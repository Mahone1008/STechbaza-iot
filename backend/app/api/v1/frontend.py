import uuid
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.schemas.frontend import AccessErrorRead, DeviceOverviewRead, OrganizationAccessRead
from app.security.current_user import CurrentUserContext, get_current_user_context
from app.services.frontend import FrontendReadService, OverviewPermissionError
from app.schemas.telemetry_read import TelemetrySeriesQuery, TelemetrySeriesRead
from app.services.telemetry_series import (
    TelemetrySeriesService, SeriesMetricError, SeriesCapabilityError,
    SeriesTooLargeError, SeriesPermissionError,
)

logger = logging.getLogger(__name__)

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
    device_id: uuid.UUID, session: DbSession, current: CurrentUser, response: Response,
) -> DeviceOverviewRead:
    """Зведення пристрою з реально призначеними enabled capabilities."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return FrontendReadService(session, current).device_overview(device_id)
    except OverviewPermissionError as exc:
        raise HTTPException(status_code=403, detail="Недостатньо прав для огляду пристрою") from exc


@router.get("/devices/{device_id}/telemetry/series", response_model=TelemetrySeriesRead,
            responses={409: {"model": AccessErrorRead, "description": "Capability метрики вимкнена або не призначена"},
                       503: {"model": AccessErrorRead, "description": "Сховище недоступне або запит перевищив timeout"}})
def get_device_telemetry_series(
    device_id: uuid.UUID, query: Annotated[TelemetrySeriesQuery, Query()],
    session: DbSession, current: CurrentUser, response: Response,
) -> TelemetrySeriesRead:
    """Обмежений графік числової метрики за часом приймання сервером, [start, end)."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return TelemetrySeriesService(session, current).read(device_id, query)
    except SeriesPermissionError as exc:
        raise HTTPException(403, "Недостатньо прав для графіка пристрою") from exc
    except SeriesMetricError as exc:
        raise HTTPException(422, "Невідома або нечислова метрика") from exc
    except SeriesCapabilityError as exc:
        raise HTTPException(409, "Capability метрики вимкнена або не призначена") from exc
    except SeriesTooLargeError as exc:
        raise HTTPException(422, "Період містить понад 100000 пакетів; скоротіть період") from exc
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Telemetry series query failed for device %s", device_id)
        raise HTTPException(503, "Графік тимчасово недоступний; спробуйте менший період або повторіть пізніше") from exc
