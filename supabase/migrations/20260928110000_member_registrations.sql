-- Registered emails: the studio registers a member (email, name, tier) on
-- the Members page, and only registered emails can create an account.
-- Replaces email invites, so adding a member sends no email.

create table if not exists public.member_registrations (
  email text primary key check (email = lower(trim(email)) and email like '%_@_%'),
  full_name text check (char_length(full_name) <= 100),
  tier text not null check (tier in ('tier_1', 'tier_2', 'tier_3')),
  -- When their membership (first tier period) starts; set by the studio.
  starts_on date not null default (now() at time zone 'America/New_York')::date,
  registered_at timestamptz not null default now()
);

alter table public.member_registrations enable row level security;

revoke all on public.member_registrations from anon, authenticated;
grant select, insert (email, full_name, tier, starts_on), delete
  on public.member_registrations to authenticated;

drop policy if exists "Admins read registrations" on public.member_registrations;
create policy "Admins read registrations" on public.member_registrations
  for select to authenticated using (public.is_admin());

drop policy if exists "Admins add registrations" on public.member_registrations;
create policy "Admins add registrations" on public.member_registrations
  for insert to authenticated with check (public.is_admin());

drop policy if exists "Admins remove registrations" on public.member_registrations;
create policy "Admins remove registrations" on public.member_registrations
  for delete to authenticated using (public.is_admin());

-- Refuse new accounts for emails the studio hasn't registered. This covers
-- every way an account can be made (site signup, dashboard, API).
create or replace function public.require_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.member_registrations where email = lower(new.email)
  ) then
    raise exception 'This email has not been registered by the studio'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists before_auth_user_created on auth.users;
create trigger before_auth_user_created
  before insert on auth.users
  for each row execute function public.require_registration();

-- New profiles take their name and tier from the registration (members
-- can't pick their own tier), then the registration is used up. The tier
-- starts the member's history via on_profile_tier_change, which dates it
-- today; it's then moved to the start date the studio registered.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  registration public.member_registrations;
begin
  select * into registration
  from public.member_registrations
  where email = lower(new.email);

  insert into public.profiles (id, full_name, email, tier, payment_method, payment_handle)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), registration.full_name),
    new.email,
    registration.tier,
    nullif(new.raw_user_meta_data ->> 'payment_method', ''),
    nullif(trim(new.raw_user_meta_data ->> 'payment_handle'), '')
  );

  update public.membership_periods
  set starts_on = registration.starts_on
  where user_id = new.id and ends_on is null and registration.starts_on is not null;

  delete from public.member_registrations where email = lower(new.email);
  return new;
end;
$$;
