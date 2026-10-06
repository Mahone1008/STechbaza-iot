import { expect, test, type Page } from "@playwright/test";

const adminId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const orgId = "00000000-0000-4000-8000-000000000003";
const siteId = "00000000-0000-4000-8000-000000000004";
const stamp = "2026-10-06T08:00:00Z";
async function setup(page: Page, service = false) {
  const mutations: { path: string; body: Record<string, unknown> }[] = [];
  let loggedIn = false;
  const profile = {
    id: adminId,
    email: service ? "service@example.com" : "administrator@example.com",
    login_name: null,
    display_name: service ? "Сервісний спеціаліст" : "Адміністратор платформи",
    platform_role: service ? "service_admin" : "superadmin",
    is_active: true,
    auth_session_id: userId,
    auth_session_expires_at: "2030-10-06T08:00:00Z",
    memberships: [],
  };
  const user = {
    id: userId,
    email: "customer@example.com",
    login_name: null,
    display_name: "Клієнт платформи",
    platform_role: "user",
    is_active: true,
    email_verified: true,
    mfa_enabled: true,
    active_sessions: 2,
    last_login_at: stamp,
    updated_at: stamp,
  };
  const org = {
    id: orgId,
    name: "Північне господарство",
    slug: "north-farm",
    is_active: true,
    created_at: stamp,
    updated_at: stamp,
  };
  const site = {
    id: siteId,
    organization_id: orgId,
    name: "Насосна станція",
    code: "pump-site",
    timezone: "Europe/Kyiv",
    created_at: stamp,
    updated_at: stamp,
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const send = (json: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
    if (path.endsWith("/browser/refresh"))
      return send(
        loggedIn
          ? {
              access_token: "private-staff-access-token",
              token_type: "bearer",
              expires_in: 900,
              session_expires_in: 3600,
            }
          : { detail: "No session" },
        loggedIn ? 200 : 401,
      );
    if (path.endsWith("/browser/login")) {
      loggedIn = true;
      return send({
        access_token: "private-staff-access-token",
        token_type: "bearer",
        expires_in: 900,
        session_expires_in: 3600,
        onboarding_path: null,
      });
    }
    if (path.endsWith("/browser/logout")) {
      loggedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (request.method() !== "GET") {
      mutations.push({ path, body: request.postDataJSON() as Record<string, unknown> });
      if (path === `/api/v1/staff/users/${userId}`) {
        const body = request.postDataJSON() as typeof user;
        Object.assign(user, {
          platform_role: body.platform_role,
          display_name: body.display_name,
          is_active: body.is_active,
        });
        return send(user);
      }
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/auth/me")) return send(profile);
    if (path.endsWith("/auth/security"))
      return send({
        mfa_enabled: true,
        privileged_mfa_required: true,
        current_session_verified: true,
        recovery_available: true,
      });
    if (path.endsWith("/auth/sessions")) return send([]);
    if (path === "/api/v1/organizations") return send([org]);
    if (path === `/api/v1/organizations/${orgId}`) return send(org);
    if (path.endsWith("/access"))
      return send({
        organization_id: orgId,
        user_id: adminId,
        platform_role: profile.platform_role,
        organization_role: service ? "service" : null,
        permissions: [
          "organization.read",
          "site.read",
          "device.read",
          "telemetry.read",
          "capability.read",
          "command.read",
          "alarm.read",
          "event.read",
          "notification.read",
        ],
      });
    if (path.endsWith("/sites")) return send([site]);
    if (path.endsWith("/memberships"))
      return send([
        {
          id: userId,
          organization_id: orgId,
          user_id: userId,
          user_email: user.email,
          user_display_name: user.display_name,
          role: "service",
          is_active: true,
          site_ids: null,
          expires_at: null,
          created_at: stamp,
          updated_at: stamp,
        },
      ]);
    if (path.endsWith("/invitations")) return send([]);
    if (path.endsWith("/staff/overview"))
      return send({
        organizations: 1,
        sites: 1,
        devices: 2,
        offline_devices: 1,
        active_alarms: 0,
        users: service ? null : 8,
        login_failures_24h: service ? null : 2,
      });
    if (path.endsWith("/staff/users")) return send([user]);
    if (path.endsWith("/staff/devices"))
      return send([
        {
          id: userId,
          uid: "KERUMO-001",
          name: "Контролер насосної",
          site_id: siteId,
          site_name: site.name,
          organization_id: orgId,
          organization_name: org.name,
          lifecycle_status: "active",
          last_seen_at: stamp,
          online: true,
        },
      ]);
    if (path.endsWith("/staff/audit"))
      return send([
        {
          id: userId,
          occurred_at: stamp,
          actor_user_id: adminId,
          actor_email: profile.email,
          action: "user.updated",
          resource_type: "user",
          resource_id: userId,
          request_id: adminId,
          client_ip: "100.64.0.10",
          status: 200,
          details: { reason: "Оновлено сервісний доступ" },
        },
      ]);
    if (path.endsWith("/staff/monitoring"))
      return send({
        database: { available: true, size_bytes: 1048576, connections: 4 },
        container: {
          disk_free_bytes: 1048576,
          disk_total_bytes: 2048576,
          memory_bytes: 52428800,
          memory_limit_bytes: 100000000,
          uptime_seconds: 600,
        },
        worker: {
          available: true,
          mqtt: { connected: true },
          uptime_seconds: 600,
          http: { requests: 120, errors: 2, received_bytes: 102400, sent_bytes: 1048576 },
        },
      });
    return send([]);
  });
  return mutations;
}
async function login(page: Page, service = false) {
  await page.goto("/login");
  await page.getByLabel("Логін", { exact: true }).fill(service ? "service@example.com" : "administrator@example.com");
  await page.getByLabel("Пароль", { exact: true }).fill("browser-test-only-password");
  await page.getByRole("button", { name: "Увійти", exact: true }).click();
  await expect(page).toHaveURL(/\/operations$/u);
  await expect(page.getByRole("heading", { name: "Огляд", exact: true })).toBeVisible();
}
async function proof(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Причина зміни").fill("Зміна доступу для перевірки");
  await dialog.getByLabel("Ваш поточний пароль").fill("browser-test-only-password");
  await dialog.getByLabel("Свіжий код із вашого застосунку").fill("123456");
}

test("admin lands on overview, changes a role with explicit proof and sees a human audit", async ({ page }) => {
  const mutations = await setup(page);
  await login(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "admin");
  await page.getByRole("navigation").getByRole("link", { name: "Користувачі", exact: true }).click();
  await page.getByRole("button", { name: "Змінити", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Роль на платформі").selectOption("service_admin");
  await proof(page);
  await page.getByRole("dialog").getByRole("button", { name: "Підтвердити", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(mutations[0]?.body.platform_role).toBe("service_admin");
  expect(mutations[0]?.body.proof).toEqual({ password: "browser-test-only-password", otp: "123456" });
  await page.getByRole("navigation").getByRole("link", { name: "Журнал дій", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Журнал платформи: прокручувана таблиця" })
      .getByText("Змінено обліковий запис", { exact: true }),
  ).toBeVisible();
});

test("MFA reset explains that the password is retained and requires confirmation", async ({ page }) => {
  const mutations = await setup(page);
  await login(page);
  await page.getByRole("navigation").getByRole("link", { name: "Користувачі", exact: true }).click();
  await page.getByRole("button", { name: "Скинути захист", exact: true }).click();
  await expect(page.getByRole("dialog").getByText(/Пароль customer@example.com залишиться чинним/u)).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Підтвердити", exact: true })).toBeDisabled();
  await proof(page);
  await page.getByRole("dialog").getByRole("button", { name: "Підтвердити", exact: true }).click();
  await expect.poll(() => mutations.length).toBe(1);
  expect(mutations[0]?.path).toMatch(/security-reset$/u);
  expect(mutations[0]?.body.include_recovery).toBe(false);
});

test("empty limited object selection cannot silently grant organization-wide access", async ({ page }) => {
  await setup(page);
  await login(page);
  await page.getByRole("navigation").getByRole("link", { name: "Організації", exact: true }).click();
  await page.getByRole("button", { name: "Відкрити", exact: true }).click();
  await page.getByRole("button", { name: "Змінити доступ", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Обмежити доступ вибраними об’єктами").check();
  await proof(page);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Підтвердити", exact: true })).toBeDisabled();
  await page.getByRole("dialog").getByLabel("Насосна станція", { exact: true }).check();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Підтвердити", exact: true })).toBeEnabled();
});

test("service has the blue theme and no global management menus", async ({ page }) => {
  await setup(page, true);
  await login(page, true);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "service");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Користувачі", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation").getByRole("link", { name: "Виробництво", exact: true })).toHaveCount(0);
  await page.goto("/operations?section=people");
  await expect(page.getByRole("heading", { name: "Огляд", exact: true })).toBeVisible();
  await page.goto("/register");
  await expect(page.getByText("Сторінку не знайдено", { exact: true })).toBeVisible();
});

test("mobile staff navigation, logout and tables stay inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page);
  await login(page);
  await expect(page.locator(".staff-topbar").getByRole("button", { name: "Вийти", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("navigation").getByRole("link", { name: "Користувачі", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Користувачі", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
