import os
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import delete, select

import test_comprehensive_postgres as base
from test_equipment import report_for
from app.db import SessionLocal
from app.models.command import DeviceCommand
from app.models.device import Device
from app.models.equipment import EquipmentConfiguration, EquipmentModule
from app.models.telemetry import DeviceState
from app.services.command_dispatch import CommandDispatchService
from app.services.equipment_profiles import configuration_hash


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class EquipmentPostgresTests(unittest.TestCase):
    call = base.ComprehensivePostgresTests.call

    def cleanup_data(self):
        with SessionLocal() as session:
            session.execute(delete(EquipmentConfiguration).where(EquipmentConfiguration.device_id.in_(self.devices)))
            session.execute(delete(EquipmentModule).where(EquipmentModule.device_id.in_(self.devices)))
            session.commit()
        base.ComprehensivePostgresTests.cleanup_data(self)

    def setUp(self):
        base.ComprehensivePostgresTests.setUp(self)
        self.installation = self.call(f"/api/v1/sites/{self.sites[0]}/installations", method="POST",
            body={"name": "Pump installation"}, who="owner", expected=201)
        self.module_body = dict(installation_id=self.installation["id"], slot="vfd-1", kind="vfd", name="Pump drive",
            manufacturer="SUSWE", series="SU600", model="SU600A-5RG1-B", motor={"rated_frequency_hz": 50})
        self.module = self.call(self.base + "/equipment/modules", method="POST", body=self.module_body, who="owner", expected=201)
        self.body = dict(expected_revision=0, module_id=self.module["id"], profile_id="suswe.su600.modbus", profile_version=1,
            bus=dict(transport="modbus_rtu", address=1, baud=9600, parity="none", stop_bits=1), frequency_limits=dict(min_hz=20, max_hz=45))
        self.fresh()

    def fresh(self, report=None, *, armed=False, running=False, age=0):
        now = datetime.now(timezone.utc) - timedelta(seconds=age)
        with SessionLocal() as session:
            device = session.get(Device, self.devices[0]); device.last_observed_session_id = self.boot; device.last_seen_at = now
            snapshot = session.get(DeviceState, device.id) or DeviceState(device_id=device.id)
            snapshot.last_received_at = now; snapshot.last_reported_at = now; snapshot.last_session_id = self.boot
            snapshot.state = {"pump_running": running, "control_armed": armed}
            snapshot.values = {"vfd.frequency_hz": 40 if running else 0}
            snapshot.diagnostics = dict(version=1, firmware_version="0.6.0", uptime_ms=1000, reset_reason="power_on",
                connection={"transport":"wifi"}, equipment=report)
            session.add(snapshot); session.commit()

    def configure(self, **changes):
        return self.call(self.base + "/equipment/configurations", method="POST", body={**self.body, **changes}, who="owner", expected=201)

    def test_repeat_modules_are_inventory_not_capabilities_and_scope_is_enforced(self):
        second = self.call(self.base + "/equipment/modules", method="POST", body={**self.module_body, "slot": "vfd-2"}, who="owner", expected=201)
        passport = self.call(self.base + "/equipment", who="viewer")
        self.assertEqual(len(passport["modules"]), 2)
        self.assertEqual(passport["configuration_state"], "legacy")
        self.assertNotEqual(second["id"], self.module["id"])
        self.call(self.base + "/equipment", who="other", expected=404)
        self.call(self.base + "/equipment/modules", method="POST", body={**self.module_body, "slot":"vfd-3"}, who="viewer", expected=403)
        self.call(f"/api/v1/devices/{self.devices[1]}/equipment/modules", method="POST", body=self.module_body, who="other", expected=409)
        self.call(self.base + "/equipment/modules", method="POST", body=self.module_body, who="owner", expected=409)

    def test_configuration_guard_and_optimistic_revision(self):
        for armed, running, age in [(True, False, 0), (False, True, 0), (False, False, 300)]:
            self.fresh(armed=armed, running=running, age=age)
            self.call(self.base + "/equipment/configurations", method="POST", body=self.body, who="owner", expected=409)
        self.fresh(); configured = self.configure()
        self.call(self.base + "/equipment/configurations", method="POST", body=self.body, who="owner", expected=409)
        self.assertEqual(configured["manifest"]["revision"], 1)
        self.assertEqual(self.call(self.base + "/equipment")["configuration_state"], "awaiting")
        self.call(self.base + "/commands", method="POST", body={"request_id":str(uuid.uuid4()), "command_type":"vfd.start"}, expected=409)
        overview = self.call(self.base + "/overview")
        self.assertEqual(overview["equipment_state"], "awaiting")
        self.assertEqual(overview["allowed_commands"], [])

    def test_unsupported_profile_bus_and_limits_do_not_commission(self):
        for changes in ({"profile_id":"suswe.su100.modbus"}, {"profile_version":2},
                        {"bus":{**self.body["bus"],"address":2}}, {"frequency_limits":{"min_hz":20,"max_hz":60}}):
            self.call(self.base + "/equipment/configurations", method="POST", body={**self.body, **changes}, who="owner", expected=409)

    def test_applied_hash_protocol_v3_and_old_queued_command_fence(self):
        configured = self.configure()
        self.fresh(report_for(configured["manifest"], configured["configuration_hash"]))
        passport = self.call(self.base + "/equipment")
        self.assertEqual(passport["configuration_state"], "verified")
        self.assertEqual(self.call(self.base + "/overview")["frequency_limits"], {"min_hz":20,"max_hz":45})
        target = {key: configured["manifest"][key] for key in ("binding_id", "revision")}
        target["configuration_hash"] = configured["configuration_hash"]
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True,"published")) as mqtt:
            command = self.call(self.base + "/commands", method="POST", body={"request_id":str(uuid.uuid4()), "command_type":"vfd.start", "equipment_target":target}, expected=201)
        self.assertEqual(mqtt.call_args.kwargs["payload"]["schema_version"], 3)
        self.assertEqual(mqtt.call_args.kwargs["payload"]["equipment_target"]["configuration_hash"], configured["configuration_hash"])
        self.call(self.base + "/equipment/configurations", method="POST", body={**self.body,"expected_revision":1}, who="owner", expected=409)
        # A historical request/retained server row cannot regain authority after a new binding.
        with SessionLocal() as session:
            session.get(DeviceCommand, uuid.UUID(command["id"])).status="succeeded"; session.commit()
        second = self.call(self.base + "/equipment/modules", method="POST", body={**self.module_body,"slot":"replacement"}, who="owner", expected=201)
        newer = self.configure(expected_revision=1, module_id=second["id"])
        self.assertNotEqual(newer["manifest"]["binding_id"], configured["manifest"]["binding_id"])
        self.assertEqual(newer["manifest"]["binding_generation"], 2)
        self.fresh(report_for(newer["manifest"], newer["configuration_hash"]))
        for stale_target in (None, target):
            # A delayed HTTP request must not acquire the new target at creation time.
            self.call(self.base + "/commands", method="POST", body={"request_id":str(uuid.uuid4()),
                "command_type":"vfd.start", "equipment_target":stale_target}, expected=409)
        with SessionLocal() as session:
            row = session.get(DeviceCommand, uuid.UUID(command["id"])); row.status="queued"; row.last_publish_attempt_at=None; session.commit()
            with patch("app.services.command_dispatch.publish_command_message") as publish:
                result = CommandDispatchService(session).dispatch(row.id)
            self.assertEqual(result.reason, "equipment_binding_changed"); publish.assert_not_called()
        with SessionLocal() as session:
            rows = session.scalars(select(EquipmentConfiguration).where(EquipmentConfiguration.device_id==self.devices[0])).all()
            self.assertEqual(len(rows), 2)
            self.assertTrue(all(configuration_hash(row.canonical_manifest)==row.configuration_hash for row in rows))
