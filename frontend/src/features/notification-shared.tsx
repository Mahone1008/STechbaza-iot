"use client";
import type { Route } from "next";
import { StatusBadge } from "@/components/ui";
import { apiErrorDisplayMessage } from "@/lib/api";
import { alarmSeverityLabels } from "@/lib/api/alarms";
import { notificationKindLabels, type Notification } from "@/lib/api/notifications";

export function notificationsHref(organizationId: string): Route { return `/organizations/${organizationId}/notifications` as Route; }
export function notificationHref(organizationId: string, id: string): Route { return `/organizations/${organizationId}/notifications/${id}` as Route; }
export function NotificationBadges({ item }: { item: Notification }) {
  return <div className="ui-row"><StatusBadge tone={item.kind === "resolved" ? "success" : "warning"}>{notificationKindLabels[item.kind]}</StatusBadge><StatusBadge tone={item.severity === "critical" ? "danger" : "warning"}>{alarmSeverityLabels[item.severity]}</StatusBadge><StatusBadge tone={item.read_at ? "neutral" : "info"}>{item.read_at ? "Прочитано вами" : "Не прочитано вами"}</StatusBadge></div>;
}
export function NotificationError({ error }: { error: unknown }) {
  return <section role="alert" className="notice notice-warning"><h2>Повідомлення недоступні</h2><p>{apiErrorDisplayMessage(error)}</p></section>;
}
