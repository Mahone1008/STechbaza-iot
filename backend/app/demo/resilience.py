"""Живі fault/recovery сценарії demo через HTTP та MQTT без прямого запису в БД.

Фази розділено, щоб зовнішній Docker Compose дійсно перезапускав backend
та зупиняв broker. Checkpoint не містить токенів/паролів і переживає restart
того самого контейнера; recreate між фазами навмисно не підтримується.
"""

import argparse
import json
from pathlib import Path
import uuid
from urllib.error import URLError
from urllib.request import urlopen

from app.demo.catalog import identity, require_demo
from app.demo.check import API, Client, command, ensure, scenario, wait_for

CHECKPOINT = Path("/tmp/techbaza-demo-resilience.json")
PUMP = f"/api/v1/devices/{identity('device:pump')}"


def ready():
    try:
        with urlopen(API + "/health", timeout=2) as response:
            return json.load(response)["version"] == "0.36.0"
    except (URLError, TimeoutError, ConnectionError):
        return False


def save(data):
    temporary = CHECKPOINT.with_suffix(".tmp")
    temporary.write_text(json.dumps(data), encoding="utf-8")
    temporary.replace(CHECKPOINT)


def load(phase):
    data = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
    ensure(data["phase"] == phase, "Wrong resilience checkpoint phase")
    return data


def queued(client, frequency, ttl=300):
    body = {"request_id": str(uuid.uuid4()), "command_type": "vfd.frequency.set",
            "payload": {"frequency_hz": frequency}, "ttl_seconds": ttl}
    item = client.call("POST", PUMP + "/commands", body, expected=201)
    ensure(item["status"] == "queued" and item["publish_attempts"] == 0, "Offline command was published")
    return {"body": body, "id": item["id"], "created_at": item["created_at"], "expires_at": item["expires_at"]}


def read(client, record):
    item = client.call("GET", "/api/v1/commands/" + record["id"])
    ensure(item["request_id"] == record["body"]["request_id"], "Command identity changed")
    ensure(item["created_at"] == record["created_at"] and item["expires_at"] == record["expires_at"],
           "Restart/retry changed command lifetime")
    return item


def offline(client):
    wait_for("pump offline", lambda: not client.overview("pump")["availability"]["online"])
    wait_for("pump stale readings", lambda: client.overview("pump")["telemetry_freshness"]["status"] == "stale")
    alarms = wait_for("offline alarm", lambda: client.call("GET", PUMP + "/alarms?state=active&alarm_type=device.offline"))
    ensure(len(alarms) == 1, "Expected one active offline incident")
    return alarms[0]["id"]


def recover(owner, operator, data):
    def succeeded():
        item = read(operator, data["pending"])
        if item["status"] in {"failed", "expired", "result_unknown"}:
            raise RuntimeError("Queued command recovery failed: " + item["status"])
        return item if item["status"] == "succeeded" else None
    result = wait_for("queued command result after reconnect", succeeded, timeout=90)
    ensure(result["result"]["frequency_hz"] == data["pending"]["body"]["payload"]["frequency_hz"], "Wrong frequency result")
    repeat = operator.call("POST", PUMP + "/commands", data["pending"]["body"])
    ensure(repeat["id"] == result["id"] and repeat["status"] == "succeeded", "Retry duplicated command")
    wait_for("live readings restored", lambda: owner.overview("pump")["telemetry_freshness"]["status"] == "fresh")
    wait_for("offline incident resolved", lambda:
             owner.call("GET", "/api/v1/alarms/" + data["alarm"])["state"] == "resolved")
    transitions = owner.call("GET", "/api/v1/alarms/" + data["alarm"] + "/transitions")
    ensure(sum(t["transition_type"] == "resolved" for t in transitions) == 1, "Offline recovery duplicated transition")
    command(operator, "vfd.start")
    wait_for("recovered pump telemetry", lambda:
             owner.overview("pump")["snapshot"]["values"].get("vfd.frequency_hz") == result["result"]["frequency_hz"])
    command(operator, "vfd.stop")
    wait_for("pump stopped after check", lambda: owner.overview("pump")["snapshot"]["state"].get("pump_running") is False)


def run(phase):
    require_demo()
    wait_for("backend 0.36.0", ready, timeout=60)
    clients = []
    try:
        owner = Client("owner")
        clients.append(owner)
        operator = Client("operator")
        clients.append(operator)
        if phase == "prepare-restart":
            scenario("pump", "normal")
            wait_for("pump online before fault", lambda: owner.overview("pump")["availability"]["online"])
            command(operator, "vfd.stop")
            scenario("pump", "offline")
            alarm = offline(owner)
            pending = queued(operator, 27)
            expired = queued(operator, 19, ttl=5)
            save({"phase": "restart", "pending": pending, "expired": expired, "alarm": alarm})
            print("PASS: offline/stale/one alarm; two commands queued, restart checkpoint saved", flush=True)
        elif phase == "verify-restart":
            data = load("restart")
            ensure(read(operator, data["pending"])["status"] == "queued", "Backend restart lost pending queue")
            wait_for("short TTL expiry after backend restart", lambda: read(operator, data["expired"])["status"] == "expired")
            ensure(read(operator, data["expired"])["publish_attempts"] == 0, "Expired command was published")
            scenario("pump", "normal")
            recover(owner, operator, data)
            ensure(read(operator, data["expired"])["status"] == "expired", "Expired command revived after reconnect")
            ensure(read(operator, data["expired"])["publish_attempts"] == 0, "Expired command sent after reconnect")
            save({"phase": "restart-passed"})
            print("PASS: backend restart preserved queue/TTL; recovery succeeded; expired command never published", flush=True)
        elif phase == "broker-down":
            load("restart-passed")
            alarm = offline(owner)
            pending = queued(operator, 29)
            save({"phase": "broker", "pending": pending, "alarm": alarm})
            print("PASS: broker outage leaves HTTP readable, shows offline/stale/alarm, preserves queued command", flush=True)
        elif phase == "broker-recovered":
            data = load("broker")
            recover(owner, operator, data)
            save({"phase": "complete"})
            print("PASS: broker reconnect restored telemetry/commands and resolved offline incident; pump stopped", flush=True)
    finally:
        for client in clients:
            client.logout()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("prepare-restart", "verify-restart", "broker-down", "broker-recovered"))
    run(parser.parse_args().phase)
