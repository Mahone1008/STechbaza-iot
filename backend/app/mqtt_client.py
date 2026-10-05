from app import mqtt_ingress
from app.mqtt_topics import extract_device_uid, extract_command_event_uid
from app.mqtt_diagnostics import (
    remember_raw_message,
    remember_command_publish,
    reject_payload,
    rejection_status,
    last_mqtt_message as last_mqtt_message,
    last_ingestion_result as last_ingestion_result,
    last_heartbeat_result as last_heartbeat_result,
    last_command_publish_result as last_command_publish_result,
    last_command_ack_result as last_command_ack_result,
    last_command_result_result as last_command_result_result,
)
import json
import logging
import os
import threading
from typing import Any

import paho.mqtt.client as mqtt

from app.mqtt_payload import (
    MAX_JSON_DEPTH,
    MAX_JSON_NODES,
    MAX_PAYLOAD_BYTES,
    MAX_STRING_LENGTH,
    InvalidMQTTPayload,
    decode_payload,
)

logger = logging.getLogger(__name__)

MQTT_HOST = os.getenv("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", "techbaza-backend")
MQTT_TEST_TOPIC = os.getenv("MQTT_TEST_TOPIC", "techbaza/test/backend")
MQTT_TELEMETRY_TOPIC = os.getenv(
    "MQTT_TELEMETRY_TOPIC",
    "techbaza/devices/+/telemetry",
)
MQTT_HEARTBEAT_TOPIC = os.getenv(
    "MQTT_HEARTBEAT_TOPIC",
    "techbaza/devices/+/heartbeat",
)
MQTT_COMMAND_ACK_TOPIC = os.getenv(
    "MQTT_COMMAND_ACK_TOPIC",
    "techbaza/devices/+/commands/ack",
)
MQTT_COMMAND_RESULT_TOPIC = os.getenv(
    "MQTT_COMMAND_RESULT_TOPIC",
    "techbaza/devices/+/commands/result",
)
MQTT_COMMAND_TOPIC_TEMPLATE = os.getenv(
    "MQTT_COMMAND_TOPIC_TEMPLATE",
    "techbaza/devices/{device_uid}/commands",
)
MQTT_PUBLISH_TIMEOUT_SECONDS = float(os.getenv("MQTT_PUBLISH_TIMEOUT_SECONDS", "3"))

_lock = threading.Lock()
_connected = False


def command_topic(device_uid: str) -> str:
    """Будує publish-topic конкретного Device без MQTT wildcard."""

    if not device_uid or any(char in device_uid for char in ("/", "+", "#")):
        raise ValueError("Некоректний device_uid для MQTT topic")

    return MQTT_COMMAND_TOPIC_TEMPLATE.format(device_uid=device_uid)


def publish_command_message(
    *,
    topic: str,
    payload: dict[str, Any],
    command_id: Any,
    device_uid: str,
) -> tuple[bool, str]:
    """Публікує command із QoS 1 та ніколи не використовує retain."""

    with _lock:
        connected = _connected

    if not connected:
        remember_command_publish(
            status="failed",
            reason="mqtt_not_connected",
            topic=topic,
            command_id=str(command_id),
            device_uid=device_uid,
        )
        return False, "mqtt_not_connected"

    payload_text = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    )

    try:
        info = client.publish(
            topic,
            payload=payload_text,
            qos=1,
            retain=False,
        )

        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            reason = f"mqtt_publish_rc_{info.rc}"
            remember_command_publish(
                status="failed",
                reason=reason,
                topic=topic,
                command_id=str(command_id),
                device_uid=device_uid,
                qos=1,
                retain=False,
            )
            return False, reason

        info.wait_for_publish(timeout=MQTT_PUBLISH_TIMEOUT_SECONDS)
        if not info.is_published():
            remember_command_publish(
                status="failed",
                reason="mqtt_publish_timeout",
                topic=topic,
                command_id=str(command_id),
                device_uid=device_uid,
                qos=1,
                retain=False,
            )
            return False, "mqtt_publish_timeout"
    except Exception:
        logger.exception(
            "Помилка MQTT publish command: device_uid=%s command_id=%s",
            device_uid,
            command_id,
        )
        remember_command_publish(
            status="failed",
            reason="mqtt_publish_exception",
            topic=topic,
            command_id=str(command_id),
            device_uid=device_uid,
            qos=1,
            retain=False,
        )
        return False, "mqtt_publish_exception"

    remember_command_publish(
        status="published",
        reason="published",
        topic=topic,
        command_id=str(command_id),
        device_uid=device_uid,
        payload=payload,
        qos=1,
        retain=False,
    )
    return True, "published"


