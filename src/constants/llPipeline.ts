// The LL -> DL journey state machine, transcribed from the Ops flow board.
// Each stage belongs to a phase (rendered as queue tabs on the admin page).
// `next` lists the stage(s) a "happy path" advance can go to — more than one
// entry means Ops picks the branch (e.g. post-LL: classes vs direct DL).
// `failure` describes the red-box outcome for a stage and where recovery
// re-enters the flow.

import { addDays, addMonths, format, subDays } from "date-fns";

export type LLPhaseKey =
  | "documents"
  | "application_call"
  | "rto_submission"
  | "ll_test"
  | "post_ll"
  | "dl_test";

export const LL_PHASES: { key: LLPhaseKey; label: string }[] = [
  { key: "documents", label: "Docs & Payment" },
  { key: "application_call", label: "Application Call" },
  { key: "rto_submission", label: "RTO Submission" },
  { key: "ll_test", label: "LL Test" },
  { key: "post_ll", label: "Post-LL" },
  { key: "dl_test", label: "DL Test & Delivery" },
];

/**
 * Segregation routes (stored in ll_applications.batch_code).
 * RTO lane = Aadhaar auth × existing 2W LL. Drives which stages Ops may advance to.
 */
export type LLSegregationRouteCode = "A" | "B" | "C" | "D";

export interface LLSegregationRoute {
  code: LLSegregationRouteCode;
  name: string;
  namingSchema: string;
  who: string;
  aadhaarAuth: boolean;
  documentUpload: string;
  physicalVerification: boolean;
  /** "yes" | "none" | "normally_none" */
  scrutiny: "yes" | "none" | "normally_none";
  llTest: boolean;
  approval: boolean;
}

export const LL_SEGREGATION_ROUTES: LLSegregationRoute[] = [
  {
    code: "A",
    name: "Out of state",
    namingSchema: "No aadhaar auth — No 2WL DL",
    who: "No KA licence; Aadhaar from another state; rental agreement / affidavit",
    aadhaarAuth: false,
    documentUpload: "Yes",
    physicalVerification: true,
    scrutiny: "yes",
    llTest: true,
    approval: true,
  },
  {
    code: "B",
    name: "Aadhaar fast track",
    namingSchema: "Yes aadhaar auth — No 2WL DL",
    who: "No KA licence; KA-Bengaluru Aadhaar; recent photo",
    aadhaarAuth: true,
    documentUpload: "None",
    physicalVerification: false,
    scrutiny: "normally_none",
    llTest: true,
    approval: true,
  },
  {
    code: "C",
    name: "Add-on, name matched",
    namingSchema: "Yes aadhaar auth — Yes 2WL DL",
    who: "Holds KA 2W LL; adding 4W; DL name = Aadhaar name",
    aadhaarAuth: true,
    documentUpload: "None",
    physicalVerification: false,
    scrutiny: "none",
    llTest: false,
    approval: true,
  },
  {
    code: "D",
    name: "Add-on, name mismatch",
    namingSchema: "No aadhaar auth — Yes 2WL DL",
    who: "Holds KA 2W LL; adding 4W; DL name ≠ Aadhaar name",
    aadhaarAuth: false,
    documentUpload: "DL uploaded manually on portal",
    physicalVerification: false,
    scrutiny: "yes",
    llTest: false,
    approval: true,
  },
];

export const LL_SEGREGATION_ROUTE_MAP: Record<
  LLSegregationRouteCode,
  LLSegregationRoute
> = Object.fromEntries(LL_SEGREGATION_ROUTES.map((r) => [r.code, r])) as Record<
  LLSegregationRouteCode,
  LLSegregationRoute
>;

/** @deprecated Use LL_SEGREGATION_ROUTES — kept as code list for callers that expect strings. */
export const LL_BATCHES = LL_SEGREGATION_ROUTES.map((r) => r.code);

