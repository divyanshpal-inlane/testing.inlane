import { proofPathFor } from "@/lib/sales-dashboard/manualPaymentInput";
import { supabase } from "@/lib/supabaseClient";

export const PROOF_BUCKET = "payment-proofs";

export interface ManualPaymentArgs {
  learnerId: string;
  enrollmentId: string;
  amount: number;
  method: string;
  utr: string;
  paidOn: string;
  note: string;
  file: File;
  recordedByName?: string;
}

/**
 * Uploads the proof image, then asks the `record-manual-payment` edge function
 * to file the payment and complete the order exactly as a paid link would. The
 * function removes the proof again if anything fails, so no orphan is left.
 * Resolves with the order's new payment status.
 */
export async function recordManualPayment(
  args: ManualPaymentArgs,
): Promise<{ paymentId: string; paymentStatus: string }> {
  const proofPath = proofPathFor(
    args.learnerId,
    args.enrollmentId,
    args.file.name,
  );
  const { error: uploadError } = await supabase.storage
    .from(PROOF_BUCKET)
    .upload(proofPath, args.file, {
      contentType: args.file.type,
      upsert: false,
    });
  if (uploadError) {
    throw new Error(`Could not upload the proof: ${uploadError.message}`);
  }

  const { data, error } = await supabase.functions.invoke(
    "record-manual-payment",
    {
      body: {
        enrollmentId: args.enrollmentId,
        amount: args.amount,
        method: args.method,
        utr: args.utr,
        paidOn: args.paidOn,
        proofPath,
        note: args.note,
        recordedByName: args.recordedByName,
      },
    },
  );
  if (error) {
    // FunctionsHttpError hides the real reason in the response body.
    let reason = error.message;
    try {
      const body = await (
        error as unknown as { context?: Response }
      ).context?.json();
      if (body?.error) reason = String(body.error);
    } catch {
      /* keep the generic message */
    }
    throw new Error(reason);
  }
  const payload = data as {
    success?: boolean;
    error?: string;
    paymentId?: string;
    paymentStatus?: string;
  } | null;
  if (!payload || payload.success === false) {
    throw new Error(payload?.error ?? "The payment was not recorded.");
  }
  return {
    paymentId: payload.paymentId ?? "",
    paymentStatus: payload.paymentStatus ?? "",
  };
}

/** A short-lived link to view a proof image (the bucket is private). */
export async function proofSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PROOF_BUCKET)
    .createSignedUrl(path, 300);
  if (error || !data?.signedUrl) {
    throw new Error("Could not open the proof.");
  }
  return data.signedUrl;
}
