import { Loader2, Search, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { CreatedLearnerInfo } from "@/components/admin/learner/CreateLearnerDialog";
import { CreateLearnerDialog } from "@/components/admin/learner/CreateLearnerDialog";
import { LearnerNameSearch } from "@/components/admin/learner/LearnerNameSearch";
import { sendPaymentLink } from "@/components/admin/learner/sendPaymentLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { useCanSeeCustomerPhone } from "@/hooks/useCanSeeCustomerPhone";
import type { OrderSlot } from "@/lib/sales-dashboard/orderSlots";
import type { BookingIntent } from "@/lib/sales-dashboard/serviceBooking";
import { tenDigitPhone } from "@/lib/sales-dashboard/serviceBooking";
import { normalizePhone } from "@/lib/sales-dashboard/validation";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import { maskPhoneNumber } from "@/utils/phoneMasking";

import { SlotLearnerActions } from "./SlotLearnerActions";

/** A learner picked through the search (the real phone stays internal). */
export interface LookupTarget {
  name: string;
  /** Real number: the learner is always found by phone, whatever was typed. */
  phone: string;
  email?: string;
  /** How they were found, e.g. "Lead ID 12345". */
  via: string;
}

type Mode = "lead" | "name" | "phone";

const MODES: { key: Mode; label: string }[] = [
  { key: "lead", label: "Lead ID" },
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
];

interface LeadLookupResponse {
  configured?: boolean;
  found?: boolean;
  code?: string;
  learner?: { name?: string; email?: string; phone?: string } | null;
}

/**
 * "Find learner": a full-width bar just under the dashboard's top bar. Look a
 * learner up by Cratio Lead ID (the default), by name, or by phone number. The
 * learner then opens in the left column (see FindLearnerResult), with their
 * actions and full History & orders, without needing a slot.
 *
 * Whatever is typed, the learner is finally found by PHONE NUMBER only:
 *  - Lead ID: the number is fetched from Cratio (the same lookup the booking
 *    form's autofill uses), then the learner is searched by it.
 *  - Name: pick from the matches; their number is used.
 *  - Phone: used as typed.
 */
export function FindLearnerSearch({
  target,
  onTarget,
}: {
  /** The learner currently open, so the box can clear itself when it closes. */
  target: LookupTarget | null;
  onTarget: (target: LookupTarget | null) => void;
}) {
  const [mode, setMode] = useState<Mode>("lead");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  // Closing the learner (x, or any calendar click) leaves a clean search box.
  useEffect(() => {
    if (!target) {
      setValue("");
      setMessage(null);
    }
  }, [target]);

  const findByLead = async () => {
    const id = value.trim();
    if (!id) {
      setMessage("Enter a Cratio Lead ID.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "instructor-slot-booking",
        { body: { action: "lookupLearner", leadId: id, by: "leadId" } },
      );
      if (error) throw error;
      const res = (data ?? {}) as LeadLookupResponse;
      if (res.configured === false) {
        setMessage(
          "The CRM lookup is not set up yet. Search by name or phone.",
        );
        return;
      }
      if (res.code || !res.found || !res.learner) {
        setMessage(`No CRM lead matched ${id}.`);
        return;
      }
      const phone = tenDigitPhone(res.learner.phone);
      if (!phone) {
        setMessage(
          "That lead has no phone number in the CRM, so the learner cannot be searched. Try the name.",
        );
        return;
      }
      onTarget({
        name: res.learner.name ?? "",
        phone,
        email: res.learner.email,
        via: `Lead ID ${id}`,
      });
    } catch (err) {
      console.error("Lead lookup failed:", err);
      setMessage("Could not reach the CRM. Try again, or search by name.");
    } finally {
      setBusy(false);
    }
  };

  const findByPhone = () => {
    const p10 = normalizePhone(value);
    if (!p10) {
      setMessage("Enter a valid 10-digit phone number.");
      return;
    }
    setMessage(null);
    onTarget({ name: "", phone: p10, via: "Phone" });
  };

  const submit = () => {
    if (mode === "lead") void findByLead();
    else if (mode === "phone") findByPhone();
  };

  const dispatchLink = async (info: CreatedLearnerInfo) => {
    if (!info.enrollmentId) return;
    await sendPaymentLink(
      {
        id: info.learnerId,
        name: info.name,
        email: info.email,
        phone: info.phone,
      },
      { name: info.courseName, duration: info.totalLessons },
      info.paymentAmount,
      info.enrollmentId,
      toast,
      info.courseType,
    );
  };

  const handleCreated = (info: CreatedLearnerInfo) => {
    // Only a classes-only enrollment can take the existing payment page; an
    // RTO-only case has no enrollment to send a link for.
    if (info.enrollmentId && info.caseType === "classes_only") {
      dispatchLink(info).catch((err) => {
        console.error("Auto payment link dispatch failed:", err);
      });
    }
    // Switch straight into the full learner view — the same 4 actions (Send
    // Payment Link / Edit / Additional service / Delete) and History & orders
    // that "Find learner" opens — and stay there until Back is clicked.
    onTarget({
      name: info.name,
      phone: info.phone,
      email: info.email,
      via: "just created",
    });
  };

  return (
    // Two cards side by side on wide screens, stacked on narrow ones: Find
    // learner on the left (orders/payments/booking for someone who already
    // exists), New learner on the right (same create + send-link flow as
    // Learner Management, without leaving the dashboard).
    <div className="mt-2 flex flex-col gap-2 lg:flex-row">
      <section
        aria-label="Find learner"
        className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 shadow-sm"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Search size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight">
              Find learner
            </h2>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Orders, payments and booking for any learner. No slot needed.
            </p>
          </div>
        </div>

        <div
          role="tablist"
          className="flex shrink-0 gap-0.5 rounded-lg border bg-background p-0.5"
        >
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={mode === m.key}
              onClick={() => {
                setMode(m.key);
                setValue("");
                setMessage(null);
              }}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition",
                mode === m.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="min-w-[240px] flex-1 basis-[320px]">
          {mode === "name" ? (
            <LearnerNameSearch
              placeholder="Learner name or e-mail"
              listMaxHeight="max-h-72"
              onPick={(l) => {
                const phone = tenDigitPhone(l.phone);
                if (!phone) {
                  setMessage("That learner has no phone number on file.");
                  return;
                }
                setMessage(null);
                onTarget({
                  name: l.name ?? "",
                  phone,
                  email: l.email ?? undefined,
                  via: "Name",
                });
              }}
            />
          ) : (
            <div className="flex gap-1.5">
              <Input
                className="h-8 text-xs"
                value={value}
                inputMode={mode === "phone" ? "numeric" : undefined}
                onChange={(e) => setValue(e.target.value)}
                placeholder={
                  mode === "lead" ? "Cratio Lead ID" : "10-digit phone number"
                }
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="h-8 shrink-0 px-4 text-xs"
                onClick={submit}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
              </Button>
            </div>
          )}
        </div>

        {message && (
          <p className="basis-full text-[11px] text-muted-foreground">
            {message}
          </p>
        )}
      </section>

      {/* New learner: create a profile and send the payment link, same flow
          as Learner Management's "Create Learner" card. */}
      <section
        aria-label="New learner"
        className="flex flex-wrap items-center gap-2.5 rounded-xl border border-emerald-600/25 bg-emerald-600/5 px-3 py-2.5 shadow-sm lg:flex-none"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700">
          <UserPlus size={16} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-tight">New learner</h2>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Create a profile and send the payment link.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="ml-auto h-8 shrink-0 border-emerald-600/40 px-4 text-xs text-emerald-800 hover:bg-emerald-600/10 lg:ml-0"
          onClick={() => setCreateOpen(true)}
        >
          <UserPlus size={14} className="mr-1.5" />
          Create learner
        </Button>
      </section>

      <CreateLearnerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}

/**
 * The learner opened from Find learner: shown in the left column in place of
 * the slot / booking panel (the booking form is only hidden, not lost), with
 * the learner's actions and History & orders. Closing it, or clicking any slot
 * on the calendar, brings the slot panel back.
 */
export function FindLearnerResult({
  target,
  onClose,
  onBookClasses,
  onEditSlots,
}: {
  target: LookupTarget;
  onClose: () => void;
  onBookClasses?: (intent: BookingIntent) => void;
  onEditSlots?: (slots: OrderSlot[]) => void;
}) {
  const canSeePhone = useCanSeeCustomerPhone();
  return (
    <section
      aria-label="Learner"
      className="flex min-h-0 flex-1 flex-col rounded-xl border border-primary/25 bg-primary/5 p-3 shadow-sm"
    >
      <div className="flex flex-none items-center justify-between gap-2 rounded-md bg-background px-2 py-1 text-[11px]">
        <span className="min-w-0 truncate">
          {target.name || "Learner"} · found by {target.via}
          {canSeePhone
            ? ` · ${target.phone}`
            : ` · ${maskPhoneNumber(target.phone)}`}
        </span>
        <button
          type="button"
          aria-label="Back to search"
          onClick={onClose}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium hover:bg-muted"
        >
          <X size={14} />
          Back
        </button>
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg border bg-background p-2 [scrollbar-gutter:stable]">
        <SlotLearnerActions
          key={target.phone}
          customer={{
            name: target.name,
            phone: target.phone,
            email: target.email,
            course: "",
            paymentStatus: "unpaid",
          }}
          onBookClasses={onBookClasses}
          onEditSlots={onEditSlots}
        />
      </div>
    </section>
  );
}
