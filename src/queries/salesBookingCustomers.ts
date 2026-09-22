import { useQuery } from "@tanstack/react-query";

import { normalizePhone } from "@/lib/sales-dashboard/validation";
import { supabase } from "@/lib/supabaseClient";

// Schedule.tentative_details is not present in the generated database types yet.
// Keep the escape hatch local to this narrow read-only lookup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const QUERY_LIMIT = 12;
const RESULT_LIMIT = 10;
const ENROLLMENT_LIMIT = 48;
const COURSE_LESSON_COUNTS = new Set([4, 5, 6, 10, 15, 20]);

export type ReusableCustomerSource = "tentative" | "learner" | "session";

export interface ReusableCustomer {
  key: string;
  name: string;
  phone: string;
  address: string;
  course: string;
  source: ReusableCustomerSource;
  lastUsedAt: string | null;
}

interface TentativeCustomerRow {
  id: number;
  created_at: string | null;
  tentative_details: Record<string, unknown> | null;
}

interface LearnerCustomerRow {
  id: string;
  created_at: string | null;
  name: string | null;
  phone: string;
  pick_up_location: string | null;
}

interface EnrollmentCourseRow {
  learner_id: string;
  created_at: string | null;
  progress: unknown;
  Courses: { total_lessons: number | null } | null;
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function savedTentativeCourse(value: unknown): string {
  const course = nonEmptyString(value);
  return course === "demo" || /^course_(4|5|6|10|15|20)$/.test(course)
    ? course
    : "";
}

function enrollmentCourse(row: EnrollmentCourseRow): string {
  const progress =
    row.progress && typeof row.progress === "object"
      ? (row.progress as Record<string, unknown>)
      : null;
  if (progress?.type === "demo") return "demo";
  const lessons = row.Courses?.total_lessons;
  return typeof lessons === "number" && COURSE_LESSON_COUNTS.has(lessons)
    ? `course_${lessons}`
    : "";
}

function uniqueById<T extends { id: string | number }>(rows: T[]): T[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function tentativeProfile(row: TentativeCustomerRow): ReusableCustomer | null {
  const details = row.tentative_details ?? {};
  const name = nonEmptyString(details.name) || nonEmptyString(details.leadName);
  const phone = normalizePhone(details.phone);
  const address =
    nonEmptyString(details.address) || nonEmptyString(details.pickup_location);
  const course = savedTentativeCourse(details.course);
  if (!name || !phone) return null;
  return {
    key: phone,
    name,
    phone,
    address,
    course,
    source: "tentative",
    lastUsedAt: row.created_at,
  };
}

function learnerProfile(row: LearnerCustomerRow): ReusableCustomer | null {
  const name = nonEmptyString(row.name);
  const phone = normalizePhone(row.phone);
  if (!name || !phone) return null;
  return {
    key: phone,
    name,
    phone,
    address: nonEmptyString(row.pick_up_location),
    course: "",
    source: "learner",
    lastUsedAt: row.created_at,
  };
}

async function searchTentativeCustomers(
  term: string,
): Promise<TentativeCustomerRow[]> {
  const namePattern = `%${escapeLikePattern(term)}%`;
  const digits = term.replace(/\D/g, "");
  const requests = [
    sb
      .from("Schedule")
      .select("id, created_at, tentative_details")
      .eq("isTentative", true)
      .not("tentative_details", "is", null)
      .ilike("tentative_details->>name", namePattern)
      .order("created_at", { ascending: false })
      .limit(QUERY_LIMIT),
  ];
  if (digits.length >= 3) {
    requests.push(
      sb
        .from("Schedule")
        .select("id, created_at, tentative_details")
        .eq("isTentative", true)
        .not("tentative_details", "is", null)
        .ilike("tentative_details->>phone", `%${digits}%`)
        .order("created_at", { ascending: false })
        .limit(QUERY_LIMIT),
    );
  }
  const responses = await Promise.all(requests);
  const error = responses.find((response) => response.error)?.error;
  if (error) throw error;
  return uniqueById(
    responses.flatMap(
      (response) => response.data ?? [],
    ) as TentativeCustomerRow[],
  ).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

async function searchLearners(term: string): Promise<LearnerCustomerRow[]> {
  const namePattern = `%${escapeLikePattern(term)}%`;
  const digits = term.replace(/\D/g, "");
  const requests = [
    sb
      .from("Learner")
      .select("id, created_at, name, phone, pick_up_location")
      .ilike("name", namePattern)
      .order("created_at", { ascending: false })
      .limit(QUERY_LIMIT),
  ];
  if (digits.length >= 3) {
    requests.push(
      sb
        .from("Learner")
        .select("id, created_at, name, phone, pick_up_location")
        .ilike("phone", `%${digits}%`)
        .order("created_at", { ascending: false })
        .limit(QUERY_LIMIT),
    );
  }
  const responses = await Promise.all(requests);
  const error = responses.find((response) => response.error)?.error;
  if (error) throw error;
  return uniqueById(
    responses.flatMap(
      (response) => response.data ?? [],
    ) as LearnerCustomerRow[],
  );
}

async function searchLatestEnrollmentCourses(
  learners: LearnerCustomerRow[],
): Promise<Map<string, { course: string; createdAt: string | null }>> {
  const learnerIds = [...new Set(learners.map((learner) => learner.id))];
  if (learnerIds.length === 0) return new Map();

  const { data, error } = await sb
    .from("enrollment")
    .select("learner_id, created_at, progress, Courses(total_lessons)")
    .in("learner_id", learnerIds)
    .order("created_at", { ascending: false })
    .limit(ENROLLMENT_LIMIT);

  // Customer reuse must remain usable for roles whose current RLS can read
  // Learner/Schedule but not enrollment. Never broaden permissions here.
  if (error) return new Map();

  const latest = new Map<
    string,
    { course: string; createdAt: string | null }
  >();
  for (const row of (data ?? []) as EnrollmentCourseRow[]) {
    if (latest.has(row.learner_id)) continue;
    const course = enrollmentCourse(row);
    if (course) {
      latest.set(row.learner_id, { course, createdAt: row.created_at });
    }
  }
  return latest;
}

export async function searchReusableCustomers(
  rawTerm: string,
): Promise<ReusableCustomer[]> {
  const term = rawTerm.trim();
  if (term.length < 2) return [];

  const [tentativeRows, learnerRows] = await Promise.all([
    searchTentativeCustomers(term),
    searchLearners(term),
  ]);
  const enrollmentCourses = await searchLatestEnrollmentCourses(learnerRows);

  // The newest tentative snapshot best reflects the details Sales last used.
  // Registered Learner data fills identity/address gaps. Course is resolved
  // separately below so the newest saved tentative or enrollment wins.
  const byPhone = new Map<string, ReusableCustomer>();
  const courseByPhone = new Map<
    string,
    { course: string; createdAt: string | null }
  >();
  for (const row of tentativeRows) {
    const profile = tentativeProfile(row);
    if (profile && !byPhone.has(profile.phone)) {
      byPhone.set(profile.phone, profile);
    }
    if (profile?.course && !courseByPhone.has(profile.phone)) {
      courseByPhone.set(profile.phone, {
        course: profile.course,
        createdAt: profile.lastUsedAt,
      });
    }
  }
  for (const row of learnerRows) {
    const profile = learnerProfile(row);
    if (profile && !byPhone.has(profile.phone)) {
      byPhone.set(profile.phone, profile);
    }
    const enrollment = enrollmentCourses.get(row.id);
    const current = profile ? courseByPhone.get(profile.phone) : null;
    if (
      profile &&
      enrollment &&
      (!current ||
        (enrollment.createdAt ?? "").localeCompare(current.createdAt ?? "") > 0)
    ) {
      courseByPhone.set(profile.phone, enrollment);
    }
  }
  return [...byPhone.values()]
    .map((profile) => ({
      ...profile,
      course: courseByPhone.get(profile.phone)?.course ?? profile.course,
    }))
    .slice(0, RESULT_LIMIT);
}

export function useReusableCustomerSearch(term: string, enabled: boolean) {
  const normalizedTerm = term.trim();
  return useQuery({
    queryKey: ["sales-reusable-customers", normalizedTerm],
    queryFn: () => searchReusableCustomers(normalizedTerm),
    enabled: enabled && normalizedTerm.length >= 2,
    staleTime: 30_000,
  });
}
