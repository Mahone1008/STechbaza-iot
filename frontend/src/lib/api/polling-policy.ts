import { isApiError } from "./errors";
export type PollSeconds = 0 | 30 | 60;
const transient = new Set(["network", "timeout", "server", "rate-limited"]);
// Один бюджет на query: ручне оновлення також поважає Retry-After.
export class PollingBudget {
  constructor(readonly queryIdentity = "") {}
  failures = 0;
  error: unknown = null;
  nextAttemptAt = 0;
  retryAfterAt = 0;
  success() { this.failures = 0; this.error = null; this.nextAttemptAt = 0; this.retryAfterAt = 0; }
  failure(error: unknown, baseMs: number, now = Date.now(), jitter = Math.random()) {
    this.error = error;
    this.failures += 1;
    const backoff = Math.min(300000, baseMs * 2 ** Math.min(this.failures - 1, 5));
    this.retryAfterAt = isApiError(error) && error.retryAfterSeconds !== null ? now + error.retryAfterSeconds * 1000 : 0;
    this.nextAttemptAt = Math.max(now + backoff * (1 + Math.max(0, Math.min(1, jitter)) * 0.1), this.retryAfterAt);
  }
  interval(baseMs: number, now = Date.now()): number | false {
    if (!baseMs) return false;
    if (this.error && (!isApiError(this.error) || !transient.has(this.error.kind))) return false;
    return this.error ? Math.max(1000, this.nextAttemptAt - now) : baseMs;
  }
  blocked(manual: boolean, now = Date.now()) { return now < (manual ? this.retryAfterAt : this.nextAttemptAt); }
}
