-- My account page: members edit their own profile, and the studio verifies
-- their Venmo/Zelle once a payment from it arrives.

alter table public.profiles
  add column if not exists pronouns text check (char_length(pronouns) <= 50),
  add column if not exists bio text check (char_length(bio) <= 1000),
  add column if not exists payment_verified boolean not null default false;

-- Members can edit these columns on their own row. payment_verified, email
-- and id are not granted, so only the studio (dashboard) can change them.
grant update (full_name, pronouns, bio, tier, payment_method, payment_handle)
  on public.profiles to authenticated;

drop policy if exists "Members update own profile" on public.profiles;
create policy "Members update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- A new payment method or handle needs verifying again, unless the same
-- update also sets payment_verified (the studio editing in the dashboard).
create or replace function public.reset_payment_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.payment_method is distinct from old.payment_method
      or new.payment_handle is distinct from old.payment_handle)
     and new.payment_verified is not distinct from old.payment_verified then
    new.payment_verified := false;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_payment_change on public.profiles;
create trigger on_profile_payment_change
  before update on public.profiles
  for each row execute function public.reset_payment_verification();

-- Keep profiles.email in step when a member confirms a new email address.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_change on auth.users;
create trigger on_auth_user_email_change
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.sync_profile_email();
