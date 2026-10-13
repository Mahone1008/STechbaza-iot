"use client";
import { AccountGate } from "./account-gate";
import { useAccessContext } from "./access-context";
import { ControllerActivation } from "./controller-activation";
import { useAccountAction } from "./use-account-action";
import type { Route } from "next";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, PageHeader, SelectField, StatusBadge, TextField } from "@/components/ui";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import { apiErrorDisplayMessage, type components } from "@/lib/api";
import { parseConnection, type Connection } from "@/lib/api/onboarding";
import { isRecord, requiredString, requiredUuid, invalidResponse } from "@/lib/api/access";
import "./connect.css";

type Schema = components["schemas"];

export function ConnectionEntry() {
  const [id, setId] = useState("");
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return (
    <main className="connect-page">
      <PageHeader title="Додати контролер" description="Відскануйте QR на корпусі контролера камерою телефона." />
      <Card title="Маєте посилання з QR?">
        <TextField
          label="Посилання або ідентифікатор QR"
          value={id}
          onChange={(event) => {
            const value = event.target.value.trim();
            const match = value.match(/\/connect\/([0-9a-f-]{36})\/?$/i);
            setId(match?.[1] ?? value);
          }}
        />
        {valid && (
          <Link className="button button-primary" href={`/connect/${id}` as Route}>
            Продовжити
          </Link>
        )}
        <p className="help-copy">Пароль із закритої картки знадобиться для активації.</p>
      </Card>
      <Link href="/devices">До пристроїв</Link>
    </main>
  );
}

export function ConnectPage({ id }: { id: string }) {
  const { session } = useAuthSession();
  return (
    <main className="connect-page">
      <PageHeader title="Підключення контролера" description="Активуйте контролер і дочекайтеся його готовності." />
      {session.status === "anonymous" ? (
        <ControllerActivation id={id} />
      ) : (
        <AccountGate returnTo={`/connect/${id}`}>
          <ConnectWizard id={id} />
        </AccountGate>
      )}
      <Link href="/devices">До пристроїв</Link>
    </main>
  );
}

