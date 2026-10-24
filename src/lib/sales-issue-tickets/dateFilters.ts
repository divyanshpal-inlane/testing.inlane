// Date presets for the ticket list. All boundaries are LOCAL calendar days
// (the viewer's timezone) converted to UTC instants for the database query:
//   created_at >= start-of-first-day  AND  created_at < start-of-day-after-last-day
// so tickets on BOTH the first and last selected day are included.

export type DatePreset =
  | "today"
  | "last15"
  | "last30"
  | "lastMonth"
  | "custom"
  | "all";

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "today", label: "Today / Last 1 Day" },
  { value: "last15", label: "Last 15 Days" },
  { value: "last30", label: "Last 30 Days" },
  { value: "lastMonth", label: "Last 1 Month" },
  { value: "custom", label: "Custom Date Range" },
  { value: "all", label: "All Dates" },
];

export interface DateRange {
  /** inclusive lower bound (ISO UTC) or null = unbounded */
  from: string | null;
  /** exclusive upper bound (ISO UTC) or null = unbounded */
  to: string | null;
}

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Same day-of-month one month earlier, clamped (31 Mar -> 28/29 Feb). */
export function subtractOneMonth(d: Date): Date {
  const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const m = d.getMonth() === 0 ? 11 : d.getMonth() - 1;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), lastDay));
}

/** Parse "YYYY-MM-DD" (an <input type="date"> value) as a LOCAL date. */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
    ? date
    : null;
}

export function validateCustomRange(start: string, end: string): string | null {
  if (!start || !end) return "Pick both a start and an end date.";
  const s = parseDateInput(start);
  const e = parseDateInput(end);
  if (!s || !e) return "Enter valid dates.";
  if (s.getTime() > e.getTime())
    return "Start date must not be after end date.";
  return null;
}

/**
 * Resolve a preset to a DB range. Definitions (today counts as day 1):
 *  - today:     today only
 *  - last15:    today + the preceding 14 calendar days
 *  - last30:    today + the preceding 29 calendar days
 *  - lastMonth: the same calendar date one month ago through today
 *               (31 Mar -> 28 Feb), distinct from last30
 *  - custom:    start..end inclusive (null when the range is invalid/incomplete)
 */
export function resolveDateRange(
  preset: DatePreset,
  now: Date = new Date(),
  custom?: { start: string; end: string },
): DateRange | null {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1).toISOString();
  switch (preset) {
    case "all":
      return { from: null, to: null };
    case "today":
      return { from: today.toISOString(), to: tomorrow };
    case "last15":
      return { from: addDays(today, -14).toISOString(), to: tomorrow };
    case "last30":
      return { from: addDays(today, -29).toISOString(), to: tomorrow };
    case "lastMonth":
      return { from: subtractOneMonth(today).toISOString(), to: tomorrow };
    case "custom": {
      if (!custom || validateCustomRange(custom.start, custom.end)) return null;
      const s = parseDateInput(custom.start)!;
      const e = parseDateInput(custom.end)!;
      return { from: s.toISOString(), to: addDays(e, 1).toISOString() };
    }
  }
}

/** Strip characters that are special in a PostgREST `or=(...)`/ilike filter. */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[%*,()_"'\\]/g, "").trim();
}
