"""Обмежені SQL-запити розкладів; порядок блокувань Device → Schedule → Command."""
from sqlalchemy import func, select

from app.models.command import DeviceCommand
from app.models.schedule import DeviceSchedule, ScheduleOccurrence


class ScheduleRepository:
    def __init__(self, session):
        self.session = session

    def get(self, schedule_id, *, lock=False):
        query = select(DeviceSchedule).where(DeviceSchedule.id == schedule_id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return self.session.scalar(query)

    def for_device(self, device_id):
        return list(self.session.scalars(select(DeviceSchedule).where(
            DeviceSchedule.device_id == device_id, DeviceSchedule.deleted_at.is_(None)
        ).order_by(DeviceSchedule.created_at, DeviceSchedule.id).limit(50)))

    def count_for_device(self, device_id):
        return self.session.scalar(select(func.count()).select_from(DeviceSchedule).where(
            DeviceSchedule.device_id == device_id, DeviceSchedule.deleted_at.is_(None)))

    def due_ids(self, now, limit=100):
        return list(self.session.scalars(select(DeviceSchedule.id).where(
            DeviceSchedule.enabled.is_(True), DeviceSchedule.deleted_at.is_(None), DeviceSchedule.next_check_at <= now
        ).order_by(DeviceSchedule.next_check_at, DeviceSchedule.id).limit(limit)))

    def occurrence(self, schedule_id, starts_at):
        return self.session.scalar(select(ScheduleOccurrence).where(
            ScheduleOccurrence.schedule_id == schedule_id, ScheduleOccurrence.starts_at == starts_at))

    def history(self, schedule_id, limit=30):
        rows = self.session.execute(select(ScheduleOccurrence, DeviceCommand).outerjoin(
            DeviceCommand, ScheduleOccurrence.command_id == DeviceCommand.id).where(
            ScheduleOccurrence.schedule_id == schedule_id).order_by(ScheduleOccurrence.starts_at.desc()).limit(limit))
        return [(run, command) for run, command in rows]

    def busy(self, device_id):
        return self.session.scalar(select(DeviceCommand.id).where(
            DeviceCommand.device_id == device_id,
            DeviceCommand.command_type != "vfd.stop",
            DeviceCommand.status.in_(("queued", "published", "acknowledged")),
        ).limit(1)) is not None
