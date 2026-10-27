import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowBigLeft,
  Delete,
  Pencil,
  PlusCircle,
  RefreshCcw,
  UserPlus,
} from "lucide-react";
import { useState } from "react";

import { AdditionalServiceDialog } from "@/components/admin/learner/AdditionalServiceDialog";
import {
  listLearnerServices,
  serviceLabel,
} from "@/components/admin/learner/additionalServices";
import {
  CreatedLearnerInfo,
  CreateLearnerDialog,
} from "@/components/admin/learner/CreateLearnerDialog";
import { EditPlanDialog } from "@/components/admin/learner/EditPlanDialog";
import {
  deleteLearnerCascade,
  ENROLLMENT_SELECT,
  EnrollmentRecord,
} from "@/components/admin/learner/enrollmentActions";
import { LearnerHistory } from "@/components/admin/learner/LearnerHistory";
import { LearnerNameSearch } from "@/components/admin/learner/LearnerNameSearch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import type { OrderSlot } from "@/lib/sales-dashboard/orderSlots";
import {
  type BookingIntent,
  paymentStatusOf,
} from "@/lib/sales-dashboard/serviceBooking";
import { normalizePhone } from "@/lib/sales-dashboard/validation";
import { supabase } from "@/lib/supabaseClient";

import { type ServiceChoice, SlotServiceLink } from "./SlotServiceLink";

export interface SlotCustomer {
  name: string;
  /** Real number as saved on the booking (never shown unmasked here); may be empty. */
  phone: string;
  /** E-mail saved on the booking (from the CRM autofill), if any. */
  email?: string;
  /** Courses.id saved on the booking, if it is a real course. */
  courseId?: string;
  /** Course label saved on the booking, if any. */
  course: string;
  paymentStatus: "unpaid" | "half_paid" | "full_paid";
  // Present for a saved tentative slot (not for the "Booking saved" card):
  // what is needed to link the slot to one of the learner's services.
  scheduleId?: number;
  instructorId?: string;
  /** May this viewer edit the slot (so also link it to a service)? */
  canEdit?: boolean;
  /**
   * The slot is a class Operations has confirmed (booked / completed / paused),
   * not a tentative hold. Its learner section is for looking things up and
   * selling, so "Delete" (which wipes the learner and every order) is not shown.
   */
  confirmedClass?: boolean;
  /** The service (enrollment) the slot is already linked to, if any. */
  enrollmentId?: string;
  serviceLabel?: string;
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
export function SlotLearnerActions({
  customer,
  onBookClasses,
  onLinkService,
  onEditSlots,
}: {
  customer: SlotCustomer;
  /** Open an order's booked classes for editing (History & orders). */
  onEditSlots?: (slots: OrderSlot[]) => void;
  /** Start booking classes for a service (closes dialogs, arms the grid). */
  onBookClasses?: (intent: BookingIntent) => void;
  /** Link this slot (and the classes booked with it) to a service. */
  onLinkService?: (
    customer: SlotCustomer,
    choice: ServiceChoice,
  ) => Promise<void>;
}) {
  // The learner is matched by PHONE NUMBER only. A booking made in Instructor
  // Management carries no phone, so Sales can type one to check.
  const savedPhone10 = normalizePhone(customer.phone);
  const [enteredPhone, setEnteredPhone] = useState("");
  const [checkedPhone, setCheckedPhone] = useState<string | null>(null);
  const phone10 = savedPhone10 ?? normalizePhone(checkedPhone);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const lookupKey = ["slot-learner-lookup", phone10];

  const [createOpen, setCreateOpen] = useState(false);
  // Set when the learner was created from this panel (changes the wording and
  // hides the payment link for RTO-only cases, which have no payable course).
  const [created, setCreated] = useState<CreatedLearnerInfo | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceTab, setServiceTab] = useState<"sell" | "services">("sell");
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

  // Slots are linked to a service by default: when this slot's learner is
  // created, or a service is sold, with the slot open, link the slot to it.
  const canAutoLink =
    customer.scheduleId != null &&
    !customer.enrollmentId &&
    Boolean(customer.canEdit) &&
    Boolean(onLinkService);
  const linkSlotTo = async (e: EnrollmentRecord) => {
    if (!canAutoLink || !onLinkService || e.case_type === "rto_only") return;
    await onLinkService(customer, {
      enrollmentId: e.id,
      serviceLabel: serviceLabel(e),
      paymentStatus: paymentStatusOf(e.payment_status),
    });
  };
  const linkNewService = async (info: CreatedLearnerInfo) => {
    if (!canAutoLink || !info.enrollmentId) return;
    const list = await listLearnerServices(info.learnerId);
    const created = list.find((x) => x.id === info.enrollmentId);
    if (created) await linkSlotTo(created);
  };

