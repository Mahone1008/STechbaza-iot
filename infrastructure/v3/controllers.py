"""Окремий шлюз для заводських контролерів; чинний legacy-стенд не змінюється."""
import base64
import hashlib
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

from generate import write_private


def signing_key_path(root, signing_dir):
    if signing_dir is None:
        return None
    directory = Path(signing_dir).resolve()
    broker_directory = root.resolve()
    if directory == broker_directory or directory.is_relative_to(broker_directory) or broker_directory.is_relative_to(directory):
        raise ValueError("Keep the CA signing directory separate from the broker runtime directory")
    return directory / "ca.key"


def server_certificate(address, ca, ca_key, key):
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=180)
    if ca.not_valid_after_utc < expires:
        raise RuntimeError("CA renewal is due; plan an explicit trust migration before renewing this gateway")
    return (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "kerumo-controller-gateway")]))
            .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now-timedelta(minutes=5)).not_valid_after(expires)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .add_extension(x509.KeyUsage(True, False, True, False, False, False, False, False, False), critical=True)
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(address)]), critical=False)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .sign(ca_key, hashes.SHA256()))


def prepare_tls(root, address, signing_path=None):
    """Controller gateway identity, independent of the private-LAN legacy bench."""
    now = datetime.now(timezone.utc)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "KERUMO controller gateway CA")])
    ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name).public_key(ca_key.public_key())
          .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=5))
          .not_valid_after(now+timedelta(days=3650))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
          .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
          .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
          .sign(ca_key, hashes.SHA256()))
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    certificate = server_certificate(address, ca, ca_key, key)
    if signing_path is not None:
        signing_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if any(signing_path.parent.iterdir()):
            raise RuntimeError("CA signing directory is not empty; inspect the previous deployment before pairing")
        os.chmod(signing_path.parent, 0o700)
        if os.geteuid() == 0:
            os.chown(signing_path.parent, 0, 0)
        write_private(signing_path, ca_key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    write_private(root / "ca.crt", ca.public_bytes(serialization.Encoding.PEM))
    write_private(root / "server.crt", certificate.public_bytes(serialization.Encoding.PEM))
    write_private(root / "server.key", key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))


def renew_certificate(root, address, signing_path):
    if signing_path is None or not signing_path.is_file():
        raise RuntimeError("This gateway has no retained CA signing key; restore its private signing backup or plan an explicit trust migration. No keys were changed")
    ca = x509.load_pem_x509_certificate((root / "ca.crt").read_bytes())
    ca_key = serialization.load_pem_private_key(signing_path.read_bytes(), password=None)
    if ca_key.public_key().public_numbers() != ca.public_key().public_numbers():
        raise RuntimeError("CA signing key does not match this gateway; no keys were changed")
    os.chmod(signing_path.parent, 0o700)
    os.chmod(signing_path, 0o600)
    if os.geteuid() == 0:
        os.chown(signing_path.parent, 0, 0)
        os.chown(signing_path, 0, 0)
    key = serialization.load_pem_private_key((root / "server.key").read_bytes(), password=None)
    certificate = server_certificate(address, ca, ca_key, key)
    # Preserve the broker key and replace only the leaf certificate atomically.
    staged = root / "server.crt.next"
    write_private(staged, certificate.public_bytes(serialization.Encoding.PEM))
    if os.geteuid() == 0:
        os.chown(staged, 1883, 1883)
    os.replace(staged, root / "server.crt")


def encoded_password(value):
    salt = secrets.token_bytes(64)
    result = hashlib.pbkdf2_hmac("sha512", value.encode(), salt, 1000, 64)
    return "$7$1000$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(result).decode()


def initialize(root, host, signing_dir=None, renew_tls=False):
    address = ipaddress.IPv4Address(host)
    private_lan = any(address in ipaddress.ip_network(net)
                      for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
    if address.is_multicast or not (address.is_global or private_lan):
        raise ValueError("Select a fixed public IPv4 or a private LAN IPv4 for the controller gateway")
    signing_path = signing_key_path(root, signing_dir)
    marker = root / "controllers.ready"
    if marker.exists():
        if marker.read_text() != host:
            raise RuntimeError("Адреса відрізняється; потрібне планове перевидання TLS, без автоматичної заміни ключів")
        for name in ("controllers.env", "dynamic-security.json", "controllers.conf", "https.conf", "server.crt", "server.key", "ca.crt"):
            if not (root / name).is_file():
                raise RuntimeError("Неповний шлюз: відновіть власну резервну копію")
        if renew_tls:
            renew_certificate(root, address, signing_path)
            if os.geteuid() == 0:
                os.chown(root / "ca.crt", 1883, 1883)
            print("Gateway TLS leaf certificate renewed; CA, signing key and credentials preserved. Restart only the gateway to apply it")
            return
        # Older generators left the public CA owned by root; the hardened pilot runs as mosquitto.
        if os.geteuid() == 0:
            os.chown(root / "ca.crt", 1883, 1883)
        print("Controller gateway configuration preserved")
        return
    if renew_tls:
        raise RuntimeError("Prepare the gateway first; TLS renewal cannot create a new identity")
    if any(root.iterdir()):
        raise RuntimeError("Каталог не порожній: неповну попередню підготовку потрібно перевірити")
    prepare_tls(root, address, signing_path)
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
    for name in ("dynamic-security.json", "controllers.conf", "server.crt", "server.key", "ca.crt"):
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
    parser.add_argument("--signing-dir", type=Path, help="Private CA-key directory, never mounted in the runtime broker")
    parser.add_argument("--renew-tls", action="store_true", help="Explicitly renew only the leaf certificate for the unchanged host")
    args = parser.parse_args()
    initialize(Path("/work"), args.host, args.signing_dir, args.renew_tls)
