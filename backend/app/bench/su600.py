"""Attach a physical SU600 bench to demo owner A; preserve existing identities/history."""
import argparse
import json
import uuid

from sqlalchemy import select, text

from app.db import SessionLocal
from app.demo.catalog import identity
from app.demo.seed import assert_database
from app.models.capability import Capability, DeviceCapability
from app.models.device import Device
from app.models.organization import Organization
from app.models.site import Site

UID = "KERUMO-V3-SU600-001"
SITE_ID = identity("physical-bench:su600:site")
DEVICE_ID = identity("physical-bench:su600:device")
CAPABILITIES = {
    "vfd.frequency.read": "Вихідна частота",
    "vfd.set_frequency.read": "Задана частота",
    "vfd.current.read": "Вихідний струм",
    "vfd.voltage.read": "Вихідна напруга",
    "vfd.state.read": "Стан частотника",
    "vfd.diagnostics.read": "Діагностика контролера V3",
    "vfd.control": "Керування SU600",
    "vfd.program": "Етапи роботи частотника",
    "vfd.schedule": "Календарні запуски частотника",
}
CONTROL_CONFIG = {"driver_profile": "suswe.su600.delta_m.v1", "bench_without_motor": True,
                  "frequency_limits": {"min_hz": 0, "max_hz": 50}}
EXTENDED_CONTROL_CONFIG = {"driver_profile": "suswe.su600.delta_m.v1", "bench_without_motor": False,
                          "test_session": "extended", "frequency_limits": {"min_hz": 0, "max_hz": 50}}


def prepare(*, enable_control: bool | None = None, extended_test: bool = False) -> dict:
    if extended_test and enable_control is not True:
        raise ValueError("Extended test requires an explicit enable action")
    with SessionLocal.begin() as session:
        assert_database(session)
        session.execute(text("SELECT pg_advisory_xact_lock(8340005)"))
        org = session.get(Organization, identity("org:a"))
        if org is None or org.slug != "techbaza-demo-a" or not org.is_active:
            raise RuntimeError("Run the normal demo seed first; active demo organization A is required")
        site = session.get(Site, SITE_ID)
        if site is None:
            site = Site(id=SITE_ID, organization_id=org.id, name="V3 — фізичний стенд SU600", code="v3-su600-bench")
            session.add(site)
            session.flush()
        elif site.organization_id != org.id or site.code != "v3-su600-bench":
            raise RuntimeError("Bench site was moved/changed; automatic reassignment is forbidden")
        device = session.get(Device, DEVICE_ID)
        if device is None:
            if session.scalar(select(Device).where(Device.uid == UID)):
                raise RuntimeError("UID already belongs to another device")
            device = Device(id=DEVICE_ID, uid=UID, site_id=SITE_ID,
                            name="V3 — реальний SU600 / ESP32-S3", lifecycle_status="active")
            session.add(device)
            session.flush()
        elif device.site_id != SITE_ID or device.uid != UID:
            raise RuntimeError("Bench device identity changed; no data was overwritten")
        control = program = schedule = None
        for code, name in CAPABILITIES.items():
            cap = session.scalar(select(Capability).where(Capability.code == code))
            if cap is None:
                cap = Capability(id=uuid.uuid4(), code=code, name=name)
                session.add(cap)
                session.flush()
            elif code == "vfd.control" and cap.name == "Керування SU600 — стенд без двигуна":
                cap.name = name
            assignment = session.scalar(select(DeviceCapability).where(
                DeviceCapability.device_id == device.id, DeviceCapability.capability_id == cap.id))
            if assignment is None:
                config = (CONTROL_CONFIG if code == "vfd.control" else
                          {"telemetry_keys": ["pump_running", "vfd_fault_code"]} if code == "vfd.state.read" else {})
                assignment = DeviceCapability(device_id=device.id, capability_id=cap.id,
                    is_enabled=code not in {"vfd.control", "vfd.program", "vfd.schedule"}, config=config)
                session.add(assignment)
            if code == "vfd.control":
                control = assignment
            elif code == "vfd.program":
                program = assignment
            elif code == "vfd.schedule":
                schedule = assignment
        if enable_control is not None:
            if enable_control and control.config not in (CONTROL_CONFIG, EXTENDED_CONTROL_CONFIG):
                raise RuntimeError("Bench control config changed; review it explicitly before enabling")
            if enable_control:
                control.config = EXTENDED_CONTROL_CONFIG if extended_test else CONTROL_CONFIG
            control.is_enabled = enable_control
            program.is_enabled = bool(enable_control and extended_test)
            schedule.is_enabled = bool(enable_control and extended_test)
        return {"organization_id": str(org.id), "site_id": str(SITE_ID), "device_id": str(DEVICE_ID),
                "uid": UID, "control_enabled": control.is_enabled, "firmware_profile": "suswe.su600.delta_m.v1",
                "test_session": control.config.get("test_session", "bench_60_seconds")}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--enable-control-bench-without-motor", action="store_true")
    group.add_argument("--enable-control-extended-test", action="store_true",
                       help="Enable the 0–50 Hz test profile after motor commissioning; firmware still requires local ARM")
    group.add_argument("--disable-control", action="store_true")
    args = parser.parse_args()
    control = True if args.enable_control_bench_without_motor or args.enable_control_extended_test else False if args.disable_control else None
    print(json.dumps(prepare(enable_control=control, extended_test=args.enable_control_extended_test), ensure_ascii=False, indent=2))
