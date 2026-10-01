"use client";
import { TextField } from "./ui";

// Текстове поле не відкриває системний time-picker поза межами мобільного екрана.
export function TimeField({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <TextField
      label={label}
      type="text"
      inputMode="numeric"
      required
      maxLength={5}
      pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
      placeholder="ГГ:ХХ"
      title="Час від 00:00 до 23:59 у форматі ГГ:ХХ"
      autoComplete="off"
      value={value.slice(0, 5)}
      onChange={(event) => onValueChange(event.target.value.replace(/^(\d{2})(\d{2})$/, "$1:$2"))}
    />
  );
}
