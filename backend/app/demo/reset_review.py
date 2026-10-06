"""Clear only review-account examples in the isolated demo database."""

import argparse
import json
from pathlib import Path

from sqlalchemy import delete, or_, select, text, update
from sqlalchemy.exc import SQLAlchemyError

from app.db import SessionLocal
from app.demo.catalog import identity, require_demo
from app.demo.review_accounts import ACCOUNTS
from app.demo.seed import assert_database
from app.models import (
    AccountLink,
    AuthRateLimit,
    AuthSession,
    Device,
    NotificationRead,
    Organization,
    OrganizationMembership,
    Site,
    User,
)
from app.models.onboarding import (
    AccountSecurity,
    ControllerCredential,
    FactoryAudit,
    FactoryController,
    PersonalWorkspace,
)
from app.security.passwords import verify_password
from app.security.tokens import utc_now
from app.services.auth_throttle import rate_key
from app.services.controller_broker import BrokerUnavailable, ControllerBroker


def validate_reset_credentials(value: object) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {account.key for account in ACCOUNTS}:
        raise ValueError("Потрібен чинний файл восьми demo-паролів")
    if any(
        not isinstance(password, str) or not 12 <= len(password) <= 128
        for password in value.values()
    ):
        raise ValueError("Потрібні чинні паролі; нові значення не генеруються")
    return value


def reset_review(passwords: dict[str, str], *, apply: bool = False):
    require_demo()
    validate_reset_credentials(passwords)
    user_ids = [account.user_id for account in ACCOUNTS]
    with SessionLocal.begin() as session:
        assert_database(session)
        session.execute(text("SELECT pg_advisory_xact_lock(8340004)"))
        users = list(
            session.scalars(
                select(User).where(User.id.in_(user_ids)).order_by(User.id).with_for_update()
            )
        )
        if len(users) != len(ACCOUNTS):
            raise RuntimeError(
                "Потрібні всі вісім готових demo-акаунтів; часткова очистка заборонена"
            )
        for account in ACCOUNTS:
            user = next(value for value in users if value.id == account.user_id)
            if user.email != account.email or not verify_password(
                passwords[account.key], user.password_hash
            ):
                raise RuntimeError("Demo-реквізити не збігаються; дані не змінено")
        memberships = list(
            session.scalars(
                select(OrganizationMembership).where(OrganizationMembership.user_id.in_(user_ids))
            )
        )
        organization_ids = {identity("org:a"), identity("org:b")}
        for key in ("a", "b"):
            org = session.get(Organization, identity("org:" + key))
            if org is None or org.slug != "techbaza-demo-" + key:
                raise RuntimeError("Demo-організації не збігаються; дані не змінено")
        personal_ids = set(
            session.scalars(
                select(PersonalWorkspace.organization_id).where(
                    PersonalWorkspace.user_id.in_(user_ids)
                )
            )
        )
        owned_ids = {member.organization_id for member in memberships if member.role == "owner"}
        # Membership in someone else's organization is not permission to erase it.
        for org_id in personal_ids | owned_ids:
            owners = set(
                session.scalars(
                    select(OrganizationMembership.user_id).where(
                        OrganizationMembership.organization_id == org_id,
                        OrganizationMembership.role == "owner",
                    )
                )
            )
            if owners and owners <= set(user_ids):
                organization_ids.add(org_id)
        sites = list(
            session.scalars(select(Site.id).where(Site.organization_id.in_(organization_ids)))
        )
        devices = list(session.scalars(select(Device.id).where(Device.site_id.in_(sites))))
        registered = select(FactoryAudit.controller_id).where(
            FactoryAudit.actor_user_id.in_(user_ids), FactoryAudit.action == "registered"
        )
        controllers = list(
            session.scalars(
                select(FactoryController.id).where(
                    or_(
                        FactoryController.device_id.in_(devices),
                        (FactoryController.status == "ready")
                        & FactoryController.id.in_(registered),
                    )
                )
            )
        )
        credentials = list(
            session.scalars(
                select(ControllerCredential)
                .where(ControllerCredential.controller_id.in_(controllers))
                .with_for_update()
            )
        )
        report = {
            "accounts": len(users),
            "sites": len(sites),
            "devices": len(devices),
            "controllers": len(controllers),
            "network_keys": len(credentials),
            "security_reset": True,
            "passwords_and_roles_preserved": True,
            "applied": apply,
        }
        if not apply:
            return report
        if credentials:
            try:
                with ControllerBroker() as broker:
                    for credential in credentials:
                        device = session.get(Device, credential.device_id)
                        broker.apply(device.uid, "", True)
            except BrokerUnavailable:
                raise RuntimeError(
                    "Шлюз не підтвердив відкликання ключів; очистку бази скасовано"
                ) from None
        # Rights stay attached to the same organizations and identities.
        before = [
            (user.id, user.password_hash, user.platform_role, user.is_active) for user in users
        ]
        rights = [
            (member.id, member.role, member.is_active, member.expires_at, member.site_ids)
            for member in memberships
        ]
        session.execute(
            delete(ControllerCredential).where(ControllerCredential.controller_id.in_(controllers))
        )
        session.execute(delete(FactoryAudit).where(FactoryAudit.controller_id.in_(controllers)))
        session.execute(delete(FactoryController).where(FactoryController.id.in_(controllers)))
        session.execute(delete(Site).where(Site.id.in_(sites)))
        session.execute(
            delete(AccountLink).where(
                or_(
                    AccountLink.organization_id.in_(organization_ids),
                    AccountLink.email.in_([user.email for user in users]),
                    AccountLink.created_by_user_id.in_(user_ids),
                    AccountLink.target_user_id.in_(user_ids),
                )
            )
        )
        session.execute(delete(AccountSecurity).where(AccountSecurity.user_id.in_(user_ids)))
        session.execute(delete(NotificationRead).where(NotificationRead.user_id.in_(user_ids)))
        session.execute(
            update(AuthSession)
            .where(AuthSession.user_id.in_(user_ids))
            .values(revoked_at=utc_now(), mfa_verified_at=None)
        )
        session.execute(
            delete(AuthRateLimit).where(
                AuthRateLimit.key.in_([rate_key("login-account", user.email) for user in users])
            )
        )
        for user in users:
            user.last_login_at = None
        session.flush()
        if before != [
            (user.id, user.password_hash, user.platform_role, user.is_active) for user in users
        ] or rights != [
            (member.id, member.role, member.is_active, member.expires_at, member.site_ids)
            for member in memberships
        ]:
            raise RuntimeError("Права чи паролі змінилися; транзакцію скасовано")
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credentials", type=Path)
    parser.add_argument("--all-existing", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        if args.all_existing:
            from app.demo.reset_all import reset_all_existing
            report = reset_all_existing(apply=args.apply)
        else:
            if not args.credentials:
                raise ValueError("Потрібен файл чинних demo-паролів")
            passwords = validate_reset_credentials(
                json.loads(args.credentials.read_text(encoding="utf-8-sig"))
            )
            report = reset_review(passwords, apply=args.apply)
    except (OSError, ValueError, RuntimeError) as error:
        raise SystemExit(str(error)) from None
    except SQLAlchemyError:
        raise SystemExit("Очистку скасовано, база не змінена") from None
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
