import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

import { completePayment } from "../_shared/complete-payment.ts";
import { planManualPayment } from "../_shared/manual-payment.ts";

// Records a payment the customer made OUTSIDE the payment link (cash, UPI,
// bank transfer), with an image proof the browser already uploaded to the
// private `payment-proofs` bucket.
//
// It does NOT hand-edit the order. It files a normal `payment` row (source
// 'manual') and then runs the same completion every gateway payment runs
// (`completePayment`: order status, unlocked lessons, thank-you message), so a
// manually recorded payment behaves exactly like a paid link.
//
// Staff only (an Admin or User row for the caller's phone). Nothing is written
// unless every check passes; on a failure after the payment row exists, it is
// removed again and the order is put back.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, content-length",
  "Access-Control-Max-Age": "86400",
};

const METHODS = ["cash", "upi", "bank_transfer", "card", "other"];

interface RequestBody {
  enrollmentId: string;
  amount: number;
  method: string;
  utr?: string;
  paidOn: string; // YYYY-MM-DD
  proofPath: string;
  note?: string;
  recordedByName?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("MY_SUPABASE_URL") ?? "",
    Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Rollback state, filled in as the steps below succeed.
  let createdPaymentId: string | null = null;
  let enrollmentIdForRollback: string | null = null;
  let previousPaymentId: string | null = null;
  let proofPathForCleanup: string | null = null;

  try {
    // ---- who is calling: staff only ---------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ success: false, error: "Not signed in." }, 401);
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user?.phone) {
      return json({ success: false, error: "Not signed in." }, 401);
    }
    const digits = user.phone.replace(/\D/g, "");
    const last10 = digits.slice(-10);
    const variants = [
      ...new Set([user.phone, digits, last10, `91${last10}`, `+91${last10}`]),
    ];
    const [{ data: admins }, { data: staff }] = await Promise.all([
      supabase.from("Admin").select("id").in("phone", variants).limit(1),
      supabase.from("User").select("id").in("phone", variants).limit(1),
    ]);
    if (!admins?.length && !staff?.length) {
      return json(
        { success: false, error: "Only staff can record a payment." },
        403,
      );
    }

    // ---- input ------------------------------------------------------------
    const body = (await req.json()) as RequestBody;
    const amount = Number(body.amount);
    if (!body.enrollmentId) throw new Error("enrollmentId is required.");
    const { data: enrollment, error: enrollmentError } = await supabase
      .from("enrollment")
      .select(
        "id, learner_id, payment_id, payment_status, case_type, installment_mode, amount, installment1_amount, installment2_amount, progress, Learner:learner_id (id, name, phone, email)",
      )
      .eq("id", body.enrollmentId)
      .single();
    if (enrollmentError || !enrollment) throw new Error("Order not found.");

    // The proof must be one uploaded for THIS order: <learner id>/<order id>/<file>.
    // Only a path that passes this is ever cleaned up on failure, so a bad
    // request can never delete somebody else's proof.
    if (
      typeof body.proofPath !== "string" ||
      !body.proofPath.startsWith(`${enrollment.learner_id}/${enrollment.id}/`)
    ) {
      throw new Error("Attach the proof image.");
    }
    proofPathForCleanup = body.proofPath;

    if (!METHODS.includes(body.method)) {
      throw new Error("Pick how the money was received.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.paidOn ?? "")) {
      throw new Error("Enter the date the money was received.");
    }
    if (body.paidOn > new Date().toISOString().slice(0, 10)) {
      throw new Error("The received date cannot be in the future.");
    }
    if (
      (body.method === "upi" || body.method === "bank_transfer") &&
      !(body.utr ?? "").trim()
    ) {
      throw new Error("Enter the UTR / transaction number.");
    }

    // ---- plan: amount must equal what is due ------------------------------
    const plan = planManualPayment(
      {
        paymentStatus: enrollment.payment_status,
        caseType: enrollment.case_type,
        progressType: enrollment.progress?.type ?? null,
        totalHours: enrollment.progress?.total_hours ?? null,
        installmentMode: enrollment.installment_mode,
        amount: enrollment.amount,
        installment1: enrollment.installment1_amount,
        installment2: enrollment.installment2_amount,
      },
      amount,
    );
    if (!plan.ok) throw new Error(plan.error);

    // The proof file must really exist.
    const folder = body.proofPath.slice(0, body.proofPath.lastIndexOf("/"));
    const fileName = body.proofPath.slice(body.proofPath.lastIndexOf("/") + 1);
    const { data: listed, error: listError } = await supabase.storage
      .from("payment-proofs")
      .list(folder, { search: fileName, limit: 1 });
    if (listError || !listed?.some((f) => f.name === fileName)) {
      throw new Error("The proof image was not uploaded. Please try again.");
    }

    // ---- file the payment, point the order at it, complete it -------------
    const learner = enrollment.Learner as {
      id: string;
      name: string | null;
      phone: string | null;
      email: string | null;
    } | null;
    const { data: payment, error: paymentError } = await supabase
      .from("payment")
      .insert({
        learner_id: enrollment.learner_id,
        enrollment_id: enrollment.id,
        amount: plan.due,
        total_amount: enrollment.amount || plan.due,
        email: learner?.email ?? null,
        phone: learner?.phone ?? null,
        name: learner?.name ?? null,
        payment_type: plan.paymentType,
        status: "pending",
        installment_type: plan.installmentType,
        installment1_amount: enrollment.installment1_amount,
        installment2_amount: enrollment.installment2_amount,
        source: "manual",
        method: body.method,
        utr: (body.utr ?? "").trim() || null,
        paid_on: body.paidOn,
        proof_path: body.proofPath,
        recorded_by: (body.recordedByName ?? "").trim() || null,
        recorded_by_id: user.id,
        manual_note: (body.note ?? "").trim() || null,
      })
      .select("id")
      .single();
    if (paymentError || !payment) {
      throw new Error(paymentError?.message || "Could not record the payment.");
    }
    createdPaymentId = payment.id;

    // completePayment finds the order through enrollment.payment_id, exactly
    // as it does for a gateway payment.
    enrollmentIdForRollback = enrollment.id;
    previousPaymentId = enrollment.payment_id ?? null;
    const { error: pointError } = await supabase
      .from("enrollment")
      .update({ payment_id: payment.id })
      .eq("id", enrollment.id);
    if (pointError) throw pointError;

    await completePayment(
      supabase,
      payment.id,
      `manual:${(body.utr ?? "").trim() || payment.id}`,
    );

    const { data: after } = await supabase
      .from("enrollment")
      .select("payment_status")
      .eq("id", enrollment.id)
      .single();

    return json({
      success: true,
      paymentId: payment.id,
      paymentStatus: after?.payment_status ?? plan.resultingStatus,
    });
  } catch (err) {
    console.error("[record-manual-payment]", err);
    // Undo, best effort and in reverse order: the order pointer, the payment
    // row, then the proof file nobody will reference.
    try {
      if (enrollmentIdForRollback) {
        await supabase
          .from("enrollment")
          .update({ payment_id: previousPaymentId })
          .eq("id", enrollmentIdForRollback);
      }
      if (createdPaymentId) {
        await supabase.from("payment").delete().eq("id", createdPaymentId);
      }
      if (proofPathForCleanup) {
        await supabase.storage
          .from("payment-proofs")
          .remove([proofPathForCleanup]);
      }
    } catch (rollbackError) {
      console.error("[record-manual-payment] rollback failed", rollbackError);
    }
    const message =
      (err as { message?: string } | null)?.message ||
      "Could not record the payment.";
    return json({ success: false, error: message }, 400);
  }
});
