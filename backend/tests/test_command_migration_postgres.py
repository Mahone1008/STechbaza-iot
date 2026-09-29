"""Справжня міграція неоднозначних legacy-записів в ізольованій схемі."""
import importlib.util
import os
from pathlib import Path
import unittest
import uuid
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from app.db import engine


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class CommandMigrationTests(unittest.TestCase):
    def test_legacy_queue_and_crash_window_are_quarantined_across_upgrade_and_rollback(self):
        path = Path(__file__).resolve().parents[1] / "alembic/versions/20260929_0018_command_safety.py"
        spec = importlib.util.spec_from_file_location("command_safety_migration", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        namespace = "command_migration_" + uuid.uuid4().hex
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                connection.execute(text(f'CREATE SCHEMA "{namespace}"'))
                connection.execute(text(f'SET LOCAL search_path TO "{namespace}"'))
                connection.execute(text("CREATE TABLE devices (id uuid PRIMARY KEY)"))
                connection.execute(text("""CREATE TABLE device_commands (
                    id int PRIMARY KEY, device_id uuid, status varchar(32),
                    publish_attempts int NOT NULL DEFAULT 0, error_code varchar(96),
                    error_message text, completed_at timestamptz, result_timed_out_at timestamptz,
                    updated_at timestamptz)"""))
                connection.execute(text("""INSERT INTO device_commands (id, status, publish_attempts) VALUES
                    (1, 'queued', 0), (2, 'queued', 1), (3, 'published', 1),
                    (4, 'acknowledged', 1), (5, 'succeeded', 1), (6, 'failed', 1)"""))
                with patch.object(migration, "op", Operations(MigrationContext.configure(connection))):
                    migration.upgrade()
                    rows = connection.execute(text("SELECT id, status, error_code, result_timed_out_at FROM device_commands ORDER BY id")).all()
                    for row in rows[:4]:
                        self.assertEqual((row.status, row.error_code), ("result_unknown", "protocol_upgrade_quarantine"))
                        self.assertIsNotNone(row.result_timed_out_at)
                    self.assertEqual([row.status for row in rows[4:]], ["succeeded", "failed"])
                    connection.execute(text("INSERT INTO device_commands (id, status) VALUES (7, 'queued'), (8, 'cancelled')"))
                    migration.downgrade()
                    self.assertEqual(list(connection.execute(text("SELECT status FROM device_commands WHERE id IN (7, 8) ORDER BY id")).scalars()), ["expired", "expired"])
                    migration.upgrade()
                    self.assertEqual(list(connection.execute(text("SELECT status FROM device_commands WHERE id IN (7, 8) ORDER BY id")).scalars()), ["expired", "expired"])
            finally:
                transaction.rollback()
