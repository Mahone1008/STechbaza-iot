"""HTTP/RBAC, постійний режим, гонки та відсутність відкладеного самозапуску."""
import os
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from sqlalchemy import select

from app.db import SessionLocal
from app.models.command import DeviceCommand
from app.models.device import Device
from app.models.event_alarm import DeviceEvent
from app.schemas.control_mode import ControlModeWrite
from app.services.commands import CommandActorSnapshot
from app.services.command_dispatch import CommandDispatchService
from app.services.control_mode import ControlModeConflict, ControlModeService
import test_schedules_postgres as schedules


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class ControlModePostgresTests(unittest.TestCase):
    call = schedules.SchedulePostgresTests.call
    cleanup_data = schedules.SchedulePostgresTests.cleanup_data
    fresh = schedules.SchedulePostgresTests.fresh
    save_rule = schedules.SchedulePostgresTests.save_rule
    history = schedules.SchedulePostgresTests.history
    process = schedules.SchedulePostgresTests.process

    def setUp(self):
        schedules.SchedulePostgresTests.setUp(self)
        with SessionLocal() as session:
            session.get(Device, self.devices[0]).control_mode = "manual"
            session.commit()
        self.fresh(self.now)
        self.path = self.base + "/control-mode"

    def actor(self):
        current = self.contexts["operator"]
        return CommandActorSnapshot(user_id=current.user.id, auth_session_id=current.auth_session.id,
            organization_id=self.orgs[0], platform_role=current.user.platform_role, organization_role="operator",
            email=current.user.email, display_name=current.user.display_name)

    def change(self, mode, revision, *, now=None):
        with SessionLocal() as session:
            return ControlModeService(session).update(self.devices[0], ControlModeWrite(
                request_id=uuid.uuid4(), mode=mode, expected_revision=revision), self.actor(), now=now or self.now)

    def test_scope_revision_idempotency_and_audit_without_motor_command(self):
        self.save_rule()
        current = self.call(self.path, who="viewer")
        self.assertEqual((current["mode"], current["revision"]), ("manual", 0))
        data = dict(request_id=str(uuid.uuid4()), mode="schedule", expected_revision=0)
        for who, status in (("viewer", 403), ("other", 404), (None, 401)):
            self.call(self.path, method="PATCH", body=data, who=who, expected=status)
        with patch("app.services.command_dispatch.publish_command_message") as publish:
            saved = self.call(self.path, method="PATCH", body=data)
            self.assertEqual(self.call(self.path, method="PATCH", body=data), saved)
            publish.assert_not_called()
        self.assertEqual((saved["mode"], saved["revision"]), ("schedule", 1))
        self.assertEqual(self.call(self.path)["revision"], 1)
        self.call(self.path, method="PATCH", body={**data, "request_id": str(uuid.uuid4())}, expected=409)
        self.call(self.path, method="PATCH", body={**data, "mode": "manual"}, expected=409)
        self.call(self.path, method="PATCH", body=data, who="owner", expected=409)
        self.call(self.path, method="PATCH", body={**data, "expected_revision": True}, expected=422)
        self.call(self.path, method="PATCH", body={**data, "mode": "local"}, expected=422)
        with SessionLocal() as session:
            events = list(session.scalars(select(DeviceEvent).where(DeviceEvent.device_id == self.devices[0])))
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0].data["actor_user_id"], str(self.contexts["operator"].user.id))
            self.assertEqual(events[0].data["request"], data)
            self.assertEqual(list(session.scalars(select(DeviceCommand).where(DeviceCommand.device_id == self.devices[0]))), [])

    def test_schedule_requires_enabled_future_rule_and_current_firmware(self):
        with self.assertRaises(ControlModeConflict):
            self.change("schedule", 0)
        self.save_rule()
        self.fresh(self.now, supported=False)
        with self.assertRaises(ControlModeConflict):
            self.change("schedule", 0)
        self.fresh(self.now)
        with self.assertRaises(ControlModeConflict):
            self.change("schedule", 0, now=self.now + timedelta(minutes=3))
        self.assertEqual(self.call(self.path)["revision"], 0)

    def test_manual_skips_due_run_and_reenable_never_catches_up(self):
        row, _ = self.save_rule(repeat="daily", until_date=(self.due + timedelta(days=2)).date().isoformat())
        self.fresh(self.due)
        self.assertEqual(self.process(row), "control_mode_manual")
        self.assertIsNone(self.history(row)[0]["command_id"])
        saved = self.change("schedule", 0, now=self.due + timedelta(seconds=1))
        self.assertGreater(saved.next_start_at, self.due)
        self.assertEqual(self.process(row, self.due + timedelta(seconds=2)), "not_due")
        self.assertEqual(len(self.history(row)), 1)

    def test_switch_blocks_queued_calendar_even_after_reenable(self):
        row, _ = self.save_rule(repeat="daily", until_date=(self.due + timedelta(days=2)).date().isoformat())
        self.change("schedule", 0)
        self.fresh(self.due)
        self.assertEqual(self.process(row), "queued")
        command_id = uuid.UUID(self.history(row)[0]["command_id"])
        self.change("manual", 1, now=self.due + timedelta(seconds=1))
        self.change("schedule", 2, now=self.due + timedelta(seconds=2))
        with SessionLocal() as session, patch("app.services.command_dispatch.publish_command_message") as publish:
            self.assertEqual(CommandDispatchService(session).dispatch(command_id, now=self.due + timedelta(seconds=3)).reason, "status_cancelled")
            publish.assert_not_called()
            self.assertEqual(session.get(DeviceCommand, command_id).error_code, "control_mode_changed")

    def test_manual_commands_pause_automation_but_retry_does_not_pause_again(self):
        self.save_rule()
        self.change("schedule", 0)
        data = dict(request_id=str(uuid.uuid4()), command_type="vfd.start", expected_control_mode_revision=1)
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")):
            first = self.call(self.command_path, method="POST", body=data, expected=201)
        current = self.call(self.path)
        self.assertEqual((current["mode"], current["revision"]), ("manual", 2))
        self.change("schedule", 2)
        retry = self.call(self.command_path, method="POST", body=data)
        self.assertEqual(retry["id"], first["id"])
        self.assertEqual(self.call(self.path)["mode"], "schedule")
        self.call(self.command_path, method="POST", body={**data, "request_id": str(uuid.uuid4())}, expected=409)
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")):
            stop = self.call(self.command_path, method="POST", body={
                "request_id": str(uuid.uuid4()), "command_type": "vfd.stop", "expected_control_mode_revision": 0}, expected=201)
        self.assertEqual(stop["command_type"], "vfd.stop")
        self.assertEqual(self.call(self.path)["mode"], "manual")

    def test_concurrent_switches_have_one_winner(self):
        self.save_rule()
        barrier = Barrier(2)
        def change():
            barrier.wait(timeout=5)
            try:
                self.change("schedule", 0)
                return "saved"
            except ControlModeConflict:
                return "conflict"
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(lambda _: change(), range(2))), ["conflict", "saved"])
        self.assertEqual(self.call(self.path)["revision"], 1)

    def test_old_mode_retry_after_stop_does_not_reenable_automation(self):
        self.save_rule()
        data = dict(request_id=str(uuid.uuid4()), mode="schedule", expected_revision=0)
        saved = self.call(self.path, method="PATCH", body=data)
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")):
            self.call(self.command_path, method="POST", body={"request_id": str(uuid.uuid4()), "command_type": "vfd.stop"}, expected=201)
        self.assertEqual(self.call(self.path)["mode"], "manual")
        self.assertEqual(self.call(self.path, method="PATCH", body=data), saved)
        self.assertEqual(self.call(self.path)["mode"], "manual")

    def test_stop_remains_available_at_the_mode_revision_limit(self):
        with SessionLocal() as session:
            device = session.get(Device, self.devices[0])
            device.control_mode = "schedule"; device.control_mode_revision = 2147483647
            session.commit()
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")):
            self.call(self.command_path, method="POST", body={"request_id": str(uuid.uuid4()), "command_type": "vfd.stop"}, expected=201)
        self.assertEqual(self.call(self.path)["mode"], "manual")
        rejected = self.call(self.command_path, method="POST", body={"request_id": str(uuid.uuid4()),
            "command_type": "vfd.start"}, expected=409)
        self.assertIn("перевірки сервісом", rejected["detail"])

    def test_delayed_mode_selection_cannot_follow_an_accepted_manual_action(self):
        self.save_rule()
        for kind in ("vfd.start", "vfd.stop"):
            current = self.call(self.path)
            old_selection = dict(request_id=str(uuid.uuid4()), mode="schedule", expected_revision=current["revision"])
            with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")):
                accepted = self.call(self.command_path, method="POST", body={"request_id": str(uuid.uuid4()),
                    "command_type": kind, "expected_control_mode_revision": current["revision"]}, expected=201)
            updated = self.call(self.path)
            self.assertEqual((updated["mode"], updated["revision"]), ("manual", current["revision"] + 1))
            self.assertEqual(accepted["control_mode_revision"], updated["revision"])
            self.call(self.path, method="PATCH", body=old_selection, expected=409)
            self.assertEqual(self.call(self.path)["mode"], "manual")
        with SessionLocal() as session:
            changes = list(session.scalars(select(DeviceEvent).where(DeviceEvent.device_id == self.devices[0],
                DeviceEvent.event_type == "device.control_mode_changed")))
            self.assertEqual(changes, [])
