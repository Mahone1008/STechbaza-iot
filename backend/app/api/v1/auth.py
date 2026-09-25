from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.repositories.memberships import MembershipRepository
from app.schemas.current_user import (
    CurrentUserMembershipRead,
    CurrentUserRead,
)
from app.schemas.auth import (
    LoginRequest,
    LogoutRequest,
    RefreshTokenRequest,
    TokenResponse,
)
from app.security.current_user import (
    CurrentUserContext,
    get_current_user_context,
)
from app.services.auth import (
    AuthService,
    InactiveUserError,
    InvalidCredentialsError,
    InvalidRefreshTokenError,
)


router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[
    CurrentUserContext,
    Depends(get_current_user_context),
]


def _token_response(pair) -> TokenResponse:
    return TokenResponse(
        access_token=pair.access_token,
        expires_in=pair.access_expires_in,
        refresh_token=pair.refresh_token,
        refresh_expires_in=pair.refresh_expires_in,
    )


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    session: DbSession,
) -> TokenResponse:
    try:
        pair = AuthService(session).login(payload)
    except InvalidCredentialsError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Невірний email або пароль",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except InactiveUserError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Обліковий запис вимкнено",
        ) from exc

    return _token_response(pair)


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    payload: RefreshTokenRequest,
    session: DbSession,
) -> TokenResponse:
    try:
        pair = AuthService(session).refresh(payload.refresh_token)
    except InvalidRefreshTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token недійсний або завершився",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except InactiveUserError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Обліковий запис вимкнено",
        ) from exc

    return _token_response(pair)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    payload: LogoutRequest,
    session: DbSession,
) -> Response:
    AuthService(session).logout(payload.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=CurrentUserRead)
def me(
    current: CurrentUser,
    session: DbSession,
) -> CurrentUserRead:
    memberships = MembershipRepository(session).list_active_for_user(
        current.user.id
    )

    return CurrentUserRead(
        id=current.user.id,
        email=current.user.email,
        display_name=current.user.display_name,
        platform_role=current.user.platform_role,
        is_active=current.user.is_active,
        auth_session_id=current.auth_session.id,
        auth_session_expires_at=current.auth_session.expires_at,
        memberships=[
            CurrentUserMembershipRead(
                organization_id=membership.organization_id,
                role=membership.role,
            )
            for membership in memberships
        ],
    )
