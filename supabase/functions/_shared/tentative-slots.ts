// Pure helpers for "Send Tentative Slots on WhatsApp". No Deno imports, so the
// Node test harness (tests/whatsapp-slots.test.mjs) can load this file.
//
// The Sales Dashboard preview uses src/lib/sales-dashboard/whatsappSlots.ts
// (buildSlotLines). The two MUST format identically -- the test compares them.

export interface TentativeRow {
  id: number;
  date: string; // "YYYY-MM-DD"
  start_time: string; // "HH:MM" or "HH:MM:SS"
  end_time: string;
  isTentative: boolean | null;
  tentative_details: Record<string, unknown> | null;
}

function clock12Parts(hhmm: string): { time: string; period: string } {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return {
    time: `${hour}:${String(m).padStart(2, "0")}`,
    period: h >= 12 ? "PM" : "AM",
  };
}

/** "7:00–8:00 AM", or "11:30 AM–12:30 PM" when the class crosses noon. */
function timeRange(start: string, end: string): string {
  const a = clock12Parts(start.slice(0, 5));
  const b = clock12Parts(end.slice(0, 5));
  return a.period === b.period
    ? `${a.time}–${b.time} ${b.period}`
    : `${a.time} ${a.period}–${b.time} ${b.period}`;
}

/** "Sat 17 Oct". UTC math so the server's timezone cannot shift the date. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Sorted, de-duplicated and grouped by day: "Sat 17 Oct: 6:30–7:30 AM,
 * 5:30–6:30 PM". One entry per day.
 */
export function formatSlotLines(
  slots: { date: string; start_time: string; end_time: string }[],
): string[] {
  const seen = new Set<string>();
  const unique = slots
    .filter((s) => {
      const key = `${s.date}|${s.start_time.slice(0, 5)}|${s.end_time.slice(0, 5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`),
    );
  const byDay = new Map<string, string[]>();
  for (const s of unique) {
    const list = byDay.get(s.date) ?? [];
    list.push(timeRange(s.start_time, s.end_time));
    byDay.set(s.date, list);
  }
  return [...byDay].map(
    ([date, times]) => `${shortDate(date)}: ${times.join(", ")}`,
  );
}

/** 10-digit Indian mobile from the formats the DB stores, else null. */
export function normalizeIndianMobile(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  const local =
    d.length === 12 && d.startsWith("91")
      ? d.slice(2)
      : d.length === 11 && d.startsWith("0")
        ? d.slice(1)
        : d;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

/** Today in IST (UTC+05:30) as YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export type SendPlan =
  | { ok: true; phone: string; name: string; rows: TentativeRow[] }
  | {
      ok: false;
      code:
        | "NO_ROWS"
        | "NOT_TENTATIVE"
        | "NO_UPCOMING"
        | "NO_PHONE"
        | "MIXED_CUSTOMERS";
      error: string;
    };

/**
 * Decides who gets the message and which classes it lists, from the Schedule
 * rows the caller pointed at. The phone ONLY ever comes from the rows
 * (tentative_details.phone), never from the caller.
 */
export function planTentativeSlotsMessage(
  rows: TentativeRow[],
  todayIso: string,
): SendPlan {
  if (rows.length === 0) {
    return { ok: false, code: "NO_ROWS", error: "No matching booking found." };
  }
  if (rows.some((r) => !r.isTentative)) {
    return {
      ok: false,
      code: "NOT_TENTATIVE",
      error: "Only tentative slots can be shared.",
    };
  }
  const upcoming = rows.filter((r) => r.date >= todayIso);
  if (upcoming.length === 0) {
    return {
      ok: false,
      code: "NO_UPCOMING",
      error: "There are no upcoming tentative slots to send.",
    };
  }
  const phones = new Set<string>();
  for (const r of upcoming) {
    const p = normalizeIndianMobile(r.tentative_details?.phone);
    if (p) phones.add(p);
  }
  if (phones.size === 0) {
    return {
      ok: false,
      code: "NO_PHONE",
      error: "No phone number is saved for this booking.",
    };
  }
  if (phones.size > 1) {
    return {
      ok: false,
      code: "MIXED_CUSTOMERS",
      error: "These slots belong to different customers.",
    };
  }
  const phone = [...phones][0];
  const name =
    upcoming
      .map((r) => r.tentative_details?.name)
      .find((n): n is string => typeof n === "string" && n.trim() !== "")
      ?.trim() ?? "";
  return { ok: true, phone, name, rows: upcoming };
}
