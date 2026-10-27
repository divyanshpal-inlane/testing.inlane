import { Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { classifyLookup } from "@/lib/learnerSearch";
import { normalizePhone } from "@/lib/sales-dashboard/validation";
import { supabase } from "@/lib/supabaseClient";

import { AdditionalServiceDialog } from "./AdditionalServiceDialog";
import type { ServiceLearner } from "./additionalServices";
import {
  type FoundLearner,
  LearnerResultList,
  useLearnerSearch,
} from "./LearnerNameSearch";
import { isMissingTraceSchema, normalizeReference } from "./paymentTrace";

type Found = { learner: ServiceLearner; how: string; tab: "sell" | "services" };

const LEARNER_COLS = "id, name, phone, email";

async function learnerById(id: string): Promise<ServiceLearner | null> {
  const { data } = await supabase
    .from("Learner")
    .select(LEARNER_COLS)
    .eq("id", id)
    .maybeSingle();
  return (data as ServiceLearner | null) ?? null;
}

/**
 * Find a customer by name or e-mail (or a payment by its Payment ID / Link ID),
 * then sell them another service or inspect their
 * payments. Works for fully paid customers, which the Incomplete Payments list
 * never shows.
 */
export function ExistingCustomerCard() {
  const [query, setQuery] = useState("");
  const [looking, setLooking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [open, setOpen] = useState(false);

  // Names and e-mails are searched as you type (the team does not know phone
  // numbers); the other kinds of lookup run on Find.
  const nameMode = classifyLookup(query) === "name";
  const nameSearch = useLearnerSearch(query, nameMode);
  const openLearner = (l: FoundLearner) => {
    setFound({
      learner: { id: l.id, name: l.name, phone: l.phone, email: l.email },
      how: "Name",
      tab: "sell",
    });
    setMessage(null);
    setOpen(true);
  };

  const find = async () => {
    const raw = query.trim();
    if (!raw) return;
    const kind = classifyLookup(raw);
    setLooking(true);
    setMessage(null);
    try {
      const upper = normalizeReference(raw);
      let result: Found | null = null;

      if (/^PAY-/i.test(raw)) {
        const id = upper.replace(/^PAY-?/, "");
        const { data, error } = await supabase
          .from("payment" as never)
          .select("learner_id")
          .eq("reference_id", `PAY-${id}`)
          .maybeSingle();
        if (error && isMissingTraceSchema(error)) {
          setMessage(
            "Payment IDs are not set up in the database yet. Search by phone for now.",
          );
          return;
        }
        const learnerId = (data as { learner_id?: string } | null)?.learner_id;
        const learner = learnerId ? await learnerById(learnerId) : null;
        if (learner)
          result = { learner, how: `Payment ${upper}`, tab: "services" };
      } else if (/^LNK-/i.test(raw)) {
        const code = `LNK-${upper.replace(/^LNK-?/, "")}`;
        const { data, error } = await supabase
          .from("payment_link_log" as never)
          .select("learner_id")
          .eq("link_code", code)
          .maybeSingle();
        if (error && isMissingTraceSchema(error)) {
          setMessage("Link IDs are not set up in the database yet.");
          return;
        }
        const learnerId = (data as { learner_id?: string } | null)?.learner_id;
        const learner = learnerId ? await learnerById(learnerId) : null;
        if (learner) result = { learner, how: `Link ${code}`, tab: "services" };
      } else if (kind === "name") {
        // A name is searched live below the box; the team picks from the list.
        setMessage("Pick the learner from the list below.");
        return;
      } else {
        const p10 = kind === "phone" ? normalizePhone(raw) : null;
        if (p10) {
          const { data, error } = await supabase
            .from("Learner")
            .select(LEARNER_COLS)
            .in("phone", [p10, `91${p10}`, `+91${p10}`])
            .order("created_at", { ascending: false })
            .limit(1);
          if (error) throw error;
          const learner = (data?.[0] as ServiceLearner | undefined) ?? null;
          if (learner) result = { learner, how: "Phone number", tab: "sell" };
        } else {
          // Not a name, phone, Payment ID or Link ID (for example a bank
          // reference): payments are found by their own IDs.
          setMessage(
            "Payments are found by their Payment ID (PAY-…) or Link ID (LNK-…). To find a customer, type their name or e-mail.",
          );
          return;
        }
      }

      if (!result) {
        setMessage(
          "Nothing found. Check the number or ID. For a brand-new customer use Create New Learner.",
        );
        return;
      }
      setFound(result);
      setOpen(true);
    } catch (err) {
      setMessage(
        (err as { message?: string } | null)?.message ||
          "Couldn't look that up.",
      );
    } finally {
      setLooking(false);
    }
  };

  return (
    <Card className="transition-all hover:shadow-lg">
      <CardHeader>
        <div className="flex items-center gap-4">
          <div className="rounded-lg bg-gray-100 p-2 text-blue-500">
            <Search size={24} />
          </div>
          <div>
            <CardTitle className="text-xl">
              Existing customer: services &amp; payments
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Sell another course, top-up or licence service, send another
              payment link, or check a payment. Find the customer by name or
              e-mail, or find a payment by its Payment ID (PAY-…) or Link ID
              (LNK-…).
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void find();
          }}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Learner name or e-mail, PAY-… or LNK-…"
            className="max-w-sm"
            autoComplete="off"
          />
          <Button type="submit" variant="outline" disabled={looking}>
            {looking ? "Finding…" : "Find"}
          </Button>
        </form>
        {nameMode && query.trim() !== "" && (
          <div className="mt-2 max-w-sm">
            <LearnerResultList
              results={nameSearch.results}
              loading={nameSearch.loading}
              error={nameSearch.error}
              ready={nameSearch.ready}
              capped={nameSearch.capped}
              maxHeight="max-h-72"
              onPick={openLearner}
            />
          </div>
        )}
        {message && (
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        )}
        {found && (
          <p className="mt-2 text-xs text-muted-foreground">
            Last opened: {found.learner.name ?? "customer"} (found by{" "}
            {found.how}){" "}
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => setOpen(true)}
            >
              open again
            </button>
          </p>
        )}
        <AdditionalServiceDialog
          open={open}
          onOpenChange={setOpen}
          learner={found?.learner ?? null}
          initialTab={found?.tab ?? "sell"}
        />
      </CardContent>
    </Card>
  );
}
