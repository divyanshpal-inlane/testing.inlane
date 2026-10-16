-- Create app_settings table for application-wide configuration
CREATE TABLE IF NOT EXISTS app_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default payment gateway setting
-- Values: 'icici' (ICICI only), 'razorpay' (Razorpay only), 'both' (user chooses)
INSERT INTO app_settings (key, value, description)
VALUES (
    'payment_gateway_mode',
    '"both"',
    'Payment gateway mode: "icici" for ICICI only, "razorpay" for Razorpay only, "both" for user choice'
)
ON CONFLICT (key) DO NOTHING;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(key);

-- Enable RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read settings (needed for payment page)
CREATE POLICY "Anyone can read app settings"
    ON app_settings FOR SELECT
    USING (true);

-- Only admins can update settings
CREATE POLICY "Admins can update app settings"
    ON app_settings FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM "Admin"
            WHERE "Admin".phone = auth.jwt()->>'phone'
        )
    );

-- Only admins can insert settings
CREATE POLICY "Admins can insert app settings"
    ON app_settings FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM "Admin"
            WHERE "Admin".phone = auth.jwt()->>'phone'
        )
    );
