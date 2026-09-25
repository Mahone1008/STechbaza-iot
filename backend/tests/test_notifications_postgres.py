"""Етап 7: справжні PostgreSQL/JWT/ASGI та MQTT, власні тимчасові tenant.

Запускати з TECHBAZA_RUN_DB_TESTS=1, для MQTT також TECHBAZA_RUN_MQTT_TESTS=1.
Основний backend на локальному стенді має бути зупинений на час тестів.
"""

import os
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import paho.mqtt.client as paho
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert

from app import mqtt_client
from app.db import SessionLocal
from app.models.alarm_rule_state import DeviceAlarmRuleState
from app.models.capability import Capability, DeviceCapability
from app.models.device import Device
from app.models.event_alarm import AlarmTransition, DeviceAlarm, DeviceEvent
from app.models.notification import AlarmNotification, NotificationRead
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.models.site import Site
from app.models.telemetry import DeviceState, TelemetryMessage
from app.models.user import User
from app.repositories.notifications import NotificationRepository
from app.security.tokens import create_access_token
from app.services.alarms import AlarmLifecycleService
from app.services.notifications import NotificationService
from app.services.telemetry import TelemetryService
from app.schemas.telemetry import TelemetryEnvelope
from app.tools.alarm_ack_check import _identity
from app.tools.alarm_ack_http_check import _request


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires PostgreSQL opt-in")
class NotificationIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.orgs = [uuid.uuid4(), uuid.uuid4()]
        self.sites = [uuid.uuid4(), uuid.uuid4()]
        self.device_id = uuid.uuid4()
        self.uid = f"TB-NOTIFY-{self.device_id.hex}"
        self.now = datetime.now(timezone.utc)
        self.boot_id = uuid.uuid4()
        self.users = []
        self.created_capability = None
        self.tokens = {}
        self.identities = {}
        # Реєструємо cleanup до першого commit, щоб assertion також був безпечним.
        self.addCleanup(self.cleanup_data)
        with SessionLocal() as session:
            for org_id, site_id in zip(self.orgs, self.sites):
                session.add(Organization(id=org_id, name="Notification test", slug=f"notify-{org_id.hex}"))
                session.flush()
                session.add(Site(id=site_id, organization_id=org_id, name="Test only", code="test"))
                session.flush()
            session.add(Device(id=self.device_id, site_id=self.sites[0], uid=self.uid,
                               name="Notification test", lifecycle_status="active"))
            self.created_capability = session.scalar(insert(Capability).values(
                id=uuid.uuid4(), code="pressure.read", name="Pressure",
            ).on_conflict_do_nothing(index_elements=["code"]).returning(Capability.id))
            self.capability_id = session.scalar(select(Capability.id).where(Capability.code == "pressure.read"))
            for name, org, role in (("viewer", self.orgs[0], "viewer"),
                                    ("operator", self.orgs[0], "operator"),
                                    ("outsider", self.orgs[1], "owner")):
                ctx = _identity(session, org, role)
                self.identities[name] = ctx
                self.users.append(ctx.user.id)
                self.tokens[name] = create_access_token(
                    user_id=ctx.user.id, auth_session_id=ctx.auth_session.id,
                ).token
            session.commit()

    def cleanup_data(self):
        with SessionLocal() as session:
            session.execute(delete(Organization).where(Organization.id.in_(self.orgs)))
            session.execute(delete(User).where(User.id.in_(self.users)))
            if self.created_capability is not None:
                session.execute(delete(Capability).where(Capability.id == self.created_capability))
            session.commit()
            self.assertEqual(session.scalar(select(func.count()).select_from(AlarmNotification).where(
                AlarmNotification.device_id == self.device_id,
            )), 0, "Test notification was not removed")
            self.assertEqual(session.scalar(select(func.count()).select_from(NotificationRead).where(
                NotificationRead.user_id.in_(self.users),
            )), 0, "Test receipt was not removed")

    def configure_rule(self, debounce=1):
        with SessionLocal() as session:
            session.add(DeviceCapability(device_id=self.device_id, capability_id=self.capability_id,
                is_enabled=True, config={"alarm_rules": [{
                    "rule_key": "test.pressure", "alarm_type": "pressure.low", "metric": "pressure.bar",
                    "kind": "low", "threshold": 1, "clear_threshold": 2, "debounce_samples": debounce,
                    "severity": "warning", "title": "Test low pressure",
                }]}))
            session.commit()

    def envelope(self, value, sequence):
        return TelemetryEnvelope(schema_version=1, message_id=uuid.uuid4(), session_id=self.boot_id,
                                 sequence=sequence, values={"pressure.bar": value}, state={})

    def raise_alarm(self, session, *, severity="warning", seconds=0, event_id=None, key="test.lifecycle"):
        return AlarmLifecycleService(session).raise_alarm(
            device_id=self.device_id, alarm_key=key, alarm_type="pressure.low",
            severity=severity, title=f"Test {severity}", occurred_at=self.now+timedelta(seconds=seconds),
            event_id=event_id,
        )

    def notifications(self):
        with SessionLocal() as session:
            return list(session.scalars(select(AlarmNotification).where(
                AlarmNotification.device_id == self.device_id,
            ).order_by(AlarmNotification.created_at, AlarmNotification.id)))

    def request(self, method, path, *, who="viewer", expected=200):
        code, result = _request(method, f"/api/v1{path}", self.tokens.get(who))
        self.assertEqual(code, expected, (method, path, result))
        return result

    def test_lifecycle_snapshots_deduplicate_repeats_and_preserve_history(self):
        with SessionLocal() as session:
            event = DeviceEvent(device_id=self.device_id, event_type="test.pressure", severity="warning",
                                source="system", title="Test", occurred_at=self.now, data={})
            session.add(event)
            session.commit()
            first = self.raise_alarm(session, event_id=event.id)
            self.assertTrue(self.raise_alarm(session, event_id=event.id).duplicate_event)
            self.raise_alarm(session, seconds=1)
            self.raise_alarm(session, severity="critical", seconds=2)
            # Старе warning-вимірювання не створює повідомлення про пониження severity.
            self.raise_alarm(session, seconds=1)
            AlarmLifecycleService(session).resolve_alarm(device_id=self.device_id,
                alarm_key="test.lifecycle", occurred_at=self.now+timedelta(seconds=3))
            AlarmLifecycleService(session).resolve_alarm(device_id=self.device_id,
                alarm_key="test.lifecycle", occurred_at=self.now+timedelta(seconds=4))
            # Навіть повторне додавання того самого transition має бути idempotent у БД.
            alarm = session.get(DeviceAlarm, first.alarm_id)
            transition = session.get(AlarmTransition, first.transition_id)
            NotificationService(session).record_alarm_transition(alarm=alarm, transition=transition)
            session.commit()
            new_incident = self.raise_alarm(session, seconds=5)
            self.assertNotEqual(first.alarm_id, new_incident.alarm_id)
        rows = self.notifications()
        self.assertEqual([r.kind for r in rows], ["raised", "severity_changed", "resolved", "raised"])
        self.assertEqual([r.severity for r in rows], ["warning", "critical", "critical", "warning"])
        self.assertEqual(rows[0].title, "Test warning")

    def test_notification_failure_rolls_back_whole_telemetry_transaction(self):
        self.configure_rule()
        payload = self.envelope(0.4, 1)
        original = NotificationRepository.add_snapshot
        def fail_after_write(repo, **values):
            original(repo, **values)
            raise RuntimeError("Injected notification failure")
        with SessionLocal() as session:
            with patch.object(NotificationRepository, "add_snapshot", fail_after_write):
                with self.assertRaisesRegex(RuntimeError, "Injected notification failure"):
                    TelemetryService(session).ingest(device_uid=self.uid, payload=payload)
        with SessionLocal() as session:
            for model in (TelemetryMessage, DeviceState, DeviceAlarmRuleState, DeviceEvent, DeviceAlarm, AlarmNotification):
                self.assertEqual(session.scalar(select(func.count()).select_from(model).where(
                    model.device_id == self.device_id,
                )), 0, model.__name__)
            self.assertIsNone(session.get(Device, self.device_id).last_observed_session_id)
            TelemetryService(session).ingest(device_uid=self.uid, payload=payload)
        self.assertEqual(len(self.notifications()), 1, "Retry must write the notification exactly once")

    def test_http_permissions_personal_reads_pagination_and_revocation(self):
        with SessionLocal() as session:
            first = self.raise_alarm(session)
            self.raise_alarm(session, key="test.second")
        item = self.notifications()[0]
        root = f"/organizations/{self.orgs[0]}/notifications"
        detail = f"/notifications/{item.id}"
        self.request("GET", root, who=None, expected=401)
        for path in (root, root+"/unread-count", detail):
            self.request("GET", path, who="outsider", expected=404)
        foreign = self.request("GET", detail, who="outsider", expected=404)
        missing = self.request("GET", f"/notifications/{uuid.uuid4()}", expected=404)
        self.assertEqual(foreign, missing)
        self.request("POST", detail+"/read", who="outsider", expected=404)
        self.request("POST", detail+"/read", who=None, expected=401)
        self.request("GET", root+"?limit=0", expected=422)
        self.request("GET", root+"?limit=201", expected=422)
        self.request("GET", root+"?offset=-1", expected=422)
        p1 = self.request("GET", root+"?limit=1")
        p2 = self.request("GET", root+"?limit=1&offset=1")
        self.assertEqual(len(p1), 1)
        self.assertEqual(len(p2), 1)
        self.assertNotEqual(p1[0]["id"], p2[0]["id"])
        self.assertEqual(self.request("GET", root+"/unread-count")["unread_count"], 2)
        read = self.request("POST", detail+"/read")
        self.assertEqual(read, self.request("POST", detail+"/read"))
        self.assertEqual(self.request("GET", detail)["read_at"], read["read_at"])
        self.assertIsNone(self.request("GET", detail, who="operator")["read_at"])
        self.assertEqual(len(self.request("GET", root+"?unread_only=true")), 1)
        self.assertEqual(self.request("GET", root+"/unread-count")["unread_count"], 1)
        self.assertEqual(self.request("GET", root+"/unread-count", who="operator")["unread_count"], 2)
        # Прочитання viewer не означає acknowledge і не дає нових прав.
        self.request("POST", f"/alarms/{first.alarm_id}/acknowledge", expected=403)
        alarm = self.request("GET", f"/alarms/{first.alarm_id}")
        self.assertIsNone(alarm["acknowledged_at"])
        self.request("POST", f"/alarms/{first.alarm_id}/acknowledge", who="operator")
        self.request("POST", f"/alarms/{first.alarm_id}/acknowledge", who="operator")
        self.assertEqual(len(self.notifications()), 2, "Acknowledge must not spam the feed")
        with SessionLocal() as session:
            session.scalar(select(OrganizationMembership).where(
                OrganizationMembership.user_id == self.identities["viewer"].user.id,
                OrganizationMembership.organization_id == self.orgs[0],
            )).is_active = False
            session.get(User, self.identities["outsider"].user.id).platform_role = "service_admin"
            session.commit()
        self.request("GET", root, expected=404)
        self.request("POST", detail+"/read", expected=404)
        self.request("GET", detail, who="outsider", expected=404)
        with SessionLocal() as session:
            from app.models.auth_session import AuthSession
            session.get(AuthSession, self.identities["operator"].auth_session.id).revoked_at = self.now
            session.commit()
        self.request("GET", root, who="operator", expected=401)

    def test_moving_device_does_not_expose_historical_notifications(self):
        with SessionLocal() as session:
            self.raise_alarm(session)
            session.get(Device, self.device_id).site_id = self.sites[1]
            session.commit()
        item = self.notifications()[0]
        for who in ("viewer", "outsider"):
            self.request("GET", f"/notifications/{item.id}", who=who, expected=404)
            self.request("POST", f"/notifications/{item.id}/read", who=who, expected=404)
        for org, who in zip(self.orgs, ("viewer", "outsider")):
            self.assertEqual(self.request("GET", f"/organizations/{org}/notifications", who=who), [])
            self.assertEqual(self.request("GET", f"/organizations/{org}/notifications/unread-count", who=who),
                             {"unread_count": 0})

    def parallel(self, action):
        barrier = threading.Barrier(2)
        def run(index):
            with SessionLocal() as session:
                session.execute(text("SET LOCAL lock_timeout = '3s'"))
                session.execute(text("SET LOCAL statement_timeout = '5s'"))
                barrier.wait(timeout=3)
                return action(session, index)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(run, index) for index in range(2)]
            return [f.result(timeout=8) for f in futures]

    def test_concurrent_reads_keep_one_original_timestamp(self):
        with SessionLocal() as session:
            self.raise_alarm(session)
        item = self.notifications()[0]
        user_id = self.identities["viewer"].user.id
        times = self.parallel(lambda session, _: NotificationService(session).mark_read(item.id, user_id))
        self.assertEqual(times[0], times[1])
        with SessionLocal() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(NotificationRead).where(
                NotificationRead.notification_id == item.id,
            )), 1)

    def test_concurrent_raises_create_one_notification(self):
        results = self.parallel(lambda session, _: self.raise_alarm(session))
        self.assertCountEqual([r.action for r in results], ["raised", "repeated"])
        self.assertEqual(results[0].alarm_id, results[1].alarm_id)
        self.assertEqual(len(self.notifications()), 1)

    def test_stale_cached_alarm_does_not_hide_severity_change(self):
        with SessionLocal() as first_session:
            result = self.raise_alarm(first_session)
            cached = first_session.get(DeviceAlarm, result.alarm_id)
            first_session.commit()
            with SessionLocal() as worker:
                self.raise_alarm(worker, severity="critical", seconds=1)
            self.assertEqual(cached.severity, "warning")
            self.assertTrue(self.raise_alarm(first_session, severity="warning", seconds=2).severity_changed)
        self.assertEqual([r.severity for r in self.notifications()], ["warning", "critical", "warning"])

    @unittest.skipUnless(os.getenv("TECHBAZA_RUN_MQTT_TESTS") == "1", "Requires a test MQTT broker")
    def test_mqtt_to_rule_alarm_notification_http_acknowledge_and_recovery(self):
        self.configure_rule(debounce=2)
        ready = threading.Event()
        receiver = paho.Client(paho.CallbackAPIVersion.VERSION2,
                              client_id=f"notify-{self.device_id.hex}", clean_session=True, manual_ack=True)
        topic = f"techbaza/devices/{self.uid}/telemetry"
        receiver.on_connect = lambda client, *args: client.subscribe(topic, qos=1)
        receiver.on_subscribe = lambda *args: ready.set()
        receiver.on_message = mqtt_client._on_message
        publisher = paho.Client(paho.CallbackAPIVersion.VERSION2)

        def await_message(message_id):
            deadline = time.monotonic()+8
            while time.monotonic() < deadline:
                with SessionLocal() as session:
                    if session.scalar(select(TelemetryMessage.id).where(TelemetryMessage.message_id == message_id)):
                        return
                time.sleep(0.05)
            self.fail("MQTT telemetry was not committed")

        def send(value, sequence):
            payload = self.envelope(value, sequence)
            publisher.publish(topic, payload.model_dump_json(), qos=1).wait_for_publish(timeout=5)
            await_message(payload.message_id)
            return payload

        try:
            with patch.object(mqtt_client, "client", receiver):
                try:
                    mqtt_client.start_mqtt()
                    self.assertTrue(ready.wait(5), "MQTT subscription timed out")
                    publisher.connect(mqtt_client.MQTT_HOST, mqtt_client.MQTT_PORT)
                    publisher.loop_start()
                    send(0.4, 1)
                    self.assertEqual(self.notifications(), [], "Debounce must delay the alarm")
                    packet = send(0.3, 2)
                    raised = self.notifications()
                    self.assertEqual(len(raised), 1)
                    self.assertEqual(raised[0].kind, "raised")
                    publisher.publish(topic, packet.model_dump_json(), qos=1).wait_for_publish(timeout=5)
                    send(0.2, 3)
                    self.assertEqual(len(self.notifications()), 1, "Duplicates must not spam the feed")
                    alarm_id = raised[0].alarm_id
                    self.request("POST", f"/notifications/{raised[0].id}/read")
                    first = self.request("POST", f"/alarms/{alarm_id}/acknowledge", who="operator")
                    again = self.request("POST", f"/alarms/{alarm_id}/acknowledge", who="operator")
                    self.assertEqual(first["acknowledged_at"], again["acknowledged_at"])
                    send(1.5, 4)
                    self.assertEqual(len(self.notifications()), 1, "Hysteresis must hold the alarm")
                    send(2.5, 5)
                    self.assertEqual(len(self.notifications()), 1, "Recovery requires debounce")
                    send(2.6, 6)
                    rows = self.notifications()
                    self.assertEqual([r.kind for r in rows], ["raised", "resolved"])
                    self.assertEqual(rows[0].alarm_id, rows[1].alarm_id)
                    alarm = self.request("GET", f"/alarms/{alarm_id}")
                    self.assertEqual(alarm["state"], "resolved")
                    self.assertEqual(alarm["acknowledged_by_user_id"], str(self.identities["operator"].user.id))
                    history = self.request("GET", f"/alarms/{alarm_id}/transitions")
                    self.assertCountEqual([item["transition_type"] for item in history],
                                          ["raised", "acknowledged", "resolved"])
                    feed = self.request("GET", f"/organizations/{self.orgs[0]}/notifications")
                    self.assertEqual(len(feed), 2)
                    self.assertEqual(sum(item["read_at"] is None for item in feed), 1)
                finally:
                    mqtt_client.stop_mqtt()
        finally:
            publisher.disconnect()
            publisher.loop_stop()
