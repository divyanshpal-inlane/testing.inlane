import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";

import {
  LL_PHASES,
  LL_STAGE_MAP,
  LLPhaseKey,
  llStagePhase,
} from "@/constants/llPipeline";
import { supabase } from "@/lib/supabaseClient";

// Data layer for the Operations Control Tower (WAI-73). Everything is
// computed client-side from tables we already have — no new schema. Heavier
// hooks are split per tab so each only loads when its tab is opened.

// The generated types don't include the ll_* tables (same pattern as
// llApplications.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const today = () => format(new Date(), "yyyy-MM-dd");
const daysAgo = (n: number) => format(subDays(new Date(), n), "yyyy-MM-dd");

const first = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

const isCancelled = (status: string | null) =>
  !!status && status.toLowerCase().includes("cancel");

// ---------------------------------------------------------------------------
// Executive KPIs (Overview tab)
// ---------------------------------------------------------------------------
export interface OpsKpis {
  activeStudents: number;
  newLearners7d: number;
  classesToday: {
    total: number;
    completed: number;
    upcoming: number;
    cancelled: number;
  };
  collectionsToday: number;
  outstanding: { count: number; amount: number };
  llByPhase: { key: LLPhaseKey; label: string; count: number }[];
  llEscalated: number;
  llTotal: number;
  actionNeeded: {
    openTickets: number;
    openNoShows: number;
    openSafety: number;
    pendingLeave: number;
  };
}

