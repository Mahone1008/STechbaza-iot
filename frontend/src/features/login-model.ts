import { apiErrorDisplayMessage, isApiError } from "@/lib/api";

export type LoginFormValues = Readonly<{
  email: string;
  password: string;
}>;

export type LoginFieldErrors = Readonly<{
  email?: string;
  password?: string;
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
}>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;

export function validateLoginForm(values: LoginFormValues): LoginValidationResult {
  const normalizedEmail = values.email.trim().toLowerCase();
  const errors: { email?: string; password?: string } = {};

  if (!normalizedEmail) {
    errors.email = "Введіть email.";
  } else if (normalizedEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(normalizedEmail)) {
    errors.email = "Введіть коректний email, наприклад name@company.ua.";
  }

  if (!values.password) {
    errors.password = "Введіть пароль.";
  } else if (values.password.length > MAX_PASSWORD_LENGTH) {
    errors.password = `Пароль не може бути довшим за ${MAX_PASSWORD_LENGTH} символів.`;
  }

  return { normalizedEmail, errors };
}

export function loginErrorPresentation(error: unknown): LoginErrorPresentation {
  if (!isApiError(error)) {
    return {
      summary: "Сталася непередбачена помилка інтерфейсу входу.",
      fieldErrors: {},
      retryAfterSeconds: 0,
      clearPassword: false,
    };
  }

  if (error.kind === "unauthorized") {
    return {
      summary: "Невірний email або пароль.",
      fieldErrors: { password: "Перевірте пароль і повторіть спробу." },
      retryAfterSeconds: 0,
      clearPassword: true,
    };
  }

  if (error.kind === "forbidden") {
    return {
      summary: "Вхід заборонено. Обліковий запис може бути вимкнений або цей browser origin не дозволений.",
      fieldErrors: {},
      retryAfterSeconds: 0,
      clearPassword: true,
    };
  }

  if (error.kind === "validation") {
    return {
      summary: "Backend відхилив дані входу. Перевірте email і пароль.",
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
      summary: error.status === 503
        ? "Сервіс входу тимчасово недоступний. Дані не були прийняті; повторіть пізніше."
        : "Backend тимчасово не може виконати вхід.",
      fieldErrors: {},
      retryAfterSeconds: 0,
      clearPassword: false,
    };
  }

  if (error.kind === "invalid-response") {
    return {
      summary: "Backend повернув некоректну відповідь входу. Сесію не створено.",
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
