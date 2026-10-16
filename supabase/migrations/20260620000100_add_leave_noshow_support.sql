-- Section 4 — Leave, No-show & Support Management
-- Adds the data layer behind the instructor-facing Leave / No-show / Support
-- screens and the matching admin tooling.
--
-- Conventions follow 20260619_add_instructor_earnings.sql (TEXT + CHECK instead
-- of enums, shared updated_at trigger) and the reschedule_requests RLS pattern
-- (20241223162931) — but unlike the read-only earnings tables, instructors must
-- WRITE here (apply for leave, report a no-show, raise a ticket). So each table
-- is readable/writable by the owning instructor (matched by normalised phone)
-- and fully managed by admins.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at_leave_support()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- The id_instructor(s) whose phone matches the caller's JWT phone, compared on
-- the last 10 digits so +91 / leading-0 / 10-digit formats all line up.
CREATE OR REPLACE FUNCTION current_instructor_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
  SELECT id_instructor FROM "Instructor"
  WHERE right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)
      = right(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\D', '', 'g'), 10)
    AND coalesce(auth.jwt() ->> 'phone', '') <> '';
$$;

CREATE OR REPLACE FUNCTION is_current_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Admin" WHERE "Admin".phone = auth.jwt() ->> 'phone'
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. instructor_leave_request — planned & emergency leave (with approval)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS instructor_leave_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID NOT NULL REFERENCES "Instructor"(id_instructor) ON DELETE CASCADE,
  leave_type TEXT NOT NULL DEFAULT 'planned'
      CHECK (leave_type IN ('planned', 'emergency')),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT true,
  start_time TIME,
  end_time TIME,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  -- whether an approved leave has been written into Instructor.unavailability
  unavailability_applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leave_request_instructor ON instructor_leave_request (instructor_id);
CREATE INDEX IF NOT EXISTS idx_leave_request_status ON instructor_leave_request (status);

-- ---------------------------------------------------------------------------
-- 2. schedule_no_show — learner & instructor no-show cases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedule_no_show (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id BIGINT NOT NULL REFERENCES "Schedule"(id) ON DELETE CASCADE,
  no_show_party TEXT NOT NULL CHECK (no_show_party IN ('learner', 'instructor')),
  reported_by TEXT NOT NULL DEFAULT 'instructor'
      CHECK (reported_by IN ('instructor', 'admin', 'system')),
  reporter_instructor_id UUID REFERENCES "Instructor"(id_instructor) ON DELETE SET NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (schedule_id, no_show_party)
);
CREATE INDEX IF NOT EXISTS idx_no_show_schedule ON schedule_no_show (schedule_id);
CREATE INDEX IF NOT EXISTS idx_no_show_status ON schedule_no_show (status);

-- ---------------------------------------------------------------------------
-- 3. support_ticket — categorised support tickets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_ticket (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raised_by_role TEXT NOT NULL DEFAULT 'instructor'
      CHECK (raised_by_role IN ('instructor', 'learner', 'admin')),
  instructor_id UUID REFERENCES "Instructor"(id_instructor) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'other'
      CHECK (category IN ('learner', 'vehicle', 'payment', 'app', 'rto', 'other')),
  priority TEXT NOT NULL DEFAULT 'normal'
      CHECK (priority IN ('normal', 'urgent')),
  subject TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  admin_response TEXT,
  assigned_to TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_status ON support_ticket (status);
CREATE INDEX IF NOT EXISTS idx_support_ticket_instructor ON support_ticket (instructor_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_category ON support_ticket (category);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_leave_request_updated_at ON instructor_leave_request;
CREATE TRIGGER trg_leave_request_updated_at BEFORE UPDATE ON instructor_leave_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_leave_support();

DROP TRIGGER IF EXISTS trg_no_show_updated_at ON schedule_no_show;
CREATE TRIGGER trg_no_show_updated_at BEFORE UPDATE ON schedule_no_show
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_leave_support();

DROP TRIGGER IF EXISTS trg_support_ticket_updated_at ON support_ticket;
CREATE TRIGGER trg_support_ticket_updated_at BEFORE UPDATE ON support_ticket
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_leave_support();

-- ---------------------------------------------------------------------------
-- RLS: instructor owns their own rows (by normalised phone); admins manage all.
-- ---------------------------------------------------------------------------
ALTER TABLE instructor_leave_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_no_show ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket ENABLE ROW LEVEL SECURITY;

-- instructor_leave_request
DROP POLICY IF EXISTS "Admins manage leave requests" ON instructor_leave_request;
CREATE POLICY "Admins manage leave requests" ON instructor_leave_request
  FOR ALL USING (is_current_admin());
DROP POLICY IF EXISTS "Instructors view own leave" ON instructor_leave_request;
CREATE POLICY "Instructors view own leave" ON instructor_leave_request
  FOR SELECT USING (instructor_id IN (SELECT current_instructor_ids()));
DROP POLICY IF EXISTS "Instructors create own leave" ON instructor_leave_request;
CREATE POLICY "Instructors create own leave" ON instructor_leave_request
  FOR INSERT WITH CHECK (instructor_id IN (SELECT current_instructor_ids()));
DROP POLICY IF EXISTS "Instructors update own leave" ON instructor_leave_request;
CREATE POLICY "Instructors update own leave" ON instructor_leave_request
  FOR UPDATE USING (instructor_id IN (SELECT current_instructor_ids()));

-- schedule_no_show (instructor owns rows they reported)
DROP POLICY IF EXISTS "Admins manage no-shows" ON schedule_no_show;
CREATE POLICY "Admins manage no-shows" ON schedule_no_show
  FOR ALL USING (is_current_admin());
DROP POLICY IF EXISTS "Instructors view own no-shows" ON schedule_no_show;
CREATE POLICY "Instructors view own no-shows" ON schedule_no_show
  FOR SELECT USING (reporter_instructor_id IN (SELECT current_instructor_ids()));
DROP POLICY IF EXISTS "Instructors create no-shows" ON schedule_no_show;
CREATE POLICY "Instructors create no-shows" ON schedule_no_show
  FOR INSERT WITH CHECK (reporter_instructor_id IN (SELECT current_instructor_ids()));

-- support_ticket
DROP POLICY IF EXISTS "Admins manage tickets" ON support_ticket;
CREATE POLICY "Admins manage tickets" ON support_ticket
  FOR ALL USING (is_current_admin());
DROP POLICY IF EXISTS "Instructors view own tickets" ON support_ticket;
CREATE POLICY "Instructors view own tickets" ON support_ticket
  FOR SELECT USING (instructor_id IN (SELECT current_instructor_ids()));
DROP POLICY IF EXISTS "Instructors create own tickets" ON support_ticket;
CREATE POLICY "Instructors create own tickets" ON support_ticket
  FOR INSERT WITH CHECK (instructor_id IN (SELECT current_instructor_ids()));
