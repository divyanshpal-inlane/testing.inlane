import type { useToast } from "@/components/ui/use-toast";
import {
  LICENCE_NEED_LABEL,
  licenceLabel,
  type LicenceNeed,
  type Vehicle,
} from "@/lib/licenceLabel";
import { supabase } from "@/lib/supabaseClient";

import { PREDEFINED_COURSES } from "./CreateLearnerDialog";
import { ENROLLMENT_SELECT, EnrollmentRecord } from "./enrollmentActions";
import { copyText, logPaymentLink } from "./paymentTrace";

// Additional services for an EXISTING customer: another course package, or
// top-up classes. Each service gets its OWN enrollment (and therefore its own
// payment record); the learner row, phone and earlier enrollments are never
// touched, so no duplicate customer or lead is created.
//
// Why this needs no backend change:
//  - process-payment keys course payments on (learner, course_id): a different
//    course = a new enrollment, the same course = the pending one is reused.
//  - top-ups already create / reuse a pending `progress.type = "topup"`
//    enrollment, which is what we pre-create here so the link, the enrollment
//    and the payment line up.

type Toast = ReturnType<typeof useToast>["toast"];

export const DEFAULT_TOPUP_PRICE_PER_CLASS = 599;
const BASE_URL = "https://inlane-web-app.vercel.app";

export interface ServiceLearner {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export type ServicePlan = "full" | "half" | "custom";

export function splitAmount(
  plan: ServicePlan,
  total: number,
  customDueNow: number,
): { total: number; dueNow: number; second: number } {
  const t = Math.max(0, Math.round(total) || 0);
  const dueNow =
    plan === "full"
      ? t
      : plan === "half"
        ? Math.round(t / 2)
        : Math.min(t, Math.round(customDueNow) || 0);
  return { total: t, dueNow, second: Math.max(0, t - dueNow) };
}

/** All of a learner's enrollments (their services), newest first. */
export async function listLearnerServices(
  learnerId: string,
): Promise<EnrollmentRecord[]> {
  const { data, error } = await supabase
    .from("enrollment")
    .select(ENROLLMENT_SELECT)
    .eq("learner_id", learnerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as EnrollmentRecord[];
}

/** Human label for an enrollment in the "existing services" list. */
export function serviceLabel(e: EnrollmentRecord): string {
  if (e.Courses?.name) return e.Courses.name;
  if (e.case_type === "rto_only") return licenceLabel(e);
  const t = (e as { progress?: { type?: string; total_hours?: number } })
    .progress;
  if (t?.type === "topup") return `Top-up (${t.total_hours ?? "?"} classes)`;
  if (t?.type === "demo") return "Demo class";
  if (t?.type === "custom") return "Custom course";
  return "Service";
}

/**
 * Creates a pending enrollment for another course package. Refuses a course
 * the learner already has: a fully-paid one cannot be bought again, and a
 * pending one should be re-sent / edited instead of duplicated.
 */
export async function createCourseAddOn(args: {
  learner: ServiceLearner;
  courseId: string;
  plan: ServicePlan;
  total: number;
  customDueNow: number;
  existing: EnrollmentRecord[];
}): Promise<{ enrollmentId: string; courseName: string; dueNow: number }> {
  const course = PREDEFINED_COURSES.find((c) => c.id === args.courseId);
  if (!course) throw new Error("Pick a course package.");

  const same = args.existing.find((e) => e.course_id === args.courseId);
  if (same) {
    throw new Error(
      same.payment_status === "full_paid"
        ? `${course.name} is already fully paid for this customer.`
        : `This customer already has a pending ${course.name}. Use "Send Payment Link" or "Edit" on it instead of adding a second one.`,
    );
  }

  const { total, dueNow, second } = splitAmount(
    args.plan,
    args.total,
    args.customDueNow,
  );
  if (total < 1 || dueNow < 1) {
    throw new Error("Total and amount due now must be at least ₹1.");
  }

  const { data, error } = await supabase
    .from("enrollment")
    .insert([
      {
        learner_id: args.learner.id,
        course_id: args.courseId,
        amount: total,
        payment_status: "pending",
        installment_mode: args.plan === "full" ? "full" : "installment",
        installment1_amount: dueNow,
        installment2_amount: second,
        unlocked_lessons: [],
        progress: { type: "course", total_hours: course.duration },
        case_type: "classes_only",
      },
    ])
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Could not create the new service.");
  }
  return { enrollmentId: data.id, courseName: course.name, dueNow };
}

/**
 * Creates (or updates) the pending top-up enrollment. The payment backend
 * reuses ONE pending top-up per learner, so a second top-up request before the
 * first is paid updates that same row rather than creating a competing one.
 */
export async function upsertTopupEnrollment(args: {
  learner: ServiceLearner;
  hours: number;
  total: number;
  existing: EnrollmentRecord[];
}): Promise<{ enrollmentId: string; reused: boolean }> {
  const hours = Math.max(1, Math.round(args.hours) || 0);
  const total = Math.round(args.total) || 0;
  if (total < 1) throw new Error("Top-up amount must be at least ₹1.");

  const progress = { type: "topup", total_hours: hours };
  const pending = args.existing.find(
    (e) =>
      e.course_id === null &&
      (e as { progress?: { type?: string } }).progress?.type === "topup" &&
      e.payment_status !== "full_paid" &&
      e.payment_status !== "half_paid",
  );

  if (pending) {
    const { error } = await supabase
      .from("enrollment")
      .update({
        amount: total,
        installment_mode: "full",
        unlocked_lessons: Array.from({ length: hours }, (_, i) => i + 1),
        progress,
      })
      .eq("id", pending.id);
    if (error) throw error;
    return { enrollmentId: pending.id, reused: true };
  }

  const { data, error } = await supabase
    .from("enrollment")
    .insert([
      {
        learner_id: args.learner.id,
        course_id: null,
        amount: total,
        payment_status: "pending",
        installment_mode: "full",
        unlocked_lessons: Array.from({ length: hours }, (_, i) => i + 1),
        progress,
      },
    ])
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Could not create the top-up.");
  }
  return { enrollmentId: data.id, reused: false };
}

