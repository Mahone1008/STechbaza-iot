"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Card, TextField } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";
import { apiErrorDisplayMessage, isApiError } from "@/lib/api";
import { commandLabel, makeCommandInput, parseCommandReceipt, validFrequency, type CommandInput, type CommandType } from "@/lib/api/commands";
import { parseOverview, type Overview } from "@/lib/api/overview";

type Intent = Readonly<{ input: CommandInput; deadline: number }>;
type Uncertain = Readonly<{ intent: Intent; retryAt: number; message: string }>;
type Dialog = { kind: "new"; type: CommandType } | { kind: "retry" } | { kind: "discard" };
// Read only from event handlers/effects, never while rendering controls.
function monotonicNow() { return performance.now(); }
function availableBrowser() { return navigator.onLine && document.visibilityState !== "hidden"; }

export function CommandControls({ context, overview, receivedAt, active, refreshing, onCreated }: {
  context: ReadyAccessSnapshot; overview: Overview | null; receivedAt: number; active: boolean; refreshing: boolean; onCreated: (id: string) => void;
}) {
  const { authorizedRequest } = useAuthSession();
  const device = context.activeDevice!;
  const [frequency, setFrequency] = useState("");
  const [ttl, setTtl] = useState("30");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<Uncertain | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const canExecute = context.access.permissions.includes("command.execute");
  useEffect(() => {
    mounted.current = true;
    const update = () => { setNow(monotonicNow()); if (!availableBrowser()) pending.current?.abort(); };
    const timer = window.setInterval(update, 1000);
    window.addEventListener("offline", update); document.addEventListener("visibilitychange", update);
    return () => { mounted.current = false; pending.current?.abort(); window.clearInterval(timer); window.removeEventListener("offline", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  const elapsed = Math.max(0, (now - receivedAt) / 1000);
  const online = overview?.availability.online && overview.availability.seconds_since_seen !== null && overview.availability.seconds_since_seen + elapsed <= overview.availability.timeout_seconds;
  const validTtl = ttl.trim() !== "" && Number.isInteger(Number(ttl)) && Number(ttl) >= 5 && Number(ttl) <= 300;
  const permitted = (type: CommandType) => canExecute && !!overview?.allowedCommands.includes(type) && (type === "vfd.stop" || online);
  const enabled = (type: CommandType) => permitted(type) && active && !refreshing && !busy && !uncertain && validTtl && (type !== "vfd.frequency.set" || validFrequency(frequency) !== null);
  const retryEnabled = !!uncertain && permitted(uncertain.intent.input.command_type) && active && !refreshing && !busy && now < uncertain.intent.deadline && now >= uncertain.retryAt;

  async function handleSend(intent: Intent, previous: Uncertain | null) {
    // Synchronous guard also covers two clicks before React commits busy state.
    if (pending.current || !canExecute || !availableBrowser() || monotonicNow() >= intent.deadline) return;
    const controller = new AbortController(); pending.current = controller;
    const timer = window.setTimeout(() => controller.abort(), Math.max(0, intent.deadline - monotonicNow()));
    setBusy(true); setNotice(null);
    let postStarted = false;
    try {
      const raw = await authorizedRequest<unknown>({ path: `/api/v1/devices/${device.id}/overview`, signal: controller.signal, timeoutMs: 10_000 });
      const fresh = parseOverview(raw, device, context.activeOrganization.id);
      if (!fresh.allowedCommands.includes(intent.input.command_type)) throw new Error("Команда більше недоступна. Оновіть панель та права доступу.");
      if (intent.input.command_type !== "vfd.stop" && !fresh.availability.online) throw new Error("Пристрій offline. Запуск і зміна частоти не надсилаються.");
      if (controller.signal.aborted || !availableBrowser() || monotonicNow() >= intent.deadline) throw new Error("Надсилання скасовано до POST. Команду не поставлено в локальну чергу.");
      postStarted = true;
      const response = await authorizedRequest<unknown>({ path: `/api/v1/devices/${device.id}/commands`, method: "POST", body: intent.input, signal: controller.signal, timeoutMs: 10_000, retryOnUnauthorized: false });
      const command = parseCommandReceipt(response, device.id, context.activeOrganization.id, context.scope.userId, intent.input);
      if (controller.signal.aborted) throw new Error("Очікування відповіді перервано.");
      if (!mounted.current) return;
      setUncertain(null); setNotice("Сервер прийняв команду. Перевіряємо повідомлення контролера нижче."); onCreated(command.id);
    } catch (error) {
      if (!mounted.current) return;
      const message = isApiError(error) ? apiErrorDisplayMessage(error) : error instanceof Error ? error.message : "Не вдалося надіслати команду.";
      const definitelyRejected = isApiError(error) && ["unauthorized", "forbidden", "not-found", "conflict", "validation"].includes(error.kind);
      if (previous || (postStarted && !definitelyRejected)) {
        setUncertain({ intent, message, retryAt: monotonicNow() + (isApiError(error) && error.kind === "rate-limited" ? (error.retryAfterSeconds ?? 30) * 1000 : 0) });
      } else setNotice(message);
    } finally {
      window.clearTimeout(timer);
      if (pending.current === controller) pending.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  function handleConfirm() {
    if (!dialog) return;
    if (dialog.kind === "discard") { setUncertain(null); setNotice("Попередню команду не скасовано. Перевірте її в журналі перед новою дією."); return; }
    if (dialog.kind === "retry") { if (retryEnabled && uncertain) void handleSend(uncertain.intent, uncertain); return; }
    if (!enabled(dialog.type)) return;
    const input = makeCommandInput(dialog.type, frequency, Number(ttl), crypto.randomUUID());
    void handleSend({ input, deadline: monotonicNow() + Number(ttl) * 1000 }, null);
  }
  if (!canExecute && !uncertain) return null;
  const selectedType = dialog?.kind === "new" ? dialog.type : uncertain?.intent.input.command_type;
  const selectedFrequency = dialog?.kind === "new" ? validFrequency(frequency) : uncertain?.intent.input.payload?.frequency_hz;
  return <Card title="Керування пристроєм" description="Кожну команду потрібно підтвердити. Після втрати мережі запуск і частота автоматично не надсилаються.">
    {!overview ? <p>Для керування потрібна актуальна панель.</p> : overview.allowedCommands.length === 0 ? <p>Для цього пристрою немає дозволених команд.</p> : <>
      <div className="history-controls"><TextField label="TTL прийому, с" type="number" min={5} max={300} step={1} value={ttl} disabled={busy || !!uncertain} onChange={(event) => setTtl(event.target.value)} hint="5–300 с на прийом контролером. Типово 30 с." />
        {overview.allowedCommands.includes("vfd.frequency.set") && <TextField label="Задана частота, Гц" type="number" min={0} max={100} step="any" value={frequency} disabled={busy || !!uncertain} onChange={(event) => setFrequency(event.target.value)} hint="Межі протоколу: 0–100 Гц. Робочі межі визначає обладнання." />}</div>
      <div className="ui-row">{(["vfd.start", "vfd.stop", "vfd.frequency.set"] as const).filter((type) => overview.allowedCommands.includes(type)).map((type) => <Button key={type} variant={type === "vfd.stop" ? "danger" : "primary"} disabled={!enabled(type)} onClick={() => setDialog({ kind: "new", type })}>{commandLabel(type)}</Button>)}</div>
      {!online && <p>Запуск і зміна частоти недоступні без актуального зв’язку. Зупинка може очікувати доставки на сервері до завершення TTL; фізична зупинка не гарантована.</p>}
    </>}
    {busy && <p role="status">Перевіряємо доступ і надсилаємо команду…</p>}
    {notice && <p role="status">{notice}</p>}
    {uncertain && <section className="notice notice-warning" role="alert"><h3>Прийом команди не підтверджено</h3><p>{uncertain.message}</p><p>Сервер міг прийняти запит. Спочатку перевірте журнал. Повтор надсилає той самий запит і не створює нової команди, якщо його вже прийнято.</p>
      <p>{now >= uncertain.intent.deadline ? "Час ручного повтору минув. Перевірте журнал команд." : `Ручний повтор доступний ще ${Math.max(0, Math.ceil((uncertain.intent.deadline - now) / 1000))} с.`}</p>
      {now < uncertain.retryAt && <p>Сервер обмежив частоту запитів. Зачекайте {Math.ceil((uncertain.retryAt - now) / 1000)} с.</p>}
      <div className="ui-row"><Button disabled={!retryEnabled} onClick={() => setDialog({ kind: "retry" })}>Повторити той самий запит</Button><Button disabled={busy} onClick={() => setDialog({ kind: "discard" })}>Завершити перевірку запиту</Button></div>
      <details><summary>Ідентифікатор запиту</summary><code>{uncertain.intent.input.request_id}</code></details>
    </section>}
    <ConfirmDialog open={!!dialog} title={dialog?.kind === "discard" ? "Завершити перевірку?" : "Підтвердити команду"} description={dialog?.kind === "discard" ? "Це не скасовує команду на сервері. Нова дія матиме інший ідентифікатор. Перед нею перевірте журнал і стан обладнання." : `${device.name} · ${device.uid}`} confirmLabel={dialog?.kind === "discard" ? "Перевірку завершено" : dialog?.kind === "retry" ? "Підтвердити повтор" : "Надіслати команду"} confirmVariant={selectedType === "vfd.stop" ? "danger" : "primary"} confirmDisabled={dialog?.kind === "new" ? !enabled(dialog.type) : dialog?.kind === "retry" ? !retryEnabled : busy} onConfirm={() => handleConfirm()} onClose={() => setDialog(null)}>
      {dialog?.kind !== "discard" && <><p><strong>{selectedType ? commandLabel(selectedType) : ""}</strong>{selectedType === "vfd.frequency.set" ? ` · ${selectedFrequency} Гц` : ""}</p><p>TTL прийому: {dialog?.kind === "retry" ? uncertain?.intent.input.ttl_seconds : ttl} с.</p><p>Відповідь сервера підтверджує реєстрацію запиту; виконання перевіряється окремо.</p>{selectedType === "vfd.stop" && !online && <p>Пристрій offline: команда чекатиме доставки до завершення TTL. Фізичну зупинку ще не підтверджено.</p>}</>}
    </ConfirmDialog>
  </Card>;
}
