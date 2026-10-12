"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button, SelectField, StatusBadge, TextField } from "@/components/ui";
import type { components } from "@/lib/api";
import type { EquipmentPassport } from "@/lib/api/equipment";
import type { ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";
import { useAccountAction } from "./use-account-action";
import { usePanelQuery } from "./use-panel-query";

type Schema = components["schemas"];

export function InstallerWorkspace({
  context,
  passport,
  onSaved,
  children,
}: {
  context: ReadyAccessSnapshot;
  passport: EquipmentPassport;
  onSaved: () => void;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const installedDrive = passport.modules.find((item) => item.kind === "vfd" && !item.retired_at);
  const verified = passport.configuration_state === "verified";
  const commissioned = passport.commissioned_control_mode != null;
  const permissionAccepted = commissioned && passport.readiness?.state === "ready";
  const blockers = passport.readiness?.blockers ?? [];
  const steps = [
    {
      name: "Паспорт обладнання",
      done: !!installedDrive,
      detail: installedDrive
        ? `${installedDrive.manufacturer} ${installedDrive.model}`
        : "Звірте частотник і двигун зі шильдиками.",
    },
    {
      name: "Робочі межі",
      done: !!passport.desired,
      detail: passport.desired
        ? `${passport.desired.manifest.frequency_limits.min_hz}–${passport.desired.manifest.frequency_limits.max_hz} Гц`
        : "Задайте межі; сумісний драйвер вибирається з паспорта.",
    },
    {
      name: "Підтвердження біля установки",
      done: verified,
      detail: verified
        ? "Контролер підтвердив підключення і конфігурацію."
        : "Дочекайтеся доставки налаштувань і звірте обладнання на місці.",
    },
    {
      name: "Дозвіл використання",
      done: permissionAccepted,
      detail:
        commissioned && !permissionAccepted
          ? "Дозвіл збережено. Очікуємо готовність контролера."
          : commissioned
            ? passport.commissioned_control_mode === "extended_test"
              ? "Повне керування після перевірки установки"
              : passport.commissioned_control_mode === "bench_without_motor"
                ? "Стенд без двигуна"
                : "Спостереження без керування"
            : "Виберіть дозволений режим після перевірки установки.",
    },
  ];
  return (
    <section className="equipment-actions" aria-label="Підготовка установки">
      <h3>Підготовка установки</h3>
      <p className="help-copy">
        Виробник або сервіс виконує ці кроки. Клієнт бачить готовність і доступні йому команди.
      </p>
      {passport.readiness && (
        <>
          {passport.readiness.next_action && <p>{passport.readiness.next_action}</p>}
          {!!blockers.length && (
            <ul>
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <ol className="device-events" aria-label="Кроки підготовки установки">
        {steps.map((step, index) => (
          <li key={step.name}>
            <strong>{step.name}</strong>{" "}
            <StatusBadge tone={step.done ? "success" : "neutral"}>
              {step.done ? "Готово" : index === 3 && commissioned ? "Очікуємо підтвердження" : "Потрібно виконати"}
            </StatusBadge>
            <p className="help-copy">{step.detail}</p>
          </li>
        ))}
      </ol>
      {!passport.desired && passport.controller_id && (
        <>
          {!editing && (
            <Button variant={!installedDrive ? "primary" : "secondary"} onClick={() => setEditing(true)}>
              {installedDrive ? "Виправити початковий паспорт" : "Підготувати паспорт"}
            </Button>
          )}
          {editing && (
            <InitialEquipmentForm
              key={installedDrive?.id ?? "new"}
              context={context}
              passport={passport}
              onSaved={() => {
                setEditing(false);
                onSaved();
              }}
              onCancel={() => setEditing(false)}
            />
          )}
        </>
      )}
      {!installedDrive && !passport.controller_id && (
        <p className="notice notice-warning">
          Це контролер зі старою реєстрацією. Виробник має підготувати індивідуальний заводський комплект перед
          заповненням паспорта.
        </p>
      )}
      {passport.firmware_version && passport.firmware_control_capability === "read_only" && (
        <p className="notice notice-warning" role="status">
          Керування: потрібно оновити стару ReadOnly-прошивку. Поточна плата дозволяє лише спостереження.
        </p>
      )}
      {passport.desired && !verified && (
        <section className="equipment-module" aria-label="Місцеве підтвердження монтажником">
          <h4>Крок 3. Підтвердьте обладнання біля установки</h4>
          <p>Спочатку дочекайтеся, щоб контролер завантажив збережені налаштування.</p>
          <ol>
            <li>Зупиніть двигун, заблокуйте пуск і перевірте підключення, захисти та незалежну зупинку.</li>
            <li>Утримуйте BOOT на контролері 3 секунди.</li>
            <li>
              Підключіть телефон до мережі{" "}
              <strong>{passport.controller_id ? `KERUMO-${passport.controller_id.slice(0, 8)}` : "KERUMO-…"}</strong>.
              Пароль локального налаштування є у закритій картці.
            </li>
            <li>
              Відкрийте <strong>http://192.168.4.1</strong> і натисніть «Підтвердити монтаж».
            </li>
            <li>Завершіть місцеве налаштування, поверніть телефон до інтернету та оновіть паспорт.</li>
          </ol>
          <p className="help-copy">
            Для V4 ця мережа потрібна лише для місцевої перевірки. Інтернет контролера надходить через SIM.
          </p>
        </section>
      )}
      {verified && commissioned && passport.readiness?.state === "needs_commissioning" && (
        <details className="equipment-secondary">
          <summary>Як відновити місцевий дозвіл керування</summary>
          <p>
            Спочатку дочекайтеся доставки дозволу. Якщо пуск було заблоковано місцево, перевірте зупинку і захисти біля
            установки.
          </p>
          <p>
            Утримуйте BOOT 3 секунди, підключіть телефон до мережі контролера та відкрийте 192.168.4.1. Натисніть
            «Дозволити керування після перевірки», потім «Завершити налаштування».
          </p>
          <p className="help-copy">
            Дозвіл і закриття налаштування не запускають двигун. Запуск виконується окремою командою.
          </p>
        </details>
      )}
      {!editing && children}
    </section>
  );
}

function InitialEquipmentForm({
  context,
  passport,
  onSaved,
  onCancel,
}: {
  context: ReadyAccessSnapshot;
  passport: EquipmentPassport;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { authorizedRequest } = useAuthSession();
  const installedDrive = passport.modules.find((item) => item.kind === "vfd" && !item.retired_at);
  const [selected, setSelected] = useState("");
  const [model, setModel] = useState(installedDrive?.model ?? "");
  const [serial, setSerial] = useState(installedDrive?.serial_number ?? "");
  const [hardware, setHardware] = useState(installedDrive?.hardware_revision ?? "");
  const [software, setSoftware] = useState(installedDrive?.software_revision ?? "");
  const [rated, setRated] = useState(installedDrive?.motor ? String(installedDrive.motor.rated_frequency_hz) : "");
  const [current, setCurrent] = useState(
    installedDrive?.motor?.rated_current_a != null ? String(installedDrive.motor.rated_current_a) : "",
  );
  const [voltage, setVoltage] = useState(
    installedDrive?.motor?.rated_voltage_v != null ? String(installedDrive.motor.rated_voltage_v) : "",
  );
  const [power, setPower] = useState(
    installedDrive?.motor?.rated_power_kw != null ? String(installedDrive.motor.rated_power_kw) : "",
  );
  const [withoutMotor, setWithoutMotor] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const profiles = usePanelQuery({
    queryKey: ["installer-profiles", context.scope],
    intervalMs: 0,
    queryFn: (signal) => authorizedRequest<Schema["ProfileRead"][]>({ path: "/api/v1/equipment/profiles", signal }),
  });
  const selectable = profiles.data?.filter((item) => item.manufacturer.trim().toUpperCase() === "SUSWE");
  const previous = selectable?.find(
    (item) => item.series === installedDrive?.series && item.manufacturer === installedDrive?.manufacturer,
  );
  const profileId = selected || (previous ? `${previous.id}:${previous.version}` : "");
  const profile = selectable?.find((item) => `${item.id}:${item.version}` === profileId);
  const supported = !!profile?.driver_id && profile.tested_model?.toLowerCase() === model.trim().toLowerCase();
  const { busy, error, run } = useAccountAction(onSaved);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || !confirmed || !profiles.active || !passport.controller_id) return;
    void run(async () => {
      await authorizedRequest({
        path: `/api/v1/connect/${passport.controller_id}/equipment`,
        method: "PUT",
        body: {
          profile_id: profile.id,
          profile_version: profile.version,
          model: model.trim(),
          serial_number: serial.trim() || null,
          hardware_revision: hardware.trim() || null,
          software_revision: software.trim() || null,
          motor: withoutMotor
            ? null
            : {
                rated_frequency_hz: Number(rated),
                rated_current_a: current ? Number(current) : null,
                rated_voltage_v: voltage ? Number(voltage) : null,
                rated_power_kw: power ? Number(power) : null,
              },
          nameplate_confirmed: true,
        },
      });
    });
  };
  return (
    <form
      className="equipment-action-form"
      onSubmit={submit}
      onChange={(event) => {
        if (!(event.target instanceof HTMLInputElement && event.target.type === "checkbox")) setConfirmed(false);
      }}
    >
      <h4>Крок 1. Паспорт частотника і двигуна</h4>
      <SelectField
        label="Серія частотника SUSWE"
        required
        value={profileId}
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="">Оберіть за шильдиком</option>
        {selectable?.map((item) => (
          <option key={`${item.id}:${item.version}`} value={`${item.id}:${item.version}`}>
            {item.series}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Повна модель частотника зі шильдика"
        required
        maxLength={120}
        value={model}
        onChange={(event) => setModel(event.target.value)}
        hint="Вкажіть модель, а не серійний номер. Драйвер перевіряється для повної моделі."
      />
      <TextField
        label="Серійний номер частотника"
        maxLength={120}
        value={serial}
        onChange={(event) => setSerial(event.target.value)}
      />
      <details className="equipment-secondary">
        <summary>Версія обладнання, якщо зазначено</summary>
        <TextField
          label="Версія обладнання частотника"
          maxLength={80}
          value={hardware}
          onChange={(event) => setHardware(event.target.value)}
        />
        <TextField
          label="Версія ПЗ частотника"
          maxLength={80}
          value={software}
          onChange={(event) => setSoftware(event.target.value)}
        />
      </details>
      <label className="ui-row">
        <input
          type="checkbox"
          checked={withoutMotor}
          onChange={(event) => {
            setWithoutMotor(event.target.checked);
            setConfirmed(false);
          }}
        />
        Стенд без підключеного двигуна
      </label>
      {!withoutMotor && (
        <TextField
          label="Номінальна частота двигуна зі шильдика, Гц"
          required
          type="number"
          min="0.01"
          max="400"
          step="0.01"
          value={rated}
          onChange={(event) => setRated(event.target.value)}
        />
      )}
      {!withoutMotor && (
        <details className="equipment-secondary">
          <summary>Інші дані двигуна зі шильдика</summary>
          <div className="equipment-form-grid">
            <TextField
              label="Номінальний струм двигуна, А"
              type="number"
              min="0.01"
              max="10000"
              step="0.01"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
            <TextField
              label="Номінальна напруга двигуна, В"
              type="number"
              min="0.01"
              max="10000"
              step="0.01"
              value={voltage}
              onChange={(event) => setVoltage(event.target.value)}
            />
            <TextField
              label="Номінальна потужність двигуна, кВт"
              type="number"
              min="0.01"
              max="10000"
              step="0.01"
              value={power}
              onChange={(event) => setPower(event.target.value)}
            />
          </div>
        </details>
      )}
      {profile && model.trim() && !supported && (
        <p className="notice notice-warning">
          Паспорт можна зберегти. Для цієї повної моделі ще немає перевіреного драйвера; керування залишиться
          недоступним.
        </p>
      )}
      {profiles.isError && (
        <p role="alert">
          Каталог не завантажено. <Button onClick={profiles.refresh}>Повторити</Button>
        </p>
      )}
      <label className="ui-row">
        <input required type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        Частотник і паспорт двигуна звірено зі шильдиками
      </label>
      {error && (
        <p role="alert" className="notice notice-warning">
          {error}
        </p>
      )}
      <div className="ui-row">
        <Button variant="primary" type="submit" disabled={busy || !confirmed || !profile || !profiles.active}>
          {busy ? "Зберігаємо…" : "Зберегти паспорт"}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Скасувати
        </Button>
      </div>
    </form>
  );
}
