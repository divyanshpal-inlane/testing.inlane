import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  MailWarning,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import TicketAnalytics from "@/components/admin/sales-issue/TicketAnalytics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useStaffPermission } from "@/hooks/useStaffPermission";
import {
  DATE_PRESETS,
  type DatePreset,
  resolveDateRange,
  validateCustomRange,
} from "@/lib/sales-issue-tickets/dateFilters";
import {
  TICKET_STATUSES,
  type TicketStatus,
} from "@/lib/sales-issue-tickets/validation";
import {
  type SalesIssueTicket,
  TICKETS_PAGE_SIZE,
  useRetryTicketNotification,
  useSalesIssueTickets,
  useSalesIssueTicketStats,
  useUpdateTicketStatus,
} from "@/queries/salesIssueTickets";

const STATUS_STYLE: Record<TicketStatus, string> = {
  "To Do": "border-amber-200 bg-amber-100 text-amber-800",
  "In Progress": "border-blue-200 bg-blue-100 text-blue-800",
  Resolved: "border-emerald-200 bg-emerald-100 text-emerald-800",
};

function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge variant="outline" className={STATUS_STYLE[status]}>
      {status}
    </Badge>
  );
}

const raisedByLabel = (t: SalesIssueTicket) =>
  t.raised_by_name || t.raised_by_email || "—";

const when = (iso: string) => format(new Date(iso), "d MMM yyyy, h:mm a");

