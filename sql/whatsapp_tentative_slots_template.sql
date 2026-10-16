-- Production config for "Send Tentative Slots on WhatsApp".
-- name/language/content must match the template APPROVED on Heltar exactly.
-- To change wording or switch template, UPDATE this row; no redeploy needed.
-- If the row is missing, send-message falls back to TEMPLATES.TENTATIVE_SLOTS.
INSERT INTO app_settings (key, value, description)
VALUES (
  'whatsapp_tentative_slots_template',
  jsonb_build_object(
    'name', 'webapp_tentative_class_slots',
    'language', 'en',
    'content', E'Hi {{1}} 👋\n\nYour *tentative class slots* with *Lane* 🚗 are reserved:\n\n📅 {{2}}\n\n⏳ These slots are held for you for a limited time. Reply to this message to confirm them, or to ask for a different time.\n\nHappy driving! 🛞\n*Team Lane*'
  ),
  'Heltar WhatsApp template used by the Sales Dashboard to share tentative class slots. {{1}} = customer name, {{2}} = slot list.'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
