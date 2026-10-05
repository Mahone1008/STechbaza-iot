"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, PageHeader, SelectField, TextField } from "@/components/ui";
import { apiErrorDisplayMessage, organizationRoleLabel, type components } from "@/lib/api";
import { useAccessContext } from "./access-context";
import { useAuthSession } from "./auth-session";
import { useAccountAction } from "./use-account-action";
import { usePanelQuery } from "./use-panel-query";

type Schema = components["schemas"];
export function OrganizationMembers({ organizationId }: { organizationId: string }) {
  const { snapshot, hasPermission, retryAccess } = useAccessContext();
  const { authorizedRequest } = useAuthSession();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Schema["OrganizationRole"]>("viewer");
  const [notice, setNotice] = useState("");
  const allowed =
    snapshot.status === "ready" &&
    snapshot.activeOrganization.id === organizationId &&
    hasPermission("membership.read");
  const base = `/api/v1/organizations/${organizationId}`;
  const scope = snapshot.status === "ready" ? snapshot.scope : null;
  const members = usePanelQuery({
    queryKey: ["members", scope, organizationId],
    intervalMs: 0,
    enabled: allowed,
    queryFn: (signal) => authorizedRequest<Schema["MembershipRead"][]>({ path: base + "/memberships", signal }),
  });
  const invitations = usePanelQuery({
    queryKey: ["invitations", scope, organizationId],
    intervalMs: 0,
    enabled: allowed,
    queryFn: (signal) =>
      authorizedRequest<Schema["InvitationRead"][]>({ path: base + "/invitations", csrf: true, signal }),
  });
  const { busy, error, run } = useAccountAction(() => {
    members.refresh();
    invitations.refresh();
  });
  const canManage = allowed && hasPermission("membership.manage");
  const canAssignOwner =
    snapshot.status === "ready" &&
    (snapshot.access.platform_role === "superadmin" || snapshot.access.organization_role === "owner");
  const invite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      await authorizedRequest({ path: base + "/invitations", method: "POST", csrf: true, body: { email, role } });
      setEmail("");
      setNotice("Запрошення надіслано. Отримувач має прийняти його протягом трьох днів.");
    });
  };
  const update = (
    member: Schema["MembershipRead"],
    change: { role?: Schema["OrganizationRole"]; is_active?: boolean },
  ) =>
    void run(async () => {
      await authorizedRequest({ path: base + `/memberships/${member.id}`, method: "PATCH", body: change });
      setNotice("Права учасника оновлено.");
      if (member.user_id === scope?.userId) retryAccess();
    });
  const revoke = (id: string) =>
    void run(async () => {
      await authorizedRequest({ path: base + `/invitations/${id}`, method: "DELETE", csrf: true });
      setNotice("Запрошення скасовано.");
    });
  if (!allowed)
    return (
      <Card title="Учасники недоступні">
        <p>Перегляд і керування учасниками доступні за правами вашої ролі.</p>
      </Card>
    );
  const roles = (["owner", "admin", "operator", "viewer", "service"] as const)
    .filter((key) => canAssignOwner || key !== "owner")
    .map((key) => [key, organizationRoleLabel(key)]);
  return (
    <>
      <PageHeader
        title="Учасники організації"
        description="Запрошуйте співробітників на їхню пошту. Кожен використовує власний пароль."
      />
      {canManage && (
        <Card title="Запросити учасника">
          <form className="connect-fields" onSubmit={invite}>
            <TextField
              label="Пошта учасника"
              type="email"
              required
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <SelectField
              label="Права запрошеного учасника"
              value={role}
              onChange={(event) => setRole(event.target.value as Schema["OrganizationRole"])}
            >
              {roles.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </SelectField>
            <Button variant="primary" type="submit" disabled={busy}>
              Надіслати запрошення
            </Button>
          </form>
        </Card>
      )}
      {notice && (
        <p className="notice notice-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      )}
      <Card title="Учасники">
        {members.isError ? (
          <p role="alert">{apiErrorDisplayMessage(members.error)}</p>
        ) : !members.data ? (
          <p role="status">Завантажуємо учасників…</p>
        ) : (
          <ul className="device-events">
            {members.data.map((member) => (
              <li key={member.id}>
                <strong>{member.user_display_name}</strong>
                <p>
                  {member.user_email} · {member.is_active ? organizationRoleLabel(member.role) : "Доступ вимкнено"}
                </p>
                {canManage && (member.role !== "owner" || canAssignOwner) && (
                  <div className="connect-fields">
                    <SelectField
                      label={`Права для ${member.user_email}`}
                      value={member.role}
                      disabled={busy}
                      onChange={(event) => update(member, { role: event.target.value as Schema["OrganizationRole"] })}
                    >
                      {roles.map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </SelectField>
                    <Button disabled={busy} onClick={() => update(member, { is_active: !member.is_active })}>
                      {member.is_active ? "Вимкнути доступ" : "Відновити доступ"}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Очікують на підтвердження">
        {invitations.isError ? (
          <p role="alert">{apiErrorDisplayMessage(invitations.error)}</p>
        ) : !invitations.data ? (
          <p role="status">Завантажуємо запрошення…</p>
        ) : invitations.data.length === 0 ? (
          <p>Немає активних запрошень.</p>
        ) : (
          <ul className="device-events">
            {invitations.data.map((item) => (
              <li key={item.id}>
                <strong>{item.email}</strong>
                <p>
                  {organizationRoleLabel(item.role)} · дійсне до {new Date(item.expires_at).toLocaleString("uk-UA")}
                </p>
                {canManage && (
                  <Button disabled={busy} onClick={() => revoke(item.id)}>
                    Скасувати запрошення
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
