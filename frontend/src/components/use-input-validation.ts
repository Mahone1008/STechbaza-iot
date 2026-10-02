"use client";
import { useLayoutEffect, useRef, useState, type InvalidEvent } from "react";

function constraintMessage(input: HTMLInputElement): string {
  const state = input.validity;
  if (state.valid) return "";
  if (state.customError) return input.validationMessage;
  if (state.valueMissing) return "Заповніть це поле.";
  if (state.badInput) return "Введіть число.";
  if (state.typeMismatch)
    return input.type === "email" ? "Вкажіть коректну адресу електронної пошти." : "Перевірте формат значення.";
  if (state.rangeUnderflow) return `Значення має бути не менше ${input.min}.`;
  if (state.rangeOverflow) return `Значення має бути не більше ${input.max}.`;
  if (state.stepMismatch) return `Введіть значення з кроком ${input.step || "1"}.`;
  if (state.tooShort) return `Введіть щонайменше ${input.minLength} символів.`;
  if (state.tooLong) return `Введіть не більше ${input.maxLength} символів.`;
  return "Перевірте формат значення.";
}

export function useInputValidation(message = "") {
  const inputRef = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);
  const [nativeError, setNativeError] = useState("");
  useLayoutEffect(() => {
    inputRef.current?.setCustomValidity(message);
  }, [message]);
  const validate = (element: HTMLInputElement) => {
    setTouched(true);
    setNativeError(element.validity.customError ? "" : constraintMessage(element));
  };
  const onInvalid = (event: InvalidEvent<HTMLInputElement>) => {
    // HTML-валідація блокує submit, але текст і вигляд помилки належать сайту,
    // а не мові браузера. Розкриваємо приховане поле перед поверненням фокуса.
    event.preventDefault();
    const element = event.currentTarget;
    validate(element);
    const first = element.form?.querySelector("input:invalid, select:invalid, textarea:invalid");
    if (first && first !== element) return;
    for (let parent = element.parentElement; parent && parent !== element.form; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    element.focus();
  };
  const onChange = () => setNativeError("");
  return {
    inputRef,
    error: touched ? message || nativeError : "",
    onInvalid,
    onChange,
    onBlur: validate,
    reset: () => {
      setTouched(false);
      setNativeError("");
    },
  };
}