export { LICENCE_NEED_LABEL, licenceLabel };
export type { LicenceNeed, Vehicle };

/**
 * Creates a licence / RTO service (`case_type = rto_only`) for an existing
 * customer. Same enrollment shape the Create Learner form writes for an
 * RTO-only case. Its fee can be collected through a payment link naming this
 * enrollment (the payment page and the payment functions recognise
 * `rto_only`). Payment is only ever taken through that link.
 */
export async function createLicenceService(args: {
  learner: ServiceLearner;
  vehicle: Vehicle;
  need: LicenceNeed;
  amount: number;
}): Promise<{ enrollmentId: string; label: string }> {
  const amount = Math.round(args.amount) || 0;
  if (amount < 1) throw new Error("Enter the licence service fee.");
  const two = args.vehicle === "two_wheeler" ? args.need : "not_required";
  const four = args.vehicle === "four_wheeler" ? args.need : "not_required";

  const { data, error } = await supabase
    .from("enrollment")
    .insert([
      {
        learner_id: args.learner.id,
        course_id: null,
        amount,
        payment_status: "pending",
        installment_mode: "full",
        installment1_amount: amount,
        installment2_amount: 0,
        unlocked_lessons: [],
        progress: {},
        case_type: "rto_only",
        vehicle_type: args.vehicle,
        two_wheeler_requirement: two,
        four_wheeler_requirement: four,
        rto_address_change_required: false,
      },
    ])
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Could not create the licence service.");
  }
  return {
    enrollmentId: data.id,
    label: licenceLabel({
      vehicle_type: args.vehicle,
      two_wheeler_requirement: two,
      four_wheeler_requirement: four,
    }),
  };
}

/**
 * Removes a service that was added by mistake. Only a service that has no
 * money against it can go: nothing paid, no completed payment row.
 */
export async function removeUnpaidService(
  enrollment: EnrollmentRecord,
): Promise<void> {
  if (
    enrollment.payment_status === "full_paid" ||
    enrollment.payment_status === "half_paid"
  ) {
    throw new Error(
      "This service already has a payment, so it cannot be removed.",
    );
  }
  const { data: paid, error: paidError } = await supabase
    .from("payment")
    .select("id")
    .eq("learner_id", enrollment.learner_id)
    .eq("status", "completed")
    .eq("id", enrollment.payment_id ?? "00000000-0000-0000-0000-000000000000")
    .limit(1);
  if (paidError) throw paidError;
  if (paid && paid.length > 0) {
    throw new Error(
      "This service already has a payment, so it cannot be removed.",
    );
  }
  const { error } = await supabase
    .from("enrollment")
    .delete()
    .eq("id", enrollment.id);
  if (error) throw error;
}

