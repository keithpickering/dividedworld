-- Member groups in the database (supabase/migrations/0116_groups.sql; docs/plans/2026-11-06-member-groups-plan.md, Task 3):
-- `group_kinds` is the instance's ladder and the groups a move confers, seeded by seed_instance from `payload -> 'groups'`.
-- `group_now(character)` is the open conferGroup move's group, else the highest rung whose condition holds; it is read through
-- characters_public ("group"). A seed with a condition kind SQL has no case for is refused; a group a move names keeps its row.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The seed's `groups` as Divided World's ladder and favors/punishments hold them (instances/divided-world/groups.ts), flattened as
-- supabase/functions/_shared/seed.ts sends them. A seed carrying only `groups` touches nothing else.
create function pg_temp.payload(groups jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'cards', '[]'::jsonb, 'boards', '[]'::jsonb)
    || case when groups is null then '{}'::jsonb else jsonb_build_object('groups', groups) end
$$;

create function pg_temp.groups() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'members', 'name', 'Members', 'badge', 'Member', 'color', '#7a7a7a', 'source', 'ladder', 'rung', 0, 'condition', 'default'),
    jsonb_build_object('key', 'regulars', 'name', 'Regulars', 'color', '#2f6fb0', 'source', 'ladder', 'rung', 1, 'condition', 'posts', 'atLeast', 100),
    jsonb_build_object('key', 'oldGuard', 'name', 'Old Guard', 'color', '#9c6b30', 'source', 'ladder', 'rung', 2, 'condition', 'seasons', 'atLeast', 2),
    jsonb_build_object('key', 'personalityCores', 'name', 'Personality Cores', 'color', '#d4a017', 'source', 'ladder', 'rung', 3, 'condition', 'staff'),
    jsonb_build_object('key', 'trialMembers', 'name', 'Trial Members', 'color', '#d2691e', 'stripe', true, 'source', 'conferred', 'tone', 'punishment'),
    jsonb_build_object('key', 'teachersPet', 'name', 'Teacher''s Pet', 'color', '#c2408f', 'source', 'conferred', 'tone', 'favor'))
$$;

-- Settle the open season through the real path (reveal_season, which writes one season_results row per character, 0099).
create function pg_temp.settle() returns void language sql as $$
  select reveal_season((select starts_at + span_interval(setting('seasonLength')) from seasons where ends_at is null))
$$;

-- ---- The ladder, read through characters_public ----
do $$
declare
  ann uuid := tests.account('gr-ann');
  quiet uuid := tests.character(ann, 'Gr Quiet');
  busy uuid := tests.character(ann, 'Gr Busy');
  old uuid := tests.character(ann, 'Gr Old');
  once uuid := tests.character(ann, 'Gr Once');
  t uuid := tests.thread('Gr thread');
  got text;
