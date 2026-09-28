-- Kiln workflow: the studio moves pieces from "ready for bisque" (submitted)
-- to "in the kiln" to "ready for pickup". Replaces the single
-- "bisque_fired" status.

alter table public.pieces drop constraint if exists pieces_status_check;

update public.pieces set status = 'ready_for_pickup' where status = 'bisque_fired';

alter table public.pieces
  add constraint pieces_status_check
  check (status in ('submitted', 'in_kiln', 'ready_for_pickup'));

-- bisque_fired_at now records when the firing finished: the piece became
-- ready for pickup.
create or replace function public.stamp_bisque_fired_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'ready_for_pickup' and new.bisque_fired_at is null then
    new.bisque_fired_at := now();
  elsif new.status <> 'ready_for_pickup' then
    new.bisque_fired_at := null;
  end if;
  return new;
end;
$$;

-- Only admins change a piece's status. Members' own update policy still
-- requires status = 'submitted' before and after, so they can't move it.
grant update (status) on public.pieces to authenticated;

drop policy if exists "Admins update piece status" on public.pieces;
create policy "Admins update piece status"
  on public.pieces for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
