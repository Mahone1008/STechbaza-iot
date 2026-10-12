"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, PageHeader, TextField } from "@/components/ui";
import { apiErrorDisplayMessage, type components, type SessionScope } from "@/lib/api";
import { useAccessContext } from "./access-context";
import { useAuthSession } from "./auth-session";
import { useAccountAction } from "./use-account-action";
import { usePanelQuery } from "./use-panel-query";
import {
  accessExpiryInput,
  MemberAccessFields,
  MemberScopeDescription,
  memberRoleLabels,
} from "./member-access-fields";

type Schema = components["schemas"];
export function OrganizationMembers({ organizationId }: { organizationId: string }) {
  const { snapshot } = useAccessContext();
  const identity = snapshot.status === "ready" ? `${snapshot.scope.userId}:${snapshot.scope.sessionId}` : "pending";
  return <OrganizationMemberAccess key={`${organizationId}:${identity}`} organizationId={organizationId} />;
}

function OrganizationMemberAccess({ organizationId }: { organizationId: string }) {
  const { snapshot, hasPermission, retryAccess } = useAccessContext();
  const { authorizedRequest } = useAuthSession();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Schema["OrganizationRole"]>("viewer");
  const [chosenSites, setChosenSites] = useState<string[] | null | undefined>(undefined);
  const [expires, setExpires] = useState("");
  const [notice, setNotice] = useState("");
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const allowed =
    snapshot.status === "ready" &&
    snapshot.activeOrganization.id === organizationId &&
    hasPermission("membership.read");
  const base = `/api/v1/organizations/${organizationId}`;
  const scope = snapshot.status === "ready" ? snapshot.scope : null;
  const currentSite = snapshot.status === "ready" ? snapshot.activeSite : null;
  const siteIds =
    chosenSites === undefined ? (currentSite?.organization_id === organizationId ? [currentSite.id] : []) : chosenSites;
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
  const refresh = () => {
    setCheckedAt(Date.now());
    members.refresh();
    invitations.refresh();
  };
  const { busy, error, run } = useAccountAction(refresh);
  const canManage = allowed && hasPermission("membership.manage");
  const canAssignOwner =
    snapshot.status === "ready" &&
    (snapshot.access.platform_role === "superadmin" || snapshot.access.organization_role === "owner");
  const invite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || !members.active || (siteIds !== null && siteIds.length === 0)) return;
    void run(async () => {
      await authorizedRequest({
        path: base + "/invitations",
        method: "POST",
        csrf: true,
        body: {
          email,
          role,
          site_ids: siteIds,
          expires_at: expires ? new Date(expires).toISOString() : null,
        },
      });
      setEmail("");
      setNotice("Запрошення надіслано. Отримувач має прийняти його протягом трьох днів.");
    });
  };
  const updateActive = (member: Schema["MembershipRead"]) =>
    void run(async () => {
      if (!members.active) return;
      await authorizedRequest({
        path: base + `/memberships/${member.id}`,
        method: "PATCH",
        body: { is_active: !member.is_active, expected_updated_at: member.updated_at },
      });
      setNotice("Доступ учасника оновлено.");
      if (member.user_id === scope?.userId) retryAccess();
    });
  const revoke = (id: string) =>
    void run(async () => {
      if (!invitations.active) return;
      await authorizedRequest({ path: base + `/invitations/${id}`, method: "DELETE", csrf: true });
      setNotice("Запрошення скасовано.");
    });
  if (!allowed)
    return (
      <Card title="Учасники недоступні">
        <p>Перегляд і керування учасниками доступні за правами вашої ролі.</p>
      </Card>
    );
  return (
    <>
      <PageHeader
        title="Учасники та доступ"
        description="Оберіть об’єкти й права для кожної людини."
        actions={
          <Button disabled={!members.active || members.isFetching || invitations.isFetching} onClick={refresh}>
            Оновити список
          </Button>
        }
      />
      {canManage && (
        <Card title="Додати учасника">
          <form className="connect-fields" onSubmit={invite}>
            <TextField
              label="Пошта учасника"
              type="email"
              required
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <MemberAccessFields
              organizationId={organizationId}
              scope={scope}
              role={role}
              onRoleChange={setRole}
              siteIds={siteIds}
              onSiteIdsChange={setChosenSites}
              expires={expires}
              onExpiresChange={setExpires}
              canAssignOwner={canAssignOwner}
              disabled={busy}
            />
            <Button
              variant="primary"
              type="submit"
              disabled={busy || !members.active || (siteIds !== null && siteIds.length === 0)}
            >
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
                  {member.user_email} ·{" "}
                  {!member.is_active
                    ? "Доступ вимкнено"
                    : member.expires_at && new Date(member.expires_at).getTime() <= checkedAt
                      ? "Строк доступу завершився"
                      : memberRoleLabels[member.role]}
                </p>
                <MemberScopeDescription organizationId={organizationId} scope={scope} siteIds={member.site_ids} />
                {member.expires_at && <p>Доступ до {new Date(member.expires_at).toLocaleString("uk-UA")}</p>}
                {canManage && (member.role !== "owner" || canAssignOwner) && (
                  <>
                    <MemberAccessEditor
                      key={`${member.id}:${member.updated_at}`}
                      organizationId={organizationId}
                      scope={scope}
                      member={member}
                      canAssignOwner={canAssignOwner}
                      active={members.active && !members.isError}
                      onSaved={() => {
                        setNotice("Права та об’єкти учасника оновлено.");
                        refresh();
                        if (member.user_id === scope?.userId) retryAccess();
                      }}
                    />
                    <Button disabled={busy || !members.active} onClick={() => updateActive(member)}>
                      {member.is_active ? "Вимкнути доступ" : "Відновити доступ"}
                    </Button>
                  </>
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
        ) : !invitations.data.length ? (
          <p>Немає активних запрошень.</p>
        ) : (
          <ul className="device-events">
            {invitations.data.map((item) => (
              <li key={item.id}>
                <strong>{item.email}</strong>
                <p>{memberRoleLabels[item.role]}</p>
                <MemberScopeDescription organizationId={organizationId} scope={scope} siteIds={item.site_ids} />
                {item.access_expires_at && <p>Доступ до {new Date(item.access_expires_at).toLocaleString("uk-UA")}</p>}
                <p>Прийняти запрошення до {new Date(item.expires_at).toLocaleString("uk-UA")}</p>
                {canManage && (
                  <Button disabled={busy || !invitations.active} onClick={() => revoke(item.id)}>
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

function MemberAccessEditor({
  organizationId,
  scope,
  member,
  canAssignOwner,
  active,
  onSaved,
}: {
  organizationId: string;
  scope: SessionScope | null;
  member: Schema["MembershipRead"];
  canAssignOwner: boolean;
  active: boolean;
  onSaved: () => void;
}) {
  const { authorizedRequest } = useAuthSession();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(member.role);
  const [siteIds, setSiteIds] = useState<string[] | null>(member.site_ids ?? null);
  const [expires, setExpires] = useState(accessExpiryInput(member.expires_at));
  const { busy, error, run } = useAccountAction(onSaved);
  const scopeChanged =
    JSON.stringify(siteIds ? [...new Set(siteIds)].sort() : null) !==
    JSON.stringify(member.site_ids ? [...new Set(member.site_ids)].sort() : null);
  const changes = {
    ...(role !== member.role ? { role } : {}),
    ...(scopeChanged ? { site_ids: siteIds } : {}),
  };
  const expiryChanged = expires !== accessExpiryInput(member.expires_at);
  const changed = Object.keys(changes).length > 0 || expiryChanged;
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!active || !changed || (siteIds !== null && !siteIds.length)) return;
    void run(async () => {
      await authorizedRequest({
        path: `/api/v1/organizations/${organizationId}/memberships/${member.id}`,
        method: "PATCH",
        body: {
          ...changes,
          ...(expiryChanged ? { expires_at: expires ? new Date(expires).toISOString() : null } : {}),
          expected_updated_at: member.updated_at,
        },
      });
      setOpen(false);
    });
  };
  return (
    <div className="member-access-editor">
      <Button
        aria-expanded={open}
        disabled={busy || !active}
        onClick={() => {
          setRole(member.role);
          setSiteIds(member.site_ids ?? null);
          setExpires(accessExpiryInput(member.expires_at));
          setOpen(!open);
        }}
      >
        Налаштувати доступ
      </Button>
      {open && (
        <form className="connect-fields" onSubmit={save} aria-label={`Доступ для ${member.user_email}`}>
          <MemberAccessFields
            organizationId={organizationId}
            scope={scope}
            role={role}
            onRoleChange={setRole}
            siteIds={siteIds}
            onSiteIdsChange={setSiteIds}
            expires={expires}
            onExpiresChange={setExpires}
            canAssignOwner={canAssignOwner}
            disabled={busy}
          />
          {error && <p role="alert">{error}</p>}
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !active || !changed || (siteIds !== null && !siteIds.length)}
          >
            Зберегти доступ
          </Button>
        </form>
      )}
    </div>
  );
}
