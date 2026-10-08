import { expect, type Page } from "@playwright/test";

export async function revealSection(page: Page, summary: string) {
  const toggle = page.getByText(summary, { exact: true });
  const details = toggle.locator("..");
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await toggle.click();
}

async function fieldInSection(page: Page, summary: string, label: string) {
  await revealSection(page, summary);
  const field = page.getByLabel(label, { exact: true });
  await expect(field).toBeVisible();
  return field;
}

export const displaySettings = (page: Page) => fieldInSection(page, "Налаштування відображення", "Автооновлення");
export const historyInterval = (page: Page) => fieldInSection(page, "Додаткові налаштування графіка", "Інтервал");
export const alarmTypeFilter = (page: Page) => fieldInSection(page, "Додаткові фільтри", "Тип аварії");
export const securityTotpPassword = (page: Page) =>
  fieldInSection(page, "Налаштування двоетапного входу", "Поточний пароль для підтвердження");
export const securityPasswordProof = (page: Page) =>
  fieldInSection(page, "Зміна пароля", "Поточний пароль для зміни пароля");
export const recoveryPasswordProof = (page: Page) =>
  fieldInSection(page, "Створення нового ключа", "Поточний пароль для оновлення ключа");

// Device and directory refreshes share the display settings of the current view.
export async function refreshButton(page: Page, name: string) {
  let button = page.getByRole("button", { name, exact: true, includeHidden: true });
  const contextual = [
    "Оновити історію",
    "Оновити розклади",
    "Оновити історію запусків",
    "Оновити журнал",
    "Оновити паспорт",
    "Оновити стан доступу",
    "Оновити події",
    "Оновити стан команди",
    "Оновити список",
    "Оновити зв’язок",
  ];
  if (
    contextual.includes(name) &&
    (await button.count()) === 0 &&
    (await page.locator(".panel-display-settings").count())
  ) {
    const settings = page.locator(".panel-display-settings");
    button = settings.getByRole("button", { name: "Оновити дані", exact: true, includeHidden: true });
    if (name === "Оновити стан команди" && (await button.count()) === 0)
      button = settings.getByRole("button", { name: "Оновити панель", exact: true, includeHidden: true });
  }
  await button.waitFor({ state: "attached" });
  const parents = button.locator("xpath=ancestor::details");
  for (const details of await parents.all()) {
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open)))
      await details.locator(":scope > summary").click();
  }
  return button;
}
