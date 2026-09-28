-- East Village Pottery Collective — members bisque log
-- Applied automatically by the Supabase GitHub integration on push to main.
-- Written to be safe to re-run in case it was already applied by hand.

-- Pieces members submit for bisque firing ----------------------------------

create table if not exists public.pieces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 2000),
  length_in numeric(5, 2) not null check (length_in > 0),
  width_in numeric(5, 2) not null check (width_in > 0),
  height_in numeric(5, 2) not null check (height_in > 0),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 4),
  status text not null default 'submitted'
    check (status in ('submitted', 'bisque_fired')),
  submitted_at timestamptz not null default now()
);

create index if not exists pieces_user_id_idx on public.pieces (user_id);

alter table public.pieces enable row level security;

-- Members can read and add only their own pieces. Status changes are left to
-- the studio (done from the dashboard, which bypasses RLS).
drop policy if exists "Members read own pieces" on public.pieces;
create policy "Members read own pieces"
  on public.pieces for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Members add own pieces" on public.pieces;
create policy "Members add own pieces"
  on public.pieces for insert to authenticated
  with check (user_id = auth.uid() and status = 'submitted');

-- Members may only send the piece details; user_id, status and submitted_at
-- always come from the column defaults, so the submission date can't be faked.
revoke insert on public.pieces from anon, authenticated;
grant insert (id, title, description, length_in, width_in, height_in, photo_paths)
  on public.pieces to authenticated;

drop policy if exists "Members delete own unfired pieces" on public.pieces;
create policy "Members delete own unfired pieces"
  on public.pieces for delete to authenticated
  using (user_id = auth.uid() and status = 'submitted');

-- Photos: private bucket, one folder per member ------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'piece-photos',
  'piece-photos',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

drop policy if exists "Members upload own photos" on storage.objects;
create policy "Members upload own photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'piece-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Members read own photos" on storage.objects;
create policy "Members read own photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'piece-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Members delete own photos" on storage.objects;
create policy "Members delete own photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'piece-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
