from datetime import timedelta

from sqlalchemy import case, delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.auth_rate_limit import AuthRateLimit


class AuthRateLimitRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def consume(self, key: str, window: int, limit: int) -> tuple[int, int]:
        now = func.clock_timestamp()
        expired = AuthRateLimit.expires_at <= now
        statement = insert(AuthRateLimit).values(
            key=key, attempts=1, expires_at=now + timedelta(seconds=window),
        ).on_conflict_do_update(
            index_elements=[AuthRateLimit.key],
            set_={
                # Насичення запобігає integer overflow під час тривалої атаки.
                "attempts": case((expired, 1), else_=func.least(AuthRateLimit.attempts + 1, limit + 1)),
                "expires_at": case((expired, now + timedelta(seconds=window)), else_=AuthRateLimit.expires_at),
            },
        ).returning(AuthRateLimit.attempts, AuthRateLimit.expires_at)
        attempts, expires_at = self._session.execute(statement).one()
        db_now = self._session.scalar(select(func.clock_timestamp()))
        retry_after = max(1, int((expires_at - db_now).total_seconds()) + 1)
        return attempts, retry_after

    def cleanup(self) -> None:
        # Обмежена порція та SKIP LOCKED не затримують конкурентні входи.
        stale = select(AuthRateLimit.key).where(
            AuthRateLimit.expires_at < func.clock_timestamp() - timedelta(hours=1),
        ).order_by(AuthRateLimit.expires_at).limit(100).with_for_update(skip_locked=True)
        self._session.execute(delete(AuthRateLimit).where(AuthRateLimit.key.in_(stale)))
