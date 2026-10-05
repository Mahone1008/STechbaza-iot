"""HTTP endpoints for passwords, MFA, recovery and session management."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.auth_throttle import throttle_auth
from app.db import get_db_session
from app.schemas.onboarding import (
    RecoveryRead,
    RecoveryRequest,
    PasswordChange,
    SecurityProof,
    SecurityRead,
    SessionRead,
    TotpConfirm,
    TotpSetupRead,
)
from app.security.browser_auth import require_browser_request
from app.security.current_user import CurrentUserContext, get_current_user_context
from app.services.account_security import AccountSecurityService

router = APIRouter(prefix="/auth", tags=["account-security"])
Db = Annotated[Session, Depends(get_db_session)]
Current = Annotated[CurrentUserContext, Depends(get_current_user_context)]


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


@router.post(
    "/recover", response_model=RecoveryRead, dependencies=[Depends(require_browser_request)]
)
def recover(payload: RecoveryRequest, request: Request, response: Response, session: Db):
    throttle_auth(request, session, email=str(payload.email))
    no_store(response)
    return AccountSecurityService(session).recover(payload)


@router.get("/security", response_model=SecurityRead)
def security(current: Current, response: Response, session: Db):
    no_store(response)
    return AccountSecurityService(session).read(current)


@router.post("/security/recovery", response_model=RecoveryRead)
def rotate_recovery(
    payload: SecurityProof, current: Current, request: Request, response: Response, session: Db
):
    throttle_auth(request, session, email=current.user.email)
    no_store(response)
    return AccountSecurityService(session).rotate_recovery(current, payload)


@router.post("/security/totp/setup", response_model=TotpSetupRead)
def setup_totp(
    payload: SecurityProof, current: Current, request: Request, response: Response, session: Db
):
    throttle_auth(request, session, email=current.user.email)
    no_store(response)
    return AccountSecurityService(session).setup_totp(current, payload)


@router.post("/security/totp/confirm", status_code=204)
def confirm_totp(payload: TotpConfirm, current: Current, request: Request, session: Db):
    throttle_auth(request, session, email=current.user.email)
    AccountSecurityService(session).confirm_totp(current, payload.otp)
    return Response(status_code=204)


@router.get("/sessions", response_model=list[SessionRead])
def sessions(current: Current, session: Db):
    return AccountSecurityService(session).list_sessions(current)


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(session_id: uuid.UUID, current: Current, session: Db):
    AccountSecurityService(session).revoke_session(current, session_id)
    return Response(status_code=204)


@router.post("/security/password", status_code=204)
def change_password(payload: PasswordChange, current: Current, request: Request, session: Db):
    throttle_auth(request, session, email=current.user.email)
    AccountSecurityService(session).change_password(current, payload)
    return Response(status_code=204)
