"use client";
import { Button, SelectField, TextField } from "@/components/ui";
import { durationText, MAX_PROGRAM_STEPS, parseProgramPlan, type ProgramPlan } from "@/lib/api/programs";

export type WorkMode = "manual" | "timer" | "program" | "schedule";
export type ProgramDraft = { id: number; frequency: string; hours: string; minutes: string; seconds: string };
export function emptyProgramStep(id: number): ProgramDraft { return { id, frequency: "", hours: "0", minutes: "1", seconds: "0" }; }
export function draftPlan(mode: WorkMode, rows: ProgramDraft[]): ProgramPlan | null {
  const selected = mode === "timer" ? rows.slice(0, 1) : rows;
  const steps = selected.map((row) => {
    const parts = [row.hours, row.minutes, row.seconds];
    if (parts.some((value) => !/^\d+$/.test(value)) || Number(row.hours) > 24 || Number(row.minutes) > 59 || Number(row.seconds) > 59 || !row.frequency.trim()) return null;
    return { frequency_hz: Number(row.frequency), duration_seconds: Number(row.hours) * 3600 + Number(row.minutes) * 60 + Number(row.seconds) };
  });
  return parseProgramPlan({ version: 1, steps });
}
export function ProgramPlanSummary({ plan }: { plan: ProgramPlan }) {
  return <><ol className="program-summary">{plan.steps.map((step, index) => <li key={index}>{step.frequency_hz} Гц · {durationText(step.duration_seconds)}</li>)}</ol>
    <p>Час на заданих частотах: {durationText(plan.steps.reduce((sum, step) => sum + step.duration_seconds, 0))}. Перехід до кожної частоти — додатково, до 60 с. Наприкінці — STOP.</p></>;
}
export function ProgramSettings({ mode, onMode, rows, onRows, onAdd, disabled, supported, limits, scheduleSupported = false }: {
  mode: WorkMode; onMode: (mode: WorkMode) => void; rows: ProgramDraft[]; onRows: (rows: ProgramDraft[]) => void;
  onAdd: () => void; disabled: boolean; supported: boolean; scheduleSupported?: boolean; limits: { min_hz: number; max_hz: number } | null;
}) {
  const selected = mode === "timer" ? rows.slice(0, 1) : rows;
  const update = (id: number, field: keyof Omit<ProgramDraft, "id">, value: string) => onRows(rows.map((row) => row.id === id ? { ...row, [field]: value } : row));
  return <div className="program-settings">
    <SelectField label="Режим роботи" value={mode} disabled={disabled} onChange={(event) => onMode(event.target.value as WorkMode)}>
      <option value="manual">Звичайне керування</option><option value="timer" disabled={!supported}>За таймером</option><option value="program" disabled={!supported}>За етапами</option><option value="schedule" disabled={!scheduleSupported}>За розкладом</option>
    </SelectField>
    {!supported && <p className="help-copy">Таймер і програма потребують увімкненої можливості програм та сумісної прошивки контролера.</p>}
    {(mode === "timer" || mode === "program") && <>
      <p className="help-copy">До 8 етапів, від 10 с кожен, до 24 год сумарно. Час етапу починається після досягнення частоти. Закриття вкладки не скасовує програму.</p>
      <div className="program-steps">{selected.map((row, index) => <fieldset className="program-step" key={row.id} disabled={disabled}>
        <legend>{mode === "timer" ? "Робота за таймером" : `Етап ${index + 1}`}</legend>
        <TextField label={`Частота${mode === "program" ? ` етапу ${index + 1}` : ""}, Гц`} type="number" min={limits?.min_hz ?? 0} max={limits?.max_hz ?? 100} step="0.01" value={row.frequency} onChange={(event) => update(row.id, "frequency", event.target.value)} />
        <div className="program-duration">
          {(["hours", "minutes", "seconds"] as const).map((field, part) => <TextField key={field} label={`${["Години", "Хвилини", "Секунди"][part]}${mode === "program" ? ` · етап ${index + 1}` : ""}`} type="number" min={0} max={part === 0 ? 24 : 59} step={1} value={row[field]} onChange={(event) => update(row.id, field, event.target.value)} />)}
        </div>
        {mode === "program" && rows.length > 1 && <Button variant="ghost" onClick={() => onRows(rows.filter((item) => item.id !== row.id))}>Видалити етап {index + 1}</Button>}
      </fieldset>)}</div>
      {mode === "program" && <Button disabled={disabled || rows.length >= MAX_PROGRAM_STEPS} onClick={onAdd}>Додати етап</Button>}
      <p className="help-copy">Робочі межі: {limits ? `${limits.min_hz}–${limits.max_hz} Гц; для програми частота має бути більшою за нуль.` : "профіль ще не задано."} Втрата зв’язку або перезапуск переривають програму без автоматичного відновлення.</p>
    </>}
  </div>;
}
