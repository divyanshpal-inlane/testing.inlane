import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/lib/supabaseClient";

export type LessonStatus =
  | "active"
  | "completed"
  | "paused"
  | "pending_payment"
  | "cancelled"
  | string;

export type EnrollmentType = "course" | "demo" | "topup" | null;

export interface LessonRow {
  scheduleId: number;
  date: string; // yyyy-MM-dd
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  customerName: string | null;
  customerPhone: string | null;
  classNumber: number | null;
  enrollmentType: EnrollmentType;
  instructorId: string | null;
  instructorName: string | null;
  instructorPhone: string | null;
  vehicle: string | null; // car_make + car_mode
  kamId: string | null;
  kamName: string | null;
  status: LessonStatus | null;
  isTentative: boolean | null;
  pickupLocation: string | null;
}

export interface LessonsDashboardFilters {
  from: string; // yyyy-MM-dd
  to: string; // yyyy-MM-dd inclusive
  kamIds?: string[]; // empty/undefined = all
  instructorIds?: string[]; // empty/undefined = all
  classNumbers?: number[]; // empty/undefined = all
  statuses?: string[]; // empty/undefined = all (but defaults applied at call site)
  search?: string; // free-text on customer name/phone
}

export const LESSONS_PAGE_SIZE = 10;

export interface LessonsDashboardPage {
  rows: LessonRow[];
  totalCount: number;
}

export async function fetchLessonsDashboardPage(
  filters: LessonsDashboardFilters,
  page = 1,
  signal?: AbortSignal,
): Promise<LessonsDashboardPage> {
  // An empty status selection intentionally matches nothing.
  if (filters.statuses?.length === 0) return { rows: [], totalCount: 0 };

  const query = supabase.rpc("get_lessons_dashboard_page", {
    p_from: filters.from,
    p_to: filters.to,
    p_page: page,
    p_kam_ids: filters.kamIds?.length ? filters.kamIds : null,
    p_instructor_ids: filters.instructorIds?.length
      ? filters.instructorIds
      : null,
    p_class_numbers: filters.classNumbers?.length ? filters.classNumbers : null,
    p_statuses: filters.statuses ?? null,
    p_search: filters.search?.trim() || null,
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return data as unknown as LessonsDashboardPage;
}

export function useLessonsDashboard(filters: LessonsDashboardFilters) {
  return useInfiniteQuery({
    queryKey: ["lessons-dashboard", filters],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      fetchLessonsDashboardPage(filters, pageParam, signal),
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce(
        (count, page) => count + page.rows.length,
        0,
      );
      return lastPage.rows.length > 0 && loadedCount < lastPage.totalCount
        ? allPages.length + 1
        : undefined;
    },
    // Retrying cannot resolve an RPC that has not been installed in Supabase.
    retry: (failureCount, error) =>
      failureCount < 3 && !("code" in error && error.code === "PGRST202"),
  });
}

// Export remains all matching lessons, but is fetched only on explicit export.
export async function fetchLessonsDashboardExport(
  filters: LessonsDashboardFilters,
): Promise<LessonRow[]> {
  const firstPage = await fetchLessonsDashboardPage(filters);
  const rows = [...firstPage.rows];
  const totalPages = Math.ceil(firstPage.totalCount / LESSONS_PAGE_SIZE);
  for (let page = 2; page <= totalPages; page++) {
    const nextPage = await fetchLessonsDashboardPage(filters, page);
    rows.push(...nextPage.rows);
  }
  return rows;
}

export function lessonsToCSV(rows: LessonRow[]): string {
  const headers = [
    "Date",
    "Start",
    "End",
    "Customer",
    "Customer Phone",
    "Class #",
    "Type",
    "Instructor",
    "Instructor Phone",
    "Vehicle",
    "KAM",
    "Status",
    "Pickup Location",
  ];
  const escape = (val: string | number | null | undefined) => {
    if (val == null) return "";
    const s = String(val);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.startTime,
        r.endTime,
        r.customerName,
        r.customerPhone,
        r.classNumber,
        r.enrollmentType,
        r.instructorName,
        r.instructorPhone,
        r.vehicle,
        r.kamName,
        r.status,
        r.pickupLocation,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function defaultExportFilename(from: string, to: string): string {
  const safeFrom = from.replace(/\D/g, "");
  const safeTo = to.replace(/\D/g, "");
  return `lessons_${safeFrom}_${safeTo}.csv`;
}

// Helper for the page's KAM filter dropdown — reuses the existing KAM table.
export function useAllKAMsForFilter() {
  return useQuery({
    queryKey: ["kams", "filter-picker"],
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase
        .from("KAM")
        .select("id, name")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    staleTime: 60_000,
  });
}

// Date preset helpers used by the page.
export function todayYmd(): string {
  return format(new Date(), "yyyy-MM-dd");
}
export function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return format(d, "yyyy-MM-dd");
}
export function plusDaysYmd(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return format(d, "yyyy-MM-dd");
}
