"""H-01: справжні PostgreSQL/Mosquitto, лише власні fixtures та MQTT topics."""

import json
import os
import threading
import unittest
import uuid
from unittest.mock import patch

import paho.mqtt.client as paho
from sqlalchemy import delete, select

from app import mqtt_client
from app.db import SessionLocal
from app.models.capability import Capability, DeviceCapability
from app.models.device import Device
from app.models.event_alarm import DeviceAlarm
from app.models.organization import Organization
from app.models.site import Site
from app.models.telemetry import DeviceState, TelemetryMessage
from app.mqtt_payload import MAX_PAYLOAD_BYTES


@unittest.skipUnless(
    os.getenv("TECHBAZA_RUN_DB_TESTS") == "1" and os.getenv("TECHBAZA_RUN_MQTT_TESTS") == "1",
    "Requires PostgreSQL and MQTT opt-in",
)
class MQTTPayloadPostgresTests(unittest.TestCase):
    def setUp(self):
        self.org_id, self.site_id, self.bad_id, self.good_id = [uuid.uuid4() for _ in range(4)]
        self.bad_uid, self.good_uid = f"TB-H01-{self.bad_id.hex}", f"TB-H01-{self.good_id.hex}"
        self.owned_capability = None
        self.addCleanup(self.cleanup_data)
        with SessionLocal() as session:
            session.add(Organization(id=self.org_id, name="H-01 test", slug=f"h01-{self.org_id.hex}"))
            session.flush()
            session.add(Site(id=self.site_id, organization_id=self.org_id, name="H-01", code="h01"))
            session.flush()
            for device_id, uid in ((self.bad_id, self.bad_uid), (self.good_id, self.good_uid)):
                session.add(Device(id=device_id, site_id=self.site_id, uid=uid, name="H-01 test"))
            capability = session.scalar(select(Capability).where(Capability.code == "pressure.read"))
            if capability is None:
                capability = Capability(id=uuid.uuid4(), code="pressure.read", name="Pressure")
                self.owned_capability = capability.id
                session.add(capability)
            session.flush()
            for device_id in (self.bad_id, self.good_id):
                session.add(DeviceCapability(device_id=device_id, capability_id=capability.id,
                    is_enabled=True, config={"alarm_rules": [{
                        "rule_key": "h01.pressure.low", "alarm_type": "pressure.low",
                        "metric": "pressure.bar", "kind": "low", "threshold": 1,
                        "clear_threshold": 2, "debounce_samples": 1,
                        "severity": "warning", "title": "H-01 pressure",
                    }]}))
            session.commit()

    def cleanup_data(self):
        with SessionLocal() as session:
            session.execute(delete(Organization).where(Organization.id == self.org_id))
            if self.owned_capability:
                session.execute(delete(Capability).where(Capability.id == self.owned_capability))
            session.commit()

    def test_bad_device_packets_do_not_block_other_device_or_reappear_after_reconnect(self):
        ready, received = threading.Event(), threading.Event()
        connections, deliveries, acked = [], [], []
        boot = uuid.uuid4()
        first_id, second_id = uuid.uuid4(), uuid.uuid4()
        client_id = f"h01-{self.org_id.hex}"
        topics = [f"techbaza/devices/{self.bad_uid}/{suffix}" for suffix in
                  ("telemetry", "heartbeat", "commands/ack", "commands/result")]
        good_topic = f"techbaza/devices/{self.good_uid}/telemetry"
        receiver = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id=client_id,
                               clean_session=False, manual_ack=True)
        publisher = paho.Client(paho.CallbackAPIVersion.VERSION2)

        def on_connect(client, userdata, flags, reason_code, properties):
            if reason_code == 0:
                connections.append(1)
                client.subscribe([(topic, 1) for topic in topics + [good_topic]])

        def on_message(client, userdata, message):
            deliveries.append((message.topic, message.payload))
            mqtt_client._on_message(client, userdata, message)
            if message.topic == good_topic:
                received.set()

        original_ack = receiver.ack

        def record_ack(mid, qos):
            acked.append((mid, qos))
            return original_ack(mid, qos)

        receiver.on_connect = on_connect
        receiver.on_subscribe = lambda *args: ready.set()
        receiver.on_message = on_message
        receiver.on_disconnect = mqtt_client._on_disconnect

        def publish(topic, payload):
            info = publisher.publish(topic, payload, qos=1)
            info.wait_for_publish(timeout=5)
            self.assertTrue(info.is_published(), "Publisher timed out")

        def valid(message_id, sequence):
            return json.dumps({"schema_version": 1, "message_id": str(message_id),
                "session_id": str(boot), "sequence": sequence,
                "values": {"pressure.bar": 0.5}, "state": {}})

        try:
            with patch.object(mqtt_client, "client", receiver), \
                 patch.object(receiver, "ack", side_effect=record_ack):
                try:
                    mqtt_client.start_mqtt()
                    self.assertTrue(ready.wait(5), "Receiver subscription timed out")
                    publisher.connect(mqtt_client.MQTT_HOST, mqtt_client.MQTT_PORT)
                    publisher.loop_start()
                    with self.assertLogs("app.mqtt_client", level="WARNING"):
                        # Кожна ingress-тема отримує poison number.
                        for topic in topics:
                            publish(topic, '{"value":' + '9' * 5000 + '}')
                        invalid_telemetry = json.loads(valid(uuid.uuid4(), 1))
                        invalid_telemetry["values"]["pressure.bar"] = 10**400
                        for payload in (
                            json.dumps(invalid_telemetry), b'\xff', b'x' * (MAX_PAYLOAD_BYTES + 1),
                            '{"v":' + '[' * 50 + '0' + ']' * 50 + '}',
                        ):
                            publish(topics[0], payload)
                        publish(good_topic, valid(first_id, 1))
                        self.assertTrue(received.wait(8), "Valid packet behind poison packets was blocked")

                    self.assertEqual(len(connections), 1, "Poison packet forced a reconnect")
                    self.assertEqual(len(deliveries), 9)
                    self.assertEqual(len(acked), 9)
                    with SessionLocal() as session:
                        self.assertIsNotNone(session.scalar(select(TelemetryMessage.id)
                            .where(TelemetryMessage.message_id == first_id)))
                        self.assertIsNone(session.scalar(select(TelemetryMessage.id)
                            .where(TelemetryMessage.device_id == self.bad_id)))
                        self.assertIsNone(session.get(DeviceState, self.bad_id))
                        alarm = session.scalar(select(DeviceAlarm).where(
                            DeviceAlarm.device_id == self.good_id, DeviceAlarm.alarm_key == "h01.pressure.low"))
                        self.assertIsNotNone(alarm)
                        self.assertEqual(alarm.state, "active")

                    # Той самий persistent client ID: відхилені packets не повертаються.
                    mqtt_client.stop_mqtt()
                    ready.clear()
                    received.clear()
                    mqtt_client.start_mqtt()
                    self.assertTrue(ready.wait(5), "Reconnect subscription timed out")
                    publish(good_topic, valid(second_id, 2))
                    self.assertTrue(received.wait(8), "Valid packet after reconnect was blocked")
                    self.assertEqual(len(connections), 2)
                    self.assertEqual(len(deliveries), 10)
                    self.assertEqual(len(acked), 10)
                    with SessionLocal() as session:
                        self.assertIsNotNone(session.scalar(select(TelemetryMessage.id)
                            .where(TelemetryMessage.message_id == second_id)))
                finally:
                    mqtt_client.stop_mqtt()
        finally:
            publisher.disconnect()
            publisher.loop_stop()
            # Видаляється лише persistent MQTT session цього випадкового тесту.
            cleanup = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id=client_id,
                                  clean_session=True)
            cleanup.connect(mqtt_client.MQTT_HOST, mqtt_client.MQTT_PORT)
            cleanup.loop(timeout=0.2)
            cleanup.disconnect()


if __name__ == "__main__":
    unittest.main()
