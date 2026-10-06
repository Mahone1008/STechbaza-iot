"""Explicit all-existing-account reset, only in the isolated demo database."""

import uuid

from sqlalchemy import delete, func, select, text, update

from app.db import SessionLocal
from app.demo.catalog import require_demo
from app.demo.seed import assert_database
from app.models import AccountLink, AuthRateLimit, AuthSession, NotificationRead, OrganizationMembership, Site, User
from app.models.onboarding import AccountSecurity, ControllerCredential, FactoryAudit, FactoryController
from app.models.platform_audit import PlatformAudit
from app.security.tokens import utc_now
from app.services.controller_broker import BrokerUnavailable, ControllerBroker


def reset_all_existing(*, apply=False):
    require_demo()
    with SessionLocal.begin() as session:
        assert_database(session)
        session.execute(text("SELECT pg_advisory_xact_lock(8340004)"))
        users = list(session.scalars(select(User).order_by(User.id).with_for_update()))
        if not users:
            raise RuntimeError("У базі немає облікових записів")
        memberships = list(session.scalars(select(OrganizationMembership).order_by(OrganizationMembership.id).with_for_update()))
        before = [(u.id, u.email, u.login_name, u.password_hash, u.platform_role, u.is_active) for u in users]
        rights = [(m.id, m.role, m.is_active, m.site_ids, m.expires_at) for m in memberships]
        credentials = list(session.scalars(select(ControllerCredential).with_for_update()))
        sites = list(session.scalars(select(Site.id)))
        report = {"scope": "ALL_EXISTING_DEMO_ACCOUNTS", "emails": [user.email for user in users],
                  "accounts": len(users), "sites": len(sites), "network_keys": len(credentials),
                  "controllers": session.scalar(select(func.count()).select_from(FactoryController)),
                  "mfa_and_recovery_reset": True, "passwords_and_roles_preserved": True, "applied": apply}
        if not apply:
            return report
        # Never leave working credentials on a gateway after dropping their database rows.
        if credentials:
            from app.models import Device
            try:
                with ControllerBroker() as broker:
                    for credential in credentials:
                        device = session.get(Device, credential.device_id)
                        broker.apply(device.uid, "", True)
            except BrokerUnavailable:
                raise RuntimeError("Шлюз не підтвердив відкликання ключів; очистку бази скасовано") from None
        for model in (AccountLink, ControllerCredential, FactoryAudit, FactoryController, Site, AccountSecurity, NotificationRead, AuthRateLimit):
            session.execute(delete(model))
        session.execute(update(AuthSession).values(revoked_at=utc_now(), mfa_verified_at=None))
        for user in users:
            user.last_login_at = None
        session.flush()
        if before != [(u.id, u.email, u.login_name, u.password_hash, u.platform_role, u.is_active) for u in users] or rights != [(m.id, m.role, m.is_active, m.site_ids, m.expires_at) for m in memberships]:
            raise RuntimeError("Права чи паролі змінилися; транзакцію скасовано")
        session.add(PlatformAudit(occurred_at=utc_now(), actor_user_id=None, actor_session_id=None,
            action="demo.accounts_reset", resource_type="demo", resource_id=None,
            request_id=str(uuid.uuid4()), client_ip=None, status=200,
            details={key: value for key, value in report.items() if key != "emails"}))
        return report
