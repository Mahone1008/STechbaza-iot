"""Стабільні demo identity та різний склад модулів без прив'язки до реальних UID."""

import os
import uuid

NAMESPACE = uuid.UUID("8f811be9-b156-48db-9461-e9e4463867a0")
DATABASE_NAME = "techbaza_demo"


def identity(key):
    return uuid.uuid5(NAMESPACE, key)


def require_demo():
    if os.getenv("TECHBAZA_DEMO_MODE") != "1":
        raise RuntimeError("Потрібен TECHBAZA_DEMO_MODE=1; запускайте окремий compose.demo.yml")


ACCOUNTS = {
    "owner": ("a", "owner"),
    "operator": ("a", "operator"),
    "viewer": ("a", "viewer"),
    "other": ("b", "owner"),
}


def email(account):
    return f"{account}@techbaza-demo.example.com"


DEVICES = {
    "pump": {"org": "a", "name": "DEMO: насос з частотником", "caps": (
        "vfd.control", "vfd.frequency.read", "vfd.current.read", "vfd.state.read", "pressure.read")},
    "pressure": {"org": "a", "name": "DEMO: окремий датчик тиску", "caps": ("pressure.read",)},
    "stale": {"org": "a", "name": "DEMO: зв'язок є, показання старі", "caps": ("pressure.read",)},
    "offline": {"org": "a", "name": "DEMO: відключений датчик", "caps": ("pressure.read",)},
    "new": {"org": "a", "name": "DEMO: новий датчик рівня", "caps": ("water_level.read",)},
    "other": {"org": "b", "name": "DEMO: датчик іншого клієнта", "caps": ("pressure.read",)},
}
LIVE_DEVICES = ("pump", "pressure", "stale", "other")


def uid(key):
    if key not in DEVICES:
        raise ValueError("Невідомий demo device")
    return "TB-DEMO-" + key.upper()


def manifest():
    return {
        "organizations": {key: str(identity("org:" + key)) for key in ("a", "b")},
        "accounts": {key: {"email": email(key), "organization": org, "role": role}
                     for key, (org, role) in ACCOUNTS.items()},
        "devices": {key: {"id": str(identity("device:" + key)), "uid": uid(key), **item}
                    for key, item in DEVICES.items()},
    }
