"""Окремий шлюз для заводських контролерів; чинний legacy-стенд не змінюється."""
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import secrets
import subprocess

from generate import prepare, write_private


def encoded_password(value):
    salt = secrets.token_bytes(64)
    result = hashlib.pbkdf2_hmac("sha512", value.encode(), salt, 1000, 64)
    return "$7$1000$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(result).decode()


def initialize(root, host):
    ipaddress.IPv4Address(host)
    marker = root / "controllers.ready"
    if marker.exists():
        if marker.read_text() != host:
            raise RuntimeError("Адреса відрізняється; потрібне планове перевидання TLS, без автоматичної заміни ключів")
        for name in ("controllers.env", "dynamic-security.json", "controllers.conf", "https.conf", "server.crt", "server.key", "ca.crt"):
            if not (root / name).is_file():
                raise RuntimeError("Неповний шлюз: відновіть власну резервну копію")
        print("Controller gateway configuration preserved")
        return
    if any(root.iterdir()):
        raise RuntimeError("Каталог не порожній: неповну попередню підготовку потрібно перевірити")
    # Спільна TLS-реалізація; локальні legacy credentials не використовуються цим шлюзом.
    prepare(root, {"host": host, "ssid": "factory-no-wifi", "wifi_password": secrets.token_hex(16)})
    admin, bridge = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    subprocess.run(["mosquitto_ctrl", "dynsec", "init", str(root / "dynamic-security.json"), "enrollment-admin", admin],
                   check=True, capture_output=True)
    config = json.loads((root / "dynamic-security.json").read_text())
    config["defaultACLAccess"] = dict(publishClientSend=False, publishClientReceive=False, subscribe=False, unsubscribe=True)
    base = "techbaza/devices/+"
    bridge_acls = [{"acltype": "publishClientSend", "topic": base + "/commands", "allow": True}]
    bridge_acls += [{"acltype": kind, "topic": base + "/" + suffix, "allow": True}
                   for kind in ("subscribePattern", "publishClientReceive")
                   for suffix in ("heartbeat", "telemetry", "commands/ack", "commands/result")]
    config["roles"].append({"rolename": "bridge", "acls": bridge_acls})
    config["clients"].append({"username": "controller-bridge", "encoded_password": encoded_password(bridge), "roles": [{"rolename": "bridge"}]})
    (root / "dynamic-security.json").write_text(json.dumps(config))
    broker = f"""user mosquitto
per_listener_settings false
allow_anonymous false
plugin /usr/lib/mosquitto_dynamic_security.so
plugin_opt_config_file /work/dynamic-security.json
listener 8883 0.0.0.0
certfile /work/server.crt
keyfile /work/server.key
tls_version tlsv1.2
listener 1884 0.0.0.0
retain_available false
persistence false
max_packet_size 16384
max_queued_messages 64
log_dest stdout
connection controller-demo
address mosquitto:1883
local_username controller-bridge
local_password {bridge}
remote_clientid kerumo-controller-bridge
cleansession true
notifications false
bridge_outgoing_retain false
topic techbaza/devices/+/commands in 1
""" + "".join(f"topic techbaza/devices/+/{suffix} out 1\n" for suffix in ("telemetry", "heartbeat", "commands/ack", "commands/result"))
    write_private(root / "controllers.conf", broker)
    write_private(root / "controllers.env", f"CONTROLLER_HOST={host}\nCONTROLLER_BROKER_ADMIN_PASSWORD={admin}\n")
    write_private(root / "https.conf", """server {
  listen 8443 ssl;
  ssl_certificate /work/server.crt;
  ssl_certificate_key /work/server.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  client_max_body_size 16k;
  add_header X-Content-Type-Options nosniff always;
  location /api/ { proxy_pass http://backend:8000; proxy_set_header Host $host; }
  location = /health { proxy_pass http://backend:8000; }
  location / {
    proxy_pass http://host.docker.internal:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
""")
    for name in ("dynamic-security.json", "controllers.conf"):
        os.chmod(root / name, 0o600)
        if os.geteuid() == 0:
            os.chown(root / name, 1883, 1883)
    # Dynamic Security атомарно замінює JSON через тимчасовий файл у цьому каталозі.
    if os.geteuid() == 0:
        os.chown(root, 1883, 1883)
    write_private(marker, host)
    print("Controller gateway ready; no credentials printed")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    args = parser.parse_args()
    initialize(Path("/work"), args.host)
