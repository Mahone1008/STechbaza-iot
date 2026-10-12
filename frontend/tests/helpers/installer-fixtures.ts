import type { Page, Route } from "@playwright/test";
import { expect } from "@playwright/test";
import type { components } from "../../src/lib/api/schema";
import { overviewFixture } from "../fixtures/overview";
import {
  accessPayload,
  currentUserPayload,
  devicePayload,
  organizationPayload,
  sitePayload,
  tokenPayload,
  DEVICE_ID,
  ORGANIZATION_ID,
  SITE_ID,
} from "../browser/auth-fixtures";

export { DEVICE_ID } from "../browser/auth-fixtures";
export const API_ORIGIN = "http://127.0.0.1:8002";
export const controllerId = "11111111-1111-4111-8111-111111111111";
export const installationId = "22222222-2222-4222-8222-222222222222";
export const moduleId = "33333333-3333-4333-8333-333333333333";
type Schema = components["schemas"];
export const profile: Schema["ProfileRead"] = {
  id: "suswe.su600.modbus",
  version: 1,
  profile_hash: "a".repeat(64),
  manufacturer: "SUSWE",
  series: "SU600",
  parameter_family: "F",
  support: "bench_limited",
  driver_id: "suswe.su600",
  driver_version: 1,
  command_protocol: 3,
  tested_model: "SU600A-5RG1-B",
  manual: "manual",
  manual_sha256: "b".repeat(64),
  manual_pages: [1],
  notes: [],
};
export const installed: Schema["ModuleRead"] = {
  id: moduleId,
  device_id: DEVICE_ID,
  installation_id: installationId,
  slot: "vfd-1",
  kind: "vfd",
  name: "Частотний перетворювач",
  manufacturer: "SUSWE",
  series: "SU600",
  model: "SU600A-5RG1-B",
  serial_number: "OLD-DRIVE",
  hardware_revision: null,
  software_revision: null,
  motor: null,
  retired_at: null,
};
export function passport(): Schema["EquipmentPassport"] {
  return {
    device_id: DEVICE_ID,
    controller_uid: devicePayload().uid,
    controller_id: controllerId,
    firmware_version: "0.12.0",
    installations: [{ id: installationId, site_id: SITE_ID, name: "Насосна установка" }],
    modules: [installed],
    desired: null,
    reported: null,
    configuration_state: "legacy",
    can_install: true,
    firmware_control_capability: "full",
    commissioned_control_mode: null,
    readiness: { state: "needs_equipment", title: "Обладнання готує сервіс", next_action: null, blockers: [] },
  };
}
const corsHeaders = {
  "access-control-allow-origin": "http://127.0.0.1:3001",
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-techbaza-csrf",
};
export async function fulfillStaffPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== "OPTIONS") return false;
  await route.fulfill({ status: 204, headers: corsHeaders });
  return true;
}
export async function fulfillStaffJson(route: Route, status: number, json: unknown) {
  await route.fulfill({ status, headers: corsHeaders, contentType: "application/json", body: JSON.stringify(json) });
}
export async function setup(page: Page) {
  const identity = { platformRole: "service_admin" as const, role: "service" as const };
  const overview = overviewFixture(devicePayload());
  overview.access.platform_role = identity.platformRole;
  overview.access.organization_role = identity.role;
  await page.route(`${API_ORIGIN}/api/v1/**`, async (route) => {
    if (await fulfillStaffPreflight(route)) return;
    const path = new URL(route.request().url()).pathname;
    const send = (body: unknown) => fulfillStaffJson(route, 200, body);
    if (path.endsWith("/auth/browser/refresh")) return send(tokenPayload("staff-maintenance"));
    if (path.endsWith("/auth/me")) return send(currentUserPayload(identity));
    if (path.endsWith("/auth/security"))
      return send({
        mfa_enabled: true,
        privileged_mfa_required: true,
        current_session_verified: true,
        recovery_available: true,
      });
    if (path === `/api/v1/devices/${DEVICE_ID}`) return send(devicePayload());
    if (path === `/api/v1/sites/${SITE_ID}`) return send(sitePayload());
    if (path === `/api/v1/organizations/${ORGANIZATION_ID}`) return send(organizationPayload());
    if (path.endsWith("/access")) return send(accessPayload(identity));
    if (path.endsWith("/overview")) return send(overview);
    if (path === `/api/v1/devices/${DEVICE_ID}/equipment`) return send(passport());
    if (path === "/api/v1/equipment/profiles") return send([profile]);
    return send([]);
  });
  await page.goto(`/devices/${DEVICE_ID}?view=equipment`);
  await expect(page.getByText("SUSWE SU600", { exact: true })).toBeVisible();
}
