"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { Button, Card, DataTable, SelectField, StatusBadge, TextField } from "@/components/ui";
import { ModalDialog } from "@/components/modal-dialog";
import { useAuthSession } from "@/features/auth-session";
import { ActionDialog, dateLabel, Pager, QueryFeedback, roleLabels, useStaffQuery, type Schema } from "./shared";

type User = Schema["StaffUserRead"];
type Action = { kind: "edit" | "reset" | "revoke"; user: User };
export function PeoplePanel() {
  const { authorizedRequest } = useAuthSession();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [role, setRole] = useState<Schema["PlatformRole"]>("user");
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [recoveryReset, setRecoveryReset] = useState(false);
  const [notice, setNotice] = useState("");
  const users = useStaffQuery<User[]>("/api/v1/staff/users", { q: query, limit: 25, offset });
  const choose = (kind: Action["kind"], user: User) => {
    setRole(user.platform_role as Schema["PlatformRole"]);
    setName(user.display_name);
    setActive(user.is_active);
    setRecoveryReset(false);
    setAction({ kind, user });
  };
  return (
    <div className="staff-section-stack">
      <Card
        title="Облікові записи"
        description="Паролі не відображаються. Новий учасник створює особистий пароль після запрошення."
        actions={
          <Link className="button button-secondary" href={"/operations?section=organizations" as Route}>
            Запросити учасника
          </Link>
        }
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
            label="Пошук за поштою або іменем"
            value={search}
            maxLength={160}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button type="submit">Знайти</Button>
          <Button onClick={users.refresh}>Оновити</Button>
        </form>
        <QueryFeedback error={users.error} loading={!users.data && !users.error} />
        {notice && (
          <p className="staff-feedback staff-feedback-success" role="status">
            {notice}
          </p>
        )}
        {users.data && (
          <>
            <DataTable
              rows={users.data}
              caption="Користувачі платформи"
              columns={[
                {
                  key: "person",
                  header: "Користувач",
                  render: (user) => (
                    <div className="staff-cell-stack">
                      <strong>{user.display_name}</strong>
                      <span>{user.email}</span>
                    </div>
                  ),
                },
                { key: "role", header: "Роль", render: (user) => roleLabels[user.platform_role] },
                {
                  key: "status",
                  header: "Доступ",
                  render: (user) => (
                    <StatusBadge tone={user.is_active ? "success" : "neutral"}>
                      {user.is_active ? "Активний" : "Вимкнено"}
                    </StatusBadge>
                  ),
                },
                {
                  key: "security",
                  header: "Захист",
                  render: (user) => (
                    <div className="staff-cell-stack">
                      <span>{user.mfa_enabled ? "Двоетапний вхід" : "Вхід із паролем"}</span>
                      <span>{user.active_sessions} активних сесій</span>
                    </div>
                  ),
                },
                { key: "last", header: "Останній вхід", render: (user) => dateLabel(user.last_login_at) },
                {
                  key: "actions",
                  header: "Дії",
                  render: (user) => (
                    <div className="staff-table-actions">
                      <Button size="small" onClick={() => choose("edit", user)}>
                        Змінити
                      </Button>
                      <Button size="small" onClick={() => setSessionUser(user)}>
                        Сесії
                      </Button>
                      <Button size="small" onClick={() => choose("reset", user)}>
                        Скинути захист
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
            <Pager offset={offset} length={users.data.length} onChange={setOffset} />
          </>
        )}
      </Card>
      {sessionUser && (
        <UserSessions
          user={sessionUser}
          onClose={() => setSessionUser(null)}
          onRevoke={() => {
            choose("revoke", sessionUser);
            setSessionUser(null);
          }}
        />
      )}
      {action && (
        <ActionDialog
          key={action.kind + action.user.id}
          title={
            action.kind === "edit"
              ? "Змінити обліковий запис"
              : action.kind === "reset"
                ? "Скинути налаштування захисту"
                : "Завершити всі сесії"
          }
          description={
            action.kind === "edit"
              ? `Зміни для ${action.user.email}. Зміна ролі або вимкнення доступу завершує сесії.`
              : action.kind === "reset"
                ? `Authenticator буде відв’язано, відкриті сесії завершаться. Пароль ${action.user.email} залишиться чинним.`
                : `Користувач ${action.user.email} увійде повторно на кожному пристрої.`
          }
          onClose={() => setAction(null)}
          danger={action.kind !== "edit" || !active}
          onSubmit={async (proof, reason) => {
            const base = `/api/v1/staff/users/${action.user.id}`;
            if (action.kind === "edit")
              await authorizedRequest({
                path: base,
                method: "PATCH",
                body: {
                  proof,
                  reason,
                  expected_updated_at: action.user.updated_at,
                  display_name: name,
                  platform_role: role,
                  is_active: active,
                },
              });
            if (action.kind === "reset")
              await authorizedRequest({
                path: base + "/security-reset",
                method: "POST",
                body: { proof, reason, include_recovery: recoveryReset },
              });
            if (action.kind === "revoke")
              await authorizedRequest({ path: base + "/sessions/revoke", method: "POST", body: { proof, reason } });
            users.refresh();
            setNotice("Зміни збережено та додано до журналу.");
          }}
        >
          {action.kind === "edit" && (
            <>
              <TextField
                label="Ім’я"
                value={name}
                minLength={2}
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
              />
              <SelectField
                label="Роль на платформі"
                value={role}
                onChange={(event) => setRole(event.target.value as Schema["PlatformRole"])}
              >
                {(["user", "service_admin", "superadmin"] as const).map((value) => (
                  <option key={value} value={value}>
                    {roleLabels[value]}
                  </option>
                ))}
              </SelectField>
              <label className="staff-check">
                <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
                Доступ до облікового запису ввімкнено
              </label>
            </>
          )}
          {action.kind === "reset" && (
            <label className="staff-check">
              <input
                type="checkbox"
                checked={recoveryReset}
                onChange={(event) => setRecoveryReset(event.target.checked)}
              />
              Також анулювати ключ відновлення
            </label>
          )}
        </ActionDialog>
      )}
    </div>
  );
}

function UserSessions({ user, onClose, onRevoke }: { user: User; onClose: () => void; onRevoke: () => void }) {
  const sessions = useStaffQuery<Schema["StaffSessionRead"][]>(`/api/v1/staff/users/${user.id}/sessions`);
  return (
    <ModalDialog
      open
      title="Активні сесії"
      description={user.email}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Закрити</Button>
          <Button variant="danger" disabled={!sessions.data?.length} onClick={onRevoke}>
            Завершити всі сесії
          </Button>
        </>
      }
    >
      <QueryFeedback error={sessions.error} loading={!sessions.data && !sessions.error} />
      {sessions.data && (
        <DataTable
          rows={sessions.data}
          caption="Сесії користувача"
          columns={[
            { key: "start", header: "Вхід", render: (row) => dateLabel(row.created_at) },
            {
              key: "source",
              header: "Кабінет",
              render: (row) => (row.audience === "kerumo-staff-api" ? "Службовий" : "Клієнтський"),
            },
            { key: "ip", header: "Адреса", render: (row) => row.client_ip ?? "Не збережено" },
            { key: "browser", header: "Браузер", render: (row) => row.user_agent ?? "Не збережено" },
            { key: "expires", header: "Діє до", render: (row) => dateLabel(row.expires_at) },
          ]}
          emptyMessage="Активних сесій немає."
        />
      )}
    </ModalDialog>
  );
}
