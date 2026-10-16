// Bulk LL-customer migration: CSV parsing, per-row validation, ll_stage → LL
// field mapping, course resolution, and Learner/payment/enrollment payload
// builders. Pure (no Supabase/DOM) so it's testable; the page does the inserts.
import { COURSES_DATA } from "@/constants/courses";

export type LLStage =
  | "has_ll"
  | "passed_waiting"
  | "appointment_booked"
  | "not_started";

export const LL_STAGES: LLStage[] = [
  "has_ll",
  "passed_waiting",
  "appointment_booked",
  "not_started",
];

// Canonical CSV columns (order used by the downloadable template).
export const LL_MIGRATION_COLUMNS = [
  "name",
  "phone",
  "email",
  "dob",
  "area",
  "pincode",
  "pick_up_location",
  "address_lat",
  "address_lng",
  "ll_stage",
  "ll_application_id",
  "ll_received_date",
  "ll_test_date",
  "has_a_dl",
  "has_two_wheeler_license",
  "course",
  "total_amount",
  "amount_paid",
  "completed_lessons",
  "comments",
] as const;

export interface ParsedLLRow {
  rowNumber: number; // 1-based data row (excludes header)
  name: string;
  phone: string; // normalised to last-10 digits ("" if unparseable)
  email: string | null;
  dob: string | null;
  area: string | null;
  pincode: string | null;
  pickupLocation: string | null;
  addressLat: number | null;
  addressLng: number | null;
  stage: LLStage;
  llApplicationId: string | null;
  llReceivedDate: string | null;
  llTestDate: string | null;
  hasADL: boolean;
  hasTwoWheeler: boolean;
  courseId: string | null;
  courseLabel: string | null;
  totalAmount: number | null;
  amountPaid: number | null;
  completedLessons: number;
  comments: string | null;
  errors: string[];
}

// ---------------------------------------------------------------------------
// CSV parsing (quote-aware: handles commas/newlines inside quoted fields)
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty rows.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const normHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

// Header aliases → canonical key.
const HEADER_ALIASES: Record<string, string> = {
  phone_number: "phone",
  mobile: "phone",
  pickup_location: "pick_up_location",
  pickup: "pick_up_location",
  lat: "address_lat",
  lng: "address_lng",
  lon: "address_lng",
  longitude: "address_lng",
  latitude: "address_lat",
  has_dl: "has_a_dl",
  has_4_wheeler: "has_a_dl",
  ll_number: "ll_application_id",
  ll_id: "ll_application_id",
  stage: "ll_stage",
  notes: "comments",
};

const canonical = (h: string) => {
  const n = normHeader(h);
  return HEADER_ALIASES[n] ?? n;
};

