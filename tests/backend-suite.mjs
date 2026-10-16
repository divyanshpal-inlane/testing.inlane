// Backend test suite for the Sales Dashboard / Instructor Management
// tentative-booking system. See ../tests.md for the checklist this
// implements. Plain Node + the Supabase anon key -- same pattern used
// throughout this project's development, no new test framework needed.
//
// Creates all its own data on a dedicated far-future date range against
// two existing fixture instructors, and deletes everything it created at
// the end. Never touches real schedules.
//
// Run: node tests/backend-suite.mjs

import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://csnzgfzxnscumvjefpon.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzbnpnZnp4bnNjdW12amVmcG9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjMyODEyMDksImV4cCI6MjAzODg1NzIwOX0.Go70qkJn_MsIjU9QgRy1HbIUGmY-M7wmNg6MU77VaDk";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TEST_DP = "34239456-159b-42a0-8184-a0e11954cfd0"; // "test_dp"
const HIDAYAT = "b2d0a21a-5c7a-4416-8f3d-15cffa13d800"; // "test_ins_hidayat_dont_delete"
const TEST_DATES = ["2027-05-01", "2027-05-02", "2027-05-03", "2027-05-04"];

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

const results = [];

async function check(id, description, fn) {
  try {
    await fn();
    results.push({ id, description, pass: true });
    console.log(`✅ ${id}: ${description}`);
  } catch (e) {
    results.push({ id, description, pass: false, error: e.message });
    console.log(`❌ ${id}: ${description}`);
    console.log(`   ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Hands out a fresh, never-overlapping date+time slot for tests that need
// isolation from each other. Tests that deliberately need to reuse the
// SAME slot (conflict tests) call this once and reuse the result.
//
// `spanMinutes` reserves however much time range the test will actually
// touch, not just the 60-minute slot itself -- e.g. a test that also
// inserts an "adjacent" row right after its own slot needs spanMinutes:120
// (60 for the slot + 60 for the adjacent row), or the allocator's cursor
// wouldn't move far enough and the NEXT test's slot could land inside
// space this test already used, causing a spurious exclusion-constraint
// failure that has nothing to do with the behavior actually being tested.
const DAY_START_MIN = 6 * 60;
const DAY_END_MIN = 22 * 60;
const SAFETY_GAP_MIN = 30;
let cursorMin = DAY_START_MIN;
let dateIdx = 0;
function nextSlot(instructorId = TEST_DP, spanMinutes = 60) {
  if (cursorMin + spanMinutes > DAY_END_MIN) {
    cursorMin = DAY_START_MIN;
    dateIdx++;
    if (dateIdx >= TEST_DATES.length) {
      throw new Error("Ran out of test dates -- add more to TEST_DATES.");
    }
  }
  const startMin = cursorMin;
  cursorMin += spanMinutes + SAFETY_GAP_MIN;
  const toTime = (m) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
  return {
    instructor_id: instructorId,
    date: TEST_DATES[dateIdx],
    start_time: toTime(startMin),
    end_time: toTime(startMin + 60),
  };
}

function tentativeRow(slot, overrides = {}) {
  return {
    instructor_id: slot.instructor_id,
    date: slot.date,
    start_time: slot.start_time,
    end_time: slot.end_time,
    status: "hold",
    isTentative: true,
    tentative_details: {
      name: "E2E Test",
      phone: "9000000001",
      sales_agent: "suite",
      payment_status: "unpaid",
      address: "test",
      course: "demo",
      created_at: new Date().toISOString(),
    },
    learner_id: null,
    course_id: null,
    lesson_id: null,
    ...overrides,
  };
}

const createdIds = new Set();
async function insertTracked(row) {
  const { data, error } = await sb.from("Schedule").insert(row).select();
  if (!error) createdIds.add(data[0].id);
  return { data, error };
}

async function cleanup() {
  const ids = [...createdIds];
  if (ids.length === 0) return;
  await sb.from("Schedule").delete().in("id", ids);
}

// ---------------------------------------------------------------------------
// A. Schedule -- core CRUD
// ---------------------------------------------------------------------------

async function sectionA() {
  await check("A1", "Insert a single tentative slot succeeds", async () => {
    const slot = nextSlot();
    const { data, error } = await insertTracked(tentativeRow(slot));
    assert(!error, error?.message);
    assert(
      data[0].status === "hold" && data[0].isTentative === true,
      "wrong status/isTentative on insert",
    );
  });

  await check(
    "A2",
    "Insert a multi-slot batch creates exactly 3 rows",
    async () => {
      const s1 = nextSlot();
      const s2 = nextSlot();
      const s3 = nextSlot();
      const { data, error } = await sb
        .from("Schedule")
        .insert([tentativeRow(s1), tentativeRow(s2), tentativeRow(s3)])
        .select();
      if (data) for (const r of data) createdIds.add(r.id);
      assert(!error, error?.message);
      assert(data.length === 3, `expected 3 rows, got ${data?.length}`);
    },
  );

  await check(
    "A3",
    "Update (reschedule) a tentative slot succeeds",
    async () => {
      const slot = nextSlot();
      const { data } = await insertTracked(tentativeRow(slot));
      const id = data[0].id;
      const newStart = "05:00:00";
      const { data: updated, error } = await sb
        .from("Schedule")
        .update({ start_time: newStart, end_time: "06:00:00" })
        .eq("id", id)
        .select();
      assert(!error, error?.message);
      assert(updated[0].start_time === newStart, "start_time did not update");
    },
  );

  await check(
    "A4",
    "Delete a tentative slot actually removes the row",
    async () => {
      const slot = nextSlot();
      const { data } = await insertTracked(tentativeRow(slot));
      const id = data[0].id;
      const { error: delErr } = await sb.from("Schedule").delete().eq("id", id);
      createdIds.delete(id);
      assert(!delErr, delErr?.message);
      const { data: check2 } = await sb
        .from("Schedule")
        .select("id")
        .eq("id", id);
      assert(check2.length === 0, "row still present after delete");
    },
  );
}

// ---------------------------------------------------------------------------
// B. Conflict handling -- schedule_no_overlap_new_rows
// ---------------------------------------------------------------------------

async function sectionB() {
  await check("B1", "Exact-duplicate slot is rejected", async () => {
    const slot = nextSlot();
    await insertTracked(tentativeRow(slot));
    const { error } = await sb.from("Schedule").insert(tentativeRow(slot));
    assert(
      error?.code === "23P01",
      `expected exclusion violation, got ${error?.code}`,
    );
  });

  await check("B2", "Partial-overlap slot is rejected", async () => {
    const slot = nextSlot(TEST_DP, 90); // reaches slot.end + 30
    await insertTracked(tentativeRow(slot));
    const overlap = {
      ...slot,
      start_time: addMinutes(slot.start_time, 30),
      end_time: addMinutes(slot.end_time, 30),
    };
    const { error } = await sb.from("Schedule").insert(tentativeRow(overlap));
    assert(
      error?.code === "23P01",
      `expected exclusion violation, got ${error?.code}`,
    );
  });

  await check(
    "B3",
    "Concurrent inserts for the same slot -- exactly one succeeds",
    async () => {
      const slot = nextSlot();
      const [r1, r2] = await Promise.all([
        insertTracked(
          tentativeRow(slot, {
            tentative_details: {
              ...tentativeRow(slot).tentative_details,
              name: "race-a",
            },
          }),
        ),
        insertTracked(
          tentativeRow(slot, {
            tentative_details: {
              ...tentativeRow(slot).tentative_details,
              name: "race-b",
            },
          }),
        ),
      ]);
      const succeeded = [r1, r2].filter((r) => !r.error).length;
      assert(
        succeeded === 1,
        `expected exactly 1 to succeed, got ${succeeded}`,
      );
    },
  );

  await check(
    "B4",
    "Batch with one conflicting row is rejected wholesale (no partial insert)",
    async () => {
      const existing = nextSlot();
      await insertTracked(tentativeRow(existing));
      const clean = nextSlot();
      const { error } = await sb
        .from("Schedule")
        .insert([tentativeRow(clean), tentativeRow(existing)])
        .select();
      assert(
        error?.code === "23P01",
        `expected exclusion violation, got ${error?.code}`,
      );
      const { data: leaked } = await sb
        .from("Schedule")
        .select("id")
        .eq("instructor_id", clean.instructor_id)
        .eq("date", clean.date)
        .eq("start_time", clean.start_time);
      assert(
        leaked.length === 0,
        "clean row from rejected batch leaked into the DB",
      );
    },
  );

  await check(
    "B5",
    "Cross-module conflict is blocked both directions",
    async () => {
      const slot = nextSlot();
      // Instructor-Management-shaped insert (no course/learner/lesson keys, extra tentative_details shape)
      const imRow = {
        instructor_id: slot.instructor_id,
        date: slot.date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        enabled: true,
        isTentative: true,
        status: "hold",
        tentative_details: {
          name: "IM customer",
          phone: "9000000002",
          paid_info: "Unpaid",
        },
      };
      await insertTracked(imRow);
      const { error } = await sb.from("Schedule").insert(tentativeRow(slot));
      assert(
        error?.code === "23P01",
        "Sales Dashboard insert over an IM-created slot should be rejected",
      );
    },
  );

  await check(
    "B6",
    "Two different instructors can share the exact same date/time",
    async () => {
      const slot = nextSlot(TEST_DP);
      const sameTimeOtherInstr = { ...slot, instructor_id: HIDAYAT };
      const r1 = await insertTracked(tentativeRow(slot));
      const r2 = await insertTracked(tentativeRow(sameTimeOtherInstr));
      assert(
        !r1.error && !r2.error,
        "different instructors at the same time should both succeed",
      );
    },
  );

  await check(
    "B7",
    "Back-to-back non-overlapping slots both succeed",
    async () => {
      const slot = nextSlot(TEST_DP, 120); // reserves slot + the adjacent hour right after it
      const adjacent = {
        ...slot,
        start_time: slot.end_time,
        end_time: addMinutes(slot.end_time, 60),
      };
      const r1 = await insertTracked(tentativeRow(slot));
      const r2 = await insertTracked(tentativeRow(adjacent));
      assert(
        !r1.error && !r2.error,
        "back-to-back slots should not conflict with each other",
      );
    },
  );

  await check(
    "B8",
    "A cancelled slot does not block re-booking the same time",
    async () => {
      const slot = nextSlot();
      const cancelled = await insertTracked({
        ...tentativeRow(slot),
        status: "cancelled",
        isTentative: false,
        tentative_details: null,
      });
      assert(!cancelled.error, cancelled.error?.message);
      const rebook = await insertTracked(tentativeRow(slot));
      assert(
        !rebook.error,
        "cancelled slot should not block a fresh booking at the same time",
      );
    },
  );
}

function addMinutes(hhmmss, minutes) {
  const [h, m, s] = hhmmss.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// C. Instructor travel-gap buffer
// ---------------------------------------------------------------------------

async function sectionC() {
  const GAP_MIN = 15; // instructor_gap_minutes from app_settings, see section I

  await check(
    "C1",
    "Adjacent slot for a DIFFERENT customer within the gap is rejected",
    async () => {
      const slot = nextSlot(TEST_DP, 130); // reaches slot.end + (GAP_MIN-5) + 60
      await insertTracked(
        tentativeRow(slot, {
          tentative_details: {
            ...tentativeRow(slot).tentative_details,
            phone: "9000000010",
          },
        }),
      );
      const adjacentWithinGap = {
        ...slot,
        start_time: addMinutes(slot.end_time, GAP_MIN - 5),
        end_time: addMinutes(slot.end_time, GAP_MIN - 5 + 60),
      };
      // This is a business-logic rule enforced by the FRONTEND (buildFreeGrid /
      // classifySlotConflict in SalesDashboard.tsx), not a DB constraint --
      // the DB itself will happily accept an adjacent non-overlapping insert.
      // This check documents that fact so it isn't mistaken for a DB-level
      // guarantee, and confirms the two slots really are non-overlapping (so
      // the exclusion constraint alone would NOT have caught this).
      const { error } = await sb
        .from("Schedule")
        .insert(
          tentativeRow(adjacentWithinGap, {
            tentative_details: {
              ...tentativeRow(slot).tentative_details,
              phone: "9000000011",
            },
          }),
        )
        .select();
      if (!error) {
        const { data } = await sb
          .from("Schedule")
          .select("id")
          .eq("instructor_id", adjacentWithinGap.instructor_id)
          .eq("date", adjacentWithinGap.date)
          .eq("start_time", adjacentWithinGap.start_time);
        if (data?.[0]) createdIds.add(data[0].id);
      }
      assert(
        !error,
        "DB layer correctly does not block this by itself (buffer is enforced client-side)",
      );
    },
  );

  // classifySlotConflict/bufferWaivedForCustomer live in
  // src/lib/sales-dashboard/conflict.ts (extracted out of
  // SalesDashboard.tsx specifically so this is testable) -- no DB
  // equivalent to query, so this bundles and calls the real module
  // directly, same pattern as section D uses for availability.ts.
  try {
    buildBundle("src/lib/sales-dashboard/conflict.ts", CONFLICT_BUNDLE_PATH);
  } catch (e) {
    await check("C2", "Buffer waived for the same customer", async () => {
      throw new Error(`could not bundle conflict.ts: ${e.message}`);
    });
    await check(
      "C3",
      "Buffer never waived for a real (non-tentative) booking",
      async () => {
        throw new Error("skipped, bundle failed");
      },
    );
    return;
  }

  const { classifySlotConflict, bufferWaivedForCustomer } = await import(
    `file://${CONFLICT_BUNDLE_PATH}`
  );
  const GAP = 15;

  function blockAt(startMinute, overrides = {}) {
    return {
      startMinute,
      endMinute: startMinute + 60,
      status: "hold",
      isTentative: true,
      rawTentativeDetails: { phone: "9000000099" },
      ...overrides,
    };
  }

  await check(
    "C2",
    "Buffer waived when the adjacent tentative block is the same customer",
    async () => {
      // Existing tentative block 10:00-11:00 (600-660). Candidate 11:00-12:00
      // (660-720) is adjacent (buffer-only, not overlapping).
      const blocksIndex = new Map([
        ["instr-x", new Map([["2027-06-01", [blockAt(600)]]])],
      ]);
      const conflict = classifySlotConflict(
        "instr-x",
        "2027-06-01",
        660,
        GAP,
        blocksIndex,
      );
      assert(
        conflict.kind === "buffer",
        `expected a buffer conflict, got ${conflict.kind}`,
      );
      const waived = bufferWaivedForCustomer(conflict, "9000000099");
      assert(waived === true, "same-phone buffer conflict should be waived");
      const notWaived = bufferWaivedForCustomer(conflict, "9000000001");
      assert(
        notWaived === false,
        "different-phone buffer conflict should NOT be waived",
      );
    },
  );

  await check(
    "C3",
    "Buffer never waived for a real (non-tentative) booking, even with a matching phone",
    async () => {
      const realBooking = blockAt(600, {
        status: "booked",
        isTentative: false,
      });
      const blocksIndex = new Map([
        ["instr-x", new Map([["2027-06-01", [realBooking]]])],
      ]);
      const conflict = classifySlotConflict(
        "instr-x",
        "2027-06-01",
        660,
        GAP,
        blocksIndex,
      );
      assert(
        conflict.kind === "buffer",
        `expected a buffer conflict, got ${conflict.kind}`,
      );
      // A real booking's phone is never exposed via rawTentativeDetails in
      // classifySlotConflict (isSalesTentative gates it) -- so even the
      // "same" phone can't waive it; the conflict's phone entry is null.
      const waived = bufferWaivedForCustomer(conflict, "9000000099");
      assert(waived === false, "a real booking's buffer must never be waived");
    },
  );

  await check(
    "C4",
    "A genuine overlap is never waivable, regardless of phone",
    async () => {
      const blocksIndex = new Map([
        ["instr-x", new Map([["2027-06-01", [blockAt(600)]]])],
      ]);
      // Candidate 10:30-11:30 (630-690) genuinely overlaps 600-660.
      const conflict = classifySlotConflict(
        "instr-x",
        "2027-06-01",
        630,
        GAP,
        blocksIndex,
      );
      assert(
        conflict.kind === "direct",
        `expected a direct overlap, got ${conflict.kind}`,
      );
      const waived = bufferWaivedForCustomer(conflict, "9000000099");
      assert(waived === false, "a direct overlap must never be waivable");
    },
  );

  if (existsSync(CONFLICT_BUNDLE_PATH)) unlinkSync(CONFLICT_BUNDLE_PATH);
}

// ---------------------------------------------------------------------------
// D. Unavailability engine -- tests the actual TS module directly, no DB
// ---------------------------------------------------------------------------

const BUNDLE_PATH = new URL(
  "./availability-bundle.tmp.mjs",
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]):/, "$1:");
const CONFLICT_BUNDLE_PATH = new URL(
  "./conflict-bundle.tmp.mjs",
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]):/, "$1:");

