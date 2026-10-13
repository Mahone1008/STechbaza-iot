"""Посилання для пропозицій не отримує identity власника чи права керування."""
import uuid
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import select

from app.models import OrganizationMembership, User
from app.models.setup_helpers import DeviceSetupHelper
from app.schemas.setup_helpers import SetupHelperContext, SetupHelperCreated, SetupHelperProfile, SetupHelperRead
from app.security.account_keys import digest, new_key, verify_digest
from app.security.tokens import utc_now
from app.services.equipment_profiles import profiles
from app.services.equipment import EquipmentConflict
from app.services.onboarding import audit
from app.services import owner_setup

PURPOSE = "device-initial-setup-helper-v1"
UNAVAILABLE = "Допомога недоступна або термін посилання завершився"


def owner_membership(session, ctx, user_id):
    return session.scalar(select(OrganizationMembership).where(
        OrganizationMembership.organization_id == ctx.organization.id,
        OrganizationMembership.user_id == user_id).execution_options(populate_existing=True))


def current_scope(row, ctx):
    return bool(row.device_id == ctx.device.id and row.controller_id == ctx.factory.id
        and row.controller_generation == ctx.factory.generation
        and row.credential_revision == ctx.factory.credential_revision
        and row.configuration_revision == (ctx.configuration.revision if ctx.configuration else 0))


def current_authority(row, user, membership):
    return bool(user and user.is_active and user.platform_role == "user"
        and user.updated_at == row.issuer_updated_at
        and membership and membership.id == row.membership_id
        and membership.updated_at == row.membership_updated_at
        and membership.is_active and membership.role == "owner" and membership.site_ids is None
        and (membership.expires_at is None or membership.expires_at > utc_now()))


def active(row, ctx, user, membership):
    return bool(row.revoked_at is None and row.expires_at > utc_now()
        and current_scope(row, ctx) and owner_setup.initial_setup_open(ctx)
        and current_authority(row, user, membership))


def read_link(row, is_active):
    return SetupHelperRead(id=row.id, created_at=row.created_at, expires_at=row.expires_at,
        revoked_at=row.revoked_at, active=is_active)


def invalidate_helpers(session, device_id):
    rows = session.scalars(select(DeviceSetupHelper).where(DeviceSetupHelper.device_id == device_id,
        DeviceSetupHelper.revoked_at.is_(None)).order_by(DeviceSetupHelper.id).with_for_update())
    for row in rows:
        row.revoked_at = utc_now()
    session.flush()


def create_helper(session, current, ctx, payload):
    owner_setup.ensure_initial_setup(ctx)
    owner_setup.check_scope(ctx, payload)
    issuer = session.get(User, current.user.id, populate_existing=True)
    membership = owner_membership(session, ctx, issuer.id)
    # require_owner_context уже утримує блокування автора й організації.
    if not owner_setup.is_setup_owner(session, issuer.id, ctx.organization.id):
        raise HTTPException(404, UNAVAILABLE)
    invalidate_helpers(session, ctx.device.id)
    secret, now = new_key(), utc_now()
    row = DeviceSetupHelper(id=uuid.uuid4(), device_id=ctx.device.id, controller_id=ctx.factory.id,
        issuer_user_id=issuer.id, issuer_updated_at=issuer.updated_at,
        membership_id=membership.id, membership_updated_at=membership.updated_at,
        controller_generation=ctx.factory.generation, credential_revision=ctx.factory.credential_revision,
        configuration_revision=ctx.configuration.revision if ctx.configuration else 0,
        token_hash=digest(PURPOSE, secret), created_at=now, expires_at=now + timedelta(hours=2))
    session.add(row)
    session.flush()
    audit(session, ctx.factory, current, "setup_helper_created", helper_id=str(row.id), device_id=str(ctx.device.id))
    return SetupHelperCreated(**read_link(row, True).model_dump(), token=f"{row.id.hex}.{secret}")


def list_helpers(session, ctx):
    rows = session.scalars(select(DeviceSetupHelper).where(DeviceSetupHelper.device_id == ctx.device.id)
        .order_by(DeviceSetupHelper.created_at.desc()).limit(20))
    return [read_link(row, active(row, ctx, session.get(User, row.issuer_user_id, populate_existing=True),
        owner_membership(session, ctx, row.issuer_user_id))) for row in rows]


def revoke_helper(session, current, ctx, helper_id):
    row = session.scalar(select(DeviceSetupHelper).where(DeviceSetupHelper.id == helper_id,
        DeviceSetupHelper.device_id == ctx.device.id).with_for_update().execution_options(populate_existing=True))
    if row is None:
        raise HTTPException(404, UNAVAILABLE)
    if row.revoked_at is None:
        row.revoked_at = utc_now()
        audit(session, ctx.factory, current, "setup_helper_revoked", helper_id=str(row.id), device_id=str(ctx.device.id))


def helper_context(session, token):
    try:
        row_id, secret = token.split(".")
        initial = session.get(DeviceSetupHelper, uuid.UUID(row_id))
    except (ValueError, AttributeError):
        raise HTTPException(404, UNAVAILABLE) from None
    if initial is None or not verify_digest(PURPOSE, secret, initial.token_hash):
        raise HTTPException(404, UNAVAILABLE)
    # Як у security/owner: автор -> factory -> org -> device -> draft -> helper.
    user = session.scalar(select(User).where(User.id == initial.issuer_user_id)
        .with_for_update().execution_options(populate_existing=True))
    if user is None:
        raise HTTPException(404, UNAVAILABLE)
    try:
        ctx = owner_setup.lock_setup_context(session, initial.controller_id)
    except (HTTPException, EquipmentConflict):
        raise HTTPException(404, UNAVAILABLE) from None
    row = session.scalar(select(DeviceSetupHelper).where(DeviceSetupHelper.id == initial.id)
        .with_for_update().execution_options(populate_existing=True))
    membership = owner_membership(session, ctx, user.id)
    if row is None or not verify_digest(PURPOSE, secret, row.token_hash) or not active(row, ctx, user, membership):
        raise HTTPException(404, UNAVAILABLE)
    return row, ctx


def public_read(session, row, ctx):
    state = owner_setup.read_setup(session, ctx)
    return SetupHelperContext(helper_id=row.id, expires_at=row.expires_at, serial_number=ctx.factory.serial_number,
        generation=state.generation, credential_revision=state.credential_revision,
        configuration_revision=state.configuration_revision, draft_revision=state.draft_revision,
        equipment=state.equipment, missing_fields=state.missing_fields, checks=state.checks, progress=state.progress,
        profiles=[SetupHelperProfile(**profile.model_dump(include={
            "id", "version", "manufacturer", "series", "support", "tested_model"})) for profile in profiles()])
