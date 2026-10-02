-- TEMP SALES DASHBOARD MONITORING
-- REMOVE BEFORE PRODUCTION
--
-- TEMPORARY table for the pre-ship monitoring of the Sales Dashboard. Every
-- column exists to answer one of the questions in
-- sales_dashboard_temporary_log.md without reading raw logs by hand.
--
-- TO REMOVE:
--   DROP TABLE IF EXISTS public.sales_dashboard_temporary_logs;
--   DROP POLICY IF EXISTS ... (dropped with the table)
--   then delete supabase/src/lib/sales-dashboard/tempMonitoring.ts and the
--   call sites listed in sales_dashboard_temporary_log.md.
--
-- MANUAL APPLY ONLY (repo convention: DDL needs the SQL editor / psql; there
-- is no CI that runs migrations and the raw-SQL RPC is unavailable). Until it
-- is applied the dashboard logs nothing and behaves exactly as before -- the
-- frontend treats "table not found" as "monitoring off".

CREATE TABLE IF NOT EXISTS "public"."sales_dashboard_temporary_logs" (
    -- Client clock at the moment of the event. `received_at` is the server
    -- clock, so a large gap between the two is itself a health signal
    -- (user clock skew, or a laptop waking from sleep mid-session).
    "ts" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One row per dashboard session (a browser tab). Lives in sessionStorage,
    -- so a reload continues the same session and a new tab starts a new one.
    "session_id" TEXT NOT NULL,

    -- Auth identity. `user_id` is the admin/user record id from
    -- useCurrentAdmin()/useCurrentUser(), NOT the Supabase auth uid.
    -- `auth_user_id` is the Supabase auth.users uuid, recorded separately
    -- because that lookup is network-backed and may never resolve (Go service
    -- down) while the session itself is still authenticated.
    "user_id" TEXT,
    "auth_user_id" TEXT,
    "user_name" TEXT,
    "user_role" TEXT,

    -- session | user_action | api | error
    "category" TEXT NOT NULL
        CHECK ("category" IN ('session', 'user_action', 'api', 'error')),
    "event_name" TEXT NOT NULL,
    -- TRUE/FALSE for pass/fail events, NULL for pure observations
    -- (e.g. dashboard_opened).
    "success" BOOLEAN,

    -- Booking context. Nullable: most events are not about one slot.
    "instructor_id" TEXT,
    "slot_date" DATE,
    "slot_start" TIME,
    "slot_end" TIME,
    -- Schedule.id for a created/deleted hold, NULL while it is still pending.
    "booking_id" TEXT,

    "error_code" TEXT,
    "error_message" TEXT,

    -- API/system behaviour.
    "api_name" TEXT,
    "http_method" TEXT,
    "http_status" INTEGER,
    "duration_ms" INTEGER,

    -- Browser/OS/touch/screen/timezone, captured once per session. No IP, no
    -- geolocation, no user agent string.
    "device" JSONB,
    -- Event-specific extras, already redacted client-side (no customer name,
    -- phone, address, tokens or keys ever reach this column).
    "props" JSONB
);

-- Reporting queries group by user/session, filter by time window, and slice by
-- category/event/api, so those are the access paths that matter.
CREATE INDEX IF NOT EXISTS "idx_sales_dashboard_temp_logs_ts"
    ON "public"."sales_dashboard_temporary_logs" ("ts" DESC);
CREATE INDEX IF NOT EXISTS "idx_sales_dashboard_temp_logs_session"
    ON "public"."sales_dashboard_temporary_logs" ("session_id", "ts");
CREATE INDEX IF NOT EXISTS "idx_sales_dashboard_temp_logs_user"
    ON "public"."sales_dashboard_temporary_logs" ("user_id", "ts" DESC);
CREATE INDEX IF NOT EXISTS "idx_sales_dashboard_temp_logs_auth_user"
    ON "public"."sales_dashboard_temporary_logs" ("auth_user_id", "ts" DESC);
CREATE INDEX IF NOT EXISTS "idx_sales_dashboard_temp_logs_event"
    ON "public"."sales_dashboard_temporary_logs" ("event_name", "ts" DESC);
CREATE INDEX IF NOT EXISTS "idx_sales_dashboard_temp_logs_api"
    ON "public"."sales_dashboard_temporary_logs" ("api_name", "ts" DESC)
    WHERE "api_name" IS NOT NULL;

ALTER TABLE "public"."sales_dashboard_temporary_logs" ENABLE ROW LEVEL SECURITY;

-- The dashboard only ever appends. No client-side read path exists, so the
-- report is produced with the service role (scripts/sales-dashboard-report.mjs)
-- or the SQL editor -- not with the browser's anon key.
DROP POLICY IF EXISTS "authenticated inserts sales dashboard temporary logs"
    ON "public"."sales_dashboard_temporary_logs";
CREATE POLICY "authenticated inserts sales dashboard temporary logs"
    ON "public"."sales_dashboard_temporary_logs"
    FOR INSERT TO authenticated
    WITH CHECK (true);

-- Keep the table lean while it is live: drop rows older than the retention
-- window. Raise or drop this when the monitoring comes out.
CREATE OR REPLACE FUNCTION "public".purge_sales_dashboard_temporary_logs(
    p_keep_days integer DEFAULT 90
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_deleted integer;
BEGIN
    -- Without this guard, purge(0) or purge(-1) would silently delete EVERY row
    -- ("ts < now()" matches all history) and look like it worked.
    IF p_keep_days IS NULL OR p_keep_days < 1 THEN
        RAISE EXCEPTION 'p_keep_days must be >= 1 (got %)', p_keep_days;
    END IF;

    DELETE FROM "public"."sales_dashboard_temporary_logs"
    WHERE "ts" < now() - make_interval(days => p_keep_days);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC. This one deletes data,
-- so only the owner (SQL editor / service_role) may call it, and revoke is
-- re-issued on every apply so the grant can't creep back.
REVOKE ALL ON FUNCTION "public".purge_sales_dashboard_temporary_logs(integer)
    FROM PUBLIC;

COMMENT ON TABLE "public"."sales_dashboard_temporary_logs" IS
    'TEMPORARY pre-ship monitoring for the Sales Dashboard. Drop this table and src/lib/sales-dashboard/tempMonitoring.ts to remove the feature.';