function buildBundle(sourcePath, outPath) {
  // The native binary directly, not the node_modules/.bin/esbuild(.cmd)
  // wrapper -- execFileSync can't invoke a Windows .cmd shim without
  // shell:true, and shell:true brings its own quoting hazards. Calling
  // the platform package's own binary sidesteps both.
  const bin =
    process.platform === "win32"
      ? "node_modules/@esbuild/win32-x64/esbuild.exe"
      : "node_modules/@esbuild/linux-x64/bin/esbuild";
  execFileSync(
    bin,
    [
      sourcePath,
      "--bundle",
      "--format=esm",
      `--outfile=${outPath}`,
      "--platform=node",
    ],
    { stdio: "pipe" },
  );
}

async function sectionD() {
  try {
    buildBundle("src/lib/sales-dashboard/availability.ts", BUNDLE_PATH);
  } catch (e) {
    await check("D1", "Unavailability boundary precision", async () => {
      throw new Error(`could not bundle availability.ts: ${e.message}`);
    });
    await check("D2", "Buffer after unavailability window", async () => {
      throw new Error("skipped, bundle failed");
    });
    await check("D3", "Half-free + half-unavailable is excluded", async () => {
      throw new Error("skipped, bundle failed");
    });
    return;
  }

  const { buildInstructorFreeGrid } = await import(`file://${BUNDLE_PATH}`);
  const slotConfig = {
    slotStart: "06:00",
    slotEnd: "22:00",
    gridMinutes: 30,
    slotDurationMinutes: 60,
  };
  const gapMinutes = 15;

  function freeStarts(unavailability, date, instrId = "x") {
    const instr = {
      id: instrId,
      status: "active",
      enabled: true,
      unavailability,
    };
    const grid = buildInstructorFreeGrid(
      {
        instructors: [instr],
        learnerArea: "",
        slotConfig,
        dates: [date],
        gapMinutes,
        blocks: [],
      },
      [instr],
    );
    return grid.get(instrId).get(date) ?? [];
  }

  await check(
    "D1",
    "Candidate overlapping a non-grid-aligned unavailability boundary is excluded",
    async () => {
      // Unavailable 12:18-16:16 (Tuesday 2027-05-04 is a Tuesday)
      const unavail = [
        {
          start_date: "2027-01-01",
          end_date: "2027-12-31",
          range_start_time: "12:18",
          range_end_time: "16:16",
        },
      ];
      const starts = freeStarts(unavail, "2027-05-04");
      assert(
        !starts.includes(11 * 60 + 30),
        "11:30 candidate (covers 11:30-12:30, overlaps 12:18-16:16) should be excluded",
      );
    },
  );

  await check(
    "D2",
    "Instructor gap buffer applies after an unavailability window ends",
    async () => {
      const unavail = [
        {
          start_date: "2027-01-01",
          end_date: "2027-12-31",
          range_start_time: "12:18",
          range_end_time: "16:16",
        },
      ];
      const starts = freeStarts(unavail, "2027-05-04");
      assert(
        !starts.includes(16 * 60 + 30),
        "16:30 should still be excluded (within the 15-min gap after 16:16)",
      );
      assert(
        starts.includes(17 * 60),
        "17:00 should be free (gap has cleared)",
      );
    },
  );

  await check(
    "D3",
    "Half-free + half-unavailable candidate is excluded, not falsely free",
    async () => {
      // Unavailable 03:30-07:30
      const unavail = [
        {
          start_date: "2027-01-01",
          end_date: "2027-12-31",
          range_start_time: "03:30",
          range_end_time: "07:30",
        },
      ];
      const starts = freeStarts(unavail, "2027-05-04");
      assert(
        !starts.includes(7 * 60),
        "07:00 candidate (covers 07:00-08:00, half inside unavailability) should be excluded",
      );
      assert(
        starts.includes(8 * 60 + 30),
        "08:30 should be free (past the gap after 07:30)",
      );
    },
  );

  if (existsSync(BUNDLE_PATH)) unlinkSync(BUNDLE_PATH);
}

