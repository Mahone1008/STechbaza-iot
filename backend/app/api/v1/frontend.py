import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.schemas.frontend import AccessErrorRead, DeviceOverviewRead, OrganizationAccessRead
from app.security.current_user import CurrentUserContext, get_current_user_context
from app.services.frontend import FrontendReadService, OverviewPermissionError

router = APIRouter(tags=["frontend"], responses={
    401: {"model": AccessErrorRead, "description": "Потрібна дійсна authentication session"},
    403: {"model": AccessErrorRead, "description": "Недостатньо прав або користувача вимкнено"},
    404: {"model": AccessErrorRead, "description": "Ресурс відсутній або не належить доступному tenant"},
})
DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[CurrentUserContext, Depends(get_current_user_context)]


@router.get("/organizations/{organization_id}/access", response_model=OrganizationAccessRead)
def get_organization_access(
    organization_id: uuid.UUID, session: DbSession, current: CurrentUser,
) -> OrganizationAccessRead:
    """Поточні tenant permissions для інтерфейсу; кожна дія перевіряється окремо."""
    return FrontendReadService(session, current).organization_access(organization_id)


@router.get("/devices/{device_id}/overview", response_model=DeviceOverviewRead)
def get_device_overview(
    device_id: uuid.UUID, session: DbSession, current: CurrentUser,
) -> DeviceOverviewRead:
    """Зведення пристрою з реально призначеними enabled capabilities."""
    try:
        return FrontendReadService(session, current).device_overview(device_id)
    except OverviewPermissionError as exc:
        raise HTTPException(status_code=403, detail="Недостатньо прав для огляду пристрою") from exc
