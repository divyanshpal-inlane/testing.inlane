-- Migration: Create bug-screenshots storage bucket and policies
-- This allows team members to upload screenshots when reporting issues

-- Create the storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('bug-screenshots', 'bug-screenshots', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop existing policies if any (to avoid conflicts)
DROP POLICY IF EXISTS "Allow public uploads to bug-screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Allow public viewing of bug-screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Allow public deletes from bug-screenshots" ON storage.objects;

-- Policy: Allow anyone to upload screenshots (INSERT)
-- This is needed because the report-issue page may be used by unauthenticated team members
CREATE POLICY "Allow public uploads to bug-screenshots" ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'bug-screenshots');

-- Policy: Allow anyone to view screenshots (SELECT)
-- Screenshots need to be viewable in the admin bug reports management page
CREATE POLICY "Allow public viewing of bug-screenshots" ON storage.objects
FOR SELECT
USING (bucket_id = 'bug-screenshots');

-- Policy: Allow authenticated users to delete screenshots (DELETE)
-- Only authenticated admins should be able to delete screenshots
CREATE POLICY "Allow authenticated deletes from bug-screenshots" ON storage.objects
FOR DELETE
USING (bucket_id = 'bug-screenshots' AND auth.role() = 'authenticated');
