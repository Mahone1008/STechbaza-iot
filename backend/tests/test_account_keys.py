import unittest
from app.security.account_keys import digest, secret_box, totp_code, verify_totp
from app.schemas.onboarding import ClaimRequest, NewSite, RegisterRequest
from pydantic import ValidationError


class AccountKeyTests(unittest.TestCase):
    def test_rfc6238_sha1_vectors(self):
        secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        for timestamp, expected in ((59,"94287082"),(1111111109,"07081804"),(1111111111,"14050471"),(1234567890,"89005924"),(2000000000,"69279037"),(20000000000,"65353130")):
            self.assertEqual(totp_code(secret, timestamp//30, 8), expected)

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
        base = dict(activation_code="a"*43, device_name="New pump")
        with self.assertRaises(ValidationError):
            ClaimRequest(**base)
        ClaimRequest(**base, new_site=NewSite(name="Well"))
        with self.assertRaises(ValidationError):
            ClaimRequest(**base, new_site={"name":"Well", "timezone":"Europe/Invalid"})
        with self.assertRaises(ValidationError):
            RegisterRequest(email="person@example.com", display_name="Person", password=" short ")
