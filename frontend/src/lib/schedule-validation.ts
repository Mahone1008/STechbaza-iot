import { scheduleDayLabels, type ScheduleSpec } from "./api/schedules";
import { MAX_SCHEDULE_SECONDS } from "./api/programs";
import { minuteOfDay, normalizeTimeInput } from "./time-input";

const pointLabel = (minutes: number) => {
  const day = Math.floor(minutes / 1440);
  const time = `${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return `${time} (${scheduleDayLabels[day]?.toLocaleLowerCase("uk-UA")})`;
};

export function normalizeScheduleTimes(spec: ScheduleSpec): ScheduleSpec {
  return {
    ...spec,
    start_time: normalizeTimeInput(spec.start_time),
    stop_time: normalizeTimeInput(spec.stop_time),
    changes: spec.changes.map((change) => ({ ...change, at: normalizeTimeInput(change.at) })),
  };
}

// Ті самі межі місцевого інтервалу, що й у серверній ScheduleSpec.coherent.
// Сервер додатково перевіряє часовий пояс, DST, перетини й права.
export function scheduleTimingErrors(spec: ScheduleSpec): { stop: string; changes: string[] } {
  const errors = { stop: "", changes: spec.changes.map(() => "") };
  const start = minuteOfDay(spec.start_time),
    stopTime = minuteOfDay(spec.stop_time);
  if (start === null || stopTime === null) return errors;
  const stop = spec.stop_day_offset * 1440 + stopTime;
  if (stop - start < 1)
    errors.stop =
      "Зупинка має бути щонайменше через 1 хв після запуску. Для роботи через північ оберіть наступний день зупинки.";
  else if (stop - start > MAX_SCHEDULE_SECONDS / 60)
    errors.stop = "Один запуск може тривати не більше 7 діб (168 годин).";
  if (errors.stop) return errors;
  let previous: number | null = start;
  spec.changes.forEach((change, index) => {
    const time = minuteOfDay(change.at);
    if (time === null) {
      previous = null;
      return;
    }
    const point = change.day_offset * 1440 + time;
    if (point >= stop)
      errors.changes[index] =
        `Зміна ${index + 1} о ${pointLabel(point)} має бути раніше зупинки о ${pointLabel(stop)}, щонайменше на 1 хв.`;
    else if (point <= start)
      errors.changes[index] = `Зміна ${index + 1} має бути щонайменше через 1 хв після запуску о ${pointLabel(start)}.`;
    else if (previous !== null && point <= previous)
      errors.changes[index] =
        `Зміна ${index + 1} має бути щонайменше через 1 хв після попередньої зміни о ${pointLabel(previous)}.`;
    previous = point;
  });
  return errors;
}
