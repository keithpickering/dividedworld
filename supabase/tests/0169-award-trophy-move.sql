-- The Boss's AWARD_TROPHY move (supabase/migrations/0208_award_trophy_move.sql; the cosmetics plan, Task 5; engine/system/moves.ts holds the same limits for the meeting).
--
-- 1. A landed move writes one `boss` award naming its Act, ends at once (`spent`), and the trophy shows on the character with the Boss named in plain words.
-- 2. The limits at landing: a second award of a non-belt trophy to one character this season, a belt to its holder, a trophy off the Boss's list, a staff character, a retired
--    one and a move with a demand are each refused for good (the queue row says why, no Act and no award is written, the move is not in force). A trophy an admin took back may be given again.
--    (Poison: trophy_award_problem answering null. The test is red on every refusal.)
-- 3. A belt award moves the belt: the lineage is in order, the first holder no longer holds it, and reversing the latest returns it.
-- 4. The meeting's readers (boss_trophies, trophy_award_facts) say what the engine's repair needs and are the service role's alone.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

select tests.unbecome();
do $$
declare
  catalog jsonb := jsonb_build_object('kinds', jsonb_build_array(
      jsonb_build_object('key', 'aw-champion', 'name', 'Champion'), jsonb_build_object('key', 'aw-runner-up', 'name', 'Runner-Up'), jsonb_build_object('key', 'aw-third', 'name', 'Third'),
      jsonb_build_object('key', 'aw-pet', 'name', 'Pet'), jsonb_build_object('key', 'aw-belt', 'name', 'The Belt', 'belt', true), jsonb_build_object('key', 'aw-met', 'name', 'Met It')),
    'seasonPlaces', jsonb_build_array('aw-champion', 'aw-runner-up', 'aw-third'), 'boss', jsonb_build_array('aw-pet', 'aw-belt'), 'demandMet', 'aw-met');
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true,
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.')),
      'systemMoveWords', jsonb_build_object('awardTrophy', 'the giving of the {trophyName} trophy to {characterName}')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'aw-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'aw-boss', 'name', 'Aw Boss', 'title', 'Boss', 'signature', 'a')),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'awardTrophy', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss'), 'derived', jsonb_build_array('trophyName', 'characterName'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'))),
    'trophies', catalog));
  perform tests.account('aw-ann'); perform tests.account('aw-bob'); perform tests.account('aw-cat'); perform tests.account('aw-dan'); perform tests.account('aw-adm');
  perform tests.character(tests.account('aw-ann2'), 'Aw Ann');
end $$;

create function pg_temp.ch(label text) returns uuid language sql as $$ select id from characters where name = label $$;
create function pg_temp.queue(trophy text, of_character uuid, demand jsonb default null) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
  live timestamptz := now() - interval '1 minute';
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'aw-boss', 'awardTrophy', jsonb_build_object('trophy', trophy, 'character', of_character), demand, 'because', live, live + interval '24 hours', false) returning id into q;
  return q;
end $$;
create function pg_temp.land(q bigint) returns queued_moves language plpgsql as $$
declare r queued_moves;
begin
  perform system_tick();
  select * into r from queued_moves where id = q;
  return r;
end $$;
create function pg_temp.move_acts() returns bigint language sql as $$ select count(*) from acts where kind = 'move' and payload ->> 'kind' = 'awardTrophy' $$;
create function pg_temp.standing(of_character uuid, kind text) returns bigint language sql as $$
  select count(*) from trophy_awards a where a.character = of_character and a.trophy = kind and not exists (select 1 from trophy_reversals r where r.award = a.id)
$$;

-- ---- 1. A landed move writes one award and ends at once ----
do $$
declare
  ann uuid := pg_temp.ch('Aw Ann');
  q bigint;
  got queued_moves;
  shown jsonb;
