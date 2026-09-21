import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  isDLSlotUploadAllowed,
  isDLSlotVisibleToCustomer,
} from "@/constants/llPipeline";
import { supabase } from "@/lib/supabaseClient";

// Generated DB types don't include dl_test_slots yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface DLTestSlot {
  id: string;
  test_date: string;
  rto: string;
  is_active: boolean;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

/** All active slots (admin list + customer picker source). */
export function useDLTestSlots(opts?: { includeInactive?: boolean }) {
  const includeInactive = opts?.includeInactive ?? false;
  return useQuery({
    queryKey: ["dl-test-slots", includeInactive],
    queryFn: async (): Promise<DLTestSlot[]> => {
      let q = sb
        .from("dl_test_slots")
        .select("*")
        .order("test_date", { ascending: true })
        .order("rto", { ascending: true });
      if (!includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DLTestSlot[];
    },
  });
}

/**
 * Active slots filtered for a specific customer (14-day floor + LL window).
 */
export function useCustomerDLTestSlots(opts: {
  llMaturesAt?: string | null;
  llExpiryDate?: string | null;
  enabled?: boolean;
}) {
  const { data: slots, ...rest } = useDLTestSlots();
  const visible = (slots ?? []).filter((s) =>
    isDLSlotVisibleToCustomer(s.test_date, {
      llMaturesAt: opts.llMaturesAt,
      llExpiryDate: opts.llExpiryDate,
    }),
  );
  return { data: visible, ...rest };
}

export function useCreateDLTestSlot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      testDate,
      rto,
      uploadedBy,
    }: {
      testDate: string;
      rto: string;
      uploadedBy?: string | null;
    }) => {
      if (!isDLSlotUploadAllowed(testDate)) {
        throw new Error(
          "Slots must be uploaded at least 15 days before the test date.",
        );
      }
      const { data, error } = await sb
        .from("dl_test_slots")
        .insert({
          test_date: testDate,
          rto,
          uploaded_by: uploadedBy ?? null,
          is_active: true,
        })
        .select("*")
        .single();
      if (error) {
        if (error.code === "23505") {
          throw new Error(
            "An active slot already exists for that date and RTO.",
          );
        }
        throw error;
      }
      return data as DLTestSlot;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dl-test-slots"] });
    },
  });
}

export function useSetDLTestSlotActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await sb
        .from("dl_test_slots")
        .update({
          is_active: isActive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dl-test-slots"] });
    },
  });
}

export function useDeleteDLTestSlot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("dl_test_slots").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dl-test-slots"] });
    },
  });
}
