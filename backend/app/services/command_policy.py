"""Authoritative command checks at creation and immediately before dispatch."""
from datetime import datetime

from fastapi import HTTPException
from app.schemas.command_profile import FrequencyLimits
from sqlalchemy.orm import Session

from app.models.auth_session import AuthSession
from app.models.command import DeviceCommand
from app.models.user import User
from app.models.device import Device
from app.models.site import Site
from app.models.organization import Organization
from app.numeric import finite_number
from app.repositories.capabilities import CapabilityRepository
from app.security.authorization import AccessControl
from app.security.current_user import CurrentUserContext
from app.security.roles import Permission


def configured_limits(session: Session, device_id) -> FrequencyLimits | None:
    for item in CapabilityRepository(session).get_enabled_assignments_for_device(device_id):
        if item.capability.code == "vfd.control":
            raw = item.config.get("frequency_limits")
            if raw is None:
                return None
            try:
                return FrequencyLimits.model_validate(raw)
            except ValueError:
                return None  # Old/invalid configuration fails closed.
    return None


def frequency_allowed(session: Session, device_id, payload: dict) -> bool:
    limits = configured_limits(session, device_id)
    value = finite_number(payload.get("frequency_hz"))
    return limits is not None and value is not None and limits.min_hz <= value <= limits.max_hz


def dispatch_rejection(session: Session, command: DeviceCommand, now: datetime) -> str | None:
    """A past audit snapshot is not current permission to actuate equipment."""
    if command.control_sequence is None:
        return "legacy_command"
    user = session.get(User, command.actor_user_id, populate_existing=True) if command.actor_user_id else None
    auth = session.get(AuthSession, command.actor_auth_session_id, populate_existing=True) if command.actor_auth_session_id else None
    if (user is None or not user.is_active or auth is None or auth.user_id != user.id
            or auth.revoked_at is not None or auth.expires_at <= now):
        return "command_access_revoked"
    device = session.get(Device, command.device_id)
    site = session.get(Site, device.site_id, populate_existing=True) if device else None
    if site:
        session.get(Organization, site.organization_id, populate_existing=True)
    try:
        access = AccessControl(session, CurrentUserContext(user, auth)).require_device_context(
            command.device_id, Permission.COMMAND_EXECUTE)
    except HTTPException:
        return "command_access_revoked"
    if access.organization_id != command.actor_organization_id:
        return "command_binding_changed"
    if "vfd.control" not in CapabilityRepository(session).get_enabled_codes_for_device(command.device_id):
        return "command_capability_disabled"
    if command.command_type == "vfd.frequency.set" and not frequency_allowed(session, command.device_id, command.payload):
        return "command_frequency_profile_changed"
    return None
