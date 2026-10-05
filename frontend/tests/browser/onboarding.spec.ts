import { expect, test, type Page, type Route } from "@playwright/test";
import type { components } from "../../src/lib/api/schema";
import {
  API_ORIGIN,
  DEVICE_ID,
  SESSION_ID,
  SITE_ID,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
  mockMissingBrowserSession,
} from "./auth-fixtures";

type Schema = components["schemas"];
const id = "017ca46d-342c-4ab6-bd1c-89a602021951";
const recovery = "r".repeat(43),
  activation = "a".repeat(43),
  password = "browser-fixture-only-123";
const connection: Schema["ConnectionRead"] = {
  controller_id: id,
  serial_number: "BROWSER-001",
  hardware_model: "KERUMO V3",
  state: "ready",
  device_id: null,
  site_id: null,
  last_contact_at: null,
  firmware_version: null,
};
const controller: Schema["FactoryRead"] = {
  access_revoked: false,
  credential_revision: 0,
  id,
  serial_number: connection.serial_number,
  hardware_model: connection.hardware_model,
  hardware_revision: "3.1",
  batch: "test",
  status: "ready",
  generation: 1,
  distributor: null,
  claimed_at: null,
  device_id: null,
  last_contact_at: null,
};
const profile: Schema["ProfileRead"] = {
  id: "sunfar.su300",
  version: 1,
  manufacturer: "Sunfar",
  series: "SU300",
  support: "documented",
  driver_id: null,
  driver_version: null,
  command_protocol: null,
  tested_model: null,
  manual: "test manual",
  manual_pages: [1],
  manual_sha256: "a".repeat(64),
  profile_hash: "b".repeat(64),
  notes: [],
  parameter_family: "SU300",
};
async function route(page: Page, path: string, handle: (route: Route) => Promise<void>) {
  await page.route(`${API_ORIGIN}/api/v1/${path}`, async (request) => {
    if (!(await fulfillPreflight(request))) await handle(request);
  });
}
async function read(page: Page, path: string, data: () => unknown) {
  await route(page, path, (request) => fulfillJson(request, 200, data()));
}
async function noStoredSecrets(page: Page, ...secrets: string[]) {
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  for (const secret of secrets) {
    expect(stored).not.toContain(secret);
    expect(page.url()).not.toContain(secret);
  }
}

test("registration validates confirmation and reveals a one-time key before returning to QR", async ({ page }) => {
  await mockMissingBrowserSession(page);
  let posts = 0;
  await route(page, "auth/register", async (request) => {
    posts++;
    expect(request.request().postDataJSON()).toEqual({ email: "buyer@example.com", display_name: "Buyer", password });
    await fulfillJson(request, 201, { recovery_key: recovery });
  });
  const destination = encodeURIComponent(`/connect/${id}`);
  await page.goto(`/register?returnTo=${destination}`);
  await page.getByLabel("Ваше ім’я", { exact: true }).fill("Buyer");
  await page.getByLabel("Email для входу", { exact: true }).fill("buyer@example.com");
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  const confirmation = page.getByLabel("Повторіть пароль", { exact: true });
  await confirmation.fill("different-password-123");
  const submit = page.getByRole("button", { name: "Зареєструватися", exact: true });
  await submit.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Паролі мають збігатися.");
  expect(posts).toBe(0);
  await confirmation.fill(password);
  await submit.click();
  await expect(page.locator(".recovery-key")).toHaveText(recovery);
  const login = page.getByRole("link", { name: "Перейти до входу", exact: true });
  await expect(login).toHaveCount(0);
  await page.getByRole("checkbox").check();
  await expect(login).toHaveAttribute("href", `/login?returnTo=${destination}`);
  expect(posts).toBe(1);
  await noStoredSecrets(page, password, recovery);
  await page.reload();
  await expect(page.locator(".recovery-key")).toHaveCount(0);
});

