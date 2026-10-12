from datetime import datetime, timedelta, timezone
import json
import unittest
import uuid

from app.bench.v4_probe import physical_sample


class PhysicalProbeTests(unittest.TestCase):
    def sample(self):
        self.now = datetime.now(timezone.utc)
        return {"schema_version": 1, "message_id": str(uuid.uuid4()), "session_id": str(uuid.uuid4()),
                "sequence": 1, "sent_at": self.now.isoformat(),
                "values": {"vfd.set_frequency_hz": 40, "vfd.frequency_hz": 0,
                           "vfd.current_a": 0, "vfd.voltage_v": 0},
                "state": {"vfd_link": True, "pump_running": False, "vfd_fault_code": 0, "control_armed": False},
                "diagnostics": {"version": 1, "firmware_version": "0.9.0", "uptime_ms": 3000,
                                "reset_reason": "power_on", "connection": {"transport": "cellular"}}}

    def test_real_zero_readings_are_valid(self):
        sample = self.sample()
        parsed = physical_sample(json.dumps(sample), now=self.now, read_only=True)
        self.assertEqual(parsed.values["vfd.current_a"], 0)

    def test_missing_or_stale_data_cannot_pass(self):
        for mutation in (lambda x: x["values"].pop("vfd.current_a"),
                         lambda x: x["state"].update(vfd_link=False),
                         lambda x: x["state"].update(control_armed=True),
                         lambda x: x["values"].update({"vfd.current_a": float("nan")}),
                         lambda x: x["diagnostics"]["connection"].update(transport="wifi"),
                         lambda x: x.update(sent_at=(self.now - timedelta(minutes=2)).isoformat())):
            sample = self.sample()
            mutation(sample)
            with self.assertRaises(ValueError):
                physical_sample(json.dumps(sample), now=self.now, read_only=True)


if __name__ == "__main__":
    unittest.main()
