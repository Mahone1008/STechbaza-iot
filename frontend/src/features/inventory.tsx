"use client";

import { useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button, Card, DataTable, PageHeader, StatusBadge, type TableColumn } from "@/components/ui";
import { useAccessContext, type DirectoryAccessSnapshot, type ReadyAccessSnapshot } from "@/features/access-context";
import { RefreshSettings } from "@/components/refresh-settings";
import { useAuthSession } from "@/features/auth-session";
import { apiErrorDisplayMessage, apiQueryKeys, isApiError } from "@/lib/api";
import { parseOrganization } from "@/lib/api/access";
import { deviceLifecycleLabel } from "@/lib/device-labels";
import {
  formatSeen,
  mapBounded,
  PAGE_SIZE,
  parseAvailability,
  parseDevice,
  parsePage,
  parseSite,
  PRESENCE_CONCURRENCY,
  type Availability,
  type Device,
} from "@/lib/api/inventory";

const customerPortal = process.env.NEXT_PUBLIC_PORTAL_MODE !== "staff";

export function sitesHref(organizationId: string): Route {
  return `/organizations/${organizationId}/sites` as Route;
}
function devicesHref(organizationId: string, siteId: string): Route {
  return `/organizations/${organizationId}/sites/${siteId}/devices` as Route;
}

export function InventoryBreadcrumbs() {
  const { snapshot } = useAccessContext();
  if (snapshot.status !== "ready" && snapshot.status !== "directory") return null;
  return (
    <nav className="inventory-breadcrumbs" aria-label="Шлях до об’єкта">
      <Link href={"/organizations" as Route}>Організації</Link>
      {snapshot.status === "ready" ? (
        <>
          <span aria-hidden="true">/</span>
          <Link href={sitesHref(snapshot.activeOrganization.id)}>{snapshot.activeOrganization.name}</Link>
          {snapshot.activeSite ? (
            <>
              <span aria-hidden="true">/</span>
              <Link href={devicesHref(snapshot.activeOrganization.id, snapshot.activeSite.id)}>
                {snapshot.activeSite.name}
              </Link>
            </>
          ) : null}
          {snapshot.activeDevice ? (
            <>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{snapshot.activeDevice.name}</span>
            </>
          ) : null}
        </>
      ) : null}
    </nav>
  );
}

function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const denied = isApiError(error) && (error.kind === "forbidden" || error.kind === "not-found");
  return (
    <section className="notice notice-warning inventory-state" role="alert">
      <h2>{denied ? "Дані більше недоступні" : "Не вдалося завантажити дані"}</h2>
      <p>{apiErrorDisplayMessage(error)}</p>
      <div className="ui-row">
        <Button onClick={retry}>Повторити</Button>
        <Link className="button button-secondary" href={"/organizations" as Route}>
          Обрати організацію
        </Link>
      </div>
    </section>
  );
}

function Pagination({
  page,
  hasNext,
  busy,
  onPage,
}: {
  page: number;
  hasNext: boolean;
  busy: boolean;
  onPage: (page: number) => void;
}) {
  if (customerPortal && page === 0 && !hasNext) return null;
  return (
    <nav className="inventory-pagination" aria-label="Сторінки списку">
      <Button disabled={page === 0 || busy} onClick={() => onPage(page - 1)}>
        Попередня
      </Button>
      <span aria-live="polite">Сторінка {page + 1}</span>
      <Button disabled={!hasNext || busy} onClick={() => onPage(page + 1)}>
        Наступна
      </Button>
    </nav>
  );
}

