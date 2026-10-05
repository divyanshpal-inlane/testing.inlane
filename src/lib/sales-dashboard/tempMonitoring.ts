// TEMP SALES DASHBOARD MONITORING
// REMOVE BEFORE PRODUCTION
//
// ============================================================================
// ENTIRE TEMPORARY MONITORING SYSTEM LIVES IN THIS FILE.
// To remove the feature: delete this file, delete the migration
// 20261002_000000_sales_dashboard_temporary_logs.sql (and DROP the table),
// delete scripts/sales-dashboard-report.mjs + sales_dashboard_temporary_log.md,
// then delete the `monitoring` import and the trackEvent/measureApi call sites
// in SalesDashboard.tsx, TentativeBookingModal.tsx and useSalesData.ts.
// ============================================================================
//
// Design constraints this file exists to satisfy:
//   1. Monitoring must NEVER break the dashboard. Every function here is
//      wrapped so a thrown error is swallowed; nothing here is ever awaited by
//      the booking path.
//   2. Monitoring must NEVER log secrets or customer data. `props` is passed
//      through a redactor that drops any key that looks like a credential or
//      customer identifier, and every string is length-capped.
//   3. Writes are batched (one INSERT per flush, not one per click) and sent
//      fire-and-forget. If the table does not exist yet (the migration is
//      manual-apply only), a circuit breaker disables logging for the rest of
//      the session instead of retrying forever.

import { supabase } from "@/lib/supabaseClient";

// TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
export const MONITORING_TABLE = "sales_dashboard_temporary_logs";
/** Set `localStorage.setItem("sales_dashboard_monitoring_off", "1")` to kill
 *  monitoring instantly in a live browser, no redeploy needed. */
export const MONITORING_OFF_KEY = "sales_dashboard_monitoring_off";
const SESSION_KEY = "sales_dashboard_monitoring_session";

const FLUSH_DEBOUNCE_MS = 4000;
const FLUSH_BATCH = 15;
/** Flush reasons that happen while/just before the document goes away. These
 *  must survive the browser cancelling in-flight requests on unload. */
const UNLOAD_REASONS = new Set(["hidden", "pagehide", "unmount"]);
/** Gap with no activity that counts as idle rather than active usage. */
const IDLE_GAP_MS = 5 * 60 * 1000;
/** Consecutive "table does not exist" responses before logging gives up. */
const MISSING_TABLE_STRIKES = 2;

// database.types.ts has no entry for this temporary table (and must not get
// one). Same `as any` escape hatch used elsewhere in the codebase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Json = Record<string, unknown>;

export interface MonitorIdentity {
  userId: string | null;
  userName: string;
  role: string;
  /** Supabase Auth uid. Recorded separately because the admin/user record
   *  lookup above is network-backed and may never resolve (the Go service
   *  being down must not turn every row anonymous). */
  authUserId?: string | null;
}

export interface MonitorFields {
  instructorId?: string | null;
  slotDate?: string | null;
  slotStart?: string | null;
  slotEnd?: string | null;
  bookingId?: string | null;
  /** Customer/learner name for booking events, so a row answers "which
   *  customer did this" and not only "which member of staff". Stored as
   *  `props.customer_name` (the existing JSONB column), so it needs no schema
   *  change. It is added AFTER the redactor runs: the redactor strips any key
   *  matching /customer|phone|address/ from `details`, which is why a name
   *  passed inside `details` never survives. Phone and address are still never
   *  recorded. */
  customerName?: string | null;
  success?: boolean | null;
  error?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  details?: Json;
}

export interface ApiFields extends MonitorFields {
  method: string;
  status?: number | null;
  durationMs?: number | null;
}

interface LogRow {
  ts: string;
  session_id: string;
  user_id: string | null;
  auth_user_id: string | null;
  user_name: string | null;
  user_role: string | null;
  category: "session" | "user_action" | "api" | "error";
  event_name: string;
  success: boolean | null;
  instructor_id: string | null;
  slot_date: string | null;
  slot_start: string | null;
  slot_end: string | null;
  booking_id: string | null;
  error_code: string | null;
  error_message: string | null;
  api_name: string | null;
  http_method: string | null;
  http_status: number | null;
  duration_ms: number | null;
  device: Json | null;
  props: Json | null;
}

// --------------------------------------------------------------- redaction
const SECRET_KEY =
  /(pass|token|secret|auth|apikey|api_key|bearer|cookie|otp|pin|cvv|card)/i;
