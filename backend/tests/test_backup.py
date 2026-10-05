"""Backup guards: цілісність bundle, WAL та відмова перезаписувати SQLite."""

from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from app.operations.backup import (
    BUNDLE_FILES,
    create_manifest,
    sqlite_copy,
    sqlite_fingerprint,
    verify_bundle,
)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def bundle(self):
        for name in BUNDLE_FILES:
            (self.root / name).write_bytes(b"backup-fixture:" + name.encode())
        return create_manifest(self.root, "a" * 40)

    def test_manifest_round_trip_and_tampered_file_rejected(self):
        expected = self.bundle()
        self.assertEqual(verify_bundle(self.root), expected)
        path = self.root / "postgres.dump"
        raw = path.read_bytes()
        path.write_bytes(bytes([raw[0] ^ 1]) + raw[1:])
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            verify_bundle(self.root)

    def test_missing_file_and_traversal_manifest_rejected(self):
        self.bundle()
        (self.root / "source.tar").unlink()
        with self.assertRaises(ValueError):
            verify_bundle(self.root)
        manifest = json.loads((self.root / "manifest.json").read_text())
        manifest["files"]["../private"] = manifest["files"].pop("source.tar")
        (self.root / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            verify_bundle(self.root)

    def test_wrong_format_and_overwriting_manifest_rejected(self):
        self.bundle()
        with self.assertRaises(FileExistsError):
            create_manifest(self.root, "a" * 40)
        manifest = json.loads((self.root / "manifest.json").read_text())
        manifest["format"] = 2
        (self.root / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            verify_bundle(self.root)

    def test_patch_release_keeps_previous_backup_compatible(self):
        manifest = self.bundle()
        self.assertEqual(manifest["backend"], "0.47.0")
        self.assertEqual(manifest["migration"], "20261005_0024")
        for version in ("0.37.0", "0.37.1", "0.37.2", "0.37.3"):
            manifest["backend"] = version
            manifest["migration"] = "20260926_0017"
            (self.root / "manifest.json").write_text(json.dumps(manifest))
            self.assertEqual(verify_bundle(self.root)["backend"], version)
        manifest["backend"] = "0.39.0"
        manifest["migration"] = "20260929_0018"
        (self.root / "manifest.json").write_text(json.dumps(manifest))
        self.assertEqual(verify_bundle(self.root)["backend"], "0.39.0")
        manifest["backend"] = "0.45.0"
        manifest["migration"] = "20261002_0022"
        (self.root / "manifest.json").write_text(json.dumps(manifest))
        self.assertEqual(verify_bundle(self.root)["backend"], "0.45.0")
        manifest["backend"] = "0.46.0"
        manifest["migration"] = "20261005_0023"
        (self.root / "manifest.json").write_text(json.dumps(manifest))
        self.assertEqual(verify_bundle(self.root)["backend"], "0.46.0")
        manifest["backend"] = "0.36.0"
        (self.root / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            verify_bundle(self.root)

    def test_sqlite_backup_includes_uncheckpointed_wal_and_round_trip(self):
        source = self.root / "source.sqlite3"
        connection = sqlite3.connect(source)
        self.addCleanup(connection.close)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(
            "CREATE TABLE devices(id TEXT PRIMARY KEY, value INT); CREATE TABLE commands(id TEXT, pending INT);"
        )
        connection.execute("INSERT INTO devices VALUES ('pump', 33)")
        connection.execute("INSERT INTO commands VALUES ('command-1', 1)")
        connection.commit()
        self.assertTrue(Path(str(source) + "-wal").exists())
        copy = self.root / "backup.sqlite3"
        sqlite_copy(source, copy)
        restored = self.root / "restored.sqlite3"
        sqlite_copy(copy, restored)
        self.assertEqual(sqlite_fingerprint(source), sqlite_fingerprint(restored))
        with closing(sqlite3.connect(restored)) as other:
            other.execute("UPDATE devices SET value=44")
            other.commit()
        self.assertNotEqual(sqlite_fingerprint(source), sqlite_fingerprint(restored))

    def test_sqlite_missing_source_and_existing_target_rejected(self):
        source, target = self.root / "missing", self.root / "existing"
        target.write_bytes(b"preserve")
        with self.assertRaises(ValueError):
            sqlite_copy(source, target)
        with closing(sqlite3.connect(source)) as connection:
            connection.execute("CREATE TABLE test(id INT)")
        with self.assertRaises(FileExistsError):
            sqlite_copy(source, target)
        self.assertEqual(target.read_bytes(), b"preserve")

    def test_corrupt_sqlite_is_not_left_as_successful_backup(self):
        source, target = self.root / "bad", self.root / "target"
        source.write_bytes(b"not a sqlite database")
        with self.assertRaises(sqlite3.DatabaseError):
            sqlite_copy(source, target)
        self.assertFalse(target.exists())

    def test_restore_mutations_require_isolated_acceptance_mode(self):
        from app.demo.backup_check import require_target

        with patch.dict(os.environ, {"TECHBAZA_DEMO_MODE": "1", "TECHBAZA_ACCEPTANCE_MODE": "0"}):
            with self.assertRaises(RuntimeError):
                require_target()
        with patch.dict(os.environ, {"TECHBAZA_DEMO_MODE": "1", "TECHBAZA_ACCEPTANCE_MODE": "1"}):
            require_target()
