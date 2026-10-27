import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabaseClient";

import {
  CopyableId,
  displayPaymentId,
  isMissingTraceSchema,
  PaymentTraceRow,
} from "./paymentTrace";

export interface PaymentRow extends PaymentTraceRow {
  payment_type?: string | null;
  enrollment_id?: string | null;
}

export interface LinkRow {
  id: string;
  link_code: string | null;
  enrollment_id: string | null;
  service_label: string | null;
  amount: number | null;
  url: string;
  created_at: string;
  sent_by: string | null;
  channel?: string | null;
}

// Payments are made through payment links only, so a payment row is just the
// gateway's record plus the Payment ID and the service it paid for.
const FULL_COLUMNS =
  "id, reference_id, status, amount, created_at, payment_type, enrollment_id";
const BASIC_COLUMNS = "id, status, amount, created_at, payment_type";

export const paymentsKey = (learnerId: string) =>
  ["learner-payments-trace", learnerId] as const;
export const linksKey = (learnerId: string) =>
  ["learner-payment-links", learnerId] as const;

/** All payments of one customer (reads degrade before the migration). */
export function useLearnerPayments(learnerId: string | undefined) {
  return useQuery<PaymentRow[]>({
    queryKey: paymentsKey(learnerId ?? ""),
    enabled: !!learnerId,
    staleTime: 0,
    queryFn: async () => {
      const run = (cols: string) =>
        supabase
          .from("payment" as never)
          .select(cols)
          .eq("learner_id", learnerId!)
          .order("created_at", { ascending: false }) as unknown as Promise<{
          data: PaymentRow[] | null;
          error: { code?: string; message?: string } | null;
        }>;
      let res = await run(FULL_COLUMNS);
      if (res.error && isMissingTraceSchema(res.error)) {
        res = await run(BASIC_COLUMNS);
      }
      if (res.error) throw res.error;
      return res.data ?? [];
    },
  });
}

/** Payment links logged for one customer, newest first. */
export function useLearnerLinks(learnerId: string | undefined) {
  return useQuery<LinkRow[]>({
    queryKey: linksKey(learnerId ?? ""),
    enabled: !!learnerId,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_link_log" as never)
        .select(
          "id, link_code, enrollment_id, service_label, amount, url, created_at, sent_by, channel",
        )
        .eq("learner_id", learnerId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        if (isMissingTraceSchema(error)) return [];
        throw error;
      }
      return (data ?? []) as unknown as LinkRow[];
    },
  });
}

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(iso))
    : "";

/** One payment: its Payment ID (click to copy), amount, status and date. */
export function PaymentItem({ payment: p }: { payment: PaymentRow }) {
  return (
    <li className="rounded border p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <CopyableId value={displayPaymentId(p)} />
        <span className="font-medium">
          ₹{Number(p.amount ?? 0).toLocaleString("en-IN")}
        </span>
        <span className="rounded bg-muted px-1.5">{p.status}</span>
        <span className="text-muted-foreground">{fmtDate(p.created_at)}</span>
      </div>
      {p.payment_type && (
        <div className="mt-1 text-muted-foreground">{p.payment_type}</div>
      )}
    </li>
  );
}

export { fmtDate };