export function isLLSegregationRouteCode(
  value: string | null | undefined,
): value is LLSegregationRouteCode {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

/** Badge / select label: "A — Out of state". Falls back to raw value for legacy LN* codes. */
export function llSegregationRouteLabel(
  code: string | null | undefined,
): string {
  if (!code) return "—";
  if (isLLSegregationRouteCode(code)) {
    const r = LL_SEGREGATION_ROUTE_MAP[code];
    return `${r.code} — ${r.name}`;
  }
  return code;
}

function scrutinyLabel(scrutiny: LLSegregationRoute["scrutiny"]): string {
  if (scrutiny === "yes") return "Yes";
  if (scrutiny === "normally_none") return "Normally none";
  return "None";
}

/** Compact ops checklist lines for the selected route. */
export function llSegregationRouteChecklist(
  code: string | null | undefined,
): string[] {
  if (!isLLSegregationRouteCode(code)) return [];
  const r = LL_SEGREGATION_ROUTE_MAP[code];
  return [
    `Aadhaar auth: ${r.aadhaarAuth ? "Yes" : "No"}`,
    `Document upload: ${r.documentUpload}`,
    `Physical verification: ${r.physicalVerification ? "Yes" : "No"}`,
    `Scrutiny: ${scrutinyLabel(r.scrutiny)}`,
    `LL test: ${r.llTest ? "Yes" : "No"}`,
    `Approval: ${r.approval ? "Yes" : "No"}`,
  ];
}

export interface LLFailure {
  key: string;
  label: string;
  recoverTo: string;
}

export interface LLStage {
  key: string;
  label: string;
  phase: LLPhaseKey;
  next: string[];
  /** Red-box outcomes reachable from this stage, with their recovery targets. */
  failures?: LLFailure[];
  /** Ops fields that become relevant at this stage (shown highlighted). */
  fields?: string[];
}

export const LL_STAGES: LLStage[] = [
  // ── Phase 1: Payment & documents ─────────────────────────────────────
  {
    key: "payment_received",
    label: "Payment Received",
    phase: "documents",
    next: ["docs_link_sent"],
  },
  {
    key: "docs_link_sent",
    label: "Document Upload Link Sent",
    phase: "documents",
    next: ["docs_submitted"],
    // Board rule: not filled after 2 days -> escalate to Ops.
  },
  {
    key: "docs_submitted",
    label: "Documents Submitted",
    phase: "documents",
    next: ["docs_under_review"],
  },
  {
    key: "docs_under_review",
    label: "Documents Under Review",
    phase: "documents",
    next: ["meet_booking_enabled"],
    failures: [
      {
        key: "docs_rejected",
        label: "Docs Rejected / Incomplete",
        recoverTo: "docs_submitted",
      },
    ],
  },

  // ── Phase 2: Google Meet application call ────────────────────────────
  {
    key: "meet_booking_enabled",
    label: "Meet Booking Enabled",
    phase: "application_call",
    next: ["appointment_booked"],
    // Board rule: reminders at 24h/48h, then Ops follow-up queue.
  },
  {
    key: "appointment_booked",
    label: "Appointment Booked",
    phase: "application_call",
    next: ["rto_application_generated"],
    failures: [
      {
        key: "call_missed",
        label: "Missed by Customer",
        recoverTo: "appointment_booked",
        // Board rule: 2 misses -> Ops calls the customer to finish over phone.
      },
      {
        key: "call_missed_by_lane",
        label: "Missed by Lane / Technical Issue",
        recoverTo: "appointment_booked",
        // Customer gets an apology + free reschedule.
      },
    ],
  },
  {
    key: "rto_application_generated",
    label: "RTO Application Generated",
    phase: "application_call",
    next: ["govt_payment_pending"],
    fields: ["services"],
  },

  // ── Phase 3: Govt payment & RTO submission ───────────────────────────
  {
    key: "govt_payment_pending",
    label: "Govt Payment Pending",
    phase: "rto_submission",
    next: ["application_ready"],
    failures: [
      {
        key: "govt_payment_failed",
        label: "Payment Failed",
        recoverTo: "govt_payment_pending",
      },
    ],
  },
  {
    key: "application_ready",
    label: "Ready for RTO (No., Date & Route)",
    phase: "rto_submission",
    // Default graph edge (Route A/D). Actual advances are route-aware via
    // getLLAdvanceTargets — B skips to LL test, C skips to approval.
    next: ["in_scrutiny_queue"],
    fields: ["application_number", "application_date", "batch_code"],
  },
  {
    key: "in_scrutiny_queue",
    label: "In RTO Scrutiny Queue",
    phase: "rto_submission",
    next: ["assigned_to_runner"],
  },
  {
    key: "assigned_to_runner",
    label: "Assigned to RTO Runner",
    phase: "rto_submission",
    next: ["submitted_at_rto"],
  },
  {
    key: "submitted_at_rto",
    label: "Submitted at RTO",
    phase: "rto_submission",
    next: ["waiting_rto_verification"],
  },
  {
    key: "waiting_rto_verification",
    label: "Waiting for RTO Verification",
    phase: "rto_submission",
    next: ["ll_test_enabled"],
    // Route D (add-on, no LL test) advances to ll_approval_pending instead —
    // see getLLAdvanceTargets.
    failures: [
      {
        key: "scrutiny_rejected",
        label: "Scrutiny Not Approved",
        recoverTo: "submitted_at_rto",
      },
    ],
  },

  // ── Phase 4: LL test & approval ──────────────────────────────────────
  {
    key: "ll_test_enabled",
    label: "LL Test Enabled",
    phase: "ll_test",
    next: ["ll_test_passed"],
    fields: ["scrutiny_approved_date", "scrutiny_expiry_date"],
    failures: [
      {
        key: "ll_test_failed",
        label: "LL Test Failed",
        recoverTo: "ll_test_enabled",
        // Board rule: Ops pays retest fee + calls customer; retry after 24h.
      },
      {
        key: "scrutiny_expired",
        label: "Scrutiny Expired (7 days)",
        recoverTo: "meet_booking_enabled",
        // Set automatically by ll_expire_scrutiny(); customer pays a fresh
        // govt fee (reapply_fee) and the application call restarts.
      },
    ],
  },
  {
    key: "ll_test_passed",
    label: "LL Test Passed",
    phase: "ll_test",
    next: ["ll_approval_pending"],
  },
  {
    key: "ll_approval_pending",
    label: "LL Approval Pending",
    phase: "ll_test",
    next: ["ll_issued"],
    failures: [
      {
        key: "ll_approval_rejected",
        label: "LL Approval Rejected",
        recoverTo: "meet_booking_enabled",
        // RTO returned the application — Ops corrects and resubmits via a
        // fresh application call.
      },
    ],
  },
  {
    key: "ll_issued",
    label: "LL Issued (LL No. entered)",
    phase: "ll_test",
    next: ["ob_form_enabled", "ll_maturing"],
    fields: ["ll_number", "ll_issue_date", "ll_expiry_date"],
  },

  // ── Phase 5: Post-LL branch ──────────────────────────────────────────
  {
    key: "ob_form_enabled",
    label: "OB Form Enabled (with Classes)",
    phase: "post_ll",
    next: ["classes_in_progress"],
  },
  {
    key: "classes_in_progress",
    label: "Classes In Progress",
    phase: "post_ll",
    next: ["dl_date_selection"],
  },
  {
    key: "ll_maturing",
    label: "LL Maturing (1-month timer)",
    phase: "post_ll",
    next: ["ll_matured"],
    fields: ["ll_matures_at"],
  },
  {
    key: "ll_matured",
    label: "LL Matured",
    phase: "post_ll",
    next: ["dl_date_selection"],
  },
  {
    key: "dl_date_selection",
    label: "DL Date Options Enabled",
    phase: "post_ll",
    next: ["dl_date_preference_received"],
  },
  {
    key: "ll_expired",
    label: "LL Expired",
    phase: "post_ll",
    next: [],
  },

  // ── Phase 6: DL test & delivery ──────────────────────────────────────
  {
    key: "dl_date_preference_received",
    label: "DL Date Preference Received",
    phase: "dl_test",
    next: ["dl_test_scheduled", "dl_otp_required"],
    fields: ["dl_preferred_date", "dl_preferred_rto"],
    // Customer picked a date+RTO on the homepage; ops confirms the slot with
    // the RTO (via dl_otp_required when a Parivahan OTP call is needed).
  },
  {
    key: "dl_otp_required",
    label: "Slot Booking — OTP Required",
    phase: "dl_test",
    next: ["dl_test_scheduled"],
  },
  {
    key: "dl_test_scheduled",
    label: "DL Test Confirmed",
    phase: "dl_test",
    next: ["dl_results_pending"],
    fields: [
      "dl_application_number",
      "dl_application_date",
      "dl_test_date",
      "dl_test_time",
      "dl_test_rto",
      "dl_test_rto_address",
    ],
    failures: [
      {
        key: "dl_test_missed",
        label: "DL Test Not Attended",
        recoverTo: "dl_test_scheduled",
      },
    ],
  },
  {
    key: "dl_results_pending",
    label: "DL Test Done — Results Pending",
    phase: "dl_test",
    next: ["dl_test_passed"],
    failures: [
      {
        key: "dl_test_failed",
        label: "DL Test Failed",
        recoverTo: "dl_test_scheduled",
      },
    ],
  },
  {
    key: "dl_test_passed",
    label: "DL Test Passed",
    phase: "dl_test",
    next: ["dl_number_generated"],
  },
  {
    key: "dl_number_generated",
    label: "DL Number Generated",
    phase: "dl_test",
    next: ["dl_delivery_pending"],
    fields: ["dl_number", "dl_expiry_date"],
  },
  {
    key: "dl_delivery_pending",
    label: "DL Card Dispatched / Delivery Pending",
    phase: "dl_test",
    next: ["dl_delivered"],
    fields: ["dl_dispatch_eta", "dl_tracking_ref"],
    failures: [
      {
        key: "dl_not_delivered",
        label: "DL Not Delivered (auto-ticket)",
        recoverTo: "dl_delivery_pending",
      },
    ],
  },
  {
    key: "dl_delivered",
    label: "DL Delivered — Journey Complete",
    phase: "dl_test",
    next: [],
  },
];

/** Failure statuses are storable statuses too — index them for lookups. */
export const LL_FAILURE_STAGES: Record<
  string,
  { label: string; recoverTo: string; phase: LLPhaseKey }
> = Object.fromEntries(
  LL_STAGES.flatMap((s) =>
    (s.failures ?? []).map((f) => [
      f.key,
      { label: f.label, recoverTo: f.recoverTo, phase: s.phase },
    ]),
  ),
);

export const LL_STAGE_MAP: Record<string, LLStage> = Object.fromEntries(
  LL_STAGES.map((s) => [s.key, s]),
);

/** Expiry states are terminal until Ops deliberately reverts the journey. */
export const LL_EXPIRY_STATUSES = ["scrutiny_expired", "ll_expired"] as const;

export function isLLExpiryStatus(status: string): boolean {
  return (LL_EXPIRY_STATUSES as readonly string[]).includes(status);
}

/** Statuses shown in the Escalations queue even without a manual flag. */
export const LL_ESCALATION_STATUSES = [
  ...Object.keys(LL_FAILURE_STAGES),
  "ll_expired",
];

export function llStageLabel(status: string): string {
  return (
    LL_STAGE_MAP[status]?.label ?? LL_FAILURE_STAGES[status]?.label ?? status
  );
}

export function llStagePhase(status: string): LLPhaseKey {
  return (
    LL_STAGE_MAP[status]?.phase ??
    LL_FAILURE_STAGES[status]?.phase ??
    "documents"
  );
}

export function isLLFailureStatus(status: string): boolean {
  return status in LL_FAILURE_STAGES || status === "ll_expired";
}

const LL_STAGE_ORDER: Record<string, number> = Object.fromEntries([
  ...LL_STAGES.map((s, i) => [s.key, i] as const),
  ...Object.keys(LL_FAILURE_STAGES).map(
    (k, i) => [k, LL_STAGES.length + i] as const,
  ),
]);

/**
 * Happy-path next stages for this status, branched by segregation route.
 *
 * A — full scrutiny → runner → verification → LL test → approval
 * B — normally skip scrutiny → LL test (optional scrutiny path kept)
 * C — skip scrutiny + LL test → approval
 * D — scrutiny path, then skip LL test → approval
 *
 * Legacy / missing route: keep default stage.next (scrutiny path) so old
 * rows still move, but advancing past application_ready requires A–D.
 */
export function getLLAdvanceTargets(
  status: string,
  batchCode: string | null | undefined,
): string[] {
  const stage = LL_STAGE_MAP[status];
  if (!stage) return [];

  const route = isLLSegregationRouteCode(batchCode) ? batchCode : null;
  const def = route ? LL_SEGREGATION_ROUTE_MAP[route] : null;

  if (status === "application_ready") {
    if (!route) return [];
    switch (route) {
      case "A":
        return ["in_scrutiny_queue"];
      case "B":
        // Fast track first; ops can still send through scrutiny if needed.
        return ["ll_test_enabled", "in_scrutiny_queue"];
      case "C":
        return ["ll_approval_pending"];
      case "D":
        return ["in_scrutiny_queue"];
    }
  }

  if (status === "waiting_rto_verification") {
    if (def && !def.llTest) return ["ll_approval_pending"];
    return ["ll_test_enabled"];
  }

  // Escape hatch if a no-LL-test route was wrongly parked on LL-test stages.
  if (
    (status === "ll_test_enabled" || status === "ll_test_passed") &&
    def &&
    !def.llTest
  ) {
    return ["ll_approval_pending"];
  }

  let next = [...stage.next];
  if (def && !def.llTest) {
    next = next.filter(
      (n) => n !== "ll_test_enabled" && n !== "ll_test_passed",
    );
  }
  return next;
}

/** Failure buttons reachable from this stage for the given route. */
export function getLLFailureOptions(
  status: string,
  batchCode: string | null | undefined,
): LLFailure[] {
  const stage = LL_STAGE_MAP[status];
  if (!stage?.failures?.length) return [];

  const route = isLLSegregationRouteCode(batchCode) ? batchCode : null;
  const def = route ? LL_SEGREGATION_ROUTE_MAP[route] : null;

  return stage.failures.filter((f) => {
    if (
      (f.key === "ll_test_failed" || f.key === "scrutiny_expired") &&
      def &&
      !def.llTest
    ) {
      return false;
    }
    if (f.key === "scrutiny_rejected" && def && def.scrutiny === "none") {
      return false;
    }
    return true;
  });
}

function buildLLReverseEdges(
  batchCode: string | null | undefined,
): Record<string, string[]> {
  const map: Record<string, Set<string>> = {};
  const link = (from: string, to: string) => {
    if (!map[to]) map[to] = new Set();
    map[to].add(from);
  };
  for (const s of LL_STAGES) {
    for (const n of getLLAdvanceTargets(s.key, batchCode)) link(s.key, n);
    for (const f of getLLFailureOptions(s.key, batchCode)) link(s.key, f.key);
  }
  // Union default graph edges so legacy rows (no route) remain reversible.
  if (!isLLSegregationRouteCode(batchCode)) {
    for (const s of LL_STAGES) {
      for (const n of s.next) link(s.key, n);
      for (const f of s.failures ?? []) link(s.key, f.key);
    }
  }
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]));
}

