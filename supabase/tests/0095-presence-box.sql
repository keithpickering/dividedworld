-- presence_box (supabase/migrations/0093_presence_box.sql; the forum-load plan, Task 2): the box `here` ends with, readable on its own.
-- It answers exactly what here() answers for a place, for a thread, a board and the index; it writes no row (the presence row count and
-- the caller's seen_at are unchanged); anon is refused; a missing thread, board or kind is refused as here() refuses it.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;

do $$
declare
  ann uuid := tests.account('pb-ann');
  a1 uuid := tests.character(ann, 'Box One');
  t uuid := tests.thread('Box me');
  gen uuid := (select board from threads where id = t);
  seen timestamptz;
  rows_before bigint;
  via_here jsonb;
begin
  perform tests.become(ann);
  perform here('thread', t, a1);
  perform tests.unbecome();
  seen := (select seen_at from presence where character = a1);
  rows_before := (select count(*) from presence);
  perform tests.become(ann);

  -- The same answer as here(), for each kind of place, with the mask already present.
  if presence_box('thread', t) is distinct from here('thread', t, a1) then raise exception 'a thread''s box differs from here()'; end if;
  if presence_box('board', gen) is distinct from here('board', gen, null) then raise exception 'a board''s box differs from here()'; end if;
  if presence_box('index', null) is distinct from here('index', null, null) then raise exception 'the index box differs from here()'; end if;
  if (presence_box('thread', t) -> 'names') is distinct from jsonb_build_array(jsonb_build_object('id', a1, 'name', 'Box One', 'staff', false)) then
    raise exception 'the box lists the present mask: %', presence_box('thread', t); end if;

  -- It writes nothing (the counts are read as the table's owner; the caller cannot read presence).
  perform tests.unbecome();
  if (select count(*) from presence) is distinct from rows_before then raise exception 'presence_box wrote a row'; end if;
  if (select seen_at from presence where character = a1) is distinct from seen then raise exception 'presence_box moved seen_at'; end if;

  -- Refusals.
  perform tests.become(ann);
  if pg_temp.refusal(format('select presence_box(%L, %L)', 'thread', gen_random_uuid())) is distinct from 'P0002' then raise exception 'a box of no thread'; end if;
  if pg_temp.refusal(format('select presence_box(%L, %L)', 'board', gen_random_uuid())) is distinct from 'P0002' then raise exception 'a box of no board'; end if;
  if pg_temp.refusal(format('select presence_box(%L, null)', 'room')) is distinct from 'P0002' then raise exception 'a box of no kind of place'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  if pg_temp.refusal(format('select presence_box(%L, %L)', 'thread', t)) is distinct from '42501' then raise exception 'anon reads a box'; end if;
  perform tests.unbecome();
end $$;
