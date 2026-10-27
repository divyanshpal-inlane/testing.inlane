// Who may edit / delete a tentative (sales hold) slot. One pure function so the
// grid, the delete confirm and the edit save all apply the SAME rules.
//
// Rules
//  - Delete:  the creator, or a super admin.
//  - Edit:    the creator, a super admin, or ANYONE while the slot is unpaid
//             (that is how a hold is handed to a learner who is now paying).
//  - Creator is matched by account id when the booking recorded one
//    (`created_by_id`); otherwise (older bookings) by name, case-insensitive.
//    If the booking has an id and the viewer's id is known and they differ, the
//    viewer is NOT the creator even when the names are identical (two agents
//    can share a name).
//  - Fails CLOSED: a row with no recorded creator has no verifiable owner, so
//    only a super admin (or anyone, for an unpaid slot's edit) can touch it.
//  - Never decided while the viewer's own identity is still loading.

export interface TentativeActor {
  name: string;
  id?: string | null;
  isSuperAdmin?: boolean;
}

export interface TentativeSubject {
  /** Raw `tentative_details` JSON of the Schedule row. */
  details?: Record<string, unknown> | null;
  /** Falls back to details.payment_status when omitted. */
  paymentStatus?: string | null;
  /** Schedule.isTentative; a confirmed class is never editable from here. */
  isTentative?: boolean;
}

export interface TentativePermissions {
  canEdit: boolean;
  canDelete: boolean;
  isCreator: boolean;
  /** True when access comes only from the super-admin override. */
  viaSuperAdmin: boolean;
  isUnpaid: boolean;
  creatorName: string;
  /** Why delete (and possibly edit) is not available; null when allowed. */
  reason: string | null;
}

const norm = (v: unknown): string =>
  typeof v === "string" ? v.trim().toLowerCase() : "";

export function getTentativePermissions(
  subject: TentativeSubject,
  actor: TentativeActor,
): TentativePermissions {
  const details = subject.details ?? {};
  const creatorName =
    typeof details.sales_agent === "string" ? details.sales_agent.trim() : "";
  const creatorId =
    typeof details.created_by_id === "string" ? details.created_by_id : "";
  const paymentStatus =
    subject.paymentStatus ??
    (typeof details.payment_status === "string"
      ? details.payment_status
      : "unpaid");
  const isUnpaid = paymentStatus === "unpaid";
  const identityKnown = norm(actor.name) !== "" || !!actor.id;

  const base = {
    isUnpaid,
    creatorName,
  };

  // A class Operations has already confirmed is not a hold any more.
  if (subject.isTentative === false) {
    return {
      ...base,
      canEdit: false,
      canDelete: false,
      isCreator: false,
      viaSuperAdmin: false,
      reason: "This class is confirmed, so it can't be changed here.",
    };
  }

  if (!identityKnown) {
    return {
      ...base,
      canEdit: false,
      canDelete: false,
      isCreator: false,
      viaSuperAdmin: false,
      reason: "Checking your account…",
    };
  }

  let isCreator = false;
  if (creatorId && actor.id) {
    isCreator = creatorId === actor.id;
  } else if (creatorName) {
    isCreator = norm(creatorName) === norm(actor.name);
  }

  const viaSuperAdmin = !!actor.isSuperAdmin && !isCreator;
  const canDelete = isCreator || !!actor.isSuperAdmin;
  const canEdit = canDelete || isUnpaid;

  let reason: string | null = null;
  if (!canDelete) {
    reason = creatorName
      ? `Created by ${creatorName} — only they (or a super admin) can delete${canEdit ? "" : " or edit"} this.`
      : `No creator recorded for this slot — only a super admin can delete${canEdit ? "" : " or edit"} it.`;
  }

  return {
    ...base,
    canEdit,
    canDelete,
    isCreator,
    viaSuperAdmin,
    reason,
  };
}
