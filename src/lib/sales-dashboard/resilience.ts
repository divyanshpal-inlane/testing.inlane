// Small, dependency-free helpers that keep the Sales Dashboard usable when
// Supabase has a brief hiccup (e.g. the edge proxy's "upstream connect error or
// disconnect/reset before headers ... connection timeout").
//
// Every browser talks to the same Supabase project directly, so a short
// backend stall hits every open dashboard at the same moment. Two things keep
// that from turning into a wall of error banners:
//   1. transient failures are retried with jittered exponential backoff (the
//      jitter matters: without it every client retries in lockstep and keeps
//      the backend saturated);
//   2. rarely-changing reads (booking config, instructor list) are cached, so a
//      reload during a blip still renders instead of dead-ending on an error.

const TRANSIENT_MESSAGE =
  /upstream connect error|connection timeout|disconnect\/reset|reset before headers|failed to fetch|networkerror|network request failed|load failed|fetch failed|timed out|timeout|temporarily unavailable|bad gateway|service unavailable|gateway time-?out|econnreset|socket hang up/i;

// 408 timeout, 425/429 back-pressure, and the 5xx gateway family.
const TRANSIENT_STATUS = new Set([
  408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524,
]);

/**
 * True for failures that are worth retrying: network errors, timeouts, and
 * backend/proxy overload. False for genuine client/data errors (bad query,
 * permission denied, missing column) where retrying can only waste requests.
 */
export function isTransientError(err: unknown): boolean {
  if (err == null) return false;
  const obj = err as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    code?: unknown;
    details?: unknown;
    error?: unknown;
  };
  // AbortError from OUR timeout is retryable; a caller-initiated abort is
  // handled by withRetry's signal check before it ever gets here.
  if (obj.name === "AbortError" || obj.name === "TimeoutError") return true;
  if (typeof obj.status === "number" && TRANSIENT_STATUS.has(obj.status)) {
    return true;
  }
  const parts = [obj.message, obj.details, obj.code]
    .filter((x): x is string => typeof x === "string")
    .join(" ");
  if (parts && TRANSIENT_MESSAGE.test(parts)) return true;
  if (typeof err === "string") return TRANSIENT_MESSAGE.test(err);
  if (obj.error != null && typeof obj.error === "object") {
    return isTransientError(obj.error);
  }
  return false;
}

/** Full-jitter exponential backoff delay for the given 0-based attempt. */
export function backoffDelayMs(
  attempt: number,
  baseMs = 800,
  maxMs = 6000,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  // Never 0: an immediate retry is exactly what hammers a struggling backend.
  return Math.max(150, Math.round(random() * ceiling));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface RetryOptions {
  /** Extra attempts after the first. 0 disables retrying. */
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  /** Stops waiting/retrying as soon as the caller gives up (e.g. deadline). */
  signal?: AbortSignal;
  /** Test seam. */
  random?: () => number;
}

/**
 * Runs `fn`, retrying only transient failures with jittered backoff. The last
 * error is rethrown unchanged so existing error handling keeps working.
 */
export async function withRetry<T>(
  fn: () => PromiseLike<T> | T,
  opts: RetryOptions = {},
): Promise<T> {
  const { retries = 2, baseMs, maxMs, signal, random } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await fn();
      // supabase-js resolves with { data, error } instead of throwing, so a
      // backend failure arrives as a value. Surface it as a throw so the retry
      // logic (and the caller's existing `if (error) throw error`) both work.
      const maybeErr = (out as { error?: unknown } | null)?.error;
      if (maybeErr && isTransientError(maybeErr)) throw maybeErr;
      return out;
    } catch (err) {
      const callerGaveUp = signal?.aborted === true;
      if (callerGaveUp || attempt >= retries || !isTransientError(err)) {
        throw err;
      }
      await sleep(backoffDelayMs(attempt, baseMs, maxMs, random), signal);
    }
  }
}

// --------------------------- tiny TTL cache --------------------------------

const PREFIX = "lane-sales-cache:v1:";

interface Entry<T> {
  at: number;
  value: T;
}

export function cacheRead<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (typeof entry?.at !== "number") return null;
    if (Date.now() - entry.at > maxAgeMs) return null;
    return entry.value;
  } catch {
    return null;
  }
}

export function cacheWrite<T>(key: string, value: T): void {
  try {
    localStorage.setItem(
      PREFIX + key,
      JSON.stringify({ at: Date.now(), value } satisfies Entry<T>),
    );
  } catch {
    // Storage full / disabled (private mode): caching is best-effort only.
  }
}
