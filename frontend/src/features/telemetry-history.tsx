"use client";
import { useState } from "react";
import { Button, Card, SelectField } from "@/components/ui";
import { StableRegion } from "@/components/stable-region";
import { TelemetryChart } from "@/components/telemetry-chart";
import { useAuthSession } from "@/features/auth-session";
import { usePanelQuery } from "@/features/use-panel-query";
import { historyPreferencesKey, normalizeHistorySelection, readHistorySelection, saveHistorySelection, type HistorySelection } from "@/features/telemetry-preferences";
import type { ReadyAccessSnapshot } from "@/features/access-context";
import { apiErrorDisplayMessage, apiQueryKeys, isApiError } from "@/lib/api";
import { channelLabel, type Channel, type Overview } from "@/lib/api/overview";
import { historyBuckets, parseSeries, periods, seriesChannels, seriesWindow } from "@/lib/api/telemetry-series";
import type { PollSeconds } from "@/lib/api/polling-policy";

function HistoryData({ context, channel, seconds, bucket, poll }: { context: ReadyAccessSnapshot; channel: Channel; seconds: number; bucket: number; poll: PollSeconds }) {
  const { authorizedRequest } = useAuthSession();
  const device = context.activeDevice!;
  const query = usePanelQuery({
    queryKey: [...apiQueryKeys.sessionRoot(context.scope), "series-rolling", context.activeOrganization.id, device.site_id, device.id, channel.key, channel.unit, seconds, bucket],
    intervalMs: poll ? Math.max(60, poll) * 1000 : 0,
    queryFn: async (signal) => {
      const window = seriesWindow(seconds, bucket);
      const raw = await authorizedRequest<unknown>({ path: `/api/v1/devices/${device.id}/telemetry/series`, query: { metric: channel.key, ...window }, signal, timeoutMs: 10000 });
      return parseSeries(raw, device.id, channel, window);
    },
  });
  const status = isApiError(query.error) ? query.error.status : null;
  return <StableRegion className="history-result-region" preserveHeight={query.isFetching || query.isPending}>
    <div className="ui-row"><Button disabled={query.isFetching || !query.active} onClick={query.refresh}>Оновити історію</Button>
      <span className="help-copy" role="status">{query.isFetching && query.data ? "Оновлюємо історію…" : ""}</span>
    </div>
    {!query.active && <p role="status">Оновлення призупинено: вкладка прихована або немає мережі.</p>}
    {query.isError ? <section role="alert" className="notice notice-warning"><h3>Історія недоступна</h3><p>{status === 409 ? "Модуль більше недоступний. Оновіть панель, щоб перевірити склад модулів." : status === 422 ? "Період або обсяг історії перевищує ліміт. Оберіть коротший період; більший інтервал не зменшує кількість вхідних повідомлень." : apiErrorDisplayMessage(query.error)}</p>{status === 429 && <p>Повторний запит можливий після затримки сервера.</p>}</section> : query.data ? <TelemetryChart series={query.data} timezone={context.activeSite?.timezone ?? "UTC"} /> : <p role="status">Завантажуємо історію…</p>}
  </StableRegion>;
}
export function TelemetryHistory({ context, overview, poll }: { context: ReadyAccessSnapshot; overview: Overview; poll: PollSeconds }) {
  const channels = seriesChannels(overview);
  const storageKey = historyPreferencesKey(context.scope, context.activeOrganization.id, context.activeDevice!.id);
  const [saved, setSaved] = useState(() => readHistorySelection(storageKey, channels));
  const selection = normalizeHistorySelection(saved, channels);
  const { metric, seconds, bucket } = selection;
  const channel = channels.find((item) => item.key === metric);
  const change = (patch: Partial<HistorySelection>) => {
    const next = normalizeHistorySelection({ ...selection, ...patch }, channels);
    saveHistorySelection(storageKey, next);
    setSaved(next);
  };
  return <Card title="Історія телеметрії" description="Час приймання сервером; середнє за валідними зразками, а не за тривалістю. Оновлення пересуває період до поточного часу.">
    {!channel ? <p>Увімкнених каналів з підтримкою історії немає.</p> : <>
      <div className="history-controls telemetry-history-controls">
        <SelectField label="Метрика" value={channel.key} onChange={(e) => change({ metric: e.target.value })}>{channels.map((c) => <option key={c.key} value={c.key}>{channelLabel(c.key)} · {c.unit}</option>)}</SelectField>
        <SelectField label="Період" value={seconds} onChange={(e) => { const period = periods.find((p) => p.seconds === Number(e.target.value))!; change({ seconds: period.seconds, bucket: period.bucket }); }}>{periods.map((p) => <option key={p.seconds} value={p.seconds}>{p.label}</option>)}</SelectField>
        <SelectField label="Інтервал" value={bucket} onChange={(e) => change({ bucket: Number(e.target.value) })}>{historyBuckets.map((b) => <option key={b} value={b} disabled={Math.ceil(seconds / b) > 1000}>{b < 3600 ? `${b / 60} хв` : `${b / 3600} год`}</option>)}</SelectField>
      </div>
      <HistoryData context={context} channel={channel} seconds={seconds} bucket={bucket} poll={poll} />
    </>}
  </Card>;
}
