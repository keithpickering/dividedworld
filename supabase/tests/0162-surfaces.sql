-- Surfaces (supabase/migrations/0154_surfaces.sql; docs/plans/2026-11-11-graffiti-plan.md, Task 2): a play whose layer any character may add to, kept as draws and washes (Acts) and a derived row
-- of the play's own (`surfaces`): the covered cells, the draw that last inked each, and the live list. The card is this file's own (`sfwall`, with the surface flag); every name is prefixed sf.
--
--  1. a play opens an empty surface, and a second wall card on the post is refused by the stack
--  2. a draw covers its cells and returns `covered`; a draw over a covered cell adds nothing
--  3. a draw past the limit is refused with the wall's own figures and writes nothing
--  4. two draws racing under the limit cannot both pass (two sessions)
--  5. a wash by the post's character uncovers its cells; by anyone else, the author's other mask included, is refused; a wash on a full wall lands; a wash that cuts nothing is not kept
--  6. a draw wholly painted over leaves `live`, and the indices are renumbered
--  7. the 49th live draw is refused; painting over one is the way out, and a wash is never refused for the count
--  8. a banned or barred drawer is refused in those checks' own words; a drawer playing the post author's other mask is not
--  9. an ended play refuses a draw and a wash
-- 10. rebuild_surface equals the stored row after a mixed run of twenty Acts
-- 11. a set surface card springs with its draft as the first draw; a draft over the limit opens the wall bare, and the spring says so; the draft row is private and gone once read
-- 12. thread_page carries ids and counts, no strokes; card_target shows `covered`; surface_acts lists the live Acts with each draw's share
-- 13. an update of a draw Act is refused by acts_append_only; a draw is written only by its function

select tests.unbecome();

-- ---- 4. Two draws racing under the limit: exactly one passes (two sessions; the rows are committed, in the scratch database the run drops). First in the file, before it holds any lock a racer would wait on,
-- and with a card kind of its own, since the racers do not see what this transaction has not committed. ----
do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); cal uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); p uuid; pl uuid; said text[]; rounds integer := 8;
  payload text := '{"strokes": [{"width": 0.01, "points": [[0.1, 0.1]]}]}';
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'sf-race-ann@test.invalid'), (%2$L, 'sf-race-bob@test.invalid'), (%3$L, 'sf-race-cal@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L), (%3$L);
    insert into characters (id, owner, name, debuted_at) values (%4$L, %1$L, 'Sf Race Ann', now()), (%5$L, %2$L, 'Sf Race Bob', now()), (%6$L, %3$L, 'Sf Race Cal', now());
    insert into class_history (character, class_key) values (%4$L, 'alpha'), (%5$L, 'alpha'), (%6$L, 'alpha');
    insert into threads (id, board, title) select %7$L, id, 'Sf race' from boards where slug = 'general';
    insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, stack, surface) values ('sfracewall', 'Sf Race Wall', 'pepperoni', 'rare', 'cast', null, '{post}', 1, true);
  $sql$, ann, bob, cal, a, b, c, t));
  for i in 1..rounds loop
    p := gen_random_uuid(); pl := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into acts (id, character, kind, thread, payload) values (%1$L, %2$L, 'post', %3$L, '{"body": "Race me."}');
      insert into acts (id, character, kind, thread, target_act_id, payload) values (%4$L, %2$L, 'card', %3$L, %1$L, '{"card": "sfracewall", "message": "", "config": {}, "layer": 1}');
      do $x$ begin perform open_surface(%4$L); end $x$;
    $sql$, p, a, t, pl));
    -- Each tag is 3,000 fresh cells on a wall limited to 4,000: either alone passes, both cannot.
    said := tests.race_service(
      format('select draw_on_surface(%L, %L, %L, %L, %L, 4000)', bob, b, pl, payload, (repeat('0', 0) || repeat('1', 3000) || repeat('0', 7000))),
      format('select draw_on_surface(%L, %L, %L, %L, %L, 4000)', cal, c, pl, payload, (repeat('0', 3000) || repeat('1', 3000) || repeat('0', 4000))));
    if (select bit_count(cover) from surfaces where play = pl) > 4000 then raise exception 'round %: two draws both passed the limit (%)', i, said; end if;
    if (select bit_count(cover) from surfaces where play = pl) is distinct from 3000 then raise exception 'round %: neither draw landed (%)', i, said; end if;
    if (said[1] is null) = (said[2] is null) then raise exception 'round %: exactly one draw should be refused: %', i, said; end if;
    if coalesce(said[1], said[2]) is distinct from 'this wall is 30% covered, and its limit is 40%; this tag would take it to 60%' then raise exception 'round %: the loser is refused with the figures the winner left: %', i, said; end if;
    if (select count(*) from acts where target_act_id = pl and kind = 'draw') is distinct from 1 then raise exception 'round %: one draw is an Act', i; end if;
  end loop;
end $$;

insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, stack, surface)
values ('sfwall', 'Sf Wall', 'pepperoni', 'rare', 'cast', null, '{post}', 1, true);

-- Run a statement as an account (null: the service role); its first column as text, or 'ERROR: ' and the refusal.
create function pg_temp.as_val(who uuid, stmt text) returns text language plpgsql as $$
declare
  r text;
