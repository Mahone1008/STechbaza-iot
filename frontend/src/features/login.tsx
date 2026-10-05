"use client";

import type { Route } from "next";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { Brand } from "@/components/app-shell";
import { Button, TextField } from "@/components/ui";
import { useAuthSession } from "@/features/auth-session";
import {
  loginErrorPresentation,
  safeLoginReturnTo,
  validateLoginForm,
  type LoginFieldErrors,
} from "@/features/login-model";
import { isApiError } from "@/lib/api";

function focusFirstInvalidField(errors: LoginFieldErrors): void {
  const id = errors.email ? "login-email" : errors.password ? "login-password" : null;
  if (!id) return;
  window.requestAnimationFrame(() => document.getElementById(id)?.focus());
}

function withoutFieldError(errors: LoginFieldErrors, field: keyof LoginFieldErrors): LoginFieldErrors {
  const next: { email?: string; password?: string } = { ...errors };
  delete next[field];
  return next;
}

function subscribeToLocationChange(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

function loggedOutLocationSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("loggedOut") === "1";
}

function currentLoginDestination(): Route {
  if (typeof window === "undefined") return "/devices";
  return safeLoginReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
}

export function LoginPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = safeLoginReturnTo(params.get("returnTo"));
  const [otp, setOtp] = useState("");
  const { login, session } = useAuthSession();
  const abortControllerRef = useRef<AbortController | null>(null);
  const redirectTargetRef = useRef<Route | null>(null);
  const onboardingTargetRef = useRef<Route | null>(null);
  const alertRef = useRef<HTMLDivElement | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const loggedOutNotice = useSyncExternalStore(subscribeToLocationChange, loggedOutLocationSnapshot, () => false);
  const sessionBusy = session.status === "restoring" || session.status === "logging-out";

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  useEffect(() => {
    if (session.status !== "authenticated") {
      redirectTargetRef.current = null;
      return;
    }
    const destination = onboardingTargetRef.current ?? currentLoginDestination();
    if (redirectTargetRef.current === destination) return;
    redirectTargetRef.current = destination;
    router.replace(destination);
  }, [router, session.status]);

  useEffect(() => {
    if (blockedUntil === null) return;

    const updateClock = () => {
      const now = Date.now();
      setClock(now);
      if (now >= blockedUntil) {
        setBlockedUntil(null);
        setFormError("");
      }
    };

    updateClock();
    const interval = window.setInterval(updateClock, 250);
    return () => window.clearInterval(interval);
  }, [blockedUntil]);

  useEffect(() => {
    if (formError) alertRef.current?.focus();
  }, [formError]);

  const retrySeconds = blockedUntil === null ? 0 : Math.max(1, Math.ceil((blockedUntil - clock) / 1_000));

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || sessionBusy || session.status === "authenticated" || retrySeconds > 0) return;

    const validation = validateLoginForm({ email, password });
    setFieldErrors(validation.errors);
    setFormError("");

    if (validation.errors.email || validation.errors.password) {
      focusFirstInvalidField(validation.errors);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setSubmitting(true);

    try {
      const response = await login(
        { email: validation.normalizedEmail, password, ...(otp ? { otp } : {}) },
        controller.signal,
      );
      if (!params.get("returnTo") && response.onboarding_path)
        onboardingTargetRef.current = safeLoginReturnTo(response.onboarding_path);
      setPassword("");
      // Єдиний перехід виконує effect після підтвердженого authenticated state.
    } catch (error) {
      if (isApiError(error) && error.kind === "aborted") return;

      const presentation = loginErrorPresentation(error);
      setFormError(presentation.summary);
      setFieldErrors(presentation.fieldErrors);
      if (presentation.clearPassword) setPassword("");
      if (presentation.retryAfterSeconds > 0) {
        const now = Date.now();
        setClock(now);
        setBlockedUntil(now + presentation.retryAfterSeconds * 1_000);
      }
      focusFirstInvalidField(presentation.fieldErrors);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setSubmitting(false);
      }
    }
  };

  const buttonLabel = sessionBusy
    ? session.status === "logging-out"
      ? "Завершуємо сесію…"
      : "Відновлюємо сесію…"
    : submitting
      ? "Перевіряємо…"
      : retrySeconds > 0
        ? `Спробуйте через ${retrySeconds} с`
        : "Увійти";

  return (
    <main className="login-page">
      <section className="login-visual" aria-label="Про платформу KERUMO">
        <Brand />
        <div className="login-message">
          <p className="eyebrow">Промисловий контроль без зайвого шуму</p>
          <h1>Обладнання, показники та аварії — в одному зрозумілому кабінеті.</h1>
          <p>
            KERUMO поєднує модульні контролери, частотні перетворювачі та датчики, не змішуючи стан зв’язку з фактичним
            результатом команди.
          </p>
        </div>
        <div className="login-features">
          <div className="login-feature">
            <strong>Модульність</strong>
            <span>Лише встановлені можливості</span>
          </div>
          <div className="login-feature">
            <strong>Контроль</strong>
            <span>ACK і Result показуються окремо</span>
          </div>
          <div className="login-feature">
            <strong>Безпека</strong>
            <span>Доступ лише до вашого обладнання</span>
          </div>
        </div>
      </section>

      <section className="login-form-side">
        <div className="login-card">
          <Brand />
          <h2>Вхід до кабінету</h2>
          <p>
            Для першої активації використайте заводські логін і пароль або QR на шильдику. Надалі входьте з постійним
            паролем і кодом із застосунку.
          </p>

          {loggedOutNotice && session.status === "anonymous" ? (
            <div className="login-alert login-alert-success" role="status">
              <strong>Сесію завершено</strong>
              <span>Ви вийшли з облікового запису в усіх відкритих вкладках цього браузера.</span>
            </div>
          ) : null}

          {sessionBusy ? (
            <div className="login-alert login-alert-info" role="status">
              <strong>{session.status === "logging-out" ? "Завершуємо сесію" : "Перевіряємо наявну сесію"}</strong>
              <span>
                {session.status === "logging-out"
                  ? "Зачекайте, поки завершиться вихід з облікового запису."
                  : "Перевіряємо, чи можна безпечно продовжити роботу в кабінеті."}
              </span>
            </div>
          ) : session.status === "logout-failed" && !formError ? (
            <div className="login-alert login-alert-warning" role="alert">
              <strong>Вихід не підтверджено</strong>
              <span>
                {session.message} Поверніться до захищеного маршруту, щоб повторити вихід або відновити кабінет.
              </span>
            </div>
          ) : session.status === "unavailable" && !formError ? (
            <div className="login-alert login-alert-warning" role="status">
              <strong>Автоматичне відновлення тимчасово недоступне</strong>
              <span>{session.message} Можна повторити вхід вручну.</span>
            </div>
          ) : null}

          {formError ? (
            <div
              className={`login-alert ${retrySeconds > 0 ? "login-alert-warning" : "login-alert-danger"}`}
              role="alert"
              tabIndex={-1}
              ref={alertRef}
            >
              <strong>Не вдалося увійти</strong>
              <span>{retrySeconds > 0 ? `Забагато спроб. Повторіть через ${retrySeconds} с.` : formError}</span>
            </div>
          ) : null}

          <form className="login-form" onSubmit={submitLogin} noValidate>
            <TextField
              id="login-email"
              label="Логін"
              type="text"
              placeholder="Ваш логін"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              value={email}
              {...(fieldErrors.email ? { error: fieldErrors.email } : {})}
              disabled={submitting || sessionBusy}
              onChange={(event) => {
                setEmail(event.target.value);
                if (fieldErrors.email) setFieldErrors((current) => withoutFieldError(current, "email"));
              }}
              autoFocus={!sessionBusy}
            />
            <TextField
              id="login-password"
              label="Пароль"
              type="password"
              placeholder="Введіть пароль"
              autoComplete="current-password"
              maxLength={128}
              value={password}
              {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
              disabled={submitting || sessionBusy}
              onChange={(event) => {
                setPassword(event.target.value);
                if (fieldErrors.password) setFieldErrors((current) => withoutFieldError(current, "password"));
              }}
            />
            <TextField
              label="Код двоетапного входу, якщо ввімкнено"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
            />
            <Button
              type="submit"
              variant="primary"
              fullWidth
              disabled={submitting || sessionBusy || retrySeconds > 0}
              aria-busy={submitting || sessionBusy}
            >
              {buttonLabel}
            </Button>
          </form>

          <div className="login-support">
            <Link href="/connect">Активувати контролер за QR</Link>
            <Link href={`/recover?returnTo=${encodeURIComponent(returnTo)}` as Route}>Відновити доступ</Link>
          </div>
          <div className="login-security">
            Зберігайте постійний пароль і ключ відновлення в надійному місці. Код із застосунку потрібен, якщо
            двоетапний вхід увімкнено.
          </div>
        </div>
      </section>
    </main>
  );
}
