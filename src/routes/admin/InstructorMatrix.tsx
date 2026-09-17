import { addDays, format, startOfWeek } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { InstructorMatrixCell } from "@/components/admin/InstructorMatrixCell";
import { InstructorMatrixDrawer } from "@/components/admin/InstructorMatrixDrawer";
import { InstructorMultiSelect } from "@/components/admin/InstructorMultiSelect";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  buildInstructorMatrix,
  fetchCompleteInstructorMatrix,
  MatrixRow,
  useInstructorMatrix,
} from "@/queries/instructorMatrix";
import { exportInstructorMatrixWorkbook } from "@/utils/instructorMatrixWorkbook";
import { UTILIZATION_LEGEND } from "@/utils/utilizationColor";

const getMonday = (d: Date) => startOfWeek(d, { weekStartsOn: 1 });

export default function InstructorMatrix() {
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  // Instructors picked in the multi-select. Empty = show everyone.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openRow, setOpenRow] = useState<MatrixRow | null>(null);
  const [hideOffDuty, setHideOffDuty] = useState(false);
  // View A (default): tentative holds count as busy. View B: exclude them.
  const [countTentative, setCountTentative] = useState(true);
  const [exporting, setExporting] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  const {
    data: raw,
    isLoading,
    isFetching,
    isError,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    refetch,
  } = useInstructorMatrix({
    weekStart,
    selectedIds,
    hideOffDuty,
    countTentative,
  });

  // Availability calculations and the tentative view stay in the existing
  // builder. Each appended batch contributes to the same matrix/totals.
  const data = useMemo(
    () =>
      raw
        ? buildInstructorMatrix(raw, { includeTentative: countTentative })
        : undefined,
    [raw, countTentative],
  );

  // Loaded instructors supply chip labels; the picker queries suggestions on
  // demand so search can still find instructors beyond these pages.
  const loadedInstructors = useMemo(
    () => (data ? data.rows.map((r) => r.instructor) : []),
    [data],
  );

  const visibleRows = useMemo(() => {
    if (!data) return [] as MatrixRow[];
    const selected = new Set(selectedIds);
    return data.rows.filter((r) => {
      // When instructors are picked, show only those; otherwise show everyone.
      if (selected.size > 0 && !selected.has(r.instructor.id)) return false;
      if (hideOffDuty && r.weekCapacityHours === 0) return false;
      return true;
    });
  }, [data, selectedIds, hideOffDuty]);

  useEffect(() => {
    hasScrolledRef.current = false;
  }, [weekStart, selectedIds, hideOffDuty, countTentative]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (
      !sentinel ||
      !data ||
      !hasNextPage ||
      isFetching ||
      isFetchNextPageError
    )
      return;

    let requested = false;
    const loadMore = () => {
      if (requested) return;
      requested = true;
      observer.disconnect();
      void fetchNextPage({ cancelRefetch: false });
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          entry.isIntersecting &&
          (hasScrolledRef.current || (hideOffDuty && visibleRows.length === 0))
        ) {
          loadMore();
        }
      },
      { rootMargin: "0px 0px 200px" },
    );
    const onScroll = (event: Event) => {
      // Ignore scrolling the picker or the horizontal matrix viewport.
      if (event.target instanceof Element && !event.target.contains(sentinel))
        return;
      hasScrolledRef.current = true;
      const bounds = sentinel.getBoundingClientRect();
      if (bounds.top <= window.innerHeight + 200 && bounds.bottom >= 0)
        loadMore();
    };
    // A tall viewport may already contain the sentinel. Wait for scrolling
    // before loading more, so opening/resetting the page fetches only one batch.
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchNextPageError,
    hideOffDuty,
    visibleRows.length,
  ]);

  const visibleTotals = useMemo(() => {
    return visibleRows.reduce(
      (acc, r) => ({
        instructorCount: acc.instructorCount + 1,
        bookedHours: acc.bookedHours + r.weekBookedHours,
        capacityHours: acc.capacityHours + r.weekCapacityHours,
        conflictCount: acc.conflictCount + r.weekConflictCount,
      }),
      {
        instructorCount: 0,
        bookedHours: 0,
        capacityHours: 0,
        conflictCount: 0,
      },
    );
  }, [visibleRows]);

  const utilizationPct =
    visibleTotals.capacityHours > 0
      ? Math.round(
          (visibleTotals.bookedHours / visibleTotals.capacityHours) * 100,
        )
      : 0;

  const weekLabel = `${format(weekStart, "EEE d MMM")} – ${format(
    addDays(weekStart, 6),
    "EEE d MMM yyyy",
  )}`;

  // Export the full week for every enabled instructor (the instructor picker /
  // hide-off-duty are intentionally ignored) as a styled .xlsx workbook: a
  // colour-coded Matrix grid, a Bookings detail table, and a Summary table.
  const handleExport = async () => {
    if (!raw || !data || exporting) return;
    setExporting(true);
    try {
      const exportRaw = await fetchCompleteInstructorMatrix(weekStart);
      const exportData = buildInstructorMatrix(exportRaw, {
        includeTentative: countTentative,
      });
      await exportInstructorMatrixWorkbook(
        exportRaw,
        exportData,
        countTentative,
      );
    } catch (err) {
      console.error("Failed to export instructor matrix", err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Top header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/admin">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Instructor Availability Matrix
              </h1>
              <p className="text-sm text-muted-foreground">
                Capacity assumes a 14h working window (06:00–20:00) per
                instructor, minus unavailability.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-1 h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={handleExport}
              disabled={isLoading || !data || !raw || exporting}
            >
              {exporting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1 h-4 w-4" />
              )}
              Export Excel
            </Button>
          </div>
        </div>

        {/* Week nav + filters */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setWeekStart(addDays(weekStart, -7))}
                aria-label="Previous week"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeekStart(getMonday(new Date()))}
              >
                This week
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setWeekStart(addDays(weekStart, 7))}
                aria-label="Next week"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="ml-2 text-sm font-medium">{weekLabel}</span>
            </div>
            <div className="ml-auto w-full max-w-md">
              <InstructorMultiSelect
                instructors={loadedInstructors}
                selectedIds={selectedIds}
                onChange={setSelectedIds}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hideOffDuty}
                onChange={(e) => setHideOffDuty(e.target.checked)}
              />
              Hide off-duty
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={countTentative}
                onChange={(e) => setCountTentative(e.target.checked)}
              />
              Count tentative as busy
            </label>
            {!countTentative && (
              <span className="rounded border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">
                Excluding tentative holds
              </span>
            )}
          </CardContent>
        </Card>

        {/* Stat strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <Card>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Instructors</div>
              <div className="text-2xl font-semibold tabular-nums">
                {visibleTotals.instructorCount}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">
                Fleet free hrs
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {visibleTotals.capacityHours}h
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Booked hrs</div>
              <div className="text-2xl font-semibold tabular-nums">
                {visibleTotals.bookedHours.toFixed(0)}h
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Utilization</div>
              <div className="text-2xl font-semibold tabular-nums">
                {utilizationPct}%
              </div>
            </CardContent>
          </Card>
          <Card
            className={
              visibleTotals.conflictCount > 0 ? "border-yellow-400" : ""
            }
          >
            <CardContent className="p-3">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {visibleTotals.conflictCount > 0 && (
                  <AlertTriangle className="h-3 w-3 text-yellow-500" />
                )}
                Conflicts
              </div>
              <div
                className={`text-2xl font-semibold tabular-nums ${
                  visibleTotals.conflictCount > 0 ? "text-yellow-600" : ""
                }`}
              >
                {visibleTotals.conflictCount}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Legend:</span>
          {UTILIZATION_LEGEND.map((s) => (
            <span
              key={s.bucket}
              className={`flex items-center gap-1 rounded border px-2 py-0.5 ${s.bg} ${s.text} ${s.border}`}
            >
              <span className="font-medium">{s.label}</span>
            </span>
          ))}
        </div>

        {/* Matrix */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : isError && !data ? (
              <div className="p-6 text-center text-sm text-destructive">
                Could not load instructors. Use Refresh to try again.
              </div>
            ) : !data || (visibleRows.length === 0 && !hasNextPage) ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No instructors match the current filters.
              </div>
            ) : (
              <ScrollArea>
                <div className="min-w-[900px]">
                  {/* Header row */}
                  <div
                    className="grid gap-1 border-b bg-muted/40 p-2 text-xs font-medium text-muted-foreground"
                    style={{
                      gridTemplateColumns: `12rem repeat(7, minmax(0, 1fr)) 6rem`,
                    }}
                  >
                    <div>Instructor</div>
                    {data.dayHeaders.map((h) => (
                      <div key={h.date} className="text-center">
                        {h.weekday} {h.dayOfMonth}
                      </div>
                    ))}
                    <div className="text-center">Week total</div>
                  </div>

                  {/* Rows */}
                  {visibleRows.map((row) => {
                    const pct =
                      row.weekCapacityHours > 0
                        ? Math.round(
                            (row.weekBookedHours / row.weekCapacityHours) * 100,
                          )
                        : 0;
                    return (
                      <div
                        key={row.instructor.id}
                        className="grid items-center gap-1 border-b p-2 hover:bg-muted/30"
                        style={{
                          gridTemplateColumns: `12rem repeat(7, minmax(0, 1fr)) 6rem`,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setOpenRow(row)}
                          className="flex flex-col items-start text-left hover:underline"
                        >
                          <span className="truncate text-sm font-medium">
                            {row.instructor.name}
                            {row.weekConflictCount > 0 && (
                              <AlertTriangle className="ml-1 inline h-3 w-3 text-yellow-600" />
                            )}
                          </span>
                          {row.instructor.phone && (
                            <span className="truncate text-[11px] text-muted-foreground">
                              {row.instructor.phone}
                            </span>
                          )}
                        </button>
                        {row.days.map((d) => (
                          <InstructorMatrixCell
                            key={d.date}
                            day={d}
                            onClick={() => setOpenRow(row)}
                          />
                        ))}
                        <div className="flex flex-col items-center text-xs">
                          <span className="font-semibold tabular-nums">
                            {row.weekBookedHours.toFixed(0)}/
                            {row.weekCapacityHours}
                          </span>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {pct}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            )}
            {/* Outside the horizontal ScrollArea so page scrolling can always
                reach it, including when a batch contains only off-duty rows. */}
            <div ref={loadMoreRef} className={hasNextPage ? "min-h-10" : ""}>
              {isFetchingNextPage && (
                <div
                  role="status"
                  className="flex items-center justify-center gap-2 p-3 text-sm text-muted-foreground"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading more instructors…
                </div>
              )}
              {isFetchNextPageError && (
                <div className="p-3 text-center text-sm text-destructive">
                  Could not load more instructors.
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchNextPage()}
                    disabled={isFetching}
                  >
                    Retry
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <InstructorMatrixDrawer
        row={openRow}
        onOpenChange={(open) => !open && setOpenRow(null)}
      />
    </div>
  );
}
