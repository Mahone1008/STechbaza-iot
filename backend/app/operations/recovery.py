"""Fingerprint PostgreSQL та явний захист від replay після restore.

harden_restored_database викликається лише окремим CLI на ізольованому
restore стенді. Викликач володіє транзакцією; HTTP startup цього не робить.
"""

import hashlib
import json
import re
from datetime import datetime, timezone

from sqlalchemy import delete, inspect, select, text

from app.models.account_link import AccountLink

from app.models.auth_rate_limit import AuthRateLimit
from app.models.auth_session import AuthSession
from app.models.command import DeviceCommand
from app.models.schedule import DeviceSchedule
from app.models.onboarding import ControllerCredential, FactoryController
from app.services.system_alarms import SystemAlarmService


_VARCHAR_LITERAL = r"'(?:[^']|'')*'::character varying"
_VARCHAR_ARRAY_TO_TEXT = re.compile(
    r"\(ARRAY\[(" + _VARCHAR_LITERAL + r"(?:, " + _VARCHAR_LITERAL + r")*)\]\)::text\[\]"
)


def canonical_constraint(definition):
    # pg_dump/restore переносить text cast з varchar[] на окремі literals.
    # Нормалізуємо тільки цю точну еквівалентність; literals, порядок,
    # оператори, null guards та будь-які інші casts залишаються незмінними.
    return _VARCHAR_ARRAY_TO_TEXT.sub(
        lambda match: "ARRAY[" + ", ".join(
            "(" + literal + ")::text" for literal in re.findall(_VARCHAR_LITERAL, match.group(1))
        ) + "]", definition)


def database_fingerprint(engine):
    with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
        with connection.begin():
            connection.execute(text("SET TRANSACTION READ ONLY"))
            connection.execute(text("SET LOCAL timezone = 'UTC'"))
            connection.execute(text("SET LOCAL DateStyle = 'ISO, YMD'"))
            connection.execute(text("SET LOCAL extra_float_digits = 3"))
            connection.execute(text("SET LOCAL statement_timeout = '30s'"))
            inspector = inspect(connection)
            tables = inspector.get_table_names(schema="public")
            if "alembic_version" not in tables:
                raise ValueError("База не мігрована")
            result, structure = {}, {}
            quote = connection.dialect.identifier_preparer.quote
            for name in sorted(tables):
                columns = inspector.get_columns(name, schema="public")
                structure[name] = {
                    "columns": [{k: c[k].compile(dialect=connection.dialect) if k == "type" else c.get(k)
                                 for k in ("name", "type", "nullable", "default")} for c in columns],
                    "constraints": [[row[0], canonical_constraint(row[1])] for row in connection.execute(text("""
                        SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c
                        JOIN pg_class t ON t.oid=c.conrelid
                        JOIN pg_namespace n ON n.oid=t.relnamespace
                        WHERE n.nspname='public' AND t.relname=:table ORDER BY conname
                    """), {"table": name})],
                    "indexes": [list(row) for row in connection.execute(text("""
                        SELECT indexname, indexdef FROM pg_indexes
                        WHERE schemaname='public' AND tablename=:table ORDER BY indexname
                    """), {"table": name})],
                }
                digest, count = hashlib.sha256(), 0
                rows = connection.execution_options(stream_results=True).execute(text(
                    f"SELECT row_to_json(t)::text FROM public.{quote(name)} t ORDER BY row_to_json(t)::text"))
                for (raw,) in rows:
                    # PostgreSQL JSON text зберігає точність numeric/JSONB numbers.
                    # Python float normalization могла б приховати зміну значення.
                    digest.update(raw.encode("utf-8") + b"\n")
                    count += 1
                rows.close()
                # Наступні catalog statements не повинні успадковувати server cursor.
                connection.execution_options(stream_results=False)
                result[name] = {"rows": count, "sha256": digest.hexdigest()}
            migration = list(connection.execute(text("SELECT version_num FROM alembic_version ORDER BY version_num")).scalars())
            if migration != ["20261005_0026"]:
                raise ValueError("Очікується migration 0026 head")
            return {"migration": migration, "tables": result, "schema": structure,
                    "schema_sha256": hashlib.sha256(json.dumps(structure, sort_keys=True, default=str).encode()).hexdigest()}


def harden_restored_database(session, *, now=None):
    """Відкликати sessions; не переопубліковувати команди з відновленої копії."""
    now = now or datetime.now(timezone.utc)
    sessions = list(session.scalars(select(AuthSession).where(AuthSession.revoked_at.is_(None)).with_for_update()))
    commands = list(session.scalars(select(DeviceCommand).where(
        DeviceCommand.status.in_(("queued", "published", "acknowledged"))).order_by(DeviceCommand.id).with_for_update()))
    for item in sessions:
        item.revoked_at = now
    counts = {"revoked_sessions": len(sessions), "cancelled_delivery": 0, "unknown_results": 0}
    schedules = list(session.scalars(select(DeviceSchedule).where(DeviceSchedule.enabled.is_(True)).with_for_update()))
    for item in schedules:
        item.enabled = False
        item.next_start_at = None
        item.next_check_at = None
        item.updated_at = now
    counts["paused_schedules"] = len(schedules)
    credentials = list(session.scalars(select(ControllerCredential).where(ControllerCredential.revoked.is_(False)).with_for_update()))
    for credential in credentials:
        credential.revoked = True
        credential.revision += 1
        controller = session.get(FactoryController, credential.controller_id)
        if controller.device_id == credential.device_id:
            controller.access_revoked = True
            controller.credential_revision = credential.revision
    counts["revoked_controller_keys"] = len(credentials)
    links = list(session.scalars(select(AccountLink).where(
        AccountLink.used_at.is_(None), AccountLink.revoked_at.is_(None)
    ).with_for_update()))
    for item in links:
        item.revoked_at = now
    counts["revoked_account_links"] = len(links)
    # Ліміти старого вікна/IP не переносяться в нове оточення; наступні
    # login/refresh знову проходять звичайний DB rate limiter.
    counts["cleared_rate_limits"] = session.execute(delete(AuthRateLimit)).rowcount
    alarms = SystemAlarmService(session)
    for item in commands:
        if item.status in {"published", "acknowledged"} or item.publish_attempts or item.published_at:
            item.status = "result_unknown"
            item.result_timed_out_at = now
            item.error_code = "restore_result_unknown"
            item.error_message = "Після restore результат прийнятої команди потребує звірення"
            alarms.record_result_timeout(command=item, occurred_at=now)
            counts["unknown_results"] += 1
        else:
            item.status = "expired"
            item.completed_at = now
            item.error_code = "restore_delivery_cancelled"
            item.error_message = "Автоматичну доставку команди зі старої копії заборонено"
            alarms.record_command_outcome(command=item, occurred_at=now)
            counts["cancelled_delivery"] += 1
    session.flush()
    return counts