test("recovery failure is not retried and explicit retry displays a replacement key", async ({ page }) => {
  await mockMissingBrowserSession(page);
  let posts = 0;
  await route(page, "auth/recover", async (request) => {
    posts++;
    expect(request.request().postDataJSON()).toEqual({
      email: "buyer@example.com",
      recovery_key: activation,
      new_password: password,
    });
    await fulfillJson(
      request,
      posts === 1 ? 503 : 200,
      posts === 1 ? { detail: "Unavailable" } : { recovery_key: recovery },
    );
  });
  await page.goto("/recover");
  await page.getByLabel("Email для входу", { exact: true }).fill("buyer@example.com");
  await page.getByLabel("Ключ відновлення", { exact: true }).fill(activation);
  await page.getByLabel("Новий пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторіть пароль", { exact: true }).fill(password);
  const submit = page.getByRole("button", { name: "Відновити доступ", exact: true });
  await submit.click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(60_000);
  expect(posts).toBe(1);
  await submit.click();
  await expect(page.locator(".recovery-key")).toHaveText(recovery);
  expect(posts).toBe(2);
  await noStoredSecrets(page, password, activation, recovery);
});

test("TOTP enrollment clears its secret, rotates recovery and revokes only the selected session", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let mfa = false,
    deleted = false;
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    other = "7d80edec-3b7f-47f2-8a4e-1106231f9ee9";
  await read(page, "auth/security", () => ({
    mfa_enabled: mfa,
    privileged_mfa_required: true,
    current_session_verified: mfa,
    recovery_available: true,
  }));
  await read(page, "auth/sessions", () =>
    (deleted ? [SESSION_ID] : [SESSION_ID, other]).map((id) => ({
      id,
      current: id === SESSION_ID,
      created_at: new Date().toISOString(),
      expires_at: "2027-01-01T00:00:00Z",
      last_used_at: null,
    })),
  );
  await route(page, "auth/security/totp/setup", async (request) => {
    expect(request.request().postDataJSON()).toEqual({ password });
    await fulfillJson(request, 200, { secret, uri: `otpauth://totp/test?secret=${secret}` });
  });
  await route(page, "auth/security/totp/confirm", async (request) => {
    expect(request.request().postDataJSON()).toEqual({ otp: "123456" });
    mfa = true;
    await fulfillJson(request, 200, {});
  });
  await route(page, "auth/security/recovery", async (request) => {
    expect(request.request().postDataJSON()).toEqual({ password, otp: "654321" });
    await fulfillJson(request, 200, { recovery_key: recovery });
  });
  await route(page, `auth/sessions/${other}`, async (request) => {
    expect(request.request().method()).toBe("DELETE");
    deleted = true;
    await fulfillJson(request, 200, {});
  });
  await page.goto("/account/security");
  const proof = page.getByLabel("Поточний пароль для підтвердження", { exact: true });
  const otp = page.getByLabel("Код із застосунку автентифікації", { exact: true });
  await proof.fill(password);
  await page.getByRole("button", { name: "Налаштувати двоетапний вхід", exact: true }).click();
  await expect(page.locator(".recovery-key")).toHaveText(secret);
  await expect(proof).toHaveValue("");
  await otp.fill("123456");
  await page.getByRole("button", { name: "Підтвердити код і ввімкнути", exact: true }).click();
  await expect(
    page.getByText("Увімкнено: при вході потрібні пароль і код із застосунку.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".recovery-key")).toHaveCount(0);
  await proof.fill(password);
  await otp.fill("654321");
  await page.getByRole("button", { name: "Створити новий ключ відновлення", exact: true }).click();
  await expect(page.locator(".recovery-key")).toHaveText(recovery);
  await page.getByRole("button", { name: "Я зберіг ключ", exact: true }).click();
  await expect(page.locator(".recovery-key")).toHaveCount(0);
  await page.getByRole("listitem").filter({ hasText: "Інша сесія" }).getByRole("button").click();
  await expect(page.getByText("Інша сесія", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Поточна сесія", { exact: true })).toBeVisible();
  expect(deleted).toBe(true);
  await noStoredSecrets(page, secret, password, recovery);
});

test("factory denial hides issuance and shipment controls", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await route(page, "factory/controllers?*", (request) => fulfillJson(request, 403, { detail: "Forbidden" }));
  await page.goto("/factory");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Зареєструвати і видати ключі", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Записати постачання", exact: true })).toHaveCount(0);
});

