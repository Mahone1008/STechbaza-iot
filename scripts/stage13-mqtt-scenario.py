"""Керує лише demo pressure через MQTT; БД використовується тільки для доказів."""

import json
import os
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
from sqlalchemy import select

from app.db import SessionLocal
from app.demo.catalog import identity, uid
from app.demo.seed import PRESSURE_CONFIG, assert_database
from app.models.capability import DeviceCapability
from app.models.device import Device
from app.models.event_alarm import AlarmTransition, DeviceAlarm, DeviceEvent
from app.models.notification import AlarmNotification
from app.models.telemetry import DeviceState, TelemetryMessage

DEVICE_ID = identity("device:pressure")
RULE = "demo.pressure.low"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def verify_scope(session):
    assert_database(session)
    device = session.get(Device, DEVICE_ID)
    require(device is not None and device.uid == uid("pressure")
            and device.site_id == identity("site:a"), "Expected isolated demo pressure device")
    assignment = session.get(DeviceCapability, identity("assignment:pressure:pressure.read"))
    require(assignment is not None and assignment.device_id == DEVICE_ID
            and assignment.is_enabled and assignment.config == PRESSURE_CONFIG,
            "Demo pressure rule changed; test will not overwrite configuration")
    require(os.getenv("MQTT_HOST") == "mosquitto" and os.getenv("MQTT_PORT", "1883") == "1883",
            "Expected isolated compose MQTT broker")


def set_scenario(mode):
    ready = threading.Event()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                         client_id="stage13-browser-" + uuid.uuid4().hex)
    client.on_connect = lambda _client, _data, _flags, reason, _props: ready.set() if reason == 0 else None
    try:
        client.connect("mosquitto", 1883, keepalive=15)
        client.loop_start()
        require(ready.wait(10), "Demo broker connection timeout")
        info = client.publish("techbaza/demo/scenario",
                              json.dumps({"device": "pressure", "mode": mode}),
                              qos=1, retain=False)
        info.wait_for_publish(timeout=10)
        require(info.is_published(), "Demo scenario publish timeout")
    finally:
        client.disconnect()
        client.loop_stop()


def proof(session, alarm, kind):
    transition = session.scalars(select(AlarmTransition).where(
        AlarmTransition.alarm_id == alarm.id, AlarmTransition.transition_type == kind,
    )).one()
    notice = session.scalars(select(AlarmNotification).where(
        AlarmNotification.transition_id == transition.id,
    )).one()
    event = session.get(DeviceEvent, transition.event_id)
    require(event is not None and event.source == "telemetry" and event.device_id == DEVICE_ID
            and event.data.get("rule_key") == RULE, "Missing telemetry rule event")
    packet = session.get(TelemetryMessage, event.source_message_id)
    require(packet is not None and packet.device_id == DEVICE_ID, "Missing MQTT telemetry packet")
    value = packet.values.get("pressure.bar")
    require(isinstance(value, (int, float)) and (value <= 1 if kind == "raised" else value >= 1.5),
            "Telemetry value does not prove the rule transition")
    require(notice.organization_id == identity("org:a") and notice.device_id == DEVICE_ID
            and notice.alarm_id == alarm.id and notice.kind == kind, "Incorrect notification scope")
    return {"alarm_id": str(alarm.id), "notification_id": str(notice.id), "transition_id": str(transition.id),
            "event_id": str(event.id), "telemetry_id": str(packet.id), "message_id": str(packet.message_id),
            "session_id": str(packet.session_id), "sequence": packet.sequence, "pressure_bar": value,
            "state": alarm.state, "acknowledged": alarm.acknowledged_at is not None}


def main():
    require(len(sys.argv) in (2, 3) and sys.argv[1] in ("normal", "alarm"), "Use normal|alarm [alarm_id]")
    mode = sys.argv[1]
    expected_id = uuid.UUID(sys.argv[2]) if len(sys.argv) == 3 else None
    with SessionLocal() as session:
        verify_scope(session)
        if expected_id:
            alarm = session.get(DeviceAlarm, expected_id)
            require(alarm is not None and alarm.device_id == DEVICE_ID and alarm.alarm_key == RULE,
                    "Expected demo pressure incident")
    started = datetime.now(timezone.utc)
    set_scenario(mode)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        with SessionLocal() as session:
            verify_scope(session)
            current = session.get(DeviceState, DEVICE_ID)
            alarms = session.scalars(select(DeviceAlarm).where(
                DeviceAlarm.device_id == DEVICE_ID, DeviceAlarm.alarm_key == RULE,
                DeviceAlarm.state == "active",
            )).all()
            fresh = current is not None and current.last_received_at >= started
            value = current.values.get("pressure.bar") if fresh else None
            if mode == "alarm" and fresh and value == 0.4 and len(alarms) == 1:
                result = proof(session, alarms[0], "raised")
                require(not result["acknowledged"], "Fresh incident must not already be acknowledged")
                print(json.dumps(result))
                return
            if mode == "normal" and fresh and isinstance(value, (int, float)) and value >= 1.5 and not alarms:
                result = {"state": "normal", "device_id": str(DEVICE_ID)}
                if expected_id:
                    alarm = session.get(DeviceAlarm, expected_id)
                    require(alarm.state == "resolved", "Expected same incident to recover")
                    result = proof(session, alarm, "resolved")
                    notices = session.scalars(select(AlarmNotification).where(AlarmNotification.alarm_id == expected_id)).all()
                    require(sorted(item.kind for item in notices) == ["raised", "resolved"],
                            "Expected exactly one raised and one resolved notification; no ACK notification")
                print(json.dumps(result))
                return
        time.sleep(0.25)
    raise RuntimeError("MQTT telemetry/rule/notification verification timeout")


if __name__ == "__main__":
    main()
