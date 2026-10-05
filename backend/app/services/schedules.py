"""Довготривале доручення на календарні запуски з перевіркою чинних прав."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.models.organization import Organization
from app.models.schedule import DeviceSchedule, ScheduleRevision
from app.models.site import Site
from app.models.user import User
from app.repositories.capabilities import CapabilityRepository
from app.repositories.devices import DeviceRepository
from app.repositories.memberships import MembershipRepository
from app.repositories.schedules import ScheduleRepository
from app.repositories.telemetry import TelemetryRepository
from app.schemas.program import MAX_PROGRAM_SECONDS
from app.schemas.schedule import SchedulePreview, ScheduleSpec
from app.security.roles import Permission, PlatformRole, role_has_permission
from app.services.command_profile import configured_limits
from app.services.commands import CommandActorSnapshot
from app.services.program_policy import read_program_progress
from app.services.schedule_calendar import first_overlap, self_overlap, upcoming

MAX_DEVICE_SCHEDULES = 8


def schedule_actor(session, schedule):
    user = session.get(User, schedule.author_user_id, populate_existing=True)
    device = DeviceRepository(session).get(schedule.device_id)
    site = session.get(Site, device.site_id, populate_existing=True) if device else None
    org = session.get(Organization, schedule.organization_id, populate_existing=True)
    if user is None or not user.is_active or not site or site.organization_id != schedule.organization_id or not org or not org.is_active:
        return None
    membership = MembershipRepository(session).get_active(user.id, org.id)
    role = membership.role if membership else None
    if user.platform_role != PlatformRole.SUPERADMIN.value and (role is None or (membership.site_ids is not None and str(site.id) not in membership.site_ids) or not role_has_permission(role, Permission.COMMAND_EXECUTE)):
        return None
    # Logout не відкликає збережене доручення. Чинні User/RBAC перевіряються кожного запуску.
    return CommandActorSnapshot(user.id, None, org.id, user.platform_role, role, user.email, user.display_name)


def refresh_next(schedule, spec, after):
    runs = upcoming(spec, after) if schedule.enabled else []
    schedule.next_start_at = runs[0].starts_at if runs else None
    schedule.next_check_at = min(schedule.next_start_at, after + timedelta(days=1)) if runs else None


class ScheduleService:
    def __init__(self, session):
        self.session = session
        self.repo = ScheduleRepository(session)

    def validate_device(self, device_id, spec):
        device = DeviceRepository(self.session).get(device_id)
        site = self.session.get(Site, device.site_id)
        if spec.timezone != site.timezone:
            raise HTTPException(409, "Часовий пояс має відповідати об'єкту; оновіть форму")
        enabled = CapabilityRepository(self.session).get_enabled_codes_for_device(device_id)
        if not {"vfd.control", "vfd.program", "vfd.schedule"} <= enabled:
            raise HTTPException(409, "Для розкладу потрібні увімкнені керування, етапи та календарні запуски")
        limits = configured_limits(self.session, device_id)
        if limits is None or any(not limits.min_hz <= hz <= limits.max_hz for hz in [spec.frequency_hz, *(change.frequency_hz for change in spec.changes)]):
            raise HTTPException(409, "Частота розкладу поза робочими межами обладнання")
        duration = (datetime.combine(spec.start_date + timedelta(days=spec.stop_day_offset), spec.stop_time)
            - datetime.combine(spec.start_date, spec.start_time)).total_seconds()
        if duration > MAX_PROGRAM_SECONDS:
            progress = read_program_progress(TelemetryRepository(self.session).get_state(device_id))
            if progress is None or not progress.supports_schedule or duration > progress.max_schedule_seconds:
                raise HTTPException(409, "Для запуску понад добу оновіть прошивку контролера до 0.5.0 та дочекайтеся нової телеметрії")

    def preview(self, device_id, spec, *, exclude_id=None, now=None):
        self.validate_device(device_id, spec)
        now = now or datetime.now(timezone.utc)
        if self_overlap(spec, now):
            raise HTTPException(409, "Запуски цього розкладу перетинаються. Збільшіть інтервал повторення або скоротіть тривалість")
        conflicts = [item.id for item in self.repo.for_device(device_id)
            if item.enabled and item.id != exclude_id and first_overlap(spec, ScheduleSpec.model_validate(item.spec), now)]
        return SchedulePreview(runs=upcoming(spec, now, limit=5), conflicts=conflicts, notes=[
            "Пропущений місцевий час не запускається; повторна година виконується лише один раз.",
            "Початок допускає до 30 с запізнення. Офлайн-запуск не підтримується; STOP виконує контролер.",
            "Перетини перевірено на найближчі 366 днів; під час кожного запуску діє блокування зайнятого пристрою.",
        ])

    def write(self, device_id, data, current, access, *, now=None):
        DeviceRepository(self.session).get_for_update(device_id)
        now = now or datetime.now(timezone.utc)
        existing = self.repo.get(data.id, lock=True)
        if existing and (existing.device_id != device_id or existing.organization_id != access.organization_id):
            raise HTTPException(404, "Ресурс не знайдено")
        if existing and existing.deleted_at is not None:
            raise HTTPException(404, "Розклад видалено; створіть новий")
        spec = data.spec.model_dump(mode="json")
        # Повтор PUT після втрати відповіді не створює ревізію чи нове доручення.
        if existing and existing.revision == data.expected_revision + 1 and existing.author_user_id == current.user.id and existing.spec == spec and existing.enabled == data.enabled:
            return existing
        if (existing.revision if existing else 0) != data.expected_revision:
            raise HTTPException(409, "Розклад змінено іншим користувачем. Оновіть список")
        if existing is None and self.repo.count_for_device(device_id) >= MAX_DEVICE_SCHEDULES:
            raise HTTPException(409, "До 8 розкладів на пристрій, включно з призупиненими. Видаліть один або змініть наявний")
        if data.enabled:
            preview = self.preview(device_id, data.spec, exclude_id=data.id, now=now)
            if not preview.runs:
                raise HTTPException(409, "У цьому періоді немає майбутніх коректних запусків")
            if preview.conflicts:
                raise HTTPException(409, "Розклад перетинається з іншим увімкненим розкладом")
        item = existing or DeviceSchedule(id=data.id, device_id=device_id, organization_id=access.organization_id, created_at=now)
        item.author_user_id = current.user.id
        item.revision = data.expected_revision + 1
        item.spec = spec
        item.enabled = data.enabled
        item.updated_at = now
        refresh_next(item, data.spec, now)
        self.session.add(item)
        self.session.flush()
        self.session.add(ScheduleRevision(schedule_id=item.id, revision=item.revision, actor_user_id=current.user.id,
            actor_auth_session_id=current.auth_session.id, spec=spec, enabled=item.enabled, created_at=now))
        self.session.commit()
        return item

    def delete(self, device_id, schedule_id, expected_revision, current, access, *, now=None):
        DeviceRepository(self.session).get_for_update(device_id)
        item = self.repo.get(schedule_id, lock=True)
        if item is None or item.device_id != device_id or item.organization_id != access.organization_id:
            raise HTTPException(404, "Ресурс не знайдено")
        # Retrying a lost DELETE response cannot remove a different revision or rule.
        if item.deleted_at is not None:
            return
        if item.revision != expected_revision:
            raise HTTPException(409, "Розклад змінено іншим користувачем. Оновіть список")
        now = now or datetime.now(timezone.utc)
        item.deleted_at = now
        item.enabled = False
        item.next_start_at = None
        item.next_check_at = None
        item.revision += 1
        item.updated_at = now
        self.session.add(ScheduleRevision(schedule_id=item.id, revision=item.revision, actor_user_id=current.user.id,
            actor_auth_session_id=current.auth_session.id, spec=item.spec, enabled=False, created_at=now, deleted_at=now))
        self.session.commit()
