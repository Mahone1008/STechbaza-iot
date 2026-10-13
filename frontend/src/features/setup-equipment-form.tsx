"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, SelectField, TextField } from "@/components/ui";
import { setupSnapshotKey, type SetupEquipment, type SetupProfile, type SetupSnapshot } from "@/lib/api/setup";

const motorFields = [
  ["rated_frequency_hz", "Номінальна частота двигуна, Гц", 400],
  ["rated_current_a", "Номінальний струм двигуна, А", 10000],
  ["rated_voltage_v", "Номінальна напруга двигуна, В", 10000],
  ["rated_power_kw", "Номінальна потужність двигуна, кВт", 10000],
] as const;

export function SetupEquipmentSummary({ equipment }: { equipment: SetupEquipment }) {
  return (
    <dl className="setup-equipment-summary">
      <div>
        <dt>Частотник</dt>
        <dd>{equipment.model ?? "Потрібна модель зі шильдика"}</dd>
      </div>
      {motorFields.map(([field, label]) => (
        <div key={field}>
          <dt>{label}</dt>
          <dd>{equipment.motor?.[field] ?? "Не вказано"}</dd>
        </div>
      ))}
      <div>
        <dt>Робоча частота</dt>
        <dd>
          {equipment.frequency_limits
            ? `${equipment.frequency_limits.min_hz}–${equipment.frequency_limits.max_hz} Гц`
            : "Потрібні межі"}
        </dd>
      </div>
      {equipment.serial_number && (
        <div>
          <dt>Серійний номер частотника</dt>
          <dd>{equipment.serial_number}</dd>
        </div>
      )}
      {equipment.hardware_revision && (
        <div>
          <dt>Ревізія частотника</dt>
          <dd>{equipment.hardware_revision}</dd>
        </div>
      )}
      {equipment.software_revision && (
        <div>
          <dt>Версія ПЗ частотника</dt>
          <dd>{equipment.software_revision}</dd>
        </div>
      )}
    </dl>
  );
}

