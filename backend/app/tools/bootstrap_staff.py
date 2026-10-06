"""Create only the first platform administrator, with a private one-time credential file."""
import argparse
import json
import os
import secrets
from pathlib import Path

from pydantic import EmailStr, TypeAdapter
from sqlalchemy import func, select, text
from app.db import SessionLocal
from app.models import User
from app.security.passwords import hash_password
from app.security.tokens import utc_now


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    email = str(TypeAdapter(EmailStr).validate_python(args.email)).strip().lower()
    password = secrets.token_urlsafe(30)
    created_file = False
    try:
        with SessionLocal.begin() as session:
            if not session.scalar(text("SELECT pg_get_userbyid(datdba)=current_user FROM pg_database WHERE datname=current_database()")):
                raise RuntimeError("Database owner access required")
            session.execute(text("SELECT pg_advisory_xact_lock(8340040)"))
            if session.scalar(select(func.count()).select_from(User).where(User.platform_role == "superadmin", User.is_active.is_(True))):
                raise RuntimeError("An active administrator already exists; use the private panel")
            if session.scalar(select(User.id).where(User.email == email)):
                raise RuntimeError("This email already exists; no password or role was changed")
            session.add(User(email=email, display_name="Головний адміністратор", platform_role="superadmin",
                email_verified_at=utc_now(), password_hash=hash_password(password)))
            descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created_file = True
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                json.dump({"email": email, "password": password, "instruction": "Enter the private portal, save a recovery key, set up Authenticator, then replace this initial password."}, stream, ensure_ascii=False, indent=2)
        print("PASS: first administrator created; credentials are only in the specified private file")
    except Exception:
        if created_file:
            args.output.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Administrator setup failed. Check DB-owner access, unused email and a new private output path; no existing password was changed.") from None
