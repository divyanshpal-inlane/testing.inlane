import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  assertLLStatusTransition,
  classifyLLStatusTransition,
  fieldsToClearOnLLRevert,
  isLLSegregationRouteCode,
  LL_ESCALATION_STATUSES,
  LL_FAILURE_STAGES,
  LL_PHASES,
  LL_SEGREGATION_ROUTES,
  LL_STAGES,
  LLPhaseKey,
  llSegregationRouteLabel,
  llStagePhase,
} from "@/constants/llPipeline";
import { supabase } from "@/lib/supabaseClient";

// The generated database types don't include the new ll_* tables yet
// (same pattern as noShowFees.ts) — regenerate types to remove this.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface LLApplication {
  id: string;
  learner_id: string;
  status: string;
  services: string[];
  ll_type: "with_classes" | "direct_dl" | null;
  application_number: string | null;
  application_date: string | null;
  date_of_birth: string | null;
  batch_code: string | null;
  ll_number: string | null;
  scrutiny_approved_date: string | null;
  /** Generated column: scrutiny_approved_date + 7 days. Never write it. */
  scrutiny_expiry_date: string | null;
  ll_matures_at: string | null;
  dl_application_number: string | null;
  dl_application_date: string | null;
  /** Customer's preferred slot (homepage picker); ops confirms into dl_test_*. */
  dl_preferred_date: string | null;
  dl_preferred_rto: string | null;
  dl_test_date: string | null;
  dl_test_time: string | null;
  dl_test_rto: string | null;
  dl_test_rto_address: string | null;
  dl_retest_fee: number | null;
  dl_number: string | null;
  dl_expiry_date: string | null;
  dl_dispatch_eta: string | null;
  dl_tracking_ref: string | null;
  rejection_reason: string | null;
  /** Answers from the in-app LL application form. */
  form_data: Record<string, string> | null;
  form_submitted_at: string | null;
  escalated: boolean;
  escalation_reason: string | null;
  /** When the current status was entered (maintained by a DB trigger). */
  status_changed_at: string;
  /** Customer no-shows on the application call (2 -> Ops calls them). */
  call_missed_count: number;
  ll_issue_date: string | null;
  ll_expiry_date: string | null;
  /** Fresh govt fee quoted when scrutiny expires (falls back to default). */
  reapply_fee: number | null;
  /** Which scheduled nudges the ll-flow-reminders sweep already sent. */
  reminders_sent: Record<string, string>;
  /** Sticky: learner passed the online LL test (survives Ops revert). */
  ll_test_passed_achieved?: boolean;
  /** Sticky: learner passed the DL test (survives Ops revert). */
  dl_test_passed_achieved?: boolean;
  created_at: string;
  updated_at: string;
  Learner: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    area: string | null;
  } | null;
}

export interface LLPipelineEvent {
  id: string;
  application_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_name: string | null;
  note: string | null;
  changes: { field: string; label: string; old: unknown; new: unknown }[];
  created_at: string;
}

// ── Backend-driven pagination (LLDL Pipeline) ────────────────────────────
// The admin list never downloads the whole table. Every request asks the
// database for one page (15 rows) and applies the active queue/search/route/
// date filters in the WHERE clause (PostgREST LIMIT/OFFSET + filters). The
// page can never return more than 15 rows and pagination reaches well
// past PostgREST's 1000-row response cap.

export type LLPipelineQueueKey = "all" | LLPhaseKey | "escalations";

export interface LLPipelineFilters {
  /** Empty = every phase; otherwise status must fall in one of these phases. */
  phases: LLPhaseKey[];
  /** When true, only escalated rows / failure statuses (scoped to selected phases if any). */
  escalationsOnly: boolean;
  /** Empty = all stages in scope; otherwise status IN (...). */
  stages: string[];
  /** Matches learner name/phone/email, application no., LL no., batch/route. */
  search: string;
  /** Empty = all routes; values A|B|C|D|unset */
  routes: string[];
  dateField: "created_at" | "updated_at";
  dateFrom: string;
  dateTo: string;
}

export const LL_PIPELINE_PAGE_SIZE = 15;