def _on_connect(client, userdata, connect_flags, reason_code, properties) -> None:
    global _connected
    is_connected = reason_code == 0

    with _lock:
        _connected = is_connected

    if is_connected:
        client.subscribe(MQTT_TEST_TOPIC, qos=0)
        client.subscribe(MQTT_TELEMETRY_TOPIC, qos=1)
        client.subscribe(MQTT_HEARTBEAT_TOPIC, qos=1)
        client.subscribe(MQTT_COMMAND_ACK_TOPIC, qos=1)
        client.subscribe(MQTT_COMMAND_RESULT_TOPIC, qos=1)


def _on_disconnect(client, userdata, disconnect_flags, reason_code, properties) -> None:
    global _connected
    with _lock:
        _connected = False


class MQTTProcessingError(RuntimeError):
    """Тимчасова помилка обробки: повідомлення не можна підтверджувати."""


_stop_event = threading.Event()
_network_thread: threading.Thread | None = None


def _on_message(client, userdata, message) -> None:
    try:
        payload = decode_payload(message.payload)
    except InvalidMQTTPayload as exc:
        remember_raw_message(message, None)
        reject_payload(message.topic, exc.reason)
        if message.qos > 0:
            client.ack(message.mid, message.qos)
        return
    remember_raw_message(message, payload)
    processed = True

    if extract_device_uid(message.topic, "telemetry") is not None:
        processed = mqtt_ingress.handle_telemetry(message.topic, payload)
    elif extract_device_uid(message.topic, "heartbeat") is not None:
        processed = mqtt_ingress.handle_heartbeat(message.topic, payload)
    elif extract_command_event_uid(message.topic, "ack") is not None:
        processed = mqtt_ingress.handle_command_ack(message.topic, payload)
    elif extract_command_event_uid(message.topic, "result") is not None:
        processed = mqtt_ingress.handle_command_result(message.topic, payload)

    if not processed:
        # Вихід із network loop запускає reconnect з тією самою MQTT session.
        # Брокер повторить непідтверджений QoS 1 packet після відновлення.
        raise MQTTProcessingError("MQTT message processing must be retried")
    if message.qos > 0:
        client.ack(message.mid, message.qos)


client = mqtt.Client(
    callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    client_id=MQTT_CLIENT_ID,
    clean_session=False,
    manual_ack=True,
)
client.on_connect = _on_connect
client.on_disconnect = _on_disconnect
client.on_message = _on_message


def _mqtt_loop() -> None:
    """Один network thread: commit перед ACK, reconnect після transient error."""

    global _connected
    while not _stop_event.is_set():
        try:
            client.loop_forever(retry_first_connection=True)
        except Exception:
            logger.exception("MQTT processing interrupted; pending QoS 1 will be redelivered")
        if _stop_event.is_set():
            break
        with _lock:
            _connected = False
        delay = 1.0
        while not _stop_event.wait(delay):
            try:
                client.reconnect()
                break
            except OSError:
                logger.warning("MQTT reconnect failed; retrying", exc_info=True)
                delay = min(delay * 2, 30)


def start_mqtt() -> None:
    global _network_thread
    if _network_thread is not None and _network_thread.is_alive():
        return
    _stop_event.clear()
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=30)
    _network_thread = threading.Thread(target=_mqtt_loop, name="techbaza-mqtt", daemon=True)
    _network_thread.start()


def stop_mqtt() -> None:
    global _network_thread, _connected
    _stop_event.set()
    client.disconnect()
    if _network_thread is not None:
        _network_thread.join(timeout=5)
        if not _network_thread.is_alive():
            _network_thread = None
    with _lock:
        _connected = False


def mqtt_status() -> dict[str, Any]:
    with _lock:
        return {
            "connected": _connected,
            "host": MQTT_HOST,
            "port": MQTT_PORT,
            "subscribed_test_topic": MQTT_TEST_TOPIC,
            "subscribed_telemetry_topic": MQTT_TELEMETRY_TOPIC,
            "subscribed_heartbeat_topic": MQTT_HEARTBEAT_TOPIC,
            "subscribed_command_ack_topic": MQTT_COMMAND_ACK_TOPIC,
            "subscribed_command_result_topic": MQTT_COMMAND_RESULT_TOPIC,
            "command_topic_template": MQTT_COMMAND_TOPIC_TEMPLATE,
            "command_qos": 1,
            "command_retain": False,
            "ingress_policy": "H-01",
            "max_payload_bytes": MAX_PAYLOAD_BYTES,
            "max_json_depth": MAX_JSON_DEPTH,
            "max_json_nodes": MAX_JSON_NODES,
            "max_json_string_length": MAX_STRING_LENGTH,
            **rejection_status(),
        }
