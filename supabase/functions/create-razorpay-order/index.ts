import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

import {
  assertLicencePayable,
  isLicenceEnrollment,
  type LicenceEnrollmentLike,
} from "../_shared/licence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, content-length",
  "Access-Control-Max-Age": "86400",
};

/**
 * Calculate how many lessons to unlock for half (first installment) payment.
 * 10hr→8, 8hr→6, 6hr→4, 4hr→2, 2hr→1. Demo (1hr) = full payment only.
 */
function getHalfPaymentLessons(totalHours: number): number[] {
  if (totalHours <= 1) return [1];
  if (totalHours === 2) return [1];
  const count = totalHours - 2;
  return Array.from({ length: count }, (_, i) => i + 1);
}

/**
 * Server-side guard against a tampered client amount. Given an enrollment the
 * admin already set up (which carries the negotiated total + installment split)
 * and the installment type being paid, return the amount the learner is
 * actually expected to pay — or null when we can't derive one (no stored
 * amount, e.g. a brand-new learner-initiated purchase) and validation should be
 * skipped. Reads the stored amount, never a hardcoded price, so a variable
 * demo/custom price is validated correctly.
 */
function expectedAmountFor(
  enrollment: {
    amount?: number | null;
    installment1_amount?: number | null;
    installment2_amount?: number | null;
  } | null,
  installmentType?: string,
): number | null {
  const total = Math.round(Number(enrollment?.amount) || 0);
  if (total <= 0) return null;
  const inst1 =
    Number(enrollment?.installment1_amount) > 0
      ? Math.round(Number(enrollment?.installment1_amount))
      : Math.round(total / 2);
  const inst2 =
    Number(enrollment?.installment2_amount) > 0
      ? Math.round(Number(enrollment?.installment2_amount))
      : total - inst1;
  if (installmentType === "second_half") return inst2;
  if (installmentType === "first_half") return inst1;
  return total;
}

/**
 * Throw if the client-supplied amount doesn't match what the enrollment says is
 * owed (±₹1 for independent rounding). No-op when no expected amount can be
 * derived, so learner-initiated first purchases are unaffected.
 */
function assertAmountMatchesEnrollment(
  amount: number,
  enrollment: {
    amount?: number | null;
    installment1_amount?: number | null;
    installment2_amount?: number | null;
  } | null,
  installmentType?: string,
): void {
  const expected = expectedAmountFor(enrollment, installmentType);
  if (expected !== null && Math.abs(Math.round(amount) - expected) > 1) {
    throw new Error(
      `Amount mismatch: this enrollment requires ₹${expected}, not ₹${Math.round(
        amount,
      )}.`,
    );
  }
}

/**
 * The full price this enrollment is being sold at, with any demo credit already
 * applied by the payment page. Persisting it on the enrollment is what makes
 * that price survive an abandoned payment: the payment page prefills from
 * enrollment.amount, and expectedAmountFor() only validates once it is set.
 * Without it a demo learner who dropped off mid-upgrade came back to the list
 * price (course) or to ₹0 (custom, which has no course row to fall back on).
 */
function resolveEnrollmentTotal(
  totalAmount?: number,
  installment1Amount?: number,
  installment2Amount?: number,
  amount?: number,
): number | null {
  const fromTotal = Math.round(Number(totalAmount) || 0);
  if (fromTotal > 0) return fromTotal;

  // A second_half payment carries only the remaining half in `amount`, so the
  // installments are the reliable source when totalAmount wasn't sent.
  const fromInstallments =
    Math.round(Number(installment1Amount) || 0) +
    Math.round(Number(installment2Amount) || 0);
  if (fromInstallments > 0) return fromInstallments;

  const fromAmount = Math.round(Number(amount) || 0);
  return fromAmount > 0 ? fromAmount : null;
}