begin
  if who is null then perform tests.become_service(); else perform tests.become(who); end if;
  begin
    execute stmt into r;
  exception when others then
    r := 'ERROR: ' || sqlerrm;
  end;
  perform tests.unbecome();
  return r;
end $$;

-- A run of cells: `n` ones from cell `first`.
create function pg_temp.cells(first integer, n integer) returns bit(10000) language sql as $$
  select (repeat('0', first) || repeat('1', n) || repeat('0', 10000 - first - n))::bit(10000)
$$;

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;
create function pg_temp.announcements() returns uuid language sql as $$ select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements' $$;

-- A wall as place_cast leaves one: a post by `author`, a play of the wall card on it, and its open surface.
create function pg_temp.wall(author uuid, in_thread uuid, out post uuid, out play uuid) language plpgsql as $$
begin
  post := tests.post(author, in_thread, 'A wall.');
  play := tests.act(author, 'card', in_thread, jsonb_build_object('card', 'sfwall', 'message', '', 'config', '{}'::jsonb, 'layer', 1), post);
  perform open_surface(play);
end $$;

-- A draw or a wash by the service role, as the act function calls them; the answer as text, or the refusal.
create function pg_temp.draw(who uuid, through uuid, play uuid, cells bit(10000), most integer default 4000) returns text language sql as $$
  select pg_temp.as_val(null, format('select draw_on_surface(%L, %L, %L, %L, %L, %s)::text', who, through, play, '{"strokes": [{"width": 0.01, "points": [[0.1, 0.1]]}]}'::jsonb, cells::text, most))
$$;
create function pg_temp.wash(who uuid, through uuid, play uuid, cells bit(10000)) returns text language sql as $$
  select pg_temp.as_val(null, format('select wash_surface(%L, %L, %L, %L, %L)::text', who, through, play, '{"strokes": [{"width": 0.02, "points": [[0.1, 0.1]]}]}'::jsonb, cells::text))
$$;
create function pg_temp.covered(play uuid) returns integer language sql as $$ select bit_count(cover) from surfaces where surfaces.play = covered.play $$;
create function pg_temp.live(play uuid) returns integer language sql as $$ select cardinality(live) from surfaces where surfaces.play = live.play $$;
create function pg_temp.draws(play uuid) returns integer language sql as $$ select count(*)::integer from acts where target_act_id = draws.play and kind = 'draw' $$;

-- A one-day ban of a character, with the infraction a ban follows, about a post of the character's in the thread.
create function pg_temp.ban(who uuid, in_thread uuid) returns void language plpgsql as $$
declare
  p uuid := tests.post(who, in_thread, 'A post that earned it.');
  inf uuid;
begin
  perform set_config('kayfabb.warn_writer', 'on', true);
  inf := tests.act(null, 'infraction', in_thread, jsonb_build_object('character', who, 'band', 'minor', 'points', 2, 'rule_number', null,
    'board', (select board from threads where id = in_thread), 'about_act', p, 'visit_act', null, 'staff', 'sf-boss', 'expires_at', now() + interval '14 days'));
  perform tests.act(null, 'ban', in_thread, jsonb_build_object('character', who, 'days', 1, 'until', now() + interval '1 day', 'infraction_act', inf, 'season', 1));
  perform set_config('kayfabb.warn_writer', '', true);
end $$;

-- A group move that has landed (as an Act), as 0127's test lands one: a bar from a board.
create function pg_temp.landed(staff text, who uuid, grp text, board uuid) returns uuid language plpgsql as $$
declare
  made uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  made := tests.act((select id from characters c where c.staff = landed.staff), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'conferGroup', 'body', 'Moved.', 'params', jsonb_build_object('character', who::text, 'group', grp, 'board', board::text),
      'demand', jsonb_build_object('kind', 'apologyAccepted', 'params', '{}'::jsonb), 'expires_at', clock_timestamp() + interval '3 days'),
    null, clock_timestamp() - interval '1 hour');
  perform set_config('kayfabb.staff_writer', '', true);
  return made;
end $$;

-- The world the bar needs: a Boss, a ladder, and a conferred group.
do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true,
      'apology', jsonb_build_object('apologyEveryHours', 24, 'apologyJudgeBatch', 2, 'apologyRulingMaxWords', 80),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveMet', jsonb_build_array('Met, {move}.')),
      'systemMoveWords', jsonb_build_object('conferGroup', 'moving a member into "{groupName}"')),
    'groups', jsonb_build_array(
      jsonb_build_object('key', 'members', 'name', 'Members', 'color', '#7a7a7a', 'source', 'ladder', 'rung', 0, 'condition', 'default'),
      jsonb_build_object('key', 'trialMembers', 'name', 'Trial Members', 'color', '#d2691e', 'stripe', true, 'source', 'conferred', 'tone', 'punishment')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'sf-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'sf-boss', 'name', 'Sf Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'conferGroup', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'), 'derived', jsonb_build_array('groupName'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'), jsonb_build_object('key', 'apologyAccepted')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts')))));
end $$;

