-- Seeding a changed reaction set (supabase/migrations/0082_seed_reaction_kinds.sql; design
-- docs/plans/2026-11-05-reaction-set-design.md, section 3): a payload that carries `reactions` names the
-- instance's whole set. A kind it drops that nothing uses is deleted; one a reaction or a tally uses stops the seed,
-- and nothing is written; a payload with no `reactions` key leaves the kinds as they are.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- A minimal seed payload, with the given reactions list, or none.
create function pg_temp.payload(reactions jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'cards', '[]'::jsonb, 'boards', '[]'::jsonb)
    || case when reactions is null then '{}'::jsonb else jsonb_build_object('reactions', reactions) end
$$;

create function pg_temp.kind(key text, emoji text, quadrant text) returns jsonb language sql as $$
  select jsonb_build_object('key', key, 'emoji', emoji, 'quadrant', quadrant)
$$;

-- Each case seeds the fixture's kinds afresh: a savepoint around it puts them back, since a seed here deletes some.

-- ---- A dropped kind that nothing uses is deleted ----
savepoint kinds_1;
do $$
declare
  list jsonb := jsonb_build_array(pg_temp.kind('up', '⬆️', 'excitedPositive'), pg_temp.kind('boo', '👻', 'excitedNegative'),
    pg_temp.kind('calm', '🌊', 'calmPositive'), pg_temp.kind('meh', '😑', 'boredNegative'), pg_temp.kind('zing', '💥', 'excitedPositive'));
  first jsonb;
  second jsonb;
begin
  first := seed_instance(pg_temp.payload(list));
  second := seed_instance(pg_temp.payload(list));
  if exists (select 1 from reaction_kinds where key = 'wow') then raise exception 'a dropped kind nothing uses was kept'; end if;
  if (select count(*) from reaction_kinds where key in ('up', 'boo', 'calm', 'meh', 'zing')) is distinct from 5 then
    raise exception 'the listed kinds did not all arrive';
  end if;
  if first is distinct from second then raise exception 'seeding twice changed something: % then %', first, second; end if;
end $$;
rollback to savepoint kinds_1;

-- ---- A dropped kind that a reaction uses stops the seed, and nothing is written ----
savepoint kinds_2;
do $$
declare
  ann uuid := tests.account('rk-ann');
  bob uuid := tests.account('rk-bob');
  a uuid := tests.character(ann, 'Rk Ann');
  b uuid := tests.character(bob, 'Rk Bob');
  t uuid := tests.thread('Rk thread');
  p uuid := tests.post(a, t);
  list jsonb := jsonb_build_array(pg_temp.kind('up', '⬆️', 'excitedPositive'), pg_temp.kind('boo', '👻', 'excitedNegative'),
    pg_temp.kind('calm', '🌊', 'calmPositive'), pg_temp.kind('meh', '😑', 'boredNegative'), pg_temp.kind('zing', '💥', 'excitedPositive'));
  why text;
begin
  insert into reactions (act, reactor_account, reactor_character, kind, slot) values (p, bob, b, 'wow', 1);
  insert into reaction_tallies (act, kind, count) values (p, 'wow', 1);
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', pg_temp.payload(list)));
  if why is null or why not like '%wow (1 reactions)%' or why not like '%#216%' then
    raise exception 'a used kind was dropped without the seed saying so: %', why;
  end if;
  if exists (select 1 from reaction_kinds where key = 'zing') then raise exception 'a refused seed still wrote a kind'; end if;
  if not exists (select 1 from reaction_kinds where key = 'wow') then raise exception 'a refused seed removed the used kind'; end if;
end $$;
rollback to savepoint kinds_2;

