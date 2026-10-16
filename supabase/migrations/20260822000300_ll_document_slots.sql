-- V1 feedback items 1 & 2: allow multiple files per logical document type
-- (address proof pairs, ID proof front/back). Existing rows get slot
-- "primary" so single-file uploads keep working unchanged.

ALTER TABLE "public"."ll_documents"
  ADD COLUMN IF NOT EXISTS "doc_slot" text NOT NULL DEFAULT 'primary';

-- One file per (application, doc type, slot). Re-upload replaces that slot.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ll_documents_app_type_slot"
  ON "public"."ll_documents" ("application_id", "doc_type", "doc_slot");
