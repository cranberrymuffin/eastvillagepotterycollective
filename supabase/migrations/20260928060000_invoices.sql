-- Invoices page: when each member joined, and when each piece was fired, so a
-- month's invoice can be worked out as membership + that month's firings.

-- The date membership started. Members fill it in once on My account; after
-- that only the studio can change it, in the dashboard (Table Editor →
-- profiles).
alter table public.profiles
  add column if not exists member_since date;

grant update (member_since) on public.profiles to authenticated;

create or replace function public.guard_member_since()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.member_since is distinct from old.member_since
     and current_user = 'authenticated' then
    if old.member_since is not null then
      raise exception 'Only the studio can change member_since once it is set'
        using errcode = '42501';
    end if;
    if new.member_since > (now() at time zone 'America/New_York')::date then
      raise exception 'member_since can''t be in the future'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_member_since_change on public.profiles;
create trigger on_profile_member_since_change
  before update of member_since on public.profiles
  for each row execute function public.guard_member_since();

-- When the studio marked a piece bisque fired. Firing fees are billed in the
-- month the piece was fired.
alter table public.pieces
  add column if not exists bisque_fired_at timestamptz;

-- Pieces fired before this column existed have no firing date; bill them in
-- the month they were submitted.
update public.pieces
set bisque_fired_at = submitted_at
where status = 'bisque_fired' and bisque_fired_at is null;

-- Stamp the firing date when the status changes, unless the same update sets
-- it (the studio back-dating a firing in the dashboard).
create or replace function public.stamp_bisque_fired_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'bisque_fired' and new.bisque_fired_at is null then
    new.bisque_fired_at := now();
  elsif new.status <> 'bisque_fired' then
    new.bisque_fired_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists on_piece_status_change on public.pieces;
create trigger on_piece_status_change
  before insert or update of status, bisque_fired_at on public.pieces
  for each row execute function public.stamp_bisque_fired_at();
