"""H-01: poison packets відхиляються, справжній збій processing зберігає retry."""

import json
import unittest
import uuid
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch

from pydantic import ValidationError

from app import mqtt_client, mqtt_ingress
from app.mqtt_payload import (
    MAX_JSON_DEPTH, MAX_JSON_NODES, MAX_PAYLOAD_BYTES, MAX_STRING_LENGTH,
    InvalidMQTTPayload, decode_payload, load_json_object,
)
from app.schemas.heartbeat import HeartbeatEnvelope
from app.schemas.telemetry import TelemetryEnvelope
from app.services.alarm_rule_engine import TelemetryAlarmRuleEngine
from app.services.telemetry_quality import numeric_value


class PayloadContractTests(unittest.TestCase):
    def reject(self, text, reason):
        with self.assertRaises(InvalidMQTTPayload) as caught:
            load_json_object(text)
        self.assertEqual(caught.exception.reason, reason)

    def test_numeric_rule_engine_and_read_model_agree(self):
        for value, expected in (
            (0, 0.0), (2.5, 2.5), (-1, -1.0), (10**400, None),
            (float("nan"), None), (float("inf"), None), (True, None),
            (None, None), ("2.5", None), ({}, None),
        ):
            with self.subTest(value=type(value).__name__, expected=expected):
                self.assertEqual(TelemetryAlarmRuleEngine._numeric_value(value), expected)
                self.assertEqual(numeric_value(value), expected)

    def test_valid_json_preserves_values_unicode_and_escaped_brackets(self):
        expected = {"zero": 0, "negative": -2.5, "null": None, "flag": False,
                    "text": 'Тиск: [ { \\" ] }', "nested": {"emoji": "\U0001f4a7"}}
        self.assertEqual(load_json_object(json.dumps(expected)), expected)

    def test_packet_byte_limit_accepts_boundary_rejects_above(self):
        text = "{}" + " " * (MAX_PAYLOAD_BYTES - 2)
        self.assertEqual(load_json_object(text), {})
        self.assertEqual(decode_payload(text.encode()), text)
        self.reject(text + " ", "payload_too_large")
        with self.assertRaises(InvalidMQTTPayload) as caught:
            decode_payload((text + " ").encode())
        self.assertEqual(caught.exception.reason, "payload_too_large")
        # Ліміт у байтах, не лише у Python characters.
        self.reject(json.dumps({"x": "ї" * (MAX_PAYLOAD_BYTES // 2)}, ensure_ascii=False),
                    "payload_too_large")

    def test_depth_boundary_and_brackets_inside_strings(self):
        text = '{"v":' + "[" * (MAX_JSON_DEPTH - 1) + "0" + "]" * (MAX_JSON_DEPTH - 1) + "}"
        self.assertIsInstance(load_json_object(text), dict)
        self.reject('{"v":' + "[" * MAX_JSON_DEPTH + "0" + "]" * MAX_JSON_DEPTH + "}",
                    "json_too_deep")
        self.assertEqual(load_json_object(json.dumps({"v": "[" * 200}))["v"], "[" * 200)

    def test_node_and_string_limits(self):
        self.assertEqual(len(load_json_object(json.dumps({"v": [0] * (MAX_JSON_NODES - 3)}))["v"]),
                         MAX_JSON_NODES - 3)
        self.reject(json.dumps({"v": [0] * (MAX_JSON_NODES - 2)}), "too_many_json_nodes")
        self.assertEqual(load_json_object(json.dumps({"v": "x" * MAX_STRING_LENGTH}))["v"],
                         "x" * MAX_STRING_LENGTH)
        self.reject(json.dumps({"v": "x" * (MAX_STRING_LENGTH + 1)}), "string_too_long")

    def test_invalid_numbers_and_ambiguous_objects_rejected(self):
        for text, reason in (
            ('{"v":NaN}', "nonfinite_number"), ('{"v":Infinity}', "nonfinite_number"),
            ('{"v":-Infinity}', "nonfinite_number"), ('{"v":1e400}', "number_out_of_range"),
            ('{"v":' + str(10**400) + '}', "number_out_of_range"),
            ('{"v":1,"v":2}', "duplicate_key"), ('{"v":{"x":1,"x":2}}', "duplicate_key"),
            ('[]', "object_required"), ('null', "object_required"), ('{', "invalid_json"),
        ):
            with self.subTest(reason=reason):
                self.reject(text, reason)
        # Не залежить від налаштування Python int_max_str_digits.
        with self.assertRaises(InvalidMQTTPayload):
            load_json_object('{"v":' + '9' * 5000 + '}')

    def test_invalid_unicode_and_nul_rejected_in_keys_and_values(self):
        for value in ("\x00", "\ud800"):
            for data in ({"v": value}, {value: 1}):
                with self.subTest(data=repr(data)):
                    self.reject(json.dumps(data), "invalid_json_string")
        with self.assertRaises(InvalidMQTTPayload) as caught:
            decode_payload(b'\xff')
        self.assertEqual(caught.exception.reason, "invalid_utf8")

    def test_sequence_matches_database_bigint_range(self):
        for schema in (HeartbeatEnvelope, TelemetryEnvelope):
            base = {"schema_version": 1, "message_id": str(uuid.uuid4())}
            self.assertEqual(schema(**base, sequence=2**63 - 1).sequence, 2**63 - 1)
            for sequence in (-1, 2**63):
                with self.subTest(schema=schema, sequence=sequence), self.assertRaises(ValidationError):
                    schema(**base, sequence=sequence)


class MQTTIngressTests(unittest.TestCase):
    def message(self, payload, suffix="telemetry", mid=7, qos=1):
        return NS(payload=payload, topic=f"techbaza/devices/TB-H01/{suffix}",
                  mid=mid, qos=qos, retain=False)

    def valid_telemetry(self):
        return json.dumps({"schema_version": 1, "message_id": str(uuid.uuid4()),
                           "session_id": str(uuid.uuid4()), "sequence": 1,
                           "values": {"pressure.bar": 2.5}, "state": {}}).encode()

    def test_bad_packets_ack_without_database_for_all_ingress_topics(self):
        invalid = (
            b'\xff', b'x' * (MAX_PAYLOAD_BYTES + 1), b'{', b'[]', b'{}',
            b'{"v":NaN}', b'{"v":1e400}', b'{"v":' + b'9' * 5000 + b'}',
            b'{"v":' + str(10**400).encode() + b'}', b'{"v":1,"v":2}',
            json.dumps({"v": "\ud800"}).encode(), json.dumps({"v": "\x00"}).encode(),
            ('{"v":' + '[' * 50 + '0' + ']' * 50 + '}').encode(),
        )
        for suffix in ("telemetry", "heartbeat", "commands/ack", "commands/result"):
            for payload in invalid:
                with self.subTest(suffix=suffix, size=len(payload)), \
                     patch.object(mqtt_ingress, "SessionLocal") as sessions, \
                     self.assertLogs("app.mqtt_client", level="WARNING"):
                    client = Mock()
                    mqtt_client._on_message(client, None, self.message(payload, suffix))
                    client.ack.assert_called_once_with(7, 1)
                    sessions.assert_not_called()

    def test_packet_limit_is_checked_before_decoding(self):
        class NeverDecode(bytes):
            def decode(self, *args, **kwargs):
                raise AssertionError("Oversized payload must not be decoded")
        client = Mock()
        with self.assertLogs("app.mqtt_client", level="WARNING"):
            mqtt_client._on_message(client, None, self.message(NeverDecode(b'x' * (MAX_PAYLOAD_BYTES + 1))))
        client.ack.assert_called_once_with(7, 1)
        self.assertIsNone(mqtt_client.last_mqtt_message()["payload"])

    def test_valid_packet_after_rejection_is_stored_then_acknowledged(self):
        order = []
        client = Mock()
        client.ack.side_effect = lambda mid, qos: order.append(f"ack:{mid}")
        def ingest(**kwargs):
            order.append("committed")
            return NS(duplicate=False, telemetry_id=uuid.uuid4(), state_updated=True, ordering_reason="new")
        with patch.object(mqtt_ingress, "SessionLocal"), \
             patch.object(mqtt_ingress, "TelemetryService") as service:
            service.return_value.ingest.side_effect = ingest
            with self.assertLogs("app.mqtt_client", level="WARNING"):
                mqtt_client._on_message(client, None, self.message(b'{"v":1e400}', mid=7))
            mqtt_client._on_message(client, None, self.message(self.valid_telemetry(), mid=8))
        self.assertEqual(order, ["ack:7", "committed", "ack:8"])
        self.assertEqual(mqtt_client.last_ingestion_result()["status"], "stored")

    def test_service_valueerror_is_not_misclassified_as_invalid_json(self):
        client = Mock()
        with patch.object(mqtt_ingress, "SessionLocal"), \
             patch.object(mqtt_ingress, "TelemetryService") as service:
            service.return_value.ingest.side_effect = ValueError("Unexpected service failure")
            with self.assertLogs("app.mqtt_client", level="ERROR"), \
                 self.assertRaises(mqtt_client.MQTTProcessingError):
                mqtt_client._on_message(client, None, self.message(self.valid_telemetry()))
        client.ack.assert_not_called()

    def test_rejection_log_omits_payload_and_diagnostics_count_reason(self):
        before = mqtt_client.mqtt_status()["payload_rejections"].get("invalid_envelope", 0)
        secret = "DO-NOT-LOG-DEVICE-CONTENT"
        with self.assertLogs("app.mqtt_client", level="WARNING") as logs:
            mqtt_client._on_message(Mock(), None, self.message(json.dumps({"private": secret}).encode()))
        self.assertNotIn(secret, " ".join(logs.output))
        self.assertEqual(mqtt_client.mqtt_status()["payload_rejections"]["invalid_envelope"], before + 1)
        self.assertEqual(mqtt_client.last_ingestion_result()["payload_error"], "invalid_envelope")

    def test_raw_diagnostic_preview_is_bounded(self):
        text = "x" * 4096
        mqtt_client._on_message(Mock(), None, self.message(text.encode(), suffix="unknown", qos=0))
        result = mqtt_client.last_mqtt_message()
        self.assertEqual(len(result["payload"]), 2048)
        self.assertEqual(result["payload_bytes"], 4096)
        self.assertTrue(result["payload_truncated"])


if __name__ == "__main__":
    unittest.main()
