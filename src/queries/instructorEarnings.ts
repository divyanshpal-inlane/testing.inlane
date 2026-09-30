import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabaseClient";
import {
  AdjustmentRow,
  computeTotals,
  earliestPeriodStart,
  effectiveRate,
  effectiveTarget,
  getEarningPeriods,
  nextPayoutDate,
  PeriodKey,
  PeriodTotals,
  sumAdjustments,
} from "@/utils/earnings";

// ---------------------------------------------------------------------------
// Row types (hand-rolled — these tables are not in the generated db types,
// matching the KAM / app_settings convention).
// ---------------------------------------------------------------------------

export interface EarningConfig {
  id: number;
  default_per_class_rate: number;
  default_monthly_target: number;
  payout_day: string;
  leaderboard_top_n: number;
  leaderboard_bonus_amount: number;
  tip_copy: string | null;
  availability_message_template: string | null;
  updated_at: string;
}

export interface InstructorEarningSettings {
  instructor_id: string;
  per_class_rate: number | null;
  monthly_class_target: number | null;
  updated_at: string;
}

export type ProgramStatusPill = "active" | "new" | "coming_soon";

export interface EarningProgram {
  id: string;
  key: string;
  title: string;
  description: string | null;
  amount_label: string | null;
  status_pill: ProgramStatusPill;
  cta_label: string | null;
  cta_url: string | null;
  icon_bg: string | null;
  is_active: boolean;
  sort_order: number;
  updated_at: string;
}

export type PayoutStatus = "pending" | "approved" | "paid" | "cancelled";

export interface InstructorPayout {
  id: string;
  instructor_id: string;
  period_start: string;
  period_end: string;
  classes_count: number;
  per_class_rate: number;
  gross_amount: number;
  adjustments_total: number;
  net_amount: number;
  status: PayoutStatus;
  payout_date: string | null;
  created_at: string;
  updated_at: string;
}

export type AdjustmentType = "adjustment" | "bonus" | "referral" | "correction";

