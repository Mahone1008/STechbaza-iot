"""H-02: справжній SQL-відбір, пачки >100 та конкурентний dispatch.

Власний випадковий tenant; запуск лише з TECHBAZA_RUN_DB_TESTS=1 і без
фонових workers у тестовій БД. MQTT publish підмінено для точного контролю
спроб; реальний transport перевіряють MQTT та demo integration suites.
"""

import os
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models.command import DeviceCommand
from app.models.device import Device
from app.models.event_alarm import DeviceAlarm
from app.models.organization import Organization
from app.models.site import Site
from app.repositories.commands import CommandRepository
from app.services import command_reliability as worker
from app.services.command_config import COMMAND_RETRY_INTERVAL_SECONDS
from app.services.presence_config import DEVICE_ONLINE_TIMEOUT_SECONDS


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class CommandQueueTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc)
        self.retry = timedelta(seconds=COMMAND_RETRY_INTERVAL_SECONDS)
        self.online_window = timedelta(seconds=DEVICE_ONLINE_TIMEOUT_SECONDS)
        self.org, self.site, self.online, self.offline = [uuid.uuid4() for _ in range(4)]
        with SessionLocal() as session:
            session.add(Organization(id=self.org, name="Queue test", slug=f"queue-{self.org.hex}"))
            session.flush()
            session.add(Site(id=self.site, organization_id=self.org, name="Queue test", code="test"))
            session.flush()
            for device_id in (self.online, self.offline):
                session.add(Device(id=device_id, site_id=self.site, uid=f"TB-QUEUE-{device_id.hex}",
                                   name="Queue test", last_seen_at=self.now if device_id == self.online else None))
            session.commit()
        self.addCleanup(self.cleanup_data)
        self.batch = patch.object(worker, "COMMAND_RELIABILITY_BATCH_SIZE", 100)
        self.batch.start()
        self.addCleanup(self.batch.stop)

    def cleanup_data(self):
        with SessionLocal() as session:
            session.execute(delete(Organization).where(Organization.id == self.org))
            session.commit()

    def commands(self, count=1, **changes):
        ids = []
        with SessionLocal() as session:
            for _ in range(count):
                fields = dict(id=uuid.uuid4(), request_id=uuid.uuid4(), device_id=self.online,
                    command_type="vfd.start", status="queued", ttl_seconds=300,
                    created_at=self.now, expires_at=self.now + timedelta(seconds=300))
                fields.update(changes)
                command = DeviceCommand(**fields)
                session.add(command)
                ids.append(command.id)
            session.commit()
        return ids

    def candidates(self, now=None):
        now = now or self.now
        with SessionLocal() as session:
            return CommandRepository(session).list_delivery_candidate_ids(now=now,
                retry_before=now-self.retry, online_since=now-self.online_window, limit=100)

    def cycle(self, now=None):
        return worker.run_command_reliability_cycle(now=now or self.now)

    def test_150_offline_commands_do_not_hide_online_command(self):
        blocked = self.commands(150, device_id=self.offline, expires_at=self.now+timedelta(seconds=150))
        ready = self.commands()[0]
        self.assertEqual(self.candidates(), [ready])
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")) as publish:
            self.assertEqual(self.cycle()["published_count"], 1)
            self.assertEqual(publish.call_args.kwargs["command_id"], ready)
        with SessionLocal() as session:
            self.assertTrue(all(c.status == "queued" and c.publish_attempts == 0
                for c in session.scalars(select(DeviceCommand).where(DeviceCommand.id.in_(blocked)))))

    def test_150_backoff_commands_do_not_hide_fresh_command(self):
        for status in ("queued", "published"):
            self.commands(75, status=status, last_publish_attempt_at=self.now,
                          publish_attempts=1, expires_at=self.now+timedelta(seconds=150))
        ready = self.commands()[0]
        self.assertEqual(self.candidates(), [ready])
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")) as publish:
            self.assertEqual(self.cycle()["published_count"], 1)
            publish.assert_called_once()
        self.assertEqual(self.candidates(), [])

    def test_205_ready_commands_progress_in_three_batches_without_early_retries(self):
        ids = self.commands(205)
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")) as publish:
            self.assertEqual([self.cycle()["published_count"] for _ in range(4)], [100, 100, 5, 0])
            self.assertCountEqual([call.kwargs["command_id"] for call in publish.call_args_list], ids)
        with SessionLocal() as session:
            rows = list(session.scalars(select(DeviceCommand).where(DeviceCommand.id.in_(ids))))
            self.assertTrue(all(row.status == "published" and row.publish_attempts == 1 for row in rows))

    def test_failed_publish_backoff_survives_new_sessions_and_retries_same_envelope(self):
        command_id = self.commands()[0]
        with patch("app.services.command_dispatch.publish_command_message", return_value=(False, "mqtt_unavailable")) as publish:
            self.assertEqual(self.cycle()["reasons"], {"mqtt_unavailable": 1})
            envelope = publish.call_args.kwargs["payload"]
            self.assertEqual(self.cycle(self.now+self.retry-timedelta(microseconds=1))["candidate_count"], 0)
            publish.assert_called_once()
        with SessionLocal() as session:
            command = session.get(DeviceCommand, command_id)
            self.assertEqual((command.status, command.publish_attempts, command.last_publish_error),
                             ("queued", 1, "mqtt_unavailable"))
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")) as publish:
            self.assertEqual(self.cycle(self.now+self.retry)["published_count"], 1)
            self.assertEqual(publish.call_args.kwargs["payload"], envelope)
        with SessionLocal() as session:
            self.assertEqual(session.get(DeviceCommand, command_id).publish_attempts, 2)

    def test_due_retries_do_not_starve_205_waiting_commands_across_cycles(self):
        ids = self.commands(205)
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")) as publish:
            for cycle in range(3):
                self.assertEqual(self.cycle(self.now+self.retry*cycle)["published_count"], 100)
            # До першого retry усі 205 команд отримують свою першу спробу,
            # навіть якщо retry попередньої пачки вже дозволений за часом.
            sent = [call.kwargs["command_id"] for call in publish.call_args_list]
            self.assertCountEqual(sent[:205], ids)
            self.assertEqual(len(set(sent[:205])), 205)
            self.assertEqual(len(sent), 300)

    def test_offline_expiry_and_ack_timeout_bypass_retry_backoff(self):
        expired = [self.commands(device_id=self.offline, status=status, expires_at=self.now,
                                last_publish_attempt_at=self.now)[0] for status in ("queued", "published")]
        unknown = self.commands(device_id=self.offline, status="acknowledged", result_deadline_at=self.now)[0]
        waiting = self.commands(device_id=self.offline, status="acknowledged",
                                result_deadline_at=self.now+timedelta(seconds=60))[0]
        legacy = self.commands(device_id=self.offline, status="acknowledged",
                              acknowledged_at=self.now-timedelta(days=1))[0]
        terminal = self.commands(device_id=self.offline, status="succeeded", expires_at=self.now)[0]
        self.assertCountEqual(self.candidates(), expired+[unknown, legacy])
        with patch("app.services.command_dispatch.publish_command_message") as publish:
            result = self.cycle()
            self.assertEqual(result["reasons"], {"expired": 2, "result_unknown": 2})
            self.assertEqual(self.cycle()["candidate_count"], 0)
            publish.assert_not_called()
        with SessionLocal() as session:
            self.assertEqual(session.get(DeviceCommand, waiting).status, "acknowledged")
            self.assertEqual(session.get(DeviceCommand, terminal).status, "succeeded")
            for command_id in expired:
                self.assertEqual(session.get(DeviceCommand, command_id).status, "expired")
            for command_id in (unknown, legacy):
                self.assertEqual(session.get(DeviceCommand, command_id).status, "result_unknown")
            alarms = list(session.scalars(select(DeviceAlarm).where(DeviceAlarm.device_id == self.offline)))
            self.assertCountEqual([alarm.alarm_key for alarm in alarms], [
                "command.failed.vfd.start", f"command.result_unknown.{unknown}",
                f"command.result_unknown.{legacy}",
            ])

    def test_presence_boundary_and_return_online_without_changing_command(self):
        command_id = self.commands(device_id=self.offline)[0]
        cutoff = self.now-self.online_window
        for seen, eligible in ((cutoff-timedelta(microseconds=1), False), (cutoff, True), (None, False), (self.now, True)):
            with self.subTest(last_seen=seen):
                with SessionLocal() as session:
                    session.get(Device, self.offline).last_seen_at = seen
                    session.commit()
                self.assertEqual(self.candidates(), [command_id] if eligible else [])

    def test_two_cycles_select_same_command_but_publish_only_once(self):
        command_id = self.commands()[0]
        selected = threading.Barrier(2)
        original = CommandRepository.list_delivery_candidate_ids
        def select_together(repository, **kwargs):
            ids = original(repository, **kwargs)
            self.assertEqual(ids, [command_id])
            selected.wait(timeout=5)
            return ids
        with patch.object(CommandRepository, "list_delivery_candidate_ids", select_together), \
             patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")) as publish:
            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = [executor.submit(self.cycle) for _ in range(2)]
                results = [future.result(timeout=10) for future in futures]
            self.assertEqual(sum(r["published_count"] for r in results), 1)
            self.assertCountEqual([r["reasons"] for r in results], [{"published": 1}, {"retry_not_due": 1}])
            publish.assert_called_once()
        with SessionLocal() as session:
            self.assertEqual(session.get(DeviceCommand, command_id).publish_attempts, 1)

    def test_dispatch_rechecks_state_changed_after_selection(self):
        original = CommandRepository.list_delivery_candidate_ids
        for change, expected in (("offline", "device_offline"), ("expired", "expired"),
                                 ("acknowledged", "awaiting_result"), ("succeeded", "status_succeeded")):
            with self.subTest(change=change):
                with SessionLocal() as session:
                    session.get(Device, self.online).last_seen_at = self.now
                    session.commit()
                command_id = self.commands()[0]
                def change_after_selection(repository, **kwargs):
                    ids = original(repository, **kwargs)
                    self.assertIn(command_id, ids)
                    with SessionLocal() as session:
                        command = session.get(DeviceCommand, command_id)
                        if change == "offline":
                            session.get(Device, self.online).last_seen_at = None
                        elif change == "expired":
                            command.expires_at = self.now
                        else:
                            command.status = change
                            if change == "acknowledged":
                                command.result_deadline_at = self.now+timedelta(seconds=60)
                        session.commit()
                    return ids
                with patch.object(CommandRepository, "list_delivery_candidate_ids", change_after_selection), \
                     patch("app.services.command_dispatch.publish_command_message") as publish:
                    self.assertEqual(self.cycle()["reasons"], {expected: 1})
                    publish.assert_not_called()
                with SessionLocal() as session:
                    session.get(DeviceCommand, command_id).status = "succeeded"
                    session.commit()

    def test_production_cycle_rechecks_clock_after_selection(self):
        self.commands(expires_at=self.now+timedelta(seconds=1))
        with patch("app.services.command_reliability.datetime") as selection_clock, \
             patch("app.services.command_dispatch.datetime") as dispatch_clock, \
             patch("app.services.command_dispatch.publish_command_message") as publish:
            selection_clock.now.return_value = self.now
            dispatch_clock.now.return_value = self.now+timedelta(seconds=2)
            self.assertEqual(worker.run_command_reliability_cycle()["reasons"], {"expired": 1})
            publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
