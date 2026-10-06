"""Validate native firmware JSON with the backend's actual MQTT contracts."""

import sys
from datetime import datetime, timezone
from pathlib import Path

from app.mqtt_payload import load_json_object
from app.schemas.command_ack import CommandAckEnvelope
from app.schemas.command_result import CommandResultEnvelope
from app.schemas.telemetry import TelemetryEnvelope

models = {"telemetry": TelemetryEnvelope, "ack": CommandAckEnvelope, "result": CommandResultEnvelope}
expected_labels = {
    "telemetry", "telemetry_no_clock", "telemetry_after2038",
    "ack", "ack_no_clock", "result", "result_no_clock",
}
seen = set()
for line in Path(sys.argv[1]).read_text().splitlines():
    label, raw = line.split("\t", 1)
    assert label in expected_labels and label not in seen
    seen.add(label)
    body = load_json_object(raw)
    assert "sent_at" in body
    envelope = models[label.split("_", 1)[0]].model_validate(body)
    if label.endswith("_no_clock"):
        assert envelope.sent_at is None
        assert "command_sequence_floor" not in body
    else:
        expected = datetime(2040, 1, 1, tzinfo=timezone.utc) if label.endswith("_after2038") else datetime(
            2026, 10, 6, 12, tzinfo=timezone.utc)
        assert envelope.sent_at == expected
        if label.startswith("telemetry"):
            assert envelope.command_sequence_floor == 83
            assert envelope.sequence == 7
assert seen == expected_labels
print("PASS: firmware UTC, no-clock and post-2038 telemetry/ACK/result match backend MQTT contracts")
