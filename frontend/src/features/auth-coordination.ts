export const AUTH_CHANNEL_NAME = "kerumo-auth-session-v1";
export const AUTH_LOCK_NAME = "kerumo-auth-session-lock-v1";

const AUTH_LOCK_STORAGE_KEY = "kerumo.auth.lock.v1";
const LOCK_LEASE_MS = 15_000;
const LOCK_RENEW_MS = 5_000;
const LOCK_TIMEOUT_MS = 25_000;
const MIN_SNAPSHOT_TOKEN_LENGTH = 20;
const MAX_SNAPSHOT_TOKEN_LENGTH = 8_192;
const MAX_FUTURE_CLOCK_SKEW_MS = 60_000;

export type AuthSessionOrigin = "login" | "refresh";

export type AuthSessionRequestMessage = Readonly<{
  version: 1;
  type: "session-request";
  sourceTab: string;
  issuedAt: number;
}>;

export type AuthSessionSnapshotMessage = Readonly<{
  version: 1;
  type: "session-snapshot";
  sourceTab: string;
  targetTab: string | null;
  issuedAt: number;
  sessionOrigin: AuthSessionOrigin;
  email: string | null;
  accessToken: string;
  accessExpiresAt: number;
  sessionExpiresAt: number;
}>;

export type AuthSessionClearedMessage = Readonly<{
  version: 1;
  type: "session-cleared";
  sourceTab: string;
  issuedAt: number;
  reason: "expired" | "revoked" | "logout";
}>;

export type AuthChannelMessage =
  | AuthSessionRequestMessage
  | AuthSessionSnapshotMessage
  | AuthSessionClearedMessage;

type StorageLease = Readonly<{
  owner: string;
  nonce: string;
  expiresAt: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function readInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? Number(value) : null;
}

function readNullableEmail(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.length <= 254 ? normalized : undefined;
}

export function createAuthTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function parseAuthChannelMessage(value: unknown, nowMs = Date.now()): AuthChannelMessage | null {
  if (!isRecord(value) || value.version !== 1) return null;

  const type = value.type;
  const sourceTab = readString(value.sourceTab, 128);
  const issuedAt = readInteger(value.issuedAt);
  if (!sourceTab || issuedAt === null || issuedAt > nowMs + MAX_FUTURE_CLOCK_SKEW_MS) return null;

  if (type === "session-request") {
    return { version: 1, type, sourceTab, issuedAt };
  }

  if (type === "session-cleared") {
    const reason = value.reason;
    if (reason !== "expired" && reason !== "revoked" && reason !== "logout") return null;
    return { version: 1, type, sourceTab, issuedAt, reason };
  }

  if (type !== "session-snapshot") return null;

  const targetTabRaw = value.targetTab;
  const targetTab = targetTabRaw === null ? null : readString(targetTabRaw, 128);
  const sessionOrigin = value.sessionOrigin;
  const email = readNullableEmail(value.email);
  const accessToken = readString(value.accessToken, MAX_SNAPSHOT_TOKEN_LENGTH);
  const accessExpiresAt = readInteger(value.accessExpiresAt);
  const sessionExpiresAt = readInteger(value.sessionExpiresAt);

  if (
    targetTab === null && targetTabRaw !== null
    || (sessionOrigin !== "login" && sessionOrigin !== "refresh")
    || email === undefined
    || !accessToken
    || accessToken.length < MIN_SNAPSHOT_TOKEN_LENGTH
    || accessExpiresAt === null
    || sessionExpiresAt === null
    || accessExpiresAt <= issuedAt
    || sessionExpiresAt <= issuedAt
  ) {
    return null;
  }

  return {
    version: 1,
    type,
    sourceTab,
    targetTab,
    issuedAt,
    sessionOrigin,
    email,
    accessToken,
    accessExpiresAt,
    sessionExpiresAt,
  };
}

export function isSnapshotUsable(
  snapshot: AuthSessionSnapshotMessage,
  nowMs = Date.now(),
  minimumValidityMs = 5_000,
): boolean {
  return snapshot.accessExpiresAt - nowMs > minimumValidityMs
    && snapshot.sessionExpiresAt - nowMs > minimumValidityMs;
}

export function refreshDelayMs(accessExpiresAt: number, nowMs = Date.now()): number {
  const remaining = accessExpiresAt - nowMs;
  const earlyRefreshMs = Math.min(60_000, Math.max(5_000, Math.floor(remaining * 0.2)));
  return Math.max(1_000, remaining - earlyRefreshMs);
}

export function refreshRetryDelayMs(attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null) {
    return Math.min(60_000, Math.max(1_000, retryAfterSeconds * 1_000));
  }
  const schedule = [1_000, 5_000, 15_000, 30_000, 60_000] as const;
  return schedule[Math.min(Math.max(0, attempt), schedule.length - 1)] ?? 60_000;
}

function parseLease(value: string | null): StorageLease | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return null;
    const owner = readString(parsed.owner, 128);
    const nonce = readString(parsed.nonce, 128);
    const expiresAt = readInteger(parsed.expiresAt);
    return owner && nonce && expiresAt !== null ? { owner, nonce, expiresAt } : null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function storageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const probe = `${AUTH_LOCK_STORAGE_KEY}.probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

async function withStorageLease<T>(owner: string, operation: () => Promise<T>): Promise<T> {
  if (!storageAvailable()) return operation();

  const nonce = createAuthTabId();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const now = Date.now();
    const existing = parseLease(window.localStorage.getItem(AUTH_LOCK_STORAGE_KEY));

    if (!existing || existing.expiresAt <= now) {
      const candidate: StorageLease = { owner, nonce, expiresAt: now + LOCK_LEASE_MS };
      window.localStorage.setItem(AUTH_LOCK_STORAGE_KEY, JSON.stringify(candidate));
      await delay(25 + Math.floor(Math.random() * 25));

      const confirmed = parseLease(window.localStorage.getItem(AUTH_LOCK_STORAGE_KEY));
      if (confirmed?.owner === owner && confirmed.nonce === nonce) {
        const renewal = globalThis.setInterval(() => {
          const current = parseLease(window.localStorage.getItem(AUTH_LOCK_STORAGE_KEY));
          if (current?.owner === owner && current.nonce === nonce) {
            window.localStorage.setItem(
              AUTH_LOCK_STORAGE_KEY,
              JSON.stringify({ ...current, expiresAt: Date.now() + LOCK_LEASE_MS }),
            );
          }
        }, LOCK_RENEW_MS);

        try {
          return await operation();
        } finally {
          globalThis.clearInterval(renewal);
          const current = parseLease(window.localStorage.getItem(AUTH_LOCK_STORAGE_KEY));
          if (current?.owner === owner && current.nonce === nonce) {
            window.localStorage.removeItem(AUTH_LOCK_STORAGE_KEY);
          }
        }
      }
    }

    await delay(50 + Math.floor(Math.random() * 75));
  }

  throw new Error("Не вдалося серіалізувати auth-операцію між вкладками.");
}

export async function withCrossTabAuthLock<T>(
  owner: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(AUTH_LOCK_NAME, { mode: "exclusive" }, operation);
  }
  return withStorageLease(owner, operation);
}
