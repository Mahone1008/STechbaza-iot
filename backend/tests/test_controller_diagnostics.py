"""Diagnostic input boundary: old firmware, boot identity and transport semantics."""

import copy
import unittest
import uuid

from pydantic import ValidationError

from app.schemas.telemetry import TelemetryEnvelope


def diagnostic_payload():
    return {
        "program": None, "equipment": None, "vfd_settings": None, "version": 1, "firmware_version": "0.2.2", "uptime_ms": 2**32 + 9000,
        "reset_reason": "brownout", "connection": {"transport": "wifi", "signal": {"metric": "rssi", "dbm": -67}},
        "last_stop": {"reason": "network_lost", "uptime_ms": 2**32 + 3000,
                      "requested_at": None, "confirmed": False},
    }


class ControllerDiagnosticsTests(unittest.TestCase):
    def envelope(self, diagnostics, **changes):
        return TelemetryEnvelope.model_validate({
            "schema_version": 1, "message_id": str(uuid.uuid4()), "session_id": str(uuid.uuid4()),
            "diagnostics": diagnostics, **changes,
        })

    def test_old_firmware_remains_valid(self):
        payload = TelemetryEnvelope(schema_version=1, message_id=uuid.uuid4())
        self.assertIsNone(payload.diagnostics)
        self.assertIsNone(payload.command_sequence_floor)

    def test_command_cursor_requires_strict_bounded_integer_and_current_packet_metadata(self):
        base = {"schema_version": 1, "message_id": str(uuid.uuid4()),
                "session_id": str(uuid.uuid4()), "sequence": 0,
                "sent_at": "2026-10-06T10:00:00Z", "command_sequence_floor": 83}
        for floor in (0, 83, 9007199254740991):
            self.assertEqual(TelemetryEnvelope.model_validate({**base, "command_sequence_floor": floor}).command_sequence_floor, floor)
        for floor in (-1, True, "83", 83.0, 9007199254740992):
            with self.subTest(floor=floor), self.assertRaises(ValidationError):
                TelemetryEnvelope.model_validate({**base, "command_sequence_floor": floor})
        for field in ("session_id", "sequence", "sent_at"):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                TelemetryEnvelope.model_validate({**base, field: None})

    def test_preserves_unknown_time_false_and_64_bit_uptime(self):
        expected = {**diagnostic_payload(), "program": None}
        self.assertEqual(self.envelope(expected).diagnostics.model_dump(mode="json"), {**expected, "equipment": None})
        with self.assertRaises(ValidationError):
            self.envelope(expected, session_id=None)

    def test_transport_is_not_tied_to_wifi(self):
        for connection in (
            {"transport": "cellular", "signal": {"metric": "rsrp", "dbm": -108}},
            {"transport": "ethernet", "signal": None},
            {"transport": "unknown", "signal": None},
            {"transport": "wifi", "signal": None},
        ):
            data = diagnostic_payload()
            data["connection"] = connection
            self.assertEqual(self.envelope(data).diagnostics.connection.model_dump(), connection)

    def test_rejects_invalid_measurements_and_incoherent_stop(self):
        data = diagnostic_payload()
        changes = [
            ("uptime_ms", True), ("uptime_ms", -1), ("uptime_ms", 2**53), ("uptime_ms", "100"),
            ("version", 2), ("version", True), ("reset_reason", "guess"), ("firmware_version", "<script>"),
            ("connection", {"transport": "wifi", "signal": {"metric": "rsrp", "dbm": -80}}),
            ("connection", {"transport": "ethernet", "signal": {"metric": "rssi", "dbm": -60}}),
            ("connection", {"transport": "wifi", "signal": {"metric": "rssi", "dbm": True}}),
            ("connection", {"transport": "wifi", "signal": {"metric": "rssi", "dbm": -128}}),
            ("connection", {"transport": "wifi", "signal": {"metric": "rssi", "dbm": 5}}),
            ("last_stop", {**data["last_stop"], "uptime_ms": data["uptime_ms"] + 1}),
            ("last_stop", {**data["last_stop"], "confirmed": "false"}),
            ("last_stop", {**data["last_stop"], "requested_at": "2026-10-01T10:00:00"}),
            ("extra", "not permitted"),
        ]
        for key, value in changes:
            with self.subTest(field=key, value=value), self.assertRaises(ValidationError):
                self.envelope({**copy.deepcopy(data), key: value})

    def test_clock_correction_does_not_drop_valid_telemetry(self):
        data = diagnostic_payload()
        data["last_stop"]["requested_at"] = "2026-10-01T10:01:00Z"
        # UTC may be corrected backwards; monotonic uptime remains authoritative.
        self.envelope(data, sent_at="2026-10-01T10:00:00Z")
