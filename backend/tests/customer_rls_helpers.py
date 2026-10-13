"""Canonical customer RLS in a separate, disposable database for each test class."""

from pathlib import Path
import uuid
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.db import SessionLocal, engine


class IsolatedCustomerRls:
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        database = "kerumo_rls_test_" + uuid.uuid4().hex
        admin = create_engine(engine.url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
        cls.addClassCleanup(admin.dispose)
        with admin.connect() as connection:
            connection.exec_driver_sql(f'CREATE DATABASE "{database}"')

        def drop_database():
            with admin.connect() as connection:
                connection.exec_driver_sql(f'DROP DATABASE "{database}"')

        cls.addClassCleanup(drop_database)
        cls.rls_engine = create_engine(engine.url.set(database=database), poolclass=NullPool)
        cls.addClassCleanup(cls.rls_engine.dispose)
        # Build a fresh schema instead of cloning a source DB that may have other
        # connections. RLS, functions, triggers and grants never touch demo data.
        config = Config()
        config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
        with patch("app.db.DATABASE_URL", cls.rls_engine.url.render_as_string(hide_password=False)):
            command.upgrade(config, "head")
        sql = (Path(__file__).resolve().parents[2] / "infrastructure/staff/runtime-roles.sql").read_text()
        with cls.rls_engine.begin() as connection:
            for role in ("kerumo_customer", "kerumo_staff"):
                if not connection.scalar(text("SELECT 1 FROM pg_roles WHERE rolname=:role"), {"role": role}):
                    connection.exec_driver_sql(f"CREATE ROLE {role} NOLOGIN")
            connection.exec_driver_sql(sql[sql.index("REVOKE CREATE"):])
        original_bind = SessionLocal.kw["bind"]
        cls.addClassCleanup(lambda: SessionLocal.configure(bind=original_bind))
        SessionLocal.configure(bind=cls.rls_engine)