/**
 * Stages the RTO agent may move this application back to (to correct a
 * mistaken promotion). Walks the route-aware state-machine backwards.
 */
export function getLLRevertTargets(
  currentStatus: string,
  batchCode?: string | null,
): string[] {
  // Expiry has no forward edge. Ops must explicitly pick the stage where the
  // renewed/reapplied journey should restart.
  if (currentStatus === "ll_expired") {
    return LL_STAGES.filter(
      (stage) => stage.key !== "ll_expired" && stage.key !== "dl_delivered",
    ).map((stage) => stage.key);
  }

  const reverse = buildLLReverseEdges(batchCode ?? null);
  const seen = new Set<string>();
  const queue = [...(reverse[currentStatus] ?? [])];
  const targets: string[] = [];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (!isLLFailureStatus(cur)) targets.push(cur);
    for (const prev of reverse[cur] ?? []) queue.push(prev);
  }

  const failure = LL_FAILURE_STAGES[currentStatus];
  if (failure && !targets.includes(failure.recoverTo)) {
    targets.push(failure.recoverTo);
  }

  return targets.sort(
    (a, b) => (LL_STAGE_ORDER[a] ?? 999) - (LL_STAGE_ORDER[b] ?? 999),
  );
}

/** True when the current stage has at least one valid earlier stage. */
export function canRevertLLStatus(
  status: string,
  batchCode?: string | null,
): boolean {
  return getLLRevertTargets(status, batchCode).length > 0;
}

