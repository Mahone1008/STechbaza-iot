"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, DataTable, MetricCard, SelectField, StatusBadge, TextField } from "@/components/ui";
import { bytesLabel, dateLabel, Pager, QueryFeedback, useStaffQuery, type Schema } from "./shared";

export function OverviewPanel({ admin }: { admin: boolean }) {
  const overview = useStaffQuery<Schema["StaffOverview"]>("/api/v1/staff/overview", undefined, 30_000);
  const value = overview.data;
  return (
    <div className="staff-section-stack">
      <div className="staff-section-toolbar">
        <span>Оновлення кожні 30 секунд, коли вкладка відкрита</span>
        <Button onClick={overview.refresh}>Оновити</Button>
      </div>
      <QueryFeedback error={overview.error} loading={!value && !overview.error} />
      {value && (
        <>
          <div className="staff-metrics">
            <MetricCard
              label="Організації"
              value={String(value.organizations)}
              unit=""
              meta={admin ? "Усі організації платформи" : "Організації з вашим доступом"}
            />
            <MetricCard label="Об’єкти" value={String(value.sites)} unit="" meta="Місця встановлення обладнання" />
            <MetricCard label="Контролери" value={String(value.devices)} unit="" meta="Активовані пристрої" />
            <MetricCard
              label="Без зв’язку"
              value={String(value.offline_devices)}
              unit=""
              meta="Не надходять свіжі дані"
              status={
                <StatusBadge tone={value.offline_devices ? "warning" : "success"}>
                  {value.offline_devices ? "Потребують уваги" : "Усе гаразд"}
                </StatusBadge>
              }
            />
            <MetricCard
              label="Активні аварії"
              value={String(value.active_alarms)}
              unit=""
              meta="Аварії на доступному обладнанні"
              status={
                <StatusBadge tone={value.active_alarms ? "danger" : "success"}>
                  {value.active_alarms ? "Перевірте обладнання" : "Аварій немає"}
                </StatusBadge>
              }
            />
            {admin && (
              <MetricCard
                label="Користувачі"
                value={String(value.users ?? 0)}
                unit=""
                meta={`Невдалих входів за добу: ${value.login_failures_24h ?? 0}`}
              />
            )}
          </div>
          <Card title="Наступні дії">
            <div className="staff-shortcuts">
              <Link href={"/operations?section=devices" as Route}>
                <strong>Перевірити обладнання</strong>
                <span>З’єднання, панель керування й історія</span>
              </Link>
              <Link href={"/operations?section=organizations" as Route}>
                <strong>{admin ? "Керувати організаціями" : "Відкрити призначені об’єкти"}</strong>
                <span>
                  {admin ? "Команди, учасники та сервісний доступ" : "Обладнання клієнтів, яким ви допомагаєте"}
                </span>
              </Link>
              {admin && (
                <Link href={"/operations?section=audit" as Route}>
                  <strong>Переглянути журнал</strong>
                  <span>Входи, зміни доступу й адміністративні дії</span>
                </Link>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export function DevicesPanel() {
  const [search, setSearch] = useState("");
  const [q, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [offline, setOffline] = useState(false);
  const list = useStaffQuery<Schema["StaffDeviceRead"][]>("/api/v1/staff/devices", {
    q,
    offline_only: offline,
    limit: 25,
    offset,
  });
  return (
    <Card
      title="Обладнання"
      description="На панелі контролера доступні показники, журнал, розклади та безпечні операції з обладнанням."
    >
      <form
        className="staff-filter"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search.trim());
          setOffset(0);
        }}
      >
        <TextField
          label="Контролер, організація або об’єкт"
          value={search}
          maxLength={160}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit">Знайти</Button>
        <Button onClick={list.refresh}>Оновити</Button>
      </form>
      <label className="staff-check">
        <input
          type="checkbox"
          checked={offline}
          onChange={(event) => {
            setOffline(event.target.checked);
            setOffset(0);
          }}
        />
        Лише пристрої без зв’язку
      </label>
      <QueryFeedback error={list.error} loading={!list.data && !list.error} />
      {list.data && (
        <>
          <DataTable
            rows={list.data}
            caption="Контролери"
            columns={[
              {
                key: "name",
                header: "Контролер",
                render: (row) => (
                  <div className="staff-cell-stack">
                    <strong>{row.name}</strong>
                    <span>{row.uid}</span>
                  </div>
                ),
              },
              {
                key: "where",
                header: "Місце встановлення",
                render: (row) => (
                  <div className="staff-cell-stack">
                    <strong>{row.organization_name}</strong>
                    <span>{row.site_name}</span>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Зв’язок",
                render: (row) => (
                  <StatusBadge tone={row.online ? "success" : "warning"}>
                    {row.online ? "На зв’язку" : "Без зв’язку"}
                  </StatusBadge>
                ),
              },
              { key: "last", header: "Останні дані", render: (row) => dateLabel(row.last_seen_at) },
              {
                key: "actions",
                header: "Дії",
                render: (row) => (
                  <Link className="button button-small button-secondary" href={`/devices/${row.id}` as Route}>
                    Панель контролера
                  </Link>
                ),
              },
            ]}
          />
          <Pager offset={offset} length={list.data.length} onChange={setOffset} />
        </>
      )}
    </Card>
  );
}

const actions: Record<string, string> = {
  "user.updated": "Змінено обліковий запис",
  "user.security_reset": "Скинуто захист",
  "user.sessions_revoked": "Завершено сесії",
  "organization.updated": "Змінено організацію",
  "organization.deleted": "Видалено організацію",
  "site.updated": "Змінено об’єкт",
  "site.deleted": "Видалено об’єкт",
  "membership.created": "Надано доступ до організації",
  "membership.updated": "Змінено доступ учасника",
  "demo.accounts_reset": "Очищено приклади та захист",
};
function actionLabel(row: Schema["AuditRead"]) {
  if (actions[row.action]) return actions[row.action];
  const route = typeof row.details.route === "string" ? row.details.route : "";
  if (route.endsWith("/login")) return row.status >= 400 ? "Невдалий вхід" : "Вхід до кабінету";
  if (route.endsWith("/logout")) return "Вихід із кабінету";
  if (route.endsWith("/recover")) return "Відновлення доступу";
  if (route.includes("factory")) return "Операція заводського реєстру";
  if (route.includes("commands")) return "Команда обладнанню";
  if (route.includes("schedules")) return "Зміна розкладу";
  return "Запит до платформи";
}
export function AuditPanel() {
  const [action, setAction] = useState("");
  const [failed, setFailed] = useState(false);
  const [offset, setOffset] = useState(0);
  const list = useStaffQuery<Schema["AuditRead"][]>("/api/v1/staff/audit", {
    action,
    failed_only: failed,
    limit: 50,
    offset,
  });
  const exportRows = () => {
    if (!list.data) return;
    const blob = new Blob([JSON.stringify(list.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "kerumo-audit-page.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card
      title="Журнал дій"
      description="Час відображається за часовим поясом вашого браузера. Старі дії, виконані до встановлення журналу, сюди не потрапляють."
      actions={
        <>
          <Button onClick={list.refresh}>Оновити</Button>
          <Button disabled={!list.data?.length} onClick={exportRows}>
            Завантажити цю сторінку
          </Button>
        </>
      }
    >
      <div className="staff-filter">
        <SelectField
          label="Дія"
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setOffset(0);
          }}
        >
          <option value="">Усі дії</option>
          {Object.entries(actions).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <label className="staff-check">
          <input
            type="checkbox"
            checked={failed}
            onChange={(event) => {
              setFailed(event.target.checked);
              setOffset(0);
            }}
          />
          Лише невдалі запити
        </label>
      </div>
      <QueryFeedback error={list.error} loading={!list.data && !list.error} />
      {list.data && (
        <>
          <DataTable
            rows={list.data}
            caption="Журнал платформи"
            columns={[
              { key: "when", header: "Коли", render: (row) => dateLabel(row.occurred_at) },
              {
                key: "who",
                header: "Хто",
                render: (row) =>
                  row.actor_email ?? (row.actor_user_id ? "Обліковий запис видалено" : "Вхід не підтверджено"),
              },
              {
                key: "action",
                header: "Дія",
                render: (row) => (
                  <div className="staff-cell-stack">
                    <strong>{actionLabel(row)}</strong>
                    <StatusBadge tone={row.status >= 400 ? "warning" : "success"}>
                      {row.status >= 400 ? "Не виконано" : "Виконано"}
                    </StatusBadge>
                  </div>
                ),
              },
              { key: "ip", header: "Адреса входу", render: (row) => row.client_ip ?? "Не збережено" },
              {
                key: "details",
                header: "Подробиці",
                render: (row) => (
                  <details>
                    <summary>Відкрити</summary>
                    <div className="staff-audit-details">
                      {typeof row.details.reason === "string" && <p>{row.details.reason}</p>}
                      <p>
                        Номер запиту: <code>{row.request_id}</code>
                      </p>
                      <pre>{JSON.stringify(row.details, null, 2)}</pre>
                    </div>
                  </details>
                ),
              },
            ]}
          />
          <Pager offset={offset} length={list.data.length} onChange={setOffset} size={50} />
        </>
      )}
    </Card>
  );
}

export function MonitoringPanel() {
  const monitor = useStaffQuery<Schema["StaffMonitorRead"]>("/api/v1/staff/monitoring", undefined, 30_000);
  const value = monitor.data;
  const traffic = value?.worker.http as Record<string, unknown> | undefined;
  return (
    <div className="staff-section-stack">
      <div className="staff-section-toolbar">
        <span>Оновлення кожні 30 секунд</span>
        <Button onClick={monitor.refresh}>Оновити</Button>
      </div>
      <QueryFeedback error={monitor.error} loading={!value && !monitor.error} />
      {value && (
        <>
          <div className="staff-metrics">
            <MetricCard
              label="База даних"
              value={value.database.available ? "Доступна" : "Недоступна"}
              unit=""
              meta={`Розмір: ${bytesLabel(value.database.size_bytes)}`}
            />
            <MetricCard
              label="Підключення до бази"
              value={String(value.database.connections ?? "Недоступно")}
              unit=""
              meta="Поточні з’єднання з цією базою"
            />
            <MetricCard
              label="Обробка обладнання"
              value={value.worker.available ? "Доступна" : "Немає відповіді"}
              unit=""
              meta="Окремий сервіс телеметрії та команд"
            />
            <MetricCard
              label="Вільне місце"
              value={bytesLabel(value.container.disk_free_bytes)}
              unit=""
              meta="Файлова система службового застосунку"
            />
            <MetricCard
              label="Пам’ять застосунку"
              value={bytesLabel(value.container.memory_bytes)}
              unit=""
              meta={`Ліміт: ${bytesLabel(value.container.memory_limit_bytes)}`}
            />
          </div>
          <Card
            title="Запити клієнтського застосунку"
            description="Лічильники від запуску сервісу. Вони враховують HTTP-запити до API, без перевірок стану. Трафік усього сервера сюди не входить."
          >
            <div className="staff-metrics">
              <MetricCard
                label="Запити"
                value={String(traffic?.requests ?? "Недоступно")}
                unit=""
                meta="Усього від запуску"
              />
              <MetricCard
                label="Помилки запитів"
                value={String(traffic?.errors ?? "Недоступно")}
                unit=""
                meta="Відповіді з кодами 400 і вище"
              />
              <MetricCard
                label="Отримано"
                value={bytesLabel(traffic?.received_bytes)}
                unit=""
                meta="Тіла HTTP-запитів"
              />
              <MetricCard
                label="Надіслано"
                value={bytesLabel(traffic?.sent_bytes)}
                unit=""
                meta="Тіла HTTP-відповідей"
              />
            </div>
          </Card>
          <Card
            title="Діагностика сервісів"
            description="Показники стосуються застосунків і бази. Моніторинг усього сервера підключається окремо."
          >
            <dl className="staff-diagnostic-list">
              <dt>Зв’язок із брокером обладнання</dt>
              <dd>
                {value.worker.available &&
                typeof value.worker.mqtt === "object" &&
                value.worker.mqtt !== null &&
                "connected" in value.worker.mqtt &&
                value.worker.mqtt.connected
                  ? "Є з’єднання"
                  : "Не підтверджено"}
              </dd>
              <dt>Час роботи службового застосунку</dt>
              <dd>{Math.floor(Number(value.container.uptime_seconds ?? 0) / 60)} хв</dd>
              <dt>Час роботи сервісу обладнання</dt>
              <dd>
                {value.worker.available
                  ? `${Math.floor(Number(value.worker.uptime_seconds ?? 0) / 60)} хв`
                  : "Недоступно"}
              </dd>
            </dl>
            <details>
              <summary>Докладний стан обробки команд і аварій</summary>
              <pre className="staff-json">{JSON.stringify(value.worker, null, 2)}</pre>
            </details>
          </Card>
        </>
      )}
    </div>
  );
}
