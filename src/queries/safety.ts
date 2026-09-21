import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabaseClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type IncidentType = "accident" | "breakdown" | "misconduct" | "sos";
export type IncidentStatus = "open" | "acknowledged" | "resolved" | "dismissed";

export interface SafetyIncident {
  id: string;
  instructor_id: string;
  incident_type: IncidentType;
  schedule_id: number | null;
  description: string | null;
  location: string | null;
  status: IncidentStatus;
  admin_response: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SafetyIncidentWithInstructor extends SafetyIncident {
  instructorName: string | null;
  instructorPhone: string | null;
}

export const INCIDENT_TYPE_LABEL: Record<IncidentType, string> = {
  accident: "Accident",
  breakdown: "Vehicle breakdown",
  misconduct: "Learner misconduct",
  sos: "Emergency SOS",
};

// ---------------------------------------------------------------------------
// Instructor-facing hooks
// ---------------------------------------------------------------------------
export function useMySafetyIncidents(instructorId: string | undefined) {
  return useQuery({
    queryKey: ["safety_incidents", "mine", instructorId],
    enabled: !!instructorId,
    queryFn: async (): Promise<SafetyIncident[]> => {
      const { data, error } = await supabase
        .from("safety_incident")
        .select("*")
        .eq("instructor_id", instructorId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SafetyIncident[];
    },
  });
}

export function useReportSafetyIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      instructorId: string;
      incidentType: IncidentType;
      description?: string | null;
      location?: string | null;
      scheduleId?: number | null;
    }) => {
      const { error } = await supabase.from("safety_incident").insert({
        instructor_id: input.instructorId,
        incident_type: input.incidentType,
        description: input.description ?? null,
        location: input.location ?? null,
        schedule_id: input.scheduleId ?? null,
        status: "open",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["safety_incidents"] }),
  });
}

// ---------------------------------------------------------------------------
// Admin-facing hooks
// ---------------------------------------------------------------------------
export function useAllSafetyIncidents(filters?: {
  status?: IncidentStatus;
  type?: IncidentType;
}) {
  return useQuery({
    queryKey: [
      "safety_incidents",
      "all",
      filters?.status ?? "any",
      filters?.type ?? "any",
    ],
    // SOS alerts should surface fast on the monitoring page.
    refetchInterval: 30_000,
    queryFn: async (): Promise<SafetyIncidentWithInstructor[]> => {
      let q = supabase
        .from("safety_incident")
        .select("*")
        .order("created_at", { ascending: false });
      if (filters?.status) q = q.eq("status", filters.status);
      if (filters?.type) q = q.eq("incident_type", filters.type);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as SafetyIncident[];

      // Resolve instructor names/phones in one batch (no FK relationship typed).
      const ids = Array.from(new Set(rows.map((r) => r.instructor_id)));
      const byId = new Map<
        string,
        { name: string | null; phone: string | null }
      >();
      if (ids.length) {
        const { data: instrs } = await supabase
          .from("Instructor")
          .select("id_instructor, name, phone")
          .in("id_instructor", ids);
        for (const i of instrs ?? [])
          byId.set(i.id_instructor, { name: i.name, phone: i.phone });
      }
      return rows.map((r) => ({
        ...r,
        instructorName: byId.get(r.instructor_id)?.name ?? null,
        instructorPhone: byId.get(r.instructor_id)?.phone ?? null,
      }));
    },
  });
}

export function useUpdateSafetyIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: IncidentStatus;
      adminResponse?: string;
      resolverName?: string;
    }) => {
      const closing =
        input.status === "resolved" || input.status === "dismissed";
      const { error } = await supabase
        .from("safety_incident")
        .update({
          status: input.status,
          admin_response: input.adminResponse ?? null,
          resolved_by: closing ? (input.resolverName ?? null) : null,
          resolved_at: closing ? new Date().toISOString() : null,
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["safety_incidents"] }),
  });
}
