import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.repositories.devices import DeviceRepository
from app.services.presence_config import DEVICE_ONLINE_TIMEOUT_SECONDS
from app.services.system_alarms import SystemAlarmService



class PresenceDeviceNotFoundError(Exception):
    """Пристрій для heartbeat або availability не знайдено."""


@dataclass(frozen=True, slots=True)
class DeviceAvailability:
    """Розрахований online/offline стан пристрою."""

    device_id: uuid.UUID
    uid: str
    online: bool
    last_seen_at: datetime | None
    timeout_seconds: int
    seconds_since_seen: float | None


@dataclass(frozen=True, slots=True)
class PresenceHeartbeatResult:
    """Чи справді heartbeat підтвердив актуальну boot session."""

    seen_at: datetime | None
    accepted: bool
    reason: str


class DevicePresenceService:
    """Оновлює last_seen_at і розраховує актуальну доступність Device."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._devices = DeviceRepository(session)

    def mark_seen(
        self,
        *,
        device_uid: str,
        received_at: datetime | None = None,
        session_id: uuid.UUID | None = None,
        message_id: uuid.UUID | None = None,
        sequence: int | None = None,
    ) -> PresenceHeartbeatResult:
        device = self._devices.get_by_uid_for_update(device_uid)
        if device is None:
            raise PresenceDeviceNotFoundError

        seen_at = received_at or datetime.now(timezone.utc)
        system = SystemAlarmService(self._session)
        try:
            reason = "legacy_heartbeat"
            if session_id is not None:
                if message_id is None:
                    raise ValueError("session-aware heartbeat потребує message_id")
                reason = system.observe_session(
                    device=device,
                    session_id=session_id,
                    message_id=message_id,
                    heartbeat_sequence=sequence,
                    occurred_at=seen_at,
                )
                if reason in {
                    "old_session_reappeared",
                    "duplicate_message_id",
                    "stale_heartbeat_sequence",
                }:
                    return PresenceHeartbeatResult(
                        seen_at=device.last_seen_at,
                        accepted=False,
                        reason=reason,
                    )

            if device.last_seen_at is None or device.last_seen_at < seen_at:
                device.last_seen_at = seen_at
            system.mark_online(
                device=device,
                occurred_at=seen_at,
                source_message_id=message_id,
            )
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise
        return PresenceHeartbeatResult(
            seen_at=seen_at,
            accepted=True,
            reason=reason,
        )

    def get_availability(
        self,
        *,
        device_id: uuid.UUID,
        now: datetime | None = None,
    ) -> DeviceAvailability:
        device = self._devices.get(device_id)
        if device is None:
            raise PresenceDeviceNotFoundError

        current_time = now or datetime.now(timezone.utc)

        if device.last_seen_at is None:
            return DeviceAvailability(
                device_id=device.id,
                uid=device.uid,
                online=False,
                last_seen_at=None,
                timeout_seconds=DEVICE_ONLINE_TIMEOUT_SECONDS,
                seconds_since_seen=None,
            )

        elapsed = current_time - device.last_seen_at
        seconds_since_seen = max(elapsed.total_seconds(), 0.0)
        online = elapsed <= timedelta(seconds=DEVICE_ONLINE_TIMEOUT_SECONDS)

        return DeviceAvailability(
            device_id=device.id,
            uid=device.uid,
            online=online,
            last_seen_at=device.last_seen_at,
            timeout_seconds=DEVICE_ONLINE_TIMEOUT_SECONDS,
            seconds_since_seen=seconds_since_seen,
        )
