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
  activation_required: true,
  permanent_login: null,
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

test("QR activation uses the label password without registration and resumes its wizard", async ({ page }) => {
  await mockMissingBrowserSession(page);
  let posts = 0;
  await route(page, "auth/browser/login", async (request) => {
    posts++;
    expect(request.request().postDataJSON()).toEqual({ controller_id: id, password });
    if (posts === 1) {
      await fulfillJson(request, 401, { detail: "Wrong label password" });
      return;
    }
    await mockAuthenticatedWorkspace(page);
    await read(page, `connect/${id}`, () => ({ ...connection, activation_required: false }));
    await read(page, "connect/sites", () => []);
    await read(page, "equipment/profiles", () => [profile]);
    await fulfillJson(request, 200, {
      access_token: "activation-access-token-only-for-browser-test",
      token_type: "bearer",
      expires_in: 300,
      session_expires_in: 3600,
      onboarding_path: `/connect/${id}`,
    });
  });
  await page.goto(`/connect/${id}`);
  await expect(page.getByRole("link", { name: "Створити обліковий запис", exact: true })).toHaveCount(0);
  await page.getByLabel("Пароль з етикетки", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Активувати контролер", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Wrong label password");
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "Активувати контролер", exact: true }).click();
  await expect(page.getByLabel("Назва об’єкта", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Пароль активації з етикетки", { exact: true })).toHaveCount(0);
  expect(posts).toBe(2);
  await noStoredSecrets(page, password);
});

test("printed login opens the pending controller wizard instead of an empty cabinet", async ({ page }) => {
  await mockMissingBrowserSession(page);
  const login = "kr-017ca46d342c4ab6bd1c89a602021951-g1";
  await route(page, "auth/browser/login", async (request) => {
    expect(request.request().postDataJSON()).toEqual({ email: login, password });
    await mockAuthenticatedWorkspace(page);
    await read(page, `connect/${id}`, () => ({ ...connection, activation_required: false }));
    await read(page, "connect/sites", () => []);
    await read(page, "equipment/profiles", () => [profile]);
    await fulfillJson(request, 200, {
      access_token: "label-login-access-token-only-for-browser-test",
      token_type: "bearer",
      expires_in: 300,
      session_expires_in: 3600,
      onboarding_path: `/connect/${id}`,
    });
  });
  await page.goto("/login");
  await page.getByLabel("Логін", { exact: true }).fill(login);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Увійти", exact: true }).click();
  await expect(page).toHaveURL(`/connect/${id}`);
  await expect(page.getByLabel("Назва об’єкта", { exact: true })).toBeVisible();
  await noStoredSecrets(page, password);
});

test("registration route is removed", async ({ page }) => {
  await mockMissingBrowserSession(page);
  const response = await page.goto("/register");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("button", { name: "Зареєструватися", exact: true })).toHaveCount(0);
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
  await page.getByLabel("Логін", { exact: true }).fill("buyer@example.com");
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
    login: "kr-017ca46d342c4ab6bd1c89a602021951-g1",
    password: activation,
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
  await page.evaluate(() => {
    window.print = () => undefined;
  });
  await page.getByRole("button", { name: "Друкувати публічний QR", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".factory-public-label")).toBeVisible();
  await expect(page.locator(".factory-private-label")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Друкувати закриту етикетку покупця", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".factory-public-label")).toBeHidden();
  await expect(page.locator(".factory-private-label")).toBeVisible();
  await expect(page.locator(".factory-private-label")).toContainText(kit.login);
  await expect(page.locator(".factory-private-label")).toContainText(kit.password);
  await expect(page.locator(".factory-private-label")).not.toContainText(kit.bootstrap_key);
  await page.emulateMedia({ media: "screen" });
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
    await page.getByLabel("Пароль активації з етикетки", { exact: true }).fill(activation);
    await page.getByRole("button", { name: "Підключити до об’єкта", exact: true }).click();
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

test("activation saves permanent credentials and confirms MFA before the factory password expires", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const login = "ku-017ca46d342c4ab6bd1c89a602021951";
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const setup = { login, secret, uri: `otpauth://totp/KERUMO:${login}?secret=${secret}`, recovery_key: recovery };
  await read(page, `connect/${id}`, () => ({ ...connection, activation_required: false, permanent_login: login }));
  await read(page, "connect/sites", () => []);
  await read(page, "equipment/profiles", () => [profile]);
  await route(page, `connect/${id}/security`, async (request) => {
    await fulfillJson(request, 200, setup);
  });
  let permanentPassword = "";
  await route(page, `connect/${id}/claim`, async (request) => {
    const body = request.request().postDataJSON();
    expect(body).toEqual({
      device_name: "Контролер насоса",
      new_site: { name: "New well", timezone: "Europe/Kyiv" },
      new_password: permanentPassword,
      otp: "123456",
    });
    await fulfillJson(request, 200, { ...connection, state: "claimed", device_id: DEVICE_ID, site_id: SITE_ID });
  });
  await page.goto(`/connect/${id}`);
  await page.getByLabel("Назва об’єкта", { exact: true }).fill("New well");
  const submit = page.getByRole("button", { name: "Підключити до об’єкта", exact: true });
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: "Створити постійний доступ", exact: true }).click();
  permanentPassword = await page.getByLabel("Новий згенерований пароль", { exact: true }).inputValue();
  expect(permanentPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
  await expect(page.getByRole("img", { name: "QR для застосунку автентифікації", exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Завантажити дані входу та ключ відновлення", exact: true }).click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toBe(`kerumo-access-${login}.json`);
  await page.getByLabel("Я зберіг нові дані входу та ключ відновлення", { exact: true }).check();
  await expect(submit).toBeDisabled();
  await page.getByLabel("Код підтвердження постійного доступу", { exact: true }).fill("123456");
  await submit.click();
  await expect(page.getByRole("status").filter({ hasText: "Контролер прив’язано" })).toBeVisible();
  await expect(page.getByLabel("Новий згенерований пароль", { exact: true })).toHaveCount(0);
  await noStoredSecrets(page, permanentPassword, secret, recovery);
});
