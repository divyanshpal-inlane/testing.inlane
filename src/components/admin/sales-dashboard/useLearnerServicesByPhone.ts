import { useQuery } from "@tanstack/react-query";

import {
  listLearnerServices,
  serviceLabel,
} from "@/components/admin/learner/additionalServices";
import type { EnrollmentRecord } from "@/components/admin/learner/enrollmentActions";
import { supabase } from "@/lib/supabaseClient";

export interface BookableService {
  enrollment: EnrollmentRecord;
  label: string;
}

/**
 * The bookable services (courses and top-ups; never a licence service) of the
 * learner who owns this phone number. `null` data means no learner has the
 * number. Used by the booking form so a slot is linked to the customer's
 * service by default instead of carrying only a course written as text.
 */
export function useLearnerServicesByPhone(
  phone10: string | null,
  enabled: boolean,
) {
  return useQuery<{ learnerId: string; services: BookableService[] } | null>({
    queryKey: ["slot-form-services", phone10],
    enabled: enabled && !!phone10,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Learner")
        .select("id")
        .in("phone", [phone10!, `91${phone10}`, `+91${phone10}`])
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const learner = data?.[0];
      if (!learner) return null;
      const all = await listLearnerServices(learner.id);
      return {
        learnerId: learner.id,
        services: all
          .filter((e) => e.case_type !== "rto_only")
          .map((e) => ({ enrollment: e, label: serviceLabel(e) })),
      };
    },
  });
}