function StatusSelect({
  ticket,
  onChange,
  disabled,
  label,
}: {
  ticket: SalesIssueTicket;
  onChange: (s: TicketStatus) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Select
      value={ticket.status}
      onValueChange={(v) => onChange(v as TicketStatus)}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-[130px]" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TICKET_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DetailDialog({
  ticket,
  onClose,
  onStatus,
  statusBusy,
  onRetry,
  retryBusy,
}: {
  ticket: SalesIssueTicket;
  onClose: () => void;
  onStatus: (s: TicketStatus) => void;
  statusBusy: boolean;
  onRetry: () => void;
  retryBusy: boolean;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">
            {ticket.ticket_number}
          </DialogTitle>
          <DialogDescription>
            Raised {when(ticket.created_at)} · updated {when(ticket.updated_at)}
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Phone number</dt>
            <dd className="font-medium">{ticket.phone_number}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Raised by</dt>
            <dd className="font-medium">
              {ticket.raised_by_name ?? "—"}
              {ticket.raised_by_email ? ` · ${ticket.raised_by_email}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Issue description</dt>
            <dd className="whitespace-pre-wrap break-words">
              {ticket.description ?? (
                <span className="text-muted-foreground">
                  No description provided
                </span>
              )}
            </dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <StatusSelect
                ticket={ticket}
                onChange={onStatus}
                disabled={statusBusy}
                label="Change ticket status"
              />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Support e-mail</dt>
            <dd>
              {ticket.notification_status === "sent" ? (
                <span className="text-emerald-700">Sent</span>
              ) : (
                <div className="space-y-2">
                  <span
                    className={
                      ticket.notification_status === "failed"
                        ? "text-red-700"
                        : "text-amber-700"
                    }
                  >
                    {ticket.notification_status === "failed"
                      ? "Failed"
                      : "Pending"}
                  </span>
                  {ticket.notification_error && (
                    <p className="break-words text-xs text-muted-foreground">
                      {ticket.notification_error}
                    </p>
                  )}
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onRetry}
                      disabled={retryBusy}
                    >
                      {retryBusy && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Retry notification
                    </Button>
                  </div>
                </div>
              )}
            </dd>
          </div>
        </dl>
      </DialogContent>
    </Dialog>
  );
}

export default function SalesIssueTickets() {
  const { toast } = useToast();
  const { allowed, isLoading: permLoading } = useStaffPermission(
    "sales_issue_tickets",
  );

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TicketStatus | "all">("all");
  const [preset, setPreset] = useState<DatePreset>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Debounce the search box; any filter change returns to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const customError =
    preset === "custom" && (customStart || customEnd)
      ? validateCustomRange(customStart, customEnd)
      : null;
  const customIncomplete = preset === "custom" && !customStart && !customEnd;

  const range = useMemo(
    () =>
      resolveDateRange(preset, new Date(), {
        start: customStart,
        end: customEnd,
      }),
    [preset, customStart, customEnd],
  );

  const { data, isLoading, isError, error, refetch, isFetching } =
    useSalesIssueTickets(
      { page, status, search, range: range ?? { from: null, to: null } },
      allowed && range !== null,
    );

  const updateStatus = useUpdateTicketStatus();
  const retry = useRetryTicketNotification();

  // Analytics follow the date range + search (the status cards double as the
  // status filter, so they always show the full split for the selection).
  const stats = useSalesIssueTicketStats(
    { range: range ?? { from: null, to: null }, search },
    allowed && range !== null,
  );

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / TICKETS_PAGE_SIZE));
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const filtersActive =
    status !== "all" || preset !== "all" || searchInput.trim() !== "";

  const reset = () => {
    setSearchInput("");
    setSearch("");
    setStatus("all");
    setPreset("all");
    setCustomStart("");
    setCustomEnd("");
    setPage(0);
  };

  const dateSummary = (() => {
    if (preset === "all") return "All dates";
    const label = DATE_PRESETS.find((p) => p.value === preset)!.label;
    if (!range || !range.from || !range.to) return label;
    const first = new Date(range.from);
    const last = new Date(new Date(range.to).getTime() - 1);
    return `${label}: ${format(first, "d MMM yyyy")} – ${format(last, "d MMM yyyy")}`;
  })();

  const changeStatus = async (t: SalesIssueTicket, next: TicketStatus) => {
    if (next === t.status) return;
    try {
      await updateStatus.mutateAsync({ ticketId: t.id, status: next });
      toast({
        title: "Status updated",
        description: `${t.ticket_number} → ${next}`,
      });
    } catch (e) {
      toast({
        title: "Couldn't update status",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const retryEmail = async (t: SalesIssueTicket) => {
    try {
      const res = await retry.mutateAsync(t.id);
      toast(
        res.ticket.notification_status === "sent"
          ? { title: "Support notified", description: t.ticket_number }
          : {
              title: "E-mail still failing",
              description: res.ticket.notification_error ?? "Try again later.",
              variant: "destructive",
            },
      );
    } catch (e) {
      toast({
        title: "Retry failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/admin" aria-label="Back to dashboard">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Escalate Issue Tracker
              </h1>
              <p className="text-sm text-muted-foreground">
                Issues reported by the Sales team.
              </p>
            </div>
          </div>
          <Link to="/admin/report-sales-issue">
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" /> Escalate an issue
            </Button>
          </Link>
        </div>

        {permLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !allowed ? (
          <Alert variant="destructive">
            <AlertTitle>No access</AlertTitle>
            <AlertDescription>
              You don&apos;t have permission to view the Escalate Issue Tracker.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Filter toolbar */}
            <Card>
              <CardContent className="space-y-3 p-3 sm:p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[200px] flex-1 space-y-1">
                    <Label htmlFor="ticket-search" className="text-xs">
                      Search
                    </Label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="ticket-search"
                        className="pl-8"
                        placeholder="Ticket ID or phone number"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Status</Label>
                    <Select
                      value={status}
                      onValueChange={(v) => {
                        setStatus(v as TicketStatus | "all");
                        setPage(0);
                      }}
                    >
                      <SelectTrigger
                        className="w-[150px]"
                        aria-label="Filter by status"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        {TICKET_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Date</Label>
                    <Select
                      value={preset}
                      onValueChange={(v) => {
                        setPreset(v as DatePreset);
                        setPage(0);
                      }}
                    >
                      <SelectTrigger
                        className="w-[190px]"
                        aria-label="Filter by date"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DATE_PRESETS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {preset === "custom" && (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor="date-from" className="text-xs">
                          From
                        </Label>
                        <Input
                          id="date-from"
                          type="date"
                          value={customStart}
                          max={customEnd || undefined}
                          onChange={(e) => {
                            setCustomStart(e.target.value);
                            setPage(0);
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="date-to" className="text-xs">
                          To
                        </Label>
                        <Input
                          id="date-to"
                          type="date"
                          value={customEnd}
                          min={customStart || undefined}
                          onChange={(e) => {
                            setCustomEnd(e.target.value);
                            setPage(0);
                          }}
                        />
                      </div>
                    </>
                  )}
                  <Button
                    variant="outline"
                    onClick={reset}
                    disabled={!filtersActive}
                  >
                    <RotateCcw className="mr-1 h-4 w-4" /> Reset
                  </Button>
                </div>
                {customError && (
                  <p role="alert" className="text-sm text-red-600">
                    {customError}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Showing: <span className="font-medium">{dateSummary}</span>
                  {status !== "all" && (
                    <>
                      {" "}
                      · Status: <span className="font-medium">{status}</span>
                    </>
                  )}
                  {search.trim() && (
                    <>
                      {" "}
                      · Search: <span className="font-medium">{search}</span>
                    </>
                  )}
                </p>
              </CardContent>
            </Card>

            {range !== null && (
              <TicketAnalytics
                stats={stats.data}
                isLoading={stats.isLoading}
                isFetching={stats.isFetching}
                error={
                  stats.error
                    ? new Error((stats.error as { message?: string }).message)
                    : null
                }
                scope={dateSummary}
                statusFilter={status}
                onStatusClick={(s) => {
                  setStatus(s);
                  setPage(0);
                }}
              />
            )}

            {/* Results */}
            {range === null ? (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  {customIncomplete
                    ? "Pick a start and end date to filter."
                    : "Fix the date range to see tickets."}
                </CardContent>
              </Card>
            ) : isLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Couldn&apos;t load tickets</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    {error instanceof Error
                      ? error.message
                      : "Something went wrong."}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => refetch()}>
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            ) : rows.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  {filtersActive
                    ? "No tickets match these filters."
                    : "No tickets have been reported yet."}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Ticket ID</th>
                          <th className="px-3 py-2">Phone Number</th>
                          <th className="px-3 py-2">Issue Description</th>
                          <th className="px-3 py-2">Raised By</th>
                          <th className="px-3 py-2">Date &amp; Time</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody
                        className={isFetching ? "opacity-60" : undefined}
                        data-testid="tickets-body"
                      >
                        {rows.map((t) => (
                          <tr key={t.id} className="border-b last:border-0">
                            <td className="whitespace-nowrap px-3 py-2 font-mono">
                              {t.ticket_number}
                              {t.notification_status !== "sent" && (
                                <MailWarning
                                  className="ml-1 inline h-3.5 w-3.5 text-amber-600"
                                  aria-label="Support e-mail not sent"
                                />
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">
                              {t.phone_number}
                            </td>
                            <td className="max-w-[260px] px-3 py-2">
                              <span
                                className="line-clamp-2 break-words"
                                title={t.description ?? undefined}
                              >
                                {t.description ?? (
                                  <span className="text-muted-foreground">
                                    No description
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-3 py-2">{raisedByLabel(t)}</td>
                            <td className="whitespace-nowrap px-3 py-2">
                              {when(t.created_at)}
                            </td>
                            <td className="px-3 py-2">
                              <StatusBadge status={t.status} />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8"
                                  aria-label={`View ${t.ticket_number}`}
                                  onClick={() => setSelectedId(t.id)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <StatusSelect
                                  ticket={t}
                                  label={`Status of ${t.ticket_number}`}
                                  disabled={updateStatus.isPending}
                                  onChange={(s) => changeStatus(t, s)}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm">
                    <span className="text-muted-foreground">
                      {total} ticket{total === 1 ? "" : "s"} · page {page + 1}{" "}
                      of {pageCount}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={page === 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" /> Prev
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={page + 1 >= pageCount}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {selected && (
        <DetailDialog
          ticket={selected}
          onClose={() => setSelectedId(null)}
          onStatus={(s) => changeStatus(selected, s)}
          statusBusy={updateStatus.isPending}
          onRetry={() => retryEmail(selected)}
          retryBusy={retry.isPending}
        />
      )}
    </div>
  );
}
