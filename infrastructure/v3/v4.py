"""Separate LTE bench gateway; reuse the physical UID/password, retain the V3 files."""
from datetime import datetime, timedelta, timezone
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import subprocess

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def checked_host(value):
    if not isinstance(value, str) or not value or len(value) > 253:
        raise ValueError("Expected the tunnel hostname or a public IPv4 address")
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        if not all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", part)
                   for part in value.split(".")):
            raise ValueError("Invalid MQTT hostname") from None
        return value.lower()
    if address.version != 4:
        raise ValueError("The initial V4 bench expects IPv4")
    return str(address)


def write_private(path, content):
    data = content.encode("utf-8") if isinstance(content, str) else content
    temporary = path.with_name(path.name + ".new")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def prepare(root: Path, source: dict, request: dict):
    host = checked_host(request["host"])
    port = request["port"]
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("Invalid external MQTT port")
    apn = request.get("apn", "internet")
    if not isinstance(apn, str) or not re.fullmatch(r"[A-Za-z0-9.-]{1,100}", apn):
        raise ValueError("Invalid APN")
    mode = request.get("control_mode", "ReadOnly")
    if mode not in {"ReadOnly", "Bench", "Extended", "Remote"}:
        raise ValueError("Invalid control mode")
    uid, password = source["uid"], source["password"]
    if not isinstance(uid, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", uid):
        raise ValueError("Invalid source UID")
    if uid != "KERUMO-V3-SU600-001":
        raise RuntimeError("This setup uses the existing SU600 bench; another UID requires separate enrollment")
    if not isinstance(password, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,256}", password):
        raise ValueError("Invalid source MQTT password")
    marker = root / "identity.json"
    now = datetime.now(timezone.utc)
    if marker.exists():
        identity = json.loads(marker.read_text())
        if identity["uid"] != uid or identity["password"] != password:
            raise RuntimeError("Existing V4 identity differs; automatic re-pairing is forbidden")
        for name in ("ca.crt", "ca.key", "server.crt", "server.key", "passwords", "acl", "mosquitto.conf"):
            if not (root / name).is_file():
                raise RuntimeError("Incomplete V4 identity; inspect retained files before retrying")
        changed = identity["host"] != host or identity["port"] != port
        if changed and request.get("renew_endpoint") is not True:
            raise RuntimeError("Tunnel endpoint changed; use -RenewEndpoint after checking its new address")
        ca = x509.load_pem_x509_certificate((root / "ca.crt").read_bytes())
        ca_key = serialization.load_pem_private_key((root / "ca.key").read_bytes(), password=None)
        if ca.not_valid_after_utc <= now + timedelta(days=7):
            raise RuntimeError("Bench CA expires soon; plan explicit CA replacement")
        renew = changed or request.get("renew_endpoint") is True
    else:
        if any((root / name).exists() for name in ("ca.crt", "ca.key", "server.crt", "passwords")):
            raise RuntimeError("Partial V4 setup found; existing files were not replaced")
        identity = {"uid": uid, "password": password, "bridge_password": secrets.token_hex(32),
                    "observer_password": secrets.token_hex(32)}
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "KERUMO V4 bench CA")])
        ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
              .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
              .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=365))
              .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
              .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
              .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
              .sign(ca_key, hashes.SHA256()))
        write_private(root / "ca.crt", ca.public_bytes(serialization.Encoding.PEM))
        write_private(root / "ca.key", ca_key.private_bytes(serialization.Encoding.PEM,
                      serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        renew = True
    if renew:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        try:
            external_name = x509.IPAddress(ipaddress.ip_address(host))
        except ValueError:
            external_name = x509.DNSName(host)
        names = [external_name, x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
        if host != "v4-gateway":
            names.append(x509.DNSName("v4-gateway"))
        cert = (x509.CertificateBuilder().subject_name(x509.Name([
                    x509.NameAttribute(NameOID.COMMON_NAME, "kerumo-v4-broker")]))
                .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now - timedelta(minutes=5))
                .not_valid_after(min(now + timedelta(days=180), ca.not_valid_after_utc))
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.SubjectAlternativeName(names), critical=False)
                .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
                .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
                .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
                .add_extension(x509.KeyUsage(True, False, True, False, False, False, False, False, False), critical=True)
                .sign(ca_key, hashes.SHA256()))
        write_private(root / "server.crt", cert.public_bytes(serialization.Encoding.PEM))
        write_private(root / "server.key", key.private_bytes(serialization.Encoding.PEM,
                      serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    if not (root / "passwords").exists():
        write_private(root / "passwords", f"{uid}:{password}\nv4-bridge:{identity['bridge_password']}\n"
                      f"v4-observer:{identity['observer_password']}\n")
        subprocess.run(["mosquitto_passwd", "-U", str(root / "passwords")], check=True, capture_output=True)
    topic = f"techbaza/devices/{uid}"
    outgoing = ("telemetry", "heartbeat", "commands/ack", "commands/result")
    acl = f"user {uid}\ntopic read {topic}/commands\n"
    acl += "".join(f"topic write {topic}/{suffix}\n" for suffix in outgoing)
    acl += f"\nuser v4-bridge\ntopic write {topic}/commands\n"
    acl += "".join(f"topic read {topic}/{suffix}\n" for suffix in outgoing)
    acl += "\nuser v4-observer\n" + "".join(f"topic read {topic}/{suffix}\n" for suffix in outgoing)
    write_private(root / "acl", acl)
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
connection v4-demo
address mosquitto:1883
remote_clientid kerumo-v4-bridge
local_username v4-bridge
local_password {identity['bridge_password']}
cleansession true
notifications false
restart_timeout 5 30
bridge_outgoing_retain false
topic {topic}/commands in 1
""" + "".join(f"topic {topic}/{suffix} out 1\n" for suffix in outgoing)
    write_private(root / "mosquitto.conf", config)
    definitions = {"KERUMO_USE_LTE": True, "KERUMO_MODEM_APN": apn,
                   "KERUMO_MQTT_HOST": host, "KERUMO_MQTT_PORT": port,
                   "KERUMO_DEVICE_UID": uid, "KERUMO_MQTT_PASSWORD": password,
                   "KERUMO_MQTT_CA": (root / "ca.crt").read_text(),
                   "KERUMO_ENABLE_CONTROL": mode != "ReadOnly",
                   "KERUMO_ENABLE_EXTENDED_TEST": mode in {"Extended", "Remote"},
                   "KERUMO_ENABLE_REMOTE_OPERATION": mode == "Remote"}
    content = "#pragma once\n// Private V4 bench configuration. Never commit or share.\n"
    for name, value in definitions.items():
        content += f"#undef {name}\n#define {name} {json.dumps(value, ensure_ascii=True)}\n"
    write_private(root / "lte_config.local.h", content)
    probe = root / "probe"
    probe.mkdir(exist_ok=True)
    write_private(probe / "ca.crt", (root / "ca.crt").read_bytes())
    write_private(probe / "identity.json", json.dumps({"uid": uid, "host": "v4-gateway", "port": 8883,
                  "observer_password": identity["observer_password"]}))
    identity.update(host=host, port=port, apn=apn, control_mode=mode)
    write_private(marker, json.dumps(identity))
    for name in ("passwords", "acl", "mosquitto.conf", "server.crt", "server.key"):
        if hasattr(os, "chown") and os.geteuid() == 0:
            os.chown(root / name, 1883, 1883)
        os.chmod(root / name, 0o600)
    # Allow the unprivileged broker to traverse a host directory created with
    # umask 077. File access stays restricted to root / the broker owner.
    os.chmod(root, 0o711)
    print(f"V4 configured: UID={uid}, endpoint={host}:{port}, mode={mode}. Secrets are not printed.")


if __name__ == "__main__":
    root = Path("/work")
    request_path = root / "setup.json"
    try:
        prepare(root, json.loads(Path("/source/identity.json").read_text()),
                json.loads(request_path.read_text(encoding="utf-8-sig")))
    finally:
        request_path.unlink(missing_ok=True)
