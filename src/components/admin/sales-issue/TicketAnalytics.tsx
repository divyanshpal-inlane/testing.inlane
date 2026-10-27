import { AlertTriangle, Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import type { TicketStatus } from "@/lib/sales-issue-tickets/validation";
import type { TicketStats } from "@/queries/salesIssueTickets";

const hours = (h: number | null) => {
  if (h === null || h === undefined) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
};

function Stat({
  label,
  value,
  tone,
  hint,
  onClick,
  active,
}: {
  label: string;
  value: string | number;
  tone: string;
  hint?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      className={`rounded-lg border bg-white p-3 text-left ${
        onClick ? "transition hover:shadow-md" : ""
      } ${active ? "ring-2 ring-primary" : ""}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </Tag>
  );
}

export default function TicketAnalytics({
  stats,
  isLoading,
  isFetching,
  error,
  scope,
  statusFilter,
  onStatusClick,
}: {
  stats: TicketStats | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  scope: string;
  statusFilter: TicketStatus | "all";
  onStatusClick: (s: TicketStatus | "all") => void;
}) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !stats) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Couldn&apos;t load analytics
          {error ? `: ${error.message}` : "."}
        </AlertDescription>
      </Alert>
    );
  }

  const resolvedPct = stats.total
    ? Math.round((stats.resolved / stats.total) * 100)
    : 0;

  return (
    <Card>
      <CardContent
        className={`space-y-4 p-3 sm:p-4 ${isFetching ? "opacity-70" : ""}`}
        data-testid="ticket-analytics"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Analytics</h2>
          <span className="text-xs text-muted-foreground">{scope}</span>
        </div>

        {/* Ticket counts (click to filter the table) */}
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-5"
          data-testid="ticket-counts"
        >
          <Stat
            label="Total tickets"
            value={stats.total}
            tone="text-foreground"
            onClick={() => onStatusClick("all")}
            active={statusFilter === "all"}
          />
          <Stat
            label="To Do"
            value={stats.to_do}
            tone="text-amber-700"
            onClick={() => onStatusClick("To Do")}
            active={statusFilter === "To Do"}
          />
          <Stat
            label="In Progress"
            value={stats.in_progress}
            tone="text-blue-700"
            onClick={() => onStatusClick("In Progress")}
            active={statusFilter === "In Progress"}
          />
          <Stat
            label="Resolved"
            value={stats.resolved}
            tone="text-emerald-700"
            hint={`${resolvedPct}% resolved`}
            onClick={() => onStatusClick("Resolved")}
            active={statusFilter === "Resolved"}
          />
          <Stat
            label="Open (To Do + In Progress)"
            value={stats.to_do + stats.in_progress}
            tone="text-foreground"
            hint="Still needs work"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Raised today"
            value={stats.raised_today}
            tone="text-foreground"
          />
          <Stat
            label="Avg. time to resolve"
            value={hours(stats.avg_resolution_hours)}
            tone="text-foreground"
            hint="Created → last update"
          />
          <Stat
            label="Oldest open"
            value={hours(stats.oldest_open_hours)}
            tone={
              stats.oldest_open_hours && stats.oldest_open_hours > 48
                ? "text-red-700"
                : "text-foreground"
            }
            hint="Still not resolved"
          />
          <Stat
            label="E-mail not sent"
            value={stats.email_not_sent}
            tone={stats.email_not_sent ? "text-red-700" : "text-foreground"}
            hint={stats.email_not_sent ? "Retry from details" : "All delivered"}
          />
        </div>
      </CardContent>
    </Card>
  );
}
