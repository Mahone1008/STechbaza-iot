import argparse
import getpass
import uuid

from email_validator import EmailNotValidError, validate_email
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models.user import User
from app.repositories.users import UserRepository
from app.security.passwords import hash_password
from app.security.roles import PLATFORM_ROLE_VALUES


def _normalize_email(value: str) -> str:
    result = validate_email(
        value.strip(),
        check_deliverability=False,
    )
    return result.normalized.lower()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Створити локального User з Argon2 password hash."
    )
    parser.add_argument("--email", required=True)
    parser.add_argument("--display-name", required=True)
    parser.add_argument(
        "--platform-role",
        choices=PLATFORM_ROLE_VALUES,
        default="user",
    )
    args = parser.parse_args()

    try:
        email = _normalize_email(args.email)
    except EmailNotValidError as exc:
        raise SystemExit(f"Некоректний email: {exc}") from exc

    password = getpass.getpass("Password: ")
    password_confirmation = getpass.getpass("Repeat password: ")

    if password != password_confirmation:
        raise SystemExit("Паролі не збігаються")

    try:
        password_hash = hash_password(password)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    with SessionLocal() as session:
        repository = UserRepository(session)

        if repository.get_by_email(email) is not None:
            raise SystemExit("User з таким email уже існує")

        user = User(
            id=uuid.uuid4(),
            email=email,
            display_name=args.display_name.strip(),
            password_hash=password_hash,
            platform_role=args.platform_role,
            is_active=True,
        )

        try:
            repository.add(user)
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise SystemExit("Не вдалося створити User") from exc

        print(f"User created: {user.id}")
        print(f"Email: {user.email}")
        print(f"Platform role: {user.platform_role}")


if __name__ == "__main__":
    main()
