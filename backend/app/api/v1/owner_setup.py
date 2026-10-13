"""Власник керує лише первинною підготовкою свого контролера."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.schemas.owner_setup import SetupAccept, SetupApply, SetupDraftWrite, SetupRead
from app.security.current_user import CurrentUserContext, get_current_user_context
from app.services import owner_setup
from app.services.equipment import EquipmentConflict

router = APIRouter(tags=["owner-setup"])
Db = Annotated[Session, Depends(get_db_session)]
Current = Annotated[CurrentUserContext, Depends(get_current_user_context)]


def context(session, current, controller_id, response):
    response.headers["Cache-Control"] = "no-store"
    try:
        return owner_setup.require_owner_context(session, current, controller_id)
    except EquipmentConflict as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/connect/{controller_id}/setup", response_model=SetupRead)
def get_setup(controller_id: uuid.UUID, current: Current, session: Db, response: Response):
    ctx = context(session, current, controller_id, response)
    return owner_setup.read_setup(session, ctx, can_setup=True)


@router.put("/connect/{controller_id}/setup/draft", response_model=SetupRead)
def put_draft(controller_id: uuid.UUID, payload: SetupDraftWrite, current: Current, session: Db, response: Response):
    ctx = context(session, current, controller_id, response)
    result = owner_setup.save_draft(session, ctx, payload, actor_user_id=current.user.id,
        actor_session_id=current.auth_session.id)
    session.commit()
    return result


@router.post("/connect/{controller_id}/setup/apply", response_model=SetupRead)
def apply(controller_id: uuid.UUID, payload: SetupApply, current: Current, session: Db, response: Response):
    ctx = context(session, current, controller_id, response)
    try:
        result = owner_setup.apply_draft(session, current, ctx, payload)
    except EquipmentConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    session.commit()
    return result


@router.post("/connect/{controller_id}/setup/accept", response_model=SetupRead)
def accept(controller_id: uuid.UUID, payload: SetupAccept, current: Current, session: Db, response: Response):
    ctx = context(session, current, controller_id, response)
    try:
        result = owner_setup.accept_setup(session, current, ctx, payload)
    except EquipmentConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    session.commit()
    return result