interface PaymentDetails {
  amount: number;
  email: string;
  phone: string;
  paymentType: "course" | "demo" | "custom" | "topup";
  courseId?: string;
  name: string;
  learnerId?: string;
  installmentType?: "full" | "first_half" | "second_half";
  totalAmount?: number;
  installment1Amount?: number;
  installment2Amount?: number;
  selectedModules?: string[];
  totalHours?: number;
  isDemoUpgrade?: boolean;
  demoPaymentId?: string;
  courseSelectionType?: string;
  enrollmentId?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("MY_SUPABASE_URL") ?? "",
      Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";

    if (!razorpayKeyId || !razorpayKeySecret) {
      throw new Error("Razorpay credentials not configured");
    }

    const {
      amount,
      email,
      phone,
      paymentType,
      courseId,
      name,
      learnerId: providedLearnerId,
      installmentType,
      totalAmount,
      installment1Amount,
      installment2Amount,
      selectedModules,
      totalHours,
      isDemoUpgrade,
      demoPaymentId,
      courseSelectionType,
      enrollmentId,
    } = (await req.json()) as PaymentDetails;

    // 1. Find or create learner
    let learnerId: string;

    if (providedLearnerId) {
      const { data: existingLearner, error: learnerVerifyError } =
        await supabaseClient
          .from("Learner")
          .select("id")
          .eq("id", providedLearnerId)
          .single();

      if (learnerVerifyError || !existingLearner) {
        throw new Error("Invalid learner ID");
      }
      learnerId = providedLearnerId;

      // Update learner details if provided
      if (name || email) {
        const updateData: { name?: string; email?: string } = {};
        if (name) updateData.name = name;
        if (email) updateData.email = email;

        await supabaseClient
          .from("Learner")
          .update(updateData)
          .eq("id", learnerId);
      }
    } else {
      // Lookup by phone
      const { data: existingLearners, error: learnerQueryError } =
        await supabaseClient
          .from("Learner")
          .select()
          .eq("phone", phone)
          .order("created_at", { ascending: false })
          .limit(1);

      if (learnerQueryError) throw learnerQueryError;

      if (existingLearners?.length) {
        learnerId = existingLearners[0].id;
      } else {
        // Create new learner
        const { data: newLearner, error: learnerCreateError } =
          await supabaseClient
            .from("Learner")
            .insert([
              {
                email,
                phone,
                name,
                onboarding_completed: false,
              },
            ])
            .select()
            .single();

        if (learnerCreateError) throw learnerCreateError;
        learnerId = newLearner.id;
      }
    }

    // 1b. Licence service paid through its link: validate it BEFORE the payment
    // row exists, so a bad request leaves no orphan pending payment.
    let licenceEnrollment: LicenceEnrollmentLike | null = null;
    if (paymentType === "course" && !courseId && enrollmentId) {
      const { data: licenceRow, error: licenceError } = await supabaseClient
        .from("enrollment")
        .select("id, learner_id, case_type, payment_status, amount")
        .eq("id", enrollmentId)
        .maybeSingle();
      if (licenceError) throw licenceError;
      if (isLicenceEnrollment(licenceRow)) {
        assertLicencePayable(licenceRow, learnerId, amount);
        licenceEnrollment = licenceRow;
      }
    }

    // 2. Create payment record with gateway = 'razorpay'
    const { data: paymentRecord, error: dbError } = await supabaseClient
      .from("payment")
      .insert([
        {
          learner_id: learnerId,
          amount,
          email,
          phone,
          payment_type: paymentType,
          status: "pending",
          name,
          installment_type: installmentType,
          installment1_amount: installment1Amount,
          installment2_amount: installment2Amount,
          gateway: "razorpay",
        },
      ])
      .select()
      .single();

    if (dbError) throw dbError;

    // Price this enrollment is sold at (demo credit already applied
    // client-side). Stored on the enrollment so an abandoned payment
    // doesn't silently revert the learner to list price on their next visit.
    const enrollmentTotal = resolveEnrollmentTotal(
      totalAmount,
      installment1Amount,
      installment2Amount,
      amount,
    );

