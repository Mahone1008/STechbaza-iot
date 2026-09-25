from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.auth_session import AuthSession


class AuthSessionRepository:
    """SQL-операції для server-side refresh token sessions."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, auth_session: AuthSession) -> AuthSession:
        self._session.add(auth_session)
        self._session.flush()
        self._session.refresh(auth_session)
        return auth_session

    def get_by_refresh_hash_for_update(
        self,
        refresh_token_hash: str,
    ) -> AuthSession | None:
        statement = (
            select(AuthSession)
            .where(AuthSession.refresh_token_hash == refresh_token_hash)
            .with_for_update()
        )
        return self._session.scalar(statement)
