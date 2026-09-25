"""Перевірити alarm acknowledge через ASGI HTTP та справжній JWT.

Запуск: python -m app.tools.alarm_ack_http_check
Всі Device/User/AuthSession створюються у транзакції та відкочуються.
"""

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import engine, get_db_session
from app.main import app
from app.models.device import Device
from app.models.event_alarm import AlarmTransition, DeviceAlarm
from app.models.site import Site
from app.models.user import User
from app.security.tokens import create_access_token
from app.services.alarms import AlarmLifecycleService
from app.tools.alarm_ack_check import _identity, _raise


async def _asgi_request(
    method: str,
    path: str,
    token: str | None,
) -> tuple[int, object]:
    """Викликати FastAPI маршрут разом із Bearer/JWT dependencies."""

    messages: list[dict] = []
    request_delivered = False

    async def receive() -> dict:
        nonlocal request_delivered
        if not request_delivered:
            request_delivered = True
            return {"type": "http.request", "body": b"", "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        messages.append(message)

    headers = [(b"host", b"localhost")]
    if token is not None:
        headers.append((b"authorization", f"Bearer {token}".encode("ascii")))

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "scheme": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode("ascii"),
        "root_path": "",
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 0),
        "server": ("127.0.0.1", 8000),
    }
    await app(scope, receive, send)
    status = next(
        message["status"] for message in messages
        if message["type"] == "http.response.start"
    )
    payload = b"".join(
        message.get("body", b"") for message in messages
        if message["type"] == "http.response.body"
    )
    return status, json.loads(payload) if payload else None


def _request(
    method: str,
    path: str,
    token: str | None = None,
) -> tuple[int, object]:
    return asyncio.run(_asgi_request(method, path, token))


def main() -> None:
    now = datetime.now(timezone.utc)
    device_id = uuid.uuid4()
    ids: list[uuid.UUID] = []
    connection = engine.connect()
    outer = connection.begin()
    try:
        with Session(
            bind=connection,
            join_transaction_mode="create_savepoint",
            expire_on_commit=False,
            autoflush=False,
        ) as session:
            site = session.scalar(select(Site).limit(1))
            if site is None:
                raise RuntimeError("У локальній БД немає Site для тесту")
            session.add(
                Device(
                    id=device_id,
                    site_id=site.id,
                    uid=f"TB-ACK-HTTP-{uuid.uuid4().hex[:12]}",
                    name="Temporary HTTP Acknowledge Check",
                    lifecycle_status="active",
                )
            )
            session.flush()
            operator = _identity(session, site.organization_id, "operator")
            admin = _identity(session, site.organization_id, "admin")
            viewer = _identity(session, site.organization_id, "viewer")
            outsider = _identity(session, site.organization_id, None)
            ids = [ctx.user.id for ctx in (operator, admin, viewer, outsider)]

            alarm_id = _raise(session, device_id, "test.ack.http", now)
            resolved_id = _raise(session, device_id, "test.ack.http.resolved", now)
            AlarmLifecycleService(session).resolve_alarm(
                device_id=device_id,
                alarm_key="test.ack.http.resolved",
                occurred_at=now + timedelta(seconds=1),
            )

            def token(ctx) -> str:
                return create_access_token(
                    user_id=ctx.user.id,
                    auth_session_id=ctx.auth_session.id,
                ).token

            operator_token = token(operator)
            admin_token = token(admin)
            viewer_token = token(viewer)
            outsider_token = token(outsider)
            path = f"/api/v1/alarms/{alarm_id}/acknowledge"
            old_override = app.dependency_overrides.get(get_db_session)
            app.dependency_overrides[get_db_session] = lambda: session
            try:
                status, _ = _request("POST", path)
                assert status == 401, status
                status, me = _request("GET", "/api/v1/auth/me", operator_token)
                assert status == 200 and me["id"] == str(operator.user.id)
                status, _ = _request("POST", path, outsider_token)
                assert status == 404, status
                status, _ = _request(
                    "POST",
                    f"/api/v1/alarms/{uuid.uuid4()}/acknowledge",
                    operator_token,
                )
                assert status == 404, status
                status, visible = _request(
                    "GET", f"/api/v1/alarms/{alarm_id}", viewer_token
                )
                assert status == 200 and visible["acknowledged_at"] is None
                status, _ = _request("POST", path, viewer_token)
                assert status == 403, status

                status, first = _request("POST", path, operator_token)
                assert status == 200, status
                assert first["state"] == "active"
                assert first["acknowledged_by_user_id"] == str(operator.user.id)
                assert first["acknowledged_by_email"] == operator.user.email
                assert first["acknowledged_at"] is not None
                status, repeat = _request("POST", path, admin_token)
                assert status == 200, status
                assert repeat["acknowledged_at"] == first["acknowledged_at"]
                assert repeat["acknowledged_by_user_id"] == first["acknowledged_by_user_id"]

                status, transitions = _request(
                    "GET",
                    f"/api/v1/alarms/{alarm_id}/transitions",
                    viewer_token,
                )
                assert status == 200, status
                acks = [
                    item for item in transitions
                    if item["transition_type"] == "acknowledged"
                ]
                assert len(acks) == 1
                audit = acks[0]
                assert audit["actor_user_id"] == str(operator.user.id)
                assert audit["actor_auth_session_id"] == str(operator.auth_session.id)
                assert audit["actor_organization_id"] == str(site.organization_id)
                assert audit["actor_organization_role"] == "operator"
                assert audit["actor_email"] == first["acknowledged_by_email"]
                assert audit["actor_display_name"] == operator.user.display_name

                status, _ = _request(
                    "POST",
                    f"/api/v1/alarms/{resolved_id}/acknowledge",
                    operator_token,
                )
                assert status == 409, status
                assert session.scalar(
                    select(AlarmTransition.id)
                    .where(
                        AlarmTransition.alarm_id == resolved_id,
                        AlarmTransition.transition_type == "acknowledged",
                    )
                    .limit(1)
                ) is None
                operator.auth_session.revoked_at = datetime.now(timezone.utc)
                session.commit()
                status, _ = _request("POST", path, operator_token)
                assert status == 401, status
                print(
                    "PASS: HTTP route + JWT: unauthenticated/revoked 401, "
                    "tenant 404, viewer 403, resolved 409"
                )
                print(
                    "PASS: HTTP first/repeat, one transition, actor/session/role audit"
                )
            finally:
                if old_override is None:
                    app.dependency_overrides.pop(get_db_session, None)
                else:
                    app.dependency_overrides[get_db_session] = old_override
    finally:
        outer.rollback()
        connection.close()

    with engine.connect() as verification:
        assert verification.scalar(
            select(Device.id).where(Device.id == device_id)
        ) is None
        assert verification.scalar(
            select(DeviceAlarm.id)
            .where(DeviceAlarm.device_id == device_id)
            .limit(1)
        ) is None
        for user_id in ids:
            assert verification.scalar(
                select(User.id).where(User.id == user_id)
            ) is None
    print("PASS: test transaction rolled back; no Device, Alarm or User remains")


if __name__ == "__main__":
    main()

