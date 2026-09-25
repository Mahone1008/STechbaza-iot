from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.schemas.auth import (
    LoginRequest,
    LogoutRequest,
    RefreshTokenRequest,
    TokenResponse,
)
from app.services.auth import (
    AuthService,
    InactiveUserError,
    InvalidCredentialsError,
    InvalidRefreshTokenError,
)


router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[Session, Depends(get_db_session)]


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
