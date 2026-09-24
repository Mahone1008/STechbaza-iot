import logging
import os
import threading
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from app.db import SessionLocal
from app.repositories.commands import CommandRepository
from app.services.command_dispatch import CommandDispatchService

logger = logging.getLogger(__name__)

COMMAND_RELIABILITY_POLL_SECONDS = float(
    os.getenv("COMMAND_RELIABILITY_POLL_SECONDS", "2")
)
COMMAND_RELIABILITY_BATCH_SIZE = int(
    os.getenv("COMMAND_RELIABILITY_BATCH_SIZE", "100")
)

_stop_event = threading.Event()
_worker_thread: threading.Thread | None = None
_state_lock = threading.Lock()
_last_cycle: dict[str, Any] | None = None


def _remember_cycle(**data: Any) -> None:
    global _last_cycle
    with _state_lock:
        _last_cycle = {
            **data,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }


def run_command_reliability_cycle() -> dict[str, Any]:
    """Один цикл: expire, publish queued та retry published без ACK."""

    with SessionLocal() as session:
        candidate_ids = CommandRepository(session).list_delivery_candidate_ids(
            limit=COMMAND_RELIABILITY_BATCH_SIZE
        )

    reasons: Counter[str] = Counter()
    published = 0

    for command_id in candidate_ids:
        try:
            with SessionLocal() as session:
                result = CommandDispatchService(session).dispatch(
                    command_id,
                    allow_retry=True,
                )
        except Exception:
            logger.exception(
                "Помилка command reliability cycle: command_id=%s",
                command_id,
            )
            reasons["internal_error"] += 1
            continue

        reasons[result.reason] += 1
        if result.published:
            published += 1

    snapshot = {
        "candidate_count": len(candidate_ids),
        "published_count": published,
        "reasons": dict(reasons),
    }
    _remember_cycle(**snapshot)
    return snapshot


def _worker_loop() -> None:
    while not _stop_event.is_set():
        try:
            run_command_reliability_cycle()
        except Exception:
            logger.exception("Помилка command reliability worker")

        _stop_event.wait(COMMAND_RELIABILITY_POLL_SECONDS)


def start_command_reliability_worker() -> None:
    """Запускає lightweight worker у backend process для локального V3.5."""

    global _worker_thread

    if _worker_thread is not None and _worker_thread.is_alive():
        return

    _stop_event.clear()
    _worker_thread = threading.Thread(
        target=_worker_loop,
        name="techbaza-command-reliability",
        daemon=True,
    )
    _worker_thread.start()


def stop_command_reliability_worker() -> None:
    global _worker_thread

    _stop_event.set()
    if _worker_thread is not None:
        _worker_thread.join(timeout=5)
    _worker_thread = None


def command_reliability_status() -> dict[str, Any]:
    with _state_lock:
        last_cycle = dict(_last_cycle) if _last_cycle is not None else None

    return {
        "running": _worker_thread is not None and _worker_thread.is_alive(),
        "poll_seconds": COMMAND_RELIABILITY_POLL_SECONDS,
        "batch_size": COMMAND_RELIABILITY_BATCH_SIZE,
        "last_cycle": last_cycle,
    }
