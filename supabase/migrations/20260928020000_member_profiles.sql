-- Member profiles: name, membership tier and how they pay (Venmo or Zelle).
-- Filled from the "Create an account" form via auth user metadata, so it
-- works before the member has confirmed their email.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text check (char_length(full_name) <= 100),
  email text,
  tier text check (tier in ('tier_1', 'tier_2', 'tier_3')),
  payment_method text check (payment_method in ('venmo', 'zelle')),
  payment_handle text check (char_length(payment_handle) <= 100),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Members read own profile" on public.profiles;
create policy "Members read own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

-- Members can't edit their profile from the site yet; the studio edits it in
-- the dashboard (Table Editor → profiles).
revoke insert, update, delete on public.profiles from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, tier, payment_method, payment_handle)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    new.email,
    nullif(new.raw_user_meta_data ->> 'tier', ''),
    nullif(new.raw_user_meta_data ->> 'payment_method', ''),
    nullif(trim(new.raw_user_meta_data ->> 'payment_handle'), '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for anyone who signed up before this migration.
insert into public.profiles (id, full_name, email, tier, payment_method, payment_handle)
select
  id,
  nullif(trim(raw_user_meta_data ->> 'full_name'), ''),
  email,
  nullif(raw_user_meta_data ->> 'tier', ''),
  nullif(raw_user_meta_data ->> 'payment_method', ''),
  nullif(trim(raw_user_meta_data ->> 'payment_handle'), '')
from auth.users
on conflict (id) do nothing;
