"""Перевірки команд під час створення та безпосередньо перед доставкою."""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.auth_session import AuthSession
from app.models.command import DeviceCommand
from app.models.user import User
from app.models.device import Device
from app.models.site import Site
from app.models.organization import Organization
from app.repositories.capabilities import CapabilityRepository
from app.security.authorization import AccessControl
from app.security.current_user import CurrentUserContext
from app.security.roles import Permission
from app.device_contract import COMMAND_REQUIRED_CAPABILITY
from app.services.program_policy import program_rejection
from app.services.command_profile import frequency_allowed
from app.services.equipment import equipment_rejection


def dispatch_rejection(session: Session, command: DeviceCommand, now: datetime) -> str | None:
    """Історичний audit snapshot не замінює поточний дозвіл керування."""
    if command.control_sequence is None:
        return "legacy_command"
    user = session.get(User, command.actor_user_id, populate_existing=True) if command.actor_user_id else None
    auth = session.get(AuthSession, command.actor_auth_session_id, populate_existing=True) if command.actor_auth_session_id else None
    scheduled = command.command_type == "vfd.schedule.start"
    if scheduled:
        from app.repositories.schedules import ScheduleRepository
        from app.services.schedules import schedule_actor
        from app.models.schedule import ScheduleOccurrence
        schedule = ScheduleRepository(session).get(command.schedule_id) if command.schedule_id else None
        occurrence = session.scalar(select(ScheduleOccurrence).where(ScheduleOccurrence.command_id == command.id))
        actor = schedule_actor(session, schedule) if schedule else None
        if (not schedule or schedule.deleted_at is not None or not schedule.enabled or not occurrence
                or occurrence.revision != schedule.revision or not actor
                or actor.user_id != command.actor_user_id
                or actor.organization_id != command.actor_organization_id
                or schedule.device_id != command.device_id):
            return "command_access_revoked"
    elif (user is None or not user.is_active or auth is None or auth.user_id != user.id
            or auth.revoked_at is not None or auth.expires_at <= now):
        return "command_access_revoked"
    device = session.get(Device, command.device_id)
    site = session.get(Site, device.site_id, populate_existing=True) if device else None
    if site:
        session.get(Organization, site.organization_id, populate_existing=True)
    if not scheduled:
        try:
            access = AccessControl(session, CurrentUserContext(user, auth)).require_device_context(
                command.device_id, Permission.COMMAND_EXECUTE)
        except HTTPException:
            return "command_access_revoked"
        if access.organization_id != command.actor_organization_id:
            return "command_binding_changed"
    enabled = CapabilityRepository(session).get_enabled_codes_for_device(command.device_id)
    if "vfd.control" not in enabled or COMMAND_REQUIRED_CAPABILITY[command.command_type] not in enabled:
        return "command_capability_disabled"
    if command.command_type == "vfd.frequency.set" and not frequency_allowed(session, command.device_id, command.payload):
        return "command_frequency_profile_changed"
    rejection = equipment_rejection(session, device, command, now)
    if rejection:
        return rejection
    return program_rejection(session, device, command.command_type, command.payload, now, command.id)