const CUSTOMER_KEY = /(phone|email|address|customer|learner|contact|note)/i;
const MAX_STRING = 120;

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 3) return "[deep]";
  const t = typeof value;
  if (t === "string") {
    const s = value as string;
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s;
  }
  if (t === "number" || t === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }
  if (t === "object") {
    const out: Json = {};
    for (const [k, v] of Object.entries(value as Json)) {
      if (SECRET_KEY.test(k) || CUSTOMER_KEY.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function errorParts(error: unknown): {
  code: string | null;
  message: string | null;
  status: number | null;
} {
  if (!error) return { code: null, message: null, status: null };
  const e = error as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const message =
    typeof e.message === "string" && e.message.trim()
      ? e.message.trim().slice(0, 300)
      : String(error).slice(0, 300);
  const status =
    typeof e.status === "number"
      ? e.status
      : typeof e.statusCode === "number"
        ? e.statusCode
        : null;
  return {
    code: typeof e.code === "string" ? e.code : null,
    message,
    status,
  };
}

// -------------------------------------------------------------- device info
let deviceCache: Json | null = null;

function deviceInfo(): Json {
  if (deviceCache) return deviceCache;
  const nav = typeof navigator === "undefined" ? null : navigator;
  const ua = nav?.userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua) && /Version\//.test(ua)
          ? "Safari"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : "Other";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Other";
  deviceCache = {
    browser,
    os,
    mobile: /Mobi|Android|iPhone|iPad/.test(ua) ? 1 : 0,
    screen:
      typeof screen === "undefined" ? null : `${screen.width}x${screen.height}`,
    lang: nav?.language ?? null,
    // IANA timezone only. Never a location or an IP-derived value.
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
  };
  return deviceCache;
}

// ------------------------------------------------------------- module state
let queue: LogRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let disabled = false;
let missingTableStrikes = 0;
let identity: MonitorIdentity = {
  userId: null,
  userName: "",
  role: "",
  authUserId: null,
};
let sessionId = "";
let sessionStartedAt = 0;
let lastActivityAt = 0;
let activeMs = 0;
let listenersAttached = false;
let sessionRefs = 0;

function off(): boolean {
  if (disabled) return true;
  try {
    return localStorage.getItem(MONITORING_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

function ensureSession(): string {
  if (sessionId) return sessionId;
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(SESSION_KEY);
  } catch {
    // Storage unavailable — fall back to a per-page-load session id.
  }
  if (!stored) {
    stored =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      sessionStorage.setItem(SESSION_KEY, stored);
    } catch {
      // Ignore: the id stays in memory for this page load.
    }
  }
  sessionId = stored;
  sessionStartedAt = Date.now();
  lastActivityAt = sessionStartedAt;
  return sessionId;
}

function noteActivity() {
  const now = Date.now();
  // A gap longer than IDLE_GAP_MS is time the tab was left open but unused, so
  // it is excluded from active usage rather than counted as engagement.
  if (lastActivityAt && now - lastActivityAt <= IDLE_GAP_MS) {
    activeMs += now - lastActivityAt;
  }
  lastActivityAt = now;
}

// ------------------------------------------------------------------- queue
function enqueue(row: LogRow) {
  if (disabled || off()) return;
  try {
    noteActivity();
    queue.push(row);
    if (queue.length >= FLUSH_BATCH) {
      void flush("batch");
      return;
    }
    // Max-wait, not debounce: the timer is armed by the FIRST pending row and
    // deliberately NOT re-armed by later ones. Resetting it on every enqueue
    // meant a user clicking steadily could hold rows indefinitely, and the last
    // events of a session are exactly the ones an unload cancels.
    if (!flushTimer) {
      flushTimer = setTimeout(() => void flush("max-wait"), FLUSH_DEBOUNCE_MS);
    }
  } catch {
    // Monitoring must never surface an error to the dashboard.
  }
}

function baseRow(
  category: LogRow["category"],
  eventName: string,
  fields: MonitorFields = {},
): LogRow {
  const { code, message, status } = errorParts(fields.error);
  return {
    ts: new Date().toISOString(),
    session_id: ensureSession(),
    // Falls back to the Supabase Auth uid so a row is never anonymous just
    // because the network-backed admin/user lookup didn't resolve.
    user_id: identity.userId || identity.authUserId || null,
    auth_user_id: identity.authUserId ?? null,
    user_name: identity.userName || null,
    user_role: identity.role || null,
    category,
    event_name: eventName,
    success: fields.success === undefined ? null : fields.success,
    instructor_id: fields.instructorId ?? null,
    slot_date: fields.slotDate ?? null,
    slot_start: fields.slotStart ?? null,
    slot_end: fields.slotEnd ?? null,
    booking_id: fields.bookingId ?? null,
    error_code: fields.errorCode ?? code,
    error_message: fields.errorMessage ?? message,
    api_name: null,
    http_method: null,
    http_status: status,
    duration_ms: null,
    device: deviceInfo(),
    props: buildProps(fields),
  };
}

// `props` = redacted details, plus the customer name when the event has one.
// The name is merged in AFTER redaction and last, so nothing in `details` can
// overwrite it and the redactor cannot strip it. Trimmed and length-capped, but
// recorded: the customer name is the point of the booking events. Phone and
// address never get here.
function buildProps(fields: MonitorFields): Json | null {
  const redacted = fields.details ? (redact(fields.details) as Json) : null;
  const customerName = fields.customerName
    ? fields.customerName.trim().slice(0, 80)
    : "";
  if (!customerName) return redacted;
  return { ...(redacted ?? {}), customer_name: customerName };
}

export function trackEvent(
  eventName: string,
  fields: MonitorFields = {},
): void {
  enqueue(baseRow("user_action", eventName, fields));
}

export function trackApi(apiName: string, fields: ApiFields): void {
  const row = baseRow("api", apiName, fields);
  row.api_name = apiName;
  row.http_method = fields.method;
  row.duration_ms =
    fields.durationMs == null ? null : Math.round(fields.durationMs);
  // PostgREST doesn't expose the status on success, so record the caller's
  // status when it has one and otherwise record a nominal 200 — an explicit
  // null would read as "unknown" for every successful call in the report.
  row.http_status =
    fields.status ?? row.http_status ?? (fields.success === false ? null : 200);
  enqueue(row);
}

/** Unexpected/uncaught failures: React render throws, unhandled rejections. */
export function reportMonitoringError(
  eventName: string,
  error: unknown,
  details?: Json,
): void {
  enqueue(baseRow("error", eventName, { error, success: false, details }));
}

/**
 * Times an existing call and logs it, without changing what the call does.
 * PostgREST resolves `{ data, error }` instead of throwing, so a resolver maps
 * that shape to an error; otherwise `error` is read straight off the result.
 *
 * Deliberately `any` in and `any` out rather than a generic. As a generic it
 * inferred `unknown` at every call site (the callbacks wrap `sb`, which is
 * `any`, so there is no candidate to infer from), and `await`ing it then broke
 * destructuring -- `const { data, error } = ...` failed with "Property 'error'
 * does not exist on type 'unknown'". Monitoring must not degrade the types of
 * the code it wraps, so this restores exactly the pre-monitoring shape.
 */
export async function measureApi(
  apiName: string,
  // PromiseLike, not Promise: Supabase query builders are thenables, not real
  // Promises, so a Promise<T> parameter would not accept them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: () => PromiseLike<any>,
  options: {
    method?: string;
    details?: Json;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolveError?: (result: any) => unknown;
  } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const started =
    typeof performance === "undefined" ? Date.now() : performance.now();
  const done = (result: unknown, thrown: unknown) => {
    const durationMs =
      (typeof performance === "undefined" ? Date.now() : performance.now()) -
      started;
    const mapped =
      thrown ??
      (result === undefined ? null : options.resolveError?.(result)) ??
      null;
    trackApi(apiName, {
      method: options.method ?? "POST",
      success: !mapped,
      error: mapped,
      durationMs,
      details: options.details,
    });
  };
  try {
    const result = await fn();
    done(result, null);
    return result;
  } catch (error) {
    done(undefined, error);
    throw error;
  }
}

export function flushMonitoring(reason: string): void {
  void flush(reason);
}

/** Backfills identity onto rows queued before it resolved. Never overwrites a
 *  value that is already set. */
function stampIdentity(rows: LogRow[]): void {
  const userId = identity.userId || identity.authUserId || null;
  if (!userId && !identity.userName && !identity.role) return;
  for (const row of rows) {
    if (!row.user_id && !row.auth_user_id) {
      row.user_id = identity.userId || identity.authUserId || null;
      row.auth_user_id = identity.authUserId ?? null;
    }
    if (!row.user_name && identity.userName) row.user_name = identity.userName;
    if (!row.user_role && identity.role) row.user_role = identity.role;
  }
}

// -------------------------------------------------------------------- sink
function isMissingTable(error: unknown): boolean {
  const { code, message } = errorParts(error);
  if (code === "42P01" || code === "PGRST205") return true;
  return (
    /sales_dashboard_temporary_logs/.test(message ?? "") &&
    /not found|does not exist|schema cache/i.test(message ?? "")
  );
}

// Every key on a LogRow must be a real column of the table: PostgREST rejects a
// whole batch (PGRST204) if even one key -- even null -- has no column, and the
// generic failure path below drops it silently. That is how a `customer_name`
// column that only existed in an unapplied migration once stopped ALL logging.
// New per-event data therefore goes in `props` (JSONB), never in a new field.
async function flush(reason: string): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (disabled || queue.length === 0) return;
  // Rows are stamped at flush time too, not only when they are created. The
  // admin/user lookup and the Supabase Auth session both resolve
  // asynchronously, so an early session_start would otherwise be the one row
  // with no identity attached.
  stampIdentity(queue);

  const rows = queue;
  queue = [];
  // On the unload paths the browser cancels any in-flight request the moment
  // the document goes away, which silently cost us the tail of every session
  // (notably dashboard_closed, i.e. the wall/active time figures). keepalive
  // lets the request outlive the page. postgrest-js does not expose it, so
  // fetch is wrapped for this one call and restored immediately after.
  const unloading = UNLOAD_REASONS.has(reason);
  const realFetch = unloading ? globalThis.fetch : null;
  if (realFetch) {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(input, { ...init, keepalive: true })) as typeof fetch;
  }
  try {
    const { error } = await sb.from(MONITORING_TABLE).insert(rows);
    if (!error) return;
    if (isMissingTable(error)) {
      missingTableStrikes += 1;
      if (missingTableStrikes >= MISSING_TABLE_STRIKES) {
        // Migration not applied (or was dropped): stop trying for this page
        // load instead of failing a request per flush.
        disabled = true;
        if (import.meta.env.DEV) {
          console.info(
            `[temp-monitoring] disabled after ${missingTableStrikes} strikes (${reason}): table not found. Apply migration 20261002_000000_sales_dashboard_temporary_logs.sql to collect logs.`,
          );
        }
      }
      return;
    }
    // Any other failure (network, RLS) is dropped: the dashboard must not
    // block or retry-log because monitoring had a bad moment.
  } catch {
    // Swallowed on purpose.
  } finally {
    if (realFetch) globalThis.fetch = realFetch;
  }
}

// --------------------------------------------------------------- lifecycle
export function setMonitorIdentity(next: MonitorIdentity): void {
  identity = {
    userId: next.userId ?? null,
    userName: next.userName ?? "",
    role: next.role ?? "",
    authUserId: next.authUserId ?? null,
  };
}

/**
 * Fallback identity read straight from the Supabase session. The dashboard also
 * passes useAuth()'s user, but auth-context can legitimately hold `user: null`
 * while it rehydrates (or when the Go service is what authenticated the
 * session), and rows are written on a 4s debounce, so waiting for the React
 * identity is not always an option.
 */
async function hydrateAuthIdentity(): Promise<void> {
  if (identity.authUserId || identity.userId) return;
  try {
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user) return;
    const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
    setMonitorIdentity({
      userId: identity.userId,
      userName: identity.userName,
      role: identity.role || (typeof meta.role === "string" ? meta.role : ""),
      authUserId: data.user.id,
    });
  } catch {
    // No session, or auth is unreachable: rows stay unattributed rather than
    // blocking anything.
  }
}

