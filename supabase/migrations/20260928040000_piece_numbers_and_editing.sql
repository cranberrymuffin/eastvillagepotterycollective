-- Piece numbers for shelf tags, and letting members edit unfired pieces.

-- A studio-wide piece number (#0001, #0002…). Existing pieces are numbered
-- when the column is added.
alter table public.pieces
  add column if not exists piece_number bigint generated always as identity unique;

-- Members can fix the details of their own pieces until they're fired.
grant update (title, description, length_in, width_in, height_in)
  on public.pieces to authenticated;

drop policy if exists "Members edit own unfired pieces" on public.pieces;
create policy "Members edit own unfired pieces"
  on public.pieces for update to authenticated
  using (user_id = auth.uid() and status = 'submitted')
  with check (user_id = auth.uid() and status = 'submitted');
