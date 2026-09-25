"""Регресії виправлень 0.30.0. Запуск: python -m unittest discover -s tests -v."""

import asyncio
import json
import logging
import struct
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch

import paho.mqtt.client as paho
from pydantic import ValidationError
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.exc import DataError

from app import mqtt_client
from app.main import app
from app.repositories import commands as command_repo
from app.schemas.capability import DeviceCapabilityAssign, DeviceCapabilityUpdate
from app.schemas.command_ack import CommandAckEnvelope
from app.schemas.command_result import CommandResultEnvelope
from app.schemas.membership import MembershipUpdate
from app.security.current_user import get_current_user_context
from app.services.capabilities import CapabilityService, DeviceAlarmRulesConflictError
from app.services.command_ack import CommandAckService
from app.services.command_dispatch import CommandDispatchService
from app.services.command_result import CommandResultService
from app.services.memberships import (
    MembershipService, MembershipLastOwnerError, MembershipPermissionError,
)
from app.tools.alarm_ack_http_check import _asgi_request


def rule(**changes):
    return {
        "rule_key": "test.pressure", "alarm_type": "pressure.low",
        "metric": "pressure.bar", "kind": "low", "threshold": 1,
        "clear_threshold": 2, "severity": "warning", "title": "Pressure low",
        **changes,
    }


class MQTTTests(unittest.TestCase):
    def client(self, payload):
        client = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id="test",
                             clean_session=False, manual_ack=True)
        client.on_message = mqtt_client._on_message
        topic = b"techbaza/devices/TB-TEST/telemetry"
        packet = struct.pack("!H", len(topic)) + topic + struct.pack("!H", 77) + payload
        client._in_packet = {"command": 0x32, "remaining_length": len(packet), "packet": packet}
        return client

    def test_database_failure_does_not_ack(self):
        payload = json.dumps({"schema_version": 1, "message_id": str(uuid.uuid4())}).encode()
        client = self.client(payload)
        with patch.object(mqtt_client, "SessionLocal", side_effect=RuntimeError("DB unavailable")):
            with patch.object(client, "_send_puback", return_value=0) as ack:
                with self.assertLogs("app.mqtt_client", logging.ERROR):
                    with self.assertRaises(mqtt_client.MQTTProcessingError):
                        client._handle_publish()
                ack.assert_not_called()

    def test_success_and_invalid_payload_are_acknowledged(self):
        client = self.client(b"{}")
        with self.assertLogs("app.mqtt_client", logging.WARNING):
            with patch.object(client, "_send_puback", return_value=0) as ack:
                client._handle_publish()
                ack.assert_called_once_with(77)

        client = self.client(b"{}")
        with patch.object(mqtt_client, "_handle_telemetry", return_value=True):
            with patch.object(client, "_send_puback", return_value=0) as ack:
                client._handle_publish()
                ack.assert_called_once_with(77)

    def test_permanently_invalid_database_value_does_not_retry_forever(self):
        payload = json.dumps({"schema_version": 1, "message_id": str(uuid.uuid4())}).encode()
        client = self.client(payload)
        with patch.object(mqtt_client, "SessionLocal", side_effect=DataError("test", {}, ValueError())):
            with self.assertLogs("app.mqtt_client", logging.WARNING):
                with patch.object(client, "_send_puback", return_value=0) as ack:
                    client._handle_publish()
                    ack.assert_called_once_with(77)


class RuleTests(unittest.TestCase):
    def test_nonfinite_thresholds_rejected(self):
        for key in ("threshold", "clear_threshold"):
            for value in ("NaN", "Infinity", "-Infinity", float("nan"), float("inf")):
                with self.subTest(key=key, value=value), self.assertRaises(ValidationError):
                    DeviceCapabilityAssign(config={"alarm_rules": [rule(**{key: value})]})

    def test_duplicate_across_modules_rejected_before_write(self):
        session = Mock()
        service = CapabilityService(session)
        service._devices = Mock()
        service._capabilities = Mock()
        current_id, other_id = uuid.uuid4(), uuid.uuid4()
        assignment = NS(capability_id=current_id, is_enabled=True, config={})
        service._capabilities.get_assignment.return_value = assignment
        service._capabilities.get_enabled_assignments_for_device.return_value = [
            NS(capability_id=other_id, config={"alarm_rules": [rule()]}),
        ]
        payload = DeviceCapabilityUpdate(config={"alarm_rules": [rule()]})
        with self.assertRaises(DeviceAlarmRulesConflictError):
            service.update_assignment(uuid.uuid4(), current_id, payload)
        self.assertEqual(assignment.config, {})
        session.commit.assert_not_called()

    def test_disabling_conflicting_assignment_is_allowed(self):
        service = CapabilityService(Mock())
        service._capabilities = Mock()
        service._validate_device_rule_keys(uuid.uuid4(), uuid.uuid4(), False,
                                           {"alarm_rules": [rule()]})
        service._capabilities.get_enabled_assignments_for_device.assert_not_called()


