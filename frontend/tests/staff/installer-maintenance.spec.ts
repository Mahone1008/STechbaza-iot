import { refreshButton, revealSection } from "../helpers/customer-details";
import { expect, test } from "@playwright/test";
import {
  API_ORIGIN,
  DEVICE_ID,
  moduleId,
  profile,
  installed,
  passport,
  setup,
  fulfillStaffJson as fulfillJson,
  fulfillStaffPreflight as fulfillPreflight,
} from "../helpers/installer-fixtures";

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
  await revealSection(page, "Обслуговування та заміна");
  await page.getByRole("button", { name: "Замінити частотник", exact: true }).click();
  await page.getByLabel("Серія частотника SUSWE").selectOption(profile.id);
  await page.getByLabel("Модель нового частотника зі шильдика").fill("SU600A-5RG1-B");
  await page.getByLabel("Серійний номер нового частотника").fill("NEW-DRIVE");
  await page.getByLabel("Номінальна частота двигуна зі шильдика, Гц").fill("50");
  await page.getByLabel("Причина заміни").fill("Несправність старого частотника");
  await expect(page.getByRole("button", { name: "Підтвердити заміну" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Підтвердити заміну" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "DISARM" })).toBeVisible();
  await expect(page.getByText("SUSWE SU600", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Налаштувати робочі межі" }).click();
  await expect(page.getByLabel("Серія частотника SUSWE")).toHaveCount(0);
  await page.getByLabel("Мінімальна частота, Гц", { exact: true }).fill("15");
  await page.getByLabel("Максимальна частота, Гц", { exact: true }).fill("45");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Зберегти налаштування" }).click();
  await expect(page.getByText("Межі збережено.", { exact: false })).toBeVisible();
});

test("replacement selection offers SUSWE only even if the catalog includes a historical manufacturer", async ({
  page,
}) => {
  await setup(page);
  await page.route(`${API_ORIGIN}/api/v1/equipment/profiles`, async (route) => {
    if (!(await fulfillPreflight(route)))
      await fulfillJson(route, 200, [
        profile,
        { ...profile, id: "sigma.legacy", manufacturer: "SIGMA", series: "VFD" },
      ]);
  });
  await revealSection(page, "Обслуговування та заміна");
  await page.getByRole("button", { name: "Замінити частотник", exact: true }).click();
  const select = page.getByLabel("Серія частотника SUSWE");
  await expect(select.locator("option", { hasText: "SU600" })).toHaveCount(1);
  await expect(select.locator("option", { hasText: "SIGMA" })).toHaveCount(0);
  await expect(select.locator('option[value="sigma.legacy"]')).toHaveCount(0);
});

test("opening a supported setup uses its passport model without sending a change", async ({ page }) => {
  await setup(page);
  let posts = 0;
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment/configurations`, async (route) => {
    if (!(await fulfillPreflight(route))) {
      posts++;
      await fulfillJson(route, 201, {});
    }
  });
  await page.getByRole("button", { name: "Налаштувати робочі межі", exact: true }).click();
  await expect(page.getByLabel("Серія частотника SUSWE")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Зберегти налаштування", exact: true })).toBeDisabled();
  expect(posts).toBe(0);
  await page.getByRole("checkbox").check();
  await page.getByLabel("Максимальна частота, Гц", { exact: true }).fill("45");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Зберегти налаштування", exact: true })).toBeDisabled();
});

test("setup never guesses a driver for a different full model", async ({ page }) => {
  await setup(page);
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment`, async (route) => {
    if (!(await fulfillPreflight(route)))
      await fulfillJson(route, 200, { ...passport(), modules: [{ ...installed, model: "SU600-OTHER-REVISION" }] });
  });
  await (await refreshButton(page, "Оновити паспорт")).click();
  await page.getByRole("button", { name: "Налаштувати робочі межі", exact: true }).click();
  await expect(page.getByLabel("Серія частотника SUSWE")).toHaveCount(0);
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Зберегти налаштування", exact: true })).toBeDisabled();
  await expect(
    page.getByText("Для повної моделі з паспорта немає перевіреного драйвера", { exact: false }),
  ).toBeVisible();
});

test("passport refresh cannot retarget an already reviewed configuration to a replaced drive", async ({ page }) => {
  await setup(page);
  let replaced = false,
    posts = 0;
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment`, async (route) => {
    if (!(await fulfillPreflight(route)))
      await fulfillJson(route, 200, {
        ...passport(),
        modules: [{ ...installed, id: replaced ? "44444444-4444-4444-8444-444444444444" : moduleId }],
      });
  });
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment/configurations`, async (route) => {
    if (!(await fulfillPreflight(route))) {
      posts++;
      await fulfillJson(route, 201, {});
    }
  });
  await page.getByRole("button", { name: "Налаштувати робочі межі", exact: true }).click();
  await page.getByRole("checkbox").check();
  replaced = true;
  await (await refreshButton(page, "Оновити паспорт")).click();
  await expect(page.getByRole("alert").filter({ hasText: "Паспорт змінився" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Зберегти налаштування", exact: true })).toBeDisabled();
  expect(posts).toBe(0);
});
