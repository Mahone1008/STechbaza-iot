"""Opt-in local check that telemetry and rule state roll back together.

Run against a test device with an enabled numeric alarm rule. This command
injects an exception after the rule engine has flushed its changes. It must
not leave a telemetry message, snapshot change, or rule-state change behind.
"""

import argparse
import copy
import uuid
from unittest.mock import patch

from sqlalchemy import select

from app.db import SessionLocal
from app.models.alarm_rule_state import DeviceAlarmRuleState
from app.models.device import Device
from app.models.event_alarm import AlarmTransition, DeviceAlarm, DeviceEvent
from app.models.telemetry import DeviceState, TelemetryMessage
from app.schemas.telemetry import TelemetryEnvelope
from app.services.alarm_rule_engine import TelemetryAlarmRuleEngine
from app.services.telemetry import TelemetryService


class InjectedRuleFailure(Exception):
    """Expected failure after the rule engine's database flush."""


def _read_state(session, device_id: uuid.UUID, rule_key: str) -> tuple:
    snapshot = session.get(DeviceState, device_id)
    rule = session.scalar(
        select(DeviceAlarmRuleState).where(
            DeviceAlarmRuleState.device_id == device_id,
            DeviceAlarmRuleState.rule_key == rule_key,
        )
    )
    return (
        (
            snapshot.last_telemetry_id,
            snapshot.last_session_id,
            snapshot.last_sequence,
            copy.deepcopy(snapshot.values),
            copy.deepcopy(snapshot.state),
        ) if snapshot is not None else None,
        (
            rule.pending_action,
            rule.pending_count,
            copy.deepcopy(rule.last_value),
            rule.last_source_message_id,
        ) if rule is not None else None,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device-uid", required=True)
    parser.add_argument("--rule-key", required=True)
    parser.add_argument("--metric", required=True)
    parser.add_argument("--value", type=float, required=True)
    args = parser.parse_args()

    message_id = uuid.uuid4()
    envelope = TelemetryEnvelope(
        schema_version=1,
        message_id=message_id,
        session_id=uuid.uuid4(),
        sequence=1,
        values={args.metric: args.value},
        state={},
    )

    with SessionLocal() as session:
        device = session.scalar(select(Device).where(Device.uid == args.device_uid))
        if device is None:
            parser.error("test device not found")
        device_id = device.id
        rules = TelemetryAlarmRuleEngine(session)._load_rules(device_id)
        matching_rules = [
            rule for _, rule in rules
            if rule.rule_key == args.rule_key
            and rule.source == "values"
            and rule.metric == args.metric
        ]
        if not matching_rules:
            parser.error("enabled rule for this metric not found")
        rule_config = matching_rules[0]
        if TelemetryAlarmRuleEngine._candidate_action(
            rule=rule_config,
            value=args.value,
            alarm_is_active=False,
        ) != "raise":
            parser.error("test value must cross the rule's raise threshold")
        before = _read_state(session, device_id, args.rule_key)

    original_evaluate = TelemetryAlarmRuleEngine.evaluate
    created = {}

    def evaluate_then_fail(engine, **kwargs):
        result = original_evaluate(engine, **kwargs)
        action = next(
            (item for item in result.actions if item.rule_key == args.rule_key),
            None,
        )
        if action is None or action.action != "raised":
            raise AssertionError("test rule did not raise an alarm")
        if action.event_id is None or action.alarm_id is None:
            raise AssertionError("raised alarm has no event or alarm id")
        created["event_id"] = action.event_id
        created["alarm_id"] = action.alarm_id

        # Force pending ORM writes to reach PostgreSQL before the exception.
        engine._session.flush()
        rule = engine._session.scalar(
            select(DeviceAlarmRuleState).where(
                DeviceAlarmRuleState.device_id == device_id,
                DeviceAlarmRuleState.rule_key == args.rule_key,
            )
        )
        if rule is None or rule.last_source_message_id != kwargs["source_message_id"]:
            raise AssertionError("test rule did not write its state")
        raise InjectedRuleFailure("intentional failure after rule evaluation")

    with SessionLocal() as session:
        # Preload one pending sample inside this same transaction. The tested
        # packet must create an Event and Alarm; rollback removes the preload.
        session.scalar(select(Device).where(Device.id == device_id).with_for_update())
        active_alarm = session.scalar(
            select(DeviceAlarm.id).where(
                DeviceAlarm.device_id == device_id,
                DeviceAlarm.alarm_key == args.rule_key,
                DeviceAlarm.state == "active",
            )
        )
        if active_alarm is not None:
            parser.error("resolve the active test alarm before running this check")
        pending = session.scalar(
            select(DeviceAlarmRuleState).where(
                DeviceAlarmRuleState.device_id == device_id,
                DeviceAlarmRuleState.rule_key == args.rule_key,
            ).with_for_update()
        )
        if pending is None:
            parser.error("rule state does not exist; run normal rule tests first")
        pending.pending_action = "raise"
        pending.pending_count = rule_config.debounce_samples - 1
        session.flush()
        try:
            with patch.object(TelemetryAlarmRuleEngine, "evaluate", evaluate_then_fail):
                TelemetryService(session).ingest(
                    device_uid=args.device_uid,
                    payload=envelope,
                )
        except InjectedRuleFailure:
            pass
        else:
            raise AssertionError("expected failure did not happen")

    with SessionLocal() as session:
        message = session.scalar(
            select(TelemetryMessage.id).where(
                TelemetryMessage.message_id == message_id
            )
        )
        events = session.scalar(
            select(DeviceEvent.id).where(DeviceEvent.id == created["event_id"])
        )
        alarm = session.scalar(
            select(DeviceAlarm.id).where(DeviceAlarm.id == created["alarm_id"])
        )
        transition = session.scalar(
            select(AlarmTransition.id).where(
                AlarmTransition.event_id == created["event_id"]
            )
        )
        after = _read_state(session, device_id, args.rule_key)

    assert message is None, "telemetry message survived rollback"
    assert events is None, "alarm event survived rollback"
    assert alarm is None, "alarm survived rollback"
    assert transition is None, "alarm transition survived rollback"
    assert after == before, "snapshot or rule state changed after rollback"
    print("PASS: forced failure rolled back message, snapshot, rule state, event, alarm and transition")
    print(f"test_message_id={message_id}")


if __name__ == "__main__":
    main()
