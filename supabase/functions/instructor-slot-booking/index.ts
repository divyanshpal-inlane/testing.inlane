import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Cratio (the CRM vendor behind the "Ratio CRM" integration). This is the
// legacy `apirequest.php` API: the operation, form name and API key travel as
// QUERY params, and `getRecordsBySearch` is the only way to fetch a single
// lead (there is no get-by-id operation) — we search on the `Email Address` column.
// The URL + key are read from secrets, never from client code. See
// supabase/functions/.env.example for the variable names.
const CRATIO_LOOKUP_URL = Deno.env.get("CRATIO_LEAD_LOOKUP_URL");
const CRATIO_TOKEN = Deno.env.get("CRATIO_API_TOKEN");
const CRATIO_FORM_NAME = "Leads";
const CRATIO_TIMEOUT_MS = 8000;

// API column searched by the "Lead ID" tab: the Lead ID shown on the Cratio lead
// page. Cratio's `Form ID` is a DIFFERENT number (UI lead 103313 is Form ID
// 110869) and loads the wrong customer, so never point this at "Form ID". The
// search condition must travel as a URL query param (see searchCratio), as in
// Cratio's own Postman example. Set to null to switch the tab off.
const LEAD_ID_FIELD: string | null = "Lead ID";

type LookupBy = "email" | "leadId";
const parseBy = (v: unknown): LookupBy => (v === "leadId" ? "leadId" : "email");
const LEAD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CRATIO_DISPLAY_FIELDS = [
  "Contact Name",
  "Email Address",
  "Mobile Number",
  "Lead Owner",
  "Customer Location",
  "Locality",
  "Caller Name",
  "Created By",
  "Created Username",
  "Course Applicable",
  "Course Details",
  "Course Tenure",
  "Payment Status",
];

