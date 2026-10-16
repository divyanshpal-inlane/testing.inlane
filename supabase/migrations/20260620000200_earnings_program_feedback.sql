-- ---------------------------------------------------------------------------
-- Instructor earnings — "More ways to earn" program changes (team feedback)
--   1. Remove the "Monthly top instructor bonus" (leaderboard) program
--   2. Turn the (previously coming-soon) car program into an active
--      "Car Purchase Referral" — ₹1,500 per successful sale
--   3. Add a new "Review Bonus" program — ₹50 per review
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

-- 1. Remove the monthly top-instructor leaderboard bonus
UPDATE earning_program
SET is_active = false,
    updated_at = NOW()
WHERE key = 'leaderboard_bonus';

-- 2. Car Purchase Referral (repurpose the existing lane_cars row)
UPDATE earning_program
SET title = 'Car Purchase Referral',
    description = 'Refer someone who wants to purchase a car. Earn on every successful sale.',
    amount_label = '₹1,500 per successful sale',
    status_pill = 'new',
    is_active = true,
    sort_order = 3,
    updated_at = NOW()
WHERE key = 'lane_cars';

-- 3. Review Bonus (new program)
INSERT INTO earning_program
    (key, title, description, amount_label, status_pill, cta_label, cta_url, icon_bg, is_active, sort_order)
VALUES
    ('review_bonus', 'Review Bonus',
     'Earn for every learner review you collect.',
     '₹50 per review', 'active', '', '', '#FFF4CC', true, 4)
ON CONFLICT (key) DO UPDATE
SET title = EXCLUDED.title,
    description = EXCLUDED.description,
    amount_label = EXCLUDED.amount_label,
    status_pill = EXCLUDED.status_pill,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();
