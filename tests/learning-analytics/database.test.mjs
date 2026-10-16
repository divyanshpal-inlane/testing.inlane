// PGLITE_MODULE can point to a separately installed disposable test dependency.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
const read = (path) =>
  readFile(new URL("../../" + path, import.meta.url), "utf8");
await db.exec(await read("tests/game-analytics/setup.sql"));
await db.exec(
  "CREATE TABLE public.enrollment(learner_id uuid,course_id uuid);",
);
await db.exec(await read("supabase/migrations/20260908_game_analytics.sql"));
await db.exec(
  await read("supabase/migrations/20260908103119_group_game_analytics.sql"),
);
await db.exec(
  await read("supabase/migrations/20260911050000_learning_analytics.sql"),
);
await db.exec(
  await read("supabase/migrations/20260911050100_learning_content_catalog.sql"),
);
const course = "e129f667-0510-4f07-9847-edb58356dc74";
const learner = "00000000-0000-0000-0000-000000000001";
await db.exec(
  `INSERT INTO public.enrollment VALUES('${learner}','${course}');`,
);
const { rows: catalog } = await db.query(
  `SELECT * FROM learning_content WHERE course_id=$1 AND lesson_number=1 ORDER BY kind`,
  [course],
);
const video = catalog.find((c) => c.kind === "video");
const quiz = catalog.find((c) => c.kind === "quiz");
const as = async (phone) => {
  await db.exec("RESET ROLE");
  await db.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: "00000000-0000-0000-0000-000000000099", phone }),
  ]);
  await db.exec("SET ROLE authenticated");
};
const empty = () => ({
  duration: 0,
  ranges: [],
  active_ms: 0,
  plays: 0,
  pauses: 0,
  seeks: 0,
  errors: 0,
  responses: [],
  finished: false,
});
let sid = 0;
const id = () => `00000000-0000-0000-0001-${String(++sid).padStart(12, "0")}`;
const save = (session, seq, snapshot, content = video.content_id) =>
  db.query("SELECT record_learning_session($1,$2,1,$3,$4,$5)", [
    session,
    course,
    content,
    seq,
    JSON.stringify(snapshot),
  ]);
const report = async (search = "", activity = "all", page = 0) =>
  (
    await db.query(
      "SELECT get_learning_analytics($1,$2,NULL,NULL,$3) AS report",
      [search, activity, page],
    )
  ).rows[0].report;
const attempt = async (sessionContent) =>
  (
    await db.query("SELECT get_learning_attempts($1,$2,1,$3,0) AS report", [
      learner,
      course,
      sessionContent,
    ])
  ).rows[0].report;
// Catch expected SQL errors within savepoints because fixture setup opens a transaction.
async function rejects(operation) {
  await db.exec("SAVEPOINT expected_error");
  let threw = false;
  try {
    await operation();
  } catch {
    threw = true;
    await db.exec("ROLLBACK TO SAVEPOINT expected_error");
  }
  await db.exec("RELEASE SAVEPOINT expected_error");
  assert.ok(threw, "operation must be rejected");
}

