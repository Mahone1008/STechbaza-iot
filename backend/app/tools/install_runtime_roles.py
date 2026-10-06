"""One-time DB-owner setup. Never exposed as an HTTP endpoint."""
import argparse
import os
from pathlib import Path

from psycopg import sql
from app.db import engine


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rules", type=Path, required=True)
    args = parser.parse_args()
    rules = args.rules.read_text(encoding="utf-8")
    with engine.begin() as connection:
        owner = connection.exec_driver_sql("SELECT pg_get_userbyid(datdba)=current_user FROM pg_database WHERE datname=current_database()").scalar()
        if not owner:
            raise RuntimeError("Run this setup with the database-owner connection")
        for role, variable in (("kerumo_customer", "CUSTOMER_DB_PASSWORD"), ("kerumo_staff", "STAFF_DB_PASSWORD")):
            password = os.getenv(variable, "")
            if len(password) < 32:
                raise RuntimeError("Provide two distinct random runtime database passwords, at least 32 characters")
            if os.getenv("CUSTOMER_DB_PASSWORD") == os.getenv("STAFF_DB_PASSWORD"):
                raise RuntimeError("Customer and staff database passwords must differ")
            cursor = connection.connection.driver_connection.cursor()
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (role,))
            if not cursor.fetchone():
                cursor.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(role)))
            cursor.execute(sql.SQL("ALTER ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD {}").format(sql.Identifier(role), sql.Literal(password)))
            cursor.close()
        connection.exec_driver_sql(rules[rules.index("REVOKE CREATE"):])
    print("PASS: separate customer/staff database roles and protected staff identities configured")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Runtime-role setup failed. Check owner access, private environment and migration; transaction rolled back.") from None
