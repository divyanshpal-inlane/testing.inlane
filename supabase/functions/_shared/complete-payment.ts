import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

function getHalfPaymentLessons(totalHours: number): number[] {
  if (totalHours <= 1) return [1];
  if (totalHours === 2) return [1];
  const count = totalHours - 2;
  return Array.from({ length: count }, (_, i) => i + 1);
}

/**
 * How many of an upgraded course's hours the learner's completed demos already
 * cover. Each demo is 1 hr of car time and its price is credited against the
 * course price on upgrade, so the hour comes off the course too — otherwise
 * the learner pays for N hours and drives N+1. Applies to every upgrade
 * target: Beginner, specialty and custom courses alike.
 *
 * Counts "upgraded" alongside "completed" — a demo payment flips
 * completed -> upgraded when the upgrade order is created, so counting only
 * "completed" would lose the credit for exactly the population this exists for.
 *
 * Clamped to leave at least one course hour, so a 2-hr specialty course after
 * one demo schedules its 2nd hour instead of collapsing to nothing.
 *
 * Mirrors demoLessonOffsetFor() in src/constants/courses.ts and the copy in
 * payment-callback/index.ts — keep the three in sync.
 */
async function getDemoLessonOffset(
  supabaseClient: SupabaseClient,
  learnerId: string,
  totalHours: number,
): Promise<number> {
  const { data: demoPayments } = await supabaseClient
    .from("payment")
    .select("id")
    .eq("learner_id", learnerId)
    .eq("payment_type", "demo")
    .in("status", ["completed", "upgraded"]);

  return Math.min(demoPayments?.length ?? 0, Math.max(0, totalHours - 1));
}

export interface CompletePaymentResult {
  alreadyCompleted: boolean;
  paymentId: string;
  paymentType: string;
  learnerId: string;
}

/**
 * Marks a payment as completed and runs all downstream updates
 * (enrollment, schedules, reschedule_requests, thank-you message).
 *
 * Idempotent: if the payment is already "completed", returns early
 * without modifying any state. Safe to call from multiple paths
 * (frontend verify, webhook, admin recovery).
 *
 * Shared by verify-razorpay-payment, razorpay-webhook, and
 * recover-razorpay-payment.
 */
