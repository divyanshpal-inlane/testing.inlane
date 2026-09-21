import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabaseClient";

// The no_show_fee / no_show_appeal tables are newer than the generated
// database.types.ts, so route their access through an untyped handle and expose
// the explicit interfaces below (same approach noShow.ts uses for its own types).
const sb = supabase as any;

export const NO_SHOW_FEE_AMOUNT = 300; // ₹ — PRD-confirmed fee

export type FeeType = "no_show" | "late_reschedule";
export type FeeStatus =
  | "pending"
  | "confirmed"
  | "deducted"
  | "appealed"
  | "waived"
  | "paid";
export type AppealReason =
  | "instructor_no_show"
  | "system_error"
  | "emergency"
  | "other";
export type AppealStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "partial_refund";

export interface NoShowFee {
  id: string;
  schedule_id: number;
  no_show_id: string | null;
  learner_id: string;
  fee_type: FeeType;
  amount: number;
  status: FeeStatus;
  payment_id: string | null;
  marked_by: string | null;
  marked_at: string | null;
  created_at: string | null;
  // enriched
  date: string | null;
  startTime: string | null;
  learnerName: string | null;
  learnerPhone: string | null;
  instructorName: string | null;
  lessonNumber: number | null;
  appeal: NoShowAppeal | null;
}

export interface NoShowAppeal {
  id: string;
  fee_id: string;
  learner_id: string;
  reason: AppealReason;
  description: string | null;
  status: AppealStatus;
  refund_amount: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  ops_notes: string | null;
  created_at: string | null;
}

const first = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

// Best-effort WhatsApp/Heltar dispatch — a missing template must never block the
// fee/appeal action. The actual Heltar templates are added in the notifications
// phase; until then these no-op on the backend without throwing here.
async function notify(messageType: string, body: Record<string, unknown>) {
  try {
    await supabase.functions.invoke("send-message", {
      body: { message_type: messageType, ...body },
    });
  } catch (e) {
    console.warn(`notify(${messageType}) failed (non-blocking)`, e);
  }
}

// Enrich raw fee rows with Schedule/Learner/Instructor details + their appeal.
async function enrichFees(rows: any[]): Promise<NoShowFee[]> {
  if (!rows.length) return [];
  const scheduleIds = Array.from(new Set(rows.map((r) => r.schedule_id)));
  const feeIds = rows.map((r) => r.id);

  const [{ data: scheds }, { data: appeals }] = await Promise.all([
    supabase
      .from("Schedule")
      .select(
        "id, date, start_time, Learner(name, phone), Instructor(name), Lesson(number)",
      )
      .in("id", scheduleIds),
    sb.from("no_show_appeal").select("*").in("fee_id", feeIds),
  ]);

  const schedById = new Map<number, any>();
  for (const s of scheds ?? []) schedById.set(s.id, s);
  const appealByFee = new Map<string, NoShowAppeal>();
  for (const a of (appeals ?? []) as NoShowAppeal[])
    appealByFee.set(a.fee_id, a);

  return rows.map((r) => {
    const s = schedById.get(r.schedule_id);
    const learner = first<{ name: string | null; phone: string | null }>(
      s?.Learner as never,
    );
    const instr = first<{ name: string | null }>(s?.Instructor as never);
    const lesson = first<{ number: number | null }>(s?.Lesson as never);
    return {
      ...(r as NoShowFee),
      date: s?.date ?? null,
      startTime: s?.start_time ?? null,
      learnerName: learner?.name ?? null,
      learnerPhone: learner?.phone ?? null,
      instructorName: instr?.name ?? null,
      lessonNumber: lesson?.number ?? null,
      appeal: appealByFee.get(r.id) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Admin-facing
// ---------------------------------------------------------------------------

export function useAllNoShowFees(filters?: { status?: FeeStatus }) {
  return useQuery({
    queryKey: ["no_show_fees", filters?.status ?? "any"],
    queryFn: async (): Promise<NoShowFee[]> => {
      let q = sb
        .from("no_show_fee")
        .select("*")
        .order("marked_at", { ascending: false });
      if (filters?.status) q = q.eq("status", filters.status);
      const { data, error } = await q;
      if (error) throw error;
      return enrichFees(data ?? []);
    },
  });
}

// Raise a ₹300 fee against a confirmed no-show. Looks up the lesson's learner,
// inserts the fee, resolves the originating no-show case, and notifies the
// learner. Idempotent at the DB level via UNIQUE(schedule_id, fee_type).
export function useChargeNoShowFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      scheduleId: number;
      noShowId?: string | null;
      learnerId?: string | null;
      amount?: number;
      markedBy?: string | null;
    }) => {
      let learnerId = input.learnerId ?? null;
      if (!learnerId) {
        const { data: sched, error: schedErr } = await supabase
          .from("Schedule")
          .select("learner_id")
          .eq("id", input.scheduleId)
          .single();
        if (schedErr) throw schedErr;
        learnerId = sched?.learner_id ?? null;
      }
      if (!learnerId)
        throw new Error("Could not resolve learner for this lesson.");

      const { data: fee, error } = await sb
        .from("no_show_fee")
        .insert({
          schedule_id: input.scheduleId,
          no_show_id: input.noShowId ?? null,
          learner_id: learnerId,
          fee_type: "no_show",
          amount: input.amount ?? NO_SHOW_FEE_AMOUNT,
          status: "pending",
          marked_by: input.markedBy ?? "admin",
        })
        .select()
        .single();
      if (error) throw error;

      // Resolve the originating no-show case so it leaves the open queue.
      if (input.noShowId) {
        await supabase
          .from("schedule_no_show")
          .update({
            status: "resolved",
            resolution: `Fee charged (₹${input.amount ?? NO_SHOW_FEE_AMOUNT})`,
            resolved_by: input.markedBy ?? "admin",
            resolved_at: new Date().toISOString(),
          })
          .eq("id", input.noShowId);
      }

      await notify("NO_SHOW_FEE_CHARGED", {
        learner_id: learnerId,
        schedule_id: input.scheduleId,
        fee_amount: input.amount ?? NO_SHOW_FEE_AMOUNT,
      });

      return fee as NoShowFee;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["no_show_fees"] });
      qc.invalidateQueries({ queryKey: ["no_show_cases"] });
    },
  });
}

