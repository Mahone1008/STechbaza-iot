"use client";
import { DeviceSection } from "./panel-activity";
import dynamic from "next/dynamic";
import { ProgramStatus } from "@/features/program-status";
import { CommandControls } from "@/features/command-controls";
import { ControllerDiagnostics } from "@/features/controller-diagnostics";
import { alarmsHref } from "@/features/alarm-shared";
import { CommandDetail } from "@/features/command-journal";
import { usePanelQuery } from "@/features/use-panel-query";
import { StableRegion } from "@/components/stable-region";
import type { PollSeconds } from "@/lib/api/polling-policy";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useElapsedSeconds } from "./use-elapsed-seconds";
import { Button, Card, MetricCard, PageHeader, SelectField, StatusBadge } from "@/components/ui";
import { useAccessContext, type ReadyAccessSnapshot } from "@/features/access-context";
import { useAuthSession } from "@/features/auth-session";
import { apiErrorDisplayMessage, apiQueryKeys, isApiError } from "@/lib/api";
import { formatSeen } from "@/lib/api/inventory";
import { deviceLifecycleLabel } from "@/lib/device-labels";
import {
  channelLabel,
  channelSupported,
  effectiveQuality,
  parseOverview,
  qualityLabels,
  readingText,
  reasonLabels,
  type Overview,
} from "@/lib/api/overview";

const SchedulePanel = dynamic(() => import("./schedule-panel").then((module) => module.SchedulePanel), {
  loading: () => <p role="status">Завантажуємо розклади…</p>,
});
const TelemetryHistory = dynamic(() => import("./telemetry-history").then((module) => module.TelemetryHistory), {
  loading: () => <p role="status">Завантажуємо графіки…</p>,
});
const DeviceEvents = dynamic(() => import("./device-events").then((module) => module.DeviceEvents));
const EquipmentPassportPanel = dynamic(() =>
  import("./equipment-passport").then((module) => module.EquipmentPassportPanel),
);
const CommandJournal = dynamic(() => import("./command-journal").then((module) => module.CommandJournal));

function DeviceStatus({
  overview,
  receivedAt,
  timezone,
}: {
  overview: Overview;
  receivedAt: number;
  timezone: string;
}) {
  const elapsed = useElapsedSeconds(receivedAt);
  const quality = effectiveQuality(overview.freshness.status, overview.freshness, elapsed);
  const presence = overview.availability;
  const online =
    presence.online &&
    presence.seconds_since_seen !== null &&
    presence.seconds_since_seen + elapsed <= presence.timeout_seconds;
  const channels = overview.modules.flatMap((module) => module.channels);
  const running = channels.find((channel) => channel.source === "state" && channel.key === "pump_running");
  const fault = channels.find((channel) => channel.source === "state" && channel.key === "vfd_fault_code");
  const confirmed =
    online &&
    running &&
    effectiveQuality(running.status, overview.freshness, elapsed) === "fresh" &&
    typeof running.value === "boolean";
  const currentFault =
    online &&
    fault &&
    effectiveQuality(fault.status, overview.freshness, elapsed) === "fresh" &&
    typeof fault.value === "number" &&
    fault.value !== 0;
  const title = currentFault
    ? "Помилка обладнання"
    : confirmed
      ? running.value
        ? "Обладнання працює"
        : "Обладнання зупинено"
      : "Стан обладнання не підтверджено";
  return (
    <Card className={`device-status${currentFault ? " device-status-fault" : ""}`}>
      <div className="device-status-heading">
        <div>
          <h2>{title}</h2>
        </div>
        <div className="device-status-badges">
          <StatusBadge tone={online ? "success" : "warning"}>
            {presence.last_seen_at === null
              ? "Ще не було зв’язку"
              : online
                ? "На зв’язку"
                : presence.online
                  ? "Потрібно оновити зв’язок"
                  : "Немає зв’язку"}
          </StatusBadge>
          <StatusBadge tone={quality === "fresh" ? "success" : "warning"}>{qualityLabels[quality]}</StatusBadge>
        </div>
      </div>
      {currentFault && (
        <p className="device-status-warning" role="alert">
          Частотник повідомив про помилку. Код: {String(fault.value)}. Перевірте обладнання перед запуском.
        </p>
      )}
      {quality !== "fresh" && (
        <p className="device-status-warning">
          {quality === "stale" && overview.freshness.reason === "recent"
            ? reasonLabels.timeout
            : reasonLabels[overview.freshness.reason]}
          . Поточний стан потрібно перевірити.
        </p>
      )}
      <details className="device-connection-details">
        <summary>Докладніше про зв’язок</summary>
        <dl className="overview-details">
          <div>
            <dt>Останній зв’язок</dt>
            <dd>{formatSeen(presence.last_seen_at, timezone)}</dd>
          </div>
          <div>
            <dt>Показання отримано</dt>
            <dd>
              {overview.freshness.received_at ? formatSeen(overview.freshness.received_at, timezone) : "Немає даних"}
            </dd>
          </div>
          <div>
            <dt>Панель перевірено</dt>
            <dd>{formatSeen(overview.generatedAt, timezone)}</dd>
          </div>
        </dl>
        <p className="help-copy">
          Зв’язок із контролером не підтверджує роботу двигуна. Для цього потрібні актуальні показання обладнання.
        </p>
      </details>
    </Card>
  );
}

