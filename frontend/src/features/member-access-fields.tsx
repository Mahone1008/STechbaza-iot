"use client";

import { useState } from "react";
import { Button, SelectField, TextField } from "@/components/ui";
import { apiErrorDisplayMessage, type components } from "@/lib/api";
import { mapBounded, parsePage, parseSite } from "@/lib/api/inventory";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import type { SessionScope } from "@/lib/api";

type Role = components["schemas"]["OrganizationRole"];
export const memberRoleLabels: Record<Role, string> = {
  viewer: "Лише перегляд",
  operator: "Перегляд і керування",
  service: "Сервісне обслуговування",
  admin: "Адміністратор",
  owner: "Власник організації",
};
const roleDescriptions: Record<Role, string> = {
  viewer: "Показання, графіки та журнал. Без запуску й зміни налаштувань.",
  operator: "Перегляд, запуск, зупинка та зміна частоти в дозволених межах.",
  service: "Перегляд, керування й налаштування обладнання. Без керування учасниками.",
  admin: "Керування та налаштування обладнання. Учасниками — лише з доступом до всієї організації.",
  owner: "Повний постійний доступ до організації та її учасників.",
};

function useSelectedSites(organizationId: string, scope: SessionScope | null, ids: string[], enabled: boolean) {
  const { authorizedRequest } = useAuthSession();
  return usePanelQuery({
    queryKey: ["member-selected-sites", scope, organizationId, [...ids].sort()],
    enabled: enabled && ids.length > 0 && ids.length <= 100,
    intervalMs: 0,
    queryFn: (signal) =>
      mapBounded(ids, 4, signal, async (id) =>
        parseSite(await authorizedRequest<unknown>({ path: `/api/v1/sites/${id}`, signal }), organizationId, id),
      ),
  });
}

export function MemberScopeDescription({
  organizationId,
  scope,
  siteIds,
}: {
  organizationId: string;
  scope: SessionScope | null;
  siteIds: string[] | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const query = useSelectedSites(organizationId, scope, siteIds ?? [], open);
  if (siteIds == null) return <p>Уся організація</p>;
  return (
    <details className="member-scope-summary" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Обрані об’єкти: {siteIds.length}</summary>
      {open &&
        (query.isError ? (
          <p role="alert">{apiErrorDisplayMessage(query.error)}</p>
        ) : query.data ? (
          <ul>
            {query.data.map((site) => (
              <li key={site.id}>{site.name}</li>
            ))}
          </ul>
        ) : (
          <p role="status">Завантажуємо об’єкти…</p>
        ))}
    </details>
  );
}

export function MemberAccessFields({
  organizationId,
  scope,
  role,
  onRoleChange,
  siteIds,
  onSiteIdsChange,
  expires,
  onExpiresChange,
  canAssignOwner,
  disabled = false,
}: {
  organizationId: string;
  scope: SessionScope | null;
  role: Role;
  onRoleChange: (value: Role) => void;
  siteIds: string[] | null;
  onSiteIdsChange: (value: string[] | null) => void;
  expires: string;
  onExpiresChange: (value: string) => void;
  canAssignOwner: boolean;
  disabled?: boolean;
}) {
  const { authorizedRequest } = useAuthSession();
  const [offset, setOffset] = useState(0);
  const query = usePanelQuery({
    queryKey: ["member-site-page", scope, organizationId, offset],
    intervalMs: 0,
    enabled: siteIds !== null,
    queryFn: async (signal) =>
      parsePage(
        await authorizedRequest<unknown>({
          path: `/api/v1/organizations/${organizationId}/sites`,
          query: { limit: 21, offset },
          signal,
        }),
        (item) => parseSite(item, organizationId),
        21,
      ),
  });
  const choices = query.data?.slice(0, 20) ?? [];
  const missing = (siteIds ?? []).filter((id) => !choices.some((site) => site.id === id));
  const selected = useSelectedSites(organizationId, scope, missing, !!query.data);
  const selectedNames = (siteIds ?? [])
    .map((id) => [...choices, ...(selected.data ?? [])].find((site) => site.id === id)?.name)
    .filter(Boolean);
  const roles: Role[] = ["viewer", "operator", "service", "admin"];
  if (canAssignOwner && siteIds === null) roles.push("owner");
  return (
    <>
      <SelectField
        label="Доступ до"
        value={siteIds === null ? "organization" : "sites"}
        disabled={disabled || role === "owner"}
        onChange={(event) => onSiteIdsChange(event.target.value === "organization" ? null : [])}
      >
        <option value="sites">Обраних об’єктів</option>
        <option value="organization">Усієї організації</option>
      </SelectField>
      {siteIds !== null && (
        <fieldset className="member-site-picker" disabled={disabled}>
          <legend>Оберіть об’єкти</legend>
          {selectedNames.length ? <p className="help-copy">Обрано: {selectedNames.join(", ")}</p> : null}
          {selected.isError && <p role="alert">{apiErrorDisplayMessage(selected.error)}</p>}
          {query.isError ? (
            <p role="alert">
              {apiErrorDisplayMessage(query.error)} <Button onClick={query.refresh}>Повторити</Button>
            </p>
          ) : !query.data ? (
            <p role="status">Завантажуємо об’єкти…</p>
          ) : !choices.length ? (
            <p>Об’єктів ще немає.</p>
          ) : (
            choices.map((site) => (
              <label key={site.id} className="member-site-option">
                <input
                  type="checkbox"
                  checked={siteIds.includes(site.id)}
                  disabled={!siteIds.includes(site.id) && siteIds.length >= 100}
                  onChange={(event) =>
                    onSiteIdsChange(
                      event.target.checked ? [...siteIds, site.id] : siteIds.filter((id) => id !== site.id),
                    )
                  }
                />
                <span>{site.name}</span>
              </label>
            ))
          )}
          <div className="ui-row">
            {offset > 0 && (
              <Button disabled={disabled || query.isFetching} onClick={() => setOffset(Math.max(0, offset - 20))}>
                Попередні об’єкти
              </Button>
            )}
            {query.data?.length === 21 && (
              <Button disabled={disabled || query.isFetching} onClick={() => setOffset(offset + 20)}>
                Наступні об’єкти
              </Button>
            )}
          </div>
          {!siteIds.length && <p className="help-copy">Оберіть хоча б один об’єкт.</p>}
        </fieldset>
      )}
      <SelectField
        label="Права учасника"
        value={role}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value as Role;
          onRoleChange(next);
          if (next === "owner") {
            onSiteIdsChange(null);
            onExpiresChange("");
          }
        }}
      >
        {roles.map((key) => (
          <option key={key} value={key}>
            {memberRoleLabels[key]}
          </option>
        ))}
      </SelectField>
      <p className="help-copy">{roleDescriptions[role]}</p>
      <details className="member-extra">
        <summary>Термін доступу</summary>
        <TextField
          label="Доступ до дати (ваш місцевий час)"
          type="datetime-local"
          value={expires}
          disabled={disabled || role === "owner"}
          onChange={(event) => onExpiresChange(event.target.value)}
        />
        <p className="help-copy">Порожнє поле — без обмеження строку.</p>
      </details>
    </>
  );
}

export function accessExpiryInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
