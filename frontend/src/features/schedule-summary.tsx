import { durationText } from "@/lib/api/programs";
import { formatScheduleTime, type ScheduleRun } from "@/lib/api/schedules";

export function ScheduleRunSummary({ run, timezone }: { run: ScheduleRun; timezone: string }) {
  return <><ol className="program-summary">{run.steps.map((step, index) => {
    const start = Date.parse(run.starts_at) + run.steps.slice(0, index).reduce((sum, row) => sum + row.duration_seconds * 1000, 0);
    const end = start + step.duration_seconds * 1000;
    return <li key={index}>{formatScheduleTime(new Date(start).toISOString(), timezone)} → {formatScheduleTime(new Date(end).toISOString(), timezone)} · {step.frequency_hz} Гц</li>;
  })}</ol><p>Інтервал: {durationText((Date.parse(run.stops_at) - Date.parse(run.starts_at)) / 1000)}. Наприкінці контролер починає STOP; час гальмування визначає частотник.</p></>;
}
