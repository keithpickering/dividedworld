-- A lasting move is not handed on (supabase/migrations/0171_thread_places.sql; plan Task 1). The inheritance review is of moves that expire: a Boss that
-- inherits sees the renames in force, and a lasting move (a board made, merged, or a thread moved) shapes a board all the same and is not in inheritance_due.

insert into move_kinds (key, structural, shapes_board, lasting) values ('testLasting', true, true, true);
insert into characters (name, staff, staff_kind, debuted_at) values ('Old Boss', 'li-old', 'persona', now()), ('New Boss', 'li-new', 'persona', now());
insert into threads (board, title) select id, 'Anywhere' from boards where slug = 'general';

create function pg_temp.land(kind text) returns uuid language plpgsql as $$
declare
  written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload)
  values ((select id from characters where staff = 'li-old'), 'move', (select id from threads limit 1),
          jsonb_build_object('kind', kind, 'params', jsonb_build_object('board', (select id from boards where slug = 'general')), 'body', 'landed')) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;

do $$
declare
  ordinary uuid;
  stays uuid;
begin
  insert into move_kinds (key, structural, shapes_board) values ('testOrdinary', true, true);
  ordinary := pg_temp.land('testOrdinary');
  stays := pg_temp.land('testLasting');
  -- Both shape a board and are in force, and the old Boss's are not the new one's: the ordinary one is due for review.
  if not exists (select 1 from inheritance_due('li-new') d where d.act = ordinary) then raise exception 'an ordinary board-shaping move is not due for review'; end if;
  if exists (select 1 from inheritance_due('li-new') d where d.act = stays) then raise exception 'a lasting move in force is due for review'; end if;
  -- Said the other way: the lasting flag is the only difference between them.
  update move_kinds set lasting = true where key = 'testOrdinary';
  if exists (select 1 from inheritance_due('li-new') d where d.act in (ordinary, stays)) then raise exception 'a kind marked lasting is still due for review'; end if;
  update move_kinds set lasting = false where key = 'testLasting';
  if not exists (select 1 from inheritance_due('li-new') d where d.act = stays) then raise exception 'a kind no longer lasting is not due for review'; end if;
end $$;
