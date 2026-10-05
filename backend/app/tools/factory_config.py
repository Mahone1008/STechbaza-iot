"""Приватний заводський JSON → файл прошивки; без Wi-Fi клієнта та без stdout секретів."""

import argparse
import json
import os
from pathlib import Path
import uuid
from urllib.parse import urlsplit


def generate(kit, ca, api_url):
    controller_id = str(uuid.UUID(kit["controller"]["id"]))
    origin = urlsplit(api_url)
    if (
        origin.scheme != "https"
        or not origin.hostname
        or origin.username
        or origin.password
        or origin.path not in ("", "/")
        or origin.query
        or origin.fragment
    ):
        raise ValueError("Потрібна HTTPS-адреса сервера без шляху й credentials")
    if "-----BEGIN CERTIFICATE-----" not in ca:
        raise ValueError("Потрібен PEM довіреного CA")
    if len(kit["bootstrap_key"]) < 32 or not 12 <= len(kit["setup_password"]) <= 63:
        raise ValueError("Неповний заводський комплект")
    values = dict(
        KERUMO_FACTORY_CONTROLLER_ID=controller_id,
        KERUMO_BOOTSTRAP_KEY=kit["bootstrap_key"],
        KERUMO_API_URL=api_url.rstrip("/"),
        KERUMO_SETUP_PASSWORD=kit["setup_password"],
    )
    result = "#pragma once\n// Приватний заводський файл. Не публікувати.\n"
    result += "#undef KERUMO_MQTT_CA\n#define KERUMO_MQTT_CA " + json.dumps(ca) + "\n"
    return result + "".join(f"#define {key} {json.dumps(value)}\n" for key, value in values.items())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("kit", type=Path)
    parser.add_argument("--ca", required=True, type=Path)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    content = generate(
        json.loads(args.kit.read_text(encoding="utf-8-sig")), args.ca.read_text(), args.api_url
    )
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(content)
    print("Заводський файл створено; наявні файли не перезаписуються")


if __name__ == "__main__":
    main()
