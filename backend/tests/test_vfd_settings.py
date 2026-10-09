import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException, Response
from pydantic import ValidationError

from app.api.v1.commands import create_command
from app.schemas.command import DeviceCommandCreate
from app.schemas.vfd_settings import VfdSettings
from app.services.vfd_settings import settings_rejection


def settings_fixture():
    return {"version": 1, "driver_id": "su600", "ready": True, "command_sequence": 10,
            "run_source": 2, "frequency_source": 6, "parameters": {"F0.10": 75, "F0.11": 75}}


class VfdSettingsTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc)
        self.device = SimpleNamespace(id=uuid.uuid4(), last_observed_session_id=uuid.uuid4())
        self.snapshot = SimpleNamespace(
            diagnostics={"vfd_settings": settings_fixture()},
            last_received_at=self.now, last_reported_at=self.now,
            last_session_id=self.device.last_observed_session_id,
            state={"pump_running": False, "vfd_fault_code": 0, "vfd_link": True},
            values={"vfd.frequency_hz": 0},
        )
        self.session = MagicMock()
        self.session.scalars.return_value.all.return_value = []
        self.session.scalars.return_value.first.return_value = None
        self.session.scalar.return_value = None
        self.source = {"source": "local", "expected_run_source": 2, "expected_frequency_source": 6}

    def rejection(self, kind="vfd.source.set", payload=None, command_id=None):
        with patch("app.services.vfd_settings.TelemetryRepository") as telemetry:
            telemetry.return_value.get_state.return_value = self.snapshot
            return settings_rejection(self.session, self.device, kind, payload or self.source, self.now, command_id)

    def test_model_whitelist_strict_words_and_no_arbitrary_address(self):
        for kind, payload in (
            ("vfd.source.set", {**self.source, "address": 2}),
            ("vfd.source.set", {**self.source, "expected_run_source": True}),
            ("vfd.parameter.set", {"code": "F5.00", "expected_raw": 4097, "value_raw": 0}),
            ("vfd.parameter.set", {"code": "F0.10", "expected_raw": 75, "value_raw": True}),
            ("vfd.parameter.set", {"code": "F0.10", "expected_raw": 75, "value_raw": 10000}),
        ):
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                DeviceCommandCreate(request_id=uuid.uuid4(), command_type=kind, payload=payload)
        with self.assertRaises(ValidationError):
            VfdSettings.model_validate({**settings_fixture(), "parameters": {"F0.10": True, "F0.11": 75}})

    def test_stopped_fresh_same_boot_and_compare_before_write(self):
        self.assertIsNone(self.rejection())
        self.snapshot.diagnostics["vfd_settings"]["run_source"] = 0
        self.assertEqual(self.rejection(), "vfd_settings_changed")
        self.snapshot.diagnostics["vfd_settings"]["run_source"] = 2
        self.snapshot.state["pump_running"] = True
        self.assertEqual(self.rejection(), "vfd_settings_stopped")
        self.snapshot.state["pump_running"] = False
        self.snapshot.last_session_id = uuid.uuid4()
        self.assertEqual(self.rejection(), "vfd_settings_unavailable")
        self.snapshot.last_session_id = self.device.last_observed_session_id
        self.snapshot.last_reported_at -= timedelta(hours=1)
        self.assertEqual(self.rejection(), "vfd_settings_unavailable")

    def test_schedules_and_unanswered_mutation_block_competing_motion(self):
        self.session.scalar.return_value = uuid.uuid4()
        self.assertEqual(self.rejection(), "vfd_settings_schedules")
        self.session.scalar.return_value = None
        pending = SimpleNamespace(id=uuid.uuid4(), command_type="vfd.parameter.set", status="published",
                                  control_sequence=11, created_at=self.now)
        self.session.scalars.return_value.all.return_value = [pending]
        self.assertEqual(self.rejection("vfd.start", {}), "vfd_settings_busy")
        self.assertEqual(self.rejection("vfd.frequency.set", {"frequency_hz": 20}), "vfd_settings_busy")
        self.assertIsNone(self.rejection("vfd.stop", {}))
        self.assertIsNone(self.rejection(command_id=pending.id))
        # Actual post-operation same-boot snapshot releases uncertainty, rather than time alone.
        pending.status = "result_unknown"
        self.snapshot.diagnostics["vfd_settings"]["command_sequence"] = 11
        self.assertIsNone(self.rejection("vfd.start", {}))
        self.snapshot.last_session_id = uuid.uuid4()
        self.assertEqual(self.rejection("vfd.start", {}), "vfd_settings_busy")

    def test_terminal_control_cannot_be_taken_over(self):
        self.snapshot.diagnostics["vfd_settings"]["run_source"] = 1
        self.assertEqual(self.rejection(), "vfd_settings_unavailable")
        self.assertEqual(self.rejection("vfd.start", {}), "vfd_local_control")

    def test_final_result_still_waits_for_post_operation_telemetry(self):
        latest = SimpleNamespace(id=uuid.uuid4(), control_sequence=11, created_at=self.now)
        self.session.scalars.return_value.first.return_value = latest
        self.assertEqual(self.rejection("vfd.start", {}), "vfd_settings_busy")
        self.snapshot.diagnostics["vfd_settings"]["command_sequence"] = 11
        self.assertIsNone(self.rejection("vfd.start", {}))

    def test_customer_cannot_write_parameter_even_with_command_permission(self):
        current = SimpleNamespace(user=SimpleNamespace(platform_role="user"))
        request = DeviceCommandCreate(request_id=uuid.uuid4(), command_type="vfd.parameter.set",
                                      payload={"code": "F0.10", "expected_raw": 75, "value_raw": 100})
        with patch("app.api.v1.commands.AccessControl"), patch("app.api.v1.commands.CommandService") as service:
            with self.assertRaises(HTTPException) as caught:
                create_command(self.device.id, request, Response(), self.session, current)
            self.assertEqual(caught.exception.status_code, 403)
            service.assert_not_called()
