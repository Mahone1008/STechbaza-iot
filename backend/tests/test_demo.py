import json
import os
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

from app.demo.catalog import DEVICES, LIVE_DEVICES, manifest, require_demo
from app.demo.config import SECRET_KEYS, create_config
from app.demo.seed import assert_database
from app.demo.state import DemoState
from app.schemas.heartbeat import HeartbeatEnvelope
from app.schemas.telemetry import TelemetryEnvelope
from app.services.telemetry_policy import validate_telemetry_capabilities


class DemoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "state.sqlite3"
        self.state = DemoState(self.path)
        self.addCleanup(lambda: self.state.close())
        self.now = datetime.now(timezone.utc)

    def command(self, kind="vfd.start", payload=None, **updates):
        return {"schema_version": 1, "command_id": str(uuid.uuid4()), "request_id": str(uuid.uuid4()),
                "command_type": kind, "payload": payload or {}, "ttl_seconds": 30,
                "issued_at": (self.now - timedelta(seconds=1)).isoformat(),
                "expires_at": (self.now + timedelta(seconds=29)).isoformat(), **updates}

    def test_opt_in_and_database_name_are_both_required(self):
        with patch.dict(os.environ, {"TECHBAZA_DEMO_MODE": "0"}):
            with self.assertRaises(RuntimeError):
                require_demo()
        database = Mock()
        with patch.dict(os.environ, {"TECHBAZA_DEMO_MODE": "1"}):
            database.scalar.return_value = "techbaza"
            with self.assertRaises(RuntimeError):
                assert_database(database)
            database.scalar.return_value = "techbaza_demo"
            assert_database(database)

    def test_generated_secrets_are_unique_and_never_overwritten(self):
        path = Path(self.temp.name) / ".env.demo"
        create_config(path)
        initial = path.read_bytes()
        values = dict(line.split("=") for line in path.read_text().splitlines())
        self.assertEqual(set(values), set(SECRET_KEYS))
        self.assertEqual(len(set(values.values())), len(values))
        self.assertTrue(all(len(value) == 64 for value in values.values()))
        with self.assertRaises(FileExistsError):
            create_config(path)
        self.assertEqual(initial, path.read_bytes())

    def test_catalog_identity_and_telemetry_follow_capabilities(self):
        catalog = manifest()
        self.assertEqual(len({item["id"] for item in catalog["devices"].values()}), 6)
        self.assertTrue(all(item["uid"].startswith("TB-DEMO-") for item in catalog["devices"].values()))
        for key in LIVE_DEVICES:
            HeartbeatEnvelope.model_validate(self.state.envelope(key))
            payload = self.state.telemetry(key)
            if payload is None:
                self.assertEqual(key, "stale")
                continue
            envelope = TelemetryEnvelope.model_validate(payload)
            decision = validate_telemetry_capabilities(value_keys=set(envelope.values), state_keys=set(envelope.state),
                                                       enabled_capabilities=set(DEVICES[key]["caps"]))
            self.assertTrue(decision.allowed)

    def test_duplicate_command_does_not_execute_twice_and_replays_same_response(self):
        command = self.command()
        self.assertTrue(self.state.command("pump", command))
        first = self.state.pending()[0]
        self.state.delivered(first["id"])
        self.assertEqual(self.state.pending(), [])
        self.assertFalse(self.state.command("pump", command))
        replay = self.state.pending()[0]
        self.assertEqual((first["ack"], first["result"]), (replay["ack"], replay["result"]))
        self.assertEqual(self.state.device("pump")["executions"], 1)

    def test_restart_preserves_state_outbox_and_deduplication(self):
        command = self.command("vfd.frequency.set", {"frequency_hz": 37})
        self.state.command("pump", command)
        original = self.state.pending()[0]
        old_session = self.state.device("pump")["session"]
        self.state.close()
        self.state = DemoState(self.path)
        self.state.boot()
        self.assertNotEqual(self.state.device("pump")["session"], old_session)
        self.assertEqual(self.state.device("pump")["frequency"], 37)
        self.assertFalse(self.state.command("pump", command, now=self.now + timedelta(days=1)))
        self.assertEqual(self.state.pending()[0]["result"], original["result"])
        self.assertEqual(self.state.device("pump")["executions"], 1)

    def test_same_id_with_changed_payload_is_rejected_without_state_change(self):
        command = self.command("vfd.frequency.set", {"frequency_hz": 37})
        self.state.command("pump", command)
        with self.assertRaises(ValueError):
            self.state.command("pump", {**command, "payload": {"frequency_hz": 99}})
        self.assertEqual(self.state.device("pump")["frequency"], 37)
        self.assertEqual(self.state.device("pump")["executions"], 1)

    def test_expired_future_and_naive_commands_do_not_execute(self):
        cases = [self.command(expires_at=(self.now - timedelta(seconds=1)).isoformat()),
                 self.command(issued_at=(self.now + timedelta(minutes=1)).isoformat()),
                 self.command(expires_at=self.now.replace(tzinfo=None).isoformat())]
        for command in cases:
            with self.assertRaises(ValueError):
                self.state.command("pump", command, now=self.now)
        self.assertEqual(self.state.device("pump")["executions"], 0)
        self.assertEqual(self.state.pending(), [])

    def test_unknown_device_command_and_invalid_frequency_are_rejected(self):
        for key, command in [("pressure", self.command()), ("pump", self.command("other.command")),
                             ("pump", self.command("vfd.frequency.set", {"frequency_hz": True})),
                             ("pump", self.command("vfd.frequency.set", {"frequency_hz": 101})),
                             ("pump", self.command("vfd.start", {"extra": 1}))]:
            with self.assertRaises(ValueError):
                self.state.command(key, command)
        self.assertEqual(self.state.device("pump")["executions"], 0)

    def test_fault_rejects_start_but_allows_stop(self):
        self.state.command("pump", self.command())
        self.state.mode("pump", "fault")
        self.state.command("pump", self.command())
        result = json.loads(self.state.pending()[-1]["result"])
        self.assertEqual((result["status"], result["error_code"]), ("failed", "demo_vfd_fault"))
        self.assertEqual(self.state.device("pump")["running"], 0)
        self.state.command("pump", self.command("vfd.stop"))
        self.assertEqual(json.loads(self.state.pending()[-1]["result"])["status"], "succeeded")

    def test_gap_offline_and_alarm_scenarios_are_distinct(self):
        self.state.mode("pressure", "gap")
        self.assertEqual(self.state.telemetry("pressure")["values"], {})
        self.state.mode("pressure", "alarm")
        self.assertLess(self.state.telemetry("pressure")["values"]["pressure.bar"], 1)
        self.state.mode("pressure", "offline")
        self.assertIsNone(self.state.telemetry("pressure"))
        self.state.mode("pump", "offline")
        with self.assertRaises(ValueError):
            self.state.command("pump", self.command())
        self.assertEqual(self.state.pending(), [])

    def test_scenarios_do_not_create_unregistered_devices_or_modules(self):
        with self.assertRaises(ValueError):
            self.state.mode("real-device", "normal")
        with self.assertRaises(ValueError):
            self.state.mode("pressure", "fault")
        with self.assertRaises(ValueError):
            self.state.mode("new", "normal")

    def test_sequence_increases_and_boot_changes_session(self):
        first, second = self.state.envelope("pump"), self.state.envelope("pump")
        self.assertEqual(first["session_id"], second["session_id"])
        self.assertGreater(second["sequence"], first["sequence"])
        self.state.boot()
        third = self.state.envelope("pump")
        self.assertNotEqual(second["session_id"], third["session_id"])
        self.assertEqual(third["sequence"], 1)