/** The payment URL for an existing service (courses, top-ups and licence services). */
export function buildEnrollmentLink(
  e: EnrollmentRecord,
  phone: string,
): { url: string; amount: number; hours: number } | null {
  if (e.case_type === "rto_only") {
    // A licence service is one fixed fee on one enrollment; the link names it.
    return {
      url: `${BASE_URL}/payment?phone=${phone}&enrollment=${e.id}`,
      amount: e.amount || 0,
      hours: 1,
    };
  }
  const type = e.progress?.type;
  if (type === "topup") {
    const hours = Math.max(1, e.progress?.total_hours ?? 1);
    const total = e.amount || hours * DEFAULT_TOPUP_PRICE_PER_CLASS;
    return {
      url: buildServiceLink({
        phone,
        enrollmentId: e.id,
        topup: { hours, total },
      }),
      amount: total,
      hours,
    };
  }
  const due =
    e.payment_status === "half_paid"
      ? e.installment2_amount || 0
      : e.installment1_amount || e.amount || 0;
  return {
    url: `${BASE_URL}/payment?phone=${phone}${type === "demo" ? "&type=demo" : ""}&enrollment=${e.id}`,
    amount: due,
    hours: e.Courses?.duration ?? 1,
  };
}

/** Copies a service's link and logs that it was shared by hand. */
export async function copyServiceLink(args: {
  learner: ServiceLearner;
  enrollmentId: string;
  serviceType: "course" | "topup" | "other";
  serviceLabel: string;
  amount: number;
  url: string;
}): Promise<void> {
  await copyText(args.url);
  void logPaymentLink({
    learnerId: args.learner.id,
    enrollmentId: args.enrollmentId,
    serviceType: args.serviceType,
    serviceLabel: args.serviceLabel,
    amount: args.amount,
    url: args.url,
    channel: "copy",
  });
}

/** Builds the payment URL for a service. */
export function buildServiceLink(args: {
  phone: string;
  enrollmentId: string;
  topup?: { hours: number; total: number };
}): string {
  const base = `${BASE_URL}/payment?phone=${args.phone}`;
  const topup = args.topup
    ? `&type=topup&hours=${args.topup.hours}&amount=${args.topup.total}`
    : "";
  return `${base}${topup}&enrollment=${args.enrollmentId}`;
}

/**
 * Sends the link by e-mail and WhatsApp/SMS (same two calls as every other
 * payment link) and logs it. Throws only when the message send fails.
 */
export async function sendServiceLink(args: {
  learner: ServiceLearner;
  enrollmentId: string;
  serviceType: "course" | "topup" | "other";
  serviceLabel: string;
  amount: number;
  duration: number;
  url: string;
  toast: Toast;
}): Promise<void> {
  const { learner, toast } = args;
  void logPaymentLink({
    learnerId: learner.id,
    enrollmentId: args.enrollmentId,
    serviceType: args.serviceType,
    serviceLabel: args.serviceLabel,
    amount: args.amount,
    url: args.url,
  });

  const { error: emailError } = await supabase.functions.invoke(
    "send-payment-link-email",
    {
      body: {
        learnerEmail: learner.email,
        learnerName: learner.name,
        course: args.serviceLabel,
        amount: args.amount,
        paymentLink: args.url,
      },
    },
  );
  if (emailError) {
    console.error(emailError);
    toast({
      title: "Failed to send email",
      description: `Failed to send link to ${learner.email}`,
    });
  }

  const { error: messageError } = await supabase.functions.invoke(
    "send-message",
    {
      body: {
        message_type: "PAYMENT_LINK",
        learner_id: learner.id,
        enrollment_id: args.enrollmentId,
        course_name: args.serviceLabel,
        payment_amount: args.amount,
        duration: args.duration,
        payment_link: args.url,
      },
    },
  );
  if (messageError) {
    console.error(messageError);
    throw messageError;
  }
  toast({
    title: "Success",
    description: `Payment link for ${args.serviceLabel} sent to ${learner.name ?? "the customer"}.`,
  });
}
