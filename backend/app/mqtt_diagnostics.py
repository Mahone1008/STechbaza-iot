"""Bounded, thread-safe MQTT diagnostics shared by transport and ingestion."""

import logging
import threading
from datetime import datetime, timezone
from typing import Any
import paho.mqtt.client as mqtt
from app.mqtt_topics import extract_device_uid, extract_command_event_uid

logger = logging.getLogger("app.mqtt_client")
_lock = threading.Lock()
_last_message: dict[str, Any] | None = None
_last_ingestion: dict[str, Any] | None = None
_last_heartbeat: dict[str, Any] | None = None
_last_command_publish: dict[str, Any] | None = None
_last_command_ack: dict[str, Any] | None = None
_last_command_result: dict[str, Any] | None = None
_payload_rejections: dict[str, int] = {}
_last_payload_rejection: dict[str, Any] | None = None


def remember_raw_message(message: mqtt.MQTTMessage, payload: str | None) -> None:
    global _last_message
    with _lock:
        _last_message = {
            "topic": message.topic[:256],
            "payload": payload[:2048] if payload is not None else None,
            "payload_bytes": len(message.payload),
            "payload_truncated": payload is not None and len(payload) > 2048,
            "qos": message.qos,
            "retain": bool(message.retain),
            "received_at": datetime.now(timezone.utc).isoformat(),
        }


def remember_ingestion(**data: Any) -> None:
    global _last_ingestion
    with _lock:
        _last_ingestion = {
            **data,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }


def remember_heartbeat(**data: Any) -> None:
    global _last_heartbeat
    with _lock:
        _last_heartbeat = {
            **data,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }


def remember_command_publish(**data: Any) -> None:
    global _last_command_publish
    with _lock:
        _last_command_publish = {
            **data,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }


def remember_command_ack(**data: Any) -> None:
    global _last_command_ack
    with _lock:
        _last_command_ack = {
            **data,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }


def remember_command_result(**data: Any) -> None:
    global _last_command_result
    with _lock:
        _last_command_result = {
            **data,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }


def reject_payload(topic: str, reason: str) -> None:
    """Відхилення до DB: bounded diagnostics без вмісту пакета/ValidationError."""

    global _last_payload_rejection
    logger.warning("MQTT payload rejected: topic=%r reason=%s", topic[:256], reason)
    with _lock:
        _payload_rejections[reason] = _payload_rejections.get(reason, 0) + 1
        _last_payload_rejection = {
            "topic": topic[:256],
            "reason": reason,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }
    routes = (
        (extract_device_uid(topic, "telemetry"), remember_ingestion),
        (extract_device_uid(topic, "heartbeat"), remember_heartbeat),
        (extract_command_event_uid(topic, "ack"), remember_command_ack),
        (extract_command_event_uid(topic, "result"), remember_command_result),
    )
    for device_uid, remember in routes:
        if device_uid is not None:
            remember(
                status="rejected",
                topic=topic[:256],
                device_uid=device_uid[:160],
                reason="invalid_payload",
                payload_error=reason,
            )
            break


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
        return dict(_last_command_publish) if _last_command_publish is not None else None


def last_command_ack_result() -> dict[str, Any] | None:
    with _lock:
        return dict(_last_command_ack) if _last_command_ack is not None else None


def last_command_result_result() -> dict[str, Any] | None:
    with _lock:
        return dict(_last_command_result) if _last_command_result is not None else None


def rejection_status() -> dict[str, Any]:
    with _lock:
        return {
            "payload_rejections": dict(_payload_rejections),
            "last_payload_rejection": dict(_last_payload_rejection)
            if _last_payload_rejection
            else None,
        }
