"""Generate local bench TLS identity and topic ACL; preserve credentials on repeat."""
import ipaddress
import json
import os
from pathlib import Path
import secrets
import subprocess
from datetime import datetime, timedelta, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

UID = "KERUMO-V3-SU600-001"


def write_private(path: Path, content: str | bytes):
    data = content.encode("utf-8") if isinstance(content, str) else content
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(data)


def prepare(root: Path, request: dict):
    address = ipaddress.ip_address(request["host"])
    if address.version != 4 or not any(address in ipaddress.ip_network(net) for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
        raise ValueError("Select the PC's private LAN IPv4 address")
    if not isinstance(request["ssid"], str) or not 1 <= len(request["ssid"].encode()) <= 32:
        raise ValueError("Wi-Fi SSID must contain 1..32 bytes")
    if not isinstance(request["wifi_password"], str) or not 8 <= len(request["wifi_password"]) <= 63:
        raise ValueError("This bench requires a password-protected Wi-Fi network")
    marker = root / "identity.json"
    if marker.exists():
        identity = json.loads(marker.read_text())
        if identity["host"] != str(address) or identity["uid"] != UID:
            raise RuntimeError("Existing certificate/identity belongs to a different IP; keep it and plan explicit renewal")
        for filename in ("ca.crt", "server.crt", "server.key", "passwords", "mosquitto.conf", "acl"):
            if not (root / filename).is_file():
                raise RuntimeError("Incomplete existing identity; automatic replacement is forbidden")
    else:
        if any((root / name).exists() for name in ("ca.crt", "server.crt", "server.key", "passwords")):
            raise RuntimeError("Partial previous setup found; inspect the files before retrying")
        now = datetime.now(timezone.utc)
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "KERUMO V3 private bench CA")])
        ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name).public_key(ca_key.public_key())
              .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=5))
              .not_valid_after(now+timedelta(days=365)).add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
              .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
              .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
              .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
              .sign(ca_key, hashes.SHA256()))
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cert = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "kerumo-v3-broker")]))
                .issuer_name(ca_name).public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=180))
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
                .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
                .add_extension(x509.KeyUsage(True, False, True, False, False, False, False, False, False), critical=True)
                .add_extension(x509.SubjectAlternativeName([x509.IPAddress(address)]), critical=False)
                .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
                .sign(ca_key, hashes.SHA256()))
        write_private(root/"ca.crt", ca.public_bytes(serialization.Encoding.PEM))
        write_private(root/"server.crt", cert.public_bytes(serialization.Encoding.PEM))
        write_private(root/"server.key", key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        # CA key is deliberately not persisted; renewal requires a new explicit pairing.
        password = secrets.token_hex(32)
        bridge_password = secrets.token_hex(32)
        write_private(root/"passwords", f"{UID}:{password}\nv3-bridge:{bridge_password}\n")
        subprocess.run(["mosquitto_passwd", "-U", str(root/"passwords")], check=True, capture_output=True)
        topic = f"techbaza/devices/{UID}"
        outgoing = ("telemetry", "heartbeat", "commands/ack", "commands/result")
        acl = f"user {UID}\ntopic read {topic}/commands\n" + "".join(f"topic write {topic}/{suffix}\n" for suffix in outgoing)
        acl += "\nuser v3-bridge\n" + f"topic write {topic}/commands\n" + "".join(f"topic read {topic}/{suffix}\n" for suffix in outgoing)
        write_private(root/"acl", acl)
        config = f"""user mosquitto
listener 8883 0.0.0.0
allow_anonymous false
password_file /work/passwords
acl_file /work/acl
certfile /work/server.crt
keyfile /work/server.key
tls_version tlsv1.2
retain_available false
persistence false
max_packet_size 8192
max_queued_messages 64
log_dest stdout
connection v3-demo
address mosquitto:1883
remote_clientid kerumo-v3-bridge
local_username v3-bridge
local_password {bridge_password}
cleansession true
notifications false
restart_timeout 5 30
bridge_outgoing_retain false
topic {topic}/commands in 1
""" + "".join(f"topic {topic}/{suffix} out 1\n" for suffix in outgoing)
        write_private(root/"mosquitto.conf", config)
        identity = {"uid": UID, "host": str(address), "password": password}
        write_private(marker, json.dumps(identity))
    ca_text = (root/"ca.crt").read_text()
    definitions = {"KERUMO_WIFI_SSID": request["ssid"], "KERUMO_WIFI_PASSWORD": request["wifi_password"],
                   "KERUMO_MQTT_HOST": str(address), "KERUMO_DEVICE_UID": UID,
                   "KERUMO_MQTT_PASSWORD": identity["password"], "KERUMO_MQTT_CA": ca_text}
    content = "#pragma once\n// Private local configuration. Never commit or share this file.\n"
    content += "".join(f"#define {key} {json.dumps(value, ensure_ascii=True)}\n" for key,value in definitions.items())
    content += "#define KERUMO_MQTT_PORT 8883\n#define KERUMO_ENABLE_CONTROL false\n"
    # Initial setup never overwrites a previously flashed controller configuration.
    path = root/"config.local.h"
    if path.exists():
        if path.read_text() != content:
            raise RuntimeError("Local firmware config already exists and differs; no overwrite performed")
    else:
        write_private(path, content)
    for name in ("passwords", "acl", "mosquitto.conf", "server.crt", "server.key"):
        if hasattr(os, "chown") and os.geteuid() == 0:
            os.chown(root/name, 1883, 1883)
        os.chmod(root/name, 0o600)
    print(f"V3 identity ready: {UID}; TLS broker {address}:8883; control disabled. Secrets are not printed.")


if __name__ == "__main__":
    root = Path("/work")
    request_path = root/"setup.json"
    try:
        prepare(root, json.loads(request_path.read_text(encoding="utf-8-sig")))
    finally:
        request_path.unlink(missing_ok=True)
