"""Тестовий incident для browser-приймання 13.1–13.2, лише в demo-базі."""

from datetime import datetime, timezone

from app.db import SessionLocal
from app.demo.catalog import identity, uid
from app.demo.seed import assert_database
from app.models.device import Device
from app.services.alarms import AlarmLifecycleService


def main():
    with SessionLocal() as session:
        assert_database(session)
        device_id = identity("device:pressure")
        device = session.get(Device, device_id)
        if device is None or device.uid != uid("pressure"):
            raise RuntimeError("Expected isolated TB-DEMO-PRESSURE fixture")
        service = AlarmLifecycleService(session)
        key = "demo.frontend.acknowledgement"
        # Зберігаємо попередній incident в історії та починаємо нове приймання.
        service.resolve_alarm(device_id=device_id, alarm_key=key,
                              occurred_at=datetime.now(timezone.utc), reason="browser_fixture_reset")
        service.raise_alarm(device_id=device_id, alarm_key=key, alarm_type=key,
                            severity="warning", title="DEMO: acknowledgement check",
                            occurred_at=datetime.now(timezone.utc),
                            description="Browser acceptance fixture; no equipment fault or control action.",
                            context={"source": "stage13_browser_fixture"})
        print("PASS: isolated stage 13 acknowledgement fixture prepared; existing history preserved.")


if __name__ == "__main__":
    main()