export type LLTransitionKind = "advance" | "failure" | "recover" | "revert";

/**
 * Throws if the status move is illegal for this segregation route.
 * Used by admin mutations (and mirrored in Postgres).
 */
export function assertLLStatusTransition(opts: {
  fromStatus: string;
  toStatus: string;
  batchCode: string | null | undefined;
  kind: LLTransitionKind;
}): void {
  const { fromStatus, toStatus, batchCode, kind } = opts;

  if (fromStatus === toStatus) {
    throw new Error("Status is already set to that stage.");
  }

  if (kind === "revert") {
    const allowed = getLLRevertTargets(fromStatus, batchCode);
    if (!allowed.includes(toStatus)) {
      throw new Error(
        `Cannot revert from ${fromStatus} to ${toStatus} for route ${batchCode ?? "unset"}.`,
      );
    }
    return;
  }

  if (kind === "recover") {
    const failure = LL_FAILURE_STAGES[fromStatus];
    if (!failure || failure.recoverTo !== toStatus) {
      throw new Error(`Cannot recover from ${fromStatus} to ${toStatus}.`);
    }
    return;
  }

  if (kind === "failure") {
    const allowed = getLLFailureOptions(fromStatus, batchCode).map(
      (f) => f.key,
    );
    if (!allowed.includes(toStatus)) {
      throw new Error(
        `Failure ${toStatus} is not available from ${fromStatus} for route ${batchCode ?? "unset"}.`,
      );
    }
    return;
  }

  // advance
  if (
    fromStatus === "application_ready" &&
    !isLLSegregationRouteCode(batchCode)
  ) {
    throw new Error(
      "Set segregation route (A / B / C / D) before advancing from Ready for RTO.",
    );
  }
  const allowed = getLLAdvanceTargets(fromStatus, batchCode);
  if (!allowed.includes(toStatus)) {
    throw new Error(
      `Cannot advance from ${fromStatus} to ${toStatus} for route ${
        batchCode ?? "unset"
      }. Allowed: ${allowed.join(", ") || "none"}.`,
    );
  }
}

