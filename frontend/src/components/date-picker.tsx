"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { calendarMonthRows, clampCalendarDate, shiftCalendarDays, shiftCalendarMonths } from "@/lib/calendar-date";
import { Button, SelectField } from "./ui";
import { ModalDialog } from "./modal-dialog";

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
const weekdays = ["Понеділок", "Вівторок", "Середа", "Четвер", "П’ятниця", "Субота", "Неділя"];
const weekdayShort = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const dateLabel = new Intl.DateTimeFormat("uk-UA", { timeZone: "UTC", dateStyle: "full" });

export function DatePicker({
  label,
  value,
  today,
  initialDate,
  min,
  max,
  timezone,
  onSelect,
  onClose,
}: {
  label: string;
  value: string;
  today: string;
  initialDate: string;
  min: string;
  max: string;
  timezone: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const [focusedDate, setFocusedDate] = useState(initialDate);
  const focusedButton = useRef<HTMLButtonElement>(null);
  const focusPending = useRef(false);
  const monthId = useId();
  const year = Number(focusedDate.slice(0, 4)),
    month = Number(focusedDate.slice(5, 7));
  const minYear = Number(min.slice(0, 4)),
    maxYear = Number(max.slice(0, 4));
  const monthKey = focusedDate.slice(0, 7);
  const rows = calendarMonthRows(focusedDate);
  const move = (date: string, focus = false) => {
    const next = clampCalendarDate(date, min, max);
    if (next === focusedDate) return;
    focusPending.current = focus;
    setFocusedDate(next);
  };
  useEffect(() => {
    if (focusPending.current) focusedButton.current?.focus();
    focusPending.current = false;
  }, [focusedDate]);
  function navigate(event: KeyboardEvent<HTMLTableElement>) {
    const weekday = (new Date(`${focusedDate}T12:00:00Z`).getUTCDay() + 6) % 7;
    const days: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -weekday,
      End: 6 - weekday,
    };
    if (Object.hasOwn(days, event.key)) {
      event.preventDefault();
      move(shiftCalendarDays(focusedDate, days[event.key]!), true);
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      move(shiftCalendarMonths(focusedDate, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1)), true);
    }
  }
  return (
    <ModalDialog
      open
      title={label}
      description={`Оберіть день у календарі. Час об’єкта: ${timezone}.`}
      className="date-dialog"
      initialFocus={focusedButton}
      onClose={onClose}
      actions={
        <>
          <Button disabled={today < min || today > max} onClick={() => onSelect(today)}>
            Сьогодні
          </Button>
          <Button onClick={onClose}>Скасувати</Button>
        </>
      }
    >
      <div className="calendar-navigation">
        <Button
          aria-label="Попередній місяць"
          disabled={monthKey <= min.slice(0, 7)}
          onClick={() => move(shiftCalendarMonths(focusedDate, -1))}
        >
          ‹
        </Button>
        <h3 id={monthId} aria-live="polite" aria-atomic="true">
          {months[month - 1]} {year}
        </h3>
        <Button
          aria-label="Наступний місяць"
          disabled={monthKey >= max.slice(0, 7)}
          onClick={() => move(shiftCalendarMonths(focusedDate, 1))}
        >
          ›
        </Button>
      </div>
      <div className="calendar-month-selectors">
        <SelectField
          id={`${monthId}-month`}
          label="Місяць"
          value={month}
          onChange={(event) => move(shiftCalendarMonths(focusedDate, Number(event.target.value) - month))}
        >
          {months.map((name, index) => {
            const key = `${year}-${String(index + 1).padStart(2, "0")}`;
            return (
              <option key={name} value={index + 1} disabled={key < min.slice(0, 7) || key > max.slice(0, 7)}>
                {name}
              </option>
            );
          })}
        </SelectField>
        <SelectField
          id={`${monthId}-year`}
          label="Рік"
          value={year}
          onChange={(event) => move(shiftCalendarMonths(focusedDate, (Number(event.target.value) - year) * 12))}
        >
          {Array.from({ length: maxYear - minYear + 1 }, (_, index) => (
            <option key={index} value={minYear + index}>
              {minYear + index}
            </option>
          ))}
        </SelectField>
      </div>
      <table className="calendar-grid" role="grid" aria-labelledby={monthId} onKeyDown={navigate}>
        <thead>
          <tr>
            {weekdays.map((name, index) => (
              <th key={name} scope="col" abbr={name}>
                {weekdayShort[index]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => (
                <td key={day} aria-selected={day === value}>
                  <button
                    type="button"
                    className="calendar-day"
                    disabled={day < min || day > max}
                    aria-label={dateLabel.format(new Date(`${day}T12:00:00Z`))}
                    aria-current={day === today ? "date" : undefined}
                    data-outside={day.slice(0, 7) !== monthKey || undefined}
                    tabIndex={day === focusedDate ? 0 : -1}
                    ref={day === focusedDate ? focusedButton : undefined}
                    onClick={() => onSelect(day)}
                  >
                    {Number(day.slice(8))}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="help-copy calendar-keyboard-help">
        Оберіть дату. Стрілки змінюють день, Page Up/Down змінюють місяць, Escape закриває календар.
      </p>
    </ModalDialog>
  );
}
