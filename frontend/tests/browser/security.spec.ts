import { expect, test } from "@playwright/test";
import { API_ORIGIN, ME_URL, fulfillJson, fulfillPreflight, mockMissingBrowserSession, tokenPayload } from "./auth-fixtures";
import { notificationPath, stage14Workspace, tenants } from "../helpers/stage14-workspace";
import { notificationFixture } from "../fixtures/notifications";

test("production HTML has fresh CSP nonces, private cache and defensive headers", async ({ page, request }) => {
  await mockMissingBrowserSession(page);
  const response = (await page.goto("/login"))!;
  await expect(page.getByRole("heading", { name: "Вхід до кабінету" })).toBeVisible();
  const headers = response.headers(), policy = headers["content-security-policy"]!;
  const nonce = /'nonce-([^']+)'/u.exec(policy)?.[1];
  expect(nonce).toBeTruthy();
  expect(policy).toContain("'strict-dynamic'");
  expect(policy.split(";").find((part) => part.trim().startsWith("script-src "))).not.toMatch(/unsafe-inline|unsafe-eval/u);
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain(`connect-src 'self' ${API_ORIGIN}`);
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-powered-by"]).toBeUndefined();
  const scripts = await page.locator("script").evaluateAll((nodes) => nodes.map((node) => (node as HTMLScriptElement).nonce));
  expect(scripts.length).toBeGreaterThan(0); expect(scripts.every((value) => value === nonce)).toBe(true);
  const next = await request.get("/login", { headers: { "Content-Security-Policy": "script-src 'unsafe-inline'" } });
  const nextNonce = /'nonce-([^']+)'/u.exec(next.headers()["content-security-policy"]!)?.[1];
  expect(nextNonce).toBeTruthy(); expect(nextNonce).not.toBe(nonce);
});

test("CSP blocks injected inline scripts and inline event handlers", async ({ page }) => {
  await mockMissingBrowserSession(page);
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      document.documentElement.dataset.cspBlocked = `${document.documentElement.dataset.cspBlocked ?? ""},${event.effectiveDirective}`;
    });
  });
  // Exercise untrusted parser-inserted HTML, not DevTools-authorized JS evaluation.
  await page.route("http://127.0.0.1:3000/login", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace("</head>", '<script>document.documentElement.dataset.injectedScript="yes"</script></head>');
    await route.fulfill({ response, body });
  });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Вхід до кабінету" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-csp-blocked", /script-src-elem/u);
  await expect(page.locator("html")).not.toHaveAttribute("data-injected-script", "yes");
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.setAttribute("onclick", 'document.documentElement.dataset.injectedHandler = "yes"'); document.body.append(button); button.click();
  });
  await expect(page.locator("html")).toHaveAttribute("data-csp-blocked", /script-src-attr/u);
  await expect(page.locator("html")).not.toHaveAttribute("data-injected-handler", "yes");
});

test("notification content is escaped and credentials never enter persistent storage", async ({ page }) => {
  await stage14Workspace(page);
  const title = '<img src=x onerror="document.documentElement.dataset.injected=1">';
  await page.route(`${API_ORIGIN}/api/v1/notifications/${tenants[0].notification}`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, notificationFixture({ id: tenants[0].notification, organization_id: tenants[0].organization, device_id: tenants[0].device, alarm_id: tenants[0].alarm, title }));
  });
  // Logout replaces the current entry; retain an earlier protected page for Back.
  await page.goto("/devices");
  await expect(page.getByRole("heading", { name: "Пристрої", exact: true })).toBeVisible();
  await page.goto(notificationPath());
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-injected", "1");
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain(tokenPayload("r").access_token);
  expect(storage).not.toMatch(/access_token|refresh_token|authorization|password/iu);
  await page.getByRole("button", { name: "Відкрити меню користувача" }).click();
  await page.getByRole("menuitem", { name: /Вийти з акаунта/u }).click();
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
  await page.goBack(); await expect(page.getByRole("heading", { name: "Вхід до кабінету" })).toBeVisible();
  await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
});

test("API redirects fail closed without following the destination", async ({ page }) => {
  await stage14Workspace(page); let destinationRequests = 0;
  await page.route(`${API_ORIGIN}/unexpected-profile`, async (route) => { destinationRequests++; await fulfillJson(route, 200, {}); });
  await page.route(ME_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    await route.fulfill({ status: 302, headers: {
      location: `${API_ORIGIN}/unexpected-profile`,
      "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true",
    } });
  });
  await page.goto("/devices");
  await expect(page.getByRole("heading", { name: "Не вдалося перевірити права" })).toBeVisible();
  expect(destinationRequests).toBe(0);
  await expect(page.getByRole("heading", { name: "Пристрої", exact: true })).toHaveCount(0);
});
