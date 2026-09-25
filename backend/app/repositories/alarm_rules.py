import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.alarm_rule_state import DeviceAlarmRuleState


class AlarmRuleStateRepository:
    """SQL-доступ до durable debounce-state Rule Engine."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_for_update(
        self,
        device_id: uuid.UUID,
        rule_key: str,
    ) -> DeviceAlarmRuleState | None:
        statement = (
            select(DeviceAlarmRuleState)
            .where(
                DeviceAlarmRuleState.device_id == device_id,
                DeviceAlarmRuleState.rule_key == rule_key,
            )
            .with_for_update()
        )
        return self._session.scalar(statement)

    def get_or_create_for_update(
        self,
        *,
        device_id: uuid.UUID,
        rule_key: str,
    ) -> DeviceAlarmRuleState:
        state = self.get_for_update(device_id, rule_key)
        if state is not None:
            return state

        state = DeviceAlarmRuleState(
            device_id=device_id,
            rule_key=rule_key,
            pending_action=None,
            pending_count=0,
        )
        self._session.add(state)
        self._session.flush()
        return state

    def observe(
        self,
        state: DeviceAlarmRuleState,
        *,
        value: float,
        observed_at: datetime,
        source_message_id: uuid.UUID,
    ) -> None:
        state.last_value = {"value": value}
        state.last_observed_at = observed_at
        state.last_source_message_id = source_message_id

    def set_pending(
        self,
        state: DeviceAlarmRuleState,
        action: str,
    ) -> int:
        if state.pending_action == action:
            state.pending_count += 1
        else:
            state.pending_action = action
            state.pending_count = 1

        self._session.flush()
        return state.pending_count

    def reset_pending(self, state: DeviceAlarmRuleState) -> None:
        state.pending_action = None
        state.pending_count = 0
        self._session.flush()
