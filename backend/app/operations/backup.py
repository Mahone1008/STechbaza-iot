"""Перевірка локального backup bundle та узгоджена копія SQLite з WAL."""

from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3

BUNDLE_FILES = frozenset(
    {"postgres.dump", "simulator.sqlite3", "source.json", "environment.env", "source.tar"}
)


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_private_json(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, sort_keys=True, indent=2)
        stream.write("\n")


def create_manifest(directory, revision):
    root = Path(directory)
    if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise ValueError("Потрібен повний Git SHA")
    files = {}
    for name in sorted(BUNDLE_FILES):
        path = root / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size == 0:
            raise ValueError("Неповний backup bundle: " + name)
        files[name] = {"sha256": file_hash(path), "bytes": path.stat().st_size}
    value = {
        "format": 1,
        "backend": "0.50.0",
        "migration": "20261006_0027",
        "postgres_major": 16,
        "git_revision": revision,
        "files": files,
    }
    write_private_json(root / "manifest.json", value)
    return value


def verify_bundle(directory):
    root = Path(directory)
    value = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    versions = {key: "20260926_0017" for key in ("0.37.0", "0.37.1", "0.37.2", "0.37.3", "0.38.0")}
    versions["0.39.0"] = "20260929_0018"
    versions["0.40.0"] = "20261001_0019"
    versions["0.41.0"] = "20261001_0019"
    versions["0.42.0"] = "20261001_0020"
    versions["0.43.0"] = "20261001_0020"
    versions["0.44.0"] = "20261002_0021"
    versions["0.45.0"] = "20261002_0022"
    versions["0.46.0"] = "20261005_0023"
    versions["0.47.0"] = "20261005_0024"
    versions["0.48.0"] = "20261005_0025"
    versions["0.49.0"] = "20261005_0026"
    versions["0.50.0"] = "20261006_0027"
    if (
        value.get("format") != 1
        or value.get("backend") not in versions
        or value.get("migration") != versions.get(value.get("backend"))
        or value.get("postgres_major") != 16
        or set(value.get("files", {})) != BUNDLE_FILES
    ):
        raise ValueError("Непідтримуваний або неповний manifest")
    # Фіксований allowlist не дозволяє manifest читати довільні host paths.
    for name, expected in value["files"].items():
        path = root / name
        if (
            not path.is_file()
            or path.is_symlink()
            or path.stat().st_size != expected["bytes"]
            or file_hash(path) != expected["sha256"]
        ):
            raise ValueError("Backup checksum mismatch: " + name)
    return value


def sqlite_copy(source, target):
    source, target = Path(source), Path(target)
    if not source.is_file() or source.is_symlink():
        raise ValueError("Відсутнє або неприпустиме SQLite джерело")
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(descriptor)
    try:
        with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)) as src:
            with closing(sqlite3.connect(target)) as dst:
                src.backup(dst)
                if dst.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                    raise ValueError("SQLite integrity_check failed")
    except BaseException:
        target.unlink(missing_ok=True)
        raise


def sqlite_fingerprint(path):
    path = Path(path)
    if not path.is_file():
        raise ValueError("SQLite state відсутній")
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("SQLite integrity_check failed")
        result = {}
        existing = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        for table in ("devices", "commands", "programs"):
            if table == "programs" and table not in existing:
                continue  # Backup зі старої версії симулятора залишається читабельним.
            rows = sorted(tuple(row) for row in connection.execute(f'SELECT * FROM "{table}"'))
            encoded = json.dumps(rows, separators=(",", ":"), ensure_ascii=False).encode()
            result[table] = {"rows": len(rows), "sha256": hashlib.sha256(encoded).hexdigest()}
        return result
