import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { isDLSlotVisibleToCustomer } from "@/constants/llPipeline";
import { useUser } from "@/context/auth-context";
import { supabase } from "@/lib/supabaseClient";

import { LLApplication, LLDocument } from "./llApplications";

// Same pattern as llApplications.ts — the generated database types don't
// include the ll_* tables yet; regenerate types to remove this.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/** Statuses that end a journey — anything else counts as the active one. */
const CLOSED_STATUSES = ["dl_delivered", "closed"];

/**
 * Customer homepage still shows the "delivered, you're all set" state, so its
 * query only hides fully closed journeys — preferring an active one if the
 * learner has both an old delivered journey and a new application.
 */
const CUSTOMER_HIDDEN_STATUSES = ["closed"];

export interface MyLLApplication {
  application: LLApplication | null;
  documents: LLDocument[];
}

/** The learner's active LL application + uploaded documents (customer side). */
export function useMyLLApplication(learnerId: string | null | undefined) {
  return useQuery({
    queryKey: ["my-ll-application", learnerId],
    queryFn: async (): Promise<MyLLApplication> => {
      const { data: rows, error } = await sb
        .from("ll_applications")
        .select("*")
        .eq("learner_id", learnerId)
        .not("status", "in", `(${CUSTOMER_HIDDEN_STATUSES.join(",")})`)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const application =
        (rows ?? []).find(
          (r: { status: string }) => !CLOSED_STATUSES.includes(r.status),
        ) ??
        (rows ?? [])[0] ??
        null;
      if (!application) return { application: null, documents: [] };

      const { data: documents, error: docsError } = await sb
        .from("ll_documents")
        .select("*")
        .eq("application_id", application.id)
        .order("created_at", { ascending: true });
      if (docsError) throw docsError;

      return {
        application: application as unknown as LLApplication,
        documents: (documents ?? []) as unknown as LLDocument[],
      };
    },
    enabled: !!learnerId,
  });
}

/**
 * When the learner paid for the course — anchors the "Day N since payment"
 * timer shown while the LL form is still unfilled. Falls back to the
 * application's created_at when there is no payment row (ops-created).
 */
export function useFirstCoursePaymentDate(
  learnerId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["first-course-payment", learnerId],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await sb
        .from("payment")
        .select("created_at")
        .eq("learner_id", learnerId)
        .eq("status", "completed")
        .in("payment_type", ["course", "custom"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.created_at ?? null;
    },
    enabled: !!learnerId,
  });
}

/**
 * Customer-side status transition (e.g. appointment booked via cal.com).
 * Mirrors the admin useUpdateLLStatus but without the Ops message wiring.
 */
export function useCustomerLLStatusUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      applicationId,
      learnerId,
      fromStatus,
      toStatus,
      note,
      actorName,
    }: {
      applicationId: string;
      learnerId: string;
      fromStatus: string;
      toStatus: string;
      note?: string;
      actorName?: string | null;
    }) => {
      const { error } = await sb
        .from("ll_applications")
        .update({ status: toStatus, updated_at: new Date().toISOString() })
        .eq("id", applicationId);
      if (error) throw error;
      await sb.from("ll_pipeline_events").insert({
        application_id: applicationId,
        learner_id: learnerId,
        event_type: "status_change",
        from_status: fromStatus,
        to_status: toStatus,
        actor_name: actorName ?? null,
        note: note ?? null,
        changes: [],
      });
    },
    onSuccess: (_d, { learnerId }) => {
      queryClient.invalidateQueries({
        queryKey: ["my-ll-application", learnerId],
      });
      queryClient.invalidateQueries({ queryKey: ["ll-applications"] });
      queryClient.invalidateQueries({ queryKey: ["ll-queue-counts"] });
    },
  });
}

/**
 * Customer picks their preferred DL test date + RTO on the homepage.
 * Moves the application to "DL Date Preference Received"; ops then confirms
 * the slot with the RTO (dl_test_scheduled) within 24 hours.
 */
