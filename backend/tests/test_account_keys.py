import unittest
import os
from unittest.mock import patch
from app.security.account_keys import digest, secret_box, totp_code, verify_totp
from app.schemas.onboarding import ClaimRequest, NewSite, RecoveryRequest
from pydantic import ValidationError
from app.security.account_key_config import load_account_keys
from app.security.account_keys import verify_digest, verify_stored_totp


class AccountKeyTests(unittest.TestCase):
    def test_jwt_rotation_does_not_change_persistent_keys(self):
        with patch("app.security.account_keys.ACCOUNT_KEYS", ("account-root-" + "a" * 32,)):
            stored = digest("recovery", "existing-key")
            encrypted = secret_box().encrypt(b"existing-totp")
            with patch.dict(os.environ, {"AUTH_ACCESS_TOKEN_SECRET": "new-jwt-" + "b" * 32}):
                self.assertTrue(verify_digest("recovery", "existing-key", stored))
                self.assertEqual(secret_box().decrypt(encrypted), b"existing-totp")

    def test_previous_root_verifies_existing_keys_and_migrates_totp(self):
        old, new = "old-root-" + "a" * 32, "new-root-" + "b" * 32
        secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        with patch("app.security.account_keys.ACCOUNT_KEYS", (old,)):
            hashes = {
                purpose: digest(purpose, "existing-key")
                for purpose in ("activation", "bootstrap", "recovery")
            }
            encrypted = secret_box().encrypt(secret.encode()).decode()
        with patch("app.security.account_keys.ACCOUNT_KEYS", (new, old)):
            for purpose, stored in hashes.items():
                self.assertTrue(verify_digest(purpose, "existing-key", stored))
                self.assertFalse(verify_digest(purpose, "wrong-key", stored))
            with patch("app.security.account_keys.time.time", return_value=300):
                counter, migrated = verify_stored_totp(encrypted, totp_code(secret, 10), None)
                self.assertEqual(counter, 10)
        with patch("app.security.account_keys.ACCOUNT_KEYS", (new,)):
            self.assertEqual(secret_box().decrypt(migrated.encode()).decode(), secret)
            self.assertFalse(verify_digest("activation", "existing-key", hashes["activation"]))

    def test_custom_jwt_requires_explicit_upgrade_configuration(self):
        old = "existing-jwt-root-" + "a" * 32
        with patch.dict(os.environ, {"AUTH_ACCESS_TOKEN_SECRET": old}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "previous AUTH_ACCESS_TOKEN_SECRET"):
                load_account_keys()
            os.environ["ACCOUNT_KEY_SECRET"] = old
            self.assertEqual(load_account_keys(), (old,))
            os.environ["AUTH_ACCESS_TOKEN_SECRET"] = "replacement-jwt-" + "b" * 32
            self.assertEqual(load_account_keys(), (old,))

    def test_invalid_account_key_ring_is_rejected(self):
        for previous in ("{}", '["short"]', "not-json"):
            with (
                self.subTest(previous=previous),
                patch.dict(
                    os.environ,
                    {
                        "ACCOUNT_KEY_SECRET": "primary-" + "a" * 32,
                        "ACCOUNT_KEY_PREVIOUS_SECRETS": previous,
                    },
                    clear=True,
                ),
                self.assertRaises(RuntimeError),
            ):
                load_account_keys()

    def test_rfc6238_sha1_vectors(self):
        secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        for timestamp, expected in (
            (59, "94287082"),
            (1111111109, "07081804"),
            (1111111111, "14050471"),
            (1234567890, "89005924"),
            (2000000000, "69279037"),
            (20000000000, "65353130"),
        ):
            self.assertEqual(totp_code(secret, timestamp // 30, 8), expected)

    def test_totp_drift_and_replay_are_bounded(self):
        secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        code = totp_code(secret, 10)
        self.assertEqual(verify_totp(secret, code, None, 300), 10)
        self.assertEqual(verify_totp(secret, code, None, 330), 10)
        self.assertIsNone(verify_totp(secret, code, 10, 300))
        self.assertIsNone(verify_totp(secret, code, None, 360))
        self.assertIsNone(verify_totp(secret, "１２３４５６", None, 300))

    def test_secret_purposes_and_ciphertext_are_separate(self):
        self.assertNotEqual(digest("activation", "key"), digest("bootstrap", "key"))
        box = secret_box()
        encrypted = box.encrypt(b"secret")
        self.assertNotIn(b"secret", encrypted)
        self.assertEqual(box.decrypt(encrypted), b"secret")
        from cryptography.fernet import InvalidToken

        with self.assertRaises(InvalidToken):
            box.decrypt(encrypted[:-5] + b"wrong")

    def test_claim_requires_exactly_one_site_and_valid_timezone(self):
        base = dict(activation_code="a" * 43, device_name="New pump")
        with self.assertRaises(ValidationError):
            ClaimRequest(**base)
        ClaimRequest(**base, new_site=NewSite(name="Well"))
        with self.assertRaises(ValidationError):
            ClaimRequest(**base, new_site={"name": "Well", "timezone": "Europe/Invalid"})
        with self.assertRaises(ValidationError):
            RecoveryRequest(email="person@example.com", recovery_key="r" * 43, new_password="short")
