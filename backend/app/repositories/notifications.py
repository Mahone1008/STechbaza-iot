import uuid
from datetime import datetime

from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.notification import AlarmNotification, NotificationRead
from app.models.site import Site


class NotificationRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def organization_for_device(self, device_id: uuid.UUID) -> uuid.UUID:
        return self._session.execute(
            select(Site.organization_id)
            .join(Device, Device.site_id == Site.id)
            .where(Device.id == device_id)
        ).scalar_one()

    def add_snapshot(self, **values) -> None:
        # DB UNIQUE гарантує один snapshot навіть при повторному enqueue.
        self._session.execute(
            insert(AlarmNotification)
            .values(id=uuid.uuid4(), **values)
            .on_conflict_do_nothing(constraint="uq_alarm_notifications_transition")
        )

    def get(self, notification_id: uuid.UUID) -> AlarmNotification | None:
        return self._session.get(AlarmNotification, notification_id)

    @staticmethod
    def _visible_with_reader(user_id: uuid.UUID):
        # Snapshot tenant і поточний tenant Device мають збігатися. Перенесення
        # пристрою не повинно відкрити його попередню історію новому клієнту.
        return (
            select(AlarmNotification, NotificationRead.read_at)
            .join(Device, Device.id == AlarmNotification.device_id)
            .join(Site, Site.id == Device.site_id)
            .where(Site.organization_id == AlarmNotification.organization_id)
            .outerjoin(NotificationRead, and_(
                NotificationRead.notification_id == AlarmNotification.id,
                NotificationRead.user_id == user_id,
            ))
        )

    def list_for_organization(
        self, organization_id: uuid.UUID, user_id: uuid.UUID, *,
        limit: int, offset: int, unread_only: bool = False,
    ) -> list[tuple[AlarmNotification, datetime | None]]:
        query = self._visible_with_reader(user_id).where(
            AlarmNotification.organization_id == organization_id,
        )
        if unread_only:
            query = query.where(NotificationRead.notification_id.is_(None))
        rows = self._session.execute(
            query.order_by(AlarmNotification.created_at.desc(), AlarmNotification.id.desc())
            .limit(limit).offset(offset)
        )
        return [(item, read_at) for item, read_at in rows]

    def unread_count(self, organization_id: uuid.UUID, user_id: uuid.UUID) -> int:
        query = self._visible_with_reader(user_id).where(
            AlarmNotification.organization_id == organization_id,
            NotificationRead.notification_id.is_(None),
        ).with_only_columns(func.count()).select_from(AlarmNotification)
        return self._session.scalar(query) or 0

    def read_at(self, notification_id: uuid.UUID, user_id: uuid.UUID) -> datetime | None:
        return self._session.scalar(select(NotificationRead.read_at).where(
            NotificationRead.notification_id == notification_id,
            NotificationRead.user_id == user_id,
        ))

    def mark_read(self, notification_id: uuid.UUID, user_id: uuid.UUID) -> datetime:
        self._session.execute(
            insert(NotificationRead)
            .values(notification_id=notification_id, user_id=user_id)
            .on_conflict_do_nothing(index_elements=["notification_id", "user_id"])
        )
        return self._session.execute(select(NotificationRead.read_at).where(
            NotificationRead.notification_id == notification_id,
            NotificationRead.user_id == user_id,
        )).scalar_one()
