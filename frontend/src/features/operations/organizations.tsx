"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, DataTable, SelectField, StatusBadge, TextField } from "@/components/ui";
import { useAuthSession } from "@/features/auth-session";
import { useAccountAction } from "@/features/use-account-action";
import { ActionDialog, Pager, QueryFeedback, roleLabels, useStaffQuery, type Schema, type Proof } from "./shared";

type Org = Schema["OrganizationRead"];
type Site = Schema["SiteRead"];
type Member = Schema["MembershipRead"];
export function OrganizationsPanel({ admin }: { admin: boolean }) {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const { authorizedRequest } = useAuthSession();
  const list = useStaffQuery<Org[]>("/api/v1/organizations", { limit: 25, offset });
  const action = useAccountAction(list.refresh);
  if (selected)
    return (
      <OrganizationDetail
        id={selected}
        admin={admin}
        onBack={() => {
          setSelected(null);
          list.refresh();
        }}
      />
    );
  return (
    <Card
      title={admin ? "Усі організації" : "Призначені організації"}
      description={
        admin
          ? "Керуйте командою й об’єктами кожної організації."
          : "Сервісний доступ обмежено організаціями, об’єктами та строком, які вам призначили."
      }
      actions={
        <>
          {admin && (
            <Button variant="primary" onClick={() => setCreating((value) => !value)}>
              Додати організацію
            </Button>
          )}
          <Button onClick={list.refresh}>Оновити</Button>
        </>
      }
    >
      {creating && (
        <form
          className="staff-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              await authorizedRequest({ path: "/api/v1/organizations", method: "POST", body: { name, slug } });
              setCreating(false);
              setName("");
              setSlug("");
            });
          }}
        >
          <TextField
            label="Назва організації"
            required
            minLength={2}
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label="Код організації"
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            minLength={2}
            maxLength={80}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            hint="Латинські літери, цифри й дефіс. Наприклад, farm-north."
          />
          <Button type="submit" variant="primary" disabled={action.busy}>
            Створити
          </Button>
        </form>
      )}
      <QueryFeedback error={list.error || action.error || null} loading={!list.data && !list.error} />
      {list.data && (
        <>
          <DataTable
            rows={list.data}
            caption="Організації"
            columns={[
              {
                key: "name",
                header: "Організація",
                render: (org) => (
                  <div className="staff-cell-stack">
                    <strong>{org.name}</strong>
                    <span>{org.slug}</span>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Стан",
                render: (org) => (
                  <StatusBadge tone={org.is_active ? "success" : "neutral"}>
                    {org.is_active ? "Активна" : "В архіві"}
                  </StatusBadge>
                ),
              },
              {
                key: "actions",
                header: "Дії",
                render: (org) => (
                  <Button size="small" onClick={() => setSelected(org.id)}>
                    Відкрити
                  </Button>
                ),
              },
            ]}
            emptyMessage="Організацій немає. Головний адміністратор може призначити сервісний доступ."
          />
          <Pager offset={offset} length={list.data.length} onChange={setOffset} />
        </>
      )}
    </Card>
  );
}

