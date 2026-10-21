import type { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";

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
  const paymentLink = `https://inlane-web-app.vercel.app/payment?phone=${learner.phone}${typeParam}`;

  const courseName = getCourseName(enrollment);
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
 * Records the installments an admin marks as paid: inserts a completed
 * `payment` row, activates the enrollment and notifies the learner. Same steps
 * as process-payment (see the card's handleUpdatePaidInfoSave).
 */
export async function saveManualPaidInfo(
  enrollment: EnrollmentRecord,
  installment1: number | null,
  installment2: number | null,
): Promise<"full_paid" | "half_paid"> {
  // Determine payment status based on which installments are paid
  // If both installments paid OR if it's full payment mode -> full_paid
  // If only first installment paid -> half_paid
  const isFullPayment = enrollment.installment_mode === "full";
  const bothInstallmentsPaid = installment1 && installment2;
  const paymentStatus =
    isFullPayment || bothInstallmentsPaid ? "full_paid" : "half_paid";

  // Calculate the amount being paid
  const paidAmount = (installment1 || 0) + (installment2 || 0);

  // Determine installment_type for payment record
  let installmentType = "full";
  if (!isFullPayment) {
    if (installment1 && !installment2) {
      installmentType = "first_half";
    } else if (installment1 && installment2) {
      installmentType = "full";
    }
  }

  // 1. Make payment record with "completed" status to match automatic payment flow
  // The enrollment.payment_status tracks full_paid vs half_paid for installments
  const { data: paymentRecord, error: dbError } = await supabase
    .from("payment")
    .insert([
      {
        learner_id: enrollment.Learner?.id ?? enrollment.learner_id,
        amount: paidAmount,
        total_amount: enrollment.amount || paidAmount,
        email: enrollment.Learner?.email,
        phone: enrollment.Learner?.phone,
        payment_type: "course",
        status: "completed",
        name: enrollment.Learner?.name,
        installment_type: installmentType,
        installment1_amount: enrollment.installment1_amount,
        installment2_amount: enrollment.installment2_amount,
      },
    ])
    .select()
    .single();

  if (dbError) throw new Error("Failed to record payment.");

  // 2. Update Enrollment status - IMPORTANT: Also update payment_status
  await updateEnrollment(enrollment.id, {
    amount: enrollment.amount || paidAmount,
    payment_id: paymentRecord.id,
    status: "active",
    payment_status: paymentStatus,
    installment_mode: paymentStatus === "full_paid" ? "full" : "first_half",
    installment1_amount: enrollment.installment1_amount,
    installment2_amount: enrollment.installment2_amount,
  });

  // 3. Send message
  await supabase.functions.invoke("send-message", {
    body: {
      message_type: "LL_APPLICATION_UPDATE",
      learner_id: enrollment.Learner?.id,
    },
  });

  return paymentStatus;
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
