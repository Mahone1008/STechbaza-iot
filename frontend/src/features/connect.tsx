"use client";
import { AccountGate } from "./account-gate";
import { useAccessContext } from "./access-context";
import { ControllerActivation } from "./controller-activation";
import { useAccountAction } from "./use-account-action";
import type { Route } from "next";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Card, PageHeader, SelectField, TextField } from "@/components/ui";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import { apiErrorDisplayMessage, type components } from "@/lib/api";
import { parseConnection } from "@/lib/api/onboarding";
import { isRecord, requiredString, requiredUuid, invalidResponse } from "@/lib/api/access";

type Schema = components["schemas"];
type Connection = Schema["ConnectionRead"];

export function ConnectionEntry() {
  const [id, setId] = useState("");
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return (
    <main className="connect-page">
      <PageHeader
        title="Додати контролер"
        description="Відскануйте QR на корпусі камерою телефона. Він відкриє сторінку саме вашого контролера."
      />
      <Card title="Маєте посилання або номер QR?">
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
            Продовжити підключення
          </Link>
        )}
        <p>Код активації вводиться окремо на наступному кроці. Пароль Wi-Fi вводиться лише локально в контролері.</p>
      </Card>
      <Link href="/devices">До пристроїв</Link>
    </main>
  );
}

export function ConnectPage({ id }: { id: string }) {
  const { session } = useAuthSession();
  return (
    <main className="connect-page">
      <PageHeader title="Підключення контролера" description="Ваш об’єкт, обладнання та перевірка зв’язку." />
      {session.status === "anonymous" ? (
        <ControllerActivation id={id} />
      ) : (
        <AccountGate returnTo={`/connect/${id}`}>
          <ConnectWizard id={id} />
        </AccountGate>
      )}
      <div className="ui-row">
        <Link href="/devices">До пристроїв</Link>
        <Link href="/account/security">Безпека облікового запису</Link>
      </div>
    </main>
  );
}