function OrganizationDetail({ id, admin, onBack }: { id: string; admin: boolean; onBack: () => void }) {
  const org = useStaffQuery<Org>(`/api/v1/organizations/${id}`);
  const [offset, setOffset] = useState(0);
  const sites = useStaffQuery<Site[]>(`/api/v1/organizations/${id}/sites`, { limit: 25, offset });
  const { authorizedRequest } = useAuthSession();
  const [operation, setOperation] = useState<"edit" | "delete" | null>(null);
  const [siteAction, setSiteAction] = useState<{ kind: "edit" | "delete"; site: Site } | null>(null);
  const [siteName, setSiteName] = useState("");
  const [timezone, setTimezone] = useState("Europe/Kyiv");
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [code, setCode] = useState("");
  const create = useAccountAction(sites.refresh);
  return (
    <div className="staff-section-stack">
      <div className="ui-row">
        <Button onClick={onBack}>До організацій</Button>
        <Button
          onClick={() => {
            org.refresh();
            sites.refresh();
          }}
        >
          Оновити
        </Button>
      </div>
      <QueryFeedback error={org.error} loading={!org.data && !org.error} />
      {org.data && (
        <Card
          title={org.data.name}
          description={org.data.is_active ? "Організація активна." : "Організація в архіві."}
          actions={
            admin && (
              <>
                <Button
                  onClick={() => {
                    setName(org.data!.name);
                    setActive(org.data!.is_active);
                    setOperation("edit");
                  }}
                >
                  Змінити
                </Button>
                {!org.data.is_active && (
                  <Button variant="danger" onClick={() => setOperation("delete")}>
                    Видалити
                  </Button>
                )}
              </>
            )
          }
        >
          <p>
            Робочі налаштування та історія контролерів доступні на сторінці обладнання. Видаляти можна порожні об’єкти;
            контролер спочатку передають або списують.
          </p>
        </Card>
      )}
      <Card
        title="Об’єкти"
        actions={admin && <Button onClick={() => setCreating((value) => !value)}>Додати об’єкт</Button>}
      >
        {creating && (
          <form
            className="staff-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              void create.run(async () => {
                await authorizedRequest({
                  path: `/api/v1/organizations/${id}/sites`,
                  method: "POST",
                  body: { name: newName, code, timezone: "Europe/Kyiv" },
                });
                setCreating(false);
                setNewName("");
                setCode("");
              });
            }}
          >
            <TextField
              label="Назва об’єкта"
              required
              minLength={2}
              maxLength={160}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <TextField
              label="Код об’єкта"
              required
              minLength={2}
              maxLength={80}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <Button type="submit" disabled={create.busy} variant="primary">
              Створити
            </Button>
          </form>
        )}
        <QueryFeedback error={sites.error || create.error || null} loading={!sites.data && !sites.error} />
        {sites.data && (
          <>
            <DataTable
              rows={sites.data}
              caption="Об’єкти організації"
              columns={[
                {
                  key: "name",
                  header: "Об’єкт",
                  render: (site) => (
                    <div className="staff-cell-stack">
                      <strong>{site.name}</strong>
                      <span>{site.code}</span>
                    </div>
                  ),
                },
                { key: "timezone", header: "Часовий пояс", render: (site) => site.timezone },
                {
                  key: "actions",
                  header: "Дії",
                  render: (site) => (
                    <div className="staff-table-actions">
                      <Link
                        className="button button-small button-secondary"
                        href={`/organizations/${id}/sites/${site.id}/devices` as Route}
                      >
                        Контролери
                      </Link>
                      {admin && (
                        <>
                          <Button
                            size="small"
                            onClick={() => {
                              setSiteName(site.name);
                              setTimezone(site.timezone);
                              setSiteAction({ kind: "edit", site });
                            }}
                          >
                            Змінити
                          </Button>
                          <Button size="small" variant="danger" onClick={() => setSiteAction({ kind: "delete", site })}>
                            Видалити
                          </Button>
                        </>
                      )}
                    </div>
                  ),
                },
              ]}
            />
            <Pager offset={offset} length={sites.data.length} onChange={setOffset} />
          </>
        )}
      </Card>
      {admin && <MembersPanel organizationId={id} />}
      {operation && org.data && (
        <ActionDialog
          title={operation === "edit" ? "Змінити організацію" : "Видалити організацію"}
          description={
            operation === "edit"
              ? "Архівація доступна для організації без обладнання."
              : "Порожню архівну організацію буде видалено разом із доступом її учасників. Дію не можна скасувати."
          }
          danger={operation === "delete" || !active}
          onClose={() => setOperation(null)}
          onSubmit={async (proof, reason) => {
            await authorizedRequest({
              path: `/api/v1/staff/organizations/${id}`,
              method: operation === "edit" ? "PATCH" : "DELETE",
              body:
                operation === "edit"
                  ? { proof, reason, name, is_active: active, expected_updated_at: org.data!.updated_at }
                  : { proof, reason },
            });
            if (operation === "delete") onBack();
            else org.refresh();
          }}
        >
          {operation === "edit" && (
            <>
              <TextField
                label="Назва"
                minLength={2}
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <label className="staff-check">
                <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
                Організація активна
              </label>
            </>
          )}
        </ActionDialog>
      )}
      {siteAction && (
        <ActionDialog
          title={siteAction.kind === "edit" ? "Змінити об’єкт" : "Видалити об’єкт"}
          description={
            siteAction.kind === "edit"
              ? siteAction.site.name
              : `Порожній об’єкт «${siteAction.site.name}» буде видалено. Обмежений лише ним доступ учасників буде відкликано.`
          }
          danger={siteAction.kind === "delete"}
          onClose={() => setSiteAction(null)}
          onSubmit={async (proof, reason) => {
            await authorizedRequest({
              path: `/api/v1/staff/sites/${siteAction.site.id}`,
              method: siteAction.kind === "edit" ? "PATCH" : "DELETE",
              body:
                siteAction.kind === "edit"
                  ? { proof, reason, name: siteName, timezone, expected_updated_at: siteAction.site.updated_at }
                  : { proof, reason },
            });
            sites.refresh();
          }}
        >
          {siteAction.kind === "edit" && (
            <>
              <TextField
                label="Назва об’єкта"
                minLength={2}
                maxLength={160}
                value={siteName}
                onChange={(event) => setSiteName(event.target.value)}
              />
              <TextField
                label="Часовий пояс"
                value={timezone}
                maxLength={64}
                onChange={(event) => setTimezone(event.target.value)}
                hint="Наприклад, Europe/Kyiv або Europe/Istanbul."
              />
            </>
          )}
        </ActionDialog>
      )}
    </div>
  );
}

