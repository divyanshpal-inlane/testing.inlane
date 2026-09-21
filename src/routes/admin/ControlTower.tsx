import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CalendarOff,
  LifeBuoy,
  Loader2,
  Siren,
  Users,
  UserX,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { llStageLabel } from "@/constants/llPipeline";
import {
  useDailyOps,
  useOpsExceptions,
  useOpsKpis,
} from "@/queries/controlTower";
import { formatINR } from "@/utils/earnings";

const hhmm = (t: string | null) => t?.slice(0, 5) ?? "—";

function StatusBadge({
  status,
  started,
}: {
  status: string | null;
  started: boolean;
}) {
  const s = status ?? "unknown";
  const cls =
    s === "completed"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : s === "ongoing" || started
        ? "bg-blue-100 text-blue-800 border-blue-200"
        : s.includes("cancel")
          ? "bg-gray-100 text-gray-500 border-gray-200"
          : "bg-amber-100 text-amber-800 border-amber-200";
  return (
    <Badge variant="outline" className={`text-[10px] capitalize ${cls}`}>
      {s === "booked" && started ? "started" : s}
    </Badge>
  );
}

function KpiCard({
  label,
  value,
  sub,
  to,
}: {
  label: string;
  value: string | number;
  sub?: string;
  to?: string;
}) {
  const body = (
    <CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </CardContent>
  );
  return to ? (
    <Link to={to}>
      <Card className="transition-colors hover:bg-muted/30">{body}</Card>
    </Link>
  ) : (
    <Card>{body}</Card>
  );
}

