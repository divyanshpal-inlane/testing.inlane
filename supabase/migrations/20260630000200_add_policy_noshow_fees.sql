-- Holiday/Leave/No-Show Policy — money & consent layer (PRD v1.0)
-- Adds the three tables the existing schedule_no_show / leave system was missing:
--   1. policy_acceptance  — persists the policy/T&C acceptance that today is
--                           UI-only (signup checkbox, instructor contract step).
--   2. no_show_fee        — the ₹300 charge raised when ops confirms a learner
--                           no-show (or a late reschedule). schedule_no_show only
--                           TRACKED no-shows; it never had a financial record.
--   3. no_show_appeal     — the learner's appeal against a fee, reviewed by ops.
--
-- Conventions follow 20260620_add_leave_noshow_support.sql (TEXT + CHECK instead
-- of enums, shared set_updated_at_leave_support() trigger, is_current_admin() /
-- current_instructor_ids() helpers) and the reschedule_requests learner-owned RLS
-- pattern (20241223162931): a learner owns rows whose learner_id matches the
-- Learner whose phone equals the caller's JWT phone.

-- ---------------------------------------------------------------------------
-- 1. policy_acceptance — append-only consent log (instructor OR learner)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policy_acceptance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_type TEXT NOT NULL CHECK (user_type IN ('instructor', 'learner')),
  learner_id UUID REFERENCES "Learner"(id) ON DELETE CASCADE,
  instructor_id UUID REFERENCES "Instructor"(id_instructor) ON DELETE CASCADE,
  -- For learners: which booking triggered the acceptance (PRD §2.2 Flow A).
  schedule_id BIGINT REFERENCES "Schedule"(id) ON DELETE SET NULL,
  policy_version TEXT NOT NULL DEFAULT '1.0',
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_by_ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Exactly one owner column is set, matching user_type.
  CHECK (
    (user_type = 'learner' AND learner_id IS NOT NULL AND instructor_id IS NULL) OR
    (user_type = 'instructor' AND instructor_id IS NOT NULL AND learner_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_policy_acceptance_learner ON policy_acceptance (learner_id);
CREATE INDEX IF NOT EXISTS idx_policy_acceptance_instructor ON policy_acceptance (instructor_id);
-- One acceptance per instructor per policy version (idempotent first-load gate).
CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_acceptance_instructor_version
  ON policy_acceptance (instructor_id, policy_version)
  WHERE instructor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. no_show_fee — ₹300 charge raised on a confirmed no-show / late reschedule
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS no_show_fee (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id BIGINT NOT NULL REFERENCES "Schedule"(id) ON DELETE CASCADE,
  -- The schedule_no_show case this fee was raised from (null for late reschedule).
  no_show_id UUID REFERENCES schedule_no_show(id) ON DELETE SET NULL,
  learner_id UUID NOT NULL REFERENCES "Learner"(id) ON DELETE CASCADE,
  fee_type TEXT NOT NULL DEFAULT 'no_show'
      CHECK (fee_type IN ('no_show', 'late_reschedule')),
  amount INTEGER NOT NULL DEFAULT 300,
  status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'confirmed', 'deducted', 'appealed', 'waived', 'paid')),
  -- Set once the learner pays the fee.
  payment_id UUID REFERENCES "payment"(id) ON DELETE SET NULL,
  marked_by TEXT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deducted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- At most one fee of each type per lesson.
  UNIQUE (schedule_id, fee_type)
);
CREATE INDEX IF NOT EXISTS idx_no_show_fee_learner ON no_show_fee (learner_id);
CREATE INDEX IF NOT EXISTS idx_no_show_fee_status ON no_show_fee (status);
CREATE INDEX IF NOT EXISTS idx_no_show_fee_schedule ON no_show_fee (schedule_id);

