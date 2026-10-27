import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import {
  listLearnerServices,
  serviceLabel,
} from "@/components/admin/learner/additionalServices";
import {
  defaultServiceFor,
  paymentStatusOf,
  type PaymentStatusValue,
} from "@/lib/sales-dashboard/serviceBooking";

export interface ServiceChoice {
  enrollmentId: string;
  serviceLabel: string;
  /** The service's payment status; copied onto the slot as its payment label. */
  paymentStatus: PaymentStatusValue;
  /** True for an automatic link / re-sync (no success message). */
  silent?: boolean;
}

const STATUS_TEXT: Record<PaymentStatusValue, string> = {
  unpaid: "Unpaid",
  half_paid: "Half paid",
  full_paid: "Paid",
};

/**
 * The service (order) a tentative slot is linked to, with NO manual step.
 *
 * Slots are linked by default: when the booking is made (the form picks the
 * customer's service), and here, when an unlinked slot is opened:
 *  - if the learner has exactly one service matching the booking's course, or
 *    (when the booking names no course) exactly one service, the slot links
 *    itself, silently;
 *  - otherwise nothing is shown and nothing is guessed.
 *
 * A linked slot shows that service's LIVE payment status, and if the label
 * stored on the slot has fallen behind (the customer has paid since) it is
 * brought up to date. The label is never typed in.
 */
export function SlotServiceLink({
  learnerId,
  courseText,
  linkedLabel,
  linkedEnrollmentId,
  storedPaymentStatus,
  canEdit,
  onLink,
}: {
  learnerId: string;
  /** The course written on the booking itself, if any. */
  courseText?: string;
  linkedLabel?: string;
  linkedEnrollmentId?: string;
  /** The payment label currently stored on the slot. */
  storedPaymentStatus: PaymentStatusValue;
  canEdit: boolean;
  onLink: (choice: ServiceChoice) => Promise<void>;
}) {
  const services = useQuery({
    queryKey: ["learner-services", learnerId],
    staleTime: 0,
    queryFn: () => listLearnerServices(learnerId),
  });
  const all = useMemo(() => services.data ?? [], [services.data]);

  const linkedService = linkedEnrollmentId
    ? all.find((e) => e.id === linkedEnrollmentId)
    : undefined;
  const liveStatus = linkedService
    ? paymentStatusOf(linkedService.payment_status)
    : null;

  // Keep the status stored on the slot in step with the service: one write when
  // they differ and this viewer may edit.
  const syncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (
      !canEdit ||
      !linkedService ||
      !liveStatus ||
      liveStatus === storedPaymentStatus
    ) {
      return;
    }
    const key = `${linkedService.id}:${liveStatus}`;
    if (syncedFor.current === key) return;
    syncedFor.current = key;
    void onLink({
      enrollmentId: linkedService.id,
      serviceLabel: serviceLabel(linkedService),
      paymentStatus: liveStatus,
      silent: true,
    });
  }, [canEdit, linkedService, liveStatus, storedPaymentStatus, onLink]);

  // Not linked yet: link it ourselves when the match is unambiguous.
  const autoLinked = useRef(false);
  useEffect(() => {
    if (linkedEnrollmentId || !canEdit || autoLinked.current) return;
    if (!services.isSuccess) return;
    const candidates = all
      .filter((e) => e.case_type !== "rto_only")
      .map((e) => ({ e, label: serviceLabel(e) }));
    const pick = defaultServiceFor(courseText, candidates, {
      // A single service is only assumed when the booking names no course; an
      // unrelated course note must not be silently overridden.
      allowSingle: !courseText?.trim(),
    });
    if (!pick) return;
    autoLinked.current = true;
    void onLink({
      enrollmentId: pick.e.id,
      serviceLabel: pick.label,
      paymentStatus: paymentStatusOf(pick.e.payment_status),
      silent: true,
    });
  }, [
    linkedEnrollmentId,
    canEdit,
    services.isSuccess,
    all,
    courseText,
    onLink,
  ]);

  if (!linkedEnrollmentId) return null;
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-2 py-1.5 text-xs text-green-900">
      <Link2 size={13} />
      <span>
        Service: <b>{linkedLabel ?? "Linked service"}</b>
        {liveStatus ? ` · ${STATUS_TEXT[liveStatus]}` : ""}
      </span>
    </div>
  );
}
