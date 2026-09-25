"""Перевірки з PostgreSQL після migration 0014.

Увімкнення: TECHBAZA_RUN_DB_TESTS=1 python -m unittest discover -s tests -v
Створюється лише окремий тестовий tenant із випадковим UUID; після тесту
видаляються саме його записи та явно створені тестові users/capabilities.
"""

import os
import json
import threading
import time
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import paho.mqtt.client as paho

from sqlalchemy import delete, select, text

from app.db import SessionLocal
from app import mqtt_client
from app.models.capability import Capability
from app.models.command import DeviceCommand
from app.models.device import Device
from app.models.event_alarm import DeviceAlarm
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.models.site import Site
from app.models.user import User
from app.models.telemetry import TelemetryMessage
from app.repositories.commands import CommandRepository
from app.repositories.memberships import MembershipRepository
from app.schemas.capability import DeviceCapabilityAssign
from app.schemas.command_result import CommandResultEnvelope
from app.schemas.membership import MembershipUpdate
from app.services.capabilities import CapabilityService, DeviceAlarmRulesConflictError
from app.services.command_dispatch import CommandDispatchService
from app.services.command_result import CommandResultService
from app.services.memberships import MembershipService, MembershipLastOwnerError


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "PostgreSQL tests require explicit opt-in")
class PostgreSQLHardeningTests(unittest.TestCase):
    def setUp(self):
        self.org_id, self.device_id, site_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        self.users = [uuid.uuid4(), uuid.uuid4()]
        self.memberships = [uuid.uuid4(), uuid.uuid4()]
        self.capabilities = [uuid.uuid4(), uuid.uuid4()]
        self.uid = f"TB-HARDENING-{self.device_id.hex}"
        with SessionLocal() as session:
            session.add(Organization(id=self.org_id, name="Hardening check", slug=f"check-{self.org_id.hex}"))
            session.flush()
            session.add(Site(id=site_id, organization_id=self.org_id, name="Test only", code="test"))
            session.flush()
            session.add(Device(id=self.device_id, site_id=site_id, uid=self.uid, name="Test only"))
            for user_id in self.users:
                session.add(User(id=user_id, email=f"{user_id.hex}@example.com",
                                 display_name="Hardening test", password_hash="test-no-login"))
            for capability_id in self.capabilities:
                session.add(Capability(id=capability_id, code=f"test.{capability_id.hex}", name="Test only"))
            session.flush()
            for membership_id, user_id in zip(self.memberships, self.users):
                session.add(OrganizationMembership(id=membership_id, organization_id=self.org_id,
                                                    user_id=user_id, role="owner", is_active=True))
            session.commit()
        self.addCleanup(self.cleanup_data)

    def cleanup_data(self):
        with SessionLocal() as session:
            session.execute(delete(Organization).where(Organization.id == self.org_id))
            session.execute(delete(User).where(User.id.in_(self.users)))
            session.execute(delete(Capability).where(Capability.id.in_(self.capabilities)))
            session.commit()

    def parallel(self, operation):
        barrier, results, failures = threading.Barrier(2), [], []
        def run(index):
            try:
                with SessionLocal() as session:
                    session.execute(text("SET LOCAL lock_timeout = '3s'"))
                    session.execute(text("SET LOCAL statement_timeout = '5s'"))
                    barrier.wait(timeout=3)
                    results.append(operation(session, index))
            except BaseException as exc:
                failures.append(exc)
        threads = [threading.Thread(target=run, args=(i,)) for i in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=8)
            self.assertFalse(thread.is_alive(), "concurrency test timed out")
        if failures:
            raise failures[0]
        return results

    def test_simultaneous_owner_removals_leave_one_owner(self):
        original = MembershipRepository.count_active_owners
        def slow_count(repo, org_id):
            count = original(repo, org_id)
            threading.Event().wait(0.15)
            return count
        def change(session, index):
            try:
                MembershipService(session).update(self.org_id, self.memberships[index],
                    MembershipUpdate(role="viewer"), actor_user_id=self.users[index],
                    actor_is_superadmin=True)
                return "updated"
            except MembershipLastOwnerError:
                return "protected"
        with patch.object(MembershipRepository, "count_active_owners", slow_count):
            self.assertCountEqual(self.parallel(change), ["updated", "protected"])
        with SessionLocal() as session:
            self.assertEqual(MembershipRepository(session).count_active_owners(self.org_id), 1)

    def test_simultaneous_rule_assignments_reject_conflict(self):
        config = {"alarm_rules": [{
            "rule_key":"test.shared", "alarm_type":"pressure.low", "metric":"pressure.bar",
            "kind":"low", "threshold":1, "clear_threshold":2,
            "severity":"warning", "title":"Test pressure",
        }]}
        def change(session, index):
            try:
                CapabilityService(session).assign_to_device(self.device_id, self.capabilities[index],
                                                            DeviceCapabilityAssign(config=config))
                return "created"
            except DeviceAlarmRulesConflictError:
                return "conflict"
        self.assertCountEqual(self.parallel(change), ["created", "conflict"])

    def new_command(self, session, **changes):
        now = datetime.now(timezone.utc)
        fields = dict(id=uuid.uuid4(), request_id=uuid.uuid4(), device_id=self.device_id,
                      command_type="vfd.start", status="queued", expires_at=now+timedelta(seconds=30))
        fields.update(changes)
        command = DeviceCommand(**fields)
        session.add(command)
        session.commit()
        return command

    def test_locked_read_refreshes_real_command(self):
        with SessionLocal() as session:
            command = self.new_command(session)
            with SessionLocal() as worker:
                worker.get(DeviceCommand, command.id).status = "succeeded"
                worker.commit()
            self.assertEqual(CommandRepository(session).get_for_update(command.id).status, "succeeded")

    def test_timeout_alarm_and_late_result_commit_together(self):
        now = datetime.now(timezone.utc)
        with SessionLocal() as session:
            command = self.new_command(session, status="acknowledged",
                acknowledged_at=now-timedelta(minutes=3), result_deadline_at=now-timedelta(seconds=1))
            self.assertIn(command.id, CommandRepository(session).list_delivery_candidate_ids(limit=10000))
            CommandDispatchService(session).dispatch(command.id, now=now, allow_retry=True)
            key = f"command.result_unknown.{command.id}"
            alarm = session.scalar(select(DeviceAlarm).where(DeviceAlarm.device_id == self.device_id,
                                                              DeviceAlarm.alarm_key == key))
            self.assertEqual((command.status, alarm.state), ("result_unknown", "active"))
            self.assertIsNone(command.completed_at)
            self.assertNotIn(command.id, CommandRepository(session).list_delivery_candidate_ids(limit=10000))
            payload = CommandResultEnvelope(schema_version=1, message_id=uuid.uuid4(),
                session_id=uuid.uuid4(), command_id=command.id, status="succeeded", result={})
            CommandResultService(session).complete(device_uid=self.uid, payload=payload, now=now)
            session.refresh(alarm)
            self.assertEqual((command.status, alarm.state), ("succeeded", "resolved"))

    @unittest.skipUnless(os.getenv("TECHBAZA_RUN_MQTT_TESTS") == "1", "Requires a test MQTT broker")
    def test_broker_redelivers_after_database_processing_failure(self):
        ready = threading.Event()
        message_id = uuid.uuid4()
        client_id = f"hardening-{self.device_id.hex}"
        receiver = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id=client_id,
                               clean_session=False, manual_ack=True)
        receiver.on_connect = mqtt_client._on_connect
        receiver.on_disconnect = mqtt_client._on_disconnect
        receiver.on_message = mqtt_client._on_message
        subscribed = []
        def on_subscribe(*args):
            subscribed.append(1)
            if len(subscribed) >= 5:
                ready.set()
        receiver.on_subscribe = on_subscribe
        publisher = paho.Client(paho.CallbackAPIVersion.VERSION2)
        original_service = mqtt_client.TelemetryService
        attempts = []

        def fail_once(session):
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError("Injected temporary database processing failure")
            return original_service(session)

        topic = f"techbaza/devices/{self.uid}/telemetry"
        # Усі підписки тестового client обмежені його власним Device.
        topics = dict(MQTT_TEST_TOPIC=f"techbaza/test/{self.uid}", MQTT_TELEMETRY_TOPIC=topic,
                      MQTT_HEARTBEAT_TOPIC=f"techbaza/devices/{self.uid}/heartbeat",
                      MQTT_COMMAND_ACK_TOPIC=f"techbaza/devices/{self.uid}/commands/ack",
                      MQTT_COMMAND_RESULT_TOPIC=f"techbaza/devices/{self.uid}/commands/result")
        try:
            with patch.object(mqtt_client, "client", receiver), \
                 patch.multiple(mqtt_client, **topics), \
                 patch.object(mqtt_client, "TelemetryService", side_effect=fail_once):
                try:
                    mqtt_client.start_mqtt()
                    self.assertTrue(ready.wait(5), "MQTT subscription timed out")
                    publisher.connect(mqtt_client.MQTT_HOST, mqtt_client.MQTT_PORT)
                    publisher.loop_start()
                    payload = json.dumps({"schema_version":1, "message_id":str(message_id),
                        "session_id":str(uuid.uuid4()), "sequence":1, "values":{}, "state":{}})
                    publisher.publish(topic, payload, qos=1).wait_for_publish(timeout=5)
                    until = time.monotonic()+8
                    found = False
                    while time.monotonic() < until:
                        with SessionLocal() as session:
                            found = session.scalar(select(TelemetryMessage.id)
                                .where(TelemetryMessage.message_id == message_id)) is not None
                        if found:
                            break
                        threading.Event().wait(0.1)
                    self.assertTrue(found, "Message was not redelivered and stored")
                    self.assertGreaterEqual(len(attempts), 2)
                finally:
                    mqtt_client.stop_mqtt()
        finally:
            publisher.disconnect()
            publisher.loop_stop()
            # Очистити лише persistent session цього тестового client.
            cleanup = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id=client_id,
                                  clean_session=True)
            cleanup.connect(mqtt_client.MQTT_HOST, mqtt_client.MQTT_PORT)
            cleanup.loop(timeout=0.2)
            cleanup.disconnect()


if __name__ == "__main__":
    unittest.main()
