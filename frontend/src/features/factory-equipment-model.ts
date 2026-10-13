import type { components } from "@/lib/api";

type Schema = components["schemas"];
export type FactoryEquipment = Schema["FactoryEquipmentSetup"];
export type FactoryEquipmentDraft = {
  supply: "controller" | "cabinet";
  series: string;
  model: string;
  serial: string;
  hardware: string;
  software: string;
  motorAttached: boolean;
  ratedFrequency: string;
  ratedCurrent: string;
  ratedVoltage: string;
  ratedPower: string;
  minHz: string;
  maxHz: string;
  reviewed: boolean;
};
export type FactoryPreparationResult = { equipment: FactoryEquipment | null; valid: boolean; error: string | null };

export function factoryEquipmentDraft(equipment?: FactoryEquipment | null): FactoryEquipmentDraft {
  return {
    supply: equipment ? "cabinet" : "controller",
    series: "",
    model: equipment?.model ?? "",
    serial: equipment?.serial_number ?? "",
    hardware: equipment?.hardware_revision ?? "",
    software: equipment?.software_revision ?? "",
    motorAttached: equipment?.motor != null,
    ratedFrequency: equipment?.motor ? String(equipment.motor.rated_frequency_hz) : "",
    ratedCurrent: equipment?.motor?.rated_current_a != null ? String(equipment.motor.rated_current_a) : "",
    ratedVoltage: equipment?.motor?.rated_voltage_v != null ? String(equipment.motor.rated_voltage_v) : "",
    ratedPower: equipment?.motor?.rated_power_kw != null ? String(equipment.motor.rated_power_kw) : "",
    minHz: equipment ? String(equipment.frequency_limits.min_hz) : "",
    maxHz: equipment ? String(equipment.frequency_limits.max_hz) : "",
    reviewed: false,
  };
}

function numeric(value: string, minimum: number, maximum: number, inclusive = false): number | null {
  if (!value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) && (inclusive ? result >= minimum : result > minimum) && result <= maximum
    ? result
    : null;
}

export function validateFactoryEquipment(
  draft: FactoryEquipmentDraft,
  profiles: readonly Schema["ProfileRead"][] | undefined,
  initial?: FactoryEquipment | null,
): FactoryPreparationResult {
  if (draft.supply === "controller") return { equipment: null, valid: true, error: null };
  const reject = (error: string): FactoryPreparationResult => ({ equipment: null, valid: false, error });
  if (!profiles) return reject("Завантажуємо каталог обладнання…");
  const profile = profiles.find(
    (item) =>
      item.manufacturer.toUpperCase() === "SUSWE" &&
      (draft.series ? item.series === draft.series : item.id === initial?.profile_id),
  );
  if (!profile || !draft.model.trim()) return reject("Оберіть серію та введіть повну модель зі шильдика.");
  if (!profile.driver_id || profile.tested_model?.toLowerCase() !== draft.model.trim().toLowerCase()) {
    return reject("Для цієї повної моделі ще немає перевіреного драйвера. Підготовка керування недоступна.");
  }
  const min = numeric(draft.minHz, 0, 50, true),
    max = numeric(draft.maxHz, 0, 50);
  if (min == null || max == null || min >= max)
    return reject("Вкажіть робочі межі: мінімум від 0 Гц, максимум до 50 Гц і більший за мінімум.");
  if ([min, max].some((value) => Math.abs(value * 100 - Math.round(value * 100)) > 1e-8))
    return reject("Робочі межі частоти можуть мати до двох знаків після коми.");
  let motor: Schema["MotorNameplate"] | null = null;
  if (draft.motorAttached) {
    const frequency = numeric(draft.ratedFrequency, 0, 400);
    if (frequency == null) return reject("Вкажіть номінальну частоту зі шильдика двигуна.");
    if (max > frequency) return reject("Максимальна робоча частота не може перевищувати номінальну частоту двигуна.");
    const current = draft.ratedCurrent.trim() ? numeric(draft.ratedCurrent, 0, 10000) : null;
    const voltage = draft.ratedVoltage.trim() ? numeric(draft.ratedVoltage, 0, 10000) : null;
    const power = draft.ratedPower.trim() ? numeric(draft.ratedPower, 0, 10000) : null;
    if (
      (draft.ratedCurrent.trim() && current == null) ||
      (draft.ratedVoltage.trim() && voltage == null) ||
      (draft.ratedPower.trim() && power == null)
    ) {
      return reject("Дані двигуна мають бути додатними числами зі шильдика.");
    }
    motor = {
      rated_frequency_hz: frequency,
      rated_current_a: current,
      rated_voltage_v: voltage,
      rated_power_kw: power,
    };
  }
  if (!draft.reviewed) return reject("Звірте паспорт і робочі межі перед збереженням.");
  return {
    valid: true,
    error: null,
    equipment: {
      profile_id: profile.id,
      profile_version: profile.version,
      model: draft.model.trim(),
      serial_number: draft.serial.trim() || null,
      hardware_revision: draft.hardware.trim() || null,
      software_revision: draft.software.trim() || null,
      motor,
      frequency_limits: { min_hz: min, max_hz: max },
    },
  };
}
