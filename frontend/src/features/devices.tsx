"use client";

import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button, Card, DataTable, MetricCard, PageHeader, StatusBadge, TextField, type StatusTone, type TableColumn } from "@/components/ui";
import { useAccessContext } from "@/features/access-context";
import { devices, type AvailabilityState, type DeviceDetail, type DeviceMetric, type DeviceSummary } from "@/lib/demo-data";

const availabilityTone: Record<AvailabilityState, StatusTone> = {
  online: "success",
  stale: "warning",
  offline: "danger",
  new: "neutral",
};
const availabilityLabel: Record<AvailabilityState, string> = {
  online: "Online",
  stale: "Дані застарілі",
  offline: "Offline",
  new: "Новий",
};

function qualityBadge(metric: DeviceMetric) {
  const map = {
    fresh: { tone: "success", label: "Свіжі" },
    stale: { tone: "warning", label: "Застарілі" },
    missing: { tone: "neutral", label: "Немає даних" },
    invalid: { tone: "danger", label: "Некоректні" },
  } as const;
  const item = map[metric.quality];
  return <StatusBadge tone={item.tone}>{item.label}</StatusBadge>;
}

export function DeviceList() {
  const { snapshot, hasPermission } = useAccessContext();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("uk");
  const visibleDevices = useMemo(
    () => normalized ? devices.filter((device) => [device.name, device.site, device.uid].some((value) => value.toLocaleLowerCase("uk").includes(normalized))) : devices,
    [normalized],
  );
  const organizationName = snapshot.status === "ready" ? snapshot.activeOrganization.name : "Організація";
  const canCreateDevice = hasPermission("device.create");

  const columns: readonly TableColumn<DeviceSummary>[] = [
    {
      key: "device",
      header: "Пристрій",
      render: (device) => <div><Link className="table-primary" href={`/devices/${device.id}` as Route}>{device.name}</Link><div className="table-secondary">{device.uid}</div></div>,
    },
    {
      key: "status",
      header: "Стан",
      render: (device) => <StatusBadge tone={availabilityTone[device.availability]}>{availabilityLabel[device.availability]}</StatusBadge>,
    },
    {
      key: "site",
      header: "Об’єкт",
      render: (device) => <div><span className="table-primary">{device.site}</span><div className="table-secondary">{device.mode}</div></div>,
    },
    { key: "lastSeen", header: "Останній зв’язок", render: (device) => device.lastSeen },
    {
      key: "alarms",
      header: "Увага",
      render: (device) => device.alarmCount ? <StatusBadge tone="warning">{device.alarmCount} активна</StatusBadge> : <span className="table-secondary">Немає</span>,
    },
  ];

  const onlineCount = devices.filter((device) => device.availability === "online").length;
  const issueCount = devices.filter((device) => device.availability === "offline" || device.alarmCount).length;

  return (
    <>
      <PageHeader
        eyebrow={`Організація · ${organizationName}`}
        title="Пристрої"
        description="Стан парку без завантаження повної телеметрії кожного контролера. Дані пристроїв поки демонстраційні."
        actions={(
          <Button
            variant="primary"
            disabled
            title={canCreateDevice ? "Provisioning буде окремою функцією" : "Поточна роль не має permission device.create"}
          >
            Додати пристрій
          </Button>
        )}
      />
      <section className="summary-grid" aria-label="Зведення парку">
        <article className="card summary-card"><span className="summary-label">Усього пристроїв</span><div className="summary-value"><strong>{devices.length}</strong><span>у 4 об’єктах</span></div></article>
        <article className="card summary-card"><span className="summary-label">Online</span><div className="summary-value"><strong>{onlineCount}</strong><span>свіжий heartbeat</span></div></article>
        <article className="card summary-card"><span className="summary-label">Потребують уваги</span><div className="summary-value"><strong>{issueCount}</strong><span>offline або alarm</span></div></article>
        <article className="card summary-card"><span className="summary-label">Нові</span><div className="summary-value"><strong>1</strong><span>без телеметрії</span></div></article>
      </section>
      <div className="toolbar">
        <div className="toolbar-search"><TextField label="Пошук" placeholder="Назва, UID або об’єкт" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <StatusBadge tone="info">Показано {visibleDevices.length} із {devices.length}</StatusBadge>
      </div>
      <DataTable caption="Список пристроїв KERUMO" rows={visibleDevices} columns={columns} emptyMessage="За цим пошуком пристроїв не знайдено." />
    </>
  );
}

