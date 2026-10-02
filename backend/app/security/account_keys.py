"""Domain-separated opaque keys and RFC 6238 TOTP (SHA-1, 30 s, 6 digits)."""
import base64
import hashlib
import hmac
import secrets
import struct
import time

from cryptography.fernet import Fernet
from app.security.auth_config import AUTH_ACCESS_TOKEN_SECRET


def digest(purpose: str, value: str) -> str:
    return hmac.new(AUTH_ACCESS_TOKEN_SECRET.encode(), f"{purpose}:{value}".encode(), hashlib.sha256).hexdigest()


def new_key() -> str:
    return secrets.token_urlsafe(32)


def secret_box() -> Fernet:
    key = hmac.new(AUTH_ACCESS_TOKEN_SECRET.encode(), b"kerumo:totp:encryption:v1", hashlib.sha256).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def totp_code(secret: str, counter: int, digits: int = 6) -> str:
    key = base64.b32decode(secret, casefold=True)
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = mac[-1] & 15
    value = struct.unpack(">I", mac[offset:offset+4])[0] & 0x7fffffff
    return str(value % (10 ** digits)).zfill(digits)


def verify_totp(secret: str, code: str, previous: int | None, now: float | None = None) -> int | None:
    if len(code) != 6 or not code.isascii() or not code.isdigit():
        return None
    counter = int((time.time() if now is None else now) // 30)
    for candidate in (counter, counter - 1, counter + 1):
        if candidate >= 0 and (previous is None or candidate > previous) and hmac.compare_digest(totp_code(secret, candidate), code):
            return candidate
    return None
