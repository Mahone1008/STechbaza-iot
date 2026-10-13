"""Власник видає коротку допомогу; анонімний helper лише пропонує чернетку."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.auth_throttle import throttle_auth
from app.api.v1.owner_setup import context
from app.db import get_db_session
from app.schemas.setup_helpers import (
    SetupHelperContext, SetupHelperCreate, SetupHelperCreated, SetupHelperDraftWrite,
    SetupHelperProof, SetupHelperRead,
)
from app.security.browser_auth import require_browser_request
from app.security.current_user import CurrentUserContext, get_current_user_context
from app.services import owner_setup, setup_helpers

router = APIRouter(tags=["setup-helpers"])
Db = Annotated[Session, Depends(get_db_session)]
Current = Annotated[CurrentUserContext, Depends(get_current_user_context)]


@router.get("/connect/{controller_id}/setup/helpers", response_model=list[SetupHelperRead])
def helper_list(controller_id: uuid.UUID, current: Current, session: Db, response: Response):
    return setup_helpers.list_helpers(session, context(session, current, controller_id, response))


@router.post("/connect/{controller_id}/setup/helpers", response_model=SetupHelperCreated, status_code=201)
def helper_create(controller_id: uuid.UUID, payload: SetupHelperCreate, current: Current,
                  request: Request, session: Db, response: Response):
    throttle_auth(request, session, email="setup-helper:" + str(current.user.id))
    ctx = context(session, current, controller_id, response)
    result = setup_helpers.create_helper(session, current, ctx, payload)
    session.commit()
    return result


@router.delete("/connect/{controller_id}/setup/helpers/{helper_id}", status_code=204)
def helper_revoke(controller_id: uuid.UUID, helper_id: uuid.UUID, current: Current,
                  session: Db, response: Response):
    setup_helpers.revoke_helper(session, current, context(session, current, controller_id, response), helper_id)
    session.commit()
    return Response(status_code=204)


@router.post("/setup-help/inspect", response_model=SetupHelperContext, dependencies=[Depends(require_browser_request)])
def helper_inspect(payload: SetupHelperProof, request: Request, session: Db):
    throttle_auth(request, session)
    row, ctx = setup_helpers.helper_context(session, payload.token)
    return setup_helpers.public_read(session, row, ctx)


@router.put("/setup-help/draft", response_model=SetupHelperContext, dependencies=[Depends(require_browser_request)])
def helper_draft(payload: SetupHelperDraftWrite, request: Request, session: Db):
    throttle_auth(request, session)
    row, ctx = setup_helpers.helper_context(session, payload.token)
    owner_setup.save_draft(session, ctx, payload, actor_helper_id=row.id)
    result = setup_helpers.public_read(session, row, ctx)
    session.commit()
    return result
