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
import { parseConnection, parseConnectionEquipment, type ConnectionEquipment } from "@/lib/api/onboarding";
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
        <p>QR містить лише посилання. Одноразовий пароль із закритої картки вводиться на наступному кроці.</p>
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
  const queryClient = useQueryClient();
  const { retryAccess } = useAccessContext();
  const [activation, setActivation] = useState("");
  const [deviceName, setDeviceName] = useState("Контролер насоса");
  const [siteName, setSiteName] = useState("");
  const [timezone, setTimezone] = useState("Europe/Kyiv");
  const [siteId, setSiteId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [organizationName, setOrganizationName] = useState("Моя організація");
  const key = session.status === "authenticated" ? [session.email, session.sessionExpiresAt] : null;
  const connectionKey = ["connect", key, id];
  const query = usePanelQuery({
    queryKey: connectionKey,
    intervalMs: 5000,
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
  const organizations = usePanelQuery({
    queryKey: ["connect-organizations", key],
    intervalMs: 0,
    queryFn: (signal) =>
      authorizedRequest<Schema["OrganizationRead"][]>({
        path: "/api/v1/connect/organizations",
        signal,
      }),
  });
  const data = query.data;
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
      queryClient.setQueryData(connectionKey, parseConnection(result, id));
      setActivation("");
      retryAccess();
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
      {error && (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      )}
      <Card title="2. Зв’язок із контролером">
        <ConnectionNetwork connection={data} />
        <Button disabled={query.isFetching || busy} onClick={query.refresh}>
          Перевірити підключення
        </Button>
      </Card>
      {data.state === "claimed" && data.device_id && <ConnectEquipment connection={data} />}
    </>
  );
}

function ConnectionNetwork({ connection }: { connection: Connection }) {
  const lte = connection.network_transport === "lte";
  const state = connection.connection_state ?? "not_connected";
  const labels = {
    not_connected: "Плата ще не підключилася",
    transport_mismatch: "Тип інтернету не збігається із заводським комплектом",
    bootstrap_connected: "Плата підключилася. Очікуємо показання обладнання",
    online: "Контролер на зв’язку; отримано свіжі показання",
    offline: "Зв’язок перервався; нових показань немає",
  };
  return (
    <>
      <StatusBadge tone={state === "online" ? "success" : "warning"}>{labels[state]}</StatusBadge>
      {lte ? (
        <p>
          Інтернет через 4G. Установіть SIM-картку з активним інтернетом і ввімкніть контролер та модем. Підготовлена
          виробником плата підключиться сама.
        </p>
      ) : (
        <>
          <p>
            Зупиніть двигун. Утримуйте BOOT 3 секунди й підключіться телефоном до мережі контролера. Її назва та пароль
            є в закритій картці.
          </p>
          <p>
            Відкрийте <strong>http://192.168.4.1</strong> і введіть домашній Wi-Fi. Пароль зберігається тільки в
            контролері; налаштування закривається через 10 хвилин.
          </p>
        </>
      )}
      {state === "not_connected" && (
        <p className="help-copy">
          Прив’язка на сайті зберігає власника. Зв’язок підтверджується лише після звернення фізичної плати з її
          заводським ключем.
        </p>
      )}
      {state === "transport_mismatch" && (
        <p role="alert">
          Виробник має звірити тип мережі та прошивку цього контролера. Повторна активація не потрібна.
        </p>
      )}
      {connection.last_contact_at && (
        <p className="help-copy">
          Контакт плати: {new Date(connection.last_contact_at).toLocaleString("uk-UA")}.{" "}
          {connection.telemetry_received_at && (
            <>Показання: {new Date(connection.telemetry_received_at).toLocaleString("uk-UA")}.</>
          )}
        </p>
      )}
    </>
  );
}

function ConnectEquipment({ connection }: { connection: Connection }) {
  const { authorizedRequest, session } = useAuthSession();
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const key = session.status === "authenticated" ? [session.email, session.sessionExpiresAt] : null;
  const query = usePanelQuery({
    queryKey: ["connect-equipment", key, connection.controller_id, connection.device_id],
    enabled: !!connection.device_id,
    intervalMs: 30000,
    queryFn: async (signal) =>
      parseConnectionEquipment(
        await authorizedRequest<unknown>({
          path: `/api/v1/devices/${connection.device_id}/equipment`,
          signal,
        }),
        connection.device_id!,
        connection.controller_id,
      ),
  });
  const equipment = query.data;
  const editable = connection.initial_equipment_editable === true && !equipment?.configured;
  return (
    <Card title="3. Обладнання та готовність">
      {saved && <p role="status">Паспорт збережено. Керування не ввімкнено автоматично.</p>}
      {query.isError && (
        <>
          <p role="alert">{apiErrorDisplayMessage(query.error)}</p>
          <Button onClick={query.refresh}>Повторити завантаження паспорта</Button>
        </>
      )}
      {!equipment && !query.isError && <p role="status">Завантажуємо паспорт…</p>}
      {equipment?.module && (
        <>
          <p>
            <strong>
              {equipment.module.manufacturer} {equipment.module.model}
            </strong>{" "}
            · {equipment.module.series}
          </p>
          <StatusBadge tone={equipment.configuration_state === "verified" ? "success" : "warning"}>
            {equipment.configuration_state === "verified"
              ? "Обладнання підтверджено контролером"
              : "Потрібна перевірка обладнання"}
          </StatusBadge>
          {editable && !editing && <Button onClick={() => setEditing(true)}>Виправити паспорт</Button>}
          <p>
            <Link className="button button-primary" href={`/devices/${connection.device_id}?view=equipment` as Route}>
              Налаштувати й перевірити обладнання
            </Link>
          </p>
        </>
      )}
      {equipment && editable && (!equipment.module || editing) && (
        <ConnectEquipmentForm
          key={equipment.module?.id ?? "new"}
          connection={connection}
          module={equipment.module}
          onSaved={() => {
            setSaved(true);
            setEditing(false);
            query.refresh();
          }}
        />
      )}
      {equipment && !editable && !equipment.module && (
        <p>Паспорт заповнює виробник або сервіс. Зверніться до них для перевірки цього контролера.</p>
      )}
      <details>
        <summary>Що потрібно перед першим запуском</summary>
        <p>
          Перевірений драйвер для повної моделі, робочі межі та захисти двигуна. Налаштування виконайте біля установки;
          прив’язка до облікового запису сама не дозволяє пуск.
        </p>
        {connection.network_transport === "lte" && (
          <p>
            Для локального підтвердження зупиніть двигун, утримуйте BOOT 3 секунди й відкрийте 192.168.4.1 через мережу
            контролера. Це перевірка обладнання, а інтернет надходить через 4G.
          </p>
        )}
      </details>
    </Card>
  );
}

function ConnectEquipmentForm({
  connection,
  module,
  onSaved,
}: {
  connection: Connection;
  module: ConnectionEquipment["module"];
  onSaved: () => void;
}) {
  const { authorizedRequest, session } = useAuthSession();
  const [selectedProfile, setSelectedProfile] = useState("");
  const [model, setModel] = useState(module?.model ?? "");
  const [revision, setRevision] = useState(module?.hardware_revision ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const key = session.status === "authenticated" ? [session.email, session.sessionExpiresAt] : null;
  const profiles = usePanelQuery({
    queryKey: ["connect-profiles", key],
    intervalMs: 0,
    queryFn: (signal) => authorizedRequest<Schema["ProfileRead"][]>({ path: "/api/v1/equipment/profiles", signal }),
  });
  const selectable = profiles.data?.filter((item) => item.manufacturer.trim().toUpperCase() === "SUSWE");
  const matching = module
    ? selectable?.find((item) => item.series === module.series && item.manufacturer === module.manufacturer)
    : undefined;
  const chosen = selectedProfile || (matching ? `${matching.id}:${matching.version}` : "");
  const profile = selectable?.find((item) => `${item.id}:${item.version}` === chosen);
  const supported = !!profile?.driver_id && profile.tested_model?.toLowerCase() === model.trim().toLowerCase();
  const { busy, error, run } = useAccountAction();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || !confirmed) return;
    void run(async () => {
      await authorizedRequest({
        path: `/api/v1/connect/${connection.controller_id}/equipment`,
        method: "PUT",
        body: {
          profile_id: profile.id,
          profile_version: profile.version,
          model: model.trim(),
          hardware_revision: revision.trim() || null,
          nameplate_confirmed: true,
        },
      });
      onSaved();
    });
  };
  return (
    <form onSubmit={submit}>
      <SelectField
        required
        label="Серія частотника SUSWE"
        value={chosen}
        onChange={(event) => {
          setSelectedProfile(event.target.value);
          setConfirmed(false);
        }}
      >
        <option value="">Оберіть за шильдиком</option>
        {selectable?.map((item) => (
          <option key={`${item.id}:${item.version}`} value={`${item.id}:${item.version}`}>
            {item.series}
          </option>
        ))}
      </SelectField>
      {profiles.isError && <p role="alert">{apiErrorDisplayMessage(profiles.error)}</p>}
      <TextField
        required
        label="Повна модель зі шильдика"
        hint="Модель частотника, а не його серійний номер."
        value={model}
        maxLength={120}
        onChange={(event) => {
          setModel(event.target.value);
          setConfirmed(false);
        }}
      />
      <details>
        <summary>Версія обладнання</summary>
        <TextField
          label="Версія обладнання, якщо зазначено"
          value={revision}
          maxLength={80}
          onChange={(event) => {
            setRevision(event.target.value);
            setConfirmed(false);
          }}
        />
      </details>
      <label className="ui-row">
        <input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        Модель перевірено за шильдиком обладнання
      </label>
      {profile && (
        <p className="notice notice-warning">
          {supported
            ? "Перед керуванням перевірте межі й підтвердьте обладнання біля установки."
            : "Паспорт можна зберегти. Керування цією моделлю поки недоступне: потрібен перевірений сумісний драйвер."}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy || !profile || !confirmed || !profiles.active}>
        {busy ? "Зберігаємо…" : "Зберегти обладнання"}
      </Button>
      {error && (
        <p role="alert" className="notice notice-warning">
          {error}
        </p>
      )}
    </form>
  );
}
