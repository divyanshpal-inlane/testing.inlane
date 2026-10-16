-- Test Data for Active Learners Pagination
-- Run this in Supabase Studio SQL Editor: http://localhost:54323

-- Insert test learners
INSERT INTO "Learner" (id, name, phone, email, area, pick_up_location, created_at, address_lat, address_lng, preferred_start_date, preferred_completion_days, prefers_two_hour_classes, two_hour_days, DL_test_date)
VALUES 
  (gen_random_uuid(), 'Test Learner 1', '9999999001', 'learner1@test.com', 'Indiranagar', 'BTM Layout', NOW() - INTERVAL '10 days', 12.9716, 77.5946, '2026-09-20', 30, true, 'Mon,Wed,Fri', '2026-10-15'),
  (gen_random_uuid(), 'Test Learner 2', '9999999002', 'learner2@test.com', 'Koramangala', 'Koramangala 5th Block', NOW() - INTERVAL '9 days', 12.9352, 77.6245, '2026-09-21', 45, false, NULL, '2026-10-20'),
  (gen_random_uuid(), 'Test Learner 3', '9999999003', 'learner3@test.com', 'Whitefield', 'Marathahalli', NOW() - INTERVAL '8 days', 12.9698, 77.7499, '2026-09-22', 30, true, 'Tue,Thu,Sat', NULL),
  (gen_random_uuid(), 'Test Learner 4', '9999999004', 'learner4@test.com', 'HSR Layout', 'HSR Sector 1', NOW() - INTERVAL '7 days', 12.9121, 77.6446, '2026-09-23', 30, false, NULL, '2026-10-25'),
  (gen_random_uuid(), 'Test Learner 5', '9999999005', 'learner5@test.com', 'Jayanagar', 'Jayanagar 4th Block', NOW() - INTERVAL '6 days', 12.9250, 77.5838, '2026-09-24', 60, true, 'Mon,Wed,Fri', NULL),
  (gen_random_uuid(), 'Demo Learner 1', '9999999006', 'demo1@test.com', 'Bellandur', 'Bellandur Lake', NOW() - INTERVAL '5 days', 12.9266, 77.6787, '2026-09-25', 7, false, NULL, NULL),
  (gen_random_uuid(), 'Test Learner 6', '9999999007', 'learner6@test.com', 'Electronic City', 'Infosys Campus', NOW() - INTERVAL '4 days', 12.8456, 77.6603, '2026-09-26', 30, true, 'Mon,Wed,Fri', '2026-10-30'),
  (gen_random_uuid(), 'Test Learner 7', '9999999008', 'learner7@test.com', 'Malleshwaram', 'Malleshwaram 8th Cross', NOW() - INTERVAL '3 days', 13.0059, 77.5713, '2026-09-27', 45, false, NULL, NULL),
  (gen_random_uuid(), 'Test Learner 8', '9999999009', 'learner8@test.com', 'Rajajinagar', 'Rajajinagar Metro', NOW() - INTERVAL '2 days', 12.9916, 77.5543, '2026-09-28', 30, true, 'Tue,Thu,Sat', '2026-11-05'),
  (gen_random_uuid(), 'Test Learner 9', '9999999010', 'learner9@test.com', 'Yelahanka', 'Yelahanka New Town', NOW() - INTERVAL '1 day', 13.1007, 77.5963, '2026-09-29', 30, false, NULL, NULL)
ON CONFLICT (phone) DO NOTHING;

-- Get the course ID for Beginner Course (should already exist)
DO $$
DECLARE
  beginner_course_id UUID;
  demo_learner_id UUID;
  learner_record RECORD;
BEGIN
  -- Find or create Beginner Course
  SELECT id INTO beginner_course_id FROM "Courses" WHERE name = 'Beginner Course' LIMIT 1;
  
  IF beginner_course_id IS NULL THEN
    beginner_course_id := 'e129f667-0510-4f07-9847-edb58356dc74'::UUID;
    INSERT INTO "Courses" (id, name, total_lessons, duration, price, description)
    VALUES (beginner_course_id, 'Beginner Course', 10, 10, 10000, 'Complete beginner driving course')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Create active enrollments for all test learners
  FOR learner_record IN SELECT id, phone FROM "Learner" WHERE phone LIKE '999999900%'
  LOOP
    -- Regular course enrollment for most learners
    IF learner_record.phone != '9999999006' THEN
      INSERT INTO "enrollment" (id, learner_id, course_id, status, created_at, progress)
      VALUES (
        gen_random_uuid(),
        learner_record.id,
        beginner_course_id,
        'active',
        NOW(),
        jsonb_build_object('total_hours', 10, 'type', 'course')
      )
      ON CONFLICT DO NOTHING;
    ELSE
      -- Demo enrollment for demo learner
      INSERT INTO "enrollment" (id, learner_id, course_id, status, created_at, progress)
      VALUES (
        gen_random_uuid(),
        learner_record.id,
        beginner_course_id,
        'active',
        NOW(),
        jsonb_build_object('total_hours', 1, 'type', 'demo')
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RAISE NOTICE 'Test data created successfully!';
END $$;

-- Verify the data
SELECT 
  l.name,
  l.phone,
  e.status as enrollment_status,
  e.progress->>'type' as enrollment_type,
  c.name as course_name
FROM "Learner" l
LEFT JOIN "enrollment" e ON l.id = e.learner_id
LEFT JOIN "Courses" c ON e.course_id = c.id
WHERE l.phone LIKE '999999900%'
ORDER BY l.created_at DESC;
