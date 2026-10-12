"""Observe fresh physical LTE telemetry; never publish or execute a command."""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import queue
import ssl
import threading
import time
import uuid

import paho.mqtt.client as mqtt
from sqlalchemy import select

from app.db import SessionLocal
from app.models.device import Device
from app.models.telemetry import DeviceState, TelemetryMessage
from app.schemas.heartbeat import HeartbeatEnvelope
from app.schemas.telemetry import TelemetryEnvelope

READINGS = {"vfd.set_frequency_hz", "vfd.frequency_hz", "vfd.current_a", "vfd.voltage_v"}


def physical_sample(payload, *, now, read_only):
    sample = TelemetryEnvelope.model_validate_json(payload)
    if sample.sent_at is None or abs((now - sample.sent_at).total_seconds()) > 30:
        raise ValueError("Telemetry UTC missing or more than 30 seconds from server time")
    if sample.session_id is None or sample.sequence is None:
        raise ValueError("Boot session / sequence missing")
    if not sample.diagnostics or sample.diagnostics.connection.transport != "cellular":
        raise ValueError("This is not declared cellular telemetry")
    if not READINGS <= sample.values.keys() or any(
        type(sample.values[key]) not in (int, float) or not math.isfinite(sample.values[key]) for key in READINGS
    ):
        raise ValueError("Not all four real VFD measurements are present")
    if sample.state.get("vfd_link") is not True or type(sample.state.get("vfd_fault_code")) is not int:
        raise ValueError("VFD readback is not confirmed")
    if type(sample.state.get("pump_running")) is not bool:
        raise ValueError("VFD operating state is not confirmed")
    if read_only and sample.state.get("control_armed") is not False:
        raise ValueError("First read-only test requires control_armed=false")
    return sample


def run(root, timeout, read_only=True):
    identity = json.loads((root / "identity.json").read_text())
    uid = identity["uid"]
    topic = f"techbaza/devices/{uid}"
    inbox = queue.Queue(maxsize=128)
    subscribed, failed = threading.Event(), threading.Event()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="v4-observer-" + uuid.uuid4().hex)
    client.tls_set(ca_certs=str(root / "ca.crt"), tls_version=ssl.PROTOCOL_TLS_CLIENT)
    client.username_pw_set("v4-observer", identity["observer_password"])

    def connected(peer, userdata, flags, reason, properties):
        if reason.is_failure:
            failed.set()
        else:
            peer.subscribe([(topic + "/telemetry", 1), (topic + "/heartbeat", 1)])

    def subscription(peer, userdata, mid, codes, properties):
        if any(code.is_failure for code in codes):
            failed.set()
        else:
            subscribed.set()

    def message(peer, userdata, packet):
        try:
            inbox.put_nowait((packet.topic, bytes(packet.payload), packet.retain))
        except queue.Full:
            failed.set()

    def disconnected(peer, userdata, flags, reason, properties):
        failed.set()

    client.on_connect, client.on_subscribe, client.on_message = connected, subscription, message
    client.on_disconnect = disconnected
    client.connect(identity["host"], identity["port"], 10)
    client.loop_start()
    deadline = time.monotonic() + timeout
    heartbeat = None
    candidate = None
    last_error = "No live telemetry received"
    try:
        if not subscribed.wait(5) or failed.is_set():
            raise RuntimeError("Observer MQTT authentication/subscription failed")
        while time.monotonic() < deadline:
            if failed.is_set():
                raise RuntimeError("Observer disconnected or input queue overflowed")
            try:
                source, raw, retained = inbox.get(timeout=0.5)
            except queue.Empty:
                source, raw, retained = None, None, False
            if retained:
                raise RuntimeError("Retained message cannot prove fresh hardware telemetry")
            if raw is not None:
                try:
                    if source == topic + "/heartbeat":
                        heartbeat = HeartbeatEnvelope.model_validate_json(raw)
                    else:
                        candidate = physical_sample(raw, now=datetime.now(timezone.utc), read_only=read_only)
                except ValueError as error:
                    last_error = str(error).splitlines()[0]
                    candidate = None
                    continue
            now = datetime.now(timezone.utc)
            if not candidate or not heartbeat or heartbeat.session_id != candidate.session_id:
                continue
            if heartbeat.sent_at is None or abs((now - heartbeat.sent_at).total_seconds()) > 30:
                continue
            if abs((now - candidate.sent_at).total_seconds()) > 30:
                candidate = None
                continue
            with SessionLocal() as session:
                device = session.scalar(select(Device).where(Device.uid == uid))
                if device is None:
                    raise RuntimeError("UID is not registered in this database")
                stored = session.scalar(select(TelemetryMessage).where(
                    TelemetryMessage.message_id == candidate.message_id,
                    TelemetryMessage.device_id == device.id))
                state = session.get(DeviceState, device.id)
                if stored is None or state is None or state.last_session_id != candidate.session_id:
                    last_error = "MQTT sample received, but backend has not stored this boot session"
                    continue
                if state.last_received_at is None or abs((now - state.last_received_at).total_seconds()) > 30:
                    last_error = "Stored overview snapshot is stale"
                    continue
                if state.state.get("vfd_link") is not True or not READINGS <= state.values.keys():
                    last_error = "Latest backend snapshot no longer confirms complete VFD readback"
                    continue
                if read_only and state.state.get("control_armed") is not False:
                    last_error = "Latest backend snapshot is not read-only"
                    continue
                if failed.is_set():
                    raise RuntimeError("Observer disconnected before acceptance completed")
                print(json.dumps({"uid": uid, "device_id": str(device.id), "site_id": str(device.site_id),
                                  "message_id": str(candidate.message_id), "transport": "cellular",
                                  "values": candidate.values, "state": candidate.state}, ensure_ascii=False, indent=2))
                print("PASS: live LTE heartbeat + SU600 measurements accepted by backend. Verify this device in the website.")
                return
        raise RuntimeError(f"Physical LTE acceptance timed out: {last_error}")
    finally:
        client.disconnect()
        client.loop_stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/probe"))
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--allow-control", action="store_true")
    args = parser.parse_args()
    if not 5 <= args.timeout <= 300:
        parser.error("timeout must be 5..300 seconds")
    run(args.root, args.timeout, not args.allow_control)
