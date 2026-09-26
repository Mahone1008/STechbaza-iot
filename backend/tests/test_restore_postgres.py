"""Транзакційна післяrestore політика; тільки власні випадкові fixtures."""

import os
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import select

from app.models.auth_session import AuthSession
from app.models.command import DeviceCommand
from app.models.device import Device
from app.models.event_alarm import DeviceAlarm
from app.models.notification import AlarmNotification
from app.models.organization import Organization
from app.models.site import Site
from app.models.user import User
from app.operations.recovery import harden_restored_database


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires PostgreSQL opt-in")
class RestorePostgresTests(unittest.TestCase):
    def setUp(self):
        self.org, self.site, self.device, self.user, self.auth = [uuid.uuid4() for _ in range(5)]
        self.ids = {status: uuid.uuid4() for status in ("queued", "published", "acknowledged", "succeeded", "failed", "expired", "result_unknown")}
        self.now = datetime.now(timezone.utc)
        self.addCleanup(self.cleanup_data)
        # Outer transaction із savepoints не змінює жодних наявних demo users/commands.
        from app.db import engine
        from sqlalchemy.orm import Session
        self.connection = engine.connect()
        self.outer = self.connection.begin()
        self.session = Session(bind=self.connection, join_transaction_mode="create_savepoint", expire_on_commit=False)
        s = self.session
        s.add(Organization(id=self.org, name="Restore check", slug=f"restore-{self.org.hex}"))
        s.flush()
        s.add(Site(id=self.site, organization_id=self.org, name="Test", code="test"))
        s.add(User(id=self.user, email=f"{self.user.hex}@example.com", display_name="Restore check", password_hash="no-login"))
        s.flush()
        s.add(Device(id=self.device, site_id=self.site, uid=f"TB-RESTORE-{self.device.hex}", name="Test"))
        s.add(AuthSession(id=self.auth, user_id=self.user, refresh_token_hash=self.auth.hex*2,
                          expires_at=self.now + timedelta(days=1)))
        s.flush()
        for status, command_id in self.ids.items():
            s.add(DeviceCommand(id=command_id, request_id=uuid.uuid4(), device_id=self.device,
                                command_type="vfd.stop", status=status, expires_at=self.now + timedelta(minutes=5),
                                acknowledged_at=self.now if status == "acknowledged" else None))
        s.commit()

    def cleanup_data(self):
        if hasattr(self, "session"):
            self.session.close()
        if hasattr(self, "outer"):
            self.outer.rollback()
            self.connection.close()

    def test_restore_policy_revokes_and_quarantines_without_rewriting_terminal_history(self):
        result = harden_restored_database(self.session, now=self.now)
        self.session.commit()
        self.assertGreaterEqual(result["revoked_sessions"], 1)
        self.assertGreaterEqual(result["cancelled_delivery"], 2)
        self.assertGreaterEqual(result["unknown_results"], 1)
        self.assertIsNotNone(self.session.get(AuthSession, self.auth).revoked_at)
        for old in ("queued", "published"):
            item = self.session.get(DeviceCommand, self.ids[old])
            self.assertEqual((item.status, item.error_code), ("expired", "restore_delivery_cancelled"))
            self.assertEqual(item.expires_at, self.now + timedelta(minutes=5))
        unknown = self.session.get(DeviceCommand, self.ids["acknowledged"])
        self.assertEqual(unknown.status, "result_unknown")
        self.assertIsNone(unknown.completed_at)
        for status in ("succeeded", "failed", "expired", "result_unknown"):
            self.assertEqual(self.session.get(DeviceCommand, self.ids[status]).status, status)
        count = len(list(self.session.scalars(select(AlarmNotification).where(AlarmNotification.device_id == self.device))))
        self.assertEqual(harden_restored_database(self.session, now=self.now),
                         {"revoked_sessions": 0, "cancelled_delivery": 0, "unknown_results": 0, "cleared_rate_limits": 0})
        self.session.commit()
        self.assertEqual(len(list(self.session.scalars(select(AlarmNotification).where(AlarmNotification.device_id == self.device)))), count)

    def test_restore_policy_failure_rolls_back_sessions_commands_and_alarms(self):
        with patch("app.operations.recovery.SystemAlarmService.record_command_outcome", side_effect=RuntimeError("injected restore failure")):
            with self.assertRaises(RuntimeError):
                harden_restored_database(self.session, now=self.now)
        self.session.rollback()
        self.assertIsNone(self.session.get(AuthSession, self.auth).revoked_at)
        for status, command_id in self.ids.items():
            self.assertEqual(self.session.get(DeviceCommand, command_id).status, status)
        self.assertEqual(list(self.session.scalars(select(DeviceAlarm).where(DeviceAlarm.device_id == self.device))), [])
