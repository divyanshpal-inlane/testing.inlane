// Offline PostgreSQL regression test; uses the same optional PGLITE_MODULE as
// recover-missing-requests.test.mjs. Never connects to a Supabase project.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pathToFileURL } from "node:url";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261006010000_normalize_scheduling_learner_rls.sql",
    import.meta.url,
  ),
  "utf8",
);

const phoneFormats = [
  "9876543210",
  "919876543210",
  "+919876543210",
  "09876543210",
  "+91 98765-43210",
];
const ownerIds = phoneFormats.map(
  (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`,
);
const otherId = "00000000-0000-4000-8000-000000000009";

function permissionDenied(error) {
  return error.code === "42501";
}

test(
  "scheduling RLS accepts phone formats without granting another learner access",
  { skip: !process.env.PGLITE_MODULE },
  async () => {
    const { PGlite } = await import(
      pathToFileURL(process.env.PGLITE_MODULE).href
    );
    const db = new PGlite();
    const login = async (phone, role = "authenticated") => {
      await db.exec(`RESET ROLE; SET ROLE ${role};`);
      await db.query("SELECT set_config('request.jwt.claims', $1, false)", [
        JSON.stringify(phone === undefined ? {} : { phone }),
      ]);
    };
    try {
      await db.exec(`
        CREATE ROLE authenticated;
        CREATE ROLE anon;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
          SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb;
        $$;
        GRANT USAGE ON SCHEMA auth TO authenticated, anon;
        CREATE TABLE public."Learner" (id uuid PRIMARY KEY, phone text);
        CREATE TABLE public."Admin" (phone text PRIMARY KEY);
        CREATE TABLE public.reschedule_requests (
          id serial PRIMARY KEY, learner_id uuid REFERENCES public."Learner",
          lesson_ids text[] DEFAULT ARRAY['virtual-lesson-1'], amount numeric DEFAULT 0
        );
        CREATE TABLE public.schedule_preferences (
          id serial PRIMARY KEY, learner_id uuid REFERENCES public."Learner",
          day_of_week smallint DEFAULT 0, time_slot text DEFAULT '6-9',
          UNIQUE (learner_id, day_of_week, time_slot)
        );
        GRANT SELECT ON public."Learner", public."Admin" TO authenticated, anon;
        GRANT ALL ON public.reschedule_requests, public.schedule_preferences TO authenticated, anon;
        GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated, anon;
        ALTER TABLE public.reschedule_requests ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.schedule_preferences ENABLE ROW LEVEL SECURITY;
        INSERT INTO public."Admin" VALUES ('911234567890');
      `);
      // Reproduce the original exact-phone rules, including unchanged admin access.
      for (const table of ["reschedule_requests", "schedule_preferences"]) {
        const label =
          table === "reschedule_requests"
            ? "reschedule requests"
            : "preferences";
        const owner = `learner_id IN (SELECT id FROM public."Learner" WHERE phone = auth.jwt()->>'phone')`;
        await db.exec(`
          CREATE POLICY "Users can view their own ${label}" ON public.${table}
            FOR SELECT USING (${owner});
          CREATE POLICY "Users can ${table === "reschedule_requests" ? "create" : "insert"} their own ${label}" ON public.${table}
            FOR INSERT WITH CHECK (${owner});
          CREATE POLICY "Users can update their own ${label}" ON public.${table}
            FOR UPDATE USING (${owner}) WITH CHECK (${owner});
          CREATE POLICY "Admins can manage all ${label}" ON public.${table}
            FOR ALL USING (EXISTS (SELECT 1 FROM public."Admin" WHERE phone = auth.jwt()->>'phone'));
        `);
        if (table === "schedule_preferences") {
          await db.exec(`CREATE POLICY "Users can delete their own preferences"
            ON public.schedule_preferences FOR DELETE USING (${owner});`);
        }
      }
      const baselinePhones = [...phoneFormats, "8765432109", "", "123", null];
      const baselineIds = [
        ...ownerIds,
        otherId,
        "00000000-0000-4000-8000-000000000010",
        "00000000-0000-4000-8000-000000000011",
        "00000000-0000-4000-8000-000000000012",
      ];
      for (let i = 0; i < baselineIds.length; i++) {
        await db.query('INSERT INTO public."Learner" VALUES ($1, $2)', [
          baselineIds[i],
          baselinePhones[i],
        ]);
        for (const table of ["reschedule_requests", "schedule_preferences"]) {
          await db.query(
            `INSERT INTO public.${table} (learner_id) VALUES ($1)`,
            [baselineIds[i]],
          );
        }
      }
      const readPhones = () =>
        db.query('SELECT id, phone FROM public."Learner" ORDER BY id');
      const before = (await readPhones()).rows;
      await login("919876543210");
      // Supabase JWT has the country code; this row has only 10 digits.
      await assert.rejects(
        db.query(
          "INSERT INTO public.reschedule_requests (learner_id) VALUES ($1)",
          [ownerIds[0]],
        ),
        permissionDenied,
      );
      await db.exec("RESET ROLE");
      await db.exec(migration);
      await db.exec(migration); // safe for a repeated manual deployment
      assert.deepEqual((await readPhones()).rows, before); // no profile rewrites

      for (const phone of phoneFormats) {
        await login(phone);
        for (const table of ["reschedule_requests", "schedule_preferences"]) {
          const { rows } = await db.query(
            `SELECT learner_id FROM public.${table} ORDER BY learner_id`,
          );
          assert.deepEqual(
            [...new Set(rows.map((row) => row.learner_id))],
            ownerIds,
          );
          await assert.rejects(
            db.query(`INSERT INTO public.${table} (learner_id) VALUES ($1)`, [
              otherId,
            ]),
            permissionDenied,
          );
          await assert.rejects(
            db.query(
              `UPDATE public.${table} SET learner_id = $1 WHERE learner_id = $2`,
              [otherId, ownerIds[0]],
            ),
            permissionDenied,
          );
        }
        // The actual Save sequence: replace timings, then refresh a pending request.
        for (const id of ownerIds) {
          const removed = await db.query(
            "DELETE FROM public.schedule_preferences WHERE learner_id = $1 RETURNING id",
            [id],
          );
          assert.ok(removed.rows.length > 0);
          await db.query(
            "INSERT INTO public.schedule_preferences (learner_id, day_of_week, time_slot) VALUES ($1, 0, '6-9'), ($1, 1, '6-9')",
            [id],
          );
          const updated = await db.query(
            "UPDATE public.reschedule_requests SET lesson_ids = ARRAY['virtual-lesson-1', 'virtual-lesson-2'] WHERE learner_id = $1 RETURNING lesson_ids",
            [id],
          );
          assert.deepEqual(updated.rows[0].lesson_ids, [
            "virtual-lesson-1",
            "virtual-lesson-2",
          ]);
        }
        // A new request can also be inserted and read back by the owner.
        const inserted = await db.query(
          "INSERT INTO public.reschedule_requests (learner_id) VALUES ($1) RETURNING id",
          [ownerIds[0]],
        );
        assert.equal(inserted.rows.length, 1);
      }
      // Missing, blank, malformed, and non-matching trusted JWT phones grant nothing.
      for (const phone of [
        undefined,
        null,
        "",
        "123",
        "+91 ---",
        "1111111111",
      ]) {
        await login(phone);
        assert.deepEqual(
          (
            await db.query(
              "SELECT public.current_scheduling_learner_ids() AS id",
            )
          ).rows,
          [],
        );
        for (const table of ["reschedule_requests", "schedule_preferences"]) {
          assert.deepEqual(
            (await db.query(`SELECT id FROM public.${table}`)).rows,
            [],
          );
          await assert.rejects(
            db.query(`INSERT INTO public.${table} (learner_id) VALUES ($1)`, [
              ownerIds[0],
            ]),
            permissionDenied,
          );
        }
      }
      await login(undefined, "anon");
      for (const table of ["reschedule_requests", "schedule_preferences"]) {
        assert.deepEqual(
          (await db.query(`SELECT id FROM public.${table}`)).rows,
          [],
        );
        await assert.rejects(
          db.query(`INSERT INTO public.${table} (learner_id) VALUES ($1)`, [
            ownerIds[0],
          ]),
          permissionDenied,
        );
      }
      await login("911234567890"); // existing admin policy, not learner ownership
      for (const table of ["reschedule_requests", "schedule_preferences"]) {
        assert.ok(
          (
            await db.query(
              `SELECT id FROM public.${table} WHERE learner_id = $1`,
              [otherId],
            )
          ).rows.length > 0,
        );
      }
    } finally {
      await db.close();
    }
  },
);
