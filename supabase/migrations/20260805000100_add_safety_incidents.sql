-- Section 5 — Safety Features
-- Adds the data layer behind the instructor-facing Safety screen (accident,
-- vehicle breakdown, learner misconduct reporting + emergency SOS) and the
-- admin Safety Monitoring page.
--
-- Conventions follow 20260620_add_leave_noshow_support.sql: TEXT + CHECK
-- instead of enums, the shared updated_at trigger, and the same RLS shape —
-- instructors read/insert their own rows (matched by normalised phone via
-- current_instructor_ids()), admins manage everything.

CREATE TABLE IF NOT EXISTS safety_incident (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID NOT NULL REFERENCES "Instructor"(id_instructor) ON DELETE CASCADE,
  incident_type TEXT NOT NULL
      CHECK (incident_type IN ('accident', 'breakdown', 'misconduct', 'sos')),
  -- optional link to the lesson the incident happened in
  schedule_id BIGINT REFERENCES "Schedule"(id) ON DELETE SET NULL,
  description TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  admin_response TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_safety_incident_instructor ON safety_incident (instructor_id);
CREATE INDEX IF NOT EXISTS idx_safety_incident_status ON safety_incident (status);
CREATE INDEX IF NOT EXISTS idx_safety_incident_type ON safety_incident (incident_type);

DROP TRIGGER IF EXISTS trg_safety_incident_updated_at ON safety_incident;
CREATE TRIGGER trg_safety_incident_updated_at BEFORE UPDATE ON safety_incident
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_leave_support();

ALTER TABLE safety_incident ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage safety incidents" ON safety_incident;
CREATE POLICY "Admins manage safety incidents" ON safety_incident
  FOR ALL USING (is_current_admin());
DROP POLICY IF EXISTS "Instructors view own safety incidents" ON safety_incident;
CREATE POLICY "Instructors view own safety incidents" ON safety_incident
  FOR SELECT USING (instructor_id IN (SELECT current_instructor_ids()));
DROP POLICY IF EXISTS "Instructors create own safety incidents" ON safety_incident;
CREATE POLICY "Instructors create own safety incidents" ON safety_incident
  FOR INSERT WITH CHECK (instructor_id IN (SELECT current_instructor_ids()));
