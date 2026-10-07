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

// Refresh actions are secondary, but remain reachable through native disclosures.
export async function refreshButton(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true, includeHidden: true });
  const parents = button.locator("xpath=ancestor::details");
  for (const details of await parents.all()) {
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open)))
      await details.locator(":scope > summary").click();
  }
  return button;
}