test("permission checks reject anonymous, learners reporting and direct writes", async () => {
  await as("7878676756");
  await rejects(() => report());
  await rejects(() => db.exec("SELECT * FROM learning_sessions"));
  await rejects(() => db.exec("SELECT * FROM learning_content"));
  await db.exec("RESET ROLE; SET ROLE anon");
  await rejects(() => save(id(), 1, empty()));
});
test("repeated and out-of-order snapshots do not inflate sessions; seeking does not complete", async () => {
  await as("7878676756");
  const session = id();
  const s = {
    ...empty(),
    duration: 100,
    ranges: [
      [0, 10],
      [95, 100],
    ],
    plays: 1,
    active_ms: 15000,
  };
  await save(session, 1, s);
  await save(session, 1, s);
  await save(session, 2, { ...s, plays: 2 });
  await save(session, 1, s);
  await as("1111111111");
  const data = await attempt(video.content_id);
  assert.equal(data.total_rows, 1);
  assert.equal(data.rows[0].snapshot.plays, 2);
  assert.equal(Number(data.rows[0].coverage), 0.15);
  assert.equal(data.rows[0].completed, false);
});
test("video coverage accumulates unique segments across repeat visits", async () => {
  await as("7878676756");
  await save(id(), 1, {
    ...empty(),
    duration: 100,
    ranges: [[10, 95]],
    plays: 1,
    active_ms: 85000,
  });
  await as("1111111111");
  const data = await report();
  const row = data.rows.find((r) => r.learner_id === learner);
  const item = row.items.find((i) => i.content_id === video.content_id);
  assert.equal(Number(item.coverage), 1);
  assert.equal(item.completed_sessions, 0);
  assert.equal(row.videos_completed, 1);
  assert.ok(row.videos_total >= 2);
});
test("quiz retries, timeout and first-try accuracy are graded against server catalog", async () => {
  await as("7878676756");
  const session = id();
  const responses = quiz.questions.flatMap((q, i) =>
    i === 0
      ? [
          {
            question_id: q.id,
            selected: q.answers.find((a) => a !== q.correct),
            elapsed_ms: 2000,
          },
          { question_id: q.id, selected: q.correct, elapsed_ms: 4000 },
        ]
      : [
          {
            question_id: q.id,
            selected: i === 1 ? null : q.correct,
            elapsed_ms: 15000,
          },
        ],
  );
  await save(
    session,
    1,
    { ...empty(), responses: responses.slice(0, 1) },
    quiz.content_id,
  );
  await save(
    session,
    2,
    { ...empty(), responses, finished: true },
    quiz.content_id,
  );
  await save(
    session,
    2,
    { ...empty(), responses, finished: true },
    quiz.content_id,
  );
  await as("1111111111");
  const data = await attempt(quiz.content_id);
  assert.equal(data.total_rows, 1);
  assert.equal(data.rows[0].wrong, 1);
  assert.equal(data.rows[0].timeouts, 1);
  assert.equal(data.rows[0].correct, quiz.questions.length - 1);
  assert.equal(data.rows[0].completed, true);
  assert.equal(data.rows[0].responses[0].correct, false);
  const row = (await report()).rows.find((r) => r.learner_id === learner);
  assert.equal(row.first_total, quiz.questions.length);
  assert.equal(row.first_correct, quiz.questions.length - 2);
  await as("7878676756");
  await rejects(() =>
    save(session, 3, { ...empty(), responses: [] }, quiz.content_id),
  );
});
test("forged answers, completion, malformed ranges and cross-learner sessions are rejected", async () => {
  await as("7878676756");
  await rejects(() =>
    save(id(), 1, {
      ...empty(),
      duration: 10,
      ranges: [
        [0, 8],
        [4, 9],
      ],
    }),
  );
  await rejects(() =>
    save(
      id(),
      1,
      {
        ...empty(),
        responses: [
          {
            question_id: quiz.questions[0].id,
            selected: "forged",
            elapsed_ms: 1,
          },
        ],
      },
      quiz.content_id,
    ),
  );
  const session = id();
  await save(session, 1, { ...empty(), finished: true }, quiz.content_id);
  await as("1111111111");
  assert.equal(
    (await attempt(quiz.content_id)).rows.find((s) => s.id === session)
      .completed,
    false,
  );
  await as("9999999999");
  await rejects(() => save(id(), 1, empty()));
  await db.exec("RESET ROLE");
  await db.exec(
    `INSERT INTO enrollment VALUES('00000000-0000-0000-0000-000000000002','${course}')`,
  );
  await as("9999999999");
  await rejects(() => save(session, 4, empty(), quiz.content_id));
});
test("report masks phones, limits phone search, includes zero-activity learners and filters", async () => {
  await as("2222222222");
  let data = await report();
  assert.equal(
    data.rows.find((r) => r.learner_id === learner).phone,
    "******6756",
  );
  assert.equal((await report("7878676756")).total_rows, 0);
  assert.equal((await report("Other", "unrecorded")).total_rows, 1);
  assert.equal((await report("Test", "active")).total_rows, 1);
  assert.equal((await report("Test", "complete")).total_rows, 0);
  await rejects(() => report("", "bad"));
  await rejects(() => report("", "all", -1));
});
test("learner pagination and game-launch report remain compatible", async () => {
  await db.exec("RESET ROLE");
  await db.exec(
    `INSERT INTO "Learner" SELECT ('00000000-0000-0000-0002-'||lpad(n::text,12,'0'))::uuid, '555555'||lpad(n::text,4,'0'), 'Extra '||n FROM generate_series(1,55) n`,
  );
  await as("1111111111");
  assert.equal((await report()).rows.length, 50);
  assert.equal((await report("", "all", 1)).rows.length, 7);
  const old = (
    await db.query("SELECT get_game_analytics_by_learner() AS report")
  ).rows[0].report;
  assert.equal(old.total_rows, 57);
});
test("team member permission precedence applies to learning reports", async () => {
  await db.exec("RESET ROLE");
  await db.exec(
    `INSERT INTO "User" VALUES('00000000-0000-0000-0000-000000000020','1111111111')`,
  );
  await as("1111111111");
  await rejects(() => report());
  await rejects(() => attempt(video.content_id));
});
test.after(async () => {
  await db.exec("ROLLBACK");
  await db.close();
});
