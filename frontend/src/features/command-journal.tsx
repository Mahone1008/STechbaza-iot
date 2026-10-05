"use client";
import { ProgramPlanSummary } from "./program-settings";
import { parseScheduleRun } from "@/lib/api/schedules";
import { ScheduleRunSummary } from "./schedule-summary";
import { parseProgramPlan } from "@/lib/api/programs";
import { useState } from "react";
import type { PollSeconds } from "@/lib/api/polling-policy";
import { Button, Card, DataTable, StatusBadge } from "@/components/ui";
import { StableRegion } from "@/components/stable-region";
import { useAuthSession } from "./auth-session";
import type { ReadyAccessSnapshot } from "./access-context";
import { usePanelQuery } from "./use-panel-query";
import { apiErrorDisplayMessage, apiQueryKeys, organizationRoleLabel } from "@/lib/api";
import type { OrganizationRole } from "@/lib/api/access";
import { formatSeen } from "@/lib/api/inventory";
import { commandCursor, commandLabel, commandPending, parseCommand, parseCommandPage, statusLabels, type Command, type CommandCursor } from "@/lib/api/commands";

function CommandStatus({ command }: { command: Command }) {
  return <StatusBadge tone={command.status === "succeeded" ? "success" : command.status === "failed" ? "danger" : commandPending(command) ? "info" : "warning"}>{command.error_code === "program_cancelled" ? "Програму скасовано оператором" : command.command_type === "vfd.program.start" && command.status === "succeeded" ? "Програму завершено, STOP підтверджено" : statusLabels[command.status]}</StatusBadge>;
}
export function CommandDetail({ context, id, poll }: { context: ReadyAccessSnapshot; id: string; poll: PollSeconds }) {
  const { authorizedRequest } = useAuthSession();
  const [openedAt] = useState(() => performance.now());
  const device = context.activeDevice!;
  const query = usePanelQuery({
    queryKey: [...apiQueryKeys.command(context.scope, id), context.activeOrganization.id, device.id], intervalMs: poll * 1000,
    pollWhile: (data: Command) => commandPending(data) && performance.now() - openedAt < 600_000,
    queryFn: async (signal) => parseCommand(await authorizedRequest({ path: `/api/v1/commands/${id}`, signal, timeoutMs: 10_000 }), device.id, context.activeOrganization.id, id),
  });
  const command = query.data;
  const scheduled = command?.command_type === "vfd.schedule.start" ? parseScheduleRun(command.payload) : null;
  const program = scheduled ?? (command?.command_type === "vfd.program.start" ? parseProgramPlan(command.payload) : null);
  const time = (value: string | null) => value ? formatSeen(value, context.activeSite?.timezone ?? "UTC") : "Ще немає";
  return <Card title="Стан вибраної команди" description="Це окрема команда з журналу. Перемикання режиму вище не змінює її стан." actions={<Button disabled={!query.active || query.isFetching} onClick={query.refresh}>Оновити стан команди</Button>}>
    <StableRegion>
      {query.isError ? <p role="alert">{apiErrorDisplayMessage(query.error)}</p> : !command ? <p role="status">Завантажуємо команду…</p> : <>
        <p><strong>{commandLabel(command.command_type)}</strong>{typeof command.payload.frequency_hz === "number" ? ` · ${command.payload.frequency_hz} Гц` : ""}</p>
        {scheduled ? <ScheduleRunSummary run={scheduled} timezone={context.activeSite?.timezone ?? "UTC"} /> : program && <ProgramPlanSummary plan={program} />}
        <div role="status"><CommandStatus command={command} /></div>
        <p className="help-copy">Прийом сервером і підтвердження прийому контролером не означають фізичного виконання. Зіставляйте результат із показаннями пристрою.</p>
        {command.status === "result_unknown" && <p className="notice notice-warning">Контролер не надіслав результат вчасно. Автоматичного повтору немає. Пізній результат можна перевірити кнопкою оновлення.</p>}
        <ol className="command-lifecycle">
          <li>Сервер прийняв: {time(command.created_at)}</li>
          <li>Перша спроба доставки: {time(command.published_at)}</li>
          <li>Контролер підтвердив прийом: {time(command.acknowledged_at)}</li>
          <li>Завершення обробки: {time(command.completed_at)}</li>
        </ol>
        <p>Час на прийняття команди: {command.ttl_seconds} с · до {time(command.expires_at)}. Це не тривалість роботи насоса. Запізнілі відповіді зберігаються в журналі.</p>
        {command.result_deadline_at && commandPending(command) && <p>Очікування результату: до {time(command.result_deadline_at)}.</p>}
        {command.result_timed_out_at && <p>Результат став невідомим: {time(command.result_timed_out_at)}.</p>}
        {program && typeof command.result.steps_completed === "number" && <p>Завершених етапів: {command.result.steps_completed} з {program.steps.length}. Зупинка: {command.result.stop_confirmed === true ? "підтверджена контролером" : "не підтверджена"}.</p>}
        {command.error_message && <p role="alert">{command.error_code === "program_cancelled" ? "Програму перервано запитом оператора; наступні етапи скасовано." : command.error_code === "program_transition_timeout" ? "Частотник не досяг заданої частоти за 60 с. Перевірте налаштування розгону та результат зупинки." : command.error_code === "program_invalid" ? "Програма не відповідає можливостям або локальному режиму контролера." : command.error_code === "not_armed" ? "Локальний дозвіл керування вимкнено. Перевірте причину зупинки та відновіть дозвіл на контролері." : command.error_message}</p>}
        <details><summary>Автор та виконання</summary><dl className="overview-details command-audit">
          <div><dt>Автор</dt><dd>{command.actor_display_name ?? "Невідомий"} · {command.actor_email ?? "Email не збережено"}</dd></div>
          <div><dt>Роль під час запиту</dt><dd>{organizationRoleLabel(command.actor_organization_role as OrganizationRole | null, command.actor_platform_role ?? "user")}</dd></div>
          <div><dt>Спроби доставки</dt><dd>{command.publish_attempts}</dd></div><div><dt>Остання спроба</dt><dd>{time(command.last_publish_attempt_at)}</dd></div>
          <div><dt>Останнє оновлення</dt><dd>{time(command.updated_at)}</dd></div>
        </dl></details>
        <p className="help-copy">{poll > 0 && commandPending(command) ? `Один вибраний запис перевіряється кожні ${poll} с, до 10 хвилин; після помилок інтервал збільшується.` : "Стан можна перевірити вручну."}</p>
      </>}
    </StableRegion>
  </Card>;
}
export function CommandJournal({ context, onSelect, poll }: { context: ReadyAccessSnapshot; onSelect: (id: string) => void; poll: PollSeconds }) {
  const { authorizedRequest } = useAuthSession();
  const [pages, setPages] = useState<(CommandCursor | null)[]>([null]);
  const [revision, setRevision] = useState(0);
  const cursor = pages.at(-1)!;
  const device = context.activeDevice!;
  const query = usePanelQuery({
    queryKey: [...apiQueryKeys.deviceCommands(context.scope, device.id, pages.length), context.activeOrganization.id, cursor, revision],
    intervalMs: pages.length === 1 ? poll * 1000 : 0,
    queryFn: async (signal) => parseCommandPage(await authorizedRequest({ path: `/api/v1/devices/${device.id}/commands`, query: { limit: 21, ...(cursor ?? {}) }, signal, timeoutMs: 10_000 }), device.id, context.activeOrganization.id, cursor),
  });
  const rows = query.isError ? [] : query.data?.slice(0, 20) ?? [];
  return <Card title="Журнал команд" description={poll > 0 ? `Перша сторінка оновлюється кожні ${poll} с. Старі сторінки залишаються на місці; кнопка оновлення повертає до нових команд.` : "Ручне оновлення відкриває першу сторінку."} actions={<Button disabled={!query.active || query.isFetching} onClick={() => { if (pages.length === 1) query.refresh(); else { setPages([null]); setRevision((value) => value + 1); } }}>Оновити журнал</Button>}>
    <StableRegion>
      {query.isFetching && !query.data ? <p role="status">Завантажуємо журнал…</p> : query.isError ? <p role="alert">{apiErrorDisplayMessage(query.error)}</p> : rows.length === 0 ? <p>Команд ще немає.</p> : <DataTable caption="Журнал команд пристрою" rows={rows} columns={[
        { key: "created", header: "Створено", render: (row) => formatSeen(row.created_at, context.activeSite?.timezone ?? "UTC") },
        { key: "type", header: "Команда", render: (row) => <>{commandLabel(row.command_type)}{typeof row.payload.frequency_hz === "number" ? ` · ${row.payload.frequency_hz} Гц` : ""}{" "}<a className="button button-ghost button-small" href="#selected-command" aria-label={`Переглянути команду ${commandLabel(row.command_type)}`} onClick={() => onSelect(row.id)}>Деталі</a></> },
        { key: "status", header: "Стан на час завантаження", render: (row) => <CommandStatus command={row} /> },
        { key: "actor", header: "Автор", render: (row) => row.actor_display_name ?? row.actor_email ?? "Невідомий" },
      ]} />}
    </StableRegion>
    <div className="ui-row"><Button disabled={pages.length === 1 || query.isFetching || !query.active} onClick={() => setPages((value) => value.slice(0, -1))}>Попередні команди</Button><span>Сторінка {pages.length}</span><Button disabled={!query.data || query.data.length <= 20 || query.isError || query.isFetching || !query.active} onClick={() => setPages((value) => [...value, commandCursor(rows.at(-1)!)])}>Наступні команди</Button></div>
  </Card>;
}
