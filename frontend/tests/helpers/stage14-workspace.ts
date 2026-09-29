import type { BrowserContext, Page } from "@playwright/test";
import { alarmFixture, acknowledgedFixture, transitionFixture } from "../fixtures/alarms";
import { notificationFixture } from "../fixtures/notifications";
import { overviewFixture } from "../fixtures/overview";
import {
  API_ORIGIN, ORGANIZATION_ID, SITE_ID, DEVICE_ID, ORGANIZATIONS_URL, REFRESH_URL,
  accessPayload, availabilityPayload, devicePayload, fulfillJson, fulfillPreflight,
  mockAuthenticatedWorkspace, mockBrowserLoginSuccess, mockBrowserLogoutSuccess,
  organizationPayload, sitePayload, tokenPayload, ownerPermissions, viewerPermissions,
} from "../browser/auth-fixtures";

export const tenants = [
  { organization: ORGANIZATION_ID, site: SITE_ID, device: DEVICE_ID, name: "DEMO: клієнт A", suffix: "A",
    alarm: "e8f2f2d6-e380-492a-a9dc-d0b9ba792136", notification: "18f2f2d6-e380-492a-a9dc-d0b9ba792136" },
  { organization: "0115f25c-ed62-42cc-95bc-a1b4b3669755", site: "d9c4f8a6-f57d-43e2-a2e3-f10669e4a39c", device: "b8f2f2d6-e380-492a-a9dc-d0b9ba792136", name: "DEMO: клієнт B", suffix: "B",
    alarm: "c8f2f2d6-e380-492a-a9dc-d0b9ba792136", notification: "28f2f2d6-e380-492a-a9dc-d0b9ba792136" },
] as const;
export const feedPath = (index = 0) => `/organizations/${tenants[index]!.organization}/notifications`;
export const notificationPath = (index = 0) => `${feedPath(index)}/${tenants[index]!.notification}`;
export const alarmPath = (index = 0) => `/alarms/devices/${tenants[index]!.device}/${tenants[index]!.alarm}`;

// Два незалежні tenant-набори в одному browser context: сценарії перевіряють UI,
// а серверну авторизацію додатково перевіряє окремий live suite.
export async function stage14Workspace(target: Page | BrowserContext, role: "owner" | "viewer" = "owner", loginRequired = false) {
  let signedIn = !loginRequired;
  const writes = { reads: [0, 0], acknowledgements: [0, 0], commands: 0, logouts: 0 };
  await mockAuthenticatedWorkspace(target, { role, memberships: tenants.map((t) => ({ organization_id: t.organization, role })) });
  await mockBrowserLoginSuccess(target, { onRequest: () => { signedIn = true; } });
  await mockBrowserLogoutSuccess(target, () => { signedIn = false; writes.logouts++; });
  await target.route(REFRESH_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, signedIn ? 200 : 401, signedIn ? tokenPayload("r") : { detail: "Session ended" });
  });
  const get = async (path: string, read: () => unknown) => target.route(`${API_ORIGIN}/api/v1/${path}`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, signedIn ? 200 : 401, signedIn ? read() : { detail: "Session ended" });
  });
  const organizations = tenants.map((t) => ({ ...organizationPayload(), id: t.organization, name: t.name }));
  await target.route(`${ORGANIZATIONS_URL}?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, organizations);
  });
  for (const [index, t] of tenants.entries()) {
    const site = { ...sitePayload(), id: t.site, organization_id: t.organization, name: `Об’єкт ${t.suffix}` };
    const device = { ...devicePayload(), id: t.device, site_id: t.site, name: `Насос ${t.suffix}`, uid: `TB-TEST-${t.suffix}` };
    const access = { ...accessPayload({ role }), organization_id: t.organization };
    let incident = alarmFixture({ id: t.alarm, device_id: t.device, title: `Тиск ${t.suffix}` });
    let notification = notificationFixture({ id: t.notification, organization_id: t.organization, device_id: t.device, alarm_id: t.alarm, title: `Повідомлення ${t.suffix}` });
    await get(`organizations/${t.organization}`, () => organizations[index]);
    await get(`organizations/${t.organization}/access`, () => access);
    await get(`organizations/${t.organization}/sites?*`, () => [site]);
    await get(`sites/${t.site}`, () => site);
    await get(`sites/${t.site}/devices?*`, () => [device]);
    await get(`devices/${t.device}`, () => device);
    await get(`devices/${t.device}/availability`, () => availabilityPayload(device));
    await get(`devices/${t.device}/overview`, () => {
      const overview = overviewFixture(device);
      overview.access = { organization_id: t.organization, platform_role: "user", organization_role: role,
        permissions: [...(role === "owner" ? ownerPermissions : viewerPermissions)] };
      if (role === "owner") {
        overview.allowed_commands = [...overview.command_types];
        overview.modules[3]!.allowed_commands = [...overview.command_types];
      }
      return overview;
    });
    await get(`devices/${t.device}/alarms?*`, () => [incident]);
    await get(`alarms/${t.alarm}`, () => incident);
    await get(`alarms/${t.alarm}/transitions?*`, () => [transitionFixture({ alarm_id: t.alarm })]);
    await target.route(`${API_ORIGIN}/api/v1/alarms/${t.alarm}/acknowledge`, async (route) => {
      if (await fulfillPreflight(route)) return;
      writes.acknowledgements[index] = (writes.acknowledgements[index] ?? 0) + 1;
      if (role === "viewer") { await fulfillJson(route, 403, { detail: "Denied" }); return; }
      incident = acknowledgedFixture({ id: t.alarm, device_id: t.device, title: `Тиск ${t.suffix}` });
      await fulfillJson(route, 200, incident);
    });
    await get(`notifications/${t.notification}`, () => notification);
    await get(`organizations/${t.organization}/notifications/unread-count`, () => ({ unread_count: notification.read_at ? 0 : 1 }));
    await target.route(`${API_ORIGIN}/api/v1/organizations/${t.organization}/notifications?*`, async (route) => {
      if (await fulfillPreflight(route)) return;
      const unread = new URL(route.request().url()).searchParams.get("unread_only") === "true";
      await fulfillJson(route, 200, unread && notification.read_at ? [] : [notification]);
    });
    await target.route(`${API_ORIGIN}/api/v1/notifications/${t.notification}/read`, async (route) => {
      if (await fulfillPreflight(route)) return;
      writes.reads[index] = (writes.reads[index] ?? 0) + 1;
      notification = { ...notification, read_at: notification.read_at ?? "2026-09-28T12:01:00Z" };
      await fulfillJson(route, 200, { notification_id: t.notification, read_at: notification.read_at });
    });
    await target.route(`${API_ORIGIN}/api/v1/devices/${t.device}/commands`, async (route) => {
      if (await fulfillPreflight(route)) return;
      writes.commands++;
      await fulfillJson(route, 403, { detail: "No equipment writes in this UI journey" });
    });
  }
  return writes;
}
