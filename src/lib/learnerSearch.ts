// Finding a learner when the team does NOT know (or may not see) phone numbers.
// Pure helpers only, so they are unit tested.

export type LookupKind = "pay" | "link" | "phone" | "utr" | "name";

/**
 * What a typed search string is:
 *  - PAY-... a Payment ID,  LNK-... a Link ID
 *  - a 10-13 digit number (optionally +91 / spaces / dashes): a phone number
 *  - a long letters+digits token with no spaces: a bank / UPI reference (UTR)
 *  - anything else (names, e-mails): a name / e-mail search
 */
export function classifyLookup(raw: string): LookupKind {
  const q = raw.trim();
  if (/^PAY-/i.test(q)) return "pay";
  if (/^LNK-/i.test(q)) return "link";
  const digits = q.replace(/\D/g, "");
  if (/^[+\d\s()-]+$/.test(q)) {
    // Digits only. A phone is 10 digits, or 91 + 10, or +country-code form.
    // Any other long run of digits is a bank / UPI reference (a UPI RRN is 12
    // digits, so 12 digits is a UTR unless it starts with 91).
    if (digits.length === 10) return "phone";
    if (digits.length === 12 && digits.startsWith("91")) return "phone";
    if (q.startsWith("+") && digits.length >= 11 && digits.length <= 13) {
      return "phone";
    }
    if (digits.length >= 8) return "utr";
    return "name";
  }
  const compact = q.replace(/[\s-]+/g, "");
  if (
    !/\s/.test(q) &&
    !q.includes("@") &&
    /^[A-Za-z0-9]+$/.test(compact) &&
    /\d/.test(compact) &&
    compact.length >= 8
  ) {
    return "utr";
  }
  return "name";
}

/** Characters that would break a PostgREST `or(...)` filter value. */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .trim()
    .replace(/[,()*%\\"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A name / e-mail search needs at least this many characters. */
export const MIN_NAME_SEARCH_LENGTH = 3;

/** The PostgREST `or` filter for a name / e-mail search, or null if too short. */
export function nameSearchFilter(raw: string): string | null {
  const term = sanitizeSearchTerm(raw);
  if (term.length < MIN_NAME_SEARCH_LENGTH) return null;
  return `name.ilike.%${term}%,email.ilike.%${term}%`;
}
