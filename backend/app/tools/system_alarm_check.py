"""Перевірити системні Alarm у транзакції без змін у робочій базі.

Запуск: python -m app.tools.system_alarm_check
Потрібні застосована migration 0013 та хоча б один Site у локальній БД.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import engine
from app.models.command import DeviceCommand
from app.models.device import Device
from app.models.event_alarm import AlarmTransition, DeviceAlarm, DeviceEvent
from app.models.site import Site
from app.schemas.command_result import CommandResultEnvelope
from app.services.command_dispatch import CommandDispatchService
from app.services.command_result import CommandResultService
from app.services.device_presence import DevicePresenceService
from app.services.presence_config import DEVICE_ONLINE_TIMEOUT_SECONDS
from app.services.system_alarms import SystemAlarmService


def _alarm(session: Session, device_id: uuid.UUID, key: str) -> DeviceAlarm:
    item = session.scalar(
        select(DeviceAlarm)
        .where(DeviceAlarm.device_id == device_id, DeviceAlarm.alarm_key == key)
        .order_by(DeviceAlarm.first_raised_at.desc())
        .limit(1)
    )
    assert item is not None, f"Alarm {key} не знайдено"
    return item


def _new_command(
    session: Session,
    device: Device,
    *,
    created_at: datetime,
    expires_at: datetime,
) -> DeviceCommand:
    command = DeviceCommand(
        device_id=device.id,
        request_id=uuid.uuid4(),
        command_type="vfd.start",
        payload={},
        status="published",
        ttl_seconds=30,
        created_at=created_at,
        expires_at=expires_at,
    )
    session.add(command)
    session.flush()
    return command


def main() -> None:
    now = datetime.now(timezone.utc)
    test_uid = f"TB-SYSTEM-TEST-{uuid.uuid4().hex[:12]}"
    device_id = uuid.uuid4()
    connection = engine.connect()
    outer = connection.begin()
    try:
        # Сервіси самі роблять commit: savepoint не завершує outer transaction.
        with Session(
            bind=connection,
            join_transaction_mode="create_savepoint",
            expire_on_commit=False,
            autoflush=False,
        ) as session:
            site_id = session.scalar(select(Site.id).limit(1))
            if site_id is None:
                raise RuntimeError("У локальній БД немає Site для тесту")
            device = Device(
                id=device_id,
                site_id=site_id,
                uid=test_uid,
                name="Temporary System Alarm Check",
                lifecycle_status="active",
            )
            session.add(device)
            session.flush()
            presence = DevicePresenceService(session)
            system = SystemAlarmService(session)
            session_a = uuid.uuid4()
            session_b = uuid.uuid4()
            first = presence.mark_seen(
                device_uid=test_uid,
                session_id=session_a,
                message_id=uuid.uuid4(),
                sequence=1,
                received_at=now,
            )
            assert first.accepted and first.reason == "session_tracking_initialized"

            reboot_message = uuid.uuid4()
            reboot = presence.mark_seen(
                device_uid=test_uid,
                session_id=session_b,
                message_id=reboot_message,
                sequence=1,
                received_at=now + timedelta(seconds=1),
            )
            assert reboot.accepted and reboot.reason == "new_session"
            assert _alarm(session, device_id, "device.reboot").state == "active"
            duplicate = presence.mark_seen(
                device_uid=test_uid,
                session_id=session_b,
                message_id=reboot_message,
                sequence=1,
                received_at=now + timedelta(seconds=2),
            )
            assert not duplicate.accepted
            assert _alarm(session, device_id, "device.reboot").state == "active"

            stable = presence.mark_seen(
                device_uid=test_uid,
                session_id=session_b,
                message_id=uuid.uuid4(),
                sequence=2,
                received_at=now + timedelta(seconds=3),
            )
            assert stable.accepted
            assert _alarm(session, device_id, "device.reboot").state == "resolved"
            old = presence.mark_seen(
                device_uid=test_uid,
                session_id=session_a,
                message_id=uuid.uuid4(),
                sequence=2,
                received_at=now + timedelta(seconds=4),
            )
            assert not old.accepted and old.reason == "old_session_reappeared"
            assert device.last_observed_session_id == session_b

            offline_at = now + timedelta(seconds=DEVICE_ONLINE_TIMEOUT_SECONDS + 5)
            assert system.check_offline(device_id=device_id, now=offline_at)
            session.commit()
            assert not system.check_offline(device_id=device_id, now=offline_at)
            assert _alarm(session, device_id, "device.offline").state == "active"
            recovered = presence.mark_seen(
                device_uid=test_uid,
                session_id=session_b,
                message_id=uuid.uuid4(),
                sequence=3,
                received_at=offline_at + timedelta(seconds=1),
            )
            assert recovered.accepted
            assert _alarm(session, device_id, "device.offline").state == "resolved"

            first_command = _new_command(
                session,
                device,
                created_at=offline_at,
                expires_at=offline_at + timedelta(seconds=30),
            )
            failed = CommandResultEnvelope(
                message_id=uuid.uuid4(),
                command_id=first_command.id,
                session_id=session_b,
                status="failed",
                error_code="test_failure",
            )
            outcome = CommandResultService(session).complete(
                device_uid=test_uid,
                payload=failed,
                now=offline_at + timedelta(seconds=2),
            )
            assert outcome.updated and not outcome.duplicate
            key = "command.failed.vfd.start"
            assert _alarm(session, device_id, key).state == "active"
            duplicate_result = CommandResultService(session).complete(
                device_uid=test_uid,
                payload=failed,
                now=offline_at + timedelta(seconds=3),
            )
            assert duplicate_result.duplicate
            assert _alarm(session, device_id, key).occurrence_count == 1

            second_command = _new_command(
                session,
                device,
                created_at=offline_at + timedelta(seconds=4),
                expires_at=offline_at + timedelta(seconds=34),
            )
            success = CommandResultEnvelope(
                message_id=uuid.uuid4(),
                command_id=second_command.id,
                session_id=session_b,
                status="succeeded",
            )
            CommandResultService(session).complete(
                device_uid=test_uid,
                payload=success,
                now=offline_at + timedelta(seconds=5),
            )
            assert _alarm(session, device_id, key).state == "resolved"

            expired_command = _new_command(
                session,
                device,
                created_at=offline_at + timedelta(seconds=6),
                expires_at=offline_at + timedelta(seconds=36),
            )
            expiry = CommandDispatchService(session).dispatch(
                expired_command.id,
                now=offline_at + timedelta(seconds=37),
                allow_retry=True,  # Так викликає dispatcher фоновий worker.
            )
            assert expiry.reason == "expired"
            assert expiry.command.status == "expired"
            assert _alarm(session, device_id, key).state == "active"
            transitions = session.scalar(
                select(AlarmTransition.id)
                .where(AlarmTransition.alarm_id == _alarm(session, device_id, key).id)
                .limit(1)
            )
            events = session.scalar(
                select(DeviceEvent.id)
                .where(DeviceEvent.device_id == device_id)
                .limit(1)
            )
            assert transitions is not None and events is not None
        print(
            "PASS: offline/recovery, reboot/stable/old session, "
            "failed/duplicate/success/expired command"
        )
    finally:
        outer.rollback()
        connection.close()

    with engine.connect() as verification:
        assert verification.scalar(
            select(Device.id).where(Device.id == device_id)
        ) is None, "Тестовий Device залишився в БД"
    print("PASS: test transaction rolled back; no test Device remains")


if __name__ == "__main__":
    main()
