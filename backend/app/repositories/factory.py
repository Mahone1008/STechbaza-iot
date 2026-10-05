"""Factory inventory queries, independent of HTTP and buyer workflows."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.onboarding import FactoryAudit, FactoryController


class FactoryRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, controller_id: uuid.UUID, *, lock: bool = False) -> FactoryController | None:
        statement = select(FactoryController).where(FactoryController.id == controller_id)
        if lock:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        return self._session.scalar(statement)

    def list_controllers(self, *, limit: int, offset: int) -> list[FactoryController]:
        return list(
            self._session.scalars(
                select(FactoryController)
                .order_by(FactoryController.created_at.desc(), FactoryController.id)
                .limit(limit)
                .offset(offset)
            )
        )

    def list_audit(
        self, controller_id: uuid.UUID, *, limit: int, offset: int
    ) -> list[FactoryAudit]:
        return list(
            self._session.scalars(
                select(FactoryAudit)
                .where(FactoryAudit.controller_id == controller_id)
                .order_by(FactoryAudit.occurred_at.desc(), FactoryAudit.id)
                .limit(limit)
                .offset(offset)
            )
        )
