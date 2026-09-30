"use client";
import { CommandControls } from "@/features/command-controls";
import { alarmsHref } from "@/features/alarm-shared";
import { CommandDetail, CommandJournal } from "@/features/command-journal";
import { usePanelQuery } from "@/features/use-panel-query";
import { StableRegion } from "@/components/stable-region";
import { TelemetryHistory } from "@/features/telemetry-history";
import type { PollSeconds } from "@/lib/api/polling-policy";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, MetricCard, PageHeader, StatusBadge } from "@/components/ui";
import { useAccessContext, type ReadyAccessSnapshot } from "@/features/access-context";
import { useAuthSession } from "@/features/auth-session";
import { apiErrorDisplayMessage, apiQueryKeys, isApiError } from "@/lib/api";
import { formatSeen } from "@/lib/api/inventory";
import { channelLabel, channelSupported, effectiveQuality, parseOverview, qualityLabels, readingText, reasonLabels, type Overview } from "@/lib/api/overview";

function OverviewContent({ overview, receivedAt, timezone }: { overview: Overview; receivedAt: number; timezone: string }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, (performance.now() - receivedAt) / 1000));
  useEffect(() => {
    const update = () => setElapsed(Math.max(0, (performance.now() - receivedAt) / 1000));
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [receivedAt]);
  const quality = effectiveQuality(overview.freshness.status, overview.freshness, elapsed);
  const presence = overview.availability;
  const presenceExpired = presence.seconds_since_seen === null || presence.seconds_since_seen + elapsed > presence.timeout_seconds;
  return <>
    <Card title="Зв’язок і якість даних">
      <div className="ui-row"><StatusBadge tone={presence.online && !presenceExpired ? "success" : "neutral"}>{presence.last_seen_at === null ? "Ще не було зв’язку" : presence.online ? presenceExpired ? "Потрібно оновити зв’язок" : "Online" : "Offline"}</StatusBadge><StatusBadge tone={quality === "fresh" ? "success" : "warning"}>{qualityLabels[quality]}</StatusBadge></div>
      <p>{quality === "stale" && overview.freshness.reason === "recent" ? reasonLabels.timeout : reasonLabels[overview.freshness.reason]}</p>
      <dl className="overview-details"><div><dt>UID</dt><dd>{overview.device.uid}</dd></div><div><dt>Життєвий цикл</dt><dd>{overview.device.lifecycle_status}</dd></div><div><dt>Останній зв’язок</dt><dd>{formatSeen(presence.last_seen_at, timezone)}</dd></div><div><dt>Телеметрію отримано</dt><dd>{overview.freshness.received_at ? formatSeen(overview.freshness.received_at, timezone) : "Немає даних"}</dd></div><div><dt>Панель перевірено</dt><dd>{formatSeen(overview.generatedAt, timezone)}</dd></div></dl>
      <p className="help-copy">Online означає наявність зв’язку. Стан обладнання визначається окремими показаннями. Частота автоматичного оновлення задається вище; доступна кнопка «Оновити панель».</p>
    </Card>
    <section aria-labelledby="modules-heading"><h2 id="modules-heading">Модулі та канали</h2><p className="help-copy">Показані лише увімкнені можливості цього пристрою. Призначення модуля не визначає кількість фізичних датчиків.</p>
      {overview.modules.length === 0 ? <Card><p>Для пристрою немає увімкнених модулів.</p></Card> : <div className="overview-modules">{overview.modules.map((module) => <Card key={module.assignmentId} title={module.name} description={module.code}>
        {!module.supported ? <p>Цей модуль ще не підтримує відображення даних.</p> : module.channels.length === 0 ? <p>Модуль керування без вимірювальних каналів. Доступні дії показані в блоці керування.</p> : <div className="overview-widgets">{module.channels.map((channel) => {
          if (!channelSupported(channel)) return <article className="notice" key={`${channel.source}:${channel.key}`}><h3>{channelLabel(channel.key)}</h3><p>Цей тип каналу поки не підтримується.</p></article>;
          const status = effectiveQuality(channel.status, overview.freshness, elapsed);
          return <MetricCard key={`${channel.source}:${channel.key}`} label={channelLabel(channel.key)} value={readingText(channel)} unit={channel.unit ?? ""} meta={status === "stale" ? "Останнє відоме значення; не поточний стан" : status === "missing" ? "Показання ще не отримано" : status === "invalid" ? "Показання не пройшло перевірку" : "За останнім отриманим повідомленням"} status={<StatusBadge tone={status === "fresh" ? "success" : status === "invalid" ? "danger" : "warning"}>{qualityLabels[status]}</StatusBadge>} />;
        })}</div>}
      </Card>)}</div>}
    </section>
  </>;
}
function DevicePanel({ context }: { context: ReadyAccessSnapshot }) {
  const { authorizedRequest } = useAuthSession();
  const device = context.activeDevice!;
  const canRead = context.access.permissions.includes("telemetry.read") && context.access.permissions.includes("capability.read");
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
  // The demo presence lease is 15 s; refresh well before it expires.
  const [poll, setPoll] = useState<PollSeconds>(5);
  const query = usePanelQuery({
    queryKey: [...apiQueryKeys.deviceOverview(context.scope, device.id), context.activeOrganization.id, device.site_id],
    enabled: canRead, intervalMs: poll * 1000,
    queryFn: async (signal) => {
      const start = performance.now();
      const raw = await authorizedRequest<unknown>({ path: `/api/v1/devices/${device.id}/overview`, signal, timeoutMs: 10_000 });
      return { overview: parseOverview(raw, device, context.activeOrganization.id), receivedAt: start };
    },
  });
  const denied = isApiError(query.error) && ["forbidden", "not-found"].includes(query.error.kind);
  return <>
    <PageHeader title={device.name} description="Модулі, показання та якість даних пристрою." actions={<>{context.access.permissions.includes("alarm.read") && <Link className="button button-secondary" href={alarmsHref(device.id)}>Аварії пристрою</Link>}<Button disabled={!canRead || query.isFetching || !query.active} onClick={query.refresh}>Оновити панель</Button></>} />
    <div className="history-controls"><label>Автооновлення<select aria-label="Автооновлення" value={poll} onChange={(e) => setPoll(Number(e.target.value) as PollSeconds)}><option value={5}>Панель: 5 с; історія: 60 с</option><option value={30}>Панель: 30 с; історія: 60 с</option><option value={60}>Щохвилини</option><option value={0}>Лише вручну</option></select></label></div>
    {!query.active && <p role="status">Автооновлення призупинено: вкладка прихована або немає мережі.</p>}
    <CommandControls context={context} overview={query.isError ? null : query.data?.overview ?? null} receivedAt={query.data?.receivedAt ?? 0} active={query.active} refreshing={query.isFetching} onCreated={setSelectedCommand} />
    <div id="selected-command">{selectedCommand && context.access.permissions.includes("command.read") && <CommandDetail key={selectedCommand} context={context} id={selectedCommand} auto={poll > 0} />}</div>
    <StableRegion className="overview-result-region">{!canRead ? <section className="notice notice-warning" role="alert"><h2>Недостатньо прав для панелі</h2><p>Потрібен доступ до модулів і телеметрії.</p></section>
      : query.isFetching && !query.data ? <p role="status">Перевіряємо модулі та показання…</p>
        : query.isError ? <section className="notice notice-warning" role="alert"><h2>{denied ? "Дані більше недоступні" : "Не вдалося завантажити панель"}</h2><p>{apiErrorDisplayMessage(query.error)}</p><div className="ui-row"><Button onClick={query.refresh}>Повторити</Button><Link className="button button-secondary" href="/organizations">Обрати організацію</Link></div></section>
          : query.data ? <OverviewContent key={query.dataUpdatedAt} overview={query.data.overview} receivedAt={query.data.receivedAt} timezone={context.activeSite?.timezone ?? "UTC"} /> : null}</StableRegion>
    {canRead && query.data && !query.isError && <TelemetryHistory context={context} overview={query.data.overview} poll={poll} />}
    {context.access.permissions.includes("command.read") && <CommandJournal context={context} onSelect={setSelectedCommand} auto={poll > 0} />}
  </>;
}
export function DeviceOverview() {
  const { snapshot } = useAccessContext();
  if (snapshot.status !== "ready" || !snapshot.activeDevice) return null;
  return <DevicePanel key={`${snapshot.scope.userId}:${snapshot.scope.sessionId}:${snapshot.activeOrganization.id}:${snapshot.activeDevice.id}`} context={snapshot} />;
}