const supabase = createClient(
  Deno.env.get("MY_SUPABASE_URL") ?? "",
  Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// --- CRM lead lookup --------------------------------------------------------

// The Cratio API exposes NO column for the "Lead ID" shown in the CRM UI: its
// only ID column, `Form ID`, is a different number (UI lead 103313 is Form ID
// 110869). Searching it would silently return the wrong customer, so until
// Cratio exposes the Lead ID, leads are looked up by e-mail address, which the
// API does expose as `Email Address`.
function toCrmEmail(input: string): string | undefined {
  const email = input.trim().toLowerCase();
  return /^[^\s@,;|"']+@[^\s@,;|"']+\.[^\s@,;|"']+$/.test(email)
    ? email
    : undefined;
}

function str(value: unknown): string | undefined {
  const s = String(value ?? "").trim();
  return s || undefined;
}

// Cratio's free-text payment status -> the form's three options. Unrecognised
// or empty values return undefined so the form's own default stays.
function mapPayment(value: unknown): string | undefined {
  const v = str(value)?.toLowerCase();
  if (!v) return undefined;
  if (/un\s*paid|pending|due|not\s*paid/.test(v)) return "Unpaid";
  if (/half|part|advance|token/.test(v)) return "Half paid";
  if (/full|complete|paid/.test(v)) return "Full paid";
  return undefined;
}

// Map a Cratio lead payload onto the booking form's own contract. Cratio's
// legacy API uses human-readable column names ("Contact Name", "Mobile
// Number", "Lead Owner", "Customer Location"). `phone` is included here for
// SERVER-SIDE persistence only — callers must strip it before anything is
// returned to the browser.
// "Lead Owner" is sometimes a team bucket ("Ops team") rather than the person
// who sold the lead; in that case fall back to the person who worked it.
function pickSalesPerson(lead: Record<string, unknown>): string | undefined {
  const owner = str(lead["Lead Owner"] ?? lead.sales_lead ?? lead.lead_owner);
  if (owner && !/\b(ops|team|unassigned|admin)\b/i.test(owner)) return owner;
  return (
    str(lead["Caller Name"]) ??
    str(lead["Created By"]) ??
    str(lead["Created Username"]) ??
    owner
  );
}

function mapLead(lead: Record<string, unknown>) {
  const rawAddress = str(
    lead["Customer Location"] ?? lead["Locality"] ?? lead.address,
  );
  return {
    name: str(lead["Contact Name"] ?? lead.name ?? lead.contact_name),
    // Cratio often stores the location as "Area |" — drop the trailing marker.
    address: rawAddress
      ? rawAddress.replace(/[\s|]+$/, "").trim() || undefined
      : undefined,
    leadName: pickSalesPerson(lead),
    // Cratio dropdown placeholders ("--select--") mean "not chosen".
    course:
      [lead["Course Details"], lead["Course Tenure"]]
        .map(str)
        .filter((v) => v && !/^-+\s*select\s*-+$/i.test(v))
        .join(" ") || undefined,
    payment: mapPayment(lead["Payment Status"]),
    email: str(lead["Email Address"]),
    // Cratio's "Course Applicable" dropdown; only Learner Management uses it.
    courseApplicable: str(lead["Course Applicable"]),
    phone: str(
      lead["Mobile Number"] ??
        lead["Mobile"] ??
        lead.mobile ??
        lead.mobile_number,
    ),
  };
}

type LeadFields = {
  name?: string;
  address?: string;
  leadName?: string;
  course?: string;
  payment?: string;
  email?: string;
  courseApplicable?: string;
  phone?: string;
};

type LeadFetchResult = {
  configured: boolean;
  error?: string;
  found?: boolean;
  lead?: LeadFields | null;
};

// Fetch + map a Cratio lead. Returns the phone; only server-side code may use
// it. Endpoint + token live in environment secrets; when unset we report clear,
// structured "not configured" failures instead of guessing an API contract.
//
// Cratio's legacy API: POST apirequest.php?operation=getRecordsBySearch with
// apikey/formname in the query, and the search expression + display fields in
// the JSON body. A match returns `{ data: [ {...} ] }`; no match returns the
// body `{ "error": "NO RECORDS FOUND" }` (still HTTP 200).
type CratioSearch =
  | { error: string }
  | {
      payload: Record<string, unknown> | null;
      rows: Record<string, unknown>[];
    };

async function searchCratio(
  searchcondition: string,
  field: string,
  numofrecords: number,
): Promise<CratioSearch> {
  const url =
    `${CRATIO_LOOKUP_URL}?operation=getRecordsBySearch` +
    `&apikey=${encodeURIComponent(CRATIO_TOKEN ?? "")}` +
    `&formname=${encodeURIComponent(CRATIO_FORM_NAME)}` +
    // Cratio's documented example sends the search condition as a query param.
    `&searchcondition=${encodeURIComponent(searchcondition)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: CRATIO_TOKEN,
        formname: CRATIO_FORM_NAME,
        operation: "getRecordsBySearch",
        displayfields: [...new Set([...CRATIO_DISPLAY_FIELDS, field])],
        pageno: 1,
        numofrecords,
        isnull: 1,
        searchcondition,
      }),
      signal: AbortSignal.timeout(CRATIO_TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof DOMException && err.name === "TimeoutError";
    console.error("[instructor-slot-booking] CRM fetch failed:", err);
    return {
      error: timeout ? "CRM_LOOKUP_TIMEOUT" : "CRM_LOOKUP_NETWORK_ERROR",
    };
  }

  if (!response.ok) {
    console.error(
      "[instructor-slot-booking] CRM HTTP error:",
      response.status,
      await response.text().catch(() => ""),
    );
    return { error: "CRM_LOOKUP_HTTP_ERROR" };
  }

  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const rows = Array.isArray(payload?.data)
    ? (payload.data as Record<string, unknown>[])
    : [];
  return { payload, rows };
}

// Negative control: a search for an ID that cannot exist must come back empty.
// If Cratio instead returns a row, it is ignoring the condition and any row it
// gives us for a real ID is arbitrary, so it must not be trusted.
async function searchFilterIsHonoured(field: string): Promise<boolean> {
  const res = await searchCratio(`${field}@is@0@AND`, field, 1);
  return !("error" in res) && res.rows.length === 0;
}

async function fetchLead(
  value: string,
  by: LookupBy = "email",
): Promise<LeadFetchResult> {
  if (!CRATIO_LOOKUP_URL || !CRATIO_TOKEN) {
    return { configured: false, error: "CRM_LOOKUP_NOT_CONFIGURED" };
  }
  // Which column to search and what the matched record must contain.
  let field: string;
  let key: string;
  if (by === "leadId") {
    if (!LEAD_ID_FIELD) {
      return { configured: true, error: "CRM_LOOKUP_LEAD_ID_UNAVAILABLE" };
    }
    if (!LEAD_ID_RE.test(value.trim())) {
      return { configured: true, error: "CRM_LOOKUP_INVALID_ID" };
    }
    field = LEAD_ID_FIELD;
    key = value.trim();
  } else {
    const email = toCrmEmail(value);
    if (!email) {
      return { configured: true, error: "CRM_LOOKUP_USE_EMAIL" };
    }
    field = "Email Address";
    key = email;
  }
  const norm = (v: unknown) =>
    by === "email"
      ? String(v ?? "")
          .trim()
          .toLowerCase()
      : String(v ?? "").trim();

  // Cratio's search syntax is `Column@operator@value@AND`, so an e-mail's own
  // "@" breaks an exact `is` match (the API answers NO RECORDS FOUND). Search
  // on the part before the "@" and let the exact check below pick the record.
  const conditions =
    by === "email"
      ? [
          `${field}@contains@${key.split("@")[0]}@AND`,
          `${field}@startswith@${key.split("@")[0]}@AND`,
        ]
      : [`${field}@is@${key}@AND`];
  const numRecords = by === "email" ? 25 : 1;

  let payload: Record<string, unknown> | null = null;
  let rows: Record<string, unknown>[] = [];
  for (const searchcondition of conditions) {
    const res = await searchCratio(searchcondition, field, numRecords);
    if ("error" in res) return { configured: true, error: res.error };
    payload = res.payload;
    rows = res.rows;
    if (rows.some((r) => norm(r[field]) === norm(key))) break;
  }

  if (rows.length === 0) {
    console.error(
      "[instructor-slot-booking] CRM returned no rows for",
      by,
      JSON.stringify(payload)?.slice(0, 300),
    );
    return { configured: true, found: false, lead: null };
  }

  // Never trust the search to have filtered: only accept a record whose
  // searched column really holds the value asked for.
  let row = rows.find((r) => norm(r[field]) === norm(key));
  // Cratio can SEARCH on `Lead ID` without RETURNING it. When no row carries
  // the field we cannot compare it, so accept the match only if the search is
  // proven to honour the condition (see searchFilterIsHonoured).
  if (
    !row &&
    by === "leadId" &&
    rows.length > 0 &&
    !rows.some((r) => field in r) &&
    (await searchFilterIsHonoured(field))
  ) {
    row = rows[0];
  }
  if (!row) {
    console.error(
      "[instructor-slot-booking] CRM returned no record matching the searched value; field present in rows:",
      rows.some((r) => field in r),
      "row keys:",
      Object.keys(rows[0] ?? {}),
    );
    return { configured: true, found: false, lead: null };
  }

  const mapped = mapLead(row);

  if (!mapped.name && !mapped.address && !mapped.phone) {
    return { configured: true, found: false, lead: null };
  }

  return { configured: true, found: true, lead: mapped };
}

// Look up a sales lead by its Lead ID for the form preview. The returned
// customer is phone-free: learner/customer phone numbers never reach the
// browser, no matter what the CRM returns.
async function lookupLead(leadId: string, by: LookupBy) {
  const result = await fetchLead(leadId, by);
  if (!result.configured) {
    return {
      configured: false,
      found: false,
      customer: null,
      code: result.error,
    };
  }
  if (result.error) {
    return {
      configured: true,
      found: false,
      customer: null,
      code: result.error,
    };
  }
  if (!result.found || !result.lead) {
    return { configured: true, found: false, customer: null };
  }
  // The Instructor Management form never receives phone or e-mail.
  const {
    phone: _phone,
    email: _email,
    courseApplicable: _courseApplicable,
    ...customer
  } = result.lead;
  return { configured: true, found: true, customer };
}

// Lookup for Learner Management's "Create New Learner" form. Unlike the
// Instructor Management lookup, that form needs the lead's e-mail and phone to
// create the learner account, so this (and only this) action returns them. The
// phone is normalised to the 10 digits the form validates.
async function lookupLearnerLead(leadId: string, by: LookupBy) {
  const result = await fetchLead(leadId, by);
  if (!result.configured) {
    return {
      configured: false,
      found: false,
      learner: null,
      code: result.error,
    };
  }
  if (result.error) {
    return {
      configured: true,
      found: false,
      learner: null,
      code: result.error,
    };
  }
  if (!result.found || !result.lead) {
    return { configured: true, found: false, learner: null };
  }
  const { name, email, phone, courseApplicable, address, payment } =
    result.lead;
  // Only Cratio's "Course Applicable" is used. "Course Details" is a different
  // field (it held "Traffic + Parking" for a lead whose Course Applicable was
  // "Beginner course"), so mixing it in picked the wrong course. A "--select--"
  // placeholder means no course.
  const courseText =
    courseApplicable && !/^-+\s*select\s*-+$/i.test(courseApplicable)
      ? courseApplicable
      : undefined;
  const digits = (phone ?? "").replace(/\D/g, "");
  return {
    configured: true,
    found: true,
    learner: {
      name,
      email,
      course: courseText,
      address,
      payment,
      phone: digits.length >= 10 ? digits.slice(-10) : undefined,
    },
  };
}

// --- slot validation --------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

type SlotInput = {
  date: string;
  start_time: string;
  end_time: string;
  description?: string;
};

type ExistingBlock = {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  tentative_details?: { name?: string } | null;
};

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// Validate + normalise a client-supplied slot. Returns null when malformed, so
// callers can reject the batch instead of silently treating a bad time as
// "free" (toMinutes("") is NaN and every overlap comparison would be false).
function parseSlot(raw: unknown): SlotInput | null {
  if (!raw || typeof raw !== "object") return null;
  const { date, start_time, end_time, description } = raw as Record<
    string,
    unknown
  >;
  const d = String(date ?? "").trim();
  const s = String(start_time ?? "").trim();
  const e = String(end_time ?? "").trim();
  if (!DATE_RE.test(d) || Number.isNaN(Date.parse(d))) return null;
  if (!TIME_RE.test(s) || !TIME_RE.test(e)) return null;
  if (toMinutes(s) >= toMinutes(e)) return null;
  return { date: d, start_time: s, end_time: e, description: str(description) };
}

function parseSlots(raw: unknown): { slots?: SlotInput[]; error?: string } {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) return { error: "No slots provided" };
  const slots: SlotInput[] = [];
  for (const item of list) {
    const slot = parseSlot(item);
    if (!slot) return { error: "One or more slots are invalid" };
    slots.push(slot);
  }
  return { slots };
}

async function fetchBlocks(
  instructorId: string,
  minDate: string,
  maxDate: string,
) {
  const { data, error } = await supabase
    .from("Schedule")
    .select("id, date, start_time, end_time, tentative_details")
    .gte("date", minDate)
    .lte("date", maxDate)
    .eq("instructor_id", instructorId);
  return { data: (data ?? []) as ExistingBlock[], error };
}

function conflictFor(slot: SlotInput, blocks: ExistingBlock[]) {
  const start = toMinutes(slot.start_time);
  const end = toMinutes(slot.end_time);
  return blocks.find((block) => {
    if (block.date !== slot.date) return false;
    const blockStart = toMinutes(block.start_time);
    const blockEnd = toMinutes(block.end_time);
    return start < blockEnd && end > blockStart;
  });
}

function conflictError(block: ExistingBlock) {
  const who = block.tentative_details?.name || "Confirmed Lesson";
  return { error: `Instructor is busy: ${who}`, code: "SLOT_CONFLICT" };
}

// PostgREST surfaces the `schedule_no_overlap_new_rows` exclusion violation as
// SQLSTATE 23P01. Map it (and the constraint name, as a fallback) to the same
// friendly conflict message used by the pre-flight check.
function isOverlapError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "23P01" ||
    /no_overlap|conflicting key|exclusion/i.test(error.message ?? "")
  );
}

// Server-side slot/booking validation. Mirrors the client's old overlap rules
// (src/queries/instructor.ts) but never returns tentative_details, so phone
// numbers never reach the response. Blockers are reported by name only.
async function validateSlots(instructorId: string, rawSlots: unknown) {
  const { slots, error: parseError } = parseSlots(rawSlots);
  if (parseError || !slots) return { error: parseError, code: "INVALID_SLOT" };

  const dates = slots.map((s) => s.date);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  const { data: blocks, error } = await fetchBlocks(
    instructorId,
    minDate,
    maxDate,
  );
  if (error) {
    console.error(
      "[instructor-slot-booking] Availability query failed:",
      error,
    );
    return { error: "Failed to check availability", code: "DB_ERROR" };
  }

  const map: Record<string, { available: boolean; reason: string }> = {};
  for (const slot of slots) {
    const key = `${slot.date}-${slot.start_time}`;
    const conflict = conflictFor(slot, blocks);
    map[key] = conflict
      ? { available: false, reason: conflictError(conflict).error }
      : { available: true, reason: "" };
  }
  return { availabilityMap: map };
}

// Instructor Management schedule read. Returns the same shape the module's old
// `fetchAdminSchedules` call produced. The phone of the joined learner and the
// one inside the `tentative_details` JSON are masked server-side unless the
// caller may see customer phones (see getCaller), so an unpermitted browser
// never receives a real number.
const SCHEDULE_PAGE_SIZE = 1000;
async function fetchSchedules(instructorId: string, canSeePhones: boolean) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += SCHEDULE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("Schedule")
      .select(
        `*,
        Lesson(id, number),
        Instructor(id_instructor, name),
        Courses(id, name, total_lessons),
        learner:learner_id(id, name, phone, pick_up_location, address_lat, address_lng)`,
      )
      .eq("instructor_id", instructorId)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + SCHEDULE_PAGE_SIZE - 1);

    if (error) {
      console.error("[instructor-slot-booking] Schedule query failed:", error);
      return { error: "Failed to fetch schedules", code: "DB_ERROR" };
    }
    const page = data ?? [];
    rows.push(...(page as Record<string, unknown>[]));
    if (page.length < SCHEDULE_PAGE_SIZE) break;
  }

  const sanitized = rows.map((row) => {
    const { tentative_details: details, learner, ...rest } = row;
    let safeDetails = details;
    if (!canSeePhones && details && typeof details === "object") {
      const d = details as Record<string, unknown>;
      safeDetails = d.phone ? { ...d, phone: maskPhone(d.phone) } : d;
    }
    let safeLearner = learner;
    if (!canSeePhones && learner && typeof learner === "object") {
      const l = learner as Record<string, unknown>;
      safeLearner = l.phone ? { ...l, phone: maskPhone(l.phone) } : l;
    }
    return { ...rest, learner: safeLearner, tentative_details: safeDetails };
  });

  return { rows: sanitized };
}

// Resolve a Cratio lead's phone for server-side persistence. The browser never
// sends or receives it; it is fetched here and written straight to the DB. Any
// failure degrades to "no phone stored" rather than blocking the booking.
async function resolveLeadPhone(
  leadId: string,
  by: LookupBy,
): Promise<string | undefined> {
  const id = (leadId ?? "").trim();
  if (!id) return undefined;
  try {
    const result = await fetchLead(id, by);
    if (result.configured && result.found && result.lead?.phone) {
      return result.lead.phone;
    }
  } catch (err) {
    console.error("[instructor-slot-booking] phone resolve failed:", err);
  }
  return undefined;
}

// Build the tentative_details JSON that is written to the DB. A client-supplied
// `phone` is always discarded — the phone may only come from the CRM — and the
// CRM phone is injected here on the server.
function buildTentativeDetails(
  details: Record<string, unknown>,
  phone: string | undefined,
  description: unknown,
) {
  const base: Record<string, unknown> = { ...details };
  delete base.phone;
  if (phone) base.phone = phone;
  base.description = description;
  return base;
}

function normalizeCourseId(value: unknown) {
  if (
    value === "none" ||
    value === "topup" ||
    value === "" ||
    value === undefined ||
    value === null
  ) {
    return null;
  }
  const numeric =
    typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isNaN(numeric) ? null : numeric;
}

// Create the tentative hold rows. The Schedule insert happens here (service
// role) so the CRM phone can be attached without ever touching the browser.
async function createTentativeSchedules(body: {
  instructorId?: string;
  leadId?: string;
  leadBy?: string;
  slots?: unknown;
  details?: Record<string, unknown>;
}) {
  const instructorId = String(body.instructorId ?? "").trim();
  const details = body.details ?? {};
  if (!instructorId) {
    return { error: "Instructor ID is required", code: "NO_INSTRUCTOR" };
  }

  const { slots, error: parseError } = parseSlots(body.slots);
  if (parseError || !slots) return { error: parseError, code: "INVALID_SLOT" };

  const dates = slots.map((s) => s.date);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  // Pre-flight overlap check gives a named conflict and avoids a partial
  // multi-row insert. The DB exclusion constraint remains the source of truth.
  const { data: blocks, error: blockError } = await fetchBlocks(
    instructorId,
    minDate,
    maxDate,
  );
  if (blockError) {
    console.error(
      "[instructor-slot-booking] Availability query failed:",
      blockError,
    );
    return { error: "Failed to check availability", code: "DB_ERROR" };
  }
  const conflict = slots
    .map((slot) => conflictFor(slot, blocks))
    .find((block): block is ExistingBlock => !!block);
  if (conflict) return conflictError(conflict);

  const phone = await resolveLeadPhone(
    String(body.leadId ?? ""),
    parseBy(body.leadBy),
  );
  const courseId = normalizeCourseId(details.course_id);

  const rows = slots.map((slot) => ({
    date: slot.date,
    start_time: slot.start_time,
    end_time: slot.end_time,
    instructor_id: instructorId,
    isTentative: true,
    status: "hold",
    course_id: courseId,
    tentative_details: buildTentativeDetails(details, phone, slot.description),
  }));

  const { data: inserted, error } = await supabase
    .from("Schedule")
    .insert(rows)
    .select("id");
  if (error) {
    if (isOverlapError(error)) {
      return {
        error: "Instructor is busy: another booking now overlaps these slots.",
        code: "SLOT_CONFLICT",
      };
    }
    console.error("[instructor-slot-booking] Tentative insert failed:", error);
    return { error: "Failed to create tentative schedules", code: "DB_ERROR" };
  }
  const ids = (inserted ?? []).map((row) => (row as { id: number }).id);
  return { ids, phoneStored: !!phone };
}

// Update a single tentative hold row, injecting the CRM phone server-side.
async function updateTentativeSchedule(body: {
  id?: string;
  leadId?: string;
  leadBy?: string;
  slot?: Record<string, unknown>;
  details?: Record<string, unknown>;
}) {
  const id = String(body.id ?? "").trim();
  const details = body.details ?? {};
  if (!id) return { error: "Schedule ID is required", code: "NO_ID" };
  // Schedule.id is an integer; a non-numeric id would make PostgREST raise a
  // cast error rather than a clean miss. Treat it as "not found".
  if (!/^\d+$/.test(id)) {
    return { error: "Schedule not found", code: "NOT_FOUND" };
  }

  const slot = parseSlot(body.slot);
  if (!slot)
    return { error: "One or more slots are invalid", code: "INVALID_SLOT" };

  // Resolve the row (and its true instructor) before writing, so a stale/forged
  // id can never silently no-op and the overlap check scopes to the right owner.
  const { data: existing, error: findError } = await supabase
    .from("Schedule")
    .select("id, instructor_id")
    .eq("id", id)
    .maybeSingle();
  if (findError) {
    console.error(
      "[instructor-slot-booking] Schedule lookup failed:",
      findError,
    );
    return { error: "Failed to update tentative schedule", code: "DB_ERROR" };
  }
  if (!existing) return { error: "Schedule not found", code: "NOT_FOUND" };

  const instructorId = (existing as { instructor_id: string }).instructor_id;
  const { data: blocks, error: blockError } = await fetchBlocks(
    instructorId,
    slot.date,
    slot.date,
  );
  if (blockError) {
    console.error(
      "[instructor-slot-booking] Availability query failed:",
      blockError,
    );
    return { error: "Failed to check availability", code: "DB_ERROR" };
  }
  const conflict = conflictFor(
    slot,
    blocks.filter((block) => String(block.id) !== id),
  );
  if (conflict) return conflictError(conflict);

  const phone = await resolveLeadPhone(
    String(body.leadId ?? ""),
    parseBy(body.leadBy),
  );
  const courseId = normalizeCourseId(details.course_id);

  const { data: updated, error } = await supabase
    .from("Schedule")
    .update({
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
      course_id: courseId,
      tentative_details: buildTentativeDetails(
        details,
        phone,
        slot.description,
      ),
    })
    .eq("id", id)
    .select("id");

  if (error) {
    if (isOverlapError(error)) {
      return {
        error: "Instructor is busy: another booking now overlaps this slot.",
        code: "SLOT_CONFLICT",
      };
    }
    console.error("[instructor-slot-booking] Tentative update failed:", error);
    return { error: "Failed to update tentative schedule", code: "DB_ERROR" };
  }
  if (!updated || updated.length === 0) {
    return { error: "Schedule not found", code: "NOT_FOUND" };
  }
  return { ids: [id], phoneStored: !!phone };
}

// Only users with an Admin record may read CRM data or validate booking slots.
// Permission (managed in User / Admin Management, like "View Unmasked Phone
// Numbers" which is for the ops team and is not touched here) that allows
// seeing customer / lead phone numbers unmasked.
const CUSTOMER_PHONE_PERMISSION = "view_unmasked_customer_phone_numbers";

// Same format the app uses everywhere: nine X's and the last two digits.
function maskPhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length < 2 ? "XXXXXXXXXX" : `XXXXXXXXX${digits.slice(-2)}`;
}

// Any logged-in staff account may use this function: an "Admin" row (which
// includes super admins, flagged is_super_admin) or a "User" row (team members
// created by an admin). Learners and instructors are not staff and are refused.
// Phones are stored in several formats, so match on every common variant.
// `canSeePhones` is true for super admins and for accounts that were granted
// CUSTOMER_PHONE_PERMISSION; everyone else gets masked numbers from this
// function, so an unpermitted browser never receives a real number.
async function getCaller(
  authHeader: string | null,
): Promise<{ authorized: boolean; canSeePhones: boolean }> {
  const denied = { authorized: false, canSeePhones: false };
  if (!authHeader?.startsWith("Bearer ")) return denied;
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user?.phone) return denied;

  const digits = user.phone.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  const variants = [
    ...new Set([user.phone, digits, last10, `91${last10}`, `+91${last10}`]),
  ];

  let authorized = false;
  let canSeePhones = false;

  const { data: admins } = await supabase
    .from("Admin")
    .select("id, is_super_admin")
    .in("phone", variants)
    .limit(1);
  const admin = admins?.[0];
  if (admin) {
    authorized = true;
    if (admin.is_super_admin) {
      canSeePhones = true;
    } else {
      const { data: perms } = await supabase
        .from("admin_permissions")
        .select("permission")
        .eq("admin_id", admin.id)
        .eq("permission", CUSTOMER_PHONE_PERMISSION)
        .limit(1);
      if (perms && perms.length > 0) canSeePhones = true;
    }
  }

  const { data: users } = await supabase
    .from("User")
    .select("id")
    .in("phone", variants)
    .limit(1);
  const staffUser = users?.[0];
  if (staffUser) {
    authorized = true;
    if (!canSeePhones) {
      const { data: perms } = await supabase
        .from("user_permissions")
        .select("permission")
        .eq("user_id", staffUser.id)
        .eq("permission", CUSTOMER_PHONE_PERMISSION)
        .limit(1);
      if (perms && perms.length > 0) canSeePhones = true;
    }
  }

  return { authorized, canSeePhones };
}

serve(async (req) => {
  const startedAt = Date.now();
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return json(405, { error: "Method Not Allowed" });
    }

    const caller = await getCaller(req.headers.get("Authorization"));
    if (!caller.authorized) {
      return json(401, { error: "Unauthorized" });
    }

    let body: {
      action?: string;
      leadId?: string;
      by?: string;
      leadBy?: string;
      instructorId?: string;
      slots?: unknown;
      id?: string;
      slot?: Record<string, unknown>;
      details?: Record<string, unknown>;
    };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON payload" });
    }

    const action = body.action;
    if (action === "lookup") {
      const leadId = String(body.leadId ?? "").trim();
      if (!leadId) {
        return json(400, { success: false, error: "Lead ID is required" });
      }
      const result = await lookupLead(leadId, parseBy(body.by));
      return json(200, { success: true, ...result });
    }

    if (action === "lookupLearner") {
      const leadId = String(body.leadId ?? "").trim();
      if (!leadId) {
        return json(400, { success: false, error: "Lead ID is required" });
      }
      const result = await lookupLearnerLead(leadId, parseBy(body.by));
      return json(200, { success: true, ...result });
    }

    if (
      action === "validate" ||
      action === "schedules" ||
      action === "create"
    ) {
      const instructorId = String(body.instructorId ?? "").trim();
      if (!instructorId) {
        return json(400, {
          success: false,
          error: "Instructor ID is required",
          code: "NO_INSTRUCTOR",
        });
      }
      if (action === "validate") {
        const result = await validateSlots(instructorId, body.slots);
        if (result.error) {
          return json(400, { success: false, ...result });
        }
        return json(200, {
          success: true,
          availabilityMap: result.availabilityMap,
        });
      }
      if (action === "schedules") {
        const result = await fetchSchedules(instructorId, caller.canSeePhones);
        if (result.error) {
          return json(400, { success: false, ...result });
        }
        return json(200, { success: true, rows: result.rows });
      }
      const result = await createTentativeSchedules(body);
      if (result.error) {
        return json(400, { success: false, ...result });
      }
      return json(200, { success: true, ids: result.ids });
    }

    if (action === "update") {
      const result = await updateTentativeSchedule(body);
      if (result.error) {
        return json(400, { success: false, ...result });
      }
      return json(200, { success: true, ids: result.ids });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    console.error("[instructor-slot-booking] Unhandled error:", err);
    return json(500, { error: "Internal server error" });
  } finally {
    console.log(
      `[instructor-slot-booking] ${req.method} ${Date.now() - startedAt}ms`,
    );
  }
});
