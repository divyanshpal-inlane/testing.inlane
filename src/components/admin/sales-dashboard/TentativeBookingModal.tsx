import { useMutation } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { BulkType } from "@/lib/sales-dashboard/bulkSlots";
import { generateBulkSlots } from "@/lib/sales-dashboard/bulkSlots";
// TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
import { measureApi, trackEvent } from "@/lib/sales-dashboard/tempMonitoring";
import { minutesToTime, timeToMinutes } from "@/lib/sales-dashboard/validation";
import { isValidPhone, normalizePhone } from "@/lib/sales-dashboard/validation";
import { supabase } from "@/lib/supabaseClient";
import { checkInstructorAvailability } from "@/queries/instructor";

import { AddressAutocomplete } from "./AddressAutocomplete";

export interface TentativeBookingData {
  instructorId: string;
  date: string;
  startMinute: number;
  endMinute: number;
  customerName: string;
  customerPhone: string;
  salesAgent: string;
  paymentStatus: "unpaid" | "half_paid" | "full_paid";
  customerAddress: string;
  course: string;
}

// One selected class in the batch. Task 19 (multiple-class booking): a
// single customer form can carry N of these — one Schedule row gets
// created per slot, all sharing the same tentative_details.
export interface SlotPick {
  instructorId: string;
  instructorName: string;
  date: string;
  startTime: string;
  endTime: string;
  // Present only when this row already exists in the DB (edit mode): the
  // Schedule row id it maps to. Absent for a freshly added class, which is
  // inserted rather than updated on submit.
  scheduleId?: number;
}

export interface CustomerFormValues {
  customerName: string;
  customerPhone: string;
  salesAgent: string;
  paymentStatus: "unpaid" | "half_paid" | "full_paid";
  customerAddress: string;
  course: string;
}

export const DEFAULT_CUSTOMER_FORM = (
  currentUserName = "",
  address = "",
): CustomerFormValues => ({
  customerName: "",
  customerPhone: "",
  salesAgent: currentUserName,
  paymentStatus: "unpaid",
  customerAddress: address,
  course: "demo",
});

interface TentativeBookingModalProps {
  isOpen: boolean;
  // "modal" (default) = the centred dialog over a dimmed backdrop.
  // "panel" = no backdrop; the same form renders inline inside the
  // dashboard's right-hand slot panel so the calendar stays visible and
  // the grid is never covered while Sales fills the form in.
  variant?: "modal" | "panel";
  onClose: () => void;
  onSuccess: () => void;
  // 1..N slots. The modal renders nothing if this is empty while open —
  // the parent owns exactly when that can happen.
  slots: SlotPick[];
  onRemoveSlot: (index: number) => void;
  // Hides the modal (without losing formData/slots — both live in the
  // parent) and arms "pick another slot" mode on the grid.
  onAddAnotherSlot: () => void;
  // "Change slot" on a conflicting class: hides the modal and sends Sales to
  // the calendar; the next free slot they double-click REPLACES this row
  // (index into `slots`) and the modal reopens.
  onChangeSlot?: (index: number) => void;
  // Adds multiple slots at once (from the Bulk Add dialog). The parent
  // validates each one (overlap with the batch, instructor busy) and appends
  // only those that pass. It reports what happened so the dialog can show
  // Sales exactly which slots were skipped and why.
  onAddBulkSlots?: (
    newSlots: SlotPick[],
  ) => Promise<{ added: number; skipped: string[] }>;
  // Fresh re-check of one slot's availability at submit time — the grid
  // could have changed since it was added to the batch. `reason` is only
  // present when `ok` is false, and explains *why* (e.g. a buffer
  // conflict vs. a genuine double-booking) for the error message.
  validateSlot: (slot: SlotPick) => { ok: boolean; reason?: string };
  formData: CustomerFormValues;
  onFormDataChange: (data: CustomerFormValues) => void;
  // Present when editing an existing tentative booking (the Edit action on a
  // tentative slot's panel). The shared customer fields in `formData` are
  // saved back onto EVERY row of the booking; each row's date/time comes from
  // `slots`, matched to a Schedule row by `SlotPick.scheduleId`. Rows dropped
  // from `slots` are deleted, rows added are inserted, the rest updated.
  // `rowIds` is the original set of Schedule ids that formed the booking.
  editContext?: {
    batchId: string | null;
    baseDetails: Record<string, unknown> | null;
    rowIds: number[];
  } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const COURSES = [
  { id: "demo", label: "Demo Class" },
  { id: "course_4", label: "4-Class Course" },
  { id: "course_5", label: "5-Class Course" },
  { id: "course_6", label: "6-Class Course" },
  { id: "course_10", label: "10-Class Course" },
  { id: "course_15", label: "15-Class Course" },
  { id: "course_20", label: "20-Class Course" },
];

function formatSlotTime(startTime: string, endTime: string): string {
  try {
    return `${minutesToTime(timeToMinutes(startTime))}–${minutesToTime(timeToMinutes(endTime))}`;
  } catch {
    return `${startTime}–${endTime}`;
  }
}

// Translates the raw Postgres error from a losing race against the
// schedule_no_overlap_new_rows exclusion constraint (code 23P01 -- fires on
// exact duplicates, partial overlaps, and concurrent inserts for the same
// slot alike) into a message a sales agent can actually act on, instead of
// surfacing "conflicting key value violates exclusion constraint...".
function friendlyBookingError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "23P01" || code === "23505") {
    return "This slot was just booked by another sales agent. Please close this and pick a different time.";
  }
  // Duck-typed, not `instanceof Error` -- the object thrown from a failed
  // Supabase/Postgrest call isn't necessarily a real Error instance, but
  // does carry a .message.
  const message = (error as { message?: string } | null)?.message;
  return message || "Failed to create tentative booking";
}

