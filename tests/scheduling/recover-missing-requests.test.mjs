// Optional offline PostgreSQL test; PGlite can be installed OUTSIDE the repo:
// npm install --prefix /tmp/inlane-scheduling-sql-test --ignore-scripts @electric-sql/pglite
// PGLITE_MODULE=/tmp/inlane-scheduling-sql-test/node_modules/@electric-sql/pglite/dist/index.js node --test tests/scheduling/recover-missing-requests.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pathToFileURL } from "node:url";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261006000000_recover_missing_new_scheduling_requests.sql",
    import.meta.url,
  ),
  "utf8",
);

test(
  "recovery only queues ready, paid, unscheduled learners and is idempotent",
  { skip: !process.env.PGLITE_MODULE },
  async () => {
    const { PGlite } = await import(
      pathToFileURL(process.env.PGLITE_MODULE).href
    );
    const db = new PGlite();
    try {
      await db.exec(`
      CREATE TABLE "Learner" (id text PRIMARY KEY, onboarding_completed boolean,
        address_lat numeric, address_lng numeric, preferred_start_date date);
      CREATE TABLE enrollment (id text PRIMARY KEY, learner_id text, status text,
        course_id text, created_at timestamptz, case_type text, payment_status text,
        payment_id text, progress jsonb);
      CREATE TABLE payment (id text PRIMARY KEY, learner_id text, status text, payment_type text);
      CREATE TABLE schedule_preferences (learner_id text);
      CREATE TABLE "Courses" (id text PRIMARY KEY, total_lessons bigint);
      CREATE TABLE "Lesson" (id text PRIMARY KEY, course_id text, number bigint);
      CREATE TABLE "Schedule" (learner_id text, course_id text, status text, created_at timestamptz);
      CREATE TABLE reschedule_requests (learner_id text, type text, status text,
        lesson_ids text[], amount numeric, payment_id text, created_at timestamptz DEFAULT now());
      INSERT INTO "Courses" VALUES ('course', 2);
      INSERT INTO "Lesson" VALUES ('lesson-1','course',1), ('lesson-1-duplicate','course',1), ('lesson-2','course',2), ('extra-lesson','course',3);
    `);
      const ids = [
        "ready",
        "custom",
        "demo",
        "incomplete",
        "no-address",
        "no-start",
        "no-slots",
        "unpaid",
        "rto",
        "pending",
        "pending-payment",
        "scheduled",
        "fulfilled",
        "demo-upgrade",
        "old-request",
      ];
      for (const id of ids) {
        await db.query(`INSERT INTO "Learner" VALUES ($1, $2, $3, 77, $4)`, [
          id,
          id !== "incomplete",
          id === "no-address" ? null : 12,
          id === "no-start" ? null : "2026-10-07",
        ]);
        await db.query(
          `INSERT INTO enrollment VALUES ($1, $1, 'active', $2, '2026-10-06', $3, $4, $5, $6::jsonb)`,
          [
            id,
            ["custom", "demo"].includes(id) ? null : "course",
            id === "rto" ? "rto_only" : "classes_only",
            id === "unpaid" ? "unpaid" : "half_paid",
            `payment-${id}`,
            JSON.stringify({
              type: ["custom", "demo"].includes(id) ? id : "course",
              total_hours: id === "custom" ? 6 : 1,
            }),
          ],
        );
        if (id !== "no-slots")
          await db.query(`INSERT INTO schedule_preferences VALUES ($1)`, [id]);
      }
      await db.exec(`
      INSERT INTO payment VALUES ('old-demo', 'custom', 'upgraded', 'demo');
      INSERT INTO "Schedule" VALUES ('demo-upgrade', null, 'COMPLETED', now());
      INSERT INTO "Schedule" VALUES ('scheduled', 'course', 'BOOKED', now());
      INSERT INTO reschedule_requests (learner_id, type, status, lesson_ids) VALUES
        ('pending', 'new', 'pending', ARRAY['lesson-1']),
        ('pending-payment', 'new', 'pending_payment', ARRAY['lesson-1']),
        ('fulfilled', 'new', 'completed', ARRAY['lesson-1']);
      INSERT INTO reschedule_requests (learner_id, type, status, lesson_ids, created_at)
        VALUES ('old-request', 'new', 'completed', ARRAY['lesson-1'], '2026-09-01');
    `);
      await db.exec(migration);
      const { rows } = await db.query(
        `SELECT learner_id, lesson_ids, payment_id FROM reschedule_requests WHERE status = 'pending' ORDER BY learner_id`,
      );
      assert.deepEqual(
        rows.map((r) => r.learner_id),
        ["custom", "demo", "demo-upgrade", "old-request", "pending", "ready"],
      );
      const custom = rows.find((r) => r.learner_id === "custom");
      assert.equal(custom.lesson_ids.length, 5); // all six hours minus one demo, not half-paid unlocks
      assert.equal(custom.payment_id, "payment-custom");
      assert.deepEqual(rows.find((r) => r.learner_id === "ready").lesson_ids, [
        "lesson-1",
        "lesson-2",
      ]);
      assert.deepEqual(rows.find((r) => r.learner_id === "demo").lesson_ids, [
        "virtual-lesson-1",
      ]);
      await db.exec(migration);
      const { rows: repeated } = await db.query(
        `SELECT count(*)::int AS total FROM reschedule_requests`,
      );
      assert.equal(repeated[0].total, 9); // four originals + five repairs; no duplicates
    } finally {
      await db.close();
    }
  },
);
