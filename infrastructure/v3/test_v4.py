"""Host-side identity/certificate tests; no actual modem or tunnel is used."""
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cryptography import x509
from cryptography.x509.oid import ExtensionOID

from v4 import checked_host, prepare


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = {"uid": "KERUMO-V3-SU600-001", "password": "12" * 32}
        self.request = {"host": "test.pinggy.link", "port": 23456}
        self.process = patch("v4.subprocess.run")
        self.process.start()
        self.addCleanup(self.process.stop)

    def test_pairing_and_read_only_override(self):
        prepare(self.root, self.source, self.request)
        identity = json.loads((self.root / "identity.json").read_text())
        self.assertEqual(identity["uid"], self.source["uid"])
        self.assertEqual(identity["password"], self.source["password"])
        cert = x509.load_pem_x509_certificate((self.root / "server.crt").read_bytes())
        names = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME).value
        self.assertIn("test.pinggy.link", names.get_values_for_type(x509.DNSName))
        authority = cert.extensions.get_extension_for_oid(ExtensionOID.AUTHORITY_KEY_IDENTIFIER).value
        ca = x509.load_pem_x509_certificate((self.root / "ca.crt").read_bytes())
        issuer = ca.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_KEY_IDENTIFIER).value
        self.assertEqual(authority.key_identifier, issuer.digest)
        self.assertGreater(cert.not_valid_after_utc, datetime.now(timezone.utc))
        config = (self.root / "lte_config.local.h").read_text()
        self.assertIn("#undef KERUMO_ENABLE_CONTROL\n#define KERUMO_ENABLE_CONTROL false", config)
        self.assertIn("#define KERUMO_USE_LTE true", config)
        probe = json.loads((self.root / "probe/identity.json").read_text())
        self.assertNotIn("password", probe)
        self.assertNotIn("bridge_password", probe)
        self.assertEqual(probe["observer_password"], identity["observer_password"])
        self.assertFalse((self.root / "probe/ca.key").exists())
        self.assertEqual((self.root / "ca.key").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.root.stat().st_mode & 0o777, 0o711)
        observer_acl = (self.root / "acl").read_text().split("user v4-observer\n")[1]
        self.assertNotIn("topic write", observer_acl)
        self.assertNotIn("/commands\n", observer_acl)

    def test_idempotence_and_explicit_endpoint_renewal(self):
        prepare(self.root, self.source, self.request)
        ca, certificate = (self.root / "ca.crt").read_bytes(), (self.root / "server.crt").read_bytes()
        password_file = (self.root / "passwords").read_bytes()
        prepare(self.root, self.source, self.request)
        self.assertEqual(certificate, (self.root / "server.crt").read_bytes())
        changed = {"host": "next.pinggy.link", "port": 12345}
        with self.assertRaises(RuntimeError):
            prepare(self.root, self.source, changed)
        self.assertEqual(certificate, (self.root / "server.crt").read_bytes())
        prepare(self.root, self.source, {**changed, "renew_endpoint": True})
        self.assertEqual(ca, (self.root / "ca.crt").read_bytes())
        self.assertEqual(password_file, (self.root / "passwords").read_bytes())
        self.assertNotEqual(certificate, (self.root / "server.crt").read_bytes())

    def test_foreign_identity_and_invalid_inputs_do_not_replace_files(self):
        prepare(self.root, self.source, self.request)
        before = (self.root / "identity.json").read_bytes()
        with self.assertRaises(RuntimeError):
            prepare(self.root, {**self.source, "uid": "OTHER"}, self.request)
        for value in ("bad\nlistener 1883", "tcp://example.org", "example.org:1234", "bad..name", ""):
            with self.assertRaises(ValueError):
                checked_host(value)
        with self.assertRaises(ValueError):
            prepare(self.root, self.source, {**self.request, "port": True})
        self.assertEqual(before, (self.root / "identity.json").read_bytes())


if __name__ == "__main__":
    unittest.main()
