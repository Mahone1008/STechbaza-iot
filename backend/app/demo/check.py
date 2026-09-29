"""Перевірка живого demo HTTP → MQTT → simulator → backend без прямого запису у БД."""

import argparse
import http.cookiejar
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener

from paho.mqtt.publish import single

from app.demo.catalog import ACCOUNTS, DEVICES, email, identity, require_demo

API = "http://backend:8000"
ORIGIN = "http://127.0.0.1:3000"


def ensure(condition, message):
    if not condition:
        raise RuntimeError(message)


def wait_for(label, read, timeout=45):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        result = read()
        if result:
            return result
        time.sleep(0.4)
    raise RuntimeError("Demo check timeout: " + label)


class Client:
    def __init__(self, account, *, session_file=None):
        # Лише міжпроцесні resilience-тести використовують окремий приватний cookie file.
        self.session_file = session_file
        jar = http.cookiejar.LWPCookieJar(str(session_file)) if session_file else http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(jar))
        self.access = None
        if session_file and session_file.exists():
            jar.load(ignore_discard=True)
            result = self.call("POST", "/api/v1/auth/browser/refresh")
        else:
            result = self.call("POST", "/api/v1/auth/browser/login", {
                "email": email(account), "password": os.environ["DEMO_" + account.upper() + "_PASSWORD"],
            })
        self.access = result["access_token"]
        if session_file:
            fd = os.open(session_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            os.close(fd)
            jar.save(ignore_discard=True)

    def call(self, method, path, body=None, expected=200):
        headers = {"Origin": ORIGIN, "X-TechBaza-CSRF": "1"}
        if self.access:
            headers["Authorization"] = "Bearer " + self.access
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(API + path, method=method, headers=headers,
                          data=json.dumps(body).encode() if body is not None else None)
        try:
            response = self.opener.open(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            status, raw = response.status, response.read()
        # Не друкувати auth response або credentials навіть при відмові.
        ensure(status == expected, f"{method} {path}: expected {expected}, got {status}")
        return json.loads(raw) if raw else None

    def overview(self, key):
        return self.call("GET", f"/api/v1/devices/{identity('device:' + key)}/overview")

    def logout(self):
        self.call("POST", "/api/v1/auth/browser/logout", expected=204)
        if self.session_file:
            self.session_file.unlink(missing_ok=True)


def scenario(key, mode):
    single("techbaza/demo/scenario", json.dumps({"device": key, "mode": mode}), qos=1,
           retain=False, hostname=os.getenv("MQTT_HOST", "mosquitto"), port=int(os.getenv("MQTT_PORT", "1883")))


def command(client, kind, payload=None, expected_result="succeeded"):
    body = {"request_id": str(uuid.uuid4()), "command_type": kind, "payload": payload or {}, "ttl_seconds": 30}
    path = f"/api/v1/devices/{identity('device:pump')}/commands"
    first = client.call("POST", path, body, expected=201)
    repeat = client.call("POST", path, body)
    ensure(first["id"] == repeat["id"], "Command request_id did not deduplicate")

    def terminal():
        result = client.call("GET", "/api/v1/commands/" + first["id"])
        if result["status"] in {"failed", "succeeded", "expired", "result_unknown", "cancelled"}:
            ensure(result["status"] == expected_result, "Unexpected demo command result: " + result["status"])
            ensure(result["actor_organization_role"] == "operator", "Command actor audit missing")
            return result
        return None

    return wait_for(kind, terminal)


def check_module_contract(overview):
    """Перевірити зв'язки, за якими перший UI будує панель пристрою."""
    modules = overview["modules"]
    ensure([item["code"] for item in modules] == [item["code"] for item in overview["capabilities"]],
           "Module list differs from enabled capabilities")
    descriptors = [channel for module in modules for channel in module["channels"]]
    for source, keys_field, readings_field in (("values", "value_keys", "readings"), ("state", "state_keys", "state_readings")):
        keys = sorted(item["key"] for item in descriptors if item["source"] == source)
        ensure(keys == overview[keys_field], "Module channels differ from overview keys")
        ensure(keys == [item["key"] for item in overview[readings_field]], "Module readings are incomplete")
    ensure(sorted(command for module in modules for command in module["command_types"]) == overview["command_types"],
           "Module commands differ from command types")
    ensure(sorted(command for module in modules for command in module["allowed_commands"]) == overview["allowed_commands"],
           "Module commands differ from role permissions")
    ensure(all(module["supported"] for module in modules), "Demo has an unsupported module")
    numeric = {item["key"]: item for item in overview["readings"]}
    for channel in descriptors:
        ensure(channel["supports_series"] == (channel["source"] == "values"), "Unexpected chart support")
        if channel["source"] == "values":
            ensure(channel["unit"] == numeric[channel["key"]]["unit"], "Channel unit differs from reading")


def run(quick=False):
    require_demo()
    clients = {}
    try:
        for account in ACCOUNTS:
            clients[account] = Client(account)
        owner, operator, viewer, other = [clients[key] for key in ("owner", "operator", "viewer", "other")]
        if not quick:
            for key in ("pump", "pressure", "stale", "other"):
                scenario(key, "normal")
        health = owner.call("GET", "/health")
        ensure(health["version"] == "0.39.0" and health["status"] == "ok", "Expected demo backend 0.39.0")
        for key, client in clients.items():
            orgs = client.call("GET", "/api/v1/organizations")
            ensure([item["id"] for item in orgs] == [str(identity("org:" + ACCOUNTS[key][0]))], "Tenant list leak")
        owner.call("GET", f"/api/v1/devices/{identity('device:other')}/overview", expected=404)
        other.call("GET", f"/api/v1/devices/{identity('device:pump')}/overview", expected=404)
        viewer.call("POST", f"/api/v1/devices/{identity('device:pump')}/commands",
                    {"request_id": str(uuid.uuid4()), "command_type": "vfd.start"}, expected=403)
        for key in ("pump", "pressure", "other"):
            client = other if key == "other" else owner
            wait_for(key + " live telemetry", lambda key=key, client=client:
                client.overview(key)["telemetry_freshness"]["status"] == "fresh")
            ensure({cap["code"] for cap in client.overview(key)["capabilities"]} == set(DEVICES[key]["caps"]),
                   "Wrong modular device capabilities")
        wait_for("stale heartbeat", lambda: owner.overview("stale")["availability"]["online"])
        ensure(owner.overview("stale")["telemetry_freshness"]["status"] == "stale", "Heartbeat freshened old values")
        ensure(not owner.overview("offline")["availability"]["online"], "Offline fixture unexpectedly online")
        ensure(owner.overview("new")["snapshot"] is None, "New device unexpectedly has telemetry")
        for key in DEVICES:
            check_module_contract((other if key == "other" else owner).overview(key))
        viewer_overview = viewer.overview("pump")
        check_module_contract(viewer_overview)
        ensure(not any(module["allowed_commands"] for module in viewer_overview["modules"]), "Viewer module commands leak")
        check_module_contract(operator.overview("pump"))
        print("PASS: module/channel contract, units, chart support, state readings and role-aware commands", flush=True)
        print("PASS: four logins, tenant isolation, viewer 403, modular/live/stale/offline/new states", flush=True)
        if quick:
            return

        command(operator, "vfd.frequency.set", {"frequency_hz": 33})
        command(operator, "vfd.start")
        wait_for("pump telemetry after command", lambda: owner.overview("pump")["snapshot"]["values"].get("vfd.frequency_hz") == 33)
        command(operator, "vfd.stop")
        wait_for("pump stopped", lambda: owner.overview("pump")["snapshot"]["state"].get("pump_running") is False)
        print("PASS: HTTP commands, MQTT ACK/Result, request_id deduplication, telemetry and actor audit", flush=True)

        end = datetime.now(timezone.utc)
        query = urlencode({"metric": "pressure.bar", "start": (end - timedelta(minutes=5)).isoformat(),
                           "end": end.isoformat(), "bucket_seconds": 30})
        series = owner.call("GET", f"/api/v1/devices/{identity('device:pressure')}/telemetry/series?{query}")
        ensure(series["sample_count"] > 0 and series["time_basis"] == "server_received_at", "Series has no live data")

        scenario("pressure", "alarm")
        alarm_path = f"/api/v1/devices/{identity('device:pressure')}/alarms?state=active&alarm_type=demo.pressure.low"
        alarm = wait_for("low pressure alarm", lambda: owner.call("GET", alarm_path))[0]
        viewer.call("POST", f"/api/v1/alarms/{alarm['id']}/acknowledge", expected=403)
        acknowledged = owner.call("POST", f"/api/v1/alarms/{alarm['id']}/acknowledge")
        ensure(acknowledged["acknowledged_at"] is not None, "Alarm acknowledgement missing")
        feed = owner.call("GET", f"/api/v1/organizations/{identity('org:a')}/notifications")
        notice = next(item for item in feed if item["alarm_id"] == alarm["id"] and item["kind"] == "raised")
        viewer.call("POST", f"/api/v1/notifications/{notice['id']}/read")
        ensure(owner.call("GET", f"/api/v1/notifications/{notice['id']}")["read_at"] is None, "Read receipt leaked to owner")
        scenario("pressure", "normal")
        wait_for("pressure recovery", lambda: owner.call("GET", f"/api/v1/alarms/{alarm['id']}")["state"] == "resolved")
        scenario("pressure", "gap")
        wait_for("missing pressure", lambda: owner.overview("pressure")["readings"][0]["status"] == "missing")
        scenario("pressure", "normal")
        wait_for("pressure restored", lambda: owner.overview("pressure")["readings"][0]["status"] == "fresh")
        print("PASS: chart, low-pressure alarm, acknowledgement, personal notification read, recovery and data gap", flush=True)

        scenario("pump", "fault")
        wait_for("VFD fault", lambda: owner.overview("pump")["snapshot"]["state"].get("vfd_fault_code") == 42)
        failure = command(operator, "vfd.start", expected_result="failed")
        ensure(failure["error_code"] == "demo_vfd_fault", "Missing simulated failure reason")
        command(operator, "vfd.stop")
        scenario("pump", "normal")
        wait_for("VFD recovered", lambda: owner.overview("pump")["snapshot"]["state"].get("vfd_fault_code") == 0)
        print("PASS: VFD failure is failed, Stop remains available, normal mode restored", flush=True)
    finally:
        # Повторний запуск перевірки починається зі звичайних сценаріїв.
        if not quick:
            for key in ("pump", "pressure"):
                try:
                    scenario(key, "normal")
                except Exception:
                    pass
        for client in clients.values():
            client.logout()
    print("PASS: Stage 8 operation 4 - live demo acceptance complete", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true")
    run(parser.parse_args().quick)

