"""Private operations API. Never mounted on the customer application."""

import uuid
from datetime import datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import String, cast, delete, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.api.auth_throttle import throttle_auth
from app.db import get_db_session
from app.models import AuthSession, Device, Organization, OrganizationMembership, Site, User
from app.models.onboarding import AccountSecurity
from app.models.platform_audit import PlatformAudit
from app.schemas.organization import OrganizationRead
from app.schemas.site import SiteRead
from app.schemas.staff import (AuditRead, OrganizationChange, SiteChange, StaffProof, StaffSessionRead,
                               StaffUserRead, UserChange, UserSecurityReset, StaffOverview, StaffDeviceRead, StaffMonitorRead, StaffMembershipChange, StaffMembershipCreate)
from app.security.current_user import CurrentUserContext, get_current_user_context
from app.security.mfa_policy import require_privileged_mfa
from app.security.plane import APP_PLANE, STAFF_ROLES
from app.security.tokens import utc_now
from app.services.account_security import AccountSecurityService
from app.services.platform_audit import audit

Db = Annotated[Session, Depends(get_db_session)]
Current = Annotated[CurrentUserContext, Depends(get_current_user_context)]


def require_staff(current: Current):
    if APP_PLANE != "staff" or current.user.platform_role not in STAFF_ROLES:
        raise HTTPException(404, "Сторінку не знайдено")
    require_privileged_mfa(current)
    return current


def require_admin(current: Annotated[CurrentUserContext, Depends(require_staff)]):
    if current.user.platform_role != "superadmin":
        raise HTTPException(403, "Доступ лише головному адміністратору")
    return current


Admin = Annotated[CurrentUserContext, Depends(require_admin)]
router = APIRouter(prefix="/staff", tags=["staff"], dependencies=[Depends(require_staff)])


def prove(session, request, current, payload):
    throttle_auth(request, session, email="staff-action:"+current.user.email)
    # Serialize administrative role changes and re-check the actor after this lock.
    session.execute(text("SELECT pg_advisory_xact_lock(8340040)"))
    actor = session.get(User, current.user.id, populate_existing=True)
    auth = session.get(AuthSession, current.auth_session.id, populate_existing=True)
    if not actor or not actor.is_active or actor.platform_role != "superadmin" or not auth or auth.revoked_at or auth.expires_at <= utc_now() or not auth.mfa_verified_at:
        raise HTTPException(403, "Доступ змінився. Увійдіть повторно")
    AccountSecurityService(session).prove(current, payload.proof)


def locked(session, model, resource_id, expected=None):
    row = session.scalar(select(model).where(model.id == resource_id).with_for_update().execution_options(populate_existing=True))
    if row is None:
        raise HTTPException(404, "Запис не знайдено")
    if expected is not None and row.updated_at != expected:
        raise HTTPException(409, "Запис уже змінено. Оновіть список і повторіть дію")
    return row


def user_read(session, user):
    security = session.get(AccountSecurity, user.id)
    active = session.scalar(select(func.count()).select_from(AuthSession).where(
        AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None), AuthSession.expires_at > utc_now()))
    return StaffUserRead(id=user.id, email=user.email, login_name=user.login_name,
                         display_name=user.display_name, platform_role=user.platform_role,
                         is_active=user.is_active, email_verified=bool(user.email_verified_at),
                         mfa_enabled=bool(security and security.totp_enabled_at), active_sessions=active,
                         last_login_at=user.last_login_at, updated_at=user.updated_at)


@router.get("/users", response_model=list[StaffUserRead])
def users(session: Db, current: Admin, q: str = Query(default="", max_length=160),
          limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0)):
    stmt = select(User).order_by(User.email).limit(limit).offset(offset)
    if q:
        pattern = "%"+q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")+"%"
        stmt = stmt.where(or_(User.email.ilike(pattern), User.display_name.ilike(pattern)))
    return [user_read(session, row) for row in session.scalars(stmt)]