function OverviewContent({
  overview,
  receivedAt,
  onViewProgram,
}: {
  overview: Overview;
  receivedAt: number;
  onViewProgram?: (() => void) | undefined;
}) {
  const elapsed = useElapsedSeconds(receivedAt);
  const quality = effectiveQuality(overview.freshness.status, overview.freshness, elapsed);
  const presence = overview.availability;
  const presenceExpired =
    presence.seconds_since_seen === null || presence.seconds_since_seen + elapsed > presence.timeout_seconds;
  const channels = overview.modules.flatMap((module) => module.channels);
  const detailKeys = new Set(["control_armed", "vfd_configuration_valid", "vfd_link"]);
  const renderReading = (channel: Overview["modules"][number]["channels"][number]) => {
    const label = channelLabel(channel.key) === channel.key ? "Додатковий показник" : channelLabel(channel.key);
    if (!channelSupported(channel))
      return (
        <article className="notice" key={`${channel.source}:${channel.key}`}>
          <h3>{label}</h3>
          <p>Цей тип каналу поки не підтримується.</p>
        </article>
      );
    const status = effectiveQuality(channel.status, overview.freshness, elapsed);
    return (
      <MetricCard
        key={`${channel.source}:${channel.key}`}
        label={label}
        value={
          channel.key === "pump_running" && typeof channel.value === "boolean"
            ? channel.value
              ? "Працює"
              : "Зупинено"
            : readingText(channel)
        }
        unit={channel.unit === "Hz" ? "Гц" : (channel.unit ?? "")}
        meta={
          status === "stale"
            ? "Останнє відоме значення; не поточний стан"
            : status === "missing"
              ? "Показання ще не отримано"
              : status === "invalid"
                ? "Показання не пройшло перевірку"
                : channel.key === "vfd_fault_code" && channel.value === 0
                  ? "Помилок немає"
                  : ""
        }
        status={
          <StatusBadge tone={status === "fresh" ? "success" : status === "invalid" ? "danger" : "warning"}>
            {qualityLabels[status]}
          </StatusBadge>
        }
      />
    );
  };
  return (
    <>
      <ProgramStatus
        progress={overview.diagnostics?.program}
        fresh={quality === "fresh" && presence.online && !presenceExpired}
        onViewProgram={onViewProgram}
      />
      <section aria-labelledby="modules-heading">
        <h2 id="modules-heading">Показники обладнання</h2>
        {overview.modules.length === 0 ? (
          <Card>
            <p>Для пристрою немає увімкнених модулів.</p>
          </Card>
        ) : (
          <>
            <div className="overview-widgets overview-readings">
              {channels.filter((channel) => !detailKeys.has(channel.key)).map(renderReading)}
            </div>
            {channels.some((channel) => detailKeys.has(channel.key)) && (
              <details className="overview-extra-readings">
                <summary>Додаткові показники контролера</summary>
                <div className="overview-widgets overview-readings">
                  {channels.filter((channel) => detailKeys.has(channel.key)).map(renderReading)}
                </div>
              </details>
            )}
          </>
        )}
      </section>
    </>
  );
}
function SnapshotDiagnostics({
  overview,
  receivedAt,
  timezone,
}: {
  overview: Overview;
  receivedAt: number;
  timezone: string;
}) {
  const elapsed = useElapsedSeconds(receivedAt);
  return (
    <ControllerDiagnostics
      data={overview.diagnostics}
      quality={effectiveQuality(overview.freshness.status, overview.freshness, elapsed)}
      previousSession={overview.freshness.reason === "session_changed"}
      timezone={timezone}
    />
  );
}

const sections = [
  ["panel", "Панель"],
  ["charts", "Графіки"],
  ["schedules", "Розклади"],
  ["journal", "Журнал"],
  ["equipment", "Обладнання"],
] as const;
type Section = (typeof sections)[number][0];

