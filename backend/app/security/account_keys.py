"""Domain-separated opaque keys and RFC 6238 TOTP (SHA-1, 30 s, 6 digits)."""

import base64
import hashlib
import hmac
import secrets
import struct
import time

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from app.security.account_key_config import ACCOUNT_KEYS


def digest(purpose: str, value: str) -> str:
    return _digest(ACCOUNT_KEYS[0], purpose, value)


def _digest(key: str, purpose: str, value: str) -> str:
    return hmac.new(key.encode(), f"{purpose}:{value}".encode(), hashlib.sha256).hexdigest()


def verify_digest(purpose: str, value: str, expected: str | None) -> bool:
    # Keep the original 64-character format: existing factory/recovery keys
    # remain usable while their previous root key is explicitly retained.
    matches = [
        hmac.compare_digest(_digest(key, purpose, value), expected or "0" * 64)
        for key in ACCOUNT_KEYS
    ]
    return any(matches)


def new_key() -> str:
    return secrets.token_urlsafe(32)


def secret_box(purpose: str = "totp") -> MultiFernet:
    boxes = []
    for root in ACCOUNT_KEYS:
        key = hmac.new(root.encode(), f"kerumo:{purpose}:encryption:v1".encode(), hashlib.sha256).digest()
        boxes.append(Fernet(base64.urlsafe_b64encode(key)))
    return MultiFernet(boxes)


class AccountKeyUnavailableError(Exception):
    """Stored MFA data cannot be decrypted with the configured key ring."""


def verify_stored_totp(
    secret: str | None, code: str, previous: int | None
) -> tuple[int | None, str]:
    if secret is None:
        raise AccountKeyUnavailableError
    box = secret_box()
    try:
        plaintext = box.decrypt(secret.encode()).decode()
        counter = verify_totp(plaintext, code, previous)
        # Migrate ciphertext only after a valid proof; callers own the transaction.
        return counter, box.rotate(secret.encode()).decode() if counter is not None else secret
    except (InvalidToken, UnicodeError) as exc:
        raise AccountKeyUnavailableError from exc


def totp_code(secret: str, counter: int, digits: int = 6) -> str:
    key = base64.b32decode(secret, casefold=True)
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = mac[-1] & 15
    value = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10**digits)).zfill(digits)


def verify_totp(
    secret: str, code: str, previous: int | None, now: float | None = None
) -> int | None:
    if len(code) != 6 or not code.isascii() or not code.isdigit():
        return None
    counter = int((time.time() if now is None else now) // 30)
    for candidate in (counter, counter - 1, counter + 1):
        if (
            candidate >= 0
            and (previous is None or candidate > previous)
            and hmac.compare_digest(totp_code(secret, candidate), code)
        ):
            return candidate
    return None
