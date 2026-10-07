import { refreshButton, displaySettings, historyInterval } from "../helpers/customer-details";
import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { API_ORIGIN, fulfillJson, fulfillPreflight } from "./auth-fixtures";
import { stage14Workspace, tenants } from "../helpers/stage14-workspace";
import { seriesFixture } from "../fixtures/series";

async function settled(page: Page) {
  await page.getByRole("tab", { name: "Графіки", exact: true }).click();
  await expect(page.locator(".telemetry-chart")).toBeVisible();
  await expect((await refreshButton(page, "Оновити історію"))).toBeEnabled();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function attach(name: string, report: unknown) {
  const path = test.info().outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(report, null, 2));
  await test.info().attach(name, { path, contentType: "application/json" });
}

test("device request and dense history rendering stay within baseline budgets", async ({ page }) => {
  await stage14Workspace(page);
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().startsWith(`${API_ORIGIN}/`) && request.method() !== "OPTIONS") requests.push(new URL(request.url()).pathname); });
  await page.route(`${API_ORIGIN}/api/v1/devices/*/telemetry/series?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const q = new URL(route.request().url()).searchParams;
    const series = seriesFixture({ start: q.get("start")!, end: q.get("end")!, bucket_seconds: Number(q.get("bucket_seconds")) });
    series.buckets = series.buckets.map((bucket, i) => ({ ...bucket, status: "ok", sample_count: 1, minimum: i % 17, average: i % 17 + 0.25, maximum: i % 17 + 0.5 }));
    series.message_count = series.sample_count = series.buckets.length;
    await fulfillJson(route, 200, series);
  });
  const started = Date.now(); await page.goto(`/devices/${tenants[0].device}`); await settled(page);
  const readyMs = Date.now() - started, initialRequests = [...requests];
  await (await displaySettings(page)).selectOption("0");
  await page.getByLabel("Період", { exact: true }).selectOption("604800");
  await expect(page.locator(".history-table tbody tr")).toHaveCount(168);
  const denseStarted = Date.now();
  await (await historyInterval(page)).selectOption("900");
  await expect(page.locator(".history-table tbody tr")).toHaveCount(672); await settled(page);
  const denseMs = Date.now() - denseStarted;
  const nodes = await page.locator("*").count();
  await attach("performance-device", { kind: "mocked-chromium-test-baseline", readyMs, denseMs, nodes, initialRequests,
    budgets: { readyMs: 8000, denseMs: 4000, initialRequests: 14, nodes: 15000 },
    note: "Local production build with mocked API, 672 populated buckets; not WAN latency or backend load capacity." });
  expect(readyMs).toBeLessThan(8000); expect(denseMs).toBeLessThan(4000);
  expect(initialRequests.length).toBeLessThanOrEqual(14); expect(nodes).toBeLessThan(15000);
});

test("repeated client navigation bounds retained heap and has no CSP violations", async ({ page, context }) => {
  test.setTimeout(90_000); await stage14Workspace(page);
  const errors: string[] = [], violations: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (/content security policy|refused to/iu.test(message.text())) violations.push(message.text()); });
  await page.goto(`/devices/${tenants[0].device}`); await settled(page);
  const client = await context.newCDPSession(page);
  const sample = async () => { await client.send("HeapProfiler.collectGarbage"); return await client.send("Runtime.getHeapUsage"); };
  const cycle = async () => {
    await page.getByRole("link", { name: "Аварії пристрою", exact: true }).click();
    await expect(page.getByRole("link", { name: "Тиск A", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Панель пристрою", exact: true }).click(); await settled(page);
  };
  try {
    await cycle(); await cycle(); const before = await sample();
    for (let i = 0; i < 6; i++) await cycle();
    const after = await sample(), growth = after.usedSize - before.usedSize;
    await attach("performance-navigation", { kind: "mocked-chromium-retained-js-heap", warmedCycles: 2, measuredCycles: 6,
      beforeBytes: before.usedSize, afterBytes: after.usedSize, growthBytes: growth,
      budgets: { afterBytes: 96 * 1024 * 1024, growthBytes: 16 * 1024 * 1024 },
      errors, violations, note: "Forced GC diagnostic of JS heap; not a long-running leak proof or total browser RSS." });
    expect(after.usedSize).toBeLessThan(96 * 1024 * 1024); expect(growth).toBeLessThan(16 * 1024 * 1024);
    expect(errors).toEqual([]); expect(violations).toEqual([]);
  } finally { await client.detach(); }
});
