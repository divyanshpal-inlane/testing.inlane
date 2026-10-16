import { Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  MatrixInstructor,
  useInstructorMatrixSuggestions,
} from "@/queries/instructorMatrix";

interface Props {
  instructors: MatrixInstructor[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

// Typeahead that lets the admin pick several instructors as chips. When any are
// selected the matrix shows only those; with none selected it shows everyone.
export function InstructorMultiSelect({
  instructors,
  selectedIds,
  onChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // Keep chip labels when the matrix resets its pages or a picked instructor
  // was found by searching beyond the matrix's loaded batch.
  const [pickedInstructors, setPickedInstructors] = useState<
    MatrixInstructor[]
  >([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebouncedValue(query);
  const searchPending = query !== debouncedQuery;
  const {
    data: matches,
    isFetching,
    isError,
    refetch,
  } = useInstructorMatrixSuggestions({
    search: debouncedQuery,
    selectedIds,
    enabled: open && !searchPending,
  });

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedInstructors = useMemo(
    () =>
      selectedIds
        .map(
          (id) =>
            instructors.find((i) => i.id === id) ??
            pickedInstructors.find((i) => i.id === id),
        )
        .filter((i): i is MatrixInstructor => !!i)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [instructors, pickedInstructors, selectedIds],
  );

  const suggestions = useMemo(() => {
    return searchPending
      ? []
      : (matches ?? []).filter((i) => !selectedSet.has(i.id));
  }, [matches, selectedSet, searchPending]);

  // Dismiss the dropdown on any click outside the control.
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const add = (instructor: MatrixInstructor) => {
    if (selectedSet.has(instructor.id)) return;
    setPickedInstructors((previous) => [
      ...previous.filter((i) => i.id !== instructor.id),
      instructor,
    ]);
    onChange([...selectedIds, instructor.id]);
    setQuery("");
    setOpen(true); // stay open to add more
  };
  const remove = (id: string) => {
    setPickedInstructors((previous) => previous.filter((i) => i.id !== id));
    onChange(selectedIds.filter((x) => x !== id));
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div
        className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        {selectedInstructors.map((i) => (
          <Badge key={i.id} variant="secondary" className="gap-1 pr-1">
            {i.name}
            <button
              type="button"
              aria-label={`Remove ${i.name}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(i.id);
              }}
              className="rounded-full hover:bg-black/10"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={
            selectedInstructors.length ? "Add another…" : "Search instructors…"
          }
          className="min-w-[7rem] flex-1 bg-transparent px-1 text-sm outline-none"
        />
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
              setPickedInstructors([]);
              setQuery("");
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {suggestions.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => add(i)}
              className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className="font-medium">{i.name}</span>
              {i.phone && (
                <span className="text-[11px] text-muted-foreground">
                  {i.phone}
                </span>
              )}
            </button>
          ))}
          {(isFetching || searchPending) && (
            <div
              role="status"
              className="flex items-center justify-center gap-2 p-2 text-xs text-muted-foreground"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading instructors…
            </div>
          )}
          {isError && !searchPending && (
            <button
              type="button"
              onClick={() => refetch()}
              className="w-full p-2 text-xs text-destructive"
            >
              Could not load instructors. Retry
            </button>
          )}
          {!isFetching &&
            !searchPending &&
            !isError &&
            suggestions.length === 0 && (
              <div className="p-2 text-center text-xs text-muted-foreground">
                No instructors found.
              </div>
            )}
        </div>
      )}
    </div>
  );
}