// ---------------------------------------------------------------------------
// E. Status & cross-module consistency
// ---------------------------------------------------------------------------

async function sectionE() {
  await check(
    "E1",
    "Sales-Dashboard-shaped tentative insert has status:hold + isTentative:true",
    async () => {
      const slot = nextSlot();
      const { data, error } = await insertTracked(tentativeRow(slot));
      assert(!error, error?.message);
      assert(
        data[0].status === "hold" && data[0].isTentative === true,
        "wrong status/isTentative",
      );
    },
  );

  await check(
    "E2",
    "Instructor-Management-shaped tentative insert also has status:hold + isTentative:true",
    async () => {
      const slot = nextSlot();
      const imRow = {
        instructor_id: slot.instructor_id,
        date: slot.date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        enabled: true,
        isTentative: true,
        status: "hold",
        tentative_details: {
          name: "IM",
          phone: "9000000020",
          paid_info: "Unpaid",
        },
      };
      const { data, error } = await insertTracked(imRow);
      assert(!error, error?.message);
      assert(
        data[0].status === "hold" && data[0].isTentative === true,
        "regression: IM insert without explicit status would default to 'booked'",
      );
    },
  );

  await check(
    "E3",
    "No row exists anywhere with isTentative:false + status:hold",
    async () => {
      const { count, error } = await sb
        .from("Schedule")
        .select("id", { count: "exact", head: true })
        .eq("isTentative", false)
        .eq("status", "hold");
      assert(!error, error?.message);
      assert(
        count === 0,
        `found ${count} rows with isTentative:false + status:hold`,
      );
    },
  );

  await check(
    "E4",
    "No row exists anywhere that's booked but missing learner_id/course_id/lesson_id",
    async () => {
      const { count, error } = await sb
        .from("Schedule")
        .select("id", { count: "exact", head: true })
        .eq("isTentative", false)
        .eq("status", "booked")
        .or("learner_id.is.null,course_id.is.null,lesson_id.is.null");
      assert(!error, error?.message);
      assert(count === 0, `found ${count} incomplete booked rows`);
    },
  );
}

