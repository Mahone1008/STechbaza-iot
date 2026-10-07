"""Приймання backup/restore demo: тільки фіксовані identity та окремий target."""

import argparse
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid

from sqlalchemy import inspect, text

from app.db import SessionLocal, engine
from app.demo.catalog import email, identity, require_demo
from app.demo.check import API, Client, ensure, scenario, wait_for
from app.operations.backup import (create_manifest, sqlite_copy, sqlite_fingerprint, verify_bundle, write_private_json)
from app.operations.recovery import database_fingerprint, harden_restored_database

ROOT = Path("/backup")
STATE = Path(os.getenv("DEMO_STATE_PATH", "/state/demo.sqlite3"))
PUMP = f"/api/v1/devices/{identity('device:pump')}"


def require_target():
    require_demo()
    if os.getenv("TECHBAZA_ACCEPTANCE_MODE") != "1":
        raise RuntimeError("Restore actions дозволені лише в compose.acceptance.yml")


def assert_demo_database():
    require_demo()
    with engine.connect() as connection:
        ensure(connection.scalar(text("SELECT current_database()")) == "techbaza_demo", "Wrong demo database")


def raw(method, path, *, body=None, access=None, expected=200):
    headers = {"Content-Type": "application/json"}
    if access:
        headers["Authorization"] = "Bearer " + access
    req = Request(API + path, method=method, headers=headers,
                  data=json.dumps(body).encode() if body is not None else None)
    try:
        response = urlopen(req, timeout=10)
    except HTTPError as exc:
        response = exc
    with response:
        status, payload = response.status, response.read()
    ensure(status == expected, f"{method} {path}: expected {expected}, got {status}")
    return json.loads(payload) if payload else None


def canary():
    pair = raw("POST", "/api/v1/auth/login", body={"email": email("owner"), "password": os.environ["DEMO_OWNER_PASSWORD"]})
    # Активна session потрапляє до dump; після знімка source її відкликає.
    write_private_json(ROOT / "canary.json", {"pair": pair})
    scenario("pump", "offline")
    wait_for("pump offline before backup", lambda: not raw("GET", PUMP + "/availability", access=pair["access_token"])["online"])
    body = {"request_id": str(uuid.uuid4()), "command_type": "vfd.stop", "ttl_seconds": 300}
    command = raw("POST", PUMP + "/commands", body=body, access=pair["access_token"], expected=201)
    ensure(command["status"] == "queued" and command["publish_attempts"] == 0, "Expected queued STOP canary")
    write_private_json(ROOT / "canary-command.json", {"id": command["id"], "body": body})
    print("PASS: active login and queued STOP canaries prepared for restore protection", flush=True)


def source_resume():
    pair_path = ROOT / "canary.json"
    scenario("pump", "normal")
    if pair_path.exists():
        pair = json.loads(pair_path.read_text())["pair"]
        raw("POST", "/api/v1/auth/logout", body={"refresh_token": pair["refresh_token"]}, expected=204)
    client = Client("operator")
    try:
        wait_for("source telemetry resumed", lambda: client.overview("pump")["telemetry_freshness"]["status"] == "fresh")
        canary_path = ROOT / "canary-command.json"
        if canary_path.exists():
            record = json.loads(canary_path.read_text())
            wait_for("source STOP terminal", lambda: client.call("GET", "/api/v1/commands/" + record["id"])["status"] in ("succeeded", "expired", "cancelled", "result_unknown"))
    finally:
        client.logout()
    print("PASS: source demo resumed; source canary session revoked after backup", flush=True)


def compare_database():
    expected = json.loads((ROOT / "source.json").read_text())
    actual = database_fingerprint(engine)
    if actual != expected:
        # Лише names/counts/hashes та DDL із репозиторію; жодного row content.
        names = sorted(set(actual["tables"]) | set(expected["tables"]))
        differences = {name: {"source": expected["tables"].get(name), "restored": actual["tables"].get(name)}
                       for name in names if actual["tables"].get(name) != expected["tables"].get(name)}
        schemas = {name: {"source": expected["schema"].get(name), "restored": actual["schema"].get(name)}
                   for name in names if actual["schema"].get(name) != expected["schema"].get(name)}
        print("Restore comparison differences: " + json.dumps({"tables": differences, "schema": schemas}, default=str), flush=True)
        raise RuntimeError("Restored schema/row counts/content differ from source snapshot")
    return actual


