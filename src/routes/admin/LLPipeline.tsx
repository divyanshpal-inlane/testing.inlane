import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  Undo2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import LLDocumentsReview from "@/components/admin/LLDocumentsReview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  calcLLExpiryDate,
  calcLLMaturityDate,
  getLLAdvanceTargets,
  getLLFailureOptions,
  getLLRevertTargets,
  isLLExpiryStatus,
  isLLFailureStatus,
  isLLSegregationRouteCode,
  LL_FAILURE_STAGES,
  LL_PHASES,
  LL_SEGREGATION_ROUTES,
  LL_SERVICES,
  LL_STAGES,
  LLPhaseKey,
  llSegregationRouteChecklist,
  llSegregationRouteLabel,
  llStageLabel,
} from "@/constants/llPipeline";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  DEFAULT_LL_PIPELINE_FILTERS,
  LLApplication,
  llDocumentUrl,
  LLPipelineFilters,
  LLPipelineQueryPage,
  useActiveLLApplication,
  useCreateLLApplication,
  useLLApplicationsInfinite,
  useLLDocuments,
  useLLLearnerSearch,
  useLLPipelineEvents,
  useLLQueueCounts,
  useLLStageCounts,
  useRevertLLStatus,
  useUpdateLLFields,
  useUpdateLLStatus,
  useUploadLLCard,
} from "@/queries/llApplications";
import { useCurrentUser } from "@/queries/userManagement";

type QueueKey = "all" | LLPhaseKey | "escalations";

interface StageFilterOption {
  key: string;
  label: string;
  phase: LLPhaseKey;
  isFailure: boolean;
}

const LL_BOARD_STAGE_FILTERS: StageFilterOption[] = (() => {
  const seen = new Set<string>();
  const stages: StageFilterOption[] = [];
  for (const stage of LL_STAGES) {
    if (!seen.has(stage.key)) {
      seen.add(stage.key);
      stages.push({
        key: stage.key,
        label: stage.label,
        phase: stage.phase,
        isFailure: isLLFailureStatus(stage.key),
      });
    }
    for (const failure of stage.failures ?? []) {
      if (seen.has(failure.key)) continue;
      seen.add(failure.key);
      stages.push({
        key: failure.key,
        label: failure.label,
        phase: stage.phase,
        isFailure: true,
      });
    }
  }
  return stages;
})();

