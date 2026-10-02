"""Паролі/транзакції/RBAC review-входів; SQLite лише для цих чотирьох таблиць.

Повний CLI та HTTP на PostgreSQL окремо проходять у demo job GitHub Actions.
"""

import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.demo.catalog import identity
from app.demo.review_accounts import (
    ACCOUNTS, _prepare_accounts, provision_accounts, read_or_create_credentials, validate_passwords,
)
from app.models import AccountSecurity, AuthSession, Organization, OrganizationMembership, User
from app.models.base import Base
from app.schemas.auth import LoginRequest
from app.security.authorization import AccessControl
from app.security.current_user import CurrentUserContext
from app.security.passwords import hash_password, verify_password
from app.security.roles import Permission
from app.security.tokens import decode_access_token
from app.services.auth import AuthService, InactiveUserError, InvalidCredentialsError


class ReviewCredentialsTests(unittest.TestCase):
    def test_credentials_are_unique_persistent_and_invalid_files_are_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "accounts.json"
            passwords = read_or_create_credentials(path)
            initial = path.read_bytes()
            self.assertEqual(len(set(passwords.values())), 8)
            self.assertTrue(all(len(p) == 40 for p in passwords.values()))
            self.assertEqual(read_or_create_credentials(path), passwords)
            self.assertEqual(path.read_bytes(), initial)
            for invalid in ('{}', 'broken JSON', 'x' * 16385):
                path.write_text(invalid)
                with self.assertRaises(ValueError):
                    read_or_create_credentials(path)
                self.assertEqual(path.read_text(), invalid)

    def test_password_validation_rejects_missing_extra_duplicate_and_invalid_values(self):
        good = {a.key: a.key + 'x' * 32 for a in ACCOUNTS}
        for bad in (None, {**good, "extra": "y" * 40}, {**good, "new": 42},
                    {**good, "new": "short"}, {**good, "new": "x" * 129},
                    {**good, "new": good["owner"]}):
            with self.subTest(value_type=type(bad).__name__), self.assertRaises(ValueError):
                validate_passwords(bad)

    def test_non_demo_environment_and_database_cannot_write(self):
        passwords = {a.key: a.key + 'x' * 32 for a in ACCOUNTS}
        with patch.dict(os.environ, {"TECHBAZA_DEMO_MODE": "0"}), \
                patch("app.demo.review_accounts.SessionLocal") as sessions:
            with self.assertRaises(RuntimeError):
                provision_accounts(passwords)
            sessions.begin.assert_not_called()
        with patch.dict(os.environ, {"TECHBAZA_DEMO_MODE": "1"}), \
                patch("app.demo.review_accounts.SessionLocal") as sessions:
            session = sessions.begin.return_value.__enter__.return_value
            session.scalar.return_value = "techbaza"
            with self.assertRaises(RuntimeError):
                provision_accounts(passwords)
            session.execute.assert_not_called()
            session.add.assert_not_called()


class ReviewAccountTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine, tables=[model.__table__ for model in (
            User, Organization, OrganizationMembership, AuthSession, AccountSecurity,
        )])
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        self.passwords = {a.key: a.key + '-local-test-only-password-' + 'x' * 16 for a in ACCOUNTS}
        with self.sessions.begin() as session:
            for key in ('a', 'b'):
                session.add(Organization(id=identity('org:' + key), name='Fixture',
                                         slug='techbaza-demo-' + key, is_active=True))

    def prepare(self, passwords=None):
        with self.sessions.begin() as session:
            return _prepare_accounts(session, passwords or self.passwords)

    def snapshot(self):
        with self.sessions() as session:
            return {u.email: (u.id, u.password_hash, u.platform_role, u.is_active)
                    for u in session.scalars(select(User))}

    def test_creation_hashes_passwords_and_repeat_preserves_existing_users(self):
        with self.sessions.begin() as session:
            session.add(User(email='legacy@example.com', display_name='Existing',
                             password_hash=hash_password('Legacy-test-password!'), platform_role='user'))
        original = self.snapshot()
        self.assertTrue(all(r['status'] == 'created' for r in self.prepare()))
        first = self.snapshot()
        self.assertEqual(first['legacy@example.com'], original['legacy@example.com'])
        for a in ACCOUNTS:
            self.assertTrue(verify_password(self.passwords[a.key], first[a.email][1]))
        self.assertTrue(all(r['status'] == 'existing' for r in self.prepare()))
        self.assertEqual(self.snapshot(), first)

    def test_email_collision_rolls_back_the_entire_batch(self):
        with self.sessions.begin() as session:
            session.add(User(email=ACCOUNTS[-1].email, display_name='Someone else',
                             password_hash=hash_password('Existing-test-password!'), platform_role='user'))
        original = self.snapshot()
        with self.assertRaises(RuntimeError):
            self.prepare()
        self.assertEqual(self.snapshot(), original)

    def test_late_database_conflict_rolls_back_inserted_users(self):
        legacy_id = uuid.uuid4()
        with self.sessions.begin() as session:
            session.add(User(id=legacy_id, email='legacy@example.com', display_name='Existing',
                             password_hash=hash_password('Legacy-test-password!'), platform_role='user'))
            session.flush()
            session.add(OrganizationMembership(id=identity('review:membership:owner'), user_id=legacy_id,
                organization_id=identity('org:a'), role='viewer', is_active=True))
        original = self.snapshot()
        with self.assertRaises(IntegrityError):
            self.prepare()
        self.assertEqual(self.snapshot(), original)

    def test_changed_password_does_not_reset_any_account(self):
        self.prepare()
        original = self.snapshot()
        with self.assertRaises(RuntimeError):
            self.prepare({**self.passwords, 'new': 'Different-test-password-' + 'x' * 32})
        self.assertEqual(self.snapshot(), original)

    def test_revoked_service_grant_is_not_restored(self):
        self.prepare()
        with self.sessions.begin() as session:
            session.get(OrganizationMembership, identity('review:membership:service')).is_active = False
        with self.assertRaises(RuntimeError):
            self.prepare()
        with self.sessions() as session:
            self.assertFalse(session.get(OrganizationMembership, identity('review:membership:service')).is_active)

    def test_disabled_account_is_not_reactivated(self):
        self.prepare()
        with self.sessions.begin() as session:
            session.get(User, ACCOUNTS[-1].user_id).is_active = False
        original = self.snapshot()
        with self.assertRaises(RuntimeError):
            self.prepare()
        self.assertEqual(self.snapshot(), original)

    def test_wrong_fixture_prevents_creation(self):
        with self.sessions.begin() as session:
            session.get(Organization, identity('org:b')).slug = 'other-organization'
        with self.assertRaises(RuntimeError):
            self.prepare()
        self.assertEqual(self.snapshot(), {})

    def test_real_login_and_role_boundaries(self):
        self.prepare()
        expected = {
            'owner': ({'a'}, True, True), 'admin': ({'a'}, True, True),
            'operator': ({'a'}, True, False), 'viewer': ({'a'}, False, False),
            'service': ({'a'}, True, False), 'superadmin': ({'a', 'b'}, True, True),
            'other': ({'b'}, True, True), 'new': (set(), False, False),
        }
        for account in ACCOUNTS:
            with self.subTest(account=account.key), self.sessions() as session:
                tokens = AuthService(session).login(LoginRequest(email=account.email,
                                                                 password=self.passwords[account.key]))
                claims = decode_access_token(tokens.access_token)
                self.assertEqual(claims['sub'], str(account.user_id))
                current = CurrentUserContext(session.get(User, account.user_id),
                                             session.get(AuthSession, uuid.UUID(claims['sid'])))
                access = AccessControl(session, current)
                visible, can_execute, can_manage = expected[account.key]
                self.assertEqual({o.id for o in access.list_visible_organizations(limit=50, offset=0)},
                                 {identity('org:' + key) for key in visible})
                for org in ('a', 'b'):
                    for permission, allowed in ((Permission.COMMAND_EXECUTE, can_execute),
                                                (Permission.MEMBERSHIP_MANAGE, can_manage)):
                        if org in visible and allowed:
                            access.require_organization(identity('org:' + org), permission)
                        else:
                            with self.assertRaises(HTTPException) as error:
                                access.require_organization(identity('org:' + org), permission)
                            self.assertEqual(error.exception.status_code, 403 if org in visible else 404)
        with self.sessions() as session:
            with self.assertRaises(InvalidCredentialsError):
                AuthService(session).login(LoginRequest(email=ACCOUNTS[0].email, password='wrong-password'))
            session.get(User, ACCOUNTS[0].user_id).is_active = False
            session.commit()
            with self.assertRaises(InactiveUserError):
                AuthService(session).login(LoginRequest(email=ACCOUNTS[0].email, password=self.passwords['owner']))
