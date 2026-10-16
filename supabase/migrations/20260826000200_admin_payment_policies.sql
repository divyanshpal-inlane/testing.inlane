-- Admins can create payment rows when migrating customers (LearnerMigration,
-- LL Customer Migration). Without this, payment INSERT only succeeds when the
-- JWT phone matches the learner's phone (customer self-serve checkout).

DROP POLICY IF EXISTS "Allow admins to view all payments" ON "public"."payment";
DROP POLICY IF EXISTS "Allow admins to manage all payments" ON "public"."payment";

CREATE POLICY "Allow admins to view all payments"
  ON "public"."payment"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "Admin"
      WHERE "Admin".phone = auth.jwt() ->> 'phone'
    )
  );

CREATE POLICY "Allow admins to manage all payments"
  ON "public"."payment"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Admin"
      WHERE "Admin".phone = auth.jwt() ->> 'phone'
    )
  );
