"use client";
import { Button, SelectField, TextField } from "@/components/ui";
import { repeatLabels, type ScheduleSpec } from "@/lib/api/schedules";

const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const months = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
];
const toggle = (values: number[], value: number) =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value].sort((a, b) => a - b);

export function ScheduleForm({
  value,
  onChange,
  disabled,
  limits,
}: {
  value: ScheduleSpec;
  onChange: (value: ScheduleSpec) => void;
  disabled: boolean;
  limits: { min_hz: number; max_hz: number } | null;
}) {
  const change = <K extends keyof ScheduleSpec>(key: K, item: ScheduleSpec[K]) => onChange({ ...value, [key]: item });
  return (
    <fieldset className="schedule-form" disabled={disabled}>
      <legend>Налаштування розкладу</legend>
      <TextField
        label="Назва розкладу"
        required
        maxLength={100}
        value={value.name}
        onChange={(event) => change("name", event.target.value)}
      />
      <div className="schedule-grid">
        <fieldset className="schedule-window">
          <legend>Запуск</legend>
          <TextField
            label="Дата початку"
            required
            type="date"
            min="2000-01-01"
            max="2199-12-31"
            value={value.start_date}
            onChange={(event) =>
              onChange({
                ...value,
                start_date: event.target.value,
                until_date: value.repeat === "once" ? event.target.value : value.until_date,
              })
            }
          />
          <TextField
            label="Час запуску"
            required
            type="time"
            step={60}
            value={value.start_time}
            onChange={(event) => change("start_time", event.target.value)}
          />
        </fieldset>
        <fieldset className="schedule-window">
          <legend>Зупинка</legend>
          <SelectField
            label="День зупинки"
            value={value.stop_day_offset}
            onChange={(event) => change("stop_day_offset", Number(event.target.value))}
          >
            <option value={0}>Того самого дня</option>
            <option value={1}>Наступного дня</option>
          </SelectField>
          <TextField
            label="Час зупинки"
            required
            type="time"
            step={60}
            value={value.stop_time}
            onChange={(event) => change("stop_time", event.target.value)}
          />
        </fieldset>
      </div>
      <TextField
        label="Частота за розкладом, Гц"
        required
        type="number"
        min={Math.max(0.01, limits?.min_hz ?? 0.01)}
        max={limits?.max_hz ?? 100}
        step="0.01"
        value={value.frequency_hz || ""}
        onChange={(event) => change("frequency_hz", Number(event.target.value))}
        hint={
          limits
            ? `Робочі межі: ${limits.min_hz}–${limits.max_hz} Гц. Тривалість одного запуску — від 1 хв до 24 год.`
            : "Спочатку налаштуйте допустимі межі частоти обладнання."
        }
      />
      <details>
        <summary>Повторення та сезон</summary>
        <div className="schedule-grid">
          <SelectField
            label="Повторення"
            value={value.repeat}
            onChange={(event) =>
              onChange({
                ...value,
                repeat: event.target.value as ScheduleSpec["repeat"],
                until_date: event.target.value === "once" ? value.start_date : value.until_date,
                months:
                  event.target.value === "once" ? Array.from({ length: 12 }, (_, index) => index + 1) : value.months,
              })
            }
          >
            {Object.entries(repeatLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </SelectField>
          {value.repeat !== "once" && (
            <TextField
              label="Діє до дати включно"
              type="date"
              min={value.start_date}
              max="2199-12-31"
              value={value.until_date}
              onChange={(event) => change("until_date", event.target.value)}
            />
          )}
          {value.repeat === "interval" && (
            <TextField
              label="Інтервал, днів"
              type="number"
              min={1}
              max={366}
              value={value.interval_days}
              onChange={(event) => change("interval_days", Number(event.target.value))}
            />
          )}
          {value.repeat === "monthly" && (
            <SelectField
              label="День місяця"
              value={value.month_day}
              onChange={(event) => change("month_day", Number(event.target.value))}
            >
              <option value={-1}>Останній день місяця</option>
              {Array.from({ length: 31 }, (_, index) => (
                <option key={index} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </SelectField>
          )}
        </div>
        {value.repeat === "weekly" && (
          <fieldset className="schedule-options">
            <legend>Дні тижня</legend>
            {weekdays.map((label, day) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={value.weekdays.includes(day)}
                  onChange={() => change("weekdays", toggle(value.weekdays, day))}
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        {value.repeat === "yearly" && <p>Щороку в день і місяць дати початку. 29 лютого — лише у високосні роки.</p>}
        {value.repeat === "monthly" && <p>Якщо обраного числа немає в місяці, запуск пропускається.</p>}
        {value.repeat !== "once" && (
          <fieldset className="schedule-options">
            <legend>Місяці роботи</legend>
            {months.map((label, index) => (
              <label key={label}>
                <input
                  type="checkbox"
                  checked={value.months.includes(index + 1)}
                  onChange={() => change("months", toggle(value.months, index + 1))}
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}
      </details>
      <details>
        <summary>Зміна частоти протягом роботи</summary>
        <p className="help-copy">
          До 7 змін за місцевим часом, між початком і зупинкою. Переходи не пересувають час завершення.
        </p>
        {value.changes.map((item, index) => (
          <fieldset className="program-step" key={index}>
            <legend>Зміна {index + 1}</legend>
            <div className="schedule-grid">
              <TextField
                label={`Час зміни ${index + 1}`}
                type="time"
                step={60}
                value={item.at}
                onChange={(event) =>
                  change(
                    "changes",
                    value.changes.map((row, i) => (i === index ? { ...row, at: event.target.value } : row)),
                  )
                }
              />
              <SelectField
                label={`День зміни ${index + 1}`}
                value={item.day_offset}
                onChange={(event) =>
                  change(
                    "changes",
                    value.changes.map((row, i) =>
                      i === index ? { ...row, day_offset: Number(event.target.value) } : row,
                    ),
                  )
                }
              >
                <option value={0}>День запуску</option>
                <option value={1}>Наступний день</option>
              </SelectField>
              <TextField
                label={`Нова частота ${index + 1}, Гц`}
                type="number"
                min={Math.max(0.01, limits?.min_hz ?? 0.01)}
                max={limits?.max_hz ?? 100}
                step="0.01"
                value={item.frequency_hz || ""}
                onChange={(event) =>
                  change(
                    "changes",
                    value.changes.map((row, i) =>
                      i === index ? { ...row, frequency_hz: Number(event.target.value) } : row,
                    ),
                  )
                }
              />
            </div>
            <Button
              variant="ghost"
              onClick={() =>
                change(
                  "changes",
                  value.changes.filter((_, i) => i !== index),
                )
              }
            >
              Видалити зміну {index + 1}
            </Button>
          </fieldset>
        ))}
        <Button
          disabled={disabled || value.changes.length >= 7}
          onClick={() =>
            change("changes", [...value.changes, { at: "", day_offset: 0, frequency_hz: value.frequency_hz }])
          }
        >
          Додати зміну частоти
        </Button>
      </details>
      <details>
        <summary>Дати без запуску</summary>
        <p className="help-copy">Виняток стосується дати початку запуску, зокрема під час роботи через північ.</p>
        {value.excluded_dates.map((day, index) => (
          <div className="ui-row" key={index}>
            <TextField
              label={`Пропустити дату ${index + 1}`}
              type="date"
              value={day}
              onChange={(event) =>
                change(
                  "excluded_dates",
                  value.excluded_dates.map((item, i) => (i === index ? event.target.value : item)),
                )
              }
            />
            <Button
              variant="ghost"
              onClick={() =>
                change(
                  "excluded_dates",
                  value.excluded_dates.filter((_, i) => i !== index),
                )
              }
            >
              Прибрати виняток {index + 1}
            </Button>
          </div>
        ))}
        <Button
          disabled={disabled || value.excluded_dates.length >= 100}
          onClick={() => change("excluded_dates", [...value.excluded_dates, value.start_date])}
        >
          Додати дату без запуску
        </Button>
      </details>
    </fieldset>
  );
}