export default function LLPipeline() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const actorName = currentUser?.name ?? null;
  const actorId = currentUser?.id ?? null;

  const [queue, setQueue] = useState<QueueKey>("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Date filter (feedback item 8): view entries created/updated in a range.
  const [dateField, setDateField] = useState<"created_at" | "updated_at">(
    "updated_at",
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  /** Filter by segregation route A–D ("all" = no filter). */
  const [routeFilter, setRouteFilter] = useState<"all" | string>("all");

  const updateStatus = useUpdateLLStatus();
  const revertStatus = useRevertLLStatus();
  const updateFields = useUpdateLLFields();

  // Debounced search: each keystroke must not fire its own DB request.
  const debouncedSearch = useDebouncedValue(searchTerm, 300);

  // Queue/search/route/date filters are applied in the DB (PostgREST WHERE),
  // never client-side. A change resets pagination via a fresh query key.
  const filters = useMemo<LLPipelineFilters>(
    () => ({
      queue,
      stage: stageFilter,
      search: debouncedSearch,
      route: routeFilter,
      dateField,
      dateFrom,
      dateTo,
    }),
    [
      queue,
      stageFilter,
      debouncedSearch,
      routeFilter,
      dateField,
      dateFrom,
      dateTo,
    ],
  );

  const pipeline = useLLApplicationsInfinite(filters);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = pipeline;
  const applications = useMemo(
    () => pipeline.data?.pages.flatMap((p) => p.data) ?? [],
    [pipeline.data],
  );
  const { data: queueCountsData } = useLLQueueCounts();
  const queueCounts: Record<string, number> = queueCountsData ?? {};
  const { data: stageCountsData, isLoading: stageCountsLoading } =
    useLLStageCounts(queue);
  const stageCounts = stageCountsData ?? {};
  const visibleStageFilters = useMemo(() => {
    if (queue === "all" || queue === "escalations") {
      return LL_BOARD_STAGE_FILTERS;
    }
    return LL_BOARD_STAGE_FILTERS.filter((stage) => stage.phase === queue);
  }, [queue]);

  const selected = applications.find((a) => a.id === selectedId) ?? null;

  // Infinite scroll: fetch the next 10 rows when the list nears the bottom.
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const listScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const viewport = listScrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement | null;
    if (!viewport) return;
    const onScroll = () => {
      if (
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
        240
      ) {
        loadMore();
      }
    };
    viewport.addEventListener("scroll", onScroll);
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [loadMore]);

  return (
    <div
      className="flex min-h-screen flex-col bg-white p-4"
      style={{
        backgroundImage: 'url("/assets/bg_pattern.svg")',
        backgroundRepeat: "repeat",
        backgroundSize: "cover",
      }}
    >
      <div className="border-b bg-white px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/admin")}
              className="h-10 w-10"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold">LL → DL Pipeline</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/admin/dl-test-slots")}
            >
              DL test dates
            </Button>
            <NewApplicationButton
              actorName={actorName}
              onOpenApplication={(application) => {
                // Prepend the freshly-created application into the default
                // (unfiltered) list so it appears instantly at the top.
                queryClient.setQueryData<InfiniteData<LLPipelineQueryPage>>(
                  ["ll-applications", DEFAULT_LL_PIPELINE_FILTERS],
                  (current) => {
                    if (!current) return current;
                    return {
                      ...current,
                      pages: current.pages.map((page, index) =>
                        index === 0
                          ? {
                              ...page,
                              data: [
                                application,
                                ...page.data.filter(
                                  (item) => item.id !== application.id,
                                ),
                              ],
                              total: Math.max(page.total + 1, page.data.length),
                            }
                          : page,
                      ),
                    };
                  },
                );
                setQueue("all");
                setStageFilter("all");
                setRouteFilter("all");
                setDateFrom("");
                setDateTo("");
                setSearchTerm("");
                setSelectedId(application.id);
              }}
            />
          </div>
        </div>
      </div>

      {/* Queue tabs */}
      <div className="flex flex-wrap gap-1 border-b bg-white px-4 py-2">
        {[
          { key: "all" as QueueKey, label: "All" },
          ...LL_PHASES.map((p) => ({ key: p.key as QueueKey, label: p.label })),
          { key: "escalations" as QueueKey, label: "⚠ Escalations" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setQueue(t.key);
              setStageFilter("all");
              setSelectedId(null);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              queue === t.key
                ? t.key === "escalations"
                  ? "bg-red-600 text-white"
                  : "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {t.label} {queueCounts[t.key] ?? 0}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Select value={routeFilter} onValueChange={setRouteFilter}>
            <SelectTrigger className="h-7 w-44 text-xs">
              <SelectValue placeholder="Route" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All routes</SelectItem>
              {LL_SEGREGATION_ROUTES.map((r) => (
                <SelectItem key={r.code} value={r.code}>
                  {r.code} — {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={dateField}
            onValueChange={(v) =>
              setDateField(v as "created_at" | "updated_at")
            }
          >
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated_at">Updated</SelectItem>
              <SelectItem value="created_at">Created</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            className="h-7 w-32 text-xs"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <span className="text-xs text-gray-400">–</span>
          <Input
            type="date"
            className="h-7 w-32 text-xs"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
          {(dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Exact board-stage counts and filters within the selected queue. */}
      <div className="border-b bg-slate-50 px-4 py-2.5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Stage visibility
          </span>
          <Badge variant="outline" className="bg-white text-[10px]">
            {visibleStageFilters.length} stages
          </Badge>
          <span className="text-xs text-slate-500">
            {queueCounts[queue] ?? 0} applications in this queue
          </span>
          {stageFilter !== "all" && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2 text-xs"
              onClick={() => {
                setStageFilter("all");
                setSelectedId(null);
              }}
            >
              Clear stage filter
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {visibleStageFilters.map((stage) => {
            const active = stageFilter === stage.key;
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => {
                  setStageFilter(active ? "all" : stage.key);
                  setSelectedId(null);
                }}
                className={`rounded-md border px-2 py-1 text-left text-[11px] transition ${
                  active
                    ? stage.isFailure
                      ? "border-red-600 bg-red-600 text-white"
                      : "border-primary bg-primary text-primary-foreground"
                    : stage.isFailure
                      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100"
                }`}
                aria-pressed={active}
              >
                <span>{stage.label}</span>
                <span
                  className={`ml-1 font-semibold ${
                    active ? "text-current" : "text-slate-900"
                  }`}
                >
                  {stageCountsLoading ? "…" : (stageCounts[stage.key] ?? 0)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-2 p-4 md:grid-cols-3">
        {/* Application list */}
        <Card className="md:col-span-1">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-sm">
              Applications
              {pipeline.data?.pages[0] ? (
                <span className="ml-1 font-normal text-gray-500">
                  · {pipeline.data.pages[0].total}
                </span>
              ) : null}
            </CardTitle>
            <div className="relative mt-1">
              <Search className="absolute left-2 top-2 h-4 w-4 text-gray-500" />
              <Input
                placeholder="Name, phone, application no…"
                className="h-8 pl-8 text-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <ScrollArea
              ref={listScrollRef}
              className="h-[calc(100vh-410px)] min-h-[360px]"
            >
              {pipeline.isLoading ? (
                <div className="py-10 text-center text-sm text-gray-500">
                  Loading…
                </div>
              ) : applications.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-500">
                  No applications in this queue.
                </div>
              ) : (
                applications.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className={`mb-2 block w-full rounded-md border p-2 text-left transition hover:bg-gray-50 ${
                      selectedId === a.id
                        ? "border-indigo-500 bg-indigo-50"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {a.Learner?.name ?? "Unknown learner"}
                      </span>
                      {(a.escalated || isLLFailureStatus(a.status)) && (
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {a.Learner?.phone}
                      {a.batch_code ? (
                        <span className="ml-1 text-gray-400">
                          · {llSegregationRouteLabel(a.batch_code)}
                        </span>
                      ) : null}
                    </div>
                    <StatusBadge status={a.status} />
                  </button>
                ))
              )}
              {pipeline.isFetchingNextPage ? (
                <div className="py-4 text-center text-sm text-gray-400">
                  Loading more…
                </div>
              ) : !pipeline.hasNextPage && applications.length > 0 ? (
                <div className="py-4 text-center text-xs text-gray-400">
                  End of list
                </div>
              ) : null}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Detail panel */}
        <div className="md:col-span-2">
          {selected ? (
            <ApplicationDetail
              application={selected}
              actorName={actorName}
              onTransition={(toStatus, note, extraFields) =>
                updateStatus.mutate(
                  {
                    application: selected,
                    toStatus,
                    note,
                    actorName,
                    actorId,
                    extraFields,
                  },
                  {
                    onSuccess: () =>
                      toast({
                        title: "Status updated",
                        description: `${selected.Learner?.name ?? "Application"} → ${llStageLabel(toStatus)}`,
                      }),
                    onError: (e: Error) =>
                      toast({
                        title: "Error",
                        description: e.message,
                        variant: "destructive",
                      }),
                  },
                )
              }
              onRevert={(toStatus, reason) =>
                revertStatus.mutate(
                  {
                    application: selected,
                    toStatus,
                    reason,
                    actorName,
                    actorId,
                  },
                  {
                    onSuccess: () =>
                      toast({
                        title: "Stage reverted",
                        description: `${selected.Learner?.name ?? "Application"} → ${llStageLabel(toStatus)}`,
                      }),
                    onError: (e: Error) =>
                      toast({
                        title: "Revert failed",
                        description: e.message,
                        variant: "destructive",
                      }),
                  },
                )
              }
              onSaveFields={(fields) =>
                updateFields.mutate(
                  { application: selected, fields, actorName },
                  {
                    onSuccess: () => toast({ title: "Details saved" }),
                    onError: (e: Error) =>
                      toast({
                        title: "Error",
                        description: e.message,
                        variant: "destructive",
                      }),
                  },
                )
              }
              isBusy={
                updateStatus.isPending ||
                revertStatus.isPending ||
                updateFields.isPending
              }
            />
          ) : (
            <Card className="h-full border-dashed">
              <CardContent className="flex h-full items-center justify-center py-20 text-gray-400">
                Select an application to see its journey, update its status, and
                enter RTO details.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const failure = isLLFailureStatus(status);
  const done = status === "dl_delivered";
  return (
    <Badge
      variant="outline"
      className={`mt-1 text-[10px] ${
        failure
          ? "border-red-300 bg-red-50 text-red-700"
          : done
            ? "border-green-300 bg-green-50 text-green-700"
            : "border-blue-200 bg-blue-50 text-blue-700"
      }`}
    >
      {llStageLabel(status)}
    </Badge>
  );
}

function ApplicationDetail({
  application,
  actorName,
  onTransition,
  onRevert,
  onSaveFields,
  isBusy,
}: {
  application: LLApplication;
  actorName: string | null;
  onTransition: (
    toStatus: string,
    note?: string,
    extraFields?: Partial<LLApplication>,
  ) => void;
  onRevert: (toStatus: string, reason: string) => void;
  onSaveFields: (fields: Partial<LLApplication>) => void;
  isBusy: boolean;
}) {
  const failure = LL_FAILURE_STAGES[application.status];
  const { data: events } = useLLPipelineEvents(application.id);
  const [note, setNote] = useState("");
  const [revertTarget, setRevertTarget] = useState<string>("");
  const [revertReason, setRevertReason] = useState("");
  const [revertOpen, setRevertOpen] = useState(false);

  const revertTargets = useMemo(
    () => getLLRevertTargets(application.status, application.batch_code),
    [application.status, application.batch_code],
  );

  // Editable Ops fields (draft state, saved together)
  const [draft, setDraft] = useState<Partial<LLApplication>>({});
  // Drop local edits when the server row moves (advance / revert / external update).
  useEffect(() => {
    setDraft({});
  }, [application.id, application.status, application.updated_at]);
  const value = (k: keyof LLApplication) =>
    (draft[k] ?? application[k] ?? "") as string;
  const setValue = (k: keyof LLApplication, v: string | null) =>
    setDraft((p) => ({ ...p, [k]: v === "" ? null : v }));

  /** Issue date drives Valid Till (+6mo −1d) and Maturity (+1mo). */
  const setLLIssueDate = (raw: string) => {
    if (!raw) {
      setDraft((p) => ({
        ...p,
        ll_issue_date: null,
        ll_expiry_date: null,
        ll_matures_at: null,
      }));
      return;
    }
    setDraft((p) => ({
      ...p,
      ll_issue_date: raw,
      ll_expiry_date: calcLLExpiryDate(raw),
      ll_matures_at: calcLLMaturityDate(raw),
    }));
  };

  const issueDate = value("ll_issue_date");
  const derivedExpiry = issueDate ? calcLLExpiryDate(issueDate) : "";
  const derivedMaturity = issueDate ? calcLLMaturityDate(issueDate) : "";

  const services: string[] = Array.isArray(draft.services)
    ? (draft.services as string[])
    : (application.services ?? []);

  const effectiveBatchCode =
    (draft.batch_code as string | null | undefined) ?? application.batch_code;
  const advanceTargets = getLLAdvanceTargets(
    application.status,
    effectiveBatchCode,
  );
  const failureOptions = getLLFailureOptions(
    application.status,
    effectiveBatchCode,
  );
  const needsRouteToAdvance =
    application.status === "application_ready" &&
    !isLLSegregationRouteCode(effectiveBatchCode);

  return (
    <div className="space-y-2">
      <Card>
        <CardHeader className="p-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {application.Learner?.name}{" "}
              <span className="text-sm font-normal text-gray-500">
                {application.Learner?.phone} · {application.Learner?.area}
              </span>
            </CardTitle>
            <StatusBadge status={application.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-3 pt-0">
          {/* Transition controls */}
          <div className="rounded-md border p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Move this application
              {isLLSegregationRouteCode(effectiveBatchCode) && (
                <span className="ml-2 font-normal normal-case text-gray-400">
                  ({llSegregationRouteLabel(effectiveBatchCode)})
                </span>
              )}
            </div>
            {needsRouteToAdvance && (
              <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                Select a segregation route (A–D) under RTO details and Save
                before advancing. Route decides scrutiny vs LL-test vs approval
                path.
              </p>
            )}
            <Textarea
              placeholder="Optional note for the timeline (reason, remarks…)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mb-2 h-16 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              {failure && !isLLExpiryStatus(application.status) ? (
                <Button
                  size="sm"
                  disabled={isBusy}
                  onClick={() => {
                    onTransition(
                      failure.recoverTo,
                      note || "Recovered from failure",
                    );
                    setNote("");
                  }}
                >
                  <ArrowRight className="mr-1 h-4 w-4" />
                  Resume: {llStageLabel(failure.recoverTo)}
                </Button>
              ) : (
                advanceTargets.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    disabled={isBusy || needsRouteToAdvance}
                    onClick={() => {
                      const extra: Partial<LLApplication> = {};
                      if (t === "ob_form_enabled") {
                        extra.ll_type = "with_classes";
                      } else if (t === "ll_maturing") {
                        extra.ll_type = "direct_dl";
                      }
                      // Keep expiry / maturity in sync whenever we know the
                      // issue date (draft takes precedence over saved value).
                      const issue =
                        (draft.ll_issue_date as string | null | undefined) ??
                        application.ll_issue_date;
                      if (issue) {
                        extra.ll_expiry_date = calcLLExpiryDate(issue);
                        extra.ll_matures_at = calcLLMaturityDate(issue);
                      }
                      if (
                        draft.batch_code &&
                        isLLSegregationRouteCode(String(draft.batch_code))
                      ) {
                        extra.batch_code = draft.batch_code as string;
                      }
                      onTransition(
                        t,
                        note || undefined,
                        Object.keys(extra).length ? extra : undefined,
                      );
                      setNote("");
                    }}
                  >
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                    {llStageLabel(t)}
                  </Button>
                ))
              )}
              {isLLExpiryStatus(application.status) && (
                <p className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  This expiry stage has no forward action. Use Revert stage to
                  restart the application from the appropriate point.
                </p>
              )}
              {failureOptions.map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant="outline"
                  className="border-red-300 text-red-600 hover:bg-red-50"
                  disabled={isBusy}
                  onClick={() => {
                    const extra: Partial<LLApplication> | undefined =
                      f.key === "call_missed"
                        ? {
                            call_missed_count:
                              (application.call_missed_count ?? 0) + 1,
                          }
                        : undefined;
                    onTransition(f.key, note || undefined, extra);
                    setNote("");
                  }}
                >
                  <XCircle className="mr-1 h-4 w-4" />
                  {f.label}
                  {f.key === "call_missed" &&
                    (application.call_missed_count ?? 0) > 0 &&
                    ` (${application.call_missed_count} so far)`}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                className={
                  application.escalated
                    ? "border-green-400 text-green-700 hover:bg-green-50"
                    : "border-amber-400 text-amber-700 hover:bg-amber-50"
                }
                disabled={isBusy}
                onClick={() =>
                  onSaveFields({
                    escalated: !application.escalated,
                    escalation_reason: application.escalated
                      ? null
                      : note || "Escalated by Ops",
                  })
                }
              >
                <AlertTriangle className="mr-1 h-4 w-4" />
                {application.escalated ? "Clear escalation" : "Escalate"}
              </Button>
              {revertTargets.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-slate-400 text-slate-700 hover:bg-slate-50"
                  disabled={isBusy}
                  onClick={() => {
                    setRevertTarget(
                      revertTargets[revertTargets.length - 1] ?? "",
                    );
                    setRevertReason("");
                    setRevertOpen(true);
                  }}
                >
                  <Undo2 className="mr-1 h-4 w-4" />
                  Revert stage
                </Button>
              )}
            </div>
            {application.escalated && (
              <p className="mt-2 text-xs text-amber-700">
                Escalated:{" "}
                {application.escalation_reason || "no reason recorded"}
              </p>
            )}
          </div>

          <Dialog
            open={revertOpen}
            onOpenChange={(open) => {
              setRevertOpen(open);
              if (!open) {
                setRevertReason("");
                setRevertTarget("");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Revert application stage</DialogTitle>
                <DialogDescription>
                  Move this application back to an earlier stage to fix a
                  mistaken promotion. A reason is required and will be stored on
                  the timeline. The customer will not get a WhatsApp for this
                  change.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    Current stage
                  </label>
                  <Input
                    className="h-8 bg-gray-50 text-sm"
                    readOnly
                    value={llStageLabel(application.status)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    Revert to
                  </label>
                  <Select
                    value={revertTarget || undefined}
                    onValueChange={setRevertTarget}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Pick an earlier stage" />
                    </SelectTrigger>
                    <SelectContent>
                      {revertTargets.map((t) => (
                        <SelectItem key={t} value={t}>
                          {llStageLabel(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-600">
                    Reason (required)
                  </label>
                  <Textarea
                    placeholder="Why is this stage being reverted?"
                    value={revertReason}
                    onChange={(e) => setRevertReason(e.target.value)}
                    className="h-20 text-sm"
                  />
                </div>
                <p className="text-xs text-gray-500">
                  Fields that only apply after the target stage (LL/DL numbers,
                  test dates, etc.) will be cleared automatically.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setRevertOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={isBusy || !revertTarget || !revertReason.trim()}
                    onClick={() => {
                      onRevert(revertTarget, revertReason.trim());
                      setRevertOpen(false);
                      setRevertReason("");
                      setRevertTarget("");
                    }}
                  >
                    <Undo2 className="mr-1 h-4 w-4" />
                    Confirm revert
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Customer's form submission + uploaded documents */}
          <LLDocumentsReview application={application} actorName={actorName} />

          {/* Issued licence uploads — power the customer's download buttons */}
          <LLCardUpload
            application={application}
            actorName={actorName}
            docType="ll_card"
          />
          <LLCardUpload
            application={application}
            actorName={actorName}
            docType="dl_card"
          />

          {/* Ops data entry */}
          <div className="rounded-md border p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              RTO details
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="LL Application Number">
                <Input
                  className="h-8 text-sm"
                  value={value("application_number")}
                  onChange={(e) =>
                    setValue("application_number", e.target.value)
                  }
                />
              </Field>
              <Field label="Date of Birth">
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={value("date_of_birth")}
                  onChange={(e) => setValue("date_of_birth", e.target.value)}
                />
              </Field>
              <Field label="LL Application Date">
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={value("application_date")}
                  onChange={(e) => setValue("application_date", e.target.value)}
                />
              </Field>
              <Field
                label="Segregation route"
                className="col-span-2 md:col-span-3"
              >
                <Select
                  value={
                    isLLSegregationRouteCode(value("batch_code"))
                      ? value("batch_code")
                      : undefined
                  }
                  onValueChange={(v) => setValue("batch_code", v)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Pick route A / B / C / D" />
                  </SelectTrigger>
                  <SelectContent>
                    {LL_SEGREGATION_ROUTES.map((r) => (
                      <SelectItem key={r.code} value={r.code}>
                        {r.code} — {r.name} ({r.namingSchema})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {value("batch_code") &&
                  !isLLSegregationRouteCode(value("batch_code")) && (
                    <p className="mt-1 text-xs text-amber-700">
                      Legacy batch code “{value("batch_code")}” — re-select a
                      route A–D and save.
                    </p>
                  )}
                {isLLSegregationRouteCode(value("batch_code")) && (
                  <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                    <p className="mb-1 font-medium text-gray-800">
                      {llSegregationRouteLabel(value("batch_code"))}
                    </p>
                    <p className="mb-2 text-gray-600">
                      {
                        LL_SEGREGATION_ROUTES.find(
                          (r) => r.code === value("batch_code"),
                        )?.who
                      }
                    </p>
                    <ul className="grid gap-0.5 sm:grid-cols-2">
                      {llSegregationRouteChecklist(value("batch_code")).map(
                        (line) => (
                          <li key={line}>• {line}</li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
              </Field>
              <Field label="Scrutiny Approved Date">
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={value("scrutiny_approved_date")}
                  onChange={(e) =>
                    setValue("scrutiny_approved_date", e.target.value)
                  }
                />
              </Field>
              <Field label="Scrutiny Expiry Date (auto: +7 days)">
                <Input
                  className="h-8 bg-gray-50 text-sm"
                  readOnly
                  tabIndex={-1}
                  value={
                    value("scrutiny_approved_date")
                      ? format(
                          addDays(new Date(value("scrutiny_approved_date")), 7),
                          "dd-MM-yyyy",
                        )
                      : "—"
                  }
                />
              </Field>
              <Field label="LL Number">
                <Input
                  className="h-8 text-sm"
                  value={value("ll_number")}
                  onChange={(e) => setValue("ll_number", e.target.value)}
                />
              </Field>
              <Field label="LL Issue Date">
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={value("ll_issue_date")}
                  onChange={(e) => setLLIssueDate(e.target.value)}
                />
              </Field>
              <Field label="LL Valid Till (auto: +6 months − 1 day)">
                <Input
                  type="date"
                  className="h-8 bg-gray-50 text-sm"
                  readOnly
                  tabIndex={-1}
                  value={derivedExpiry}
                />
              </Field>
              <Field label="Reapply Govt Fee (Rs.)">
                <Input
                  type="number"
                  className="h-8 text-sm"
                  placeholder="Quoted when scrutiny expires"
                  value={value("reapply_fee")}
                  onChange={(e) => setValue("reapply_fee", e.target.value)}
                />
              </Field>
              <Field label="LL Matures On (auto: +1 month)">
                <Input
                  type="date"
                  className="h-8 bg-gray-50 text-sm"
                  readOnly
                  tabIndex={-1}
                  value={derivedMaturity}
                />
              </Field>
              <Field label="DL Test Application Number">
                <Input
                  className="h-8 text-sm"
                  value={value("dl_application_number")}
                  onChange={(e) =>
                    setValue("dl_application_number", e.target.value)
                  }
                />
              </Field>
              <Field label="DL Test Application Date">
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={value("dl_application_date")}
                  onChange={(e) =>
                    setValue("dl_application_date", e.target.value)
                  }
                />
              </Field>
              <Field label="Customer's Preferred DL Slot">
                <Input
                  className="h-8 bg-gray-50 text-sm"
                  readOnly
                  tabIndex={-1}
                  value={
                    application.dl_preferred_date
                      ? `${format(
                          new Date(application.dl_preferred_date),
                          "dd-MM-yyyy",
                        )} · ${application.dl_preferred_rto ?? ""}`
                      : "— not picked yet —"
                  }
                />
              </Field>
              <Field label="DL Test Date">
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={value("dl_test_date")}
                  onChange={(e) => setValue("dl_test_date", e.target.value)}
                />
              </Field>
              <Field label="DL Test Time">
                <Input
                  className="h-8 text-sm"
                  placeholder="e.g. 10:30 AM"
                  value={value("dl_test_time")}
                  onChange={(e) => setValue("dl_test_time", e.target.value)}
                />
              </Field>
              <Field label="DL Test RTO">
                <Input
                  className="h-8 text-sm"
                  value={value("dl_test_rto")}
                  onChange={(e) => setValue("dl_test_rto", e.target.value)}
                />
              </Field>
              <Field label="DL Test RTO Address" className="col-span-2">
                <Input
                  className="h-8 text-sm"
                  placeholder="Shown on the customer's Get Directions button"
                  value={value("dl_test_rto_address")}
                  onChange={(e) =>
                    setValue("dl_test_rto_address", e.target.value)
                  }
                />
              </Field>
              <Field label="DL Retest Fee (Rs.)">
                <Input
                  type="number"
                  className="h-8 text-sm"
                  placeholder="Quoted if the test is failed"
                  value={value("dl_retest_fee")}
                  onChange={(e) => setValue("dl_retest_fee", e.target.value)}
                />
              </Field>
              <Field label="DL Number">
                <Input
                  className="h-8 text-sm"
                  value={value("dl_number")}
                  onChange={(e) => setValue("dl_number", e.target.value)}
                />
              </Field>
              <Field label="DL Valid Till">
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={value("dl_expiry_date")}
                  onChange={(e) => setValue("dl_expiry_date", e.target.value)}
                />
              </Field>
              <Field label="DL Card Expected Delivery">
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={value("dl_dispatch_eta")}
                  onChange={(e) => setValue("dl_dispatch_eta", e.target.value)}
                />
              </Field>
              <Field label="DL Card Tracking Ref">
                <Input
                  className="h-8 text-sm"
                  placeholder="Courier / Speed Post reference"
                  value={value("dl_tracking_ref")}
                  onChange={(e) => setValue("dl_tracking_ref", e.target.value)}
                />
              </Field>
              <Field
                label="Rejection Reason"
                className="col-span-2 md:col-span-3"
              >
                <Input
                  className="h-8 text-sm"
                  placeholder="Latest scrutiny / approval rejection reason"
                  value={value("rejection_reason")}
                  onChange={(e) => setValue("rejection_reason", e.target.value)}
                />
              </Field>
            </div>

            {/* Services */}
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-gray-500">
                Services on this application
              </div>
              <div className="flex flex-wrap gap-1">
                {LL_SERVICES.map((s) => {
                  const active = services.includes(s.key);
                  return (
                    <button
                      key={s.key}
                      onClick={() =>
                        setDraft((p) => ({
                          ...p,
                          services: active
                            ? services.filter((k) => k !== s.key)
                            : [...services, s.key],
                        }))
                      }
                      className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                disabled={isBusy || Object.keys(draft).length === 0}
                onClick={() => {
                  const fields: Partial<LLApplication> = { ...draft };
                  const issue =
                    (fields.ll_issue_date as string | null | undefined) ??
                    application.ll_issue_date;
                  if (issue) {
                    fields.ll_expiry_date = calcLLExpiryDate(issue);
                    fields.ll_matures_at = calcLLMaturityDate(issue);
                  }
                  onSaveFields(fields);
                  setDraft({});
                }}
              >
                Save details
              </Button>
            </div>
          </div>

          {/* Timeline */}
          <div className="rounded-md border p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Timeline
            </div>
            <ScrollArea className="max-h-64">
              {(events ?? []).length === 0 ? (
                <p className="text-sm text-gray-400">No events yet.</p>
              ) : (
                <ul className="space-y-2">
                  {(events ?? []).map((e) => (
                    <li key={e.id} className="flex gap-2 text-sm">
                      {e.event_type === "status_reversal" ? (
                        <Undo2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      ) : (
                        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                      )}
                      <div>
                        <div>
                          {e.event_type === "status_change" ||
                          e.event_type === "status_reversal" ? (
                            <>
                              {e.event_type === "status_reversal" && (
                                <span className="mr-1 font-medium text-amber-700">
                                  Reverted:
                                </span>
                              )}
                              {e.from_status ? (
                                <>
                                  <span className="text-gray-500">
                                    {llStageLabel(e.from_status)}
                                  </span>{" "}
                                  →{" "}
                                </>
                              ) : null}
                              <span className="font-medium">
                                {e.to_status ? llStageLabel(e.to_status) : ""}
                              </span>
                            </>
                          ) : e.event_type === "field_update" ? (
                            <span>
                              {e.changes
                                .map(
                                  (c) =>
                                    `${c.label}: ${c.old ?? "—"} → ${
                                      Array.isArray(c.new)
                                        ? c.new.join(", ")
                                        : (c.new ?? "—")
                                    }`,
                                )
                                .join("; ")}
                            </span>
                          ) : (
                            <span>{e.note}</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400">
                          {format(new Date(e.created_at), "dd MMM yyyy, HH:mm")}
                          {e.actor_name ? ` · ${e.actor_name}` : ""}
                          {(e.event_type === "status_change" ||
                            e.event_type === "status_reversal") &&
                          e.note
                            ? ` · ${e.note}`
                            : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Upload (or replace) the issued LL / DL PDF-image. The customer homepage
 * shows the matching "Download LL"/"Download DL" button as soon as one
 * exists.
 */
function LLCardUpload({
  application,
  actorName,
  docType,
}: {
  application: LLApplication;
  actorName: string | null;
  docType: "ll_card" | "dl_card";
}) {
  const { toast } = useToast();
  const { data: documents } = useLLDocuments(application.id);
  const upload = useUploadLLCard();
  const card = (documents ?? []).find((d) => d.doc_type === docType);
  const label = docType === "dl_card" ? "DL" : "LL";

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
        Issued {label} (customer download)
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {card ? (
          <a
            href={llDocumentUrl(card)}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary underline"
          >
            {card.file_name ?? `${label} card`}
          </a>
        ) : (
          <span className="text-sm text-gray-400">
            No {label} uploaded yet — the customer&apos;s Download {label}{" "}
            button stays hidden.
          </span>
        )}
        <label className="cursor-pointer rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50">
          {upload.isPending
            ? "Uploading…"
            : card
              ? "Replace file"
              : `Upload ${label} PDF/image`}
          <input
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            disabled={upload.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              upload.mutate(
                { application, file, actorName, docType },
                {
                  onSuccess: () => toast({ title: `${label} uploaded` }),
                  onError: (err: Error) =>
                    toast({
                      title: "Upload failed",
                      description: err.message,
                      variant: "destructive",
                    }),
                },
              );
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      {children}
    </div>
  );
}

function NewApplicationButton({
  actorName,
  onOpenApplication,
}: {
  actorName: string | null;
  onOpenApplication: (application: LLApplication) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(
    null,
  );
  const [services, setServices] = useState<string[]>(["ll"]);
  const { data: results } = useLLLearnerSearch(term);
  const createMutation = useCreateLLApplication();
  const {
    data: activeApplication,
    isPending: isCheckingApplication,
    isFetching: isRefreshingApplication,
    isError: applicationCheckFailed,
    refetch: recheckApplication,
  } = useActiveLLApplication(open ? selectedLearnerId : null);

  const resetDialog = () => {
    setOpen(false);
    setTerm("");
    setSelectedLearnerId(null);
    setServices(["ll"]);
  };

  const create = () => {
    if (!selectedLearnerId) return;
    createMutation.mutate(
      { learnerId: selectedLearnerId, services, actorName },
      {
        onSuccess: (result) => {
          if (result.kind === "existing") {
            toast({
              title: "An active journey already exists",
              description: "Open the existing journey to continue.",
            });
            return;
          }
          toast({ title: "Application created" });
          resetDialog();
        },
        onError: (e: Error) =>
          toast({
            title: "Error",
            description: e.message.includes(
              "idx_ll_applications_learner_active",
            )
              ? "This learner already has an active LL application."
              : e.message,
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> New Application
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!createMutation.isPending) {
            if (nextOpen) setOpen(true);
            else resetDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start an LL → DL journey</DialogTitle>
            <DialogDescription>
              Pick the learner and the services sold. The application starts at
              “Payment Received”.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Search learner by name / phone / email (min 3 chars)"
              value={term}
              disabled={createMutation.isPending}
              onChange={(e) => {
                setTerm(e.target.value);
                setSelectedLearnerId(null);
              }}
            />
            {term.trim().length >= 3 && (
              <div className="max-h-40 overflow-y-auto rounded-md border">
                {(results ?? []).map(
                  (l: {
                    id: string;
                    name: string | null;
                    phone: string | null;
                  }) => (
                    <button
                      key={l.id}
                      disabled={createMutation.isPending}
                      onClick={() => setSelectedLearnerId(l.id)}
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                        selectedLearnerId === l.id ? "bg-indigo-50" : ""
                      }`}
                    >
                      <span className="font-medium">{l.name}</span>{" "}
                      <span className="text-gray-500">{l.phone}</span>
                    </button>
                  ),
                )}
                {(results ?? []).length === 0 && (
                  <p className="px-3 py-2 text-sm text-gray-400">No matches.</p>
                )}
              </div>
            )}
            {selectedLearnerId && (
              <div className="rounded-md border p-3 text-sm" role="status">
                {isCheckingApplication || isRefreshingApplication ? (
                  <p>Checking for an active journey…</p>
                ) : applicationCheckFailed ? (
                  <div>
                    <p>
                      Could not check for an existing journey. Please retry.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => recheckApplication()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : activeApplication ? (
                  <div>
                    <p className="font-medium">
                      This learner already has an active journey.
                    </p>
                    <p>
                      Current stage: {llStageLabel(activeApplication.status)}
                    </p>
                    <p className="mt-1 text-gray-500">
                      Open it to continue with its existing progress, documents,
                      and services.
                    </p>
                  </div>
                ) : (
                  <p>No active journey. You can create a new application.</p>
                )}
              </div>
            )}
            {!activeApplication && (
              <div>
                <div className="mb-1 text-xs font-medium text-gray-500">
                  Services
                </div>
                <div className="flex flex-wrap gap-1">
                  {LL_SERVICES.map((s) => {
                    const active = services.includes(s.key);
                    return (
                      <button
                        key={s.key}
                        onClick={() =>
                          setServices((prev) =>
                            active
                              ? prev.filter((k) => k !== s.key)
                              : [...prev, s.key],
                          )
                        }
                        className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={createMutation.isPending}
                onClick={resetDialog}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (activeApplication) {
                    onOpenApplication(activeApplication);
                    resetDialog();
                  } else create();
                }}
                disabled={
                  !selectedLearnerId ||
                  createMutation.isPending ||
                  isCheckingApplication ||
                  isRefreshingApplication ||
                  applicationCheckFailed
                }
              >
                {createMutation.isPending
                  ? "Creating…"
                  : activeApplication
                    ? "Open existing journey"
                    : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
