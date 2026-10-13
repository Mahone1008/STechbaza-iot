"use client";
import { useState, type FormEvent } from "react";
import { Button, SelectField, TextField } from "@/components/ui";
import type { components } from "@/lib/api";
import type { EquipmentPassport } from "@/lib/api/equipment";
import type { ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import { useAccountAction } from "./use-account-action";
import { InstallerWorkspace } from "./installer-workspace";

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
  const canInstall =
    process.env.NEXT_PUBLIC_PORTAL_MODE === "staff" &&
    ["superadmin", "service_admin"].includes(context.profile.platform_role) &&
    passport.can_install === true &&
    context.activeDevice?.lifecycle_status !== "retired";
  if (!canInstall) return null;
  return (
    <InstallerWorkspace context={context} passport={passport} onSaved={onSaved}>
      <EquipmentInstallationActions context={context} passport={passport} onSaved={onSaved} />
    </InstallerWorkspace>
  );
}

function EquipmentInstallationActions({
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
  const [profileId, setProfileId] = useState<string | null>(passport.desired?.manifest.profile_id ?? null);
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
  const [review, setReview] = useState<{ moduleId: string; revision: number } | null>(null);
  const { busy, error, run, fail } = useAccountAction(onSaved);
  const profiles = usePanelQuery({
    queryKey: ["equipment-profiles", context.scope],
    enabled: mode !== null,
    intervalMs: 0,
    queryFn: (signal) => authorizedRequest<Schema["ProfileRead"][]>({ path: "/api/v1/equipment/profiles", signal }),
  });
  const installedModule = passport.modules.find((item) => item.kind === "vfd" && !item.retired_at);
  if (!installedModule || context.activeDevice?.lifecycle_status === "retired") return null;
  const selectableProfiles = profiles.data?.filter((item) => item.manufacturer.toUpperCase() === "SUSWE");
  const matching = selectableProfiles?.find(
    (item) =>
      item.driver_id &&
      item.manufacturer === installedModule.manufacturer &&
      item.series === installedModule.series &&
      item.tested_model?.toLowerCase() === installedModule.model.toLowerCase(),
  );
  const selectedProfileId = mode === "configure" ? (matching?.id ?? "") : (profileId ?? "");
  const profile = selectableProfiles?.find((item) => item.id === selectedProfileId);
  const supported = profile?.driver_id && profile.tested_model?.toLowerCase() === installedModule.model.toLowerCase();
  const base = `/api/v1/devices/${passport.device_id}/equipment`;
  const fullControlAvailable = passport.firmware_control_capability === "full" && !!installedModule.motor;
  const benchControlAvailable = ["bench", "full"].includes(passport.firmware_control_capability);
  const awaitingConfirmation = !!passport.desired && passport.configuration_state !== "verified";
  const changed =
    !!review &&
    (review.moduleId !== installedModule.id || review.revision !== (passport.desired?.manifest.revision ?? 0));
  const selectMode = (next: typeof mode) => {
    if (next === "commission") {
      const previous = passport.commissioned_control_mode;
      const previousAvailable =
        previous === "read_only" ||
        (previous === "extended_test" && fullControlAvailable) ||
        (previous === "bench_without_motor" && benchControlAvailable);
      setControlMode(
        previousAvailable
          ? previous!
          : fullControlAvailable
            ? "extended_test"
            : benchControlAvailable
              ? "bench_without_motor"
              : "read_only",
      );
    }
    setMode(next);
    setConfirmed(false);
    setNotice("");
    setProfileId(next === "configure" ? (passport.desired?.manifest.profile_id ?? null) : null);
    setMinHz(String(passport.desired?.manifest.frequency_limits.min_hz ?? 0));
    setMaxHz(String(passport.desired?.manifest.frequency_limits.max_hz ?? 50));
    setRated("");
    setReview({ moduleId: installedModule.id, revision: passport.desired?.manifest.revision ?? 0 });
    fail("");
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed || !review || changed || !profiles.active) return;
    void run(async () => {
      if (mode === "replace" && profile) {
        await authorizedRequest({
          path: `${base}/replacement`,
          method: "POST",
          body: {
            expected_module_id: review.moduleId,
            expected_revision: review.revision,
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
            expected_revision: review.revision,
            module_id: review.moduleId,
            profile_id: profile.id,
            profile_version: profile.version,
            bus: { transport: "modbus_rtu", address: 1, baud: 9600, parity: "none", stop_bits: 1 },
            frequency_limits: { min_hz: Number(minHz), max_hz: Number(maxHz) },
            ...(!installedModule.motor && rated ? { motor: { rated_frequency_hz: Number(rated) } } : {}),
          },
        });
        setNotice(
          "Межі збережено. Дочекайтеся доставки до контролера, підтвердьте обладнання біля установки та оновіть паспорт.",
        );
      } else if (mode === "commission" && passport.desired) {
        await authorizedRequest({
          path: `${base}/commission`,
          method: "POST",
          body: {
            expected_revision: review.revision,
            installation_checked: true,
            control_mode: controlMode,
          },
        });
        setNotice(
          "Дозвіл збережено. Контролер отримає його автоматично. Якщо пуск було заблоковано місцево, відновіть дозвіл біля установки. Двигун запуститься лише після окремої команди користувача.",
        );
      } else return;
      setMode(null);
      setConfirmed(false);
    });
  };
  return (
    <section className="equipment-actions" aria-label="Налаштування обладнання">
      <div className="ui-row">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            awaitingConfirmation
              ? onSaved()
              : selectMode(passport.configuration_state === "verified" ? "commission" : "configure")
          }
        >
          {awaitingConfirmation
            ? "Перевірити готовність"
            : passport.configuration_state === "verified"
              ? passport.commissioned_control_mode
                ? "Змінити дозвіл використання"
                : "Дозволити використання"
              : "Налаштувати робочі межі"}
        </Button>
      </div>
      <details className="equipment-secondary">
        <summary>Обслуговування та заміна</summary>
        <p className="help-copy">Для зміни робочих меж або заміни встановленого частотника.</p>
        <div className="ui-row">
          <Button disabled={busy} onClick={() => selectMode("configure")}>
            Змінити налаштування
          </Button>
          <Button disabled={busy} onClick={() => selectMode("replace")}>
            Замінити частотник
          </Button>
        </div>
      </details>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {mode && (
        <form
          onSubmit={submit}
          className="equipment-action-form"
          onChange={(event) => {
            if (!(event.target instanceof HTMLInputElement && event.target.type === "checkbox")) setConfirmed(false);
          }}
        >
          <h4>
            {mode === "replace"
              ? "Заміна частотного перетворювача"
              : mode === "configure"
                ? "Робочі межі установки"
                : "Перевірка перед використанням"}
          </h4>
          <p className="help-copy">
            Зупиніть двигун, заблокуйте пуск на контролері (DISARM), призупиніть розклади та дочекайтеся завершення
            команд.
          </p>
          {(mode === "replace" ||
            (passport.desired && (mode === "configure" || passport.commissioned_control_mode != null))) && (
            <details className="equipment-secondary">
              <summary>Як заблокувати пуск без USB</summary>
              <ol>
                <li>Зупиніть двигун, вимкніть розклади та дочекайтеся завершення команд.</li>
                <li>Утримуйте BOOT 3 секунди, підключіть телефон до мережі контролера та відкрийте 192.168.4.1.</li>
                <li>
                  Натисніть «Завершити налаштування», не натискаючи «Дозволити керування після перевірки». Місцеве
                  блокування пуску залишиться.
                </li>
                <li>
                  Поверніться до інтернету та оновіть паспорт. Після свіжого підтвердження зупинки збережіть зміни на
                  цьому сайті.
                </li>
              </ol>
              <p className="help-copy">
                Після зміни конфігурації дочекайтеся доставки й повторно підтвердьте монтаж у кроці 3. Для відновлення
                попереднього дозволу без зміни конфігурації використайте місцеву кнопку «Дозволити керування після
                перевірки».
              </p>
            </details>
          )}
          {changed && (
            <p role="alert">Паспорт змінився. Закрийте форму й відкрийте її знову, щоб перевірити актуальні дані.</p>
          )}
          {mode === "replace" && (
            <>
              <SelectField
                label="Серія частотника SUSWE"
                required
                value={selectedProfileId}
                onChange={(event) => {
                  setProfileId(event.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="">Оберіть за шильдиком</option>
                {selectableProfiles?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.series}
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
              <details className="equipment-secondary">
                <summary>Додаткові відомості про частотник</summary>
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
              </details>
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
                . Серія {installedModule.series}; підключення визначається за збереженим паспортом.
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
              {profiles.isError && (
                <p role="alert">
                  Каталог не завантажено. <Button onClick={profiles.refresh}>Повторити</Button>
                </p>
              )}
              {profiles.data && !supported && (
                <p className="notice notice-warning">
                  Для повної моделі з паспорта немає перевіреного драйвера. Збереження конфігурації недоступне.
                </p>
              )}
              <details className="equipment-secondary">
                <summary>Як підтвердити підключення</summary>
                <p>Перевірене підключення SU600: адреса 1, 9600, 8N1.</p>
                <p>Порядок місцевого підтвердження наведено у кроці 3 вище.</p>
              </details>
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
                <option value="bench_without_motor" disabled={!benchControlAvailable}>
                  Стенд без двигуна · до 60 секунд
                </option>
                <option value="extended_test" disabled={!fullControlAvailable}>
                  Повне керування після перевірки установки
                </option>
              </SelectField>
              {!installedModule.motor && (
                <p className="notice notice-warning">
                  Для повного керування внесіть паспорт двигуна через «Змінити налаштування» і підтвердьте конфігурацію.
                </p>
              )}
              <p>
                Профіль SU600 залишається стендовим. Для випробування з двигуном перевірте його паспорт, захисти та
                незалежну зупинку за інструкцією. Режим повного керування використовує чинний дозвіл випробувань; він не
                засвідчує промислову сертифікацію установки.
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
              disabled={
                busy ||
                !profiles.active ||
                changed ||
                !confirmed ||
                (mode === "configure" && !supported) ||
                (mode === "replace" && !profile) ||
                (mode === "commission" &&
                  ((controlMode === "extended_test" && !fullControlAvailable) ||
                    (controlMode === "bench_without_motor" && !benchControlAvailable)))
              }
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
