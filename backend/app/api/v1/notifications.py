import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.repositories.notifications import NotificationRepository
from app.schemas.notification import (
    AlarmNotificationRead, NotificationReadReceipt, NotificationUnreadCount,
)
from app.security.authorization import AccessControl
from app.security.current_user import CurrentUserContext, get_current_user_context
from app.security.roles import Permission
from app.services.notifications import NotificationService

router = APIRouter(tags=["notifications"])
DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[CurrentUserContext, Depends(get_current_user_context)]


@router.get(
    "/organizations/{organization_id}/notifications",
    response_model=list[AlarmNotificationRead],
)
def list_notifications(
    organization_id: uuid.UUID, session: DbSession, current: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    unread_only: bool = False,
) -> list[AlarmNotificationRead]:
    AccessControl(session, current).require_organization(
        organization_id, Permission.NOTIFICATION_READ,
    )
    rows = NotificationRepository(session).list_for_organization(
        organization_id, current.user.id,
        limit=limit, offset=offset, unread_only=unread_only,
    )
    return [
        AlarmNotificationRead.model_validate(item).model_copy(update={"read_at": read_at})
        for item, read_at in rows
    ]


@router.get(
    "/organizations/{organization_id}/notifications/unread-count",
    response_model=NotificationUnreadCount,
)
def unread_count(
    organization_id: uuid.UUID, session: DbSession, current: CurrentUser,
) -> NotificationUnreadCount:
    AccessControl(session, current).require_organization(
        organization_id, Permission.NOTIFICATION_READ,
    )
    return NotificationUnreadCount(unread_count=NotificationRepository(session).unread_count(
        organization_id, current.user.id,
    ))


@router.get("/notifications/{notification_id}", response_model=AlarmNotificationRead)
def get_notification(
    notification_id: uuid.UUID, session: DbSession, current: CurrentUser,
) -> AlarmNotificationRead:
    item = AccessControl(session, current).require_notification(
        notification_id, Permission.NOTIFICATION_READ,
    )
    read_at = NotificationRepository(session).read_at(notification_id, current.user.id)
    return AlarmNotificationRead.model_validate(item).model_copy(update={"read_at": read_at})


@router.post("/notifications/{notification_id}/read", response_model=NotificationReadReceipt)
def mark_notification_read(
    notification_id: uuid.UUID, session: DbSession, current: CurrentUser,
) -> NotificationReadReceipt:
    AccessControl(session, current).require_notification(
        notification_id, Permission.NOTIFICATION_READ,
    )
    read_at = NotificationService(session).mark_read(notification_id, current.user.id)
    return NotificationReadReceipt(notification_id=notification_id, read_at=read_at)