/**
 * Infer transition kind for a proposed status change (non-revert).
 */
export function classifyLLStatusTransition(
  fromStatus: string,
  toStatus: string,
  batchCode: string | null | undefined,
): LLTransitionKind | null {
  if (getLLAdvanceTargets(fromStatus, batchCode).includes(toStatus)) {
    return "advance";
  }
  if (
    getLLFailureOptions(fromStatus, batchCode).some((f) => f.key === toStatus)
  ) {
    return "failure";
  }
  const failure = LL_FAILURE_STAGES[fromStatus];
  if (failure?.recoverTo === toStatus) return "recover";
  return null;
}

/**
 * Fields that become relevant only at/after certain stages. When Ops reverts
 * past those stages, clear the values so the customer homepage doesn't show
 * stale RTO/DL data for a stage the application is no longer in.
 */
const STAGE_FIELD_CLEAR_AFTER: {
  /** Cleared when target stage order is strictly before this stage. */
  afterStage: string;
  fields: LLRevertClearField[];
}[] = [
  {
    afterStage: "application_ready",
    fields: ["application_number", "application_date", "batch_code"],
  },
  {
    afterStage: "ll_test_enabled",
    fields: ["scrutiny_approved_date"],
  },
  {
    afterStage: "ll_issued",
    fields: [
      "ll_number",
      "ll_issue_date",
      "ll_expiry_date",
      "ll_type",
      "ll_matures_at",
    ],
  },
  {
    afterStage: "dl_date_preference_received",
    fields: ["dl_preferred_date", "dl_preferred_rto"],
  },
  {
    afterStage: "dl_test_scheduled",
    fields: [
      "dl_application_number",
      "dl_application_date",
      "dl_test_date",
      "dl_test_time",
      "dl_test_rto",
      "dl_test_rto_address",
    ],
  },
  {
    afterStage: "dl_number_generated",
    fields: ["dl_number", "dl_expiry_date"],
  },
  {
    afterStage: "dl_delivery_pending",
    fields: ["dl_dispatch_eta", "dl_tracking_ref"],
  },
];

export type LLRevertClearField =
  | "application_number"
  | "application_date"
  | "batch_code"
  | "scrutiny_approved_date"
  | "ll_number"
  | "ll_issue_date"
  | "ll_expiry_date"
  | "ll_type"
  | "ll_matures_at"
  | "dl_preferred_date"
  | "dl_preferred_rto"
  | "dl_application_number"
  | "dl_application_date"
  | "dl_test_date"
  | "dl_test_time"
  | "dl_test_rto"
  | "dl_test_rto_address"
  | "dl_number"
  | "dl_expiry_date"
  | "dl_dispatch_eta"
  | "dl_tracking_ref";