begin
  perform seed_instance(pg_temp.payload(pg_temp.groups()));
  if (select count(*) from group_kinds) is distinct from 6 then raise exception 'the six groups did not arrive: %', (select jsonb_agg(key) from group_kinds); end if;
  if (select count(*) from group_kinds where source = 'ladder') is distinct from 4 then raise exception 'the ladder has four rungs'; end if;
  perform seed_instance(pg_temp.payload(pg_temp.groups()));
  if (select count(*) from group_kinds) is distinct from 6 then raise exception 'seeding twice changed the groups'; end if;

  -- 0 posts: the default rung.
  select "group" into got from characters_public where id = quiet;
  if got is distinct from 'members' then raise exception 'a character with no posts is in members, not %', coalesce(got, 'null'); end if;

  -- 100 posts: regulars; 99 are not.
  insert into acts (character, kind, thread, payload) select busy, 'post', t, jsonb_build_object('body', 'p' || g) from generate_series(1, 99) g;
  select "group" into got from characters_public where id = busy;
  if got is distinct from 'members' then raise exception '99 posts is still members, not %', coalesce(got, 'null'); end if;
  perform tests.post(busy, t, 'the hundredth');
  select "group" into got from characters_public where id = busy;
  if got is distinct from 'regulars' then raise exception '100 posts is regulars, not %', coalesce(got, 'null'); end if;

  -- 5 posts and reveals in 2 seasons: old guard; in 1 season, not yet.
  insert into acts (character, kind, thread, payload) select old, 'post', t, jsonb_build_object('body', 'o' || g) from generate_series(1, 4) g;
  perform tests.post(old, t, 'fifth');
  perform tests.post(once, t, 'only');
  perform pg_temp.settle();
  select "group" into got from characters_public where id = once;
  if got is distinct from 'members' then raise exception 'one season is not old guard, got %', coalesce(got, 'null'); end if;
  perform pg_temp.settle();
  select "group" into got from characters_public where id = old;
  if got is distinct from 'oldGuard' then raise exception '5 posts and 2 seasons is oldGuard, not %', coalesce(got, 'null'); end if;

  -- A staff character with no posts: the staff rung. A persona in the member office is not staff.
  insert into characters (name, staff, staff_kind, debuted_at) values ('Gr Mod', 'gr-mod', 'persona', now());
  insert into characters (name, staff, staff_kind, debuted_at) values ('Gr Former', 'gr-former', 'persona', now());
  insert into staff_offices (staff, office, cause) values ('gr-mod', 'mod', 'seed'), ('gr-former', 'member', 'seed');
  select "group" into got from characters_public where name = 'Gr Mod';
  if got is distinct from 'personalityCores' then raise exception 'a Mod with no posts is personalityCores, not %', coalesce(got, 'null'); end if;
  select "group" into got from characters_public where name = 'Gr Former';
  if got is distinct from 'members' then raise exception 'a persona in the member office is members, not %', coalesce(got, 'null'); end if;
end $$;

-- ---- A group a move confers wins over the ladder while the move is open ----
do $$
declare
  ann uuid := tests.account('gr2-ann');
  a uuid := tests.character(ann, 'Gr2 Ann');
  t uuid := tests.thread('Gr2 thread');
  bossc uuid;
  mv uuid;
  got text;
begin
  perform seed_instance(pg_temp.payload(pg_temp.groups()));
  insert into move_kinds (key, structural) values ('conferGroup', false) on conflict do nothing;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Gr2 Mod', 'gr2-mod', 'persona', now()) returning id into bossc;
  perform set_config('kayfabb.staff_writer', 'on', true);
  mv := tests.act(bossc, 'move', t, jsonb_build_object('kind', 'conferGroup', 'params', jsonb_build_object('character', a::text, 'group', 'trialMembers'), 'demand', null, 'expires_at', null));
  select "group" into got from characters_public where id = a;
  if got is distinct from 'trialMembers' then raise exception 'an open conferGroup move puts the member in its group, not %', coalesce(got, 'null'); end if;
  select "group" into got from characters_public where name = 'Gr2 Mod';
  if got is not distinct from 'trialMembers' then raise exception 'the move names one character only'; end if;
  perform set_config('kayfabb.move_end_writer', 'on', true);
  perform tests.act(null, 'move_end', t, jsonb_build_object('why', 'expired', 'by', 'tick'), mv);
  select "group" into got from characters_public where id = a;
  if got is distinct from 'members' then raise exception 'when the move ends the ladder is back, not %', coalesce(got, 'null'); end if;
end $$;

-- ---- A condition kind SQL has no case for is refused, and nothing is written (the poison) ----
do $$
declare
  poisoned jsonb := pg_temp.groups() || jsonb_build_array(
    jsonb_build_object('key', 'veterans', 'name', 'Veterans', 'color', '#123456', 'source', 'ladder', 'rung', 4, 'condition', 'years', 'atLeast', 3));
  why text;
