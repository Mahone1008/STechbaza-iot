import { Card, StatusBadge } from "@/components/ui";
import { durationText, programActive, programStateLabels, type ProgramProgress } from "@/lib/api/programs";
import { stopReasonLabels } from "@/lib/api/diagnostics";

export function ProgramStatus({ progress, fresh }: { progress: ProgramProgress | null | undefined; fresh: boolean }) {
  if (!progress || progress.state === "idle") return null;
  const reason = progress.reason && Object.hasOwn(stopReasonLabels, progress.reason) ? stopReasonLabels[progress.reason as keyof typeof stopReasonLabels] : progress.reason;
  return <Card title="Виконання програми">
    <StatusBadge tone={!fresh ? "warning" : progress.state === "completed" ? "success" : programActive(progress) ? "info" : "warning"}>{fresh ? programStateLabels[progress.state] : "Останній відомий стан програми"}</StatusBadge>
    <p>Етап {progress.step_index} з {progress.step_count}{progress.target_frequency_hz !== null ? ` · ${progress.target_frequency_hz} Гц` : ""}.</p>
    {progress.remaining_seconds !== null && <p>Залишок етапу за повідомленням контролера: {durationText(progress.remaining_seconds)}.</p>}
    {reason && <p>Причина завершення або зупинки: {reason}.</p>}
    {!fresh && <p className="help-copy">Дані застаріли. Поточний стан і зупинку ще потрібно підтвердити свіжою телеметрією.</p>}
  </Card>;
}
