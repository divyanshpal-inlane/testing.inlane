import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseISO } from "date-fns";

import { supabase } from "@/lib/supabaseClient";
import type { Json } from "@/types/database.types";
import { isTimeUnavailable } from "@/utils/time";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type LeaveType = "planned" | "emergency";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  instructor_id: string;
  leave_type: LeaveType;
  from_date: string;
  to_date: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  status: LeaveStatus;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  unavailability_applied: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface LeaveRequestWithInstructor extends LeaveRequest {
  instructorName: string | null;
  instructorPhone: string | null;
}

export interface AffectedLesson {
  scheduleId: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string | null;
  learnerId: string | null;
  learnerName: string | null;
  learnerPhone: string | null;
  learnerArea: string | null;
  lessonNumber: number | null;
}

export interface ReplacementCandidate {
  id: string;
  name: string | null;
  phone: string | null;
  sameArea: boolean;
}

// Schedule statuses that represent a real, active booking (so we count them as
// blocking and as needing a replacement). Mirrors the matrix's active set.
const ACTIVE_STATUSES = ["booked", "ongoing"];

const toMin = (t: string | null | undefined): number | null => {
  if (!t) return null;
  const [h, m = "0"] = t.split(":");
  return Number(h) * 60 + Number(m);
};

const overlaps = (
  aStart: number | null,
  aEnd: number | null,
  bStart: number | null,
  bEnd: number | null,
): boolean =>
  aStart != null && aEnd != null && bStart != null && bEnd != null
    ? aStart < bEnd && bStart < aEnd
    : false;

// Is the instructor unavailable for ANY 30-min point across [startMin,endMin)?
const unavailableInWindow = (
  unavailability: unknown,
  day: Date,
  startMin: number,
  endMin: number,
): boolean => {
  const arr = Array.isArray(unavailability) ? unavailability : null;
  if (!arr) return false;
  for (let m = startMin; m < endMin; m += 30) {
    if (isTimeUnavailable(arr, day, Math.floor(m / 60), m % 60)) return true;
  }
  return false;
};

const first = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

// Translate an approved leave request into an Instructor.unavailability entry,
// matching the existing shapes consumed by isTimeUnavailable + the matrix. The
// leave_request_id tag lets us cleanly remove it again if the leave is revoked.
function buildUnavailabilityEntry(req: LeaveRequest): Record<string, unknown> {
  const base: Record<string, unknown> = {
    reason:
      req.reason ??
      (req.leave_type === "emergency" ? "Emergency leave" : "Leave"),
    leave_request_id: req.id,
  };
  const singleDay = req.from_date === req.to_date;
  if (singleDay) {
    return req.all_day
      ? { ...base, booked_date: req.from_date, all_day: true }
      : {
          ...base,
          booked_date: req.from_date,
          all_day: false,
          booked_start_time: req.start_time,
          booked_end_time: req.end_time,
        };
  }
  return req.all_day
    ? {
        ...base,
        start_date: req.from_date,
        end_date: req.to_date,
        range_all_day: true,
      }
    : {
        ...base,
        start_date: req.from_date,
        end_date: req.to_date,
        range_all_day: false,
        range_start_time: req.start_time,
        range_end_time: req.end_time,
      };
}

// ---------------------------------------------------------------------------
// Instructor-facing hooks
// ---------------------------------------------------------------------------
export function useMyLeaveRequests(instructorId: string | undefined) {
  return useQuery({
    queryKey: ["leave_requests", "mine", instructorId],
    enabled: !!instructorId,
    queryFn: async (): Promise<LeaveRequest[]> => {
      const { data, error } = await supabase
        .from("instructor_leave_request")
        .select("*")
        .eq("instructor_id", instructorId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LeaveRequest[];
    },
  });
}

export function useCreateLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      instructorId: string;
      leaveType: LeaveType;
      fromDate: string;
      toDate: string;
      allDay: boolean;
      startTime?: string | null;
      endTime?: string | null;
      reason?: string | null;
    }) => {
      const { error } = await supabase.from("instructor_leave_request").insert({
        instructor_id: input.instructorId,
        leave_type: input.leaveType,
        from_date: input.fromDate,
        to_date: input.toDate,
        all_day: input.allDay,
        start_time: input.allDay ? null : (input.startTime ?? null),
        end_time: input.allDay ? null : (input.endTime ?? null),
        reason: input.reason ?? null,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave_requests"] }),
  });
}