export async function completePayment(
  supabaseClient: SupabaseClient,
  paymentId: string,
  gatewayReference: string,
): Promise<CompletePaymentResult> {
  const { data: payment, error: paymentError } = await supabaseClient
    .from("payment")
    .select(
      `
      id,
      learner_id,
      payment_type,
      amount,
      installment_type,
      status,
      Learner (
        phone
      )
    `,
    )
    .eq("id", paymentId)
    .single();

  if (paymentError || !payment) {
    throw new Error(`Payment not found: ${paymentId}`);
  }

  if (payment.status === "completed") {
    return {
      alreadyCompleted: true,
      paymentId,
      paymentType: payment.payment_type || "course",
      learnerId: payment.learner_id,
    };
  }

  const { error: updateError } = await supabaseClient
    .from("payment")
    .update({ status: "completed", gateway_reference: gatewayReference })
    .eq("id", paymentId);

  if (updateError) throw updateError;

  const installmentType = payment.installment_type || "full";
  const paymentType = payment.payment_type || "course";

  if (paymentType === "course") {
    const { data: enrollment, error: enrollmentQueryError } =
      await supabaseClient
        .from("enrollment")
        .select("*, unlocked_lessons")
        .eq("payment_id", paymentId)
        .single();
    if (enrollmentQueryError) throw enrollmentQueryError;
    if (!enrollment) throw new Error("Enrollment record not found");

    let newPaymentStatus = enrollment.payment_status;
    let unlockedLessons = enrollment.unlocked_lessons || [];

    // Course length comes from the actual course row — it was previously
    // hardcoded to 10, which unlocked phantom lessons for the short specialty
    // courses (e.g. 2-hour Flyover/Parking).
    let totalCourseLessons = enrollment.progress?.total_hours || 10;
    if (enrollment.course_id) {
      const { data: courseRow } = await supabaseClient
        .from("Courses")
        .select("total_lessons, duration")
        .eq("id", enrollment.course_id)
        .maybeSingle();
      totalCourseLessons =
        courseRow?.total_lessons || courseRow?.duration || totalCourseLessons;
    }

    // Demo hours already driven stand in for the course's first lessons, so
    // unlock only what's left (e.g. 2..10 on a 10-lesson course after 1 demo).
    // Must stay in sync with the same offset in CreateSchedule.
    const demoSkip = await getDemoLessonOffset(
      supabaseClient,
      payment.learner_id,
      totalCourseLessons,
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
    if (enrollmentError) throw enrollmentError;
  } else if (paymentType === "reschedule") {
    const { error: scheduleError } = await supabaseClient
      .from("Schedule")
      .update({ status: "confirmed", payment_confirmed: true })
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

    const { data: prePaidSchedules } = await supabaseClient
      .from("Schedule")
      .select("id")
      .eq("learner_id", payment.learner_id)
      .eq("status", "pending_payment");

    if (prePaidSchedules && prePaidSchedules.length > 0) {
      await supabaseClient
        .from("Schedule")
        .update({ status: "booked" })
        .eq("learner_id", payment.learner_id)
        .eq("status", "pending_payment");
    } else {
      const { data: existingReq } = await supabaseClient
        .from("reschedule_requests")
        .select("id")
        .eq("learner_id", payment.learner_id)
        .eq("type", "new")
        .eq("status", "pending")
        .maybeSingle();
      if (!existingReq) {
        await supabaseClient.from("reschedule_requests").insert({
          learner_id: payment.learner_id,
          lesson_ids: ["virtual-lesson-1"],
          amount: 0,
          status: "pending",
          type: "new",
        });
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
    const unlockedLessons = Array.from({ length: topupHours }, (_, i) => i + 1);
    const topupProgress = {
      type: "topup",
      total_hours: topupHours,
      completed_lessons: [],
      current_lesson: 1,
      last_accessed: new Date().toISOString(),
    };

    if (!enrollment) {
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

    const { data: prePaidTopupSchedules } = await supabaseClient
      .from("Schedule")
      .select("id")
      .eq("learner_id", payment.learner_id)
      .eq("status", "pending_payment");

    if (prePaidTopupSchedules && prePaidTopupSchedules.length > 0) {
      await supabaseClient
        .from("Schedule")
        .update({ status: "booked" })
        .eq("learner_id", payment.learner_id)
        .eq("status", "pending_payment");
    } else {
      // Don't create a second pending "new" request if one already exists —
      // this payment path can run twice (webhook + client callback), and a
      // duplicate pending request leaks the learner into the admin New
      // Schedules tab even after they've been scheduled.
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
        await supabaseClient.from("reschedule_requests").insert({
          learner_id: payment.learner_id,
          lesson_ids: lessonIds,
          amount: 0,
          status: "pending",
          type: "new",
        });
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
    const purchasedLessons = Math.min(Math.ceil(totalHours / 1), 10);

    // A custom course is an upgrade target like any other: the demo's price is
    // credited against it on the payment page, so the demo hour comes off the
    // hours delivered. progress.total_hours stays at the PURCHASED figure (it
    // backs the module list and price validation) — only the schedulable count
    // shrinks. Virtual lessons carry no real lesson numbers, so the hours are
    // renumbered 1..N rather than offset like a real course's 2..10.
    const customDemoSkip = await getDemoLessonOffset(
      supabaseClient,
      payment.learner_id,
      purchasedLessons,
    );
    const lessonsToUnlock = Math.max(1, purchasedLessons - customDemoSkip);
    let unlockedLessons = enrollment.unlocked_lessons || [];
    let newPaymentStatus = enrollment.payment_status;

    if (installmentType === "full") {
      unlockedLessons = Array.from(
        { length: lessonsToUnlock },
        (_, i) => i + 1,
      );
      newPaymentStatus = "full_paid";
    } else if (installmentType === "first_half") {
      // Half of the hours actually being delivered, not of the purchased
      // total — otherwise a demo-credited course unlocks an hour it no
      // longer has.
      unlockedLessons = getHalfPaymentLessons(lessonsToUnlock);
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

    // The admin scheduler has no Courses/Lesson rows to fall back on for a
    // custom course (course_id is NULL), so reschedule_requests.lesson_ids is
    // the ONLY signal for how many hours to schedule — see CreateSchedule's
    // isVirtualLessons branch. Without this, a demo->custom upgrade left the
    // demo's stale ["virtual-lesson-1"] request in place and every custom
    // course looked like a single 1-hour lesson on the admin side.
    //
    // Always list ALL deliverable lessons regardless of installment state:
    // unlike the learner-facing unlocked_lessons, the admin schedules the whole
    // custom course up front even when only the first installment is paid.
    // "Deliverable" is purchased hours minus demo hours already driven.
    const customLessonIds = Array.from(
      { length: lessonsToUnlock },
      (_, i) => `virtual-lesson-${i + 1}`,
    );
    // Update rather than skip when a pending request already exists — the
    // stale 1-lesson demo request IS the bug, so a !existingReq guard (as used
    // by the demo/topup branches) would silently preserve it.
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

  // LL-first learners: open their LL->DL journey at "Payment Received" so the
  // homepage shows the Fill-LL-Form state and the day-1/day-2 form reminders
  // (ll-flow-reminders) anchor to the payment date. Skipped for learners who
  // already hold an LL/DL or already have an active application.
  if (paymentType === "course" || paymentType === "custom") {
    try {
      const { data: learnerFlags } = await supabaseClient
        .from("Learner")
        .select("has_a_DL, LL_received")
        .eq("id", payment.learner_id)
        .single();

      if (!learnerFlags?.has_a_DL && !learnerFlags?.LL_received) {
        const { data: activeApp } = await supabaseClient
          .from("ll_applications")
          .select("id")
          .eq("learner_id", payment.learner_id)
          .not("status", "in", "(dl_delivered,closed)")
          .maybeSingle();

        if (!activeApp) {
          const { data: created, error: createError } = await supabaseClient
            .from("ll_applications")
            .insert({
              learner_id: payment.learner_id,
              services: ["ll"],
              status: "payment_received",
            })
            .select("id")
            .single();
          if (createError) throw createError;
          await supabaseClient.from("ll_pipeline_events").insert({
            application_id: created.id,
            learner_id: payment.learner_id,
            event_type: "status_change",
            to_status: "payment_received",
            actor_name: "System",
            note: "Journey opened automatically on course payment",
          });
        }
      }
    } catch (llErr) {
      // Never let journey bookkeeping fail the payment completion.
      console.error("Error opening LL application:", llErr);
    }
  }

  try {
    await supabaseClient.functions.invoke("send-message", {
      body: {
        message_type: "WEBAPP_THANK_YOU_FOR_PAYMENT_GENERIC",
        learner_id: payment.learner_id,
        payment_amount: payment.amount,
      },
    });
  } catch (msgErr) {
    console.error("Error invoking send-message:", msgErr);
  }

  return {
    alreadyCompleted: false,
    paymentId,
    paymentType,
    learnerId: payment.learner_id,
  };
}