export function SetupEquipmentForm({
  snapshot,
  profiles,
  busy,
  available,
  onSave,
  onReload,
  onDirty,
  submitLabel = "Зберегти дані",
}: {
  snapshot: SetupSnapshot;
  profiles: SetupProfile[];
  busy: boolean;
  available: boolean;
  onSave: (equipment: SetupEquipment, original: SetupSnapshot) => void;
  onReload: () => void;
  onDirty?: () => void;
  submitLabel?: string;
}) {
  // Фонове оновлення не переносить відкриту форму на іншу версію установки.
  const [original] = useState(snapshot);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(original.equipment.profile_id ?? "");
  const id = useId();
  const equipment = original.equipment;
  const stale = setupSnapshotKey(original) !== setupSnapshotKey(snapshot);
  const missing = new Set(original.missing_fields);
  const profile = profiles.find((item) => item.id === selected);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !available || stale) return;
    setError("");
    const values = new FormData(event.currentTarget);
    const string = (key: string, fallback: string | null) =>
      values.has(key) ? String(values.get(key)).trim() || null : fallback;
    const numeric = (key: string, fallback: number | null): number | null => {
      if (!values.has(key)) return fallback;
      const raw = String(values.get(key)).trim();
      return raw ? Number(raw) : null;
    };
    const chosen = profiles.find((item) => item.id === string("profile_id", equipment.profile_id));
    const motor = Object.fromEntries(
      motorFields.map(([field]) => [field, numeric(field, equipment.motor?.[field] ?? null)]),
    ) as NonNullable<SetupEquipment["motor"]>;
    const min = numeric("min_hz", equipment.frequency_limits?.min_hz ?? null);
    const max = numeric("max_hz", equipment.frequency_limits?.max_hz ?? null);
    if (
      (min === null) !== (max === null) ||
      (min !== null &&
        max !== null &&
        (min >= max || (motor.rated_frequency_hz !== null && max > motor.rated_frequency_hz)))
    ) {
      setError(
        "Вкажіть обидві робочі межі. Максимум має бути більшим за мінімум і не перевищувати номінальну частоту двигуна.",
      );
      return;
    }
    onSave(
      {
        profile_id: chosen?.id ?? null,
        profile_version: chosen?.version ?? equipment.profile_version,
        model: string("model", equipment.model),
        serial_number: string("serial_number", equipment.serial_number),
        hardware_revision: string("hardware_revision", equipment.hardware_revision),
        software_revision: string("software_revision", equipment.software_revision),
        motor: Object.values(motor).some((value) => value !== null) ? motor : null,
        frequency_limits: min !== null && max !== null ? { min_hz: min, max_hz: max } : null,
      },
      original,
    );
  };
  const fields = [
    {
      key: "profile_id",
      missing: missing.has("profile_id") || !equipment.profile_id,
      element: (
        <SelectField
          id={`${id}-profile`}
          name="profile_id"
          label="Серія частотника SUSWE"
          defaultValue={equipment.profile_id ?? ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Оберіть серію зі шильдика</option>
          {profiles
            .filter((item) => item.manufacturer.toUpperCase() === "SUSWE")
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.series}
                {item.support === "documented" ? " · керування ще не підтримується" : ""}
              </option>
            ))}
        </SelectField>
      ),
    },
    {
      key: "model",
      missing: missing.has("model") || !equipment.model,
      element: (
        <TextField
          id={`${id}-model`}
          name="model"
          label="Повна модель частотника зі шильдика"
          maxLength={120}
          defaultValue={equipment.model ?? ""}
          hint="Перепишіть модель із самого частотника. Контролер не визначає її автоматично."
        />
      ),
    },
    ...motorFields.map(([field, label, maximum]) => ({
      key: field,
      missing: missing.has(`motor.${field}`) || equipment.motor?.[field] == null,
      element: (
        <TextField
          id={`${id}-${field}`}
          name={field}
          label={label}
          type="number"
          min="0.01"
          max={maximum}
          step="any"
          defaultValue={equipment.motor?.[field] ?? ""}
        />
      ),
    })),
    {
      key: "limits",
      missing: missing.has("frequency_limits") || !equipment.frequency_limits,
      element: (
        <div className="equipment-form-grid">
          <TextField
            id={`${id}-min`}
            name="min_hz"
            label="Мінімальна робоча частота, Гц"
            type="number"
            min="0"
            max="50"
            step="0.01"
            defaultValue={equipment.frequency_limits?.min_hz ?? ""}
          />
          <TextField
            id={`${id}-max`}
            name="max_hz"
            label="Максимальна робоча частота, Гц"
            type="number"
            min="0.01"
            max="50"
            step="0.01"
            defaultValue={equipment.frequency_limits?.max_hz ?? ""}
          />
        </div>
      ),
    },
  ];
  return (
    <form className="connect-fields" onSubmit={submit} onChange={onDirty}>
      {stale && (
        <div className="notice notice-warning" role="alert">
          <p>Дані установки змінилися. Цю чернетку не можна зберегти поверх нових даних.</p>
          <Button onClick={onReload}>Завантажити актуальні дані</Button>
        </div>
      )}
      <fieldset disabled={busy || !available || stale} className="setup-fields">
        <legend>Дані з обладнання</legend>
        <p className="help-copy">
          Заповніть відсутні дані з табличок частотника й двигуна. Робочі межі беріть із вимог вашої установки.
        </p>
        {fields
          .filter((field) => field.missing)
          .map((field) => (
            <div key={field.key}>{field.element}</div>
          ))}
        {profile && (
          <p className="help-copy">
            {profile.tested_model
              ? `Перевірена модель: ${profile.tested_model}. Звірте повне позначення на обладнанні.`
              : "Для цієї серії можна підготувати дані. Керування стане доступним після підтримки й перевірки саме вашої моделі."}
          </p>
        )}
        <details open={fields.every((field) => !field.missing)}>
          <summary>Перевірити або виправити решту даних</summary>
          <div className="connect-fields">
            {fields
              .filter((field) => !field.missing)
              .map((field) => (
                <div key={field.key}>{field.element}</div>
              ))}
            <TextField
              id={`${id}-serial`}
              name="serial_number"
              label="Серійний номер частотника"
              maxLength={120}
              defaultValue={equipment.serial_number ?? ""}
            />
            <TextField
              id={`${id}-hardware`}
              name="hardware_revision"
              label="Ревізія частотника"
              maxLength={80}
              defaultValue={equipment.hardware_revision ?? ""}
            />
            <TextField
              id={`${id}-software`}
              name="software_revision"
              label="Версія ПЗ частотника"
              maxLength={80}
              defaultValue={equipment.software_revision ?? ""}
              hint="Якщо відома. Це версія частотника, а не контролера KERUMO."
            />
          </div>
        </details>
        {error && <p role="alert">{error}</p>}
        <Button variant="primary" type="submit">
          {busy ? "Зберігаємо…" : submitLabel}
        </Button>
      </fieldset>
    </form>
  );
}
