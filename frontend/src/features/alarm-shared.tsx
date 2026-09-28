"use client";
import type { Route } from "next";
import { Button, StatusBadge } from "@/components/ui";
import { apiErrorDisplayMessage, isApiError } from "@/lib/api";
import { alarmSeverityLabels, alarmStateLabels, type Alarm } from "@/lib/api/alarms";

export function alarmsHref(deviceId: string): Route { return `/alarms/devices/${deviceId}` as Route; }
export function alarmHref(deviceId: string, alarmId: string): Route { return `/alarms/devices/${deviceId}/${alarmId}` as Route; }
export function AlarmBadges({ alarm }: { alarm: Alarm }) {
  return <div className="ui-row"><StatusBadge tone={alarm.severity === "critical" ? "danger" : "warning"}>{alarmSeverityLabels[alarm.severity]}</StatusBadge><StatusBadge tone={alarm.state === "resolved" ? "success" : "warning"}>{alarmStateLabels[alarm.state]}</StatusBadge><StatusBadge tone="neutral">{alarm.acknowledged_at ? "Підтверджена оператором" : "Без підтвердження"}</StatusBadge></div>;
}
export function AlarmError({ error }: { error: unknown }) {
  const denied = isApiError(error) && ["forbidden", "not-found", "unauthorized"].includes(error.kind);
  return <section role="alert" className="notice notice-warning"><h2>{denied ? "Аварії недоступні" : "Не вдалося завантажити аварії"}</h2><p>{apiErrorDisplayMessage(error)}</p></section>;
}
export function AlarmPagination({ page, more, busy, onPage }: { page: number; more: boolean; busy: boolean; onPage: (page: number) => void }) {
  return <div className="ui-row"><Button disabled={!page || busy} onClick={() => onPage(page - 1)}>Попередня сторінка</Button><span>Сторінка {page + 1}</span><Button disabled={!more || busy} onClick={() => onPage(page + 1)}>Наступна сторінка</Button></div>;
}
