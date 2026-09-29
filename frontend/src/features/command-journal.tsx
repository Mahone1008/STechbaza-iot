"use client";
import { useState } from "react";
import { Button, Card, DataTable, StatusBadge } from "@/components/ui";
import { StableRegion } from "@/components/stable-region";
import { useAuthSession } from "./auth-session";
import type { ReadyAccessSnapshot } from "./access-context";
import { usePanelQuery } from "./use-panel-query";
import { apiErrorDisplayMessage, apiQueryKeys } from "@/lib/api";
import { formatSeen } from "@/lib/api/inventory";
import { commandCursor, commandLabel, commandPending, parseCommand, parseCommandPage, statusLabels, type Command, type CommandCursor } from "@/lib/api/commands";

export function CommandStatus({ command }: { command: Command }) {
  return <StatusBadge tone={command.status === "succeeded" ? "success" : command.status === "failed" ? "danger" : commandPending(command) ? "info" : "warning"}>{statusLabels[command.status]}</StatusBadge>;
}
export function CommandDetail({ context, id, auto }: { context: ReadyAccessSnapshot; id: string; auto: boolean }) {
  const { authorizedRequest } = useAuthSession();
  const [openedAt] = useState(() => performance.now());
  const device = context.activeDevice!;
  const query = usePanelQuery({
    queryKey: [...apiQueryKeys.command(context.scope, id), context.activeOrganization.id, device.id], intervalMs: auto ? 5000 : 0,
    pollWhile: (data: Command) => commandPending(data) && performance.now() - openedAt < 600_000,
    queryFn: async (signal) => parseCommand(await authorizedRequest({ path: `/api/v1/commands/${id}`, signal, timeoutMs: 10_000 }), device.id, context.activeOrganization.id, id),
  });
  const command = query.data;
  const time = (value: string | null) => value ? formatSeen(value, context.activeSite?.timezone ?? "UTC") : "Ще немає";
  return <Card title="Стан вибраної команди" actions={<Button disabled={!query.active || query.isFetching} onClick={query.refresh}>Оновити стан команди</Button>}>
    <StableRegion>
      {query.isError ? <p role="alert">{apiErrorDisplayMessage(query.error)}</p> : !command ? <p role="status">Завантажуємо команду…</p> : <>
        <p><strong>{commandLabel(command.command_type)}</strong>{typeof command.payload.frequency_hz === "number" ? ` · ${command.payload.frequency_hz} Гц` : ""}</p>
        <div role="status"><CommandStatus command={command} /></div>
        <p className="help-copy">Прийом сервером і підтвердження прийому контролером не означають фізичного виконання. Зіставляйте результат із показаннями пристрою.</p>
        {command.status === "result_unknown" && <p className="notice notice-warning">Контролер не надіслав результат вчасно. Автоматичного повтору немає. Пізній результат можна перевірити кнопкою оновлення.</p>}
        <ol className="command-lifecycle">
          <li>Сервер прийняв: {time(command.created_at)}</li>
          <li>Перша спроба доставки: {time(command.published_at)}</li>
          <li>Контролер підтвердив прийом: {time(command.acknowledged_at)}</li>
          <li>Результат виконання: {time(command.completed_at)}</li>
        </ol>
        <p>Час на прийняття команди: {command.ttl_seconds} с · до {time(command.expires_at)}. Це не тривалість роботи насоса. Запізнілі відповіді зберігаються в журналі.</p>
        {command.result_deadline_at && <p>Очікування результату: до {time(command.result_deadline_at)}.</p>}
        {command.result_timed_out_at && <p>Тайм-аут результату: {time(command.result_timed_out_at)}.</p>}
        {command.error_message && <p role="alert">{command.error_message}</p>}
        <details><summary>Автор і технічні деталі команди</summary><dl className="overview-details">
          <div><dt>Автор</dt><dd>{command.actor_display_name ?? "Невідомий"} · {command.actor_email ?? "Email не збережено"}</dd></div>
          <div><dt>Роль під час запиту</dt><dd>{command.actor_organization_role ?? command.actor_platform_role ?? "Невідома"}</dd></div>
          <div><dt>ID команди</dt><dd>{command.id}</dd></div><div><dt>request_id</dt><dd>{command.request_id}</dd></div>
          <div><dt>Спроби публікації</dt><dd>{command.publish_attempts}</dd></div><div><dt>Остання спроба</dt><dd>{time(command.last_publish_attempt_at)}</dd></div>
          <div><dt>Помилка публікації</dt><dd>{command.last_publish_error ?? "Немає"}</dd></div><div><dt>Код помилки</dt><dd>{command.error_code ?? "Немає"}</dd></div>
          <div><dt>Оновлено сервером</dt><dd>{time(command.updated_at)}</dd></div>
        </dl><pre className="command-json">{JSON.stringify({ payload: command.payload, result: command.result }, null, 2)}</pre></details>
        <p className="help-copy">{auto && commandPending(command) ? "Один вибраний запис перевіряється кожні 5 с, до 10 хвилин; після помилок інтервал збільшується." : "Стан можна перевірити вручну."}</p>
      </>}
    </StableRegion>
  </Card>;
}
export function CommandJournal({ context, onSelect }: { context: ReadyAccessSnapshot; onSelect: (id: string) => void }) {
  const { authorizedRequest } = useAuthSession();
  const [pages, setPages] = useState<(CommandCursor | null)[]>([null]);
  const [revision, setRevision] = useState(0);
  const cursor = pages.at(-1)!;
  const device = context.activeDevice!;
  const query = usePanelQuery({
    queryKey: [...apiQueryKeys.deviceCommands(context.scope, device.id, pages.length), context.activeOrganization.id, cursor, revision],
    intervalMs: 0,
    queryFn: async (signal) => parseCommandPage(await authorizedRequest({ path: `/api/v1/devices/${device.id}/commands`, query: { limit: 21, ...(cursor ?? {}) }, signal, timeoutMs: 10_000 }), device.id, context.activeOrganization.id, cursor),
  });
  const rows = query.isError ? [] : query.data?.slice(0, 20) ?? [];
  return <Card title="Журнал команд" description="Історія не переміщується під час надходження нових команд. Оновлення відкриває першу сторінку." actions={<Button disabled={!query.active || query.isFetching} onClick={() => { if (pages.length === 1) query.refresh(); else { setPages([null]); setRevision((value) => value + 1); } }}>Оновити журнал</Button>}>
    <StableRegion>
      {query.isFetching ? <p role="status">Завантажуємо журнал…</p> : query.isError ? <p role="alert">{apiErrorDisplayMessage(query.error)}</p> : rows.length === 0 ? <p>Команд ще немає.</p> : <DataTable caption="Журнал команд пристрою" rows={rows} columns={[
        { key: "created", header: "Створено", render: (row) => formatSeen(row.created_at, context.activeSite?.timezone ?? "UTC") },
        { key: "type", header: "Команда", render: (row) => <>{commandLabel(row.command_type)}{typeof row.payload.frequency_hz === "number" ? ` · ${row.payload.frequency_hz} Гц` : ""}{" "}<a className="button button-ghost button-small" href="#selected-command" aria-label={`Переглянути команду ${commandLabel(row.command_type)}`} onClick={() => onSelect(row.id)}>Деталі</a></> },
        { key: "status", header: "Стан на час завантаження", render: (row) => <CommandStatus command={row} /> },
        { key: "actor", header: "Автор", render: (row) => row.actor_display_name ?? row.actor_email ?? "Невідомий" },
      ]} />}
    </StableRegion>
    <div className="ui-row"><Button disabled={pages.length === 1 || query.isFetching || !query.active} onClick={() => setPages((value) => value.slice(0, -1))}>Попередні команди</Button><span>Сторінка {pages.length}</span><Button disabled={!query.data || query.data.length <= 20 || query.isError || query.isFetching || !query.active} onClick={() => setPages((value) => [...value, commandCursor(rows.at(-1)!)])}>Наступні команди</Button></div>
  </Card>;
}