export function useCancelLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("instructor_leave_request")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("status", "pending");
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave_requests"] }),
  });
}

// ---------------------------------------------------------------------------
// Admin-facing hooks
// ---------------------------------------------------------------------------
export function useAllLeaveRequests(filters?: { status?: LeaveStatus }) {
  return useQuery({
    queryKey: ["leave_requests", "all", filters?.status ?? "any"],
    queryFn: async (): Promise<LeaveRequestWithInstructor[]> => {
      let q = supabase
        .from("instructor_leave_request")
        .select("*")
        .order("created_at", { ascending: false });
      if (filters?.status) q = q.eq("status", filters.status);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as LeaveRequest[];

      // Resolve instructor names/phones in one batch (no FK relationship typed).
      const ids = Array.from(new Set(rows.map((r) => r.instructor_id)));
      const nameById = new Map<
        string,
        { name: string | null; phone: string | null }
      >();
      if (ids.length) {
        const { data: instrs } = await supabase
          .from("Instructor")
          .select("id_instructor, name, phone")
          .in("id_instructor", ids);
        for (const i of instrs ?? [])
          nameById.set(i.id_instructor, { name: i.name, phone: i.phone });
      }
      return rows.map((r) => ({
        ...r,
        instructorName: nameById.get(r.instructor_id)?.name ?? null,
        instructorPhone: nameById.get(r.instructor_id)?.phone ?? null,
      }));
    },
  });
}

// Approve / reject a leave request. Approving also writes the leave into the
// instructor's unavailability so the matrix + calendar reflect it immediately.
export function useReviewLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      request: LeaveRequest;
      action: "approve" | "reject";
      adminNote?: string;
      reviewerName?: string;
    }) => {
      const { request, action, adminNote, reviewerName } = input;
      const reviewed = {
        admin_note: adminNote ?? null,
        reviewed_by: reviewerName ?? null,
        reviewed_at: new Date().toISOString(),
      };

      if (action === "approve") {
        const { data: instr, error: e1 } = await supabase
          .from("Instructor")
          .select("unavailability")
          .eq("id_instructor", request.instructor_id)
          .single();
        if (e1) throw e1;
        const current = Array.isArray(instr?.unavailability)
          ? (instr!.unavailability as unknown[])
          : [];
        const next = [...current, buildUnavailabilityEntry(request)];
        const { error: e2 } = await supabase
          .from("Instructor")
          .update({ unavailability: next as unknown as Json })
          .eq("id_instructor", request.instructor_id);
        if (e2) throw e2;
        const { error: e3 } = await supabase
          .from("instructor_leave_request")
          .update({
            ...reviewed,
            status: "approved",
            unavailability_applied: true,
          })
          .eq("id", request.id);
        if (e3) throw e3;
      } else {
        const { error } = await supabase
          .from("instructor_leave_request")
          .update({ ...reviewed, status: "rejected" })
          .eq("id", request.id);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave_requests"] }),
  });
}

// Revoke an already-approved leave: remove its unavailability entry and cancel.
export function useRevokeLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (request: LeaveRequest) => {
      if (request.unavailability_applied) {
        const { data: instr, error: e1 } = await supabase
          .from("Instructor")
          .select("unavailability")
          .eq("id_instructor", request.instructor_id)
          .single();
        if (e1) throw e1;
        const current = Array.isArray(instr?.unavailability)
          ? (instr!.unavailability as Array<Record<string, unknown>>)
          : [];
        const next = current.filter((u) => u?.leave_request_id !== request.id);
        const { error: e2 } = await supabase
          .from("Instructor")
          .update({ unavailability: next as unknown as Json })
          .eq("id_instructor", request.instructor_id);
        if (e2) throw e2;
      }
      const { error: e3 } = await supabase
        .from("instructor_leave_request")
        .update({ status: "cancelled", unavailability_applied: false })
        .eq("id", request.id);
      if (e3) throw e3;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave_requests"] }),
  });
}

