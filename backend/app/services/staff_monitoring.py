"""Bounded diagnostics from the worker process; no shell or Docker socket access."""

import os
import secrets
import shutil
import time
import urllib.request
import json

from fastapi import HTTPException
from sqlalchemy import text

STARTED_AT = time.monotonic()


def worker_snapshot():
    from app.mqtt_client import mqtt_status
    from app.services.command_reliability import command_reliability_status
    from app.services.system_alarm_worker import system_alarm_status
    from app.services.platform_audit import REQUEST_METRICS
    return {"http": dict(REQUEST_METRICS), "mqtt": {"connected": bool(mqtt_status().get("connected"))},
            "commands": command_reliability_status(), "alarms": system_alarm_status(),
            "uptime_seconds": int(time.monotonic()-STARTED_AT)}


def require_internal_probe(request):
    expected = os.getenv("STAFF_DIAGNOSTICS_SECRET", "")
    supplied = request.headers.get("x-kerumo-probe", "")
    if len(expected) < 32 or not secrets.compare_digest(expected, supplied):
        raise HTTPException(404, "Не знайдено")


def read_worker():
    url = os.getenv("STAFF_WORKER_URL", "http://backend:8000/_internal/status")
    if not url.endswith("/_internal/status") or not url.startswith(("http://", "https://")):
        return {"available": False}
    try:
        # Internal fixed destination; browser parameters can never select a URL.
        request = urllib.request.Request(url, headers={"X-Kerumo-Probe": os.getenv("STAFF_DIAGNOSTICS_SECRET", "")})
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=3) as response:
            value = json.loads(response.read(64_000))
        return {"available": True, **value}
    except Exception:
        return {"available": False}


def infrastructure_snapshot(session):
    session.execute(text("SELECT 1"))
    database_bytes = session.scalar(text("SELECT pg_database_size(current_database())"))
    connections = session.scalar(text("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()"))
    disk = shutil.disk_usage("/")
    # These are the API container's resources, not a claim to monitor the entire host.
    memory_current, memory_limit = None, None
    try:
        from pathlib import Path
        memory_current = int(Path("/sys/fs/cgroup/memory.current").read_text())
        limit = Path("/sys/fs/cgroup/memory.max").read_text().strip()
        memory_limit = int(limit) if limit != "max" else None
    except (OSError, ValueError):
        pass
    return {"database": {"available": True, "size_bytes": database_bytes, "connections": connections},
            "container": {"disk_free_bytes": disk.free, "disk_total_bytes": disk.total,
                          "memory_bytes": memory_current, "memory_limit_bytes": memory_limit,
                          "uptime_seconds": int(time.monotonic()-STARTED_AT)},
            "worker": read_worker()}
