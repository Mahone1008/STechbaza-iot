"""Перевірити acknowledge, tenant RBAC і actor audit без залишку в БД.

Запуск: python -m app.tools.alarm_ack_check
Потрібні хоча б один Site та актуальна міграція в локальній БД.
"""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.alarms import (
    acknowledge_alarm,
    get_alarm,
    list_alarm_transitions,
)
from app.db import engine
from app.models.auth_session import AuthSession
from app.models.device import Device
from app.models.event_alarm import AlarmTransition, DeviceAlarm
from app.models.organization_membership import OrganizationMembership
from app.models.site import Site
from app.models.user import User
from app.security.current_user import CurrentUserContext
from app.security.roles import Permission, role_has_permission
from app.services.alarms import AlarmLifecycleService


def _identity(
    session: Session,
    org_id: uuid.UUID,
    role: str | None,
) -> CurrentUserContext:
    user = User(
        id=uuid.uuid4(),
        email=f"ack-check-{uuid.uuid4().hex}@example.com",
        display_name=f"Test {role or 'outsider'}",
        password_hash="test-only-no-login",
    )
    session.add(user)
    session.flush()
    auth_session = AuthSession(
        id=uuid.uuid4(),
        user_id=user.id,
        refresh_token_hash=hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    session.add(auth_session)
    if role is not None:
        session.add(
            OrganizationMembership(
                organization_id=org_id,
                user_id=user.id,
                role=role,
            )
        )
    session.flush()
    return CurrentUserContext(user=user, auth_session=auth_session)


def _expect_http(code: int, action) -> None:
    try:
        action()
    except HTTPException as exc:
        assert exc.status_code == code, (exc.status_code, exc.detail)
    else:
        raise AssertionError(f"Очікували HTTP {code}")


def _raise(
    session: Session,
    device_id: uuid.UUID,
    key: str,
    now: datetime,
) -> uuid.UUID:
    result = AlarmLifecycleService(session).raise_alarm(
        device_id=device_id,
        alarm_key=key,
        alarm_type="test.acknowledge",
        severity="warning",
        title="Temporary acknowledge check",
        occurred_at=now,
    )
    assert result.alarm_id is not None
    return result.alarm_id


def main() -> None:
    now = datetime.now(timezone.utc)
    device_id = uuid.uuid4()
    connection = engine.connect()
    outer = connection.begin()
    try:
        # Сервісні commit залишаються всередині savepoint; outer відкотиться.
        with Session(
            bind=connection,
            join_transaction_mode="create_savepoint",
            expire_on_commit=False,
            autoflush=False,
        ) as session:
            site = session.scalar(select(Site).limit(1))
            if site is None:
                raise RuntimeError("У локальній БД немає Site для тесту")

            device = Device(
                id=device_id,
                site_id=site.id,
                uid=f"TB-ACK-TEST-{uuid.uuid4().hex[:12]}",
                name="Temporary Acknowledge Check",
                lifecycle_status="active",
            )
            session.add(device)
            session.flush()

            operator = _identity(session, site.organization_id, "operator")
            admin = _identity(session, site.organization_id, "admin")
            viewer = _identity(session, site.organization_id, "viewer")
            outsider = _identity(session, site.organization_id, None)

            assert all(
                role_has_permission(role, Permission.ALARM_ACKNOWLEDGE)
                for role in ("owner", "admin", "operator", "service")
            )
            assert not role_has_permission(
                "viewer", Permission.ALARM_ACKNOWLEDGE
            )

            alarm_id = _raise(session, device_id, "test.ack.first", now)
            _expect_http(
                403, lambda: acknowledge_alarm(alarm_id, session, viewer)
            )
            _expect_http(
                404, lambda: acknowledge_alarm(alarm_id, session, outsider)
            )
            _expect_http(
                404,
                lambda: acknowledge_alarm(uuid.uuid4(), session, operator),
            )
            assert get_alarm(alarm_id, session, operator).acknowledged_at is None

            first = acknowledge_alarm(alarm_id, session, operator)
            assert first.state == "active"
            assert first.acknowledged_by_user_id == operator.user.id
            assert first.acknowledged_by_email == operator.user.email
            initial_time = first.acknowledged_at
            assert initial_time is not None

            again = acknowledge_alarm(alarm_id, session, admin)
            assert again.acknowledged_at == initial_time
            assert again.acknowledged_by_user_id == operator.user.id
            history = list_alarm_transitions(alarm_id, session, operator)
            ack_history = [
                item for item in history
                if item.transition_type == "acknowledged"
            ]
            assert len(ack_history) == 1
            transition = ack_history[0]
            assert transition.from_state == transition.to_state == "active"
            assert transition.actor_user_id == operator.user.id
            assert transition.actor_auth_session_id == operator.auth_session.id
            assert transition.actor_organization_id == site.organization_id
            assert transition.actor_organization_role == "operator"
            assert transition.actor_email == operator.user.email
            assert transition.actor_display_name == operator.user.display_name

            initial_email = operator.user.email
            operator.user.email = f"changed-{uuid.uuid4().hex}@example.com"
            session.commit()
            assert get_alarm(alarm_id, session, operator).acknowledged_by_email == initial_email
            assert list_alarm_transitions(
                alarm_id, session, operator
            )[0].actor_email == initial_email

            AlarmLifecycleService(session).resolve_alarm(
                device_id=device_id,
                alarm_key="test.ack.first",
                occurred_at=now + timedelta(seconds=1),
            )
            assert acknowledge_alarm(alarm_id, session, operator).state == "resolved"

            resolved_id = _raise(
                session, device_id, "test.ack.resolved", now
            )
            AlarmLifecycleService(session).resolve_alarm(
                device_id=device_id,
                alarm_key="test.ack.resolved",
                occurred_at=now + timedelta(seconds=1),
            )
            _expect_http(
                409,
                lambda: acknowledge_alarm(resolved_id, session, operator),
            )
            assert not session.scalar(
                select(AlarmTransition.id)
                .where(
                    AlarmTransition.alarm_id == resolved_id,
                    AlarmTransition.transition_type == "acknowledged",
                )
                .limit(1)
            )
            print(
                "PASS: tenant 404, viewer 403, resolved 409; "
                "first acknowledge and repeat are consistent"
            )
            print(
                "PASS: one audit transition with immutable actor/session/role"
            )
    finally:
        outer.rollback()
        connection.close()

    with engine.connect() as verification:
        assert verification.scalar(
            select(DeviceAlarm.id)
            .where(DeviceAlarm.device_id == device_id)
            .limit(1)
        ) is None
        assert verification.scalar(
            select(Device.id).where(Device.id == device_id)
        ) is None
    print("PASS: transaction rolled back; no test Device or Alarm remains")


if __name__ == "__main__":
    main()
