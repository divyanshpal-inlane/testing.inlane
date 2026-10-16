// Pure input validators for the booking flow. No Deno imports — usable from the
// Node test harness and from any edge function.

export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return null;
}

export function isValidPhone(raw: unknown): boolean {
  const p = normalizePhone(raw);
  return p !== null && p.length === 10 && !p.startsWith("0");
}

export function isValidEmail(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

export function isValidPincode(raw: unknown): boolean {
  return typeof raw === "string" && /^[0-9]{6}$/.test(raw.trim());
}

export function isValidTime(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw);
}

export function isValidDateISO(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
}

export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 2 || trimmed.length > 120) return null;
  return trimmed;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// "Today" in IST (UTC+05:30) — used for all booking-day math so a learner in
// India doesn't see boundary-slipped dates.
export function istTodayISO(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export function dateToWeekdayLower(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString("en-US", { weekday: "long" })
    .toLowerCase();
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// "10:00 AM" — matches Instructor Management's timetable card (format12Hour).
export function minutesTo12Hour(totalMinutes: number): string {
  const h24 = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
}

// PostgREST/supabase-js rejections are plain objects ({ message, code, details,
// hint } or { data, error }) rather than Error instances, so String() turns them
// into "[object Object]" on screen — the exact bug that made location searches
// fail with a cryptic message. Normalizes any thrown/rejected value to one
// human-readable string, threading a PostgREST `code` (e.g. 23P01) in when the
// error carries one.
// AbortError / TimeoutError come from our own client-side request deadlines,
// not from Postgres, and their raw DOMException messages ("signal is aborted
// without reason", "signal timed out") are meaningless on screen. Map them to
// one actionable sentence so a hung request looks like a retryable failure
// instead of a blank "Loading schedule…" row or "[object Object]".
export function loadErrorToMessage(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") {
    return "Loading timed out. Check your connection and try again.";
  }
  return errorToMessage(err);
}

export function errorToMessage(
  err: unknown,
  fallback = "Unknown error",
): string {
  if (err == null) return fallback;
  if (typeof err === "string") {
    const t = err.trim();
    return t.length > 0 ? t : fallback;
  }
  if (err instanceof Error) {
    const m = err.message.trim();
    return m.length > 0 ? m : fallback;
  }
  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;
    const inner =
      obj.error != null && typeof obj.error === "object"
        ? (obj.error as Record<string, unknown>)
        : obj;
    if (inner != null && typeof inner === "object") {
      const raw = inner.message;
      if (typeof raw === "string") {
        const t = raw.trim();
        if (t.length > 0) {
          const code = typeof inner.code === "string" ? inner.code : null;
          return code ? `${t} (${code})` : t;
        }
      }
    }
  }
  return fallback;
}
