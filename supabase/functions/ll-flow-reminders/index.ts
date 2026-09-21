// Daily sweep over active LL applications (RTO-flow spec):
//   * LL form not filled       -> day-1 / day-2 nudges, then help offer +
//                                 Ops follow-up queue entry (escalation)
//   * appointment not booked   -> 24h / 48h nudges; 48h flags Action Required
//   * LL test not taken        -> day-3 office-slot offer, day-5 home-visit
//                                 offer + escalation (day-7 expiry itself is
//                                 handled by the ll_process_expiries pg_cron)
//   * scrutiny expired         -> one-time "pay fresh govt fee & reapply"
//   * LL expiring in <=30 days -> one-time DL-test warning
//
// Each nudge is recorded in ll_applications.reminders_sent so re-runs never
// double-send. Schedule daily (e.g. 04:30 UTC / 10:00 IST) via the Supabase
// dashboard cron, like send-signup-reminders.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

import { heltarMessageService } from "../heltar-service.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}

function hoursSince(iso: string | null): number {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

function daysUntil(isoDate: string | null): number | null {
  if (!isoDate) return null;
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / DAY_MS);
}

interface DueReminder {
  /** reminders_sent key — one send ever per key per application. */
  key: string;
  /** heltar-service message type. */
  messageType: string;
  /**
   * Earlier rungs of the same ladder, stamped as sent without messaging.
   * Prevents a catch-up run (e.g. first deploy) from firing day-1 AND
   * day-2 AND the help offer at the same moment.
   */
  supersedes?: string[];
  /** When set, also flag the application into the Ops follow-up queue. */
  escalateReason?: string;
}

