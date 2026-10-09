import { expect, test } from "@playwright/test";
import { settingsOverview } from "../fixtures/vfd-settings";
import { commandFixture } from "../fixtures/commands";
import {
  currentUserPayload,
  organizationPayload,
  accessPayload,
  sitePayload,
  devicePayload,
  tokenPayload,
  DEVICE_ID,
  ORGANIZATION_ID,
  SITE_ID,
} from "../browser/auth-fixtures";
import type { CommandInput } from "../../src/lib/api/commands";

for (const role of ["service_admin", "superadmin"] as const) {
  test(`SU600 F editor works on the separate staff site for ${role}`, async ({ page }) => {
    const posts: CommandInput[] = [];
    const identity = { platformRole: role, role: "service" as const };
    const overview = settingsOverview();
    overview.access.platform_role = role;
    overview.access.organization_role = "service";
    overview.allowed_commands.push("vfd.parameter.set");
    overview.modules[3]!.allowed_commands.push("vfd.parameter.set");
    const response = () =>
      commandFixture({ ...posts[0], actor_platform_role: role, actor_organization_role: "service" });
    await page.route("http://127.0.0.1:8002/api/v1/**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      const headers = {
        "access-control-allow-origin": "http://127.0.0.1:3001",
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, x-techbaza-csrf",
      };
      const send = (body: unknown, status = 200) =>
        route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(body) });
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (path.endsWith("/auth/browser/refresh")) return send(tokenPayload("staff-vfd"));
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
      if (path.endsWith("/equipment"))
        return send({
          device_id: DEVICE_ID,
          controller_uid: devicePayload().uid,
          firmware_version: "0.10.0",
          installations: [],
          modules: [],
          desired: null,
          reported: null,
          configuration_state: "legacy",
        });
      if (path.endsWith("/commands") && request.method() === "POST") {
        posts.push(request.postDataJSON());
        return send(response(), 201);
      }
      if (path.includes("/commands/by-request/") || (path.startsWith("/api/v1/commands/") && posts.length))
        return send(response());
      return send([]);
    });
    await page.goto(`/devices/${DEVICE_ID}`);
    await page.getByRole("tab", { name: "Обладнання", exact: true }).click();
    await page.getByLabel("Час гальмування, с", { exact: true }).fill("12");
    await page.getByRole("button", { name: "Застосувати F0.11", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("7.5 с → 12 с");
    await page.getByRole("dialog").getByRole("button", { name: "Підтвердити зміну", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({
      command_type: "vfd.parameter.set",
      payload: { code: "F0.11", expected_raw: 75, value_raw: 120 },
    });
  });
}
