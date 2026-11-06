-- presence_box: the presence box `here` ends with, readable on its own (the forum-load plan, Task 2).
-- What moved: the three box statements (a thread's, a board's, the index's) and their refusals for a missing thread, board or kind, moved
-- unchanged out of here() (0084) into presence_box(kind, place). here() keeps its signature, still validates the place and marks the
-- caller's mask as before, and ends `return presence_box(in_kind, in_place);`, so what it answers is identical.
-- The answer is computed from presence_listed, public facts, exactly as before: it reads no private fact and writes no row, so a screen
-- can read a box without being counted in it.
--
-- Ways out: no state is added; a box is a read.

create or replace function presence_box(in_kind text, in_place uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  win interval := span_interval(setting('presenceWindow'));
  cap integer := (setting('presenceNames') #>> '{}')::integer;
  at_board uuid;
  shown jsonb;
  total integer;
begin
  if in_kind = 'thread' then
    select t.board into at_board from threads t where t.id = in_place;
    if at_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  elsif in_kind = 'board' then
    select b.id into at_board from boards b where b.id = in_place;
    if at_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  elsif in_kind is distinct from 'index' then
    raise exception 'there is no such place to browse' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;

  -- The box, read by one statement per kind of place (0041). A board's box reads a staff character's rows (one per thread it posted in)
  -- as one name; the index never lists a staff character.
  if in_kind = 'thread' then
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff) order by f.place_since, f.id), '[]'::jsonb)
            from (select l.id, l.name, l.staff, l.place_since from presence_listed l
                  where l.place = in_place and l.seen_at >= now() - win order by l.place_since, l.id limit cap) f),
           (select count(*) from presence_listed l where l.place = in_place and l.seen_at >= now() - win)
      into shown, total;
  elsif in_kind = 'board' then
    with b as (
      select l.id, l.name, l.staff, min(l.place_since) as place_since from presence_listed l
      where l.board = in_place and l.seen_at >= now() - win group by l.id, l.name, l.staff),
    f as (select * from b order by b.place_since, b.id limit cap)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff) order by f.place_since, f.id), '[]'::jsonb) from f),
           (select count(*) from b)
      into shown, total;
  else
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', false) order by f.online_since, f.id), '[]'::jsonb)
            from (select l.id, l.name, l.online_since from presence_listed l
                  where not l.staff and l.seen_at >= now() - win order by l.online_since, l.id limit cap) f),
           (select count(*) from presence_listed l where not l.staff and l.seen_at >= now() - win)
      into shown, total;
  end if;
  return jsonb_build_object('names', shown, 'others', greatest(0, total - jsonb_array_length(shown)));
end $$;

revoke execute on function presence_box(text, uuid) from public, anon;
grant execute on function presence_box(text, uuid) to authenticated;

create or replace function here(in_kind text, in_place uuid, through uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  win interval := span_interval(setting('presenceWindow'));
  at_place uuid := case when in_kind = 'index' then null else in_place end;
  at_board uuid;
begin
  if in_kind = 'thread' then
    select t.board into at_board from threads t where t.id = in_place;
    if at_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  elsif in_kind = 'board' then
    select b.id into at_board from boards b where b.id = in_place;
    if at_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  elsif in_kind is distinct from 'index' then
    raise exception 'there is no such place to browse' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;

  -- This mask's row, and no other: a swap leaves the old mask to age out by its own seen_at.
  if through is not null and not presence_mask(through, caller)
     and not exists (select 1 from presence_hidden h where h.character = through) then
    insert into presence as p (character, place_kind, place, board, place_since, online_since, seen_at)
    values (through, in_kind, at_place, at_board, now(), now(), now())
    on conflict (character) do update set
      online_since = case when p.seen_at < now() - win then now() else p.online_since end,
      place_since = case when p.seen_at < now() - win or p.place_kind <> excluded.place_kind or p.place is distinct from excluded.place
                         then now() else p.place_since end,
      place_kind = excluded.place_kind, place = excluded.place, board = excluded.board, seen_at = now();
  end if;

  return presence_box(in_kind, in_place);
end $$;

revoke execute on function here(text, uuid, uuid) from public, anon;
grant execute on function here(text, uuid, uuid) to authenticated;
