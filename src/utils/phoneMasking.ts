export function maskCarNumber(carNumber: string | null | undefined): string {
  if (!carNumber) {
    return "XXXXXXXX";
  }

  // Remove spaces/hyphens for processing
  const cleaned = carNumber.replace(/[\s-]/g, "");

  if (cleaned.length < 2) {
    return "XXXXXXXX";
  }

  // Show last 2 characters, mask the rest with X (consistent with phone masking)
  const visiblePart = cleaned.slice(-2);
  const maskedCount = cleaned.length - 2;
  const xMask = "X".repeat(maskedCount);

  return `${xMask}${visiblePart}`;
}

export function maskPhoneNumber(
  phoneNumber: string | null | undefined,
): string {
  if (!phoneNumber) {
    return "XXXXXXXXXX";
  }

  const cleanedPhone = phoneNumber.replace(/\D/g, "");

  if (cleanedPhone.length < 2) {
    return "XXXXXXXXXX";
  }

  const lastTwoDigits = cleanedPhone.slice(-2);
  return `XXXXXXXXX${lastTwoDigits}`;
}

export function maskPhoneNumberCustom(
  phoneNumber: string | null | undefined,
  visibleDigits: number = 2,
): string {
  if (!phoneNumber) {
    return "XXXXXXXXXX";
  }

  const cleanedPhone = phoneNumber.replace(/\D/g, "");

  if (cleanedPhone.length < visibleDigits) {
    return "XXXXXXXXXX";
  }

  const visiblePart = cleanedPhone.slice(-visibleDigits);
  const maskedCount = 10 - visibleDigits;
  const xMask = "X".repeat(maskedCount);

  return `${xMask}${visiblePart}`;
}
