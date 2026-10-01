"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Card, StatusBadge } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorDisplayMessage, apiQueryKeys, isApiError } from "@/lib/api";
import { statusLabels } from "@/lib/api/commands";
import { ScheduleRunSummary } from "./schedule-summary";
import { calendarDate, formatScheduleTime, newScheduleSpec, parseSchedule, parseScheduleHistory, parseSchedulePreview, parseSchedules, parseScheduleSpec, repeatLabels, type Schedule, type SchedulePreview, type ScheduleSpec, type ScheduleWrite } from "@/lib/api/schedules";
import type { ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import { ScheduleForm } from "./schedule-form";

const errorText = (error: unknown) => isApiError(error) ? apiErrorDisplayMessage(error) : error instanceof Error ? error.message : "Не вдалося виконати дію.";
const reasonLabels: Record<string, string> = {
  schedule_missed: "Час запуску пропущено", device_offline: "Контролер був offline", device_busy: "Пристрій був зайнятий",
  schedule_access_revoked: "Дозвіл автора відкликано", schedule_window_expired: "Час прийняття запуску минув",
  program_firmware_unavailable: "Немає свіжих даних або локального дозволу", schedule_firmware_unavailable: "Потрібне оновлення прошивки",
  program_active: "Виконується інший запуск", program_requires_stopped_device: "Зупинку пристрою не підтверджено",
  program_frequency_profile_changed: "Змінилися допустимі частоти", command_access_revoked: "Дозвіл запуску відкликано",
  program_cancelled: "Зупинено оператором", stop_before_dispatch: "Скасовано командою STOP до доставки",
};


function ScheduleHistory({ context, item, onCommand }: { context: ReadyAccessSnapshot; item: Schedule; onCommand: (id: string) => void }) {
  const { authorizedRequest } = useAuthSession();
  const query = usePanelQuery({ queryKey: [...apiQueryKeys.sessionRoot(context.scope), "schedule-runs", item.device_id, item.id], intervalMs: 15000,
    queryFn: async (signal) => parseScheduleHistory(await authorizedRequest<unknown>({ path: `/api/v1/devices/${item.device_id}/schedules/${item.id}/runs`, signal }), item.id) });
  return <section aria-label={`Запуски ${item.spec.name}`}><h3>Останні запуски: {item.spec.name}</h3>
    {query.isError ? <p role="alert">{errorText(query.error)}</p> : !query.data ? <p role="status">Завантажуємо історію…</p> : query.data.length === 0 ? <p>Запусків ще не було.</p> : <ul className="schedule-history">{query.data.map((run) => <li key={run.id}>
      <strong>{formatScheduleTime(run.starts_at, item.spec.timezone)}</strong><p>{run.status === "skipped" ? "Пропущено" : statusLabels[run.status] ?? "Потрібна перевірка"}{run.reason ? ` · ${reasonLabels[run.reason] ?? "Перевірте результат команди"}` : ""}</p>
      {run.command_id && <Button variant="ghost" onClick={() => onCommand(run.command_id!)}>Переглянути команду</Button>}
    </li>)}</ul>}
  </section>;
}

export function SchedulePanel({ context, limits, supported, onCommand }: { context: ReadyAccessSnapshot; limits: { min_hz: number; max_hz: number } | null; supported: boolean; onCommand: (id: string) => void }) {
  const { authorizedRequest } = useAuthSession();
  const device = context.activeDevice!;
  const timezone = context.activeSite?.timezone ?? "UTC";
  const canWrite = context.access.permissions.includes("command.execute");
  const canRead = context.access.permissions.includes("command.read");
  const base = `/api/v1/devices/${device.id}/schedules`;
  const query = usePanelQuery({ queryKey: [...apiQueryKeys.sessionRoot(context.scope), "schedules", device.id, context.activeOrganization.id], enabled: canRead, intervalMs: 30000,
    queryFn: async (signal) => parseSchedules(await authorizedRequest<unknown>({ path: base, signal }), device.id, context.activeOrganization.id) });
  const [draft, setDraft] = useState<ScheduleWrite | null>(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [confirmation, setConfirmation] = useState<ScheduleWrite | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Schedule | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);

  function edit(item?: Schedule) {
    setNotice(null); setPreview(null);
    setDraft(item ? { id: item.id, expected_revision: item.revision, enabled: item.enabled, spec: parseScheduleSpec(item.spec) }
      : { id: crypto.randomUUID(), expected_revision: 0, enabled: true, spec: newScheduleSpec(timezone, calendarDate(new Date(), timezone)) });
  }
  function change(spec: ScheduleSpec) { if (draft) { setDraft({ ...draft, spec }); setPreview(null); setNotice(null); } }
  async function action(kind: "preview" | "save", input: ScheduleWrite) {
    if (pending.current || !canWrite || !navigator.onLine) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setNotice(null);
    try {
      const raw = await authorizedRequest<unknown>({ path: kind === "preview" ? `${base}/preview` : `${base}/${input.id}`, method: kind === "preview" ? "POST" : "PUT", body: input, signal: controller.signal, retryOnUnauthorized: false });
      if (controller.signal.aborted) return;
      if (kind === "preview") setPreview(parseSchedulePreview(raw));
      else {
        const saved = parseSchedule(raw, device.id, context.activeOrganization.id);
        if (saved.id !== input.id || saved.revision !== input.expected_revision + 1 || saved.enabled !== input.enabled) throw new Error("Сервер повернув іншу ревізію розкладу. Оновіть список.");
        setDraft(null); setPreview(null); query.refresh();
        setNotice(saved.enabled ? "Розклад збережено й увімкнено. Прийом і виконання кожного запуску відображатимуться в історії." : "Майбутні запуски призупинено. Уже прийнятий запуск зупиняється окремою кнопкою STOP.");
      }
    } catch (error) {
      if (!controller.signal.aborted) setNotice(`${errorText(error)}${kind === "save" ? " Оновіть список перед повтором: сервер міг зберегти зміну." : ""}`);
    } finally {
      if (pending.current === controller) { pending.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  }
  return <Card title="Розклади пристрою" description={`Місцевий час об’єкта: ${timezone}. Під час запуску потрібні сервер, зв’язок і локальний дозвіл контролера.`}>
    {!supported && <p role="status">Збережений розклад потребує сумісної прошивки з підтримкою календарних запусків. До оновлення контролер не виконає його.</p>}
    <div className="ui-row">{canWrite && <Button disabled={busy} onClick={() => edit()}>Новий розклад</Button>}<Button disabled={!canRead || query.isFetching || !query.active} onClick={query.refresh}>Оновити розклади</Button></div>
    {query.isError ? <p role="alert">{errorText(query.error)}</p> : canRead && !query.data ? <p role="status">Завантажуємо розклади…</p> : query.data?.length === 0 ? <p>Розкладів ще немає.</p> : <ul className="schedule-list">{query.data?.map((item) => <li key={item.id}>
      <div className="ui-row"><strong>{item.spec.name}</strong><StatusBadge tone={item.enabled && item.next_start_at ? "info" : "neutral"}>{!item.enabled ? "Призупинено" : item.next_start_at ? "Увімкнено" : "Період завершено"}</StatusBadge></div>
      <p>{repeatLabels[item.spec.repeat ?? "once"]} · {item.spec.start_time.slice(0, 5)} → {item.spec.stop_time.slice(0, 5)}{item.spec.stop_day_offset ? " наступного дня" : ""} · {item.spec.frequency_hz} Гц{item.spec.changes?.length ? ` · змін частоти: ${item.spec.changes.length}` : ""}</p>
      {item.next_start_at && <p>Найближчий запуск: <strong>{formatScheduleTime(item.next_start_at, item.spec.timezone)}</strong></p>}
      <div className="ui-row">{canWrite && <><Button disabled={busy} onClick={() => edit(item)}>Змінити</Button><Button disabled={busy} onClick={() => setConfirmation({ id: item.id, expected_revision: item.revision, spec: item.spec, enabled: !item.enabled })}>{item.enabled ? "Призупинити" : "Увімкнути"}</Button></>}<Button onClick={() => setHistory(item)}>Історія запусків</Button></div>
    </li>)}</ul>}
    {draft && <section className="schedule-editor" aria-label="Редактор розкладу"><ScheduleForm value={draft.spec as ScheduleSpec} onChange={change} disabled={busy} limits={limits} />
      <div className="ui-row"><Button disabled={busy || !query.active} onClick={() => void action("preview", draft)}>Перевірити найближчі запуски</Button><Button disabled={busy} variant="ghost" onClick={() => { setDraft(null); setPreview(null); }}>Закрити редактор</Button></div>
      {preview && <section className="schedule-preview" aria-label="Попередній перегляд розкладу"><h3>Найближчі запуски</h3>
        {preview.runs.length === 0 ? <p>У цьому періоді немає майбутніх коректних запусків.</p> : <ol>{preview.runs.map((run) => <li key={run.starts_at}>{formatScheduleTime(run.starts_at, draft.spec.timezone)} → {formatScheduleTime(run.stops_at, draft.spec.timezone)}</li>)}</ol>}
        {preview.runs[0] && <details><summary>Частоти першого запуску</summary><ScheduleRunSummary run={preview.runs[0]} timezone={draft.spec.timezone} /></details>}
        {preview.conflicts.length > 0 && <p role="alert">Є перетин з іншим увімкненим розкладом. Змініть час або призупиніть інший розклад.</p>}
        <p className="help-copy">Пропущена година не запускається; повторна — лише один раз. Перетини перевірено на 366 днів. Прострочені запуски не наздоганяються.</p>
        <Button variant="primary" disabled={busy || preview.runs.length === 0 || preview.conflicts.length > 0} onClick={() => setConfirmation({ ...draft, enabled: true })}>Зберегти та увімкнути</Button>
      </section>}
    </section>}
    {busy && <p role="status">Обробляємо розклад…</p>}{notice && <p role="status">{notice}</p>}
    {history && canRead && <ScheduleHistory key={history.id} context={context} item={history} onCommand={onCommand} />}
    <ConfirmDialog open={!!confirmation} title={confirmation?.enabled ? "Увімкнути розклад?" : "Призупинити розклад?"} description={device.name} confirmLabel={confirmation?.enabled ? "Підтвердити розклад" : "Призупинити майбутні запуски"} confirmDisabled={busy || !query.active} onConfirm={() => { if (confirmation) void action("save", confirmation); }} onClose={() => setConfirmation(null)}>
      <p><strong>{confirmation?.spec.name}</strong> · {confirmation?.spec.timezone}</p>
      <p>{confirmation?.enabled ? "Розклад дозволяє автоматичні запуски в обрані дати навіть після закриття сайту або виходу з облікового запису. Втрата зв’язку чи перезапуск контролера переривають роботу без автоматичного продовження." : "Це припиняє майбутні запуски. Для вже прийнятого запуску використайте STOP."}</p>
      {confirmation && <p>{confirmation.spec.start_date} — {confirmation.spec.until_date} · {confirmation.spec.start_time.slice(0, 5)} → {confirmation.spec.stop_time.slice(0, 5)}{confirmation.spec.stop_day_offset ? " наступного дня" : ""} · {confirmation.spec.frequency_hz} Гц</p>}
    </ConfirmDialog>
  </Card>;
}