    // Handle demo upgrade
    if (isDemoUpgrade && demoPaymentId) {
      await supabaseClient
        .from("payment")
        .update({ status: "upgraded" })
        .eq("id", demoPaymentId);
    }

    // 2b. Licence service: attach this payment to its enrollment (the course
    // path below needs a courseId, so it would otherwise skip it).
    if (licenceEnrollment?.id) {
      const { error: licenceLinkError } = await supabaseClient
        .from("enrollment")
        .update({ payment_id: paymentRecord.id })
        .eq("id", licenceEnrollment.id);
      if (licenceLinkError) throw licenceLinkError;
    }

    // 3. Handle enrollment records (same logic as process-payment)
    if (paymentType === "course" && courseId) {
      const { data: existingEnrollment, error: enrollmentQueryError } =
        await supabaseClient
          .from("enrollment")
          .select("*")
          .eq("learner_id", learnerId)
          .eq("course_id", courseId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

      if (enrollmentQueryError) throw enrollmentQueryError;

      if (existingEnrollment) {
        if (existingEnrollment.payment_status === "full_paid") {
          throw new Error("This course is already fully paid for");
        }

        if (
          installmentType === "second_half" &&
          existingEnrollment.payment_status !== "half_paid"
        ) {
          throw new Error(
            "Cannot process second installment before first payment",
          );
        }

        // Reject a tampered amount against what this enrollment owes.
        assertAmountMatchesEnrollment(
          amount,
          existingEnrollment,
          installmentType,
        );

        await supabaseClient
          .from("enrollment")
          .update({
            payment_id: paymentRecord.id,
            status:
              existingEnrollment?.payment_status === "half_paid"
                ? "active"
                : "pending",
            installment_mode:
              installmentType || existingEnrollment.installment_mode,
            installment1_amount:
              installment1Amount || existingEnrollment.installment1_amount,
            installment2_amount:
              installment2Amount || existingEnrollment.installment2_amount,
            // Backfill only: an admin-negotiated price on this enrollment is
            // authoritative and must not be overwritten by the client.
            amount: existingEnrollment.amount || enrollmentTotal,
          })
          .eq("id", existingEnrollment.id);
      } else {
        // Unlock lessons for a first-half payment based on the course's actual
        // duration (hours), not a fixed 10-hour assumption.
        let courseHours = 10;
        const { data: courseRow } = await supabaseClient
          .from("Courses")
          .select("duration")
          .eq("id", courseId)
          .maybeSingle();
        if (courseRow?.duration && courseRow.duration > 0) {
          courseHours = courseRow.duration;
        }

        await supabaseClient.from("enrollment").insert([
          {
            learner_id: learnerId,
            course_id: courseId,
            payment_id: paymentRecord.id,
            status: "pending",
            payment_status: "pending",
            installment_mode: installmentType,
            installment1_amount: installment1Amount,
            installment2_amount: installment2Amount,
            amount: enrollmentTotal,
            unlocked_lessons:
              installmentType === "first_half"
                ? getHalfPaymentLessons(courseHours)
                : [],
          },
        ]);
      }
    }

    // Handle demo payment
    if (paymentType === "demo") {
      // Enforce demo cap: max 4 completed demos per learner
      const { data: existingDemos } = await supabaseClient
        .from("payment")
        .select("id")
        .eq("learner_id", learnerId)
        .eq("payment_type", "demo")
        .eq("status", "completed");
      if ((existingDemos?.length ?? 0) >= 4) {
        throw new Error(
          "Demo limit reached (max 4). Please choose a course or topup instead.",
        );
      }

      // Idempotent: if a pending demo enrollment already exists for this
      // learner (from an abandoned/retried payment), reuse it by updating
      // its payment_id. Otherwise insert a fresh one. Prevents the duplicate
      // "Demo Class" + "Unknown" rows in admin's Incomplete Payments tab.
      const { data: existingPendingDemo } = await supabaseClient
        .from("enrollment")
        .select("id")
        .eq("learner_id", learnerId)
        .is("course_id", null)
        .neq("payment_status", "full_paid")
        .filter("progress->>type", "eq", "demo")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingPendingDemo) {
        const { error: demoUpdateError } = await supabaseClient
          .from("enrollment")
          .update({
            payment_id: paymentRecord.id,
            status: "pending",
            payment_status: "pending",
            installment_mode: "full",
            unlocked_lessons: [1],
            progress: { type: "demo", total_hours: 1 },
          })
          .eq("id", existingPendingDemo.id);
        if (demoUpdateError) {
          console.error("Demo enrollment update failed:", demoUpdateError);
          throw new Error(
            `Failed to update demo enrollment: ${demoUpdateError.message}`,
          );
        }
      } else {
        const { error: demoEnrollError } = await supabaseClient
          .from("enrollment")
          .insert([
            {
              learner_id: learnerId,
              course_id: null,
              payment_id: paymentRecord.id,
              status: "pending",
              payment_status: "pending",
              installment_mode: "full",
              unlocked_lessons: [1],
              progress: { type: "demo", total_hours: 1 },
            },
          ]);
        if (demoEnrollError) {
          console.error("Demo enrollment insert failed:", demoEnrollError);
          throw new Error(
            `Failed to create demo enrollment: ${demoEnrollError.message}`,
          );
        }
      }
    }

