"""Обмежений JSON-контракт входу MQTT; помилки вмісту не потребують retry."""

import json
from typing import Any

from app.numeric import finite_number

# Ліміти протоколу, спільні для telemetry, heartbeat, ACK та result.
# Broker обмежує мережеві ресурси окремо; тут перевірка до decode/JSON/DB.
MAX_PAYLOAD_BYTES = 65_536
MAX_JSON_DEPTH = 16
MAX_JSON_NODES = 2_048
MAX_STRING_LENGTH = 4_096


class InvalidMQTTPayload(ValueError):
    """reason — фіксований код; payload ніколи не потрапляє в текст помилки."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def decode_payload(payload: bytes) -> str:
    if len(payload) > MAX_PAYLOAD_BYTES:
        raise InvalidMQTTPayload("payload_too_large")
    try:
        return payload.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise InvalidMQTTPayload("invalid_utf8") from exc


def _check_depth(text: str) -> None:
    # Рахуємо контейнери до recursive JSON parser, ігноруючи дужки у рядках.
    depth = 0
    in_string = False
    escaped = False
    for char in text:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in "[{":
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise InvalidMQTTPayload("json_too_deep")
        elif char in "]}":
            depth -= 1


def _reject_constant(value: str) -> None:
    raise InvalidMQTTPayload("nonfinite_number")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InvalidMQTTPayload("duplicate_key")
        result[key] = value
    return result


def _check_string(value: str) -> None:
    if len(value) > MAX_STRING_LENGTH:
        raise InvalidMQTTPayload("string_too_long")
    # PostgreSQL JSONB не приймає NUL і непарні Unicode surrogates.
    if "\x00" in value:
        raise InvalidMQTTPayload("invalid_json_string")
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeEncodeError as exc:
        raise InvalidMQTTPayload("invalid_json_string") from exc


def _check_values(value: dict[str, Any]) -> None:
    pending: list[Any] = [value]
    visited = 0
    while pending:
        item = pending.pop()
        visited += 1
        if visited > MAX_JSON_NODES:
            raise InvalidMQTTPayload("too_many_json_nodes")
        if isinstance(item, dict):
            for key, child in item.items():
                pending.extend((key, child))
        elif isinstance(item, list):
            pending.extend(item)
        elif isinstance(item, str):
            _check_string(item)
        elif isinstance(item, (int, float)) and not isinstance(item, bool):
            if finite_number(item) is None:
                raise InvalidMQTTPayload("number_out_of_range")


def load_json_object(text: str) -> dict[str, Any]:
    # Перевіряємо також прямі виклики handlers, що не проходять _on_message.
    if len(text) > MAX_PAYLOAD_BYTES:
        raise InvalidMQTTPayload("payload_too_large")
    try:
        encoded = text.encode("utf-8", errors="strict")
    except UnicodeEncodeError as exc:
        raise InvalidMQTTPayload("invalid_utf8") from exc
    if len(encoded) > MAX_PAYLOAD_BYTES:
        raise InvalidMQTTPayload("payload_too_large")
    _check_depth(text)
    try:
        value = json.loads(text, parse_constant=_reject_constant, object_pairs_hook=_unique_object)
    except InvalidMQTTPayload:
        raise
    except (ValueError, RecursionError, OverflowError) as exc:
        # Зокрема ValueError від ліміту кількості цифр Python int.
        # Цей catch навмисно не охоплює service/DB processing.
        raise InvalidMQTTPayload("invalid_json") from exc
    if not isinstance(value, dict):
        raise InvalidMQTTPayload("object_required")
    _check_values(value)
    return value
