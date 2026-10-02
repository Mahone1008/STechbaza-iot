"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  calendarDate,
  calendarInputError,
  clampCalendarDate,
  displayCalendarDate,
  isCalendarDate,
  MAX_CALENDAR_DATE,
  MIN_CALENDAR_DATE,
  readCalendarInput,
} from "@/lib/calendar-date";
import { Button } from "./ui";
import { DatePicker } from "./date-picker";

export function DateField({
  label,
  value,
  onValueChange,
  timezone,
  min = MIN_CALENDAR_DATE,
  max = MAX_CALENDAR_DATE,
  required = true,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  timezone: string;
  min?: string;
  max?: string;
  required?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [showError, setShowError] = useState(false);
  const [picker, setPicker] = useState<{ today: string; initialDate: string } | null>(null);
  const lower = isCalendarDate(min) ? clampCalendarDate(min, MIN_CALENDAR_DATE, MAX_CALENDAR_DATE) : MIN_CALENDAR_DATE;
  const upper = isCalendarDate(max) ? clampCalendarDate(max, lower, MAX_CALENDAR_DATE) : MAX_CALENDAR_DATE;
  const error = calendarInputError(value, lower, upper, required);
  useEffect(() => {
    input.current?.setCustomValidity(error);
  }, [error]);
  const choose = (date: string) => {
    onValueChange(date);
    setShowError(false);
    setPicker(null);
  };
  return (
    <div className="field date-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="date-input-control">
        <input
          ref={input}
          className="input"
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          required={required}
          maxLength={10}
          placeholder="ДД.ММ.РРРР"
          pattern="[0-9]{2}\.[0-9]{2}\.[0-9]{4}"
          value={displayCalendarDate(value)}
          aria-describedby={`${id}-hint${showError && error ? ` ${id}-error` : ""}`}
          aria-invalid={showError && !!error}
          onInvalid={() => setShowError(true)}
          onBlur={() => setShowError(true)}
          onChange={(event) => onValueChange(readCalendarInput(event.target.value))}
        />
        <Button
          className="date-trigger"
          aria-label={`Відкрити календар: ${label}${isCalendarDate(value) ? `, ${displayCalendarDate(value)}` : ""}`}
          aria-haspopup="dialog"
          aria-expanded={picker !== null}
          onClick={() => {
            const today = calendarDate(new Date(), timezone);
            setPicker({ today, initialDate: clampCalendarDate(isCalendarDate(value) ? value : today, lower, upper) });
          }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M7 3v4M17 3v4M3 11h18" />
          </svg>
        </Button>
      </div>
      <span className="field-hint" id={`${id}-hint`}>
        ДД.ММ.РРРР · можна ввести 8 цифр.
      </span>
      {showError && error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
      {picker && (
        <DatePicker
          label={label}
          value={value}
          today={picker.today}
          initialDate={picker.initialDate}
          min={lower}
          max={upper}
          timezone={timezone}
          onSelect={choose}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
