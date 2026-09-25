from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError


_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """Хешує пароль Argon2id; plain-text пароль не зберігається."""

    if len(password) < 12:
        raise ValueError("Пароль має містити щонайменше 12 символів")
    if len(password) > 128:
        raise ValueError("Пароль має містити не більше 128 символів")

    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Безпечно перевіряє пароль проти Argon2 hash."""

    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_hash_needs_rehash(password_hash: str) -> bool:
    """Дозволяє прозоро оновити параметри Argon2 після успішного login."""

    try:
        return _password_hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return False
