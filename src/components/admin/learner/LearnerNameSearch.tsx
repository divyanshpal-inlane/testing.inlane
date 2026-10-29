import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { useCanSeeCustomerPhone } from "@/hooks/useCanSeeCustomerPhone";
import { nameSearchFilter } from "@/lib/learnerSearch";
import { supabase } from "@/lib/supabaseClient";
import { maskPhoneNumber } from "@/utils/phoneMasking";

export interface FoundLearner {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  pick_up_location: string | null;
  area: string | null;
}

const COLUMNS = "id, name, phone, email, pick_up_location, area";

// A search returns EVERY learner that matches, not a fixed number: an old
// customer with a common name (one who comes back to finish a pending payment)
// must never be pushed off the list. Rows are fetched a page at a time (the
// database caps one request at 1000) until there are no more. MAX_RESULTS is
// only a safety net against a runaway query; no real 3+ letter search reaches
// it, and if it ever does the list says so.
const PAGE_SIZE = 1000;
const MAX_RESULTS = 10_000;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Learners whose name or e-mail contains the text (3+ characters). The team
 * does not know customers' phone numbers, so this is the way to find one; the
 * number is shown masked (per the viewer's permission) only to tell two people
 * with the same name apart.
 */
export function useLearnerSearch(query: string, enabled = true) {
  const debounced = useDebounced(query, 350);
  const filter = enabled ? nameSearchFilter(debounced) : null;
  const result = useQuery({
    queryKey: ["learner-search", filter],
    enabled: !!filter,
    staleTime: 30_000,
    queryFn: async () => {
      const rows: FoundLearner[] = [];
      let capped = false;
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("Learner")
          .select(COLUMNS)
          .or(filter!)
          // Newest first; id breaks ties so paging never skips or repeats a row.
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        const page = (data ?? []) as FoundLearner[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
        if (rows.length >= MAX_RESULTS) {
          capped = true;
          break;
        }
      }
      return { rows, capped };
    },
  });
  return {
    results: result.data?.rows ?? [],
    /** True only if the safety cap was hit (see MAX_RESULTS). */
    capped: result.data?.capped ?? false,
    // True while the typed text is waiting for the debounce or the request.
    loading:
      (!!nameSearchFilter(query) && debounced !== query) || result.isFetching,
    error: result.isError,
    /** Whether the text is long enough to search at all. */
    ready: !!nameSearchFilter(query),
  };
}

/** The result rows, shared by every place that searches for a learner. */
export function LearnerResultList({
  results,
  loading,
  error,
  ready,
  capped = false,
  maxHeight = "max-h-48",
  onPick,
}: {
  results: FoundLearner[];
  loading: boolean;
  error: boolean;
  ready: boolean;
  /** The safety cap was hit: more match than are listed. */
  capped?: boolean;
  /** Tailwind max-height class for the scrolling list. */
  maxHeight?: string;
  onPick: (learner: FoundLearner) => void;
}) {
  const canSeePhone = useCanSeeCustomerPhone();
  if (!ready) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Type at least 3 letters of the learner&apos;s name or e-mail.
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-[11px] text-red-600">Couldn&apos;t search learners.</p>
    );
  }
  if (loading && results.length === 0) {
    return (
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Searching…
      </p>
    );
  }
  if (results.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        No learner found. Check the spelling, or fill the form below.
      </p>
    );
  }
  return (
    <>
      <p className="mb-1 text-[11px] text-muted-foreground">
        {results.length} learner{results.length === 1 ? "" : "s"} found
        {results.length > 6 ? " (scroll for more)" : ""}
      </p>
      <ul
        className={`${maxHeight} divide-y overflow-y-auto rounded-md border bg-background text-xs`}
        aria-label="Matching learners"
      >
        {results.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => onPick(l)}
              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-muted/60"
            >
              <span className="min-w-0 truncate font-medium">
                {l.name ?? "Unnamed learner"}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {l.phone
                  ? canSeePhone
                    ? l.phone
                    : maskPhoneNumber(l.phone)
                  : (l.email ?? "")}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {capped && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          More than {results.length.toLocaleString("en-IN")} learners match.
          Type more of the name or the e-mail to narrow it.
        </p>
      )}
    </>
  );
}

/** A search box with its result list. Picking a row calls `onPick`. */
export function LearnerNameSearch({
  onPick,
  placeholder = "Search by name or e-mail",
  inputClassName = "h-8 text-xs",
  listMaxHeight,
}: {
  onPick: (learner: FoundLearner) => void;
  placeholder?: string;
  inputClassName?: string;
  /** Tailwind max-height class for the results list (default max-h-48). */
  listMaxHeight?: string;
}) {
  const [query, setQuery] = useState("");
  const search = useLearnerSearch(query);
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className={`pl-7 ${inputClassName}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          onKeyDown={(e) => {
            // Never submit the surrounding booking form.
            if (e.key === "Enter") e.preventDefault();
          }}
        />
      </div>
      {query.trim() !== "" && (
        <LearnerResultList
          results={search.results}
          loading={search.loading}
          error={search.error}
          ready={search.ready}
          capped={search.capped}
          maxHeight={listMaxHeight}
          onPick={(l) => {
            onPick(l);
            setQuery("");
          }}
        />
      )}
    </div>
  );
}