/** Swap inverted local-date bounds so filters stay inclusive. */
export function normalizeLLPipelineFilters(
  filters: LLPipelineFilters,
): LLPipelineFilters {
  if (
    filters.dateFrom &&
    filters.dateTo &&
    filters.dateFrom > filters.dateTo
  ) {
    return {
      ...filters,
      dateFrom: filters.dateTo,
      dateTo: filters.dateFrom,
    };
  }
  return filters;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyLLRoutesFilter(query: any, routes: string[]) {
  if (!routes.length) return query;
  const orParts: string[] = [];
  if (routes.includes("unset")) {
    orParts.push("batch_code.is.null");
  }
  for (const code of ["A", "B", "C", "D"] as const) {
    if (routes.includes(code)) {
      orParts.push(`batch_code.eq.${code}`);
    }
  }
  if (orParts.length === 0) return query;
  return query.or(orParts.join(","));
}

/** Every storable status that belongs to a pipeline phase (incl. failures). */
function llStatusesInPhase(phase: LLPhaseKey): string[] {
  const statuses = new Set<string>();
  for (const stage of LL_STAGES) {
    if (stage.phase === phase) statuses.add(stage.key);
  }
  for (const key of Object.keys(LL_FAILURE_STAGES)) {
    if (llStagePhase(key) === phase) statuses.add(key);
  }
  return [...statuses];
}

const ALL_LL_PIPELINE_STATUSES = [
  ...LL_STAGES.map((stage) => stage.key),
  ...Object.keys(LL_FAILURE_STAGES),
];

/** Union of storable statuses across the selected pipeline phases. */
export function llStatusesForPhases(phases: LLPhaseKey[]): string[] {
  const statuses = new Set<string>();
  for (const phase of phases) {
    for (const status of llStatusesInPhase(phase)) {
      statuses.add(status);
    }
  }
  return [...statuses];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyLLPhaseQueueFilters(
  query: any,
  phases: LLPhaseKey[],
  escalationsOnly: boolean,
) {
  if (phases.length === 0 && !escalationsOnly) {
    return query;
  }

  if (phases.length === 0 && escalationsOnly) {
    return query.or(
      `escalated.is.true,status.in.(${LL_ESCALATION_STATUSES.join(",")})`,
    );
  }

  const phaseStatuses = llStatusesForPhases(phases);

  if (!escalationsOnly) {
    return query.in("status", phaseStatuses);
  }

  const failuresInPhase = LL_ESCALATION_STATUSES.filter((s) =>
    phaseStatuses.includes(s),
  );
  const escOr = ["escalated.is.true"];
  if (failuresInPhase.length > 0) {
    escOr.push(`status.in.(${failuresInPhase.join(",")})`);
  }
  return query.in("status", phaseStatuses).or(escOr.join(","));
}

/** Expand derived route labels into database batch-code matches. */
function llPipelineSearchRoutes(term: string): string[] {
  const t = term.trim().toLowerCase();
  if (!t) return [];

  return LL_SEGREGATION_ROUTES.filter(
    (route) =>
      route.code.toLowerCase() === t ||
      route.name.toLowerCase().includes(t) ||
      llSegregationRouteLabel(route.code).toLowerCase().includes(t),
  ).map((route) => route.code);
}

async function fetchLLApplicationsPage(opts: {
  page: number;
  filters: LLPipelineFilters;
  signal: AbortSignal;
}): Promise<{ data: LLApplication[]; total: number }> {
  const { page, signal } = opts;
  const filters = normalizeLLPipelineFilters(opts.filters);
  const from = (page - 1) * LL_PIPELINE_PAGE_SIZE;
  const buildQuery = (head = false) => {
    // The SQL function returns the table type, preserving Learner embedding.
    // Search, exact count and the 15-row range use a single database request.
    let q = sb.rpc(
      "get_ll_pipeline_applications",
      {
        search_term: filters.search.trim(),
        search_routes: llPipelineSearchRoutes(filters.search),
      },
      { count: "exact", head },
    );

    q = q.select("*, Learner(id, name, phone, email, area)");
    q = applyLLPhaseQueueFilters(
      q,
      filters.phases,
      filters.escalationsOnly,
    );
    if (filters.stages.length > 0) {
      q = q.in("status", filters.stages);
    }
    q = applyLLRoutesFilter(q, filters.routes);
    if (filters.dateFrom) {
      // Local-date aware bounds (IST) so a date filter includes the whole day.
      q = q.gte(filters.dateField, `${filters.dateFrom}T00:00:00+05:30`);
    }
    if (filters.dateTo) {
      q = q.lte(filters.dateField, `${filters.dateTo}T23:59:59+05:30`);
    }
    return q.abortSignal(signal);
  };

  const { data, error, count } = await buildQuery()
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + LL_PIPELINE_PAGE_SIZE - 1);
  // Status changes/deletions can shrink the last page. PostgREST doesn't give
  // a usable count on PGRST103, so recover it with a count-only request.
  if (error?.code === "PGRST103" && from > 0) {
    const { count: remainingCount, error: countError } = await buildQuery(true);
    if (countError) throw countError;
    return { data: [], total: remainingCount ?? 0 };
  }
  if (error) {
    if (error.code === "PGRST202") {
      throw new Error(
        "Apply the LL pipeline pagination migration " +
          "(20260918000700_ll_pipeline_pagination.sql) in Supabase.",
      );
    }
    throw error;
  }
  return {
    data: (data ?? []) as unknown as LLApplication[],
    total: count ?? 0,
  };
}

/** Only the active tab's current 15-row page is fetched, never accumulated. */
export function useLLApplicationsPage(
  filters: LLPipelineFilters,
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: ["ll-applications", "page", filters, page],
    queryFn: ({ signal }) => fetchLLApplicationsPage({ page, filters, signal }),
    enabled,
    staleTime: 30 * 1000,
    retry: (failureCount, error) =>
      !(error instanceof Error) &&
      (error as { code?: string }).code !== "42501" &&
      failureCount < 2,
  });
}

