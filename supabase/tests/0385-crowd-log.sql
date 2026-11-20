-- The log's crowd source (supabase/migrations/0385_crowd_log.sql; docs/plans/2026-11-20-crowd-pay-plan.md, Task 5): log_page's `sources.crowd` is the caller's own my_crowd_paid rows for the settlements
-- its wallet rows name, each with that settlement's window, and those Acts are named, so the log can link them. A caller sees only their own rows: another player's Acts are never in the document,
-- and a player with no crowd wallet row has no crowd source.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('cl-ann'); bob uuid := tests.account('cl-bob'); cat uuid := tests.account('cl-cat'); dan uuid := tests.account('cl-dan'); eve uuid := tests.account('cl-eve');
  a uuid := tests.character(ann, 'Cl Ann'); b uuid := tests.character(bob, 'Cl Bob'); c uuid := tests.character(cat, 'Cl Cat'); d uuid := tests.character(dan, 'Cl Dan'); e uuid := tests.character(eve, 'Cl Eve');
  t uuid := tests.thread('Cl thread');
  w1 timestamptz := coalesce((select max(ends_at) from settlements), '2030-01-01T00:00:00Z');
  w2 timestamptz := w1 + interval '1 day';
  pb1 uuid; pb2 uuid; pb3 uuid;
  said jsonb; s1 bigint; doc jsonb; mine jsonb; lone jsonb;
begin
  pb1 := tests.post(b, t, 'One.', w1 + interval '1 hour');
  pb2 := tests.post(b, t, 'Two.', w1 + interval '2 hours');
  pb3 := tests.post(b, t, 'Three.', w1 + interval '3 hours');
  update settings set value = '2' where key = 'crowdPayEach';
  update settings set value = '7' where key = 'crowdPayMost';
  -- Each of Cat's reactions was a first one in the window; Dan reacted to one Act; Eve reacted to none.
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values
    (pb1, cat, c, 'up', 1, w1 + interval '4 hours'), (pb2, cat, c, 'up', 1, w1 + interval '5 hours'), (pb3, dan, d, 'up', 1, w1 + interval '6 hours');
  said := apply_settlement(w1, w2, '[]', '{}', '[]', '[]', jsonb_build_array(
    jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb1, pb2)),
    jsonb_build_object('player', dan, 'acts', jsonb_build_array(pb3))));
  if not (said ->> 'applied')::boolean then raise exception 'the window should apply: %', said; end if;
  s1 := (said ->> 'settlement')::bigint;

  update settings set value = '2' where key = 'crowdPayMost';  -- an admin's later change, after the payment at 7
  -- Cat: her two Acts, with the window, in settlement then Act order, and both Acts named among the document's Acts. Not Dan's.
  perform tests.become(cat);
  doc := log_page(null);
  mine := doc -> 'sources' -> 'crowd';
  if jsonb_array_length(mine) is distinct from 2 then raise exception 'Cat reads her two crowd rows: %', mine; end if;
  if (select array_agg(x ->> 'act' order by ord) from jsonb_array_elements(mine) with ordinality as r(x, ord)) is distinct from (select array_agg(y::text order by y) from unnest(array[pb1, pb2]) y) then
    raise exception 'Cat''s crowd rows are her Acts, in Act order: %', mine;
  end if;
  if exists (select 1 from jsonb_array_elements(mine) x where (x ->> 'settlement')::bigint is distinct from s1 or (x ->> 'ends_at')::timestamptz is distinct from w2 or (x ->> 'starts_at')::timestamptz is distinct from w1)
     or exists (select 1 from jsonb_array_elements(mine) x where x ? 'account') then
    raise exception 'each row names the settlement and its window, and no account: %', mine;
  end if;
  -- Each row says the cap in force when it was paid (7), and an admin's later change of the setting does not move it.
  if exists (select 1 from jsonb_array_elements(log_page(null) -> 'sources' -> 'crowd') x where (x ->> 'most')::integer is distinct from 7) then
    raise exception 'each crowd row carries the cap recorded at payment (7), not today''s: %', log_page(null) -> 'sources' -> 'crowd';
  end if;
  if not exists (select 1 from jsonb_array_elements(doc -> 'acts') x where x ->> 'id' = pb1::text)
     or not exists (select 1 from jsonb_array_elements(doc -> 'acts') x where x ->> 'id' = pb2::text) then
    raise exception 'the Acts paid are among those named';
  end if;
  if exists (select 1 from jsonb_array_elements(doc -> 'acts') x where x ->> 'id' = pb3::text) then raise exception 'Cat''s document names Dan''s Act, which no line of hers names'; end if;
  -- Before the wallet row's time, no wallet row is read, so no crowd row: the source follows the wallet rows the page reads.
  if jsonb_array_length(log_page('2000-01-02T00:00:00Z') -> 'sources' -> 'crowd') is distinct from 0 then raise exception 'a page that reads no crowd wallet row reads no crowd row'; end if;

  -- Dan: his one row, never Cat's.
  perform tests.become(dan);
  lone := log_page(null) -> 'sources' -> 'crowd';
  if jsonb_array_length(lone) is distinct from 1 or lone -> 0 ->> 'act' is distinct from pb3::text then raise exception 'Dan reads his one crowd row: %', lone; end if;

  -- Eve reacted to nothing and was paid nothing: an empty source, not an absent one.
  perform tests.become(eve);
  if log_page(null) -> 'sources' -> 'crowd' is distinct from '[]'::jsonb then raise exception 'Eve reads an empty crowd source: %', log_page(null) -> 'sources' -> 'crowd'; end if;

  -- A visitor is refused, as every read of the log is.
  perform tests.become_anon();
  if pg_temp.refusal('select log_page(null)') is null then raise exception 'a visitor read the log page'; end if;
  perform tests.unbecome();
end $$;
