import argparse
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

import paho.mqtt.client as mqtt


DEFAULT_HOST = os.getenv("MQTT_HOST", "mosquitto")
DEFAULT_PORT = int(os.getenv("MQTT_PORT", "1883"))


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_datetime(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _build_success_result(command: dict[str, Any]) -> dict[str, Any]:
    command_type = command.get("command_type")
    payload = command.get("payload") or {}

    if command_type == "vfd.frequency.set":
        return {"frequency_hz": payload.get("frequency_hz")}
    if command_type == "vfd.start":
        return {"pump_running": True}
    if command_type == "vfd.stop":
        return {"pump_running": False}

    return {}


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Одноразовий MQTT Device simulator для End-to-End перевірки "
            "Remote Command Core."
        )
    )
    parser.add_argument("--device-uid", default="TB-ESP32-001")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--session-id",
        default=str(uuid.uuid4()),
        help="Boot session UUID симульованого Device.",
    )
    parser.add_argument(
        "--outcome",
        choices=("succeeded", "failed"),
        default="succeeded",
    )
    parser.add_argument(
        "--error-code",
        default="simulated_execution_failed",
    )
    parser.add_argument(
        "--error-message",
        default="Simulated device execution failure",
    )
    args = parser.parse_args()

    command_topic = f"techbaza/devices/{args.device_uid}/commands"
    ack_topic = f"techbaza/devices/{args.device_uid}/commands/ack"
    result_topic = f"techbaza/devices/{args.device_uid}/commands/result"

    finished = threading.Event()
    processed_command_ids: set[str] = set()

    client = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"techbaza-e2e-sim-{uuid.uuid4().hex[:8]}",
    )

    def publish_json(topic: str, payload: dict[str, Any]) -> None:
        info = client.publish(
            topic,
            payload=json.dumps(
                payload,
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            qos=1,
            retain=False,
        )
        info.wait_for_publish(timeout=3)
        if not info.is_published():
            raise RuntimeError(f"MQTT publish timeout: {topic}")

    def on_connect(
        mqtt_client,
        userdata,
        connect_flags,
        reason_code,
        properties,
    ) -> None:
        if reason_code != 0:
            print(f"[ERROR] MQTT connect failed: {reason_code}", flush=True)
            finished.set()
            return

        mqtt_client.subscribe(command_topic, qos=1)
        print(
            f"[READY] Device simulator subscribed: {command_topic}",
            flush=True,
        )

    def on_message(mqtt_client, userdata, message) -> None:
        try:
            command = json.loads(message.payload.decode("utf-8"))
            command_id = str(command["command_id"])
            expires_at = _parse_datetime(str(command["expires_at"]))
        except Exception as exc:
            print(f"[REJECT] Invalid CommandEnvelope: {exc}", flush=True)
            return

        if command_id in processed_command_ids:
            print(
                f"[DUPLICATE] command_id={command_id}; physical execution skipped",
                flush=True,
            )
            return

        if datetime.now(timezone.utc) >= expires_at:
            print(
                f"[REJECT] command_id={command_id}; command already expired",
                flush=True,
            )
            return

        # Device-side deduplication відбувається до фізичної дії.
        processed_command_ids.add(command_id)

        print(
            (
                f"[RECEIVED] command_id={command_id} "
                f"type={command.get('command_type')} "
                f"payload={command.get('payload')}"
            ),
            flush=True,
        )

        ack = {
            "schema_version": 1,
            "message_id": str(uuid.uuid4()),
            "command_id": command_id,
            "session_id": args.session_id,
            "sent_at": _utc_now(),
        }
        publish_json(ack_topic, ack)
        print(f"[ACK] command_id={command_id}", flush=True)

        if args.outcome == "succeeded":
            result = {
                "schema_version": 1,
                "message_id": str(uuid.uuid4()),
                "command_id": command_id,
                "session_id": args.session_id,
                "sent_at": _utc_now(),
                "status": "succeeded",
                "result": _build_success_result(command),
                "error_code": None,
                "error_message": None,
            }
        else:
            result = {
                "schema_version": 1,
                "message_id": str(uuid.uuid4()),
                "command_id": command_id,
                "session_id": args.session_id,
                "sent_at": _utc_now(),
                "status": "failed",
                "result": {},
                "error_code": args.error_code,
                "error_message": args.error_message,
            }

        publish_json(result_topic, result)
        print(
            f"[RESULT] command_id={command_id} status={args.outcome}",
            flush=True,
        )
        finished.set()
        mqtt_client.disconnect()

    client.on_connect = on_connect
    client.on_message = on_message

    print(
        (
            f"[START] device_uid={args.device_uid} "
            f"session_id={args.session_id} outcome={args.outcome}"
        ),
        flush=True,
    )

    client.connect(args.host, args.port, keepalive=30)
    client.loop_start()

    try:
        while not finished.wait(timeout=0.25):
            pass
    except KeyboardInterrupt:
        print("[STOP] Interrupted by user", flush=True)
    finally:
        client.disconnect()
        client.loop_stop()


if __name__ == "__main__":
    main()