begin
  q := pg_temp.queue('aw-pet', ann);
  got := pg_temp.land(q);
  perform pg_temp.expect(got.landed_act is not null and got.refused_at is null, 'the move landed: ' || coalesce(got.failure, 'no failure'));
  perform pg_temp.expect((select count(*) from trophy_awards where character = ann and trophy = 'aw-pet' and by = 'boss' and act = got.landed_act) = 1, 'one boss award names the move''s Act');
  perform pg_temp.expect((select count(*) from trophy_awards where act = got.landed_act) = 1, 'the move wrote one award and no other');
  perform pg_temp.expect((select payload ->> 'why' from acts where kind = 'move_end' and target_act_id = got.landed_act) = 'spent', 'the move ended at once, spent');
  perform pg_temp.expect(not exists (select 1 from open_moves where move_act = got.landed_act), 'the move is not in force');
  perform pg_temp.expect((select payload ->> 'body' from acts where id = got.landed_act) = 'It is done: the giving of the Pet trophy to Aw Ann.', 'the announcement names the trophy and the character: ' || (select payload ->> 'body' from acts where id = got.landed_act));
  shown := trophies_of(ann) -> 'awards' -> 0;
  perform pg_temp.expect(shown ->> 'trophy' = 'aw-pet' and shown ->> 'by' = 'Aw Boss, the Boss', 'the trophy shows, given by the Boss in plain words: ' || shown::text);
  perform pg_temp.expect(shown -> 'move' = (select jsonb_build_object('act', x.id, 'thread', x.thread, 'seq', x.seq) from acts_public x where x.id = got.landed_act) and shown -> 'move' ->> 'seq' is not null, 'the award links to the move: ' || shown::text);
end $$;

-- ---- 2. The limits at landing ----
do $$
declare
  ann uuid := pg_temp.ch('Aw Ann');
  boss uuid := (select id from characters where staff = 'aw-boss');
  bob uuid := tests.character(tests.account('aw-bob2'), 'Aw Bob');
  cat uuid := tests.character(tests.account('aw-cat2'), 'Aw Cat');
  waiting uuid;
  q bigint;
  got queued_moves;
  moves_before bigint;
  awards_before bigint;
  adm uuid := (select id from auth.users where email = 'aw-adm@test.invalid');
  first_award uuid;
  kind text;
