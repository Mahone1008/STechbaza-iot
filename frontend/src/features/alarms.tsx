"use client";
import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Button, Card, DataTable, PageHeader, SelectField, TextField } from "@/components/ui";
import { StableRegion } from "@/components/stable-region";
import { useAccessContext, type ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import { sitesHref } from "./inventory";
import { AlarmBadges, AlarmError, AlarmPagination, alarmHref, alarmsHref } from "./alarm-shared";
import { apiQueryKeys } from "@/lib/api";
import { formatSeen, parseDevice, parsePage } from "@/lib/api/inventory";
import { parseAlarmPage, type AlarmFilters } from "@/lib/api/alarms";

function DeviceChooser({ context }: { context: ReadyAccessSnapshot }) {
  const { authorizedRequest } = useAuthSession();
  const [page, setPage] = useState(0);
  const site = context.activeSite;
  const query = usePanelQuery({
    queryKey: apiQueryKeys.inventory(context.scope, context.activeOrganization.id, site?.id ?? null, "alarm-devices", page),
    intervalMs: 0, enabled: !!site,
    queryFn: async (signal) => parsePage(await authorizedRequest({ path: `/api/v1/sites/${site!.id}/devices`, query: { limit: 21, offset: page * 20 }, signal, timeoutMs: 10_000 }), (item) => parseDevice(item, site!.id)),
  });
  return <>
    <PageHeader title="Аварії та інциденти" eyebrow={context.activeOrganization.name} description="Оберіть пристрій, щоб переглянути його аварії та підтвердження операторів." actions={<Link className="button button-secondary" href={sitesHref(context.activeOrganization.id)}>Обрати об’єкт</Link>} />
    <Card title={site ? `Пристрої · ${site.name}` : "Оберіть об’єкт"} actions={site && <Button disabled={!query.active || query.isFetching} onClick={query.refresh}>Оновити пристрої</Button>}>
      {!site ? <p>Спочатку оберіть об’єкт із доступними пристроями.</p> : query.isFetching || query.isPending ? <p role="status">Завантажуємо пристрої…</p> : query.isError ? <AlarmError error={query.error} /> : <DataTable caption="Пристрої для перегляду аварій" rows={query.data.slice(0, 20)} emptyMessage="На цій сторінці пристроїв немає." columns={[
        { key: "name", header: "Пристрій", render: (device) => <Link className="table-primary" href={alarmsHref(device.id)}>{device.name}</Link> },
        { key: "uid", header: "UID", render: (device) => device.uid },
      ]} />}
      {site && <AlarmPagination page={page} more={!query.isError && (query.data?.length ?? 0) > 20} busy={!query.active || query.isFetching} onPage={setPage} />}
    </Card>
  </>;
}

function DeviceAlarms({ context }: { context: ReadyAccessSnapshot }) {
  const { authorizedRequest } = useAuthSession();
  const device = context.activeDevice!;
  const [selection, setSelection] = useState<AlarmFilters & { page: number }>({ state: "active", severity: "", alarm_type: "", page: 0 });
  const [type, setType] = useState("");
  const query = usePanelQuery({
    queryKey: [...apiQueryKeys.deviceAlarms(context.scope, device.id, selection.page), context.activeOrganization.id, selection], intervalMs: 0,
    queryFn: async (signal) => parseAlarmPage(await authorizedRequest({ path: `/api/v1/devices/${device.id}/alarms`, query: { limit: 21, offset: selection.page * 20, ...(selection.state ? { state: selection.state } : {}), ...(selection.severity ? { severity: selection.severity } : {}), ...(selection.alarm_type ? { alarm_type: selection.alarm_type } : {}) }, signal, timeoutMs: 10_000 }), device.id, selection),
  });
  const change = (value: Partial<AlarmFilters>) => setSelection((old) => ({ ...old, ...value, page: 0 }));
  return <>
    <PageHeader title="Аварії пристрою" eyebrow={`${device.name} · ${device.uid}`} description="Переглядайте аварії та підтверджуйте їх отримання. Підтвердження не усуває причину аварії." actions={<><Link className="button button-secondary" href={`/devices/${device.id}` as Route}>Панель пристрою</Link><Link className="button button-secondary" href="/alarms">Обрати пристрій</Link></>} />
    <form className="history-controls" onSubmit={(event) => { event.preventDefault(); change({ alarm_type: type.trim() }); }}>
      <SelectField label="Стан аварії" aria-label="Стан аварії" value={selection.state} onChange={(e) => change({ state: e.target.value as AlarmFilters["state"] })}><option value="active">Активні</option><option value="resolved">Усунені</option><option value="">Усі стани</option></SelectField>
      <SelectField label="Важливість" aria-label="Важливість" value={selection.severity} onChange={(e) => change({ severity: e.target.value as AlarmFilters["severity"] })}><option value="">Усі рівні</option><option value="critical">Критичні</option><option value="warning">Попередження</option></SelectField>
      <TextField label="Тип аварії" aria-label="Тип аварії" value={type} maxLength={96} placeholder="Усі типи" onChange={(e) => setType(e.target.value)} hint="Введіть код типу з деталей інциденту або залиште поле порожнім для всіх типів." />
      <Button type="submit">Застосувати тип</Button>
    </form>
    <Card title="Інциденти" description="Стан на час завантаження. Оновлення повертає першу сторінку." actions={<Button disabled={!query.active || query.isFetching} onClick={() => { if (!selection.page) query.refresh(); else setSelection((old) => ({ ...old, page: 0 })); }}>Оновити аварії</Button>}>
      <StableRegion>{query.isFetching || query.isPending ? <p role="status">Завантажуємо аварії…</p> : query.isError ? <AlarmError error={query.error} /> : <DataTable caption="Аварії вибраного пристрою" rows={query.data.slice(0, 20)} emptyMessage="За вибраними фільтрами аварій немає." columns={[
        { key: "title", header: "Інцидент", render: (alarm) => <><Link className="table-primary" href={alarmHref(device.id, alarm.id)}>{alarm.title}</Link><div className="table-secondary">{alarm.alarm_type}</div></> },
        { key: "state", header: "Стан", render: (alarm) => <AlarmBadges alarm={alarm} /> },
        { key: "time", header: "Виникла", render: (alarm) => formatSeen(alarm.first_raised_at, context.activeSite?.timezone) },
        { key: "count", header: "Спрацювань", render: (alarm) => alarm.occurrence_count },
      ]} />}</StableRegion>
      <AlarmPagination page={selection.page} more={!query.isError && (query.data?.length ?? 0) > 20} busy={!query.active || query.isFetching} onPage={(page) => setSelection((old) => ({ ...old, page }))} />
      <p className="help-copy">Показано до 20 записів. Нові аварії або зміни стану можуть змінити склад сторінок; для актуального списку натисніть «Оновити аварії».</p>
    </Card>
  </>;
}

export function AlarmList() {
  const { snapshot } = useAccessContext();
  if (snapshot.status !== "ready") return null;
  const key = `${snapshot.scope.userId}:${snapshot.scope.sessionId}:${snapshot.activeOrganization.id}:${snapshot.activeSite?.id}:${snapshot.activeDevice?.id}`;
  return snapshot.activeDevice ? <DeviceAlarms key={key} context={snapshot} /> : <DeviceChooser key={key} context={snapshot} />;
}
