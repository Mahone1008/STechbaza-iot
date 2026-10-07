import { refreshButton } from "../helpers/customer-details";
import { expect, test, type Page } from "@playwright/test";
import {
  API_ORIGIN,
  DEVICE_ID,
  SITE_ID,
  devicePayload,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
} from "./auth-fixtures";
import type { components } from "../../src/lib/api/schema";

type Schema = components["schemas"];
const controllerId = "11111111-1111-4111-8111-111111111111";
const installationId = "22222222-2222-4222-8222-222222222222";
const moduleId = "33333333-3333-4333-8333-333333333333";
const profile: Schema["ProfileRead"] = {
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
const installed: Schema["ModuleRead"] = {
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
function passport(): Schema["EquipmentPassport"] {
  return {
    device_id: DEVICE_ID,
    controller_uid: devicePayload().uid,
    controller_id: controllerId,
    firmware_version: "0.7.0",
    installations: [{ id: installationId, site_id: SITE_ID, name: "Насосна установка" }],
    modules: [installed],
    desired: null,
    reported: null,
    configuration_state: "legacy",
  };
}
async function setup(page: Page, options: { viewer?: boolean } = {}) {
  await mockAuthenticatedWorkspace(page, options.viewer ? { role: "viewer" } : {});
  await page.route(`${API_ORIGIN}/api/v1/equipment/profiles`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, [profile]);
  });
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, passport());
  });
  await page.route(`${API_ORIGIN}/api/v1/connect/${controllerId}/status`, async (route) => {
    if (!(await fulfillPreflight(route)))
      await fulfillJson(route, 200, {
        controller_id: controllerId,
        generation: 1,
        credential_revision: 1,
        credential_state: "active",
        access_revoked: false,
        last_contact_at: null,
      });
  });
  await page.goto(`/devices/${DEVICE_ID}?view=equipment`);
}

test("replacement preserves the old passport, requires explicit confirmation and shows a STOP rejection", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 360, height: 800 });
  let attempts = 0;
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment/replacement`, async (route) => {
    if (await fulfillPreflight(route)) return;
    attempts++;
    expect(route.request().postDataJSON()).toMatchObject({
      expected_module_id: moduleId,
      expected_revision: 0,
      stopped_and_isolated: true,
      replacement: { model: "SU600A-5RG1-B", serial_number: "NEW-DRIVE", motor: { rated_frequency_hz: 50 } },
    });
    await fulfillJson(route, 409, { detail: "Потрібні свіжі дані: двигун зупинений, 0 Гц, керування DISARM" });
  });
  await page.getByRole("button", { name: "Замінити частотник", exact: true }).click();
  await page.getByLabel("Виробник і серія").selectOption(profile.id);
  await page.getByLabel("Модель нового частотника зі шильдика").fill("SU600A-5RG1-B");
  await page.getByLabel("Серійний номер нового частотника").fill("NEW-DRIVE");
  await page.getByLabel("Номінальна частота двигуна зі шильдика, Гц").fill("50");
  await page.getByLabel("Причина заміни").fill("Несправність старого частотника");
  await expect(page.getByRole("button", { name: "Підтвердити заміну" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Підтвердити заміну" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "DISARM" })).toBeVisible();
  await expect(page.getByText("OLD-DRIVE", { exact: true })).toBeVisible();
  expect(attempts).toBe(1);
  await page.screenshot({ path: test.info().outputPath("replacement-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("configuration is delivered explicitly with reviewed transport and limits", async ({ page }) => {
  await setup(page);
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment/configurations`, async (route) => {
    if (await fulfillPreflight(route)) return;
    expect(route.request().postDataJSON()).toMatchObject({
      expected_revision: 0,
      module_id: moduleId,
      profile_id: profile.id,
      bus: { address: 1, baud: 9600, parity: "none", stop_bits: 1 },
      frequency_limits: { min_hz: 15, max_hz: 45 },
    });
    await fulfillJson(route, 201, {});
  });
  await page.getByRole("button", { name: "Налаштувати підключення" }).click();
  await page.getByLabel("Виробник і серія").selectOption(profile.id);
  await page.getByLabel("Мінімальна частота, Гц", { exact: true }).fill("15");
  await page.getByLabel("Максимальна частота, Гц", { exact: true }).fill("45");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Зберегти налаштування" }).click();
  await expect(page.getByText("Конфігурацію збережено.", { exact: false })).toBeVisible();
});

test("handover kit remains visible after passport refresh removes its old association", async ({ page }) => {
  await setup(page);
  let released = false;
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment`, async (route) => {
    if (!(await fulfillPreflight(route)))
      await fulfillJson(route, 200, { ...passport(), controller_id: released ? null : controllerId });
  });
  await page.route(`${API_ORIGIN}/api/v1/connect/${controllerId}/access/release`, async (route) => {
    if (await fulfillPreflight(route)) return;
    expect(route.request().postDataJSON()).toMatchObject({ expected_generation: 1, stopped_and_isolated: true });
    released = true;
    await fulfillJson(route, 200, {
      controller_id: controllerId,
      generation: 2,
      qr_path: `/connect/${controllerId}`,
      activation_code: "transfer-test-key-".repeat(3),
      login: "kr-017ca46d342c4ab6bd1c89a602021951-g2",
      password: "transfer-test-key-".repeat(3),
    });
  });
  await page.getByRole("button", { name: "Керувати доступом" }).click();
  await page.getByRole("button", { name: "Передати іншому власнику" }).click();
  await page.getByLabel("Причина", { exact: true }).fill("Продаж новому власнику");
  await page.getByLabel("Ваш пароль для підтвердження").fill("test-password-only");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Підтвердити дію", exact: true }).click();
  await expect(page.getByText("Контролер готовий до передачі", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "QR для підключення контролера" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Завантажити комплект передачі" })).toBeVisible();
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 503, { detail: "Перевірка мережевої відмови" });
  });
  await (await refreshButton(page, "Оновити паспорт")).click();
  await expect(page.getByText("Сервіс тимчасово недоступний. Спробуйте пізніше.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Завантажити комплект передачі" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Завантажити комплект передачі" }).click();
  expect((await download).suggestedFilename()).toBe(`handover-${controllerId}.json`);
});

test("viewer can read passport without replacement or credential controls", async ({ page }) => {
  await setup(page, { viewer: true });
  await expect(page.getByText("OLD-DRIVE", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Замінити частотник" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Керувати доступом" })).toHaveCount(0);
});

for (const width of [320, 1280]) test(`controller access actions have readable spacing at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 852 });
  await setup(page);
  const section = page.locator('section[aria-label="Доступ і передача контролера"]');
  const help = (await section.locator(":scope > .help-copy").boundingBox())!;
  const toggle = section.getByRole("button", { name: "Керувати доступом", exact: true });
  const box = (await toggle.boundingBox())!;
  expect(box.y - (help.y + help.height)).toBeGreaterThanOrEqual(16);
  await toggle.click();
  const buttons = section.locator(":scope > .ui-row > .button");
  await expect(buttons).toHaveCount(3);
  const boxes = await Promise.all((await buttons.all()).map((button) => button.boundingBox()));
  for (let i = 1; i < boxes.length; i++) {
    const previous = boxes[i - 1]!, current = boxes[i]!;
    const gap = Math.abs(current.y - previous.y) < 2
      ? current.x - previous.x - previous.width
      : current.y - previous.y - previous.height;
    expect(gap).toBeGreaterThanOrEqual(10);
  }
  await expect(section.getByRole("button", { name: "Оновити стан доступу" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
