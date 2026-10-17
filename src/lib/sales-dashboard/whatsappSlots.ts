import { supabase } from "@/lib/supabaseClient";

/** One class to tell the customer about. Times are "HH:MM" (24h), date is ISO. */
export interface WhatsAppSlot {
  date: string;
  startTime: string;
  endTime: string;
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
  const a = clock12Parts(start);
  const b = clock12Parts(end);
  return a.period === b.period
    ? `${a.time}–${b.time} ${b.period}`
    : `${a.time} ${a.period}–${b.time} ${b.period}`;
}

/** "Mon 20 Oct". Pure UTC math so the browser's timezone can't shift it. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Sorted, de-duplicated and grouped by day, exactly as the customer will see
 * them: "Sat 17 Oct: 6:30–7:30 AM, 5:30–6:30 PM". One entry per day.
 */
export function buildSlotLines(slots: WhatsAppSlot[]): string[] {
  const seen = new Set<string>();
  const unique = slots
    .filter((s) => {
      const key = `${s.date}|${s.startTime}|${s.endTime}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`),
    );
  const byDay = new Map<string, string[]>();
  for (const s of unique) {
    const list = byDay.get(s.date) ?? [];
    list.push(timeRange(s.startTime, s.endTime));
    byDay.set(s.date, list);
  }
  return [...byDay].map(
    ([date, times]) => `${longDate(date)}: ${times.join(", ")}`,
  );
}

/** Which saved tentative rows to message: their Schedule ids, or a batch id. */
export type WhatsAppTarget =
  | { scheduleIds: number[]; batchId?: undefined }
  | { batchId: string; scheduleIds?: undefined };

/**
 * Sends the customer their tentative slots through the integrated WhatsApp
 * system. Only booking ids go to the server (`instructor-slot-booking`,
 * action `sendTentativeSlots`): it checks the caller is staff, reads the
 * customer's REAL phone from the booking, builds the message and sends it.
 * The number never reaches the browser, so agents who only see masked phones
 * can still use this. Resolves with the masked number it was sent to, throws
 * an Error with a readable message otherwise.
 */
export async function sendTentativeSlotsWhatsApp(
  target: WhatsAppTarget,
): Promise<{ sentTo: string; classes: number }> {
  const hasIds = (target.scheduleIds?.length ?? 0) > 0;
  if (!hasIds && !target.batchId) {
    throw new Error("There are no saved slots to send.");
  }

  const { data, error } = await supabase.functions.invoke(
    "instructor-slot-booking",
    {
      body: {
        action: "sendTentativeSlots",
        ...(hasIds
          ? { scheduleIds: target.scheduleIds }
          : { batchId: target.batchId }),
      },
    },
  );
  if (error) {
    // FunctionsHttpError hides the real reason inside the response body.
    let reason = error.message;
    try {
      const body = await (
        error as unknown as { context?: Response }
      ).context?.json();
      if (body?.error) reason = String(body.error);
    } catch {
      /* keep the generic message */
    }
    throw new Error(reason);
  }
  const payload = data as {
    success?: boolean;
    error?: string;
    sentTo?: string;
    classes?: number;
  } | null;
  if (!payload || payload.success === false) {
    throw new Error(payload?.error ?? "WhatsApp message was not accepted.");
  }
  return { sentTo: payload.sentTo ?? "", classes: payload.classes ?? 0 };
}
