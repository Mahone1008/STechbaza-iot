"""Shared isolated PostgreSQL fixtures for onboarding acceptance."""

import uuid
from sqlalchemy import delete, select
import test_comprehensive_postgres as base
from auth_http_helpers import request
from app.db import SessionLocal
from app.models import AuthSession, Device, Organization, User
from app.models.equipment import EquipmentModule
from app.models.onboarding import FactoryAudit, FactoryController, PersonalWorkspace
from app.security.tokens import utc_now


class OnboardingFixtures:
    def setUp(self):
        self.controllers = []
        self.additional_users = []
        base.ComprehensivePostgresTests.setUp(self)
        # A 250-address pool lets unrelated suites share a persisted auth bucket.
        # Use a separate documentation-only IPv6 peer for each isolated scenario.
        peer = uuid.uuid4().hex[:24]
        self.ip = "2001:db8:" + ":".join(peer[i:i + 4] for i in range(0, 24, 4))
        with SessionLocal.begin() as session:
            session.get(User, self.contexts["owner"].user.id).platform_role = "superadmin"
            session.get(
                AuthSession, self.contexts["owner"].auth_session.id
            ).mfa_verified_at = utc_now()

    def cleanup_data(self):
        with SessionLocal.begin() as session:
            personal = list(
                session.scalars(
                    select(PersonalWorkspace.organization_id).where(
                        PersonalWorkspace.user_id.in_(
                            [c.user.id for c in self.contexts.values()] + self.additional_users
                        )
                    )
                )
            )
            controller_devices = list(
                session.scalars(
                    select(FactoryController.device_id).where(
                        FactoryController.id.in_(self.controllers),
                        FactoryController.device_id.is_not(None),
                    )
                )
            )
            session.execute(
                delete(EquipmentModule).where(EquipmentModule.device_id.in_(controller_devices))
            )
            session.execute(
                delete(FactoryAudit).where(FactoryAudit.controller_id.in_(self.controllers))
            )
            session.execute(
                delete(FactoryController).where(FactoryController.id.in_(self.controllers))
            )
            session.execute(delete(Device).where(Device.id.in_(controller_devices)))
            session.execute(delete(Organization).where(Organization.id.in_(personal)))
            session.execute(delete(User).where(User.id.in_(self.additional_users)))
        base.ComprehensivePostgresTests.cleanup_data(self)

    def call(self, path, *, body=None, who="owner", method="GET", expected=200):
        code, result, headers = request(
            method,
            path,
            body=body,
            headers={"authorization": f"Bearer {self.tokens[who]}"},
            ip=self.ip,
        )
        self.assertEqual(code, expected, (path, result))
        return result

    def factory(self):
        result = self.call(
            "/api/v1/factory/controllers",
            method="POST",
            expected=201,
            body=dict(
                serial_number=f"TEST-{uuid.uuid4().hex}",
                hardware_model="KERUMO V3",
                hardware_revision="V3.1",
                batch="integration-only",
                test_reference="isolated test fixture",
                factory_test_passed=True,
            ),
        )
        self.controllers.append(uuid.UUID(result["controller"]["id"]))
        return result

    def claim_body(self, factory, **values):
        return dict(
            activation_code=factory["activation_code"],
            device_name="My pump",
            new_site={"name": "My well", "timezone": "Europe/Kyiv"},
            **values,
        )
