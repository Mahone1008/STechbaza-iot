import { apiConfig, buildApiUrl } from "./config";
import { ApiError, apiErrorKindForStatus, parseRetryAfter, problemMessage } from "./errors";

type ApiQueryPrimitive = string | number | boolean | null;
type ApiQueryValue = ApiQueryPrimitive | readonly ApiQueryPrimitive[] | undefined;
type ApiQuery = Readonly<Record<string, ApiQueryValue>>;
type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiRequestOptions = Readonly<{
  path: string;
  method?: ApiMethod;
  query?: ApiQuery;
  body?: unknown;
  headers?: HeadersInit;
  accessToken?: string | null;
  csrf?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  credentials?: RequestCredentials;
}>;

function appendQuery(url: URL, query: ApiQuery | undefined): void {
  if (!query) return;

  for (const [key, rawValue] of Object.entries(query)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value === undefined) continue;
      url.searchParams.append(key, value === null ? "" : String(value));
    }
  }
}

async function readResponseBody(response: Response, method: string, url: string): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return null;

  const text = await response.text();
  if (!text) return null;

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("json")) return text;

  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ApiError("Backend повернув некоректний JSON.", {
      kind: "invalid-response",
      status: response.status,
      method,
      url,
      retryAfterSeconds: null,
      requestId: response.headers.get("x-request-id"),
      details: text.slice(0, 500),
      cause,
    });
  }
}

function createCombinedAbortSignal(externalSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;

  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      globalThis.clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

export async function apiRequest<T>(options: ApiRequestOptions): Promise<T> {
  const method = options.method ?? "GET";
  const url = buildApiUrl(options.path);
  appendQuery(url, options.query);

  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.accessToken) headers.set("Authorization", `Bearer ${options.accessToken}`);
  if (options.csrf) headers.set("X-TechBaza-CSRF", "1");

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const timeoutMs = options.timeoutMs ?? apiConfig.timeoutMs;
  const abort = createCombinedAbortSignal(options.signal, timeoutMs);

  try {
    const requestInit: RequestInit = {
      method,
      headers,
      credentials: options.credentials ?? "include",
      cache: "no-store",
      // API paths are canonical; never replay a credentialed request after a redirect.
      redirect: "error",
      signal: abort.signal,
    };
    if (body !== undefined) requestInit.body = body;

    const response = await fetch(url, requestInit);
    const payload = await readResponseBody(response, method, url.toString());

    if (!response.ok) {
      throw new ApiError(problemMessage(payload, response.status), {
        kind: apiErrorKindForStatus(response.status),
        status: response.status,
        method,
        url: url.toString(),
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
        requestId: response.headers.get("x-request-id"),
        details: payload,
      });
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    if (abort.didTimeout()) {
      throw new ApiError("Час очікування відповіді API вичерпано.", {
        kind: "timeout",
        status: null,
        method,
        url: url.toString(),
        retryAfterSeconds: null,
        requestId: null,
        details: null,
        cause: error,
      });
    }

    if (options.signal?.aborted || abort.signal.aborted) {
      throw new ApiError("Запит скасовано.", {
        kind: "aborted",
        status: null,
        method,
        url: url.toString(),
        retryAfterSeconds: null,
        requestId: null,
        details: null,
        cause: error,
      });
    }

    throw new ApiError("Не вдалося встановити зв’язок із backend.", {
      kind: "network",
      status: null,
      method,
      url: url.toString(),
      retryAfterSeconds: null,
      requestId: null,
      details: null,
      cause: error,
    });
  } finally {
    abort.cleanup();
  }
}
