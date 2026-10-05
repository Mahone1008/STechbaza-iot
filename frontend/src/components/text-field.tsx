"use client";
import { useId, useState, type InputHTMLAttributes } from "react";
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
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPassword = props.type === "password";
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
    <div className="field">
      <label className="field-label" id={`${fieldId}-label`} htmlFor={fieldId}>
        {label}
      </label>
      <div className="field-control">
        <input
          {...props}
          type={isPassword && passwordVisible ? "text" : props.type}
          ref={inputRef}
          className={`input ${isPassword ? "input-password " : ""}${className}`}
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
        {isPassword ? (
          <button
            className="password-toggle"
            type="button"
            aria-label={passwordVisible ? "Приховати пароль" : "Показати пароль"}
            aria-describedby={`${fieldId}-label`}
            aria-pressed={passwordVisible}
            aria-controls={fieldId}
            disabled={props.disabled}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {passwordVisible ? <path d="m3 3 18 18" /> : null}
            </svg>
          </button>
        ) : null}
      </div>
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
    </div>
  );
}
