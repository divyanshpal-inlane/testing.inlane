// Pure slot-conflict classification for the Sales Dashboard's tentative
// booking flow. Extracted out of SalesDashboard.tsx (no behavior change)
// so it can be tested directly without a browser -- see
// tests/backend-suite.mjs sections C2/C3, which bundle this module with
// esbuild the same way tests D1-D3 do for availability.ts.

import type { BlockDetail } from "@/hooks/useSalesData";

import { normalizePhone } from "./validation";

// Distinguishes a genuine double-booking (any overlap) from a slot that's
// only unavailable because it falls within another booking's instructor
// travel-gap buffer -- the latter should be waivable when every
// buffer-only conflict belongs to the SAME customer (booking two
// back-to-back classes for one learner shouldn't need a gap between them,
// same as within a single multi-slot batch), but never for a genuine
// overlap or a buffer conflict with someone else's booking.
export type SlotConflict =
  | { kind: "free" }
  | { kind: "direct" }
  | { kind: "buffer"; phones: (string | null)[] };

export function classifySlotConflict(
  instrId: string,
  date: string,
  startMinute: number,
  gapMinutes: number,
  blocksIndex: Map<string, Map<string, BlockDetail[]>>,
): SlotConflict {
  const endMinute = startMinute + 60;
  const blocks = blocksIndex.get(instrId)?.get(date) ?? [];
  const bufferPhones: (string | null)[] = [];
  for (const b of blocks) {
    if (b.status === "cancelled" || b.status === "rejected") continue;
    const direct = b.startMinute < endMinute && startMinute < b.endMinute;
    if (direct) return { kind: "direct" };
    const buffered =
      b.startMinute - gapMinutes < endMinute &&
      startMinute < b.endMinute + gapMinutes;
    if (!buffered) continue;
    // Only a Sales-created tentative hold's phone can waive the buffer --
    // a real learner booking or payment-pending slot never should, even
    // if (coincidentally) it's the same phone, since that's a confirmed
    // class, not a hold Sales can freely stack around.
    const isSalesTentative = b.status === "hold" && b.isTentative;
    const phone =
      isSalesTentative && typeof b.rawTentativeDetails?.phone === "string"
        ? normalizePhone(b.rawTentativeDetails.phone)
        : null;
    bufferPhones.push(phone);
  }
  if (bufferPhones.length === 0) return { kind: "free" };
  return { kind: "buffer", phones: bufferPhones };
}

// A buffer-only conflict is waivable when every conflicting block's phone
// matches the customer currently being booked (and none are null, i.e.
// none are a real/non-Sales booking that never waives).
export function bufferWaivedForCustomer(
  conflict: SlotConflict,
  customerPhone: string,
): boolean {
  if (conflict.kind !== "buffer") return conflict.kind === "free";
  const normalized = normalizePhone(customerPhone);
  if (!normalized) return false;
  return conflict.phones.every((p) => p === normalized);
}
