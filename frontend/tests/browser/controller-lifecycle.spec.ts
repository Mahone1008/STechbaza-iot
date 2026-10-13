import { refreshButton, revealSection } from "../helpers/customer-details";
import AxeBuilder from "@axe-core/playwright";
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
    can_install: false,
    firmware_control_capability: "full",
    commissioned_control_mode: null,
    readiness: { state: "needs_equipment", title: "Обладнання готує сервіс", next_action: null, blockers: [] },
  };
}
function configuredPassport(verified: boolean): Schema["EquipmentPassport"] {
  const data = passport();
  const manifest: Schema["EquipmentManifest"] = {
    version: 1,
    device_uid: data.controller_uid,
    module_id: moduleId,
    binding_id: "55555555-5555-4555-8555-555555555555",
    binding_generation: 1,
    revision: 1,
    profile_id: profile.id,
    profile_version: profile.version,
    profile_hash: profile.profile_hash,
    driver_id: profile.driver_id!,
    driver_version: profile.driver_version!,
    bus: { transport: "modbus_rtu", address: 1, baud: 9600, parity: "none", stop_bits: 1 },
    frequency_limits: { min_hz: 15, max_hz: 45 },
  };
  data.modules = [
    {
      ...installed,
      motor: { rated_frequency_hz: 50, rated_power_kw: 0.12, rated_current_a: 0.44, rated_voltage_v: 380 },
    },
  ];
  data.desired = {
    manifest,
    configuration_hash: "c".repeat(64),
    created_at: new Date().toISOString(),
    actor_user_id: controllerId,
  };
  data.configuration_state = verified ? "verified" : "awaiting";
  if (verified) {
    data.reported = {
      module_id: manifest.module_id,
      binding_id: manifest.binding_id,
      binding_generation: manifest.binding_generation,
      revision: manifest.revision,
      profile_id: manifest.profile_id,
      profile_version: manifest.profile_version,
      profile_hash: manifest.profile_hash,
      driver_id: manifest.driver_id,
      driver_version: manifest.driver_version,
      configuration_hash: data.desired.configuration_hash,
      command_protocol: 3,
      compatible: true,
    };
  }
  return data;
}
async function setup(page: Page, options: { viewer?: boolean; admin?: boolean } = {}) {
  await mockAuthenticatedWorkspace(page, options.viewer ? { role: "viewer" } : options.admin ? { role: "admin" } : {});
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
  await expect(page.getByText("SUSWE SU600", { exact: true })).toBeVisible();
}

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
  await page.getByRole("button", { name: "Підтвердити передачу", exact: true }).click();
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
  await expect(page.getByText("SUSWE SU600", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Замінити частотник" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Керувати доступом" })).toHaveCount(0);
});

for (const width of [320, 1280])
  test(`controller access actions have readable spacing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await setup(page);
    const section = page.locator('section[aria-label="Доступ і передача контролера"]');
    const help = (await section.locator(":scope > .help-copy").boundingBox())!;
    const toggle = section.getByRole("button", { name: "Керувати доступом", exact: true });
    const box = (await toggle.boundingBox())!;
    expect(box.y - (help.y + help.height)).toBeGreaterThanOrEqual(16);
    await toggle.click();
    await expect(section.getByRole("button", { name: "Передати іншому власнику", exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: "Оновити доступ контролера", exact: true })).toBeHidden();
    await revealSection(page, "Захист підключення контролера");
    const buttons = section.locator(".equipment-secondary > .ui-row > .button");
    await expect(buttons).toHaveCount(2);
    const boxes = await Promise.all((await buttons.all()).map((button) => button.boundingBox()));
    for (let i = 1; i < boxes.length; i++) {
      const previous = boxes[i - 1]!,
        current = boxes[i]!;
      const gap =
        Math.abs(current.y - previous.y) < 2
          ? current.x - previous.x - previous.width
          : current.y - previous.y - previous.height;
      expect(gap).toBeGreaterThanOrEqual(10);
    }
    await expect(section.getByRole("button", { name: "Оновити стан доступу" })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include("#device-section-equipment").withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
  });

test("customer passport keeps technical data and rare maintenance out of the main view", async ({ page }) => {
  await setup(page);
  await expect(page.getByText("SUSWE SU600", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Налаштувати робочі межі", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Підготовка установки", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Замінити частотник", exact: true })).toHaveCount(0);
  await expect(page.getByText("OLD-DRIVE", { exact: true })).toBeHidden();
  await expect(page.getByText("SU600A-5RG1-B", { exact: true })).toBeHidden();
  await expect(page.getByText("vfd-1", { exact: false })).toBeHidden();
  await page.screenshot({ path: test.info().outputPath("equipment-desktop.png"), fullPage: true });
  await revealSection(page, "Докладніше про обладнання");
  await expect(page.getByText("vfd-1", { exact: false })).toBeVisible();
  await expect(page.getByText("OLD-DRIVE", { exact: true })).toBeVisible();
  await expect(page.getByText("SU600A-5RG1-B", { exact: true })).toBeVisible();
});

for (const verified of [false, true])
  test(`simple passport shows motor power and ${verified ? "confirmed" : "unconfirmed"} working limits`, async ({
    page,
  }) => {
    await setup(page);
    await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment`, async (route) => {
      if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, configuredPassport(verified));
    });
    await (await refreshButton(page, "Оновити паспорт")).click();
    const summary = page.locator(".equipment-module > .overview-details");
    await expect(summary.getByText("SUSWE SU600", { exact: true })).toBeVisible();
    await expect(summary.getByText("0.12 кВт", { exact: true })).toBeVisible();
    await expect(
      summary.getByText(verified ? "15–45 Гц" : "15–45 Гц · не підтверджено", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("OLD-DRIVE", { exact: true })).toBeHidden();
  });