export interface EarningAdjustment {
  id: string;
  instructor_id: string;
  payout_id: string | null;
  type: AdjustmentType;
  amount: number;
  reason: string | null;
  effective_date: string;
  created_by: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Shared fetch helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: EarningConfig = {
  id: 1,
  default_per_class_rate: 425,
  default_monthly_target: 30,
  payout_day: "Monday",
  leaderboard_top_n: 10,
  leaderboard_bonus_amount: 1500,
  tip_copy: null,
  availability_message_template: null,
  updated_at: "",
};

async function fetchEarningConfig(): Promise<EarningConfig> {
  const { data, error } = await supabase
    .from("earning_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return DEFAULT_CONFIG;
  return data as unknown as EarningConfig;
}

async function fetchInstructorSettings(
  instructorId: string,
): Promise<InstructorEarningSettings | null> {
  const { data } = await supabase
    .from("instructor_earning_settings")
    .select("*")
    .eq("instructor_id", instructorId)
    .maybeSingle();
  return (data as unknown as InstructorEarningSettings) ?? null;
}

/** Resolve an instructor row from the auth phone, trying the usual variants. */
async function resolveInstructor(
  phone: string,
): Promise<{ id: string; name: string | null } | null> {
  const normalized = phone.replace(/\D/g, "");
  const variants = [
    phone,
    normalized,
    normalized.replace(/^91/, ""),
    `+91${normalized.replace(/^91/, "")}`,
  ];
  const { data, error } = await supabase
    .from("Instructor")
    .select("id_instructor, name")
    .in("phone", variants);
  if (error) throw error;
  const row = data?.[0] as
    { id_instructor: string; name: string | null } | undefined;
  return row ? { id: row.id_instructor, name: row.name } : null;
}

async function fetchCompletedDates(
  instructorId: string,
  start: string,
  end: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("Schedule")
    .select("date, isTentative")
    .eq("instructor_id", instructorId)
    .eq("status", "completed")
    .gte("date", start)
    .lte("date", end);
  if (error) throw error;
  return ((data ?? []) as Array<{ date: string; isTentative: boolean | null }>)
    .filter((s) => !s.isTentative)
    .map((s) => s.date);
}

/**
 * Count of classes *assigned* to the instructor in a date range — i.e. real
 * bookings, whatever their progress: booked + ongoing + completed, excluding
 * tentative / paused / cancelled. Used as the denominator for "done vs assigned".
 */
async function fetchAssignedCount(
  instructorId: string,
  start: string,
  end: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("Schedule")
    .select("isTentative")
    .eq("instructor_id", instructorId)
    .in("status", ["booked", "ongoing", "completed"])
    .gte("date", start)
    .lte("date", end);
  if (error) throw error;
  return ((data ?? []) as Array<{ isTentative: boolean | null }>).filter(
    (s) => !s.isTentative,
  ).length;
}

// ---------------------------------------------------------------------------
// Instructor-facing: computed earnings for the Earnings screens
// ---------------------------------------------------------------------------

export interface InstructorEarningsData {
  instructorId: string;
  instructorName: string | null;
  perClassRate: number;
  monthlyTarget: number;
  periods: Record<PeriodKey, PeriodTotals>;
  pendingPayout: number;
  pendingPayoutStatus: PayoutStatus | "none";
  nextPayoutDate: string;
  payoutDay: string;
  bonusMtd: number;
  referralMtd: number;
  hasLastMonthData: boolean;
  classesThisMonth: number;
  assignedThisMonth: number;
}

export function useInstructorEarnings(phone: string | undefined) {
  return useQuery({
    queryKey: ["instructor-earnings", phone],
    enabled: !!phone,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<InstructorEarningsData | null> => {
      if (!phone) return null;
      const instr = await resolveInstructor(phone);
      if (!instr) throw new Error("Instructor not found");

      const periods = getEarningPeriods();
      const minDate = earliestPeriodStart(periods);
      const maxDate = periods.today.end;

      const [
        completedDates,
        adjustmentsRes,
        config,
        settings,
        payoutsRes,
        assignedThisMonth,
      ] = await Promise.all([
        fetchCompletedDates(instr.id, minDate, maxDate),
        supabase
          .from("instructor_earning_adjustment")
          .select("amount, type, effective_date")
          .eq("instructor_id", instr.id)
          .gte("effective_date", minDate)
          .lte("effective_date", maxDate),
        fetchEarningConfig(),
        fetchInstructorSettings(instr.id),
        supabase
          .from("instructor_payout")
          .select("*")
          .eq("instructor_id", instr.id),
        fetchAssignedCount(
          instr.id,
          periods.thisMonth.start,
          periods.thisMonth.end,
        ),
      ]);

      if (adjustmentsRes.error) throw adjustmentsRes.error;
      if (payoutsRes.error) throw payoutsRes.error;

      const adjustments = (adjustmentsRes.data ?? []) as AdjustmentRow[];
      const rate = effectiveRate(
        settings?.per_class_rate,
        config.default_per_class_rate,
      );
      const target = effectiveTarget(
        settings?.monthly_class_target,
        config.default_monthly_target,
      );

      const keys: PeriodKey[] = [
        "today",
        "thisWeek",
        "lastWeek",
        "thisMonth",
        "lastMonth",
        "payoutPeriod",
      ];
      const totals = {} as Record<PeriodKey, PeriodTotals>;
      for (const k of keys) {
        totals[k] = computeTotals(
          completedDates,
          adjustments,
          periods[k],
          rate,
        );
      }

      // Pending payout = current Sat–Fri earnings, unless a payout row already
      // covers that period (paid → 0; pending/approved → its net amount).
      const payouts = (payoutsRes.data ?? []) as InstructorPayout[];
      const covering = payouts.find(
        (p) => p.period_start === periods.payoutPeriod.start,
      );
      let pendingPayout = totals.payoutPeriod.earnings;
      let pendingPayoutStatus: PayoutStatus | "none" =
        pendingPayout > 0 ? "pending" : "none";
      if (covering) {
        if (covering.status === "paid") {
          pendingPayout = 0;
          pendingPayoutStatus = "paid";
        } else if (covering.status !== "cancelled") {
          pendingPayout = Number(covering.net_amount);
          pendingPayoutStatus = covering.status;
        }
      }

      return {
        instructorId: instr.id,
        instructorName: instr.name,
        perClassRate: rate,
        monthlyTarget: target,
        periods: totals,
        pendingPayout,
        pendingPayoutStatus,
        nextPayoutDate: nextPayoutDate(config.payout_day),
        payoutDay: config.payout_day,
        bonusMtd: sumAdjustments(adjustments, periods.thisMonth, [
          "bonus",
          "referral",
        ]),
        referralMtd: sumAdjustments(adjustments, periods.thisMonth, [
          "referral",
        ]),
        hasLastMonthData: totals.lastMonth.classes > 0,
        classesThisMonth: totals.thisMonth.classes,
        assignedThisMonth,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Instructor's assigned KAM (for Contact KAM + availability message)
// ---------------------------------------------------------------------------

export interface InstructorKAM {
  id: string;
  name: string;
  phone: string | null;
}

export function useInstructorKAM(instructorId: string | undefined) {
  return useQuery({
    queryKey: ["instructor-kam", instructorId],
    enabled: !!instructorId,
    queryFn: async (): Promise<InstructorKAM | null> => {
      if (!instructorId) return null;
      const { data: links, error } = await supabase
        .from("kam_instructor")
        .select("kam_id")
        .eq("instructor_id", instructorId)
        .limit(1);
      if (error) throw error;
      const kamId = links?.[0]?.kam_id;
      if (!kamId) return null;
      const { data: kam, error: kamErr } = await supabase
        .from("KAM")
        .select("id, name, phone")
        .eq("id", kamId)
        .maybeSingle();
      if (kamErr) throw kamErr;
      return (kam as InstructorKAM) ?? null;
    },
  });
}

// ---------------------------------------------------------------------------
// Leaderboard rank (this month, by completed classes)
// ---------------------------------------------------------------------------

export interface InstructorRank {
  rank: number;
  total: number;
  topN: number;
  percentile: number;
  bonusAmount: number;
}

export function useInstructorRank(instructorId: string | undefined) {
  return useQuery({
    queryKey: ["instructor-rank", instructorId],
    enabled: !!instructorId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<InstructorRank | null> => {
      if (!instructorId) return null;
      const periods = getEarningPeriods();
      const config = await fetchEarningConfig();
      const { data, error } = await supabase
        .from("Schedule")
        .select("instructor_id, isTentative")
        .eq("status", "completed")
        .gte("date", periods.thisMonth.start)
        .lte("date", periods.thisMonth.end);
      if (error) throw error;

      const counts = new Map<string, number>();
      for (const r of (data ?? []) as Array<{
        instructor_id: string | null;
        isTentative: boolean | null;
      }>) {
        if (!r.instructor_id || r.isTentative) continue;
        counts.set(r.instructor_id, (counts.get(r.instructor_id) ?? 0) + 1);
      }
      if (!counts.has(instructorId)) counts.set(instructorId, 0);

      const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
      const total = sorted.length;
      const rank = sorted.findIndex(([id]) => id === instructorId) + 1;
      return {
        rank,
        total,
        topN: config.leaderboard_top_n,
        percentile: total > 0 ? rank / total : 1,
        bonusAmount: Number(config.leaderboard_bonus_amount),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Earning programs (Screen 2 cards + admin editor)
// ---------------------------------------------------------------------------

export function useEarningPrograms(opts?: { includeInactive?: boolean }) {
  const includeInactive = opts?.includeInactive ?? false;
  return useQuery({
    queryKey: ["earning-programs", includeInactive],
    staleTime: 60_000,
    queryFn: async (): Promise<EarningProgram[]> => {
      let query = supabase
        .from("earning_program")
        .select("*")
        .order("sort_order", { ascending: true });
      if (!includeInactive) query = query.eq("is_active", true);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as EarningProgram[];
    },
  });
}

export function useUpsertEarningProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      program: Partial<EarningProgram> & { id: string },
    ): Promise<EarningProgram> => {
      const { id, ...patch } = program;
      const { data, error } = await supabase
        .from("earning_program")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as EarningProgram;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["earning-programs"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Global config (admin Config tab)
// ---------------------------------------------------------------------------

export function useEarningConfig() {
  return useQuery({
    queryKey: ["earning-config"],
    staleTime: 60_000,
    queryFn: fetchEarningConfig,
  });
}

export function useUpdateEarningConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      patch: Partial<Omit<EarningConfig, "id" | "updated_at">>,
    ): Promise<EarningConfig> => {
      const { data, error } = await supabase
        .from("earning_config")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", 1)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as EarningConfig;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["earning-config"] });
      queryClient.invalidateQueries({ queryKey: ["instructor-earnings"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Per-instructor settings (rate / target overrides)
// ---------------------------------------------------------------------------

export function useInstructorEarningSettings(instructorId: string | undefined) {
  return useQuery({
    queryKey: ["instructor-earning-settings", instructorId],
    enabled: !!instructorId,
    queryFn: async () =>
      instructorId ? fetchInstructorSettings(instructorId) : null,
  });
}

export function useUpsertInstructorEarningSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      instructorId: string;
      perClassRate: number | null;
      monthlyClassTarget: number | null;
    }): Promise<InstructorEarningSettings> => {
      const { data, error } = await supabase
        .from("instructor_earning_settings")
        .upsert(
          {
            instructor_id: input.instructorId,
            per_class_rate: input.perClassRate,
            monthly_class_target: input.monthlyClassTarget,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "instructor_id" },
        )
        .select()
        .single();
      if (error) throw error;
      return data as unknown as InstructorEarningSettings;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["instructor-earning-settings", vars.instructorId],
      });
      queryClient.invalidateQueries({ queryKey: ["admin-earnings-overview"] });
      queryClient.invalidateQueries({ queryKey: ["instructor-earnings"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Manual adjustments (the "change anything" + discrepancy layer)
// ---------------------------------------------------------------------------

export function useEarningAdjustments(instructorId: string | undefined) {
  return useQuery({
    queryKey: ["earning-adjustments", instructorId],
    enabled: !!instructorId,
    queryFn: async (): Promise<EarningAdjustment[]> => {
      if (!instructorId) return [];
      const { data, error } = await supabase
        .from("instructor_earning_adjustment")
        .select("*")
        .eq("instructor_id", instructorId)
        .order("effective_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as EarningAdjustment[];
    },
  });
}

export function useCreateAdjustment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      instructorId: string;
      type: AdjustmentType;
      amount: number;
      reason?: string | null;
      effectiveDate: string;
      createdBy?: string | null;
    }): Promise<EarningAdjustment> => {
      const { data, error } = await supabase
        .from("instructor_earning_adjustment")
        .insert({
          instructor_id: input.instructorId,
          type: input.type,
          amount: input.amount,
          reason: input.reason ?? null,
          effective_date: input.effectiveDate,
          created_by: input.createdBy ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as EarningAdjustment;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["earning-adjustments", vars.instructorId],
      });
      queryClient.invalidateQueries({ queryKey: ["admin-earnings-overview"] });
      queryClient.invalidateQueries({ queryKey: ["instructor-earnings"] });
    },
  });
}

export function useDeleteAdjustment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; instructorId: string }) => {
      const { error } = await supabase
        .from("instructor_earning_adjustment")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["earning-adjustments", vars.instructorId],
      });
      queryClient.invalidateQueries({ queryKey: ["admin-earnings-overview"] });
      queryClient.invalidateQueries({ queryKey: ["instructor-earnings"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Payout runs
// ---------------------------------------------------------------------------

export function useInstructorPayouts(instructorId: string | undefined) {
  return useQuery({
    queryKey: ["instructor-payouts", instructorId],
    enabled: !!instructorId,
    queryFn: async (): Promise<InstructorPayout[]> => {
      if (!instructorId) return [];
      const { data, error } = await supabase
        .from("instructor_payout")
        .select("*")
        .eq("instructor_id", instructorId)
        .order("period_start", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as InstructorPayout[];
    },
  });
}

/** Generate (or refresh) a payout run for an instructor + Sat–Fri period. */
export function useGeneratePayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      instructorId: string;
      periodStart: string;
      periodEnd: string;
    }): Promise<InstructorPayout> => {
      const config = await fetchEarningConfig();
      const settings = await fetchInstructorSettings(input.instructorId);
      const rate = effectiveRate(
        settings?.per_class_rate,
        config.default_per_class_rate,
      );

      const [completedDates, adjRes] = await Promise.all([
        fetchCompletedDates(
          input.instructorId,
          input.periodStart,
          input.periodEnd,
        ),
        supabase
          .from("instructor_earning_adjustment")
          .select("amount, type, effective_date")
          .eq("instructor_id", input.instructorId)
          .gte("effective_date", input.periodStart)
          .lte("effective_date", input.periodEnd),
      ]);
      if (adjRes.error) throw adjRes.error;

      const classes = completedDates.length;
      const adjustmentsTotal = ((adjRes.data ?? []) as AdjustmentRow[]).reduce(
        (sum, a) => sum + Number(a.amount || 0),
        0,
      );
      const gross = classes * rate;

      const { data, error } = await supabase
        .from("instructor_payout")
        .upsert(
          {
            instructor_id: input.instructorId,
            period_start: input.periodStart,
            period_end: input.periodEnd,
            classes_count: classes,
            per_class_rate: rate,
            gross_amount: gross,
            adjustments_total: adjustmentsTotal,
            net_amount: gross + adjustmentsTotal,
            status: "pending",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "instructor_id,period_start,period_end" },
        )
        .select()
        .single();
      if (error) throw error;
      return data as unknown as InstructorPayout;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["instructor-payouts", vars.instructorId],
      });
      queryClient.invalidateQueries({ queryKey: ["admin-earnings-overview"] });
      queryClient.invalidateQueries({ queryKey: ["instructor-earnings"] });
    },
  });
}

export function useUpdatePayoutStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      instructorId: string;
      status: PayoutStatus;
      payoutDate?: string | null;
    }): Promise<InstructorPayout> => {
      const patch: Record<string, unknown> = {
        status: input.status,
        updated_at: new Date().toISOString(),
      };
      if (input.status === "paid") {
        patch.payout_date =
          input.payoutDate ?? new Date().toISOString().split("T")[0];
      }
      const { data, error } = await supabase
        .from("instructor_payout")
        .update(patch)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as InstructorPayout;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["instructor-payouts", vars.instructorId],
      });
      queryClient.invalidateQueries({ queryKey: ["admin-earnings-overview"] });
      queryClient.invalidateQueries({ queryKey: ["instructor-earnings"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Admin overview: one page with computed month earnings + pending + KAM
// ---------------------------------------------------------------------------

export interface AdminEarningsRow {
  instructorId: string;
  name: string | null;
  phone: string | null;
  kamName: string | null;
  kamPhone: string | null;
  classesThisMonth: number;
  earningsThisMonth: number;
  pendingPayout: number;
  perClassRate: number;
}

export const ADMIN_EARNINGS_PAGE_SIZE = 15;

export interface AdminEarningsPage {
  rows: AdminEarningsRow[];
  totalCount: number;
}

export function useAdminEarningsOverview(page: number, search: string) {
  const searchTerm = search.trim().toLowerCase();
  return useQuery({
    queryKey: ["admin-earnings-overview", page, searchTerm],
    queryFn: () => fetchAdminEarningsPage(page, searchTerm),
  });
}

/** Also used by the on-demand CSV export; every request is limited to 15. */
export async function fetchAdminEarningsPage(
  page: number,
  search: string,
): Promise<AdminEarningsPage> {
  const buildInstructorQuery = (head = false) =>
    supabase.rpc(
      "get_earnings_instructors",
      { p_search: search.trim().toLowerCase() },
      { count: "exact", head },
    );
  const from = (page - 1) * ADMIN_EARNINGS_PAGE_SIZE;
  const instrRes = await buildInstructorQuery()
    .order("name", { ascending: true })
    .order("id_instructor", { ascending: true })
    .range(from, from + ADMIN_EARNINGS_PAGE_SIZE - 1);

  if (instrRes.error) {
    // The last page can disappear if instructors are deleted. Let the UI
    // clamp to the new last page without fetching any extra instructors.
    if (instrRes.error.code === "PGRST103") {
      const { count, error } = await buildInstructorQuery(true);
      if (error) throw error;
      return { rows: [], totalCount: count ?? 0 };
    }
    throw instrRes.error;
  }
  const instructors = instrRes.data ?? [];
  const totalCount = instrRes.count ?? 0;
  if (instructors.length === 0) return { rows: [], totalCount };
  const instructorIds = instructors.map((i) => i.id_instructor);
  const periods = getEarningPeriods();
  const [schedRes, adjRes, settingsRes, kamLinksRes, config] =
    await Promise.all([
      supabase
        .from("Schedule")
        .select("instructor_id, date, isTentative")
        .in("instructor_id", instructorIds)
        .eq("status", "completed")
        .gte("date", periods.thisMonth.start)
        .lte("date", periods.payoutPeriod.end),
      supabase
        .from("instructor_earning_adjustment")
        .select("instructor_id, amount, type, effective_date")
        .in("instructor_id", instructorIds)
        .gte("effective_date", periods.thisMonth.start)
        .lte("effective_date", periods.payoutPeriod.end),
      supabase
        .from("instructor_earning_settings")
        .select("*")
        .in("instructor_id", instructorIds),
      supabase
        .from("kam_instructor")
        .select("instructor_id, kam_id")
        .in("instructor_id", instructorIds),
      fetchEarningConfig(),
    ]);

  if (schedRes.error) throw schedRes.error;
  if (adjRes.error) throw adjRes.error;

  const kamIds = Array.from(
    new Set((kamLinksRes.data ?? []).map((k) => k.kam_id)),
  );
  const kamListRes =
    kamIds.length > 0
      ? await supabase.from("KAM").select("id, name, phone").in("id", kamIds)
      : { data: [] };

  const datesByInstr = new Map<string, string[]>();
  for (const s of (schedRes.data ?? []) as Array<{
    instructor_id: string | null;
    date: string;
    isTentative: boolean | null;
  }>) {
    if (!s.instructor_id || s.isTentative) continue;
    const arr = datesByInstr.get(s.instructor_id) ?? [];
    arr.push(s.date);
    datesByInstr.set(s.instructor_id, arr);
  }

  const adjByInstr = new Map<string, AdjustmentRow[]>();
  for (const a of (adjRes.data ?? []) as Array<
    AdjustmentRow & { instructor_id: string }
  >) {
    const arr = adjByInstr.get(a.instructor_id) ?? [];
    arr.push({
      amount: a.amount,
      type: a.type,
      effective_date: a.effective_date,
    });
    adjByInstr.set(a.instructor_id, arr);
  }

  const settingsByInstr = new Map<string, InstructorEarningSettings>();
  for (const st of (settingsRes.data ??
    []) as unknown as InstructorEarningSettings[]) {
    settingsByInstr.set(st.instructor_id, st);
  }

  const kamById = new Map<string, { name: string; phone: string | null }>();
  for (const k of (kamListRes.data ?? []) as Array<{
    id: string;
    name: string;
    phone: string | null;
  }>) {
    kamById.set(k.id, { name: k.name, phone: k.phone });
  }

  const kamByInstr = new Map<string, { name: string; phone: string | null }>();
  for (const row of (kamLinksRes.data ?? []) as Array<{
    instructor_id: string;
    kam_id: string;
  }>) {
    const kam = kamById.get(row.kam_id);
    if (kam && !kamByInstr.has(row.instructor_id)) {
      kamByInstr.set(row.instructor_id, kam);
    }
  }

  const rows = instructors.map((i) => {
    const dates = datesByInstr.get(i.id_instructor) ?? [];
    const adjustments = adjByInstr.get(i.id_instructor) ?? [];
    const settings = settingsByInstr.get(i.id_instructor);
    const rate = effectiveRate(
      settings?.per_class_rate,
      config.default_per_class_rate,
    );
    const month = computeTotals(dates, adjustments, periods.thisMonth, rate);
    const pending = computeTotals(
      dates,
      adjustments,
      periods.payoutPeriod,
      rate,
    );
    const kam = kamByInstr.get(i.id_instructor);
    return {
      instructorId: i.id_instructor,
      name: i.name,
      phone: i.phone,
      kamName: kam?.name ?? null,
      kamPhone: kam?.phone ?? null,
      classesThisMonth: month.classes,
      earningsThisMonth: month.earnings,
      pendingPayout: pending.earnings,
      perClassRate: rate,
    };
  });
  return { rows, totalCount };
}