/** Keep selected details/actions available even outside the current page. */
export function useLLApplication(
  applicationId: string | null,
  pageApplication?: LLApplication,
) {
  return useQuery({
    queryKey: ["ll-applications", "detail", applicationId],
    queryFn: async ({ signal }): Promise<LLApplication | null> => {
      if (!applicationId) return null;
      const { data, error } = await sb
        .from("ll_applications")
        .select("*, Learner(id, name, phone, email, area)")
        .eq("id", applicationId)
        .abortSignal(signal)
        .single();
      if (error) throw error;
      return data;
    },
    initialData: pageApplication,
    enabled: !!applicationId && !pageApplication,
    staleTime: 30 * 1000,
  });
}

/**
 * Per-tab counts for the LLDL Pipeline header. Each tab is a cheap DB count
 * query (`HEAD` + exact count) so the numbers are real totals, never capped
 * at 1000.
 */
export function useLLQueueCounts() {
  return useQuery({
    queryKey: ["ll-queue-counts"],
    queryFn: async (): Promise<Record<LLPipelineQueueKey, number>> => {
      const tabs: { key: LLPipelineQueueKey; statuses: string[] | null }[] = [
        { key: "all", statuses: null },
        ...LL_PHASES.map((p) => ({
          key: p.key as LLPipelineQueueKey,
          statuses: llStatusesInPhase(p.key),
        })),
        { key: "escalations", statuses: null },
      ];
      const rows = await Promise.all(
        tabs.map(async ({ key, statuses }) => {
          let q = sb.from("ll_applications").select("id", {
            count: "exact",
            head: true,
          });
          if (key === "escalations") {
            q = q.or(
              `escalated.is.true,status.in.(${LL_ESCALATION_STATUSES.join(",")})`,
            );
          } else if (statuses) {
            q = q.in("status", statuses);
          }
          const { error, count } = await q;
          if (error) throw error;
          return { key, count: count ?? 0 };
        }),
      );
      return Object.fromEntries(rows.map((r) => [r.key, r.count])) as Record<
        LLPipelineQueueKey,
        number
      >;
    },
    staleTime: 30 * 1000,
  });
}

/** Exact counts for every stage in the current phase / escalation scope. */
export function useLLStageCounts(
  phases: LLPhaseKey[],
  escalationsOnly: boolean,
) {
  return useQuery({
    queryKey: ["ll-stage-counts", phases, escalationsOnly],
    queryFn: async (): Promise<Record<string, number>> => {
      const statusesInScope =
        phases.length === 0
          ? ALL_LL_PIPELINE_STATUSES
          : llStatusesForPhases(phases);

      const rows = await Promise.all(
        statusesInScope.map(async (status) => {
          let q = sb.from("ll_applications").select("id", {
            count: "exact",
            head: true,
          });
          q = applyLLPhaseQueueFilters(q, phases, escalationsOnly).eq(
            "status",
            status,
          );
          const { error, count } = await q;
          if (error) throw error;
          return [status, count ?? 0] as const;
        }),
      );
      return Object.fromEntries(rows);
    },
    staleTime: 30 * 1000,
  });
}

