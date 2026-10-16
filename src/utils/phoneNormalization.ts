/**
 * Phone Number Normalization & Duplicate Detection Utility
 *
 * Handles all phone number formats:
 * - 8344261941 (10 digits only)
 * - 918344261941 (with country code, no +)
 * - +918344261941 (E.164 format with +)
 *
 * All formats are normalized to last 10 digits for comparison
 */

/**
 * Extract last 10 digits from any phone format
 *
 * @param phone - Phone number in any format
 * @returns Last 10 digits of the phone number
 *
 * @example
 * normalizePhoneLast10("8344261941") → "8344261941"
 * normalizePhoneLast10("918344261941") → "8344261941"
 * normalizePhoneLast10("+918344261941") → "8344261941"
 */
export function normalizePhoneLast10(phone: string): string {
  const digits = phone.replace(/\D/g, ""); // Remove all non-digits
  return digits.slice(-10); // Take last 10 digits
}

/**
 * Convert phone to E.164 format (+91XXXXXXXXXX)
 *
 * @param phone - Phone number in any format
 * @returns Phone in E.164 format
 *
 * @example
 * normalizePhoneE164("8344261941") → "+918344261941"
 * normalizePhoneE164("918344261941") → "+918344261941"
 * normalizePhoneE164("+918344261941") → "+918344261941"
 */
export function normalizePhoneE164(phone: string): string {
  const last10 = normalizePhoneLast10(phone);
  return `+91${last10}`;
}

/**
 * Generate all possible phone formats from any input
 * Useful for checking if a phone exists in database with different formats
 *
 * @param phone - Phone number in any format
 * @returns Array of possible phone formats
 *
 * @example
 * getAllPhoneFormats("8344261941") → [
 *   "8344261941",
 *   "918344261941",
 *   "+918344261941"
 * ]
 */
export function getAllPhoneFormats(phone: string): string[] {
  const last10 = normalizePhoneLast10(phone);
  return [
    last10, // 10 digits only: "8344261941"
    `91${last10}`, // With country code: "918344261941"
    `+91${last10}`, // E.164 format: "+918344261941"
  ];
}

/**
 * Check if two phones are the same (after normalization)
 *
 * @param phone1 - First phone number
 * @param phone2 - Second phone number
 * @returns true if both normalize to the same 10 digits
 *
 * @example
 * isSamePhone("8344261941", "+918344261941") → true
 * isSamePhone("8344261941", "9876543210") → false
 */
export function isSamePhone(phone1: string, phone2: string): boolean {
  return normalizePhoneLast10(phone1) === normalizePhoneLast10(phone2);
}

/**
 * Validate phone number format (must have at least 10 digits)
 *
 * @param phone - Phone number to validate
 * @returns true if valid, false otherwise
 *
 * @example
 * isValidPhone("8344261941") → true
 * isValidPhone("123") → false
 */
export function isValidPhone(phone: string): boolean {
  const last10 = normalizePhoneLast10(phone);
  return last10.length === 10 && /^\d{10}$/.test(last10);
}