type PendingAction = "start" | "stop" | "frequency" | null;

function ControlPanel({ device, canExecute }: { device: DeviceDetail; canExecute: boolean }) {
  const [frequency, setFrequency] = useState("42.5");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [localMessage, setLocalMessage] = useState("Команди ще не надсилалися в цій demo-сесії.");
  const controlsEnabled = canExecute && device.availability === "online" && device.mode === "Дистанційний";
  const dialogCopy = {
    start: { title: "Підтвердити запуск", description: `Контролер ${device.name} отримає команду запуску після підключення API в Етапі 12.`, confirm: "Підтвердити запуск", variant: "primary" as const },
    stop: { title: "Підтвердити зупинку", description: "Мережева Stop-команда не є фізичним аварійним відключенням.", confirm: "Підтвердити Stop", variant: "danger" as const },
    frequency: { title: "Змінити задану частоту", description: `Підготувати команду зі значенням ${frequency} Hz. Остаточні межі має надати конфігурація установки.`, confirm: "Застосувати частоту", variant: "primary" as const },
  };
  const activeCopy = pendingAction ? dialogCopy[pendingAction] : null;

  const blockingReason = !canExecute
    ? "Поточна роль не має permission command.execute."
    : device.availability !== "online"
      ? "Пристрій має бути online."
      : device.mode !== "Дистанційний"
        ? "Потрібен дистанційний режим."
        : null;

  return (
    <Card title="Керування" description="Критичні дії відокремлені від телеметрії, а permission надає backend.">
      <div className="control-panel">
        <div className="control-state">
          <div><strong>{device.running ? "Насос працює" : "Насос зупинений"}</strong><div className="table-secondary">Фактичний state із останнього пакета</div></div>
          <StatusBadge tone={device.mode === "Дистанційний" ? "success" : "warning"}>{device.mode}</StatusBadge>
        </div>
        {blockingReason ? <div className="notice notice-warning">Дистанційні controls заблоковані: {blockingReason}</div> : null}
        <div className="control-actions"><Button variant="primary" disabled={!controlsEnabled} onClick={() => setPendingAction("start")}>Запустити</Button><Button variant="danger" disabled={!controlsEnabled} onClick={() => setPendingAction("stop")}>Зупинити</Button></div>
        <div className="inline-fields"><TextField label="Задана частота, Hz" inputMode="decimal" value={frequency} onChange={(event) => setFrequency(event.target.value)} disabled={!controlsEnabled} /><Button variant="secondary" disabled={!controlsEnabled} onClick={() => setPendingAction("frequency")}>Застосувати</Button></div>
        <div className="notice notice-info">{localMessage}</div>
        <p className="help-copy">До Етапу 12 це локальна демонстрація компонентів. HTTP/MQTT команда не створюється.</p>
      </div>
      {activeCopy ? (
        <ConfirmDialog open title={activeCopy.title} description={activeCopy.description} confirmLabel={activeCopy.confirm} confirmVariant={activeCopy.variant} onClose={() => setPendingAction(null)} onConfirm={() => setLocalMessage("Demo intent підтверджено локально. Команду не надіслано.")}>
          <div className="notice notice-warning">Успішне натискання не означає, що насос змінив фізичний стан.</div>
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}

function TrendChart() {
  return (
    <div className="chart-wrap">
      <div className="chart-legend"><span>Частота VFD · Hz</span><span>Період: останні 6 годин · demo</span></div>
      <svg className="chart-svg" viewBox="0 0 760 240" role="img" aria-label="Демонстраційний графік частоти">
        <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#147f79" stopOpacity="0.18" /><stop offset="100%" stopColor="#147f79" stopOpacity="0" /></linearGradient></defs>
        {[40, 90, 140, 190].map((y) => <line className="chart-grid-line" x1="20" y1={y} x2="740" y2={y} key={y} />)}
        <path className="chart-area" d="M20 190 C90 176 110 165 160 168 S250 130 300 142 S385 105 430 118 S520 82 565 103 S650 70 740 87 L740 220 L20 220 Z" />
        <path className="chart-line" d="M20 190 C90 176 110 165 160 168 S250 130 300 142 S385 105 430 118 S520 82 565 103 S650 70 740 87" />
      </svg>
    </div>
  );
}

export function DeviceDashboard({ device }: { device: DeviceDetail }) {
  const { hasPermission } = useAccessContext();
  const canExecute = hasPermission("command.execute");
  const canManageCapabilities = hasPermission("capability.manage");

  return (
    <>
      <PageHeader eyebrow={`${device.site} · ${device.uid}`} title={device.name} description="Огляд стану, показників, встановлених модулів і останньої команди." actions={<><StatusBadge tone={availabilityTone[device.availability]}>{availabilityLabel[device.availability]}</StatusBadge><Button variant="secondary" disabled title={canManageCapabilities ? "Capability management буде підключено пізніше" : "Поточна роль не має permission capability.manage"}>Налаштування</Button></>} />
      <div className="status-strip" aria-label="Поточний стан пристрою">
        <div className="status-cell"><span className="status-cell-label">Насос</span><span className="status-cell-value">{device.running ? "Працює" : "Зупинений"}</span></div>
        <div className="status-cell"><span className="status-cell-label">Режим</span><span className="status-cell-value">{device.mode}</span></div>
        <div className="status-cell"><span className="status-cell-label">Якість даних</span><span className="status-cell-value">{device.dataQuality === "fresh" ? "Свіжі" : device.dataQuality === "stale" ? "Застарілі" : "Відсутні"}</span></div>
        <div className="status-cell"><span className="status-cell-label">Останній зв’язок</span><span className="status-cell-value">{device.lastSeen}</span></div>
      </div>
      <section className="metrics-grid" aria-label="Ключові показники">
        {device.metrics.map((metric) => <MetricCard key={metric.key} label={metric.label} value={metric.value} unit={metric.unit} meta={metric.meta} status={qualityBadge(metric)} />)}
      </section>
      <div className="dashboard-grid">
        <div className="dashboard-column">
          <Card title="Історія показника" description="Missing не домальовується як нуль; live API з’явиться в Етапі 12.1."><TrendChart /></Card>
          <Card title="Активне попередження" description="Acknowledge не означає, що фізична причина усунена.">
            {device.alarmCount ? <div className="notice notice-warning">Низький тиск: останнє значення наближалося до порогу 2.5 bar. Перевірте водозабір і магістраль.</div> : <div className="notice">Активних попереджень для цього Device немає.</div>}
          </Card>
        </div>
        <div className="dashboard-column">
          <ControlPanel device={device} canExecute={canExecute} />
          <Card title="Встановлені модулі" description="Склад визначається enabled assignments конкретного Device."><div className="module-chips">{device.modules.map((module) => <span className="module-chip" key={module}>{module}</span>)}</div></Card>
          <Card title="Остання команда" description="ACK і фінальний Result показуються окремо.">
            <div className="timeline">{[["Створена", "queued", "14:36:01"], ["Опублікована", "published", "14:36:02"], ["Прийнята контролером", "acknowledged", "14:36:02"], ["Виконана", "succeeded", "14:36:04"]].map(([label, code, time]) => <div className="timeline-step" key={code}><span className="timeline-node" aria-hidden="true" /><span className="timeline-copy"><strong>{label}</strong><span>{code}</span></span><span className="timeline-time">{time}</span></div>)}</div>
          </Card>
        </div>
      </div>
    </>
  );
}