/** Refresh the pipeline lists + tab counts after any LL application change. */
function invalidateLLPipeline(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["ll-applications"] });
  queryClient.invalidateQueries({ queryKey: ["ll-queue-counts"] });
  queryClient.invalidateQueries({ queryKey: ["ll-stage-counts"] });
}

export function useLLPipelineEvents(applicationId: string | null) {
  return useQuery({
    queryKey: ["ll-pipeline-events", applicationId],
    queryFn: async (): Promise<LLPipelineEvent[]> => {
      const { data, error } = await sb
        .from("ll_pipeline_events")
        .select("*")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LLPipelineEvent[];
    },
    enabled: !!applicationId,
  });
}

/** Learner search for the "New Application" dialog. */
export function useLLLearnerSearch(term: string) {
  return useQuery({
    queryKey: ["ll-learner-search", term],
    queryFn: async () => {
      // Strip commas — they break or() parsing (PGRST100).
      const clean = term.trim().replace(/,/g, "");
      const like = `%${clean}%`;
      const { data, error } = await sb
        .from("Learner")
        .select("id, name, phone, email")
        .or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
    enabled: term.trim().length >= 3,
  });
}

async function appendEvent(event: {
  application_id: string;
  learner_id?: string | null;
  event_type:
    | "status_change"
    | "status_reversal"
    | "field_update"
    | "note"
    | "escalation";
  from_status?: string | null;
  to_status?: string | null;
  actor_name?: string | null;
  note?: string | null;
  changes?: { field: string; label: string; old: unknown; new: unknown }[];
}) {
  const { error } = await sb.from("ll_pipeline_events").insert({
    changes: [],
    ...event,
  });
  // Timeline write failures shouldn't block the operational update, but they
  // must not be silent either.
  if (error) console.error("[llApplications] event insert failed:", error);
}

/** Match the database's one-active-journey constraint. */
async function findActiveLLApplication(
  learnerId: string,
): Promise<LLApplication | null> {
  const { data, error } = await sb
    .from("ll_applications")
    .select("*, Learner(id, name, phone, email, area)")
    .eq("learner_id", learnerId)
    .not("status", "in", "(dl_delivered,closed)")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function useActiveLLApplication(learnerId: string | null) {
  return useQuery({
    queryKey: ["ll-active-application", learnerId],
    queryFn: () => findActiveLLApplication(learnerId!),
    enabled: !!learnerId,
    staleTime: 0,
  });
}

export function useCreateLLApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      learnerId,
      services,
      actorName,
    }: {
      learnerId: string;
      services: string[];
      actorName?: string | null;
    }) => {
      const existing = await findActiveLLApplication(learnerId);
      if (existing) return { kind: "existing" as const, application: existing };

      const { data, error } = await sb
        .from("ll_applications")
        .insert({ learner_id: learnerId, services, status: "payment_received" })
        .select("id")
        .single();
      if (error) {
        // Another admin or the learner may have created a journey after our check.
        if (error.code === "23505") {
          const concurrent = await findActiveLLApplication(learnerId);
          if (concurrent)
            return { kind: "existing" as const, application: concurrent };
        }
        throw error;
      }
      await appendEvent({
        application_id: data.id,
        learner_id: learnerId,
        event_type: "status_change",
        to_status: "payment_received",
        actor_name: actorName,
        note: "Application created",
      });
      return { kind: "created" as const, id: data.id as string };
    },
    onSuccess: (result, { learnerId }) => {
      if (result.kind === "existing") {
        queryClient.setQueryData(
          ["ll-active-application", learnerId],
          result.application,
        );
      } else {
        queryClient.invalidateQueries({
          queryKey: ["ll-active-application", learnerId],
        });
      }
      return invalidateLLPipeline(queryClient);
    },
  });
}

/**
 * WhatsApp notification for a status transition (from the RTO-flow spec).
 * Returns null when the state has no customer message.
 */