function ConnectWizard({ id }: { id: string }) {
  const { authorizedRequest, session } = useAuthSession();
  const { retryAccess } = useAccessContext();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [activation, setActivation] = useState("");
  const [deviceName, setDeviceName] = useState("Контролер насоса");
  const [siteName, setSiteName] = useState("");
  const [timezone, setTimezone] = useState("Europe/Kyiv");
  const [siteId, setSiteId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [organizationName, setOrganizationName] = useState("Моя організація");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [model, setModel] = useState("");
  const [revision, setRevision] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState(false);
  const key = session.status === "authenticated" ? [session.email, session.sessionExpiresAt] : null;
  const query = usePanelQuery({
    queryKey: ["connect", key, id],
    intervalMs: 0,
    queryFn: async (signal) =>
      parseConnection(
        await authorizedRequest<unknown>({
          path: `/api/v1/connect/${id}`,
          signal,
        }),
        id,
      ),
  });
  const sites = usePanelQuery({
    queryKey: ["connect-sites", key],
    intervalMs: 0,
    queryFn: async (signal) => {
      const raw = await authorizedRequest<unknown>({
        path: "/api/v1/connect/sites",
        signal,
      });
      if (!Array.isArray(raw)) return invalidResponse("connect-sites", "sites");
      return raw.map((value) => {
        if (!isRecord(value)) return invalidResponse("connect-sites", "site");
        return {
          id: requiredUuid(value, "id", "sites"),
          name: requiredString(value, "name", "sites"),
        };
      });
    },
  });
  const profiles = usePanelQuery({
    queryKey: ["connect-profiles", key],
    intervalMs: 0,
    queryFn: (signal) =>
      authorizedRequest<Schema["ProfileRead"][]>({
        path: "/api/v1/equipment/profiles",
        signal,
      }),
  });
  const organizations = usePanelQuery({
    queryKey: ["connect-organizations", key],
    intervalMs: 0,
    queryFn: (signal) =>
      authorizedRequest<Schema["OrganizationRead"][]>({
        path: "/api/v1/connect/organizations",
        signal,
      }),
  });
  const data = connection ?? query.data;
  const profile = profiles.data?.find((item) => `${item.id}:${item.version}` === selectedProfile);
  const { busy, error, run: mutate } = useAccountAction();
  const submitClaim = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate(async () => {
      const result = await authorizedRequest<Connection>({
        path: `/api/v1/connect/${id}/claim`,
        method: "POST",
        body: {
          ...(data?.activation_required === false ? {} : { activation_code: activation }),
          device_name: deviceName,
          ...(siteId
            ? { site_id: siteId }
            : {
                new_site: {
                  name: siteName,
                  timezone,
                  ...(organizationId ? { organization_id: organizationId } : { organization_name: organizationName }),
                },
              }),
        },
      });
      setConnection(parseConnection(result, id));
      setActivation("");
      retryAccess();
    });
  };

  const checkConnection = () =>
    void mutate(async () => {
      setConnection(
        parseConnection(
          await authorizedRequest<unknown>({
            path: `/api/v1/connect/${id}`,
          }),
          id,
        ),
      );
    });

  const submitEquipment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile) return;
    void mutate(async () => {
      await authorizedRequest({
        path: `/api/v1/connect/${id}/equipment`,
        method: "PUT",
        body: {
          profile_id: profile.id,
          profile_version: profile.version,
          model,
          hardware_revision: revision || null,
          nameplate_confirmed: confirmed,
        },
      });
      setSaved(true);
    });
  };

  if (query.isError)
    return (
      <Card title="Контролер недоступний">
        <p role="alert">{apiErrorDisplayMessage(query.error)}</p>
        <p>
          Перевірте QR та обліковий запис. Якщо пристрій уже належить іншому власнику, попередній власник має виконати
          передачу у вкладці «Обладнання».
        </p>
        <Button onClick={query.refresh}>Повторити</Button>
      </Card>
    );
  if (!data) return <p role="status">Перевіряємо контролер…</p>;
  if (data.permanent_login)
    return (
      <Card title="Створіть особистий обліковий запис">
        <p>
          Заводські дані підтверджено. Збережіть особистий доступ із вашою поштою та паролем, щоб додавати кілька
          контролерів до одного кабінету.
        </p>
        <Link className="button button-primary" href={`/register?controller=${id}` as Route}>
          Створити обліковий запис
        </Link>
      </Card>
    );
  return (
    <>
      <Card title={data.hardware_model} description={`Серійний номер: ${data.serial_number}`}>
        {data.state === "ready" ? (
          <form onSubmit={submitClaim}>
            <h2>1. Створіть об’єкт</h2>
            <p>Об’єктом може бути свердловина, насосна станція або інше місце встановлення обладнання.</p>
            <SelectField
              label="Куди додати контролер"
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
            >
              <option value="">Створити новий об’єкт</option>
              {sites.data?.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </SelectField>
            {sites.isError && (
              <p role="status">Наявні об’єкти не завантажено. Можна створити новий або повторити завантаження.</p>
            )}
            {!siteId && (
              <>
                <SelectField
                  label="Організація для нового об’єкта"
                  value={organizationId}
                  onChange={(event) => setOrganizationId(event.target.value)}
                >
                  <option value="">Створити нову організацію</option>
                  {organizations.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </SelectField>
                {!organizationId && (
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
                  <p role="status">Наявні організації не завантажено. Можна створити нову або повторити підключення.</p>
                )}
                <TextField
                  required
                  minLength={2}
                  maxLength={160}
                  label="Назва об’єкта"
                  value={siteName}
                  placeholder="Свердловина біля будинку"
                  onChange={(event) => setSiteName(event.target.value)}
                />
                <TextField
                  required
                  label="Часовий пояс"
                  value={timezone}
                  hint="Наприклад Europe/Kyiv. За ним працюватимуть розклади."
                  onChange={(event) => setTimezone(event.target.value)}
                />
              </>
            )}
            <TextField
              required
              minLength={2}
              maxLength={160}
              label="Назва контролера"
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
            />
            {data.activation_required !== false && (
              <TextField
                required
                type="password"
                autoComplete="off"
                minLength={32}
                maxLength={100}
                label="Пароль активації з етикетки"
                value={activation}
                onChange={(event) => setActivation(event.target.value.trim())}
                hint="Пароль із комплекту підтверджує право додати контролер. Сам QR цього права не дає."
              />
            )}
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Прив’язуємо…" : "Підключити до об’єкта"}
            </Button>
          </form>
        ) : (
          <>
            <p role="status">Контролер прив’язано до вашого об’єкта. Повторна активація не потрібна.</p>
            <Link className="button button-secondary" href={`/devices/${data.device_id}` as Route}>
              Відкрити пристрій
            </Link>
          </>
        )}
      </Card>
      {data.state === "claimed" && (
        <>
          <Card title="2. Вкажіть частотний перетворювач">
            <form onSubmit={submitEquipment}>
              <SelectField
                required
                label="Виробник і серія"
                value={selectedProfile}
                onChange={(event) => {
                  setSelectedProfile(event.target.value);
                  setConfirmed(false);
                  setSaved(false);
                }}
              >
                <option value="">Оберіть за шильдиком</option>
                {profiles.data?.map((item) => (
                  <option key={`${item.id}:${item.version}`} value={`${item.id}:${item.version}`}>
                    {item.manufacturer} {item.series}
                  </option>
                ))}
              </SelectField>
              {profiles.isError && <p role="alert">{apiErrorDisplayMessage(profiles.error)}</p>}
              <TextField
                required
                label="Повна модель зі шильдика"
                value={model}
                maxLength={120}
                onChange={(event) => {
                  setModel(event.target.value);
                  setConfirmed(false);
                  setSaved(false);
                }}
              />
              <TextField
                label="Версія обладнання, якщо зазначено"
                value={revision}
                maxLength={80}
                onChange={(event) => setRevision(event.target.value)}
              />
              <label className="ui-row">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Модель перевірено за шильдиком обладнання
              </label>
              {profile && (
                <p className="notice notice-warning">
                  {profile.tested_model === model && profile.driver_id
                    ? "Перед керуванням потрібні перевірка зв’язку, меж установки й підтвердження конфігурації контролером."
                    : "Паспорт можна зберегти. Керування цією моделлю поки недоступне: потрібен перевірений сумісний драйвер."}
                </p>
              )}
              <Button type="submit" variant="primary" disabled={busy || !profile || !confirmed || saved}>
                Зберегти обладнання
              </Button>
              {saved && (
                <p role="status">
                  Паспорт збережено. Керування не ввімкнено автоматично. Стан узгодження доступний у вкладці
                  «Обладнання».
                  <Link className="button button-primary" href={`/devices/${data.device_id}?view=equipment` as Route}>
                    Налаштувати й перевірити обладнання
                  </Link>
                </p>
              )}
            </form>
          </Card>
        </>
      )}
      {error && (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      )}
      <Card title="3. Підключіть до мережі">
        <p>
          Зупиніть двигун. Утримуйте BOOT на контролері 3 секунди та підключіться телефоном до його Wi-Fi. Назва мережі
          й окремий пароль зазначені в комплекті.
        </p>
        <p>
          Відкрийте <strong>http://192.168.4.1</strong> у браузері телефона. Локальна мережа закривається через 10
          хвилин. Пароль домашнього Wi-Fi зберігається тільки в контролері.
        </p>
        <p>
          Стан зв’язку:{" "}
          {data.last_contact_at
            ? `останнє повідомлення ${new Date(data.last_contact_at).toLocaleString("uk-UA")}`
            : "контролер ще не підтвердив підключення"}
          .
        </p>
        <Button disabled={query.isFetching || busy} onClick={checkConnection}>
          Перевірити підключення
        </Button>
      </Card>
    </>
  );
}
