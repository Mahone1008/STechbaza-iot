"""Перевірка reconnect/redelivery по TCP з мінімальним тестовим MQTT peer.

Peer моделює persistent session брокера; перевірку з Mosquitto виконують окремо.
"""

import socket
import struct
import threading
import unittest
from unittest.mock import patch

import paho.mqtt.client as paho

from app import mqtt_client


def read_exact(connection, size):
    result = bytearray()
    while len(result) < size:
        part = connection.recv(size-len(result))
        if not part:
            raise EOFError
        result.extend(part)
    return bytes(result)


def read_packet(connection):
    command = read_exact(connection, 1)[0]
    size, multiplier = 0, 1
    while True:
        value = read_exact(connection, 1)[0]
        size += (value & 127) * multiplier
        if value < 128:
            return command, read_exact(connection, size)
        multiplier *= 128


class RedeliveryTest(unittest.TestCase):
    def test_failed_processing_reconnects_and_receives_same_message(self):
        errors, receipts = [], []
        finished = threading.Event()
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(2)
        listener.settimeout(8)

        def broker():
            try:
                for attempt in range(2):
                    connection, _ = listener.accept()
                    with connection:
                        connection.settimeout(5)
                        kind, packet = read_packet(connection)
                        self.assertEqual(kind, 0x10)
                        self.assertEqual(packet[7] & 2, 0, "clean_session must stay false")
                        connection.sendall(bytes([0x20, 2, attempt, 0]))
                        for _ in range(5):
                            kind, packet = read_packet(connection)
                            self.assertEqual(kind, 0x82)
                            connection.sendall(b"\x90\x03"+packet[:2]+b"\x01")
                        topic = b"techbaza/devices/TB-REDELIVERY/telemetry"
                        packet = struct.pack("!H",len(topic))+topic+b"\x00\x4d{}"
                        connection.sendall(bytes([0x32 if attempt == 0 else 0x3a, len(packet)])+packet)
                        if attempt == 0:
                            # Після збою клієнт має reconnect без PUBACK для цього packet.
                            with self.assertRaises(EOFError):
                                read_packet(connection)
                        else:
                            kind, packet = read_packet(connection)
                            self.assertEqual((kind, packet), (0x40, b"\x00\x4d"))
                            receipts.append(77)
            except BaseException as exc:
                errors.append(exc)
            finally:
                finished.set()

        thread = threading.Thread(target=broker, daemon=True)
        thread.start()
        client = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id="hardening-test",
                             clean_session=False, manual_ack=True)
        client.on_connect = mqtt_client._on_connect
        client.on_disconnect = mqtt_client._on_disconnect
        client.on_message = mqtt_client._on_message
        try:
            with patch.object(mqtt_client, "client", client), \
                 patch.object(mqtt_client, "MQTT_HOST", "127.0.0.1"), \
                 patch.object(mqtt_client, "MQTT_PORT", listener.getsockname()[1]), \
                 patch.object(mqtt_client, "_handle_telemetry", side_effect=[False, True]) as handler:
                try:
                    with self.assertLogs("app.mqtt_client", level="ERROR"):
                        mqtt_client.start_mqtt()
                        self.assertTrue(finished.wait(8), "network test timed out")
                    self.assertEqual(handler.call_count, 2)
                    self.assertEqual(receipts, [77])
                    if errors:
                        raise errors[0]
                finally:
                    mqtt_client.stop_mqtt()
        finally:
            listener.close()
            thread.join(timeout=1)


if __name__ == "__main__":
    unittest.main()
