import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { supabase } from "@/lib/supabaseClient";

// Payment traceability helpers (see supabase/migrations/
// 20261022_100000_payment_traceability.sql). Shared by the "Services & payments"
// hub, the learner History and the Learner Management payment list. Customers
// pay only through payment links; nobody records a payment by hand.

/** Message shown when the traceability migration has not been applied yet. */
export const MISSING_TRACE_MIGRATION_MESSAGE =
  "Payment traceability is not set up in the database yet. Ask the tech team to apply 20261022_100000_payment_traceability.sql.";

type PgError = { code?: string; message?: string } | null | undefined;

/** True for a PostgREST / Postgres "column or table does not exist" error. */
export function isMissingTraceSchema(err: unknown): boolean {
  const e = err as PgError;
  if (!e) return false;
  const msg = e.message ?? "";
  return (
    e.code === "PGRST204" || // column not in schema cache
    e.code === "PGRST205" || // table not in schema cache
    e.code === "42703" || // undefined_column
    e.code === "42P01" || // undefined_table
    (/payment_link_log|reference_id|enrollment_id/i.test(msg) &&
      /column|relation|schema cache|does not exist/i.test(msg))
  );
}

/**
 * Canonical form of a typed Payment ID / reference: spaces and dashes removed,
 * upper-case. Used by the "find a payment" lookup.
 */
export function normalizeReference(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

// --- Who is acting --------------------------------------------------------------

let actorPromise: Promise<string | null> | null = null;

/**
 * Name of the signed-in team member, for the "sent by" field on a payment link.
 * Staff sign in with a phone number, so the auth user has no e-mail; the name
 * comes from the same `get-current-user` call the rest of the app uses.
 * Memoised for the session (only a successful lookup is kept, so a failure is
 * retried next time).
 */
export function currentActorName(): Promise<string | null> {
  if (!actorPromise) {
    actorPromise = (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return null;
        if (user.phone) {
          const { data } = await supabase.functions.invoke("get-current-user", {
            body: { phone: user.phone },
          });
          const name = data?.user?.name as string | undefined;
          if (name?.trim()) return name.trim();
        }
        return user.email ?? user.phone ?? null;
      } catch {
        return null;
      }
    })().then((name) => {
      if (!name) actorPromise = null;
      return name;
    });
  }
  return actorPromise;
}

// --- Payment links ---------------------------------------------------------------

export interface PaymentLinkLogInput {
  learnerId: string;
  enrollmentId: string | null;
  serviceType: "course" | "topup" | "other";
  serviceLabel: string;
  amount: number;
  url: string;
  /** "send" = e-mailed/WhatsApped, "copy" = copied by hand. */
  channel?: "send" | "copy";
}

/**
 * Records a payment link. Never throws: sending the link matters more than the
 * log row, but a failure is reported in the console so a missing migration is
 * visible.
 */
export async function logPaymentLink(
  input: PaymentLinkLogInput,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("payment_link_log" as never)
      .insert({
        learner_id: input.learnerId,
        enrollment_id: input.enrollmentId,
        service_type: input.serviceType,
        service_label: input.serviceLabel,
        amount: input.amount,
        url: input.url,
        sent_by: await currentActorName(),
        channel: input.channel ?? "send",
      } as never)
      .select("link_code")
      .single();
    if (error) throw error;
    return (data as unknown as { link_code?: string })?.link_code ?? null;
  } catch (err) {
    console.warn("payment_link_log insert failed", err);
    return null;
  }
}

// --- Display helpers ----------------------------------------------------------------

/** The fields a payment row exposes for tracing (all optional: pre-migration). */
export interface PaymentTraceRow {
  id: string;
  reference_id?: string | null;
  status?: string | null;
  amount?: number | null;
  created_at?: string | null;
}

/** Payment ID to show: the stored one, else the same value derived from the id. */
export function displayPaymentId(row: {
  id: string;
  reference_id?: string | null;
}): string {
  return (
    row.reference_id ??
    `PAY-${row.id.replace(/-/g, "").slice(0, 12).toUpperCase()}`
  );
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return "just now";
  const mins = secs / 60;
  if (mins < 90) return `${Math.round(mins)} min ago`;
  const hours = mins / 60;
  if (hours < 36) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API blocked (plain http): fall back to a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

/** Small "copy to clipboard" chip for IDs the sales team has to paste. */
export function CopyableId({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await copyText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      title="Click to copy"
      className="inline-flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-muted/70"
    >
      {label ? (
        <span className="font-sans text-muted-foreground">{label}</span>
      ) : null}
      {value}
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