@router.patch("/users/{user_id}", response_model=StaffUserRead)
def change_user(user_id: uuid.UUID, payload: UserChange, request: Request, session: Db, current: Admin):
    prove(session, request, current, payload)
    user = locked(session, User, user_id, payload.expected_updated_at)
    resulting_role = payload.platform_role.value if payload.platform_role else user.platform_role
    resulting_active = payload.is_active if payload.is_active is not None else user.is_active
    if user.id == current.user.id and (not resulting_active or resulting_role != "superadmin"):
        raise HTTPException(409, "Власний адміністративний доступ змінює інший головний адміністратор")
    if user.platform_role == "superadmin" and user.is_active and (not resulting_active or resulting_role != "superadmin"):
        count = session.scalar(select(func.count()).select_from(User).where(User.platform_role == "superadmin", User.is_active.is_(True)))
        if count <= 1:
            raise HTTPException(409, "Потрібен хоча б один активний головний адміністратор")
    if user.is_active and not resulting_active:
        owned = session.scalars(select(OrganizationMembership.organization_id).where(
            OrganizationMembership.user_id == user.id, OrganizationMembership.role == "owner", OrganizationMembership.is_active.is_(True)))
        for org_id in owned:
            others = session.scalar(select(func.count()).select_from(OrganizationMembership).join(User).where(
                OrganizationMembership.organization_id == org_id, OrganizationMembership.role == "owner",
                OrganizationMembership.is_active.is_(True), User.is_active.is_(True), User.id != user.id))
            if not others:
                raise HTTPException(409, "Спочатку призначте іншого власника організації")
    before = dict(platform_role=user.platform_role, is_active=user.is_active, display_name=user.display_name)
    user.platform_role, user.is_active = resulting_role, resulting_active
    if payload.display_name is not None:
        user.display_name = payload.display_name
    if resulting_role != before["platform_role"] or not resulting_active:
        session.execute(update(AuthSession).where(AuthSession.user_id == user.id).values(revoked_at=utc_now()))
    audit(session, request, current, "user.updated", "user", user.id,
          {"reason": payload.reason, "before": before, "after": dict(platform_role=user.platform_role, is_active=user.is_active, display_name=user.display_name)})
    session.commit()
    session.refresh(user)
    return user_read(session, user)


@router.post("/users/{user_id}/security-reset", status_code=204)
def reset_security(user_id: uuid.UUID, payload: UserSecurityReset, request: Request, session: Db, current: Admin):
    prove(session, request, current, payload)
    user = locked(session, User, user_id)
    row = session.scalar(select(AccountSecurity).where(AccountSecurity.user_id == user.id).with_for_update())
    if row:
        row.totp_secret, row.totp_enabled_at, row.totp_last_counter = None, None, None
        if payload.include_recovery:
            row.recovery_hash = None
    session.execute(update(AuthSession).where(AuthSession.user_id == user.id).values(revoked_at=utc_now(), mfa_verified_at=None))
    audit(session, request, current, "user.security_reset", "user", user.id,
          {"reason": payload.reason, "recovery_reset": payload.include_recovery, "password_preserved": True})
    session.commit()
    return Response(status_code=204)


@router.get("/users/{user_id}/sessions", response_model=list[StaffSessionRead])
def user_sessions(user_id: uuid.UUID, session: Db, current: Admin):
    return list(session.scalars(select(AuthSession).where(AuthSession.user_id == user_id,
        AuthSession.revoked_at.is_(None), AuthSession.expires_at > utc_now()).order_by(AuthSession.created_at.desc()).limit(100)))


@router.post("/users/{user_id}/sessions/revoke", status_code=204)
def revoke_sessions(user_id: uuid.UUID, payload: StaffProof, request: Request, session: Db, current: Admin):
    prove(session, request, current, payload)
    locked(session, User, user_id)
    session.execute(update(AuthSession).where(AuthSession.user_id == user_id).values(revoked_at=utc_now()))
    audit(session, request, current, "user.sessions_revoked", "user", user_id, {"reason": payload.reason})
    session.commit()
    return Response(status_code=204)


