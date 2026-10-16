import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowBigLeft,
  Delete,
  Pencil,
  RefreshCcw,
  Send,
  UserPlus,
} from "lucide-react";
import { useState } from "react";

import {
  CreatedLearnerInfo,
  CreateLearnerDialog,
} from "@/components/admin/learner/CreateLearnerDialog";
import { EditPlanDialog } from "@/components/admin/learner/EditPlanDialog";
import {
  deleteLearnerCascade,
  ENROLLMENT_SELECT,
  EnrollmentRecord,
  sendEnrollmentPaymentLink,
} from "@/components/admin/learner/enrollmentActions";
import { PaidInfoDialog } from "@/components/admin/learner/PaidInfoDialog";
import { Button } from "@/components/ui/button";
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

interface LearnerLookup {
  learner: { id: string; name: string | null; phone: string | null };
  /** Their latest enrollment, if they have one. */
  enrollment: EnrollmentRecord | null;
}

/**
 * Shown in the slot panel for a tentative slot: is the customer already a
 * Learner? If not, create them (same form and edge function as Learner
 * Management). Once they exist: send the payment link, edit the plan, add paid
 * info or delete the learner -- all through the same dialogs and calls the
 * Learner Management page uses.
 */
export function SlotLearnerActions({ customer }: { customer: SlotCustomer }) {
  const phone10 = normalizePhone(customer.phone);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const lookupKey = ["slot-learner-lookup", phone10];

  const [createOpen, setCreateOpen] = useState(false);
  // Set when the learner was created from this panel (changes the wording and
  // hides the payment link for RTO-only cases, which have no payable course).
  const [created, setCreated] = useState<CreatedLearnerInfo | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [paidInfoOpen, setPaidInfoOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const lookup = useQuery<LearnerLookup | null>({
    queryKey: lookupKey,
    enabled: phone10 !== null,
    // Always fresh: the learner may have been created or changed elsewhere.
    staleTime: 0,
    queryFn: async () => {
      // The Learner table stores phones in several formats.
      const variants = [phone10!, `91${phone10}`, `+91${phone10}`];
      const { data, error } = await supabase
        .from("Learner")
        .select("id, name, phone")
        .in("phone", variants)
        .limit(1);
      if (error) throw error;
      const learner = data?.[0];
      if (!learner) return null;

      // Their latest enrollment (same select as Incomplete Payments).
      const { data: enrollments, error: enrollmentError } = await supabase
        .from("enrollment")
        .select(ENROLLMENT_SELECT)
        .eq("learner_id", learner.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (enrollmentError) throw enrollmentError;
      return {
        learner,
        enrollment: (enrollments?.[0] ??
          null) as unknown as EnrollmentRecord | null,
      };
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: lookupKey });

  const enrollment = lookup.data?.enrollment ?? null;

  const handleSend = async () => {
    if (!enrollment) return;
    setIsSending(true);
    try {
      await sendEnrollmentPaymentLink(enrollment, toast);
    } catch (err) {
      toast({
        title: "Error",
        description:
          (err as { message?: string } | null)?.message ||
          "Failed to send payment link",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleDelete = async () => {
    const found = lookup.data;
    if (!found) return;
    setIsDeleting(true);
    try {
      await deleteLearnerCascade(found.learner.id, found.learner.phone);
      toast({
        title: "Success",
        description: "Deleted learner.",
      });
      setCreated(null);
      setConfirmingDelete(false);
      await refresh();
    } catch (err) {
      toast({
        title: "Error",
        description:
          (err as { message?: string } | null)?.message ||
          "Failed to delete the learner.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Delete with an explicit confirm step, like the Learner Management card.
  const deleteControls = (
    <>
      {confirmingDelete ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={isDeleting}
            onClick={() => void handleDelete()}
            className="whitespace-nowrap"
          >
            {isDeleting ? (
              <RefreshCcw size={14} className="mr-1 animate-spin" />
            ) : (
              <Delete size={14} className="mr-1" />
            )}
            Confirm
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isDeleting}
            onClick={() => setConfirmingDelete(false)}
            className="whitespace-nowrap"
          >
            <ArrowBigLeft size={14} className="mr-1" />
            Cancel
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirmingDelete(true)}
          className="whitespace-nowrap"
        >
          <Delete size={14} className="mr-1" />
          Delete
        </Button>
      )}
    </>
  );

  let body: React.ReactNode;
  if (phone10 === null) {
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => void lookup.refetch()}
          className="whitespace-nowrap"
        >
          <RefreshCcw size={14} className="mr-1" />
          Retry
        </Button>
      </>
    );
  } else if (lookup.data) {
    const { learner } = lookup.data;
    const fullyPaid = enrollment?.payment_status === "full_paid";
    // RTO-only learners created here have no payable course enrollment.
    const noLink =
      created !== null &&
      (created.caseType !== "classes_only" || !created.enrollmentId);
    body = (
      <>
        <p className="slot-panel-learner-status ok">
          {created ? "✓ Learner created" : "✓ Learner already created"}
          {learner.name ? ` (${learner.name})` : ""}
        </p>

        {enrollment ? (
          <p className="slot-panel-learner-note">
            Payment: {enrollment.payment_status ?? "pending"}
            {fullyPaid ? " — already fully paid." : ""}
          </p>
        ) : (
          <p className="slot-panel-learner-note">
            No enrollment found, so there is no payment to send or edit.
          </p>
        )}

        <div className="slot-panel-learner-actions">
          {enrollment && !fullyPaid && !noLink && (
            <Button
              variant="outline"
              size="sm"
              disabled={isSending}
              onClick={() => void handleSend()}
              className="whitespace-nowrap"
            >
              {isSending ? (
                <RefreshCcw size={14} className="mr-1 animate-spin" />
              ) : (
                <Send size={14} className="mr-1" />
              )}
              Send Payment Link
            </Button>
          )}
          {enrollment && !fullyPaid && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
              className="whitespace-nowrap"
            >
              <Pencil size={14} className="mr-1" />
              Edit
            </Button>
          )}
          {enrollment && !fullyPaid && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPaidInfoOpen(true)}
              className="whitespace-nowrap"
            >
              <Send size={14} className="mr-1" />
              Add paid info
            </Button>
          )}
          {deleteControls}
        </div>
        {confirmingDelete && (
          <p className="slot-panel-learner-note">
            This permanently deletes the learner and all of their enrollments
            and payments.
          </p>
        )}
      </>
    );
  } else {
    body = (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setCreateOpen(true)}
        className="whitespace-nowrap"
      >
        <UserPlus size={14} className="mr-1" />
        Create New Learner
      </Button>
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
          void refresh();
        }}
      />
      <EditPlanDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        enrollment={enrollment}
        onSaved={() => void refresh()}
      />
      <PaidInfoDialog
        open={paidInfoOpen}
        onOpenChange={setPaidInfoOpen}
        enrollment={enrollment}
        onSaved={() => void refresh()}
      />
    </div>
  );
}
