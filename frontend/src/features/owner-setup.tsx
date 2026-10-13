"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, StatusBadge, TextField } from "@/components/ui";
import { apiErrorDisplayMessage } from "@/lib/api";
import type { Connection } from "@/lib/api/onboarding";
import {
  parseCreatedHelper,
  parseHelperLinks,
  parseOwnerSetup,
  parseSetupProfiles,
  setupScope,
  setupSnapshotKey,
  type OwnerSetupRead,
  type SetupEquipment,
  type SetupSnapshot,
} from "@/lib/api/setup";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import { useAccountAction } from "./use-account-action";
import { SetupEquipmentForm, SetupEquipmentSummary } from "./setup-equipment-form";

export function SetupProgress({
  progress,
  available,
  observation = false,
}: {
  progress: OwnerSetupRead["progress"];
  available: boolean;
  observation?: boolean;
}) {
  const connected = available && progress !== "activated";
  const ready = available && progress === "ready";
  return (
    <ol className="connection-progress setup-progress" aria-label="Готовність контролера">
      {[
        { title: "Активовано", detail: "Контролер належить вашому об’єкту", complete: true },
        {
          title: "Підключено",
          detail: connected ? "Отримуємо свіжі показання" : "Очікуємо зв’язок із контролером",
          complete: connected,
        },
        {
          title: observation ? "Готово до спостереження" : "Готово",
          detail: ready
            ? observation
              ? "Спостереження доступне, керування вимкнене"
              : "Перевірки установки завершено"
            : "Перевіряємо обладнання й монтаж",
          complete: ready,
        },
      ].map((step, index) => (
        <li key={step.title} data-complete={step.complete}>
          <span className="connection-step-marker" aria-hidden="true">
            {step.complete ? "✓" : index + 1}
          </span>
          <span>
            {step.title}
            <small>{step.detail}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function OwnerSetup({ connection }: { connection: Connection }) {
  const { authorizedRequest, session } = useAuthSession();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const { busy, error, run } = useAccountAction();
  const id = connection.controller_id;
  const path = `/api/v1/connect/${id}/setup`;
  const sessionKey = session.status === "authenticated" ? [session.email, session.sessionExpiresAt] : null;
  const key = ["owner-setup", sessionKey, id];
  const query = usePanelQuery({
    queryKey: key,
    intervalMs: 5000,
    queryFn: async (signal) => parseOwnerSetup(await authorizedRequest({ path, signal }), id, connection.device_id!),
  });
  const data = query.data;
  const available = query.active && !query.isError;
  const profiles = usePanelQuery({
    queryKey: ["setup-profiles", sessionKey],
    intervalMs: 0,
    enabled: data?.initial_setup_open === true,
    queryFn: async (signal) =>
      parseSetupProfiles(await authorizedRequest({ path: "/api/v1/equipment/profiles", signal })),
  });
  const publish = (value: unknown) => {
    const result = parseOwnerSetup(value, id, connection.device_id!);
    client.setQueryData(key, result);
    setEditing(false);
    setDirty(false);
    setFormVersion((version) => version + 1);
  };
  const save = (equipment: SetupEquipment, original: SetupSnapshot) =>
    void run(async () => {
      if (!available || !data || setupSnapshotKey(original) !== setupSnapshotKey(data)) return;
      publish(
        await authorizedRequest({
          path: `${path}/draft`,
          method: "PUT",
          csrf: true,
          body: { ...setupScope(original), equipment },
        }),
      );
    });
  const apply = () =>
    void run(async () => {
      if (!data || !available || !data.can_apply) return;
      publish(
        await authorizedRequest({
          path: `${path}/apply`,
          method: "POST",
          csrf: true,
          body: { ...setupScope(data), nameplate_checked: true },
        }),
      );
    });
  const accept = (mode: "extended_test" | "read_only") =>
    void run(async () => {
      if (!data || !available || !data.configuration_hash) return;
      publish(
        await authorizedRequest({
          path: `${path}/accept`,
          method: "POST",
          csrf: true,
          body: {
            ...setupScope(data),
            expected_configuration_hash: data.configuration_hash,
            installation_checked: true,
            control_mode: mode,
          },
        }),
      );
    });
  if (!data)
    return (
      <Card title="Перевірка установки">
        {query.isError ? (
          <>
            <p role="alert">{apiErrorDisplayMessage(query.error)}</p>
            <Button onClick={query.refresh}>Повторити перевірку</Button>
          </>
        ) : (
          <p role="status">Перевіряємо дані й зв’язок…</p>
        )}
      </Card>
    );
  const editable = data.can_setup && data.initial_setup_open;
  const observation = !data.initial_setup_open && data.commissioned_control_mode === "read_only";
  const showForm = editable && (editing || data.missing_fields.length > 0);
  return (
    <Card title={connection.hardware_model} description={`Серійний номер: ${connection.serial_number}`}>
      <div className="connect-fields">
        <p>Контролер прив’язано до вашого об’єкта. Повторна активація не потрібна.</p>
        <SetupProgress progress={data.progress} available={available} observation={observation} />
        {observation && (
          <p className="notice notice-success">
            Спостереження налаштовано. Дистанційне керування вимкнене. Для додавання керування зверніться до сервісного
            фахівця.
          </p>
        )}
        {!available && (
          <p className="notice notice-warning" role="alert">
            {query.isError
              ? apiErrorDisplayMessage(query.error)
              : "Зв’язок із сайтом перервано. Дії стануть доступними після відновлення зв’язку."}
          </p>
        )}
        {query.isError && <Button onClick={query.refresh}>Повторити перевірку</Button>}
        <ul className="setup-checks" aria-label="Перевірки установки">
          {data.checks
            .filter((check) => !observation || !["motor", "firmware", "grant"].includes(check.code))
            .map((check) => (
              <li key={check.code}>
                <StatusBadge
                  tone={check.status === "passed" ? "success" : check.status === "blocked" ? "warning" : "info"}
                >
                  {check.title}
                </StatusBadge>
                {check.detail && <p>{check.detail}</p>}
              </li>
            ))}
        </ul>
        {data.progress === "activated" && connection.network_transport === "lte" && (
          <p>Увімкніть контролер і модем із підготовленою SIM-карткою. Зв’язок через 4G з’явиться автоматично.</p>
        )}
        {showForm ? (
          <>
            {profiles.data ? (
              <SetupEquipmentForm
                key={formVersion}
                snapshot={data}
                profiles={profiles.data}
                busy={busy}
                available={available}
                onSave={save}
                onDirty={() => setDirty(true)}
                onReload={() => {
                  setDirty(false);
                  setFormVersion((version) => version + 1);
                }}
              />
            ) : profiles.isError ? (
              <>
                <p role="alert">Не вдалося завантажити список обладнання.</p>
                <Button onClick={profiles.refresh}>Завантажити список</Button>
              </>
            ) : (
              <p role="status">Завантажуємо список обладнання…</p>
            )}
            {editing && data.missing_fields.length === 0 && (
              <Button
                onClick={() => {
                  setEditing(false);
                  setDirty(false);
                }}
                disabled={busy}
              >
                Скасувати редагування
              </Button>
            )}
          </>
        ) : (
          <>
            <div>
              <h3>{data.needs_apply ? "Дані для вашої перевірки" : "Дані установки"}</h3>
              <SetupEquipmentSummary equipment={data.equipment} />
            </div>
            {data.needs_apply && data.configured_equipment && (
              <details>
                <summary>Порівняти зі збереженою установкою</summary>
                <SetupEquipmentSummary equipment={data.configured_equipment} />
              </details>
            )}
            {editable && (
              <Button onClick={() => setEditing(true)} disabled={busy || !available}>
                Виправити дані обладнання
              </Button>
            )}
          </>
        )}
        {editable && data.needs_apply && (!showForm || data.can_apply) && (
          <SetupConfirmation
            key={`apply:${setupSnapshotKey(data)}`}
            label="Звірив модель, дані двигуна й робочі межі з фактичною установкою"
            button="Підтвердити дані установки"
            disabled={busy || !available || !data.can_apply || dirty}
            onConfirm={apply}
          >
            <p>Після підтвердження контролер отримає паспорт установки. Двигун залишиться зупиненим.</p>
            {showForm && <SetupEquipmentSummary equipment={data.equipment} />}
            {showForm && (
              <p>
                Без повних даних двигуна можна завершити лише підготовку до спостереження. Для керування доповніть
                паспорт.
              </p>
            )}
            {dirty && <p>Спочатку збережіть введені дані.</p>}
          </SetupConfirmation>
        )}
        {editable &&
          !data.needs_apply &&
          data.configured_equipment &&
          data.checks.some((check) => check.code === "local_confirmation" && check.status !== "passed") && (
            <section aria-label="Підтвердження монтажу на місці">
              <h3>Перевірте монтаж біля установки</h3>
              <ol>
                <li>Зупиніть двигун, заблокуйте пуск і перевірте підключення, захисти та незалежну зупинку.</li>
                <li>Утримуйте BOOT на контролері 3 секунди.</li>
                <li>
                  Підключіть телефон до мережі <strong>KERUMO-{id.slice(0, 8)}</strong>. Пароль локального налаштування
                  є у закритій картці.
                </li>
                <li>
                  Відкрийте <strong>http://192.168.4.1</strong>, натисніть «Підтвердити монтаж», потім «Повернутися до
                  налаштування» і «Завершити налаштування».
                </li>
                <li>Поверніть телефон до інтернету. Сайт автоматично перевірить підтвердження від контролера.</li>
              </ol>
            </section>
          )}
        {editable &&
          !data.needs_apply &&
          ((!showForm && data.can_accept_control) || (!data.can_accept_control && data.can_accept_read_only)) && (
            <SetupConfirmation
              key={`accept:${setupSnapshotKey(data)}:${data.configuration_hash}:${data.can_accept_control ? "extended_test" : "read_only"}`}
              label={
                data.can_accept_control
                  ? "Перевірив монтаж на місці та приймаю установку"
                  : "Приймаю збережені дані й завершую налаштування лише для спостереження"
              }
              button={data.can_accept_control ? "Прийняти установку" : "Завершити для спостереження"}
              disabled={busy || !available || dirty}
              onConfirm={() => accept(data.can_accept_control ? "extended_test" : "read_only")}
            >
              <p>
                {data.can_accept_control
                  ? "Установка пройшла перевірки. Для запуску знадобиться окрема команда на панелі пристрою."
                  : "Завершення відкриє спостереження за збереженою установкою без дистанційного запуску. Первинне налаштування закриється; для додавання керування пізніше знадобиться сервісний фахівець."}
              </p>
              {!data.can_accept_control && data.configured_equipment && (
                <SetupEquipmentSummary equipment={data.configured_equipment} />
              )}
              {dirty && <p>Спочатку збережіть введені дані.</p>}
            </SetupConfirmation>
          )}
        {error && (
          <p className="notice notice-warning" role="alert">
            {error}
          </p>
        )}
        {editable && (
          <OwnerSetupHelpers
            key={`${data.generation}:${data.credential_revision}:${data.configuration_revision}`}
            data={data}
            available={available && !busy}
            sessionKey={sessionKey}
          />
        )}
        <div className="ui-row">
          <Link
            className={`button button-${available && data.progress === "ready" ? "primary" : "secondary"}`}
            href={`/devices/${data.device_id}` as Route}
          >
            Відкрити пристрій
          </Link>
        </div>
        <p className="help-copy">Стан оновлюється автоматично. Підготовка установки не запускає двигун.</p>
      </div>
    </Card>
  );
}

function SetupConfirmation({
  label,
  button,
  disabled,
  onConfirm,
  children,
}: {
  label: string;
  button: string;
  disabled: boolean;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="connect-fields">
      {children}
      <label className="setup-confirmation">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => setChecked(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      <Button variant="primary" disabled={disabled || !checked} onClick={onConfirm}>
        {button}
      </Button>
    </div>
  );
}

function OwnerSetupHelpers({
  data,
  available,
  sessionKey,
}: {
  data: OwnerSetupRead;
  available: boolean;
  sessionKey: readonly (string | number | null)[] | null;
}) {
  const { authorizedRequest } = useAuthSession();
  const { busy, error, run } = useAccountAction();
  const [issued, setIssued] = useState<{ id: string; url: string; expires: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const path = `/api/v1/connect/${data.controller_id}/setup/helpers`;
  const query = usePanelQuery({
    queryKey: ["setup-helpers", sessionKey, data.controller_id, setupSnapshotKey(data)],
    intervalMs: 5000,
    queryFn: async (signal) => parseHelperLinks(await authorizedRequest({ path, signal })),
  });
  const active = query.data?.filter((item) => item.active) ?? [];
  const create = () =>
    void run(async () => {
      const result = parseCreatedHelper(
        await authorizedRequest({ path, method: "POST", csrf: true, body: setupScope(data) }),
      );
      setIssued({
        id: result.id,
        url: `${window.location.origin}/setup-help#token=${encodeURIComponent(result.token)}`,
        expires: result.expires_at,
      });
      setCopied(false);
      query.refresh();
    });
  const revoke = (id: string) =>
    void run(async () => {
      await authorizedRequest({ path: `${path}/${id}`, method: "DELETE", csrf: true });
      if (issued?.id === id) setIssued(null);
      query.refresh();
    });
  return (
    <details>
      <summary>Допомога з первинним налаштуванням</summary>
      <div className="connect-fields">
        <p>
          Можна передати телефон помічнику або створити посилання на 2 години. Реєстрація помічника не потрібна. Він
          зможе лише підготувати дані цього контролера; перевіряєте й приймаєте їх ви.
        </p>
        <p className="help-copy">Посилання не дає доступу до запуску, історії чи сервісних параметрів частотника.</p>
        <Button onClick={create} disabled={busy || !available || !query.active || query.isError}>
          Створити посилання для помічника
        </Button>
        {issued && (
          <div className="connect-fields">
            <TextField label="Посилання для помічника" value={issued.url} readOnly autoComplete="off" />
            <p>Діє до {new Date(issued.expires).toLocaleString("uk-UA")}. Збережіть посилання зараз.</p>
            <Button
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(issued.url);
                  setCopied(true);
                })
              }
              disabled={busy}
            >
              {copied ? "Скопійовано" : "Копіювати посилання"}
            </Button>
          </div>
        )}
        {active.map((item) => (
          <div className="ui-row" key={item.id}>
            <span>Доступ до {new Date(item.expires_at).toLocaleString("uk-UA")}</span>
            <Button onClick={() => revoke(item.id)} disabled={busy || !available}>
              Відкликати посилання
            </Button>
          </div>
        ))}
        {query.isError && (
          <>
            <p role="alert">{apiErrorDisplayMessage(query.error)}</p>
            <Button onClick={query.refresh}>Оновити посилання</Button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
