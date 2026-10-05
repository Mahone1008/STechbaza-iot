"use client";
import { useId, type InputHTMLAttributes } from "react";
import { useInputValidation } from "./use-input-validation";

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  validationMessage?: string;
};

export function TextField({
  label,
  hint,
  error,
  validationMessage,
  id,
  className = "",
  onChange,
  onBlur,
  onInvalid,
  ...props
}: TextFieldProps) {
  const uniqueId = useId();
  const fieldId = id ?? uniqueId;
  const {
    inputRef,
    error: validationError,
    onInvalid: handleInvalid,
    onBlur: handleBlur,
    onChange: handleChange,
  } = useInputValidation(validationMessage);
  const visibleError = error || validationError;
  const descriptionId =
    [visibleError && `${fieldId}-error`, hint && `${fieldId}-hint`, props["aria-describedby"]]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <label className="field" htmlFor={fieldId}>
      <span className="field-label" id={`${fieldId}-label`}>
        {label}
      </span>
      <input
        {...props}
        ref={inputRef}
        className={`input ${className}`}
        id={fieldId}
        aria-labelledby={`${fieldId}-label`}
        aria-invalid={Boolean(visibleError)}
        aria-describedby={descriptionId}
        onInvalid={(event) => {
          handleInvalid(event);
          onInvalid?.(event);
        }}
        onBlur={(event) => {
          handleBlur(event.currentTarget, event.relatedTarget);
          onBlur?.(event);
        }}
        onChange={(event) => {
          handleChange();
          onChange?.(event);
        }}
      />
      {visibleError ? (
        <span className="field-error" id={`${fieldId}-error`}>
          {visibleError}
        </span>
      ) : null}
      {hint ? (
        <span className="field-hint" id={`${fieldId}-hint`}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}
