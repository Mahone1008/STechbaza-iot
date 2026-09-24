import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any

import paho.mqtt.client as mqtt
from pydantic import ValidationError

from app.db import SessionLocal
from app.schemas.command_ack import CommandAckEnvelope
from app.schemas.command_result import CommandResultEnvelope
from app.schemas.heartbeat import HeartbeatEnvelope
from app.schemas.telemetry import TelemetryEnvelope
from app.services.command_ack import (
    CommandAckCommandNotFoundError,
    CommandAckDeviceMismatchError,
    CommandAckDeviceNotFoundError,
    CommandAckExpiredError,
    CommandAckInvalidTransitionError,
    CommandAckService,
)
from app.services.command_result import (
    CommandResultCommandNotFoundError,
    CommandResultConflictError,
    CommandResultDeviceMismatchError,
    CommandResultDeviceNotFoundError,
    CommandResultExpiredError,
    CommandResultInvalidTransitionError,
    CommandResultService,
)
from app.services.device_presence import (
    DevicePresenceService,
    PresenceDeviceNotFoundError,
)
from app.services.telemetry import (
    TelemetryCapabilityViolationError,
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
MQTT_PUBLISH_TIMEOUT_SECONDS = float(
    os.getenv("MQTT_PUBLISH_TIMEOUT_SECONDS", "3")
)

_lock = threading.Lock()
_connected = False
_last_message: dict[str, Any] | None = None
_last_ingestion: dict[str, Any] | None = None
_last_heartbeat: dict[str, Any] | None = None
_last_command_publish: dict[str, Any] | None = None
_last_command_ack: dict[str, Any] | None = None
_last_command_result: dict[str, Any] | None = None


def _extract_device_uid(topic: str, expected_suffix: str) -> str | None:
    parts = topic.split("/")
    if (
        len(parts) == 4
        and parts[0] == "techbaza"
        and parts[1] == "devices"
        and parts[2]
        and parts[3] == expected_suffix
    ):
        return parts[2]
    return None


def _extract_command_event_uid(topic: str, event_name: str) -> str | None:
    parts = topic.split("/")
    if (
        len(parts) == 5
        and parts[0] == "techbaza"
        and parts[1] == "devices"
        and parts[2]
        and parts[3] == "commands"
        and parts[4] == event_name
    ):
        return parts[2]
    return None


def command_topic(device_uid: str) -> str:
    """Будує publish-topic конкретного Device без MQTT wildcard."""

    if not device_uid or any(char in device_uid for char in ("/", "+", "#")):
        raise ValueError("Некоректний device_uid для MQTT topic")

    return MQTT_COMMAND_TOPIC_TEMPLATE.format(device_uid=device_uid)


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


def _remember_heartbeat(**data: Any) -> None:
    global _last_heartbeat
    with _lock:
        _last_heartbeat = {
            **data,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }


def _remember_command_publish(**data: Any) -> None:
    global _last_command_publish
    with _lock:
        _last_command_publish = {
            **data,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }


def _remember_command_ack(**data: Any) -> None:
    global _last_command_ack
    with _lock:
        _last_command_ack = {
            **data,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }


def _remember_command_result(**data: Any) -> None:
    global _last_command_result
    with _lock:
        _last_command_result = {
            **data,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }


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
        _remember_command_publish(
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
            _remember_command_publish(
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
            _remember_command_publish(
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
        _remember_command_publish(
            status="failed",
            reason="mqtt_publish_exception",
            topic=topic,
            command_id=str(command_id),
            device_uid=device_uid,
            qos=1,
            retain=False,
        )
        return False, "mqtt_publish_exception"

    _remember_command_publish(
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


def _handle_telemetry(topic: str, payload_text: str) -> None:
    device_uid = _extract_device_uid(topic, "telemetry")
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
        _remember_ingestion(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            message_id=str(envelope.message_id),
            reason="unknown_device",
        )
        return
    except TelemetryCapabilityViolationError as exc:
        _remember_ingestion(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            message_id=str(envelope.message_id),
            reason="capability_violation",
            missing_capabilities=list(exc.missing_capabilities),
            unsupported_keys=list(exc.unsupported_keys),
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

    _remember_ingestion(
        status="duplicate" if result.duplicate else "stored",
        topic=topic,
        device_uid=device_uid,
        message_id=str(envelope.message_id),
        session_id=(
            str(envelope.session_id)
            if envelope.session_id is not None
            else None
        ),
        telemetry_id=str(result.telemetry_id),
        duplicate=result.duplicate,
        state_updated=result.state_updated,
        ordering_reason=result.ordering_reason,
    )


def _handle_heartbeat(topic: str, payload_text: str) -> None:
    device_uid = _extract_device_uid(topic, "heartbeat")
    if device_uid is None:
        return

    try:
        payload_json = json.loads(payload_text)
        envelope = HeartbeatEnvelope.model_validate(payload_json)
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.warning(
            "Відхилено невалідний heartbeat: topic=%s error=%s",
            topic,
            exc,
        )
        _remember_heartbeat(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            reason="invalid_payload",
        )
        return

    try:
        with SessionLocal() as session:
            seen_at = DevicePresenceService(session).mark_seen(
                device_uid=device_uid
            )
    except PresenceDeviceNotFoundError:
        _remember_heartbeat(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            message_id=str(envelope.message_id),
            reason="unknown_device",
        )
        return
    except Exception:
        logger.exception(
            "Помилка heartbeat ingestion: uid=%s message_id=%s",
            device_uid,
            envelope.message_id,
        )
        _remember_heartbeat(
            status="error",
            topic=topic,
            device_uid=device_uid,
            message_id=str(envelope.message_id),
            reason="internal_error",
        )
        return

    _remember_heartbeat(
        status="accepted",
        topic=topic,
        device_uid=device_uid,
        message_id=str(envelope.message_id),
        session_id=(
            str(envelope.session_id)
            if envelope.session_id is not None
            else None
        ),
        sequence=envelope.sequence,
        seen_at=seen_at.isoformat(),
    )


def _handle_command_ack(topic: str, payload_text: str) -> None:
    device_uid = _extract_command_event_uid(topic, "ack")
    if device_uid is None:
        return

    try:
        payload_json = json.loads(payload_text)
        envelope = CommandAckEnvelope.model_validate(payload_json)
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.warning(
            "Відхилено невалідний command ACK: topic=%s error=%s",
            topic,
            exc,
        )
        _remember_command_ack(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            reason="invalid_payload",
        )
        return

    try:
        with SessionLocal() as session:
            result = CommandAckService(session).acknowledge(
                device_uid=device_uid,
                payload=envelope,
            )
    except CommandAckDeviceNotFoundError:
        _remember_command_ack(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="unknown_device",
        )
        return
    except CommandAckCommandNotFoundError:
        _remember_command_ack(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="unknown_command",
        )
        return
    except CommandAckDeviceMismatchError:
        _remember_command_ack(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="device_mismatch",
        )
        return
    except CommandAckExpiredError:
        _remember_command_ack(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="command_expired",
        )
        return
    except CommandAckInvalidTransitionError as exc:
        _remember_command_ack(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="invalid_transition",
            command_status=exc.status,
        )
        return
    except Exception:
        logger.exception(
            "Помилка command ACK: device_uid=%s command_id=%s",
            device_uid,
            envelope.command_id,
        )
        _remember_command_ack(
            status="error",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="internal_error",
        )
        return

    _remember_command_ack(
        status="duplicate" if result.duplicate else "accepted",
        topic=topic,
        device_uid=device_uid,
        command_id=str(envelope.command_id),
        message_id=str(envelope.message_id),
        session_id=str(envelope.session_id),
        duplicate=result.duplicate,
        command_updated=result.updated,
        reason=result.reason,
        command_status=result.command.status,
        acknowledged_at=(
            result.command.acknowledged_at.isoformat()
            if result.command.acknowledged_at is not None
            else None
        ),
    )



def _handle_command_result(topic: str, payload_text: str) -> None:
    device_uid = _extract_command_event_uid(topic, "result")
    if device_uid is None:
        return

    try:
        payload_json = json.loads(payload_text)
        envelope = CommandResultEnvelope.model_validate(payload_json)
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.warning(
            "Відхилено невалідний command result: topic=%s error=%s",
            topic,
            exc,
        )
        _remember_command_result(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            reason="invalid_payload",
        )
        return

    try:
        with SessionLocal() as session:
            result = CommandResultService(session).complete(
                device_uid=device_uid,
                payload=envelope,
            )
    except CommandResultDeviceNotFoundError:
        _remember_command_result(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="unknown_device",
        )
        return
    except CommandResultCommandNotFoundError:
        _remember_command_result(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="unknown_command",
        )
        return
    except CommandResultDeviceMismatchError:
        _remember_command_result(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="device_mismatch",
        )
        return
    except CommandResultConflictError:
        _remember_command_result(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="terminal_result_conflict",
        )
        return
    except CommandResultExpiredError:
        _remember_command_result(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="command_expired",
        )
        return
    except CommandResultInvalidTransitionError as exc:
        _remember_command_result(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="invalid_transition",
            command_status=exc.status,
        )
        return
    except Exception:
        logger.exception(
            "Помилка command result: device_uid=%s command_id=%s",
            device_uid,
            envelope.command_id,
        )
        _remember_command_result(
            status="error",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="internal_error",
        )
        return

    _remember_command_result(
        status="duplicate" if result.duplicate else "accepted",
        topic=topic,
        device_uid=device_uid,
        command_id=str(envelope.command_id),
        message_id=str(envelope.message_id),
        session_id=str(envelope.session_id),
        duplicate=result.duplicate,
        command_updated=result.updated,
        reason=result.reason,
        command_status=result.command.status,
        acknowledged_at=(
            result.command.acknowledged_at.isoformat()
            if result.command.acknowledged_at is not None
            else None
        ),
        completed_at=(
            result.command.completed_at.isoformat()
            if result.command.completed_at is not None
            else None
        ),
        result=result.command.result,
        error_code=result.command.error_code,
        error_message=result.command.error_message,
    )


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


def _on_message(client, userdata, message) -> None:
    payload = message.payload.decode("utf-8", errors="replace")
    _remember_raw_message(message, payload)

    if _extract_device_uid(message.topic, "telemetry") is not None:
        _handle_telemetry(message.topic, payload)
        return

    if _extract_device_uid(message.topic, "heartbeat") is not None:
        _handle_heartbeat(message.topic, payload)
        return

    if _extract_command_event_uid(message.topic, "ack") is not None:
        _handle_command_ack(message.topic, payload)
        return

    if _extract_command_event_uid(message.topic, "result") is not None:
        _handle_command_result(message.topic, payload)


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
            "subscribed_heartbeat_topic": MQTT_HEARTBEAT_TOPIC,
            "subscribed_command_ack_topic": MQTT_COMMAND_ACK_TOPIC,
            "subscribed_command_result_topic": MQTT_COMMAND_RESULT_TOPIC,
            "command_topic_template": MQTT_COMMAND_TOPIC_TEMPLATE,
            "command_qos": 1,
            "command_retain": False,
        }


def last_mqtt_message() -> dict[str, Any] | None:
    with _lock:
        return dict(_last_message) if _last_message is not None else None


def last_ingestion_result() -> dict[str, Any] | None:
    with _lock:
        return dict(_last_ingestion) if _last_ingestion is not None else None


def last_heartbeat_result() -> dict[str, Any] | None:
    with _lock:
        return dict(_last_heartbeat) if _last_heartbeat is not None else None


def last_command_publish_result() -> dict[str, Any] | None:
    with _lock:
        return (
            dict(_last_command_publish)
            if _last_command_publish is not None
            else None
        )


def last_command_ack_result() -> dict[str, Any] | None:
    with _lock:
        return (
            dict(_last_command_ack)
            if _last_command_ack is not None
            else None
        )


def last_command_result_result() -> dict[str, Any] | None:
    with _lock:
        return (
            dict(_last_command_result)
            if _last_command_result is not None
            else None
        )
