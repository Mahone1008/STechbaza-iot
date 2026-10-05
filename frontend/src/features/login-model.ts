import type { Route } from "next";

import { apiErrorDisplayMessage, isApiError } from "@/lib/api";

export type LoginFormValues = Readonly<{
  email: string;
  password: string;
  otp?: string;
}>;

export type LoginFieldErrors = Readonly<{
  email?: string;
  password?: string;
  otp?: string;
}>;

export type LoginValidationResult = Readonly<{
  normalizedEmail: string;
  errors: LoginFieldErrors;
}>;

export type LoginErrorPresentation = Readonly<{
  summary: string;
  fieldErrors: LoginFieldErrors;
  retryAfterSeconds: number;
  clearPassword: boolean;
  tone?: "info" | "danger";
}>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;
const DEFAULT_LOGIN_DESTINATION: Route = "/devices";
const ALLOWED_RETURN_PATHS = [
  "/devices",
  "/organizations",
  "/alarms",
  "/notifications",
  "/ui-kit",
  "/connect",
  "/account",
  "/factory",
] as const;

export function safeLoginReturnTo(value: string | null | undefined): Route {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_LOGIN_DESTINATION;
  }

  try {
    const url = new URL(value, "http://kerumo.local");
    if (url.origin !== "http://kerumo.local" || url.pathname === "/login") {
      return DEFAULT_LOGIN_DESTINATION;
    }
    const allowed = ALLOWED_RETURN_PATHS.some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    );
    return allowed ? (`${url.pathname}${url.search}${url.hash}` as Route) : DEFAULT_LOGIN_DESTINATION;
  } catch {
    return DEFAULT_LOGIN_DESTINATION;
  }
}

export function validateLoginForm(values: LoginFormValues): LoginValidationResult {
  const normalizedEmail = values.email.trim().toLowerCase();
  const errors: { email?: string; password?: string; otp?: string } = {};

  if (!normalizedEmail) {
    errors.email = "Введіть логін.";
  } else if (
    normalizedEmail.length > MAX_EMAIL_LENGTH ||
    !(normalizedEmail.includes("@")
      ? EMAIL_PATTERN.test(normalizedEmail)
      : /^(?:kr-[0-9a-f]{32}-g[1-9][0-9]*|ku-[0-9a-f]{32})$/u.test(normalizedEmail))
  ) {
    errors.email = "Введіть постійний логін, логін із комплекту або email наявного облікового запису.";
  }

  if (!values.password) {
    errors.password = "Введіть пароль.";
  } else if (values.password.length > MAX_PASSWORD_LENGTH) {
    errors.password = `Пароль не може бути довшим за ${MAX_PASSWORD_LENGTH} символів.`;
  }

  if (values.otp && !/^\d{6}$/u.test(values.otp)) errors.otp = "Введіть шестизначний код із застосунку.";
  return { normalizedEmail, errors };
}

export function loginErrorPresentation(error: unknown): LoginErrorPresentation {
  if (!isApiError(error)) {
    return {
      summary: "Не вдалося увійти. Спробуйте ще раз.",
      fieldErrors: {},
      retryAfterSeconds: 0,
      clearPassword: false,
    };
  }

  if (error.kind === "unauthorized") {
    const detail = error.details && typeof error.details === "object" ? Reflect.get(error.details, "detail") : null;
    const code = detail && typeof detail === "object" ? Reflect.get(detail, "code") : null;
    if (code === "mfa_required" || code === "mfa_invalid") {
      const summary =
        code === "mfa_required"
          ? "Для цього облікового запису ввімкнено двоетапний вхід. Введіть код із застосунку."
          : "Код із застосунку не прийнято. Дочекайтеся нового коду й повторіть вхід.";
      return {
        summary,
        fieldErrors: { otp: "Введіть свіжий шестизначний код із застосунку." },
        retryAfterSeconds: 0,
        clearPassword: false,
        tone: code === "mfa_required" ? "info" : "danger",
      };
    }
    return {
      summary: "Невірний логін або пароль.",
      fieldErrors: { password: "Перевірте пароль і повторіть спробу." },
      retryAfterSeconds: 0,
      clearPassword: true,
    };
  }

  if (error.kind === "forbidden") {
    return {
      summary: "Вхід недоступний. Перевірте адресу сайту або зверніться до адміністратора.",
      fieldErrors: {},
      retryAfterSeconds: 0,
      clearPassword: true,
    };
  }

  if (error.kind === "validation") {
    return {
      summary: "Перевірте логін, пароль і код із застосунку, якщо він потрібен.",
      fieldErrors: {},
      retryAfterSeconds: 0,
      clearPassword: true,
    };
  }

  if (error.kind === "rate-limited") {
    const retryAfterSeconds = Math.max(1, error.retryAfterSeconds ?? 1);
    return {
      summary: `Забагато спроб входу. Повторіть через ${retryAfterSeconds} с.`,
      fieldErrors: {},
      retryAfterSeconds,
      clearPassword: true,
    };
  }

  if (error.kind === "server") {
    return {
      summary:
        error.status === 503
          ? "Вхід тимчасово недоступний. Спробуйте пізніше."
          : "Не вдалося увійти. Спробуйте пізніше.",
      fieldErrors: {},
      retryAfterSeconds: 0,
      clearPassword: false,
    };
  }

  if (error.kind === "invalid-response") {
    return {
      summary: "Не вдалося підтвердити вхід. Спробуйте ще раз.",
      fieldErrors: {},
      retryAfterSeconds: 0,
      clearPassword: false,
    };
  }

  if (error.kind === "aborted") {
    return { summary: "", fieldErrors: {}, retryAfterSeconds: 0, clearPassword: false };
  }

  return {
    summary: apiErrorDisplayMessage(error),
    fieldErrors: {},
    retryAfterSeconds: 0,
    clearPassword: false,
  };
}
