import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  CreatedLearnerInfo,
  CreateLearnerDialog,
} from "@/components/admin/learner/CreateLearnerDialog";
import { sendPaymentLink } from "@/components/admin/learner/sendPaymentLink";
import { useToast } from "@/components/ui/use-toast";
import { normalizePhone } from "@/lib/sales-dashboard/validation";
import { supabase } from "@/lib/supabaseClient";

export interface SlotCustomer {
  name: string;
  /** Real number as saved on the booking (never shown unmasked here). */
  phone: string;
  /** E-mail saved on the booking (from the CRM autofill), if any. */
  email?: string;
  /** Courses.id saved on the booking, if it is a real course. */
  courseId?: string;
  /** Course label saved on the booking, if any. */
  course: string;
  paymentStatus: "unpaid" | "half_paid" | "full_paid";
}

interface ExistingEnrollment {
  id: string;
  installment_mode: string | null;
  amount: number | null;
  installment1_amount: number | null;
  installment2_amount: number | null;
  payment_status: string | null;
  Courses: { name: string | null; duration: number | null } | null;
  payment: {
    payment_type: string | null;
    amount: number | null;
    total_amount: number | null;
  } | null;
}

// Same rules as Incomplete Payments' getPayableAmount().
function payableAmount(e: ExistingEnrollment): number {
  const paymentAmount = e.payment?.total_amount || e.payment?.amount || 0;
  if (e.installment_mode === "full") return e.amount || paymentAmount;
  if (
    e.installment_mode === "first_half" ||
    e.installment_mode === "installment"
  )
    return e.installment1_amount || paymentAmount;
  if (e.installment_mode === "second_half")
    return e.installment2_amount || paymentAmount;
  return paymentAmount || e.amount || 0;
}

// Same rules as Incomplete Payments' getCourseName().
function enrollmentCourseName(e: ExistingEnrollment): string {
  if (e.Courses?.name) return e.Courses.name;
  if (e.payment?.payment_type === "demo") return "Demo Class";
  if (e.payment?.payment_type === "custom") return "Custom Course";
  return "Unknown";
}

/**
 * Shown in the slot panel for a tentative slot: is the customer already a
 * Learner, and if not, create them (same form and edge function as Learner
 * Management) and then send the payment link (same calls as well).
 */
