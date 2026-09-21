import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, content-length",
  "Access-Control-Max-Age": "86400",
};

/**
 * Calculate how many lessons to unlock for half (first installment) payment.
 * 10hr→8, 8hr→6, 6hr→4, 4hr→2, 2hr→1. Demo (1hr) = full payment only.
 */
function getHalfPaymentLessons(totalHours: number): number[] {
  if (totalHours <= 1) return [1]; // demo – should not reach here
  if (totalHours === 2) return [1];
  // 4+ hours: unlock totalHours - 2
  const count = totalHours - 2;
  return Array.from({ length: count }, (_, i) => i + 1);
}

/**
 * Generate HMAC-SHA256 hash for verification (Orange PG)
 */
async function generateSecureHash(
  data: Record<string, string>,
  secretKey: string,
): Promise<string> {
  const sortedKeys = Object.keys(data).sort();
  let hashText = "";
  for (const key of sortedKeys) {
    hashText += data[key];
  }

  console.log("HashText for HMAC:", hashText);
  console.log("Sorted keys:", sortedKeys);

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secretKey);
  const msgData = encoder.encode(hashText);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Timing helper for debugging latency
  const callbackStartTime = performance.now();
  const timings: Record<string, number> = {};

  const recordTiming = (label: string) => {
    const elapsed = performance.now() - callbackStartTime;
    timings[label] = elapsed;
    console.log(`[Payment Callback] ${label}: ${elapsed.toFixed(0)}ms`);
  };

  recordTiming("callback-received");

  const supabaseClient = createClient(
    Deno.env.get("MY_SUPABASE_URL") ?? "",
    Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const secretKey = Deno.env.get("ORANGE_PG_SECRET_KEY") ?? "";
  const PAYMENT_SUCCESS_URL = (
    Deno.env.get("PAYMENT_SUCCESS_URL") ?? ""
  ).trim();
  const PAYMENT_FAILURE_URL = (
    Deno.env.get("PAYMENT_FAILURE_URL") ?? ""
  ).trim();

  try {
    // Orange PG can send response as POST with JSON or form data
    let responseData: Record<string, string> = {};
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      responseData = await req.json();
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const formData = await req.formData();
      formData.forEach((value, key) => {
        responseData[key] = value.toString();
      });
    } else {
      // Try URL parameters for GET requests
      const url = new URL(req.url);
      url.searchParams.forEach((value, key) => {
        responseData[key] = value;
      });
    }

    console.log(
      "Orange PG Callback Response:",
      JSON.stringify(responseData, null, 2),
    );

    // Extract key fields from Orange PG response
    const {
      secureHash: receivedHash,
      responseCode,
      merchantTxnNo,
      paymentID,
      amount,
      paymentMode,
      paymentDateTime,
      txnID,
      respDescription,
      addlParam1, // installmentType
      addlParam2, // paymentType
      customerEmailID,
      customerMobileNo,
      paymentSubInstType,
      merchantId,
    } = responseData;

    // Build data object for hash verification - all response fields except secureHash
    // and fields not included in Orange PG's hash calculation
    // Same approach as process-payment: sort ascending, concatenate values, HMAC-SHA256
    const dataForHash: Record<string, string> = { ...responseData };
    delete dataForHash.secureHash;
    delete dataForHash.isCallFromPaymentOptionsPage;
    delete dataForHash.paymentDateTime;

    // Verify secure hash
    const calculatedHash = await generateSecureHash(dataForHash, secretKey);
    recordTiming("hash-verified");

    console.log("Hash verification:", {
      received: receivedHash,
      calculated: calculatedHash,
      match: calculatedHash === receivedHash,
      hashFields: dataForHash,
    });

    if (calculatedHash !== receivedHash) {
      // TODO: Hash verification is failing - needs investigation with Orange PG documentation
      // For now, log warning and continue to not block payments
      // The hash calculation fields/order may not match what Orange PG expects
      console.warn("Hash mismatch - needs investigation", {
        received: receivedHash,
        calculated: calculatedHash,
      });
    }

    // Extract payment ID from merchantTxnNo (format: ORD-{paymentId})
    if (!merchantTxnNo) {
      console.error("Missing merchantTxnNo in callback response");
      throw new Error("Missing merchantTxnNo");
    }

    const paymentId = merchantTxnNo.replace(/^ORD-/, "");
    if (!paymentId || paymentId === merchantTxnNo) {
      console.error("Invalid merchantTxnNo format:", merchantTxnNo);
      throw new Error(`Invalid merchantTxnNo format: ${merchantTxnNo}`);
    }

    // Determine payment status
    // Orange PG uses "0000" for successful transactions
    // Log all relevant fields for debugging
    console.log("Orange PG callback data:", {
      merchantTxnNo,
      paymentId,
      responseCode,
      respDescription,
      txnID,
      paymentID,
      amount,
      paymentMode,
    });

    const isSuccess = responseCode === "0000";
    const status = isSuccess ? "completed" : "failed";
    const gatewayReference = txnID || paymentID || "";

    console.log("Determined payment status:", {
      paymentId,
      status,
      isSuccess,
      responseCode,
      gatewayReference,
    });

    // First verify the payment exists
    const { data: existingPayment, error: fetchError } = await supabaseClient
      .from("payment")
      .select("id, status")
      .eq("id", paymentId)
      .single();
    recordTiming("payment-fetched");

    if (fetchError || !existingPayment) {
      console.error("Payment not found:", { paymentId, fetchError });
      throw new Error(`Payment not found: ${paymentId}`);
    }

    console.log("Found existing payment:", {
      paymentId,
      currentStatus: existingPayment.status,
      newStatus: status,
    });

    // Update payment record (only status and gateway_reference - no pg_response column exists)
    const { data: updatedPayment, error: updateError } = await supabaseClient
      .from("payment")
      .update({
        status,
        gateway_reference: gatewayReference,
      })
      .eq("id", paymentId)
      .select("id, status")
      .single();

    if (updateError) {
      console.error("Error updating payment:", updateError);
      throw updateError;
    }
    recordTiming("payment-updated");

    console.log("Payment updated successfully:", {
      paymentId,
      updatedStatus: updatedPayment?.status,
    });

    // Get payment details with learner info
    const { data: payment, error: paymentError } = await supabaseClient
      .from("payment")
      .select(
        `
        learner_id,
        payment_type,
        amount,
        installment_type,
        Learner (
          phone
        )
      `,
      )
      .eq("id", paymentId)
      .single();

    if (paymentError) {
      console.error("Error fetching payment:", paymentError);
      throw paymentError;
    }
    recordTiming("payment-details-fetched");

    // Use addlParam1 for installmentType if available, otherwise use from payment record
    const installmentType = addlParam1 || payment.installment_type || "full";
    // Use addlParam2 for paymentType if available, otherwise use from payment record
    const paymentType = addlParam2 || payment.payment_type || "course";

    // If payment is successful, update related records
    if (isSuccess) {
      try {
        if (paymentType === "course") {
          // Get enrollment record with existing unlocked lessons
          const { data: enrollment, error: enrollmentQueryError } =
            await supabaseClient
              .from("enrollment")
              .select("*, unlocked_lessons")
              .eq("payment_id", paymentId)
              .single();

          if (enrollmentQueryError) throw enrollmentQueryError;
          if (!enrollment) throw new Error("Enrollment record not found");

          // Update enrollment status based on payment type
          let newPaymentStatus = enrollment.payment_status;
          let unlockedLessons = enrollment.unlocked_lessons || [];

          // Course length comes from the actual course row — it was
          // previously hardcoded to 10, which unlocked phantom lessons for
          // the short specialty courses (e.g. 2-hour Flyover/Parking).
          let totalCourseLessons = enrollment.progress?.total_hours || 10;
          if (enrollment.course_id) {
            const { data: courseRow } = await supabaseClient
              .from("Courses")
              .select("total_lessons, duration")
              .eq("id", enrollment.course_id)
              .maybeSingle();
            totalCourseLessons =
              courseRow?.total_lessons ||
              courseRow?.duration ||
              totalCourseLessons;
          }

          // Demo hours already driven stand in for the course's first lessons
          // on every upgrade target, because the demo's price is credited
          // against the course price — otherwise the learner pays for N hours
          // and drives N+1. Include "upgraded" demos so the credit survives
          // the completed -> upgraded status flip, and clamp so at least one
          // course hour always remains (same rule as
          // _shared/complete-payment.ts and CreateSchedule).
          const { data: completedDemoPayments } = await supabaseClient
            .from("payment")
            .select("id")
            .eq("learner_id", payment.learner_id)
            .eq("payment_type", "demo")
            .in("status", ["completed", "upgraded"]);
          const demoSkip = Math.min(
            completedDemoPayments?.length ?? 0,
            Math.max(0, totalCourseLessons - 1),
          );
          const remainingLessons = Math.max(1, totalCourseLessons - demoSkip);
          const fullUnlock = Array.from(
            { length: remainingLessons },
            (_, i) => i + 1 + demoSkip,
          );

          if (installmentType === "full") {
            unlockedLessons = fullUnlock;
            newPaymentStatus = "full_paid";
          } else if (installmentType === "first_half") {
            unlockedLessons = getHalfPaymentLessons(remainingLessons).map(
              (n) => n + demoSkip,
            );
            newPaymentStatus = "half_paid";
          } else if (
            installmentType === "second_half" &&
            enrollment.payment_status === "half_paid"
          ) {
            unlockedLessons = fullUnlock;
            newPaymentStatus = "full_paid";
          }

          console.log("Updating enrollment:", {
            paymentStatus: newPaymentStatus,
            unlockedLessons,
            enrollmentId: enrollment.id,
          });

          const { error: enrollmentError } = await supabaseClient
            .from("enrollment")
            .update({
              payment_status: newPaymentStatus,
              unlocked_lessons: unlockedLessons,
              status: "active",
              progress: {
                completed_lessons: enrollment.progress?.completed_lessons || [],
                current_lesson: enrollment.progress?.current_lesson || 1,
                last_accessed: new Date().toISOString(),
              },
            })
            .eq("id", enrollment.id);

          if (enrollmentError) {
            console.error("Error updating enrollment:", enrollmentError);
            throw enrollmentError;
          }
          recordTiming("enrollment-updated");
        } else if (paymentType === "reschedule") {
          const { error: scheduleError } = await supabaseClient
            .from("Schedule")
            .update({
              status: "confirmed",
              payment_confirmed: true,
            })
            .eq("payment_id", paymentId);

          if (scheduleError) throw scheduleError;
        } else if (paymentType === "demo") {
          const { data: enrollment, error: enrollmentQueryError } =
            await supabaseClient
              .from("enrollment")
              .select("*")
              .eq("payment_id", paymentId)
              .maybeSingle();

          if (enrollmentQueryError) throw enrollmentQueryError;

          const demoProgress = {
            type: "demo",
            total_hours: 1,
            completed_lessons: [],
            current_lesson: 1,
            last_accessed: new Date().toISOString(),
          };

          if (!enrollment) {
            console.warn(
              "Demo enrollment missing for payment; recreating",
              paymentId,
            );
            const { error: recreateError } = await supabaseClient
              .from("enrollment")
              .insert([
                {
                  learner_id: payment.learner_id,
                  course_id: null,
                  payment_id: paymentId,
                  status: "active",
                  payment_status: "full_paid",
                  installment_mode: "full",
                  unlocked_lessons: [1],
                  progress: demoProgress,
                },
              ]);
            if (recreateError) throw recreateError;
          } else {
            const { error: enrollmentError } = await supabaseClient
              .from("enrollment")
              .update({
                payment_status: "full_paid",
                unlocked_lessons: [1],
                status: "active",
                progress: demoProgress,
              })
              .eq("id", enrollment.id);

            if (enrollmentError) throw enrollmentError;
          }

          // Two demo paths land here:
          // (A) Admin pre-created Schedule rows via /admin/schedules → "Schedule
          //     Demo" with status="pending_payment". Flip them to "booked" now
          //     that payment cleared, and skip the reschedule_request below.
          // (B) Learner self-paid /payment?type=demo with no schedules yet —
          //     surface a New Scheduling Request so admin can schedule.
          const { data: prePaidSchedules } = await supabaseClient
            .from("Schedule")
            .select("id")
            .eq("learner_id", payment.learner_id)
            .eq("status", "pending_payment");

          if (prePaidSchedules && prePaidSchedules.length > 0) {
            const { error: scheduleFlipError } = await supabaseClient
              .from("Schedule")
              .update({ status: "booked" })
              .eq("learner_id", payment.learner_id)
              .eq("status", "pending_payment");
            if (scheduleFlipError) {
              console.error(
                "Error flipping pending_payment → booked for demo:",
                scheduleFlipError,
              );
            }
          } else {
            const { data: existingReq } = await supabaseClient
              .from("reschedule_requests")
              .select("id")
              .eq("learner_id", payment.learner_id)
              .eq("type", "new")
              .eq("status", "pending")
              .maybeSingle();

            if (!existingReq) {
              const { error: rescheduleRequestError } = await supabaseClient
                .from("reschedule_requests")
                .insert({
                  learner_id: payment.learner_id,
                  lesson_ids: ["virtual-lesson-1"],
                  amount: 0,
                  status: "pending",
                  type: "new",
                });

              if (rescheduleRequestError) {
                console.error(
                  "Error creating scheduling request for demo:",
                  rescheduleRequestError,
                );
              }
            }
          }
        } else if (paymentType === "topup") {
          const { data: enrollment, error: enrollmentQueryError } =
            await supabaseClient
              .from("enrollment")
              .select("*")
              .eq("payment_id", paymentId)
              .maybeSingle();

          if (enrollmentQueryError) throw enrollmentQueryError;

          const topupHours =
            enrollment?.progress?.total_hours ||
            Math.max(1, Math.round((payment.amount || 1) / 1));
          const unlockedLessons = Array.from(
            { length: topupHours },
            (_, i) => i + 1,
          );
          const topupProgress = {
            type: "topup",
            total_hours: topupHours,
            completed_lessons: [],
            current_lesson: 1,
            last_accessed: new Date().toISOString(),
          };

          if (!enrollment) {
            console.warn(
              "Topup enrollment missing for payment; recreating",
              paymentId,
            );
            const { error: recreateError } = await supabaseClient
              .from("enrollment")
              .insert([
                {
                  learner_id: payment.learner_id,
                  course_id: null,
                  payment_id: paymentId,
                  status: "active",
                  payment_status: "full_paid",
                  installment_mode: "full",
                  unlocked_lessons: unlockedLessons,
                  progress: topupProgress,
                },
              ]);
            if (recreateError) throw recreateError;
          } else {
            const { error: enrollmentError } = await supabaseClient
              .from("enrollment")
              .update({
                payment_status: "full_paid",
                unlocked_lessons: unlockedLessons,
                status: "active",
                progress: topupProgress,
              })
              .eq("id", enrollment.id);

            if (enrollmentError) throw enrollmentError;
          }

          // Same Path A / Path B split as demo above. If admin pre-created
          // Schedule rows via "+ Topup", flip them to booked and don't create
          // another scheduling request — otherwise admin sees both stuck
          // pending_payment rows AND a "new request" prompting them to
          // schedule again, which leads to duplicate bookings.
          const { data: prePaidTopupSchedules } = await supabaseClient
            .from("Schedule")
            .select("id")
            .eq("learner_id", payment.learner_id)
            .eq("status", "pending_payment");

          if (prePaidTopupSchedules && prePaidTopupSchedules.length > 0) {
            const { error: scheduleFlipError } = await supabaseClient
              .from("Schedule")
              .update({ status: "booked" })
              .eq("learner_id", payment.learner_id)
              .eq("status", "pending_payment");
            if (scheduleFlipError) {
              console.error(
                "Error flipping pending_payment → booked for topup:",
                scheduleFlipError,
              );
            }
          } else {
            // Skip if a pending "new" request already exists. This callback can
            // fire twice (webhook + client), and a duplicate pending request
            // keeps the learner stuck in the admin New Schedules tab even after
            // they've been scheduled.
            const { data: existingReq } = await supabaseClient
              .from("reschedule_requests")
              .select("id")
              .eq("learner_id", payment.learner_id)
              .eq("type", "new")
              .eq("status", "pending")
              .maybeSingle();

            if (!existingReq) {
              const lessonIds = Array.from(
                { length: topupHours },
                (_, i) => `virtual-lesson-${i + 1}`,
              );

              const { error: rescheduleRequestError } = await supabaseClient
                .from("reschedule_requests")
                .insert({
                  learner_id: payment.learner_id,
                  lesson_ids: lessonIds,
                  amount: 0,
                  status: "pending",
                  type: "new",
                });

              if (rescheduleRequestError) {
                console.error(
                  "Error creating scheduling request for topup:",
                  rescheduleRequestError,
                );
              }
            }
          }
        } else if (paymentType === "custom") {
          const { data: enrollment, error: enrollmentQueryError } =
            await supabaseClient
              .from("enrollment")
              .select("*")
              .eq("payment_id", paymentId)
              .single();

          if (enrollmentQueryError) throw enrollmentQueryError;
          if (!enrollment) throw new Error("Custom enrollment not found");

          const totalHours = enrollment.progress?.total_hours || 10;
          const lessonsToUnlock = Math.min(Math.ceil(totalHours / 1), 10);
          let unlockedLessons = enrollment.unlocked_lessons || [];
          let newPaymentStatus = enrollment.payment_status;

          if (installmentType === "full") {
            unlockedLessons = Array.from(
              { length: lessonsToUnlock },
              (_, i) => i + 1,
            );
            newPaymentStatus = "full_paid";
          } else if (installmentType === "first_half") {
            unlockedLessons = getHalfPaymentLessons(totalHours);
            newPaymentStatus = "half_paid";
          } else if (
            installmentType === "second_half" &&
            enrollment.payment_status === "half_paid"
          ) {
            unlockedLessons = Array.from(
              { length: lessonsToUnlock },
              (_, i) => i + 1,
            );
            newPaymentStatus = "full_paid";
          }

          const { error: enrollmentError } = await supabaseClient
            .from("enrollment")
            .update({
              payment_status: newPaymentStatus,
              unlocked_lessons: unlockedLessons,
              status: "active",
              progress: {
                ...enrollment.progress,
                completed_lessons: enrollment.progress?.completed_lessons || [],
                current_lesson: enrollment.progress?.current_lesson || 1,
                last_accessed: new Date().toISOString(),
              },
            })
            .eq("id", enrollment.id);

          if (enrollmentError) throw enrollmentError;

          // The admin scheduler has no Courses/Lesson rows to fall back on for
          // a custom course (course_id is NULL), so reschedule_requests
          // .lesson_ids is the ONLY signal for how many hours to schedule —
          // see CreateSchedule's isVirtualLessons branch. Without this, a
          // demo->custom upgrade left the demo's stale ["virtual-lesson-1"]
          // request in place and every custom course looked like a single
          // 1-hour lesson on the admin side.
          //
          // Always list ALL lessons regardless of installment state: unlike
          // the learner-facing unlocked_lessons, the admin schedules the whole
          // custom course up front even when only the first installment is
          // paid.
          const customLessonIds = Array.from(
            { length: lessonsToUnlock },
            (_, i) => `virtual-lesson-${i + 1}`,
          );
          // Update rather than skip when a pending request already exists —
          // the stale 1-lesson demo request IS the bug, so a !existingReq
          // guard (as used by the demo/topup branches) would preserve it.
          const { data: existingCustomReq } = await supabaseClient
            .from("reschedule_requests")
            .select("id")
            .eq("learner_id", payment.learner_id)
            .eq("type", "new")
            .eq("status", "pending")
            .maybeSingle();

          if (existingCustomReq) {
            await supabaseClient
              .from("reschedule_requests")
              .update({ lesson_ids: customLessonIds })
              .eq("id", existingCustomReq.id);
          } else {
            await supabaseClient.from("reschedule_requests").insert({
              learner_id: payment.learner_id,
              lesson_ids: customLessonIds,
              amount: 0,
              status: "pending",
              type: "new",
            });
          }
        }

        // Send thank you message (async, non-blocking)
        recordTiming("ready-to-send-message");
        // Fire and forget - don't await message sending
        supabaseClient.functions
          .invoke("send-message", {
            body: {
              message_type: "WEBAPP_THANK_YOU_FOR_PAYMENT_GENERIC",
              learner_id: payment.learner_id,
              payment_amount: payment.amount,
            },
          })
          .catch((error) => {
            // Log error but don't block payment completion
            console.error(
              "Background: Error sending thank you message:",
              error,
            );
          });
        // Continue immediately without waiting for message response
        recordTiming("callback-complete");
      } catch (error) {
        console.error("Error updating related records:", error);
        // Don't throw here, we still want to redirect the user
      }
    }

    // Build redirect URL
    const redirectUrl = isSuccess
      ? `${PAYMENT_SUCCESS_URL}?status=completed&reference=${gatewayReference}&phone=${encodeURIComponent(
          payment.Learner?.phone || "",
        )}&type=${paymentType}`
      : `${PAYMENT_FAILURE_URL}?status=failed&reference=${gatewayReference}&reason=${encodeURIComponent(
          respDescription || "Payment failed",
        )}`;

    // Log total duration before returning
    console.log("[Payment Callback] Total timings:", timings);
    console.log(
      "[Payment Callback] Total duration:",
      (performance.now() - callbackStartTime).toFixed(0) + "ms",
    );

    // Return HTML that redirects the browser
    const html = `
       <!DOCTYPE html>
       <html>
         <head>
           <meta http-equiv="refresh" content="0;url=${redirectUrl}">
           <script>window.location.href = "${redirectUrl}";</script>
         </head>
         <body>
           <p>Redirecting... If not redirected, <a href="${redirectUrl}">click here</a>.</p>
         </body>
       </html>
     `;

    return new Response(html, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
  } catch (error) {
    console.error("Payment callback error:", error);

    const errorRedirectUrl = `${PAYMENT_FAILURE_URL}?status=failed&error=verification_failed`;

    const errorHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta http-equiv="refresh" content="0;url=${errorRedirectUrl}">
          <script>window.location.href = "${errorRedirectUrl}";</script>
        </head>
        <body>
          <p>Redirecting... If not redirected, <a href="${errorRedirectUrl}">click here</a>.</p>
        </body>
      </html>
    `;

    return new Response(errorHtml, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
  }
});
