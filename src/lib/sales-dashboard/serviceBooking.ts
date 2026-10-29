// "Book classes for a service": turning an existing learner + one of their
// services (an enrollment) into a prefilled tentative booking on the Sales
// Dashboard. Pure helpers only (no React, no Supabase) so they are unit tested.

export type PaymentStatusValue = "unpaid" | "half_paid" | "full_paid";

/** What the dashboard needs to start booking classes for a service. */
export interface BookingIntent {
  learnerId: string;
  name: string;
  /** As stored on the learner (any of the 10-digit / 91.. / +91.. forms). */
  phone: string;
  email?: string;
  /** The enrollment this booking is for; saved on every class of the booking. */
  enrollmentId: string;
  /** "Beginner Course", "Top-up classes (4)"... shown on the slot and banner. */
  serviceLabel: string;
  /** How many classes the service covers, when known. */
  classes: number | null;
  paymentStatus: PaymentStatusValue;
}

/** enrollment.payment_status -> the booking form's payment status. */
export function paymentStatusOf(
  status: string | null | undefined,
): PaymentStatusValue {
  if (status === "full_paid") return "full_paid";
  if (status === "half_paid") return "half_paid";
  return "unpaid";
}

/** Last 10 digits of a stored phone, or null if there are fewer than 10. */
export function tenDigitPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** The booking-form fields an intent fills in (everything else stays default). */
export function intentToFormFields(intent: BookingIntent) {
  const phone = tenDigitPhone(intent.phone);
  return {
    customerName: intent.name,
    customerPhone: phone ?? intent.phone,
    // The number comes from the learner record, not typed by hand: accounts
    // that may not see full numbers get it masked and read-only.
    phoneFromCrm: Boolean(phone),
    customerEmail: intent.email || undefined,
    paymentStatus: intent.paymentStatus,
    enrollmentId: intent.enrollmentId,
    serviceLabel: intent.serviceLabel,
  };
}

/** "Beginner Course · 10 classes" for banners and chips. */
export function describeIntent(intent: BookingIntent): string {
  const n = intent.classes;
  return n && n > 0
    ? `${intent.serviceLabel} · ${n} class${n === 1 ? "" : "es"}`
    : intent.serviceLabel;
}

/** Instructor Management's wording for the same three states. */
export function paidInfoLabel(status: PaymentStatusValue): string {
  if (status === "full_paid") return "Full paid";
  if (status === "half_paid") return "Half paid";
  return "Unpaid";
}

/**
 * The tentative_details patch that links a booking to a service.
 *
 * A slot's payment label is never typed in: it is the payment status of the
 * service the slot is linked to. So linking also writes that status, in both
 * spellings the app reads (`payment_status` for the Sales Dashboard,
 * `paid_info` for Instructor Management). The customer details and creator are
 * left alone.
 */
export function serviceLinkPatch(link: {
  enrollmentId: string;
  serviceLabel: string;
  paymentStatus?: PaymentStatusValue;
}): Record<string, string> {
  return {
    enrollment_id: link.enrollmentId,
    service_label: link.serviceLabel,
    ...(link.paymentStatus
      ? {
          payment_status: link.paymentStatus,
          paid_info: paidInfoLabel(link.paymentStatus),
        }
      : {}),
  };
}

const COURSE_TOPICS = ["beginner", "flyover", "parking", "slopes", "traffic"];

/**
 * Which course topics a piece of text names, e.g. "Comprehensive/Beginner's
 * course" -> ["beginner"], "Parking + Flyover" -> ["flyover", "parking"].
 * "Comprehensive" is the older name of the Beginner course.
 */
export function courseTopics(text: string | null | undefined): string[] {
  const t = (text ?? "").toLowerCase();
  const found = new Set<string>();
  for (const topic of COURSE_TOPICS) if (t.includes(topic)) found.add(topic);
  if (t.includes("comprehensive")) found.add("beginner");
  return [...found].sort();
}

/**
 * The learner's service that a booking's free-text course most likely means:
 * the ONE service whose topics are exactly the topics in the text. Returns null
 * when nothing matches or more than one does, so a suggestion is never a guess
 * between several. Top-ups and licence services name no topics and never match.
 */
export function suggestService<T extends { label: string }>(
  courseText: string | null | undefined,
  services: readonly T[],
): T | null {
  const wanted = courseTopics(courseText);
  if (wanted.length === 0) return null;
  const key = wanted.join("|");
  const matches = services.filter(
    (s) => courseTopics(s.label).join("|") === key,
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * The service a slot should be linked to by default.
 *
 *  - the ONE service whose topics match the booking's course text (see
 *    suggestService), else
 *  - when `allowSingle`, the learner's only service.
 *
 * Returns null when it would be a guess between several, so nothing is linked
 * silently to the wrong order. `allowSingle` is true on the booking form (the
 * user sees and can change the choice) and, in the slot panel, only when the
 * slot names no course at all (an unrelated note must not be overridden).
 */
export function defaultServiceFor<T extends { label: string }>(
  courseText: string | null | undefined,
  services: readonly T[],
  opts: { allowSingle: boolean },
): T | null {
  const suggested = suggestService(courseText, services);
  if (suggested) return suggested;
  if (opts.allowSingle && services.length === 1) return services[0];
  return null;
}