function DevicePanel({ context }: { context: ReadyAccessSnapshot }) {
  const { authorizedRequest } = useAuthSession();
  const device = context.activeDevice!;
  const canRead =
    context.access.permissions.includes("telemetry.read") && context.access.permissions.includes("capability.read");
  const search = useSearchParams();
  const section: Section = sections.find(([id]) => id === search.get("view"))?.[0] ?? "panel";
  const [visited, setVisited] = useState<Set<Section>>(() => new Set([section]));
  const navigate = (next: Section) => {
    setVisited((current) => new Set([...current, section, next]));
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    const tab = document.getElementById(`device-tab-${next}`);
    const strip = tab?.parentElement;
    if (
      tab &&
      strip &&
      (tab.offsetLeft < strip.scrollLeft || tab.offsetLeft + tab.offsetWidth > strip.scrollLeft + strip.clientWidth)
    )
      strip.scrollTo({
        left: tab.offsetLeft - strip.offsetLeft,
        behavior: "smooth",
      });
  };
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
  // The demo presence lease is 15 s; refresh well before it expires.
  const [poll, setPoll] = useState<PollSeconds>(5);
  const query = usePanelQuery({
    queryKey: [...apiQueryKeys.deviceOverview(context.scope, device.id), context.activeOrganization.id, device.site_id],
    enabled: canRead,
    intervalMs: section === "panel" || section === "schedules" ? poll * 1000 : 0,
    queryFn: async (signal) => {
      const start = performance.now();
      const raw = await authorizedRequest<unknown>({
        path: `/api/v1/devices/${device.id}/overview`,
        signal,
        timeoutMs: 10_000,
      });
      return {
        overview: parseOverview(raw, device, context.activeOrganization.id),
        receivedAt: start,
      };
    },
  });
  const denied = isApiError(query.error) && ["forbidden", "not-found"].includes(query.error.kind);
  const programCommandId = query.isError ? null : (query.data?.overview.diagnostics?.program?.command_id ?? null);
  // Після F5 відновлюємо серверний план за ID із телеметрії, а не чернетку форми.
  const displayedCommand = selectedCommand ?? programCommandId;
  const selectCommand = (id: string) => {
    setSelectedCommand(id);
    navigate("journal");
  };
  const onViewProgram =
    context.access.permissions.includes("command.read") && programCommandId
      ? () => selectCommand(programCommandId)
      : undefined;
  return (
    <>
      <PageHeader
        title={device.name}
        actions={
          <>
            {context.access.permissions.includes("alarm.read") && (
              <Link className="button button-secondary" href={alarmsHref(device.id)}>
                Аварії пристрою
              </Link>
            )}
            <Button disabled={!canRead || query.isFetching || !query.active} onClick={query.refresh}>
              Оновити панель
            </Button>
          </>
        }
      />
      <div className="device-tabs" role="tablist" aria-label="Розділи пристрою">
        {sections.map(([id, label], index) => (
          <button
            key={id}
            type="button"
            id={`device-tab-${id}`}
            role="tab"
            aria-selected={section === id}
            aria-controls={`device-section-${id}`}
            tabIndex={section === id ? 0 : -1}
            onClick={() => navigate(id)}
            onKeyDown={(event) => {
              const target =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? sections.length - 1
                    : event.key === "ArrowRight"
                      ? (index + 1) % sections.length
                      : event.key === "ArrowLeft"
                        ? (index + sections.length - 1) % sections.length
                        : -1;
              if (target >= 0) {
                event.preventDefault();
                const next = sections[target]![0];
                navigate(next);
                document.getElementById(`device-tab-${next}`)?.focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {!query.active && <p role="status">Автооновлення призупинено: вкладка прихована або немає мережі.</p>}
      <DeviceSection name="panel" active={section === "panel"}>
        <div className="device-panel-grid">
          {canRead && query.data && !query.isError && (
            <DeviceStatus
              overview={query.data.overview}
              receivedAt={query.data.receivedAt}
              timezone={context.activeSite?.timezone ?? "UTC"}
            />
          )}
          <CommandControls
            onSchedules={() => navigate("schedules")}
            context={context}
            overview={query.isError ? null : (query.data?.overview ?? null)}
            receivedAt={query.data?.receivedAt ?? 0}
            active={query.active && section === "panel"}
            refreshing={query.isFetching}
            poll={poll}
            onCreated={setSelectedCommand}
          />
          <StableRegion className="overview-result-region" preserveHeight={query.isFetching || query.isError}>
            {!canRead ? (
              <section className="notice notice-warning" role="alert">
                <h2>Недостатньо прав для панелі</h2>
                <p>Потрібен доступ до модулів і телеметрії.</p>
              </section>
            ) : query.isFetching && !query.data ? (
              <p role="status">Перевіряємо модулі та показання…</p>
            ) : query.isError ? (
              <section className="notice notice-warning" role="alert">
                <h2>{denied ? "Дані більше недоступні" : "Не вдалося завантажити панель"}</h2>
                <p>{apiErrorDisplayMessage(query.error)}</p>
                <div className="ui-row">
                  <Button onClick={query.refresh}>Повторити</Button>
                  <Link className="button button-secondary" href="/organizations">
                    Обрати організацію
                  </Link>
                </div>
              </section>
            ) : query.data ? (
              <OverviewContent
                overview={query.data.overview}
                receivedAt={query.data.receivedAt}
                onViewProgram={onViewProgram}
              />
            ) : null}
          </StableRegion>
        </div>
        {section === "panel" && displayedCommand && context.access.permissions.includes("command.read") && (
          <CommandDetail key={displayedCommand} context={context} id={displayedCommand} poll={poll} />
        )}
      </DeviceSection>
      <DeviceSection name="charts" active={section === "charts"}>
        {visited.has("charts") &&
          (canRead && query.data && !query.isError ? (
            <TelemetryHistory context={context} overview={query.data.overview} poll={poll} />
          ) : (
            <p>Для графіків потрібні доступ до телеметрії та завантажена панель.</p>
          ))}
      </DeviceSection>
      <DeviceSection name="schedules" active={section === "schedules"}>
        {visited.has("schedules") &&
          (context.access.permissions.includes("command.read") && query.data ? (
            <SchedulePanel
              context={context}
              visible={section === "schedules"}
              poll={poll}
              limits={query.data.overview.frequencyLimits}
              supported={query.data.overview.diagnostics?.program?.supports_schedule === true}
              maxScheduleSeconds={query.data.overview.diagnostics?.program?.max_schedule_seconds}
              onCommand={selectCommand}
            />
          ) : (
            <p>Розклади недоступні: перевірте права та зв’язок із сервером.</p>
          ))}
      </DeviceSection>
      <DeviceSection name="journal" active={section === "journal"}>
        {visited.has("journal") && (
          <>
            <div id="selected-command">
              {section === "journal" && displayedCommand && context.access.permissions.includes("command.read") && (
                <CommandDetail key={displayedCommand} context={context} id={displayedCommand} poll={poll} />
              )}
            </div>
            {context.access.permissions.includes("command.read") && (
              <CommandJournal context={context} onSelect={selectCommand} poll={poll} />
            )}
            <DeviceEvents context={context} poll={poll} />
          </>
        )}
      </DeviceSection>
      <DeviceSection name="equipment" active={section === "equipment"}>
        {visited.has("equipment") && (
          <>
            <EquipmentPassportPanel context={context} expanded />
            <details>
              <summary>Технічні дані контролера</summary>
              <dl className="overview-details">
                <div>
                  <dt>UID</dt>
                  <dd>{device.uid}</dd>
                </div>
                <div>
                  <dt>Стан реєстрації</dt>
                  <dd>{deviceLifecycleLabel(device.lifecycle_status)}</dd>
                </div>
              </dl>
              {query.isError ? (
                <p role="alert">{apiErrorDisplayMessage(query.error)}</p>
              ) : (
                query.data && (
                  <SnapshotDiagnostics
                    overview={query.data.overview}
                    receivedAt={query.data.receivedAt}
                    timezone={context.activeSite?.timezone ?? "UTC"}
                  />
                )
              )}
            </details>
          </>
        )}
      </DeviceSection>
      <details className="customer-disclosure panel-display-settings">
        <summary>Налаштування відображення</summary>
        <div className="panel-refresh-controls">
          <SelectField
            label="Автооновлення"
            value={poll}
            onChange={(event) => setPoll(Number(event.target.value) as PollSeconds)}
          >
            <option value={5}>Панель: 5 с; історія: 60 с</option>
            <option value={30}>Панель: 30 с; історія: 60 с</option>
            <option value={60}>Щохвилини</option>
            <option value={0}>Лише вручну</option>
          </SelectField>
        </div>
      </details>
    </>
  );
}
export function DeviceOverview() {
  const { snapshot } = useAccessContext();
  if (snapshot.status !== "ready" || !snapshot.activeDevice) return null;
  return (
    <DevicePanel
      key={`${snapshot.scope.userId}:${snapshot.scope.sessionId}:${snapshot.activeOrganization.id}:${snapshot.activeDevice.id}`}
      context={snapshot}
    />
  );
}