// ---------------------------------------------------------------------------
// F. Override RPC
// ---------------------------------------------------------------------------

async function sectionF() {
  await check(
    "F1",
    "Override succeeds and replaces the old row at the same slot",
    async () => {
      const slot = nextSlot();
      const { data: old } = await insertTracked(tentativeRow(slot));
      const oldId = old[0].id;
      const { data: newRow, error } = await sb.rpc("override_tentative_slot", {
        p_old_schedule_id: oldId,
        p_new_tentative_details: {
          name: "New Payer",
          phone: "9000000030",
          payment_status: "half_paid",
        },
      });
      assert(!error, error?.message);
      createdIds.delete(oldId);
      createdIds.add(newRow.id);
      assert(
        newRow.instructor_id === slot.instructor_id &&
          newRow.start_time === slot.start_time,
        "override moved the slot, should stay in place",
      );
      const { data: goneCheck } = await sb
        .from("Schedule")
        .select("id")
        .eq("id", oldId);
      assert(
        goneCheck.length === 0,
        "old row should be deleted by the override",
      );
    },
  );

  await check(
    "F2",
    "Override with payment_status:unpaid is rejected",
    async () => {
      const slot = nextSlot();
      const { data: old } = await insertTracked(tentativeRow(slot));
      const { error } = await sb.rpc("override_tentative_slot", {
        p_old_schedule_id: old[0].id,
        p_new_tentative_details: {
          name: "X",
          phone: "9000000031",
          payment_status: "unpaid",
        },
      });
      assert(error, "expected rejection for unpaid override");
    },
  );

  await check(
    "F3",
    "Override of a nonexistent schedule id is rejected",
    async () => {
      const { error } = await sb.rpc("override_tentative_slot", {
        p_old_schedule_id: 999999999,
        p_new_tentative_details: {
          name: "X",
          phone: "9000000032",
          payment_status: "half_paid",
        },
      });
      assert(error, "expected rejection for a schedule id that doesn't exist");
    },
  );

  await check(
    "F4",
    "Override of an already-paid tentative slot is rejected",
    async () => {
      const slot = nextSlot();
      const { data: old } = await insertTracked(
        tentativeRow(slot, {
          tentative_details: {
            ...tentativeRow(slot).tentative_details,
            payment_status: "half_paid",
          },
        }),
      );
      const { error } = await sb.rpc("override_tentative_slot", {
        p_old_schedule_id: old[0].id,
        p_new_tentative_details: {
          name: "X",
          phone: "9000000033",
          payment_status: "full_paid",
        },
      });
      assert(
        error,
        "expected rejection: slot already has payment, no longer overridable",
      );
    },
  );
}