type DirectoryRow = { id: string; name: string; description: string; href: Route | null };
function Directory({ context, sites }: { context: DirectoryAccessSnapshot | ReadyAccessSnapshot; sites: boolean }) {
  const { authorizedRequest } = useAuthSession();
  const { hasPermission } = useAccessContext();
  const [page, setPage] = useState(0);
  const organizationId = sites && context.status === "ready" ? context.activeOrganization.id : null;
  const query = useQuery({
    queryKey: apiQueryKeys.inventory(context.scope, organizationId, null, sites ? "sites" : "organizations", page),
    gcTime: 0,
    queryFn: async ({ signal }): Promise<DirectoryRow[]> => {
      const payload = await authorizedRequest<unknown>({
        path: sites ? `/api/v1/organizations/${organizationId}/sites` : "/api/v1/organizations",
        query: { limit: PAGE_SIZE + 1, offset: page * PAGE_SIZE },
        signal,
      });
      return sites
        ? parsePage(payload, (item) => parseSite(item, organizationId!)).map((site) => ({
            id: site.id,
            name: site.name,
            description: customerPortal ? `Час об’єкта: ${site.timezone}` : `${site.code} · ${site.timezone}`,
            href: devicesHref(organizationId!, site.id),
          }))
        : parsePage(payload, (item) => parseOrganization(item, "/api/v1/organizations")).map((organization) => ({
            id: organization.id,
            name: organization.name,
            description: organization.is_active ? "Активна" : "Неактивна",
            href: organization.is_active ? sitesHref(organization.id) : null,
          }));
    },
  });
  const rows = query.data?.slice(0, PAGE_SIZE) ?? [];
  const columns: TableColumn<DirectoryRow>[] = [
    {
      key: "name",
      header: sites ? "Об’єкт" : "Організація",
      render: (row) =>
        row.href ? (
          <Link className="table-primary" href={row.href}>
            {row.name}
          </Link>
        ) : (
          <span>{row.name}</span>
        ),
    },
    { key: "description", header: sites ? "Код · часовий пояс" : "Стан", render: (row) => row.description },
  ];
  return (
    <>
      <PageHeader
        title={sites ? "Об’єкти" : "Організації"}
        description={
          sites
            ? "Оберіть об’єкт, щоб переглянути його пристрої."
            : "Оберіть організацію, щоб перейти до її об’єктів та обладнання."
        }
        actions={
          sites && organizationId && hasPermission("membership.read") ? (
            <Link className="button button-secondary" href={`/organizations/${organizationId}/members` as Route}>
              Учасники організації
            </Link>
          ) : undefined
        }
      />
      {query.isFetching ? (
        <p role="status">Завантажуємо {sites ? "об’єкти" : "організації"}…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : customerPortal ? (
        rows.length ? (
          <ul className="inventory-card-list" aria-label={sites ? "Список об’єктів" : "Список організацій"}>
            {rows.map((row) => (
              <li key={row.id}>
                {row.href ? (
                  <Link className="inventory-directory-card" href={row.href} aria-label={row.name}>
                    <span className="inventory-card-kind">{sites ? "Об’єкт" : "Організація"}</span>
                    <h2>{row.name}</h2>
                    <p>{row.description}</p>
                    <span className="inventory-card-open">
                      Відкрити <span aria-hidden="true">→</span>
                    </span>
                  </Link>
                ) : (
                  <div className="inventory-directory-card inventory-card-inactive">
                    <h2>{row.name}</h2>
                    <p>{row.description}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Card>
            <p>{sites ? "У цій організації ще немає об’єктів." : "На цій сторінці немає доступних організацій."}</p>
          </Card>
        )
      ) : (
        <DataTable
          caption={sites ? "Список об’єктів" : "Список організацій"}
          rows={rows}
          columns={columns}
          emptyMessage={sites ? "У цій організації ще немає об’єктів." : "На цій сторінці немає доступних організацій."}
        />
      )}
      <RefreshSettings error={query.isError}>
        <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
          Оновити список
        </Button>
      </RefreshSettings>
      <Pagination
        page={page}
        hasNext={!query.isError && (query.data?.length ?? 0) > PAGE_SIZE}
        busy={query.isFetching}
        onPage={setPage}
      />
    </>
  );
}

export function OrganizationList() {
  const { snapshot } = useAccessContext();
  return snapshot.status === "directory" ? (
    <Directory key={`${snapshot.scope.userId}:${snapshot.scope.sessionId}`} context={snapshot} sites={false} />
  ) : null;
}
export function SiteList() {
  const { snapshot } = useAccessContext();
  return snapshot.status === "ready" ? (
    <Directory
      key={`${snapshot.scope.userId}:${snapshot.scope.sessionId}:${snapshot.activeOrganization.id}`}
      context={snapshot}
      sites
    />
  ) : null;
}

type Presence = Readonly<{ availability: Availability | null; error?: string; checkedAt: string }>;
function PresenceTable({
  devices,
  context,
  version,
}: {
  devices: Device[];
  context: ReadyAccessSnapshot;
  version: number;
}) {
  const { authorizedRequest } = useAuthSession();
  const query = useQuery({
    queryKey: [
      ...apiQueryKeys.inventory(
        context.scope,
        context.activeOrganization.id,
        context.activeSite?.id ?? null,
        "presence",
      ),
      devices.map((device) => device.id),
      version,
    ],
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }): Promise<Presence[]> => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      try {
        return await mapBounded(devices, PRESENCE_CONCURRENCY, controller.signal, async (device) => {
          try {
            const payload = await authorizedRequest<unknown>({
              path: `/api/v1/devices/${device.id}/availability`,
              signal: controller.signal,
              timeoutMs: 5_000,
            });
            return { availability: parseAvailability(payload, device), checkedAt: new Date().toISOString() };
          } catch (error) {
            if (
              controller.signal.aborted ||
              (isApiError(error) && ["unauthorized", "forbidden", "not-found", "aborted"].includes(error.kind))
            )
              throw error;
            return { availability: null, error: apiErrorDisplayMessage(error), checkedAt: new Date().toISOString() };
          }
        });
      } finally {
        controller.abort();
        signal.removeEventListener("abort", abort);
      }
    },
  });
  const byId = new Map(devices.map((device, index) => [device.id, query.data?.[index]]));
  const status = (presence: Presence | undefined): ReactNode => {
    if (query.isFetching || !presence) return <StatusBadge tone="neutral">Перевіряємо зв’язок…</StatusBadge>;
    if (!presence.availability)
      return (
        <span title={presence.error}>
          <StatusBadge tone="warning">Стан невідомий</StatusBadge>
        </span>
      );
    if (presence.availability.last_seen_at === null)
      return <StatusBadge tone="neutral">Ще не було зв’язку</StatusBadge>;
    return (
      <StatusBadge tone={presence.availability.online ? "success" : "neutral"}>
        {presence.availability.online ? "На зв’язку" : "Немає зв’язку"}
      </StatusBadge>
    );
  };
  const columns: TableColumn<Device>[] = [
    {
      key: "device",
      header: "Пристрій",
      render: (device) => (
        <>
          <Link className="table-primary" href={`/devices/${device.id}` as Route}>
            {device.name}
          </Link>
          <div className="table-secondary">{device.uid}</div>
          <div className="table-secondary">
            Тип: {device.device_type} · Життєвий цикл: {device.lifecycle_status}
          </div>
        </>
      ),
    },
    {
      key: "presence",
      header: "Стан зв’язку",
      render: (device) => (
        <>
          {status(byId.get(device.id))}
          <div className="table-secondary">
            {query.isFetching
              ? ""
              : byId.get(device.id)
                ? `Перевірено: ${formatSeen(byId.get(device.id)!.checkedAt, context.activeSite?.timezone)}`
                : ""}
          </div>
          {!query.isFetching && byId.get(device.id)?.availability ? (
            <div className="table-secondary">
              Останній зв’язок:{" "}
              {formatSeen(byId.get(device.id)!.availability!.last_seen_at, context.activeSite?.timezone)}
            </div>
          ) : null}
        </>
      ),
    },
  ];
  // 403/404 приховує всю сторінку до повторної перевірки, без застарілих рядків.
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return (
    <>
      <div className="toolbar">
        <span className="table-secondary">
          Показано: {devices.length}. Час об’єкта: {context.activeSite?.timezone ?? "UTC"}.
        </span>
      </div>
      {customerPortal ? (
        devices.length ? (
          <ul className="inventory-card-list" aria-label="Список пристроїв KERUMO">
            {devices.map((device) => {
              const presence = byId.get(device.id);
              return (
                <li key={device.id}>
                  <article className="inventory-device-card">
                    <div className="inventory-device-heading">
                      <span className="inventory-card-kind">Контролер</span>
                      {status(presence)}
                    </div>
                    <h2>
                      <Link className="inventory-device-link" href={`/devices/${device.id}` as Route}>
                        {device.name}
                        <span aria-hidden="true">→</span>
                      </Link>
                    </h2>
                    <p className="help-copy">Відкрийте панель, щоб перевірити показання та керувати обладнанням.</p>
                    <details>
                      <summary>Відомості про контролер</summary>
                      <dl className="overview-details">
                        <div>
                          <dt>Номер контролера</dt>
                          <dd>{device.uid}</dd>
                        </div>
                        <div>
                          <dt>Стан реєстрації</dt>
                          <dd>{deviceLifecycleLabel(device.lifecycle_status)}</dd>
                        </div>
                        <div>
                          <dt>Зв’язок перевірено</dt>
                          <dd>
                            {query.isFetching
                              ? "Перевіряємо…"
                              : presence
                                ? formatSeen(presence.checkedAt, context.activeSite?.timezone)
                                : "Немає даних"}
                          </dd>
                        </div>
                        {presence?.availability && (
                          <div>
                            <dt>Останній зв’язок</dt>
                            <dd>{formatSeen(presence.availability.last_seen_at, context.activeSite?.timezone)}</dd>
                          </div>
                        )}
                      </dl>
                    </details>
                  </article>
                </li>
              );
            })}
          </ul>
        ) : (
          <Card>
            <p>На цій сторінці пристроїв немає.</p>
          </Card>
        )
      ) : (
        <DataTable
          caption="Список пристроїв KERUMO"
          rows={devices}
          columns={columns}
          emptyMessage="На цій сторінці пристроїв немає."
        />
      )}
      <p className="help-copy">
        Зв’язок показано на час останньої перевірки. Для поточних показників і стану обладнання відкрийте панель
        пристрою.
      </p>
      <RefreshSettings label="Оновлення зв’язку">
        <Button disabled={query.isFetching || devices.length === 0} onClick={() => void query.refetch()}>
          Оновити зв’язок
        </Button>
      </RefreshSettings>
    </>
  );
}

function DevicePageList({ context }: { context: ReadyAccessSnapshot }) {
  const { authorizedRequest } = useAuthSession();
  const [page, setPage] = useState(0);
  const siteId = context.activeSite?.id;
  const query = useQuery({
    queryKey: apiQueryKeys.inventory(context.scope, context.activeOrganization.id, siteId ?? null, "devices", page),
    enabled: Boolean(siteId),
    gcTime: 0,
    queryFn: async ({ signal }) =>
      parsePage(
        await authorizedRequest<unknown>({
          path: `/api/v1/sites/${siteId}/devices`,
          query: { limit: PAGE_SIZE + 1, offset: page * PAGE_SIZE },
          signal,
        }),
        (item) => parseDevice(item, siteId),
      ),
  });
  return (
    <>
      <PageHeader
        title="Пристрої"
        eyebrow={context.activeSite?.name ?? "Оберіть об’єкт"}
        description="Оберіть пристрій, щоб перевірити його стан або перейти до керування."
      />
      {!siteId ? (
        <Card title="Оберіть об’єкт">
          <p>Оберіть об’єкт, щоб переглянути його пристрої.</p>
          <Link className="button button-secondary" href={sitesHref(context.activeOrganization.id)}>
            Переглянути об’єкти
          </Link>
        </Card>
      ) : query.isFetching ? (
        <p role="status">Завантажуємо пристрої…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data ? (
        <PresenceTable
          key={`${page}:${query.dataUpdatedAt}`}
          devices={query.data.slice(0, PAGE_SIZE)}
          context={context}
          version={query.dataUpdatedAt}
        />
      ) : null}
      <RefreshSettings error={query.isError}>
        <Button disabled={!siteId || query.isFetching} onClick={() => void query.refetch()}>
          Оновити список
        </Button>
      </RefreshSettings>
      {siteId ? (
        <Pagination
          page={page}
          hasNext={!query.isError && (query.data?.length ?? 0) > PAGE_SIZE}
          busy={query.isFetching}
          onPage={setPage}
        />
      ) : null}
    </>
  );
}
export function DeviceList() {
  const { snapshot } = useAccessContext();
  return snapshot.status === "ready" ? (
    <DevicePageList
      key={`${snapshot.scope.userId}:${snapshot.scope.sessionId}:${snapshot.activeOrganization.id}:${snapshot.activeSite?.id}`}
      context={snapshot}
    />
  ) : null;
}
