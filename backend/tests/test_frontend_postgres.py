"""Етап 8 операція 1: справжні JWT/ASGI/PostgreSQL, власні тестові дані.

TECHBAZA_RUN_DB_TESTS=1; основний backend зупинений. Cleanup видаляє лише
UUID цього запуску та capabilities, які створив саме цей тест.
"""

import os
import json
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.parse import urlencode

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert

from app.db import SessionLocal
from app.models.auth_session import AuthSession
from app.models.capability import Capability, DeviceCapability
from app.models.device import Device
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.models.site import Site
from app.models.telemetry import DeviceState, TelemetryMessage
from app.models.user import User
from app.security.roles import ORGANIZATION_ROLE_PERMISSIONS, OrganizationRole, Permission
from app.security.tokens import create_access_token
from app.schemas.telemetry import TelemetryEnvelope
from app.services.telemetry import TelemetryCapabilityViolationError, TelemetryService
from app.tools.alarm_ack_check import _identity
from app.tools.alarm_ack_http_check import _request
from test_controller_diagnostics import diagnostic_payload


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires PostgreSQL opt-in")
class FrontendPostgresTests(unittest.TestCase):
    def setUp(self):
        self.orgs = [uuid.uuid4(), uuid.uuid4()]
        self.sites = [uuid.uuid4(), uuid.uuid4()]
        self.devices = [uuid.uuid4(), uuid.uuid4()]
        self.now = datetime.now(timezone.utc)
        self.identities = {}
        self.tokens = {}
        self.created_caps = []
        self.addCleanup(self.cleanup_data)
        with SessionLocal() as session:
            for org_id, site_id in zip(self.orgs, self.sites):
                session.add(Organization(id=org_id, name="Frontend test", slug=f"frontend-{org_id.hex}",
                                         created_at=self.now))
                session.flush()
                session.add(Site(id=site_id, organization_id=org_id, name="Test only", code="test",
                                 created_at=self.now))
                session.flush()
            for device_id in self.devices:
                session.add(Device(id=device_id, site_id=self.sites[0], uid=f"TB-FRONTEND-{device_id.hex}",
                                   name="Frontend test", lifecycle_status="active", created_at=self.now))
            for role in ("owner", "admin", "operator", "viewer", "service", "outsider"):
                ctx = _identity(session, self.orgs[0] if role != "outsider" else self.orgs[1],
                                role if role != "outsider" else "owner")
                self.identities[role] = ctx
                self.tokens[role] = create_access_token(
                    user_id=ctx.user.id, auth_session_id=ctx.auth_session.id,
                ).token
            session.commit()

    def cleanup_data(self):
        with SessionLocal() as session:
            session.execute(delete(Organization).where(Organization.id.in_(self.orgs)))
            session.execute(delete(User).where(User.id.in_([c.user.id for c in self.identities.values()])))
            session.execute(delete(Capability).where(Capability.id.in_(self.created_caps)))
            session.commit()

    def request(self, path, *, who="viewer", expected=200, method="GET", body=None):
        code, result = _request(method, f"/api/v1{path}", self.tokens.get(who), body=body)
        self.assertEqual(code, expected, (path, code, result))
        return result

    @property
    def overview(self):
        return f"/devices/{self.devices[0]}/overview"

    @property
    def access(self):
        return f"/organizations/{self.orgs[0]}/access"

    def assign(self, code, enabled=True):
        with SessionLocal() as session:
            created = session.scalar(insert(Capability).values(
                id=uuid.uuid4(), code=code, name=f"Test {code}",
            ).on_conflict_do_nothing(index_elements=["code"]).returning(Capability.id))
            if created is not None:
                self.created_caps.append(created)
            cap_id = session.scalar(select(Capability.id).where(Capability.code == code))
            session.add(DeviceCapability(device_id=self.devices[0], capability_id=cap_id,
                                         is_enabled=enabled, config={"frequency_limits": {"min_hz": 0, "max_hz": 50}} if code == "vfd.control" else {}))
            session.commit()
            return cap_id

    def store_snapshot(self, *, seen_at, received_at, values=None, state=None):
        with SessionLocal() as session:
            session.get(Device, self.devices[0]).last_seen_at = seen_at
            session.add(DeviceState(device_id=self.devices[0], last_received_at=received_at,
                                    values=values or {}, state=state or {}))
            session.commit()

    def test_new_device_has_explicit_empty_state(self):
        result = self.request(self.overview)
        self.assertEqual(result["device"]["id"], str(self.devices[0]))
        self.assertIsNone(result["snapshot"])
        self.assertFalse(result["availability"]["online"])
        self.assertIsNone(result["availability"]["last_seen_at"])
        for key in ("capabilities", "modules", "value_keys", "state_keys", "command_types", "allowed_commands", "state_readings"):
            self.assertEqual(result[key], [], key)
        self.assertEqual(result["access"], self.request(self.access))
        self.assertIsNone(result["diagnostics"])

    def test_diagnostics_share_telemetry_ordering_session_and_tenant_guards(self):
        device_uid = f"TB-FRONTEND-{self.devices[0].hex}"
        boot = uuid.uuid4()
        first = TelemetryEnvelope(schema_version=1, message_id=uuid.uuid4(), session_id=boot,
                                  sequence=10, sent_at=self.now, diagnostics=diagnostic_payload())
        with SessionLocal() as session:
            service = TelemetryService(session)
            result = service.ingest(device_uid=device_uid, payload=first, received_at=self.now)
            self.assertTrue(result.state_updated)
            self.assertTrue(service.ingest(device_uid=device_uid, payload=first).duplicate)
            older = first.model_copy(update={"message_id": uuid.uuid4(), "sequence": 9, "diagnostics": None})
            self.assertFalse(service.ingest(device_uid=device_uid, payload=older).state_updated)
        view = self.request(self.overview)
        self.assertEqual(view["diagnostics"], diagnostic_payload())
        self.assertEqual(view["telemetry_freshness"]["status"], "fresh")
        history = self.request(f"/devices/{self.devices[0]}/telemetry")
        self.assertEqual(len(history), 2)
        self.assertEqual(next(row for row in history if row["message_id"] == str(first.message_id))["diagnostics"], diagnostic_payload())
        self.request(self.overview, who="outsider", expected=404)
        self.assertIsNone(self.request(f"/devices/{self.devices[1]}/overview")["diagnostics"])
        with SessionLocal() as session:
            session.get(Device, self.devices[0]).last_observed_session_id = uuid.uuid4()
            session.commit()
        view = self.request(self.overview)
        self.assertEqual(view["telemetry_freshness"]["reason"], "session_changed")
        # An explicit absent block replaces rather than revives the previous sample's data.
        with SessionLocal() as session:
            next_boot = session.get(Device, self.devices[0]).last_observed_session_id
            payload = first.model_copy(update={"message_id": uuid.uuid4(), "session_id": next_boot,
                                               "sequence": 1, "diagnostics": None, "sent_at": self.now + timedelta(seconds=1)})
            self.assertTrue(TelemetryService(session).ingest(device_uid=device_uid, payload=payload).state_updated)
        self.assertIsNone(self.request(self.overview)["diagnostics"])

    def test_enabled_modules_filter_snapshot_without_mutating_history(self):
        self.assign("pressure.read")
        state_cap = self.assign("vfd.state.read")
        self.assign("vfd.frequency.read", enabled=False)
        custom = f"test.{uuid.uuid4().hex}"
        self.assign(custom)
        old = self.now - timedelta(hours=1)
        values = {"pressure.bar": 0, "vfd.frequency_hz": 50, "water_level.percent": 80, "unknown": 7}
        state = {"pump_running": False, "unexpected": True}
        self.store_snapshot(seen_at=self.now, received_at=old, values=values, state=state)
        result = self.request(self.overview)
        self.assertCountEqual([c["code"] for c in result["capabilities"]],
                              ["pressure.read", "vfd.state.read", custom])
        self.assertEqual(result["value_keys"], ["pressure.bar"])
        self.assertIn("vfd_fault_code", result["state_keys"])
        self.assertEqual(result["snapshot"]["values"], {"pressure.bar": 0})
        self.assertEqual(result["snapshot"]["state"], {"pump_running": False})
        self.assertNotIn("vfd_fault_code", result["snapshot"]["state"])
        self.assertTrue(result["availability"]["online"])
        self.assertEqual(datetime.fromisoformat(result["snapshot"]["last_received_at"].replace("Z", "+00:00")), old)
        self.assertEqual(self.request(f"/devices/{self.devices[1]}/overview")["capabilities"], [])
        with SessionLocal() as session:
            stored = session.get(DeviceState, self.devices[0])
            self.assertEqual(stored.values, values)
            self.assertEqual(stored.state, state)
            assignment = session.scalar(select(DeviceCapability).where(
                DeviceCapability.device_id == self.devices[0], DeviceCapability.capability_id == state_cap))
            assignment.is_enabled = False
            session.commit()
        result = self.request(self.overview)
        self.assertEqual(result["snapshot"]["state"], {})
        self.assertEqual(result["state_keys"], [])

    def test_roles_and_capability_commands_follow_server_guards(self):
        cap_id = self.assign("vfd.control")
        commands = ["vfd.frequency.set", "vfd.start", "vfd.stop"]
        for role in ("owner", "admin", "operator", "viewer", "service"):
            result = self.request(self.overview, who=role)
            self.assertEqual(result["command_types"], commands)
            self.assertEqual(result["allowed_commands"], [] if role == "viewer" else commands)
            self.assertEqual(result["modules"][0]["code"], "vfd.control")
            self.assertEqual(result["modules"][0]["allowed_commands"], result["allowed_commands"])
            self.assertEqual(result["modules"][0]["channels"], [])
            self.assertTrue(result["modules"][0]["supported"])
            self.assertEqual(result["access"]["organization_role"], role)
            self.assertEqual(result["access"], self.request(self.access, who=role))
            self.assertEqual("command.execute" in result["access"]["permissions"], role != "viewer")
        body = {"request_id": str(uuid.uuid4()), "command_type": "vfd.start"}
        command_path = f"/devices/{self.devices[0]}/commands"
        self.request(command_path, method="POST", body=body, expected=403)
        # Якщо політика читання стане вужчою, агрегат також повинен відмовити.
        for removed in (Permission.CAPABILITY_READ, Permission.TELEMETRY_READ):
            permissions = ORGANIZATION_ROLE_PERMISSIONS[OrganizationRole.VIEWER] - {removed}
            with patch.dict(ORGANIZATION_ROLE_PERMISSIONS, {OrganizationRole.VIEWER: permissions}):
                self.request(self.overview, expected=403)
        with SessionLocal() as session:
            assignment = session.scalar(select(DeviceCapability).where(
                DeviceCapability.device_id == self.devices[0], DeviceCapability.capability_id == cap_id))
            assignment.is_enabled = False
            session.commit()
        result = self.request(self.overview, who="operator")
        self.assertEqual(result["allowed_commands"], [])
        self.assertEqual(result["command_types"], [])
        self.request(command_path, who="operator", method="POST", body=body, expected=409)
        self.assertEqual(self.request(command_path), [])

    def test_tenant_guards_platform_roles_and_membership_revocation(self):
        for path, missing in ((self.overview, f"/devices/{uuid.uuid4()}/overview"),
                              (self.access, f"/organizations/{uuid.uuid4()}/access")):
            self.assertEqual(self.request(path, who="outsider", expected=404),
                             self.request(missing, expected=404))
        with SessionLocal() as session:
            session.get(User, self.identities["outsider"].user.id).platform_role = "service_admin"
            session.scalar(select(OrganizationMembership).where(
                OrganizationMembership.user_id == self.identities["viewer"].user.id,
                OrganizationMembership.organization_id == self.orgs[0])).is_active = False
            session.commit()
        for path in (self.access, self.overview):
            self.request(path, who="outsider", expected=404)
            self.request(path, expected=404)
        with SessionLocal() as session:
            session.get(User, self.identities["outsider"].user.id).platform_role = "superadmin"
            session.get(Organization, self.orgs[0]).is_active = False
            session.commit()
        for path in (self.access, self.overview):
            self.request(path, who="operator", expected=404)
        result = self.request(self.overview, who="outsider")
        self.assertIsNone(result["access"]["organization_role"])
        self.assertEqual(result["access"]["permissions"], sorted(p.value for p in Permission))

    def test_revoked_session_disabled_user_and_invalid_uuid(self):
        self.request("/devices/not-a-uuid/overview", expected=422)
        self.request("/organizations/not-a-uuid/access", expected=422)
        with SessionLocal() as session:
            session.get(AuthSession, self.identities["operator"].auth_session.id).revoked_at = self.now
            session.get(User, self.identities["viewer"].user.id).is_active = False
            session.commit()
        for path in (self.overview, self.access):
            self.request(path, who="operator", expected=401)
            self.request(path, expected=403)

    def test_saved_snapshot_does_not_mean_device_online(self):
        self.assign("pressure.read")
        self.store_snapshot(seen_at=self.now-timedelta(days=1), received_at=self.now-timedelta(days=1),
                            values={"pressure.bar": 2.5})
        result = self.request(self.overview)
        self.assertFalse(result["availability"]["online"])
        self.assertEqual(result["snapshot"]["values"], {"pressure.bar": 2.5})
        self.assertGreater(result["availability"]["seconds_since_seen"], 80000)

    def test_navigation_pagination_has_stable_tie_breaker_and_limits(self):
        with SessionLocal() as session:
            session.add(OrganizationMembership(organization_id=self.orgs[1],
                        user_id=self.identities["viewer"].user.id, role="viewer"))
            session.get(Site, self.sites[1]).organization_id = self.orgs[0]
            session.get(Site, self.sites[1]).code = "second"
            session.commit()
        for path, ids in (("/organizations", self.orgs),
                          (f"/organizations/{self.orgs[0]}/sites", self.sites),
                          (f"/sites/{self.sites[0]}/devices", self.devices)):
            first = self.request(path+"?limit=1")[0]["id"]
            second = self.request(path+"?limit=1&offset=1")[0]["id"]
            self.assertEqual([first, second], sorted(map(str, ids), reverse=True))
            self.assertEqual(self.request(path+"?limit=1&offset=2"), [])
            for query in ("limit=0", "limit=101", "offset=-1"):
                self.request(path+"?"+query, expected=422)

    def test_first_screen_flow_and_empty_feeds(self):
        me = self.request("/auth/me")
        self.assertEqual(me["id"], str(self.identities["viewer"].user.id))
        organizations = self.request("/organizations")
        self.assertEqual([o["id"] for o in organizations], [str(self.orgs[0])])
        sites = self.request(f"/organizations/{self.orgs[0]}/sites")
        self.assertEqual([s["id"] for s in sites], [str(self.sites[0])])
        devices = self.request(f"/sites/{self.sites[0]}/devices")
        self.assertCountEqual([d["id"] for d in devices], list(map(str, self.devices)))
        self.request(self.access)
        self.request(self.overview)
        for feed in ("telemetry", "events", "alarms", "commands"):
            self.assertEqual(self.request(f"/devices/{self.devices[0]}/{feed}"), [])
        self.request(f"/devices/{self.devices[0]}/state", expected=404)
        notifications = f"/organizations/{self.orgs[0]}/notifications"
        self.assertEqual(self.request(notifications), [])
        self.assertEqual(self.request(notifications+"/unread-count"), {"unread_count": 0})

    def test_physical_v3_subset_hides_uninstalled_inputs_and_rejects_their_ingestion(self):
        cap_id = self.assign("vfd.state.read")
        voltage_id = self.assign("vfd.voltage.read")
        with SessionLocal() as session:
            assignment = session.scalar(select(DeviceCapability).where(DeviceCapability.device_id == self.devices[0],
                DeviceCapability.capability_id == cap_id))
            assignment.config = {"telemetry_keys": ["pump_running", "vfd_fault_code"]}
            session.commit()
        result = self.request(self.overview)
        self.assertEqual(result["state_keys"], ["pump_running", "vfd_fault_code"])
        valid = TelemetryEnvelope(schema_version=1, message_id=uuid.uuid4(), values={"vfd.voltage_v": 0},
                                  state={"pump_running": False, "vfd_fault_code": 0})
        with SessionLocal() as session:
            TelemetryService(session).ingest(device_uid=f"TB-FRONTEND-{self.devices[0].hex}", payload=valid, received_at=self.now)
        with SessionLocal() as session:
            with self.assertRaises(TelemetryCapabilityViolationError):
                TelemetryService(session).ingest(device_uid=f"TB-FRONTEND-{self.devices[0].hex}",
                    payload=TelemetryEnvelope(schema_version=1, message_id=uuid.uuid4(), state={"emergency_stop": False}))
        self.assertEqual(self.request(self.overview)["readings"][0]["value"], 0)
        with SessionLocal() as session:
            assignment = session.scalar(select(DeviceCapability).where(DeviceCapability.device_id == self.devices[0],
                DeviceCapability.capability_id == voltage_id))
            assignment.config = {"telemetry_keys": []}
            session.commit()
        query = urlencode({"metric": "vfd.voltage_v", "start": (self.now-timedelta(seconds=1)).isoformat(),
                           "end": (self.now+timedelta(seconds=1)).isoformat(), "bucket_seconds": 2})
        self.request(f"/devices/{self.devices[0]}/telemetry/series?{query}", expected=409)

    def test_modules_bind_assignments_channels_and_commands_without_config_leak(self):
        expected = {
            "pressure.read": [("pressure.bar", "values", "number", "bar", True)],
            "water_level.read": [("water_level.percent", "values", "number", "%", True)],
            "vfd.frequency.read": [("vfd.frequency_hz", "values", "number", "Hz", True)],
            "vfd.current.read": [("vfd.current_a", "values", "number", "A", True)],
            "vfd.set_frequency.read": [("vfd.set_frequency_hz", "values", "number", "Hz", True)],
            "vfd.voltage.read": [("vfd.voltage_v", "values", "number", "V", True)],
            "vfd.diagnostics.read": [(key, "state", "boolean", None, False) for key in
                                     ("control_armed", "vfd_configuration_valid", "vfd_link")],
            "vfd.state.read": [(key, "state", "integer" if key == "vfd_fault_code" else "boolean", None, False)
                               for key in ("emergency_stop", "local_mode", "pump_running", "vfd_fault_code")],
            "vfd.control": [],
        }
        for code in expected:
            self.assign(code)
        unknown = "test.unsupported." + uuid.uuid4().hex
        unknown_id = self.assign(unknown)
        with SessionLocal() as session:
            assignments = session.scalars(select(DeviceCapability).where(DeviceCapability.device_id == self.devices[0])).all()
            assignment_ids = {str(item.capability_id): str(item.id) for item in assignments}
            next(item for item in assignments if item.capability_id == unknown_id).config = {
                "private_marker": "DO_NOT_EXPOSE_MODULE_CONFIG", "channels": ["fake.pressure"],
                "command_types": ["vfd.start"],
            }
            session.commit()
        result = self.request(self.overview)
        self.assertEqual([item["code"] for item in result["modules"]], sorted([*expected, unknown]))
        self.assertNotIn("DO_NOT_EXPOSE_MODULE_CONFIG", json.dumps(result))
        for module in result["modules"]:
            self.assertEqual(module["assignment_id"], assignment_ids[module["capability_id"]])
            self.assertEqual(module["supported"], module["code"] != unknown)
            channels = [(c["key"], c["source"], c["data_type"], c["unit"], c["supports_series"]) for c in module["channels"]]
            self.assertEqual(channels, expected.get(module["code"], []))
            self.assertEqual(module["allowed_commands"], [])
            self.assertEqual(module["command_types"], result["command_types"] if module["code"] == "vfd.control" else [])
        self.assertEqual(self.request(f"/devices/{self.devices[1]}/overview")["modules"], [])

    def test_advertised_channels_work_through_ingest_series_and_command_routes(self):
        for code in ("pressure.read", "water_level.read", "vfd.frequency.read", "vfd.current.read", "vfd.state.read", "vfd.control"):
            self.assign(code)
        values = {"pressure.bar": 2.5, "water_level.percent": 80, "vfd.frequency_hz": 31, "vfd.current_a": 4}
        state = {"pump_running": False, "vfd_fault_code": 0, "local_mode": False, "emergency_stop": False}
        with SessionLocal() as session:
            TelemetryService(session).ingest(device_uid=f"TB-FRONTEND-{self.devices[0].hex}",
                payload=TelemetryEnvelope(schema_version=1, message_id=uuid.uuid4(), values=values, state=state),
                received_at=self.now)
        result = self.request(self.overview, who="operator")
        self.assertEqual(result["value_keys"], sorted(values))
        self.assertEqual(result["state_keys"], sorted(state))
        with patch("app.services.command_dispatch.publish_command_message", return_value=(True, "published")) as publish:
            for module in result["modules"]:
                for channel in module["channels"]:
                    query = urlencode({"metric": channel["key"], "start": (self.now-timedelta(seconds=1)).isoformat(),
                        "end": (self.now+timedelta(seconds=1)).isoformat(), "bucket_seconds": 2})
                    series = self.request(f"/devices/{self.devices[0]}/telemetry/series?{query}",
                                          expected=200 if channel["supports_series"] else 422)
                    if channel["supports_series"]:
                        self.assertEqual(series["sample_count"], 1)
                        self.assertEqual(series["unit"], channel["unit"])
                        self.assertEqual(series["buckets"][0]["average"], values[channel["key"]])
                for command in module["allowed_commands"]:
                    self.request(f"/devices/{self.devices[0]}/commands", method="POST", who="operator", expected=201,
                        body={"request_id": str(uuid.uuid4()), "command_type": command,
                              "payload": {"frequency_hz": 31} if command == "vfd.frequency.set" else {}})
            self.assertEqual(publish.call_count, 3)

    def test_http_disable_removes_modules_and_blocks_ingest_series_and_commands(self):
        ids = {code: self.assign(code) for code in ("pressure.read", "vfd.state.read", "vfd.control")}
        self.store_snapshot(seen_at=self.now, received_at=self.now, values={"pressure.bar": 2.5}, state={"pump_running": False})
        for cap_id in ids.values():
            self.request(f"/devices/{self.devices[0]}/capabilities/{cap_id}", who="owner", method="PATCH", body={"is_enabled": False})
        result = self.request(self.overview, who="owner")
        for key in ("modules", "value_keys", "state_keys", "readings", "state_readings", "allowed_commands"):
            self.assertEqual(result[key], [])
        self.assertEqual(result["snapshot"]["values"], {})
        self.assertEqual(result["snapshot"]["state"], {})
        query = urlencode({"metric": "pressure.bar", "start": (self.now-timedelta(seconds=1)).isoformat(), "end": self.now.isoformat()})
        self.request(f"/devices/{self.devices[0]}/telemetry/series?{query}", expected=409)
        self.request(f"/devices/{self.devices[0]}/commands", who="owner", method="POST", expected=409,
                     body={"request_id": str(uuid.uuid4()), "command_type": "vfd.start"})
        with SessionLocal() as session:
            with self.assertRaises(TelemetryCapabilityViolationError):
                TelemetryService(session).ingest(device_uid=f"TB-FRONTEND-{self.devices[0].hex}",
                    payload=TelemetryEnvelope(schema_version=1, message_id=uuid.uuid4(), values={"pressure.bar": 99}))
            stored = session.get(DeviceState, self.devices[0])
            self.assertEqual(stored.values, {"pressure.bar": 2.5})
            self.assertEqual(stored.state, {"pump_running": False})
            self.assertIsNone(session.scalar(select(TelemetryMessage.id).where(TelemetryMessage.device_id == self.devices[0])))
        self.request(f"/devices/{self.devices[0]}/capabilities/{ids['pressure.read']}", who="owner", method="PATCH", body={"is_enabled": True})
        self.assertEqual([m["code"] for m in self.request(self.overview)["modules"]], ["pressure.read"])

    def test_assigned_state_module_without_telemetry_exposes_missing_readings(self):
        self.assign("vfd.state.read")
        result = self.request(self.overview)
        self.assertTrue(result["modules"][0]["supported"])
        self.assertIsNone(result["snapshot"])
        self.assertEqual(result["readings"], [])
        self.assertEqual(len(result["state_readings"]), 4)
        for reading in result["state_readings"]:
            self.assertEqual((reading["value"], reading["status"]), (None, "missing"))

    def test_state_readings_preserve_quality_and_do_not_mutate_historical_state(self):
        self.assign("vfd.state.read")
        raw = {"pump_running": False, "vfd_fault_code": 0, "local_mode": "false", "emergency_stop": None}
        self.store_snapshot(seen_at=self.now, received_at=self.now-timedelta(hours=1), state=raw)
        result = self.request(self.overview)
        self.assertTrue(result["availability"]["online"])
        readings = {item["key"]: item for item in result["state_readings"]}
        self.assertIs(readings["pump_running"]["value"], False)
        self.assertEqual(readings["pump_running"]["status"], "stale")
        self.assertIs(type(readings["vfd_fault_code"]["value"]), int)
        self.assertEqual(readings["vfd_fault_code"]["status"], "stale")
        self.assertEqual((readings["local_mode"]["value"], readings["local_mode"]["status"]), (None, "invalid"))
        self.assertEqual((readings["emergency_stop"]["value"], readings["emergency_stop"]["status"]), (None, "missing"))
        with SessionLocal() as session:
            self.assertEqual(session.get(DeviceState, self.devices[0]).state, raw)
            session.get(DeviceState, self.devices[0]).last_received_at = self.now
            session.get(Device, self.devices[0]).last_observed_session_id = uuid.uuid4()
            session.commit()
        result = self.request(self.overview)
        self.assertEqual(result["telemetry_freshness"]["reason"], "session_changed")
        self.assertEqual(next(item for item in result["state_readings"] if item["key"] == "pump_running")["status"], "stale")
        with SessionLocal() as session:
            session.execute(text('UPDATE device_states SET state = CAST(:state AS jsonb) WHERE device_id = :id'),
                {"state": '{"vfd_fault_code": 1e1000}', "id": self.devices[0]})
            session.commit()
        result = self.request(self.overview)
        # PostgreSQL JSONB нормалізує 1e1000 у точне ціле; raw snapshot сумісний.
        self.assertEqual(result["snapshot"]["state"]["vfd_fault_code"], 10**1000)
        fault = next(item for item in result["state_readings"] if item["key"] == "vfd_fault_code")
        self.assertEqual((fault["value"], fault["status"]), (None, "invalid"))
        with SessionLocal() as session:
            self.assertEqual(session.get(DeviceState, self.devices[0]).state["vfd_fault_code"], 10**1000)