function MembersPanel({ organizationId }: { organizationId: string }) {
  const base = `/api/v1/organizations/${organizationId}`;
  const members = useStaffQuery<Member[]>(base + "/memberships");
  const invitations = useStaffQuery<Schema["InvitationRead"][]>(base + "/invitations");
  const { authorizedRequest } = useAuthSession();
  const [member, setMember] = useState<Member | null>(null);
  const [role, setRole] = useState<Schema["OrganizationRole"]>("viewer");
  const [active, setActive] = useState(true);
  const [scope, setScope] = useState("");
  const [scopeLimited, setScopeLimited] = useState(false);
  const [expiry, setExpiry] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Schema["OrganizationRole"]>("viewer");
  const [notice, setNotice] = useState("");
  const action = useAccountAction(() => {
    members.refresh();
    invitations.refresh();
  });
  const [adding, setAdding] = useState(false);
  const submitMember = async (proof: Proof, reason: string) => {
    const siteIds = scopeLimited
      ? scope
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : null;
    const accessExpiry = expiry ? new Date(expiry).toISOString() : null;
    if (member)
      await authorizedRequest({
        path: `/api/v1/staff/organizations/${organizationId}/memberships/${member.id}`,
        method: "PATCH",
        body: {
          proof,
          reason,
          role,
          is_active: active,
          site_ids: siteIds,
          expires_at: accessExpiry,
          expected_updated_at: member.updated_at,
        },
      });
    else {
      const matches = await authorizedRequest<Schema["StaffUserRead"][]>({
        path: "/api/v1/staff/users",
        query: { q: email.trim(), limit: 100 },
      });
      const user = matches.find((row) => row.email.toLowerCase() === email.trim().toLowerCase());
      if (!user) throw new Error("Користувач має спочатку створити особистий обліковий запис. Надішліть запрошення.");
      await authorizedRequest({
        path: `/api/v1/staff/organizations/${organizationId}/memberships`,
        method: "POST",
        body: { proof, reason, user_id: user.id, role, site_ids: siteIds, expires_at: accessExpiry },
      });
    }
    members.refresh();
    setNotice("Доступ оновлено. Зміни записано до журналу.");
  };
  return (
    <Card
      title="Учасники та сервісний доступ"
      description="Власник має постійний доступ до організації. Сервіс можна обмежити об’єктами та строком."
    >
      <form
        className="staff-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            await authorizedRequest({
              path: base + "/invitations",
              method: "POST",
              csrf: true,
              body: { email, role: inviteRole },
            });
            setEmail("");
            setNotice("Запрошення надіслано. Отримувач має підтвердити пошту.");
          });
        }}
      >
        <TextField
          label="Пошта учасника"
          type="email"
          required
          value={email}
          maxLength={254}
          onChange={(event) => setEmail(event.target.value)}
        />
        <SelectField
          label="Роль за запрошенням"
          value={inviteRole}
          onChange={(event) => setInviteRole(event.target.value as Schema["OrganizationRole"])}
        >
          {["owner", "admin", "operator", "viewer", "service"].map((value) => (
            <option value={value} key={value}>
              {roleLabels[value]}
            </option>
          ))}
        </SelectField>
        <Button type="submit" disabled={action.busy}>
          Надіслати запрошення
        </Button>
        <Button
          onClick={() => {
            setMember(null);
            setRole(inviteRole);
            setScope("");
            setScopeLimited(false);
            setExpiry("");
            setAdding(true);
          }}
        >
          Додати наявного користувача
        </Button>
      </form>
      <QueryFeedback error={members.error || action.error || null} loading={!members.data && !members.error} />
      {notice && (
        <p className="staff-feedback staff-feedback-success" role="status">
          {notice}
        </p>
      )}
      {members.data && (
        <DataTable
          rows={members.data}
          caption="Учасники організації"
          columns={[
            {
              key: "person",
              header: "Учасник",
              render: (row) => (
                <div className="staff-cell-stack">
                  <strong>{row.user_display_name}</strong>
                  <span>{row.user_email}</span>
                </div>
              ),
            },
            { key: "role", header: "Роль", render: (row) => roleLabels[row.role] },
            {
              key: "status",
              header: "Доступ",
              render: (row) => (
                <div className="staff-cell-stack">
                  <span>{row.is_active ? "Активний" : "Відкликано"}</span>
                  <span>{row.site_ids ? `Об’єктів: ${row.site_ids.length}` : "Усі об’єкти"}</span>
                </div>
              ),
            },
            {
              key: "actions",
              header: "Дії",
              render: (row) => (
                <Button
                  size="small"
                  onClick={() => {
                    setMember(row);
                    setRole(row.role);
                    setActive(row.is_active);
                    setScope(row.site_ids?.join(", ") ?? "");
                    setScopeLimited(row.site_ids !== null);
                    setExpiry(
                      row.expires_at
                        ? new Date(
                            new Date(row.expires_at).getTime() - new Date(row.expires_at).getTimezoneOffset() * 60_000,
                          )
                            .toISOString()
                            .slice(0, 16)
                        : "",
                    );
                  }}
                >
                  Змінити доступ
                </Button>
              ),
            },
          ]}
        />
      )}
      <QueryFeedback error={invitations.error} loading={false} />
      {!!invitations.data?.length && (
        <div className="staff-invitations">
          <h3>Очікують підтвердження</h3>
          {invitations.data.map((row) => (
            <div key={row.id} className="staff-invitation">
              <span>
                {row.email} · {roleLabels[row.role ?? "viewer"]}
              </span>
              <Button
                size="small"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await authorizedRequest({ path: base + `/invitations/${row.id}`, method: "DELETE", csrf: true });
                  })
                }
              >
                Скасувати запрошення
              </Button>
            </div>
          ))}
        </div>
      )}
      {(member || adding) && (
        <ActionDialog
          title={member ? "Змінити доступ учасника" : "Додати наявного учасника"}
          description={member?.user_email ?? "Обліковий запис із цією поштою має вже існувати."}
          onClose={() => {
            setMember(null);
            setAdding(false);
          }}
          onSubmit={submitMember}
          valid={!scopeLimited || Boolean(scope.trim())}
        >
          {!member && (
            <TextField
              label="Пошта наявного користувача"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
          <SelectField
            label="Роль в організації"
            value={role}
            onChange={(event) => {
              setRole(event.target.value as Schema["OrganizationRole"]);
              if (event.target.value === "owner") {
                setScope("");
                setScopeLimited(false);
                setExpiry("");
              }
            }}
          >
            {["owner", "admin", "operator", "viewer", "service"].map((value) => (
              <option value={value} key={value}>
                {roleLabels[value]}
              </option>
            ))}
          </SelectField>
          {member && (
            <label className="staff-check">
              <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
              Доступ увімкнено
            </label>
          )}
          <SiteScopePicker
            organizationId={organizationId}
            value={scope}
            onChange={setScope}
            limited={scopeLimited}
            onLimitedChange={setScopeLimited}
            disabled={role === "owner"}
          />
          <TextField
            label="Доступ до дати й часу"
            type="datetime-local"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
            hint="За місцевим часом браузера. Порожнє поле означає постійний доступ."
          />
        </ActionDialog>
      )}
    </Card>
  );
}

