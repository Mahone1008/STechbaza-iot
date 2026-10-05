"""Справжній TLS/ACL/rotate/revoke тест із власними тимчасовими identities."""

import os
import secrets
import threading
import uuid

import paho.mqtt.client as mqtt

from app.services.controller_broker import ControllerBroker


class Connection:
    def __init__(self, uid, password, *, admin=False):
        self.connected, self.disconnected, self.message = (
            threading.Event(),
            threading.Event(),
            threading.Event(),
        )
        self.accepted = False
        self.messages = []
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"check-{uuid.uuid4().hex}" if admin else f"{uid}-esp32",
        )
        self.client.username_pw_set(uid, password)
        self.client.tls_set(ca_certs=os.environ["CONTROLLER_TEST_CA"])
        self.client.on_connect = self._connected
        self.client.on_disconnect = lambda *args: self.disconnected.set()
        self.client.on_message = self._message
        self.client.connect(
            os.environ["CONTROLLER_MQTT_PUBLIC_HOST"],
            int(os.getenv("CONTROLLER_MQTT_PUBLIC_PORT", "8883")),
            15,
        )
        self.client.loop_start()
        if not self.connected.wait(5):
            self.close()
            raise RuntimeError("TLS connection timed out")

    def _connected(self, client, userdata, flags, reason, properties):
        self.accepted = not reason.is_failure
        self.connected.set()

    def _message(self, client, userdata, message):
        self.messages.append((message.topic, bytes(message.payload)))
        self.message.set()

    def close(self):
        self.client.disconnect()
        self.client.loop_stop()


def main():
    if os.getenv("TECHBAZA_CONTROLLER_GATEWAY_TEST") != "1":
        raise SystemExit("Set TECHBAZA_CONTROLLER_GATEWAY_TEST=1 for the isolated gateway")
    uid = f"TEST-GATEWAY-{uuid.uuid4().hex}"
    first, second = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    connections = []
    with ControllerBroker() as broker:
        try:
            broker.apply(uid, first, False)
            monitor = Connection(
                "enrollment-admin", os.environ["CONTROLLER_BROKER_ADMIN_PASSWORD"], admin=True
            )
            connections.append(monitor)
            assert monitor.accepted, "observer authentication"
            subscribed = threading.Event()
            monitor.client.on_subscribe = lambda *args: subscribed.set()
            monitor.client.subscribe("techbaza/devices/#", 1)
            assert subscribed.wait(5), "observer subscription"
            device = Connection(uid, first)
            connections.append(device)
            assert device.accepted, "device authentication"
            topic = f"techbaza/devices/{uid}"
            device.client.publish(topic + "/telemetry", "allowed", qos=1).wait_for_publish(5)
            assert monitor.message.wait(5), "own telemetry missing"
            assert monitor.messages == [(topic + "/telemetry", b"allowed")]
            monitor.message.clear()
            device.client.publish(topic + "/commands", "forbidden", qos=1).wait_for_publish(5)
            device.client.publish(
                "techbaza/devices/OTHER/telemetry", "forbidden", qos=1
            ).wait_for_publish(5)
            assert not monitor.message.wait(0.5), "cross-topic publish escaped ACL"
            codes = []
            subscribed.clear()
            device.client.on_subscribe = lambda client, userdata, mid, reasons, properties: (
                codes.extend(reasons),
                subscribed.set(),
            )
            device.client.subscribe(topic + "/commands", 1)
            assert subscribed.wait(5) and codes and all(not code.is_failure for code in codes), (
                "own commands subscription rejected"
            )
            subscribed.clear()
            codes.clear()
            device.client.subscribe("techbaza/devices/OTHER/commands", 1)
            assert subscribed.wait(5) and all(code.is_failure for code in codes), (
                "foreign commands subscription allowed"
            )
            broker.apply(uid, second, False)
            assert device.disconnected.wait(5), "rotation did not disconnect active session"
            device.close()
            old = Connection(uid, first)
            connections.append(old)
            assert not old.accepted, "old credential still accepted"
            fresh = Connection(uid, second)
            connections.append(fresh)
            assert fresh.accepted, "rotated credential rejected"
            broker.apply(uid, "", True)
            assert fresh.disconnected.wait(5), "revocation did not disconnect active session"
            fresh.close()
            revoked = Connection(uid, second)
            connections.append(revoked)
            assert not revoked.accepted, "revoked credential still accepted"
            print("PASS: TLS, per-device ACL, rotation, active-session disconnect and revocation")
        finally:
            for connection in connections:
                connection.close()
            broker.request("deleteClient", username=uid)
            broker.request("deleteRole", rolename=f"device-{uid}")


if __name__ == "__main__":
    main()
