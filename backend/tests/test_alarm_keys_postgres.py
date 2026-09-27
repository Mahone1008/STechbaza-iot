"""H-03: JWT/HTTP, PostgreSQL lifecycle, legacy preflight та MQTT callback."""

from contextlib import redirect_stdout
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import io
import json
import os
import threading
from types import SimpleNamespace as NS
import unittest
import uuid
from unittest.mock import Mock

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert

from app import mqtt_client
from app.db import SessionLocal
from app.models.alarm_rule_state import DeviceAlarmRuleState
from app.models.capability import Capability, DeviceCapability
from app.models.command import DeviceCommand
from app.models.device import Device
from app.models.event_alarm import AlarmTransition, DeviceAlarm
from app.models.organization import Organization
from app.models.site import Site
from app.models.telemetry import TelemetryMessage
from app.models.user import User
from app.security.tokens import create_access_token
from app.services.alarm_rule_engine import TelemetryAlarmRuleEngine
from app.services.alarms import AlarmLifecycleService
from app.services.system_alarms import SystemAlarmService
from app.tools import alarm_key_check
from app.tools.alarm_ack_check import _identity
from auth_http_helpers import request
from test_alarm_keys import rule


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class AlarmKeyPostgresTests(unittest.TestCase):
    def setUp(self):
        self.org, self.other_org, self.site, self.device, self.extra_cap = [uuid.uuid4() for _ in range(5)]
        self.uid = f"TB-H03-{self.device.hex}"
        self.now = datetime.now(timezone.utc)
        self.users, self.tokens, self.created_caps = [], {}, []
        self.addCleanup(self.cleanup_data)
        with SessionLocal() as session:
            for org in (self.org, self.other_org):
                session.add(Organization(id=org, name="H-03 test", slug=f"h03-{org.hex}"))
            session.flush()
            session.add(Site(id=self.site, organization_id=self.org, name="H-03", code="h03"))
            session.flush()
            session.add(Device(id=self.device, site_id=self.site, uid=self.uid, name="H-03 test",
                               last_seen_at=self.now-timedelta(days=1)))
            created = session.scalar(insert(Capability).values(id=uuid.uuid4(), code="pressure.read", name="Pressure")
                .on_conflict_do_nothing(index_elements=["code"]).returning(Capability.id))
            if created:
                self.created_caps.append(created)
            self.cap = session.scalar(select(Capability.id).where(Capability.code == "pressure.read"))
            session.add(Capability(id=self.extra_cap, code=f"h03.{self.extra_cap.hex}", name="H-03 extra"))
            self.created_caps.append(self.extra_cap)
            for who, org, role in (("owner", self.org, "owner"), ("viewer", self.org, "viewer"),
                                   ("other", self.other_org, "owner")):
                ctx = _identity(session, org, role)
                self.users.append(ctx.user.id)
                self.tokens[who] = create_access_token(user_id=ctx.user.id, auth_session_id=ctx.auth_session.id).token
            session.commit()

    def cleanup_data(self):
        with SessionLocal() as session:
            session.execute(delete(Organization).where(Organization.id.in_([self.org, self.other_org])))
            session.execute(delete(User).where(User.id.in_(self.users)))
            session.execute(delete(Capability).where(Capability.id.in_(self.created_caps)))
            session.commit()

    def assignment(self, rules, *, enabled=True, capability=None):
        assignment_id = uuid.uuid4()
        with SessionLocal() as session:
            session.add(DeviceCapability(id=assignment_id, device_id=self.device,
                capability_id=capability or self.cap, is_enabled=enabled, config={"alarm_rules": rules}))
            session.commit()
        return assignment_id

    def api(self, method, body, *, who="owner", expected=200, capability=None):
        headers = {"authorization": "Bearer "+self.tokens[who]} if who else {}
        code, result, _ = request(method, f"/api/v1/devices/{self.device}/capabilities/{capability or self.cap}",
                                  body=body, headers=headers)
        self.assertEqual(code, expected, result)
        return result

    def evaluate(self, session, value, *, seconds=0):
        return TelemetryAlarmRuleEngine(session).evaluate(device_id=self.device,
            values={"pressure.bar": value}, state={}, source_message_id=uuid.uuid4(),
            occurred_at=self.now+timedelta(seconds=seconds))

    def test_http_post_and_patch_reserved_keys_return_422_without_writes(self):
        bad = {"config": {"alarm_rules": [rule("device.offline")]}}
        self.api("POST", bad, expected=422)
        with SessionLocal() as session:
            self.assertIsNone(session.scalar(select(DeviceCapability.id).where(DeviceCapability.device_id == self.device)))
        good = {"config": {"alarm_rules": [rule()]}}
        created = self.api("POST", good, expected=201)
        for key in ("device.reboot", "command.failed.vfd.start", f"command.result_unknown.{uuid.uuid4()}"):
            self.api("PATCH", {"config": {"alarm_rules": [rule(key)]}}, expected=422)
        with SessionLocal() as session:
            self.assertEqual(session.get(DeviceCapability, uuid.UUID(created["id"])).config, good["config"])
            self.assertEqual(session.scalar(select(func.count()).select_from(DeviceAlarm).where(DeviceAlarm.device_id == self.device)), 0)

    def test_http_authorization_is_preserved_for_valid_rules(self):
        body = {"config": {"alarm_rules": [rule()]}}
        for who, code in ((None, 401), ("viewer", 403), ("other", 404)):
            self.api("POST", body, who=who, expected=code)
        self.api("POST", body, expected=201)
        self.api("PATCH", {"config": {"alarm_rules": [rule("pressure.secondary")]}}, who="other", expected=404)

    def test_legacy_reenable_is_blocked_but_disable_and_repair_are_allowed(self):
        assignment = self.assignment([rule("device.offline")], enabled=False)
        self.api("PATCH", {"is_enabled": True}, expected=422)
        with SessionLocal() as session:
            self.assertFalse(session.get(DeviceCapability, assignment).is_enabled)
            session.get(DeviceCapability, assignment).is_enabled = True
            session.commit()
        # Інша legacy capability не блокує створення/ремонт нормального правила.
        self.assignment([rule("command.failed.vfd.start")], capability=self.extra_cap)
        self.api("PATCH", {"is_enabled": False})
        self.api("PATCH", {"config": {"alarm_rules": [rule()]}, "is_enabled": True})
        with SessionLocal() as session:
            fixed = session.get(DeviceCapability, assignment)
            self.assertTrue(fixed.is_enabled)
            self.assertEqual(fixed.config["alarm_rules"][0]["rule_key"], "test.pressure")

    def test_legacy_rules_cannot_repeat_or_resolve_system_alarms(self):
        with SessionLocal() as session:
            system = SystemAlarmService(session)
            self.assertTrue(system.check_offline(device_id=self.device, now=self.now))
            device = session.get(Device, self.device)
            for _ in range(2):
                system.observe_session(device=device, session_id=uuid.uuid4(), message_id=uuid.uuid4(), occurred_at=self.now)
            failed = DeviceCommand(id=uuid.uuid4(), request_id=uuid.uuid4(), device_id=self.device,
                command_type="vfd.start", status="failed", expires_at=self.now+timedelta(seconds=30), created_at=self.now)
            unknown = DeviceCommand(id=uuid.uuid4(), request_id=uuid.uuid4(), device_id=self.device,
                command_type="vfd.stop", status="result_unknown", expires_at=self.now+timedelta(seconds=30), created_at=self.now)
            session.add_all([failed, unknown])
            session.flush()
            system.record_command_outcome(command=failed, occurred_at=self.now)
            system.record_result_timeout(command=unknown, occurred_at=self.now)
            session.commit()
            alarms = list(session.scalars(select(DeviceAlarm).where(DeviceAlarm.device_id == self.device)))
            self.assertEqual(len(alarms), 4)
            before = {a.id: (a.alarm_key, a.state, a.severity, a.title, a.occurrence_count,
                             a.last_event_id, dict(a.context)) for a in alarms}
            system_ids = list(before)
            transitions = session.scalar(select(func.count()).select_from(AlarmTransition)
                                         .where(AlarmTransition.alarm_id.in_(system_ids)))
        self.assignment([rule(key, severity="critical") for key, *_ in before.values()]+[rule()])
        with self.assertLogs("app.services.alarm_rule_engine", "ERROR"):
            for value, seconds in ((0, 1), (3, 2)):
                with SessionLocal() as session:
                    result = self.evaluate(session, value, seconds=seconds)
                    self.assertEqual(result.configured_rules, 1)
        with SessionLocal() as session:
            for alarm_id, expected in before.items():
                a = session.get(DeviceAlarm, alarm_id)
                self.assertEqual((a.alarm_key, a.state, a.severity, a.title, a.occurrence_count,
                                  a.last_event_id, dict(a.context)), expected)
            self.assertEqual(session.scalar(select(func.count()).select_from(AlarmTransition)
                             .where(AlarmTransition.alarm_id.in_(system_ids))), transitions)
            custom = session.scalar(select(DeviceAlarm).where(DeviceAlarm.device_id == self.device,
                                                               DeviceAlarm.alarm_key == "test.pressure"))
            self.assertEqual(custom.state, "resolved")

    def test_mqtt_legacy_rule_does_not_block_telemetry_commit_or_ack(self):
        self.assignment([rule("command.failed.vfd.start"), rule()])
        message_id = uuid.uuid4()
        payload = json.dumps({"schema_version": 1, "message_id": str(message_id),
            "session_id": str(uuid.uuid4()), "sequence": 1, "values": {"pressure.bar": 0}, "state": {}}).encode()
        message = NS(topic=f"techbaza/devices/{self.uid}/telemetry", payload=payload, mid=7, qos=1, retain=False)
        client = Mock()
        def ack_after_commit(mid, qos):
            with SessionLocal() as session:
                self.assertIsNotNone(session.scalar(select(TelemetryMessage.id).where(TelemetryMessage.message_id == message_id)))
        client.ack.side_effect = ack_after_commit
        with self.assertLogs("app.services.alarm_rule_engine", "ERROR"):
            mqtt_client._on_message(client, None, message)
        client.ack.assert_called_once_with(7, 1)
        with SessionLocal() as session:
            keys = list(session.scalars(select(DeviceAlarm.alarm_key).where(DeviceAlarm.device_id == self.device)))
            self.assertEqual(keys, ["test.pressure"])
            state_keys = list(session.scalars(select(DeviceAlarmRuleState.rule_key).where(DeviceAlarmRuleState.device_id == self.device)))
            self.assertEqual(state_keys, ["test.pressure"])

    def test_preflight_reports_disabled_rules_and_active_legacy_alarm_without_mutation(self):
        assignment = self.assignment([rule("device.offline", enabled=False)], enabled=False)
        with SessionLocal() as session:
            result = AlarmLifecycleService(session).raise_alarm(device_id=self.device, alarm_key="device.offline",
                alarm_type="pressure.low", severity="warning", title="Legacy collision", occurred_at=self.now,
                context={"rule_key": "device.offline"})
            alarm_id = result.alarm_id
        output = io.StringIO()
        with redirect_stdout(output), self.assertRaises(SystemExit) as exit_result:
            alarm_key_check.main()
        self.assertEqual(exit_result.exception.code, 1)
        self.assertIn("reserved_rule_key", output.getvalue())
        self.assertIn("active_legacy_rule_alarm", output.getvalue())
        with SessionLocal() as session:
            self.assertFalse(session.get(DeviceCapability, assignment).is_enabled)
            self.assertEqual(session.get(DeviceAlarm, alarm_id).state, "active")
            self.assertEqual(session.get(DeviceAlarm, alarm_id).context, {"rule_key": "device.offline"})
            self.assertEqual(session.scalar(select(func.count()).select_from(AlarmTransition)
                                           .where(AlarmTransition.alarm_id == alarm_id)), 1)

    def test_concurrent_system_and_custom_alarms_remain_independent(self):
        self.assignment([rule()])
        barrier = threading.Barrier(2)
        def run(system):
            with SessionLocal() as session:
                barrier.wait(timeout=5)
                if system:
                    SystemAlarmService(session).check_offline(device_id=self.device, now=self.now)
                    session.commit()
                else:
                    self.evaluate(session, 0)
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(run, system) for system in (False, True)]
            for future in futures:
                future.result(timeout=10)
        with SessionLocal() as session:
            alarms = list(session.scalars(select(DeviceAlarm).where(DeviceAlarm.device_id == self.device)))
            self.assertCountEqual([a.alarm_key for a in alarms], ["device.offline", "test.pressure"])
            self.assertTrue(all(a.state == "active" and a.occurrence_count == 1 for a in alarms))


if __name__ == "__main__":
    unittest.main()
