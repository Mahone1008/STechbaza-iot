"""Створення локальних випадкових секретів; існуючий файл не перезаписується."""

import argparse
import os
import secrets
from pathlib import Path

SECRET_KEYS = ("DEMO_DB_PASSWORD", "DEMO_JWT_SECRET", "DEMO_ACCOUNT_KEY_SECRET", "DEMO_OWNER_PASSWORD",
               "DEMO_OPERATOR_PASSWORD", "DEMO_VIEWER_PASSWORD", "DEMO_OTHER_PASSWORD")


def create_config(path: Path):
    # O_EXCL також захищає від тихого перезапису/ротації секретів живої БД.
    content = "".join(f"{key}={secrets.token_hex(32)}\n" for key in SECRET_KEYS)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(content)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    create_config(args.output)
    print("Demo credentials file created; secrets are not printed")
