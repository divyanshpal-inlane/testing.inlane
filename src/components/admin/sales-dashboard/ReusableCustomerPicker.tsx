import { Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { ReusableCustomer } from "@/queries/salesBookingCustomers";
import { useReusableCustomerSearch } from "@/queries/salesBookingCustomers";

interface ReusableCustomerPickerProps {
  onSelect: (customer: ReusableCustomer) => void;
}

function sourceLabel(source: ReusableCustomer["source"]): string {
  return source === "learner" ? "Registered learner" : "Previous tentative";
}

export function ReusableCustomerPicker({
  onSelect,
}: ReusableCustomerPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const searchPending = query.trim() !== debouncedQuery;
  const { data, isFetching, isError } = useReusableCustomerSearch(
    debouncedQuery,
    open && !searchPending,
  );

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const selectCustomer = (customer: ReusableCustomer) => {
    onSelect(customer);
    setQuery(`${customer.name} - ${customer.phone}`);
    setOpen(false);
  };

  const hasSearchTerm = debouncedQuery.length >= 2;
  const results = searchPending ? [] : (data ?? []);

  return (
    <div ref={rootRef} className="relative">
      <label
        htmlFor="reusableCustomerSearch"
        className="block text-sm font-medium text-foreground"
      >
        Search previous customers
      </label>
      <div className="relative mt-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id="reusableCustomerSearch"
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search by name or phone"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && hasSearchTerm}
          aria-controls="reusable-customer-results"
          className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {open && hasSearchTerm && (
        <div
          id="reusable-customer-results"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          role="listbox"
        >
          {(isFetching || searchPending) && (
            <div className="flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Searching customers...
            </div>
          )}
          {!isFetching && !searchPending && isError && (
            <p className="p-3 text-xs text-destructive">
              Customer search is unavailable for this account. No permissions
              were changed.
            </p>
          )}
          {!isFetching &&
            !searchPending &&
            !isError &&
            results.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">
                No previous customer found. Choose New Customer to enter
                details.
              </p>
            )}
          {!isFetching &&
            !searchPending &&
            !isError &&
            results.map((customer) => (
              <button
                key={`${customer.source}-${customer.key}`}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => selectCustomer(customer)}
                className="flex w-full items-start justify-between gap-3 rounded px-3 py-2 text-left hover:bg-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {customer.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {customer.phone}
                    {customer.address ? ` - ${customer.address}` : ""}
                  </span>
                </span>
                <span className="flex-none text-xs text-muted-foreground">
                  {sourceLabel(customer.source)}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
