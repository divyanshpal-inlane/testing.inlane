// Validation for "Record manual payment" (cash / UPI / bank transfer taken
// outside the payment link). Pure, so it is unit tested. The edge function
// `record-manual-payment` repeats every rule; this is only the early, friendly
// version of it.

export const MANUAL_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card (swipe machine)" },
  { value: "other", label: "Other" },
] as const;

export type ManualMethod = (typeof MANUAL_METHODS)[number]["value"];

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PROOF_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** UPI and bank transfers always have a UTR / transaction number. */
export function referenceRequired(method: string): boolean {
  return method === "upi" || method === "bank_transfer";
}

export function validateProofFile(
  file: { type: string; size: number } | null | undefined,
): string | null {
  if (!file) return "Attach the proof image.";
  if (!PROOF_TYPES.includes(file.type)) {
    return "The proof must be an image (JPG, PNG or WebP).";
  }
  if (file.size <= 0) return "That image is empty.";
  if (file.size > PROOF_MAX_BYTES) return "The image is larger than 5 MB.";
  return null;
}

export function validateManualPayment(input: {
  method: string;
  utr: string;
  paidOn: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
  file: { type: string; size: number } | null | undefined;
}): string | null {
  if (!MANUAL_METHODS.some((m) => m.value === input.method)) {
    return "Pick how the money was received.";
  }
  if (referenceRequired(input.method) && !input.utr.trim()) {
    return "Enter the UTR / transaction number.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) {
    return "Enter the date the money was received.";
  }
  if (input.paidOn > input.today) {
    return "The received date cannot be in the future.";
  }
  return validateProofFile(input.file);
}

/** Storage path for a proof: <learner id>/<order id>/<time>-<safe name>. */
export function proofPathFor(
  learnerId: string,
  enrollmentId: string,
  fileName: string,
  now = Date.now(),
): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "jpg";
  const safeExt = /^[a-z0-9]{2,5}$/.test(ext) ? ext : "jpg";
  return `${learnerId}/${enrollmentId}/${now}.${safeExt}`;
}
