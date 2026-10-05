"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button, Card, DataTable, PageHeader } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StableRegion } from "@/components/stable-region";
import { apiQueryKeys, isApiError } from "@/lib/api";
import { formatSeen } from "@/lib/api/inventory";
import { alarmStateLabels, parseAlarm, parseTransitions, transitionLabels } from "@/lib/api/alarms";
import { useAccessContext, type ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import { useAlarmAcknowledgement } from "./use-alarm-acknowledgement";
import { AlarmBadges, AlarmError, AlarmPagination, alarmsHref } from "./alarm-shared";

function TransitionHistory({ context, alarmId, onDenied }: { context: ReadyAccessSnapshot; alarmId: string; onDenied: (error: unknown) => void }) {
  const { authorizedRequest } = useAuthSession();
  const [page, setPage] = useState(0);
  const query = usePanelQuery({
    queryKey: [...apiQueryKeys.alarm(context.scope, context.activeOrganization.id, context.activeDevice!.id, alarmId), "transitions", page], intervalMs: 0,
    queryFn: async (signal) => {
      try { return parseTransitions(await authorizedRequest({ path: `/api/v1/alarms/${alarmId}/transitions`, query: { limit: 21, offset: page * 20 }, signal, timeoutMs: 10_000 }), alarmId, context.activeOrganization.id); }
      catch (error) { if (!signal.aborted && isApiError(error) && ["unauthorized", "forbidden", "not-found"].includes(error.kind)) onDenied(error); throw error; }
    },
  });
  return <Card title="Історія інциденту" description="Останні переходи першими. Підтвердження не закриває активну аварію." actions={<Button disabled={!query.active || query.isFetching} onClick={query.refresh}>Оновити історію інциденту</Button>}>
    <StableRegion>{query.isFetching || query.isPending ? <p role="status">Завантажуємо історію інциденту…</p> : query.isError ? <AlarmError error={query.error} /> : <DataTable caption="Переходи інциденту" rows={query.data.slice(0, 20)} emptyMessage="Переходів ще немає." columns={[
      { key: "time", header: "Час", render: (row) => formatSeen(row.occurred_at, context.activeSite?.timezone) },
      { key: "type", header: "Подія", render: (row) => <>{transitionLabels[row.transition_type]}<div className="table-secondary">{row.from_state ? alarmStateLabels[row.from_state] : "Не зазначено"} → {row.to_state ? alarmStateLabels[row.to_state] : "Не зазначено"}</div></> },
      { key: "actor", header: "Автор / причина", render: (row) => <>{row.actor_display_name ?? row.actor_email ?? "Система"}{row.actor_display_name && row.actor_email && <div className="table-secondary">{row.actor_email}</div>}{row.reason && <div className="table-secondary">{row.reason}</div>}</> },
    ]} />}</StableRegion>
    <AlarmPagination page={page} more={!query.isError && (query.data?.length ?? 0) > 20} busy={!query.active || query.isFetching} onPage={setPage} />
    <p className="help-copy">Нові переходи можуть змінити склад сторінок. Оновлення стану інциденту повертає історію на першу сторінку.</p>
  </Card>;
}

function Incident({ context, id }: { context: ReadyAccessSnapshot; id: string }) {
  const { authorizedRequest } = useAuthSession();
  const { retryAccess } = useAccessContext();
  const [dialog, setDialog] = useState(false);
  const [accessError, setAccessError] = useState<unknown>(null);
  const sequence = useRef(0);
  const device = context.activeDevice!;
  const query = usePanelQuery({
    queryKey: apiQueryKeys.alarm(context.scope, context.activeOrganization.id, device.id, id), intervalMs: 0,
    queryFn: async (signal) => ({ alarm: parseAlarm(await authorizedRequest({ path: `/api/v1/alarms/${id}`, signal, timeoutMs: 10_000 }), device.id, id), read: ++sequence.current }),
  });
  const alarm = query.isError || query.isFetching ? null : query.data?.alarm ?? null;
  const ack = useAlarmAcknowledgement({ context, alarm, read: query.data?.read ?? 0, active: query.active && !query.isFetching, refresh: query.refresh });
  const time = (value: string | null) => value ? formatSeen(value, context.activeSite?.timezone) : "Ще немає";
  const denied = ack.outcome?.kind === "denied" || accessError !== null;
  const reconciled = alarm && ack.outcome && query.data!.read > ack.outcome.checkedRead && !denied;
  const message = reconciled ? alarm.acknowledged_at ? "Отримання аварії підтверджено." : alarm.state === "resolved" ? "Стан перевірено: аварію усунено без підтвердження оператором." : "Стан перевірено: підтвердження ще не зафіксоване." : ack.outcome?.message;
  return <>
    <PageHeader title="Деталі інциденту" eyebrow={`${device.name} · ${device.uid}`} description="Стан аварії та підтвердження оператора зберігаються окремо." actions={<Link className="button button-secondary" href={alarmsHref(device.id)}>До аварій пристрою</Link>} />
    <Card title="Стан інциденту" actions={<Button disabled={!query.active || query.isFetching || ack.busy} onClick={denied ? retryAccess : query.refresh}>{denied ? "Оновити доступ" : "Перевірити стан"}</Button>}>
      {ack.outcome && <p role={ack.outcome.kind === "confirmed" || reconciled ? "status" : "alert"} className="notice">{message}</p>}
      {ack.busy && <p role="status">Зберігаємо підтвердження…</p>}
      <StableRegion>{denied ? <AlarmError error={accessError ?? ack.outcome?.error} /> : query.isFetching || query.isPending ? <p role="status">Завантажуємо інцидент…</p> : query.isError ? <AlarmError error={query.error} /> : alarm && <>
        <h2 className="alarm-title">{alarm.title}</h2>
        {alarm.description && <p>{alarm.description}</p>}
        <AlarmBadges alarm={alarm} />
        <dl className="overview-details"><div><dt>Виникла</dt><dd>{time(alarm.first_raised_at)}</dd></div><div><dt>Останнє спрацювання</dt><dd>{time(alarm.last_raised_at)}</dd></div><div><dt>Спрацювань</dt><dd>{alarm.occurrence_count}</dd></div><div><dt>Усунена</dt><dd>{time(alarm.resolved_at)}</dd></div><div><dt>Підтверджена</dt><dd>{time(alarm.acknowledged_at)}</dd></div><div><dt>Підтвердив оператор</dt><dd>{alarm.acknowledged_by_display_name ?? "Не зазначено"}{alarm.acknowledged_by_email && ` · ${alarm.acknowledged_by_email}`}</dd></div></dl>
        <p>Підтвердження означає, що оператор побачив аварію. Воно не усуває причину і не керує обладнанням.</p>
        {!ack.allowed ? <p className="help-copy">Ваша роль дозволяє перегляд, але не підтвердження аварій.</p> : alarm.state === "active" && !alarm.acknowledged_at ? <Button variant="primary" disabled={!ack.canConfirm} onClick={() => setDialog(true)}>Підтвердити отримання</Button> : null}
        {ack.needsCheck && <p>Спочатку натисніть «Перевірити стан». Повтор виконується лише після нового підтвердження.</p>}
        {ack.waiting && <p role="status">Зачекайте до завершення обмеження повторних запитів.</p>}
        <details><summary>Додаткові відомості</summary><dl className="overview-details"><div><dt>Код типу аварії</dt><dd>{alarm.alarm_type}</dd></div><div><dt>Останнє оновлення</dt><dd>{time(alarm.updated_at)}</dd></div></dl></details>
      </>}</StableRegion>
    </Card>
    {alarm && !denied && <TransitionHistory key={query.data!.read} context={context} alarmId={id} onDenied={setAccessError} />}
    <ConfirmDialog open={dialog && !!alarm && !denied} title="Підтвердити отримання аварії" description="Ваше підтвердження буде збережено в історії. Аварія залишиться активною до усунення її причини." confirmLabel="Підтвердити отримання" confirmDisabled={!ack.canConfirm} onClose={() => setDialog(false)} onConfirm={() => void ack.confirm()}><p>{device.name}</p><p>{alarm?.title}</p></ConfirmDialog>
  </>;
}

export function AlarmDetail({ alarmId }: { alarmId: string }) {
  const { snapshot } = useAccessContext();
  if (snapshot.status !== "ready" || !snapshot.activeDevice) return null;
  return <Incident key={`${snapshot.scope.userId}:${snapshot.scope.sessionId}:${snapshot.activeOrganization.id}:${snapshot.activeDevice.id}:${alarmId}`} context={snapshot} id={alarmId} />;
}
