"use client";
import { TextField } from "./ui";
import { normalizeTimeInput, timeInputError } from "@/lib/time-input";

// Текстове поле не відкриває системний time-picker поза межами мобільного екрана.
export function TimeField({
  label,
  value,
  onValueChange,
  validationMessage = "",
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  validationMessage?: string | undefined;
}) {
  return (
    <TextField
      label={label}
      type="text"
      inputMode="numeric"
      required
      maxLength={5}
      pattern="(?:[0-9]{3,4}|[0-9]{1,2}:[0-9]{2})"
      placeholder="ГГ:ХХ"
      validationMessage={timeInputError(value) || validationMessage}
      autoComplete="off"
      value={value.slice(0, 5)}
      onChange={(event) => onValueChange(normalizeTimeInput(event.target.value, false))}
      onBlur={(event) => {
        const normalized = normalizeTimeInput(event.target.value);
        if (normalized !== event.target.value) onValueChange(normalized);
      }}
    />
  );
}
