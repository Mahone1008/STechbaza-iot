import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.repositories.devices import DeviceRepository

DEVICE_ONLINE_TIMEOUT_SECONDS = int(
    os.getenv("DEVICE_ONLINE_TIMEOUT_SECONDS", "90")
)


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
    ) -> datetime:
        device = self._devices.get_by_uid(device_uid)
        if device is None:
            raise PresenceDeviceNotFoundError

        seen_at = received_at or datetime.now(timezone.utc)
        device.last_seen_at = seen_at
        self._session.commit()
        return seen_at

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
