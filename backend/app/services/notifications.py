import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.event_alarm import AlarmTransition, DeviceAlarm
from app.repositories.notifications import NotificationRepository


class NotificationService:
    """Формує in-app стрічку в тій самій транзакції, що й Alarm.

    Мережевих викликів та незалежних commit під час запису transition немає.
    Доставка у зовнішні канали буде окремим consumer з власними retries.
    """

    NOTIFIABLE_TRANSITIONS = frozenset({"raised", "severity_changed", "resolved"})

    def __init__(self, session: Session) -> None:
        self._session = session
        self._notifications = NotificationRepository(session)

    def record_alarm_transition(
        self, *, alarm: DeviceAlarm, transition: AlarmTransition,
    ) -> None:
        if transition.transition_type not in self.NOTIFIABLE_TRANSITIONS:
            return
        if transition.alarm_id != alarm.id:
            raise ValueError("Transition does not belong to this alarm")
        self._notifications.add_snapshot(
            organization_id=self._notifications.organization_for_device(alarm.device_id),
            device_id=alarm.device_id,
            alarm_id=alarm.id,
            transition_id=transition.id,
            kind=transition.transition_type,
            severity=alarm.severity,
            title=alarm.title,
            description=alarm.description,
            occurred_at=transition.occurred_at,
        )

    def mark_read(self, notification_id: uuid.UUID, user_id: uuid.UUID) -> datetime:
        """Викликати після перевірки доступу; зберігає час першого прочитання."""
        try:
            read_at = self._notifications.mark_read(notification_id, user_id)
            self._session.commit()
            return read_at
        except Exception:
            self._session.rollback()
            raise