begin
  -- A second award of a non-belt trophy to the same character this season.
  moves_before := pg_temp.move_acts();
  awards_before := (select count(*) from trophy_awards);
  q := pg_temp.queue('aw-pet', ann);
  got := pg_temp.land(q);
  perform pg_temp.expect(got.refused_at is not null and got.landed_act is null and got.failure like 'that trophy cannot be given: %already given%season%', 'a second award this season was not refused: ' || coalesce(got.failure, 'it landed'));
  perform pg_temp.expect(pg_temp.move_acts() = moves_before and (select count(*) from trophy_awards) = awards_before, 'a refused award wrote no Act and no award');
  perform pg_temp.expect(pg_temp.standing(ann, 'aw-pet') = 1, 'one Pet stands');
  -- A trophy off the Boss's list (a season's place and the met demand's kind are not the Boss's to give), and one that does not exist.
  foreach kind in array array['aw-champion', 'aw-met', 'aw-nothing'] loop
    got := pg_temp.land(pg_temp.queue(kind, bob));
    perform pg_temp.expect(got.refused_at is not null and got.failure like '%not one the Boss gives%', 'a trophy off the list was not refused: ' || coalesce(got.failure, 'it landed'));
  end loop;
  perform pg_temp.expect(not exists (select 1 from trophy_awards where character = bob), 'nothing was given to Bob');
  -- A staff character, a retired one, one that has not debuted, and a move with a demand.
  got := pg_temp.land(pg_temp.queue('aw-pet', boss));
  perform pg_temp.expect(got.refused_at is not null and got.failure like '%staff character is never given%', 'a staff character was not refused: ' || coalesce(got.failure, 'it landed'));
  update characters set retired_at = now() where id = cat;
  got := pg_temp.land(pg_temp.queue('aw-pet', cat));
  perform pg_temp.expect(got.refused_at is not null and got.failure like '%retired character is never given%', 'a retired character was not refused: ' || coalesce(got.failure, 'it landed'));
  insert into characters (owner, name) values (tests.account('aw-dan2'), 'Aw Waiting') returning id into waiting;
  got := pg_temp.land(pg_temp.queue('aw-pet', waiting));
  perform pg_temp.expect(got.refused_at is not null and got.failure like '%not debuted%', 'a character that has not debuted was not refused: ' || coalesce(got.failure, 'it landed'));
  got := pg_temp.land(pg_temp.queue('aw-pet', bob, jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', (select id from boards limit 1), 'count', 1))));
  perform pg_temp.expect(got.refused_at is not null and got.failure like '%carries no demand%', 'a move with a demand was not refused: ' || coalesce(got.failure, 'it landed'));
  perform pg_temp.expect(pg_temp.move_acts() = moves_before and (select count(*) from trophy_awards) = awards_before, 'no refusal wrote an Act or an award');
  -- A refused row is final: another tick leaves it as it is.
  perform system_tick();
  perform pg_temp.expect(pg_temp.move_acts() = moves_before, 'a refused move is not tried again');
  -- An award an admin took back no longer stands, so the trophy may be given again.
  select id into first_award from trophy_awards where character = ann and trophy = 'aw-pet';
  insert into admins (account) values (adm);
  perform tests.become(adm);
  perform reverse_award(first_award);
  perform tests.unbecome();
  got := pg_temp.land(pg_temp.queue('aw-pet', ann));
  perform pg_temp.expect(got.landed_act is not null and pg_temp.standing(ann, 'aw-pet') = 1, 'after a taking back the trophy is given again: ' || coalesce(got.failure, 'no failure'));
  perform pg_temp.expect((select count(*) from trophy_awards where character = ann and trophy = 'aw-pet') = 2, 'both awards are kept');
end $$;

-- ---- 3. A belt award moves the belt ----
do $$
declare
  ann uuid := pg_temp.ch('Aw Ann');
  bob uuid := pg_temp.ch('Aw Bob');
  got queued_moves;
  lineage jsonb;
  last_award uuid;
  adm uuid := (select id from auth.users where email = 'aw-adm@test.invalid');
begin
  got := pg_temp.land(pg_temp.queue('aw-belt', ann));
  perform pg_temp.expect(got.landed_act is not null, 'a belt is given: ' || coalesce(got.failure, 'no failure'));
  got := pg_temp.land(pg_temp.queue('aw-belt', bob));
  perform pg_temp.expect(got.landed_act is not null, 'a belt passes to a second character: ' || coalesce(got.failure, 'no failure'));
  lineage := belt_lineage('aw-belt');
  perform pg_temp.expect(jsonb_array_length(lineage -> 'reigns') = 2 and lineage #>> '{reigns,1,name}' = 'Aw Ann' and lineage #>> '{reigns,0,name}' = 'Aw Bob' and lineage #>> '{reigns,0,ended}' is null and lineage #>> '{reigns,1,ended}' is not null, 'the lineage is newest first: ' || lineage::text);
  perform pg_temp.expect(lineage #>> '{reigns,0,by}' = 'Aw Boss, the Boss' and lineage #>> '{reigns,1,by}' = 'Aw Boss, the Boss', 'a reign says the Boss gave it: ' || lineage::text);
  perform pg_temp.expect((select (t ->> 'held')::boolean from jsonb_array_elements(trophies_of(ann) -> 'awards') t where t ->> 'trophy' = 'aw-belt') is false, 'the first holder no longer holds it');
  perform pg_temp.expect((select (t ->> 'held')::boolean from jsonb_array_elements(trophies_of(bob) -> 'awards') t where t ->> 'trophy' = 'aw-belt') is true, 'the second holds it');
  -- A belt is not given to its holder; it may go back to one who held it.
  got := pg_temp.land(pg_temp.queue('aw-belt', bob));
  perform pg_temp.expect(got.refused_at is not null and got.failure like '%already holds the belt%', 'a belt to its holder was not refused: ' || coalesce(got.failure, 'it landed'));
  -- Reversing the latest returns the belt to the one before; and then it may be given to Bob again.
  select a.id into last_award from trophy_awards a where a.trophy = 'aw-belt' and a.character = bob;
  perform tests.become(adm);
  perform reverse_award(last_award);
  perform tests.unbecome();
  perform pg_temp.expect((select (t ->> 'held')::boolean from jsonb_array_elements(trophies_of(ann) -> 'awards') t where t ->> 'trophy' = 'aw-belt') is true, 'a taking back returns the belt');
  got := pg_temp.land(pg_temp.queue('aw-belt', bob));
  perform pg_temp.expect(got.landed_act is not null, 'the belt may be given to a character whose reign was taken back: ' || coalesce(got.failure, 'no failure'));
end $$;

-- ---- 4. The meeting's readers ----
do $$
declare
  ann uuid := pg_temp.ch('Aw Ann');
  bob uuid := pg_temp.ch('Aw Bob');
  boss uuid := (select id from characters where staff = 'aw-boss');
  cat uuid := pg_temp.ch('Aw Cat');
  list jsonb := boss_trophies();
  facts jsonb;
begin
  perform pg_temp.expect((select string_agg(e ->> 'key', ',' order by e ->> 'key') from jsonb_array_elements(list) e) = 'aw-belt,aw-pet', 'the Boss''s list is the instance''s: ' || list::text);
  perform pg_temp.expect((select e -> 'holder' ->> 'name' from jsonb_array_elements(list) e where e ->> 'key' = 'aw-belt') = 'Aw Bob', 'a belt names its holder');
  perform pg_temp.expect((select jsonb_typeof(e -> 'holder') from jsonb_array_elements(list) e where e ->> 'key' = 'aw-pet') = 'null', 'a trophy that is not a belt has no holder');
  facts := trophy_award_facts(jsonb_build_array(
    jsonb_build_object('trophy', 'aw-pet', 'character', ann), jsonb_build_object('trophy', 'aw-pet', 'character', bob),
    jsonb_build_object('trophy', 'aw-pet', 'character', boss), jsonb_build_object('trophy', 'aw-pet', 'character', cat),
    jsonb_build_object('trophy', 'aw-belt', 'character', ann), jsonb_build_object('trophy', 'aw-pet', 'character', 'nonsense')));
  perform pg_temp.expect(facts -> 'given' = jsonb_build_array('aw-pet:' || ann), 'only a standing non-belt award this season is given: ' || facts::text);
  perform pg_temp.expect((select string_agg(x, ',' order by x) from jsonb_array_elements_text(facts -> 'barred') x) = (select string_agg(x::text, ',' order by x::text) from unnest(array[boss, cat]) x), 'staff and retired are barred: ' || facts::text);
  perform pg_temp.expect(trophy_award_facts(null) = '{"given": [], "barred": []}'::jsonb, 'no awards, nothing named');
  -- A belt's holder who has not debuted is not named: no award reaches one by the Boss or by the admin's hand, but a row written any other way must not put a mask in the reference text.
  perform pg_temp.expect((select e -> 'holder' ->> 'name' from jsonb_array_elements(list) e where e ->> 'key' = 'aw-belt') = 'Aw Bob', 'a debuted holder is named');
  insert into characters (owner, name) values (tests.account('aw-hid'), 'Aw Hidden');
  insert into trophy_awards (trophy, character, by, at) values ('aw-belt', pg_temp.ch('Aw Hidden'), 'admin', now() + interval '1 second');
  list := boss_trophies();
  perform pg_temp.expect((select e -> 'holder' from jsonb_array_elements(list) e where e ->> 'key' = 'aw-belt') = 'null'::jsonb and position('Aw Hidden' in list::text) = 0 and position(pg_temp.ch('Aw Hidden')::text in list::text) = 0,
    'an undebuted holder is left out of the Boss''s list: ' || list::text);
  -- Neither reader is a player's, and neither reads an account or a wardrobe.
  perform pg_temp.expect(not has_function_privilege('authenticated', 'boss_trophies()', 'execute') and not has_function_privilege('anon', 'boss_trophies()', 'execute')
    and not has_function_privilege('authenticated', 'trophy_award_facts(jsonb)', 'execute') and has_function_privilege('service_role', 'trophy_award_facts(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'trophy_move_problem(jsonb,jsonb)', 'execute') and not has_function_privilege('authenticated', 'trophy_award_problem(text,uuid)', 'execute'), 'the readers are the service role''s');
  perform pg_temp.expect((select not bool_or(pg_get_functiondef(p.oid) ~* '\m(from|join)\s+(public\.)?(gear_ledger|gear_worn|accounts|reactions)\M')
    from pg_proc p where p.proname in ('boss_trophies', 'trophy_award_facts', 'trophy_award_problem', 'trophy_move_problem')), 'the readers read no wardrobe, account or reaction');
end $$;

-- ---- 5. The season's edge: an award from before the open season does not bar a re-award; with no open season all history counts ----
do $$
declare
  eve uuid := tests.character(tests.account('aw-eve'), 'Aw Eve');
  fay uuid := tests.character(tests.account('aw-fay'), 'Aw Fay');
  open_from timestamptz;
begin
  update seasons set starts_at = now() - interval '5 days' where ends_at is null;
  open_from := (select starts_at from seasons where ends_at is null);
  insert into trophy_awards (trophy, character, by, at) values ('aw-pet', eve, 'admin', open_from - interval '1 day'), ('aw-pet', fay, 'admin', open_from - interval '1 day');
  perform pg_temp.expect(trophy_award_problem('aw-pet', eve) is null, 'an award from before the season does not bar a re-award: ' || coalesce(trophy_award_problem('aw-pet', eve), ''));
  perform pg_temp.expect(trophy_award_facts(jsonb_build_array(jsonb_build_object('trophy', 'aw-pet', 'character', eve))) -> 'given' = '[]'::jsonb, 'nor does the meeting''s repair count it');
  insert into trophy_awards (trophy, character, by, at) values ('aw-pet', eve, 'admin', open_from + interval '1 day');
  perform pg_temp.expect(trophy_award_problem('aw-pet', eve) like '%already given%season%', 'an award inside the season bars one');
  perform pg_temp.expect(trophy_award_facts(jsonb_build_array(jsonb_build_object('trophy', 'aw-pet', 'character', eve))) -> 'given' = jsonb_build_array('aw-pet:' || eve), 'and the repair counts it');
  -- No open season: all history counts.
  update seasons set ends_at = now() - interval '1 hour' where ends_at is null;
  perform pg_temp.expect(not exists (select 1 from seasons where ends_at is null), 'no season is open');
  perform pg_temp.expect(trophy_award_problem('aw-pet', fay) like '%already given%season%', 'with no open season an old award bars one');
  perform pg_temp.expect(trophy_award_facts(jsonb_build_array(jsonb_build_object('trophy', 'aw-pet', 'character', fay))) -> 'given' = jsonb_build_array('aw-pet:' || fay), 'and the repair counts it');
end $$;

-- ---- 6. The words' lookup of the character is by key, not a scan ----
create function pg_temp.explain_lines(stmt text) returns setof text language plpgsql as $$
declare l text;
begin
  for l in execute 'explain ' || stmt loop return next l; end loop;
end $$;
do $$
declare
  plan text;
  eve uuid := pg_temp.ch('Aw Eve');
  words text;
begin
  insert into characters (owner, name) select tests.account('aw-bulk' || n), 'Aw Bulk ' || n from generate_series(1, 500) n;
  analyze characters;
  perform set_config('enable_seqscan', 'off', true);
  -- The statement system_line runs, with the id given in text.
  plan := (select string_agg(l, ' ') from pg_temp.explain_lines(format($q$select c.name from characters c where c.id = case when lower(%L::text) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (%L::text)::uuid end$q$, eve, eve)) l);
  perform set_config('enable_seqscan', 'on', true);
  perform pg_temp.expect(plan like '%characters_pkey%', 'the character lookup uses the primary key: ' || plan);
  perform pg_temp.expect(pg_get_functiondef('system_line(text,text,jsonb,text)'::regprocedure) !~ 'c\.id::text', 'system_line does not cast the key to text');
  words := system_line('moveLanded', 'awardTrophy', jsonb_build_object('trophy', 'aw-pet', 'character', upper(eve::text)), 'aw-boss');
  perform pg_temp.expect(words like '%Aw Eve%', 'an upper-case key still names the character: ' || words);
  words := system_line('moveLanded', 'awardTrophy', jsonb_build_object('trophy', 'aw-pet', 'character', 'not-a-uuid'), 'aw-boss');
  perform pg_temp.expect(words like '%the Pet trophy to .%', 'a malformed key names no one and does not error: ' || words);
end $$;
