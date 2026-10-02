"""Окремі входи для ручного приймання: лише demo, без скидання існуючих прав."""

import argparse
import json
import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import or_, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.demo.catalog import identity, require_demo
from app.demo.seed import assert_database
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.models.user import User
from app.security.passwords import hash_password, verify_password


@dataclass(frozen=True)
class ReviewAccount:
    key: str
    platform_role: str = "user"
    organization: str | None = None
    organization_role: str | None = None

    @property
    def email(self) -> str:
        return f"{self.key}@kerumo-demo.example.com"

    @property
    def user_id(self):
        return identity("review:user:" + self.key)


ACCOUNTS = (
    ReviewAccount("owner", organization="a", organization_role="owner"),
    ReviewAccount("admin", organization="a", organization_role="admin"),
    ReviewAccount("operator", organization="a", organization_role="operator"),
    ReviewAccount("viewer", organization="a", organization_role="viewer"),
    ReviewAccount("service", "service_admin", "a", "service"),
    ReviewAccount("superadmin", "superadmin"),
    ReviewAccount("other", organization="b", organization_role="owner"),
    ReviewAccount("new"),
)


def validate_passwords(value: object) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {a.key for a in ACCOUNTS}:
        raise ValueError("Файл має містити рівно вісім ключів demo-акаунтів")
    if any(not isinstance(p, str) or not 32 <= len(p) <= 128 for p in value.values()):
        raise ValueError("Demo-паролі мають містити 32..128 символів")
    if len(set(value.values())) != len(ACCOUNTS):
        raise ValueError("Кожен demo-акаунт повинен мати окремий пароль")
    return value


def read_or_create_credentials(path: Path) -> dict[str, str]:
    """O_EXCL: втрачений/змінений файл не є дозволом змінювати пароль у БД."""
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        # Обмеження також захищає від випадково переданого великого файла.
        with path.open(encoding="utf-8-sig") as stream:
            raw = stream.read(16385)
        if len(raw) > 16384:
            raise ValueError("Файл demo-паролів завеликий")
        try:
            return validate_passwords(json.loads(raw))
        except json.JSONDecodeError:
            raise ValueError("Некоректний JSON у файлі demo-паролів") from None
    passwords = {a.key: secrets.token_hex(20) for a in ACCOUNTS}
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(passwords, stream, indent=2)
        stream.write("\n")
    return passwords


def _prepare_accounts(session: Session, passwords: dict[str, str]) -> list[dict]:
    """Викликається всередині однієї захищеної demo-транзакції."""
    validate_passwords(passwords)
    for key in ("a", "b"):
        org = session.get(Organization, identity("org:" + key))
        if org is None or org.slug != "techbaza-demo-" + key or not org.is_active:
            raise RuntimeError("Спочатку потрібен чинний app.demo.seed з організаціями A/B")

    pending = []
    result = []
    for account in ACCOUNTS:
        matches = session.scalars(select(User).where(or_(
            User.id == account.user_id, User.email == account.email,
        )).with_for_update()).all()
        if matches:
            user = matches[0]
            if (len(matches) != 1 or user.id != account.user_id or user.email != account.email
                    or user.platform_role != account.platform_role or not user.is_active
                    or not verify_password(passwords[account.key], user.password_hash)):
                raise RuntimeError(f"Demo-акаунт {account.key} змінено або email зайнято; перезапис заборонено")
            memberships = session.scalars(select(OrganizationMembership).where(
                OrganizationMembership.user_id == user.id,
            ).with_for_update()).all()
            expected = [] if account.organization is None else [(
                identity("org:" + account.organization), account.organization_role, True,
            )]
            actual = [(m.organization_id, m.role, m.is_active) for m in memberships]
            if actual != expected:
                raise RuntimeError(f"Права demo-акаунта {account.key} змінено; автоматичного відновлення немає")
        else:
            pending.append(account)
        result.append({"email": account.email, "platform_role": account.platform_role,
                       "organization": account.organization, "role": account.organization_role,
                       "status": "existing" if matches else "created"})

    # Спочатку перевіряємо весь набір. Конфлікт не залишає частково створені входи.
    for account in pending:
        session.add(User(id=account.user_id, email=account.email,
                         display_name="DEMO review: " + account.key,
                         password_hash=hash_password(passwords[account.key]),
                         platform_role=account.platform_role, is_active=True))
    session.flush()
    for account in pending:
        if account.organization is not None:
            session.add(OrganizationMembership(
                id=identity("review:membership:" + account.key), user_id=account.user_id,
                organization_id=identity("org:" + account.organization),
                role=account.organization_role, is_active=True,
            ))
    session.flush()
    return result


def provision_accounts(passwords: dict[str, str]) -> list[dict]:
    require_demo()
    validate_passwords(passwords)
    with SessionLocal.begin() as session:
        assert_database(session)
        # Той самий lock, що й основний seed: без гонки з його початковим запуском.
        session.execute(text("SELECT pg_advisory_xact_lock(8340004)"))
        return _prepare_accounts(session, passwords)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--show-passwords", action="store_true",
                        help="Показати паролі лише у власному локальному терміналі")
    args = parser.parse_args()
    try:
        require_demo()
        passwords = read_or_create_credentials(args.credentials)
        result = provision_accounts(passwords)
    except (OSError, ValueError, RuntimeError) as error:
        raise SystemExit(str(error)) from None
    except SQLAlchemyError:
        # SQL/parameters/DSN можуть містити секрети; не виводимо driver traceback.
        raise SystemExit("Не вдалося підготувати demo-акаунти; транзакцію скасовано") from None
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.show_passwords:
        print("\nEmail\tPassword")
        for account in ACCOUNTS:
            print(f"{account.email}\t{passwords[account.key]}")


if __name__ == "__main__":
    main()
