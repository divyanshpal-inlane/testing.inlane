import { format } from "date-fns";
import { PDFDocument } from "pdf-lib";

import { supabase } from "@/lib/supabaseClient";
import { Form5CertificateData, generateForm5PDF } from "@/utils/generateForm5";
import { Form14Data, generateForm14PDF } from "@/utils/generateForm14";
import {
  Form15Data,
  Form15Session,
  generateForm15PDF,
} from "@/utils/generateForm15";
import { lastTenDigits } from "@/utils/phone";

// Fixed values from the Form-5 certificate spec sheet.
export const SCHOOL_NAME = "Inlane Motor Driving Training School";
export const SCHOOL_ADDRESS =
  "Plot No 194 3rd Floor Double Road Indiranagar, KA, 560038";
export const VEHICLE_CLASS = "LMV (Light Motor Vehicle)";
export const FITNESS_CONFIRMED = "Yes - Satisfactory";
export const ISSUED_BY = "InLane Motor Driving Training School";

export interface BulkFormLearner {
  id: string;
  name: string | null;
  phone: string;
  email?: string | null;
  dob?: string | null;
  aadhar_state?: string | null;
  pick_up_location?: string | null;
  area?: string | null;
  city?: string | null;
  pincode?: string | null;
  created_at?: string;
  LL_application_id?: string | null;
  LL_id?: string | null;
  DL_id?: string | null;
  DL_received_date?: string | null;
  signature_storage_path?: string | null;
  signature_mime_type?: string | null;
}

export interface TrainingPeriod {
  first: string | null; // yyyy-MM-dd
  last: string | null; // yyyy-MM-dd
}

export interface TrainingSession {
  date: string; // yyyy-MM-dd
  start_time: string; // HH:mm:ss
  end_time: string; // HH:mm:ss
}

/** Values supplied by the compliance sheet, taking precedence over the DB. */
export interface SheetOverrides {
  name?: string;
  email?: string;
  dob?: string; // dd/MM/yyyy
  guardian?: string; // "Son/Wife/Daughter of" name
  enrolledOn?: string; // LL application date, dd/MM/yyyy
  certDate?: string; // DL test date, dd/MM/yyyy
}

export interface FormsEntry {
  learner: BulkFormLearner;
  period?: TrainingPeriod;
  overrides?: SheetOverrides;
}

const fmt = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "dd/MM/yyyy") : "";

/**
 * First/last class per learner from the Schedule table (cancelled rows
 * excluded). Queries in chunks and pages past PostgREST's 1000-row cap.
 */
