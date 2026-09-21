// Shared Supabase side of the LL customer migration — used by both the bulk
// CSV import and the single-customer form so they behave identically.
import { supabase } from "@/lib/supabaseClient";
import {
  buildEnrollmentInsert,
  buildLearnerInsert,
  buildPaymentInsert,
  LLStage,
  ParsedLLRow,
} from "@/utils/llMigrationCsv";

// Generated DB types may lag behind ll_* tables (same pattern as llApplications.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

function dbErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return "Unknown database error";
}

/** Map CSV ll_stage → starting ll_applications.status so they show on the board. */
function pipelineStatusForStage(stage: LLStage): string {
  switch (stage) {
    case "has_ll":
      return "ll_issued";
    case "passed_waiting":
      return "ll_approval_pending";
    case "appointment_booked":
      return "meet_booking_enabled";
    case "not_started":
    default:
      return "payment_received";
  }
}

async function deleteLearnerCascade(learnerId: string): Promise<void> {
  // Best-effort cleanup so a failed course/pipeline import doesn't leave an
  // orphan Learner that then shows as "duplicate" on the next CSV upload.
  await sb.from("enrollment").delete().eq("learner_id", learnerId);
  await sb.from("payment").delete().eq("learner_id", learnerId);
  await sb.from("Learner").delete().eq("id", learnerId);
}

async function createPipelineApplication(
  row: ParsedLLRow,
  learnerId: string,
): Promise<string | null> {
  const status = pipelineStatusForStage(row.stage);
  const services = row.courseId ? ["ll", "classes", "dl"] : ["ll"];
  const insert: Record<string, unknown> = {
    learner_id: learnerId,
    services,
    status,
  };
  if (
    row.llApplicationId &&
    (row.stage === "has_ll" || row.stage === "passed_waiting")
  ) {
    insert.ll_number = row.llApplicationId;
  }
  if (row.llReceivedDate && row.stage === "has_ll") {
    insert.ll_issue_date = row.llReceivedDate;
  }
  if (row.llTestDate) {
    insert.ll_test_date = row.llTestDate;
  }

  const { data, error } = await sb
    .from("ll_applications")
    .insert(insert)
    .select("id")
    .single();
  if (error) return dbErrorMessage(error);

  await sb.from("ll_pipeline_events").insert({
    application_id: data.id,
    learner_id: learnerId,
    event_type: "status_change",
    to_status: status,
    note: `Created via LL Customer Migration (${row.stage})`,
  });
  return null;
}

// Create one migrated learner (+ optional payment/enrollment when a course is
// given) and an ll_applications row so they appear on the LL→DL board.
// Returns null on success, or an error message on failure.
export async function importLLCustomer(
  row: ParsedLLRow,
): Promise<string | null> {
  const { data: learner, error: learnerError } = await supabase
    .from("Learner")
    .insert(buildLearnerInsert(row) as never)
    .select("id")
    .single();
  if (learnerError) return dbErrorMessage(learnerError);
  if (!learner) return "Learner insert returned no row";
  const learnerId = (learner as { id: string }).id;

  if (row.courseId) {
    const { data: payment, error: paymentError } = await supabase
      .from("payment")
      .insert(buildPaymentInsert(row, learnerId) as never)
      .select("id")
      .single();
    if (paymentError) {
      await deleteLearnerCascade(learnerId);
      return `Payment failed: ${dbErrorMessage(paymentError)}`;
    }
    const paymentId = (payment as { id: string }).id;

    const { error: enrollmentError } = await supabase
      .from("enrollment")
      .insert(buildEnrollmentInsert(row, learnerId, paymentId) as never);
    if (enrollmentError) {
      await deleteLearnerCascade(learnerId);
      return `Enrollment failed: ${dbErrorMessage(enrollmentError)}`;
    }
  }

  const pipelineErr = await createPipelineApplication(row, learnerId);
  if (pipelineErr) {
    await deleteLearnerCascade(learnerId);
    return `Pipeline application failed: ${pipelineErr}`;
  }

  return null;
}

export async function phoneExists(phone: string): Promise<boolean> {
  const { data } = await supabase
    .from("Learner")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  return !!data;
}

export async function existingPhones(phones: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (!phones.length) return set;
  const { data } = await supabase
    .from("Learner")
    .select("phone")
    .in("phone", phones);
  for (const d of data ?? []) if (d.phone) set.add(d.phone as string);
  return set;
}
