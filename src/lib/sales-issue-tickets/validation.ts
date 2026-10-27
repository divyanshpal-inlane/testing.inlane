// Keep in sync with supabase/functions/_shared/sales-issue-tickets.ts (the
// server re-validates everything; this only gives instant feedback).

export const TICKET_STATUSES = ["To Do", "In Progress", "Resolved"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const MAX_DESCRIPTION_LENGTH = 2000;

/** Indian mobile with optional +91 / 91 / 0 prefix. Returns 10 digits or null. */
export function normalizeTicketPhone(input: string): string | null {
  const cleaned = input.trim();
  if (!cleaned || /[^0-9+\s\-().]/.test(cleaned)) return null;
  let digits = cleaned.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0"))
    digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function validatePhone(input: string): string | null {
  if (!input.trim()) return "Phone number is required.";
  return normalizeTicketPhone(input)
    ? null
    : "Enter a valid 10-digit mobile number (starting 6-9).";
}

export function validateDescription(input: string): string | null {
  return input.trim().length > MAX_DESCRIPTION_LENGTH
    ? `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`
    : null;
}