const parseBool = (v: string | undefined): boolean => {
  const s = (v ?? "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "y";
};

const parseNum = (v: string | undefined): number | null => {
  const s = (v ?? "").replace(/[,₹\s]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const normalisePhone = (v: string | undefined): string => {
  const digits = (v ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
};

// Resolve a course cell (a COURSES_DATA id or a label, case-insensitive).
const courseByLabel = new Map(
  Object.values(COURSES_DATA).map((c) => [c.label.toLowerCase(), c.id]),
);
function resolveCourse(v: string | undefined): {
  id: string | null;
  label: string | null;
  known: boolean;
} {
  const raw = (v ?? "").trim();
  if (!raw) return { id: null, label: null, known: true }; // blank = no course
  if (COURSES_DATA[raw])
    return { id: raw, label: COURSES_DATA[raw].label, known: true };
  const byLabel = courseByLabel.get(raw.toLowerCase());
  if (byLabel)
    return { id: byLabel, label: COURSES_DATA[byLabel].label, known: true };
  return { id: null, label: raw, known: false };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalise CSV dates to YYYY-MM-DD for Postgres `date` columns.
 * Accepts ISO (2026-02-28), Indian (28-02-2026 / 28/02/2026), and rejects
 * impossible calendar days (e.g. 29-02-2026 — 2026 is not a leap year).
 */
export function parseMigrationDate(
  raw: string | undefined,
  fieldLabel: string,
): { value: string | null; error: string | null } {
  const s = (raw ?? "").trim();
  if (!s) return { value: null, error: null };

  let y: number;
  let m: number;
  let d: number;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (dmy) {
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
  } else {
    return {
      value: null,
      error: `${fieldLabel} must be YYYY-MM-DD or DD-MM-YYYY (got "${s}")`,
    };
  }

  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) {
    return { value: null, error: `${fieldLabel} is not a valid date ("${s}")` };
  }

  // Reject impossible days (29 Feb in non-leap years, 31 Apr, etc.).
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return {
      value: null,
      error: `${fieldLabel} is not a real calendar date ("${s}")`,
    };
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return { value: `${y}-${pad(m)}-${pad(d)}`, error: null };
}

// ---------------------------------------------------------------------------
// Map + validate the parsed grid into typed rows.
// ---------------------------------------------------------------------------
export function analyzeLLRows(grid: string[][]): {
  headers: string[];
  rows: ParsedLLRow[];
} {
  if (grid.length === 0) return { headers: [], rows: [] };
  const headers = grid[0].map(canonical);
  const idx = (key: string) => headers.indexOf(key);
  const get = (r: string[], key: string) => {
    const i = idx(key);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };

  const phonesSeenInCsv = new Map<string, number>(); // phone → first row number

  const rows: ParsedLLRow[] = grid.slice(1).map((r, i) => {
    const errors: string[] = [];
    const name = get(r, "name");
    if (!name) errors.push("name is required");

    const phone = normalisePhone(get(r, "phone"));
    if (!phone) errors.push("phone must have 10 digits");
    else if (phonesSeenInCsv.has(phone)) {
      errors.push(
        `duplicate phone in this CSV (also on row ${phonesSeenInCsv.get(phone)})`,
      );
    } else {
      phonesSeenInCsv.set(phone, i + 1);
    }

    const email = get(r, "email") || null;
    if (email && !EMAIL_RE.test(email)) errors.push("invalid email");

    const dobParsed = parseMigrationDate(get(r, "dob"), "dob");
    if (dobParsed.error) errors.push(dobParsed.error);
    const llRecvParsed = parseMigrationDate(
      get(r, "ll_received_date"),
      "ll_received_date",
    );
    if (llRecvParsed.error) errors.push(llRecvParsed.error);
    const llTestParsed = parseMigrationDate(
      get(r, "ll_test_date"),
      "ll_test_date",
    );
    if (llTestParsed.error) errors.push(llTestParsed.error);

    // Stage: default to has_ll (these are LL customers); a 4-wheeler DL implies LL.
    const hasADL = parseBool(get(r, "has_a_dl"));
    let stage = get(r, "ll_stage").toLowerCase() as LLStage;
    if (!stage) stage = "has_ll";
    if (!LL_STAGES.includes(stage)) {
      errors.push(`ll_stage must be one of ${LL_STAGES.join(", ")}`);
      stage = "has_ll";
    }
    if (hasADL) stage = "has_ll";

    const course = resolveCourse(get(r, "course"));
    if (!course.known) errors.push(`unknown course "${course.label}"`);
    const totalAmount = parseNum(get(r, "total_amount"));
    const amountPaid = parseNum(get(r, "amount_paid"));
    if (course.id && (totalAmount == null || totalAmount <= 0))
      errors.push("total_amount required when a course is given");
    if (totalAmount != null && amountPaid != null && amountPaid > totalAmount)
      errors.push("amount_paid exceeds total_amount");

    return {
      rowNumber: i + 1,
      name,
      phone,
      email,
      dob: dobParsed.value,
      area: get(r, "area") || null,
      pincode: get(r, "pincode") || null,
      pickupLocation: get(r, "pick_up_location") || null,
      addressLat: parseNum(get(r, "address_lat")),
      addressLng: parseNum(get(r, "address_lng")),
      stage,
      llApplicationId: get(r, "ll_application_id") || null,
      llReceivedDate: llRecvParsed.value,
      llTestDate: llTestParsed.value,
      hasADL,
      hasTwoWheeler: parseBool(get(r, "has_two_wheeler_license")),
      courseId: course.id,
      courseLabel: course.label,
      totalAmount,
      amountPaid,
      completedLessons: parseNum(get(r, "completed_lessons")) ?? 0,
      comments: get(r, "comments") || null,
      errors,
    };
  });

  return { headers, rows };
}

// ll_stage → the LL_* field combo that lands the learner at the right stage.
export function llFieldsForStage(row: ParsedLLRow): Record<string, unknown> {
  const base = {
    LL_application_id: row.llApplicationId,
    has_a_DL: row.hasADL,
    has_two_wheeler_license: row.hasTwoWheeler,
  };
  const recv = row.llReceivedDate;
  const test = row.llTestDate || recv || null;
  switch (row.stage) {
    case "has_ll":
      return {
        ...base,
        LL_team_appointment_booked: true,
        is_LL_form_filled: true,
        LL_application_approved: true,
        LL_test_date: test,
        LL_result: true,
        LL_received: true,
        LL_received_date: recv,
      };
    case "passed_waiting":
      return {
        ...base,
        LL_team_appointment_booked: true,
        is_LL_form_filled: true,
        LL_application_approved: true,
        LL_test_date: test,
        LL_result: true,
        LL_received: false,
      };
    case "appointment_booked":
      return {
        ...base,
        LL_team_appointment_booked: true,
        is_LL_form_filled: true,
        LL_application_approved: false,
        LL_received: false,
      };
    case "not_started":
    default:
      return {
        ...base,
        LL_team_appointment_booked: false,
        LL_application_approved: false,
        LL_received: false,
      };
  }
}

export function buildLearnerInsert(row: ParsedLLRow): Record<string, unknown> {
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    dob: row.dob,
    area: row.area,
    pincode: row.pincode,
    pick_up_location: row.pickupLocation,
    address_lat: row.addressLat,
    address_lng: row.addressLng,
    // Match LearnerMigration / create-learner-and-enrollment — both are required
    // on insert in production (no DB default).
    address_change_required: false,
    has_postLL_done: false,
    ...llFieldsForStage(row),
    comments: `[LL Migration] ${row.comments ?? "Migrated LL customer"}`,
    onboarding_completed: true,
    enabled: true,
  };
}

export function buildPaymentInsert(
  row: ParsedLLRow,
  learnerId: string,
): Record<string, unknown> {
  const total = row.totalAmount ?? 0;
  const paid = row.amountPaid ?? total;
  return {
    learner_id: learnerId,
    amount: paid > 0 ? paid : total,
    payment_type: "course",
    status: "completed",
    email: row.email,
    phone: row.phone,
    installment_type: paid < total ? "first_half" : "full",
    total_amount: total,
  };
}

export function buildEnrollmentInsert(
  row: ParsedLLRow,
  learnerId: string,
  paymentId: string | null,
): Record<string, unknown> {
  const total = row.totalAmount ?? 0;
  const paid = row.amountPaid ?? total;
  const totalLessons = row.courseId
    ? (COURSES_DATA[row.courseId]?.hours ?? 0)
    : 0;
  const completed = Math.min(row.completedLessons, totalLessons);
  return {
    learner_id: learnerId,
    course_id: row.courseId,
    payment_id: paymentId,
    status: "active",
    amount: total,
    installment_mode: paid < total ? "installment" : "full",
    installment1_amount: paid,
    installment2_amount: Math.max(0, total - paid),
    // Must be full_paid / half_paid / pending — "completed" is payment.status only.
    // Issue Fixer and the learner app key off enrollment.payment_status === "full_paid".
    payment_status:
      paid >= total && total > 0
        ? "full_paid"
        : paid > 0
          ? "half_paid"
          : "pending",
    // Migrated customers get full lesson access.
    unlocked_lessons: Array.from({ length: totalLessons }, (_, i) => i + 1),
    progress: {
      type: "new",
      total_hours: totalLessons,
      completed_lessons: Array.from({ length: completed }, (_, i) => i + 1),
      current_lesson: completed < totalLessons ? completed + 1 : totalLessons,
    },
  };
}

// Downloadable template: header + two sample rows (one has_ll + course, one not_started).
export function buildTemplateCsv(): string {
  const beginner = Object.values(COURSES_DATA).find(
    (c) => c.key === "BEGINNER",
  );
  const sampleCourse = beginner?.label ?? "Beginner course";
  const header = LL_MIGRATION_COLUMNS.join(",");
  const sample1 = [
    "Asha Rao",
    "9876543210",
    "asha@example.com",
    "1998-04-12",
    "HSR Layout",
    "560102",
    "HSR Layout, Bengaluru",
    "12.9116",
    "77.6389",
    "has_ll",
    "KA0120240012345",
    "2026-05-20",
    "2026-05-18",
    "no",
    "no",
    sampleCourse,
    "15000",
    "15000",
    "0",
    "Migrated from paper records",
  ];
  const sample2 = [
    "Rahul Verma",
    "9123456780",
    "",
    "",
    "Indiranagar",
    "",
    "",
    "",
    "",
    "not_started",
    "",
    "",
    "",
    "no",
    "no",
    "",
    "",
    "",
    "0",
    "",
  ];
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return [header, sample1.map(esc).join(","), sample2.map(esc).join(",")].join(
    "\n",
  );
}
