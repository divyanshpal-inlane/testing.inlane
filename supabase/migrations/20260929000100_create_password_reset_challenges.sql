-- Server-side state for the WhatsApp password-reset flow.
-- Only the service-role Edge Function can access this table; OTPs and reset
-- tokens are stored as hashes and automatically become unusable after expiry.
create table if not exists public.password_reset_challenges (
  phone text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts >= 0),
  verified_at timestamptz,
  reset_token_hash text,
  reset_token_expires_at timestamptz,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.password_reset_challenges enable row level security;

revoke all on table public.password_reset_challenges from anon, authenticated;
grant all on table public.password_reset_challenges to service_role;

create index if not exists password_reset_challenges_expires_at_idx
  on public.password_reset_challenges (expires_at);

-- auth.users is not exposed through PostgREST. This service-role-only helper
-- avoids downloading and scanning the full auth user list for each OTP request.
create or replace function public.get_auth_user_for_password_reset(p_phone text)
returns table (
  user_id uuid,
  user_phone text,
  user_metadata jsonb
)
language sql
stable
security definer
set search_path = auth, public
as $$
  select
    users.id,
    users.phone::text,
    users.raw_user_meta_data
  from auth.users
  where right(regexp_replace(coalesce(users.phone, ''), '\D', '', 'g'), 10) =
        right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
  order by users.created_at desc
  limit 1;
$$;

revoke all on function public.get_auth_user_for_password_reset(text)
  from public, anon, authenticated;
grant execute on function public.get_auth_user_for_password_reset(text)
  to service_role;
