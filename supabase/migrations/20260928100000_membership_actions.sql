-- Membership actions for the studio's Members page: start (or change to) a
-- tier from a date, and end a membership. Each runs as one step, so the
-- history is never left half-changed. Only studio admins can call them.

-- Starts `new_tier` on `starting`. If a tier is active, it ends the day
-- before; if it started that same day, its tier is just replaced.
create or replace function public.start_membership_tier(
  member uuid,
  new_tier text,
  starting date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  open_period public.membership_periods;
begin
  if not public.is_admin() then
    raise exception 'Only the studio can change memberships' using errcode = '42501';
  end if;
  if starting is null then
    raise exception 'Choose a start date' using errcode = '22023';
  end if;

  select * into open_period
  from public.membership_periods
  where user_id = member and ends_on is null;

  if open_period.id is not null and open_period.starts_on > starting then
    raise exception 'The new tier must start after the current one started (%)',
      open_period.starts_on
      using errcode = '22023';
  end if;

  if open_period.id is not null and open_period.starts_on = starting then
    update public.membership_periods set tier = new_tier where id = open_period.id;
    return;
  end if;

  update public.membership_periods
  set ends_on = starting - 1
  where id = open_period.id;

  insert into public.membership_periods (user_id, tier, starts_on)
  values (member, new_tier, starting);
end;
$$;

-- Ends the active membership; `last_day` is the last day it covers.
create or replace function public.end_membership(member uuid, last_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the studio can change memberships' using errcode = '42501';
  end if;
  if last_day is null then
    raise exception 'Choose the last day' using errcode = '22023';
  end if;

  update public.membership_periods
  set ends_on = last_day
  where user_id = member and ends_on is null;

  if not found then
    raise exception 'This member has no active membership' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.start_membership_tier(uuid, text, date) from public, anon;
revoke execute on function public.end_membership(uuid, date) from public, anon;
grant execute on function public.start_membership_tier(uuid, text, date) to authenticated;
grant execute on function public.end_membership(uuid, date) to authenticated;