// deno-lint-ignore no-explicit-any
function dueReminders(app: any): DueReminder[] {
  const sent: Record<string, string> = app.reminders_sent ?? {};
  const due: DueReminder[] = [];
  // Each ladder is ordered mildest-first; only the most severe unsent rung
  // fires today, and the rungs below it are marked as superseded.
  const ladder = (rungs: DueReminder[]) => {
    for (let i = rungs.length - 1; i >= 0; i--) {
      if (!sent[rungs[i].key]) {
        due.push({
          ...rungs[i],
          supersedes: rungs
            .slice(0, i)
            .map((r) => r.key)
            .filter((k) => !sent[k]),
        });
        return;
      }
    }
  };

  // 1. Payment done, LL form still not filled (day 1 / day 2 / help offer).
  if (app.status === "payment_received" || app.status === "docs_link_sent") {
    const days = daysSince(app.created_at);
    const rungs: DueReminder[] = [];
    if (days >= 1)
      rungs.push({ key: "form_day1", messageType: "LL_FORM_REMINDER_DAY1" });
    if (days >= 2)
      rungs.push({ key: "form_day2", messageType: "LL_FORM_REMINDER_DAY2" });
    if (days > 2)
      rungs.push({
        key: "form_help",
        messageType: "LL_FORM_HELP_OFFER",
        escalateReason: `LL form not filled ${days} days after payment — call the customer`,
      });
    ladder(rungs);
  }

  // 2. Docs approved, appointment not booked (24h / 48h).
  if (app.status === "meet_booking_enabled") {
    const hours = hoursSince(app.status_changed_at);
    const rungs: DueReminder[] = [];
    if (hours >= 24)
      rungs.push({ key: "appt_24h", messageType: "LL_APPT_REMINDER_24H" });
    if (hours >= 48)
      rungs.push({
        key: "appt_48h",
        messageType: "LL_APPT_REMINDER_48H",
        escalateReason:
          "Action Required: appointment not booked 48h after documents were approved",
      });
    ladder(rungs);
  }

  // 3. Scrutiny passed, LL test not taken (day 3 office / day 5 home visit).
  if (app.status === "ll_test_enabled") {
    const days = daysSince(app.scrutiny_approved_date ?? app.status_changed_at);
    const rungs: DueReminder[] = [];
    if (days >= 3)
      rungs.push({
        key: "test_day3",
        messageType: "LL_TEST_HELP_OFFICE_SLOT",
      });
    if (days >= 5)
      rungs.push({
        key: "test_day5",
        messageType: "LL_TEST_HELP_HOME_VISIT",
        escalateReason: `LL test not taken ${days} days after scrutiny — offer a home visit`,
      });
    ladder(rungs);
  }

  // 4. DL test confirmed — countdown reminders (3 days / 1 day / test-day).
  if (app.status === "dl_test_scheduled" && app.dl_test_date) {
    const until = daysUntil(app.dl_test_date);
    if (until !== null && until >= 0) {
      const rungs: DueReminder[] = [];
      if (until <= 3)
        rungs.push({ key: "dl_3d", messageType: "DL_TEST_REMINDER_3DAYS" });
      if (until <= 1)
        rungs.push({ key: "dl_1d", messageType: "DL_TEST_REMINDER_1DAY" });
      if (until === 0)
        rungs.push({ key: "dl_day0", messageType: "DL_TEST_DAY_MORNING" });
      ladder(rungs);
    }
  }

  // 5. Scrutiny expired (status set by the combined expiry sweep).
  if (app.status === "scrutiny_expired" && !sent.scrutiny_expired) {
    due.push({
      key: "scrutiny_expired",
      messageType: "LL_SCRUTINY_EXPIRED_REAPPLY",
    });
  }

  // 6. LL expiring within 30 days (any post-issue status).
  const untilExpiry = daysUntil(app.ll_expiry_date);
  if (
    untilExpiry !== null &&
    untilExpiry >= 0 &&
    untilExpiry <= 30 &&
    !sent.expiry_30d
  ) {
    due.push({ key: "expiry_30d", messageType: "LL_EXPIRY_WARNING_30DAYS" });
  }

  return due;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("MY_SUPABASE_URL") ?? "",
      Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // V1 item 9: promote matured / classes−1 learners before sending nudges,
    // and notify them to pick a DL test date.
    try {
      const { data: promoted, error: promoteError } =
        await supabase.rpc("ll_auto_promote_dl");
      if (promoteError) {
        console.error(
          "[ll-flow-reminders] ll_auto_promote_dl failed:",
          promoteError,
        );
      } else {
        for (const row of promoted ?? []) {
          const messageType =
            row.to_status === "ll_matured"
              ? "LL_MATURED_SELECT_DL_DATE"
              : row.to_status === "dl_date_selection"
                ? "CLASSES_COMPLETED_SELECT_DL_DATE"
                : null;
          if (!messageType || !row.learner_id) continue;
          try {
            await heltarMessageService.processMessageRequest(messageType, {
              learner_id: row.learner_id,
            });
          } catch (e) {
            console.error(
              "[ll-flow-reminders] promote WhatsApp failed:",
              row.application_id,
              e,
            );
          }
        }
      }
    } catch (e) {
      console.error("[ll-flow-reminders] auto-promote sweep error:", e);
    }

    const { data: applications, error } = await supabase
      .from("ll_applications")
      .select("*, Learner(id, name, phone)")
      .not("status", "in", "(dl_delivered,closed)");
    if (error) throw error;

    const results: {
      application_id: string;
      key: string;
      success: boolean;
      error?: string;
    }[] = [];

    for (const app of applications ?? []) {
      if (!app.Learner?.phone) continue;
      const due = dueReminders(app);
      if (due.length === 0) continue;

      const sent: Record<string, string> = { ...(app.reminders_sent ?? {}) };
      let escalateReason: string | null = null;

      for (const reminder of due) {
        try {
          await heltarMessageService.processMessageRequest(
            reminder.messageType,
            { learner_id: app.learner_id },
          );
          sent[reminder.key] = new Date().toISOString();
          for (const k of reminder.supersedes ?? []) {
            sent[k] = `superseded:${new Date().toISOString()}`;
          }
          if (reminder.escalateReason) escalateReason = reminder.escalateReason;

          await supabase.from("ll_pipeline_events").insert({
            application_id: app.id,
            learner_id: app.learner_id,
            event_type: "note",
            actor_name: "System",
            note: `Reminder sent: ${reminder.messageType}`,
            changes: [],
          });

          results.push({
            application_id: app.id,
            key: reminder.key,
            success: true,
          });
        } catch (sendErr) {
          console.error(
            `Reminder ${reminder.key} failed for application ${app.id}:`,
            sendErr,
          );
          results.push({
            application_id: app.id,
            key: reminder.key,
            success: false,
            error: (sendErr as Error).message,
          });
        }
      }

      const update: Record<string, unknown> = { reminders_sent: sent };
      if (escalateReason && !app.escalated) {
        update.escalated = true;
        update.escalation_reason = escalateReason;
        await supabase.from("ll_pipeline_events").insert({
          application_id: app.id,
          learner_id: app.learner_id,
          event_type: "escalation",
          actor_name: "System",
          note: escalateReason,
          changes: [],
        });
      }
      const { error: updateError } = await supabase
        .from("ll_applications")
        .update(update)
        .eq("id", app.id);
      if (updateError) {
        console.error(
          `Failed to record reminders for application ${app.id}:`,
          updateError,
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        scanned: applications?.length ?? 0,
        sent: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("ll-flow-reminders error:", error);
    return new Response(
      JSON.stringify({
        error: (error as Error).message,
        stack: (error as Error).stack,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