/**
 * Returns fields to null out when moving back to `toStatus`.
 * Does not clear documents, form_data, or services — those stay for re-use.
 */
export function fieldsToClearOnLLRevert(
  toStatus: string,
): Partial<Record<LLRevertClearField, null>> {
  const targetOrder = LL_STAGE_ORDER[toStatus] ?? -1;
  const clear: Partial<Record<LLRevertClearField, null>> = {};
  for (const rule of STAGE_FIELD_CLEAR_AFTER) {
    const gate = LL_STAGE_ORDER[rule.afterStage] ?? 999;
    if (targetOrder < gate) {
      for (const f of rule.fields) clear[f] = null;
    }
  }
  return clear;
}

/** Services Ops can tick on the RTO application (from the board's checkbox list). */
export const LL_SERVICES: { key: string; label: string }[] = [
  { key: "ll", label: "LL" },
  { key: "classes", label: "Classes" },
  { key: "dl", label: "DL" },
  { key: "dl_renewal", label: "DL Renewal" },
  { key: "address_change_ka", label: "Address change KA to KA" },
  { key: "name_correction", label: "Name Correction" },
  { key: "backlog", label: "Backlog" },
  { key: "duplicate_dl", label: "Duplicate DL" },
  { key: "idp", label: "IDP" },
  {
    key: "dl_address_change_other_state",
    label: "DL address change (other state → KA)",
  },
];

// ── Customer-facing journey (homepage states) ────────────────────────────

/** Where the customer takes the online LL test after scrutiny passes. */
export const PARIVAHAN_LL_TEST_URL =
  "https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do";

/** Walkthrough video shown on the "Take Your LL Test" screen. */
export const LL_TEST_VIDEO_URL =
  "https://drive.google.com/file/d/1xEe3DeV0utJhl5k4fxW_zYtSXImQkLBs/view?usp=sharing";

/** Learning module PDF linked from the "Take Your LL Test" screen. */
export const LL_LEARNING_MODULE_URL =
  "https://drive.google.com/file/d/141-ogGVc2KDfN_FpYRM3oMq05K7GQtV1/view?usp=sharing";

/**
 * Parse a YYYY-MM-DD string as a local calendar date (avoids UTC day-shift).
 */
export function parseLLDateYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * LL Valid Till = LL Issue Date + 6 months − 1 day.
 * Example: 2026-08-21 → 2027-02-20.
 */
export function calcLLExpiryDate(issueDateYmd: string): string {
  return format(
    subDays(addMonths(parseLLDateYmd(issueDateYmd), 6), 1),
    "yyyy-MM-dd",
  );
}

/**
 * LL Maturity Date = LL Issue Date + 1 month.
 * Example: 2026-08-20 → 2026-09-20.
 */
export function calcLLMaturityDate(issueDateYmd: string): string {
  return format(addMonths(parseLLDateYmd(issueDateYmd), 1), "yyyy-MM-dd");
}

/**
 * True when the learner is inside the V1 promotion window for DL test:
 * on/after LL maturity and on/before LL expiry.
 */
export function isWithinLLMaturityWindow(opts: {
  today?: string;
  llMaturesAt?: string | null;
  llExpiryDate?: string | null;
}): boolean {
  const today = opts.today ?? todayYmd();
  if (!opts.llMaturesAt || !opts.llExpiryDate) return false;
  return today >= opts.llMaturesAt && today <= opts.llExpiryDate;
}

/**
 * Promote when completed lessons reach (total classes − 1).
 */
export function hasCompletedClassesMinusOne(
  completed: number,
  total: number,
): boolean {
  if (total <= 0) return false;
  return completed >= total - 1;
}

/**
 * Customer may only select a preferred DL test date this many days from
 * today (V1 item 12). Also used as the visibility floor for uploaded slots
 * (stricter than the 12-day floor in item 6).
 */
export const DL_PREFERRED_DATE_MIN_DAYS = 14;

/**
 * Ops must upload a DL test slot at least this many days before the test
 * date (V1 item 6).
 */
export const DL_SLOT_UPLOAD_LEAD_DAYS = 15;

