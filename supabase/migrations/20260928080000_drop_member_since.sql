-- Drop profiles.member_since. Membership now starts with the member's first
-- tier period (membership_periods.starts_on), which the studio can correct
-- in the dashboard.

drop trigger if exists on_profile_member_since_set on public.profiles;
drop function if exists public.extend_first_period();

drop trigger if exists on_profile_member_since_change on public.profiles;
drop function if exists public.guard_member_since();

alter table public.profiles drop column if exists member_since;