@router.patch("/organizations/{organization_id}", response_model=OrganizationRead)
def change_org(organization_id: uuid.UUID, payload: OrganizationChange, request: Request, session: Db, current: Admin):
    prove(session, request, current, payload)
    org = locked(session, Organization, organization_id, payload.expected_updated_at)
    if not payload.is_active and session.scalar(select(Device.id).join(Site).where(Site.organization_id == org.id).limit(1)):
        raise HTTPException(409, "Організація має обладнання. Спочатку виконайте безпечну передачу або списання контролерів")
    org.name, org.is_active = payload.name, payload.is_active
    audit(session, request, current, "organization.updated", "organization", org.id,
          {"reason": payload.reason, "name": org.name, "is_active": org.is_active})
    session.commit()
    return org


@router.delete("/organizations/{organization_id}", status_code=204)
def delete_org(organization_id: uuid.UUID, payload: StaffProof, request: Request, session: Db, current: Admin):
    prove(session, request, current, payload)
    org = locked(session, Organization, organization_id)
    if org.is_active or session.scalar(select(Device.id).join(Site).where(Site.organization_id == org.id).limit(1)):
        raise HTTPException(409, "Видалення доступне лише для порожньої архівної організації")
    audit(session, request, current, "organization.deleted", "organization", org.id, {"reason": payload.reason, "name": org.name})
    session.execute(delete(Site).where(Site.organization_id == org.id))
    session.delete(org)
    session.commit()
    return Response(status_code=204)


@router.patch("/sites/{site_id}", response_model=SiteRead)
def change_site(site_id: uuid.UUID, payload: SiteChange, request: Request, session: Db, current: Admin):
    prove(session, request, current, payload)
    try:
        ZoneInfo(payload.timezone)
    except ZoneInfoNotFoundError:
        raise HTTPException(422, "Оберіть чинний часовий пояс") from None
    site = locked(session, Site, site_id, payload.expected_updated_at)
    if site.timezone != payload.timezone and session.scalar(select(Device.id).where(Device.site_id == site.id).limit(1)):
        raise HTTPException(409, "Часовий пояс об’єкта з обладнанням потребує узгодження розкладів. Створіть новий об’єкт із потрібним поясом і виконайте безпечне переміщення")
    site.name, site.timezone = payload.name, payload.timezone
    audit(session, request, current, "site.updated", "site", site.id,
          {"reason": payload.reason, "name": site.name, "timezone": site.timezone})
    session.commit()
    return site


@router.delete("/sites/{site_id}", status_code=204)
def delete_site(site_id: uuid.UUID, payload: StaffProof, request: Request, session: Db, current: Admin):
    prove(session, request, current, payload)
    site = locked(session, Site, site_id)
    if session.scalar(select(Device.id).where(Device.site_id == site.id).limit(1)):
        raise HTTPException(409, "Об’єкт має обладнання. Спочатку передайте або спишіть контролери")
    # Scoped memberships and pending invitations must not point at a removed object.
    from app.models import AccountLink
    for model in (OrganizationMembership, AccountLink):
        for row in session.scalars(select(model).where(model.organization_id == site.organization_id).with_for_update()):
            if row.site_ids and str(site.id) in row.site_ids:
                row.site_ids = [value for value in row.site_ids if value != str(site.id)]
                if not row.site_ids:
                    if isinstance(row, OrganizationMembership):
                        row.is_active = False
                    else:
                        row.revoked_at = utc_now()
                    row.site_ids = None
    audit(session, request, current, "site.deleted", "site", site.id, {"reason": payload.reason, "name": site.name})
    session.delete(site)
    session.commit()
    return Response(status_code=204)