export async function fetchTrainingPeriods(
  learnerIds: string[],
): Promise<Map<string, TrainingPeriod>> {
  const periods = new Map<string, TrainingPeriod>();
  const CHUNK = 100;
  const PAGE_SIZE = 1000;

  for (let i = 0; i < learnerIds.length; i += CHUNK) {
    const chunk = learnerIds.slice(i, i + CHUNK);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("Schedule")
        .select("learner_id, date")
        .in("learner_id", chunk)
        .neq("status", "cancelled")
        .order("date", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        if (!row.learner_id || !row.date) continue;
        const cur = periods.get(row.learner_id);
        if (!cur) {
          periods.set(row.learner_id, { first: row.date, last: row.date });
        } else {
          if (row.date < cur.first!) cur.first = row.date;
          if (row.date > cur.last!) cur.last = row.date;
        }
      }
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return periods;
}

/**
 * Every past (or today's) class per learner, oldest first — the rows of the
 * Form-15 driving-hours register. Cancelled and paused classes are excluded;
 * only classes that actually happened (or are booked for today) count.
 * Queries in chunks and pages past PostgREST's 1000-row cap.
 */
export async function fetchTrainingSessions(
  learnerIds: string[],
): Promise<Map<string, TrainingSession[]>> {
  const sessions = new Map<string, TrainingSession[]>();
  const today = format(new Date(), "yyyy-MM-dd");
  const CHUNK = 100;
  const PAGE_SIZE = 1000;

  for (let i = 0; i < learnerIds.length; i += CHUNK) {
    const chunk = learnerIds.slice(i, i + CHUNK);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("Schedule")
        .select("learner_id, date, start_time, end_time")
        .in("learner_id", chunk)
        .neq("status", "cancelled")
        .neq("status", "paused")
        .lte("date", today)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        if (!row.learner_id || !row.date) continue;
        const list = sessions.get(row.learner_id) ?? [];
        list.push({
          date: row.date,
          start_time: row.start_time,
          end_time: row.end_time,
        });
        sessions.set(row.learner_id, list);
      }
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return sessions;
}

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

/** Schedule rows → Form-15 table rows. */
export const toForm15Sessions = (
  sessions: TrainingSession[],
): Form15Session[] =>
  sessions.map((s) => ({
    date: fmt(s.date),
    fromHrs: hhmm(s.start_time),
    toHrs: hhmm(s.end_time),
    vehicleClass: "LMV",
  }));

export const serialNumberFor = (learner: BulkFormLearner) =>
  learner.id?.substring(0, 8).toUpperCase() || "";

const residingAt = (learner: BulkFormLearner) =>
  learner.pick_up_location ||
  [learner.area, learner.city, learner.pincode, learner.aadhar_state]
    .filter(Boolean)
    .join(", ");

/** Form 14/15/5 payloads for one learner, mirroring the Form14Generator defaults. */
export function buildBulkFormData(
  learner: BulkFormLearner,
  period: TrainingPeriod | undefined,
  overrides: SheetOverrides = {},
  sessions: TrainingSession[] = [],
) {
  const serial = serialNumberFor(learner);
  const name = overrides.name || learner.name || "";
  const email = overrides.email || learner.email || undefined;
  const dob = overrides.dob || fmt(learner.dob);
  const enrollmentDate =
    overrides.enrolledOn ||
    fmt(learner.created_at) ||
    format(new Date(), "dd/MM/yyyy");
  const periodFrom = fmt(period?.first) || enrollmentDate;
  const periodTo = fmt(period?.last);
  const address = residingAt(learner);

  const form14: Form14Data = {
    enrollmentNumber: serial,
    name,
    guardianName: overrides.guardian || "",
    permanentAddress: address,
    dob,
    vehicleClass: VEHICLE_CLASS,
    enrollmentDate,
    llNumber: learner.LL_id || learner.LL_application_id || "",
    completionDate: periodTo || undefined,
    dlNumber: learner.DL_id || undefined,
    dlIssueDate: fmt(learner.DL_received_date) || undefined,
    phone: learner.phone,
    email,
  };

  const form15: Form15Data = {
    schoolName: SCHOOL_NAME.toUpperCase(),
    traineeName: name,
    enrollmentNumber: serial,
    enrollmentDate,
    sessions: toForm15Sessions(sessions),
  };

  const form5: Form5CertificateData = {
    certificateNo: serial,
    date: overrides.certDate || periodTo || format(new Date(), "dd/MM/yyyy"),
    name,
    guardian: overrides.guardian || undefined,
    address,
    enrolledOn: enrollmentDate,
    serialNumber: serial,
    vehicleClass: VEHICLE_CLASS,
    periodFrom,
    periodTo: periodTo || undefined,
  };

  return { form14, form15, form5 };
}

/** Download a private learner signature for embedding in an RTO form. */
export async function loadLearnerSignature(
  storagePath: string | null | undefined,
  storedMimeType?: string | null,
): Promise<
  | { traineeSignatureBytes: ArrayBuffer; traineeSignatureMimeType: string }
  | undefined
> {
  if (!storagePath) return undefined;

  const { data, error } = await supabase.storage
    .from("learner-signatures")
    .download(storagePath);
  if (error) {
    throw new Error(`Learner signature failed to load: ${error.message}`);
  }

  const mimeType = data.type || storedMimeType || "image/png";
  if (mimeType !== "image/png" && mimeType !== "image/jpeg") {
    throw new Error(`Unsupported learner signature format: ${mimeType}`);
  }

  return {
    traineeSignatureBytes: await data.arrayBuffer(),
    traineeSignatureMimeType: mimeType,
  };
}

/**
 * One merged PDF for every entry: Form 14, Form 15 and the Form-5
 * certificate per learner, in list order.
 */
export async function generateAllFormsMergedPDF(
  entries: FormsEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  const sessionsByLearner = await fetchTrainingSessions(
    entries.map((e) => e.learner.id).filter(Boolean),
  );

  for (let i = 0; i < entries.length; i++) {
    const { learner, period, overrides } = entries[i];
    try {
      const { form14, form15, form5 } = buildBulkFormData(
        learner,
        period,
        overrides,
        sessionsByLearner.get(learner.id) ?? [],
      );
      const learnerSignature = await loadLearnerSignature(
        learner.signature_storage_path,
        learner.signature_mime_type,
      );
      if (learnerSignature) Object.assign(form15, learnerSignature);
      const parts = await Promise.all([
        generateForm14PDF(form14),
        generateForm15PDF(form15),
        generateForm5PDF(form5),
      ]);
      for (const bytes of parts) {
        const doc = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      }
    } catch (error) {
      const who = learner.name || learner.phone || learner.id || `#${i + 1}`;
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed on ${who} (${i + 1} of ${entries.length}): ${reason}`,
      );
    }
    onProgress?.(i + 1, entries.length);
  }

  return merged.save();
}

/**
 * Look up learners by phone (last-10-digit identity, matching any stored
 * format). Returns a map keyed by last-10 digits; when several learners share
 * a phone, the most recently created one wins.
 */
export async function matchLearnersByPhone(
  phones: string[],
): Promise<Map<string, BulkFormLearner>> {
  const keys = [
    ...new Set(phones.map(lastTenDigits).filter((d) => d.length === 10)),
  ];
  const matched = new Map<string, BulkFormLearner>();
  const CHUNK = 20;

  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("Learner")
      .select(
        // LL_id exists in the live DB but is missing from the stale generated
        // types, hence the returns<> cast.
        "id, name, phone, email, dob, pick_up_location, area, city, pincode, aadhar_state, created_at, LL_application_id, LL_id, DL_id, DL_received_date, signature_storage_path, signature_mime_type",
      )
      .or(chunk.map((d) => `phone.ilike.%${d}`).join(","))
      .returns<BulkFormLearner[]>();
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const key = lastTenDigits(row.phone);
      if (key.length !== 10) continue;
      const existing = matched.get(key);
      if (
        !existing ||
        new Date(row.created_at ?? 0) > new Date(existing.created_at ?? 0)
      ) {
        matched.set(key, row);
      }
    }
  }
  return matched;
}

/** One customer row pasted from the compliance sheet's "Data dump" tab. */
export interface SheetCustomer {
  name: string;
  phone: string;
  email?: string;
  dob?: string; // dd/MM/yyyy
  guardian?: string;
  enrolledOn?: string; // dd/MM/yyyy
  certDate?: string; // dd/MM/yyyy
}

// Sheet dates are US-style M/d/yyyy; normalise to dd/MM/yyyy.
const SHEET_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const normalizeSheetDate = (value: string): string | null => {
  const m = value.trim().match(SHEET_DATE);
  if (!m) return null;
  return `${m[2].padStart(2, "0")}/${m[1].padStart(2, "0")}/${m[3]}`;
};

const splitLine = (line: string): string[] => {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  // Basic CSV with quoted fields
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
};

const looksLikePhone = (cell: string) => {
  const digits = cell.replace(/\D/g, "");
  return digits.length >= 10 && !/[a-zA-Z@]/.test(cell);
};

/**
 * Parse rows pasted from the "Data dump for all forms" tab (TSV when copied
 * from Google Sheets, CSV also accepted). Header rows and rows without a
 * valid phone number are skipped. Column positions are inferred per row —
 * name is the last text cell before the phone; after the phone: email is the
 * cell containing "@", the first date is the DOB, the first remaining text
 * cell is the guardian, and later dates are Enrolled On then the DL test
 * date, matching the sheet's column order.
 */
export function parseSheetCustomers(text: string): {
  customers: SheetCustomer[];
  skipped: number;
} {
  const customers: SheetCustomer[] = [];
  let skipped = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = splitLine(line);
    const phoneIdx = cells.findIndex(looksLikePhone);
    if (phoneIdx === -1) {
      skipped++;
      continue;
    }
    const name =
      cells
        .slice(0, phoneIdx)
        .filter((c) => c && !SHEET_DATE.test(c))
        .pop() || "";
    const customer: SheetCustomer = {
      name,
      phone: lastTenDigits(cells[phoneIdx]),
    };

    const datesAfterGuardian: string[] = [];
    for (const cell of cells.slice(phoneIdx + 1)) {
      if (!cell) continue;
      if (cell.includes("@")) {
        customer.email = customer.email || cell;
        continue;
      }
      const date = normalizeSheetDate(cell);
      if (date) {
        if (!customer.dob) customer.dob = date;
        else datesAfterGuardian.push(date);
        continue;
      }
      if (looksLikePhone(cell)) continue; // stray extra phone
      customer.guardian = customer.guardian || cell;
    }
    customer.enrolledOn = datesAfterGuardian[0];
    customer.certDate = datesAfterGuardian[1];
    customers.push(customer);
  }

  return { customers, skipped };
}

const DATA_DUMP_HEADERS = [
  "Certificate No.",
  "Trainee Name (Shri/Smt/Kumari)",
  "Customer Phone number",
  "Customer Email id",
  "Customer DOB",
  "Son/Wife/Daughter of",
  "Enrolled On",
  "Date",
  "School Name",
  "School Address",
  "Residing At",
  "Serial No. (Form 14 In-Out Register)",
  "Class of Vehicle / Training",
  "Training Period From",
  "Training Period To",
  "Physical Fitness & Responsibility Confirmed",
  "Issued By",
  "Signatory",
];

/**
 * CSV in the exact column order of the sheet's "Data dump for all forms"
 * tab, ready to paste back over it.
 */
export function buildDataDumpCSV(entries: FormsEntry[]): string {
  const rows = entries.map(({ learner, period, overrides = {} }) => {
    const serial = serialNumberFor(learner);
    return [
      serial,
      overrides.name || learner.name || "",
      lastTenDigits(learner.phone) || learner.phone || "",
      overrides.email || learner.email || "",
      overrides.dob || fmt(learner.dob),
      overrides.guardian || "",
      overrides.enrolledOn || fmt(learner.created_at),
      overrides.certDate || "",
      SCHOOL_NAME,
      SCHOOL_ADDRESS,
      learner.id ? residingAt(learner) : "",
      serial,
      VEHICLE_CLASS,
      fmt(period?.first),
      fmt(period?.last),
      FITNESS_CONFIRMED,
      ISSUED_BY,
      "", // Signatory — physical signature
    ]
      .map(csvCell)
      .join(",");
  });
  return [DATA_DUMP_HEADERS.map(csvCell).join(","), ...rows].join("\n");
}

const CSV_HEADERS = [
  "Trainee Name",
  "Phone",
  "School Name",
  "School Address",
  "Residing At",
  "Serial No. (Form 14 In-Out Register)",
  "Class of Vehicle / Training",
  "Training Period From",
  "Training Period To",
  "Physical Fitness & Responsibility Confirmed",
  "Issued By",
  "Signatory",
];

const csvCell = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** Certificate sheet rows (one per learner) matching the spec-sheet columns. */
export function buildCertificateSheetCSV(
  learners: BulkFormLearner[],
  periods: Map<string, TrainingPeriod>,
): string {
  const rows = learners.map((learner) => {
    const period = periods.get(learner.id);
    return [
      learner.name || "",
      learner.phone || "",
      SCHOOL_NAME,
      SCHOOL_ADDRESS,
      residingAt(learner),
      serialNumberFor(learner),
      VEHICLE_CLASS,
      fmt(period?.first),
      fmt(period?.last),
      FITNESS_CONFIRMED,
      ISSUED_BY,
      "", // Signatory — physical signature
    ]
      .map(csvCell)
      .join(",");
  });
  return [CSV_HEADERS.map(csvCell).join(","), ...rows].join("\n");
}

export function downloadCSV(csv: string, filename: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
