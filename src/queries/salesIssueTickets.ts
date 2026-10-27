import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  type DateRange,
  sanitizeSearchTerm,
} from "@/lib/sales-issue-tickets/dateFilters";
import {
  normalizeTicketPhone,
  type TicketStatus,
} from "@/lib/sales-issue-tickets/validation";
import { supabase } from "@/lib/supabaseClient";

export type NotificationStatus = "pending" | "sent" | "failed";

export interface SalesIssueTicket {
  id: string;
  ticket_number: string;
  phone_number: string;
  description: string | null;
  status: TicketStatus;
  raised_by: string | null;
  raised_by_email: string | null;
  raised_by_name: string | null;
  created_at: string;
  updated_at: string;
  notification_status: NotificationStatus;
  notification_error: string | null;
}

export const TICKETS_PAGE_SIZE = 20;

export interface TicketFilters {
  page: number; // 0-based
  status: TicketStatus | "all";
  search: string;
  range: DateRange;
}

// Reads go through sales_issue_tickets_view: Postgres limits rows to ticket
// managers and masks phone_number unless the viewer may see customer phones.; every
// filter is applied in the query, so pagination and counts are always exact.
export function useSalesIssueTickets(filters: TicketFilters, enabled = true) {
  return useQuery({
    queryKey: ["sales-issue-tickets", filters],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("sales_issue_tickets_view" as any)
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.range.from) q = q.gte("created_at", filters.range.from);
      if (filters.range.to) q = q.lt("created_at", filters.range.to);

      const term = sanitizeSearchTerm(filters.search);
      if (term) {
        // A phone typed with +91 / spaces is matched on its bare 10 digits.
        const phone = normalizeTicketPhone(term) ?? term.replace(/\D/g, "");
        const ors = [`ticket_number.ilike.*${term}*`];
        if (phone) ors.push(`phone_number.ilike.*${phone}*`);
        q = q.or(ors.join(","));
      }

      const from = filters.page * TICKETS_PAGE_SIZE;
      const { data, error, count } = await q.range(
        from,
        from + TICKETS_PAGE_SIZE - 1,
      );
      if (error) throw error;
      return {
        rows: (data ?? []) as unknown as SalesIssueTicket[],
        total: count ?? 0,
      };
    },
  });
}

interface FunctionResult {
  ticket: SalesIssueTicket;
  duplicate?: boolean;
  alreadySent?: boolean;
  inProgress?: boolean;
}

// supabase.functions.invoke hides the JSON error body behind a generic
// "non-2xx" message; surface the server's real, user-safe message instead.
async function callTickets(
  body: Record<string, unknown>,
): Promise<FunctionResult> {
  const { data, error } = await supabase.functions.invoke(
    "sales-issue-tickets",
    { body },
  );
  if (error) {
    let message = "Something went wrong. Please try again.";
    try {
      const res = (error as { context?: Response }).context;
      const parsed = res ? await res.json() : null;
      if (parsed?.error) message = String(parsed.error);
    } catch {
      /* keep generic message */
    }
    throw new Error(message);
  }
  return data as FunctionResult;
}

export function useCreateSalesIssueTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      phone: string;
      description: string;
      requestId: string;
    }) => callTickets({ action: "create", ...v }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["sales-issue-tickets"] }),
  });
}

export function useRetryTicketNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: string) =>
      callTickets({ action: "retry", ticketId }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["sales-issue-tickets"] }),
  });
}

export function useUpdateTicketStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ticketId: string; status: TicketStatus }) =>
      callTickets({ action: "status", ...v }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["sales-issue-tickets"] }),
  });
}

export interface TicketStats {
  total: number;
  to_do: number;
  in_progress: number;
  resolved: number;
  raised_today: number;
  email_not_sent: number;
  avg_resolution_hours: number | null;
  oldest_open_hours: number | null;
  granularity: "day" | "month";
  series: { bucket: string; count: number }[];
  top_raisers: { name: string; count: number }[];
}

// Same date range + search as the table, computed in Postgres. The key shares the
// "sales-issue-tickets" prefix, so any status change / new ticket refreshes it; it
// also re-polls every minute so the numbers stay live.
export function useSalesIssueTicketStats(
  filters: Pick<TicketFilters, "range" | "search">,
  enabled = true,
) {
  return useQuery({
    queryKey: ["sales-issue-tickets", "stats", filters],
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    queryFn: async () => {
      const term = sanitizeSearchTerm(filters.search);
      const { data, error } = await supabase.rpc(
        "sales_issue_ticket_stats" as never,
        {
          p_from: filters.range.from,
          p_to: filters.range.to,
          p_search: term || null,
          p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        } as never,
      );
      if (error) throw error;
      return data as unknown as TicketStats;
    },
  });
}
