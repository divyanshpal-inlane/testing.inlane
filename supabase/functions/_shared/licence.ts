// Licence / RTO services (enrollment.case_type = 'rto_only') paid through the
// online payment link.
//
// A licence service is an enrollment with NO course and NO lessons. The course
// payment path assumes the opposite (it unlocks lessons, rewrites `progress`
// and opens an LL application), so a licence enrollment must be recognised and
// handled separately:
//   - process-payment / create-razorpay-order: validate it and attach the new
//     payment to it (enrollment.payment_id), exactly like a course does.
//   - complete-payment / payment-callback: on success just mark it paid and
//     active; no lessons, no progress rewrite, no LL journey.
//
// Every other payment type and every course enrollment is untouched: the guard
// is `case_type === 'rto_only'`, which only enrollments created by the
// "Licence service" tab (or the Create Learner RTO-only case) carry.

export interface LicenceEnrollmentLike {
  id?: string | null;
  learner_id?: string | null;
  case_type?: string | null;
  payment_status?: string | null;
  amount?: number | null;
}

export function isLicenceEnrollment(
  enrollment: LicenceEnrollmentLike | null | undefined,
): boolean {
  return !!enrollment && enrollment.case_type === "rto_only";
}

/**
 * Rejects a payment that does not match the licence service it names: wrong
 * learner, already paid, no fee set, or a tampered amount (the browser sends
 * the amount, so it is checked against the enrollment, like courses are).
 */
export function assertLicencePayable(
  enrollment: LicenceEnrollmentLike,
  learnerId: string,
  amount: number,
): void {
  if (enrollment.learner_id !== learnerId) {
    throw new Error("This licence service belongs to a different learner.");
  }
  if (enrollment.payment_status === "full_paid") {
    throw new Error("This licence service is already paid for.");
  }
  const expected = Math.round(Number(enrollment.amount) || 0);
  if (expected <= 0) {
    throw new Error("This licence service has no fee set.");
  }
  if (Math.abs(Math.round(Number(amount) || 0) - expected) > 1) {
    throw new Error(
      `Amount mismatch: this licence service costs ₹${expected}, not ₹${Math.round(
        Number(amount) || 0,
      )}.`,
    );
  }
}
