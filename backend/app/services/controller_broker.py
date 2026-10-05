"""Підтверджувані зміни Mosquitto Dynamic Security; секрети не журналюються."""

import json
import os
import threading
import uuid

import paho.mqtt.client as mqtt


class BrokerUnavailable(Exception):
    pass


def configured() -> bool:
    return bool(os.getenv("CONTROLLER_BROKER_ADMIN_PASSWORD"))


class ControllerBroker:
    def __init__(self):
        if not configured():
            raise BrokerUnavailable("Шлюз контролерів ще не налаштовано")
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, client_id=f"enroll-{uuid.uuid4().hex}"
        )
        self.client.username_pw_set(
            "enrollment-admin", os.environ["CONTROLLER_BROKER_ADMIN_PASSWORD"]
        )
        ca = os.getenv("CONTROLLER_BROKER_ADMIN_CA")
        if ca:
            self.client.tls_set(ca_certs=ca)
        self.ready, self.received = threading.Event(), threading.Event()
        self.response = None
        self.correlation = ""
        self.client.on_connect = self._connected
        self.client.on_subscribe = lambda *args: self.ready.set()
        self.client.on_message = self._message

    def _connected(self, client, userdata, flags, reason, properties):
        if not reason.is_failure:
            client.subscribe("$CONTROL/dynamic-security/v1/response", qos=1)

    def _message(self, client, userdata, message):
        try:
            data = json.loads(message.payload)
            for item in data.get("responses", []):
                if item.get("correlationData") == self.correlation:
                    self.response = item
                    self.received.set()
        except (ValueError, AttributeError, TypeError):
            return

    def __enter__(self):
        try:
            self.client.connect(
                os.getenv("CONTROLLER_BROKER_ADMIN_HOST", "controller-gateway"),
                int(os.getenv("CONTROLLER_BROKER_ADMIN_PORT", "1884")),
                keepalive=15,
            )
            self.client.loop_start()
            if not self.ready.wait(4):
                raise BrokerUnavailable("Шлюз не підтвердив з’єднання")
            return self
        except (OSError, ValueError, BrokerUnavailable) as exc:
            self.__exit__(None, None, None)
            raise BrokerUnavailable("Шлюз контролерів тимчасово недоступний") from exc

    def __exit__(self, *args):
        self.client.disconnect()
        self.client.loop_stop()

    def request(self, command: str, *, missing_ok=False, **values):
        self.correlation = uuid.uuid4().hex
        self.response = None
        self.received.clear()
        payload = {
            "commands": [{"command": command, "correlationData": self.correlation, **values}]
        }
        result = self.client.publish(
            "$CONTROL/dynamic-security/v1", json.dumps(payload), qos=1, retain=False
        )
        if result.rc != mqtt.MQTT_ERR_SUCCESS or not self.received.wait(4) or self.response is None:
            raise BrokerUnavailable("Зміну доступу ще не підтверджено шлюзом")
        if self.response.get("error"):
            if missing_ok and self.response["error"] in ("Client not found", "Role not found"):
                return None
            raise BrokerUnavailable("Шлюз відхилив зміну доступу")
        return self.response.get("data", {})

    def apply(self, uid: str, password: str, revoked: bool):
        client = self.request("getClient", username=uid, missing_ok=True)
        if revoked:
            if client is not None:
                self.request("disableClient", username=uid)
            return
        role = f"device-{uid}"
        topic = f"techbaza/devices/{uid}"
        if self.request("getRole", rolename=role, missing_ok=True) is None:
            acls = [
                {"acltype": kind, "topic": f"{topic}/commands", "allow": True}
                for kind in ("subscribeLiteral", "publishClientReceive")
            ]
            acls += [
                {"acltype": "publishClientSend", "topic": f"{topic}/{suffix}", "allow": True}
                for suffix in ("telemetry", "heartbeat", "commands/ack", "commands/result")
            ]
            self.request("createRole", rolename=role, acls=acls)
        if client is None:
            self.request(
                "createClient",
                username=uid,
                clientid=f"{uid}-esp32",
                password=password,
                roles=[{"rolename": role}],
            )
        else:
            # disableClient розриває вже відкриту сесію: старий пароль не зберігає доступ.
            self.request("disableClient", username=uid)
            self.request("setClientPassword", username=uid, password=password)
            self.request("enableClient", username=uid)
