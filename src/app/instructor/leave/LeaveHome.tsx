import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarOff,
  Loader2,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useUser } from "@/context/auth-context";
import { useInstructor } from "@/queries/instructor";
import {
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  useCancelLeaveRequest,
  useCreateLeaveRequest,
  useMyLeaveRequests,
} from "@/queries/leave";

const STATUS_STYLE: Record<LeaveStatus, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-200",
};

const fmtRange = (r: LeaveRequest) => {
  const f = format(new Date(r.from_date), "EEE d MMM");
  const t = format(new Date(r.to_date), "EEE d MMM");
  const days = r.from_date === r.to_date ? f : `${f} – ${t}`;
  const time = r.all_day
    ? "All day"
    : `${r.start_time?.slice(0, 5) ?? ""}–${r.end_time?.slice(0, 5) ?? ""}`;
  return `${days} · ${time}`;
};

export default function LeaveHome() {
  const navigate = useNavigate();
  const { phone } = useUser();
  const { data: instructor } = useInstructor(phone ?? "");
  const instructorId = instructor?.instructorInfo?.id_instructor as
    string | undefined;

  const { data: requests, isLoading } = useMyLeaveRequests(instructorId);
  const createLeave = useCreateLeaveRequest();
  const cancelLeave = useCancelLeaveRequest();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>("planned");
  const today = format(new Date(), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(today);
  const [multiDay, setMultiDay] = useState(false);
  const [toDate, setToDate] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [reason, setReason] = useState("");

  const openForm = (type: LeaveType) => {
    setLeaveType(type);
    setFromDate(today);
    setToDate(today);
    setMultiDay(false);
    setAllDay(true);
    setStartTime("09:00");
    setEndTime("17:00");
    setReason("");
    setOpen(true);
  };

  const submit = async () => {
    const finalTo = multiDay ? toDate : fromDate;
    if (finalTo < fromDate) {
      toast({
        title: "End date can't be before start date",
        variant: "destructive",
      });
      return;
    }
    if (!allDay && !(startTime < endTime)) {
      toast({
        title: "End time must be after start time",
        variant: "destructive",
      });
      return;
    }
    if (!instructorId) {
      toast({
        title: "Couldn't identify your instructor account",
        variant: "destructive",
      });
      return;
    }
    try {
      await createLeave.mutateAsync({
        instructorId,
        leaveType,
        fromDate,
        toDate: finalTo,
        allDay,
        startTime: allDay ? null : startTime,
        endTime: allDay ? null : endTime,
        reason: reason.trim() || null,
      });
      toast({
        title: "Leave request submitted",
        description: "Your admin will review it shortly.",
      });
      setOpen(false);
    } catch (e) {
      toast({
        title: "Couldn't submit leave",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header */}
      <div className="relative bg-[#00CE84] px-5 pb-6 pt-5 text-white">
        <button
          type="button"
          onClick={() => navigate("/instructor")}
          aria-label="Back to dashboard"
          className="absolute left-4 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/20"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="pl-10 text-xl font-bold">Leave</h1>
        <p className="pl-10 text-sm text-white/90">
          Request time off. Your admin approves it and arranges cover.
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-24">
        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            className="h-auto flex-col items-start gap-1 py-3"
            onClick={() => openForm("planned")}
          >
            <Plus className="h-4 w-4" />
            <span className="text-sm font-semibold">Apply for leave</span>
            <span className="text-[11px] font-normal opacity-90">
              Planned time off
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 border-red-200 py-3 text-red-700 hover:bg-red-50"
            onClick={() => openForm("emergency")}
          >
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-semibold">Emergency leave</span>
            <span className="text-[11px] font-normal opacity-80">
              Urgent — needs approval
            </span>
          </Button>
        </div>

        {/* My requests */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">
            My leave requests
          </h2>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : !requests || requests.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-white py-10 text-center text-sm text-gray-500">
              <CalendarOff className="h-6 w-6 text-gray-300" />
              No leave requests yet.
            </div>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {fmtRange(r)}
                        </span>
                        {r.leave_type === "emergency" && (
                          <Badge
                            variant="outline"
                            className="border-red-200 bg-red-50 text-[10px] text-red-700"
                          >
                            Emergency
                          </Badge>
                        )}
                      </div>
                      {r.reason && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {r.reason}
                        </p>
                      )}
                      {r.admin_note && (
                        <p className="mt-1 text-xs text-gray-600">
                          <span className="font-medium">Admin:</span>{" "}
                          {r.admin_note}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] capitalize ${STATUS_STYLE[r.status]}`}
                    >
                      {r.status}
                    </Badge>
                  </div>
                  {r.status === "pending" && (
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-gray-500"
                        disabled={cancelLeave.isPending}
                        onClick={() => cancelLeave.mutate(r.id)}
                      >
                        Cancel request
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Form dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {leaveType === "emergency"
                ? "Report emergency leave"
                : "Apply for leave"}
            </DialogTitle>
            <DialogDescription>
              {leaveType === "emergency"
                ? "Flagged as urgent. Your admin still needs to approve it before your slots are blocked."
                : "Your admin will review and approve this request."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">
                {multiDay ? "From date" : "Date"}
              </Label>
              <Input
                type="date"
                min={today}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={multiDay}
                onChange={(e) => setMultiDay(e.target.checked)}
              />
              Multiple days
            </label>
            {multiDay && (
              <div className="space-y-1">
                <Label className="text-xs">To date</Label>
                <Input
                  type="date"
                  min={fromDate}
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              All day
            </label>
            {!allDay && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">From time</Label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To time</Label>
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">
                Reason {leaveType === "planned" && "(optional)"}
              </Label>
              <Textarea
                rows={2}
                placeholder="e.g. Family function, medical, car servicing…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={createLeave.isPending}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={createLeave.isPending}>
              {createLeave.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