test("factory requires a passed test, issues one kit and records a shipment", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let posts = 0,
    distributor: string | null = null;
  const kit: Schema["FactorySecrets"] = {
    controller,
    qr_path: `/connect/${id}`,
    activation_code: activation,
    bootstrap_key: "b".repeat(43),
    setup_password: "local-test-password-only",
  };
  await route(page, "factory/controllers*", async (request) => {
    if (request.request().method() === "POST") {
      expect(request.request().postDataJSON().factory_test_passed).toBe(true);
      posts++;
      await fulfillJson(request, 201, kit);
    } else await fulfillJson(request, 200, posts ? [{ ...controller, distributor }] : []);
  });
  await route(page, `factory/controllers/${id}/shipments`, async (request) => {
    expect(request.request().postDataJSON()).toEqual({ distributor: "Test distributor", reference: "INV-001" });
    distributor = "Test distributor";
    await fulfillJson(request, 200, { ...controller, distributor });
  });
  await page.goto("/factory");
  for (const [label, value] of [
    ["Серійний номер", controller.serial_number],
    ["Апаратна ревізія", "3.1"],
    ["Партія", "test"],
    ["Номер протоколу заводської перевірки", "test-001"],
  ] as const)
    await page.getByLabel(label, { exact: true }).fill(value);
  const issue = page.getByRole("button", { name: "Зареєструвати і видати ключі", exact: true });
  await expect(issue).toBeDisabled();
  await page.getByRole("checkbox").check();
  await issue.click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Завантажити/ }).click();
  expect((await download).suggestedFilename()).toBe("factory-BROWSER-001.json");
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "Комплект збережено", exact: true }).click();
  await expect(page.getByRole("button", { name: /Завантажити/ })).toHaveCount(0);
  await page.getByLabel("Оптовик або отримувач партії", { exact: true }).fill("Test distributor");
  await page.getByLabel("Номер документа постачання", { exact: true }).fill("INV-001");
  await page.getByRole("button", { name: "Записати постачання", exact: true }).click();
  await expect(page.locator(".device-events")).toContainText("Test distributor");
  await noStoredSecrets(page, activation, kit.bootstrap_key);
});

for (const existing of [false, true])
  test(`QR claim uses ${existing ? "existing" : "new"} site and records equipment without enabling control`, async ({
    page,
  }) => {
    await mockAuthenticatedWorkspace(page);
    await read(page, `connect/${id}`, () => connection);
    await read(page, "connect/sites", () => [{ id: SITE_ID, name: "Existing site" }]);
    await read(page, "equipment/profiles", () => [profile]);
    let claims = 0,
      writes = 0;
    await route(page, `connect/${id}/claim`, async (request) => {
      claims++;
      expect(request.request().postDataJSON()).toEqual({
        activation_code: activation,
        device_name: "Контролер насоса",
        ...(existing ? { site_id: SITE_ID } : { new_site: { name: "My well", timezone: "Europe/Kyiv" } }),
      });
      await fulfillJson(request, 200, { ...connection, state: "claimed", device_id: DEVICE_ID, site_id: SITE_ID });
    });
    await route(page, `connect/${id}/equipment`, async (request) => {
      expect(request.request().method()).toBe("PUT");
      expect(request.request().postDataJSON()).toEqual({
        profile_id: profile.id,
        profile_version: 1,
        model: "SU300-test",
        hardware_revision: null,
        nameplate_confirmed: true,
      });
      writes++;
      await fulfillJson(request, 200, {});
    });
    await page.goto(`/connect/${id}`);
    if (existing) await page.getByLabel("Куди додати контролер", { exact: true }).selectOption(SITE_ID);
    else await page.getByLabel("Назва об’єкта", { exact: true }).fill("My well");
    await page.getByLabel("Код активації з комплекту", { exact: true }).fill(activation);
    await page.getByRole("button", { name: "Активувати та створити об’єкт", exact: true }).click();
    await expect(
      page.getByText("Контролер прив’язано до вашого об’єкта. Повторна активація не потрібна.", { exact: true }),
    ).toBeVisible();
    expect(claims).toBe(1);
    await page.getByLabel("Виробник і серія", { exact: true }).selectOption(`${profile.id}:1`);
    await page.getByLabel("Повна модель зі шильдика", { exact: true }).fill("SU300-test");
    const save = page.getByRole("button", { name: "Зберегти обладнання", exact: true });
    await expect(save).toBeDisabled();
    await expect(page.getByText(/Керування цією моделлю поки недоступне/)).toBeVisible();
    await page.getByRole("checkbox").check();
    await save.click();
    await expect(page.getByText(/Паспорт збережено. Керування не ввімкнено автоматично/)).toBeVisible();
    await expect(save).toBeDisabled();
    expect(writes).toBe(1);
    await noStoredSecrets(page, activation);
  });
