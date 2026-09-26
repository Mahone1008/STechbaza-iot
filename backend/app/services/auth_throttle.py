import hashlib
import hmac

from sqlalchemy.orm import Session

from app.repositories.auth_rate_limits import AuthRateLimitRepository
from app.security.auth_config import AUTH_ACCESS_TOKEN_SECRET
from app.security.browser_config import (
    AUTH_LOGIN_ACCOUNT_LIMIT, AUTH_LOGIN_IP_LIMIT, AUTH_RATE_WINDOW_SECONDS,
    AUTH_SESSION_IP_LIMIT,
)


class AuthRateLimitedError(Exception):
    def __init__(self, retry_after: int):
        self.retry_after = retry_after


def rate_key(scope: str, identity: str) -> str:
    return hmac.new(
        AUTH_ACCESS_TOKEN_SECRET.encode(), f"auth-rate:{scope}:{identity}".encode(), hashlib.sha256,
    ).hexdigest()


class AuthThrottle:
    """Ліміт враховує кожну спробу до password hashing, зокрема успішну."""

    def __init__(self, session: Session):
        self._session = session
        self._repository = AuthRateLimitRepository(session)

    def check(self, ip: str, *, email: str | None = None) -> None:
        if email is None:
            buckets = [("session-ip", ip, AUTH_SESSION_IP_LIMIT)]
        else:
            buckets = [
                ("login-ip", ip, AUTH_LOGIN_IP_LIMIT),
                ("login-account", email.strip().lower(), AUTH_LOGIN_ACCOUNT_LIMIT),
            ]
        retry_after = None
        for scope, identity, limit in buckets:
            count, retry = self._repository.consume(rate_key(scope, identity), AUTH_RATE_WINDOW_SECONDS, limit)
            if count > limit:
                retry_after = retry
                break
        self._repository.cleanup()
        # Відмова credentials не повинна відкочувати лічильники.
        self._session.commit()
        if retry_after is not None:
            raise AuthRateLimitedError(retry_after)
