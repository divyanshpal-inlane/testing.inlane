import { RefreshCcw, Send } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { useCanSeeCustomerPhone } from "@/hooks/useCanSeeCustomerPhone";
import { maskPhoneNumber } from "@/utils/phoneMasking";

import { PREDEFINED_COURSES } from "./CreateLearnerDialog";
import {
  EnrollmentRecord,
  getPayableAmount,
  sendEnrollmentPaymentLink,
  updateEnrollment,
} from "./enrollmentActions";

type EditPlan = "full" | "half" | "custom";

interface EditPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enrollment: EnrollmentRecord | null;
  /** Called after the plan is saved (before the link is re-sent). */
  onSaved?: () => void;
}

/**
 * "Edit plan + regenerate link": change the course / amounts of a learner's
 * enrollment and re-send the payment link. Moved out of IncompletePaymentsCard
 * unchanged so the Sales Dashboard uses the same dialog.
 */
export function EditPlanDialog({
  open,
  onOpenChange,
  enrollment,
  onSaved,
}: EditPlanDialogProps) {
  const canSeeFullPhone = useCanSeeCustomerPhone();
  const showPhone = (phone: string | null | undefined) =>
    canSeeFullPhone ? (phone ?? "") : maskPhoneNumber(phone);
  const { toast } = useToast();

  const [editCourseId, setEditCourseId] = useState<string>("");
  const [editPlan, setEditPlan] = useState<EditPlan>("full");
  const [editTotalAmount, setEditTotalAmount] = useState<number>(0);
  const [editDueNow, setEditDueNow] = useState<number>(0);
  const [editSaving, setEditSaving] = useState(false);

  // Prefill from the enrollment's current plan whenever the dialog opens.
  useEffect(() => {
    if (!open || !enrollment) return;
    const i1 = enrollment.installment1_amount ?? 0;
    const i2 = enrollment.installment2_amount ?? 0;

    let plan: EditPlan;
    if (enrollment.installment_mode === "full" || i2 === 0) {
      plan = "full";
    } else if (Math.abs(i1 - i2) <= 1) {
      plan = "half";
    } else {
      plan = "custom";
    }

    const total =
      enrollment.amount || i1 + i2 || getPayableAmount(enrollment) || 0;

    // Only preselect the course if it matches a known package; demo/custom
    // (course_id null) start blank so the admin can assign a real package.
    const knownCourseId = PREDEFINED_COURSES.some(
      (c) => c.id === enrollment.course_id,
    )
      ? (enrollment.course_id ?? "")
      : "";

    setEditCourseId(knownCourseId);
    setEditPlan(plan);
    setEditTotalAmount(total);
    setEditDueNow(i1 || getPayableAmount(enrollment) || 0);
    // Prefill once per open, not on every enrollment refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Derive the installment split from the chosen plan (mirrors the create flow).
  const editAmounts = (() => {
    const total = Number(editTotalAmount) || 0;
    const dueNow =
      editPlan === "full"
        ? total
        : editPlan === "half"
          ? Math.round(total / 2)
          : Number(editDueNow) || 0;
    const second = Math.max(0, total - dueNow);
    return { total, dueNow, second };
  })();

  const handleEditSave = async () => {
    if (!enrollment) return;
    const { total, dueNow, second } = editAmounts;

    if (total < 1 || dueNow < 1) {
      toast({
        title: "Invalid amount",
        description: "Total and amount due now must be at least ₹1.",
        variant: "destructive",
      });
      return;
    }

    setEditSaving(true);
    try {
      const selectedCourse = PREDEFINED_COURSES.find(
        (c) => c.id === editCourseId,
      );

      // Update the enrollment in place — no new learner/enrollment row is
      // created, so the same deterministic phone payment link keeps working and
      // now reflects the new amount.
      const updates: Record<string, unknown> = {
        amount: total,
        installment_mode: editPlan === "full" ? "full" : "installment",
        installment1_amount: dueNow,
        installment2_amount: second,
      };
      if (editCourseId) {
        updates.course_id = editCourseId;
        if (selectedCourse) {
          updates.progress = {
            type: "course",
            total_hours: selectedCourse.duration,
          };
        }
      }

      await updateEnrollment(enrollment.id, updates);

      // Re-send the payment link with the updated plan. The sender reads the
      // enrollment for amount + course, so hand it a merged copy.
      const updatedEnrollment: EnrollmentRecord = {
        ...enrollment,
        amount: total,
        installment_mode: editPlan === "full" ? "full" : "installment",
        installment1_amount: dueNow,
        installment2_amount: second,
        course_id: editCourseId || enrollment.course_id,
        Courses: selectedCourse
          ? {
              id: selectedCourse.id,
              name: selectedCourse.name,
              duration: selectedCourse.duration,
            }
          : enrollment.Courses,
      };

      onOpenChange(false);
      onSaved?.();

      await sendEnrollmentPaymentLink(updatedEnrollment, toast);
    } catch (error) {
      console.error("Edit plan save error:", error);
      toast({
        title: "Update failed",
        description:
          (error as { message?: string } | null)?.message ||
          "Could not update the plan. No changes saved.",
        variant: "destructive",
      });
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            Edit plan — {enrollment?.Learner?.name || "Learner"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="rounded-lg border bg-gray-50 p-3 text-sm">
            <span className="text-muted-foreground">
              Phone (login ID, cannot be changed):{" "}
            </span>
            <span className="font-medium">
              {enrollment?.Learner?.phone
                ? showPhone(enrollment.Learner.phone)
                : "N/A"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Course / Package</Label>
              <Select value={editCourseId} onValueChange={setEditCourseId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select course" />
                </SelectTrigger>
                <SelectContent>
                  {PREDEFINED_COURSES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.duration} lessons)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Payment Plan</Label>
              <Select
                value={editPlan}
                onValueChange={(v) => setEditPlan(v as EditPlan)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full payment</SelectItem>
                  <SelectItem value="half">Half (50:50)</SelectItem>
                  <SelectItem value="custom">Custom amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Total Amount (₹)</Label>
              <Input
                type="number"
                min={1}
                value={editTotalAmount || ""}
                onChange={(e) => setEditTotalAmount(Number(e.target.value))}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Amount Due Now (₹)</Label>
              {editPlan === "custom" ? (
                <Input
                  type="number"
                  min={1}
                  value={editDueNow || ""}
                  onChange={(e) => setEditDueNow(Number(e.target.value))}
                  className="h-9 text-sm"
                />
              ) : (
                <div className="flex h-9 items-center rounded-md border bg-gray-50 px-3 text-sm text-muted-foreground">
                  ₹{editAmounts.dueNow}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Second installment: ₹{editAmounts.second}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Saving updates this learner&apos;s enrollment (no duplicate is
            created) and re-sends the payment link by email + WhatsApp/SMS.
          </p>
        </div>
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            variant="secondary"
            disabled={editSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleEditSave} disabled={editSaving}>
            {editSaving ? (
              <RefreshCcw size={14} className="mr-1 animate-spin" />
            ) : (
              <Send size={14} className="mr-1" />
            )}
            {editSaving ? "Saving..." : "Save & Resend Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
