import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { TicketCategory, TicketStatus } from "@/constants/support";
import { supabase } from "@/lib/supabaseClient";

export type TicketPriority = "normal" | "urgent";

export interface SupportTicket {
  id: string;
  raised_by_role: string;
  instructor_id: string | null;
  category: TicketCategory;
  priority: TicketPriority;
  subject: string | null;
  description: string | null;
  status: TicketStatus;
  admin_response: string | null;
  assigned_to: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SupportTicketWithInstructor extends SupportTicket {
  instructorName: string | null;
  instructorPhone: string | null;
}

// ---------------------------------------------------------------------------
// Instructor-facing
// ---------------------------------------------------------------------------
export function useMySupportTickets(instructorId: string | undefined) {
  return useQuery({
    queryKey: ["support_tickets", "mine", instructorId],
    enabled: !!instructorId,
    queryFn: async (): Promise<SupportTicket[]> => {
      const { data, error } = await supabase
        .from("support_ticket")
        .select("*")
        .eq("instructor_id", instructorId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SupportTicket[];
    },
  });
}

export function useCreateSupportTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      instructorId: string;
      category: TicketCategory;
      priority?: TicketPriority;
      subject: string;
      description?: string | null;
    }) => {
      const { error } = await supabase.from("support_ticket").insert({
        instructor_id: input.instructorId,
        raised_by_role: "instructor",
        category: input.category,
        priority: input.priority ?? "normal",
        subject: input.subject,
        description: input.description ?? null,
        status: "open",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["support_tickets"] }),
  });
}

// ---------------------------------------------------------------------------
// Admin-facing
// ---------------------------------------------------------------------------
export function useAllSupportTickets(filters?: {
  status?: TicketStatus;
  category?: TicketCategory;
}) {
  return useQuery({
    queryKey: [
      "support_tickets",
      "all",
      filters?.status ?? "any",
      filters?.category ?? "any",
    ],
    queryFn: async (): Promise<SupportTicketWithInstructor[]> => {
      let q = supabase
        .from("support_ticket")
        .select("*")
        .order("created_at", { ascending: false });
      if (filters?.status) q = q.eq("status", filters.status);
      if (filters?.category) q = q.eq("category", filters.category);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as SupportTicket[];

      const ids = Array.from(
        new Set(
          rows.map((r) => r.instructor_id).filter((id): id is string => !!id),
        ),
      );
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
        instructorName: r.instructor_id
          ? (byId.get(r.instructor_id)?.name ?? null)
          : null,
        instructorPhone: r.instructor_id
          ? (byId.get(r.instructor_id)?.phone ?? null)
          : null,
      }));
    },
  });
}

export function useUpdateSupportTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status?: TicketStatus;
      adminResponse?: string;
      resolverName?: string;
    }) => {
      const patch: Record<string, unknown> = {};
      if (input.status) patch.status = input.status;
      if (input.adminResponse !== undefined)
        patch.admin_response = input.adminResponse;
      if (input.status === "resolved" || input.status === "closed") {
        patch.resolved_by = input.resolverName ?? null;
        patch.resolved_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from("support_ticket")
        .update(patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["support_tickets"] }),
  });
}
