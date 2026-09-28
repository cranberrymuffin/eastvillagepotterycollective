-- Studio admin: the studio account can see every member's statements and
-- tier history, and edit that history. (Accounts are created by the
-- create-member Edge Function, which checks public.is_admin().)

update public.profiles
set is_admin = true
where email = 'evpotterycollective@gmail.com';

-- Admins read everyone ------------------------------------------------------
-- Member pages filter to their own rows, since these policies widen what an
-- admin's queries return.

drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles"
  on public.profiles for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins read all pieces" on public.pieces;
create policy "Admins read all pieces"
  on public.pieces for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins read all membership periods" on public.membership_periods;
create policy "Admins read all membership periods"
  on public.membership_periods for select to authenticated
  using (public.is_admin());

-- Admins edit tier history ---------------------------------------------------

grant insert (user_id, tier, starts_on, ends_on),
  update (tier, starts_on, ends_on),
  delete
  on public.membership_periods to authenticated;

drop policy if exists "Admins add membership periods" on public.membership_periods;
create policy "Admins add membership periods"
  on public.membership_periods for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins edit membership periods" on public.membership_periods;
create policy "Admins edit membership periods"
  on public.membership_periods for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins delete membership periods" on public.membership_periods;
create policy "Admins delete membership periods"
  on public.membership_periods for delete to authenticated
  using (public.is_admin());

-- A member can't be on two tiers on the same day.
create extension if not exists btree_gist with schema extensions;

alter table public.membership_periods
  drop constraint if exists membership_periods_no_overlap;
alter table public.membership_periods
  add constraint membership_periods_no_overlap
  exclude using gist (user_id with =, daterange(starts_on, ends_on, '[]') with &&);

-- profiles.tier follows the open period ---------------------------------------
-- After an admin edits the history, the member's current tier is the tier of
-- their open period (or none).

create or replace function public.sync_profile_tier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member uuid := coalesce(new.user_id, old.user_id);
begin
  update public.profiles
  set tier = (
    select tier from public.membership_periods
    where user_id = member and ends_on is null
  )
  where id = member
    and tier is distinct from (
      select tier from public.membership_periods
      where user_id = member and ends_on is null
    );
  return null;
end;
$$;

drop trigger if exists on_membership_period_change on public.membership_periods;
create trigger on_membership_period_change
  after insert or update or delete on public.membership_periods
  for each row execute function public.sync_profile_tier();

-- Studio events --------------------------------------------------------------
-- Events created by a studio admin are studio events; everyone else's are
-- member events.

create or replace function public.set_studio_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.is_studio_event := coalesce(
    (select is_admin from public.profiles where id = new.created_by),
    false
  );
  return new;
end;
$$;

drop trigger if exists on_event_write on public.events;
create trigger on_event_write
  before insert or update on public.events
  for each row execute function public.set_studio_event();

update public.events e
set is_studio_event = p.is_admin
from public.profiles p
where p.id = e.created_by and e.is_studio_event is distinct from p.is_admin;

-- The studio account isn't a member ------------------------------------------
-- Admins have no tier, tier history, bisque log or payment details.

-- The tier-change trigger skips admins, and records a new period only when
-- the tier differs from the open one, so syncing a tier from the history
-- doesn't record it again.
create or replace function public.record_tier_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
begin
  if new.is_admin
     or (tg_op = 'UPDATE' and new.tier is not distinct from old.tier) then
    return new;
  end if;

  if exists (
    select 1 from public.membership_periods
    where user_id = new.id and ends_on is null and tier is not distinct from new.tier
  ) then
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

delete from public.membership_periods
where user_id in (select id from public.profiles where is_admin);

update public.profiles
set tier = null, pronouns = null, payment_method = null, payment_handle = null,
  payment_verified = false
where is_admin;

drop policy if exists "Members add own pieces" on public.pieces;
create policy "Members add own pieces"
  on public.pieces for insert to authenticated
  with check (user_id = auth.uid() and status = 'submitted' and not public.is_admin());