test("simple passport does not invent missing motor power or working limits", async ({ page }) => {
  await setup(page);
  const summary = page.locator(".equipment-module > .overview-details");
  await expect(summary.getByText("Не зазначено", { exact: true })).toBeVisible();
  await expect(summary.getByText("Не налаштовано", { exact: true })).toBeVisible();
  await expect(summary.getByText("0 кВт", { exact: true })).toHaveCount(0);
});

test("organization admin has access maintenance without owner handover", async ({ page }) => {
  await setup(page, { admin: true });
  await page.getByRole("button", { name: "Керувати доступом", exact: true }).click();
  await expect(page.getByRole("button", { name: "Передати іншому власнику", exact: true })).toHaveCount(0);
  await revealSection(page, "Захист підключення контролера");
  await expect(page.getByRole("button", { name: "Оновити доступ контролера", exact: true })).toBeVisible();
});

test("closing access actions clears proof and a changed generation blocks the reviewed action", async ({ page }) => {
  await setup(page);
  let generation = 1,
    posts = 0;
  await page.route(`${API_ORIGIN}/api/v1/connect/${controllerId}/status`, async (route) => {
    if (!(await fulfillPreflight(route)))
      await fulfillJson(route, 200, {
        controller_id: controllerId,
        generation,
        credential_revision: generation,
        credential_state: "active",
        access_revoked: false,
        last_contact_at: null,
      });
  });
  await page.route(`${API_ORIGIN}/api/v1/connect/${controllerId}/access/release`, async (route) => {
    if (!(await fulfillPreflight(route))) {
      posts++;
      await fulfillJson(route, 409, {});
    }
  });
  await page.getByRole("button", { name: "Керувати доступом", exact: true }).click();
  await page.getByRole("button", { name: "Передати іншому власнику", exact: true }).click();
  await page.getByLabel("Причина", { exact: true }).fill("Передача новому власнику");
  await page.getByLabel("Ваш пароль для підтвердження").fill("test-password-only");
  await page.getByRole("checkbox").check();
  generation = 2;
  await (await refreshButton(page, "Оновити стан доступу")).click();
  await expect(page.getByRole("alert").filter({ hasText: "Стан доступу змінився" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Підтвердити передачу", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Згорнути дії", exact: true }).click();
  await page.getByRole("button", { name: "Керувати доступом", exact: true }).click();
  await page.getByRole("button", { name: "Передати іншому власнику", exact: true }).click();
  await expect(page.getByLabel("Ваш пароль для підтвердження")).toHaveValue("");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  expect(posts).toBe(0);
});

test("an access form cannot move to another controller with the same generation", async ({ page }) => {
  await setup(page);
  const nextController = "11111111-1111-4111-8111-111111111112";
  await page.getByRole("button", { name: "Керувати доступом", exact: true }).click();
  await page.getByRole("button", { name: "Передати іншому власнику", exact: true }).click();
  await page.getByLabel("Причина", { exact: true }).fill("Передача новому власнику");
  await page.getByLabel("Ваш пароль для підтвердження").fill("test-password-only");
  await page.getByRole("checkbox").check();
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment`, async (route) => {
    if (!(await fulfillPreflight(route)))
      await fulfillJson(route, 200, { ...passport(), controller_id: nextController });
  });
  await page.route(`${API_ORIGIN}/api/v1/connect/${nextController}/status`, async (route) => {
    if (!(await fulfillPreflight(route)))
      await fulfillJson(route, 200, {
        controller_id: nextController,
        generation: 1,
        credential_revision: 1,
        credential_state: "active",
        access_revoked: false,
        last_contact_at: null,
      });
  });
  await (await refreshButton(page, "Оновити паспорт")).click();
  await expect(page.getByRole("alert").filter({ hasText: "Стан доступу змінився" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Підтвердити передачу", exact: true })).toBeDisabled();
});
