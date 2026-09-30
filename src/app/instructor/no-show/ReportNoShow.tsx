import { format } from "date-fns";
import { ArrowLeft, CalendarX2, Check, Loader2, UserX } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useUser } from "@/context/auth-context";
import { useInstructor } from "@/queries/instructor";
import {
  InstructorLesson,
  useInstructorRecentLessons,
  useReportLearnerNoShow,
} from "@/queries/noShow";

export default function ReportNoShow() {
  const navigate = useNavigate();
  const { phone } = useUser();
  const { data: instructor } = useInstructor(phone ?? "");
  const instructorId = instructor?.instructorInfo?.id_instructor as
    string | undefined;

  const { data: lessons, isLoading } = useInstructorRecentLessons(instructorId);
  const report = useReportLearnerNoShow();
  const { toast } = useToast();

  const [selected, setSelected] = useState<InstructorLesson | null>(null);
  const [note, setNote] = useState("");

  const submit = async () => {
    if (!selected || !instructorId) return;
    try {
      await report.mutateAsync({
        scheduleId: selected.scheduleId,
        reporterInstructorId: instructorId,
        note: note.trim() || null,
      });
      toast({
        title: "No-show reported",
        description: "Your admin will review it.",
      });
      setSelected(null);
      setNote("");
    } catch (e) {
      toast({
        title: "Couldn't report no-show",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <div className="relative bg-[#00CE84] px-5 pb-6 pt-5 text-white">
        <button
          type="button"
          onClick={() => navigate("/instructor")}
          aria-label="Back to dashboard"
          className="absolute left-4 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/20"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="pl-10 text-xl font-bold">Report a no-show</h1>
        <p className="pl-10 text-sm text-white/90">
          Flag a learner who didn&apos;t turn up for a recent lesson.
        </p>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4 pb-24">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : !lessons || lessons.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-white py-10 text-center text-sm text-gray-500">
            <CalendarX2 className="h-6 w-6 text-gray-300" />
            No lessons in the last 14 days.
          </div>
        ) : (
          lessons.map((l) => (
            <div
              key={l.scheduleId}
              className="flex items-center justify-between gap-2 rounded-lg border bg-white p-3 shadow-sm"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {format(new Date(l.date), "EEE d MMM")} ·{" "}
                  {l.startTime?.slice(0, 5)}–{l.endTime?.slice(0, 5)}
                </div>
                <div className="truncate text-xs text-gray-500">
                  {l.learnerName ?? "Learner"}
                  {l.lessonNumber != null ? ` · Lesson ${l.lessonNumber}` : ""}
                </div>
              </div>
              {l.alreadyReported ? (
                <span className="flex items-center gap-1 text-xs text-emerald-600">
                  <Check className="h-3 w-3" /> Reported
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-red-200 text-red-700 hover:bg-red-50"
                  onClick={() => {
                    setSelected(l);
                    setNote("");
                  }}
                >
                  <UserX className="mr-1 h-3 w-3" /> No-show
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report learner no-show</DialogTitle>
            <DialogDescription>
              {selected && (
                <>
                  {selected.learnerName ?? "Learner"} ·{" "}
                  {format(new Date(selected.date), "EEE d MMM")}{" "}
                  {selected.startTime?.slice(0, 5)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            placeholder="What happened? (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelected(null)}
              disabled={report.isPending}
            >
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={submit}
              disabled={report.isPending}
            >
              {report.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              Report no-show
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