@router.get("/audit", response_model=list[AuditRead])
def audit_list(session: Db, current: Admin, action: str = Query(default="", max_length=80),
               actor: uuid.UUID | None = None, request_id: uuid.UUID | None = None,
               since: datetime | None = None, failed_only: bool = False,
               limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0)):
    stmt = select(PlatformAudit).order_by(PlatformAudit.occurred_at.desc(), PlatformAudit.id).limit(limit).offset(offset)
    if action:
        stmt = stmt.where(PlatformAudit.action == action)
    if actor:
        stmt = stmt.where(PlatformAudit.actor_user_id == actor)
    if request_id:
        stmt = stmt.where(PlatformAudit.request_id == str(request_id))
    if since:
        stmt = stmt.where(PlatformAudit.occurred_at >= since)
    if failed_only:
        stmt = stmt.where(PlatformAudit.status >= 400)
    result = []
    for row in session.scalars(stmt):
        actor = session.get(User, row.actor_user_id) if row.actor_user_id else None
        item = AuditRead.model_validate(row).model_copy(update={"actor_email": actor.email if actor else None})
        result.append(item)
    return result


def visible_sites(current):
    stmt = select(Site.id).select_from(Site).join(Organization, Site.organization_id == Organization.id)
    if current.user.platform_role != "superadmin":
        stmt = stmt.join(OrganizationMembership, OrganizationMembership.organization_id == Organization.id).where(
            Organization.is_active.is_(True), OrganizationMembership.user_id == current.user.id,
            OrganizationMembership.is_active.is_(True),
            or_(OrganizationMembership.expires_at.is_(None), OrganizationMembership.expires_at > utc_now()),
            or_(OrganizationMembership.site_ids.is_(None), cast(OrganizationMembership.site_ids, JSONB).has_key(cast(Site.id, String))),
        )
    return stmt


@router.get("/overview", response_model=StaffOverview)
def overview(session: Db, current: Current):
    site_scope = visible_sites(current)
    devices = select(Device.id).where(Device.site_id.in_(site_scope))
    from app.models import DeviceAlarm
    from app.services.presence_config import DEVICE_ONLINE_TIMEOUT_SECONDS
    count = lambda model, condition: session.scalar(select(func.count()).select_from(model).where(condition))
    if current.user.platform_role == "superadmin":
        organization_count = session.scalar(select(func.count()).select_from(Organization))
    else:
        # Includes assigned empty organizations, while inventory respects the site scope.
        organization_count = count(OrganizationMembership, (OrganizationMembership.user_id == current.user.id)
            & OrganizationMembership.is_active.is_(True)
            & or_(OrganizationMembership.expires_at.is_(None), OrganizationMembership.expires_at > utc_now())
            & OrganizationMembership.organization_id.in_(select(Organization.id).where(Organization.is_active.is_(True))))
    return StaffOverview(organizations=organization_count, sites=count(Site, Site.id.in_(site_scope)),
        devices=count(Device, Device.id.in_(devices)), offline_devices=count(Device, Device.id.in_(devices)
            & or_(Device.last_seen_at.is_(None), Device.last_seen_at < utc_now()-timedelta(seconds=DEVICE_ONLINE_TIMEOUT_SECONDS))),
        active_alarms=count(DeviceAlarm, DeviceAlarm.device_id.in_(devices) & (DeviceAlarm.state == "active")),
        users=session.scalar(select(func.count()).select_from(User)) if current.user.platform_role == "superadmin" else None,
        login_failures_24h=count(PlatformAudit, (PlatformAudit.occurred_at > utc_now()-timedelta(days=1))
            & (PlatformAudit.status >= 400) & (PlatformAudit.details["route"].astext.like("%/login"))) if current.user.platform_role == "superadmin" else None)