/** Today's date as YYYY-MM-DD in local time. */
export function todayYmd(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/**
 * Earliest YYYY-MM-DD a customer may pick (today + DL_PREFERRED_DATE_MIN_DAYS).
 */
export function dlPreferredDateMinYmd(fromYmd: string = todayYmd()): string {
  return format(
    addDays(parseLLDateYmd(fromYmd), DL_PREFERRED_DATE_MIN_DAYS),
    "yyyy-MM-dd",
  );
}

/**
 * Whether ops may upload a slot for this test date (must be ≥ today + 15 days).
 */
export function isDLSlotUploadAllowed(
  testDateYmd: string,
  fromYmd: string = todayYmd(),
): boolean {
  const minDate = format(
    addDays(parseLLDateYmd(fromYmd), DL_SLOT_UPLOAD_LEAD_DAYS),
    "yyyy-MM-dd",
  );
  return testDateYmd >= minDate;
}

/**
 * Whether a published slot should appear for this customer.
 * Rules: ≥14 days from today, on/after LL maturity, on/before LL expiry.
 */
export function isDLSlotVisibleToCustomer(
  testDateYmd: string,
  opts: {
    today?: string;
    llMaturesAt?: string | null;
    llExpiryDate?: string | null;
  } = {},
): boolean {
  const today = opts.today ?? todayYmd();
  if (testDateYmd < dlPreferredDateMinYmd(today)) return false;
  if (opts.llMaturesAt && testDateYmd < opts.llMaturesAt) return false;
  if (opts.llExpiryDate && testDateYmd > opts.llExpiryDate) return false;
  return true;
}

/**
 * Fresh government fee quoted when RTO scrutiny expires (LL test not taken
 * within 7 days). Ops can override per application via
 * ll_applications.reapply_fee.
 */
export const LL_REAPPLY_FEE_DEFAULT = 450;

/** DL retest fee quoted when the DL test is failed (ops-overridable). */
export const DL_RETEST_FEE_DEFAULT = 300;

/** RTOs the customer can pick for the DL test (Bengaluru). */
export const DL_RTO_OPTIONS = [
  "KR Puram RTO - KA53",
  "Kasturi Nagar RTO - KA03",
  "Electronic City ADTT Track - KA51 / KA01",
  "Jnanabharathi KA41",
];

/**
 * What to carry on DL test day (V1) — two sections shown on the confirmed
 * test card. Second-section bullets drafted where ops copy was incomplete;
 * easy to tweak in one place.
 */
export const DL_TEST_CHECKLIST_SECTIONS: {
  title: string;
  items: string[];
}[] = [
  {
    title: "If you don't have a previously issued DL",
    items: [
      "Carry your printed Learner's Licence",
      "Carry a Karnataka-registered 2-wheeler for the test (if applying for it)",
      "Carry your Aadhaar card (original)",
    ],
  },
  {
    title: "If you have a 2-wheeler (2 WL) DL",
    items: [
      "Carry your printed Learner's Licence",
      "Carry your existing 2-wheeler Driving Licence (original)",
      "Carry your Aadhaar card (original)",
    ],
  },
];

/** Flat list for calendar/reminder snippets. */
export const DL_TEST_CHECKLIST: string[] = DL_TEST_CHECKLIST_SECTIONS.flatMap(
  (s) => s.items,
);

/**
 * DL-phase statuses that get their own customer homepage screens. These are
 * also surfaced on the normal (classes) homepage via PostLLHomeCard, because
 * classes-track learners have left the LL flow by then.
 */
export const DL_PHASE_CUSTOMER_STATUSES = [
  "ll_expired",
  "ll_matured",
  "dl_date_selection",
  "dl_date_preference_received",
  "dl_otp_required",
  "dl_test_scheduled",
  "dl_test_missed",
  "dl_results_pending",
  "dl_test_failed",
  "dl_test_passed",
  "dl_number_generated",
  "dl_delivery_pending",
  "dl_not_delivered",
  "dl_delivered",
];

/** Statuses where the homepage shows "sent for scrutiny at the RTO". */
export const LL_IN_RTO_PROCESS_STATUSES = [
  "rto_application_generated",
  "govt_payment_pending",
  "govt_payment_failed",
  "application_ready",
  "in_scrutiny_queue",
  "assigned_to_runner",
  "submitted_at_rto",
  "waiting_rto_verification",
];

/** Statuses at/after LL approval where the homepage shows the LL card. */
export const LL_APPROVED_STATUSES = [
  "ll_issued",
  "ob_form_enabled",
  "classes_in_progress",
  "ll_maturing",
  "ll_matured",
  "dl_date_selection",
  "dl_test_scheduled",
  "dl_test_missed",
  "dl_results_pending",
  "dl_test_failed",
  "dl_test_passed",
  "dl_number_generated",
  "dl_delivery_pending",
  "dl_not_delivered",
];

// ── In-app LL application form (replaces the Google Form) ────────────────
// Documents the customer must upload, from the "DL Docs? Sorted in Seconds!"
// checklist shown in the app (public/assets/documents_list.jpg).

export interface LLDocSlotDef {
  key: string;
  label: string;
}

export interface LLDocTypeDef {
  key: string;
  label: string;
  required: boolean;
  /** Accepted proof kinds the customer picks from (empty = no picker). */
  subtypes: { key: string; label: string }[];
  hint?: string;
  /**
   * Always-required upload slots (e.g. ID front + back). When omitted,
   * defaults to a single "primary" slot unless the chosen subtype is in
   * dualUploadSubtypes.
   */
  slots?: LLDocSlotDef[];
  /**
   * Subtypes that need two separate files. Keys are subtype keys; values
   * are labels for the primary + secondary upload slots.
   */
  dualUploadSubtypes?: Record<string, { primary: string; secondary: string }>;
}

/** Default single-file slot used by most document types. */
export const LL_DOC_SLOT_PRIMARY: LLDocSlotDef = {
  key: "primary",
  label: "Document",
};

/**
 * Resolve which upload slots a document type needs for the chosen subtype.
 * ID proof always needs front+back; rental/affidavit address proofs need two
 * files; everything else is a single upload.
 */
export function llDocSlotsFor(
  def: LLDocTypeDef,
  subtype: string | undefined | null,
): LLDocSlotDef[] {
  if (def.slots?.length) return def.slots;
  if (subtype && def.dualUploadSubtypes?.[subtype]) {
    const dual = def.dualUploadSubtypes[subtype];
    return [
      { key: "primary", label: dual.primary },
      { key: "secondary", label: dual.secondary },
    ];
  }
  return [LL_DOC_SLOT_PRIMARY];
}

/** Composite key used in the form file map and docs-by-slot lookups. */
export function llDocFileKey(docType: string, slot: string): string {
  return `${docType}:${slot}`;
}

export function llDocSlotLabel(
  def: LLDocTypeDef | undefined,
  slot: string,
  subtype?: string | null,
): string | null {
  if (!def) return null;
  const fromSlots = def.slots?.find((s) => s.key === slot);
  if (fromSlots) return fromSlots.label;
  if (subtype && def.dualUploadSubtypes?.[subtype]) {
    const dual = def.dualUploadSubtypes[subtype];
    if (slot === "primary") return dual.primary;
    if (slot === "secondary") return dual.secondary;
  }
  if (slot === "primary") return null;
  return slot;
}

export const LL_DOC_TYPES: LLDocTypeDef[] = [
  {
    key: "photo",
    label: "Passport-size Photo",
    required: true,
    subtypes: [],
    hint: "Clear, recent photo with a plain background",
  },
  {
    key: "signature",
    label: "Signature",
    required: true,
    subtypes: [],
    hint: "Sign on plain white paper and photograph/scan it",
  },
  {
    key: "age_proof",
    label: "Age Proof",
    required: true,
    subtypes: [
      { key: "voter_id", label: "Voter ID" },
      { key: "passport", label: "Passport" },
      { key: "birth_certificate", label: "Birth Certificate" },
      { key: "tenth_marksheet", label: "10th Marksheet" },
      { key: "lic_policy", label: "LIC Insurance Policy" },
    ],
  },
  {
    key: "address_proof",
    label: "Address Proof (current address)",
    required: true,
    subtypes: [
      { key: "aadhaar", label: "Aadhaar" },
      { key: "passport", label: "Passport" },
      { key: "voter_id", label: "Voter ID" },
      { key: "bank_passbook", label: "Bank Passbook" },
      { key: "ration_card", label: "Ration Card" },
      {
        key: "rental_agreement",
        label: "Rental Agreement + Electricity/Gas Bill",
      },
      {
        key: "self_affidavit",
        label: "Notarized Self-Affidavit + supporting proof",
      },
    ],
    dualUploadSubtypes: {
      rental_agreement: {
        primary: "Rental Agreement",
        secondary: "Electricity/Gas Bill",
      },
      self_affidavit: {
        primary: "Self Affidavit",
        secondary: "Supporting Proof",
      },
    },
  },
  {
    key: "id_proof",
    label: "ID Proof",
    required: true,
    subtypes: [
      { key: "aadhaar", label: "Aadhaar" },
      { key: "pan", label: "PAN" },
      { key: "passport", label: "Passport" },
    ],
    slots: [
      { key: "front", label: "Front" },
      { key: "back", label: "Back" },
    ],
    hint: "Upload both the front and back of your ID",
  },
];

export const LL_DOC_TYPE_MAP: Record<string, LLDocTypeDef> = Object.fromEntries(
  LL_DOC_TYPES.map((d) => [d.key, d]),
);

/** Personal-detail questions on the LL application form (stored in form_data). */
export const LL_FORM_FIELDS: {
  key: string;
  label: string;
  type: "text" | "date" | "select";
  required: boolean;
  options?: string[];
}[] = [
  {
    key: "full_name",
    label: "Full Name (as on documents)",
    type: "text",
    required: true,
  },
  { key: "email", label: "Email", type: "text", required: true },
  { key: "phone", label: "Phone", type: "text", required: true },
  {
    key: "date_of_birth",
    label: "Date of Birth",
    type: "date",
    required: true,
  },
  {
    key: "gender",
    label: "Gender",
    type: "select",
    required: true,
    options: ["Male", "Female", "Other"],
  },
  {
    key: "blood_group",
    label: "Blood Group",
    type: "select",
    required: false,
    options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"],
  },
  {
    key: "father_or_spouse_name",
    label: "Father's / Spouse's Name",
    type: "text",
    required: true,
  },
  {
    key: "place_of_birth",
    label: "Place of Birth",
    type: "text",
    required: true,
  },
  {
    key: "educational_qualification",
    label: "Educational Qualification",
    type: "select",
    required: false,
    options: [
      "Below 10th",
      "10th Pass",
      "12th Pass",
      "Graduate",
      "Post-Graduate",
      "Other",
    ],
  },
  {
    key: "address",
    label: "Current Full Address",
    type: "text",
    required: true,
  },
  { key: "pincode", label: "Pincode", type: "text", required: true },
];
