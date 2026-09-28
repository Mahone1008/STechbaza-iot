"""Етап 8/5: наскрізні контракти HTTP/JWT/PostgreSQL та переходи команд.

Потрібен TECHBAZA_RUN_DB_TESTS=1 і зупинені фонові workers цієї бази.
Власні випадкові tenants; cleanup видаляє лише створені цим тестом дані.
MQTT publish підміняється лише в тестах конкретних delivery-переходів;
справжній broker/restart перевіряє окремий Compose resilience сценарій.
"""

import os
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.parse import urlencode

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.db import SessionLocal
from app.models.auth_session import AuthSession
from app.models.capability import Capability, DeviceCapability
from app.models.command import DeviceCommand
from app.models.device import Device
from app.models.organization import Organization
from app.models.site import Site
from app.models.user import User
from app.repositories.commands import CommandRepository
from app.schemas.command_ack import CommandAckEnvelope
from app.schemas.command_result import CommandResultEnvelope
from app.schemas.telemetry import TelemetryEnvelope
from app.security.tokens import create_access_token
from app.services.command_ack import CommandAckDeviceMismatchError, CommandAckService
from app.services.command_dispatch import CommandDispatchService
from app.services.command_result import (
    CommandResultConflictError, CommandResultDeviceMismatchError, CommandResultService,
)
from app.services.telemetry import TelemetryService
from app.tools.alarm_ack_check import _identity
from auth_http_helpers import request


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires PostgreSQL opt-in")
class ComprehensivePostgresTests(unittest.TestCase):
    def setUp(self):
        self.orgs, self.sites, self.devices = [[uuid.uuid4(), uuid.uuid4()] for _ in range(3)]
        self.contexts, self.tokens, self.caps, self.created_caps = {}, {}, {}, []
        self.now = datetime.now(timezone.utc)
        self.boot = uuid.uuid4()
        self.addCleanup(self.cleanup_data)
        with SessionLocal() as session:
            for org, site, device in zip(self.orgs, self.sites, self.devices):
                session.add(Organization(id=org, name="Complex check", slug=f"complex-{org.hex}"))
                session.flush()
                session.add(Site(id=site, organization_id=org, name="Test only", code="test"))
                session.flush()
                session.add(Device(id=device, site_id=site, uid=f"TB-COMPLEX-{device.hex}",
                                   name="Test only", lifecycle_status="active"))
            for role in ("owner", "operator", "viewer", "other"):
                ctx = _identity(session, self.orgs[role == "other"], "owner" if role == "other" else role)
                self.contexts[role] = ctx
                self.tokens[role] = create_access_token(user_id=ctx.user.id, auth_session_id=ctx.auth_session.id).token
            session.commit()
        for code in ("vfd.control", "pressure.read"):
            with SessionLocal() as session:
                created = session.scalar(insert(Capability).values(id=uuid.uuid4(), code=code, name="Complex check")
                    .on_conflict_do_nothing(index_elements=["code"]).returning(Capability.id))
                if created:
                    self.created_caps.append(created)
                cap_id = session.scalar(select(Capability.id).where(Capability.code == code))
                self.caps[code] = cap_id
                for device in self.devices:
                    session.add(DeviceCapability(device_id=device, capability_id=cap_id, is_enabled=True, config={}))
                session.commit()
        self.base = f"/api/v1/devices/{self.devices[0]}"
        self.command_path = self.base + "/commands"
        self.feed = f"/api/v1/organizations/{self.orgs[0]}/notifications"

    def cleanup_data(self):
        with SessionLocal() as session:
            session.execute(delete(Organization).where(Organization.id.in_(self.orgs)))
            session.execute(delete(User).where(User.id.in_([c.user.id for c in self.contexts.values()])))
            session.execute(delete(Capability).where(Capability.id.in_(self.created_caps)))
            session.commit()

    def test_command_cursor_validation_and_legacy_list(self):
        from urllib.parse import urlencode
        cursor = {"before_created_at": "2026-09-28T12:00:00+00:00", "before_id": str(uuid.uuid4())}
        for query in ({"before_id": cursor["before_id"]}, {"before_created_at": cursor["before_created_at"]},
                      {**cursor, "offset": 1}, {**cursor, "before_created_at": "2026-09-28T12:00:00"}):
            self.call(self.command_path + "?" + urlencode(query), expected=422)
        self.assertEqual(self.call(self.command_path + "?" + urlencode(cursor)), [])
        self.assertEqual(self.call(self.command_path + "?limit=20&offset=0"), [])

    def call(self, path, *, method="GET", body=None, who="operator", expected=200):
        headers = {"authorization": f"Bearer {self.tokens[who]}"} if who else {}
        code, result, _ = request(method, path, body=body, headers=headers)
        self.assertEqual(code, expected, (method, path, code, result))
        return result

    def body(self, **changes):
        return {"request_id": str(uuid.uuid4()), "command_type": "vfd.start", **changes}

    def create(self, body=None):
        return self.call(self.command_path, method="POST", body=body or self.body(), expected=201)

    def online(self):
        with SessionLocal() as session:
            session.get(Device, self.devices[0]).last_seen_at = datetime.now(timezone.utc)
            session.commit()

    def dispatch(self, command, **kwargs):
        with SessionLocal() as session:
            return CommandDispatchService(session).dispatch(uuid.UUID(command["id"]), **kwargs)

    def read(self, command):
        return self.call("/api/v1/commands/" + command["id"])

    def reply(self, command, *, result=False, device=0, **changes):
        envelope = dict(command_id=command["id"], message_id=uuid.uuid4(), session_id=self.boot)
        with SessionLocal() as session:
            if result:
                return CommandResultService(session).complete(device_uid=f"TB-COMPLEX-{self.devices[device].hex}",
                    payload=CommandResultEnvelope(**envelope, status="succeeded", result={"done": True}, **changes))
            return CommandAckService(session).acknowledge(device_uid=f"TB-COMPLEX-{self.devices[device].hex}",
                payload=CommandAckEnvelope(**envelope))

    def published(self):
        self.online()
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")):
            result = self.create()
        self.assertEqual(result["status"], "published")
        return result

    def test_concurrent_http_retries_create_one_record_and_one_publish(self):
        self.online()
        body = self.body()
        barrier = threading.Barrier(2)
        original = CommandRepository.get_by_request_id
        def same_missing(repo, request_id):
            row = original(repo, request_id)
            if row is None and str(request_id) == body["request_id"]:
                barrier.wait(timeout=5)
            return row
        def send():
            return request("POST", self.command_path, body=body,
                           headers={"authorization": "Bearer " + self.tokens["operator"]})
        with patch.object(CommandRepository, "get_by_request_id", same_missing), \
             patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")) as publish:
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: send(), range(2)))
            self.assertCountEqual([r[0] for r in results], [200, 201])
            self.assertEqual(len({r[1]["id"] for r in results}), 1)
            self.assertEqual(publish.call_count, 1)
        rows = self.call(self.command_path)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["actor_user_id"], str(self.contexts["operator"].user.id))

    def test_request_id_conflicts_do_not_change_original_actor_or_payload(self):
        body = self.body()
        first = self.create(body)
        self.call(self.command_path, method="POST", body={**body, "command_type": "vfd.stop"}, expected=409)
        self.call(self.command_path, method="POST", body=body, who="owner", expected=409)
        foreign = f"/api/v1/devices/{self.devices[1]}/commands"
        self.call(foreign, method="POST", body=body, who="other", expected=409)
        self.assertEqual(self.read(first), first)
        self.assertEqual(self.call(foreign, who="other"), [])

    def test_http_membership_downgrade_and_revocation_affect_existing_token(self):
        path = f"/api/v1/organizations/{self.orgs[0]}/memberships"
        membership = next(m for m in self.call(path, who="owner")
                          if m["user_id"] == str(self.contexts["operator"].user.id))
        self.call(path + "/" + membership["id"], method="PATCH", body={"role": "viewer"}, who="owner")
        self.assertEqual(self.call(self.base + "/overview")["allowed_commands"], [])
        self.call(self.command_path, method="POST", body=self.body(), expected=403)
        self.call(path + "/" + membership["id"], method="PATCH", body={"is_active": False}, who="owner")
        for suffix in ("/overview", "/commands", "/telemetry", "/alarms", "/events"):
            self.call(self.base + suffix, expected=404)
        self.call(self.command_path, method="POST", body=self.body(), expected=404)
        self.assertEqual(self.call(self.command_path, who="owner"), [])

    def test_http_module_disable_blocks_new_commands_and_preserves_audit(self):
        first = self.create()
        assignment = self.base + f"/capabilities/{self.caps['vfd.control']}"
        self.call(assignment, method="PATCH", body={"is_enabled": False}, who="owner")
        self.assertEqual(self.call(self.base + "/overview")["allowed_commands"], [])
        self.call(self.command_path, method="POST", body=self.body(), expected=409)
        self.assertEqual(self.read(first), first)
        self.call(assignment, method="PATCH", body={"is_enabled": True}, who="owner")
        self.assertEqual(self.call(self.command_path, method="POST", body={
            "request_id": first["request_id"], "command_type": first["command_type"]})["id"], first["id"])
        self.assertEqual(len(self.call(self.command_path)), 1)

    def test_invalid_http_commands_have_no_queue_or_publish_side_effects(self):
        self.online()
        cases = [{"ttl_seconds": 4}, {"ttl_seconds": 301}, {"command_type": "unknown"},
                 {"payload": {"unexpected": 1}}, {"request_id": "not-uuid"}]
        cases += [{"command_type": "vfd.frequency.set", "payload": {"frequency_hz": value}}
                  for value in (-1, 101, True, "50", None, 10**400, -(10**400))]
        with patch("app.services.command_dispatch.publish_command_message") as publish:
            for change in cases:
                self.call(self.command_path, method="POST", body=self.body(**change), expected=422)
            publish.assert_not_called()
        self.assertEqual(self.call(self.command_path), [])

    def test_foreign_and_anonymous_access_cannot_read_or_mutate_incident(self):
        first = self.create()
        self.dispatch(first, now=self.now + timedelta(minutes=10), allow_retry=True)
        alarm = self.call(self.base + "/alarms")[0]
        notice = self.call(self.feed)[0]
        event = self.call(self.base + "/events")[0]
        paths = [self.base, self.base + "/overview", self.base + "/availability", self.command_path,
                 self.base + "/telemetry", self.base + "/state", self.base + "/capabilities",
                 self.base + "/alarms", self.base + "/events", self.feed, self.feed + "/unread-count",
                 "/api/v1/commands/" + first["id"], "/api/v1/events/" + event["id"],
                 "/api/v1/alarms/" + alarm["id"], "/api/v1/alarms/" + alarm["id"] + "/transitions",
                 "/api/v1/notifications/" + notice["id"]]
        for who, expected in (("other", 404), (None, 401)):
            for path in paths:
                self.call(path, who=who, expected=expected)
            for path in ("/api/v1/alarms/" + alarm["id"] + "/acknowledge",
                         "/api/v1/notifications/" + notice["id"] + "/read"):
                self.call(path, method="POST", who=who, expected=expected)
        self.assertIsNone(self.call("/api/v1/alarms/" + alarm["id"])["acknowledged_at"])
        self.assertIsNone(self.call("/api/v1/notifications/" + notice["id"])["read_at"])

    def test_revoked_session_blocks_read_and_write_without_new_command(self):
        first = self.create()
        with SessionLocal() as session:
            session.get(AuthSession, self.contexts["operator"].auth_session.id).revoked_at = self.now
            session.commit()
        for path in (self.base + "/overview", self.command_path, "/api/v1/commands/" + first["id"], self.feed):
            self.call(path, expected=401)
        self.call(self.command_path, method="POST", body=self.body(), expected=401)
        self.assertEqual(len(self.call(self.command_path, who="owner")), 1)

    def test_failed_publish_survives_new_session_and_retries_same_envelope(self):
        self.online()
        with patch("app.services.command_dispatch.publish_command_message", return_value=(False, "test_broker_down")) as publish:
            first = self.create()
            sent = publish.call_args.kwargs["payload"]
        self.assertEqual((first["status"], first["publish_attempts"]), ("queued", 1))
        retry_time = self.now + timedelta(seconds=15)
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")) as publish:
            self.dispatch(first, now=retry_time, allow_retry=True)
            self.assertEqual(publish.call_args.kwargs["payload"], sent)
        self.reply(first)
        with patch("app.services.command_dispatch.publish_command_message") as publish:
            self.dispatch(first, now=retry_time, allow_retry=True)
            publish.assert_not_called()
        self.assertEqual((self.read(first)["status"], self.read(first)["publish_attempts"]), ("acknowledged", 2))

    def test_offline_expiry_is_terminal_with_single_alarm_and_notification(self):
        first = self.create(self.body(ttl_seconds=5))
        with patch("app.services.command_dispatch.publish_command_message") as publish:
            for _ in range(2):
                self.dispatch(first, now=self.now + timedelta(seconds=10), allow_retry=True)
            publish.assert_not_called()
        self.assertEqual(self.read(first)["status"], "expired")
        self.assertEqual(len(self.call(self.base + "/alarms")), 1)
        self.assertEqual([n["kind"] for n in self.call(self.feed)], ["raised"])

    def test_result_before_ack_and_conflicting_repeat_preserve_terminal_state(self):
        first = self.published()
        self.reply(first, result=True)
        terminal = self.read(first)
        self.assertTrue(self.reply(first).duplicate)
        self.assertTrue(self.reply(first, result=True).duplicate)
        with SessionLocal() as session:
            with self.assertRaises(CommandResultConflictError):
                CommandResultService(session).complete(device_uid=f"TB-COMPLEX-{self.devices[0].hex}",
                    payload=CommandResultEnvelope(command_id=first["id"], message_id=uuid.uuid4(),
                        session_id=self.boot, status="failed", error_code="conflicting_reply"))
        self.assertEqual(self.read(first), terminal)
        self.assertEqual(self.call(self.base + "/alarms"), [])

    def test_reply_from_other_device_cannot_complete_or_acknowledge_command(self):
        first = self.published()
        with self.assertRaises(CommandAckDeviceMismatchError):
            self.reply(first, device=1)
        with self.assertRaises(CommandResultDeviceMismatchError):
            self.reply(first, device=1, result=True)
        self.assertEqual(self.read(first), first)

    def test_duplicate_and_old_telemetry_do_not_repeat_alarm_or_replace_current_state(self):
        rule = {"rule_key": "complex.pressure", "alarm_type": "complex.pressure", "metric": "pressure.bar",
                "kind": "low", "threshold": 1, "clear_threshold": 2, "debounce_samples": 1, "severity": "warning", "title": "Test"}
        self.call(self.base + f"/capabilities/{self.caps['pressure.read']}", method="PATCH",
                  body={"config": {"alarm_rules": [rule]}}, who="owner")
        def ingest(sequence, value, boot=None, packet=None):
            payload = packet or TelemetryEnvelope(schema_version=1, message_id=uuid.uuid4(),
                session_id=boot or self.boot, sequence=sequence, values={"pressure.bar": value}, state={})
            with SessionLocal() as session:
                result = TelemetryService(session).ingest(device_uid=f"TB-COMPLEX-{self.devices[0].hex}", payload=payload)
            return payload, result
        payload, _ = ingest(10, 0.5)
        self.assertTrue(ingest(10, 0.5, packet=payload)[1].duplicate)
        self.assertFalse(ingest(9, 3)[1].state_updated)
        alarm = self.call(self.base + "/alarms?alarm_type=complex.pressure")[0]
        self.assertEqual(alarm["state"], "active")
        self.assertEqual(len([n for n in self.call(self.feed) if n["alarm_id"] == alarm["id"]]), 1)
        self.assertEqual(self.call(self.base + "/overview")["snapshot"]["values"]["pressure.bar"], 0.5)
        ingest(1, 3, boot=uuid.uuid4())
        self.assertFalse(ingest(100, 0.1)[1].state_updated)
        self.assertEqual(self.call(self.base + "/overview")["snapshot"]["values"]["pressure.bar"], 3)
        self.assertEqual(self.call("/api/v1/alarms/" + alarm["id"])["state"], "resolved")
        kinds = [n["kind"] for n in self.call(self.feed) if n["alarm_id"] == alarm["id"]]
        self.assertCountEqual(kinds, ["raised", "resolved"])
        end = datetime.now(timezone.utc) + timedelta(seconds=1)
        query = urlencode({"metric": "pressure.bar", "start": (self.now - timedelta(seconds=1)).isoformat(),
                           "end": end.isoformat(), "bucket_seconds": 30})
        chart = self.call(self.base + "/telemetry/series?" + query)
        # Історія містить запізнілі унікальні пакети; duplicate message_id — один раз.
        self.assertEqual(chart["message_count"], 4)
        self.assertEqual(chart["sample_count"], 4)