-- ---- 1. A play opens an empty surface ----
do $$
declare
  ann uuid := tests.account('sf-1-ann'); bob uuid := tests.account('sf-1-bob');
  a uuid := tests.character(ann, 'Sf One Ann'); b uuid := tests.character(bob, 'Sf One Bob');
  t uuid := tests.thread('Sf one'); p uuid := tests.post(a, t, 'A post for a wall.');
  played text; pl uuid; s surfaces%rowtype;
begin
  insert into card_ledger (account, card, kind, price) values (bob, 'sfwall', 'bought', 0), (bob, 'sfwall', 'bought', 0);
  played := pg_temp.as_val(null, format('select play_card(%L, %L, %L, %L, %L, 0, %L)::text', bob, 'sfwall', b, p, '{}', ''));
  if played like 'ERROR:%' then raise exception 'the wall card was refused: %', played; end if;
  pl := (played::jsonb ->> 'id')::uuid;
  select * into s from surfaces where surfaces.play = pl;
  if s.play is null then raise exception 'a play of a surface card opens its surface'; end if;
  if s.post is distinct from p or bit_count(s.cover) <> 0 or s.live <> '{}' or cardinality(s.owners) <> 10000 or s.most_live <> 48
     or exists (select 1 from unnest(s.owners) o where o <> 0) then
    raise exception 'the surface opens empty on its post: %', s;
  end if;
  if length(s.cover::text) <> 10000 then raise exception 'the cover is 10,000 cells'; end if;
  -- A second wall on the post is refused by the card's stack, in the stack's words.
  played := pg_temp.as_val(null, format('select play_card(%L, %L, %L, %L, %L, 0, %L)::text', bob, 'sfwall', b, p, '{}', ''));
  if played is distinct from 'ERROR: this post already carries that card' then raise exception 'a second wall is refused by the stack: %', played; end if;
end $$;

-- ---- 2 and 3. A draw covers its cells; over a covered cell it adds nothing; past the limit it is refused with the wall's figures ----
do $$
declare
  ann uuid := tests.account('sf-2-ann'); bob uuid := tests.account('sf-2-bob');
  a uuid := tests.character(ann, 'Sf Two Ann'); b uuid := tests.character(bob, 'Sf Two Bob');
  t uuid := tests.thread('Sf two'); w record := pg_temp.wall(a, t);
  got text; d1 uuid; before_acts integer;
begin
  got := pg_temp.draw(bob, b, w.play, pg_temp.cells(0, 3100));
  if got like 'ERROR:%' then raise exception 'the first draw was refused: %', got; end if;
  d1 := (got::jsonb ->> 'id')::uuid;
  if (got::jsonb ->> 'covered')::integer <> 3100 or got::jsonb -> 'live' <> to_jsonb(array[d1]) or got::jsonb ->> 'kind' <> 'draw' or got::jsonb ->> 'seq' is not null
     or (got::jsonb ->> 'target_act_id')::uuid <> w.play or (got::jsonb ->> 'character')::uuid <> b then
    raise exception 'a draw answers with its Act, covered and live: %', got;
  end if;
  if pg_temp.covered(w.play) <> 3100 then raise exception 'the row covers 3,100 cells'; end if;
  if (select (payload ->> 'cells')::bit(10000) from acts where id = d1) is distinct from pg_temp.cells(0, 3100) then raise exception 'the draw keeps its cells in its payload'; end if;
  got := pg_temp.draw(bob, b, w.play, pg_temp.cells(0, 100));
  if (got::jsonb ->> 'covered')::integer <> 3100 then raise exception 'a draw over covered cells adds nothing: %', got; end if;
  if (select owners[1] from surfaces where play = w.play) is distinct from 2 or (select owners[101] from surfaces where play = w.play) is distinct from 1 then raise exception 'the later draw owns the cells it painted over'; end if;
  -- Past the limit: 3,100 + 1,500 new cells is 46%.
  before_acts := pg_temp.draws(w.play);
  got := pg_temp.draw(bob, b, w.play, pg_temp.cells(3100, 1500));
  if got is distinct from 'ERROR: this wall is 31% covered, and its limit is 40%; this tag would take it to 46%' then raise exception 'the refusal carries the wall''s figures: %', got; end if;
  if pg_temp.draws(w.play) <> before_acts or pg_temp.covered(w.play) <> 3100 then raise exception 'a refused draw writes nothing'; end if;
  -- Up to the limit exactly is allowed.
  got := pg_temp.draw(bob, b, w.play, pg_temp.cells(3100, 900));
  if (got::jsonb ->> 'covered')::integer <> 4000 then raise exception 'a draw to the limit lands: %', got; end if;
  -- A draw that adds nothing lands even on a full wall, and the limit is read from the argument.
  got := pg_temp.draw(bob, b, w.play, pg_temp.cells(0, 10));
  if got like 'ERROR:%' then raise exception 'a draw that adds no cells lands on a full wall: %', got; end if;
  got := pg_temp.draw(bob, b, w.play, pg_temp.cells(5000, 1), 4000);
  if got not like 'ERROR: this wall is 40% covered, and its limit is 40%; this tag would take it to 41%' then raise exception 'the full wall refuses one more cell: %', got; end if;
end $$;

