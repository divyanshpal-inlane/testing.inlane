-- Create team_bug_reports table for internal team issue/feedback tracking
CREATE TABLE IF NOT EXISTS team_bug_reports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Reporter Information
    reporter_name VARCHAR(255) NOT NULL,
    reporter_role VARCHAR(100) NOT NULL, -- sales, ops, logistics, onboarding, customer_handling, other
    reporter_phone VARCHAR(20),
    reporter_email VARCHAR(255),

    -- Report Type
    report_type VARCHAR(50) DEFAULT 'bug', -- bug, feature_request, suggestion, improvement

    -- Issue Details
    platform_section VARCHAR(50) NOT NULL, -- learner, instructor, admin
    feature_category VARCHAR(100) NOT NULL, -- specific feature area
    issue_title VARCHAR(500) NOT NULL,
    issue_description TEXT NOT NULL,
    steps_to_reproduce TEXT, -- mainly for bugs

    -- Additional Context
    affected_user_phone VARCHAR(20), -- if issue is related to a specific user
    affected_user_name VARCHAR(255),
    browser_info VARCHAR(255),
    device_info VARCHAR(255),

    -- Screenshots/Attachments (stored as URLs from Supabase Storage)
    screenshot_urls TEXT[], -- array of screenshot URLs

    -- Status Management
    status VARCHAR(50) DEFAULT 'open', -- open, in_progress, resolved, closed, wont_fix
    priority VARCHAR(20) DEFAULT 'medium', -- low, medium, high, critical
    assigned_to VARCHAR(255), -- admin who is handling

    -- Resolution
    resolution_notes TEXT,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(255)
);

-- Create index for faster queries
CREATE INDEX idx_bug_reports_status ON team_bug_reports(status);
CREATE INDEX idx_bug_reports_platform ON team_bug_reports(platform_section);
CREATE INDEX idx_bug_reports_created ON team_bug_reports(created_at DESC);
CREATE INDEX idx_bug_reports_priority ON team_bug_reports(priority);
CREATE INDEX idx_bug_reports_type ON team_bug_reports(report_type);

-- Create storage bucket for bug report screenshots (run this in Supabase dashboard)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('bug-screenshots', 'bug-screenshots', true);

-- RLS Policies
ALTER TABLE team_bug_reports ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (public form)
CREATE POLICY "Anyone can create bug reports" ON team_bug_reports
    FOR INSERT WITH CHECK (true);

-- Allow anyone to read (for the form submission confirmation)
CREATE POLICY "Anyone can read bug reports" ON team_bug_reports
    FOR SELECT USING (true);

-- Allow updates (for admin status management)
CREATE POLICY "Anyone can update bug reports" ON team_bug_reports
    FOR UPDATE USING (true);
