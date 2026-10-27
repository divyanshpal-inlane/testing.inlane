// Pure planning for a payment taken outside the payment link (cash / UPI /
// bank transfer), shared by the `record-manual-payment` edge function and its
// unit test (no Deno or network imports here on purpose).
//
// The browser shows the amount due with the same rules (buildEnrollmentLink in
// src/components/admin/learner/additionalServices.ts); THIS file is the one
// that is enforced: the amount received must equal what is due.

export const DEFAULT_TOPUP_PRICE_PER_CLASS = 599;

export interface ManualPaymentOrder {
  paymentStatus: string | null;
  caseType?: string | null;
  progressType?: string | null;
  totalHours?: number | null;
  installmentMode?: string | null;
  amount: number | null;
  installment1: number | null;
  installment2: number | null;
}

export type ManualPaymentPlan =
  | {
      ok: true;
      due: number;
      paymentType: "course" | "topup" | "demo";
      installmentType: "full" | "first_half" | "second_half";
      /** What the order becomes once the gateway-equivalent completion runs. */
      resultingStatus: "half_paid" | "full_paid";
    }
  | { ok: false; error: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function planManualPayment(
  order: ManualPaymentOrder,
  received: number,
): ManualPaymentPlan {
  if (order.paymentStatus === "full_paid") {
    return { ok: false, error: "This order is already fully paid." };
  }
  if (!Number.isFinite(received) || received <= 0) {
    return { ok: false, error: "Enter the amount received." };
  }

  const licence = order.caseType === "rto_only";
  const topup = !licence && order.progressType === "topup";
  const demo = !licence && !topup && order.progressType === "demo";

  let due: number;
  if (licence) {
    due = order.amount || 0;
  } else if (topup) {
    const hours = Math.max(1, order.totalHours ?? 1);
    due = order.amount || hours * DEFAULT_TOPUP_PRICE_PER_CLASS;
  } else {
    due =
      order.paymentStatus === "half_paid"
        ? order.installment2 || 0
        : order.installment1 || order.amount || 0;
  }
  due = round2(due);
  if (due <= 0) {
    return { ok: false, error: "Nothing is due on this order." };
  }
  if (Math.abs(round2(received) - due) > 0.009) {
    return {
      ok: false,
      error: `The amount due on this order is ₹${due}. Enter exactly that.`,
    };
  }

  const paymentType = licence ? "course" : topup ? "topup" : demo ? "demo" : "course";

  let installmentType: "full" | "first_half" | "second_half" = "full";
  if (paymentType === "course" && !licence) {
    if (order.paymentStatus === "half_paid") {
      installmentType = "second_half";
    } else if (
      order.installmentMode !== "full" &&
      (order.installment1 ?? 0) > 0 &&
      (order.installment2 ?? 0) > 0
    ) {
      installmentType = "first_half";
    }
  }

  return {
    ok: true,
    due,
    paymentType,
    installmentType,
    resultingStatus: installmentType === "first_half" ? "half_paid" : "full_paid",
  };
}