export function useSelectDLTestDate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      applicationId,
      learnerId,
      fromStatus,
      preferredDate,
      preferredRto,
      actorName,
      llMaturesAt,
      llExpiryDate,
    }: {
      applicationId: string;
      learnerId: string;
      fromStatus: string;
      preferredDate: string;
      preferredRto: string;
      actorName?: string | null;
      llMaturesAt?: string | null;
      llExpiryDate?: string | null;
    }) => {
      // Re-check eligibility so stale UI can't submit an invalid slot.
      if (
        !isDLSlotVisibleToCustomer(preferredDate, {
          llMaturesAt,
          llExpiryDate,
        })
      ) {
        throw new Error(
          "That date is no longer available. Please pick another slot.",
        );
      }

      // Confirm the date+RTO still exists as an active uploaded slot.
      const { data: slotRows, error: slotError } = await sb
        .from("dl_test_slots")
        .select("id")
        .eq("test_date", preferredDate)
        .eq("rto", preferredRto)
        .eq("is_active", true)
        .limit(1);
      if (slotError) throw slotError;
      if (!slotRows?.length) {
        throw new Error(
          "That slot is no longer available. Please pick another date.",
        );
      }

      const { error } = await sb
        .from("ll_applications")
        .update({
          status: "dl_date_preference_received",
          dl_preferred_date: preferredDate,
          dl_preferred_rto: preferredRto,
          updated_at: new Date().toISOString(),
        })
        .eq("id", applicationId);
      if (error) throw error;
      await sb.from("ll_pipeline_events").insert({
        application_id: applicationId,
        learner_id: learnerId,
        event_type: "status_change",
        from_status: fromStatus,
        to_status: "dl_date_preference_received",
        actor_name: actorName ?? null,
        note: `Customer picked ${preferredDate} at ${preferredRto}`,
        changes: [],
      });
      // Confirmation WhatsApp — fire and forget.
      supabase.functions
        .invoke("send-message", {
          body: {
            message_type: "DL_DATE_PREFERENCE_RECEIVED",
            learner_id: learnerId,
          },
        })
        .catch((e: Error) =>
          console.error("[llCustomer] send-message failed:", e),
        );
    },
    onSuccess: (_d, { learnerId }) => {
      queryClient.invalidateQueries({
        queryKey: ["my-ll-application", learnerId],
      });
      queryClient.invalidateQueries({ queryKey: ["ll-applications"] });
      queryClient.invalidateQueries({ queryKey: ["ll-queue-counts"] });
    },
  });
}

/**
 * Customer taps a help CTA (Lane office slot, home visit, expired-scrutiny
 * reapply, DL test date…). Flags the application into the Ops follow-up
 * queue and records the request on the timeline; Ops then calls back.
 */
export function useRequestLLHelp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      applicationId,
      learnerId,
      reason,
      actorName,
    }: {
      applicationId: string;
      learnerId: string;
      reason: string;
      actorName?: string | null;
    }) => {
      const { error } = await sb
        .from("ll_applications")
        .update({
          escalated: true,
          escalation_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", applicationId);
      if (error) throw error;
      await sb.from("ll_pipeline_events").insert({
        application_id: applicationId,
        learner_id: learnerId,
        event_type: "escalation",
        actor_name: actorName ?? null,
        note: reason,
        changes: [],
      });
    },
    onSuccess: (_d, { learnerId }) => {
      queryClient.invalidateQueries({
        queryKey: ["my-ll-application", learnerId],
      });
      queryClient.invalidateQueries({ queryKey: ["ll-applications"] });
      queryClient.invalidateQueries({ queryKey: ["ll-queue-counts"] });
    },
  });
}

export interface LLDocumentUpload {
  docType: string;
  /** primary | secondary | front | back */
  docSlot: string;
  subtype: string | null;
  file: File;
}

/**
 * Submit (or resubmit) the in-app LL application form: uploads documents,
 * saves the answers, and auto-moves the application to "Documents under
 * review" (LL-DL_Flow_Feedback item 1 — no manual ops action).
 */
