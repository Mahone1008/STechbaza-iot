import { expect, test, type Page, type Route } from "@playwright/test";
import {
  API_ORIGIN,
  ORGANIZATION_ID,
  SESSION_ID,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
  mockBrowserLoginSuccess,
  mockIdentity,
  mockMissingBrowserSession,
} from "./auth-fixtures";

const email = "buyer@example.com";
const password = "personal-browser-password-2026";
const token = "f".repeat(32) + "." + "k".repeat(43);
const recovery = "r".repeat(43);

async function route(page: Page, path: string, action: (route: Route) => Promise<void>) {
  await page.route(`${API_ORIGIN}/api/v1/${path}`, async (request) => {
    if (!(await fulfillPreflight(request))) await action(request);
  });
}
async function privateState(page: Page, ...values: string[]) {
  const state = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  for (const value of values) {
    expect(state).not.toContain(value);
    expect(page.url()).not.toContain(value);
  }
}

test("verified registration saves recovery and resumes the QR without mandatory MFA", async ({ page }) => {
  const controller = "017ca46d-342c-4ab6-bd1c-89a602021951";
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMissingBrowserSession(page);
  await route(page, "auth/registration/inspect", async (request) => {
    expect(request.request().postDataJSON()).toEqual({ token });
    await fulfillJson(request, 200, { email });
  });
  let posts = 0;
  await route(page, "auth/registration/complete", async (request) => {
    posts++;
    expect(request.request().postDataJSON()).toEqual({ token, display_name: "Buyer", password });
    await fulfillJson(request, 200, { email, recovery_key: recovery, controller_id: controller });
  });
  await mockIdentity(page, { email });
  await mockBrowserLoginSuccess(page, {
    onRequest: (request) => expect(request.request().postDataJSON()).toEqual({ email, password }),
  });
  await route(page, `connect/${controller}`, (request) =>
    fulfillJson(request, 200, {
      controller_id: controller,
      hardware_model: "KERUMO V3",
      serial_number: "BROWSER-NEW",
      state: "ready",
      activation_required: true,
      permanent_login: null,
      device_id: null,
      site_id: null,
      firmware_version: null,
      last_contact_at: null,
    }),
  );
  await route(page, "connect/sites", (request) => fulfillJson(request, 200, []));
  await route(page, "connect/organizations", (request) => fulfillJson(request, 200, []));
  await route(page, "equipment/profiles", (request) => fulfillJson(request, 200, []));
  await page.goto(`/register?controller=${controller}#token=${token}`);
  await expect(page.getByLabel("Електронна пошта", { exact: true })).toHaveValue(email);
  await page.getByLabel("Ваше ім’я", { exact: true }).fill("Buyer");
  await page.getByLabel("Особистий пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторіть особистий пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Створити обліковий запис", exact: true }).click();
  await expect(page.locator(".recovery-key")).toHaveText(recovery);
  const enter = page.getByRole("button", { name: "Перейти до кабінету", exact: true });
  await expect(enter).toBeDisabled();
  await expect(page.getByText(/Двоетапний вхід необов’язковий/)).toBeVisible();
  expect(posts).toBe(1);
  await privateState(page, token, password, recovery);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: test.info().outputPath("registered-mobile.png"), fullPage: true });
  await page.getByLabel("Я зберіг дані входу та ключ відновлення", { exact: true }).check();
  await enter.click();
  await expect(page).toHaveURL(`/connect/${controller}`);
  await expect(page.getByLabel("Назва об’єкта", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Пароль активації з етикетки", { exact: true })).toBeVisible();
  await privateState(page, token, password, recovery);
});

