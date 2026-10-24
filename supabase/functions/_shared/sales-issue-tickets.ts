// Pure helpers for the sales-issue-tickets edge function (no Deno APIs, so the
// Node unit test tests/sales-issue-tickets.test.mjs can load this file).
// Keep PHONE rules in sync with src/lib/sales-issue-tickets/validation.ts.

export const TICKET_STATUSES = ["To Do", "In Progress", "Resolved"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const MAX_DESCRIPTION_LENGTH = 2000;
export const SUPPORT_EMAIL_DEFAULT = "support@inlane.in";

export function isTicketStatus(value: unknown): value is TicketStatus {
  return (
    typeof value === "string" &&
    (TICKET_STATUSES as readonly string[]).includes(value)
  );
}

// Indian mobile: optional +91 / 91 / 0 prefix, spaces/dashes/brackets allowed,
// then 10 digits starting 6-9. Returns the bare 10 digits, or null.
export function normalizeTicketPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.trim();
  if (!cleaned || /[^0-9+\s\-().]/.test(cleaned)) return null;
  let digits = cleaned.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0"))
    digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function cleanDescription(
  input: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== "string")
    return { ok: false, error: "Description must be text." };
  const value = input.trim();
  if (value.length > MAX_DESCRIPTION_LENGTH)
    return {
      ok: false,
      error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
    };
  return { ok: true, value: value || null };
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Never persist or return credentials: redact secrets and cap the length.
export function sanitizeError(error: unknown, secrets: string[] = []): string {
  let message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  for (const secret of secrets) {
    if (secret && secret.length >= 4)
      message = message.split(secret).join("***");
  }
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "Unknown error";
}

export interface TicketEmailInput {
  ticketNumber: string;
  phoneNumber: string;
  description: string | null;
  createdAt: string; // ISO UTC
  raisedBy: string; // display text: name and/or e-mail
  status: string;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const ist = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
  return `${ist} IST (${d.toISOString().replace("T", " ").slice(0, 16)} UTC)`;
}

export function buildTicketEmail(t: TicketEmailInput) {
  const description = t.description ?? "No description provided";
  const when = formatWhen(t.createdAt);
  const subject = `[Sales Support Ticket] ${t.ticketNumber} — ${t.phoneNumber}`;

  const text = [
    `Ticket ID: ${t.ticketNumber}`,
    `Phone number: ${t.phoneNumber}`,
    `Issue description: ${description}`,
    `Raised on: ${when}`,
    `Raised by: ${t.raisedBy}`,
    `Status: ${t.status}`,
  ].join("\n");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px;color:#555;white-space:nowrap;vertical-align:top"><b>${label}</b></td>` +
    `<td style="padding:6px 12px;vertical-align:top">${value}</td></tr>`;

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#222;line-height:1.5">
<div style="max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:6px">
<h2 style="color:#2563eb;margin-top:0">New Sales Support Ticket</h2>
<table style="border-collapse:collapse;width:100%">
${row("Ticket ID", escapeHtml(t.ticketNumber))}
${row("Phone number", escapeHtml(t.phoneNumber))}
${row("Issue description", `<span style="white-space:pre-wrap">${escapeHtml(description)}</span>`)}
${row("Raised on", escapeHtml(when))}
${row("Raised by", escapeHtml(t.raisedBy))}
${row("Status", escapeHtml(t.status))}
</table>
<p style="color:#777;font-size:12px;margin-bottom:0">Reply to this e-mail to reach the person who raised the ticket (when their e-mail is on file).</p>
</div></body></html>`;

  return { subject, text, html };
}
