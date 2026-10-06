import { historyInterval } from "../helpers/customer-details";
import { expect, test, type Page } from "@playwright/test";
import { stage14Workspace, tenants, feedPath, alarmPath, notificationPath } from "../helpers/stage14-workspace";
import { fillLogin } from "./auth-fixtures";

test.describe.configure({ retries: 0 });

async function logout(page: Page) {
  await page.getByRole("button", { name: "Відкрити меню користувача" }).click();
  await page.getByRole("menuitem", { name: /Вийти з акаунта/u }).press("Enter");
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
  await expect(page.getByRole("heading", { name: "Вхід до кабінету" })).toBeVisible();
}

for (const role of ["owner", "viewer"] as const) test(`${role} completes login, inventory, history, incident, personal read and logout`, async ({ page }) => {
  const writes = await stage14Workspace(page, role, true);
  await page.goto("/login"); await fillLogin(page); await page.getByRole("button", { name: "Увійти" }).click();
  await expect(page.getByRole("heading", { name: "Пристрої", exact: true })).toBeVisible();
  await page.locator(".sidebar-nav").getByRole("link", { name: "Організації", exact: true }).click();
  await page.getByRole("list", { name: "Список організацій" }).getByRole("link", { name: tenants[0].name, exact: true }).click();
  await page.getByRole("list", { name: "Список об’єктів" }).getByRole("link", { name: "Об’єкт A", exact: true }).click();
  await page.getByRole("link", { name: "Насос A", exact: true }).click();
  await page.getByRole("tab", { name: "Графіки", exact: true }).click();
  await expect(page.locator(".telemetry-chart")).toBeVisible();
  await page.getByLabel("Період", { exact: true }).selectOption("21600");
  await (await historyInterval(page)).selectOption("900");
  await page.reload(); await expect(page.getByLabel("Період", { exact: true })).toHaveValue("21600");
  await expect((await historyInterval(page))).toHaveValue("900");
  await page.getByRole("tab", { name: "Панель", exact: true }).click();
  if (role === "owner") {
    await page.getByRole("button", { name: "Зупинити", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Скасувати" }).click();
  } else await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toHaveCount(0);
  expect(writes.commands).toBe(0);
  await page.getByRole("link", { name: "Аварії пристрою", exact: true }).click();
  await page.getByRole("link", { name: "Тиск A", exact: true }).click();
  if (role === "owner") {
    await page.getByRole("button", { name: "Підтвердити отримання", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Підтвердити отримання", exact: true }).click();
    await expect(page.getByText("Оператор тесту", { exact: false }).first()).toBeVisible();
    await expect(page.locator(".status-badge").filter({ hasText: /^Активна$/u })).toBeVisible();
  } else await expect(page.getByRole("button", { name: "Підтвердити отримання", exact: true })).toHaveCount(0);
  await page.locator(".sidebar-nav").getByRole("link", { name: "Повідомлення", exact: true }).click();
  await page.getByRole("link", { name: "Повідомлення A", exact: true }).click();
  await page.getByRole("button", { name: "Позначити прочитаним" }).click();
  await expect(page.getByText("Стан перевірено: повідомлення прочитане вами.")).toBeVisible();
  await page.reload(); await expect(page.getByText("Прочитано вами", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "До повідомлень" }).click();
  await expect(page.getByText("Непрочитаних вами:")).toContainText("0");
  await page.getByLabel("Показати повідомлення", { exact: true }).selectOption("unread");
  await expect(page.getByText("За вибраним фільтром повідомлень немає.")).toBeVisible();
  await logout(page); await page.reload(); await expect(page.getByRole("heading", { name: "Вхід до кабінету" })).toBeVisible();
  expect(writes.reads).toEqual([1, 0]); expect(writes.acknowledgements).toEqual([role === "owner" ? 1 : 0, 0]);
  expect(writes.logouts).toBe(1); expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});

test("two tenants in two tabs keep history and reads separate and logout clears both", async ({ page, context }) => {
  const writes = await stage14Workspace(context);
  const second = await context.newPage();
  await page.goto(`/devices/${tenants[0].device}`);
  await page.getByRole("tab", { name: "Графіки", exact: true }).click();
  await page.getByLabel("Період", { exact: true }).selectOption("21600");
  await second.goto(`/devices/${tenants[1].device}`);
  await second.getByRole("tab", { name: "Графіки", exact: true }).click();
  await expect(second.getByRole("heading", { name: "Насос B", exact: true })).toBeVisible();
  await expect(second.getByLabel("Період", { exact: true })).toHaveValue("3600");
  await second.getByLabel("Період", { exact: true }).selectOption("86400");
  await page.reload(); await expect(page.getByLabel("Період", { exact: true })).toHaveValue("21600");
  await page.goto(notificationPath());
  await page.getByRole("button", { name: "Позначити прочитаним" }).click();
  await expect(page.getByText("Стан перевірено: повідомлення прочитане вами.")).toBeVisible();
  await second.goto(feedPath(1));
  await expect(second.getByText("Непрочитаних вами:")).toContainText("1");
  await expect(second.getByRole("table")).toContainText("Повідомлення B");
  await expect(second.getByText("Повідомлення A", { exact: true })).toHaveCount(0);
  await page.goto(alarmPath());
  await page.getByRole("button", { name: "Підтвердити отримання", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Підтвердити отримання", exact: true }).click();
  await expect(page.getByText("Оператор тесту", { exact: false }).first()).toBeVisible();
  await second.goto(alarmPath(1));
  await expect(second.getByRole("button", { name: "Підтвердити отримання", exact: true })).toBeEnabled();
  await expect(second.getByText("Оператор тесту", { exact: false })).toHaveCount(0);
  await page.goto(feedPath(1)); await expect(page.getByRole("table")).toContainText("Повідомлення B");
  await page.goto(feedPath()); await expect(page.getByText("Непрочитаних вами:")).toContainText("0");
  await logout(page);
  await expect(second).toHaveURL(/\/login\?loggedOut=1$/u);
  for (const tab of [page, second]) {
    await expect(tab.getByRole("table")).toHaveCount(0);
    expect(await tab.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  }
  await second.goto(notificationPath(1)); await expect(second).toHaveURL(/\/login\?loggedOut=1$/u);
  expect(writes.reads).toEqual([1, 0]); expect(writes.acknowledgements).toEqual([1, 0]); expect(writes.logouts).toBe(1);
});
