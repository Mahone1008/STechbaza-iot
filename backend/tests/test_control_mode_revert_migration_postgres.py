"""Retiring the selector preserves existing rules, command history and accounts."""
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


def migration(filename):
    path = Path(__file__).resolve().parents[1] / "alembic/versions" / filename
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class ControlModeRevertMigrationTests(unittest.TestCase):
    def test_new_and_already_updated_databases_preserve_customer_data(self):
        previous = migration("20261007_0028_control_mode.py")
        reverted = migration("20261007_0029_retire_control_mode.py")
        for installed in (False, True):
            with self.subTest(already_installed_0028=installed), engine.connect() as connection:
                transaction = connection.begin()
                namespace = "selector_revert_" + uuid.uuid4().hex
                try:
                    connection.execute(text(f'CREATE SCHEMA "{namespace}"'))
                    connection.execute(text(f'SET LOCAL search_path TO "{namespace}"'))
                    connection.execute(text("CREATE TABLE devices (id int PRIMARY KEY, name text)"))
                    connection.execute(text("CREATE TABLE device_commands (id int PRIMARY KEY, device_id int, status text, payload jsonb)"))
                    connection.execute(text("CREATE TABLE device_schedules (id int PRIMARY KEY, device_id int, enabled bool, deleted_at timestamptz, spec jsonb)"))
                    connection.execute(text("CREATE TABLE users (email text PRIMARY KEY, password_hash text, platform_role text)"))
                    connection.execute(text("INSERT INTO devices VALUES (1, 'Existing pump'), (2, 'Empty pump')"))
                    connection.execute(text("INSERT INTO users VALUES ('owner@example.test', 'retained-password-hash', 'user')"))
                    connection.execute(text("INSERT INTO device_commands VALUES (1, 1, 'succeeded', jsonb_build_object('frequency_hz', 35)), (2, 1, 'cancelled', '{}')"))
                    connection.execute(text("INSERT INTO device_schedules VALUES (1, 1, true, NULL, '{}'), (2, 1, false, NULL, '{}'), (3, 1, false, now(), '{}')"))
                    tables = ("devices", "device_commands", "device_schedules", "users")
                    def contents():
                        return {table: list(connection.execute(text(f"SELECT * FROM {table} ORDER BY 1"))) for table in tables}
                    before = contents()
                    operations = Operations(MigrationContext.configure(connection))
                    with patch.object(previous, "op", operations), patch.object(reverted, "op", operations):
                        previous.upgrade()
                        if installed:
                            connection.execute(text("UPDATE devices SET control_mode='manual', control_mode_revision=7, control_mode_changed_at=now()"))
                            connection.execute(text("UPDATE device_commands SET control_mode_revision=7, requested_control_mode_revision=6"))
                        reverted.upgrade()
                        self.assertEqual(contents(), before)
                        reverted.downgrade()
                        self.assertEqual(list(connection.execute(text("SELECT control_mode, control_mode_revision FROM devices ORDER BY id"))), [("schedule", 0), ("manual", 0)])
                        reverted.upgrade()
                        self.assertEqual(contents(), before)
                finally:
                    transaction.rollback()