// Booked lessons that fall inside a leave window (need a replacement).
export function useLeaveAffectedLessons(request: LeaveRequest | null) {
  return useQuery({
    queryKey: ["leave_affected", request?.id],
    enabled: !!request,
    queryFn: async (): Promise<AffectedLesson[]> => {
      const r = request!;
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          "id, date, start_time, end_time, status, learner_id, Learner(name, phone, area), Lesson(number)",
        )
        .eq("instructor_id", r.instructor_id)
        .gte("date", r.from_date)
        .lte("date", r.to_date)
        .in("status", ACTIVE_STATUSES);
      if (error) throw error;

      let rows = data ?? [];
      if (!r.all_day && r.start_time && r.end_time) {
        const ls = toMin(r.start_time);
        const le = toMin(r.end_time);
        rows = rows.filter((s) =>
          overlaps(toMin(s.start_time), toMin(s.end_time), ls, le),
        );
      }

      return rows.map((s) => {
        const learner = first<{
          name: string | null;
          phone: string | null;
          area: string | null;
        }>(s.Learner as never);
        const lesson = first<{ number: number | null }>(s.Lesson as never);
        return {
          scheduleId: s.id,
          date: s.date,
          startTime: s.start_time,
          endTime: s.end_time,
          status: s.status,
          learnerId: s.learner_id,
          learnerName: learner?.name ?? null,
          learnerPhone: learner?.phone ?? null,
          learnerArea: learner?.area ?? null,
          lessonNumber: lesson?.number ?? null,
        };
      });
    },
  });
}

// Ranked free instructors for a specific affected lesson (same-area first).
export function useReplacementCandidates(
  lesson: {
    scheduleId: number;
    date: string;
    startTime: string | null;
    endTime: string | null;
    learnerArea: string | null;
    onLeaveInstructorId: string;
  } | null,
) {
  return useQuery({
    queryKey: ["replacement_candidates", lesson?.scheduleId],
    enabled: !!lesson,
    queryFn: async (): Promise<ReplacementCandidate[]> => {
      const l = lesson!;
      const ls = toMin(l.startTime);
      const le = toMin(l.endTime);
      if (ls == null || le == null) return [];
      const day = parseISO(l.date);

      const { data: instrs } = await supabase
        .from("Instructor")
        .select("id_instructor, name, phone, areas, unavailability, enabled");
      const candidates = (instrs ?? []).filter(
        (i) => i.enabled !== false && i.id_instructor !== l.onLeaveInstructorId,
      );

      const { data: scheds } = await supabase
        .from("Schedule")
        .select("instructor_id, start_time, end_time")
        .eq("date", l.date)
        .in("status", ACTIVE_STATUSES);
      const byInstr = new Map<
        string,
        { start_time: string | null; end_time: string | null }[]
      >();
      for (const s of scheds ?? []) {
        if (!s.instructor_id) continue;
        if (!byInstr.has(s.instructor_id)) byInstr.set(s.instructor_id, []);
        byInstr.get(s.instructor_id)!.push(s);
      }

      return candidates
        .map((i) => {
          const busy = (byInstr.get(i.id_instructor) ?? []).some((s) =>
            overlaps(toMin(s.start_time), toMin(s.end_time), ls, le),
          );
          const unavail = unavailableInWindow(i.unavailability, day, ls, le);
          const sameArea =
            !!l.learnerArea &&
            Array.isArray(i.areas) &&
            (i.areas as string[]).includes(l.learnerArea);
          return {
            id: i.id_instructor,
            name: i.name,
            phone: i.phone,
            free: !busy && !unavail,
            sameArea,
          };
        })
        .filter((c) => c.free)
        .sort(
          (a, b) =>
            Number(b.sameArea) - Number(a.sameArea) ||
            (a.name ?? "").localeCompare(b.name ?? ""),
        )
        .map(({ id, name, phone, sameArea }) => ({
          id,
          name,
          phone,
          sameArea,
        }));
    },
  });
}

export function useReassignLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      scheduleId: number;
      newInstructorId: string;
    }) => {
      const { error } = await supabase
        .from("Schedule")
        // Schedule's generated Update type wrongly requires ended_at; cast past it.
        .update({ instructor_id: input.newInstructorId } as never)
        .eq("id", input.scheduleId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave_affected"] });
      qc.invalidateQueries({ queryKey: ["replacement_candidates"] });
    },
  });
}
