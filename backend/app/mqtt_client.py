import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any

import paho.mqtt.client as mqtt
from pydantic import ValidationError

from app.db import SessionLocal
from app.schemas.telemetry import TelemetryEnvelope
from app.services.telemetry import (
    TelemetryDeviceNotFoundError,
    TelemetryService,
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

_lock = threading.Lock()
_connected = False
_last_message: dict[str, Any] | None = None
_last_ingestion: dict[str, Any] | None = None


def _extract_device_uid(topic: str) -> str | None:
    parts = topic.split("/")
    if (
        len(parts) == 4
        and parts[0] == "techbaza"
        and parts[1] == "devices"
        and parts[2]
        and parts[3] == "telemetry"
    ):
        return parts[2]
    return None


def _remember_raw_message(message: mqtt.MQTTMessage, payload: str) -> None:
    global _last_message

    with _lock:
        _last_message = {
            "topic": message.topic,
            "payload": payload,
            "qos": message.qos,
            "retain": bool(message.retain),
            "received_at": datetime.now(timezone.utc).isoformat(),
        }


def _remember_ingestion(**data: Any) -> None:
    global _last_ingestion

    with _lock:
        _last_ingestion = {
            **data,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }


def _handle_telemetry(topic: str, payload_text: str) -> None:
    device_uid = _extract_device_uid(topic)
    if device_uid is None:
        return

    try:
        payload_json = json.loads(payload_text)
        envelope = TelemetryEnvelope.model_validate(payload_json)
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.warning(
            "Відхилено невалідну телеметрію: topic=%s error=%s",
            topic,
            exc,
        )
        _remember_ingestion(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            reason="invalid_payload",
        )
        return

    try:
        with SessionLocal() as session:
            result = TelemetryService(session).ingest(
                device_uid=device_uid,
                payload=envelope,
            )
    except TelemetryDeviceNotFoundError:
        logger.warning(
            "Відхилено телеметрію від невідомого пристрою: uid=%s",
            device_uid,
        )
        _remember_ingestion(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            message_id=str(envelope.message_id),
            reason="unknown_device",
        )
        return
    except Exception:
        logger.exception(
            "Помилка ingestion телеметрії: uid=%s message_id=%s",
            device_uid,
            envelope.message_id,
        )
        _remember_ingestion(
            status="error",
            topic=topic,
            device_uid=device_uid,
            message_id=str(envelope.message_id),
            reason="internal_error",
        )
        return

    logger.info(
        "Телеметрію оброблено: uid=%s message_id=%s duplicate=%s",
        device_uid,
        envelope.message_id,
        result.duplicate,
    )
    _remember_ingestion(
        status="duplicate" if result.duplicate else "stored",
        topic=topic,
        device_uid=device_uid,
        message_id=str(envelope.message_id),
        telemetry_id=str(result.telemetry_id),
        duplicate=result.duplicate,
    )


def _on_connect(client, userdata, connect_flags, reason_code, properties) -> None:
    global _connected

    is_connected = reason_code == 0

    with _lock:
        _connected = is_connected

    if is_connected:
        client.subscribe(MQTT_TEST_TOPIC, qos=0)
        client.subscribe(MQTT_TELEMETRY_TOPIC, qos=1)


def _on_disconnect(client, userdata, disconnect_flags, reason_code, properties) -> None:
    global _connected

    with _lock:
        _connected = False


def _on_message(client, userdata, message) -> None:
    payload = message.payload.decode("utf-8", errors="replace")
    _remember_raw_message(message, payload)

    if _extract_device_uid(message.topic) is not None:
        _handle_telemetry(message.topic, payload)


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
            "subscribed_telemetry_topic": MQTT_TELEMETRY_TOPIC,
        }


def last_mqtt_message() -> dict[str, Any] | None:
    with _lock:
        return dict(_last_message) if _last_message is not None else None


def last_ingestion_result() -> dict[str, Any] | None:
    with _lock:
        return dict(_last_ingestion) if _last_ingestion is not None else None
