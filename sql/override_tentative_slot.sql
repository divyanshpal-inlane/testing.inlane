-- TASK 20: Tentative slot override/replacement — server-side enforcement.
--
-- Must be run manually in the Supabase SQL editor (no DDL access via the
-- app's anon key, same limitation discussed for schedule_no_overlap_new_rows
-- earlier). Does NOT modify that exclusion constraint.
--
-- Business rule (corrected from an earlier draft of this function): an
-- override does NOT move the unpaid tentative booking to a different
-- slot. It replaces the customer at the SAME slot — an unpaid tentative
-- hold gets handed to a new, paying learner (half or full paid). The new
-- instructor/date/time are therefore never parameters here; they're
-- always read from the old row itself, so there's no way for a client to
-- redirect an "override" into creating a booking at some other slot.
--
-- Why a function instead of just doing DELETE + INSERT from the client:
-- the override permission must not be enforced only by the frontend. This
-- function re-reads the old row fresh (FOR UPDATE, ignoring anything the
-- client already believes), re-checks it's still an unpaid tentative
-- hold, re-checks the NEW tentative_details actually says half_paid or
-- full_paid (never unpaid — the whole point of an override), and only
-- then deletes the old row and inserts the replacement — in the same
-- transaction, so any failure rolls back the whole thing and leaves the
-- original tentative slot untouched. SECURITY INVOKER (the default — no
-- SECURITY DEFINER) on purpose: RLS already permits anon to insert/delete
-- "Schedule" rows directly today, so this function doesn't need to run
-- with elevated privileges, and shouldn't.

drop function if exists override_tentative_slot(bigint, uuid, date, time, time, jsonb);

create or replace function override_tentative_slot(
  p_old_schedule_id bigint,
  p_new_tentative_details jsonb
) returns "Schedule"
language plpgsql
as $$
declare
  v_old "Schedule";
  v_new "Schedule";
  v_new_payment_status text;
begin
  select * into v_old
  from "Schedule"
  where id = p_old_schedule_id
  for update;

  if v_old.id is null then
    raise exception 'This tentative slot no longer exists.';
  end if;

  if v_old."isTentative" is not true or v_old.status <> 'hold' then
    raise exception 'This slot is not a tentative hold and cannot be overridden.';
  end if;

  if coalesce(v_old.tentative_details->>'payment_status', 'unpaid') <> 'unpaid' then
    raise exception 'This tentative slot has already received payment and can no longer be overridden.';
  end if;

  v_new_payment_status := p_new_tentative_details->>'payment_status';
  if v_new_payment_status is distinct from 'half_paid'
     and v_new_payment_status is distinct from 'full_paid' then
    raise exception 'An override must be for a half-paid or full-paid learner, not unpaid.';
  end if;

  delete from "Schedule" where id = p_old_schedule_id;

  insert into "Schedule" (
    instructor_id, date, start_time, end_time, status, "isTentative",
    tentative_details, learner_id, course_id, lesson_id
  ) values (
    -- Same slot the old row occupied — never anything the client passed in.
    v_old.instructor_id, v_old.date, v_old.start_time, v_old.end_time,
    'hold', true, p_new_tentative_details, null, null, null
  )
  returning * into v_new;

  return v_new;
end;
$$;

grant execute on function override_tentative_slot(bigint, jsonb)
  to anon, authenticated;
