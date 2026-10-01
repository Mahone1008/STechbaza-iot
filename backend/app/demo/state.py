"""Durable стан симулятора та outbox відповідей; жодного підключення до PostgreSQL."""

import hashlib
import json
import math
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.demo.catalog import LIVE_DEVICES
from app.schemas.command import CommandEnvelope, DeviceCommandCreate
from app.schemas.program import PROGRAM_ACTIVE_STATES, ProgramPlan
from app.schemas.schedule import ScheduleRun

MODES = {
    "pump": ("normal", "fault", "offline"),
    "pressure": ("normal", "alarm", "gap", "offline"),
    "stale": ("normal", "offline"),
    "other": ("normal", "offline"),
}


class DemoState:
    def __init__(self, path, *, monotonic=time.monotonic):
        self._monotonic = monotonic
        self._boot_time = monotonic()
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS devices (
                key TEXT PRIMARY KEY, session TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0,
                running INTEGER NOT NULL DEFAULT 0, frequency REAL NOT NULL DEFAULT 40,
                mode TEXT NOT NULL DEFAULT 'normal', executions INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS programs (
                device TEXT PRIMARY KEY, command_id TEXT NOT NULL, plan TEXT NOT NULL,
                state TEXT NOT NULL, step INTEGER NOT NULL, remaining INTEGER NOT NULL,
                hold_started REAL NOT NULL, reason TEXT
            );
            CREATE TABLE IF NOT EXISTS commands (
                id TEXT PRIMARY KEY, device TEXT NOT NULL, fingerprint TEXT NOT NULL,
                ack TEXT NOT NULL, result TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 1
            );
        """)
        if "control_sequence" not in {row[1] for row in self.db.execute("PRAGMA table_info(devices)")}:
            self.db.execute("ALTER TABLE devices ADD COLUMN control_sequence INTEGER NOT NULL DEFAULT 0")
        with self.db:
            for key in LIVE_DEVICES:
                self.db.execute("INSERT OR IGNORE INTO devices (key, session) VALUES (?, ?)", (key, str(uuid.uuid4())))

    def close(self):
        self.db.close()

    def boot(self):
        self.interrupt_program("restart_recovery")
        self._boot_time = self._monotonic()
        with self.db:
            for key in LIVE_DEVICES:
                self.db.execute("UPDATE devices SET session=?, sequence=0 WHERE key=?", (str(uuid.uuid4()), key))

    def device(self, key):
        row = self.db.execute("SELECT * FROM devices WHERE key=?", (key,)).fetchone()
        if row is None:
            raise ValueError("Невідомий live demo device")
        return dict(row)

    def mode(self, key, mode):
        if mode not in MODES.get(key, ()):
            raise ValueError("Непідтримуваний demo scenario")
        if key == "pump" and mode in {"fault", "offline"}:
            self.interrupt_program("vfd_fault" if mode == "fault" else "network_lost")
        with self.db:
            self.db.execute("UPDATE devices SET mode=?, running=CASE WHEN ?='fault' THEN 0 ELSE running END WHERE key=?",
                            (mode, mode, key))

    def envelope(self, key):
        with self.db:
            self.db.execute("UPDATE devices SET sequence=sequence+1 WHERE key=?", (key,))
            item = self.device(key)
        return {"schema_version": 1, "message_id": str(uuid.uuid4()), "session_id": item["session"],
                "sequence": item["sequence"], "sent_at": datetime.now(timezone.utc).isoformat()}

    def telemetry(self, key):
        item = self.device(key)
        if item["mode"] == "offline" or key == "stale":
            return None
        packet = self.envelope(key)
        wave = round(math.sin(packet["sequence"] / 8) * 0.15, 3)
        values, state = {}, {}
        if key == "pump":
            running = bool(item["running"]) and item["mode"] != "fault"
            values = {"vfd.frequency_hz": item["frequency"] if running else 0,
                      "vfd.current_a": round(item["frequency"] * 0.15, 2) if running else 0,
                      "pressure.bar": round(2.5 + wave, 3) if running else 0}
            state = {"pump_running": running, "vfd_fault_code": 42 if item["mode"] == "fault" else 0,
                     "local_mode": False, "emergency_stop": False}
        elif item["mode"] != "gap":
            values = {"pressure.bar": 0.4 if item["mode"] == "alarm" else round(2.5 + wave, 3)}
        if key == "pump":
            packet["diagnostics"] = {
                "version": 1, "firmware_version": "simulator-0.4.0",
                "uptime_ms": max(0, int((self._monotonic() - self._boot_time) * 1000)),
                "reset_reason": "software", "connection": {"transport": "unknown", "signal": None},
                "last_stop": None, "program": self.program_progress(),
            }
        return {**packet, "values": values, "state": state}

    def command(self, key, raw, *, now=None):
        if key != "pump":
            raise ValueError("Цей demo device не має vfd.control")
        envelope = CommandEnvelope.model_validate(raw)
        DeviceCommandCreate(request_id=envelope.request_id, command_type=envelope.command_type,
                            payload=envelope.payload, ttl_seconds=envelope.ttl_seconds)
        if envelope.expires_at.tzinfo is None or envelope.issued_at.tzinfo is None:
            raise ValueError("Command timestamps потребують timezone")
        encoded = envelope.model_dump(mode="json")
        if envelope.schema_version == 1:
            encoded.pop("control_sequence", None)  # Зберігаємо сумісність відбитків legacy ledger.
        fingerprint = hashlib.sha256(json.dumps(encoded, sort_keys=True).encode()).hexdigest()
        command_id = str(envelope.command_id)
        self.db.execute("BEGIN IMMEDIATE")
        try:
            stored = self.db.execute("SELECT * FROM commands WHERE id=?", (command_id,)).fetchone()
            if stored:
                if stored["device"] != key or stored["fingerprint"] != fingerprint:
                    raise ValueError("Той самий command_id має інший envelope")
                self.db.execute("UPDATE commands SET pending=1 WHERE id=?", (command_id,))
                self.db.commit()
                return False
            if envelope.schema_version != 2:
                raise ValueError("Нові команди потребують protocol v2")
            item = self.device(key)
            current = now or datetime.now(timezone.utc)
            if current >= envelope.expires_at or envelope.issued_at > current:
                raise ValueError("Команда прострочена або ще не видана")
            if item["mode"] == "offline":
                raise ValueError("Demo device offline")
            error_code = error_message = None
            if (envelope.schema_version == 1 and item["control_sequence"] > 0) or (
                envelope.control_sequence is not None and envelope.control_sequence <= item["control_sequence"]
            ):
                error_code, error_message = "command_out_of_order", "Новішу команду вже прийнято; застарілу дію відхилено"
            else:
                if envelope.control_sequence is not None:
                    # Атомарно зі станом та outbox; номер не скидається під час boot.
                    self.db.execute("UPDATE devices SET control_sequence=? WHERE key=?", (envelope.control_sequence, key))
                if item["mode"] == "fault" and envelope.command_type != "vfd.stop":
                    error_code, error_message = "demo_vfd_fault", "Demo VFD fault scenario"
                if envelope.command_type == "vfd.frequency.set" and not 0 <= float(envelope.payload["frequency_hz"]) <= 50:
                    error_code, error_message = "frequency_out_of_range", "Діапазон demo VFD: 0–50 Гц"
            progress = self.program_progress()
            if not error_code and progress["state"] in PROGRAM_ACTIVE_STATES and envelope.command_type != "vfd.stop":
                error_code, error_message = "busy", "Програма вже виконується"
            if not error_code and envelope.command_type in {"vfd.program.start", "vfd.schedule.start"}:
                plan = (ScheduleRun if envelope.command_type == "vfd.schedule.start" else ProgramPlan).model_validate(envelope.payload)
                if isinstance(plan, ScheduleRun) and not 0 <= (current - plan.starts_at).total_seconds() < min(30, plan.steps[0].duration_seconds):
                    error_code, error_message = "command_expired", "Календарне вікно запуску минуло"
                if item["running"] or any(step.frequency_hz > 50 for step in plan.steps):
                    error_code, error_message = "program_invalid", "Потрібна зупинка та частоти в межах demo-профілю"
            failed = error_code is not None
            result = {}
            if not failed:
                if envelope.command_type in {"vfd.program.start", "vfd.schedule.start"}:
                    first = plan.steps[0]
                    self.db.execute("INSERT OR REPLACE INTO programs VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (key, command_id, json.dumps(envelope.payload), "holding", 0, first.duration_seconds, self._monotonic() - ((current - plan.starts_at).total_seconds() if isinstance(plan, ScheduleRun) else 0), None))
                    self.db.execute("UPDATE devices SET running=1, frequency=? WHERE key=?", (first.frequency_hz, key))
                elif envelope.command_type == "vfd.frequency.set":
                    value = float(envelope.payload["frequency_hz"])
                    self.db.execute("UPDATE devices SET frequency=? WHERE key=?", (value, key))
                    result = {"frequency_hz": value}
                else:
                    if envelope.command_type == "vfd.stop":
                        self._finish_program("command")
                    running = envelope.command_type == "vfd.start"
                    self.db.execute("UPDATE devices SET running=? WHERE key=?", (int(running), key))
                    result = {"pump_running": running}
                self.db.execute("UPDATE devices SET executions=executions+1 WHERE key=?", (key,))
            common = {"schema_version": 1, "command_id": command_id, "session_id": item["session"],
                      "sent_at": current.isoformat()}
            ack = {**common, "message_id": str(uuid.uuid4())}
            terminal = {**common, "message_id": str(uuid.uuid4()), "status": "failed" if failed else "succeeded",
                        "result": result, "error_code": error_code,
                        "error_message": error_message}
            if not failed and envelope.command_type in {"vfd.program.start", "vfd.schedule.start"}:
                terminal = None  # ACK одразу, фінальний Result лише після завершення програми/STOP.
            self.db.execute("INSERT INTO commands (id, device, fingerprint, ack, result) VALUES (?, ?, ?, ?, ?)",
                            (command_id, key, fingerprint, json.dumps(ack), json.dumps(terminal)))
            # Стан віртуального пристрою і відповіді фіксуються до першого publish.
            self.db.commit()
            return True
        except Exception:
            self.db.rollback()
            raise

    def program_progress(self):
        row = self.db.execute("SELECT * FROM programs WHERE device='pump'").fetchone()
        ready = self.device("pump")["mode"] == "normal"
        if row is None:
            return {"version": 1, "ready": ready, "supports_schedule": True, "command_id": None, "state": "idle", "step_index": 0,
                    "step_count": 0, "target_frequency_hz": None, "remaining_seconds": None, "reason": None}
        steps = json.loads(row["plan"])["steps"]
        return {"version": 1, "ready": ready, "supports_schedule": True, "command_id": row["command_id"], "state": row["state"],
                "step_index": row["step"] + 1, "step_count": len(steps),
                "target_frequency_hz": steps[row["step"]]["frequency_hz"],
                "remaining_seconds": row["remaining"] if row["state"] == "holding" else None, "reason": row["reason"]}

    def _finish_program(self, reason):
        row = self.db.execute("SELECT * FROM programs WHERE device='pump'").fetchone()
        if row is None or row["state"] not in PROGRAM_ACTIVE_STATES:
            return
        completed = reason == "program_completed"
        cancelled = reason in {"command", "local_disarm"}
        state = "completed" if completed else "interrupted" if cancelled or reason == "restart_recovery" else "failed"
        error = None if completed else "program_cancelled" if cancelled else "restart_during_execution" if reason == "restart_recovery" else reason
        stored = self.db.execute("SELECT ack FROM commands WHERE id=?", (row["command_id"],)).fetchone()
        ack = json.loads(stored["ack"])
        count = len(json.loads(row["plan"])["steps"])
        result = {**ack, "message_id": str(uuid.uuid4()), "sent_at": datetime.now(timezone.utc).isoformat(),
                  "status": "succeeded" if completed else "failed", "error_code": error, "error_message": error,
                  "result": {"steps_completed": count if completed else row["step"], "step_count": count,
                             "stop_confirmed": True, "frequency_hz": 0}}
        self.db.execute("UPDATE programs SET state=?, remaining=0, reason=? WHERE device='pump'", (state, reason))
        self.db.execute("UPDATE devices SET running=0 WHERE key='pump'")
        self.db.execute("UPDATE commands SET result=?, pending=1 WHERE id=?", (json.dumps(result), row["command_id"]))

    def interrupt_program(self, reason):
        with self.db:
            self._finish_program(reason)

    def tick_program(self):
        with self.db:
            row = self.db.execute("SELECT * FROM programs WHERE device='pump'").fetchone()
            if row is None or row["state"] != "holding":
                return
            plan = json.loads(row["plan"])
            steps = plan["steps"]
            if "starts_at" in plan:
                elapsed = self._monotonic() - row["hold_started"]
                total = 0
                for index, step in enumerate(steps):
                    total += step["duration_seconds"]
                    if elapsed < total:
                        self.db.execute("UPDATE programs SET step=?, remaining=? WHERE device='pump'", (index, math.ceil(total-elapsed)))
                        self.db.execute("UPDATE devices SET frequency=? WHERE key='pump'", (step["frequency_hz"],))
                        return
                self.db.execute("UPDATE programs SET step=? WHERE device='pump'", (len(steps)-1,))
                self._finish_program("program_completed")
                return
            remaining = max(0, math.ceil(steps[row["step"]]["duration_seconds"] - (self._monotonic() - row["hold_started"])))
            if remaining:
                if remaining != row["remaining"]:
                    self.db.execute("UPDATE programs SET remaining=? WHERE device='pump'", (remaining,))
            elif row["step"] + 1 == len(steps):
                self._finish_program("program_completed")
            else:
                step = row["step"] + 1
                self.db.execute("UPDATE programs SET step=?, remaining=?, hold_started=? WHERE device='pump'",
                                (step, steps[step]["duration_seconds"], self._monotonic()))
                self.db.execute("UPDATE devices SET frequency=? WHERE key='pump'", (steps[step]["frequency_hz"],))

    def pending(self):
        return [dict(row) for row in self.db.execute("SELECT * FROM commands WHERE pending=1 ORDER BY rowid LIMIT 100")]

    def delivered(self, command_id):
        with self.db:
            self.db.execute("UPDATE commands SET pending=0 WHERE id=?", (command_id,))

    def checkpoint(self):
        records = [tuple(row) for row in self.db.execute("SELECT id, device, fingerprint, ack, result FROM commands ORDER BY id")]
        return {"devices": {key: self.device(key) for key in LIVE_DEVICES},
                "ledger_digest": hashlib.sha256(json.dumps(records).encode()).hexdigest()}