  const found = lookup.data ?? null;
  const enrollment = found?.enrollment ?? null;

  const handleDelete = async () => {
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
      <>
        <p className="slot-panel-learner-note">
          {customer.phone
            ? "The phone number on this booking isn't valid."
            : "This booking has no phone number."}{" "}
          Search the learner by name to check:
        </p>
        <LearnerNameSearch
          onPick={(l) => setCheckedPhone(l.phone ?? "")}
          placeholder="Learner name or e-mail"
        />
        <p className="slot-panel-learner-note">
          Or, if you have the number, enter it:
        </p>
        <form
          className="slot-panel-learner-phone"
          onSubmit={(e) => {
            e.preventDefault();
            setCheckedPhone(enteredPhone);
          }}
        >
          <Input
            value={enteredPhone}
            onChange={(e) => setEnteredPhone(e.target.value)}
            placeholder="10-digit phone"
            inputMode="numeric"
            className="h-8 text-xs"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={normalizePhone(enteredPhone) === null}
            className="whitespace-nowrap"
          >
            Check
          </Button>
        </form>
        {checkedPhone !== null && normalizePhone(checkedPhone) === null && (
          <p className="slot-panel-learner-note">
            Enter a valid 10-digit number.
          </p>
        )}
      </>
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
  } else if (found) {
    const { learner } = found;
    body = (
      <>
        {/* Learner: who they are and what can be done now. */}
        <>
          <p className="slot-panel-learner-status ok">
            {created ? "✓ Learner created" : "✓ Learner already created"}
            {learner.name ? ` (${learner.name})` : ""}
          </p>

          {!enrollment && (
            <p className="slot-panel-learner-note">
              No enrollment found, so there is no payment to send or edit.
            </p>
          )}

          {customer.scheduleId != null && onLinkService && (
            <SlotServiceLink
              learnerId={learner.id}
              courseText={customer.course || undefined}
              linkedLabel={customer.serviceLabel}
              linkedEnrollmentId={customer.enrollmentId}
              storedPaymentStatus={customer.paymentStatus}
              canEdit={Boolean(customer.canEdit)}
              onLink={(choice) => onLinkService(customer, choice)}
            />
          )}

          <div className="slot-panel-learner-actions">
            {enrollment && (
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setServiceTab("sell");
                setServiceOpen(true);
              }}
              className="whitespace-nowrap"
            >
              <PlusCircle size={14} className="mr-1" />
              Additional service
            </Button>
            {!customer.confirmedClass && deleteControls}
          </div>
          {!customer.confirmedClass && confirmingDelete && (
            <p className="slot-panel-learner-note">
              This permanently deletes the learner and all of their enrollments
              and payments.
            </p>
          )}
        </>

        {/* History & orders: always visible below, no click needed. */}
        <section className="mt-4 border-t pt-3">
          <h3 className="slot-panel-learner-title">History &amp; orders</h3>
          <LearnerHistory
            learner={{
              id: learner.id,
              name: learner.name,
              phone: learner.phone,
              email: enrollment?.Learner?.email ?? customer.email ?? null,
            }}
            onBookClasses={onBookClasses}
            onEditSlots={onEditSlots}
          />
        </section>
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
          void linkNewService(info);
        }}
      />
      <EditPlanDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        enrollment={enrollment}
        onSaved={() => void refresh()}
      />
      <AdditionalServiceDialog
        open={serviceOpen}
        onOpenChange={setServiceOpen}
        learner={
          found
            ? {
                id: found.learner.id,
                name: found.learner.name,
                phone: found.learner.phone,
                email: enrollment?.Learner?.email ?? customer.email ?? null,
              }
            : null
        }
        onDone={() => void refresh()}
        initialTab={serviceTab}
        onServiceCreated={(e) => void linkSlotTo(e)}
        onBookClasses={
          onBookClasses
            ? (intent) => {
                setServiceOpen(false);
                onBookClasses(intent);
              }
            : undefined
        }
      />
    </div>
  );
}
