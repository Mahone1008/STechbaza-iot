"""Manufacturer output must not inherit a bench identity or weaken TLS."""

from datetime import datetime, timedelta, timezone
import unittest
import uuid

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from app.tools.factory_config import generate


class FactoryConfigurationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.kit = {"controller": {"id": str(uuid.uuid4()), "network_transport": "lte"},
                   "bootstrap_key": "synthetic-factory-bootstrap-" + "a" * 32,
                   "setup_password": "synthetic-setup-password"}
        cls.cas = []
        for name in ("API test CA", "MQTT test CA"):
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
            now = datetime.now(timezone.utc)
            certificate = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
                           .public_key(key.public_key()).serial_number(x509.random_serial_number())
                           .not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=1))
                           .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
                           .sign(key, hashes.SHA256()))
            cls.cas.append(certificate.public_bytes(serialization.Encoding.PEM).decode("ascii"))

    def test_factory_lte_uses_separate_trust_and_no_static_identity(self):
        api_ca, mqtt_ca = self.cas
        result = generate(self.kit, api_ca, "https://controllers.example.com", mqtt_ca=mqtt_ca)
        self.assertIn('#define KERUMO_USE_LTE true', result)
        self.assertIn('#define KERUMO_ENABLE_CONTROL false', result)
        self.assertIn('#define KERUMO_BOOTSTRAP_CA ', result)
        self.assertIn('#define KERUMO_MQTT_CA ', result)
        self.assertNotIn('KERUMO_DEVICE_UID', result)
        self.assertNotIn('KERUMO_MQTT_PASSWORD', result)
        self.assertNotIn('KERUMO-V3-SU600-001', result)
        self.assertNotIn('KERUMO_WIFI_PASSWORD', result)

    def test_unusable_origin_apn_and_certificates_rejected(self):
        ca = self.cas[0]
        for origin in ("http://controllers.example.com", "https://127.0.0.1", "https://localhost",
                       "https://user:secret@controllers.example.com", "https://controllers.example.com/path",
                       "https://controllers.example.com?key=secret", "https://controllers.example.com:0"):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                generate(self.kit, ca, origin)
        with self.assertRaises(ValueError):
            generate(self.kit, ca, "https://controllers.example.com", apn='internet"\n#define INJECTED 1')
        for broken in ("", "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----"):
            with self.subTest(certificate=broken), self.assertRaises(ValueError):
                generate(self.kit, broken, "https://controllers.example.com")
            with self.assertRaises(ValueError):
                generate(self.kit, ca, "https://controllers.example.com", mqtt_ca=broken)

    def test_legacy_wifi_kit_is_supported_with_safe_control_defaults(self):
        kit = {**self.kit, "controller": {"id": self.kit["controller"]["id"]}}
        result = generate(kit, self.cas[0], "https://controllers.example.com")
        self.assertIn('#define KERUMO_USE_LTE false', result)
        self.assertIn('#define KERUMO_ENABLE_REMOTE_OPERATION false', result)
        self.assertNotIn('KERUMO_MODEM_APN', result)

    def test_opt_in_controls_keep_existing_modes(self):
        result = generate(self.kit, self.cas[0], "https://controllers.example.com", control_mode="Remote")
        for flag in ('CONTROL', 'EXTENDED_TEST', 'REMOTE_OPERATION'):
            self.assertIn(f'#define KERUMO_ENABLE_{flag} true', result)