export function useSubmitLLApplication() {
  const queryClient = useQueryClient();
  const { phone } = useUser();

  return useMutation({
    mutationFn: async ({
      learnerId,
      learnerName,
      formData,
      uploads,
    }: {
      learnerId: string;
      learnerName: string | null;
      formData: Record<string, string>;
      uploads: LLDocumentUpload[];
    }) => {
      // 1. Find (or create) the learner's active application.
      const { data: existing, error: findError } = await sb
        .from("ll_applications")
        .select("id, status")
        .eq("learner_id", learnerId)
        .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
        .maybeSingle();
      if (findError) throw findError;

      let applicationId: string = existing?.id;
      if (!applicationId) {
        const { data: created, error: createError } = await sb
          .from("ll_applications")
          .insert({
            learner_id: learnerId,
            services: ["ll"],
            status: "docs_submitted",
          })
          .select("id, status")
          .single();
        if (createError) throw createError;
        applicationId = created.id;
        await sb.from("ll_pipeline_events").insert({
          application_id: applicationId,
          learner_id: learnerId,
          event_type: "status_change",
          to_status: "docs_submitted",
          actor_name: learnerName,
          note: "Application created from the in-app LL form",
          changes: [],
        });
      }

      // 2. Upload documents; each upload replaces the previous row (and
      //    review verdict) for that doc_type + doc_slot pair.
      for (const u of uploads) {
        const slot = u.docSlot || "primary";
        const ext = u.file.name.split(".").pop()?.toLowerCase() || "bin";
        const path = `${learnerId}/${u.docType}-${slot}-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("ll-documents")
          .upload(path, u.file, { cacheControl: "3600", upsert: true });
        if (uploadError)
          throw new Error(
            `Upload failed for ${u.docType} (${slot}): ${uploadError.message}`,
          );

        const { error: deleteError } = await sb
          .from("ll_documents")
          .delete()
          .eq("application_id", applicationId)
          .eq("doc_type", u.docType)
          .eq("doc_slot", slot);
        if (deleteError) throw deleteError;

        const { error: insertError } = await sb.from("ll_documents").insert({
          application_id: applicationId,
          learner_id: learnerId,
          doc_type: u.docType,
          doc_slot: slot,
          doc_subtype: u.subtype,
          storage_path: path,
          file_name: u.file.name,
          mime_type: u.file.type,
          status: "pending",
        });
        if (insertError) throw insertError;
      }

      // Drop leftover secondary address-proof files when the customer
      // switched to a single-document subtype (e.g. Aadhaar).
      const addressUploads = uploads.filter(
        (u) => u.docType === "address_proof",
      );
      if (
        addressUploads.length > 0 &&
        !addressUploads.some((u) => u.docSlot === "secondary")
      ) {
        await sb
          .from("ll_documents")
          .delete()
          .eq("application_id", applicationId)
          .eq("doc_type", "address_proof")
          .eq("doc_slot", "secondary");
      }

      // 3. Save the answers and auto-advance to "Documents under review".
      const fromStatus = existing?.status ?? "docs_submitted";
      const { error: updateError } = await sb
        .from("ll_applications")
        .update({
          form_data: formData,
          date_of_birth: formData.date_of_birth || null,
          form_submitted_at: new Date().toISOString(),
          status: "docs_under_review",
          updated_at: new Date().toISOString(),
        })
        .eq("id", applicationId);
      if (updateError) throw updateError;

      await sb.from("ll_pipeline_events").insert({
        application_id: applicationId,
        learner_id: learnerId,
        event_type: "status_change",
        from_status: fromStatus,
        to_status: "docs_under_review",
        actor_name: learnerName,
        note:
          fromStatus === "docs_rejected"
            ? "Customer resubmitted the LL form after rejection"
            : "Customer submitted the LL form — documents under review",
        changes: [],
      });

      // 4. Keep the existing booking gate working.
      const { error: learnerError } = await sb
        .from("Learner")
        .update({ is_LL_form_filled: true })
        .eq("id", learnerId);
      if (learnerError) throw learnerError;

      return applicationId;
    },
    onSuccess: (_id, { learnerId }) => {
      queryClient.invalidateQueries({
        queryKey: ["my-ll-application", learnerId],
      });
      queryClient.invalidateQueries({ queryKey: ["learner", phone] });
      queryClient.invalidateQueries({ queryKey: ["ll-applications"] });
      queryClient.invalidateQueries({ queryKey: ["ll-queue-counts"] });
    },
  });
}
