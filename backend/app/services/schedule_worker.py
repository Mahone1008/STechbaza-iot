"""Один індексований цикл на процес; транзакційний Device-lock запобігає дублям."""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.db import SessionLocal
from app.models.schedule import ScheduleOccurrence
from app.repositories.devices import DeviceRepository
from app.repositories.schedules import ScheduleRepository
from app.schemas.command import DeviceCommandCreate
from app.schemas.schedule import ScheduleSpec
from app.services.commands import CommandService, CommandCapabilityViolationError, CommandProgramError
from app.services.device_presence import DevicePresenceService
from app.services.schedule_calendar import START_GRACE_SECONDS, run_on_date
from app.services.schedules import refresh_next, schedule_actor

logger = logging.getLogger(__name__)


def process_schedule(session, schedule_id, *, now=None):
    repo = ScheduleRepository(session)
    item = repo.get(schedule_id)
    if item is None:
        return "removed"
    device = DeviceRepository(session).get_for_update(item.device_id)
    item = repo.get(schedule_id, lock=True)
    now = now or datetime.now(timezone.utc)
    if item is None or not item.enabled or item.next_check_at is None or item.next_check_at > now:
        return "not_due"
    spec = ScheduleSpec.model_validate(item.spec)
    if item.next_start_at is None or item.next_start_at > now:
        refresh_next(item, spec, now)
        session.commit()
        return "refreshed"
    due = item.next_start_at
    run = run_on_date(spec, due.astimezone(ZoneInfo(spec.timezone)).date())
    if run is None or run.starts_at != due:
        # Після оновлення tzdata майбутні моменти обчислюються за новими правилами.
        refresh_next(item, spec, now)
        session.commit()
        return "calendar_changed"
    if repo.occurrence(item.id, due):
        refresh_next(item, spec, max(now, due) + timedelta(microseconds=1))
        session.commit()
        return "duplicate"
    occurrence = ScheduleOccurrence(id=uuid.uuid4(), schedule_id=item.id, revision=item.revision,
        starts_at=run.starts_at, stops_at=run.stops_at, status="skipped", created_at=now)
    actor = schedule_actor(session, item)
    if actor is None:
        occurrence.reason = "schedule_access_revoked"
        item.enabled = False
    elif now >= due + timedelta(seconds=START_GRACE_SECONDS) or now >= run.stops_at:
        occurrence.reason = "schedule_missed"
    elif device.last_stop_requested_at is not None and device.last_stop_requested_at >= due:
        occurrence.reason = "stop_before_dispatch"
    elif repo.busy(item.device_id):
        occurrence.reason = "device_busy"
    elif not DevicePresenceService(session).get_availability(device_id=item.device_id, now=now).online:
        occurrence.reason = "device_offline"
    else:
        try:
            command, _ = CommandService(session).create(item.device_id,
                DeviceCommandCreate(request_id=occurrence.id, command_type="vfd.schedule.start",
                    ttl_seconds=30, payload=run.model_dump(mode="json")),
                actor=actor, now=now, schedule_id=item.id, commit=False)
            occurrence.command_id = command.id
            occurrence.status = "queued"
        except (CommandCapabilityViolationError, CommandProgramError) as exc:
            occurrence.reason = str(exc)
    refresh_next(item, spec, now + timedelta(microseconds=1))
    session.add(occurrence)
    session.commit()
    return occurrence.reason or occurrence.status


def run_schedule_cycle(*, now=None, limit=100):
    with SessionLocal() as session:
        ids = ScheduleRepository(session).due_ids(now or datetime.now(timezone.utc), limit)
    counts = {}
    for schedule_id in ids:
        try:
            with SessionLocal() as session:
                result = process_schedule(session, schedule_id, now=now)
                counts[result] = counts.get(result, 0) + 1
        except Exception:
            logger.exception("Помилка календарного запуску: schedule_id=%s", schedule_id)
            counts["errors"] = counts.get("errors", 0) + 1
    return counts
