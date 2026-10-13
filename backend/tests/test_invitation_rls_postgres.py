"""Запрошення від персоналу перевіряються HTTP-запитами під customer RLS."""

import os
import unittest
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from auth_http_helpers import request
from onboarding_helpers import OnboardingFixtures
from app.db import SessionLocal, engine, get_db_session
from app.main import app
from app.models import AccountLink, AuthSession, OrganizationMembership, User
from app.models.onboarding import AccountSecurity
from app.schemas.personal_accounts import InvitationCreate
from app.security.browser_config import AUTH_BROWSER_ORIGINS
from app.security.current_user import CurrentUserContext
from app.security.tokens import utc_now
from app.services.invitations import create_invitation


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class CustomerInvitationRlsTests(OnboardingFixtures, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Як у staff_checks: політики встановлюються лише в disposable test DB.
        sql = (Path(__file__).resolve().parents[2] / "infrastructure/staff/runtime-roles.sql").read_text()
        with engine.begin() as connection:
            for role in ("kerumo_customer", "kerumo_staff"):
                if not connection.scalar(text("SELECT 1 FROM pg_roles WHERE rolname=:role"), {"role": role}):
                    connection.exec_driver_sql(f"CREATE ROLE {role} NOLOGIN")
            connection.exec_driver_sql(sql[sql.index("REVOKE CREATE"):])

    def setUp(self):
        super().setUp()
        self.customer_engine = create_engine(engine.url, poolclass=NullPool)
        self.addCleanup(self.customer_engine.dispose)

        @event.listens_for(self.customer_engine, "connect")
        def customer_role(connection, record):
            # Session role переживає service commit; NullPool не повертає її в owner pool.
            with connection.cursor() as cursor:
                cursor.execute("SET ROLE kerumo_customer")
            connection.commit()

        self.customer_sessions = sessionmaker(bind=self.customer_engine, autoflush=False, expire_on_commit=False)

        def customer_db():
            with self.customer_sessions() as session:
                self.assertEqual(session.scalar(text("SELECT current_user")), "kerumo_customer")
                yield session

        previous = app.dependency_overrides.get(get_db_session)
        app.dependency_overrides[get_db_session] = customer_db

        def restore_dependency():
            if previous is None:
                app.dependency_overrides.pop(get_db_session, None)
            else:
                app.dependency_overrides[get_db_session] = previous

        self.addCleanup(restore_dependency)
        # Загальний suite запускається в demo plane; тут перевіряємо customer policy.
        for module in ("actor_metadata", "current_user"):
            patcher = patch(f"app.security.{module}.APP_PLANE", "customer")
            patcher.start()
            self.addCleanup(patcher.stop)

    def invite(self, email, *, role="viewer"):
        with SessionLocal() as session, patch("app.services.invitations.send_account_mail") as mail:
            current = CurrentUserContext(
                session.get(User, self.contexts["owner"].user.id),
                session.get(AuthSession, self.contexts["owner"].auth_session.id),
            )
            item = create_invitation(session, current, self.orgs[0], InvitationCreate(
                email=email, role=role, site_ids=[self.sites[0]], expires_at=utc_now() + timedelta(days=7)))
            token = mail.call_args.args[2].split("#token=")[1].split()[0]
            return item.id, token

    def customer_http(self, path, token, *, who=None, expected=200, **body):
        headers = {"origin": AUTH_BROWSER_ORIGINS[0], "x-techbaza-csrf": "1"}
        if who:
            headers["authorization"] = "Bearer " + self.tokens[who]
        status, result, _ = request("POST", "/api/v1/invitations/" + path,
            body={"token": token, **body}, headers=headers, ip=self.ip)
        self.assertEqual(status, expected, result)
        return result

    def assert_private_staff_credentials(self):
        staff_id = self.contexts["owner"].user.id
        with self.customer_sessions() as session:
            self.assertIsNone(session.get(User, staff_id))
            self.assertIsNone(session.get(AccountSecurity, staff_id))
            self.assertIsNone(session.get(AuthSession, self.contexts["owner"].auth_session.id))
            metadata = session.execute(text("SELECT * FROM public.customer_actor_metadata(:id)"),
                {"id": staff_id}).mappings().one()
            self.assertEqual(set(metadata), {"id", "email", "display_name", "platform_role", "is_active"})

    def test_hidden_superadmin_invitation_can_be_inspected_and_accepted(self):
        invitation_id, token = self.invite(self.contexts["other"].user.email)
        self.assert_private_staff_credentials()
        preview = self.customer_http("inspect", token)
        self.assertEqual((preview["role"], preview["site_names"]), ("viewer", ["Test only"]))
        self.assertEqual(set(preview), {"email", "organization_name", "role", "site_names", "access_expires_at"})
        self.customer_http("accept", token, who="viewer", expected=403)
        accepted = self.customer_http("accept", token, who="other")
        self.assertEqual(accepted["organization_id"], str(self.orgs[0]))
        with SessionLocal() as session:
            membership = session.scalar(select(OrganizationMembership).where(
                OrganizationMembership.organization_id == self.orgs[0],
                OrganizationMembership.user_id == self.contexts["other"].user.id))
            link = session.get(AccountLink, invitation_id)
            self.assertEqual((membership.role, membership.site_ids), ("viewer", [str(self.sites[0])]))
            self.assertEqual(membership.expires_at, link.access_expires_at)
            self.assertIsNotNone(link.used_at)
        self.customer_http("accept", token, who="other", expected=404)
        self.assert_private_staff_credentials()

    def test_hidden_superadmin_invitation_can_register_a_customer(self):
        email = f"rls-invited-{uuid.uuid4().hex}@example.com"
        invitation_id, token = self.invite(email)
        self.customer_http("inspect", token)
        created = self.customer_http("register", token,
            display_name="Invited customer", password="rls-invitation-customer-password-2026")
        self.assertEqual(created["email"], email)
        self.assertEqual(len(created["recovery_key"]), 43)
        with SessionLocal() as session:
            user = session.scalar(select(User).where(User.email == email))
            self.additional_users.append(user.id)
            self.assertEqual(user.platform_role, "user")
            self.assertIsNotNone(user.email_verified_at)
            membership = session.scalar(select(OrganizationMembership).where(
                OrganizationMembership.organization_id == self.orgs[0],
                OrganizationMembership.user_id == user.id))
            self.assertEqual((membership.role, membership.site_ids), ("viewer", [str(self.sites[0])]))
            self.assertIsNotNone(session.get(AccountLink, invitation_id).used_at)
        self.customer_http("register", token, expected=404,
            display_name="Again", password="rls-invitation-customer-password-2026")
        self.assert_private_staff_credentials()

    def test_hidden_inviter_current_authority_is_rechecked_before_acceptance(self):
        _, token = self.invite(self.contexts["other"].user.email)
        self.customer_http("inspect", token)
        for active, platform_role, role, site_ids, expires_at in (
            (False, "superadmin", "owner", None, None),
            (True, "service_admin", "viewer", None, None),
            (True, "service_admin", "admin", [str(self.sites[0])], None),
            (True, "service_admin", "admin", None, utc_now() - timedelta(seconds=1)),
        ):
            with self.subTest(active=active, role=role, scope=site_ids, expiry=expires_at):
                with SessionLocal.begin() as session:
                    actor = session.get(User, self.contexts["owner"].user.id)
                    actor.is_active, actor.platform_role = active, platform_role
                    membership = session.scalar(select(OrganizationMembership).where(
                        OrganizationMembership.organization_id == self.orgs[0],
                        OrganizationMembership.user_id == actor.id))
                    membership.role, membership.site_ids, membership.expires_at = role, site_ids, expires_at
                self.customer_http("inspect", token, expected=404)
                self.customer_http("accept", token, who="other", expected=404)
        # Після demotion чинне unrestricted admin membership залишається достатнім.
        with SessionLocal.begin() as session:
            membership = session.scalar(select(OrganizationMembership).where(
                OrganizationMembership.organization_id == self.orgs[0],
                OrganizationMembership.user_id == self.contexts["owner"].user.id))
            membership.site_ids, membership.expires_at = None, None
        self.customer_http("inspect", token)
        self.customer_http("accept", token, who="other")

    def test_revoked_or_invalid_scope_invitation_stays_denied_under_customer_rls(self):
        invitation_id, token = self.invite(self.contexts["other"].user.email)
        self.customer_http("inspect", token)
        with SessionLocal.begin() as session:
            session.get(AccountLink, invitation_id).site_ids = [str(self.sites[1])]
        self.customer_http("inspect", token, expected=404)
        self.customer_http("accept", token, who="other", expected=422)
        with SessionLocal.begin() as session:
            link = session.get(AccountLink, invitation_id)
            link.site_ids, link.revoked_at = [str(self.sites[0])], utc_now()
        self.customer_http("inspect", token, expected=404)
        self.customer_http("accept", token, who="other", expected=404)
        with SessionLocal() as session:
            self.assertIsNone(session.scalar(select(OrganizationMembership).where(
                OrganizationMembership.organization_id == self.orgs[0],
                OrganizationMembership.user_id == self.contexts["other"].user.id)))


if __name__ == "__main__":
    unittest.main()