function llStatusMessageType(
  toStatus: string,
  callMissedCount: number,
  llType: string | null,
): string | null {
  switch (toStatus) {
    case "meet_booking_enabled":
      return "LL_DOCS_APPROVED_BOOK_SLOT";
    case "docs_rejected":
      return "LL_DOCS_REJECTED";
    case "call_missed_by_lane":
      return "LL_CALL_MISSED_BY_LANE";
    case "call_missed":
      return callMissedCount >= 2 ? "LL_CALL_MISSED_TWICE" : null;
    case "ll_approval_rejected":
      return "LL_APPROVAL_REJECTED";
    case "ll_issued":
      return "LL_NUMBER_ISSUED";
    // ── DL phase ───────────────────────────────────────────────────────
    case "ll_matured":
      return "LL_MATURED_SELECT_DL_DATE";
    case "dl_date_selection":
      // The maturing (direct-DL) track already got the ll_matured message.
      return llType === "with_classes"
        ? "CLASSES_COMPLETED_SELECT_DL_DATE"
        : null;
    case "dl_otp_required":
      return "DL_SLOT_OTP_CALLBACK";
    case "dl_test_scheduled":
      return "DL_TEST_CONFIRMED";
    case "dl_results_pending":
      return "DL_RESULT_PENDING";
    case "dl_test_passed":
      return "DL_TEST_PASSED";
    case "dl_test_failed":
      return "DL_TEST_FAILED_RETEST";
    case "dl_test_missed":
      return "DL_TEST_NO_SHOW_RESCHEDULE";
    case "dl_number_generated":
      return "DL_NUMBER_GENERATED";
    case "dl_delivery_pending":
      return "DL_CARD_DISPATCHED";
    case "dl_delivered":
      return "DL_DELIVERED_FINAL";
    case "dl_not_delivered":
      return "DL_NOT_DELIVERED_TICKET";
    default:
      return null;
  }
}

const FIELD_LABELS: Record<string, string> = {
  application_number: "LL Application Number",
  application_date: "LL Application Date",
  date_of_birth: "Date of Birth",
  batch_code: "Segregation route",
  ll_number: "LL Number",
  scrutiny_approved_date: "Scrutiny Approved Date",
  ll_matures_at: "LL Matures On",
  dl_application_number: "DL Test Application Number",
  dl_application_date: "DL Test Application Date",
  dl_test_date: "DL Test Date",
  dl_test_rto: "DL Test RTO",
  dl_number: "DL Number",
  rejection_reason: "Rejection Reason",
  services: "Services",
  ll_type: "LL Type",
  escalated: "Escalated",
  escalation_reason: "Escalation Reason",
  ll_issue_date: "LL Issue Date",
  ll_expiry_date: "LL Valid Till",
  reapply_fee: "Reapply Govt Fee (Rs.)",
  call_missed_count: "Customer Call Misses",
  dl_preferred_date: "Customer's Preferred DL Test Date",
  dl_preferred_rto: "Customer's Preferred RTO",
  dl_test_time: "DL Test Time",
  dl_test_rto_address: "DL Test RTO Address",
  dl_retest_fee: "DL Retest Fee (Rs.)",
  dl_expiry_date: "DL Valid Till",
  dl_dispatch_eta: "DL Card Expected Delivery",
  dl_tracking_ref: "DL Card Tracking Ref",
};

export function useUpdateLLStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      application,
      toStatus,
      note,
      actorName,
      actorId,
      extraFields,
    }: {
      application: LLApplication;
      toStatus: string;
      note?: string;
      actorName?: string | null;
      /** Admin user id — stored on the timeline for stronger audit. */
      actorId?: string | null;
      /** Fields to persist together with the transition (e.g. ll_type, escalated). */
      extraFields?: Partial<LLApplication>;
    }) => {
      // Prefer draft batch_code if the transition is bundled with a route set.
      const batchCode =
        (extraFields?.batch_code as string | null | undefined) ??
        application.batch_code;

      const milestones = {
        ll_test_passed_achieved: application.ll_test_passed_achieved ?? false,
        dl_test_passed_achieved: application.dl_test_passed_achieved ?? false,
      };

      const kind = classifyLLStatusTransition(
        application.status,
        toStatus,
        batchCode,
        milestones,
      );
      if (!kind) {
        throw new Error(
          `Illegal status move ${application.status} → ${toStatus} for route ${
            batchCode ?? "unset"
          }.`,
        );
      }
      assertLLStatusTransition({
        fromStatus: application.status,
        toStatus,
        batchCode,
        kind,
        milestones,
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { Learner: _l, ...fields } = extraFields ?? {};
      const { error } = await sb
        .from("ll_applications")
        .update({
          status: toStatus,
          updated_at: new Date().toISOString(),
          ...fields,
        })
        .eq("id", application.id);
      if (error) throw error;
      await appendEvent({
        application_id: application.id,
        learner_id: application.learner_id,
        event_type: "status_change",
        from_status: application.status,
        to_status: toStatus,
        actor_name: actorName,
        note: note ?? null,
        changes: actorId
          ? [{ field: "actor_id", label: "Actor ID", old: null, new: actorId }]
          : [],
      });

      // Customer WhatsApp update for this transition — fire and forget, a
      // messaging hiccup must not roll back the operational change.
      const messageType = llStatusMessageType(
        toStatus,
        (extraFields?.call_missed_count ?? application.call_missed_count) || 0,
        extraFields?.ll_type ?? application.ll_type,
      );
      if (messageType) {
        supabase.functions
          .invoke("send-message", {
            body: {
              message_type: messageType,
              learner_id: application.learner_id,
            },
          })
          .catch((e: Error) =>
            console.error("[llApplications] send-message failed:", e),
          );
      }
    },
    onSuccess: (_d, { application }) => {
      invalidateLLPipeline(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ll-pipeline-events"] });
      queryClient.invalidateQueries({
        queryKey: ["my-ll-application", application.learner_id],
      });
    },
  });
}

