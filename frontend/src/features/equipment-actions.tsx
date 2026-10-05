"use client";
import { useState, type FormEvent } from "react";
import { Button, SelectField, TextField } from "@/components/ui";
import type { components } from "@/lib/api";
import type { EquipmentPassport } from "@/lib/api/equipment";
import type { ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import { useAccountAction } from "./use-account-action";

type Schema = components["schemas"];
export function EquipmentActions({
  context,
  passport,
  onSaved,
}: {
  context: ReadyAccessSnapshot;
  passport: EquipmentPassport;
  onSaved: () => void;
}) {
  const { authorizedRequest } = useAuthSession();
  const [mode, setMode] = useState<"configure" | "replace" | "commission" | null>(null);
  const [profileId, setProfileId] = useState(passport.desired?.manifest.profile_id ?? "");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [hardware, setHardware] = useState("");
  const [software, setSoftware] = useState("");
  const [rated, setRated] = useState("");
  const [minHz, setMinHz] = useState(String(passport.desired?.manifest.frequency_limits.min_hz ?? 0));
  const [maxHz, setMaxHz] = useState(String(passport.desired?.manifest.frequency_limits.max_hz ?? 50));
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [controlMode, setControlMode] = useState<Schema["CommissionRequest"]["control_mode"]>("read_only");
  const [notice, setNotice] = useState("");
  const { busy, error, run } = useAccountAction(onSaved);
  const profiles = usePanelQuery({
    queryKey: ["equipment-profiles", context.scope],
    enabled: mode !== null,
    intervalMs: 0,
    queryFn: (signal) => authorizedRequest<Schema["ProfileRead"][]>({ path: "/api/v1/equipment/profiles", signal }),
  });
  const installedModule = passport.modules.find((item) => item.kind === "vfd" && !item.retired_at);
  if (
    !context.access.permissions.includes("capability.manage") ||
    !installedModule ||
    context.activeDevice?.lifecycle_status === "retired"
  )
    return null;
  const profile = profiles.data?.find((item) => item.id === profileId);
  const supported = profile?.driver_id && profile.tested_model?.toLowerCase() === installedModule.model.toLowerCase();
  const base = `/api/v1/devices/${passport.device_id}/equipment`;
  const selectMode = (next: typeof mode) => {
    setMode(next);
    setConfirmed(false);
    setNotice("");
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed) return;
    void run(async () => {
      if (mode === "replace" && profile) {
        await authorizedRequest({
          path: `${base}/replacement`,
          method: "POST",
          body: {
            expected_module_id: installedModule.id,
            expected_revision: passport.desired?.manifest.revision ?? 0,
            stopped_and_isolated: true,
            reason,
            replacement: {
              installation_id: installedModule.installation_id,
              slot: installedModule.slot,
              kind: "vfd",
              name: installedModule.name,
              manufacturer: profile.manufacturer,
              series: profile.series,
              model,
              serial_number: serial || null,
              hardware_revision: hardware || null,
              software_revision: software || null,
              motor: { rated_frequency_hz: Number(rated) },
            },
          },
        });
        setNotice(
          "Новий частотник збережено. Старий паспорт залишився в історії. Налаштуйте й підтвердьте нове обладнання.",
        );
      } else if (mode === "configure" && profile && supported) {
        await authorizedRequest({
          path: `${base}/configurations`,
          method: "POST",
          body: {
            expected_revision: passport.desired?.manifest.revision ?? 0,
            module_id: installedModule.id,
            profile_id: profile.id,
            profile_version: profile.version,
            bus: { transport: "modbus_rtu", address: 1, baud: 9600, parity: "none", stop_bits: 1 },
            frequency_limits: { min_hz: Number(minHz), max_hz: Number(maxHz) },
            ...(!installedModule.motor && rated ? { motor: { rated_frequency_hz: Number(rated) } } : {}),
          },
        });
        setNotice(
          "Конфігурацію збережено. Контролер завантажить її протягом 30 секунд після зупинки. Підтвердьте обладнання локально та оновіть паспорт.",
        );
      } else if (mode === "commission" && passport.desired) {
        await authorizedRequest({
          path: `${base}/commission`,
          method: "POST",
          body: {
            expected_revision: passport.desired.manifest.revision,
            installation_checked: true,
            control_mode: controlMode,
          },
        });
        setNotice(
          "Налаштування завершено. Для керування потрібен окремий локальний ARM; двигун автоматично не запускається.",
        );
      } else return;
      setMode(null);
      setConfirmed(false);
    });
  };
  return (
    <section className="equipment-actions" aria-label="Налаштування обладнання">
      <h3>Налаштування та обслуговування</h3>
      <p className="help-copy">
        Зміни виконуються після STOP і DISARM. Вимкніть розклади та дочекайтеся завершення команд.
      </p>
      <div className="ui-row">
        <Button disabled={busy} onClick={() => selectMode("configure")}>
          Налаштувати підключення
        </Button>
        <Button disabled={busy || passport.configuration_state !== "verified"} onClick={() => selectMode("commission")}>
          Завершити налаштування
        </Button>
        <Button disabled={busy} onClick={() => selectMode("replace")}>
          Замінити частотник
        </Button>
      </div>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {mode && (
        <form onSubmit={submit} className="equipment-action-form">
          <h4>
            {mode === "replace"
              ? "Заміна частотного перетворювача"
              : mode === "configure"
                ? "Підключення та межі установки"
                : "Перевірка перед використанням"}
          </h4>
          {mode !== "commission" && (
            <>
              <SelectField
                label="Виробник і серія"
                required
                value={profileId}
                onChange={(event) => {
                  setProfileId(event.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="">Оберіть за шильдиком</option>
                {profiles.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.manufacturer} {item.series}
                  </option>
                ))}
              </SelectField>
              {profiles.isError && (
                <p role="alert">
                  Каталог не завантажено. <Button onClick={profiles.refresh}>Повторити</Button>
                </p>
              )}
            </>
          )}
          {mode === "replace" && (
            <>
              <p>
                Зараз:{" "}
                <strong>
                  {installedModule.manufacturer} {installedModule.model}
                </strong>
                . Історія, старі команди й налаштування залишаться пов’язаними з цим частотником.
              </p>
              <TextField
                label="Модель нового частотника зі шильдика"
                required
                maxLength={120}
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  setConfirmed(false);
                }}
              />
              <TextField
                label="Серійний номер нового частотника"
                maxLength={120}
                value={serial}
                onChange={(event) => setSerial(event.target.value)}
              />
              <div className="equipment-form-grid">
                <TextField
                  label="Версія обладнання"
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
              </div>
              <TextField
                label="Номінальна частота двигуна зі шильдика, Гц"
                type="number"
                min="0.01"
                max="400"
                step="0.01"
                required
                value={rated}
                onChange={(event) => setRated(event.target.value)}
              />
              <TextField
                label="Причина заміни"
                required
                minLength={5}
                maxLength={240}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              {profile && !profile.driver_id && (
                <p className="notice notice-warning">
                  Для цієї серії доступний паспорт. Керування потребує перевіреного драйвера.
                </p>
              )}
            </>
          )}
          {mode === "configure" && (
            <>
              <p>
                Модель:{" "}
                <strong>
                  {installedModule.manufacturer} {installedModule.model}
                </strong>
                . Перевірений транспорт SU600: адреса 1, 9600, 8N1.
              </p>
              {!installedModule.motor && (
                <TextField
                  label="Номінальна частота двигуна зі шильдика, Гц"
                  type="number"
                  min="0.01"
                  max="400"
                  step="0.01"
                  value={rated}
                  onChange={(event) => setRated(event.target.value)}
                  hint="Обов’язково перед випробуванням з двигуном. Для стенда без двигуна залиште порожнім."
                />
              )}
              <div className="equipment-form-grid">
                <TextField
                  label="Мінімальна частота, Гц"
                  required
                  type="number"
                  min="0"
                  max="49.99"
                  step="0.01"
                  value={minHz}
                  onChange={(event) => setMinHz(event.target.value)}
                />
                <TextField
                  label="Максимальна частота, Гц"
                  required
                  type="number"
                  min="0.01"
                  max="50"
                  step="0.01"
                  value={maxHz}
                  onChange={(event) => setMaxHz(event.target.value)}
                />
              </div>
              {profile && !supported && (
                <p className="notice notice-warning">
                  Обраний профіль не підтверджений для цієї повної моделі. Збереження конфігурації недоступне.
                </p>
              )}
              <p>
                Після доставки відкрийте локальне налаштування кнопкою BOOT на 3 секунди та підтвердьте обладнання. Для
                legacy-прошивки потрібен експорт manifest за інструкцією.
              </p>
            </>
          )}
          {mode === "commission" && (
            <>
              <SelectField
                label="Дозволене використання"
                value={controlMode}
                onChange={(event) => {
                  setControlMode(event.target.value as typeof controlMode);
                  setConfirmed(false);
                }}
              >
                <option value="read_only">Спостереження без керування</option>
                <option value="bench_without_motor">Стенд без двигуна · до 60 секунд</option>
                <option value="extended_test">Випробування після перевірки захистів двигуна</option>
              </SelectField>
              <p>
                Профіль SU600 залишається стендовим. Для випробування з двигуном перевірте його паспорт, захисти та
                незалежну зупинку за інструкцією.
              </p>
            </>
          )}
          <label className="ui-row">
            <input
              required
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {mode === "replace"
              ? "Двигун зупинено, установку безпечно ізольовано; новий паспорт звірено зі шильдиком"
              : "Паспорт, підключення, межі та безпечну зупинку перевірено"}
          </label>
          <div className="ui-row">
            <Button
              variant="primary"
              type="submit"
              disabled={busy || !confirmed || (mode === "configure" && !supported) || (mode === "replace" && !profile)}
            >
              {busy ? "Зберігаємо…" : mode === "replace" ? "Підтвердити заміну" : "Зберегти налаштування"}
            </Button>
            <Button disabled={busy} onClick={() => setMode(null)}>
              Скасувати
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="notice notice-warning">
          {error}
        </p>
      )}
    </section>
  );
}
