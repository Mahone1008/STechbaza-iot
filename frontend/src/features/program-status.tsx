import { Card, StatusBadge } from "@/components/ui";
import { durationText, programActive, programStateLabels, type ProgramProgress } from "@/lib/api/programs";
import { stopReasonLabels } from "@/lib/api/diagnostics";
import { commandWorkMode, type Command } from "@/lib/api/commands";

export function ProgramStatus({ progress, command, fresh, onViewProgram }: { progress: ProgramProgress | null | undefined; command?: Command | null | undefined; fresh: boolean; onViewProgram?: (() => void) | undefined }) {
  if (!progress || progress.state === "idle") return null;
  const reason = progress.reason && Object.hasOwn(stopReasonLabels, progress.reason) ? stopReasonLabels[progress.reason as keyof typeof stopReasonLabels] : progress.reason;
  const mode = command?.id === progress.command_id ? commandWorkMode(command) : null;
  const title = mode === "timer" ? "Робота за таймером" : mode === "schedule" ? "Робота за розкладом" : mode === "program" ? "Виконання етапів" : "Виконання роботи";
  const frequency = progress.target_frequency_hz !== null ? ` · ${progress.target_frequency_hz} Гц` : "";
  return <Card title={title}>
    <StatusBadge tone={!fresh ? "warning" : progress.state === "completed" ? "success" : programActive(progress) ? "info" : "warning"}>{fresh ? programStateLabels[progress.state] : "Останній відомий стан програми"}</StatusBadge>
    <p>{mode === "timer" ? `Робота на заданій частоті${frequency}` : mode === "schedule" ? `Інтервал ${progress.step_index} з ${progress.step_count}${frequency}` : `Етап ${progress.step_index} з ${progress.step_count}${frequency}`}.</p>
    {progress.remaining_seconds !== null && <p>{mode === "timer" ? "Залишок таймера" : mode === "schedule" ? "Залишок інтервалу" : "Залишок етапу"} за повідомленням контролера: {durationText(progress.remaining_seconds)}.</p>}
    {reason && <p>Причина завершення або зупинки: {reason}.</p>}
    {progress.command_id && onViewProgram && <a className="button button-secondary" href="#selected-command" onClick={onViewProgram}>{mode === "timer" ? "Переглянути таймер" : mode === "schedule" ? "Переглянути запуск за розкладом" : "Переглянути етапи роботи"}</a>}
    {!fresh && <p className="help-copy">Дані застаріли. Поточний стан і зупинку ще потрібно підтвердити свіжою телеметрією.</p>}
  </Card>;
}
