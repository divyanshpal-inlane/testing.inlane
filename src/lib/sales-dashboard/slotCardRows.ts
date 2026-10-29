// Small pure helpers for the slot panel's details card. Kept out of
// SalesDashboard.tsx so they can be unit tested.

export interface CardRow {
  label: string;
  value: string;
}

/** An ISO timestamp as "25 Oct, 6:05 AM" in local time; "" when absent / bad. */
export function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${day}, ${time}`;
}

/** "payment" -> "Payment": a stored value read as the start of a sentence. */
export function sentenceCase(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/**
 * The rows that explain a paused class: why it was paused, and any note. The
 * reason column and the free-text note can hold the same word ("other"), so the
 * note is only listed when it adds something.
 */
export function pauseRows(
  pauseReason: string | null | undefined,
  notes: string | null | undefined,
): CardRow[] {
  const reason = (pauseReason ?? "").trim();
  const note = (notes ?? "").trim();
  const rows: CardRow[] = [];
  if (reason) rows.push({ label: "Reason", value: sentenceCase(reason) });
  else if (note) rows.push({ label: "Reason", value: sentenceCase(note) });
  if (reason && note && note.toLowerCase() !== reason.toLowerCase()) {
    rows.push({ label: "Notes", value: note });
  }
  return rows;
}