begin
  why := pg_temp.refusal(format($q$select seed_instance(%L::jsonb)$q$, pg_temp.payload(poisoned)::text));
  if why is null then raise exception 'a seed with an unknown condition kind was accepted'; end if;
  if why not like '%years%' then raise exception 'the refusal does not name the unknown kind: %', why; end if;
  if exists (select 1 from group_kinds where key = 'veterans') then raise exception 'a refused seed wrote a group'; end if;
  -- And the table itself holds the line for a hand-written row.
  if pg_temp.refusal($q$insert into group_kinds (key, name, color, source, rung, condition) values ('x', 'X', '#000000', 'ladder', 9, 'years')$q$) is null then
    raise exception 'group_kinds took an unknown condition kind';
  end if;
  if pg_temp.refusal($q$insert into group_kinds (key, name, color, source, tone) values ('x', 'X', '#000000', 'conferred', 'meh')$q$) is null then
    raise exception 'group_kinds took a tone that is neither punishment nor favor';
  end if;
  if pg_temp.refusal($q$insert into group_kinds (key, name, color, source, rung, condition, tone) values ('x', 'X', '#000000', 'conferred', 1, 'default', 'favor')$q$) is null then
    raise exception 'a conferred group took a rung and a condition';
  end if;
  if pg_temp.refusal($q$insert into group_kinds (key, name, color, source) values ('x', 'X', '#000000', 'ladder')$q$) is null then
    raise exception 'a rung took no rung number and no condition';
  end if;
  if pg_temp.refusal($q$insert into group_kinds (key, name, color, source, rung, condition) values ('x', 'X', '#000000', 'ladder', 1, 'posts')$q$) is null then
    raise exception 'a posts condition took no at_least';
  end if;
end $$;

-- ---- Dropping a group: a free one goes, one a move names keeps its row ----
do $$
declare
  ann uuid := tests.account('gr3-ann');
  a uuid := tests.character(ann, 'Gr3 Ann');
  t uuid := tests.thread('Gr3 thread');
  bossc uuid;
  mv uuid;
  kept jsonb;
  ghost jsonb := jsonb_build_object('key', 'ghostGroup', 'name', 'Ghost Group', 'color', '#101010', 'source', 'conferred', 'tone', 'favor');
  meeting bigint;
  got text;