export const TentativeBookingModal: React.FC<TentativeBookingModalProps> = ({
  isOpen,
  variant = "modal",
  onClose,
  onSuccess,
  slots,
  onRemoveSlot,
  onAddAnotherSlot,
  onChangeSlot,
  onAddBulkSlots,
  validateSlot,
  formData,
  onFormDataChange,
  editContext = null,
}) => {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState("");
  // Bulk Add Schedules dialog state
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [bulkType, setBulkType] = useState<BulkType>("single");
  const [bulkDate, setBulkDate] = useState("");
  const [bulkTimes, setBulkTimes] = useState({ start: "09:00", end: "10:00" });
  const [repeatCount, setRepeatCount] = useState(1);
  const [isApplyingBulk, setIsApplyingBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    added: number;
    skipped: string[];
  } | null>(null);

  // Conflict detection (matches Instructor Management)
  const [availabilityMap, setAvailabilityMap] = useState<
    Record<string, { available: boolean; reason?: string }>
  >({});

  // Free / Conflict for one row. Conflict = the instructor is busy (DB check,
  // same query as Instructor Management) OR the row repeats an earlier row of
  // this booking (same date + start), which would be rejected by the DB
  // overlap constraint at submit. `checked` is false until the check returns.
  const getSlotStatus = (index: number) => {
    const s = slots[index];
    // An existing row of the booking being edited (scheduleId set) IS the
    // instructor's busy block, so the availability check below will always
    // report it as taken -- treating that as a conflict would light up every
    // row of the booking and permanently disable Save. Nothing has changed
    // about an existing row until Sales "Change slot"s it (which drops its
    // scheduleId), so it is known-good and never a conflict here.
    const isExisting = s.scheduleId != null;
    const avail = availabilityMap[`${s.date}-${s.startTime}`];
    const isDuplicate = slots.some(
      (o, j) => j < index && o.date === s.date && o.startTime === s.startTime,
    );
    if (isDuplicate) {
      return {
        conflict: true,
        checked: true,
        reason: "Duplicate of an earlier class",
      };
    }
    if (avail?.available === false && !isExisting) {
      return {
        conflict: true,
        checked: true,
        reason: avail.reason || "Not available",
      };
    }
    return {
      conflict: false,
      checked: isExisting || avail !== undefined,
      reason: "",
    };
  };
  const hasAnyConflict = slots.some((_, i) => getSlotStatus(i).conflict);

  // Check instructor availability for all slots (matches Instructor Management)
  useEffect(() => {
    const checkAvailability = async () => {
      if (slots.length === 0 || !slots[0]?.instructorId) {
        setAvailabilityMap({});
        return;
      }
      try {
        const result = await checkInstructorAvailability(
          slots.map((s) => ({
            date: s.date,
            start_time: s.startTime,
            end_time: s.endTime,
          })),
          slots[0].instructorId,
        );
        setAvailabilityMap(result);
      } catch (err) {
        console.error("Availability Check Failed:", err);
        setAvailabilityMap({});
      }
    };
    checkAvailability();
  }, [slots]);

  // This component never unmounts between bookings -- it just renders null
  // while isOpen is false (see the early return below) -- so without this,
  // an error from a PREVIOUS failed attempt (e.g. "Class 1 (9:00-10:00,
  // Instructor X) is no longer available") stayed on screen the next time
  // the modal opened for a completely unrelated slot, until the user
  // happened to submit again and overwrite it. Opening fresh should always
  // start from a clean slate.
  useEffect(() => {
    if (isOpen) setErrors({});
  }, [isOpen]);

  // Escape is now one of the ways out of the Bulk Add dialog (the backdrop no
  // longer dismisses it -- see the overlay). Bound on document so it works
  // wherever focus happens to be inside the dialog, and cleaned up so it cannot
  // fire for a closed dialog.
  useEffect(() => {
    if (!isBulkDialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isApplyingBulk) return;
      e.stopPropagation();
      setIsBulkDialogOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isBulkDialogOpen, isApplyingBulk]);

  // Opens the dialog seeded from the LAST class in the batch, so "daily" /
  // "hourly" read naturally: the copies continue from the class Sales just
  // picked (see generateBulkSlots - the first copy is the next day / hour).
  const openBulkDialog = () => {
    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
    trackEvent("bulk_add_opened", {
      instructorId: slots[0]?.instructorId,
      slotDate: slots[slots.length - 1]?.date ?? null,
      customerName: formData.customerName,
      success: true,
      details: { bulk_type: "single", repeat_count: 1 },
    });
    const last = slots[slots.length - 1];
    if (last) {
      setBulkDate(last.date);
      setBulkTimes({
        start: last.startTime.slice(0, 5),
        end: last.endTime.slice(0, 5),
      });
    }
    setBulkType("single");
    setRepeatCount(1);
    setBulkResult(null);
    setIsBulkDialogOpen(true);
  };

  const handleApplyBulkSchedules = async () => {
    if (!onAddBulkSlots || slots.length === 0 || isApplyingBulk) return;
    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
    trackEvent("bulk_add_opened", {
      instructorId: slots[0]?.instructorId,
      slotDate: bulkDate || null,
      customerName: formData.customerName,
      success: true,
      details: { bulk_type: bulkType, repeat_count: repeatCount },
    });
    if (!bulkDate) {
      setBulkResult({ added: 0, skipped: ["Pick a date first."] });
      return;
    }

    // Every class in a booking belongs to the same instructor (the parent
    // enforces the lock), so the batch's first slot supplies who.
    const { instructorId, instructorName } = slots[0];
    const generated: SlotPick[] = generateBulkSlots({
      bulkType,
      date: bulkDate,
      startTime: bulkTimes.start,
      endTime: bulkTimes.end,
      repeatCount,
    }).map((s) => ({ ...s, instructorId, instructorName }));

    // Exactly like Instructor Management: EVERY generated slot is added to
    // the list, none are filtered out here. Free/Conflict is shown per row by
    // the availability effect on `slots`, and a conflicting row blocks submit
    // until the user removes it. (Dropping conflicting slots here used to turn
    // 10 copies into 7 and left the dialog open, so a second click re-added
    // the same slots.)
    setIsApplyingBulk(true);
    try {
      const result = await onAddBulkSlots(generated);
      if (result.skipped.length === 0) {
        setIsBulkDialogOpen(false);
      } else {
        setBulkResult({ added: result.added, skipped: result.skipped });
      }
    } catch (err) {
      setBulkResult({
        added: 0,
        skipped: [
          (err as { message?: string } | null)?.message ||
            "Could not add the slots. Please try again.",
        ],
      });
    } finally {
      setIsApplyingBulk(false);
    }
  };

  const createTentativeMutation = useMutation({
    mutationFn: async () => {
      if (slots.length === 0) throw new Error("No slot selected");

      const normalizedPhone = normalizePhone(formData.customerPhone);
      if (!normalizedPhone) {
        throw new Error("Invalid phone number");
      }

      const tentativeDetails = {
        name: formData.customerName,
        phone: normalizedPhone,
        sales_agent: formData.salesAgent,
        payment_status: formData.paymentStatus,
        address: formData.customerAddress,
        course: formData.course,
        // Groups every row written by one booking (a multi-class batch or a
        // single slot) so a later Edit can find all the rows booked together
        // without guessing from phone/name. Legacy rows created before this
        // field existed have none -- the Edit lookup falls back to phone+name.
        batch_id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      };

      if (editContext) {
        // Edit an existing tentative booking in place. The shared customer
        // fields apply to every row; the per-row date/time comes from `slots`.
        const batchId = editContext.batchId ?? crypto.randomUUID();
        const editDetails: Record<string, unknown> = {
          ...(editContext.baseDetails ?? {}),
          name: formData.customerName,
          phone: normalizedPhone,
          sales_agent: formData.salesAgent,
          payment_status: formData.paymentStatus,
          address: formData.customerAddress,
          course: formData.course,
          batch_id: batchId,
          updated_at: new Date().toISOString(),
        };

        // Rows that belonged to the booking but are no longer in `slots`
        // were removed. Deleted FIRST so a class moved onto a time freed by
        // one of them cannot collide with the row it replaced.
        const removedIds = editContext.rowIds.filter(
          (id) => !slots.some((s) => s.scheduleId === id),
        );
        for (const id of removedIds) {
          const { error } = await measureApi(
            "schedule.delete_removed",
            () => sb.from("Schedule").delete().eq("id", id),
            {
              method: "DELETE",
              details: { is_edit: true },
              resolveError: (res) =>
                (res as { error?: unknown } | null)?.error ?? null,
            },
          );
          if (error) throw error;
        }

        // Changed classes: update the exact Schedule row each SlotPick maps to.
        for (const s of slots) {
          if (s.scheduleId == null) continue;
          const { error } = await measureApi(
            "schedule.update_tentative",
            () =>
              sb
                .from("Schedule")
                .update({
                  date: s.date,
                  start_time: s.startTime,
                  end_time: s.endTime,
                  tentative_details: editDetails,
                })
                .eq("id", s.scheduleId),
            {
              method: "PATCH",
              details: { is_edit: true },
              resolveError: (res) =>
                (res as { error?: unknown } | null)?.error ?? null,
            },
          );
          if (error) throw error;
        }

        // Added classes: no scheduleId -> brand new rows in the same booking.
        const addedRows = slots
          .filter((s) => s.scheduleId == null)
          .map((s) => ({
            instructor_id: s.instructorId,
            date: s.date,
            start_time: s.startTime,
            end_time: s.endTime,
            status: "hold",
            isTentative: true,
            tentative_details: editDetails,
            learner_id: null,
            course_id: null,
            lesson_id: null,
          }));
        if (addedRows.length > 0) {
          const { error } = await measureApi(
            "schedule.insert_tentative",
            () => sb.from("Schedule").insert(addedRows),
            {
              method: "POST",
              details: { rows: addedRows.length, is_edit: true },
              resolveError: (res) =>
                (res as { error?: unknown } | null)?.error ?? null,
            },
          );
          if (error) throw error;
        }
        return;
      }

      // Re-validate every slot fresh — the grid could have changed since
      // any of them were added to the batch. Fail on the FIRST conflict
      // found, naming exactly which class it is, and don't attempt any
      // insert at all: partial creation would leave a confusing mix of
      // real and missing classes for a batch the user thinks either all
      // happened or none did.
      for (let i = 0; i < slots.length; i++) {
        const result = validateSlot(slots[i]);
        if (!result.ok) {
          const s = slots[i];
          throw new Error(
            `Class ${i + 1} (${s.date} • ${formatSlotTime(s.startTime, s.endTime)} • ${s.instructorName}) is ${result.reason ?? "no longer available"}. Remove or change it and try again.`,
          );
        }
      }

      const rows = slots.map((s) => ({
        instructor_id: s.instructorId,
        date: s.date,
        start_time: s.startTime,
        end_time: s.endTime,
        status: "hold",
        isTentative: true,
        tentative_details: tentativeDetails,
        learner_id: null,
        course_id: null,
        lesson_id: null,
      }));

      // A single multi-row insert is one Postgres statement — if any row
      // conflicts (e.g. a race with another sales agent since we
      // validated above), the exclusion constraint rejects the whole
      // statement and NONE of the rows are created. That's what gives
      // this batch "all or nothing" behavior using nothing more than the
      // existing single-row insert path, just called with N rows.
      const { error } = await measureApi(
        "schedule.insert_tentative",
        () => sb.from("Schedule").insert(rows),
        {
          method: "POST",
          details: { rows: rows.length },
          resolveError: (res) =>
            (res as { error?: unknown } | null)?.error ?? null,
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      // One row per created hold (the parent logs the same rows from
      // handleTentativeSuccess with the customer-side context); this is the
      // authoritative "the database accepted it" signal, and it is the only
      // place the row count of a multi-class batch is known for sure.
      trackEvent("booking_written", {
        instructorId: slots[0]?.instructorId,
        customerName: formData.customerName,
        success: true,
        details: {
          rows_written: slots.length,
          is_edit: Boolean(editContext),
          course: formData.course,
          payment_status: formData.paymentStatus,
        },
      });
      setSuccessMessage(
        editContext
          ? "Tentative booking updated successfully!"
          : slots.length > 1
            ? `${slots.length} tentative classes booked successfully!`
            : "Tentative slot booked successfully!",
      );
      setTimeout(() => {
        setErrors({});
        setSuccessMessage("");
        onSuccess();
      }, 1500);
    },
    onError: (error: Error) => {
      // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
      // Every failed attempt, with the Postgres code kept intact (23P01 is the
      // "another agent booked this slot first" race; 23505 a duplicate).
      trackEvent("booking_failed", {
        instructorId: slots[0]?.instructorId,
        slotDate: slots[0]?.date ?? null,
        slotStart: slots[0]?.startTime ?? null,
        customerName: formData.customerName,
        success: false,
        error,
        details: {
          requested_rows: slots.length,
          message: friendlyBookingError(error).slice(0, 200),
        },
      });
      setErrors({ submit: friendlyBookingError(error) });
    },
  });

  // Escape closes the booking form too. In `modal` variant this was free - it
  // is a Radix <Dialog> - but the panel variant is plain markup, so moving the
  // form into the side panel silently dropped keyboard dismissal. Bound on
  // document for the same reason as the Bulk Add handler above, and skipped
  // while that dialog is up: it owns Escape, and both listeners sit on the
  // same node, where stopPropagation cannot separate them (that needs
  // stopImmediatePropagation, which would break unrelated handlers).
  //
  // This MUST stay below `createTentativeMutation`. A dep array is evaluated
  // during render, so naming that const from a hook above its declaration is a
  // temporal-dead-zone read - it throws "Cannot access 'x' before
  // initialization" the moment the form first renders, and the route's error
  // boundary replaces the whole dashboard with "Something went wrong".
  useEffect(() => {
    if (!isOpen || isBulkDialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || createTentativeMutation.isPending) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, isBulkDialogOpen, onClose, createTentativeMutation.isPending]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.customerName.trim()) {
      newErrors.customerName = "Customer name is required";
    }
    if (!formData.customerPhone.trim()) {
      newErrors.customerPhone = "Phone number is required";
    } else if (!isValidPhone(formData.customerPhone)) {
      // normalizePhone() alone would accept e.g. "0987654321" — 10 digits,
      // but not a real Indian mobile number (can't start with 0).
      // isValidPhone() additionally rejects that case.
      newErrors.customerPhone = "Invalid phone number";
    }
    if (!formData.salesAgent.trim()) {
      newErrors.salesAgent =
        "Couldn't identify your account yet — wait a moment and try again.";
    }
    if (!formData.customerAddress.trim()) {
      newErrors.customerAddress = "Address is required";
    }
    if (!formData.course) {
      newErrors.course = "Course selection is required";
    }
    if (slots.length === 0) {
      newErrors.submit = "Select at least one slot";
    }

    setErrors(newErrors);
    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
    // A rejected form never reaches the database, so without this the
    // "attempts vs bookings" funnel would count a validation failure as if it
    // had never happened. Field NAMES only -- never the entered values.
    if (Object.keys(newErrors).length > 0) {
      trackEvent("booking_validation_failed", {
        instructorId: slots[0]?.instructorId,
        // The customer may be the very field that failed validation, so record
        // whatever was typed -- an empty name is stored as null, not guessed.
        customerName: formData.customerName,
        success: false,
        errorMessage: Object.keys(newErrors).sort().join(","),
        details: {
          fields: Object.keys(newErrors),
          customer_mode: "new",
          batch_size: slots.length,
        },
      });
    }
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
    // The attempt itself. Success/failure is recorded by the mutation's
    // onSuccess/onError and by booking_validation_failed below.
    trackEvent("booking_submitted", {
      instructorId: slots[0]?.instructorId,
      slotDate: slots[0]?.date ?? null,
      slotStart: slots[0]?.startTime ?? null,
      customerName: formData.customerName,
      success: null,
      details: {
        batch_size: slots.length,
        is_edit: Boolean(editContext),
        course: formData.course,
        payment_status: formData.paymentStatus,
      },
    });
    if (validateForm()) {
      createTentativeMutation.mutate();
    }
  };

  if (!isOpen || slots.length === 0) return null;

  const set = <K extends keyof CustomerFormValues>(
    key: K,
    value: CustomerFormValues[K],
  ) => onFormDataChange({ ...formData, [key]: value });

  // In "panel" variant the host div stops being a fixed, dimmed backdrop:
  // CSS drops position/inset/z-index/background/padding and the form
  // stretches to fill the dashboard's right-hand column. onClick stays bound
  // -- the inner .modal stops propagation, and in panel mode it covers the
  // host completely, so there is no backdrop left to click-dismiss.
  const asPanel = variant === "panel";

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={asPanel ? "modal-backdrop modal-panel-host" : "modal-backdrop"}
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={asPanel ? "modal modal-panel" : "modal"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>
            {editContext
              ? "Edit Tentative Booking"
              : "Create Tentative Slot Booking"}
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close booking modal"
          >
            ×
          </button>
        </div>

        {successMessage && (
          <div className="mb-4 rounded-lg bg-green-100 p-3 text-sm text-green-700 dark:bg-green-900 dark:text-green-200">
            {successMessage}
          </div>
        )}

        {errors.submit && (
          <div className="mb-4 rounded-lg bg-red-100 p-3 text-sm text-red-700 dark:bg-red-900 dark:text-red-200">
            {errors.submit}
          </div>
        )}

        {/* Use div instead of <form> to avoid nested-form double-submit.
            The modal is rendered inside the admin instructor form, so a native
            <form onSubmit> would be nested and fire twice. */}
        <div className="space-y-4">
          {/* Selected Slots */}
          <div className="rounded-lg border border-border bg-muted p-3">
            {/* Title + status pills share one wrappable row; the two actions
                get their OWN full-width row below. They used to sit in the
                same justify-between row as the title and the pills, which in
                a ~400px side panel squeezed all four onto one line: the button
                labels wrapped to two lines each, the pills shrank, and
                nothing lined up. Two equal columns keep them one line tall and
                identically sized. */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
              <span className="text-sm font-medium text-foreground">
                {editContext
                  ? `Classes in this booking (${slots.length})`
                  : `Selected Slots (${slots.length})`}
              </span>
              {(
                <div className="flex flex-wrap items-center gap-1.5">
                  {(() => {
                    const statuses = slots.map((_, i) => getSlotStatus(i));
                    const conflictCount = statuses.filter(
                      (st) => st.conflict,
                    ).length;
                    const freeCount = statuses.filter(
                      (st) => st.checked && !st.conflict,
                    ).length;
                    return (
                      <>
                        {freeCount > 0 && (
                          <span className="inline-flex items-center whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">
                            {freeCount} Free
                          </span>
                        )}
                        {conflictCount > 0 && (
                          <span className="inline-flex items-center whitespace-nowrap rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                            {conflictCount} Conflict
                            {conflictCount > 1 ? "s" : ""}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
            {!editContext && (
              <div className="mb-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="whitespace-nowrap rounded-full bg-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:hover:bg-blue-800"
                  onClick={() => {
                    // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
                    trackEvent("booking_add_another_class_clicked", {
                      instructorId: slots[0]?.instructorId,
                      customerName: formData.customerName,
                      success: true,
                      details: { batch_size: slots.length },
                    });
                    onAddAnotherSlot();
                  }}
                >
                  + Add another class
                </button>
                <button
                  type="button"
                  className="whitespace-nowrap rounded-full bg-purple-100 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-200 dark:hover:bg-purple-800"
                  onClick={openBulkDialog}
                >
                  ⚡ Bulk Add
                </button>
              </div>
            )}
            <div className="space-y-1.5">
              {slots.map((s, i) => {
                const status = getSlotStatus(i);
                return (
                  <div
                    key={`${s.instructorId}-${s.date}-${s.startTime}-${i}`}
                    className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 rounded-md bg-background px-2 py-1.5 text-sm text-foreground"
                  >
                    {/* The label is allowed to wrap and take the full first
                        line; the pills and buttons are one nowrap group that
                        sits beside it (or drops below it when it is long). */}
                    <span className="min-w-0 flex-1">
                      Class {i + 1}: {s.date} •{" "}
                      {formatSlotTime(s.startTime, s.endTime)} •{" "}
                      {s.instructorName}
                    </span>
                    <span className="flex flex-none items-center gap-1.5">
                      {status.conflict ? (
                        <>
                          {/* Just "Conflict": the reason is not spelled out
                              in the row (kept as a hover tooltip only). */}
                          <span
                            className="inline-flex items-center whitespace-nowrap rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                            title={status.reason || undefined}
                          >
                            Conflict
                          </span>
                          {onChangeSlot && (
                            <button
                              type="button"
                              className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:hover:bg-amber-800"
                              aria-label={`Change slot for class ${i + 1}`}
                              onClick={() => onChangeSlot(i)}
                            >
                              Change slot
                            </button>
                          )}
                        </>
                      ) : (
                        status.checked && (
                          <>
                            <span className="inline-flex items-center whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">
                              {s.scheduleId != null ? "Saved" : "Free"}
                            </span>
                            {/* Edit mode: every class's date/time is editable,
                                so offer "Change time" even on a row that is not
                                in conflict (its own hold is why the DB check
                                would call it busy). */}
                            {editContext && onChangeSlot && (
                              <button
                                type="button"
                                className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:hover:bg-amber-800"
                                aria-label={`Change time for class ${i + 1}`}
                                onClick={() => onChangeSlot(i)}
                              >
                                Change time
                              </button>
                            )}
                          </>
                        )
                      )}
                      {slots.length > 1 && (
                        <button
                          type="button"
                          className="flex-none rounded-full px-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900"
                          aria-label={`Remove class ${i + 1}`}
                          onClick={() => {
                            // TEMP SALES DASHBOARD MONITORING / REMOVE BEFORE PRODUCTION
                            trackEvent("booking_slot_removed_clicked", {
                              instructorId: slots[i]?.instructorId,
                              slotDate: slots[i]?.date,
                              customerName: formData.customerName,
                              success: true,
                              details: { batch_size: slots.length },
                            });
                            onRemoveSlot(i);
                          }}
                        >
                          &times;
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Customer Name */}
          <div>
            <label
              htmlFor="customerName"
              className="block text-sm font-medium text-foreground"
            >
              Customer Name *
            </label>
            <input
              id="customerName"
              type="text"
              value={formData.customerName}
              onChange={(e) => set("customerName", e.target.value)}
              placeholder="Enter customer name"
              className={`mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                errors.customerName ? "border-destructive" : "border-input"
              }`}
            />
            {errors.customerName && (
              <p className="mt-1 text-xs text-destructive">
                {errors.customerName}
              </p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label
              htmlFor="customerPhone"
              className="block text-sm font-medium text-foreground"
            >
              Phone Number *
            </label>
            <input
              id="customerPhone"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={formData.customerPhone}
              onChange={(e) =>
                set(
                  "customerPhone",
                  e.target.value.replace(/\D/g, "").slice(0, 10),
                )
              }
              placeholder="10-digit phone number"
              className={`mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                errors.customerPhone ? "border-destructive" : "border-input"
              }`}
            />
            {errors.customerPhone && (
              <p className="mt-1 text-xs text-destructive">
                {errors.customerPhone}
              </p>
            )}
          </div>

          {/* Sales Agent -- read-only, set to whoever is actually logged in
              (see currentUserName in SalesDashboard.tsx). This used to be
              free text nobody was required to fill in accurately, so there
              was no reliable way to trace who created a given booking;
              locking it to the real account closes that gap. */}
          <div>
            <label
              htmlFor="salesAgent"
              className="block text-sm font-medium text-foreground"
            >
              Sales Agent
            </label>
            <input
              id="salesAgent"
              type="text"
              readOnly
              value={formData.salesAgent}
              placeholder="Loading…"
              className={`mt-1 w-full rounded-lg border border-input bg-muted px-3 py-2 text-sm text-muted-foreground ${
                errors.salesAgent ? "border-destructive" : "border-input"
              }`}
            />
            {errors.salesAgent && (
              <p className="mt-1 text-xs text-destructive">
                {errors.salesAgent}
              </p>
            )}
          </div>

          {/* Payment Status */}
          <div>
            <label
              htmlFor="paymentStatus"
              className="block text-sm font-medium text-foreground"
            >
              Payment Status
            </label>
            <select
              id="paymentStatus"
              value={formData.paymentStatus}
              onChange={(e) =>
                set(
                  "paymentStatus",
                  e.target.value as "unpaid" | "half_paid" | "full_paid",
                )
              }
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="unpaid">Unpaid</option>
              <option value="half_paid">Half Paid</option>
              <option value="full_paid">Full Paid</option>
            </select>
          </div>

          {/* Address with Google Places Autocomplete */}
          <div>
            <label
              htmlFor="customerAddress"
              className="block text-sm font-medium text-foreground"
            >
              Customer Address *
            </label>
            <AddressAutocomplete
              id="customerAddress"
              value={formData.customerAddress}
              onChange={(address) => set("customerAddress", address)}
              placeholder="Search address..."
            />
            {errors.customerAddress && (
              <p className="mt-1 text-xs text-destructive">
                {errors.customerAddress}
              </p>
            )}
          </div>

          {/* Course */}
          <div>
            <label
              htmlFor="course"
              className="block text-sm font-medium text-foreground"
            >
              Course *
            </label>
            <select
              id="course"
              value={formData.course}
              onChange={(e) => set("course", e.target.value)}
              className={`mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                errors.course ? "border-destructive" : "border-input"
              }`}
            >
              {COURSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {errors.course && (
              <p className="mt-1 text-xs text-destructive">{errors.course}</p>
            )}
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={createTentativeMutation.isPending}
              className="flex-1 rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={createTentativeMutation.isPending || hasAnyConflict}
              className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createTentativeMutation.isPending
                ? editContext
                  ? "Saving..."
                  : "Booking..."
                : editContext
                  ? "Save Changes"
                  : slots.length > 1
                    ? `Create ${slots.length} Tentative Blocks`
                    : "Create Tentative Block"}
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Add Schedules. Deliberately NOT the shared Radix <Dialog>: that
          portals at z-50 (and so does its <Select> dropdown), which is BEHIND
          this modal's z-100 backdrop - it would open invisibly. It would also
          bubble clicks (React events cross portals) up to the backdrop's
          onClick={onClose}, closing the whole booking and wiping the batch.
          A plain overlay above the backdrop, with propagation stopped, avoids
          both.

          It is portalled to document.body, which is load-bearing rather than
          cosmetic. In panel mode this tree sits inside `ASIDE.slot-panel`,
          which is `position: sticky` - and sticky creates a stacking context
          regardless of z-index. So `z-[110]` only ranked the overlay inside
          the panel's own context (which itself sits at z-index auto => 0),
          while the availability grid's sticky `th.col-time-h` (z-index 2)
          ranks in the shared parent context and therefore paints OVER the
          dialog. The overlay was fully visible but its lower half was dead to
          clicks: "Add to Preview" timed out, and the feature read as a dead
          button. A body's children compete at the root, so z-[110] finally
          means what it says. */}
      {isBulkDialogOpen &&
        createPortal(
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-6"
            // Only ever stops propagation. It used to close the dialog, which
            // made the feature look broken: the panel is 448px wide inside a
            // full-viewport overlay, and the "Bulk Add" button that opens it sits
            // ABOVE the panel's top edge -- i.e. over this overlay. The second
            // click of a double-click (or any click landing beside the panel)
            // therefore hit the backdrop and dismissed the dialog the instant it
            // appeared, throwing away the seeded date/time. The screen darkened
            // and no dialog was left, which is exactly "Bulk Add does not work".
            // Dismissal is explicit instead: the x, Cancel/Close, or Escape.
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions */}
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="bulk-add-title"
              className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 id="bulk-add-title" className="text-lg font-semibold">
                  Bulk Add Schedules
                </h3>
                <button
                  type="button"
                  aria-label="Close bulk add"
                  disabled={isApplyingBulk}
                  onClick={() => setIsBulkDialogOpen(false)}
                  className="rounded-full px-2 text-xl leading-none text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  ×
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                Adds classes for {slots[0]?.instructorName}. Daily and hourly
                copies start from the day / hour <em>after</em> the date and
                time below.
              </p>

              <div>
                <label
                  htmlFor="bulkType"
                  className="block text-sm font-medium text-foreground"
                >
                  Bulk Action
                </label>
                <select
                  id="bulkType"
                  value={bulkType}
                  onChange={(e) => setBulkType(e.target.value as BulkType)}
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="single">Single Schedule</option>
                  <option value="daily">Bulk Daily</option>
                  <option value="hourly">Bulk Hourly</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="bulkDate"
                  className="block text-sm font-medium text-foreground"
                >
                  Date
                </label>
                <input
                  id="bulkDate"
                  type="date"
                  value={bulkDate}
                  onChange={(e) => setBulkDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="bulkStart"
                    className="block text-sm font-medium text-foreground"
                  >
                    Start Time
                  </label>
                  <input
                    id="bulkStart"
                    type="time"
                    step={1800}
                    value={bulkTimes.start}
                    onChange={(e) => {
                      // Same as Instructor Management: moving the start moves
                      // the end to start + 1h (Sales classes are 60 minutes).
                      const start = e.target.value;
                      setBulkTimes({
                        start,
                        end: start
                          ? minutesToTime(
                              Math.min(timeToMinutes(start) + 60, 24 * 60 - 1),
                            )
                          : bulkTimes.end,
                      });
                    }}
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bulkEnd"
                    className="block text-sm font-medium text-foreground"
                  >
                    End Time
                  </label>
                  <input
                    id="bulkEnd"
                    type="time"
                    step={1800}
                    value={bulkTimes.end}
                    onChange={(e) =>
                      setBulkTimes({ ...bulkTimes, end: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>

              {bulkType !== "single" && (
                <div>
                  <label
                    htmlFor="bulkRepeat"
                    className="block text-sm font-medium text-foreground"
                  >
                    Number of copies
                  </label>
                  <input
                    id="bulkRepeat"
                    type="number"
                    min={1}
                    max={15}
                    value={repeatCount}
                    onChange={(e) =>
                      setRepeatCount(parseInt(e.target.value) || 1)
                    }
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              )}

              {bulkResult && (
                <div
                  role="status"
                  className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
                >
                  <p className="mb-1 font-semibold">
                    {bulkResult.added > 0
                      ? `${bulkResult.added} added, ${bulkResult.skipped.length} skipped:`
                      : "Nothing was added:"}
                  </p>
                  <ul className="list-inside list-disc space-y-0.5">
                    {bulkResult.skipped.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  disabled={isApplyingBulk}
                  onClick={() => setIsBulkDialogOpen(false)}
                  className="flex-1 rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                >
                  {bulkResult ? "Close" : "Cancel"}
                </button>
                <button
                  type="button"
                  disabled={isApplyingBulk}
                  onClick={() => void handleApplyBulkSchedules()}
                  className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isApplyingBulk ? "Checking..." : "Add to Preview"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
