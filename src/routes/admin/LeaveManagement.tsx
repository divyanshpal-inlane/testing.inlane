import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Phone,
  UserCheck,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentAdmin } from "@/queries/adminPermissions";
import {
  AffectedLesson,
  LeaveRequestWithInstructor,
  LeaveStatus,
  useAllLeaveRequests,
  useLeaveAffectedLessons,
  useReassignLesson,
  useReplacementCandidates,
  useReviewLeaveRequest,
  useRevokeLeave,
} from "@/queries/leave";

const STATUS_STYLE: Record<LeaveStatus, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-200",
};

const fmtRange = (r: LeaveRequestWithInstructor) => {
  const f = format(new Date(r.from_date), "EEE d MMM");
  const t = format(new Date(r.to_date), "EEE d MMM yyyy");
  const days =
    r.from_date === r.to_date
      ? format(new Date(r.from_date), "EEE d MMM yyyy")
      : `${f} – ${t}`;
  const time = r.all_day
    ? "All day"
    : `${r.start_time?.slice(0, 5) ?? ""}–${r.end_time?.slice(0, 5) ?? ""}`;
  return `${days} · ${time}`;
};

// Rank order: pending first, emergency before planned, then most recent.
const sortRequests = (rows: LeaveRequestWithInstructor[]) =>
  [...rows].sort((a, b) => {
    if ((a.status === "pending") !== (b.status === "pending"))
      return a.status === "pending" ? -1 : 1;
    if ((a.leave_type === "emergency") !== (b.leave_type === "emergency"))
      return a.leave_type === "emergency" ? -1 : 1;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });

// One affected booked lesson + its ranked replacement candidates.
function AffectedLessonRow({
  lesson,
  onLeaveInstructorId,
}: {
  lesson: AffectedLesson;
  onLeaveInstructorId: string;
}) {
  const { data: candidates, isLoading } = useReplacementCandidates({
    scheduleId: lesson.scheduleId,
    date: lesson.date,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    learnerArea: lesson.learnerArea,
    onLeaveInstructorId,
  });
  const reassign = useReassignLesson();
  const { toast } = useToast();

  const assign = async (newInstructorId: string, name: string | null) => {
    try {
      await reassign.mutateAsync({
        scheduleId: lesson.scheduleId,
        newInstructorId,
      });
      toast({ title: `Reassigned to ${name ?? "instructor"}` });
    } catch (e) {
      toast({
        title: "Couldn't reassign",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="rounded-md border bg-gray-50 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {format(new Date(lesson.date), "EEE d MMM")} ·{" "}
          {lesson.startTime?.slice(0, 5)}–{lesson.endTime?.slice(0, 5)}
        </span>
        {lesson.lessonNumber != null && (
          <span className="text-xs text-muted-foreground">
            Lesson {lesson.lessonNumber}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {lesson.learnerName ?? "Learner"}
        {lesson.learnerArea ? ` · ${lesson.learnerArea}` : ""}
      </div>

      <div className="mt-2">
        {isLoading ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Finding replacements…
          </span>
        ) : !candidates || candidates.length === 0 ? (
          <span className="flex items-center gap-1 text-xs font-medium text-amber-600">
            <AlertTriangle className="h-3 w-3" /> No free instructor for this
            slot
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {candidates.slice(0, 5).map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={reassign.isPending}
                onClick={() => assign(c.id, c.name)}
              >
                <UserCheck className="mr-1 h-3 w-3" />
                {c.name ?? "Instructor"}
                {c.sameArea && (
                  <span className="ml-1 rounded bg-emerald-100 px-1 text-[9px] text-emerald-700">
                    same area
                  </span>
                )}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewDialog({
  request,
  onClose,
}: {
  request: LeaveRequestWithInstructor;
  onClose: () => void;
}) {
  const { data: admin } = useCurrentAdmin();
  const review = useReviewLeaveRequest();
  const revoke = useRevokeLeave();
  const { data: affected, isLoading: lessonsLoading } =
    useLeaveAffectedLessons(request);
  const { toast } = useToast();
  const [note, setNote] = useState(request.admin_note ?? "");

  const act = async (action: "approve" | "reject") => {
    try {
      await review.mutateAsync({
        request,
        action,
        adminNote: note.trim() || undefined,
        reviewerName: admin?.name ?? "Admin",
      });
      toast({
        title: action === "approve" ? "Leave approved" : "Leave rejected",
      });
      if (action === "reject") onClose();
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const doRevoke = async () => {
    try {
      await revoke.mutateAsync(request);
      toast({ title: "Leave revoked" });
      onClose();
    } catch (e) {
      toast({
        title: "Couldn't revoke",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {request.instructorName ?? "Instructor"}
            {request.leave_type === "emergency" && (
              <Badge
                variant="outline"
                className="border-red-200 bg-red-50 text-[10px] text-red-700"
              >
                Emergency
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {fmtRange(request)}
            {request.instructorPhone ? ` · ${request.instructorPhone}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {request.reason && (
            <p className="rounded bg-gray-50 p-2 text-sm text-gray-700">
              {request.reason}
            </p>
          )}

          {request.status === "pending" ? (
            <div className="space-y-2">
              <Textarea
                rows={2}
                placeholder="Note to instructor (optional)…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={review.isPending}
                  onClick={() => act("approve")}
                >
                  {review.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                  )}
                  Approve
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 border-red-200 text-red-700 hover:bg-red-50"
                  disabled={review.isPending}
                  onClick={() => act("reject")}
                >
                  <XCircle className="mr-1 h-4 w-4" />
                  Reject
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <Badge
                variant="outline"
                className={`capitalize ${STATUS_STYLE[request.status]}`}
              >
                {request.status}
              </Badge>
              {request.status === "approved" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-red-600"
                  disabled={revoke.isPending}
                  onClick={doRevoke}
                >
                  Revoke leave
                </Button>
              )}
            </div>
          )}

          {/* Affected lessons + replacements */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              Affected booked lessons{" "}
              {affected && affected.length > 0 && (
                <span className="text-muted-foreground">
                  ({affected.length})
                </span>
              )}
            </h3>
            {lessonsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              </div>
            ) : !affected || affected.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No booked lessons fall inside this leave window.
              </p>
            ) : (
              <div className="space-y-2">
                {affected.map((l) => (
                  <AffectedLessonRow
                    key={l.scheduleId}
                    lesson={l}
                    onLeaveInstructorId={request.instructor_id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function LeaveManagement() {
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | "all">("all");
  const { data, isLoading } = useAllLeaveRequests();
  const [selected, setSelected] = useState<LeaveRequestWithInstructor | null>(
    null,
  );

  const rows = useMemo(() => {
    const all = sortRequests(data ?? []);
    return statusFilter === "all"
      ? all
      : all.filter((r) => r.status === statusFilter);
  }, [data, statusFilter]);

  const pendingCount = (data ?? []).filter(
    (r) => r.status === "pending",
  ).length;

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center gap-3">
          <Link to="/admin">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Leave Management
            </h1>
            <p className="text-sm text-muted-foreground">
              Approve leave and arrange replacement instructors.{" "}
              {pendingCount > 0 && (
                <span className="font-medium text-amber-600">
                  {pendingCount} pending
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as LeaveStatus | "all")}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No leave requests
              {statusFilter !== "all" ? ` with status “${statusFilter}”` : ""}.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <Card key={r.id} className="transition-colors hover:bg-muted/30">
                <CardContent className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {r.instructorName ?? "Instructor"}
                      </span>
                      {r.leave_type === "emergency" && (
                        <Badge
                          variant="outline"
                          className="border-red-200 bg-red-50 text-[10px] text-red-700"
                        >
                          Emergency
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-[10px] capitalize ${STATUS_STYLE[r.status]}`}
                      >
                        {r.status}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {fmtRange(r)}
                    </div>
                    {r.instructorPhone && (
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Phone className="h-3 w-3" /> {r.instructorPhone}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={r.status === "pending" ? "default" : "outline"}
                    onClick={() => setSelected(r)}
                  >
                    {r.status === "pending" ? "Review" : "View"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <ReviewDialog
          request={
            // keep the dialog in sync with the latest fetched row
            (data ?? []).find((r) => r.id === selected.id) ?? selected
          }
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