/**
 * Move an application back to an earlier stage (Ops mistake correction).
 * Requires a reason. Skips customer WhatsApp. Clears stage-gated fields that
 * no longer apply. Logged as event_type = status_reversal.
 */
export function useRevertLLStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      application,
      toStatus,
      reason,
      actorName,
      actorId,
    }: {
      application: LLApplication;
      toStatus: string;
      reason: string;
      actorName?: string | null;
      actorId?: string | null;
    }) => {
      const trimmed = reason.trim();
      if (!trimmed) {
        throw new Error("A reason is required when reverting a stage.");
      }
      assertLLStatusTransition({
        fromStatus: application.status,
        toStatus,
        batchCode: application.batch_code,
        kind: "revert",
      });

      const cleared = fieldsToClearOnLLRevert(toStatus);
      // RPC sets ll.transition_kind=revert so the DB trigger allows the move.
      const { error } = await sb.rpc("ll_revert_application", {
        p_application_id: application.id,
        p_to_status: toStatus,
        p_clear_fields: cleared,
      });
      if (error) throw error;

      const clearedLabels = Object.keys(cleared);
      await appendEvent({
        application_id: application.id,
        learner_id: application.learner_id,
        event_type: "status_reversal",
        from_status: application.status,
        to_status: toStatus,
        actor_name: actorName,
        note: trimmed,
        changes: [
          ...(actorId
            ? [
                {
                  field: "actor_id",
                  label: "Actor ID",
                  old: null as unknown,
                  new: actorId as unknown,
                },
              ]
            : []),
          ...clearedLabels.map((field) => ({
            field,
            label: FIELD_LABELS[field] ?? field,
            old:
              (application as unknown as Record<string, unknown>)[field] ??
              null,
            new: null as unknown,
          })),
        ],
      });
    },
    onSuccess: (_d, { application }) => {
      invalidateLLPipeline(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ll-pipeline-events"] });
      queryClient.invalidateQueries({
        queryKey: ["my-ll-application", application.learner_id],
      });
    },
  });
}

// ── Uploaded documents (in-app LL application form) ──────────────────────