function onWindowError(event: ErrorEvent) {
  reportMonitoringError("uncaught_error", event.error ?? event.message, {
    message: String(event.message ?? "").slice(0, 200),
    source: "window.error",
  });
}

function onUnhandledRejection(event: PromiseRejectionEvent) {
  reportMonitoringError("unhandled_rejection", event.reason, {
    source: "unhandledrejection",
  });
}

function onVisibilityChange() {
  if (document.visibilityState === "hidden") flushMonitoring("hidden");
}

function onPageHide() {
  // Best effort: the tab is going away, so this may not land. The 4s
  // debounce and the visibilitychange flush above are what make the
  // dashboard_closed row reliable in practice.
  flushMonitoring("pagehide");
}

/**
 * Starts session capture and installs the global error listeners.
 * Returns a stop() that writes session_end. Safe to call repeatedly: the
 * session id is reused, so React 19 StrictMode's double mount in dev does not
 * produce two sessions.
 */
export function startMonitoringSession(): () => void {
  if (disabled || off()) return () => {};
  ensureSession();
  void hydrateAuthIdentity();

  // Named handlers + a refcount, because these are window/document listeners:
  // attaching them once per module load and never detaching would keep
  // recording after the user navigates to another route.
  sessionRefs += 1;
  if (!listenersAttached && typeof window !== "undefined") {
    listenersAttached = true;
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
  }

  trackEvent("session_start", {
    success: true,
    details: {
      viewport:
        typeof window === "undefined"
          ? null
          : `${window.innerWidth}x${window.innerHeight}`,
    },
  });
  trackEvent("dashboard_opened", {
    details: {
      viewport:
        typeof window === "undefined"
          ? null
          : `${window.innerWidth}x${window.innerHeight}`,
    },
  });

  return () => {
    sessionRefs = Math.max(0, sessionRefs - 1);
    if (
      listenersAttached &&
      sessionRefs === 0 &&
      typeof window !== "undefined"
    ) {
      listenersAttached = false;
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    }
    const wallMs = Date.now() - sessionStartedAt;
    trackEvent("dashboard_closed", {
      success: true,
      details: {
        wall_ms: wallMs,
        active_ms: activeMs,
        idle_ms: Math.max(0, wallMs - activeMs),
        reason: "unmount",
      },
    });
    void flush("unmount");
  };
}
