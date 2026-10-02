export type ApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "validation"
  | "rate-limited"
  | "server"
  | "network"
  | "timeout"
  | "aborted"
  | "invalid-response"
  | "unexpected";

export type ApiErrorContext = Readonly<{
  kind: ApiErrorKind;
  status: number | null;
  method: string;
  url: string;
  retryAfterSeconds: number | null;
  requestId: string | null;
  details: unknown;
  cause?: unknown;
}>;

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly method: string;
  readonly url: string;
  readonly retryAfterSeconds: number | null;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(message: string, context: ApiErrorContext) {
    super(message, context.cause === undefined ? undefined : { cause: context.cause });
    this.name = "ApiError";
    this.kind = context.kind;
    this.status = context.status;
    this.method = context.method;
    this.url = context.url;
    this.retryAfterSeconds = context.retryAfterSeconds;
    this.requestId = context.requestId;
    this.details = context.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function apiErrorKindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "server";
  return "unexpected";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readValidationMessages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const message = readString(Reflect.get(item, "msg"));
    return message ? [message.replace(/^Value error,\s*/u, "")] : [];
  });
}

export function problemMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const detail = Reflect.get(payload, "detail");
    const detailText = readString(detail);
    if (detailText) return detailText;

    const detailMessages = readValidationMessages(detail);
    if (detailMessages.length) return detailMessages.join(" ");

    if (detail && typeof detail === "object") {
      const nestedMessage = readString(Reflect.get(detail, "message"));
      if (nestedMessage) return nestedMessage;
    }

    const message = readString(Reflect.get(payload, "message"));
    if (message) return message;
  }

  if (status === 401) return "Сесію не підтверджено або вона завершилася.";
  if (status === 403) return "Недостатньо прав для цієї дії.";
  if (status === 404) return "Ресурс не знайдено або він недоступний.";
  if (status === 409) return "Стан ресурсу змінився. Оновіть дані й повторіть рішення вручну.";
  if (status === 422) return "Запит містить некоректні дані.";
  if (status === 429) return "Забагато запитів. Зачекайте перед повтором.";
  if (status >= 500) return "Сервер тимчасово не може виконати запит.";
  return `API повернув HTTP ${status}.`;
}

export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - nowMs) / 1000));
}

export function apiErrorDisplayMessage(error: unknown): string {
  if (!isApiError(error)) {
    return "Сталася непередбачена помилка інтерфейсу.";
  }

  if (error.kind === "network") return "Backend недоступний. Перевірте адресу API та стан сервера.";
  if (error.kind === "timeout") return "Backend не відповів у відведений час.";
  if (error.kind === "aborted") return "Запит скасовано. Стару відповідь не буде застосовано до нового екрана.";
  return error.message;
}
