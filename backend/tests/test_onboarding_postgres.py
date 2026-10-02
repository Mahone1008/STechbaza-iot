"""Isolated real transactions: no broker publication or real controller access."""
import os
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from sqlalchemy import delete, select
import test_comprehensive_postgres as base
from auth_http_helpers import request
from app.db import SessionLocal
from app.models import AuthSession, Device, Organization, OrganizationMembership, Site, User
from app.models.equipment import EquipmentModule, PumpInstallation
from app.models.onboarding import AccountSecurity, FactoryAudit, FactoryController, PersonalWorkspace
from app.security.account_keys import secret_box, totp_code
from app.security.browser_config import AUTH_BROWSER_ORIGINS
from app.security.passwords import hash_password
from app.security.tokens import utc_now


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class OnboardingPostgresTests(unittest.TestCase):
    def setUp(self):
        self.controllers = []
        self.additional_users = []
        base.ComprehensivePostgresTests.setUp(self)
        self.ip = f"198.18.33.{1+uuid.uuid4().int%250}"
        with SessionLocal.begin() as session:
            session.get(User, self.contexts["owner"].user.id).platform_role = "superadmin"
            session.get(AuthSession, self.contexts["owner"].auth_session.id).mfa_verified_at = utc_now()

    def cleanup_data(self):
        with SessionLocal.begin() as session:
            personal = list(session.scalars(select(PersonalWorkspace.organization_id).where(PersonalWorkspace.user_id.in_([c.user.id for c in self.contexts.values()]))))
            controller_devices = list(session.scalars(select(FactoryController.device_id).where(FactoryController.id.in_(self.controllers), FactoryController.device_id.is_not(None))))
            session.execute(delete(EquipmentModule).where(EquipmentModule.device_id.in_(controller_devices)))
            session.execute(delete(FactoryAudit).where(FactoryAudit.controller_id.in_(self.controllers)))
            session.execute(delete(FactoryController).where(FactoryController.id.in_(self.controllers)))
            session.execute(delete(Device).where(Device.id.in_(controller_devices)))
            session.execute(delete(Organization).where(Organization.id.in_(personal)))
            session.execute(delete(User).where(User.id.in_(self.additional_users)))
        base.ComprehensivePostgresTests.cleanup_data(self)

    def call(self, path, *, body=None, who="owner", method="GET", expected=200):
        code, result, headers = request(method, path, body=body, headers={"authorization":f"Bearer {self.tokens[who]}"}, ip=self.ip)
        self.assertEqual(code, expected, (path, result))
        return result

    def factory(self):
        result = self.call("/api/v1/factory/controllers", method="POST", expected=201,
            body=dict(serial_number=f"TEST-{uuid.uuid4().hex}", hardware_model="KERUMO V3", hardware_revision="V3.1", batch="integration-only",
                      test_reference="isolated test fixture", factory_test_passed=True))
        self.controllers.append(uuid.UUID(result["controller"]["id"]))
        return result

    def claim_body(self, factory, **values):
        return dict(activation_code=factory["activation_code"], device_name="My pump", new_site={"name":"My well", "timezone":"Europe/Kyiv"}, **values)

    def test_claim_consumes_secret_and_rescanning_never_leaks_another_tenant(self):
        factory = self.factory()
        path = f'/api/v1/connect/{factory["controller"]["id"]}'
        body = self.claim_body(factory)
        self.call(path+"/claim", method="POST", who="other", body={**body,"activation_code":"x"*43}, expected=404)
        first = self.call(path+"/claim", method="POST", who="other", body=body)
        second = self.call(path+"/claim", method="POST", who="other", body=body)
        self.assertEqual(first["device_id"], second["device_id"])
        self.call(path, who="viewer", expected=404)
        self.call(path+"/claim", who="viewer", method="POST", body=body, expected=404)
        with SessionLocal() as session:
            row = session.get(FactoryController, uuid.UUID(factory["controller"]["id"]))
            self.assertIsNone(row.activation_hash)
            device = session.get(Device, uuid.UUID(first["device_id"]))
            self.assertTrue(device.uid.startswith("FC-"))
            self.assertEqual(device.lifecycle_status, "provisioning")
        listed = self.call("/api/v1/factory/controllers")
        self.assertNotIn(factory["bootstrap_key"], str(listed))
        self.assertNotIn(factory["activation_code"], str(listed))

    def test_concurrent_claims_have_one_owner_and_no_orphan_workspace(self):
        factory = self.factory()
        path = f'/api/v1/connect/{factory["controller"]["id"]}/claim'
        barrier = threading.Barrier(2)
        def send(who):
            barrier.wait()
            return request("POST", path, body=self.claim_body(factory), headers={"authorization":f"Bearer {self.tokens[who]}"}, ip=self.ip)[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(send, role) for role in ("other", "operator")]
            results = sorted(f.result(timeout=15) for f in futures)
        self.assertEqual(results, [200,404])
        with SessionLocal() as session:
            buyers = [self.contexts[role].user.id for role in ("other","operator")]
            self.assertEqual(len(list(session.scalars(select(PersonalWorkspace).where(PersonalWorkspace.user_id.in_(buyers))))),1)

    def test_factory_requires_mfa_and_buyer_cannot_change_shipments(self):
        self.call("/api/v1/factory/controllers", who="viewer", expected=403)
        with SessionLocal.begin() as session:
            session.get(AuthSession, self.contexts["owner"].auth_session.id).mfa_verified_at = None
        self.call("/api/v1/factory/controllers", expected=403)

    def test_site_scope_expiry_and_notifications_count_enforce_access(self):
        membership_id = None
        with SessionLocal.begin() as session:
            membership = session.scalar(select(OrganizationMembership).where(OrganizationMembership.user_id == self.contexts["operator"].user.id))
            membership.site_ids = [str(self.sites[1])]
            membership_id = membership.id
        self.call(self.base+"/overview", who="operator", expected=404)
        self.assertEqual(self.call(f"/api/v1/organizations/{self.orgs[0]}/sites", who="operator"), [])
        count = self.call(f"/api/v1/organizations/{self.orgs[0]}/notifications/unread-count", who="operator")
        self.assertEqual(count["unread_count"], 0)
        with SessionLocal.begin() as session:
            membership = session.get(OrganizationMembership, membership_id)
            membership.site_ids = None
            membership.expires_at = utc_now()-timedelta(seconds=1)
        self.call(self.base, who="operator", expected=404)
        self.assertEqual(self.call("/api/v1/organizations", who="operator"), [])

    def test_recovery_rotates_key_revokes_sessions_and_totp_rejects_replay(self):
        import time
        email=f"security-{uuid.uuid4().hex}@example.com"
        password="integration-only-password-123"
        headers={"origin":AUTH_BROWSER_ORIGINS[0], "x-techbaza-csrf":"1"}
        code, registration, _ = request("POST", "/api/v1/auth/register", body=dict(email=email, display_name="New buyer", password=password), headers=headers, ip=self.ip)
        self.assertEqual(code,201,registration)
        with SessionLocal.begin() as session:
            user=session.scalar(select(User).where(User.email==email))
            self.additional_users.append(user.id)
            sec=session.get(AccountSecurity,user.id)
            sec.totp_secret=secret_box().encrypt(b"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").decode()
            sec.totp_enabled_at=utc_now()
        login=dict(email=email,password=password,otp=totp_code("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",int(time.time()//30)))
        code,tokens,_=request("POST","/api/v1/auth/login",body=login,ip=self.ip)
        self.assertEqual(code,200,tokens)
        code,_,_=request("POST","/api/v1/auth/login",body=login,ip=self.ip)
        self.assertEqual(code,401)
        recovery=dict(email=email,recovery_key=registration["recovery_key"],new_password="replacement-password-456")
        code,replaced,_=request("POST","/api/v1/auth/recover",body=recovery,headers=headers,ip=self.ip)
        self.assertEqual(code,200,replaced)
        self.assertNotEqual(replaced["recovery_key"],registration["recovery_key"])
        code,_,_=request("GET","/api/v1/auth/me",headers={"authorization":f'Bearer {tokens["access_token"]}'},ip=self.ip)
        self.assertEqual(code,401)
        code,_,_=request("POST","/api/v1/auth/recover",body=recovery,headers=headers,ip=self.ip)
        self.assertEqual(code,401)
