import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  IndianRupee,
  Loader2,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentAdmin } from "@/queries/adminPermissions";
import {
  NoShowCase,
  useFlagInstructorNoShow,
  useNoShowCases,
  usePotentialInstructorNoShows,
  useResolveNoShow,
} from "@/queries/noShow";
import {
  NO_SHOW_FEE_AMOUNT,
  NoShowFee,
  useAllNoShowFees,
  useChargeNoShowFee,
  useReviewAppeal,
} from "@/queries/noShowFees";

const PARTY_STYLE: Record<string, string> = {
  learner: "border-blue-200 bg-blue-50 text-blue-700",
  instructor: "border-purple-200 bg-purple-50 text-purple-700",
};
const STATUS_STYLE: Record<string, string> = {
  open: "border-amber-200 bg-amber-100 text-amber-800",
  resolved: "border-emerald-200 bg-emerald-100 text-emerald-800",
  dismissed: "border-gray-200 bg-gray-100 text-gray-600",
};

const fmtWhen = (c: NoShowCase) =>
  c.date
    ? `${format(new Date(c.date), "EEE d MMM")} · ${c.startTime?.slice(0, 5) ?? ""}–${c.endTime?.slice(0, 5) ?? ""}`
    : "—";

function ReportedCases() {
  const { data: cases, isLoading } = useNoShowCases();
  const resolve = useResolveNoShow();
  const charge = useChargeNoShowFee();
  const { data: admin } = useCurrentAdmin();
  const { toast } = useToast();

  const act = async (id: string, status: "resolved" | "dismissed") => {
    try {
      await resolve.mutateAsync({
        id,
        status,
        resolverName: admin?.name ?? "Admin",
      });
      toast({ title: status === "resolved" ? "Marked resolved" : "Dismissed" });
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const chargeFee = async (c: NoShowCase) => {
    if (
      !window.confirm(
        `Charge ₹${NO_SHOW_FEE_AMOUNT} no-show fee to ${c.learnerName ?? "this learner"}? They will be notified.`,
      )
    )
      return;
    try {
      await charge.mutateAsync({
        scheduleId: c.schedule_id,
        noShowId: c.id,
        markedBy: admin?.name ?? "Admin",
      });
      toast({
        title: `₹${NO_SHOW_FEE_AMOUNT} fee charged`,
        description: "Logged under Fees & Appeals; learner notified.",
      });
    } catch (e) {
      toast({
        title: "Couldn't charge fee",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  if (!cases || cases.length === 0)
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No no-show cases reported.
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-2">
      {cases.map((c) => (
        <Card key={c.id}>
          <CardContent className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={`text-[10px] capitalize ${PARTY_STYLE[c.no_show_party]}`}
                >
                  {c.no_show_party} no-show
                </Badge>
                <Badge
                  variant="outline"
                  className={`text-[10px] capitalize ${STATUS_STYLE[c.status]}`}
                >
                  {c.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {fmtWhen(c)}
                </span>
              </div>
              <div className="mt-1 text-sm">
                <span className="font-medium">
                  {c.learnerName ?? "Learner"}
                </span>
                {c.instructorName ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {c.instructorName}
                  </span>
                ) : (
                  ""
                )}
                {c.lessonNumber != null && (
                  <span className="text-muted-foreground">
                    {" "}
                    · Lesson {c.lessonNumber}
                  </span>
                )}
              </div>
              {c.note && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  “{c.note}”
                </p>
              )}
              {c.resolution && (
                <p className="mt-0.5 text-xs text-emerald-700">
                  Resolution: {c.resolution}
                </p>
              )}
            </div>
            {c.status === "open" && (
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {c.no_show_party === "learner" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 border-rose-200 text-rose-700 hover:bg-rose-50"
                    disabled={charge.isPending}
                    onClick={() => chargeFee(c)}
                  >
                    <IndianRupee className="mr-1 h-3 w-3" /> Charge ₹
                    {NO_SHOW_FEE_AMOUNT}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={resolve.isPending}
                  onClick={() => act(c.id, "resolved")}
                >
                  <Check className="mr-1 h-3 w-3" /> Resolve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-muted-foreground"
                  disabled={resolve.isPending}
                  onClick={() => act(c.id, "dismissed")}
                >
                  <X className="mr-1 h-3 w-3" /> Dismiss
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PotentialInstructorNoShows() {
  const { data: rows, isLoading } = usePotentialInstructorNoShows();
  const flag = useFlagInstructorNoShow();
  const { toast } = useToast();

  const doFlag = async (scheduleId: number) => {
    try {
      await flag.mutateAsync({
        scheduleId,
        note: "Lesson never started (no OTP)",
      });
      toast({ title: "Flagged as instructor no-show" });
    } catch (e) {
      toast({
        title: "Couldn't flag",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

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
          No suspected instructor no-shows.
        </CardContent>
      </Card>
    );

  return (
    <>
      <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
        <AlertTriangle className="h-3 w-3 text-amber-500" />
        Past booked lessons that never started (no OTP). Confirm to log as an
        instructor no-show.
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <Card key={r.scheduleId}>
            <CardContent className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 text-sm">
                <div className="font-medium">
                  {r.instructorName ?? "Instructor"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {format(new Date(r.date), "EEE d MMM")} ·{" "}
                  {r.startTime?.slice(0, 5)}–{r.endTime?.slice(0, 5)} ·{" "}
                  {r.learnerName ?? "Learner"}
                  {r.lessonNumber != null ? ` · Lesson ${r.lessonNumber}` : ""}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-purple-200 text-purple-700 hover:bg-purple-50"
                disabled={flag.isPending}
                onClick={() => doFlag(r.scheduleId)}
              >
                Flag no-show
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

const FEE_STATUS_STYLE: Record<string, string> = {
  pending: "border-amber-200 bg-amber-100 text-amber-800",
  confirmed: "border-slate-200 bg-slate-100 text-slate-700",
  deducted: "border-emerald-200 bg-emerald-100 text-emerald-800",
  appealed: "border-orange-200 bg-orange-100 text-orange-800",
  waived: "border-blue-200 bg-blue-100 text-blue-700",
  paid: "border-emerald-200 bg-emerald-100 text-emerald-800",
};

const APPEAL_REASON_LABEL: Record<string, string> = {
  instructor_no_show: "Instructor didn't show",
  system_error: "System / booking error",
  emergency: "Emergency / personal",
  other: "Other",
};

const fmtFeeWhen = (f: NoShowFee) =>
  f.date
    ? `${format(new Date(f.date), "EEE d MMM")}${f.startTime ? ` · ${f.startTime.slice(0, 5)}` : ""}`
    : "—";

function FeesAndAppeals() {
  const { data: fees, isLoading } = useAllNoShowFees();
  const review = useReviewAppeal();
  const { data: admin } = useCurrentAdmin();
  const { toast } = useToast();

  const decide = async (
    f: NoShowFee,
    decision: "approve" | "reject" | "partial",
  ) => {
    if (!f.appeal) return;
    let refundAmount: number | undefined;
    if (decision === "partial") {
      const raw = window.prompt(
        `Refund amount (₹), max ${f.amount}. The rest stands as the fee.`,
        String(Math.floor(f.amount / 2)),
      );
      if (raw == null) return;
      refundAmount = Number(raw);
      if (
        !Number.isFinite(refundAmount) ||
        refundAmount <= 0 ||
        refundAmount >= f.amount
      ) {
        toast({
          title: "Invalid amount",
          description: `Enter a number between 1 and ${f.amount - 1}.`,
          variant: "destructive",
        });
        return;
      }
    }
    try {
      await review.mutateAsync({
        appealId: f.appeal.id,
        feeId: f.id,
        feeAmount: f.amount,
        learnerId: f.learner_id,
        decision,
        refundAmount,
        reviewerName: admin?.name ?? "Admin",
      });
      toast({
        title:
          decision === "approve"
            ? "Appeal approved — fee waived"
            : decision === "reject"
              ? "Appeal rejected — fee stands"
              : "Partial refund applied",
      });
    } catch (e) {
      toast({
        title: "Review failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  if (!fees || fees.length === 0)
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No no-show fees yet. Charge one from a learner case under “Reported
          cases”.
        </CardContent>
      </Card>
    );

  const pendingAppeals = fees.filter(
    (f) => f.appeal && f.appeal.status === "pending",
  );

  return (
    <div className="space-y-4">
      {pendingAppeals.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">
            Pending appeals ({pendingAppeals.length})
          </h2>
          <div className="space-y-2">
            {pendingAppeals.map((f) => (
              <Card key={f.id} className="border-orange-200">
                <CardContent className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {f.learnerName ?? "Learner"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fmtFeeWhen(f)} · ₹{f.amount}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {APPEAL_REASON_LABEL[f.appeal!.reason] ??
                        f.appeal!.reason}
                    </Badge>
                  </div>
                  {f.appeal!.description && (
                    <p className="text-xs text-muted-foreground">
                      “{f.appeal!.description}”
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      disabled={review.isPending}
                      onClick={() => decide(f, "approve")}
                    >
                      <Check className="mr-1 h-3 w-3" /> Approve (waive)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={review.isPending}
                      onClick={() => decide(f, "partial")}
                    >
                      Partial refund
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-muted-foreground"
                      disabled={review.isPending}
                      onClick={() => decide(f, "reject")}
                    >
                      <X className="mr-1 h-3 w-3" /> Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold">All fees ({fees.length})</h2>
        <div className="space-y-2">
          {fees.map((f) => (
            <Card key={f.id}>
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0 text-sm">
                  <div className="font-medium">
                    {f.learnerName ?? "Learner"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmtFeeWhen(f)}
                    {f.lessonNumber != null
                      ? ` · Lesson ${f.lessonNumber}`
                      : ""}
                    {f.instructorName ? ` · ${f.instructorName}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-semibold">₹{f.amount}</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] capitalize ${FEE_STATUS_STYLE[f.status] ?? ""}`}
                  >
                    {f.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function NoShowManagement() {
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
              No-show Management
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage learner & instructor no-show cases.
            </p>
          </div>
        </div>

        <Tabs defaultValue="reported">
          <TabsList>
            <TabsTrigger value="reported">Reported cases</TabsTrigger>
            <TabsTrigger value="fees">Fees &amp; appeals</TabsTrigger>
            <TabsTrigger value="potential">
              Potential instructor no-shows
            </TabsTrigger>
          </TabsList>
          <TabsContent value="reported" className="mt-4">
            <ReportedCases />
          </TabsContent>
          <TabsContent value="fees" className="mt-4">
            <FeesAndAppeals />
          </TabsContent>
          <TabsContent value="potential" className="mt-4">
            <PotentialInstructorNoShows />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
