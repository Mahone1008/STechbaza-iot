"use client";
import { useEffect, useId, useState, type Dispatch, type SetStateAction } from "react";
import { Button, SelectField, StatusBadge, TextField } from "@/components/ui";
import type { components } from "@/lib/api";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import {
  factoryEquipmentDraft,
  validateFactoryEquipment,
  type FactoryEquipment,
  type FactoryEquipmentDraft,
  type FactoryPreparationResult,
} from "./factory-equipment-model";

type Schema = components["schemas"];

export function FactoryEquipmentPreparation({
  initial,
  onChange,
  disabled = false,
}: {
  initial?: FactoryEquipment | null;
  onChange: Dispatch<SetStateAction<FactoryPreparationResult>>;
  disabled?: boolean;
}) {
  const id = useId();
  const { authorizedRequest, session } = useAuthSession();
  const [draft, setDraft] = useState(() => factoryEquipmentDraft(initial));
  const profiles = usePanelQuery({
    queryKey: ["factory-equipment-profiles", session.status === "authenticated" ? session.email : null],
    enabled: draft.supply === "cabinet",
    intervalMs: 0,
    queryFn: (signal) => authorizedRequest<Schema["ProfileRead"][]>({ path: "/api/v1/equipment/profiles", signal }),
  });
  const available = profiles.data?.filter((item) => item.manufacturer.toUpperCase() === "SUSWE");
  const selected = available?.find((item) =>
    draft.series ? item.series === draft.series : item.id === initial?.profile_id,
  );
  const result = validateFactoryEquipment(draft, profiles.data, initial);
  useEffect(() => {
    onChange(validateFactoryEquipment(draft, profiles.data, initial));
  }, [draft, profiles.data, initial, onChange]);
  const update = <Key extends keyof FactoryEquipmentDraft>(field: Key, value: FactoryEquipmentDraft[Key]) =>
    setDraft((current) => ({ ...current, [field]: value, reviewed: false }));
  return (
    <fieldset className="equipment-action-form" disabled={disabled}>
      <legend>Паспорт обладнання</legend>
      <SelectField
        id={`${id}-supply`}
        label="Комплект постачання"
        value={draft.supply}
        onChange={(event) => {
          const supply = event.target.value as "controller" | "cabinet";
          setDraft((current) => ({
            ...current,
            supply,
            motorAttached: initial?.motor != null || supply === "cabinet",
            reviewed: false,
          }));
        }}
      >
        <option value="controller">Тільки контролер · обладнання підготує монтажник</option>
        <option value="cabinet">Контролер із частотником · підготувати паспорт зараз</option>
      </SelectField>
      {draft.supply === "controller" ? (
        <p className="help-copy">
          Клієнт лише активує контролер. Паспорт, робочі межі та перевірку установки виконає монтажник.
        </p>
      ) : (
        <>
          <SelectField
            id={`${id}-series`}
            label="Серія частотника SUSWE"
            value={draft.series || selected?.series || ""}
            onChange={(event) => update("series", event.target.value)}
          >
            <option value="">Оберіть серію</option>
            {available?.map((profile) => (
              <option key={profile.id} value={profile.series}>
                {profile.series}
              </option>
            ))}
          </SelectField>
          <TextField
            id={`${id}-model`}
            label="Повна модель частотника зі шильдика"
            value={draft.model}
            required
            maxLength={120}
            onChange={(event) => update("model", event.target.value)}
            hint="Модель обладнання, не серійний номер. Драйвер визначається автоматично за серією та повною моделлю."
          />
          {selected?.tested_model && (
            <p className="help-copy">
              Перевірена модель цієї серії: {selected.tested_model}. Використовуйте лише фактичну модель встановленого
              обладнання.
            </p>
          )}
          <SelectField
            id={`${id}-motor`}
            label="Двигун у комплекті"
            value={draft.motorAttached ? "attached" : "none"}
            onChange={(event) => update("motorAttached", event.target.value === "attached")}
          >
            <option value="attached">Є двигун · ввести дані зі шильдика</option>
            <option value="none">Без двигуна · лише підготовка частотника</option>
          </SelectField>
          {draft.motorAttached && (
            <TextField
              id={`${id}-motor-frequency`}
              label="Номінальна частота двигуна, Гц"
              type="number"
              min="0.01"
              max="400"
              step="any"
              required
              value={draft.ratedFrequency}
              onChange={(event) => update("ratedFrequency", event.target.value)}
              hint="Зі шильдика фактично встановленого двигуна. Не підставляється автоматично."
            />
          )}
          <div className="equipment-form-grid">
            <TextField
              id={`${id}-minimum`}
              label="Мінімальна робоча частота, Гц"
              type="number"
              min="0"
              max="50"
              step="any"
              required
              value={draft.minHz}
              onChange={(event) => update("minHz", event.target.value)}
            />
            <TextField
              id={`${id}-maximum`}
              label="Максимальна робоча частота, Гц"
              type="number"
              min="0.01"
              max="50"
              step="any"
              required
              value={draft.maxHz}
              onChange={(event) => update("maxHz", event.target.value)}
            />
          </div>
          <p className="help-copy">
            Межі обирає виробник або монтажник для конкретної установки. Перевірений драйвер підтримує до 50 Гц.
          </p>
          <details>
            <summary>Додаткові дані шильдиків</summary>
            <div className="connect-fields">
              {(
                [
                  ["serial", "Серійний номер частотника", 120],
                  ["hardware", "Апаратна версія частотника", 80],
                  ["software", "Версія ПЗ частотника", 80],
                ] as const
              ).map(([field, label, maxLength]) => (
                <TextField
                  key={field}
                  id={`${id}-${field}`}
                  label={label}
                  maxLength={maxLength}
                  value={draft[field]}
                  onChange={(event) => update(field, event.target.value)}
                />
              ))}
              {draft.motorAttached &&
                (
                  [
                    ["ratedCurrent", "Номінальний струм двигуна, А"],
                    ["ratedVoltage", "Номінальна напруга двигуна, В"],
                    ["ratedPower", "Номінальна потужність двигуна, кВт"],
                  ] as const
                ).map(([field, label]) => (
                  <TextField
                    key={field}
                    id={`${id}-${field}`}
                    label={label}
                    type="number"
                    min="0.001"
                    max="10000"
                    step="any"
                    value={draft[field]}
                    onChange={(event) => update(field, event.target.value)}
                  />
                ))}
            </div>
          </details>
          <label className="ui-row">
            <input
              type="checkbox"
              checked={draft.reviewed}
              onChange={(event) => setDraft((current) => ({ ...current, reviewed: event.target.checked }))}
            />
            Паспорт звірено зі шильдиками; робочі межі обрано для цієї установки
          </label>
          {profiles.isError ? (
            <p role="alert">
              Каталог не завантажено. <Button onClick={profiles.refresh}>Повторити</Button>
            </p>
          ) : result.error ? (
            <p className="help-copy" role="status">
              {result.error}
            </p>
          ) : (
            <StatusBadge tone="info">Паспорт підготовлено; монтаж потрібно підтвердити</StatusBadge>
          )}
        </>
      )}
    </fieldset>
  );
}

export function FactoryPreparedEquipmentSummary({ equipment }: { equipment: FactoryEquipment | null | undefined }) {
  if (!equipment) return <p className="help-copy">Паспорт підготує монтажник після встановлення.</p>;
  return (
    <div className="connect-fields">
      <StatusBadge tone="info">Паспорт підготовлено; монтаж потрібно підтвердити</StatusBadge>
      <p>
        <strong>SUSWE {equipment.model}</strong> · {equipment.frequency_limits.min_hz}–
        {equipment.frequency_limits.max_hz} Гц
      </p>
      <p className="help-copy">
        {equipment.motor
          ? `Двигун: номінальна частота ${equipment.motor.rated_frequency_hz} Гц.`
          : "Двигун ще не зазначено."}{" "}
        Підготовка паспорта не запускає двигун і не підтверджує монтаж.
      </p>
    </div>
  );
}
