-- Super Admin and Role-Based Access Control Migration
-- This migration adds:
-- 1. Super admin designation
-- 2. Admin permissions system
-- 3. is_admin flag to distinguish admins from learners
-- 4. Fix for auth user creation triggers

-- Add is_super_admin column to Admin table
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false;

-- Add is_admin flag to distinguish actual admins from learners
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Create index for faster queries on is_admin
CREATE INDEX IF NOT EXISTS idx_admin_is_admin ON "Admin" (is_admin) WHERE is_admin = true;

-- Create admin_permissions table for role-based access control
CREATE TABLE IF NOT EXISTS admin_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES "Admin"(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(admin_id, permission)
);

-- Enable RLS on admin_permissions
ALTER TABLE admin_permissions ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can view all permissions (needed for permission checks)
DROP POLICY IF EXISTS "Admins can view permissions" ON admin_permissions;
CREATE POLICY "Admins can view permissions"
    ON admin_permissions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM "Admin"
        WHERE "Admin".phone = auth.jwt()->>'phone'
    ));

-- Policy: Only super admins can manage permissions
DROP POLICY IF EXISTS "Super admins can manage permissions" ON admin_permissions;
CREATE POLICY "Super admins can manage permissions"
    ON admin_permissions FOR ALL
    USING (EXISTS (
        SELECT 1 FROM "Admin"
        WHERE "Admin".phone = auth.jwt()->>'phone'
        AND "Admin".is_super_admin = true
    ));

-- Update the create_admin_on_user_signup function to only create Admin for admin users
-- and skip if Admin already exists (prevents duplicate key errors)
CREATE OR REPLACE FUNCTION public.create_admin_on_user_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
    -- Only create Admin record if user_role is 'admin'
    IF (NEW.raw_user_meta_data ->> 'user_role') = 'admin' THEN
        -- Use ON CONFLICT to skip if Admin already exists
        INSERT INTO public."Admin" (
            id,
            name,
            phone,
            created_at
        ) VALUES (
            NEW.id,
            NEW.raw_user_meta_data ->> 'name',
            NEW.phone,
            NOW()
        )
        ON CONFLICT (phone) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$function$;

-- Update the update_signed_up_flag function to handle admin users properly
CREATE OR REPLACE FUNCTION public.update_signed_up_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role TEXT;
BEGIN
  user_role := (NEW.raw_user_meta_data->>'user_role')::TEXT;

  IF user_role = 'learner' THEN
    IF EXISTS (SELECT 1 FROM public."Learner" WHERE phone = NEW.phone) THEN
      UPDATE public."Learner"
      SET signed_up = current_timestamp
      WHERE phone = NEW.phone;
      PERFORM public.set_claim(NEW.id, 'user_role', '"learner"'::jsonb);
    ELSE
      RAISE EXCEPTION 'User with phone % does not exist in Learner table', NEW.phone;
    END IF;
  ELSIF user_role = 'instructor' THEN
    IF EXISTS (SELECT 1 FROM public."Instructor" WHERE phone = NEW.phone) THEN
      UPDATE public."Instructor"
      SET signed_up = current_timestamp
      WHERE phone = NEW.phone;
      PERFORM public.set_claim(NEW.id, 'user_role', '"instructor"'::jsonb);
    ELSE
      RAISE EXCEPTION 'User with phone % does not exist in Instructor table', NEW.phone;
    END IF;
  ELSIF user_role = 'admin' THEN
    IF EXISTS (SELECT 1 FROM public."Admin" WHERE phone = NEW.phone) THEN
      UPDATE public."Admin"
      SET signed_up = current_timestamp
      WHERE phone = NEW.phone;
      -- Don't call set_claim here - metadata is already set by createUser
    ELSE
      RAISE EXCEPTION 'User with phone % does not exist in Admin table', NEW.phone;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid user_role: %', user_role;
  END IF;

  RETURN NEW;
END;
$$;
