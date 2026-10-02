import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { alarmFixture } from "../fixtures/alarms";
import { notificationFixture } from "../fixtures/notifications";
import {
  API_ORIGIN,
  DEVICE_ID,
  ORGANIZATION_ID,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
} from "./auth-fixtures";

test.use({ isMobile: true, hasTouch: true });
for (const width of [320, 393, 768])
  test(`notification and alarm filters have bounded open pickers at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await mockAuthenticatedWorkspace(page);
    const feed = `${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/notifications`;
    await page.route(`${feed}?*`, async (route) => {
      if (!(await fulfillPreflight(route)))
        await fulfillJson(route, 200, [notificationFixture({ title: "Контролер перезапустився" })]);
    });
    await page.route(`${feed}/unread-count`, async (route) => {
      if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, { unread_count: 1 });
    });
    await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/alarms?*`, async (route) => {
      if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, [alarmFixture()]);
    });
    for (const [path, labels] of [
      [`/organizations/${ORGANIZATION_ID}/notifications`, ["Показати повідомлення"]],
      [`/alarms/devices/${DEVICE_ID}`, ["Стан аварії", "Важливість"]],
      ["/ui-kit", ["Режим"]],
    ] as const) {
      await page.goto(path);
      for (const label of labels) {
        const select = page.getByRole("combobox", { name: label, exact: true });
        await select.click();
        await expect(select.getByRole("option").first()).toBeVisible();
        for (const option of await select.getByRole("option").all()) {
          const box = await option.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.y).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          expect(box!.y + box!.height).toBeLessThanOrEqual(852);
          expect(
            await option.evaluate((element) => {
              const node = element.firstChild!;
              const text = node.textContent ?? "";
              return Array.from(text.matchAll(/\p{L}+/gu)).every((word) => {
                const range = document.createRange();
                range.setStart(node, word.index!);
                range.setEnd(node, word.index! + word[0].length);
                return range.getClientRects().length === 1;
              });
            }),
          ).toBe(true);
        }
        await test
          .info()
          .attach(`filter-${label}-${width}`, { body: await page.screenshot(), contentType: "image/png" });
        await page.keyboard.press("Escape");
        await expect(select).toBeFocused();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      if (path.includes("notifications")) {
        const title = page.getByRole("link", { name: "Контролер перезапустився", exact: true });
        expect(
          await title.evaluate((link) => {
            const text = link.firstChild!;
            const range = document.createRange();
            range.setStart(text, "Контролер ".length);
            range.setEnd(text, text.textContent!.length);
            return range.getClientRects().length;
          }),
        ).toBe(1);
      }
    }
  });