function ConnectWizard({ id }: { id: string }) {
  const { authorizedRequest, session } = useAuthSession();
  const queryClient = useQueryClient();
  const { retryAccess } = useAccessContext();
  const [activation, setActivation] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [timezone, setTimezone] = useState("Europe/Kyiv");
  const [siteId, setSiteId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const key = session.status === "authenticated" ? [session.email, session.sessionExpiresAt] : null;
  const connectionKey = ["connect", key, id];
  const query = usePanelQuery({
    queryKey: connectionKey,
    intervalMs: 5000,
    queryFn: async (signal) =>
      parseConnection(await authorizedRequest<unknown>({ path: `/api/v1/connect/${id}`, signal }), id),
  });
  const data = query.data;
  const claiming = data?.state === "ready" && !data.permanent_login;
  const sites = usePanelQuery({
    queryKey: ["connect-sites", key],
    enabled: claiming,
    intervalMs: 0,
    queryFn: async (signal) => {
      const raw = await authorizedRequest<unknown>({ path: "/api/v1/connect/sites", signal });
      if (!Array.isArray(raw)) return invalidResponse("connect-sites", "sites");
      return raw.map((value) => {
        if (!isRecord(value)) return invalidResponse("connect-sites", "site");
        return { id: requiredUuid(value, "id", "sites"), name: requiredString(value, "name", "sites") };
      });
    },
  });
  const organizations = usePanelQuery({
    queryKey: ["connect-organizations", key],
    enabled: claiming,
    intervalMs: 0,
    queryFn: (signal) =>
      authorizedRequest<Schema["OrganizationRead"][]>({ path: "/api/v1/connect/organizations", signal }),
  });
  const { busy, error, run: mutate } = useAccountAction();
  const submitClaim = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate(async () => {
      const result = await authorizedRequest<unknown>({
        path: `/api/v1/connect/${id}/claim`,
        method: "POST",
        body: {
          ...(data?.activation_required === false ? {} : { activation_code: activation }),
          device_name: deviceName.trim() || data?.hardware_model || "Контролер",
          ...(siteId
            ? { site_id: siteId }
            : {
                new_site: {
                  name: siteName.trim(),
                  timezone,
                  ...(organizationId === "new"
                    ? { organization_name: organizationName.trim() }
                    : organizationId
                      ? { organization_id: organizationId }
                      : {}),
                },
              }),
        },
      });
      queryClient.setQueryData(connectionKey, parseConnection(result, id));
      setActivation("");
      retryAccess();
    });
  };

  if (query.isError)
    return (
      <Card title="Не вдалося перевірити контролер">
        <p role="alert">{apiErrorDisplayMessage(query.error)}</p>
        <p>Перевірте QR та свій обліковий запис. Для передачі від іншого власника потрібна нова картка активації.</p>
        <Button onClick={query.refresh}>Повторити</Button>
      </Card>
    );
  if (!data) return <p role="status">Перевіряємо контролер…</p>;
  if (data.permanent_login)
    return (
      <Card title="Створіть особистий обліковий запис">
        <p>Використовуйте власну пошту й пароль. У цьому кабінеті можна додати всі ваші контролери.</p>
        <Link className="button button-primary" href={`/register?controller=${id}` as Route}>
          Створити обліковий запис
        </Link>
      </Card>
    );
  return (
    <>
      {data.state === "ready" ? (
        <Card title={data.hardware_model} description={`Серійний номер: ${data.serial_number}`}>
          <form onSubmit={submitClaim}>
            {data.activation_required !== false && (
              <TextField
                required
                type="password"
                autoComplete="off"
                minLength={32}
                maxLength={100}
                label="Пароль активації з картки"
                value={activation}
                onChange={(event) => setActivation(event.target.value.trim())}
              />
            )}
            {!!sites.data?.length && (
              <SelectField
                label="Куди додати контролер"
                value={siteId}
                onChange={(event) => setSiteId(event.target.value)}
              >
                <option value="">Новий об’єкт</option>
                {sites.data.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </SelectField>
            )}
            {sites.isError && (
              <p role="status">Не вдалося завантажити ваші об’єкти. Повторіть завантаження або створіть новий.</p>
            )}
            {sites.isError && <Button onClick={sites.refresh}>Завантажити об’єкти</Button>}
            {!siteId && (
              <TextField
                required
                minLength={2}
                maxLength={160}
                label="Назва об’єкта"
                value={siteName}
                placeholder="Наприклад, свердловина біля будинку"
                hint="Місце, де встановлено контролер."
                onChange={(event) => setSiteName(event.target.value)}
              />
            )}
            <details>
              <summary>Назва пристрою та інші параметри</summary>
              <div className="connect-fields">
                <TextField
                  minLength={2}
                  maxLength={160}
                  label="Назва контролера"
                  value={deviceName}
                  placeholder={data.hardware_model}
                  onChange={(event) => setDeviceName(event.target.value)}
                />
                {!siteId && (
                  <>
                    <SelectField
                      label="Організація для нового об’єкта"
                      value={organizationId}
                      onChange={(event) => setOrganizationId(event.target.value)}
                    >
                      <option value="">Мій особистий кабінет</option>
                      <option value="new">Нова організація</option>
                      {organizations.data?.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </SelectField>
                    {organizationId === "new" && (
                      <TextField
                        label="Назва організації"
                        required
                        minLength={2}
                        maxLength={160}
                        value={organizationName}
                        onChange={(event) => setOrganizationName(event.target.value)}
                      />
                    )}
                    {organizations.isError && (
                      <>
                        <p role="status">Не вдалося завантажити організації.</p>
                        <Button onClick={organizations.refresh}>Завантажити організації</Button>
                      </>
                    )}
                    <TextField
                      label="Часовий пояс"
                      value={timezone}
                      hint="За ним працюватимуть розклади."
                      onChange={(event) => setTimezone(event.target.value)}
                    />
                  </>
                )}
              </div>
            </details>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Активуємо…" : "Активувати контролер"}
            </Button>
          </form>
        </Card>
      ) : (
        <ConnectionProgress connection={data} available={query.active} />
      )}
      {error && (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function ConnectionProgress({ connection, available }: { connection: Connection; available: boolean }) {
  const readiness = connection.readiness;
  const ready = available && readiness.state === "ready";
  const live = available && connection.connection_state === "online";
  const equipmentChecked = readiness.state === "ready" || readiness.state === "needs_commissioning";
  return (
    <Card title={connection.hardware_model} description={`Серійний номер: ${connection.serial_number}`}>
      <div className="connect-fields" aria-live="polite">
        <StatusBadge tone={ready ? "success" : !available || readiness.state === "blocked" ? "warning" : "info"}>
          {available ? readiness.title : "Зв’язок із сайтом перервано"}
        </StatusBadge>
        <p>Контролер прив’язано до вашого об’єкта. Повторна активація не потрібна.</p>
        <ol className="connection-progress" aria-label="Готовність контролера">
          <li data-complete="true">
            <span className="connection-step-marker" aria-hidden="true">
              ✓
            </span>
            <span>
              Ваш об’єкт<small>Контролер активовано</small>
            </span>
          </li>
          <li data-complete={live}>
            <span className="connection-step-marker" aria-hidden="true">
              {live ? "✓" : "2"}
            </span>
            <span>
              Зв’язок із контролером
              <small>
                {!available
                  ? "Не можемо перевірити зв’язок"
                  : live
                    ? "Отримуємо свіжі показання"
                    : connection.connection_state === "bootstrap_connected"
                      ? "Плата підключилася. Очікуємо показання"
                      : "Очікуємо підключення"}
              </small>
            </span>
          </li>
          <li data-complete={equipmentChecked}>
            <span className="connection-step-marker" aria-hidden="true">
              {equipmentChecked ? "✓" : "3"}
            </span>
            <span>
              Перевірка установки<small>{equipmentChecked ? "Обладнання підтверджено" : "Завершує монтажник"}</small>
            </span>
          </li>
          <li data-complete={ready}>
            <span className="connection-step-marker" aria-hidden="true">
              {ready ? "✓" : "4"}
            </span>
            <span>
              Готовність до використання<small>{ready ? "Перевірки завершено" : "Очікуємо підтвердження"}</small>
            </span>
          </li>
        </ol>
        {available ? (
          readiness.next_action && <p>{readiness.next_action}</p>
        ) : (
          <p>Перевірте інтернет на телефоні або комп’ютері.</p>
        )}
        {!ready && connection.network_transport === "lte" && readiness.state === "awaiting_controller" && (
          <p>Увімкніть контролер і модем із підготовленою SIM-карткою. Зв’язок через 4G з’явиться автоматично.</p>
        )}
        {readiness.blockers.length > 0 && (
          <details>
            <summary>Що ще потрібно</summary>
            <ul>
              {readiness.blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        )}
        {connection.device_id && (
          <div className="ui-row">
            <Link
              className={`button button-${ready ? "primary" : "secondary"}`}
              href={`/devices/${connection.device_id}` as Route}
            >
              Відкрити пристрій
            </Link>
            {connection.can_install && (
              <Link
                className="button button-secondary"
                href={`/devices/${connection.device_id}?view=equipment` as Route}
              >
                Монтаж і перевірка
              </Link>
            )}
          </div>
        )}
        {!ready &&
          !connection.can_install &&
          ["needs_equipment", "needs_local_confirmation", "needs_commissioning", "blocked"].includes(
            readiness.state,
          ) && <p className="help-copy">Налаштування виконує виробник або монтажник. Вашу активацію вже збережено.</p>}
        {available &&
          !ready &&
          !connection.can_install &&
          connection.can_invite_installer &&
          connection.organization_id &&
          connection.site_id && <InstallerInvitation controllerId={connection.controller_id} />}
        <p className="help-copy">
          {available ? "Стан оновлюється автоматично." : "Оновимо стан після відновлення зв’язку."}
        </p>
      </div>
    </Card>
  );
}

function InstallerInvitation({ controllerId }: { controllerId: string }) {
  const { authorizedRequest } = useAuthSession();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAccountAction();
  const invite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      await authorizedRequest({
        path: `/api/v1/connect/${controllerId}/installer-invitations`,
        method: "POST",
        csrf: true,
        body: {
          email: email.trim(),
          expires_in_days: 7,
        },
      });
      setEmail("");
      setSent(true);
    });
  };
  return (
    <details>
      <summary>Запросити монтажника</summary>
      <form onSubmit={invite}>
        <p>Вкажіть пошту зареєстрованого сервісного фахівця. Він отримає доступ лише до цього об’єкта на 7 днів.</p>
        <TextField
          label="Пошта монтажника"
          type="email"
          required
          maxLength={320}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Надсилаємо…" : "Надіслати запрошення"}
        </Button>
        {sent && <p role="status">Запрошення надіслано. Монтажник має прийняти його протягом трьох днів.</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
