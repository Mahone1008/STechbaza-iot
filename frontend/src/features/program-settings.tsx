"use client";
import { Button, TextField } from "@/components/ui";
import { durationText, MAX_PROGRAM_STEPS, parseProgramPlan, type ProgramPlan } from "@/lib/api/programs";

export type WorkMode = "manual" | "timer" | "program" | "schedule";
export const workModeLabels: Record<WorkMode, string> = {
  manual: "Звичайне керування",
  timer: "За таймером",
  program: "За етапами",
  schedule: "За розкладом",
};
export type ProgramDraft = { id: number; frequency: string; hours: string; minutes: string; seconds: string };
export function emptyProgramStep(id: number): ProgramDraft {
  return { id, frequency: "", hours: "0", minutes: "1", seconds: "0" };
}
export function draftPlan(mode: WorkMode, rows: ProgramDraft[]): ProgramPlan | null {
  if (mode !== "timer" && mode !== "program") return null;
  const selected = mode === "timer" ? rows.slice(0, 1) : rows;
  const steps = selected.map((row) => {
    const parts = [row.hours, row.minutes, row.seconds];
    if (
      parts.some((value) => !/^\d+$/.test(value)) ||
      Number(row.hours) > 24 ||
      Number(row.minutes) > 59 ||
      Number(row.seconds) > 59 ||
      !row.frequency.trim()
    )
      return null;
    return {
      frequency_hz: Number(row.frequency),
      duration_seconds: Number(row.hours) * 3600 + Number(row.minutes) * 60 + Number(row.seconds),
    };
  });
  return parseProgramPlan({ version: 1, steps });
}
export function ProgramPlanSummary({ plan }: { plan: ProgramPlan }) {
  return (
    <>
      <ol className="program-summary">
        {plan.steps.map((step, index) => (
          <li key={index}>
            {step.frequency_hz} Гц · {durationText(step.duration_seconds)}
          </li>
        ))}
      </ol>
      <p>
        Час на заданих частотах: {durationText(plan.steps.reduce((sum, step) => sum + step.duration_seconds, 0))}.
        Перехід до кожної частоти — додатково, до 60 с. Наприкінці — STOP.
      </p>
    </>
  );
}
export function ProgramSettings({
  mode,
  rows,
  onRows,
  onAdd,
  disabled,
  limits,
}: {
  mode: "timer" | "program";
  rows: ProgramDraft[];
  onRows: (rows: ProgramDraft[]) => void;
  onAdd: () => void;
  disabled: boolean;
  limits: { min_hz: number; max_hz: number } | null;
}) {
  const selected = mode === "timer" ? rows.slice(0, 1) : rows;
  const update = (id: number, field: keyof Omit<ProgramDraft, "id">, value: string) =>
    onRows(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  return (
    <div className="program-settings">
      <p className="help-copy">
        {mode === "timer"
          ? "Робота на одній частоті від 10 с до 24 год, потім автоматична зупинка. Відлік починається після досягнення частоти."
          : "До 8 послідовних етапів, від 10 с кожен, до 24 год сумарно. Відлік кожного етапу починається після досягнення його частоти."}
      </p>
      <div className="program-steps">
        {selected.map((row, index) => (
          <fieldset className="program-step" key={row.id} disabled={disabled}>
            <legend>{mode === "timer" ? "Робота за таймером" : `Етап ${index + 1}`}</legend>
            <TextField
              label={`Частота${mode === "program" ? ` етапу ${index + 1}` : ""}, Гц`}
              type="number"
              min={limits?.min_hz ?? 0}
              max={limits?.max_hz ?? 100}
              step="0.01"
              value={row.frequency}
              onChange={(event) => update(row.id, "frequency", event.target.value)}
            />
            <div className="program-duration">
              {(["hours", "minutes", "seconds"] as const).map((field, part) => (
                <TextField
                  key={field}
                  label={`${["Години", "Хвилини", "Секунди"][part]}${mode === "program" ? ` · етап ${index + 1}` : ""}`}
                  type="number"
                  min={0}
                  max={part === 0 ? 24 : 59}
                  step={1}
                  value={row[field]}
                  onChange={(event) => update(row.id, field, event.target.value)}
                />
              ))}
            </div>
            {mode === "program" && rows.length > 1 && (
              <Button variant="ghost" onClick={() => onRows(rows.filter((item) => item.id !== row.id))}>
                Видалити етап {index + 1}
              </Button>
            )}
          </fieldset>
        ))}
      </div>
      {mode === "program" && (
        <Button disabled={disabled || rows.length >= MAX_PROGRAM_STEPS} onClick={onAdd}>
          Додати етап
        </Button>
      )}
      <p className="help-copy">
        Робочі межі:{" "}
        {limits ? `${limits.min_hz}–${limits.max_hz} Гц; частота має бути більшою за нуль.` : "профіль ще не задано."}{" "}
        Закриття вкладки не зупиняє роботу. Втрата зв’язку або перезапуск контролера переривають її без автоматичного
        відновлення.
      </p>
    </div>
  );
}
