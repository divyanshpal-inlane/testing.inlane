# Proposed DB change: `REPLICA IDENTITY FULL` on `Schedule`

**Status:** Awaiting your approval. Not run. No DB changes have been made.

## What's broken today

Realtime sync (Sales Dashboard ↔ Instructor Management) works for
**inserts and updates**, but **not deletes**. I confirmed this live: I
subscribed to `postgres_changes` on `Schedule`, inserted a test row, then
deleted it. The delete event arrived, but its payload was just:

```json
{ "id": 66187 }
```

No `instructor_id`, no `date`, no `status` — nothing else from the row.
That's Postgres's default behavior (`REPLICA IDENTITY DEFAULT`): a DELETE's
replication event only ever carries the table's primary key, not the rest
of the row. This isn't something client-side code can work around — the
row's other columns are simply never written to the WAL for a delete, so
the data was never there for the subscriber to receive in the first place.

**Concretely, this means:** deleting a tentative slot in Instructor
Management does not currently reach the Sales Dashboard as a live update.
The code has a fallback (refresh every currently-loaded instructor when the
affected one can't be identified) so it isn't a complete dead end, but it's
a workaround, not a real fix — and it doesn't help
`InstructorSchedulePage`'s own filtered subscription at all, since a
server-side filter on `instructor_id` can't even be evaluated against a
delete event that never had `instructor_id` in the WAL to begin with.

## The proposed fix

```sql
ALTER TABLE "Schedule" REPLICA IDENTITY FULL;
```

This tells Postgres to include the **entire old row** (not just the primary
key) in the replication stream for updates and deletes on this table going
forward.

## What this does and doesn't affect

- **No data changes.** This doesn't touch any existing rows, columns,
  constraints, or indexes. It's a replication-behavior setting, not a
  schema change to the table's structure.
- **No effect on any other module's reads or writes.** Every existing
  query, insert, update, and delete against `Schedule` keeps working
  exactly as it does today.
- **Minor, ongoing cost:** slightly larger WAL (replication log) entries
  for every future UPDATE/DELETE on this table, since the full old row is
  now recorded instead of just the primary key. For this table's size and
  write volume, this is not expected to be noticeable — it only affects the
  replication stream's payload size, not query performance.
- **Reversible.** `ALTER TABLE "Schedule" REPLICA IDENTITY DEFAULT;` undoes
  it at any time, with no lasting effect either way.
- **Locking:** takes a brief `ACCESS EXCLUSIVE` lock on the table for the
  instant the setting is changed (this one specifically is a stronger lock
  than the publication change from earlier, since it's altering a table
  property rather than publication metadata) — expected to complete
  near-instantly, but unlike the publication change, this one could
  theoretically stall briefly behind any very long-running transaction
  already touching this table. Running it at a quiet moment is the safe
  default.

## Once approved

After running the SQL above, no code changes are needed — the existing
subscriptions in `useSalesData.ts` and `instructors.tsx` will start
receiving full row data on deletes automatically, and the current
fallback/unfiltered-invalidate workarounds become unnecessary (though
harmless to leave in place; they'd just rarely trigger since deletes will
resolve to a real `instructor_id` after this change).