export interface LLDocument {
  id: string;
  application_id: string;
  learner_id: string | null;
  doc_type: string;
  doc_subtype: string | null;
  /** primary | secondary | front | back — distinguishes multi-file docs. */
  doc_slot: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export function llDocumentUrl(doc: LLDocument): string {
  return supabase.storage.from("ll-documents").getPublicUrl(doc.storage_path)
    .data.publicUrl;
}

export function useLLDocuments(applicationId: string | null) {
  return useQuery({
    queryKey: ["ll-documents", applicationId],
    queryFn: async (): Promise<LLDocument[]> => {
      const { data, error } = await sb
        .from("ll_documents")
        .select("*")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LLDocument[];
    },
    enabled: !!applicationId,
  });
}

/**
 * Ops uploads the issued licence (PDF/image) so the customer's "Download
 * LL"/"Download DL" button works. Stored as an approved ll_documents row of
 * type "ll_card"/"dl_card"; re-uploading replaces the previous one.
 */
export function useUploadLLCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      application,
      file,
      actorName,
      docType = "ll_card",
    }: {
      application: LLApplication;
      file: File;
      actorName?: string | null;
      docType?: "ll_card" | "dl_card";
    }) => {
      const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const path = `${application.learner_id}/${docType}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("ll-documents")
        .upload(path, file, { cacheControl: "3600", upsert: true });
      if (uploadError) throw uploadError;

      const { error: deleteError } = await sb
        .from("ll_documents")
        .delete()
        .eq("application_id", application.id)
        .eq("doc_type", docType)
        .eq("doc_slot", "primary");
      if (deleteError) throw deleteError;

      const { error: insertError } = await sb.from("ll_documents").insert({
        application_id: application.id,
        learner_id: application.learner_id,
        doc_type: docType,
        doc_slot: "primary",
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        status: "approved",
        reviewed_by: actorName ?? null,
        reviewed_at: new Date().toISOString(),
      });
      if (insertError) throw insertError;

      await appendEvent({
        application_id: application.id,
        learner_id: application.learner_id,
        event_type: "note",
        actor_name: actorName,
        note: `${docType === "dl_card" ? "DL" : "LL"} card uploaded — customer can now download it`,
      });
    },
    onSuccess: (_d, { application }) => {
      queryClient.invalidateQueries({ queryKey: ["ll-documents"] });
      queryClient.invalidateQueries({
        queryKey: ["my-ll-application", application.learner_id],
      });
      queryClient.invalidateQueries({ queryKey: ["ll-pipeline-events"] });
    },
  });
}

/** RTO team verdict on a single uploaded document. */
export function useReviewLLDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      doc,
      status,
      rejectionReason,
      actorName,
      docLabel,
    }: {
      doc: LLDocument;
      status: "approved" | "rejected";
      rejectionReason?: string;
      actorName?: string | null;
      docLabel: string;
    }) => {
      const { error } = await sb
        .from("ll_documents")
        .update({
          status,
          rejection_reason:
            status === "rejected" ? (rejectionReason ?? null) : null,
          reviewed_by: actorName ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", doc.id);
      if (error) throw error;
      await appendEvent({
        application_id: doc.application_id,
        learner_id: doc.learner_id,
        event_type: "note",
        actor_name: actorName,
        note:
          status === "approved"
            ? `Document approved: ${docLabel}`
            : `Document rejected: ${docLabel}${rejectionReason ? ` — ${rejectionReason}` : ""}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ll-documents"] });
      queryClient.invalidateQueries({ queryKey: ["ll-pipeline-events"] });
    },
  });
}

