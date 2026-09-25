import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import exists, select

from app.db import SessionLocal
from app.models.device import Device
from app.models.event_alarm import DeviceAlarm
from app.services.presence_config import DEVICE_ONLINE_TIMEOUT_SECONDS
from app.services.system_alarms import SystemAlarmService

logger = logging.getLogger(__name__)

SYSTEM_ALARM_POLL_SECONDS = float(
    os.getenv("SYSTEM_ALARM_POLL_SECONDS", "5")
)
SYSTEM_ALARM_BATCH_SIZE = int(
    os.getenv("SYSTEM_ALARM_BATCH_SIZE", "100")
)

_stop_event = threading.Event()
_worker_thread: threading.Thread | None = None
_state_lock = threading.Lock()
_last_cycle: dict[str, Any] | None = None


def run_system_alarm_cycle(*, now: datetime | None = None) -> dict[str, int]:
    """Обробляє лише прострочені Device без відкритого offline incident."""

    current_time = now or datetime.now(timezone.utc)
    cutoff = current_time - timedelta(seconds=DEVICE_ONLINE_TIMEOUT_SECONDS)
    active_offline = exists(
        select(DeviceAlarm.id).where(
            DeviceAlarm.device_id == Device.id,
            DeviceAlarm.alarm_key == SystemAlarmService.OFFLINE_KEY,
            DeviceAlarm.state == "active",
        )
    )
    with SessionLocal() as session:
        ids = list(
            session.scalars(
                select(Device.id)
                .where(
                    Device.last_seen_at.is_not(None),
                    Device.last_seen_at < cutoff,
                    ~active_offline,
                )
                .order_by(Device.last_seen_at.asc(), Device.id.asc())
                .limit(SYSTEM_ALARM_BATCH_SIZE)
            )
        )

    raised = 0
    errors = 0
    for device_id in ids:
        try:
            with SessionLocal() as session:
                if SystemAlarmService(session).check_offline(
                    device_id=device_id,
                    now=current_time,
                ):
                    session.commit()
                    raised += 1
        except Exception:
            errors += 1
            logger.exception(
                "Помилка перевірки device.offline: device_id=%s",
                device_id,
            )

    result = {
        "candidate_count": len(ids),
        "raised_count": raised,
        "error_count": errors,
    }
    global _last_cycle
    with _state_lock:
        _last_cycle = {
            **result,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }
    return result


def _worker_loop() -> None:
    while not _stop_event.is_set():
        try:
            run_system_alarm_cycle()
        except Exception:
            logger.exception("Помилка system alarm worker")
        _stop_event.wait(SYSTEM_ALARM_POLL_SECONDS)


def start_system_alarm_worker() -> None:
    global _worker_thread
    if _worker_thread is not None and _worker_thread.is_alive():
        return
    _stop_event.clear()
    _worker_thread = threading.Thread(
        target=_worker_loop,
        name="techbaza-system-alarms",
        daemon=True,
    )
    _worker_thread.start()


def stop_system_alarm_worker() -> None:
    global _worker_thread
    _stop_event.set()
    if _worker_thread is not None:
        _worker_thread.join(timeout=5)
    _worker_thread = None


def system_alarm_status() -> dict[str, Any]:
    with _state_lock:
        last_cycle = dict(_last_cycle) if _last_cycle is not None else None
    return {
        "running": _worker_thread is not None and _worker_thread.is_alive(),
        "poll_seconds": SYSTEM_ALARM_POLL_SECONDS,
        "batch_size": SYSTEM_ALARM_BATCH_SIZE,
        "last_cycle": last_cycle,
    }
