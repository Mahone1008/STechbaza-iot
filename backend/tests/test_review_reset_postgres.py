"""The opt-in reset preserves identity and rights and never clears a foreign organization."""

import os
import unittest
from unittest.mock import patch

from sqlalchemy import delete, select

from onboarding_helpers import OnboardingFixtures
from app.db import SessionLocal
from app.demo.catalog import identity
from app.demo.reset_review import reset_review
from app.demo.review_accounts import ACCOUNTS, _prepare_accounts
from app.models import AuthSession, Device, Organization, OrganizationMembership, Site, User
from app.models.onboarding import (
    AccountSecurity,
    ControllerCredential,
    FactoryAudit,
    FactoryController,
)
from app.services.controller_broker import BrokerUnavailable
from app.security.tokens import utc_now
from app.security.passwords import hash_password


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class ReviewResetTests(OnboardingFixtures, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.passwords = {
            account.key: "reset-fixture-only-" + account.key + "x" * 24 for account in ACCOUNTS
        }
        self.review_orgs = [identity("org:a"), identity("org:b")]
        self.addCleanup(self.clean_review_orgs)
        with SessionLocal.begin() as session:
            for key, org_id in zip(("a", "b"), self.review_orgs):
                session.add(
                    Organization(
                        id=org_id, name="Review", slug="techbaza-demo-" + key, is_active=True
                    )
                )
            session.flush()
            _prepare_accounts(session, self.passwords)
            session.add(
                OrganizationMembership(
                    user_id=ACCOUNTS[0].user_id,
                    organization_id=self.orgs[0],
                    role="viewer",
                    is_active=True,
                )
            )
            session.add(
                Site(
                    id=identity("review:site"),
                    organization_id=self.review_orgs[0],
                    name="Example",
                    code="example",
                )
            )
            session.flush()
            session.add(
                Device(
                    id=identity("review:device"),
                    site_id=identity("review:site"),
                    uid="TB-DEMO-RESET",
                    name="Example",
                    device_type="test",
                    lifecycle_status="active",
                )
            )
            session.add(
                AccountSecurity(
                    user_id=ACCOUNTS[0].user_id,
                    recovery_hash="a" * 64,
                    totp_secret="encrypted-fixture",
                    totp_enabled_at=utc_now(),
                )
            )
            session.add(
                AuthSession(
                    id=identity("review:session"),
                    user_id=ACCOUNTS[0].user_id,
                    refresh_token_hash="b" * 64,
                    expires_at=utc_now().replace(year=2027),
                    mfa_verified_at=utc_now(),
                )
            )
        self.additional_users.extend(account.user_id for account in ACCOUNTS)
        factory = self.factory()
        self.factory_id = factory["controller"]["id"]
        with SessionLocal.begin() as session:
            row = session.scalar(
                select(FactoryAudit).where(FactoryAudit.controller_id == self.factory_id)
            )
            row.actor_user_id = ACCOUNTS[0].user_id

    def clean_review_orgs(self):
        with SessionLocal.begin() as session:
            session.execute(delete(Organization).where(Organization.id.in_(self.review_orgs)))

    def test_reset_preview_and_apply_preserve_passwords_roles_and_foreign_devices(self):
        with SessionLocal() as session:
            before = [
                (user.id, user.email, user.password_hash, user.platform_role, user.is_active)
                for user in session.scalars(
                    select(User).where(User.id.in_([a.user_id for a in ACCOUNTS])).order_by(User.id)
                )
            ]
            rights = [
                (m.id, m.role, m.is_active, m.site_ids, m.expires_at)
                for m in session.scalars(
                    select(OrganizationMembership)
                    .where(OrganizationMembership.organization_id.in_(self.review_orgs))
                    .order_by(OrganizationMembership.id)
                )
            ]
        with (
            patch.dict(os.environ, {"TECHBAZA_DEMO_MODE": "1"}),
            patch("app.demo.reset_review.assert_database"),
        ):
            preview = reset_review(self.passwords)
            self.assertEqual(
                (preview["sites"], preview["devices"], preview["controllers"]), (1, 1, 1)
            )
            with SessionLocal() as session:
                self.assertIsNotNone(session.get(Device, identity("review:device")))
            report = reset_review(self.passwords, apply=True)
            self.assertTrue(report["applied"])
        with SessionLocal() as session:
            after = [
                (user.id, user.email, user.password_hash, user.platform_role, user.is_active)
                for user in session.scalars(
                    select(User).where(User.id.in_([a.user_id for a in ACCOUNTS])).order_by(User.id)
                )
            ]
            self.assertEqual(after, before)
            self.assertEqual(
                [
                    (m.id, m.role, m.is_active, m.site_ids, m.expires_at)
                    for m in session.scalars(
                        select(OrganizationMembership)
                        .where(OrganizationMembership.organization_id.in_(self.review_orgs))
                        .order_by(OrganizationMembership.id)
                    )
                ],
                rights,
            )
            self.assertIsNone(session.get(Device, identity("review:device")))
            self.assertIsNone(session.get(FactoryController, self.factory_id))
            self.assertIsNone(session.get(AccountSecurity, ACCOUNTS[0].user_id))
            self.assertIsNotNone(session.get(AuthSession, identity("review:session")).revoked_at)
            self.assertIsNotNone(session.get(Device, self.devices[0]))

    def test_wrong_credentials_and_non_demo_mode_cannot_change_examples(self):
        with patch.dict(os.environ, {"TECHBAZA_DEMO_MODE": "0"}), self.assertRaises(RuntimeError):
            reset_review(self.passwords, apply=True)
        with (
            patch.dict(os.environ, {"TECHBAZA_DEMO_MODE": "1"}),
            patch("app.demo.reset_review.assert_database"),
            self.assertRaises(RuntimeError),
        ):
            reset_review({**self.passwords, "owner": "wrong-password-" + "x" * 32}, apply=True)
        with SessionLocal() as session:
            self.assertIsNotNone(session.get(Device, identity("review:device")))

    def add_network_key(self):
        with SessionLocal.begin() as session:
            session.get(FactoryController, self.factory_id).device_id = identity("review:device")
            session.add(
                ControllerCredential(
                    device_id=identity("review:device"),
                    controller_id=self.factory_id,
                    secret="private-reset-fixture",
                    revision=1,
                    applied_revision=1,
                    revoked=False,
                )
            )

    def test_reset_requires_broker_revoke_before_deleting_network_key(self):
        self.add_network_key()
        with (
            patch.dict(os.environ, {"TECHBAZA_DEMO_MODE": "1"}),
            patch("app.demo.reset_review.assert_database"),
            patch("app.demo.reset_review.ControllerBroker") as broker,
        ):
            reset_review(self.passwords)
            broker.assert_not_called()
            report = reset_review(self.passwords, apply=True)
            self.assertEqual(report["network_keys"], 1)
            broker.return_value.__enter__.return_value.apply.assert_called_once_with(
                "TB-DEMO-RESET", "", True
            )
        with SessionLocal() as session:
            self.assertIsNone(session.get(ControllerCredential, identity("review:device")))

    def test_unavailable_broker_aborts_database_reset(self):
        self.add_network_key()
        with (
            patch.dict(os.environ, {"TECHBAZA_DEMO_MODE": "1"}),
            patch("app.demo.reset_review.assert_database"),
            patch(
                "app.demo.reset_review.ControllerBroker", side_effect=BrokerUnavailable("offline")
            ),
            self.assertRaises(RuntimeError),
        ):
            reset_review(self.passwords, apply=True)
        with SessionLocal() as session:
            self.assertIsNotNone(session.get(Device, identity("review:device")))
            self.assertIsNotNone(session.get(ControllerCredential, identity("review:device")))
            self.assertIsNotNone(session.get(AccountSecurity, ACCOUNTS[0].user_id))

    def test_reset_preserves_a_personal_password_changed_after_provisioning(self):
        self.passwords["owner"] = "personal-12!"
        password_hash = hash_password(self.passwords["owner"])
        with SessionLocal.begin() as session:
            session.get(User, ACCOUNTS[0].user_id).password_hash = password_hash
        with (
            patch.dict(os.environ, {"TECHBAZA_DEMO_MODE": "1"}),
            patch("app.demo.reset_review.assert_database"),
        ):
            reset_review(self.passwords, apply=True)
        with SessionLocal() as session:
            self.assertEqual(session.get(User, ACCOUNTS[0].user_id).password_hash, password_hash)