export function useOpsKpis() {
  return useQuery({
    queryKey: ["ops_kpis"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<OpsKpis> => {
      const t = today();
      const [
        activeRes,
        learnersRes,
        schedRes,
        paymentsRes,
        halfPaidRes,
        llRes,
        ticketsRes,
        noShowRes,
        safetyRes,
        leaveRes,
      ] = await Promise.all([
        supabase
          .from("enrollment")
          .select("id", { count: "exact", head: true })
          .eq("status", "active"),
        supabase
          .from("Learner")
          .select("id", { count: "exact", head: true })
          .gte("created_at", `${daysAgo(7)}T00:00:00`),
        supabase.from("Schedule").select("status, isTentative").eq("date", t),
        supabase
          .from("payment")
          .select("amount, status, updated_at")
          .in("status", ["completed", "upgraded"])
          .gte("updated_at", `${t}T00:00:00`),
        supabase
          .from("enrollment")
          .select("amount, installment1_amount, installment2_amount")
          .eq("payment_status", "half_paid"),
        sb.from("ll_applications").select("status, escalated"),
        supabase
          .from("support_ticket")
          .select("id", { count: "exact", head: true })
          .in("status", ["open", "in_progress"]),
        supabase
          .from("schedule_no_show")
          .select("id", { count: "exact", head: true })
          .eq("status", "open"),
        supabase
          .from("safety_incident")
          .select("id", { count: "exact", head: true })
          .in("status", ["open", "acknowledged"]),
        supabase
          .from("instructor_leave_request")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ]);

      const scheds = (schedRes.data ?? []).filter(
        (s) => !(s as { isTentative?: boolean | null }).isTentative,
      );
      const completed = scheds.filter((s) => s.status === "completed").length;
      const cancelled = scheds.filter((s) => isCancelled(s.status)).length;
      const total = scheds.filter((s) => !isCancelled(s.status)).length;

      const collectionsToday = (paymentsRes.data ?? []).reduce(
        (sum, p) => sum + Number(p.amount ?? 0),
        0,
      );

      let outstandingAmount = 0;
      for (const e of halfPaidRes.data ?? []) {
        // Remaining due = second installment when set, else total minus first.
        const due =
          Number(e.installment2_amount ?? 0) ||
          Number(e.amount ?? 0) - Number(e.installment1_amount ?? 0);
        if (due > 0) outstandingAmount += due;
      }

      const llRows = (llRes.data ?? []) as {
        status: string;
        escalated: boolean;
      }[];
      const phaseCount = new Map<LLPhaseKey, number>();
      let llDone = 0;
      for (const r of llRows) {
        const stage = LL_STAGE_MAP[r.status];
        // Stages with no onward transitions are terminal (delivered / done).
        if (stage && stage.next.length === 0) {
          llDone += 1;
          continue;
        }
        const phase = llStagePhase(r.status);
        phaseCount.set(phase, (phaseCount.get(phase) ?? 0) + 1);
      }

      return {
        activeStudents: activeRes.count ?? 0,
        newLearners7d: learnersRes.count ?? 0,
        classesToday: {
          total,
          completed,
          upcoming: Math.max(0, total - completed),
          cancelled,
        },
        collectionsToday,
        outstanding: {
          count: (halfPaidRes.data ?? []).length,
          amount: outstandingAmount,
        },
        llByPhase: LL_PHASES.map((p) => ({
          key: p.key,
          label: p.label,
          count: phaseCount.get(p.key) ?? 0,
        })),
        llEscalated: llRows.filter((r) => r.escalated).length,
        llTotal: llRows.length - llDone,
        actionNeeded: {
          openTickets: ticketsRes.count ?? 0,
          openNoShows: noShowRes.count ?? 0,
          openSafety: safetyRes.count ?? 0,
          pendingLeave: leaveRes.count ?? 0,
        },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Daily Operations (Today tab)
// ---------------------------------------------------------------------------
export interface DailyOpsRow {
  scheduleId: number;
  startTime: string | null;
  endTime: string | null;
  status: string | null;
  started: boolean;
  learnerId: string | null;
  learnerName: string | null;
  learnerPhone: string | null;
  learnerArea: string | null;
  instructorName: string | null;
  lessonNumber: number | null;
  paymentStatus: string | null;
  llStatus: string | null;
  nextAction: string | null;
}

export function useDailyOps() {
  return useQuery({
    queryKey: ["ops_daily", today()],
    refetchInterval: 60_000,
    queryFn: async (): Promise<DailyOpsRow[]> => {
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          "id, date, start_time, end_time, status, started_at, learner_id, isTentative, Learner(id, name, phone, area), Instructor(name), Lesson(number)",
        )
        .eq("date", today())
        .order("start_time", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []).filter(
        (s) => !(s as { isTentative?: boolean | null }).isTentative,
      );

      const learnerIds = Array.from(
        new Set(rows.map((s) => s.learner_id).filter(Boolean)),
      ) as string[];

      const payByLearner = new Map<string, string | null>();
      const llByLearner = new Map<string, string>();
      if (learnerIds.length) {
        const [enrRes, llRes] = await Promise.all([
          supabase
            .from("enrollment")
            .select("learner_id, payment_status, created_at")
            .in("learner_id", learnerIds)
            .in("status", ["active", "pending"])
            .order("created_at", { ascending: false }),
          sb
            .from("ll_applications")
            .select("learner_id, status")
            .in("learner_id", learnerIds),
        ]);
        // keep the newest enrollment per learner (rows are sorted desc)
        for (const e of enrRes.data ?? [])
          if (!payByLearner.has(e.learner_id))
            payByLearner.set(e.learner_id, e.payment_status);
        for (const a of (llRes.data ?? []) as {
          learner_id: string;
          status: string;
        }[])
          llByLearner.set(a.learner_id, a.status);
      }

      const now = new Date();
      return rows.map((s) => {
        const learner = first<{
          id: string;
          name: string | null;
          phone: string | null;
          area: string | null;
        }>(s.Learner as never);
        const instr = first<{ name: string | null }>(s.Instructor as never);
        const lesson = first<{ number: number | null }>(s.Lesson as never);
        const started = s.started_at != null;
        const paymentStatus = s.learner_id
          ? (payByLearner.get(s.learner_id) ?? null)
          : null;
        const slotStart = s.start_time
          ? new Date(`${s.date}T${s.start_time}`)
          : null;

        let nextAction: string | null = null;
        if (isCancelled(s.status)) nextAction = "Rebook slot";
        else if (
          s.status === "booked" &&
          !started &&
          slotStart &&
          slotStart < now
        )
          nextAction = "Chase attendance — not started";
        else if (paymentStatus === "half_paid")
          nextAction = "Collect balance payment";

        return {
          scheduleId: s.id,
          startTime: s.start_time,
          endTime: s.end_time,
          status: s.status,
          started,
          learnerId: s.learner_id,
          learnerName: learner?.name ?? null,
          learnerPhone: learner?.phone ?? null,
          learnerArea: learner?.area ?? null,
          instructorName: instr?.name ?? null,
          lessonNumber: lesson?.number ?? null,
          paymentStatus,
          llStatus: s.learner_id
            ? (llByLearner.get(s.learner_id) ?? null)
            : null,
          nextAction,
        };
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Exceptions (Exceptions tab)
// ---------------------------------------------------------------------------
export interface MissedClassRow {
  scheduleId: number;
  date: string;
  startTime: string | null;
  learnerName: string | null;
  instructorName: string | null;
}

export interface OverduePaymentRow {
  enrollmentId: string;
  learnerName: string | null;
  learnerPhone: string | null;
  dueAmount: number;
  sinceDate: string;
}

export interface StalledLLRow {
  applicationId: string;
  learnerName: string | null;
  learnerPhone: string | null;
  status: string;
  escalated: boolean;
  daysStuck: number;
}

export interface InactiveStudentRow {
  learnerId: string;
  learnerName: string | null;
  learnerPhone: string | null;
  lastClassDate: string | null;
}

export interface OpsExceptions {
  missedClasses: MissedClassRow[];
  overduePayments: OverduePaymentRow[];
  stalledLL: StalledLLRow[];
  inactiveStudents: InactiveStudentRow[];
}

const STALL_DAYS = 7;
const INACTIVE_DAYS = 7;

export function useOpsExceptions() {
  return useQuery({
    queryKey: ["ops_exceptions"],
    queryFn: async (): Promise<OpsExceptions> => {
      const t = today();
      const [missedRes, halfPaidRes, llRes, activeEnrRes, recentSchedRes] =
        await Promise.all([
          supabase
            .from("Schedule")
            .select("id, date, start_time, Learner(name), Instructor(name)")
            .eq("status", "booked")
            .is("started_at", null)
            .gte("date", daysAgo(7))
            .lt("date", t)
            .order("date", { ascending: false }),
          supabase
            .from("enrollment")
            .select(
              "id, amount, installment1_amount, installment2_amount, created_at, Learner(name, phone)",
            )
            .eq("payment_status", "half_paid"),
          sb
            .from("ll_applications")
            .select("id, status, escalated, updated_at, Learner(name, phone)"),
          supabase
            .from("enrollment")
            .select("learner_id, Learner(name, phone)")
            .eq("status", "active"),
          supabase
            .from("Schedule")
            .select("learner_id, date")
            .gte("date", daysAgo(60)),
        ]);

      const missedClasses: MissedClassRow[] = (missedRes.data ?? []).map(
        (s) => ({
          scheduleId: s.id,
          date: s.date,
          startTime: s.start_time,
          learnerName:
            first<{ name: string | null }>(s.Learner as never)?.name ?? null,
          instructorName:
            first<{ name: string | null }>(s.Instructor as never)?.name ?? null,
        }),
      );

      const overduePayments: OverduePaymentRow[] = (halfPaidRes.data ?? [])
        .map((e) => {
          const learner = first<{ name: string | null; phone: string | null }>(
            e.Learner as never,
          );
          const due =
            Number(e.installment2_amount ?? 0) ||
            Number(e.amount ?? 0) - Number(e.installment1_amount ?? 0);
          return {
            enrollmentId: e.id,
            learnerName: learner?.name ?? null,
            learnerPhone: learner?.phone ?? null,
            dueAmount: due,
            sinceDate: e.created_at,
          };
        })
        .filter((r) => r.dueAmount > 0)
        .sort((a, b) => a.sinceDate.localeCompare(b.sinceDate));

      const now = Date.now();
      const stalledLL: StalledLLRow[] = (
        (llRes.data ?? []) as Array<{
          id: string;
          status: string;
          escalated: boolean;
          updated_at: string;
          Learner: { name: string | null; phone: string | null } | null;
        }>
      )
        .filter((a) => {
          const stage = LL_STAGE_MAP[a.status];
          const terminal = stage ? stage.next.length === 0 : false;
          if (terminal) return false;
          const daysStuck =
            (now - new Date(a.updated_at).getTime()) / 86_400_000;
          return a.escalated || daysStuck >= STALL_DAYS;
        })
        .map((a) => ({
          applicationId: a.id,
          learnerName: a.Learner?.name ?? null,
          learnerPhone: a.Learner?.phone ?? null,
          status: a.status,
          escalated: a.escalated,
          daysStuck: Math.floor(
            (now - new Date(a.updated_at).getTime()) / 86_400_000,
          ),
        }))
        .sort(
          (a, b) =>
            Number(b.escalated) - Number(a.escalated) ||
            b.daysStuck - a.daysStuck,
        );

      // Active students with no lesson in the last INACTIVE_DAYS days.
      const lastClass = new Map<string, string>();
      for (const s of recentSchedRes.data ?? []) {
        if (!s.learner_id || s.date >= t) continue;
        const prev = lastClass.get(s.learner_id);
        if (!prev || s.date > prev) lastClass.set(s.learner_id, s.date);
      }
      const upcoming = new Set(
        (recentSchedRes.data ?? [])
          .filter((s) => s.learner_id && s.date >= t)
          .map((s) => s.learner_id as string),
      );
      const cutoff = daysAgo(INACTIVE_DAYS);
      const seen = new Set<string>();
      const inactiveStudents: InactiveStudentRow[] = [];
      for (const e of activeEnrRes.data ?? []) {
        if (!e.learner_id || seen.has(e.learner_id)) continue;
        seen.add(e.learner_id);
        if (upcoming.has(e.learner_id)) continue;
        const last = lastClass.get(e.learner_id) ?? null;
        if (last && last >= cutoff) continue;
        const learner = first<{ name: string | null; phone: string | null }>(
          e.Learner as never,
        );
        inactiveStudents.push({
          learnerId: e.learner_id,
          learnerName: learner?.name ?? null,
          learnerPhone: learner?.phone ?? null,
          lastClassDate: last,
        });
      }
      inactiveStudents.sort((a, b) =>
        (a.lastClassDate ?? "").localeCompare(b.lastClassDate ?? ""),
      );

      return { missedClasses, overduePayments, stalledLL, inactiveStudents };
    },
  });
}
