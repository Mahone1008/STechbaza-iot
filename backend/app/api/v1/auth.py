from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
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
    BrowserTokenResponse,
)
from app.security.browser_auth import (
    require_browser_request, read_refresh_cookie, set_refresh_cookie, clear_refresh_cookie,
)
from app.services.auth_throttle import AuthThrottle, AuthRateLimitedError
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


router = APIRouter(prefix="/auth", tags=["auth"], responses={
    401: {"description": "Недійсна authentication session або credentials"},
    403: {"description": "Account вимкнено або браузерний запит заборонено"},
    429: {"description": "Забагато спроб; Retry-After містить секунди очікування"},
    503: {"description": "Auth storage тимчасово недоступне"},
})

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


def _throttle(request: Request, session: Session, *, email: str | None = None) -> None:
    # Беремо peer ASGI; довіра до proxy headers налаштовується лише на сервері.
    ip = request.client.host if request.client else "unknown-peer"
    try:
        AuthThrottle(session).check(ip, email=email)
    except AuthRateLimitedError as exc:
        raise HTTPException(429, "Забагато auth-спроб. Спробуйте пізніше",
                            headers={"Retry-After": str(exc.retry_after)}) from exc
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(503, "Auth storage тимчасово недоступне") from exc


def _login_pair(
    payload: LoginRequest,
    request: Request,
    session: DbSession,
):
    _throttle(request, session, email=str(payload.email))
    try:
        pair = AuthService(session).login(payload)
    except InvalidCredentialsError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Невірний email, пароль або код двоетапного входу",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except InactiveUserError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Обліковий запис вимкнено",
        ) from exc

    return pair


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, session: DbSession) -> TokenResponse:
    return _token_response(_login_pair(payload, request, session))


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    payload: RefreshTokenRequest,
    request: Request,
    session: DbSession,
) -> TokenResponse:
    _throttle(request, session)
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
    request: Request,
    session: DbSession,
) -> Response:
    _throttle(request, session)
    AuthService(session).logout(payload.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _browser_response(pair) -> BrowserTokenResponse:
    return BrowserTokenResponse(access_token=pair.access_token, expires_in=pair.access_expires_in,
                                session_expires_in=pair.refresh_expires_in)


@router.post("/browser/login", response_model=BrowserTokenResponse,
             dependencies=[Depends(require_browser_request)])
def browser_login(payload: LoginRequest, request: Request, response: Response, session: DbSession):
    pair = _login_pair(payload, request, session)
    # Повторний вхід у тій самій вкладці не залишає попередню cookie-сесію активною.
    old_token = read_refresh_cookie(request)
    if old_token:
        AuthService(session).logout(old_token)
    set_refresh_cookie(response, pair.refresh_token, pair.refresh_expires_in)
    return _browser_response(pair)


@router.post("/browser/refresh", response_model=BrowserTokenResponse,
             dependencies=[Depends(require_browser_request)])
def browser_refresh(request: Request, response: Response, session: DbSession):
    _throttle(request, session)
    token = read_refresh_cookie(request)
    try:
        if token is None:
            raise InvalidRefreshTokenError
        pair = AuthService(session).refresh(token)
    except (InvalidRefreshTokenError, InactiveUserError) as exc:
        # Не видаляємо cookie на невдалий refresh: запізніла паралельна
        # відповідь не повинна стерти нову cookie успішного refresh.
        code = 403 if isinstance(exc, InactiveUserError) else 401
        return JSONResponse({"detail": "Браузерна сесія недійсна або завершилася"}, status_code=code)
    set_refresh_cookie(response, pair.refresh_token, pair.refresh_expires_in)
    return _browser_response(pair)


@router.post("/browser/logout", status_code=204,
             dependencies=[Depends(require_browser_request)])
def browser_logout(request: Request, session: DbSession):
    _throttle(request, session)
    token = read_refresh_cookie(request)
    if token:
        AuthService(session).logout(token)
    response = Response(status_code=204)
    clear_refresh_cookie(response)
    return response


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