class CommandTests(unittest.TestCase):
    def test_locked_read_refreshes_cached_command(self):
        # SQLite перевіряє identity map ORM; PostgreSQL concurrency — окремий тест.
        class Base(DeclarativeBase):
            pass
        class Row(Base):
            __tablename__ = "command_test"
            id: Mapped[str] = mapped_column(String, primary_key=True)
            status: Mapped[str] = mapped_column(String)
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine, expire_on_commit=False) as session:
            command = Row(id="test", status="queued")
            session.add(command)
            session.commit()
            with Session(engine) as worker:
                worker.get(Row, "test").status = "succeeded"
                worker.commit()
            with patch.object(command_repo, "DeviceCommand", Row):
                actual = command_repo.CommandRepository(session).get_for_update("test")
            self.assertEqual(actual.status, "succeeded")
        engine.dispose()

    def test_ack_sets_deadline_and_duplicate_does_not_extend_it(self):
        now = datetime.now(timezone.utc)
        command = NS(status="published", device_id=uuid.uuid4(), expires_at=now+timedelta(seconds=30))
        service = CommandAckService(Mock())
        service._commands = Mock()
        service._devices = Mock()
        service._commands.get_for_update.return_value = command
        service._devices.get_by_uid.return_value = NS(id=command.device_id)
        payload = CommandAckEnvelope(schema_version=1, message_id=uuid.uuid4(),
                                     session_id=uuid.uuid4(), command_id=uuid.uuid4())
        service.acknowledge(device_uid="TB-TEST", payload=payload, now=now)
        deadline = command.result_deadline_at
        self.assertGreater(deadline, now)
        self.assertTrue(service.acknowledge(device_uid="TB-TEST", payload=payload,
                                            now=now+timedelta(seconds=1)).duplicate)
        self.assertEqual(command.result_deadline_at, deadline)

    def test_result_timeout_never_republishes_and_is_idempotent(self):
        now = datetime.now(timezone.utc)
        command = NS(status="acknowledged", result_deadline_at=now-timedelta(seconds=1))
        service = CommandDispatchService(Mock())
        service._commands = Mock()
        service._system_alarms = Mock()
        service._commands.get_for_update.return_value = command
        with patch("app.services.command_dispatch.publish_command_message") as publish:
            result = service.dispatch(uuid.uuid4(), now=now, allow_retry=True)
            self.assertEqual(result.reason, "result_unknown")
            service.dispatch(uuid.uuid4(), now=now, allow_retry=True)
            publish.assert_not_called()
        service._system_alarms.record_result_timeout.assert_called_once()

    def test_late_result_closes_unknown_without_reexecution(self):
        now = datetime.now(timezone.utc)
        command = NS(status="result_unknown", device_id=uuid.uuid4(),
                     acknowledged_at=now-timedelta(minutes=5), result_timed_out_at=now)
        service = CommandResultService(Mock())
        service._commands = Mock()
        service._devices = Mock()
        service._system_alarms = Mock()
        service._commands.get_for_update.return_value = command
        service._devices.get_by_uid.return_value = NS(id=command.device_id)
        payload = CommandResultEnvelope(schema_version=1, message_id=uuid.uuid4(),
            session_id=uuid.uuid4(), command_id=uuid.uuid4(), status="succeeded", result={})
        result = service.complete(device_uid="TB-TEST", payload=payload, now=now)
        self.assertEqual(result.command.status, "succeeded")
        service._system_alarms.resolve_result_timeout.assert_called_once()
        self.assertTrue(service.complete(device_uid="TB-TEST", payload=payload, now=now).duplicate)


class MembershipTests(unittest.TestCase):
    def test_last_owner_is_checked_after_shared_lock(self):
        session, trace = Mock(), []
        service = MembershipService(session)
        service._memberships = Mock()
        service._memberships.lock_organization.side_effect = lambda _: trace.append("lock") or uuid.uuid4()
        service._memberships.get_active.return_value = NS(role="owner")
        service._memberships.get_for_organization.return_value = NS(role="owner", is_active=True)
        service._memberships.count_active_owners.side_effect = lambda _: trace.append("count") or 1
        with self.assertRaises(MembershipLastOwnerError):
            service.update(uuid.uuid4(), uuid.uuid4(), MembershipUpdate(role="viewer"),
                           actor_user_id=uuid.uuid4(), actor_is_superadmin=False)
        self.assertEqual(trace, ["lock", "count"])
        session.commit.assert_not_called()

    def test_permissions_revoked_while_waiting_are_rechecked(self):
        service = MembershipService(Mock())
        service._memberships = Mock()
        service._memberships.get_active.return_value = None
        with self.assertRaises(MembershipPermissionError):
            service.update(uuid.uuid4(), uuid.uuid4(), MembershipUpdate(role="viewer"),
                           actor_user_id=uuid.uuid4(), actor_is_superadmin=False)


class DiagnosticsTests(unittest.TestCase):
    paths = ["/health/db", "/health/mqtt", "/mqtt/last", "/mqtt/ingestion/last",
             "/mqtt/heartbeat/last", "/mqtt/command/last", "/mqtt/command/ack/last",
             "/mqtt/command/result/last", "/command/reliability/status", "/system/alarms/status"]

    def test_anonymous_is_denied_on_all_diagnostics(self):
        for path in self.paths:
            with self.subTest(path=path):
                self.assertEqual(asyncio.run(_asgi_request("GET", path, None))[0], 401)
        self.assertEqual(asyncio.run(_asgi_request("GET", "/health", None))[0], 200)

    def test_tenant_and_service_admin_denied_superadmin_allowed(self):
        previous = dict(app.dependency_overrides)
        try:
            for role, expected in [("user",403), ("service_admin",403), ("superadmin",200)]:
                app.dependency_overrides[get_current_user_context] = lambda r=role: NS(user=NS(platform_role=r))
                self.assertEqual(asyncio.run(_asgi_request("GET", "/mqtt/last", None))[0], expected)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous)


if __name__ == "__main__":
    unittest.main()