-- ---- 5. Washes: the post's character, anyone else refused, a wash on a full wall, a wash that cuts nothing ----
do $$
declare
  ann uuid := tests.account('sf-5-ann'); bob uuid := tests.account('sf-5-bob');
  a uuid := tests.character(ann, 'Sf Five Ann'); a2 uuid := tests.character(ann, 'Sf Five Ann Two'); b uuid := tests.character(bob, 'Sf Five Bob');
  t uuid := tests.thread('Sf five'); w record := pg_temp.wall(a, t);
  got text; acts_before integer; live_before uuid[];
begin
  perform pg_temp.draw(bob, b, w.play, pg_temp.cells(0, 4000));
  -- A wash on a full wall lands: it is never refused for the limit.
  got := pg_temp.wash(ann, a, w.play, pg_temp.cells(0, 200));
  if got like 'ERROR:%' then raise exception 'a wash on a full wall lands: %', got; end if;
  if (got::jsonb ->> 'covered')::integer <> 3800 or pg_temp.covered(w.play) <> 3800 or got::jsonb ->> 'kind' <> 'wash' or (got::jsonb ->> 'character')::uuid <> a then
    raise exception 'a wash uncovers its cells: %', got;
  end if;
  if exists (select 1 from surfaces s, generate_series(1, 200) i where s.play = w.play and s.owners[i] <> 0) then raise exception 'washed cells have no owner'; end if;
  -- It stays live: the draw before it is live and inked under it.
  if pg_temp.live(w.play) <> 2 or (select live[2] from surfaces where play = w.play) is distinct from (got::jsonb ->> 'id')::uuid then raise exception 'a wash that cuts live ink stays live: %', got; end if;
  -- Anyone else is refused: another player's mask, and the author's own other mask (a public fact: it is not the post's character).
  acts_before := (select count(*) from acts where target_act_id = w.play);
  got := pg_temp.wash(bob, b, w.play, pg_temp.cells(0, 10));
  if got is distinct from 'ERROR: only the post''s author washes what is on it' then raise exception 'only the author washes: %', got; end if;
  got := pg_temp.wash(ann, a2, w.play, pg_temp.cells(0, 10));
  if got is distinct from 'ERROR: only the post''s author washes what is on it' then raise exception 'the author''s other mask does not wash: %', got; end if;
  got := pg_temp.wash(bob, a, w.play, pg_temp.cells(0, 10));
  if got is null or got not like 'ERROR:%' then raise exception 'a wash through a mask that is not yours is refused: %', got; end if;
  if (select count(*) from acts where target_act_id = w.play) is distinct from acts_before then raise exception 'a refused wash writes nothing'; end if;
  -- A wash over cells nobody inked cuts nothing: its Act is written, the live list is not changed.
  live_before := (select live from surfaces where play = w.play);
  got := pg_temp.wash(ann, a, w.play, pg_temp.cells(9000, 50));
  if got like 'ERROR:%' or (select live from surfaces where play = w.play) is distinct from live_before or got::jsonb -> 'live' is distinct from to_jsonb(live_before) then
    raise exception 'a wash that cuts nothing is not kept: %', got;
  end if;
  if not exists (select 1 from acts where id = (got::jsonb ->> 'id')::uuid and kind = 'wash') then raise exception 'but its Act is written'; end if;
  -- A long run of small washes over bare cells does not grow the live list.
  for i in 0..39 loop perform pg_temp.wash(ann, a, w.play, pg_temp.cells(9100 + i, 1)); end loop;
  if (select live from surfaces where play = w.play) is distinct from live_before then raise exception 'a run of washes that cut nothing grows nothing'; end if;
  -- A wash that is wholly inside an earlier wash's cells leaves the earlier one out (it cut the same ink): the later cuts nothing, then.
  got := pg_temp.wash(ann, a, w.play, pg_temp.cells(10, 50));
  if pg_temp.live(w.play) <> 2 then raise exception 'a second wash over washed cells cuts nothing and is not kept: %', got; end if;
  -- A wash that is a superset of an earlier one takes its place.
  got := pg_temp.wash(ann, a, w.play, pg_temp.cells(0, 400));
  if pg_temp.live(w.play) <> 2 or (select live[2] from surfaces where play = w.play) is distinct from (got::jsonb ->> 'id')::uuid then raise exception 'a wash over the earlier wash takes its place: %', got; end if;
end $$;

-- ---- 6. A draw wholly painted over leaves live; a draw that is washed away leaves live; renumbering ----
do $$
declare
  ann uuid := tests.account('sf-6-ann'); bob uuid := tests.account('sf-6-bob');
  a uuid := tests.character(ann, 'Sf Six Ann'); b uuid := tests.character(bob, 'Sf Six Bob');
  t uuid := tests.thread('Sf six'); w record := pg_temp.wall(a, t);
  d1 uuid; d2 uuid; d3 uuid; got text; s surfaces%rowtype;
begin
  d1 := (pg_temp.draw(bob, b, w.play, pg_temp.cells(0, 100))::jsonb ->> 'id')::uuid;
  d2 := (pg_temp.draw(bob, b, w.play, pg_temp.cells(1000, 100))::jsonb ->> 'id')::uuid;
  d3 := (pg_temp.draw(bob, b, w.play, pg_temp.cells(0, 100))::jsonb ->> 'id')::uuid;
  select * into s from surfaces where play = w.play;
  if s.live <> array[d2, d3] then raise exception 'the painted-over draw leaves live, and the rest keep their order: %', s.live; end if;
  -- Renumbered: d2 is index 1 and d3 index 2.
  if s.owners[1] <> 2 or s.owners[100] <> 2 or s.owners[1001] <> 1 or s.owners[1100] <> 1 or s.owners[101] <> 0 then raise exception 'the owners are renumbered with live: % %', s.owners[1], s.owners[1001]; end if;
  -- A draw wholly washed away leaves live too, and the wash that took it leaves with it.
  got := pg_temp.wash(ann, a, w.play, pg_temp.cells(1000, 100));
  select * into s from surfaces where play = w.play;
  if s.live <> array[d3] then raise exception 'a washed-away draw leaves live, and its wash with it: %', s.live; end if;
  if s.owners[1] <> 1 then raise exception 'renumbered again'; end if;
  -- All of it gone: nothing is live.
  perform pg_temp.wash(ann, a, w.play, pg_temp.cells(0, 100));
  select * into s from surfaces where play = w.play;
  if s.live <> '{}' or bit_count(s.cover) <> 0 then raise exception 'an empty wall holds nothing live: %', s.live; end if;
  -- The Acts all stay.
  if pg_temp.draws(w.play) <> 3 then raise exception 'every draw is still an Act'; end if;
end $$;

-- ---- 7. The 49th live draw ----
do $$
declare
  ann uuid := tests.account('sf-7-ann'); bob uuid := tests.account('sf-7-bob');
  a uuid := tests.character(ann, 'Sf Seven Ann'); b uuid := tests.character(bob, 'Sf Seven Bob');
  t uuid := tests.thread('Sf seven'); w record := pg_temp.wall(a, t);
  got text; first_draw uuid;
begin
  for i in 0..47 loop
    got := pg_temp.draw(bob, b, w.play, pg_temp.cells(i, 1));
    if got like 'ERROR:%' then raise exception 'draw % was refused: %', i + 1, got; end if;
    if i = 0 then first_draw := (got::jsonb ->> 'id')::uuid; end if;
  end loop;
  if pg_temp.live(w.play) <> 48 then raise exception '48 live draws'; end if;
  got := pg_temp.draw(bob, b, w.play, pg_temp.cells(100, 1));
  if got is distinct from 'ERROR: this wall holds 48 tags; paint over one or wait for a wash' then raise exception 'the 49th is refused in the wall''s words: %', got; end if;
  if pg_temp.draws(w.play) <> 48 or pg_temp.covered(w.play) <> 48 then raise exception 'a refused draw writes nothing'; end if;
  -- Painting over one is the way out: the draw it covers leaves live, so the count is still 48.
  got := pg_temp.draw(bob, b, w.play, pg_temp.cells(0, 1));
  if got like 'ERROR:%' or pg_temp.live(w.play) <> 48 or exists (select 1 from surfaces where play = w.play and first_draw = any (live)) then raise exception 'painting over a tag is allowed at 48: %', got; end if;
  -- A wash is never refused for the count.
  got := pg_temp.wash(ann, a, w.play, pg_temp.cells(10, 1));
  if got like 'ERROR:%' or pg_temp.live(w.play) <> 47 then raise exception 'a wash lands at 48 and frees a tag: %', got; end if;
  got := pg_temp.draw(bob, b, w.play, pg_temp.cells(100, 1));
  if got like 'ERROR:%' then raise exception 'room after a wash: %', got; end if;
end $$;

-- ---- 8. A banned or barred drawer is refused; the post author's other mask is not ----
do $$
declare
  ann uuid := tests.account('sf-8-ann'); bob uuid := tests.account('sf-8-bob'); cal uuid := tests.account('sf-8-cal');
  a uuid := tests.character(ann, 'Sf Eight Ann'); a2 uuid := tests.character(ann, 'Sf Eight Ann Two');
  b uuid := tests.character(bob, 'Sf Eight Bob'); c uuid := tests.character(cal, 'Sf Eight Cal');
  t uuid := tests.thread('Sf eight'); w record := pg_temp.wall(a, t);
  got text; general uuid := pg_temp.board('general');
begin
  perform pg_temp.ban(b, t);
  got := pg_temp.draw(bob, b, w.play, pg_temp.cells(0, 10));
  if got is null or got not like 'ERROR: this character is banned until % UTC; the ban ends by itself then%' then raise exception 'a banned drawer is refused in not_banned''s words: %', got; end if;
  got := pg_temp.draw(ann, a, w.play, pg_temp.cells(0, 10));
  if got like 'ERROR:%' then raise exception 'the post''s own character draws on its wall: %', got; end if;
  got := pg_temp.draw(ann, a2, w.play, pg_temp.cells(10, 10));
  if got like 'ERROR:%' then raise exception 'the post author''s other mask is not refused: %', got; end if;
  perform pg_temp.landed('sf-boss', c, 'trialMembers', general);
  got := pg_temp.draw(cal, c, w.play, pg_temp.cells(20, 10));
  if got is null or got not like 'ERROR: Sf Eight Cal is barred from posting on General until %' then raise exception 'a barred drawer is refused in not_barred''s words: %', got; end if;
  -- The same refusal whoever owns the post: the wall of the barred player's own post refuses them as well.
  w := pg_temp.wall(c, t);
  got := pg_temp.draw(cal, c, w.play, pg_temp.cells(20, 10));
  if got is null or got not like 'ERROR: Sf Eight Cal is barred from posting on General until %' then raise exception 'a barred drawer is refused on their own wall as well: %', got; end if;
  -- A mask that is not the caller's is refused by played_by, the same words for any wall.
  got := pg_temp.draw(bob, a, w.play, pg_temp.cells(30, 10));
  if got is null or got not like 'ERROR:%' then raise exception 'a drawer plays only their own mask: %', got; end if;
end $$;

-- ---- 9. An ended play refuses a draw and a wash ----
do $$
declare
  ann uuid := tests.account('sf-9-ann'); bob uuid := tests.account('sf-9-bob');
  a uuid := tests.character(ann, 'Sf Nine Ann'); b uuid := tests.character(bob, 'Sf Nine Bob');
  t uuid := tests.thread('Sf nine'); w record := pg_temp.wall(a, t);
  got text;
begin
  perform pg_temp.draw(bob, b, w.play, pg_temp.cells(0, 100));
  insert into admins (account) values (ann);
  perform tests.become(ann);
  perform reverse_card(w.play);
  perform tests.unbecome();
  got := pg_temp.draw(bob, b, w.play, pg_temp.cells(100, 10));
  if got is distinct from 'ERROR: an admin ended that card' then raise exception 'an ended wall refuses a draw: %', got; end if;
  got := pg_temp.wash(ann, a, w.play, pg_temp.cells(0, 10));
  if got is distinct from 'ERROR: an admin ended that card' then raise exception 'an ended wall refuses a wash: %', got; end if;
  if pg_temp.covered(w.play) <> 100 or pg_temp.draws(w.play) <> 1 then raise exception 'nothing was written'; end if;
end $$;

-- ---- 10. rebuild_surface equals the stored row after a mixed run of twenty Acts ----
do $$
declare
  ann uuid := tests.account('sf-10-ann'); bob uuid := tests.account('sf-10-bob');
  a uuid := tests.character(ann, 'Sf Ten Ann'); b uuid := tests.character(bob, 'Sf Ten Bob');
  t uuid := tests.thread('Sf ten'); w record := pg_temp.wall(a, t);
  s surfaces%rowtype; r surfaces%rowtype; got text;
begin
  for i in 1..20 loop
    if i % 4 = 0 then got := pg_temp.wash(ann, a, w.play, pg_temp.cells((i * 137) % 3000, 150 + i));
    else got := pg_temp.draw(bob, b, w.play, pg_temp.cells((i * 211) % 3000, 120 + i * 5)); end if;
    if got like 'ERROR:%' then raise exception 'step % was refused: %', i, got; end if;
  end loop;
  if (select count(*) from acts where target_act_id = w.play and kind in ('draw', 'wash')) is distinct from 20 then raise exception 'twenty Acts'; end if;
  select * into s from surfaces where play = w.play;
  r := rebuild_surface(w.play);
  if r.cover is distinct from s.cover or r.owners is distinct from s.owners or r.live is distinct from s.live or r.post is distinct from s.post or r.play is distinct from s.play then
    raise exception 'rebuild_surface differs from the stored row: live % against %', r.live, s.live;
  end if;
  if cardinality(s.live) < 2 or bit_count(s.cover) = 0 then raise exception 'the run left something to compare'; end if;
end $$;

-- ---- 11. A set surface card springs with its draft ----
do $$
declare
  ann uuid := tests.account('sf-11-ann'); bob uuid := tests.account('sf-11-bob');
  a uuid := tests.character(ann, 'Sf Eleven Ann'); b uuid := tests.character(bob, 'Sf Eleven Bob');
  t uuid := tests.thread('Sf eleven'); p1 uuid := tests.post(a, t, 'Set under a wall.'); p2 uuid := tests.post(a, t, 'Set under a wall too big.');
  q1 uuid; q2 uuid; set1 uuid; set2 uuid; spring jsonb; struck uuid; got text;
begin
  insert into card_ledger (account, card, kind, price) values (ann, 'sfwall', 'bought', 0), (ann, 'sfwall', 'bought', 0);
  got := pg_temp.as_val(null, format('select set_surface_card(%L, %L, %L, %L, %L, 0, null, null, null, null, null, %L, %L, 4000, 48)::text', ann, 'sfwall', a, p1, '{}',
    '{"strokes": [{"width": 0.01, "points": [[0.1, 0.1]]}]}'::jsonb, pg_temp.cells(0, 500)::text));
  if got like 'ERROR:%' then raise exception 'a surface card is set face down with its draft: %', got; end if;
  set1 := (got::jsonb ->> 'id')::uuid;
  got := pg_temp.as_val(null, format('select set_surface_card(%L, %L, %L, %L, %L, 0, null, null, null, null, null, %L, %L, 4000, 48)::text', ann, 'sfwall', a, p2, '{}',
    '{"strokes": [{"width": 0.5, "points": [[0.1, 0.1]]}]}'::jsonb, pg_temp.cells(0, 4500)::text));
  if got like 'ERROR:%' then raise exception 'a draft over the limit is kept all the same: %', got; end if;
  set2 := (got::jsonb ->> 'id')::uuid;
  if (select count(*) from face_down_draws where play in (set1, set2)) is distinct from 2 then raise exception 'the drafts are kept in a private row beside the backs'; end if;
  -- Nobody reads a draft: not the setter, not anyone.
  if pg_temp.as_val(ann, 'select count(*) from face_down_draws') not like 'ERROR: permission denied%' then raise exception 'a draft is read by no player: %', pg_temp.as_val(ann, 'select count(*) from face_down_draws'); end if;
  if pg_temp.as_val(bob, 'select count(*) from face_down_draws') not like 'ERROR: permission denied%' then raise exception 'a draft is read by no player'; end if;
  -- Bob quotes each post: each back springs onto his quoting post.
  perform tests.become(bob);
  spring := post(t, b, 'Quoting the first.', p1);
  q1 := (spring ->> 'id')::uuid;
  spring := spring -> 'sprung';
  perform tests.unbecome();
  if spring is null then raise exception 'the quote springs the back: %', spring; end if;
  if spring -> 'payload' ->> 'did' <> 'landed' or (spring -> 'payload' ->> 'drawn') is distinct from 'true' then raise exception 'the spring says the draft was drawn: %', spring; end if;
  struck := (select k.id from acts k where k.kind = 'card' and k.target_act_id = q1 and k.payload ->> 'card' = 'sfwall');
  if struck is null then raise exception 'the wall landed on the quoting post'; end if;
  if (select bit_count(cover) from surfaces where play = struck) is distinct from 500 then raise exception 'the draft is the first draw, covering 500 cells: %', (select bit_count(cover) from surfaces where play = struck); end if;
  if not exists (select 1 from acts d where d.kind = 'draw' and d.target_act_id = struck and d.character = a) then raise exception 'the first draw is by the setter'; end if;
  if exists (select 1 from face_down_draws where play = set1) then raise exception 'the draft row is deleted once read'; end if;
  -- The draft over the limit: the wall opens bare, and the spring says so.
  perform tests.become(bob);
  spring := post(t, b, 'Quoting the second.', p2);
  q2 := (spring ->> 'id')::uuid;
  spring := spring -> 'sprung';
  perform tests.unbecome();
  if spring -> 'payload' ->> 'did' <> 'landed' or (spring -> 'payload' ->> 'drawn') is distinct from 'false' then raise exception 'the spring says the draft did not fit: %', spring; end if;
  struck := (select k.id from acts k where k.kind = 'card' and k.target_act_id = q2 and k.payload ->> 'card' = 'sfwall');
  if struck is null or (select bit_count(cover) from surfaces where play = struck) is distinct from 0 or (select cardinality(live) from surfaces where play = struck) is distinct from 0 then raise exception 'the wall opens bare'; end if;
  if exists (select 1 from acts d where d.kind = 'draw' and d.target_act_id = struck) then raise exception 'no draw was written'; end if;
  if exists (select 1 from face_down_draws where play = set2) then raise exception 'the draft row is deleted once read, drawn or not'; end if;
end $$;

-- ---- 12. The readers: thread_page, card_target, surface_acts ----
do $$
declare
  ann uuid := tests.account('sf-12-ann'); bob uuid := tests.account('sf-12-bob');
  a uuid := tests.character(ann, 'Sf Twelve Ann'); b uuid := tests.character(bob, 'Sf Twelve Bob');
  t uuid := tests.thread('Sf twelve'); w record := pg_temp.wall(a, t);
  page jsonb; d1 uuid; d2 uuid; w1 uuid; listed jsonb; target jsonb;
begin
  d1 := (pg_temp.draw(bob, b, w.play, pg_temp.cells(0, 300))::jsonb ->> 'id')::uuid;
  d2 := (pg_temp.draw(bob, b, w.play, pg_temp.cells(0, 100))::jsonb ->> 'id')::uuid;
  w1 := (pg_temp.wash(ann, a, w.play, pg_temp.cells(250, 10))::jsonb ->> 'id')::uuid;
  perform pg_temp.draw(bob, b, w.play, pg_temp.cells(250, 5));
  -- An old draw: painted over and gone from live.
  perform pg_temp.draw(bob, b, w.play, pg_temp.cells(2000, 10));
  perform pg_temp.draw(bob, b, w.play, pg_temp.cells(2000, 10));
  perform tests.become(ann);
  page := thread_page(t, 1, null, 20, array[]::text[]);
  perform tests.unbecome();
  if (page -> 'surfaces' -> w.play::text ->> 'covered')::integer <> (select bit_count(cover) from surfaces where play = w.play) then raise exception 'the page carries the wall''s covered: %', page -> 'surfaces'; end if;
  if page -> 'surfaces' -> w.play::text -> 'live' is distinct from (select to_jsonb(live) from surfaces where play = w.play) then raise exception 'the page carries the live ids'; end if;
  if page::text like '%"strokes"%' or page::text like '%"owners"%' or page::text like '%"cells"%' then raise exception 'the page carries no strokes, owners or cells'; end if;
  -- card_target shows covered on the effect.
  perform tests.become(bob);
  target := card_target(w.post);
  perform tests.unbecome();
  if (target -> 'effects' -> 0 ->> 'covered')::integer <> (select bit_count(cover) from surfaces where play = w.play) then raise exception 'card_target shows covered: %', target -> 'effects'; end if;
  -- surface_acts: the live Acts oldest first, each draw with its share, and the count of the older draws.
  perform tests.become(bob);
  listed := surface_acts(w.play);
  perform tests.unbecome();
  if (select jsonb_agg(x ->> 'id') from jsonb_array_elements(listed -> 'acts') x) is distinct from (select jsonb_agg(u::text) from (select unnest(live) u from surfaces where play = w.play) z) then
    raise exception 'surface_acts lists the live Acts in order: %', listed;
  end if;
  if (listed ->> 'older')::integer <> (select count(*) from acts where target_act_id = w.play and kind = 'draw') - (select count(*) from acts x where x.kind = 'draw' and x.id::text in (select y ->> 'id' from jsonb_array_elements(listed -> 'acts') y)) then
    raise exception 'surface_acts counts the older draws: %', listed ->> 'older';
  end if;
  if (listed ->> 'older')::integer < 1 then raise exception 'one draw is no longer live'; end if;
  if (select sum((x ->> 'share')::integer) from jsonb_array_elements(listed -> 'acts') x where x ->> 'kind' = 'draw') is distinct from (select bit_count(cover) from surfaces where play = w.play) then
    raise exception 'the live draws share the covered cells between them: %', listed;
  end if;
  if exists (select 1 from jsonb_array_elements(listed -> 'acts') x where x ->> 'kind' = 'wash' and x ? 'share') then raise exception 'a wash has no share'; end if;
  if (listed ->> 'covered')::integer <> (select bit_count(cover) from surfaces where play = w.play) then raise exception 'and the wall''s covered'; end if;
  -- The surfaces row is readable by a player, the drafts are not.
  if pg_temp.as_val(bob, format('select bit_count(cover) from surfaces where play = %L', w.play)) like 'ERROR:%' then raise exception 'a signed-in player reads the surface row'; end if;
end $$;

-- ---- 13. Append-only, and the only writer ----
do $$
declare
  ann uuid := tests.account('sf-13-ann'); bob uuid := tests.account('sf-13-bob');
  a uuid := tests.character(ann, 'Sf Thirteen Ann'); b uuid := tests.character(bob, 'Sf Thirteen Bob');
  t uuid := tests.thread('Sf thirteen'); w record := pg_temp.wall(a, t);
  d uuid; got text;
begin
  d := (pg_temp.draw(bob, b, w.play, pg_temp.cells(0, 10))::jsonb ->> 'id')::uuid;
  begin
    update acts set payload = '{"strokes": []}' where id = d;
    raise exception 'an update of a draw Act was allowed';
  exception when others then
    if sqlerrm not like 'an Act is never edited or removed%' then raise; end if;
  end;
  -- A draw is written only through its function.
  begin
    insert into acts (character, kind, thread, target_act_id, payload) values (b, 'draw', t, w.play, jsonb_build_object('strokes', '[]'::jsonb, 'cells', repeat('0', 10000)));
    raise exception 'a draw written by hand was allowed';
  exception when others then
    if sqlerrm not like 'a draw or a wash is written only through%' then raise; end if;
  end;
  -- A draw of a post's own words, not of a card, is refused, and so is one with strokes that are no array.
  got := pg_temp.as_val(null, format('select draw_on_surface(%L, %L, %L, %L, %L, 4000)::text', bob, b, w.post, '{"strokes": []}'::jsonb, pg_temp.cells(0, 1)::text));
  if got not like 'ERROR:%' then raise exception 'a post is no wall: %', got; end if;
  got := pg_temp.as_val(null, format('select draw_on_surface(%L, %L, %L, %L, %L, 4000)::text', bob, b, w.play, '{"strokes": 3}'::jsonb, pg_temp.cells(0, 1)::text));
  if got not like 'ERROR:%' then raise exception 'strokes are an array: %', got; end if;
  got := pg_temp.as_val(null, format('select draw_on_surface(%L, %L, %L, %L, %L, 4000)::text', bob, b, w.play, jsonb_build_object('strokes', '[]'::jsonb, 'pad', repeat('x', 66000)), pg_temp.cells(0, 1)::text));
  if got not like 'ERROR:%' then raise exception 'a draw is at most 64 KiB: %', got; end if;
  -- The API roles execute none of the writers.
  if pg_temp.as_val(bob, format('select draw_on_surface(%L, %L, %L, %L, %L, 4000)', bob, b, w.play, '{"strokes": []}'::jsonb, pg_temp.cells(0, 1)::text)) not like 'ERROR: permission denied%' then
    raise exception 'a player does not call draw_on_surface';
  end if;
  if pg_temp.as_val(bob, format('select open_surface(%L)', w.play)) not like 'ERROR: permission denied%' then raise exception 'a player does not open a surface'; end if;
end $$;