/** RTO team replaces a rejected customer document collected offline. */
export function useAdminReplaceLLDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      application,
      doc,
      file,
      actorName,
      docLabel,
    }: {
      application: LLApplication;
      doc: LLDocument;
      file: File;
      actorName?: string | null;
      docLabel: string;
    }) => {
      if (doc.status !== "rejected") {
        throw new Error("Only rejected documents can be replaced here.");
      }

      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const slot = doc.doc_slot || "primary";
      const path = `${application.learner_id}/${doc.doc_type}-${slot}-admin-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("ll-documents")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (uploadError) {
        throw new Error(`Document upload failed: ${uploadError.message}`);
      }

      const { data: replaced, error: updateError } = await sb
        .from("ll_documents")
        .update({
          storage_path: path,
          file_name: file.name,
          mime_type: file.type,
          status: "pending",
          rejection_reason: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: new Date().toISOString(),
        })
        .eq("id", doc.id)
        .eq("application_id", application.id)
        .eq("status", "rejected")
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!replaced) {
        throw new Error(
          "This document is no longer rejected. Refresh and try again.",
        );
      }

      await appendEvent({
        application_id: application.id,
        learner_id: application.learner_id,
        event_type: "note",
        actor_name: actorName,
        note: `Document replaced by RTO team: ${docLabel} — ${file.name}`,
      });

      const { data: remainingRejected, error: remainingError } = await sb
        .from("ll_documents")
        .select("id")
        .eq("application_id", application.id)
        .eq("status", "rejected")
        .limit(1);
      if (remainingError) throw remainingError;

      let returnedToReview = false;
      if (
        application.status === "docs_rejected" &&
        (remainingRejected ?? []).length === 0
      ) {
        const { data: submitted, error: submitError } = await sb
          .from("ll_applications")
          .update({
            status: "docs_submitted",
            rejection_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", application.id)
          .eq("status", "docs_rejected")
          .select("id")
          .maybeSingle();
        if (submitError) throw submitError;

        if (submitted) {
          await appendEvent({
            application_id: application.id,
            learner_id: application.learner_id,
            event_type: "status_change",
            from_status: "docs_rejected",
            to_status: "docs_submitted",
            actor_name: actorName,
            note: "All rejected documents were replaced by the RTO team",
          });

          const { data: underReview, error: reviewError } = await sb
            .from("ll_applications")
            .update({
              status: "docs_under_review",
              updated_at: new Date().toISOString(),
            })
            .eq("id", application.id)
            .eq("status", "docs_submitted")
            .select("id")
            .maybeSingle();
          if (reviewError) throw reviewError;
          if (!underReview) {
            throw new Error(
              "The documents were replaced, but the application status changed at the same time. Refresh to see its current stage.",
            );
          }

          returnedToReview = true;
          await appendEvent({
            application_id: application.id,
            learner_id: application.learner_id,
            event_type: "status_change",
            from_status: "docs_submitted",
            to_status: "docs_under_review",
            actor_name: actorName,
            note: "RTO team replacement submitted — documents returned to review",
          });
        }
      }

      return { returnedToReview };
    },
    onSuccess: (_result, { application }) => {
      queryClient.invalidateQueries({ queryKey: ["ll-documents"] });
      invalidateLLPipeline(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ll-pipeline-events"] });
      queryClient.invalidateQueries({
        queryKey: ["my-ll-application", application.learner_id],
      });
    },
  });
}

export function useUpdateLLFields() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      application,
      fields,
      actorName,
    }: {
      application: LLApplication;
      fields: Partial<LLApplication>;
      actorName?: string | null;
    }) => {
      const changes = Object.entries(fields)
        .filter(
          ([k, v]) =>
            JSON.stringify(v) !==
            JSON.stringify(
              (application as unknown as Record<string, unknown>)[k],
            ),
        )
        .map(([field, value]) => {
          const format =
            field === "batch_code"
              ? (v: unknown) =>
                  v == null || v === ""
                    ? null
                    : llSegregationRouteLabel(String(v))
              : (v: unknown) => v ?? null;
          return {
            field,
            label: FIELD_LABELS[field] ?? field,
            old: format(
              (application as unknown as Record<string, unknown>)[field],
            ),
            new: format(value),
          };
        });
      if (changes.length === 0) return;

      if (
        "batch_code" in fields &&
        fields.batch_code != null &&
        fields.batch_code !== "" &&
        !isLLSegregationRouteCode(String(fields.batch_code))
      ) {
        throw new Error("Segregation route must be A, B, C, or D.");
      }

      const { error } = await sb
        .from("ll_applications")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", application.id);
      if (error) throw error;
      await appendEvent({
        application_id: application.id,
        learner_id: application.learner_id,
        event_type: "field_update",
        actor_name: actorName,
        changes,
      });
    },
    onSuccess: () => {
      invalidateLLPipeline(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ll-pipeline-events"] });
    },
  });
}

export interface LLAutoPromoteResult {
  application_id: string;
  learner_id: string;
  from_status: string;
  to_status: string;
}

/**
 * Run the DB auto-promote pass (classes − 1 + maturity window, and
 * ll_maturing → ll_matured). Sends the matching WhatsApp for each move.
 * Pass learnerId to scope to one learner (lesson-complete hook); omit for
 * a full sweep (daily cron / reminders job).
 */
export async function runLLAutoPromoteDL(
  learnerId?: string | null,
): Promise<LLAutoPromoteResult[]> {
  const { data, error } = await sb.rpc("ll_auto_promote_dl", {
    p_learner_id: learnerId ?? null,
  });
  if (error) throw error;
  const rows = (data ?? []) as LLAutoPromoteResult[];

  for (const row of rows) {
    const messageType =
      row.to_status === "ll_matured"
        ? "LL_MATURED_SELECT_DL_DATE"
        : row.to_status === "dl_date_selection"
          ? "CLASSES_COMPLETED_SELECT_DL_DATE"
          : null;
    if (!messageType) continue;
    supabase.functions
      .invoke("send-message", {
        body: {
          message_type: messageType,
          learner_id: row.learner_id,
        },
      })
      .catch((e: Error) =>
        console.error("[llApplications] auto-promote send-message failed:", e),
      );
  }

  return rows;
}
