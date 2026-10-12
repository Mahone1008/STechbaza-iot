"""Приватний заводський JSON → файл прошивки; без Wi-Fi клієнта та без stdout секретів."""

import argparse
import json
import os
from pathlib import Path
import re
import uuid
from urllib.parse import urlsplit


def generate(kit, ca, api_url, *, mqtt_ca=None, transport=None, apn="internet", control_mode="Full"):
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
        or origin.hostname in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}
    ):
        raise ValueError("Потрібна HTTPS-адреса сервера без шляху й credentials")
    if origin.port is not None and not 1 <= origin.port <= 65535:
        raise ValueError("Некоректний порт HTTPS")
    from cryptography import x509
    mqtt_ca = ca if mqtt_ca is None else mqtt_ca
    for certificate in (ca, mqtt_ca):
        try:
            if not x509.load_pem_x509_certificates(certificate.encode("ascii")):
                raise ValueError("empty")
        except (ValueError, UnicodeError, AttributeError) as exc:
            raise ValueError("Потрібен PEM довіреного CA для API та MQTT") from exc
    if len(kit["bootstrap_key"]) < 32 or not 12 <= len(kit["setup_password"]) <= 63:
        raise ValueError("Неповний заводський комплект")
    transport = transport or kit["controller"].get("network_transport", "wifi")
    if transport not in {"wifi", "lte"}:
        raise ValueError("Оберіть wifi або lte")
    if not isinstance(apn, str) or not re.fullmatch(r"[A-Za-z0-9.-]{1,100}", apn):
        raise ValueError("Некоректний APN")
    if control_mode not in {"ReadOnly", "Bench", "Extended", "Remote", "Full"}:
        raise ValueError("Некоректний режим прошивки")
    values = dict(
        KERUMO_FACTORY_CONTROLLER_ID=controller_id,
        KERUMO_BOOTSTRAP_KEY=kit["bootstrap_key"],
        KERUMO_API_URL=api_url.rstrip("/"),
        KERUMO_SETUP_PASSWORD=kit["setup_password"],
        KERUMO_BOOTSTRAP_CA=ca,
        KERUMO_MQTT_CA=mqtt_ca,
        KERUMO_USE_LTE=transport == "lte",
        KERUMO_ENABLE_CONTROL=control_mode != "ReadOnly",
        KERUMO_ENABLE_EXTENDED_TEST=control_mode in {"Extended", "Remote", "Full"},
        KERUMO_ENABLE_REMOTE_OPERATION=control_mode in {"Remote", "Full"},
    )
    if transport == "lte":
        values["KERUMO_MODEM_APN"] = apn
    result = "#pragma once\n// Приватний заводський файл. Не публікувати.\n"
    return result + "".join(f"#undef {key}\n#define {key} {json.dumps(value)}\n" for key, value in values.items())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("kit", type=Path)
    parser.add_argument("--ca", required=True, type=Path)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--mqtt-ca", type=Path, help="Окремий довірений CA MQTT, якщо відрізняється від API")
    parser.add_argument("--transport", choices=("wifi", "lte"), help="Тип мережі; має відповідати заводському реєстру")
    parser.add_argument("--apn", default="internet")
    parser.add_argument("--control-mode", choices=("ReadOnly", "Bench", "Extended", "Remote", "Full"), default="Full")
    args = parser.parse_args()
    content = generate(
        json.loads(args.kit.read_text(encoding="utf-8-sig")), args.ca.read_text(), args.api_url,
        mqtt_ca=args.mqtt_ca.read_text() if args.mqtt_ca else None,
        transport=args.transport, apn=args.apn, control_mode=args.control_mode,
    )
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(content)
    print("Заводський файл створено; наявні файли не перезаписуються")


if __name__ == "__main__":
    main()
