# Lesson learning analytics

Admin → Game Analytics → Videos & quizzes now reports the learner's configured video and quiz content across their enrolled courses. Game Club opening counts remain in a separate section on the same page.

## What is measured

- Video coverage: union of played timeline segments across visits, with a 90% completion threshold. Replaying the same segment does not increase unique coverage. Seeking, buffering, hidden tabs and suspended clocks do not add watch coverage. Playback at different speeds is supported.
- Viewing sessions: separate player visits (and replay after ending); play/resume, pause, seek and playback-error counts; foreground playback time; per-session completion and first/latest timestamps. Clicking pause/resume does not start another viewing session.
- Quizzes: opened attempts, finished attempts, right and wrong answers, timeouts, first-try accuracy, visible time and every answer/retry in order, with the question and correct answer. Completion means every question has been resolved by a correct answer or timeout and the learner pressed Finish; it does not mean a perfect score.
- First-try accuracy is the proportion of questions whose first response within each attempt was correct. First-response timeouts are included in its denominator. Correct and wrong totals count submissions, including retries.
- Learners/content with no recorded activity remain visible. Course, lesson, progress and learner-search filters apply to all displayed totals. Reports paginate 50 learners and drill-downs paginate 20 attempts.

The three new S3 videos are included: Public Relations (Lesson 1), U-turn (Lesson 7), and First Aid (Lesson 10).

## Deployment

This feature was built from `origin/main` in branch `codex/lesson-learning-analytics`, preserving the newer question bank and existing game analytics.

Apply these migrations to the same Supabase project used by the frontend, in order, before deploying the frontend:

1. `20260911050000_learning_analytics.sql`
2. `20260911050100_learning_content_catalog.sql`

They depend on the existing `20260908_game_analytics.sql` and `20260908103119_group_game_analytics.sql`. No existing game events are modified. The feature uses the existing `game_analytics` permission and server-enforced phone masking. No new staff access is granted. New tables have RLS and no direct anonymous/authenticated access; writes/reports use restricted RPCs.

No production migrations or deployment are performed by the local build/test workflow.

## Content changes

The server catalog contains the configured videos and canonical quiz answers. IDs are derived from the video URL or quiz content; question IDs survive answer shuffling. The server grades submitted answer text/area IDs against this catalog. It resolves the learner from their signed-in phone and requires enrollment in the submitted course; the client cannot name another learner or set server timestamps.

Run `node scripts/generate-learning-catalog.mjs supabase/migrations/<new-timestamp>_learning_content_catalog.sql` after changing lesson content, then apply that migration alongside the frontend. Do not edit an already-applied migration. Existing catalog versions and sessions remain stored; the report's current-content denominator includes only active catalog entries. Changed question banks start a new content version. Do not replace a video file's contents at the same URL when its version changes: use a new object key.

## Limits

Tracking begins with deployment. It cannot recover historical behavior. The content denominator follows configured courses with an enrollment row, including past enrollments; it does not treat top-up sessions or custom lessons without configured prep content as missing videos.

Telemetry is best effort: cumulative snapshots are saved every five seconds and on answers, player state changes, visibility changes and departure. Failed writes retry while the component remains open. Abrupt browser closure or offline departure can lose unsaved activity; there is no persistent offline queue. No recorded activity is not proof that someone never watched. Visible playback is a playback signal, not proof of attention; a modified client can still falsify video telemetry. Quiz grading is server-side, but this is learning analytics, not a proctored exam.

Game Club apps remain external: confirmed gameplay, external scores and external completion require instrumentation in those apps. This implementation covers lesson videos and both in-app quiz formats, while preserving external launch analytics. It collects no device fingerprint, location or keystroke stream.

## Verification

Run existing trivia and playback model tests:

```sh
node --experimental-strip-types --test tests/lesson-trivia.test.mjs tests/learning-analytics/model.test.mjs
```

Run the database suite in an ephemeral PGlite database (never a live database):

```sh
PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node --test tests/learning-analytics/database.test.mjs
```

The suite applies both analytics migrations and the generated catalog, then tests permissions, learner isolation, server grading, replay/deduplication, invalid payloads, unique coverage, zero activity, masking, filters, pagination and old report compatibility. Test data is rolled back.

Browser test harness uses the real report, quiz and video components with a synthetic RPC adapter, without live accounts:

```sh
node node_modules/vite/bin/vite.js --config tests/learning-analytics/vite.config.ts
```

Open `http://127.0.0.1:5182/tests/learning-analytics/browser.html?view=admin`. The quiz and video test links display the submitted snapshot for inspection. This harness is not routed into the production app.