def check_restored():
    require_target()
    pair = json.loads((ROOT / "canary.json").read_text())["pair"]
    raw("GET", "/api/v1/auth/me", access=pair["access_token"], expected=401)
    raw("POST", "/api/v1/auth/refresh", body={"refresh_token": pair["refresh_token"]}, expected=401)
    record = json.loads((ROOT / "canary-command.json").read_text())
    client = Client("owner")
    try:
        item = client.call("GET", "/api/v1/commands/" + record["id"])
        ensure(item["status"] == "expired" and item["error_code"] == "restore_delivery_cancelled"
               and item["publish_attempts"] == 0, "Restored command was not quarantined")
        repeat = client.call("POST", PUMP + "/commands", record["body"])
        ensure(repeat["id"] == item["id"] and repeat["status"] == "expired", "Old retry revived a restored command")
    finally:
        client.logout()
    result = {"old_access": 401, "old_refresh": 401, "canary_command": "expired", "publish_attempts": 0}
    receipt = ROOT / "restored-http.json"
    if receipt.exists():
        ensure(json.loads(receipt.read_text()) == result, "Restored HTTP result changed")
    else:
        write_private_json(receipt, result)
    print("PASS: restored old access/refresh denied; queued STOP never republished or revived", flush=True)


def main():
    require_demo()
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("empty", "snapshot", "compare", "guard", "sqlite-export", "sqlite-import",
                                          "manifest", "verify", "canary", "source-resume", "check-restored", "report"))
    parser.add_argument("--revision")
    args = parser.parse_args()
    if args.action in {"empty", "compare", "guard", "sqlite-import", "check-restored"}:
        require_target()
    if args.action in {"empty", "snapshot", "compare", "guard"}:
        assert_demo_database()
    if args.action == "empty":
        ensure(not inspect(engine).get_table_names(schema="public"), "Target database must be empty")
        print("PASS: isolated database is empty before migrations/restore")
    elif args.action == "snapshot":
        data = database_fingerprint(engine)
        for name in ("organizations", "users", "devices", "telemetry_messages", "device_commands",
                     "device_alarms", "alarm_notifications", "notification_reads"):
            ensure(data["tables"][name]["rows"] > 0, "Missing representative backup data: " + name)
        write_private_json(ROOT / "source.json", data)
        print(f"PASS: source schema and all {len(data['tables'])} tables fingerprinted")
    elif args.action == "compare":
        verify_bundle(ROOT)
        data = compare_database()
        write_private_json(ROOT / "restored.json", data)
        print(f"PASS: exact restore comparison - schema and all {len(data['tables'])} tables match")
    elif args.action == "guard":
        verify_bundle(ROOT)
        compare_database()
        with SessionLocal.begin() as session:
            counts = harden_restored_database(session)
        ensure(counts["revoked_sessions"] >= 1 and counts["cancelled_delivery"] >= 1, "Restore canaries missing")
        write_private_json(ROOT / "restore-guard.json", counts)
        print("PASS: restored sessions revoked; queued/published delivery disabled; ACK results remain unknown")
    elif args.action == "sqlite-export":
        sqlite_copy(STATE, ROOT / "simulator.sqlite3")
        ensure(sqlite_fingerprint(STATE) == sqlite_fingerprint(ROOT / "simulator.sqlite3"), "SQLite backup mismatch")
        print("PASS: SQLite backup includes device state, command ledger and pending replies")
    elif args.action == "sqlite-import":
        verify_bundle(ROOT)
        sqlite_copy(ROOT / "simulator.sqlite3", STATE)
        ensure(sqlite_fingerprint(STATE) == sqlite_fingerprint(ROOT / "simulator.sqlite3"), "SQLite restore mismatch")
        write_private_json(ROOT / "restored-simulator.json", sqlite_fingerprint(STATE))
        print("PASS: SQLite restore matches all device and command rows")
    elif args.action == "manifest":
        create_manifest(ROOT, args.revision or "")
        print("PASS: private backup manifest created with SHA-256 hashes")
    elif args.action == "verify":
        verify_bundle(ROOT)
        print("PASS: all backup file sizes and SHA-256 hashes verified")
    elif args.action == "canary":
        canary()
    elif args.action == "source-resume":
        source_resume()
    elif args.action == "check-restored":
        check_restored()
    elif args.action == "report":
        manifest = verify_bundle(ROOT)
        source = json.loads((ROOT / "source.json").read_text())
        restored = json.loads((ROOT / "restored.json").read_text())
        ensure(source == restored, "Final comparison failed")
        guard = json.loads((ROOT / "restore-guard.json").read_text())
        http = json.loads((ROOT / "restored-http.json").read_text())
        simulator = json.loads((ROOT / "restored-simulator.json").read_text())
        ensure(simulator == sqlite_fingerprint(ROOT / "simulator.sqlite3"), "Final simulator comparison failed")
        write_private_json(ROOT / "acceptance-report.json", {"status": "passed", "backend": "0.52.0",
            "git_revision": manifest["git_revision"], "migration": manifest["migration"],
            "tables_compared": len(source["tables"]), "restore_guard": guard, "restored_http": http,
            "sqlite_exact_match": True, "clean_install_and_live_restore": True})
        # Допоміжні canary tokens не входять у backup bundle і більше не потрібні.
        (ROOT / "canary.json").unlink()
        (ROOT / "canary-command.json").unlink()
        print("PASS: Stage 8 operation 6 - clean install, exact backup/restore and safe live recovery")


if __name__ == "__main__":
    main()

