import { format } from "date-fns";
import { Loader2, ReceiptText, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useLearner } from "@/queries/learner";
import {
  AppealReason,
  NoShowFee,
  useCreateAppeal,
  useLearnerNoShowFees,
} from "@/queries/noShowFees";

const APPEAL_REASONS: { value: AppealReason; label: string }[] = [
  { value: "instructor_no_show", label: "Instructor didn't show" },
  { value: "system_error", label: "System error / booking issue" },
  { value: "emergency", label: "Emergency / personal" },
  { value: "other", label: "Other" },
];

// How the learner sees each fee status.
const STATUS_LABEL: Record<string, string> = {
  pending: "Outstanding",
  confirmed: "Outstanding",
  deducted: "Settled",
  appealed: "Appeal under review",
  waived: "Waived ✓",
  paid: "Paid ✓",
};
const STATUS_STYLE: Record<string, string> = {
  pending: "border-amber-200 bg-amber-100 text-amber-800",
  confirmed: "border-amber-200 bg-amber-100 text-amber-800",
  deducted: "border-gray-200 bg-gray-100 text-gray-600",
  appealed: "border-orange-200 bg-orange-100 text-orange-800",
  waived: "border-emerald-200 bg-emerald-100 text-emerald-700",
  paid: "border-emerald-200 bg-emerald-100 text-emerald-700",
};

const isOutstanding = (f: NoShowFee) =>
  f.status === "pending" || f.status === "confirmed";

const canAppeal = (f: NoShowFee) =>
  !f.appeal && (f.status === "pending" || f.status === "confirmed");

const fmtWhen = (f: NoShowFee) =>
  f.date
    ? `${format(new Date(f.date), "d MMM yyyy")}${f.startTime ? `, ${f.startTime.slice(0, 5)}` : ""}`
    : "—";

export default function Fees() {
  const { data: learner } = useLearner();
  const { data: fees, isLoading } = useLearnerNoShowFees(learner?.id);
  const createAppeal = useCreateAppeal();
  const { toast } = useToast();

  const [appealFee, setAppealFee] = useState<NoShowFee | null>(null);
  const [reason, setReason] = useState<AppealReason>("instructor_no_show");
  const [description, setDescription] = useState("");

  const submitAppeal = async () => {
    if (!appealFee || !learner?.id) return;
    try {
      await createAppeal.mutateAsync({
        feeId: appealFee.id,
        learnerId: learner.id,
        reason,
        description: description.trim() || null,
      });
      toast({
        title: "Appeal submitted",
        description: "Our team will review it and get back to you.",
      });
      setAppealFee(null);
      setDescription("");
      setReason("instructor_no_show");
    } catch (e) {
      toast({
        title: "Couldn't submit appeal",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const totalOutstanding = (fees ?? [])
    .filter(isOutstanding)
    .reduce((sum, f) => sum + f.amount, 0);
  const totalSettled = (fees ?? [])
    .filter((f) => f.status === "paid" || f.status === "deducted")
    .reduce((sum, f) => sum + f.amount, 0);

  return (
    <div className="flex h-full w-full p-6 pb-24">
      <div className="flex h-full w-full flex-col">
        <h1 className="mb-2 text-3xl font-bold text-gray-800">
          Fees & charges
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          No-show and late-reschedule fees on your account.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !fees || fees.length === 0 ? (
          <div className="rounded-lg bg-gray-50 p-8 text-center">
            <ReceiptText className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <p className="font-medium text-gray-700">No fees on your account</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You're all clear. Reschedule 30+ minutes before a lesson to avoid
              any fee.
            </p>
          </div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-white p-4">
                <p className="text-xs text-muted-foreground">Outstanding</p>
                <p className="text-2xl font-bold text-amber-700">
                  ₹{totalOutstanding}
                </p>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <p className="text-xs text-muted-foreground">Paid</p>
                <p className="text-2xl font-bold text-emerald-700">
                  ₹{totalSettled}
                </p>
              </div>
            </div>

            {/* Fee list */}
            <div className="space-y-2">
              {fees.map((f) => (
                <div key={f.id} className="rounded-lg border bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800">
                        {f.fee_type === "late_reschedule"
                          ? "Late reschedule"
                          : "Missed lesson"}
                        {f.lessonNumber != null
                          ? ` · Lesson ${f.lessonNumber}`
                          : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fmtWhen(f)}
                        {f.instructorName ? ` · ${f.instructorName}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-bold text-gray-800">
                        ₹{f.amount}
                      </p>
                      <Badge
                        variant="outline"
                        className={`mt-1 text-[10px] ${STATUS_STYLE[f.status] ?? ""}`}
                      >
                        {STATUS_LABEL[f.status] ?? f.status}
                      </Badge>
                    </div>
                  </div>

                  {f.appeal && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {f.appeal.status === "pending"
                        ? "Appeal submitted — under review."
                        : f.appeal.status === "approved"
                          ? "Appeal approved — fee waived."
                          : f.appeal.status === "partial_refund"
                            ? `Appeal partially approved — ₹${f.appeal.refund_amount ?? 0} refunded.`
                            : "Appeal reviewed — fee stands."}
                    </p>
                  )}

                  {canAppeal(f) && (
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAppealFee(f)}
                      >
                        <ShieldAlert className="mr-1 h-3.5 w-3.5" />
                        Appeal this fee
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Appeal dialog */}
      <Dialog open={!!appealFee} onOpenChange={(o) => !o && setAppealFee(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Appeal ₹{appealFee?.amount} fee</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Reason</Label>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v as AppealReason)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPEAL_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">
                Description (optional)
              </Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Tell us what happened…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAppealFee(null)}>
              Cancel
            </Button>
            <Button onClick={submitAppeal} disabled={createAppeal.isPending}>
              {createAppeal.isPending ? "Submitting…" : "Submit appeal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