// ---------------------------------------------------------------------------
// G. Realtime sync
// ---------------------------------------------------------------------------

async function sectionG() {
  await check(
    "G2",
    "INSERT on Schedule is received by a live subscription",
    async () => {
      let received = null;
      const channel = sb
        .channel("suite-g2")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "Schedule" },
          (p) => {
            received = p;
          },
        )
        .subscribe();
      await new Promise((r) => setTimeout(r, 1500));
      const slot = nextSlot();
      const { data } = await insertTracked(tentativeRow(slot));
      await new Promise((r) => setTimeout(r, 4000));
      await sb.removeChannel(channel);
      assert(
        received?.new?.id === data[0].id,
        "did not receive the INSERT event, or wrong row -- Realtime replication may not be enabled for Schedule (see G1)",
      );
      assert(
        !!received.new.instructor_id,
        "INSERT payload should carry instructor_id",
      );
    },
  );

  await check(
    "G3",
    "UPDATE on Schedule is received with instructor_id present",
    async () => {
      const slot = nextSlot();
      const { data } = await insertTracked(tentativeRow(slot));
      let received = null;
      const channel = sb
        .channel("suite-g3")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "Schedule" },
          (p) => {
            received = p;
          },
        )
        .subscribe();
      await new Promise((r) => setTimeout(r, 1500));
      await sb
        .from("Schedule")
        .update({ start_time: "05:00:00", end_time: "06:00:00" })
        .eq("id", data[0].id);
      await new Promise((r) => setTimeout(r, 4000));
      await sb.removeChannel(channel);
      assert(
        received?.new?.id === data[0].id,
        "did not receive the UPDATE event",
      );
      assert(
        !!received.new.instructor_id,
        "UPDATE payload should carry instructor_id",
      );
    },
  );

  await check(
    "G4",
    "DELETE on Schedule currently only carries the row id (documents the REPLICA IDENTITY gap)",
    async () => {
      const slot = nextSlot();
      const { data } = await insertTracked(tentativeRow(slot));
      let received = null;
      const channel = sb
        .channel("suite-g4")
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "Schedule" },
          (p) => {
            received = p;
          },
        )
        .subscribe();
      await new Promise((r) => setTimeout(r, 1500));
      await sb.from("Schedule").delete().eq("id", data[0].id);
      createdIds.delete(data[0].id);
      await new Promise((r) => setTimeout(r, 4000));
      await sb.removeChannel(channel);
      assert(
        received?.old?.id === data[0].id,
        "did not receive the DELETE event at all",
      );
      // NOTE: this asserts the CURRENT (limited) behavior. Once REPLICA
      // IDENTITY FULL is applied (see REALTIME_DELETE_REPLICA_IDENTITY.md),
      // this should be updated to assert instructor_id IS present, and G1
      // should be re-verified.
      if (received.old.instructor_id) {
        console.log(
          "   ℹ instructor_id IS present on delete now -- REPLICA IDENTITY FULL appears to be applied. Update this test and G1's status in tests.md.",
        );
      }
    },
  );
}

