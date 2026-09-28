-- Members home: posts, comments, likes and a shared calendar with RSVPs.
-- Studio admins (profiles.is_admin, set in the dashboard) can remove
-- anything and post official studio events.

-- Admins ------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

-- Members see each other's names, not emails or payment details. This view
-- runs with its owner's rights, so it can read every profile even though
-- profiles' own policy only shows members their own row.
create or replace view public.member_names as
  select id, full_name, pronouns, is_admin from public.profiles;

revoke all on public.member_names from anon, public;
grant select on public.member_names to authenticated;

-- Posts -------------------------------------------------------------------

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.profiles on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists posts_touch_updated_at on public.posts;
create trigger posts_touch_updated_at
  before update on public.posts
  for each row execute function public.touch_updated_at();

-- Comments ----------------------------------------------------------------

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists comments_post_id_idx on public.comments (post_id, created_at);

-- Likes -------------------------------------------------------------------

create table if not exists public.post_likes (
  post_id uuid not null references public.posts on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- Calendar ----------------------------------------------------------------

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references public.profiles on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text check (char_length(description) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz check (ends_at >= starts_at),
  is_studio_event boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists events_starts_at_idx on public.events (starts_at);

create table if not exists public.event_rsvps (
  event_id uuid not null references public.events on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- Access ------------------------------------------------------------------
-- Only logged-in members can see or change anything here. Column grants
-- mean ids, authors and timestamps always come from the defaults.

alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;

revoke all on public.posts, public.comments, public.post_likes,
  public.events, public.event_rsvps from anon;
revoke insert, update on public.posts, public.comments, public.post_likes,
  public.events, public.event_rsvps from authenticated;

grant insert (body), update (body) on public.posts to authenticated;
grant insert (post_id, body) on public.comments to authenticated;
grant insert (post_id) on public.post_likes to authenticated;
grant insert (title, description, starts_at, ends_at, is_studio_event),
  update (title, description, starts_at, ends_at, is_studio_event)
  on public.events to authenticated;
grant insert (event_id) on public.event_rsvps to authenticated;

-- posts
drop policy if exists "Members read posts" on public.posts;
create policy "Members read posts" on public.posts
  for select to authenticated using (true);

drop policy if exists "Members add own posts" on public.posts;
create policy "Members add own posts" on public.posts
  for insert to authenticated with check (author_id = auth.uid());

drop policy if exists "Members edit own posts" on public.posts;
create policy "Members edit own posts" on public.posts
  for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "Authors and admins delete posts" on public.posts;
create policy "Authors and admins delete posts" on public.posts
  for delete to authenticated using (author_id = auth.uid() or public.is_admin());

-- comments
drop policy if exists "Members read comments" on public.comments;
create policy "Members read comments" on public.comments
  for select to authenticated using (true);

drop policy if exists "Members add own comments" on public.comments;
create policy "Members add own comments" on public.comments
  for insert to authenticated with check (author_id = auth.uid());

drop policy if exists "Authors and admins delete comments" on public.comments;
create policy "Authors and admins delete comments" on public.comments
  for delete to authenticated using (author_id = auth.uid() or public.is_admin());

-- likes
drop policy if exists "Members read likes" on public.post_likes;
create policy "Members read likes" on public.post_likes
  for select to authenticated using (true);

drop policy if exists "Members like as themselves" on public.post_likes;
create policy "Members like as themselves" on public.post_likes
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Members unlike their own likes" on public.post_likes;
create policy "Members unlike their own likes" on public.post_likes
  for delete to authenticated using (user_id = auth.uid());

-- events: anyone can add member events; only admins add studio events.
drop policy if exists "Members read events" on public.events;
create policy "Members read events" on public.events
  for select to authenticated using (true);

drop policy if exists "Members add events" on public.events;
create policy "Members add events" on public.events
  for insert to authenticated
  with check (created_by = auth.uid() and (not is_studio_event or public.is_admin()));

drop policy if exists "Creators and admins edit events" on public.events;
create policy "Creators and admins edit events" on public.events
  for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (not is_studio_event or public.is_admin());

drop policy if exists "Creators and admins delete events" on public.events;
create policy "Creators and admins delete events" on public.events
  for delete to authenticated using (created_by = auth.uid() or public.is_admin());

-- RSVPs
drop policy if exists "Members read RSVPs" on public.event_rsvps;
create policy "Members read RSVPs" on public.event_rsvps
  for select to authenticated using (true);

drop policy if exists "Members RSVP as themselves" on public.event_rsvps;
create policy "Members RSVP as themselves" on public.event_rsvps
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Members cancel their own RSVPs" on public.event_rsvps;
create policy "Members cancel their own RSVPs" on public.event_rsvps
  for delete to authenticated using (user_id = auth.uid());
