"""Безперервний MQTT simulator лише для фіксованих TB-DEMO-* пристроїв."""

import argparse
import json
import logging
import os
import queue
import signal
import threading
import time
from pathlib import Path

import paho.mqtt.client as mqtt

from app.demo.catalog import LIVE_DEVICES, require_demo, uid
from app.demo.state import DemoState

LOGGER = logging.getLogger("techbaza.demo")
SCENARIO_TOPIC = "techbaza/demo/scenario"


def run(path):
    # Docker Linux: один writer-процес, щоб два simulator не міняли session наввипередки.
    import fcntl
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(str(path) + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _run_locked(path)


def _run_locked(path):
    state = DemoState(path)
    incoming = queue.Queue(maxsize=100)
    ready, stopped = threading.Event(), threading.Event()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="techbaza-demo-simulator", clean_session=True)
    client.max_queued_messages_set(100)
    client.reconnect_delay_set(min_delay=1, max_delay=10)

    def on_connect(client, userdata, flags, reason_code, properties):
        if reason_code == 0:
            client.subscribe([(f"techbaza/devices/{uid('pump')}/commands", 1), (SCENARIO_TOPIC, 1)])

    def on_subscribe(client, userdata, mid, reasons, properties):
        if reasons and all(not item.is_failure for item in reasons):
            ready.set()

    def on_disconnect(client, userdata, flags, reason, properties):
        ready.clear()

    def on_message(client, userdata, message):
        if message.retain or len(message.payload) > 8192:
            LOGGER.warning("Rejected retained or oversized demo command")
            return
        if message.topic not in {f"techbaza/devices/{uid('pump')}/commands", SCENARIO_TOPIC}:
            return
        try:
            incoming.put_nowait((message.topic, json.loads(message.payload)))
        except (ValueError, UnicodeError, queue.Full):
            LOGGER.warning("Rejected malformed command or full queue")

    def publish(topic, payload):
        info = client.publish(topic, json.dumps(payload), qos=1, retain=False)
        info.wait_for_publish(timeout=5)
        if not info.is_published():
            raise RuntimeError("Demo MQTT publish timeout")

    client.on_connect, client.on_subscribe = on_connect, on_subscribe
    client.on_disconnect, client.on_message = on_disconnect, on_message
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stopped.set())
    try:
        client.connect(os.getenv("MQTT_HOST", "mosquitto"), int(os.getenv("MQTT_PORT", "1883")), keepalive=20)
        client.loop_start()
        if not ready.wait(15):
            raise RuntimeError("Demo MQTT subscription timeout")
        state.boot()
        LOGGER.info("READY: 4 virtual devices; command ledger restored")
        next_tick = 0
        while not stopped.is_set():
            if not ready.wait(0.2):
                continue
            try:
                topic, raw = incoming.get(timeout=0.1)
                try:
                    if topic == SCENARIO_TOPIC:
                        if not isinstance(raw, dict) or set(raw) != {"device", "mode"}:
                            raise ValueError("Неправильний scenario envelope")
                        state.mode(raw["device"], raw["mode"])
                        LOGGER.info("Scenario changed: %s / %s", raw["device"], raw["mode"])
                    else:
                        fresh = state.command("pump", raw)
                        LOGGER.info("Command %s: %s", raw.get("command_id"), "recorded" if fresh else "replayed")
                except (ValueError, TypeError):
                    LOGGER.warning("Demo command rejected by validation/expiry/state")
            except queue.Empty:
                pass
            try:
                for row in state.pending():
                    if state.device(row["device"])["mode"] == "offline":
                        continue
                    root = f"techbaza/devices/{uid(row['device'])}/commands"
                    publish(root + "/ack", json.loads(row["ack"]))
                    publish(root + "/result", json.loads(row["result"]))
                    state.delivered(row["id"])
                if time.monotonic() >= next_tick:
                    for key in LIVE_DEVICES:
                        if state.device(key)["mode"] == "offline":
                            continue
                        root = f"techbaza/devices/{uid(key)}"
                        publish(root + "/heartbeat", state.envelope(key))
                        payload = state.telemetry(key)
                        if payload is not None:
                            publish(root + "/telemetry", payload)
                    next_tick = time.monotonic() + 3
            except RuntimeError:
                LOGGER.warning("MQTT delivery interrupted; durable replies remain pending")
                stopped.wait(1)
    finally:
        client.disconnect()
        client.loop_stop()
        state.close()


def main():
    require_demo()
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("run", "scenario", "status", "checkpoint", "verify-restart"))
    parser.add_argument("device", nargs="?")
    parser.add_argument("mode", nargs="?")
    parser.add_argument("--state", default=os.getenv("DEMO_STATE_PATH", "/state/demo.sqlite3"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.action == "run":
        run(args.state)
    else:
        state = DemoState(args.state)
        try:
            probe = Path(str(args.state) + ".restart.json")
            if args.action == "scenario":
                state.mode(args.device, args.mode)
            if args.action == "checkpoint":
                probe.write_text(json.dumps(state.checkpoint()))
                print("PASS: simulator restart checkpoint saved")
            elif args.action == "verify-restart":
                before = json.loads(probe.read_text())
                deadline = time.monotonic() + 20
                while True:
                    after = state.checkpoint()
                    if all(before["devices"][key]["session"] != after["devices"][key]["session"] for key in LIVE_DEVICES):
                        break
                    if time.monotonic() >= deadline:
                        raise RuntimeError("Simulator did not start a new boot session")
                    time.sleep(0.2)
                if before["ledger_digest"] != after["ledger_digest"]:
                    raise RuntimeError("Simulator command ledger changed during restart")
                for key in LIVE_DEVICES:
                    for field in ("running", "frequency", "mode", "executions"):
                        if before["devices"][key][field] != after["devices"][key][field]:
                            raise RuntimeError("Simulator state changed during restart")
                print("PASS: simulator restart preserved device state and command ledger; boot sessions changed")
            else:
                print(json.dumps({key: state.device(key) for key in LIVE_DEVICES}, indent=2))
        finally:
            state.close()


if __name__ == "__main__":
    main()
