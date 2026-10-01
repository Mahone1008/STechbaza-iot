"""Справжні транзакції, HTTP/RBAC та гонки календарних запусків у тестовій БД."""
import os
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert

import test_comprehensive_postgres as base
from app.db import SessionLocal
from app.models.auth_session import AuthSession
from app.models.capability import Capability, DeviceCapability
from app.models.command import DeviceCommand
from app.models.device import Device
from app.models.organization_membership import OrganizationMembership
from app.models.schedule import DeviceSchedule, ScheduleOccurrence, ScheduleRevision
from app.models.site import Site
from app.models.telemetry import DeviceState
from app.repositories.schedules import ScheduleRepository
from app.schemas.schedule import ScheduleSpec
from app.services.command_dispatch import CommandDispatchService
from app.services.schedule_worker import process_schedule
from app.services.schedules import refresh_next


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class SchedulePostgresTests(unittest.TestCase):
    call = base.ComprehensivePostgresTests.call
    cleanup_data = base.ComprehensivePostgresTests.cleanup_data

    def setUp(self):
        base.ComprehensivePostgresTests.setUp(self)
        self.due = self.now.replace(second=0, microsecond=0) + timedelta(minutes=2)
        self.rule = dict(name="Test schedule", timezone="UTC", start_date=self.due.date().isoformat(),
            until_date=self.due.date().isoformat(), start_time=self.due.strftime("%H:%M"),
            stop_time=(self.due + timedelta(minutes=2)).strftime("%H:%M"),
            stop_day_offset=int((self.due + timedelta(minutes=2)).date() != self.due.date()), frequency_hz=40)
        with SessionLocal() as session:
            session.get(Site, self.sites[0]).timezone = "UTC"
            for code in ("vfd.program", "vfd.schedule"):
                created = session.scalar(insert(Capability).values(id=uuid.uuid4(), code=code, name="Schedule test")
                    .on_conflict_do_nothing(index_elements=["code"]).returning(Capability.id))
                if created: self.created_caps.append(created)
                cap_id = session.scalar(select(Capability.id).where(Capability.code == code))
                session.add(DeviceCapability(device_id=self.devices[0], capability_id=cap_id, is_enabled=True, config={}))
            control = session.scalar(select(DeviceCapability).where(DeviceCapability.device_id == self.devices[0], DeviceCapability.capability_id == self.caps["vfd.control"]))
            control.config = {"frequency_limits": {"min_hz": 20, "max_hz": 50}}
            session.commit()
        self.fresh(self.due)

    def fresh(self, now, *, supported=True, max_schedule_seconds=86400):
        with SessionLocal() as session:
            device = session.get(Device, self.devices[0]); device.last_seen_at = now; device.last_observed_session_id = self.boot
            snapshot = session.get(DeviceState, device.id) or DeviceState(device_id=device.id)
            snapshot.last_received_at = now; snapshot.last_reported_at = now; snapshot.last_session_id = self.boot
            snapshot.state = {"pump_running": False}
            snapshot.values = {}
            snapshot.diagnostics = {"program": {"version": 1, "ready": True, "supports_schedule": supported, "max_schedule_seconds": max_schedule_seconds, "state": "idle", "command_id": None,
                "step_index": 0, "step_count": 0, "target_frequency_hz": None, "remaining_seconds": None, "reason": None}}
            session.add(snapshot); session.commit()

    def save_rule(self, **changes):
        data = {"id": str(uuid.uuid4()), "expected_revision": 0, "enabled": True, "spec": {**self.rule, **changes}}
        row = self.call(self.base + "/schedules/" + data["id"], method="PUT", body=data)
        return row, data

    def process(self, item, now=None):
        with SessionLocal() as session:
            return process_schedule(session, uuid.UUID(item["id"]), now=now or self.due)

    def history(self, row):
        return self.call(self.base + "/schedules/" + row["id"] + "/runs")

    def test_idempotent_write_revision_and_cross_tenant_guards(self):
        row, data = self.save_rule()
        self.assertEqual(self.call(self.base + "/schedules/" + row["id"], method="PUT", body=data)["revision"], 1)
        changed = {**data, "spec": {**data["spec"], "name": "Changed"}}
        self.call(self.base + "/schedules/" + row["id"], method="PUT", body=changed, expected=409)
        self.call(self.base + "/schedules/" + row["id"], method="PUT", body=data, who="viewer", expected=403)
        self.call(self.base + "/schedules", who="other", expected=404)
        self.call(self.base + "/schedules/" + row["id"] + "/runs", who="other", expected=404)
        self.assertEqual(len(self.call(self.base + "/schedules", who="viewer")), 1)
        with SessionLocal() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(ScheduleRevision).where(ScheduleRevision.schedule_id == uuid.UUID(row["id"]))), 1)

    def test_week_requires_compatible_controller_at_save_and_dispatch(self):
        data = {"id": str(uuid.uuid4()), "expected_revision": 0, "enabled": True,
            "spec": {**self.rule, "stop_day_offset": 7, "stop_time": self.rule["start_time"]}}
        self.call(self.base + "/schedules/preview", method="POST", body=data, expected=409)
        self.call(self.base + "/schedules/" + data["id"], method="PUT", body=data, expected=409)
        self.fresh(self.due, max_schedule_seconds=604800)
        preview = self.call(self.base + "/schedules/preview", method="POST", body=data)
        self.assertEqual(preview["runs"][0]["steps"][0]["duration_seconds"], 604800)
        row = self.call(self.base + "/schedules/" + data["id"], method="PUT", body=data)
        self.assertEqual(self.process(row), "queued")
        # Заміна контролера старою версією після збереження не обходить перевірку.
        self.fresh(self.due)
        with SessionLocal() as session:
            command = session.scalar(select(DeviceCommand).where(DeviceCommand.schedule_id == uuid.UUID(row["id"])))
            result = CommandDispatchService(session).dispatch(command.id, now=self.due)
            self.assertEqual(result.reason, "schedule_duration_unsupported")

    def test_overlapping_repetitions_cannot_be_enabled(self):
        self.fresh(self.due, max_schedule_seconds=604800)
        data = {"id": str(uuid.uuid4()), "expected_revision": 0, "enabled": True,
            "spec": {**self.rule, "stop_day_offset": 7, "stop_time": self.rule["start_time"],
                "repeat": "daily", "until_date": (self.due + timedelta(days=30)).date().isoformat()}}
        self.call(self.base + "/schedules/preview", method="POST", body=data, expected=409)
        self.call(self.base + "/schedules/" + data["id"], method="PUT", body=data, expected=409)

    def test_two_workers_and_restarts_create_one_command(self):
        row, _ = self.save_rule()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.process(row), range(2)))
        self.assertEqual(results.count("queued"), 1)
        self.process(row)
        history = self.history(row)
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["status"], "queued")
        with SessionLocal() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(DeviceCommand).where(DeviceCommand.device_id == self.devices[0])), 1)

    def test_logout_keeps_schedule_but_role_revocation_blocks_dispatch(self):
        row, _ = self.save_rule()
        with SessionLocal() as session:
            session.get(AuthSession, self.contexts["operator"].auth_session.id).revoked_at = self.now
            session.commit()
        self.assertEqual(self.process(row), "queued")
        with SessionLocal() as session:
            command = session.scalar(select(DeviceCommand).where(DeviceCommand.schedule_id == uuid.UUID(row["id"])))
            self.assertIsNone(command.actor_auth_session_id)
            with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")):
                self.assertTrue(CommandDispatchService(session).dispatch(command.id, now=self.due).published)
            member = session.scalar(select(OrganizationMembership).where(OrganizationMembership.user_id == self.contexts["operator"].user.id))
            member.role = "viewer"; session.commit()
            result = CommandDispatchService(session).dispatch(command.id, now=self.due + timedelta(seconds=11), allow_retry=True)
            self.assertEqual(result.reason, "command_access_revoked")

    def test_missed_start_is_recorded_without_catchup(self):
        row, _ = self.save_rule()
        self.assertEqual(self.process(row, self.due + timedelta(seconds=31)), "schedule_missed")
        self.assertEqual(self.history(row)[0]["reason"], "schedule_missed")
        with SessionLocal() as session:
            session.get(Device, self.devices[0]).last_seen_at = None
            item = session.get(DeviceSchedule, uuid.UUID(row["id"])); item.next_start_at = self.due; item.next_check_at = self.due
            session.commit()
        self.assertEqual(self.process(row), "duplicate")
        self.assertIsNone(self.history(row)[0]["command_id"])

    def test_offline_start_does_not_queue_a_late_run(self):
        row, _ = self.save_rule()
        with SessionLocal() as session:
            session.get(Device, self.devices[0]).last_seen_at = None
            session.commit()
        self.assertEqual(self.process(row), "device_offline")
        self.fresh(self.due + timedelta(seconds=5))
        self.assertEqual(self.process(row, self.due + timedelta(seconds=5)), "not_due")
        history = self.history(row)
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["reason"], "device_offline")
        self.assertIsNone(history[0]["command_id"])

    def test_pause_blocks_queued_delivery_and_revision_is_audited(self):
        row, data = self.save_rule(); self.assertEqual(self.process(row), "queued")
        data.update(expected_revision=1, enabled=False)
        self.call(self.base + "/schedules/" + row["id"], method="PUT", body=data)
        with SessionLocal() as session:
            command = session.scalar(select(DeviceCommand).where(DeviceCommand.schedule_id == uuid.UUID(row["id"])))
            result = CommandDispatchService(session).dispatch(command.id, now=self.due)
            self.assertEqual(result.reason, "command_access_revoked")
            self.assertEqual(session.scalar(select(func.count()).select_from(ScheduleRevision).where(ScheduleRevision.schedule_id == uuid.UUID(row["id"]))), 2)

    def test_overlap_preview_and_atomic_write_reject_second_rule(self):
        self.save_rule()
        data = {"id": str(uuid.uuid4()), "expected_revision": 0, "enabled": True, "spec": {**self.rule, "name": "Overlapping"}}
        self.assertEqual(len(self.call(self.base + "/schedules/preview", method="POST", body=data)["conflicts"]), 1)
        self.call(self.base + "/schedules/" + data["id"], method="PUT", body=data, expected=409)

    def test_manual_stop_wins_before_worker_and_old_firmware_cannot_start(self):
        row, _ = self.save_rule()
        with SessionLocal() as session:
            session.get(Device, self.devices[0]).last_stop_requested_at = self.due
            session.commit()
        self.assertEqual(self.process(row), "stop_before_dispatch")
        with SessionLocal() as session:
            session.get(Device, self.devices[0]).last_stop_requested_at = None
            session.delete(session.scalar(select(ScheduleOccurrence).where(ScheduleOccurrence.schedule_id == uuid.UUID(row["id"]))))
            item = session.get(DeviceSchedule, uuid.UUID(row["id"])); refresh_next(item, ScheduleSpec.model_validate(item.spec), self.due)
            session.commit()
        self.fresh(self.due, supported=False)
        self.assertEqual(self.process(row), "schedule_firmware_unavailable")

    def test_index_selection_is_bounded_and_future_not_due(self):
        row, _ = self.save_rule()
        with SessionLocal() as session:
            self.assertNotIn(uuid.UUID(row["id"]), ScheduleRepository(session).due_ids(self.now))
            self.assertIn(uuid.UUID(row["id"]), ScheduleRepository(session).due_ids(self.due))


if __name__ == "__main__": unittest.main()
