import type { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";

import { logPaymentLink } from "./paymentTrace";

// Enrollment-level actions shared by Learner Management's "Incomplete
// Payments" card and the Sales Dashboard's slot panel. The bodies were moved
// out of IncompletePaymentsCard.tsx unchanged, so both places hit the same
// tables and edge functions.

type Toast = ReturnType<typeof useToast>["toast"];

/** The enrollment shape these actions read (as selected by both callers). */
export interface EnrollmentRecord {
  id: string;
  learner_id: string;
  course_id: string | null;
  installment_mode: string | null;
  amount: number | null;
  installment1_amount: number | null;
  installment2_amount: number | null;
  payment_status: string | null;
  payment_id: string | null;
  /** e.g. { type: "topup", total_hours: 4 }; selected by ENROLLMENT_SELECT. */
  progress?: { type?: string; total_hours?: number } | null;
  /** classes_only | rto_only | lessons_with_rto (licence services are rto_only). */
  case_type?: string | null;
  vehicle_type?: string | null;
  two_wheeler_requirement?: string | null;
  four_wheeler_requirement?: string | null;
  Learner: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  Courses: {
    id?: string;
    name: string | null;
    duration: number | null;
  } | null;
  payment: {
    payment_type: string | null;
    amount: number | null;
    total_amount: number | null;
    status?: string | null;
  } | null;
}

/** Same select the Incomplete Payments card uses (plus what the actions need). */
export const ENROLLMENT_SELECT = `
  id,
  learner_id,
  course_id,
  installment_mode,
  amount,
  installment1_amount,
  installment2_amount,
  payment_status,
  payment_id,
  progress,
  case_type,
  vehicle_type,
  two_wheeler_requirement,
  four_wheeler_requirement,
  created_at,
  Learner (id, name, phone, email),
  Courses (id, name, duration),
  payment (id, amount, installment_type, total_amount, status, payment_type)
`;

// Helper function to get course name - handles demo/custom enrollments
export function getCourseName(enrollment: EnrollmentRecord): string {
  if (enrollment.Courses?.name) {
    return enrollment.Courses.name;
  }
  // Check payment_type for demo/custom enrollments
  const paymentType = enrollment.payment?.payment_type;
  if (paymentType === "demo") return "Demo Class";
  if (paymentType === "custom") return "Custom Course";
  return "Unknown";
}

// Helper function to determine payable amount
export function getPayableAmount(enrollment: EnrollmentRecord): number {
  // For demo/custom enrollments, amount may not be in enrollment record
  // Fall back to payment record amount
  const paymentAmount =
    enrollment.payment?.total_amount || enrollment.payment?.amount;

  if (enrollment.installment_mode === "full") {
    // when enrolment mode is full, installment1 and installment2 field might be 0
    // return amount directly, or fall back to payment amount
    return enrollment.amount || paymentAmount || 0;
  } else if (
    enrollment.installment_mode === "first_half" ||
    enrollment.installment_mode === "installment"
  ) {
    return enrollment.installment1_amount || paymentAmount || 0;
  } else if (enrollment.installment_mode === "second_half") {
    return enrollment.installment2_amount || paymentAmount || 0;
  }
  // For enrollments without installment_mode (e.g., demo), use payment amount
  return paymentAmount || enrollment.amount || 0;
}

/** Plain enrollment update (the card's useUpdateEnrollmentMutation body). */
export async function updateEnrollment(
  enrollmentId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("enrollment")
    .update(updates)
    .eq("id", enrollmentId);
  if (error) throw error;
}

/**
 * E-mails + messages the learner their payment link for this enrollment
 * (`send-payment-link-email` and `send-message` PAYMENT_LINK). Throws when the
 * WhatsApp/SMS message fails, like the card.
 */
export async function sendEnrollmentPaymentLink(
  enrollment: EnrollmentRecord,
  toast: Toast,
): Promise<void> {
  const learner = enrollment.Learner;
  if (!learner) throw new Error("This enrollment has no learner.");

  // Get the payment amount based on installment mode
  const paymentAmount = getPayableAmount(enrollment);

  // Create the payment link. For demo/topup enrollments (course_id null),
  // append the right type so PaymentPage prefills the demo/topup flow even
  // on deployments without the enrollment-based auto-detect fallback.
  const paymentType = enrollment.payment?.payment_type;
  let typeParam = "";
  if (paymentType === "demo") {
    typeParam = "&type=demo";
  } else if (paymentType === "topup") {
    const topupHours = Math.max(
      1,
      Math.round((enrollment.payment?.amount || 1) / 1),
    );
    typeParam = `&type=topup&hours=${topupHours}`;
  }
  const paymentLink = `https://inlane-web-app.vercel.app/payment?phone=${learner.phone}${typeParam}&enrollment=${enrollment.id}`;

  const courseName = getCourseName(enrollment);
  void logPaymentLink({
    learnerId: learner.id,
    enrollmentId: enrollment.id,
    serviceType: paymentType === "topup" ? "topup" : "course",
    serviceLabel: courseName,
    amount: paymentAmount,
    url: paymentLink,
  });
  const { error: invokeError } = await supabase.functions.invoke(
    "send-payment-link-email",
    {
      body: {
        learnerEmail: learner.email,
        learnerName: learner.name,
        course: courseName,
        amount: paymentAmount,
        paymentLink,
      },
    },
  );

  const { error: invokeError2 } = await supabase.functions.invoke(
    "send-message",
    {
      body: {
        message_type: "PAYMENT_LINK",
        learner_id: learner.id,
        enrollment_id: enrollment.id,
        course_name: courseName,
        payment_amount: paymentAmount,
        duration: enrollment.Courses?.duration || 1,
        payment_link: paymentLink,
      },
    },
  );

  if (invokeError) {
    console.error(invokeError);
    toast({
      title: "Failed to send email",
      description: `Failed to send link sent to ${learner.email}`,
    });
  } else {
    toast({
      title: "Success",
      description: `Payment link sent to ${learner.email} successfully!`,
    });
  }
  if (invokeError2) {
    console.error(invokeError2);
    toast({
      title: "Failed to send message",
      description: "Failed to send the payment link message.",
    });
    throw invokeError2;
  }
  toast({
    title: "Success",
    description: `Payment link sent to ${learner.name} successfully!`,
  });
}

/**
 * Deletes a learner and everything attached to them: enrollments, payments,
 * the Learner row and the Admin row for that phone. Irreversible. Same steps
 * as the card's delete mutation.
 */
export async function deleteLearnerCascade(
  learnerId: string,
  phone: string | null,
): Promise<void> {
  // remove from dependent tables
  const { error: enrollmentDeleteerror } = await supabase
    .from("enrollment")
    .delete()
    .eq("learner_id", learnerId);
  if (enrollmentDeleteerror) {
    throw new Error("Failed to delete the enrollment record.");
  }

  const { error: paymentDeleteerror } = await supabase
    .from("payment")
    .delete()
    .eq("learner_id", learnerId);
  if (paymentDeleteerror) {
    throw new Error("Failed to delete the payment record.");
  }

  const { error: learnerDeleteError } = await supabase
    .from("Learner")
    .delete()
    .eq("id", learnerId);
  if (learnerDeleteError) {
    throw new Error("Failed to delete the learner record.");
  }

  // Optional: remove from Admin, should not be required if learner does not
  // get added to Admin after signup
  if (phone) {
    const { error: adminDeleteerror } = await supabase
      .from("Admin")
      .delete()
      .eq("phone", phone);
    if (adminDeleteerror) {
      throw new Error("Failed to delete the Admin record.");
    }
  }
}
