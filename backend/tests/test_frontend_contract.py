"""Перевірки OpenAPI та відмови без JWT не потребують PostgreSQL."""

import unittest
import uuid

from app.main import app
from app.tools.alarm_ack_http_check import _request


class FrontendContractTests(unittest.TestCase):
    def test_new_routes_require_valid_bearer(self):
        for path in (
            f"/api/v1/organizations/{uuid.uuid4()}/access",
            f"/api/v1/devices/{uuid.uuid4()}/overview",
        ):
            for token in (None, "invalid-token"):
                with self.subTest(path=path, token=token):
                    code, result = _request("GET", path, token)
                    self.assertEqual(code, 401)
                    self.assertIsInstance(result["detail"], str)

    def test_openapi_describes_nullable_snapshot_and_access_errors(self):
        spec = app.openapi()
        for path, schema in (
            ("/api/v1/organizations/{organization_id}/access", "OrganizationAccessRead"),
            ("/api/v1/devices/{device_id}/overview", "DeviceOverviewRead"),
        ):
            route = spec["paths"][path]["get"]
            self.assertEqual(route["security"], [{"HTTPBearer": []}])
            self.assertEqual(route["parameters"][0]["schema"]["format"], "uuid")
            for status in ("200", "401", "403", "404", "422"):
                self.assertIn(status, route["responses"])
            self.assertEqual(route["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
                             f"#/components/schemas/{schema}")
        overview = spec["components"]["schemas"]["DeviceOverviewRead"]
        self.assertIn({"type": "null"}, overview["properties"]["snapshot"]["anyOf"])
        self.assertIn("snapshot", overview["required"])
        self.assertEqual(spec["info"]["version"], _request("GET", "/health")[1]["version"])
