"""Допуск програм і монотонне виконання в симуляторі без фізичного керування."""
import copy
import json
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import ValidationError
from app.demo.state import DemoState
from app.schemas.command import DeviceCommandCreate
from app.schemas.program import ProgramPlan, ProgramProgress
from app.services.command_config import result_timeout_seconds
from app.services.program_policy import program_rejection


def plan():
    return {"version": 1, "steps": [{"frequency_hz": 40, "duration_seconds": 10}, {"frequency_hz": 50, "duration_seconds": 20}]}


class ProgramTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.t = 100.0
        self.state = DemoState(Path(temp.name) / "program.sqlite3", monotonic=lambda: self.t)
        self.addCleanup(self.state.close)
        self.sequence = 0

    def command(self, kind="vfd.program.start", payload=None):
        self.sequence += 1
        now = datetime.now(timezone.utc)
        return {"schema_version": 2, "control_sequence": self.sequence, "command_id": str(uuid.uuid4()),
                "request_id": str(uuid.uuid4()), "issued_at": now.isoformat(),
                "expires_at": (now + timedelta(seconds=30)).isoformat(), "ttl_seconds": 30,
                "command_type": kind, "payload": payload if payload is not None else plan() if kind == "vfd.program.start" else {}}

    def test_strict_limits_and_duration(self):
        accepted = ProgramPlan.model_validate(plan())
        self.assertEqual(accepted.result_timeout_seconds, 330)
        for payload in [
            {"version": True, "steps": plan()["steps"]}, {"version": 2, "steps": plan()["steps"]},
            {"version": 1, "steps": []}, {"version": 1, "steps": plan()["steps"] * 5},
            {**plan(), "resume": True},
            *[{"version": 1, "steps": [{"frequency_hz": value, "duration_seconds": 10}]} for value in (0, -1, 101, 20.001, True, "40", 10**400, float("nan"))],
            *[{"version": 1, "steps": [{"frequency_hz": 40, "duration_seconds": value}]} for value in (True, "10", 9, 86401, 10.5)],
            {"version": 1, "steps": [{"frequency_hz": 40, "duration_seconds": 86400}] * 2},
        ]:
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                DeviceCommandCreate(request_id=uuid.uuid4(), command_type="vfd.program.start", payload=payload)

    def test_long_program_deadline_is_separate_from_delivery_ttl(self):
        data = {"version": 1, "steps": [{"frequency_hz": 40, "duration_seconds": 7200}, {"frequency_hz": 50, "duration_seconds": 3600}]}
        command = DeviceCommandCreate(request_id=uuid.uuid4(), command_type="vfd.program.start", payload=data, ttl_seconds=30)
        self.assertEqual(result_timeout_seconds(command), 11100)
        self.assertEqual(command.ttl_seconds, 30)

    def test_week_schedule_progress_deadline_and_legacy_firmware(self):
        now = datetime.now(timezone.utc).replace(microsecond=0)
        payload = {"version": 1, "starts_at": now.isoformat(), "stops_at": (now + timedelta(days=7)).isoformat(),
            "steps": [{"frequency_hz": 40, "duration_seconds": 604800}]}
        self.assertEqual(result_timeout_seconds(SimpleNamespace(command_type="vfd.schedule.start", payload=payload, created_at=now)), 604980)
        boot = uuid.uuid4()
        device = SimpleNamespace(id=uuid.uuid4(), last_observed_session_id=boot)
        progress = self.state.program_progress()
        snapshot = SimpleNamespace(diagnostics={"program": progress}, state={"pump_running": False},
            last_received_at=now, last_reported_at=now, last_session_id=boot)
        with patch("app.services.program_policy.TelemetryRepository") as telemetry, patch("app.services.program_policy.CapabilityRepository") as caps, patch("app.services.program_policy.configured_limits") as limits:
            telemetry.return_value.get_state.return_value = snapshot
            caps.return_value.get_enabled_codes_for_device.return_value = {"vfd.control", "vfd.program", "vfd.schedule"}
            limits.return_value = SimpleNamespace(min_hz=20, max_hz=50)
            self.assertIsNone(program_rejection(None, device, "vfd.schedule.start", payload, now))
            del progress["max_schedule_seconds"]
            self.assertEqual(ProgramProgress.model_validate(progress).max_schedule_seconds, 86400)
            self.assertEqual(program_rejection(None, device, "vfd.schedule.start", payload, now), "schedule_duration_unsupported")
        self.state.command("pump", self.command("vfd.schedule.start", payload))
        ProgramProgress.model_validate(self.state.program_progress())
        self.t += 604799; self.state.tick_program()
        self.assertTrue(self.state.device("pump")["running"])
        self.t += 1; self.state.tick_program()
        self.assertFalse(self.state.device("pump")["running"])
        self.assertEqual(self.state.program_progress()["state"], "completed")

    def test_ordered_execution_duplicate_and_completion(self):
        request = self.command()
        self.state.command("pump", request)
        self.assertIsNone(json.loads(self.state.pending()[0]["result"]))
        self.assertEqual(self.state.device("pump")["frequency"], 40)
        self.t += 9; self.state.tick_program()
        self.assertEqual(self.state.program_progress()["remaining_seconds"], 1)
        self.state.command("pump", request)  # Повтор не подовжує поточну витримку.
        self.t += 1; self.state.tick_program()
        self.assertEqual(self.state.device("pump")["frequency"], 50)
        self.assertEqual(self.state.program_progress()["step_index"], 2)
        self.t += 20; self.state.tick_program()
        self.assertFalse(self.state.device("pump")["running"])
        self.assertEqual(self.state.program_progress()["state"], "completed")
        result = json.loads(self.state.pending()[0]["result"])
        self.assertEqual(result["result"]["steps_completed"], 2)
        self.assertTrue(result["result"]["stop_confirmed"])
        self.assertFalse(self.state.command("pump", request))
        self.assertFalse(self.state.device("pump")["running"])

    def test_stop_owns_control_and_cancels_all_later_steps(self):
        request = self.command(); self.state.command("pump", request)
        self.state.command("pump", self.command("vfd.frequency.set", {"frequency_hz": 30}))
        self.assertEqual(self.state.device("pump")["frequency"], 40)
        self.assertEqual(json.loads(self.state.pending()[1]["result"])["error_code"], "busy")
        self.state.command("pump", self.command("vfd.stop"))
        self.t += 10000; self.state.tick_program(); self.state.command("pump", request)
        self.assertFalse(self.state.device("pump")["running"])
        self.assertEqual(self.state.program_progress()["reason"], "command")
        self.assertEqual(json.loads(self.state.pending()[0]["result"])["error_code"], "program_cancelled")

    def test_restart_and_network_loss_never_resume(self):
        for action in ("restart_recovery", "network_lost", "vfd_fault"):
            with self.subTest(action=action):
                request = self.command(); self.state.command("pump", request)
                if action == "restart_recovery": self.state.boot()
                else: self.state.interrupt_program(action)
                self.t += 1000; self.state.tick_program()
                self.assertFalse(self.state.device("pump")["running"])
                self.assertFalse(self.state.command("pump", request))
                self.assertFalse(self.state.device("pump")["running"])
                ProgramProgress.model_validate(self.state.program_progress())

    def test_policy_requires_current_firmware_profile_and_exclusive_control(self):
        now = datetime.now(timezone.utc); boot = uuid.uuid4()
        device = SimpleNamespace(id=uuid.uuid4(), last_observed_session_id=boot)
        snapshot = SimpleNamespace(diagnostics={"program": self.state.program_progress()}, state={"pump_running": False},
            last_received_at=now, last_reported_at=now, last_session_id=boot)
        with patch("app.services.program_policy.TelemetryRepository") as telemetry, patch("app.services.program_policy.CapabilityRepository") as capabilities, patch("app.services.program_policy.configured_limits") as limits:
            telemetry.return_value.get_state.return_value = snapshot
            capabilities.return_value.get_enabled_codes_for_device.return_value = {"vfd.control", "vfd.program"}
            limits.return_value = SimpleNamespace(min_hz=20, max_hz=50)
            self.assertIsNone(program_rejection(None, device, "vfd.program.start", plan(), now))
            snapshot.last_session_id = uuid.uuid4()
            self.assertEqual(program_rejection(None, device, "vfd.program.start", plan(), now), "program_firmware_unavailable")
            snapshot.last_session_id = boot; snapshot.diagnostics["program"]["ready"] = False
            self.assertEqual(program_rejection(None, device, "vfd.program.start", plan(), now), "program_firmware_unavailable")
            self.state.command("pump", self.command()); snapshot.diagnostics["program"] = self.state.program_progress()
            self.assertEqual(program_rejection(None, device, "vfd.frequency.set", {"frequency_hz": 30}, now), "program_active")
            self.assertIsNone(program_rejection(None, device, "vfd.stop", {}, now))
            own_id = uuid.UUID(snapshot.diagnostics["program"]["command_id"])
            snapshot.state["pump_running"] = True
            self.assertIsNone(program_rejection(None, device, "vfd.program.start", plan(), now, own_id))
            limits.return_value.max_hz = 45
            self.assertEqual(program_rejection(None, device, "vfd.program.start", plan(), now, own_id), "program_frequency_profile_changed")

    def test_progress_rejects_inconsistent_state_and_types(self):
        value = self.state.program_progress()
        for change in ({"version": True}, {"ready": 1}, {"step_index": 1}, {"state": "holding"}, {"target_frequency_hz": True}, {"remaining_seconds": -1}):
            with self.subTest(change=change), self.assertRaises(ValidationError):
                ProgramProgress.model_validate({**copy.deepcopy(value), **change})
