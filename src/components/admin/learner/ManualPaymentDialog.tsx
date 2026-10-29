import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  MANUAL_METHODS,
  referenceRequired,
  validateManualPayment,
  validateProofFile,
} from "@/lib/sales-dashboard/manualPaymentInput";
import { useCurrentUser } from "@/queries/userManagement";

import { recordManualPayment } from "./manualPayment";

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Today as YYYY-MM-DD in the local time zone (not UTC). */
function localToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * "Record manual payment": the customer paid outside the payment link (cash,
 * UPI, bank transfer). The team enters how it was received and attaches an
 * image of the proof; the amount is the amount due on THIS order (fixed, so it
 * cannot be mistyped). The `record-manual-payment` function then files the
 * payment and completes the order exactly as a paid link would.
 */
export function ManualPaymentDialog({
  open,
  onOpenChange,
  learnerId,
  enrollmentId,
  orderLabel,
  amountDue,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  learnerId: string;
  enrollmentId: string;
  orderLabel: string;
  amountDue: number;
  onRecorded?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const me = useCurrentUser();
  const fileInput = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState("cash");
  const [utr, setUtr] = useState("");
  const [paidOn, setPaidOn] = useState(localToday());
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fresh form every time it opens.
  useEffect(() => {
    if (!open) return;
    setMethod("cash");
    setUtr("");
    setPaidOn(localToday());
    setNote("");
    setFile(null);
    setError(null);
  }, [open]);

  // Preview of the chosen image; released when it changes or the dialog closes.
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    const problem = validateProofFile(f);
    if (problem) {
      setFile(null);
      setError(problem);
      return;
    }
    setError(null);
    setFile(f);
  };

  const save = async () => {
    const problem = validateManualPayment({
      method,
      utr,
      paidOn,
      today: localToday(),
      file,
    });
    if (problem || !file) {
      setError(problem ?? "Attach the proof image.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const result = await recordManualPayment({
        learnerId,
        enrollmentId,
        amount: amountDue,
        method,
        utr: utr.trim(),
        paidOn,
        note: note.trim(),
        file,
        recordedByName: me.data?.name,
      });
      toast({
        title: "Payment recorded",
        description: `${rupees(amountDue)} for ${orderLabel}. The order is now ${
          result.paymentStatus === "half_paid" ? "half paid" : "paid"
        }.`,
      });
      void queryClient.invalidateQueries({
        queryKey: ["learner-services", learnerId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["learner-payments-trace", learnerId],
      });
      onRecorded?.();
      onOpenChange(false);
    } catch (err) {
      setError(
        (err as { message?: string } | null)?.message ||
          "Could not record the payment.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Record manual payment</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-1 text-sm">
          <div className="rounded-md border bg-muted/40 p-2">
            <div className="font-medium">{orderLabel}</div>
            <div className="text-muted-foreground">
              Amount received: <b>{rupees(amountDue)}</b> (the amount due on
              this order)
            </div>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="mp-method">How was it received?</Label>
            <select
              id="mp-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {MANUAL_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="mp-utr">
              UTR / transaction number{referenceRequired(method) ? " *" : ""}
            </Label>
            <Input
              id="mp-utr"
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              placeholder={
                referenceRequired(method)
                  ? "Required"
                  : "Optional (receipt number)"
              }
              autoComplete="off"
            />
          </div>

          <div className="grid gap-1">
            <Label htmlFor="mp-date">Date received *</Label>
            <Input
              id="mp-date"
              type="date"
              value={paidOn}
              max={localToday()}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </div>

          <div className="grid gap-1">
            <Label>Proof (image) *</Label>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              data-testid="manual-payment-proof"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {preview ? (
              <div className="relative w-fit">
                <img
                  src={preview}
                  alt="Payment proof preview"
                  className="max-h-40 rounded-md border"
                />
                <button
                  type="button"
                  aria-label="Remove the image"
                  onClick={() => setFile(null)}
                  className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5 shadow"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => fileInput.current?.click()}
              >
                <ImagePlus size={14} className="mr-1" />
                Choose image
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Screenshot or photo of the receipt / UPI confirmation. JPG, PNG or
              WebP, up to 5 MB.
            </p>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="mp-note">Note (optional)</Label>
            <Textarea
              id="mp-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>

          {error && (
            <p className="text-xs text-red-600" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Recording..." : `Record ${rupees(amountDue)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
