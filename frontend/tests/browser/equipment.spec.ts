import { expect, test } from "@playwright/test";
import { API_ORIGIN, DEVICE_ID, devicePayload, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace } from "./auth-fixtures";

test("passport loads only when opened, stays open across panel refresh and fits a narrow screen", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 320, height: 720 });
  let requests = 0;
  const device = devicePayload();
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment`, async (route) => {
    if (await fulfillPreflight(route)) return;
    requests++;
    await fulfillJson(route, 200, { device_id: device.id, controller_uid: device.uid, firmware_version: "0.6.0",
      installations: [], modules: [], desired: null, reported: null, configuration_state: "legacy" });
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await expect(page.getByRole("tab", { name: "Обладнання", exact: true })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("tab", { name: "Обладнання", exact: true }).click();
  await expect(page.getByText("Обладнання ще не внесено в паспорт.", { exact: false })).toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Оновити панель", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Обладнання", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(requests).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("tab", { name: "Панель", exact: true }).click();
  await expect(page.locator("#equipment-passport")).not.toBeVisible();
});
