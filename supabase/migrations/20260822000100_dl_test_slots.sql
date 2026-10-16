-- V1 feedback items 6 & 12: Lane/ops upload available DL test dates;
-- customers pick from that list (no free-form preferred date).

CREATE TABLE IF NOT EXISTS "public"."dl_test_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "test_date" date NOT NULL,
  "rto" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "uploaded_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- One active slot per date+RTO pair (inactive rows may share the same pair).
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dl_test_slots_date_rto_active"
  ON "public"."dl_test_slots" ("test_date", "rto")
  WHERE "is_active";

CREATE INDEX IF NOT EXISTS "idx_dl_test_slots_test_date"
  ON "public"."dl_test_slots" ("test_date")
  WHERE "is_active";

ALTER TABLE "public"."dl_test_slots" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dl_test_slots_select" ON "public"."dl_test_slots"
  FOR SELECT USING (true);
CREATE POLICY "dl_test_slots_insert" ON "public"."dl_test_slots"
  FOR INSERT WITH CHECK (true);
CREATE POLICY "dl_test_slots_update" ON "public"."dl_test_slots"
  FOR UPDATE USING (true);
CREATE POLICY "dl_test_slots_delete" ON "public"."dl_test_slots"
  FOR DELETE USING (true);