begin
  perform seed_instance(pg_temp.payload(pg_temp.groups() || jsonb_build_array(ghost)));
  insert into move_kinds (key, structural) values ('conferGroup', false) on conflict do nothing;
  insert into demand_kinds (key) values ('postsOnBoard') on conflict do nothing;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Gr3 Mod', 'gr3-mod', 'persona', now()) returning id into bossc;
  -- A pending queued favor naming teachersPet, queued validly (a Boss's, through the guard): the Boss of the open season, a character who has debuted, a check between go-live and expiry.
  insert into characters (name, staff, staff_kind, debuted_at) values ('Gr3 Boss', 'gr3-boss', 'persona', now());
  update seasons set boss = 'gr3-boss' where ends_at is null;
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into meeting;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (meeting, 'gr3-boss', 'conferGroup', jsonb_build_object('character', a::text, 'group', 'teachersPet', 'checkAt', (now() + interval '1 day')::text),
    jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', (select id from boards where slug = 'general'), 'count', 1)),
    'a favor', now() + interval '1 hour', now() + interval '3 days', false);
  perform set_config('kayfabb.staff_writer', 'on', true);
  mv := tests.act(bossc, 'move', t, jsonb_build_object('kind', 'conferGroup', 'params', jsonb_build_object('character', a::text, 'group', 'trialMembers'), 'demand', null, 'expires_at', null));
  -- The new seed lists none of trialMembers (a landed move names it), teachersPet (a queued, unlanded move names it) and ghostGroup (nothing does).
  kept := (select jsonb_agg(g) from jsonb_array_elements(pg_temp.groups()) g where g ->> 'key' not in ('trialMembers', 'teachersPet'));
  perform seed_instance(pg_temp.payload(kept));
  if not exists (select 1 from group_kinds where key = 'trialMembers') then raise exception 'a group a move names lost its row'; end if;
  if not exists (select 1 from group_kinds where key = 'teachersPet') then raise exception 'a group a queued, unlanded move names lost its row'; end if;
  if exists (select 1 from group_kinds where key = 'ghostGroup') then raise exception 'a group no move names was kept'; end if;
  -- A payload with no `groups` key leaves the groups as they are.
  perform seed_instance(pg_temp.payload());
  if (select count(*) from group_kinds) is distinct from 6 then raise exception 'a seed without groups changed them: %', (select count(*) from group_kinds); end if;
end $$;

-- ---- An instance may reorder its rungs: a reseed with two swapped lands whole ----
do $$
declare
  swapped jsonb;
begin
  perform seed_instance(pg_temp.payload(pg_temp.groups()));
  select jsonb_agg(case g ->> 'key' when 'regulars' then g || '{"rung": 2}' when 'oldGuard' then g || '{"rung": 1}' else g end order by ord)
    into swapped from jsonb_array_elements(pg_temp.groups()) with ordinality t(g, ord);
  perform seed_instance(pg_temp.payload(swapped));
  if (select rung from group_kinds where key = 'oldGuard') is distinct from 1 or (select rung from group_kinds where key = 'regulars') is distinct from 2 then
    raise exception 'the swapped rungs did not land: %', (select jsonb_agg(key || ':' || rung order by rung) from group_kinds where source = 'ladder');
  end if;
end $$;

-- ---- screen_settings carries the groups' looks and no client can read group_kinds ----
do $$
declare
  ann uuid := tests.account('gr4-ann');
  seen jsonb;
begin
  perform seed_instance(pg_temp.payload(pg_temp.groups()));
  perform tests.become(ann);
  select settings -> 'groups' into seen from screen_settings;
  if jsonb_array_length(seen) is distinct from 6 then raise exception 'screen_settings carries all six groups: %', seen; end if;
  if seen -> 0 is distinct from jsonb_build_object('key', 'members', 'name', 'Members', 'badge', 'Member', 'color', '#7a7a7a', 'stripe', false, 'staff', false) then
    raise exception 'the lowest rung comes first with its look: %', seen -> 0;
  end if;
  if seen -> 1 ? 'badge' then raise exception 'a group with no badge carries none: %', seen -> 1; end if;
  if (seen -> 5 ->> 'key') is distinct from 'trialMembers' or (seen -> 5 -> 'stripe') is distinct from 'true'::jsonb then raise exception 'conferred groups follow the ladder, by key: %', seen; end if;
  if (select count(*) from jsonb_array_elements(seen) g where (g ->> 'staff')::boolean) is distinct from 1 or (select g ->> 'key' from jsonb_array_elements(seen) g where (g ->> 'staff')::boolean) is distinct from 'personalityCores' then raise exception 'screen_settings marks the staff rung, and only it: %', seen; end if;
  if pg_temp.refusal($q$select * from group_kinds$q$) is null then raise exception 'a signed-in player read group_kinds'; end if;
  perform tests.unbecome();
end $$;

-- ---- group_now's reads are index reads: the settled-seasons count uses season_results_by_character, the post count and the move probe are keyed ----
-- EXPLAINed with the sequential scan off, as 0035 does: on a table this small it would be scanned whatever the indexes were, so the question is whether the index can be used.
do $$
declare
  ann uuid := tests.account('gr5-ann');
  a uuid := tests.character(ann, 'Gr5 Ann');
  ln record;
  plan text;
begin
  set local enable_seqscan = off;
  plan := '';
  for ln in execute format('explain select count(*) from season_results x where x.character = %L', a::text) loop
    plan := plan || E'\n' || ln."QUERY PLAN";
  end loop;
  if plan not like '%season_results_by_character%' then raise exception 'the settled-seasons count is not read from season_results_by_character: %', plan; end if;
  plan := '';
  for ln in execute format('explain select a.payload from open_moves o join acts a on a.id = o.move_act where a.payload ->> %L = %L and a.payload #>> %L = %L', 'kind', 'conferGroup', '{params,character}', a::text) loop
    plan := plan || E'\n' || ln."QUERY PLAN";
  end loop;
  if plan not like '%open_moves%' or plan like '%Seq Scan on acts%' then raise exception 'the move probe starts from open_moves and reads each Act by key: %', plan; end if;
  set local enable_seqscan = on;
end $$;