// Mark a (non-appealed) fee as deducted from the books.
export function useDeductFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string }) => {
      const { error } = await sb
        .from("no_show_fee")
        .update({ status: "deducted", deducted_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["no_show_fees"] }),
  });
}

// ---------------------------------------------------------------------------
// Appeals — admin review
// ---------------------------------------------------------------------------

export function useAllAppeals(filters?: { status?: AppealStatus }) {
  return useQuery({
    queryKey: ["no_show_appeals", filters?.status ?? "any"],
    queryFn: async (): Promise<NoShowFee[]> => {
      // Appeals are surfaced through their fee (enriched), so ops sees full context.
      let q = sb
        .from("no_show_appeal")
        .select("fee_id")
        .order("created_at", { ascending: false });
      if (filters?.status) q = q.eq("status", filters.status);
      const { data: appealRows, error } = await q;
      if (error) throw error;
      const feeIds = Array.from(
        new Set((appealRows ?? []).map((a: any) => a.fee_id)),
      );
      if (!feeIds.length) return [];
      const { data: fees, error: feeErr } = await sb
        .from("no_show_fee")
        .select("*")
        .in("id", feeIds);
      if (feeErr) throw feeErr;
      return enrichFees(fees ?? []);
    },
  });
}

// Resolve an appeal. approve = full waive, reject = fee stands, partial = reduce
// the fee by refundAmount. Mirrors PRD §7.4.
export function useReviewAppeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      appealId: string;
      feeId: string;
      feeAmount: number;
      learnerId: string;
      decision: "approve" | "reject" | "partial";
      refundAmount?: number;
      reviewerName?: string | null;
      opsNotes?: string | null;
    }) => {
      const now = new Date().toISOString();
      let appealStatus: AppealStatus;
      let feeUpdate: Record<string, unknown>;
      let refund = 0;

      if (input.decision === "approve") {
        appealStatus = "approved";
        refund = input.feeAmount;
        feeUpdate = { status: "waived" };
      } else if (input.decision === "reject") {
        appealStatus = "rejected";
        refund = 0;
        feeUpdate = { status: "confirmed" };
      } else {
        refund = Math.max(
          0,
          Math.min(input.refundAmount ?? 0, input.feeAmount),
        );
        appealStatus = "partial_refund";
        // The standing amount is what remains after the partial refund.
        feeUpdate = { status: "confirmed", amount: input.feeAmount - refund };
      }

      const { error: appealErr } = await sb
        .from("no_show_appeal")
        .update({
          status: appealStatus,
          refund_amount: refund,
          reviewed_by: input.reviewerName ?? "admin",
          reviewed_at: now,
          ops_notes: input.opsNotes ?? null,
        })
        .eq("id", input.appealId);
      if (appealErr) throw appealErr;

      const { error: feeErr } = await sb
        .from("no_show_fee")
        .update(feeUpdate)
        .eq("id", input.feeId);
      if (feeErr) throw feeErr;

      await notify(
        input.decision === "approve"
          ? "NO_SHOW_APPEAL_APPROVED"
          : input.decision === "reject"
            ? "NO_SHOW_APPEAL_REJECTED"
            : "NO_SHOW_APPEAL_PARTIAL",
        {
          learner_id: input.learnerId,
          refund_amount: refund,
          standing_amount: input.feeAmount - refund,
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["no_show_appeals"] });
      qc.invalidateQueries({ queryKey: ["no_show_fees"] });
      qc.invalidateQueries({ queryKey: ["learner_no_show_fees"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Learner-facing
// ---------------------------------------------------------------------------

export function useLearnerNoShowFees(learnerId: string | undefined) {
  return useQuery({
    queryKey: ["learner_no_show_fees", learnerId],
    enabled: !!learnerId,
    queryFn: async (): Promise<NoShowFee[]> => {
      const { data, error } = await sb
        .from("no_show_fee")
        .select("*")
        .eq("learner_id", learnerId!)
        .order("marked_at", { ascending: false });
      if (error) throw error;
      return enrichFees(data ?? []);
    },
  });
}

export function useCreateAppeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      feeId: string;
      learnerId: string;
      reason: AppealReason;
      description?: string | null;
    }) => {
      const { error } = await sb.from("no_show_appeal").insert({
        fee_id: input.feeId,
        learner_id: input.learnerId,
        reason: input.reason,
        description: input.description ?? null,
        status: "pending",
      });
      if (error) throw error;

      // Move the fee into the appealed state so ops sees it under review.
      await sb
        .from("no_show_fee")
        .update({ status: "appealed" })
        .eq("id", input.feeId);

      await notify("NO_SHOW_APPEAL_SUBMITTED", {
        learner_id: input.learnerId,
        fee_id: input.feeId,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["learner_no_show_fees"] });
      qc.invalidateQueries({ queryKey: ["no_show_appeals"] });
    },
  });
}
