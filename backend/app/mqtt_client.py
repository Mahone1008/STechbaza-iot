import os
import threading
from datetime import datetime, timezone
from typing import Any

import paho.mqtt.client as mqtt

MQTT_HOST = os.getenv("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", "techbaza-backend")
MQTT_TEST_TOPIC = os.getenv("MQTT_TEST_TOPIC", "techbaza/test/backend")

_lock = threading.Lock()
_connected = False
_last_message: dict[str, Any] | None = None


def _on_connect(client, userdata, connect_flags, reason_code, properties) -> None:
    global _connected

    is_connected = reason_code == 0

    with _lock:
        _connected = is_connected

    if is_connected:
        client.subscribe(MQTT_TEST_TOPIC, qos=0)


def _on_disconnect(client, userdata, disconnect_flags, reason_code, properties) -> None:
    global _connected

    with _lock:
        _connected = False


def _on_message(client, userdata, message) -> None:
    global _last_message

    payload = message.payload.decode("utf-8", errors="replace")

    with _lock:
        _last_message = {
            "topic": message.topic,
            "payload": payload,
            "qos": message.qos,
            "retain": bool(message.retain),
            "received_at": datetime.now(timezone.utc).isoformat(),
        }


client = mqtt.Client(
    callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    client_id=MQTT_CLIENT_ID,
)
client.on_connect = _on_connect
client.on_disconnect = _on_disconnect
client.on_message = _on_message


def start_mqtt() -> None:
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.loop_start()


def stop_mqtt() -> None:
    client.disconnect()
    client.loop_stop()


def mqtt_status() -> dict[str, Any]:
    with _lock:
        return {
            "connected": _connected,
            "host": MQTT_HOST,
            "port": MQTT_PORT,
            "subscribed_test_topic": MQTT_TEST_TOPIC,
        }


def last_mqtt_message() -> dict[str, Any] | None:
    with _lock:
        return dict(_last_message) if _last_message is not None else None
