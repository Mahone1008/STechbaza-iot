import { expect, test, type Page } from "@playwright/test";
import { currentUserPayload, tokenPayload, ORGANIZATION_ID } from "../browser/auth-fixtures";

const token = "f".repeat(32) + "." + "k".repeat(43);
const email = "installer@example.com";
const password = "staff-invitation-fixture-password";
const otp = "123456";

async function setup(page: Page, { authenticated = false, inspectStatus = 200 } = {}) {
  let loggedIn = authenticated;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
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
    if (path.endsWith("/auth/browser/refresh"))
      return send(loggedIn ? tokenPayload("staffinvite") : { detail: "No session" }, loggedIn ? 200 : 401);
    if (path.endsWith("/auth/browser/login")) {
      writes.push({ path, body: request.postDataJSON() });
      expect(request.postDataJSON()).toEqual({ email, password, otp });
      loggedIn = true;
      return send({ ...tokenPayload("staffinvite"), onboarding_path: null });
    }
    if (path.endsWith("/auth/me"))
      return send(currentUserPayload({ email, platformRole: "service_admin", role: "service" }));
    if (path.endsWith("/auth/security"))
      return send({
        mfa_enabled: true,
        privileged_mfa_required: true,
        current_session_verified: true,
        recovery_available: true,
      });
    if (path.endsWith("/invitations/inspect")) {
      writes.push({ path, body: request.postDataJSON() });
      expect(loggedIn).toBe(true);
      expect(request.headers()["authorization"]).toMatch(/^Bearer /u);
      expect(request.postDataJSON()).toEqual({ token });
      return send(
        inspectStatus === 200
          ? {
              email,
              organization_name: "Замовник монтажу",
              role: "service",
              site_names: ["Свердловина біля будинку"],
              access_expires_at: "2027-01-01T00:00:00Z",
            }
          : { detail: "Запрошення недоступне або адреса не збігається" },
        inspectStatus,
      );
    }
    if (path.endsWith("/invitations/accept")) {
      writes.push({ path, body: request.postDataJSON() });
      expect(loggedIn).toBe(true);
      expect(inspectStatus).toBe(200);
      expect(request.postDataJSON()).toEqual({ token });
      return send({ organization_id: ORGANIZATION_ID });
    }
    return send([]);
  });
  return writes;
}

async function expectPrivateToken(page: Page) {
  const stored = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  for (const secret of [token, password]) {
    expect(stored).not.toContain(secret);
    expect(page.url()).not.toContain(secret);
  }
}

test("staff invitation stays in memory through login and MFA and grants only the inspected access", async ({
  page,
}) => {
  const writes = await setup(page);
  await page.goto(`/invite#token=${token}`);
  await expect(page.getByRole("heading", { name: "Запрошення для монтажника", exact: true })).toBeVisible();
  await expect(page.getByLabel("Електронна пошта", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Створити обліковий запис", exact: true })).toHaveCount(0);
  expect(writes.filter((item) => item.path.endsWith("/invitations/inspect"))).toHaveLength(0);
  await page.getByLabel("Електронна пошта", { exact: true }).fill(email);
  await page.getByLabel("Особистий пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Увійти", exact: true }).click();
  expect(writes.filter((item) => item.path.endsWith("/auth/browser/login"))).toHaveLength(0);
  await page.getByLabel("Код двоетапного входу", { exact: true }).fill(otp);
  await page.getByRole("button", { name: "Увійти", exact: true }).click();
  await expect(page).toHaveURL(/\/invite$/u);
  await expect(page.getByText("Об’єкти: Свердловина біля будинку.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Прийняти запрошення", exact: true }).click();
  await expect(page.getByText("Запрошення прийнято. Ваш доступ: Сервісний спеціаліст.", { exact: true })).toBeVisible();
  await expectPrivateToken(page);
  expect(writes.filter((item) => item.path.endsWith("/invitations/accept"))).toHaveLength(1);
  expect(writes.some((item) => item.path.includes("registration") || "platform_role" in item.body)).toBe(false);
  await expect(page.getByRole("link", { name: "До обладнання", exact: true })).toHaveAttribute(
    "href",
    "/operations?section=devices",
  );
  for (const path of ["/register", "/connect"]) {
    await page.goto(path);
    await expect(page.getByText("Сторінку не знайдено", { exact: true })).toBeVisible();
  }
});

test("malformed staff invitation never requests inspection, registration or access", async ({ page }) => {
  const writes = await setup(page);
  await page.goto("/invite#token=invalid-token");
  await expect(
    page.getByText("Посилання недійсне. Попросіть власника надіслати нове запрошення.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Прийняти запрошення", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Електронна пошта", { exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test("expired or mismatched staff invitation cannot grant membership", async ({ page }) => {
  const writes = await setup(page, { authenticated: true, inspectStatus: 404 });
  await page.goto(`/invite#token=${token}`);
  await expect(
    page.getByRole("alert").filter({ hasText: "Запрошення недоступне або адреса не збігається" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Прийняти запрошення", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Створити обліковий запис", exact: true })).toHaveCount(0);
  expect(writes.filter((item) => item.path.endsWith("/invitations/accept"))).toHaveLength(0);
  await expectPrivateToken(page);
});
