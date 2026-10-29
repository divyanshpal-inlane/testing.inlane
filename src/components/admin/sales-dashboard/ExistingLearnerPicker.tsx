import { Loader2, UserCheck, X } from "lucide-react";
import { useState } from "react";

import {
  listLearnerServices,
  serviceLabel,
} from "@/components/admin/learner/additionalServices";
import type { EnrollmentRecord } from "@/components/admin/learner/enrollmentActions";
import {
  type FoundLearner,
  LearnerNameSearch,
} from "@/components/admin/learner/LearnerNameSearch";
import { Label } from "@/components/ui/label";
import {
  paymentStatusOf,
  type PaymentStatusValue,
  tenDigitPhone,
} from "@/lib/sales-dashboard/serviceBooking";

export interface ExistingLearnerFill {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  /** Set when a service is chosen; clears the link when null. */
  service: {
    enrollmentId: string;
    serviceLabel: string;
    paymentStatus: PaymentStatusValue;
  } | null;
}

/**
 * "Existing learner" shortcut on the booking form: search the learner by NAME
 * or e-mail (the team does not know phone numbers), fill the customer fields,
 * and choose which of their services this slot is for. The chosen service is
 * saved on the booking, so every class can later be traced back to the service
 * (and its payment) it belongs to. The real phone number is copied from the
 * learner record; it is never typed or shown unmasked here.
 */
export function ExistingLearnerPicker({
  onFill,
}: {
  onFill: (fill: ExistingLearnerFill) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [learner, setLearner] = useState<FoundLearner | null>(null);
  const [services, setServices] = useState<EnrollmentRecord[]>([]);
  const [chosen, setChosen] = useState("");

  const fillFrom = (
    row: FoundLearner,
    service: ExistingLearnerFill["service"],
    withAddress: boolean,
  ) =>
    onFill({
      name: row.name ?? undefined,
      phone: tenDigitPhone(row.phone) ?? undefined,
      email: row.email ?? undefined,
      address: withAddress
        ? row.pick_up_location || row.area || undefined
        : undefined,
      service,
    });

  const choose = (
    row: FoundLearner,
    list: EnrollmentRecord[],
    enrollmentId: string,
  ) => {
    setChosen(enrollmentId);
    const e = list.find((x) => x.id === enrollmentId);
    fillFrom(
      row,
      e
        ? {
            enrollmentId: e.id,
            serviceLabel: serviceLabel(e),
            paymentStatus: paymentStatusOf(e.payment_status),
          }
        : null,
      false,
    );
  };

  const pick = async (row: FoundLearner) => {
    setLoading(true);
    setMessage(null);
    setLearner(row);
    setServices([]);
    setChosen("");
    try {
      const list = (await listLearnerServices(row.id)).filter(
        (e) => e.case_type !== "rto_only",
      );
      setServices(list);
      fillFrom(row, null, true);
      // A single service is the obvious choice: preselect it.
      if (list.length === 1) choose(row, list, list[0].id);
    } catch (err) {
      setMessage(
        (err as { message?: string } | null)?.message ||
          "Couldn't load this learner's services.",
      );
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setLearner(null);
    setServices([]);
    setChosen("");
    setMessage(null);
    onFill({ service: null });
  };

  return (
    <div className="space-y-1">
      <Label className="block text-xs font-medium">
        Existing learner (book for one of their services)
      </Label>

      {!learner ? (
        <LearnerNameSearch
          onPick={(row) => void pick(row)}
          placeholder="Search learner by name or e-mail"
        />
      ) : (
        <div className="rounded-md border bg-green-50 p-2 text-xs">
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-1 font-medium text-green-800">
              <UserCheck size={14} /> {learner.name ?? "Learner"} selected.
              Details filled below.
            </p>
            <button
              type="button"
              aria-label="Choose a different learner"
              onClick={clear}
              className="rounded p-0.5 text-green-800 hover:bg-green-100"
            >
              <X size={14} />
            </button>
          </div>
          {loading ? (
            <p className="mt-1 flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading services…
            </p>
          ) : services.length === 0 ? (
            <p className="mt-1 text-muted-foreground">
              No services yet. Sell one from the learner panel after booking.
            </p>
          ) : (
            <div className="mt-1.5 space-y-1">
              <label
                htmlFor="existing-learner-service"
                className="text-[11px] font-medium text-muted-foreground"
              >
                This slot is for
              </label>
              <select
                id="existing-learner-service"
                value={chosen}
                onChange={(e) => choose(learner, services, e.target.value)}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              >
                <option value="">No specific service</option>
                {services.map((e) => (
                  <option key={e.id} value={e.id}>
                    {serviceLabel(e)} ·{" "}
                    {e.payment_status === "full_paid"
                      ? "Paid"
                      : e.payment_status === "half_paid"
                        ? "Half paid"
                        : "Unpaid"}
                  </option>
                ))}
              </select>
            </div>
          )}
          {message && <p className="mt-1 text-red-600">{message}</p>}
        </div>
      )}
    </div>
  );
}