-- ---- A tally alone counts as used ----
-- A kind of its own: a committed race file's reactions may already use the fixture's.
savepoint kinds_3;
do $$
declare
  ann uuid := tests.account('rt-ann');
  a uuid := tests.character(ann, 'Rt Ann');
  t uuid := tests.thread('Rt thread');
  p uuid := tests.post(a, t);
  list jsonb := jsonb_build_array(pg_temp.kind('up', '⬆️', 'excitedPositive'), pg_temp.kind('boo', '👻', 'excitedNegative'),
    pg_temp.kind('calm', '🌊', 'calmPositive'), pg_temp.kind('meh', '😑', 'boredNegative'), pg_temp.kind('wow', '🎆', 'excitedPositive'));
  why text;
begin
  insert into reaction_kinds (key, emoji, quadrant) values ('idle', '💤', 'calmPositive');
  insert into reaction_tallies (act, kind, count) values (p, 'idle', 0);
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', pg_temp.payload(list)));
  if why is null or why not like '%idle (0 reactions)%' then
    raise exception 'a kind with a tally and no reactions was dropped: %', why;
  end if;
  if not exists (select 1 from reaction_kinds where key = 'idle') then raise exception 'the tallied kind was removed'; end if;
end $$;
rollback to savepoint kinds_3;

-- ---- An emoji can move to a new key ----
-- From a kind of its own, as the fixture's meh is used by a committed race file's reactions.
savepoint kinds_4;
do $$
declare
  list jsonb := jsonb_build_array(pg_temp.kind('up', '⬆️', 'excitedPositive'), pg_temp.kind('boo', '👻', 'excitedNegative'),
    pg_temp.kind('calm', '🌊', 'calmPositive'), pg_temp.kind('meh', '😑', 'boredNegative'), pg_temp.kind('wow', '🎆', 'excitedPositive'),
    pg_temp.kind('flat', '🫤', 'boredNegative'));
begin
  insert into reaction_kinds (key, emoji, quadrant) values ('tepid', '🫤', 'boredNegative');
  perform seed_instance(pg_temp.payload(list));
  if (select emoji from reaction_kinds where key = 'flat') is distinct from '🫤' then raise exception 'the new key did not take the emoji'; end if;
  if exists (select 1 from reaction_kinds where key = 'tepid') then raise exception 'the old key kept its place'; end if;
end $$;
rollback to savepoint kinds_4;

-- ---- A payload with no reactions key leaves every kind ----
savepoint kinds_5;
do $$
begin
  perform seed_instance(pg_temp.payload());
  if (select count(*) from reaction_kinds where key in ('up', 'boo', 'calm', 'meh', 'wow')) is distinct from 5 then
    raise exception 'a seed with no reactions key removed a kind';
  end if;
end $$;
rollback to savepoint kinds_5;

-- ---- An element with no key does not hide a used kind ----
-- Under `not in`, the element's null key made every kind look listed: the refusal found nothing and the seed failed later,
-- on the key's not-null, with no word of the kind in use.
savepoint kinds_6;
do $$
declare
  ann uuid := tests.account('rn-ann');
  bob uuid := tests.account('rn-bob');
  a uuid := tests.character(ann, 'Rn Ann');
  b uuid := tests.character(bob, 'Rn Bob');
  t uuid := tests.thread('Rn thread');
  p uuid := tests.post(a, t);
  list jsonb := jsonb_build_array(pg_temp.kind('up', '⬆️', 'excitedPositive'), pg_temp.kind('boo', '👻', 'excitedNegative'),
    pg_temp.kind('calm', '🌊', 'calmPositive'), pg_temp.kind('meh', '😑', 'boredNegative'),
    jsonb_build_object('emoji', '💥', 'quadrant', 'excitedPositive'));
  why text;
begin
  insert into reactions (act, reactor_account, reactor_character, kind, slot) values (p, bob, b, 'wow', 1);
  insert into reaction_tallies (act, kind, count) values (p, 'wow', 1);
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', pg_temp.payload(list)));
  if why is null or why not like '%wow (1 reactions)%' then
    raise exception 'an element with no key hid the used kind from the refusal: %', why;
  end if;
  if not exists (select 1 from reaction_kinds where key = 'wow') then raise exception 'a refused seed removed the used kind'; end if;
end $$;
rollback to savepoint kinds_6;
