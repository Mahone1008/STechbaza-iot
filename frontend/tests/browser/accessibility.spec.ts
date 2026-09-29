import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { stage14Workspace, tenants, feedPath, notificationPath, alarmPath } from "../helpers/stage14-workspace";
import { API_ORIGIN, fulfillJson, fulfillPreflight, mockMissingBrowserSession } from "./auth-fixtures";

test.describe.configure({ retries: 0 });

async function audit(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  await test.info().attach(`axe-${label}`, { body: JSON.stringify(result), contentType: "application/json" });
  expect(result.violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
}
async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 320, height: 640 }]) {
  test(`key workspace screens pass axe and reflow at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await stage14Workspace(page);
    const screens = [
      ["/organizations", "Організації"],
      [`/organizations/${tenants[0].organization}/sites`, "Об’єкти"],
      [`/devices/${tenants[0].device}`, "Насос A"],
      [`/alarms/devices/${tenants[0].device}`, "Аварії пристрою"],
      [alarmPath(), "Деталі інциденту"], [feedPath(), "Повідомлення"],
      [notificationPath(), "Деталі повідомлення"],
    ];
    for (const [path, heading] of screens) {
      await page.goto(path!);
      await expect(page.getByRole("heading", { name: heading!, exact: true })).toBeVisible();
      await expect(page.getByText(/^Завантажуємо/u)).toHaveCount(0);
      if (heading === "Насос A") await expect(page.getByRole("button", { name: "Оновити історію" })).toBeEnabled();
      if (heading === "Повідомлення") await expect(page.getByRole("link", { name: "Повідомлення A", exact: true })).toBeVisible();
      await noPageOverflow(page);
      await audit(page, `${viewport.width}-${heading}`);
    }
    await page.screenshot({ path: test.info().outputPath(`notification-${viewport.width}.png`), fullPage: true });
  });
}

test("login keyboard validation exposes field errors and passes accessibility checks", async ({ page }) => {
  await mockMissingBrowserSession(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/login");
  const email = page.getByLabel("Email");
  await email.fill("incorrect");
  await page.getByRole("button", { name: "Увійти" }).press("Enter");
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAccessibleDescription(/коректний email/u);
  await expect(page.getByLabel("Пароль")).toHaveAccessibleDescription("Введіть пароль.");
  await noPageOverflow(page); await audit(page, "login-errors");
});

for (const width of [1440, 320]) test(`skip link and account menu support keyboard at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 }); await stage14Workspace(page);
  await page.goto(feedPath());
  await expect(page.getByRole("link", { name: "Повідомлення A", exact: true })).toBeVisible();
  const skip = page.getByRole("link", { name: "Перейти до вмісту" });
  await skip.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const trigger = page.getByRole("button", { name: "Відкрити меню користувача" });
  await trigger.focus(); await page.keyboard.press("Enter");
  const action = page.getByRole("menuitem", { name: /Вийти з акаунта/u });
  await expect(action).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(action).toBeFocused();
  await audit(page, `menu-${width}`);
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowUp"); await expect(action).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByRole("menu")).toHaveCount(0);
});

test("confirmation is keyboard-contained, Escape restores focus and never submits", async ({ page }) => {
  const writes = await stage14Workspace(page);
  await page.goto(alarmPath());
  const trigger = page.getByRole("button", { name: "Підтвердити отримання", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Скасувати" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Підтвердити отримання", exact: true })).toBeFocused();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await audit(page, "confirmation");
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused(); expect(writes.acknowledgements).toEqual([0, 0]);
});

test("narrow tables retain every column and allow keyboard horizontal scrolling", async ({ page }) => {
  await stage14Workspace(page); await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(feedPath());
  const table = page.getByRole("table", { name: "Повідомлення організації" });
  await expect(table.getByRole("columnheader", { name: "Час події (UTC)" })).toBeVisible();
  const scroll = page.getByRole("region", { name: "Повідомлення організації: прокручувана таблиця" });
  await scroll.focus(); await page.keyboard.press("ArrowRight");
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await noPageOverflow(page);
  await page.goto(`/devices/${tenants[0].device}`);
  await expect(page.locator('.mobile-nav a[aria-current="page"]')).toHaveText("Пристрої");
});

test("400 percent equivalent reflow retains content and actions at 320 by 256 CSS pixels", async ({ page }) => {
  await stage14Workspace(page); await page.setViewportSize({ width: 320, height: 256 });
  for (const path of [alarmPath(), notificationPath(), `/devices/${tenants[0].device}`]) {
    await page.goto(path); await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await noPageOverflow(page);
  }
  await page.getByRole("button", { name: "Зупинити", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Скасувати" }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Скасувати" })).toBeInViewport();
  await page.keyboard.press("Escape");
});

test("empty and denied notification states stay accessible without stale rows", async ({ page }) => {
  await stage14Workspace(page);
  let denied = false;
  await page.route(`${API_ORIGIN}/api/v1/organizations/${tenants[0].organization}/notifications?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, denied ? 403 : 200, denied ? { detail: "Denied" } : []);
  });
  await page.goto(feedPath());
  await expect(page.getByText("За вибраним фільтром повідомлень немає.")).toBeVisible();
  await audit(page, "empty"); denied = true;
  await page.getByRole("button", { name: "Оновити повідомлення" }).click();
  await expect(page.getByRole("heading", { name: "Повідомлення недоступні" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0); await audit(page, "denied");
});
