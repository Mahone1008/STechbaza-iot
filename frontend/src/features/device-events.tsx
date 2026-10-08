"use client";
import { RefreshAction } from "./refresh-actions";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, SelectField } from "@/components/ui";
import { apiErrorDisplayMessage } from "@/lib/api";
import { isRecord, requiredDateTime, requiredString, requiredUuid, invalidResponse } from "@/lib/api/access";
import { formatSeen } from "@/lib/api/inventory";
import { usePanelQuery } from "./use-panel-query";
import { useAuthSession } from "./auth-session";
import { alarmsHref } from "./alarm-shared";
import { notificationsHref } from "./notification-shared";
import type { ReadyAccessSnapshot } from "./access-context";
import type { PollSeconds } from "@/lib/api/polling-policy";

export function DeviceEvents({ context, poll }: { context: ReadyAccessSnapshot; poll: PollSeconds }) {
  const { authorizedRequest } = useAuthSession();
  const [severity, setSeverity] = useState("");
  const [offset, setOffset] = useState(0);
  const device = context.activeDevice!;
  const path = `/api/v1/devices/${device.id}/events`;
  const query = usePanelQuery({
    queryKey: ["device-events", context.scope, device.id, severity, offset],
    enabled: context.access.permissions.includes("event.read"),
    intervalMs: poll ? Math.max(30, poll) * 1000 : 0,
    queryFn: async (signal) => {
      const raw = await authorizedRequest<unknown>({
        path,
        query: { limit: 25, offset, severity: severity || undefined },
        signal,
      });
      if (!Array.isArray(raw)) return invalidResponse(path, "events");
      return raw.map((item) => {
        if (!isRecord(item) || item.device_id !== device.id) return invalidResponse(path, "device event");
        return {
          id: requiredUuid(item, "id", path),
          title: requiredString(item, "title", path),
          occurred: requiredDateTime(item, "occurred_at", path),
          message: typeof item.message === "string" ? item.message : null,
        };
      });
    },
  });
  return (
    <Card title="Події пристрою">
      <div className="ui-row">
        {context.access.permissions.includes("alarm.read") && (
          <Link className="button button-secondary" href={alarmsHref(device.id)}>
            Аварії пристрою
          </Link>
        )}
        {context.access.permissions.includes("notification.read") && (
          <Link className="button button-secondary" href={notificationsHref(context.activeOrganization.id)}>
            Повідомлення об’єктів
          </Link>
        )}
      </div>
      {context.access.permissions.includes("event.read") && (
        <>
          <SelectField
            label="Важливість події"
            value={severity}
            onChange={(event) => {
              setSeverity(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">Усі події</option>
            <option value="info">Інформаційні</option>
            <option value="warning">Попередження</option>
            <option value="critical">Критичні</option>
          </SelectField>
          {query.isError ? (
            <p role="alert">{apiErrorDisplayMessage(query.error)}</p>
          ) : !query.data ? (
            <p role="status">Завантажуємо події…</p>
          ) : query.data.length === 0 ? (
            <p>За цим фільтром подій немає.</p>
          ) : (
            <ol className="device-events">
              {query.data.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <time dateTime={item.occurred}>
                    {formatSeen(item.occurred, context.activeSite?.timezone ?? "UTC")}
                  </time>
                  {item.message && <p>{item.message}</p>}
                </li>
              ))}
            </ol>
          )}
          <div className="ui-row">
            <Button disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - 25))}>
              Попередні події
            </Button>
            <Button disabled={query.data?.length !== 25 || query.isFetching} onClick={() => setOffset(offset + 25)}>
              Наступні події
            </Button>
          </div>
          <RefreshAction onRefresh={query.refresh} disabled={!query.active || query.isFetching} error={query.isError} />
        </>
      )}
    </Card>
  );
}
