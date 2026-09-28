import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import type { components } from "../../src/lib/api/schema";

type Alarm = components["schemas"]["DeviceAlarmRead"];
type Notice = components["schemas"]["AlarmNotificationRead"];
type Proof = { alarm_id: string; notification_id: string; transition_id: string; event_id: string; telemetry_id: string; message_id: string; pressure_bar: number; state: string; acknowledged: boolean };
const API = "http://127.0.0.1:8001";
const org = "670b979d-9e60-5207-a5d2-5d86ee70c71c";
const device = "a889c963-d1fd-59d5-9236-26d99820b927";
const feed = `/organizations/${org}/notifications`;
const noticePath = (id: string) => `${feed}/${id}`;
const detailCard = (page: Page) => page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Подія та прочитання", exact: true }) });
const incidentCard = (page: Page) => page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Стан інциденту", exact: true }) });

async function scenario(mode: "normal" | "alarm", alarmId?: string): Promise<Proof> {
  expect(process.env.KERUMO_RUN_NOTIFICATION_DEMO).toBe("1");
  expect(process.env.KERUMO_API_BASE_URL).toBe(API);
  const project = process.env.KERUMO_DEMO_COMPOSE_PROJECT;
  if (project !== "techbaza-demo" && project !== "techbaza-auth-ci") throw new Error("Expected isolated demo compose project");
  const root = resolve(process.cwd(), "..");
  const input = readFileSync(resolve(root, "scripts/stage13-mqtt-scenario.py"), "utf8");
  const args = ["compose", "-p", project, "--env-file", resolve(root, ".env.demo"), "-f", resolve(root, "compose.demo.yml"), "exec", "-T", "backend", "python", "-", mode, ...(alarmId ? [alarmId] : [])];
  return new Promise((resolveResult, reject) => {
    const child = execFile("docker", args, { cwd: root, timeout: 50_000, maxBuffer: 200_000 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(`Demo MQTT ${mode} failed: ${stderr || error.message}`)); return; }
      try { resolveResult(JSON.parse(stdout) as Proof); } catch (error) { reject(error); }
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

export async function checkNotificationIncident(page: Page, browser: Browser) {
  const viewerContext = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  try {
    await scenario("normal");
    const raised = await scenario("alarm");
    expect(raised.state).toBe("active"); expect(raised.acknowledged).toBe(false); expect(raised.pressure_bar).toBe(0.4);
    const incidentPath = `/alarms/devices/${device}/${raised.alarm_id}`;
    // Власник уже увійшов в inventory test: не створюємо додатковий owner login.
    const countPromise = page.waitForResponse((r) => r.url() === `${API}/api/v1/organizations/${org}/notifications/unread-count` && r.request().method() === "GET");
    await page.goto(feed);
    const countResponse = await countPromise; expect(countResponse.status()).toBe(200);
    const count = await countResponse.json() as { unread_count: number };
    await expect(page.getByText("Непрочитаних вами:")).toContainText(String(count.unread_count));
    await page.getByRole("table", { name: "Повідомлення організації" }).locator(`a[href="${noticePath(raised.notification_id)}"]`).click();
    await expect(detailCard(page)).toContainText("Не прочитано вами");
    const readPromise = page.waitForResponse((r) => r.url() === `${API}/api/v1/notifications/${raised.notification_id}/read` && r.request().method() === "POST");
    await page.getByRole("button", { name: "Позначити прочитаним" }).click();
    const readResponse = await readPromise; expect(readResponse.status()).toBe(200);
    const readReceipt = await readResponse.json() as { read_at: string };
    await expect(detailCard(page)).toContainText("Стан перевірено: повідомлення прочитане вами.");
    const reloadPromise = page.waitForResponse((r) => r.url() === `${API}/api/v1/notifications/${raised.notification_id}` && r.request().method() === "GET");
    await page.reload(); const reloaded = await (await reloadPromise).json() as Notice;
    expect(reloaded.read_at).toBe(readReceipt.read_at); expect(reloaded.kind).toBe("raised");
    await expect(page.getByRole("button", { name: "Позначити прочитаним" })).toHaveCount(0);
    const beforeAckPromise = page.waitForResponse((r) => r.url() === `${API}/api/v1/alarms/${raised.alarm_id}` && r.request().method() === "GET");
    await page.getByRole("link", { name: "До інциденту" }).click();
    const beforeAck = await (await beforeAckPromise).json() as Alarm;
    expect(beforeAck.state).toBe("active"); expect(beforeAck.acknowledged_at).toBeNull();

    const viewer = await viewerContext.newPage();
    await viewer.goto(`/login?returnTo=${encodeURIComponent(noticePath(raised.notification_id))}`);
    await viewer.getByLabel("Email").fill(process.env.KERUMO_VIEWER_EMAIL!);
    await viewer.getByLabel("Пароль").fill(process.env.KERUMO_VIEWER_PASSWORD!);
    await viewer.getByRole("button", { name: "Увійти" }).click();
    await expect(detailCard(viewer)).toContainText("Не прочитано вами");
    await viewer.getByRole("button", { name: "Позначити прочитаним" }).click();
    await expect(detailCard(viewer)).toContainText("Стан перевірено: повідомлення прочитане вами.");
    await viewer.getByRole("link", { name: "До інциденту" }).click();
    await expect(incidentCard(viewer)).toContainText("Без підтвердження");
    await expect(viewer.getByRole("button", { name: "Підтвердити отримання", exact: true })).toHaveCount(0);

    const incident = incidentCard(page);
    await incident.getByRole("button", { name: "Підтвердити отримання", exact: true }).click();
    const ackPromise = page.waitForResponse((r) => r.url() === `${API}/api/v1/alarms/${raised.alarm_id}/acknowledge` && r.request().method() === "POST");
    await page.getByRole("dialog").getByRole("button", { name: "Підтвердити отримання", exact: true }).click();
    const ackResponse = await ackPromise; expect(ackResponse.status()).toBe(200);
    const acknowledged = await ackResponse.json() as Alarm;
    expect(acknowledged.state).toBe("active"); expect(acknowledged.acknowledged_by_email).toBe(process.env.KERUMO_DEMO_EMAIL); expect(acknowledged.acknowledged_at).not.toBeNull();
    await expect(incident).toContainText(process.env.KERUMO_DEMO_EMAIL!);
    const recovered = await scenario("normal", raised.alarm_id);
    expect(recovered.state).toBe("resolved"); expect(recovered.acknowledged).toBe(true); expect(recovered.alarm_id).toBe(raised.alarm_id);
    expect(recovered.notification_id).not.toBe(raised.notification_id); expect(recovered.message_id).not.toBe(raised.message_id);
    await page.getByRole("button", { name: "Перевірити стан" }).click();
    await expect(incident.locator(".status-badge")).toContainText(["Попередження", "Усунена", "Підтверджена оператором"]);
    const history = page.getByRole("table", { name: "Переходи інциденту" });
    await expect(history).toContainText("Усунена"); await expect(history).toContainText("Підтверджена оператором"); await expect(history).toContainText("Виникла");
    await page.reload(); await expect(incident).toContainText(process.env.KERUMO_DEMO_EMAIL!); await expect(incident).toContainText("Усунена");
    await page.goto(noticePath(raised.notification_id)); await expect(detailCard(page).locator(".status-badge")).toContainText(["Виникла аварія", "Попередження", "Прочитано вами"]);
    await page.goto(noticePath(recovered.notification_id)); await expect(detailCard(page).locator(".status-badge")).toContainText(["Причину усунено", "Попередження", "Не прочитано вами"]);
    await expect(page.getByRole("link", { name: "До інциденту" })).toHaveAttribute("href", incidentPath);
    await page.getByRole("link", { name: "До повідомлень" }).click(); await page.getByLabel("Показати повідомлення", { exact: true }).selectOption("unread");
    const feedTable = page.getByRole("table", { name: "Повідомлення організації" });
    await expect(feedTable.locator(`a[href="${noticePath(recovered.notification_id)}"]`)).toBeVisible();
    await expect(feedTable.locator(`a[href="${noticePath(raised.notification_id)}"]`)).toHaveCount(0);
    console.log("PASS: MQTT telemetry -> rule event -> alarm -> notification -> personal owner/viewer reads -> owner ACK -> MQTT recovery; linked records", JSON.stringify({ raised, recovered }));
  } finally {
    await viewerContext.close();
    await scenario("normal");
  }
}
