"use client";

import { useAccessContext } from "@/features/access-context";
import { alarms, type AlarmSeverity } from "@/lib/demo-data";
import { Button, PageHeader, SelectField, StatusBadge, type StatusTone } from "@/components/ui";

const severityTone: Record<AlarmSeverity, StatusTone> = {
  critical: "danger",
  warning: "warning",
  info: "info",
};

const severityLabel: Record<AlarmSeverity, string> = {
  critical: "Критична",
  warning: "Попередження",
  info: "Інформація",
};

export function AlarmList() {
  const { snapshot } = useAccessContext();
  const organizationName = snapshot.status === "ready" ? snapshot.activeOrganization.name : "Організація";

  return (
    <>
      <PageHeader
        eyebrow={`Організація · ${organizationName}`}
        title="Аварії та інциденти"
        description="Статус інциденту, його підтвердження та фактичне відновлення показуються окремо. Дані інцидентів поки демонстраційні."
        actions={<Button variant="secondary" disabled title="Експорт не входить у поточний frontend release">Експортувати</Button>}
      />

      <div className="toolbar">
        <div className="toolbar-search">
          <SelectField label="Фільтр стану" defaultValue="active">
            <option value="active">Активні та підтверджені</option>
            <option value="all">Усі інциденти</option>
            <option value="resolved">Вирішені</option>
          </SelectField>
        </div>
        <StatusBadge tone="warning">2 потребують уваги</StatusBadge>
      </div>

      <div className="alarm-grid">
        {alarms.map((alarm) => (
          <article className="card alarm-card" key={alarm.id}>
            <span className={`alarm-marker${alarm.severity === "critical" ? " alarm-marker-danger" : ""}`} aria-hidden="true" />
            <div className="alarm-copy">
              <h3>{alarm.title}</h3>
              <p>{alarm.description}</p>
              <div className="alarm-meta"><span>{alarm.device}</span><span>{alarm.site}</span><span>{alarm.createdAt}</span></div>
            </div>
            <div className="ui-stack">
              <StatusBadge tone={severityTone[alarm.severity]}>{severityLabel[alarm.severity]}</StatusBadge>
              <StatusBadge tone={alarm.status === "Вирішена" ? "success" : "neutral"}>{alarm.status}</StatusBadge>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
