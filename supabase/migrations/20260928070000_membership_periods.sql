-- Tier history: which tier each member had, from when to when, so past
-- statements bill the tier the member actually had that month.
-- Kept up to date by a trigger on profiles.tier; the studio can also fix
-- rows or end a membership (set ends_on) in the dashboard.

create table if not exists public.membership_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  tier text not null check (tier in ('tier_1', 'tier_2', 'tier_3')),
  starts_on date not null,
  ends_on date check (ends_on >= starts_on), -- null while it's the current tier
  created_at timestamptz not null default now()
);

create index if not exists membership_periods_user_idx
  on public.membership_periods (user_id, starts_on);

-- At most one current (open) period per member.
create unique index if not exists membership_periods_one_open_idx
  on public.membership_periods (user_id) where ends_on is null;

alter table public.membership_periods enable row level security;

drop policy if exists "Members read own membership periods" on public.membership_periods;
create policy "Members read own membership periods"
  on public.membership_periods for select to authenticated
  using (user_id = auth.uid());

-- Only the trigger below and the studio write periods.
revoke insert, update, delete on public.membership_periods from anon, authenticated;

-- A tier change ends the current period yesterday and starts a new one
-- today (New York dates). Changing again the same day replaces today's.
create or replace function public.record_tier_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
begin
  if tg_op = 'UPDATE' and new.tier is not distinct from old.tier then
    return new;
  end if;

  delete from public.membership_periods
  where user_id = new.id and ends_on is null and starts_on >= today;

  update public.membership_periods
  set ends_on = today - 1
  where user_id = new.id and ends_on is null;

  if new.tier is not null then
    insert into public.membership_periods (user_id, tier, starts_on)
    values (new.id, new.tier, today);
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_tier_change on public.profiles;
create trigger on_profile_tier_change
  after insert or update of tier on public.profiles
  for each row execute function public.record_tier_change();

-- When a member fills in member_since, their first period starts then
-- rather than on the day they signed up on the site.
create or replace function public.extend_first_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.member_since is not null
     and new.member_since is distinct from old.member_since then
    update public.membership_periods
    set starts_on = new.member_since
    where id = (
      select id from public.membership_periods
      where user_id = new.id
      order by starts_on
      limit 1
    )
    and starts_on > new.member_since;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_member_since_set on public.profiles;
create trigger on_profile_member_since_set
  after update of member_since on public.profiles
  for each row execute function public.extend_first_period();

-- Current tiers for members who signed up before this migration.
insert into public.membership_periods (user_id, tier, starts_on)
select
  id,
  tier,
  coalesce(member_since, (created_at at time zone 'America/New_York')::date)
from public.profiles
where tier is not null
  and not exists (
    select 1 from public.membership_periods where user_id = profiles.id
  );