    // Handle topup payment (N × ₹599 hour(s) for existing or completed-demo learners)
    if (paymentType === "topup") {
      const topupHours = Math.max(1, totalHours || 1);
      const topupUnlocked = Array.from({ length: topupHours }, (_, i) => i + 1);

      // Idempotent: same pattern as demo above.
      const { data: existingPendingTopup } = await supabaseClient
        .from("enrollment")
        .select("id")
        .eq("learner_id", learnerId)
        .is("course_id", null)
        .neq("payment_status", "full_paid")
        .filter("progress->>type", "eq", "topup")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingPendingTopup) {
        const { error: topupUpdateError } = await supabaseClient
          .from("enrollment")
          .update({
            payment_id: paymentRecord.id,
            status: "pending",
            payment_status: "pending",
            installment_mode: "full",
            unlocked_lessons: topupUnlocked,
            progress: { type: "topup", total_hours: topupHours },
          })
          .eq("id", existingPendingTopup.id);
        if (topupUpdateError) {
          console.error("Topup enrollment update failed:", topupUpdateError);
          throw new Error(
            `Failed to update topup enrollment: ${topupUpdateError.message}`,
          );
        }
      } else {
        const { error: topupEnrollError } = await supabaseClient
          .from("enrollment")
          .insert([
            {
              learner_id: learnerId,
              course_id: null,
              payment_id: paymentRecord.id,
              status: "pending",
              payment_status: "pending",
              installment_mode: "full",
              unlocked_lessons: topupUnlocked,
              progress: { type: "topup", total_hours: topupHours },
            },
          ]);
        if (topupEnrollError) {
          console.error("Topup enrollment insert failed:", topupEnrollError);
          throw new Error(
            `Failed to create topup enrollment: ${topupEnrollError.message}`,
          );
        }
      }
    }

    // Handle custom course payment
    if (paymentType === "custom") {
      // Reuse an existing pending custom enrollment (e.g. one an admin built and
      // sent a payment link for) instead of inserting a duplicate — mirrors the
      // demo/topup reuse pattern above and the process-payment (ICICI) flow. A
      // locked/admin link won't resend the modules, so fall back to whatever the
      // enrollment already recorded.
      const { data: existingPendingCustom } = await supabaseClient
        .from("enrollment")
        .select(
          "id, progress, amount, installment1_amount, installment2_amount",
        )
        .eq("learner_id", learnerId)
        .is("course_id", null)
        .neq("payment_status", "full_paid")
        .filter("progress->>type", "eq", "custom")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const existingProgress =
        (existingPendingCustom?.progress as {
          selected_modules?: string[];
          total_hours?: number;
          module_prices?: Record<string, number>;
        } | null) || null;
      const mergedModules =
        selectedModules && selectedModules.length > 0
          ? selectedModules
          : existingProgress?.selected_modules || [];
      const mergedHours = totalHours || existingProgress?.total_hours || 0;

      const lessonsToUnlock = Math.min(Math.ceil((mergedHours || 0) / 1), 10);
      const unlockedLessons = Array.from(
        { length: lessonsToUnlock },
        (_, i) => i + 1,
      );

      if (existingPendingCustom) {
        // Reject a tampered amount against the price the admin set up.
        assertAmountMatchesEnrollment(
          amount,
          existingPendingCustom,
          installmentType,
        );

        await supabaseClient
          .from("enrollment")
          .update({
            payment_id: paymentRecord.id,
            status: "pending",
            payment_status: "pending",
            installment_mode: installmentType || "full",
            installment1_amount:
              installment1Amount ||
              existingPendingCustom.installment1_amount ||
              null,
            installment2_amount:
              installment2Amount ||
              existingPendingCustom.installment2_amount ||
              null,
            // Backfill only — an admin-built custom course carries the price
            // ops negotiated, and that wins over anything the client sends.
            amount: existingPendingCustom.amount || enrollmentTotal,
            unlocked_lessons:
              installmentType === "first_half"
                ? getHalfPaymentLessons(mergedHours || 10)
                : unlockedLessons,
            progress: {
              type: "custom",
              selected_modules: mergedModules,
              total_hours: mergedHours,
              module_prices: existingProgress?.module_prices || {},
              is_demo_upgrade: isDemoUpgrade || false,
            },
          })
          .eq("id", existingPendingCustom.id);
      } else if (selectedModules && selectedModules.length > 0) {
        // No existing enrollment — a brand-new custom flow started by the learner.
        await supabaseClient.from("enrollment").insert([
          {
            learner_id: learnerId,
            course_id: null,
            payment_id: paymentRecord.id,
            status: "pending",
            payment_status: "pending",
            installment_mode: installmentType || "full",
            installment1_amount: installment1Amount,
            installment2_amount: installment2Amount,
            amount: enrollmentTotal,
            unlocked_lessons:
              installmentType === "first_half"
                ? getHalfPaymentLessons(mergedHours || 10)
                : unlockedLessons,
            progress: {
              type: "custom",
              selected_modules: selectedModules,
              total_hours: mergedHours,
              is_demo_upgrade: isDemoUpgrade || false,
            },
          },
        ]);
      }
    }

    // 4. Create Razorpay order
    const razorpayOrderData = {
      amount: Math.round(amount * 100), // Razorpay expects amount in paise
      currency: "INR",
      receipt: `ORD-${paymentRecord.id}`,
      notes: {
        payment_id: paymentRecord.id,
        learner_id: learnerId,
        payment_type: paymentType,
      },
    };

    const basicAuth = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);

    const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify(razorpayOrderData),
    });

    const razorpayOrder = await razorpayResponse.json();

    if (!razorpayResponse.ok) {
      console.error("Razorpay error:", razorpayOrder);
      throw new Error(
        razorpayOrder.error?.description || "Failed to create Razorpay order",
      );
    }

    // 5. Update payment record with Razorpay order ID
    await supabaseClient
      .from("payment")
      .update({
        gateway_reference: razorpayOrder.id,
      })
      .eq("id", paymentRecord.id);

    console.log("Razorpay order created:", {
      paymentId: paymentRecord.id,
      orderId: razorpayOrder.id,
    });

    // 6. Return order details for frontend
    return new Response(
      JSON.stringify({
        success: true,
        orderId: razorpayOrder.id,
        paymentId: paymentRecord.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        keyId: razorpayKeyId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
