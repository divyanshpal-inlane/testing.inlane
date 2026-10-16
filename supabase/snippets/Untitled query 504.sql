-- Insert 10 test learners
INSERT INTO "Learner" (id, name, phone, email, area, created_at)
VALUES 
  (gen_random_uuid(), 'Alice Johnson', '9999999001', 'alice@test.com', 'Indiranagar', NOW() - INTERVAL '10 days'),
  (gen_random_uuid(), 'Bob Smith', '9999999002', 'bob@test.com', 'Koramangala', NOW() - INTERVAL '9 days'),
  (gen_random_uuid(), 'Carol White', '9999999003', 'carol@test.com', 'Whitefield', NOW() - INTERVAL '8 days'),
  (gen_random_uuid(), 'David Brown', '9999999004', 'david@test.com', 'HSR Layout', NOW() - INTERVAL '7 days'),
  (gen_random_uuid(), 'Emma Davis', '9999999005', 'emma@test.com', 'Jayanagar', NOW() - INTERVAL '6 days'),
  (gen_random_uuid(), 'Frank Miller', '9999999006', 'frank@test.com', 'Bellandur', NOW() - INTERVAL '5 days'),
  (gen_random_uuid(), 'Grace Wilson', '9999999007', 'grace@test.com', 'Electronic City', NOW() - INTERVAL '4 days'),
  (gen_random_uuid(), 'Henry Moore', '9999999008', 'henry@test.com', 'Malleshwaram', NOW() - INTERVAL '3 days'),
  (gen_random_uuid(), 'Ivy Taylor', '9999999009', 'ivy@test.com', 'Rajajinagar', NOW() - INTERVAL '2 days'),
  (gen_random_uuid(), 'Jack Anderson', '9999999010', 'jack@test.com', 'Yelahanka', NOW() - INTERVAL '1 day')
ON CONFLICT (phone) DO NOTHING;