function OverviewTab() {
  const { data: k, isLoading } = useOpsKpis();
  if (isLoading || !k)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  const maxPhase = Math.max(1, ...k.llByPhase.map((p) => p.count));
  const actions = [
    {
      label: "Support tickets",
      count: k.actionNeeded.openTickets,
      icon: LifeBuoy,
      to: "/admin/support-tickets",
    },
    {
      label: "No-show cases",
      count: k.actionNeeded.openNoShows,
      icon: UserX,
      to: "/admin/no-shows",
    },
    {
      label: "Safety incidents",
      count: k.actionNeeded.openSafety,
      icon: Siren,
      to: "/admin/safety-monitoring",
    },
    {
      label: "Leave requests",
      count: k.actionNeeded.pendingLeave,
      icon: CalendarOff,
      to: "/admin/leave-management",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Active students"
          value={k.activeStudents}
          sub={`${k.newLearners7d} new learners in 7 days`}
          to="/admin/learner-management"
        />
        <KpiCard
          label="Classes today"
          value={k.classesToday.total}
          sub={`${k.classesToday.completed} done · ${k.classesToday.upcoming} upcoming · ${k.classesToday.cancelled} cancelled`}
        />
        <KpiCard
          label="Collections today"
          value={formatINR(k.collectionsToday)}
          to="/admin/payment-tracker"
        />
        <KpiCard
          label="Outstanding dues"
          value={formatINR(k.outstanding.amount)}
          sub={`${k.outstanding.count} half-paid enrollments`}
          to="/admin/payment-tracker"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* LL/DL pipeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>
                LL → DL pipeline{" "}
                <span className="font-normal text-muted-foreground">
                  ({k.llTotal} in progress)
                </span>
              </span>
              <span className="flex items-center gap-2">
                {k.llEscalated > 0 && (
                  <Badge
                    variant="outline"
                    className="border-red-200 bg-red-50 text-[10px] text-red-700"
                  >
                    {k.llEscalated} escalated
                  </Badge>
                )}
                <Link
                  to="/admin/ll-pipeline"
                  className="text-xs font-normal text-primary"
                >
                  Open board <ArrowUpRight className="inline h-3 w-3" />
                </Link>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {k.llByPhase.map((p) => (
              <div key={p.key} className="flex items-center gap-2 text-xs">
                <span className="w-32 shrink-0 text-muted-foreground">
                  {p.label}
                </span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded bg-primary/70"
                    style={{ width: `${(p.count / maxPhase) * 100}%` }}
                  />
                </div>
                <span className="w-6 text-right tabular-nums">{p.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Action needed */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Action needed</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 pt-0">
            {actions.map(({ label, count, icon: Icon, to }) => (
              <Link
                key={label}
                to={to}
                className={`flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/30 ${
                  count > 0 ? "border-amber-200 bg-amber-50/50" : ""
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${count > 0 ? "text-amber-600" : "text-muted-foreground"}`}
                />
                <span className="flex-1">{label}</span>
                <span
                  className={`font-bold tabular-nums ${count > 0 ? "text-amber-700" : ""}`}
                >
                  {count}
                </span>
              </Link>
            ))}
            <Link
              to="/admin/instructor-performance"
              className="col-span-2 flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/30"
            >
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">Instructor performance dashboard</span>
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TodayTab() {
  const { data: rows, isLoading } = useDailyOps();
  if (isLoading)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  if (!rows || rows.length === 0)
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No classes scheduled today.
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Slot</th>
              <th className="p-3 font-medium">Student</th>
              <th className="p-3 font-medium">Instructor</th>
              <th className="p-3 font-medium">Lesson</th>
              <th className="p-3 font-medium">Class</th>
              <th className="p-3 font-medium">Payment</th>
              <th className="p-3 font-medium">LL status</th>
              <th className="p-3 font-medium">Next action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.scheduleId}
                className="border-b last:border-0 hover:bg-muted/20"
              >
                <td className="p-3 tabular-nums">
                  {hhmm(r.startTime)}–{hhmm(r.endTime)}
                </td>
                <td className="p-3">
                  <div className="font-medium">{r.learnerName ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.learnerPhone}
                    {r.learnerArea ? ` · ${r.learnerArea}` : ""}
                  </div>
                </td>
                <td className="p-3">{r.instructorName ?? "—"}</td>
                <td className="p-3 tabular-nums">
                  {r.lessonNumber != null ? `#${r.lessonNumber}` : "—"}
                </td>
                <td className="p-3">
                  <StatusBadge status={r.status} started={r.started} />
                </td>
                <td className="p-3">
                  {r.paymentStatus === "half_paid" ? (
                    <Badge
                      variant="outline"
                      className="border-red-200 bg-red-50 text-[10px] text-red-700"
                    >
                      half paid
                    </Badge>
                  ) : (
                    <span className="text-xs capitalize text-muted-foreground">
                      {r.paymentStatus?.replace(/_/g, " ") ?? "—"}
                    </span>
                  )}
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {r.llStatus ? llStageLabel(r.llStatus) : "—"}
                </td>
                <td className="p-3 text-xs">
                  {r.nextAction ? (
                    <span className="font-medium text-amber-700">
                      {r.nextAction}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function ExceptionSection({
  title,
  count,
  to,
  toLabel,
  children,
}: {
  title: string;
  count: number;
  to?: string;
  toLabel?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            {title}
            <Badge
              variant="outline"
              className={
                count > 0
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "bg-gray-100 text-gray-500"
              }
            >
              {count}
            </Badge>
          </span>
          {to && (
            <Link to={to} className="text-xs font-normal text-primary">
              {toLabel ?? "Open"} <ArrowUpRight className="inline h-3 w-3" />
            </Link>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {count === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing pending. 🎉</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function ExceptionsTab() {
  const { data: ex, isLoading } = useOpsExceptions();
  if (isLoading || !ex)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  const cap = <T,>(arr: T[]) => arr.slice(0, 8);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ExceptionSection
        title="Missed classes (last 7 days)"
        count={ex.missedClasses.length}
        to="/admin/no-shows"
        toLabel="No-show cases"
      >
        <div className="space-y-1.5">
          {cap(ex.missedClasses).map((m) => (
            <div key={m.scheduleId} className="flex justify-between text-xs">
              <span>
                {m.learnerName ?? "Learner"}{" "}
                <span className="text-muted-foreground">
                  w/ {m.instructorName ?? "—"}
                </span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {format(new Date(m.date), "d MMM")} {hhmm(m.startTime)}
              </span>
            </div>
          ))}
        </div>
      </ExceptionSection>

      <ExceptionSection
        title="Overdue payments"
        count={ex.overduePayments.length}
        to="/admin/payment-tracker"
        toLabel="Payment tracker"
      >
        <div className="space-y-1.5">
          {cap(ex.overduePayments).map((p) => (
            <div key={p.enrollmentId} className="flex justify-between text-xs">
              <span>
                {p.learnerName ?? "Learner"}
                <span className="text-muted-foreground">
                  {" "}
                  · {p.learnerPhone ?? ""}
                </span>
              </span>
              <span className="font-medium tabular-nums text-red-600">
                {formatINR(p.dueAmount)}
              </span>
            </div>
          ))}
        </div>
      </ExceptionSection>

      <ExceptionSection
        title="Stalled LL/DL cases"
        count={ex.stalledLL.length}
        to="/admin/ll-pipeline"
        toLabel="Pipeline board"
      >
        <div className="space-y-1.5">
          {cap(ex.stalledLL).map((a) => (
            <div
              key={a.applicationId}
              className="flex justify-between gap-2 text-xs"
            >
              <span className="min-w-0 truncate">
                {a.escalated && (
                  <AlertTriangle className="mr-1 inline h-3 w-3 text-red-500" />
                )}
                {a.learnerName ?? "Learner"}
                <span className="text-muted-foreground">
                  {" "}
                  · {llStageLabel(a.status)}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {a.daysStuck}d stuck
              </span>
            </div>
          ))}
        </div>
      </ExceptionSection>

      <ExceptionSection
        title={`Inactive students (7+ days, active enrollment)`}
        count={ex.inactiveStudents.length}
        to="/admin/schedules"
        toLabel="Schedules"
      >
        <div className="space-y-1.5">
          {cap(ex.inactiveStudents).map((s) => (
            <div key={s.learnerId} className="flex justify-between text-xs">
              <span>
                {s.learnerName ?? "Learner"}
                <span className="text-muted-foreground">
                  {" "}
                  · {s.learnerPhone ?? ""}
                </span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {s.lastClassDate
                  ? `last class ${format(new Date(s.lastClassDate), "d MMM")}`
                  : "no classes yet"}
              </span>
            </div>
          ))}
        </div>
      </ExceptionSection>
    </div>
  );
}

export default function ControlTower() {
  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center gap-3">
          <Link to="/admin">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">
              Operations Control Tower
            </h1>
            <p className="text-sm text-muted-foreground">
              Live view of students, classes, payments, LL/DL pipeline and
              exceptions — {format(new Date(), "EEEE d MMMM")}.
            </p>
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="today">Today's operations</TabsTrigger>
            <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="today" className="mt-4">
            <TodayTab />
          </TabsContent>
          <TabsContent value="exceptions" className="mt-4">
            <ExceptionsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
