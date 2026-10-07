"use client";
import { RefreshSettings } from "@/components/refresh-settings";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, DataTable, PageHeader, SelectField } from "@/components/ui";
import { StableRegion } from "@/components/stable-region";
import { apiQueryKeys } from "@/lib/api";
import { formatSeen } from "@/lib/api/inventory";
import { parseNotificationPage, parseUnreadCount } from "@/lib/api/notifications";
import { useAccessContext, type ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import { AlarmPagination } from "./alarm-shared";
import { NotificationBadges, NotificationError, notificationHref } from "./notification-shared";

function Feed({ context }: { context: ReadyAccessSnapshot }) {
  const { authorizedRequest } = useAuthSession();
  const [selection, setSelection] = useState({ page: 0, unreadOnly: false });
  const organization = context.activeOrganization;
  const query = usePanelQuery({
    queryKey: [...apiQueryKeys.notifications(context.scope, organization.id, selection.page), selection.unreadOnly],
    intervalMs: 0,
    queryFn: async (signal) => {
      // Дві обмежені операції; збій будь-якої приховує попередній tenant snapshot.
      const [rows, count] = await Promise.all([
        authorizedRequest({
          path: `/api/v1/organizations/${organization.id}/notifications`,
          query: { limit: 21, offset: selection.page * 20, unread_only: selection.unreadOnly },
          signal,
          timeoutMs: 10_000,
        }),
        authorizedRequest({
          path: `/api/v1/organizations/${organization.id}/notifications/unread-count`,
          signal,
          timeoutMs: 10_000,
        }),
      ]);
      return {
        rows: parseNotificationPage(rows, organization.id, selection.unreadOnly),
        unread: parseUnreadCount(count),
      };
    },
  });
  const visible = !query.isError && !query.isFetching ? query.data : undefined;
  return (
    <>
      <PageHeader
        title="Повідомлення"
        eyebrow={organization.name}
        description="Події ваших пристроїв і непрочитані повідомлення."
        actions={
          <Link className="button button-secondary" href="/organizations">
            Обрати організацію
          </Link>
        }
      />
      <div className="history-controls">
        <SelectField
          label="Показати повідомлення"
          aria-label="Показати повідомлення"
          value={selection.unreadOnly ? "unread" : "all"}
          onChange={(e) => setSelection({ page: 0, unreadOnly: e.target.value === "unread" })}
        >
          <option value="all">Усі</option>
          <option value="unread">Непрочитані мною</option>
        </SelectField>
      </div>
      <Card
        title="Стрічка організації"
        actions={
          <RefreshSettings error={query.isError}>
            <Button
              disabled={!query.active || query.isFetching}
              onClick={() => {
                if (selection.page) setSelection((old) => ({ ...old, page: 0 }));
                else query.refresh();
              }}
            >
              Оновити повідомлення
            </Button>
          </RefreshSettings>
        }
      >
        <StableRegion>
          {query.isFetching || query.isPending ? (
            <p role="status">Завантажуємо повідомлення…</p>
          ) : query.isError ? (
            <NotificationError error={query.error} />
          ) : (
            visible && (
              <>
                <p role="status">
                  Непрочитаних вами: <strong>{visible.unread}</strong>
                </p>
                <DataTable
                  mobileCards
                  caption="Повідомлення організації"
                  rows={visible.rows.slice(0, 20)}
                  emptyMessage="За вибраним фільтром повідомлень немає."
                  columns={[
                    {
                      key: "title",
                      header: "Повідомлення",
                      render: (item) => (
                        <Link className="table-primary alarm-title" href={notificationHref(organization.id, item.id)}>
                          {item.title}
                        </Link>
                      ),
                    },
                    {
                      key: "kind",
                      header: "Подія та прочитання",
                      render: (item) => <NotificationBadges item={item} />,
                    },
                    { key: "time", header: "Час події (UTC)", render: (item) => formatSeen(item.occurred_at) },
                  ]}
                />
              </>
            )
          )}
        </StableRegion>
        <AlarmPagination
          page={selection.page}
          more={(visible?.rows.length ?? 0) > 20}
          busy={!query.active || query.isFetching}
          onPage={(page) => setSelection((old) => ({ ...old, page }))}
        />
        <details className="customer-disclosure section-help">
          <summary>Як працюють повідомлення</summary>
          <p className="help-copy">
            Прочитання зберігається окремо для кожного користувача. До 20 записів на сторінці. Список і лічильник
            завантажуються окремо та можуть відрізнятися під час нових подій. Нові повідомлення або прочитання можуть
            змінити склад сторінок; оновлення повертає першу сторінку.
          </p>
        </details>
      </Card>
    </>
  );
}

export function NotificationFeed() {
  const { snapshot } = useAccessContext();
  if (snapshot.status !== "ready") return null;
  return (
    <Feed
      key={`${snapshot.scope.userId}:${snapshot.scope.sessionId}:${snapshot.activeOrganization.id}`}
      context={snapshot}
    />
  );
}