function SiteScopePicker({
  organizationId,
  value,
  onChange,
  disabled,
  limited,
  onLimitedChange,
}: {
  organizationId: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  limited: boolean;
  onLimitedChange: (value: boolean) => void;
}) {
  const [offset, setOffset] = useState(0);
  const sites = useStaffQuery<Site[]>(`/api/v1/organizations/${organizationId}/sites`, { limit: 25, offset });
  const selected = value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return (
    <div>
      <label className="staff-check">
        <input
          type="checkbox"
          checked={limited && !disabled}
          disabled={disabled}
          onChange={(event) => {
            onLimitedChange(event.target.checked);
            if (!event.target.checked) onChange("");
          }}
        />
        Обмежити доступ вибраними об’єктами
      </label>
      {limited && !disabled && (
        <>
          <p>Обрано: {selected.length}. Позначте хоча б один об’єкт.</p>
          <QueryFeedback error={sites.error} loading={!sites.data && !sites.error} />
          {sites.data?.map((site) => (
            <label className="staff-check" key={site.id}>
              <input
                type="checkbox"
                checked={selected.includes(site.id)}
                onChange={(event) =>
                  onChange(
                    (event.target.checked ? [...selected, site.id] : selected.filter((id) => id !== site.id)).join(","),
                  )
                }
              />
              {site.name}
            </label>
          ))}
          <Pager offset={offset} length={sites.data?.length ?? 0} onChange={setOffset} />
        </>
      )}
    </div>
  );
}
