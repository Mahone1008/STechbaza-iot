"""Gateway TLS provisioning: production address and preserved private identity."""
import contextlib
import io
import ipaddress
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import padding

from controllers import initialize


class ControllerGatewayTests(unittest.TestCase):
    def prepare(self, directory, host, **options):
        # Mosquitto's CLI itself is covered by controller_gateway_check against a live broker.
        def initialize_dynamic_security(command, **kwargs):
            Path(command[3]).write_text(json.dumps({"roles": [], "clients": []}))

        with patch("controllers.subprocess.run", side_effect=initialize_dynamic_security), \
                contextlib.redirect_stdout(io.StringIO()):
            initialize(directory, host, **options)

    def test_public_ipv4_certificate_and_identity_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.prepare(root, "8.8.8.8")
            certificate = x509.load_pem_x509_certificate((root / "server.crt").read_bytes())
            authority = x509.load_pem_x509_certificate((root / "ca.crt").read_bytes())
            self.assertEqual(certificate.extensions.get_extension_for_class(x509.SubjectAlternativeName)
                             .value.get_values_for_type(x509.IPAddress), [ipaddress.IPv4Address("8.8.8.8")])
            authority.public_key().verify(certificate.signature, certificate.tbs_certificate_bytes,
                                          padding.PKCS1v15(), certificate.signature_hash_algorithm)
            before = {name: (root / name).read_bytes() for name in
                      ("server.key", "server.crt", "ca.crt", "controllers.env", "dynamic-security.json")}
            self.prepare(root, "8.8.8.8")
            self.assertEqual(before, {name: (root / name).read_bytes() for name in before})
            self.assertFalse((root / "config.local.h").exists(), "Managed gateway must not create legacy bench identity")
            self.assertFalse((root / "passwords").exists(), "Managed gateway must use only Dynamic Security")
            with self.assertRaises(RuntimeError):
                self.prepare(root, "1.1.1.1")
            self.assertEqual(before, {name: (root / name).read_bytes() for name in before})

    def test_private_lan_still_supported_and_invalid_addresses_write_nothing(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.prepare(Path(temporary), "192.168.4.10")
        for host in ("127.0.0.1", "0.0.0.0", "224.0.0.1", "169.254.1.1", "::1", "mqtt.example.com"):
            with self.subTest(host=host), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                with self.assertRaises(ValueError):
                    self.prepare(root, host)
                self.assertEqual(list(root.iterdir()), [])

    def test_leaf_renewal_preserves_device_trust_and_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, signing = parent / "broker", parent / "signing"
            root.mkdir()
            self.prepare(root, "8.8.8.8", signing_dir=signing)
            before = {name: (root / name).read_bytes() for name in
                      ("server.key", "ca.crt", "controllers.env", "controllers.conf", "dynamic-security.json")}
            old_leaf = (root / "server.crt").read_bytes()
            signing_key = (signing / "ca.key").read_bytes()
            self.assertEqual(signing.stat().st_mode & 0o777, 0o700)
            self.assertEqual((signing / "ca.key").stat().st_mode & 0o777, 0o600)
            authority = x509.load_pem_x509_certificate(before["ca.crt"])
            self.assertGreater((authority.not_valid_after_utc - authority.not_valid_before_utc).days, 3600)
            self.prepare(root, "8.8.8.8", signing_dir=signing, renew_tls=True)
            certificate = x509.load_pem_x509_certificate((root / "server.crt").read_bytes())
            self.assertNotEqual((root / "server.crt").read_bytes(), old_leaf)
            authority.public_key().verify(certificate.signature, certificate.tbs_certificate_bytes,
                                          padding.PKCS1v15(), certificate.signature_hash_algorithm)
            self.assertEqual(before, {name: (root / name).read_bytes() for name in before})
            self.assertEqual((signing / "ca.key").read_bytes(), signing_key)
            self.assertFalse((root / "ca.key").exists(), "Runtime directory must not contain the CA signing key")
            with self.assertRaises(RuntimeError):
                self.prepare(root, "1.1.1.1", signing_dir=signing, renew_tls=True)

    def test_legacy_renewal_without_signing_backup_preserves_all_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.prepare(root, "8.8.8.8")
            before = {path.name: path.read_bytes() for path in root.iterdir()}
            with self.assertRaisesRegex(RuntimeError, "no retained CA signing key"):
                self.prepare(root, "8.8.8.8", renew_tls=True)
            self.assertEqual(before, {path.name: path.read_bytes() for path in root.iterdir()})

    def test_signing_key_in_runtime_directory_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "separate"):
                self.prepare(root, "8.8.8.8", signing_dir=root / "signing")
            self.assertEqual(list(root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
