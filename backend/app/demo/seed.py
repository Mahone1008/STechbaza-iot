"""Атомарна підготовка лише окремої demo-бази, без видалення/перезапису даних."""

import json
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, text

from app.db import SessionLocal
from app.demo.catalog import ACCOUNTS, DATABASE_NAME, DEVICES, email, identity, manifest, require_demo, uid
from app.models.capability import Capability, DeviceCapability
from app.models.device import Device
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.models.site import Site
from app.models.telemetry import DeviceState, TelemetryMessage
from app.models.user import User
from app.schemas.alarm_rule import parse_alarm_rules
from app.security.passwords import hash_password, verify_password

FREQUENCY_CONFIG = {"frequency_limits": {"min_hz": 0, "max_hz": 50}}

PRESSURE_CONFIG = {"alarm_rules": [{
    "rule_key": "demo.pressure.low", "alarm_type": "demo.pressure.low",
    "metric": "pressure.bar", "kind": "low", "threshold": 1.0, "clear_threshold": 1.5,
    "debounce_samples": 2, "severity": "warning", "title": "DEMO: низький тиск",
}]}


def assert_database(session):
    require_demo()
    if session.scalar(text("SELECT current_database()")) != DATABASE_NAME:
        raise RuntimeError("Demo seed дозволений лише в окремій БД techbaza_demo")


def seed():
    require_demo()
    passwords = {key: os.environ.get("DEMO_" + key.upper() + "_PASSWORD", "") for key in ACCOUNTS}
    if any(not 32 <= len(value) <= 128 for value in passwords.values()):
        raise RuntimeError("Потрібні demo passwords довжиною 32..128 з локального .env.demo")
    parse_alarm_rules(PRESSURE_CONFIG)
    with SessionLocal.begin() as session:
        assert_database(session)
        session.execute(text("SELECT pg_advisory_xact_lock(8340004)"))
        exists = session.get(Organization, identity("org:a"))
        if exists is not None:
            # Повторний запуск не повертає змінені права/config до початкових
            # і не маскує втрачений файл credentials новими паролями.
            for key in ("a", "b"):
                org = session.get(Organization, identity("org:" + key))
                site = session.get(Site, identity("site:" + key))
                if not org or org.slug != "techbaza-demo-" + key or not site or site.organization_id != org.id:
                    raise RuntimeError("Demo identity пошкоджено; автоматичний перезапис заборонено")
            for key in DEVICES:
                device = session.get(Device, identity("device:" + key))
                if not device or device.uid != uid(key) or device.site_id != identity("site:" + DEVICES[key]["org"]):
                    raise RuntimeError("Demo device identity пошкоджено")
            for key in ACCOUNTS:
                user = session.get(User, identity("user:" + key))
                if not user or user.email != email(key) or not verify_password(passwords[key], user.password_hash):
                    raise RuntimeError("Demo credentials не збігаються; пароль не змінено")
            # Межі віртуального VFD відомі; додаємо лише відсутній demo
            # профіль, зберігаючи явно налаштовані значення та правила.
            assignment = session.get(DeviceCapability, identity("assignment:pump:vfd.control"))
            if assignment is not None and "frequency_limits" not in assignment.config:
                assignment.config = {**assignment.config, **FREQUENCY_CONFIG}
            program_cap = session.get(Capability, identity("cap:vfd.program"))
            if program_cap is None:
                session.add(Capability(id=identity("cap:vfd.program"), code="vfd.program", name="Програми роботи"))
                session.flush()
            if session.get(DeviceCapability, identity("assignment:pump:vfd.program")) is None:
                session.add(DeviceCapability(id=identity("assignment:pump:vfd.program"), device_id=identity("device:pump"),
                    capability_id=identity("cap:vfd.program"), is_enabled=True, config={}))
            schedule_cap = session.get(Capability, identity("cap:vfd.schedule"))
            if schedule_cap is None:
                session.add(Capability(id=identity("cap:vfd.schedule"), code="vfd.schedule", name="Календарні запуски"))
                session.flush()
            if session.get(DeviceCapability, identity("assignment:pump:vfd.schedule")) is None:
                session.add(DeviceCapability(id=identity("assignment:pump:vfd.schedule"), device_id=identity("device:pump"),
                    capability_id=identity("cap:vfd.schedule"), is_enabled=True, config={}))
            return False
        for model in (Organization, Site, Device, User, Capability):
            if session.scalar(select(func.count()).select_from(model)):
                raise RuntimeError("Початковий seed потребує порожньої demo-бази; наявні дані не змінено")

        for key in ("a", "b"):
            session.add(Organization(id=identity("org:" + key), name="DEMO: клієнт " + key.upper(),
                                     slug="techbaza-demo-" + key, is_active=True))
        session.flush()
        for key in ("a", "b"):
            session.add(Site(id=identity("site:" + key), organization_id=identity("org:" + key),
                             name="DEMO: тестовий майданчик " + key.upper(), code="demo"))
        for key in ACCOUNTS:
            session.add(User(id=identity("user:" + key), email=email(key), display_name="DEMO: " + key,
                             password_hash=hash_password(passwords[key]), platform_role="user", is_active=True))
        caps = sorted({code for item in DEVICES.values() for code in item["caps"]})
        for code in caps:
            session.add(Capability(id=identity("cap:" + code), code=code, name=code))
        session.flush()
        for key, (org, role) in ACCOUNTS.items():
            session.add(OrganizationMembership(id=identity("membership:" + key), user_id=identity("user:" + key),
                         organization_id=identity("org:" + org), role=role, is_active=True))
        old = datetime.now(timezone.utc) - timedelta(minutes=10)
        for key, item in DEVICES.items():
            historic = key in {"stale", "offline"}
            session.add(Device(id=identity("device:" + key), site_id=identity("site:" + item["org"]),
                uid=uid(key), name=item["name"], lifecycle_status="active",
                last_seen_at=old if historic else None,
                last_observed_session_id=identity("seed-session:" + key) if historic else None))
        session.flush()
        for key, item in DEVICES.items():
            for code in item["caps"]:
                session.add(DeviceCapability(id=identity("assignment:" + key + ":" + code),
                    device_id=identity("device:" + key), capability_id=identity("cap:" + code),
                    is_enabled=True, config=PRESSURE_CONFIG if key == "pressure" else FREQUENCY_CONFIG if code == "vfd.control" else {}))
            if key in {"stale", "offline"}:
                # Лише два явно позначені історичні fixtures. Живі дані надходять через MQTT.
                record_id = identity("seed-message:" + key)
                session.add(TelemetryMessage(id=record_id, device_id=identity("device:" + key),
                    message_id=identity("seed-envelope:" + key), session_id=identity("seed-session:" + key),
                    schema_version=1, sequence=1, sent_at=old, received_at=old,
                    values={"pressure.bar": 2.5}, state={}))
                session.flush()
                session.add(DeviceState(device_id=identity("device:" + key), last_telemetry_id=record_id,
                    last_session_id=identity("seed-session:" + key), last_sequence=1,
                    last_reported_at=old, last_received_at=old, values={"pressure.bar": 2.5}, state={}))
    return True


if __name__ == "__main__":
    created = seed()
    print("DEMO seed created" if created else "DEMO seed already exists; data and passwords preserved")
    print(json.dumps(manifest(), ensure_ascii=False, indent=2))

