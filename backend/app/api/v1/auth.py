from app.api.auth_throttle import throttle_auth
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
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
    LoginErrorResponse,
)
from app.security.browser_auth import (
    require_browser_request,
    read_refresh_cookie,
    set_refresh_cookie,
    clear_refresh_cookie,
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
    MfaRequiredError,
    InvalidMfaCodeError,
)


router = APIRouter(
    prefix="/auth",
    tags=["auth"],
    responses={
        401: {"description": "Недійсна authentication session або credentials"},
        403: {"description": "Account вимкнено або браузерний запит заборонено"},
        429: {"description": "Забагато спроб; Retry-After містить секунди очікування"},
        503: {"description": "Auth storage тимчасово недоступне"},
    },
)

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[
    CurrentUserContext,
    Depends(get_current_user_context),
]

LOGIN_RESPONSES = {
    401: {
        "model": LoginErrorResponse,
        "description": "Неправильні дані входу або mfa_required / mfa_invalid після перевірки пароля",
    }
}


def _token_response(pair) -> TokenResponse:
    return TokenResponse(
        access_token=pair.access_token,
        expires_in=pair.access_expires_in,
        refresh_token=pair.refresh_token,
        refresh_expires_in=pair.refresh_expires_in,
    )


def _login_pair(
    payload: LoginRequest,
    request: Request,
    session: DbSession,
):
    throttle_auth(request, session, email=str(payload.email or payload.controller_id))
    try:
        pair = AuthService(session).login(payload, client_ip=request.client.host if request.client else None, user_agent=request.headers.get("user-agent"))
    except (MfaRequiredError, InvalidMfaCodeError) as exc:
        required = isinstance(exc, MfaRequiredError)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "mfa_required" if required else "mfa_invalid",
                "message": (
                    "Для цього облікового запису ввімкнено двоетапний вхід. Введіть код із застосунку."
                    if required
                    else "Код із застосунку не прийнято. Дочекайтеся нового коду й повторіть вхід."
                ),
            },
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except InvalidCredentialsError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Невірний логін або пароль",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except InactiveUserError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Обліковий запис вимкнено",
        ) from exc

    from app.security.tokens import decode_access_token
    claims = decode_access_token(pair.access_token)
    request.state.audit_user_id = claims["sub"]
    request.state.audit_session_id = claims["sid"]
    return pair


@router.post("/login", response_model=TokenResponse, responses=LOGIN_RESPONSES)
def login(payload: LoginRequest, request: Request, session: DbSession) -> TokenResponse:
    return _token_response(_login_pair(payload, request, session))


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    payload: RefreshTokenRequest,
    request: Request,
    session: DbSession,
) -> TokenResponse:
    throttle_auth(request, session)
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
    throttle_auth(request, session)
    AuthService(session).logout(payload.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _browser_response(pair) -> BrowserTokenResponse:
    return BrowserTokenResponse(
        access_token=pair.access_token,
        expires_in=pair.access_expires_in,
        session_expires_in=pair.refresh_expires_in,
        onboarding_path=pair.onboarding_path,
    )


@router.post(
    "/browser/login",
    response_model=BrowserTokenResponse,
    responses=LOGIN_RESPONSES,
    dependencies=[Depends(require_browser_request)],
)
def browser_login(payload: LoginRequest, request: Request, response: Response, session: DbSession):
    pair = _login_pair(payload, request, session)
    # Повторний вхід у тій самій вкладці не залишає попередню cookie-сесію активною.
    old_token = read_refresh_cookie(request)
    if old_token:
        AuthService(session).logout(old_token)
    set_refresh_cookie(response, pair.refresh_token, pair.refresh_expires_in)
    return _browser_response(pair)


@router.post(
    "/browser/refresh",
    response_model=BrowserTokenResponse,
    dependencies=[Depends(require_browser_request)],
)
def browser_refresh(request: Request, response: Response, session: DbSession):
    throttle_auth(request, session)
    token = read_refresh_cookie(request)
    try:
        if token is None:
            raise InvalidRefreshTokenError
        pair = AuthService(session).refresh(token)
    except (InvalidRefreshTokenError, InactiveUserError) as exc:
        # Не видаляємо cookie на невдалий refresh: запізніла паралельна
        # відповідь не повинна стерти нову cookie успішного refresh.
        code = 403 if isinstance(exc, InactiveUserError) else 401
        return JSONResponse(
            {"detail": "Браузерна сесія недійсна або завершилася"}, status_code=code
        )
    set_refresh_cookie(response, pair.refresh_token, pair.refresh_expires_in)
    return _browser_response(pair)


@router.post("/browser/logout", status_code=204, dependencies=[Depends(require_browser_request)])
def browser_logout(request: Request, session: DbSession):
    throttle_auth(request, session)
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
    memberships = MembershipRepository(session).list_active_for_user(current.user.id)

    return CurrentUserRead(
        id=current.user.id,
        email=current.user.email,
        login_name=current.user.login_name,
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