export function SlotLearnerActions({ customer }: { customer: SlotCustomer }) {
  const phone10 = normalizePhone(customer.phone);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedLearnerInfo | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  const lookup = useQuery({
    queryKey: ["slot-learner-lookup", phone10],
    enabled: phone10 !== null,
    // Always fresh: the learner may have been created elsewhere since.
    staleTime: 0,
    queryFn: async () => {
      // The Learner table stores phones in several formats.
      const variants = [phone10!, `91${phone10}`, `+91${phone10}`];
      const { data, error } = await supabase
        .from("Learner")
        .select("id, name, email, phone")
        .in("phone", variants)
        .limit(1);
      if (error) throw error;
      const learner = data?.[0];
      if (!learner) return null;

      // Their latest enrollment, for the payment link (same data the
      // Incomplete Payments card sends from).
      const { data: enrollments, error: enrollmentError } = await supabase
        .from("enrollment")
        .select(
          "id, installment_mode, amount, installment1_amount, installment2_amount, payment_status, Courses(name, duration), payment(payment_type, amount, total_amount)",
        )
        .eq("learner_id", learner.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (enrollmentError) throw enrollmentError;
      return {
        learner,
        enrollment: (enrollments?.[0] ??
          null) as unknown as ExistingEnrollment | null,
      };
    },
  });

  const handleSend = async () => {
    if (!created?.enrollmentId) return;
    setIsSending(true);
    try {
      await sendPaymentLink(
        {
          id: created.learnerId,
          name: created.name,
          email: created.email,
          phone: created.phone,
        },
        { name: created.courseName, duration: created.totalLessons },
        created.paymentAmount,
        created.enrollmentId,
        toast,
        created.courseType,
      );
      setLinkSent(true);
    } finally {
      setIsSending(false);
    }
  };

  const handleSendExisting = async () => {
    const found = lookup.data;
    if (!found?.enrollment) return;
    const { learner, enrollment } = found;
    setIsSending(true);
    try {
      await sendPaymentLink(
        {
          id: learner.id,
          name: learner.name ?? "",
          email: learner.email ?? "",
          phone: learner.phone ?? "",
        },
        {
          name: enrollmentCourseName(enrollment),
          duration: enrollment.Courses?.duration || 1,
        },
        payableAmount(enrollment),
        enrollment.id,
        toast,
        enrollment.payment?.payment_type === "demo" ? "demo" : undefined,
      );
      setLinkSent(true);
    } finally {
      setIsSending(false);
    }
  };

  let body: React.ReactNode;
  if (created) {
    const canSend = Boolean(
      created.enrollmentId && created.caseType === "classes_only",
    );
    body = (
      <>
        <p className="slot-panel-learner-status ok">✓ Learner created</p>
        {canSend ? (
          <button
            type="button"
            className="slot-pop-edit-btn"
            disabled={isSending}
            onClick={() => void handleSend()}
          >
            {isSending
              ? "Sending…"
              : linkSent
                ? "Resend Payment Link"
                : "Send Payment Link"}
          </button>
        ) : (
          <p className="slot-panel-learner-note">
            No payment link for this case type.
          </p>
        )}
      </>
    );
  } else if (phone10 === null) {
    body = (
      <p className="slot-panel-learner-note">
        No valid phone number is saved on this booking, so the learner
        can&apos;t be checked.
      </p>
    );
  } else if (lookup.isLoading) {
    body = <p className="slot-panel-learner-note">Checking learner…</p>;
  } else if (lookup.isError) {
    body = (
      <>
        <p className="slot-panel-learner-note">
          Couldn&apos;t check the learner.
        </p>
        <button
          type="button"
          className="slot-pop-edit-btn"
          onClick={() => void lookup.refetch()}
        >
          Retry
        </button>
      </>
    );
  } else if (lookup.data) {
    const { learner, enrollment } = lookup.data;
    const fullyPaid = enrollment?.payment_status === "full_paid";
    body = (
      <>
        <p className="slot-panel-learner-status ok">
          ✓ Learner already created
          {learner.name ? ` (${learner.name})` : ""}
        </p>
        {!enrollment ? (
          <p className="slot-panel-learner-note">
            No enrollment found, so there is no payment link to send.
          </p>
        ) : fullyPaid ? (
          <p className="slot-panel-learner-note">Already fully paid.</p>
        ) : (
          <button
            type="button"
            className="slot-pop-edit-btn"
            disabled={isSending}
            onClick={() => void handleSendExisting()}
          >
            {isSending
              ? "Sending…"
              : linkSent
                ? "Resend Payment Link"
                : "Send Payment Link"}
          </button>
        )}
      </>
    );
  } else {
    body = (
      <button
        type="button"
        className="slot-pop-edit-btn"
        onClick={() => setCreateOpen(true)}
      >
        Create New Learner
      </button>
    );
  }

  return (
    <div className="slot-panel-learner">
      <h3 className="slot-panel-learner-title">Learner</h3>
      {body}
      <CreateLearnerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        prefill={{
          name: customer.name,
          phone: phone10 ?? undefined,
          email: customer.email,
          courseId: customer.courseId,
          course: customer.course || undefined,
          paymentStatus: customer.paymentStatus,
        }}
        onCreated={(info) => {
          setCreated(info);
          setLinkSent(false);
          void queryClient.invalidateQueries({
            queryKey: ["slot-learner-lookup", phone10],
          });
        }}
      />
    </div>
  );
}
