-- Add is_super_admin column to Admin table
ALTER TABLE "Admin" ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false;

-- Create admin_permissions table
-- Note: Admin table uses phone as primary key (changed in 20250316164819_add_direct_changes.sql)
CREATE TABLE IF NOT EXISTS admin_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_phone TEXT NOT NULL REFERENCES "Admin"(phone) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(admin_phone, permission)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_admin_permissions_admin_phone ON admin_permissions(admin_phone);

-- Enable RLS on admin_permissions
ALTER TABLE admin_permissions ENABLE ROW LEVEL SECURITY;

-- Policy: Super admins can manage all permissions
CREATE POLICY "Super admins can manage permissions"
    ON admin_permissions FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM "Admin"
            WHERE "Admin".phone = auth.jwt()->>'phone'
            AND "Admin".is_super_admin = true
        )
    );

-- Policy: Admins can view their own permissions
CREATE POLICY "Admins can view own permissions"
    ON admin_permissions FOR SELECT
    USING (
        admin_permissions.admin_phone = auth.jwt()->>'phone'
    );

-- Insert super admin (phone: 9831270111)
-- Note: The super admin must also be created in Supabase Auth separately
INSERT INTO "Admin" (phone, name, is_super_admin)
VALUES ('9831270111', 'Super Admin', true)
ON CONFLICT (phone) DO UPDATE SET is_super_admin = true;

-- List of all available permissions
-- learner_management, customer_migration, schedule_management, ll_applications,
-- post_ll_applications, instructor_management, notification_management,
-- customer_info, tentative_schedules, learner_issue_fixer, settings

-- Super admin gets all permissions automatically (handled in code)