test("a cancelled or expired email link never offers password setup", async ({ page }) => {
  await mockMissingBrowserSession(page);
  await route(page, "auth/registration/inspect", (request) =>
    fulfillJson(request, 404, { detail: "Посилання недійсне або вже використане" }),
  );
  await page.goto(`/register#token=${token}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Посилання недійсне");
  await expect(page.getByLabel("Особистий пароль", { exact: true })).toHaveCount(0);
  await privateState(page, token);
});

test("invitation uses the exact personal account and shows its role before acceptance", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { email });
  await route(page, "invitations/inspect", (request) =>
    fulfillJson(request, 200, { email, role: "operator", organization_name: "Customer" }),
  );
  let accepted = 0;
  await route(page, "invitations/accept", async (request) => {
    accepted++;
    expect(request.request().postDataJSON()).toEqual({ token });
    await fulfillJson(request, 200, { organization_id: ORGANIZATION_ID });
  });
  await page.goto(`/invite#token=${token}`);
  await expect(page.getByText(`Запрошення для ${email}. Роль: Оператор.`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Прийняти запрошення", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Запрошення прийнято");
  expect(accepted).toBe(1);
  await privateState(page, token);
});

test("organization owner can invite and revoke, and a viewer cannot open member controls", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let invites: unknown[] = [];
  await route(page, `organizations/${ORGANIZATION_ID}/memberships`, (request) => fulfillJson(request, 200, []));
  await route(page, `organizations/${ORGANIZATION_ID}/invitations`, async (request) => {
    if (request.request().method() === "POST") {
      expect(request.request().postDataJSON()).toEqual({ email, role: "operator" });
      const invitation = {
        id: SESSION_ID,
        email,
        role: "operator",
        site_ids: null,
        access_expires_at: null,
        expires_at: "2027-01-01T00:00:00Z",
        used_at: null,
        revoked_at: null,
      };
      invites = [invitation];
      await fulfillJson(request, 201, invitation);
    } else await fulfillJson(request, 200, invites);
  });
  await route(page, `organizations/${ORGANIZATION_ID}/invitations/${SESSION_ID}`, async (request) => {
    expect(request.request().method()).toBe("DELETE");
    invites = [];
    await fulfillJson(request, 204, null);
  });
  await page.goto(`/organizations/${ORGANIZATION_ID}/members`);
  await page.getByLabel("Пошта учасника", { exact: true }).fill(email);
  await page.getByLabel("Права запрошеного учасника", { exact: true }).selectOption("operator");
  await page.getByRole("button", { name: "Надіслати запрошення", exact: true }).click();
  await expect(page.getByText(/Запрошення надіслано/)).toBeVisible();
  await page.getByRole("button", { name: "Скасувати запрошення", exact: true }).click();
  await expect(page.getByText("Немає активних запрошень.", { exact: true })).toBeVisible();
  await mockAuthenticatedWorkspace(page, { role: "viewer", email: "viewer@example.com" });
  await page.reload();
  await expect(page.getByRole("button", { name: "Надіслати запрошення", exact: true })).toHaveCount(0);
});

test("customer can disable voluntary MFA with a password and fresh code", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let enabled = true;
  await route(page, "auth/security", (request) =>
    fulfillJson(request, 200, {
      mfa_enabled: enabled,
      privileged_mfa_required: false,
      current_session_verified: enabled,
      recovery_available: true,
    }),
  );
  await route(page, "auth/sessions", (request) =>
    fulfillJson(request, 200, [
      {
        id: SESSION_ID,
        current: true,
        created_at: "2026-10-05T12:00:00Z",
        expires_at: "2027-01-01T00:00:00Z",
        last_used_at: null,
      },
    ]),
  );
  await route(page, "auth/security/totp/disable", async (request) => {
    expect(request.request().postDataJSON()).toEqual({ password, otp: "987654" });
    enabled = false;
    await fulfillJson(request, 204, null);
  });
  await page.goto("/account/security");
  await page.getByRole("button", { name: "Вимкнути двоетапний вхід", exact: true }).click();
  await page.getByLabel("Поточний пароль для вимкнення двоетапного входу", { exact: true }).fill(password);
  await page.getByLabel("Код із застосунку для вимкнення двоетапного входу", { exact: true }).fill("987654");
  await page.getByRole("button", { name: "Підтвердити й вимкнути", exact: true }).click();
  await expect(page.getByText("Двоетапний вхід вимкнено", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Код із застосунку для вимкнення двоетапного входу", { exact: true })).toHaveCount(0);
  await privateState(page, password, "987654");
});

test("platform administrator sees mandatory MFA without a disable control", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { platformRole: "superadmin" });
  await route(page, "auth/security", (request) =>
    fulfillJson(request, 200, {
      mfa_enabled: true,
      privileged_mfa_required: true,
      current_session_verified: true,
      recovery_available: true,
    }),
  );
  await route(page, "auth/sessions", (request) => fulfillJson(request, 200, []));
  await page.goto("/account/security");
  await expect(page.getByText("Для адміністратора платформи цей захист обов’язковий.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Вимкнути двоетапний вхід", exact: true })).toHaveCount(0);
});
