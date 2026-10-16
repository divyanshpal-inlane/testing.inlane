import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

import { EnrollmentRecord, saveManualPaidInfo } from "./enrollmentActions";

interface PaidInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enrollment: EnrollmentRecord | null;
  /** Called after the payment was recorded. */
  onSaved?: () => void;
}

/**
 * "Enter Paid Installments": mark installment 1 and/or 2 as paid. Moved out of
 * IncompletePaymentsCard unchanged so the Sales Dashboard uses the same dialog.
 */
export function PaidInfoDialog({
  open,
  onOpenChange,
  enrollment,
  onSaved,
}: PaidInfoDialogProps) {
  const { toast } = useToast();
  const [manualInstallment1, setManualInstallment1] = useState<number | null>(
    null,
  );
  const [manualInstallment2, setManualInstallment2] = useState<number | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setManualInstallment1(null);
    setManualInstallment2(null);
  }, [open]);

  const handleSave = async () => {
    if (!enrollment) {
      toast({
        title: "Error",
        description: "No enrollment data available",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const paymentStatus = await saveManualPaidInfo(
        enrollment,
        manualInstallment1,
        manualInstallment2,
      );
      toast({
        title: "Success",
        description: `Payment marked as ${paymentStatus}. Enrollment updated.`,
      });
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      console.error("Payment and Enrollment Save Error:", error);
      toast({
        title: "Error Saving Data",
        description:
          (error as { message?: string } | null)?.message ||
          "An unexpected error occurred during the save process.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Enter Paid Installments</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="installment1-paid"
              // The checkbox is checked if manualInstallment1 is truthy (contains the amount)
              checked={!!manualInstallment1}
              onChange={(e) => {
                // If checked is true, set the amount; otherwise set to null.
                setManualInstallment1(
                  e.target.checked
                    ? (enrollment?.installment1_amount ?? 0)
                    : null,
                );
              }}
            />
            <Label htmlFor="installment1-paid">
              Installment 1 (Amount: {enrollment?.installment1_amount ?? 0})
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="installment2-paid"
              // Disable this checkbox if manualInstallment1 is not yet set
              disabled={!manualInstallment1}
              checked={!!manualInstallment2}
              onChange={(e) => {
                setManualInstallment2(
                  e.target.checked
                    ? (enrollment?.installment2_amount ?? 0)
                    : null,
                );
              }}
            />
            <Label
              htmlFor="installment2-paid"
              className={!manualInstallment1 ? "opacity-50" : ""}
            >
              Installment 2 (Amount: {enrollment?.installment2_amount ?? 0})
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            variant="secondary"
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