@router.get("/devices", response_model=list[StaffDeviceRead])
def device_directory(session: Db, current: Current, q: str = Query(default="", max_length=160),
                     offline_only: bool = False, limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0)):
    from app.services.presence_config import DEVICE_ONLINE_TIMEOUT_SECONDS
    now = utc_now()
    stmt = select(Device, Site.name, Organization.id, Organization.name).select_from(Device).join(Site, Device.site_id == Site.id).join(Organization, Site.organization_id == Organization.id).where(Device.site_id.in_(visible_sites(current)))
    if q:
        pattern = "%"+q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")+"%"
        stmt = stmt.where(or_(Device.name.ilike(pattern), Device.uid.ilike(pattern), Organization.name.ilike(pattern), Site.name.ilike(pattern)))
    if offline_only:
        stmt = stmt.where(or_(Device.last_seen_at.is_(None), Device.last_seen_at < now-timedelta(seconds=DEVICE_ONLINE_TIMEOUT_SECONDS)))
    rows = session.execute(stmt.order_by(Organization.name, Site.name, Device.name, Device.id).limit(limit).offset(offset))
    return [StaffDeviceRead(id=device.id, name=device.name, uid=device.uid, site_id=device.site_id,
        site_name=site_name, organization_id=org_id, organization_name=org_name,
        lifecycle_status=device.lifecycle_status, last_seen_at=device.last_seen_at,
        online=bool(device.last_seen_at and (now-device.last_seen_at).total_seconds() <= DEVICE_ONLINE_TIMEOUT_SECONDS))
        for device, site_name, org_id, org_name in rows]


@router.get("/monitoring", response_model=StaffMonitorRead)
def monitoring(session: Db, current: Admin):
    from app.services.staff_monitoring import infrastructure_snapshot
    return infrastructure_snapshot(session)


@router.post("/organizations/{organization_id}/memberships", status_code=201)
def add_member(organization_id: uuid.UUID, payload: StaffMembershipCreate, request: Request, session: Db, current: Admin):
    from app.schemas.membership import MembershipCreate
    from app.services.memberships import MembershipService, MembershipAlreadyExistsError, MembershipUserNotFoundError
    prove(session, request, current, payload)
    try:
        row = MembershipService(session).create(organization_id,
            MembershipCreate(user_id=payload.user_id, role=payload.role, site_ids=payload.site_ids, expires_at=payload.expires_at),
            actor_user_id=current.user.id, actor_is_superadmin=True, commit=False)
    except MembershipAlreadyExistsError:
        raise HTTPException(409, "Учасник уже має доступ. Оновіть його права у списку") from None
    except MembershipUserNotFoundError:
        raise HTTPException(404, "Користувача не знайдено або вимкнено") from None
    audit(session, request, current, "membership.created", "membership", row.id,
        {"reason": payload.reason, "organization_id": str(organization_id), "user_id": str(row.user_id), "role": row.role, "site_ids": row.site_ids})
    session.commit()
    return {"id": row.id}


@router.patch("/organizations/{organization_id}/memberships/{membership_id}")
def change_member(organization_id: uuid.UUID, membership_id: uuid.UUID, payload: StaffMembershipChange, request: Request, session: Db, current: Admin):
    from app.schemas.membership import MembershipUpdate
    from app.services.memberships import MembershipService, MembershipLastOwnerError, MembershipNotFoundError
    prove(session, request, current, payload)
    locked(session, Organization, organization_id)
    row = locked(session, OrganizationMembership, membership_id, payload.expected_updated_at)
    if row.organization_id != organization_id:
        raise HTTPException(404, "Учасника не знайдено")
    before = dict(role=row.role, is_active=row.is_active, site_ids=row.site_ids)
    try:
        row = MembershipService(session).update(organization_id, membership_id,
            MembershipUpdate(role=payload.role, is_active=payload.is_active, site_ids=payload.site_ids, expires_at=payload.expires_at),
            actor_user_id=current.user.id, actor_is_superadmin=True, commit=False)
    except MembershipLastOwnerError:
        raise HTTPException(409, "Не можна прибрати останнього активного власника організації") from None
    except MembershipNotFoundError:
        raise HTTPException(404, "Учасника не знайдено") from None
    audit(session, request, current, "membership.updated", "membership", row.id,
        {"reason": payload.reason, "organization_id": str(organization_id), "before": before,
         "after": dict(role=row.role, is_active=row.is_active, site_ids=row.site_ids)})
    session.commit()
    return {"id": row.id}
