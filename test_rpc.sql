SET ROLE authenticated;

SELECT set_config(
  'request.jwt.claims',
  '{"phone":"9831270111"}',
  false
);

SELECT auth.jwt() ->> 'phone' AS phone_from_jwt;

SELECT *
FROM public.get_active_learners_paginated(0, 20);
