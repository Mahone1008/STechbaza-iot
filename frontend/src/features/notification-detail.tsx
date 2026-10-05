"use client";
import Link from "next/link";
import { useRef } from "react";
import { Button, Card, PageHeader } from "@/components/ui";
import { StableRegion } from "@/components/stable-region";
import { apiQueryKeys } from "@/lib/api";
import { formatSeen } from "@/lib/api/inventory";
import { parseNotification } from "@/lib/api/notifications";
import { useAccessContext, type ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import { useNotificationRead } from "./use-notification-read";
import { alarmHref } from "./alarm-shared";
import { NotificationBadges, NotificationError, notificationsHref } from "./notification-shared";

function Detail({ context, id }: { context: ReadyAccessSnapshot; id: string }) {
  const { authorizedRequest } = useAuthSession();
  const { retryAccess } = useAccessContext();
  const sequence = useRef(0);
  const query = usePanelQuery({
    queryKey: apiQueryKeys.notification(context.scope, context.activeOrganization.id, id), intervalMs: 0,
    queryFn: async (signal) => ({ item: parseNotification(await authorizedRequest({ path: `/api/v1/notifications/${id}`, signal, timeoutMs: 10_000 }), context.activeOrganization.id, id), read: ++sequence.current }),
  });
  const item = query.isFetching || query.isError ? null : query.data?.item ?? null;
  const mark = useNotificationRead({ item, read: query.data?.read ?? 0, active: query.active && !query.isFetching && context.access.permissions.includes("notification.read"), refresh: query.refresh });
  const reconciled = item && mark.outcome && query.data!.read > mark.outcome.checkedRead && !mark.outcome.denied;
  const message = reconciled ? item.read_at ? "Стан перевірено: повідомлення прочитане вами." : "Стан перевірено: повідомлення ще не прочитане вами." : mark.outcome?.message;
  return <>
    <PageHeader title="Деталі повідомлення" eyebrow={context.activeOrganization.name} description="Повідомлення зберігає подію на момент її виникнення. Поточний стан доступний у деталях інциденту." actions={<Link className="button button-secondary" href={notificationsHref(context.activeOrganization.id)}>До повідомлень</Link>} />
    <Card title="Подія та прочитання" actions={<Button disabled={!query.active || query.isFetching || mark.busy} onClick={mark.outcome?.denied ? retryAccess : query.refresh}>{mark.outcome?.denied ? "Оновити доступ" : "Перевірити повідомлення"}</Button>}>
      {mark.outcome && <p role={reconciled ? "status" : "alert"} className="notice">{message}</p>}
      {mark.busy && <p role="status">Зберігаємо прочитання…</p>}
      <StableRegion>{mark.outcome?.denied ? <NotificationError error={mark.outcome.error} /> : query.isPending || query.isFetching ? <p role="status">Завантажуємо повідомлення…</p> : query.isError ? <NotificationError error={query.error} /> : item && <>
        <h2 className="alarm-title">{item.title}</h2>
        {item.description && <p className="alarm-title">{item.description}</p>}
        <NotificationBadges item={item} />
        <dl className="overview-details"><div><dt>Час події (UTC)</dt><dd>{formatSeen(item.occurred_at)}</dd></div><div><dt>Створено (UTC)</dt><dd>{formatSeen(item.created_at)}</dd></div><div><dt>Прочитано вами (UTC)</dt><dd>{item.read_at ? formatSeen(item.read_at) : "Ще не прочитано"}</dd></div></dl>
        <p>Прочитання стосується лише вашого облікового запису. Воно не підтверджує аварію та не усуває її причину.</p>
        <div className="ui-row">{!item.read_at && <Button variant="primary" disabled={!mark.canRead} onClick={() => void mark.markRead()}>Позначити прочитаним</Button>}{context.access.permissions.includes("alarm.read") && <Link className="button button-secondary" href={alarmHref(item.device_id, item.alarm_id)}>До інциденту</Link>}</div>
        {mark.needsCheck && <p>Перед повторною спробою натисніть «Перевірити повідомлення».</p>}
        {mark.waiting && <p role="status">Зачекайте до завершення обмеження повторних запитів.</p>}
      </>}</StableRegion>
    </Card>
  </>;
}

export function NotificationDetail({ notificationId }: { notificationId: string }) {
  const { snapshot } = useAccessContext();
  if (snapshot.status !== "ready") return null;
  return <Detail key={`${snapshot.scope.userId}:${snapshot.scope.sessionId}:${snapshot.activeOrganization.id}:${notificationId}`} context={snapshot} id={notificationId} />;
}
