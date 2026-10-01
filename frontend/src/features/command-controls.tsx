"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Card, TextField } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";
import { apiErrorDisplayMessage, isApiError } from "@/lib/api";
import { commandLabel, makeCommandInput, parseCommandReceipt, validFrequency, type CommandInput, type CommandType } from "@/lib/api/commands";
import { ProgramSettings, ProgramPlanSummary, draftPlan, emptyProgramStep, type WorkMode, type ProgramDraft } from "./program-settings";
import { durationText, parseProgramPlan, programActive, programWithinLimits } from "@/lib/api/programs";
import { controlBlockReason, effectiveQuality, parseOverview, type Overview } from "@/lib/api/overview";

type Intent = Readonly<{ input: CommandInput; deadline: number }>;
type Uncertain = Readonly<{ intent: Intent; retryAt: number; message: string }>;
type Dialog = { kind: "new"; type: CommandType } | { kind: "retry" } | { kind: "discard" };
// Read only from event handlers/effects, never while rendering controls.
function monotonicNow() { return performance.now(); }
function availableBrowser() { return navigator.onLine && document.visibilityState !== "hidden"; }

export function CommandControls({ context, overview, receivedAt, active, refreshing, onCreated, onSchedules }: {
  context: ReadyAccessSnapshot; overview: Overview | null; receivedAt: number; active: boolean; refreshing: boolean; onCreated: (id: string) => void; onSchedules: () => void;
}) {
  const { authorizedRequest } = useAuthSession();
  const device = context.activeDevice!;
  const [frequency, setFrequency] = useState("");
  const [ttl, setTtl] = useState("30");
  const [mode, setMode] = useState<WorkMode>("manual");
  const [steps, setSteps] = useState<ProgramDraft[]>([emptyProgramStep(0)]);
  const nextStep = useRef(1);
  const plan = draftPlan(mode, steps);
  const programSupported = !!overview?.allowedCommands.includes("vfd.program.start") && !!overview.diagnostics?.program;
  const programRunning = programActive(overview?.diagnostics?.program);
  const programValid = !!plan && programWithinLimits(plan, overview?.frequencyLimits ?? null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busyType, setBusyType] = useState<CommandType | null>(null);
  const busy = busyType !== null;
  const [uncertain, setUncertain] = useState<Uncertain | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const pendingIntent = useRef<Intent | null>(null);
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
  const blockedReason = overview ? controlBlockReason(overview, elapsed) : null;
  const validTtl = ttl.trim() !== "" && Number.isInteger(Number(ttl)) && Number(ttl) >= 5 && Number(ttl) <= 300;
  const permitted = (type: CommandType) => canExecute && !!overview?.allowedCommands.includes(type) && (type === "vfd.stop" || (online && !blockedReason && !programRunning));
  const limits = overview?.frequencyLimits;
  const hz = validFrequency(frequency);
  const frequencyValid = !!limits && hz !== null && hz >= limits.min_hz && hz <= limits.max_hz;
  const programReady = programSupported && overview?.diagnostics?.program?.ready && !!overview && effectiveQuality(overview.freshness.status, overview.freshness, elapsed) === "fresh";
  const runState = overview?.modules.flatMap((module) => module.channels).find((channel) => channel.key === "pump_running" && channel.source === "state");
  const programStopped = !!overview && runState?.value === false && effectiveQuality(runState.status, overview.freshness, elapsed) === "fresh";
  const enabled = (type: CommandType) => permitted(type) && active && (type === "vfd.stop" ? busyType !== "vfd.stop" : !refreshing && !busy && !uncertain && validTtl && (type !== "vfd.frequency.set" || frequencyValid) && (type !== "vfd.program.start" || (programReady && programStopped && programValid)));
  const retryEnabled = !!uncertain && permitted(uncertain.intent.input.command_type) && active && !refreshing && !busy && now < uncertain.intent.deadline && now >= uncertain.retryAt;

  async function handleSend(intent: Intent, previous: Uncertain | null) {
    // Synchronous guard also covers two clicks before React commits busy state.
    if (!canExecute || !availableBrowser() || monotonicNow() >= intent.deadline) return;
    const interrupted = pendingIntent.current;
    if (pending.current) {
      if (intent.input.command_type !== "vfd.stop" || pendingIntent.current?.input.command_type === "vfd.stop") return;
      pending.current.abort();
    }
    const controller = new AbortController(); pending.current = controller; pendingIntent.current = intent;
    const timer = window.setTimeout(() => controller.abort(), Math.max(0, intent.deadline - monotonicNow()));
    setBusyType(intent.input.command_type); setNotice(null);
    if (intent.input.command_type === "vfd.stop" && interrupted) setUncertain({ intent: interrupted, retryAt: 0, message: "Очікування попереднього запиту перервано для Stop; його прийом потребує перевірки." });
    let postStarted = false;
    try {
      const raw = await authorizedRequest<unknown>({ path: `/api/v1/devices/${device.id}/overview`, signal: controller.signal, timeoutMs: 10_000 });
      const fresh = parseOverview(raw, device, context.activeOrganization.id);
      if (!fresh.allowedCommands.includes(intent.input.command_type)) throw new Error("Команда більше недоступна. Оновіть панель та права доступу.");
      if (intent.input.command_type !== "vfd.stop" && !fresh.availability.online) throw new Error("Пристрій offline. Запуск і зміна частоти не надсилаються.");
      const freshBlock = controlBlockReason(fresh);
      if (intent.input.command_type !== "vfd.stop" && freshBlock) throw new Error(freshBlock);
      if (intent.input.command_type !== "vfd.stop" && programActive(fresh.diagnostics?.program) && !previous) throw new Error("Програма вже виконується. Спочатку зупиніть її кнопкою STOP.");
      if (intent.input.command_type === "vfd.program.start") {
        const submitted = parseProgramPlan(intent.input.payload);
        if (!fresh.diagnostics?.program?.ready || fresh.freshness.status !== "fresh") throw new Error("Очікуємо свіжу телеметрію та локальний дозвіл програм на контролері.");
        if (!submitted || !programWithinLimits(submitted, fresh.frequencyLimits)) throw new Error("Частоти етапів поза налаштованими межами обладнання.");
      }
      if (intent.input.command_type === "vfd.frequency.set") {
        const value = Number(intent.input.payload?.frequency_hz), profile = fresh.frequencyLimits;
        if (!profile || value < profile.min_hz || value > profile.max_hz) throw new Error("Частота поза налаштованими межами обладнання. Оновіть панель.");
      }
      if (controller.signal.aborted || !availableBrowser() || monotonicNow() >= intent.deadline) throw new Error("Надсилання скасовано до POST. Команду не поставлено в локальну чергу.");
      postStarted = true;
      const response = await authorizedRequest<unknown>({ path: `/api/v1/devices/${device.id}/commands`, method: "POST", body: intent.input, signal: controller.signal, timeoutMs: 10_000, retryOnUnauthorized: false });
      const command = parseCommandReceipt(response, device.id, context.activeOrganization.id, context.scope.userId, intent.input);
      if (controller.signal.aborted) throw new Error("Очікування відповіді перервано.");
      if (!mounted.current || pending.current !== controller) return;
      setUncertain(null); setNotice("Сервер прийняв команду. Перевіряємо повідомлення контролера нижче."); onCreated(command.id);
    } catch (error) {
      if (!mounted.current || pending.current !== controller) return;
      const message = isApiError(error) ? apiErrorDisplayMessage(error) : error instanceof Error ? error.message : "Не вдалося надіслати команду.";
      const definitelyRejected = isApiError(error) && ["unauthorized", "forbidden", "not-found", "conflict", "validation"].includes(error.kind);
      if (previous || (postStarted && !definitelyRejected)) {
        setUncertain({ intent, message, retryAt: monotonicNow() + (isApiError(error) && error.kind === "rate-limited" ? (error.retryAfterSeconds ?? 30) * 1000 : 0) });
      } else setNotice(message);
    } finally {
      window.clearTimeout(timer);
      if (pending.current === controller) {
        pending.current = null; pendingIntent.current = null;
        if (mounted.current) setBusyType(null);
      }
    }
  }
  function handleConfirm() {
    if (!dialog) return;
    if (dialog.kind === "discard") { setUncertain(null); setNotice("Попередню команду не скасовано. Перевірте її в журналі перед новою дією."); return; }
    if (dialog.kind === "retry") { if (retryEnabled && uncertain) void handleSend(uncertain.intent, uncertain); return; }
    if (!enabled(dialog.type)) return;
    const seconds = validTtl ? Number(ttl) : 30;
    const input = makeCommandInput(dialog.type, frequency, seconds, crypto.randomUUID(), plan);
    if (dialog.type === "vfd.stop") {
      const prior = pendingIntent.current ?? uncertain?.intent;
      if (prior) input.supersedes_request_id = prior.input.supersedes_request_id ?? prior.input.request_id;
    }
    void handleSend({ input, deadline: monotonicNow() + seconds * 1000 }, null);
  }
  if (!canExecute && !uncertain) return null;
  const selectedType = dialog?.kind === "new" ? dialog.type : uncertain?.intent.input.command_type;
  const selectedFrequency = dialog?.kind === "new" ? validFrequency(frequency) : uncertain?.intent.input.payload?.frequency_hz;
  const selectedPlan = selectedType === "vfd.program.start" ? dialog?.kind === "retry" ? parseProgramPlan(uncertain?.intent.input.payload) : plan : null;
  const duration = plan?.steps.reduce((sum, step) => sum + step.duration_seconds, 0) ?? 0;
  return <Card title="Керування пристроєм" description="Кожну команду потрібно підтвердити. Після втрати мережі запуск і частота автоматично не надсилаються.">
    {!overview ? <p>Для керування потрібна актуальна панель.</p> : overview.allowedCommands.length === 0 ? <p>Для цього пристрою немає дозволених команд.</p> : <>
      <details><summary>Додаткові налаштування команди</summary><div className="history-controls"><TextField label="Час на прийняття команди, с" type="number" min={5} max={300} step={1} value={ttl} disabled={busy || !!uncertain} onChange={(event) => setTtl(event.target.value)} hint="Типово 30 с, дозволено 5–300 с. Після цього контролер не починає нове виконання. Це не тривалість роботи насоса." /></div>
        {!programRunning && <ProgramSettings mode={mode} onMode={(next) => { setMode(next); if (next === "schedule") onSchedules(); }} rows={steps} onRows={setSteps} onAdd={() => { const row = emptyProgramStep(nextStep.current++); setSteps((rows) => [...rows, row]); }} disabled={busy || !!uncertain} supported={programSupported} scheduleSupported={!!overview?.allowedCommands.includes("vfd.schedule.start")} limits={limits ?? null} />}
      </details>
      {(mode === "timer" || mode === "program") && !programRunning && <p className="program-mode-notice"><strong>{mode === "timer" ? "За таймером" : `За етапами · етапів: ${steps.length}`}</strong>{programValid ? ` · ${durationText(duration)} на заданих частотах; потім STOP.` : " · перевірте частоти та тривалість у додаткових налаштуваннях."}</p>}
      {(mode === "timer" || mode === "program") && programSupported && !programReady && !programRunning && <p className="help-copy">Очікуємо свіжі дані та локальний дозвіл програм на контролері.</p>}
      {mode === "schedule" && <p>Календар і збережені правила — нижче. <Button variant="ghost" onClick={onSchedules}>Відкрити розклади</Button></p>}
      {programRunning && <p role="status">За останніми даними програма виконується або зупиняється. {context.access.permissions.includes("command.read") && "План відкривається через «Переглянути етапи роботи» нижче. "}Редагування, зміна частоти й новий запуск — після зупинки.</p>}
      {(mode === "timer" || mode === "program") && !programRunning && !programStopped && <p className="help-copy">Перед запуском програми потрібна підтверджена зупинка частотника.</p>}
      <div className="history-controls">
        {mode === "manual" && !programRunning && overview.allowedCommands.includes("vfd.frequency.set") && <TextField label="Задана частота, Гц" type="number" min={limits?.min_hz} max={limits?.max_hz} step="any" value={frequency} disabled={busy || !!uncertain || !limits} onChange={(event) => setFrequency(event.target.value)} hint={limits ? `Робочі межі пристрою: ${limits.min_hz}–${limits.max_hz} Гц.` : "Спочатку налаштуйте допустимі межі частоти обладнання."} />}</div>
      <div className="ui-row">{(mode === "timer" || mode === "program") && <Button disabled={!enabled("vfd.program.start")} onClick={() => setDialog({ kind: "new", type: "vfd.program.start" })}>{mode === "timer" && programValid ? `Запустити на ${durationText(duration)}` : "Запустити за етапами"}</Button>}{(["vfd.start", "vfd.stop", "vfd.frequency.set"] as const).filter((type) => overview.allowedCommands.includes(type) && (mode === "manual" || type === "vfd.stop")).map((type) => <Button key={type} variant={type === "vfd.stop" ? "danger" : "primary"} disabled={!enabled(type)} onClick={() => setDialog({ kind: "new", type })}>{commandLabel(type)}</Button>)}</div>
      {!online && <p>Запуск і зміна частоти недоступні без актуального зв’язку. Зупинка може очікувати доставки на сервері до завершення TTL; фізична зупинка не гарантована.</p>}
      {online && blockedReason && <p role="status">{blockedReason} Команда зупинки залишається доступною.</p>}
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
      {selectedPlan && <ProgramPlanSummary plan={selectedPlan} />}
      {dialog?.kind !== "discard" && <><p><strong>{selectedType ? commandLabel(selectedType) : ""}</strong>{selectedType === "vfd.frequency.set" ? ` · ${selectedFrequency} Гц` : ""}</p><p>Час на прийняття команди: {dialog?.kind === "retry" ? uncertain?.intent.input.ttl_seconds : validTtl ? ttl : 30} с.</p><p>Відповідь сервера підтверджує реєстрацію запиту; виконання перевіряється окремо.</p>{selectedType === "vfd.stop" && !online && <p>Пристрій offline: команда чекатиме доставки до завершення TTL. Фізичну зупинку ще не підтверджено.</p>}{selectedType === "vfd.stop" && (busy || uncertain) && <p>Stop припинить доставку попереднього запиту. Уже розпочату дію потрібно перевірити за відповіддю контролера та телеметрією.</p>}</>}
    </ConfirmDialog>
  </Card>;
}
