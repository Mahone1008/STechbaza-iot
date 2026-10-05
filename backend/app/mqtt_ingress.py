"""Validate inbound envelopes and commit domain operations before transport ACK."""

import logging
from pydantic import ValidationError
from sqlalchemy.exc import DataError
from app.db import SessionLocal
from app.mqtt_payload import (
    InvalidMQTTPayload,
    load_json_object,
)
from app.schemas.command_ack import CommandAckEnvelope
from app.schemas.command_result import CommandResultEnvelope
from app.schemas.heartbeat import HeartbeatEnvelope
from app.schemas.telemetry import TelemetryEnvelope
from app.services.command_ack import (
    CommandAckCommandNotFoundError,
    CommandAckDeviceMismatchError,
    CommandAckDeviceNotFoundError,
    CommandAckInvalidTransitionError,
    CommandAckService,
)
from app.services.command_result import (
    CommandResultCommandNotFoundError,
    CommandResultConflictError,
    CommandResultDeviceMismatchError,
    CommandResultDeviceNotFoundError,
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

from app.mqtt_topics import extract_device_uid, extract_command_event_uid
from app.mqtt_diagnostics import (
    reject_payload,
    remember_ingestion,
    remember_heartbeat,
    remember_command_ack,
    remember_command_result,
)

logger = logging.getLogger("app.mqtt_client")


def handle_telemetry(topic: str, payload_text: str) -> bool:
    device_uid = extract_device_uid(topic, "telemetry")
    if device_uid is None:
        return True

    try:
        payload_json = load_json_object(payload_text)
        envelope = TelemetryEnvelope.model_validate(payload_json)
    except (InvalidMQTTPayload, ValidationError) as exc:
        reject_payload(
            topic, exc.reason if isinstance(exc, InvalidMQTTPayload) else "invalid_envelope"
        )
        return True

    try:
        with SessionLocal() as session:
            result = TelemetryService(session).ingest(
                device_uid=device_uid,
                payload=envelope,
            )
    except TelemetryDeviceNotFoundError:
        remember_ingestion(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            message_id=str(envelope.message_id),
            reason="unknown_device",
        )
        return True
    except TelemetryCapabilityViolationError as exc:
        remember_ingestion(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            message_id=str(envelope.message_id),
            reason="capability_violation",
            missing_capabilities=list(exc.missing_capabilities),
            unsupported_keys=list(exc.unsupported_keys),
        )
        return True
    except DataError:
        # SQL відхилив значення payload, наприклад NaN у JSONB чи overflow.
        # Повтор незмінного packet не виправить дані; не блокуємо ним потік.
        logger.warning("Відхилено MQTT payload, несумісний зі схемою БД: topic=%s", topic)
        remember_ingestion(
            status="rejected", topic=topic, device_uid=device_uid, reason="invalid_database_value"
        )
        return True
    except Exception:
        logger.exception(
            "Помилка ingestion телеметрії: uid=%s message_id=%s",
            device_uid,
            envelope.message_id,
        )
        remember_ingestion(
            status="error",
            topic=topic,
            device_uid=device_uid,
            message_id=str(envelope.message_id),
            reason="internal_error",
        )
        return False

    remember_ingestion(
        status="duplicate" if result.duplicate else "stored",
        topic=topic,
        device_uid=device_uid,
        message_id=str(envelope.message_id),
        session_id=(str(envelope.session_id) if envelope.session_id is not None else None),
        telemetry_id=str(result.telemetry_id),
        duplicate=result.duplicate,
        state_updated=result.state_updated,
        ordering_reason=result.ordering_reason,
    )
    return True


def handle_heartbeat(topic: str, payload_text: str) -> bool:
    device_uid = extract_device_uid(topic, "heartbeat")
    if device_uid is None:
        return True

    try:
        payload_json = load_json_object(payload_text)
        envelope = HeartbeatEnvelope.model_validate(payload_json)
    except (InvalidMQTTPayload, ValidationError) as exc:
        reject_payload(
            topic, exc.reason if isinstance(exc, InvalidMQTTPayload) else "invalid_envelope"
        )
        return True

    try:
        with SessionLocal() as session:
            heartbeat = DevicePresenceService(session).mark_seen(
                device_uid=device_uid,
                session_id=envelope.session_id,
                message_id=envelope.message_id,
                sequence=envelope.sequence,
            )
    except PresenceDeviceNotFoundError:
        remember_heartbeat(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            message_id=str(envelope.message_id),
            reason="unknown_device",
        )
        return True
    except DataError:
        # SQL відхилив значення payload, наприклад NaN у JSONB чи overflow.
        # Повтор незмінного packet не виправить дані; не блокуємо ним потік.
        logger.warning("Відхилено MQTT payload, несумісний зі схемою БД: topic=%s", topic)
        remember_heartbeat(
            status="rejected", topic=topic, device_uid=device_uid, reason="invalid_database_value"
        )
        return True
    except Exception:
        logger.exception(
            "Помилка heartbeat ingestion: uid=%s message_id=%s",
            device_uid,
            envelope.message_id,
        )
        remember_heartbeat(
            status="error",
            topic=topic,
            device_uid=device_uid,
            message_id=str(envelope.message_id),
            reason="internal_error",
        )
        return False

    remember_heartbeat(
        status="accepted" if heartbeat.accepted else "ignored",
        topic=topic,
        device_uid=device_uid,
        message_id=str(envelope.message_id),
        session_id=(str(envelope.session_id) if envelope.session_id is not None else None),
        sequence=envelope.sequence,
        seen_at=heartbeat.seen_at.isoformat() if heartbeat.seen_at else None,
        reason=heartbeat.reason,
    )
    return True


def handle_command_ack(topic: str, payload_text: str) -> bool:
    device_uid = extract_command_event_uid(topic, "ack")
    if device_uid is None:
        return True

    try:
        payload_json = load_json_object(payload_text)
        envelope = CommandAckEnvelope.model_validate(payload_json)
    except (InvalidMQTTPayload, ValidationError) as exc:
        reject_payload(
            topic, exc.reason if isinstance(exc, InvalidMQTTPayload) else "invalid_envelope"
        )
        return True

    try:
        with SessionLocal() as session:
            result = CommandAckService(session).acknowledge(
                device_uid=device_uid,
                payload=envelope,
            )
    except CommandAckDeviceNotFoundError:
        remember_command_ack(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="unknown_device",
        )
        return True
    except CommandAckCommandNotFoundError:
        remember_command_ack(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="unknown_command",
        )
        return True
    except CommandAckDeviceMismatchError:
        remember_command_ack(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="device_mismatch",
        )
        return True
    except CommandAckInvalidTransitionError as exc:
        remember_command_ack(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="invalid_transition",
            command_status=exc.status,
        )
        return True
    except DataError:
        # SQL відхилив значення payload, наприклад NaN у JSONB чи overflow.
        # Повтор незмінного packet не виправить дані; не блокуємо ним потік.
        logger.warning("Відхилено MQTT payload, несумісний зі схемою БД: topic=%s", topic)
        remember_command_ack(
            status="rejected", topic=topic, device_uid=device_uid, reason="invalid_database_value"
        )
        return True
    except Exception:
        logger.exception(
            "Помилка command ACK: device_uid=%s command_id=%s",
            device_uid,
            envelope.command_id,
        )
        remember_command_ack(
            status="error",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="internal_error",
        )
        return False

    remember_command_ack(
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
    return True


def handle_command_result(topic: str, payload_text: str) -> bool:
    device_uid = extract_command_event_uid(topic, "result")
    if device_uid is None:
        return True

    try:
        payload_json = load_json_object(payload_text)
        envelope = CommandResultEnvelope.model_validate(payload_json)
    except (InvalidMQTTPayload, ValidationError) as exc:
        reject_payload(
            topic, exc.reason if isinstance(exc, InvalidMQTTPayload) else "invalid_envelope"
        )
        return True

    try:
        with SessionLocal() as session:
            result = CommandResultService(session).complete(
                device_uid=device_uid,
                payload=envelope,
            )
    except CommandResultDeviceNotFoundError:
        remember_command_result(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="unknown_device",
        )
        return True
    except CommandResultCommandNotFoundError:
        remember_command_result(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="unknown_command",
        )
        return True
    except CommandResultDeviceMismatchError:
        remember_command_result(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="device_mismatch",
        )
        return True
    except CommandResultConflictError:
        remember_command_result(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="terminal_result_conflict",
        )
        return True
    except CommandResultInvalidTransitionError as exc:
        remember_command_result(
            status="rejected",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="invalid_transition",
            command_status=exc.status,
        )
        return True
    except DataError:
        # SQL відхилив значення payload, наприклад NaN у JSONB чи overflow.
        # Повтор незмінного packet не виправить дані; не блокуємо ним потік.
        logger.warning("Відхилено MQTT payload, несумісний зі схемою БД: topic=%s", topic)
        remember_command_result(
            status="rejected", topic=topic, device_uid=device_uid, reason="invalid_database_value"
        )
        return True
    except Exception:
        logger.exception(
            "Помилка command result: device_uid=%s command_id=%s",
            device_uid,
            envelope.command_id,
        )
        remember_command_result(
            status="error",
            topic=topic,
            device_uid=device_uid,
            command_id=str(envelope.command_id),
            message_id=str(envelope.message_id),
            reason="internal_error",
        )
        return False

    remember_command_result(
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
    return True
