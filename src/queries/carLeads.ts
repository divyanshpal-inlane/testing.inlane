import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/lib/supabaseClient";

// The onboarding motivation string that flags car-buying intent
// (src/routes/onboard/aadhar.tsx → CAR_OPTION).
export const CAR_MOTIVATION = "Finally buy my own car";

export interface CarLead {
  id: string;
  name: string | null;
  phone: string | null;
  area: string | null;
  pickupLocation: string | null;
  drivingMotivation: string | null;
  carPurchaseTimeline: string | null; // onboarding "when will you buy"
  carIntentPlanning: string | null; // instructor "planning to buy?"
  carIntentType: string | null;
  carIntentCondition: string | null;
  carIntentTimeframe: string | null;
  carIntentUpdatedAt: string | null;
  carOnboardingIntentAt: string | null;
  // Course-timeline dates, computed chronologically from the learner's
  // Schedule rows (see attachClassDates). null when the learner has no classes.
  firstClassDate: string | null; // 1st class
  midClassDate: string | null; // 50% completion point (rounds up for odd totals)
  lastClassDate: string | null; // 10th / last class
}

export const CAR_LEADS_PAGE_SIZE = 10;

export type CarLeadPlanningFilter = "all" | "yes" | "onboarding";

interface CarLeadsOptions {
  page: number;
  search: string;
  area: string;
  planning: CarLeadPlanningFilter;
}

// Schedule rows in these states are not counted as real classes.
const DEAD_SCHEDULE_STATUSES = new Set([
  "cancelled",
  "rejected",
  "paused",
  "pending_payment",
]);

// The 50% class. Rounds UP when the total is odd: 7 classes -> 3.5 -> 4th class.
function midClassIndex(total: number): number {
  return Math.ceil(total / 2) - 1;
}

// Mutates each lead, attaching firstClassDate / midClassDate / lastClassDate
// from its Schedule rows (chronological order, dead statuses excluded).
async function attachClassDates(leads: CarLead[]): Promise<void> {
  const ids = leads.map((l) => l.id);
  if (ids.length === 0) return;

  const datesByLearner = new Map<string, string[]>();
  // Chunk the .in() filter to stay well under PostgREST URL limits.
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const { data, error } = await supabase
      .from("Schedule")
      .select("learner_id, date, start_time, status")
      .in("learner_id", chunk)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });
    if (error) throw error;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const status = String(row.status ?? "").toLowerCase();
      if (DEAD_SCHEDULE_STATUSES.has(status)) continue;
      const date = row.date as string | null;
      if (!date) continue;
      const lid = String(row.learner_id);
      const arr = datesByLearner.get(lid) ?? [];
      arr.push(date); // already in (date, start_time) order from the query
      datesByLearner.set(lid, arr);
    }
  }

  for (const lead of leads) {
    const dates = datesByLearner.get(lead.id) ?? [];
    const total = dates.length;
    if (total === 0) continue;
    lead.firstClassDate = dates[0];
    lead.midClassDate = dates[midClassIndex(total)];
    lead.lastClassDate = dates[total - 1];
  }
}

// The RPC filters leads in SQL; PostgREST counts the filtered set and returns
// only the requested ten rows. Schedule enrichment is limited to that page.
export async function fetchCarLeadsPage(
  { page, search, area, planning }: CarLeadsOptions,
  signal?: AbortSignal,
): Promise<{ leads: CarLead[]; totalCount: number }> {
  const buildQuery = (head = false) => {
    const query = supabase
      .rpc(
        "get_car_leads",
        {
          search_term: search.trim(),
          area_filter: area,
          planning_filter: planning,
        },
        { count: "exact", head },
      )
      .select(
        "id, name, phone, area, pick_up_location, driving_motivation, car_purchase_timeline, car_intent_planning, car_intent_type, car_intent_condition, car_intent_timeframe, car_intent_updated_at, car_onboarding_intent_at",
      );
    return signal ? query.abortSignal(signal) : query;
  };
  const from = (page - 1) * CAR_LEADS_PAGE_SIZE;
  const { data, error, count } = await buildQuery()
    .order("id", { ascending: false })
    .range(from, from + CAR_LEADS_PAGE_SIZE - 1);

  // A refresh can shrink the result set below the current offset.
  if (error?.code === "PGRST103" && from > 0) {
    const { count: remainingCount, error: countError } = await buildQuery(true);
    if (countError) throw countError;
    return { leads: [], totalCount: remainingCount ?? 0 };
  }
  if (error) throw error;
  const leads = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: (r.name as string) ?? null,
    phone: (r.phone as string) ?? null,
    area: (r.area as string) ?? null,
    pickupLocation: (r.pick_up_location as string) ?? null,
    drivingMotivation: (r.driving_motivation as string) ?? null,
    carPurchaseTimeline: (r.car_purchase_timeline as string) ?? null,
    carIntentPlanning: (r.car_intent_planning as string) ?? null,
    carIntentType: (r.car_intent_type as string) ?? null,
    carIntentCondition: (r.car_intent_condition as string) ?? null,
    carIntentTimeframe: (r.car_intent_timeframe as string) ?? null,
    carIntentUpdatedAt: (r.car_intent_updated_at as string) ?? null,
    carOnboardingIntentAt: (r.car_onboarding_intent_at as string) ?? null,
    firstClassDate: null,
    midClassDate: null,
    lastClassDate: null,
  }));

  await attachClassDates(leads);
  return { leads, totalCount: count ?? 0 };
}

export function useCarLeads(options: CarLeadsOptions) {
  return useQuery({
    queryKey: ["car_leads", options],
    queryFn: ({ signal }) => fetchCarLeadsPage(options, signal),
    placeholderData: keepPreviousData,
  });
}

export function useCarLeadAreas() {
  return useQuery({
    queryKey: ["car_lead_areas"],
    queryFn: async ({ signal }): Promise<string[]> => {
      const { data, error } = await supabase
        .rpc("get_car_lead_areas")
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []).map((r) => r.area).sort();
    },
  });
}

export function carLeadsToCSV(rows: CarLead[]): string {
  const headers = [
    "Name",
    "Phone",
    "Area",
    "Pickup Location",
    "Motivation",
    "Purchase Timeline (onboarding)",
    "Planning to Buy",
    "Car Type",
    "Condition",
    "Buy Timeframe",
    "Intent Updated",
    "Onboarding Intent At",
    "1st Class Date",
    "50% Class Date",
    "Last Class Date",
  ];
  const escape = (val: string | null | undefined) => {
    if (val == null) return "";
    const s = String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.phone,
        r.area,
        r.pickupLocation,
        r.drivingMotivation,
        r.carPurchaseTimeline,
        r.carIntentPlanning,
        r.carIntentType,
        r.carIntentCondition,
        r.carIntentTimeframe,
        r.carIntentUpdatedAt
          ? format(new Date(r.carIntentUpdatedAt), "yyyy-MM-dd HH:mm")
          : "",
        r.carOnboardingIntentAt
          ? format(new Date(r.carOnboardingIntentAt), "yyyy-MM-dd HH:mm")
          : "",
        r.firstClassDate ?? "",
        r.midClassDate ?? "",
        r.lastClassDate ?? "",
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}