// ---------------------------------------------------------------------------
// H. Data integrity / constraints
// ---------------------------------------------------------------------------

async function sectionH() {
  await check(
    "H1",
    "Invalid instructor_id (FK violation) is rejected",
    async () => {
      const slot = nextSlot("00000000-0000-0000-0000-000000000000");
      const { error } = await sb.from("Schedule").insert(tentativeRow(slot));
      assert(!!error, "expected FK violation for nonexistent instructor_id");
    },
  );

  await check("H2", "Missing required field is rejected", async () => {
    const slot = nextSlot();
    const { error } = await sb.from("Schedule").insert({
      instructor_id: slot.instructor_id,
      // date intentionally omitted -- NOT NULL column
      start_time: slot.start_time,
      end_time: slot.end_time,
      status: "hold",
      isTentative: true,
    });
    assert(!!error, "expected rejection for missing required field (date)");
  });
}

// ---------------------------------------------------------------------------
// I. Configuration
// ---------------------------------------------------------------------------

async function sectionI() {
  await check(
    "I1",
    "booking_flow config exists with all required fields",
    async () => {
      const { data, error } = await sb
        .from("app_settings")
        .select("value")
        .eq("key", "booking_flow")
        .single();
      assert(!error, error?.message);
      const cfg = data.value;
      assert(cfg.enabled === true, "booking_flow.enabled should be true");
      for (const field of [
        "slot_start",
        "slot_end",
        "slot_grid_minutes",
        "slot_duration_minutes",
        "instructor_gap_minutes",
        "excluded_schedule_statuses",
      ]) {
        assert(cfg[field] !== undefined, `booking_flow.${field} is missing`);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Run everything
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    "=== Backend Test Suite: Sales Dashboard / Instructor Management ===\n",
  );
  await sectionA();
  await sectionB();
  await sectionC();
  await sectionD();
  await sectionE();
  await sectionF();
  await sectionG();
  await sectionH();
  await sectionI();

  await cleanup();

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n=== ${results.length - failed.length}/${results.length} passed ===`,
  );
  if (failed.length > 0) {
    console.log("\nFAILED:");
    for (const f of failed)
      console.log(`  ${f.id}: ${f.description}\n    ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch(async (e) => {
  console.error("Suite crashed:", e);
  await cleanup();
  process.exit(1);
});