-- ---------------------------------------------------------------------------
-- 3. no_show_appeal — learner appeal against a fee; ops approves/rejects/partial
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS no_show_appeal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_id UUID NOT NULL REFERENCES no_show_fee(id) ON DELETE CASCADE,
  learner_id UUID NOT NULL REFERENCES "Learner"(id) ON DELETE CASCADE,
  reason TEXT NOT NULL
      CHECK (reason IN ('instructor_no_show', 'system_error', 'emergency', 'other')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected', 'partial_refund')),
  -- Amount refunded/waived when approved or partially approved.
  refund_amount INTEGER,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  ops_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_no_show_appeal_fee ON no_show_appeal (fee_id);
CREATE INDEX IF NOT EXISTS idx_no_show_appeal_learner ON no_show_appeal (learner_id);
CREATE INDEX IF NOT EXISTS idx_no_show_appeal_status ON no_show_appeal (status);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse the shared function from 20260620)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_no_show_fee_updated_at ON no_show_fee;
CREATE TRIGGER trg_no_show_fee_updated_at BEFORE UPDATE ON no_show_fee
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_leave_support();

DROP TRIGGER IF EXISTS trg_no_show_appeal_updated_at ON no_show_appeal;
CREATE TRIGGER trg_no_show_appeal_updated_at BEFORE UPDATE ON no_show_appeal
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_leave_support();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE policy_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE no_show_fee ENABLE ROW LEVEL SECURITY;
ALTER TABLE no_show_appeal ENABLE ROW LEVEL SECURITY;

-- Reusable learner-ownership predicate: the Learner whose phone matches the JWT.
-- (Inlined per table below to match the reschedule_requests pattern.)

-- policy_acceptance: each user records & reads their own; admins read all.
DROP POLICY IF EXISTS "Admins manage policy acceptance" ON policy_acceptance;
CREATE POLICY "Admins manage policy acceptance" ON policy_acceptance
  FOR ALL USING (is_current_admin());
DROP POLICY IF EXISTS "Learners record own acceptance" ON policy_acceptance;
CREATE POLICY "Learners record own acceptance" ON policy_acceptance
  FOR INSERT WITH CHECK (
    user_type = 'learner' AND learner_id IN (
      SELECT id FROM "Learner" WHERE phone = auth.jwt() ->> 'phone'
    )
  );
DROP POLICY IF EXISTS "Learners view own acceptance" ON policy_acceptance;
CREATE POLICY "Learners view own acceptance" ON policy_acceptance
  FOR SELECT USING (
    learner_id IN (SELECT id FROM "Learner" WHERE phone = auth.jwt() ->> 'phone')
  );
DROP POLICY IF EXISTS "Instructors record own acceptance" ON policy_acceptance;
CREATE POLICY "Instructors record own acceptance" ON policy_acceptance
  FOR INSERT WITH CHECK (
    user_type = 'instructor' AND instructor_id IN (SELECT current_instructor_ids())
  );
DROP POLICY IF EXISTS "Instructors view own acceptance" ON policy_acceptance;
CREATE POLICY "Instructors view own acceptance" ON policy_acceptance
  FOR SELECT USING (instructor_id IN (SELECT current_instructor_ids()));

-- no_show_fee: ops manages everything; the learner can only read their own.
DROP POLICY IF EXISTS "Admins manage no-show fees" ON no_show_fee;
CREATE POLICY "Admins manage no-show fees" ON no_show_fee
  FOR ALL USING (is_current_admin());
DROP POLICY IF EXISTS "Learners view own no-show fees" ON no_show_fee;
CREATE POLICY "Learners view own no-show fees" ON no_show_fee
  FOR SELECT USING (
    learner_id IN (SELECT id FROM "Learner" WHERE phone = auth.jwt() ->> 'phone')
  );

-- no_show_appeal: ops manages; the learner reads & files their own appeal.
DROP POLICY IF EXISTS "Admins manage appeals" ON no_show_appeal;
CREATE POLICY "Admins manage appeals" ON no_show_appeal
  FOR ALL USING (is_current_admin());
DROP POLICY IF EXISTS "Learners view own appeals" ON no_show_appeal;
CREATE POLICY "Learners view own appeals" ON no_show_appeal
  FOR SELECT USING (
    learner_id IN (SELECT id FROM "Learner" WHERE phone = auth.jwt() ->> 'phone')
  );
DROP POLICY IF EXISTS "Learners create own appeals" ON no_show_appeal;
CREATE POLICY "Learners create own appeals" ON no_show_appeal
  FOR INSERT WITH CHECK (
    learner_id IN (SELECT id FROM "Learner" WHERE phone = auth.jwt() ->> 'phone')
  );
