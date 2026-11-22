-- The rewind, the first half (supabase/migrations/0413_rewind.sql; docs/plans/2026-11-21-time-machine-plan.md, Task 2; design docs/plans/2026-11-21-time-machine-design.md, sections 3, 4.1, 4.2, 6 and 7).
-- A rewind card shows a post as of an earlier point of its history and freezes the post while it is up. This half holds:
--   * the column card_kinds.rewind and its check; card_kinds_problem takes a good rewind and names each poison in the engine's words (engine/rules/instance.ts, rewindProblems);
--   * rewind_point_at: the post (its time plus the edit grace), an edit inside the grace (null), an edit past it, another post's edit (null);
--   * rewind_point_problem: each of the engine's three sentences in order, and null for an offered point, with a play still showing or ended, a back, and a point still to come;
--   * live_rewind and rewind_refusal: the live plays, latest first, the exact words (the engine's rewindWords), the rarity cut-off, `passing`, the end by time and by an admin;
--   * card_target carries `rewind: { upTo }` on a live rewind's effect;
--   * rewind_view: the version at the point, and the hidden placeholder where an admin hid that version; null for a play that is no rewind.
-- The second half (the end of this file) holds place_cast (the point, the freeze, `rewind_at`), place_set (a rewind is never set, the freeze), spring_traps (no back springs under a rewind), edits during a rewind,
-- thread_page's `rewinds` (the page's posts and the ORIGIN post) and the lookup's plan.
-- The cards are this file's own (rw...). The edit grace is the fixtures' (two minutes).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

-- A rewind play written as place_cast will write it (item 9 of the plan): a card Act on the post with its time up and the point it names.
create function pg_temp.rewind_play(by_character uuid, in_thread uuid, post uuid, card text, point timestamptz, ends timestamptz, at timestamptz default now()) returns uuid language sql as $$
  select tests.act(by_character, 'card', in_thread, jsonb_build_object('card', card, 'reach', 'post', 'ends', ends, 'rewind_at', point), post, at)
$$;

-- ---- The catalog: the column, the check, and card_kinds_problem in the engine's words ----
select tests.unbecome();
do $$
declare
  why text; got text;
  good constant jsonb := '{"key": "rwgood", "rarity": "rare", "play": "cast", "reaches": ["post"], "lasts": {"unit": "day", "count": 1}, "rewind": {"upTo": "rare"}}';
begin
  perform pg_temp.expect(exists (select 1 from information_schema.columns where table_name = 'card_kinds' and column_name = 'rewind' and data_type = 'text' and is_nullable = 'YES'), 'card_kinds has no rewind text column');
  why := pg_temp.coded($q$insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, rewind) values ('rwbad', 'Rw Bad', 'salty', 'rare', 'cast', '{post}', interval '1 day', 'mythic')$q$);
  perform pg_temp.expect(why like '23514%card_kinds_rewind_rarity%', format('a rewind of an unknown rarity was let in the catalog: %s', why));
  why := pg_temp.coded($q$insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, rewind) values ('rwrare', 'Rw Rare', 'salty', 'rare', 'cast', '{post}', interval '1 day', 'rare')$q$);
  perform pg_temp.expect(why is null, format('a rewind of a known rarity was refused: %s', why));
  delete from card_kinds where key = 'rwrare';

  got := card_kinds_problem(jsonb_build_array(good));
  perform pg_temp.expect(got is null, format('a good rewind card was refused: %s', got));
  -- The seed sends a default for what a card leaves out; those read as left out.
  got := card_kinds_problem(jsonb_build_array(good || '{"stack": 1, "pins": false, "writes": false, "replies": false, "keeps": false, "surface": false, "addsReaction": false}'::jsonb));
  perform pg_temp.expect(got is null, format('a good rewind card with the seed''s defaults was refused: %s', got));

  got := card_kinds_problem(jsonb_build_array(jsonb_set(jsonb_set(good, '{play}', '"use"'), '{gimmick}', '{"kind": "ward", "upTo": "common"}')));
  perform pg_temp.expect(got like '%card "rwgood" has a rewind, and only a cast card does%', format('a Use with a rewind: %s', got));
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{rewind,upTo}', '"mythic"')));
  perform pg_temp.expect(got like '%card "rwgood" has a rewind, and its upTo is one of common, uncommon, rare or legendary%', format('a rewind up to mythic: %s', got));
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{rewind}', '{}')));
  perform pg_temp.expect(got like '%card "rwgood" has a rewind, and its upTo is one of common, uncommon, rare or legendary%', format('a rewind with no upTo: %s', got));
  got := card_kinds_problem(jsonb_build_array(good - 'lasts'));
  perform pg_temp.expect(got like '%card "rwgood" has a rewind, and a card with a rewind has a time up (lasts); a rewind ends at its time%', format('a rewind with no lasts: %s', got));
  got := card_kinds_problem(jsonb_build_array(good || '{"gimmick": {"kind": "ward", "upTo": "common"}}'));
  perform pg_temp.expect(got like '%card "rwgood" has a rewind, and a card with a rewind has no gimmick%', format('a rewind with a gimmick: %s', got));
  got := card_kinds_problem(jsonb_build_array(good || '{"veil": "author"}'));
  perform pg_temp.expect(got like '%card "rwgood" has a rewind, and a card with a rewind has no veil%', format('a rewind with a veil: %s', got));
  got := card_kinds_problem(jsonb_build_array(good || '{"addsReaction": true}'));
  perform pg_temp.expect(got like '%card "rwgood" has a rewind, and a card with a rewind has no reaction%', format('a rewind with a reaction: %s', got));
  got := card_kinds_problem(jsonb_build_array(good || '{"writes": true}'));
  perform pg_temp.expect(got like '%card "rwgood" has a rewind, and a card with a rewind has no writes%', format('a rewind that writes: %s', got));
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{reaches}', '["post", "thread"]')));
  perform pg_temp.expect(got like '%card "rwgood" has a rewind, and a card with a rewind reaches a post alone%', format('a rewind reaching a thread: %s', got));
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{reaches}', '["thread"]')));
  perform pg_temp.expect(got like '%card "rwgood" has a rewind, and a card with a rewind reaches a post alone%', format('a rewind reaching a thread alone: %s', got));
  -- Each effect a rewind card does not carry, one poisoned card each, in the engine's words (the eight, in order).
  declare k text; said text; n integer := 0;
  begin
    for k, said in select * from (values ('gimmick', 'gimmick'), ('veil', 'veil'), ('addsReaction', 'reaction'), ('writes', 'writes'), ('replies', 'replies'), ('draws', 'draws'), ('drive', 'drive'), ('surface', 'surface')) v(a, b) loop
      got := card_kinds_problem(jsonb_build_array(good || jsonb_build_object(k, case k when 'gimmick' then '{"kind": "ward", "upTo": "common"}'::jsonb when 'veil' then '"author"'::jsonb when 'draws' then '["x"]'::jsonb when 'drive' then '{"lasts": {"unit": "day", "count": 1}}'::jsonb else 'true'::jsonb end)));
      perform pg_temp.expect(got like format('%%card "rwgood" has a rewind, and a card with a rewind has no %s%%', said), format('a rewind with %s: %s', k, got));
      n := n + 1;
    end loop;
    perform pg_temp.expect(n = 8, 'not every carried effect was driven');
  end;
  -- A card with no rewind (none, or a JSON null) is not read as one.
  got := card_kinds_problem(jsonb_build_array((good - 'rewind') || '{"rewind": null}'::jsonb));
  perform pg_temp.expect(got is null, format('a null rewind was read as a rewind: %s', got));
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good - 'rewind', '{play}', '"use"')));
  perform pg_temp.expect(got is null or got not like '%has a rewind%', format('a Use with no rewind was read as one: %s', got));
end $$;

-- ---- The cards and the fixture ----
create temp table rw_fix (label text primary key, id uuid not null);
create function pg_temp.fix(l text) returns uuid language sql as $$ select id from rw_fix where label = l $$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('rw-ann'); adm uuid := tests.account('rw-admin');
  a uuid := tests.character(ann, 'Rw Ann'); t uuid := tests.thread('Rw thread');
begin
  insert into admins (account) values (adm);
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, rewind) values
    ('rwtime', 'Rw Time', 'salty', 'rare', 'cast', '{post}', interval '3 days', 3, 'rare'),
    ('rwtimeu', 'Rw Time Uncommon', 'salty', 'uncommon', 'cast', '{post}', interval '3 days', 3, 'uncommon');
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack) values
    ('rwcommon', 'Rw Common', 'salty', 'common', 'cast', '{post}', null, 3),
    ('rwuncommon', 'Rw Uncommon', 'salty', 'uncommon', 'cast', '{post}', null, 3),
    ('rwrare', 'Rw Rare', 'salty', 'rare', 'cast', '{post}', interval '2 days', 3),
    ('rwlegend', 'Rw Legend', 'salty', 'legendary', 'cast', '{post}', null, 3);
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, stack) values
    ('rwback', 'Rw Back', 'salty', 'common', 'set', '{"trigger": {"on": "cast"}}', '{post}', null, 1);
  insert into rw_fix values ('ann', ann), ('admin', adm), ('a', a), ('t', t);
end $$;

-- ---- rewind_point_at: the post, an edit inside the grace, an edit past it, another post's edit ----
select tests.unbecome();
do $$
declare
  a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t');
  base timestamptz := now() - interval '1 hour';
  p uuid := tests.post(a, t, 'First words.', base);
  q uuid := tests.post(a, t, 'Another post.', base);
  e_in uuid := tests.act(a, 'edit', t, '{"body": "Inside the grace."}', p, base + interval '1 minute');
  e_edge uuid := tests.act(a, 'edit', t, '{"body": "Exactly at the grace."}', p, base + interval '2 minutes');
  e_out uuid := tests.act(a, 'edit', t, '{"body": "Past the grace."}', p, base + interval '10 minutes');
  q_out uuid := tests.act(a, 'edit', t, '{"body": "The other post, edited."}', q, base + interval '10 minutes');
  tally uuid; played uuid := tests.act(a, 'card', t, '{"card": "rwrare", "reach": "post"}', p, base + interval '10 minutes');
begin
  insert into rw_fix values ('p', p), ('q', q), ('e_in', e_in), ('e_edge', e_edge), ('e_out', e_out), ('q_out', q_out);
  perform pg_temp.expect(rewind_point_at(p, p) = base + interval '2 minutes', format('the post''s point is its time plus the grace: %s', rewind_point_at(p, p)));
  perform pg_temp.expect(rewind_point_at(p, e_in) is null, 'an edit inside the grace named a point');
  perform pg_temp.expect(rewind_point_at(p, e_edge) is null, 'an edit exactly at the end of the grace named a point (the grace is inclusive, as shown_edited_at reads it)');
  perform pg_temp.expect(rewind_point_at(p, e_out) = base + interval '10 minutes', format('an edit past the grace gives its own time: %s', rewind_point_at(p, e_out)));
  perform pg_temp.expect(rewind_point_at(p, q_out) is null, 'another post''s edit named a point');
  perform pg_temp.expect(rewind_point_at(p, q) is null, 'another post named a point');
  perform pg_temp.expect(rewind_point_at(p, played) is null, 'a card Act on the post, past the grace, named a point (only an edit is a version)');
  perform pg_temp.expect(rewind_point_at(p, null) is null, 'no version named a point');
  perform pg_temp.expect(rewind_point_at(p, gen_random_uuid()) is null, 'a version that is no Act named a point');
  perform pg_temp.expect(rewind_point_at(null, p) is null, 'no post named a point');
  -- An edit is no post: asking for the point of a post that is an edit gives none.
  perform pg_temp.expect(rewind_point_at(e_out, e_out) is null, 'an edit named as the post gave a point');
  -- The grace is read from the setting: with no setting, the post's point is its own time.
  delete from settings where key = 'editGrace';
  perform pg_temp.expect(rewind_point_at(p, p) = base, format('with no grace the post''s point is its time: %s', rewind_point_at(p, p)));
  insert into settings (key, value) values ('editGrace', '{"unit": "minute", "count": 2}');
  tally := null;
end $$;

-- ---- rewind_point_problem: each of the engine's words in order, null for an offered point ----
select tests.unbecome();
do $$
declare
  a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t');
  p uuid := pg_temp.fix('p'); q_out uuid := pg_temp.fix('q_out'); e_in uuid := pg_temp.fix('e_in'); e_out uuid := pg_temp.fix('e_out');
  base timestamptz := now() - interval '1 hour';
  fresh uuid := tests.post(a, t, 'Never edited.', base);
  quiet uuid := tests.post(a, t, 'Edited once, past the grace.', base);
  quiet_e uuid := tests.act(a, 'edit', t, '{"body": "Edited."}', quiet, base + interval '10 minutes');
  playd uuid := tests.post(a, t, 'Then played on.', base);
  play_e uuid := tests.act(a, 'edit', t, '{"body": "Played on, edited."}', playd, base + interval '10 minutes');
  soon uuid := tests.post(a, t, 'Posted a moment ago.', now());
  soon_e uuid := tests.act(a, 'edit', t, '{"body": "Edited right away."}', soon, now() + interval '30 seconds');
  pl uuid; back uuid; got text;
begin
  insert into rw_fix values ('fresh', fresh), ('quiet', quiet), ('quiet_e', quiet_e), ('playd', playd), ('play_e', play_e), ('soon', soon), ('soon_e', soon_e);
  -- Words, in order.
  got := rewind_point_problem(p, q_out);
  perform pg_temp.expect(got = 'pick a point from this post''s History', format('another post''s version: %s', got));
  got := rewind_point_problem(p, null);
  perform pg_temp.expect(got = 'pick a point from this post''s History', format('no version: %s', got));
  got := rewind_point_problem(p, gen_random_uuid());
  perform pg_temp.expect(got = 'pick a point from this post''s History', format('a version that is no Act: %s', got));
  got := rewind_point_problem(p, e_in);
  perform pg_temp.expect(got = 'that version was saved in the edit grace window, so it is part of the post as first posted', format('an edit inside the grace: %s', got));
  got := rewind_point_problem(fresh, fresh);
  perform pg_temp.expect(got = 'this post shows the same at that point as it does now', format('a post never edited with no plays: %s', got));
  got := rewind_point_problem(quiet, quiet_e);
  perform pg_temp.expect(got = 'this post shows the same at that point as it does now', format('the latest version, with nothing after it: %s', got));
  -- An offered point: the post as first posted, once an edit was saved past the grace; and an older edit once a later one was.
  got := rewind_point_problem(quiet, quiet);
  perform pg_temp.expect(got is null, format('the first point of an edited post was refused: %s', got));
  got := rewind_point_problem(p, p);
  perform pg_temp.expect(got is null, format('the first point of a post edited three times was refused: %s', got));
  -- A point still to come is never offered, edited or not.
  got := rewind_point_problem(soon, soon);
  perform pg_temp.expect(got = 'this post shows the same at that point as it does now', format('a point later than now: %s', got));

  -- A play after the point that is still showing makes the point offered; ended, it does not.
  pl := tests.act(a, 'card', t, jsonb_build_object('card', 'rwrare', 'reach', 'post', 'ends', now() + interval '1 day'), playd, base + interval '20 minutes');
  got := rewind_point_problem(playd, play_e);
  perform pg_temp.expect(got is null, format('the latest edit, with a play after it still showing, was refused: %s', got));
  perform pg_temp.expect(rewind_point_problem(playd, playd) is null, 'the first point, with an edit and a play after it, was refused');
  perform tests.become(pg_temp.fix('admin')); perform reverse_card(pl); perform tests.unbecome();
  got := rewind_point_problem(playd, play_e);
  perform pg_temp.expect(got = 'this post shows the same at that point as it does now', format('a play an admin ended still made the point offered: %s', got));

  -- An edit saved exactly at the end of the grace is inside it (inclusive, as rewind_point_at and shown_edited_at read it).
  got := rewind_point_problem(p, pg_temp.fix('e_edge'));
  perform pg_temp.expect(got = 'that version was saved in the edit grace window, so it is part of the post as first posted', format('an edit exactly at the end of the grace: %s', got));
  -- A play exactly at the point shows at that point already: it makes nothing later to show. One a second after does.
  declare exact uuid := tests.post(a, t, 'A play at the point.', base); exact_pl uuid;
  begin
    exact_pl := tests.act(a, 'card', t, jsonb_build_object('card', 'rwrare', 'reach', 'post', 'ends', now() + interval '1 day'), exact, base + interval '2 minutes');
    got := rewind_point_problem(exact, exact);
    perform pg_temp.expect(got = 'this post shows the same at that point as it does now', format('a play exactly at the point made it offered: %s', got));
    perform tests.act(a, 'card', t, jsonb_build_object('card', 'rwrare', 'reach', 'post', 'ends', now() + interval '1 day'), exact, base + interval '2 minutes 1 second');
    perform pg_temp.expect(rewind_point_problem(exact, exact) is null, 'a play a second after the point did not make it offered');
  end;
  -- A card played at a thread, from a post, is not on the post and shows nothing there: it makes no point offered.
  declare spoke_t uuid := tests.thread('Rw thread-reach'); spoke uuid := tests.post(a, spoke_t, 'The opening post.', base);
  begin
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack) values ('rwmulti', 'Rw Multi', 'salty', 'common', 'cast', '{post,character,thread}', interval '1 day', 3);
    perform tests.act(a, 'card', spoke_t, jsonb_build_object('card', 'rwmulti', 'reach', 'thread', 'thread', spoke_t, 'ends', now() + interval '1 day'), spoke, base + interval '30 minutes');
    got := rewind_point_problem(spoke, spoke);
    perform pg_temp.expect(got = 'this post shows the same at that point as it does now', format('a thread-reach play made a point offered: %s', got));
  end;

  -- A play whose time is up is not showing.
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'rwrare', 'reach', 'post', 'ends', now() - interval '5 minutes'), quiet, base + interval '20 minutes');
  got := rewind_point_problem(quiet, quiet_e);
  perform pg_temp.expect(got = 'this post shows the same at that point as it does now', format('a play past its time made the latest version offered: %s', got));

  -- A play played before the point is not "after" it: the post as first posted is at 2 minutes, a play at 1 minute shows at that point already, and a play at 5 minutes does not.
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'rwrare', 'reach', 'post', 'ends', now() + interval '1 day'), fresh, base + interval '1 minute');
  got := rewind_point_problem(fresh, fresh);
  perform pg_temp.expect(got = 'this post shows the same at that point as it does now', format('a play from inside the grace made the post as first posted offered: %s', got));
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'rwrare', 'reach', 'post', 'ends', now() + interval '1 day'), fresh, base + interval '5 minutes');
  got := rewind_point_problem(fresh, fresh);
  perform pg_temp.expect(got is null, format('the post as first posted, with a play after the grace still showing, was refused: %s', got));
  -- A caught play never landed.
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'rwrare', 'reach', 'post', 'ends', now() + interval '1 day', 'caught', 'x'), soon, base + interval '2 hours');
  -- A face-down set after the point shows nothing, so it makes no point worth offering.
  back := tests.act(a, 'set', t, '{}', quiet, base + interval '40 minutes');
  insert into face_down (play, account, card, post, thread, round, ends_at) values (back, pg_temp.fix('ann'), 'rwback', quiet, t, 1, now() + interval '1 day');
  got := rewind_point_problem(quiet, quiet_e);
  perform pg_temp.expect(got = 'this post shows the same at that point as it does now', format('a face-down set made a point offered: %s', got));
end $$;

-- ---- live_rewind and rewind_refusal: the live plays, latest first, the engine's words, the cut-off, `passing`, the ends ----
select tests.unbecome();
do $$
declare
  a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t'); admin uuid := pg_temp.fix('admin');
  base timestamptz := now() - interval '1 hour';
  p uuid := tests.post(a, t, 'Under a rewind.', base);
  other uuid := tests.post(a, t, 'Not under one.', base);
  common_k card_kinds; uncommon_k card_kinds; rare_k card_kinds; legend_k card_kinds;
  r1 uuid; r2 uuid; gone uuid; ends1 timestamptz := date_trunc('minute', now() + interval '2 days'); words text; n integer; rec record;
begin
  select * into common_k from card_kinds where key = 'rwcommon';
  select * into uncommon_k from card_kinds where key = 'rwuncommon';
  select * into rare_k from card_kinds where key = 'rwrare';
  select * into legend_k from card_kinds where key = 'rwlegend';
  perform pg_temp.expect((select count(*) from live_rewind(p)) = 0, 'a post with no rewind has a live one');
  perform pg_temp.expect(rewind_refusal(p, common_k) is null, 'a post with no rewind turned a card away');

  r1 := pg_temp.rewind_play(a, t, p, 'rwtime', base + interval '2 minutes', ends1, now() - interval '10 minutes');
  -- A play that is no rewind is not listed.
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'rwrare', 'reach', 'post', 'ends', now() + interval '1 day'), p, now() - interval '9 minutes');
  select * into rec from live_rewind(p);
  perform pg_temp.expect(rec.play = r1 and rec.up_to = 'rare' and rec.card = 'rwtime' and rec.at = base + interval '2 minutes' and rec.ends = ends1, format('live_rewind read the play wrongly: %s', rec));
  perform pg_temp.expect((select count(*) from live_rewind(other)) = 0, 'a rewind on one post was live on another');

  -- The words are the engine's rewindWords exactly, the same for every card at or below rare, and none above it.
  words := 'this post''s Rw Time turns away cards up to rare until ' || to_char(ends1 at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC';
  perform pg_temp.expect(rewind_refusal(p, common_k) = words, format('the common card was refused in: %s', rewind_refusal(p, common_k)));
  perform pg_temp.expect(rewind_refusal(p, uncommon_k) = words, 'the uncommon card was not refused in the words');
  perform pg_temp.expect(rewind_refusal(p, rare_k) = words, 'the rare card was not refused in the words');
  perform pg_temp.expect(rewind_refusal(p, legend_k) is null, 'the legendary card was turned away by a rewind up to rare');
  perform pg_temp.expect(rewind_refusal(other, common_k) is null, 'a rewind on one post turned a card away from another');
  -- A pierce's rarity passes a rewind whose own card is no rarer than it, as it passes a ward: the card is rare.
  perform pg_temp.expect(rewind_refusal(p, common_k, 'rare') is null, 'a rare pierce did not pass a rare rewind');
  perform pg_temp.expect(rewind_refusal(p, common_k, 'legendary') is null, 'a legendary pierce did not pass a rare rewind');
  perform pg_temp.expect(rewind_refusal(p, common_k, 'uncommon') = words, 'an uncommon pierce passed a rare rewind');
  perform pg_temp.expect(rewind_refusal(p, common_k, null) = words, 'no pierce passed a rewind');

  -- Latest played first: a rarer rewind over a lesser one is drawn, and the first that turns the card away speaks.
  r2 := pg_temp.rewind_play(a, t, p, 'rwtimeu', base + interval '3 minutes', now() + interval '1 day', now() - interval '5 minutes');
  select count(*), min(play::text) filter (where true) into n, words from live_rewind(p);
  perform pg_temp.expect(n = 2 and (select play from live_rewind(p) limit 1) = r2, 'live_rewind did not list the latest played first');
  perform pg_temp.expect(rewind_refusal(p, common_k) like 'this post''s Rw Time Uncommon turns away cards up to uncommon until %', format('the latest rewind did not speak first: %s', rewind_refusal(p, common_k)));
  perform pg_temp.expect(rewind_refusal(p, rare_k) like 'this post''s Rw Time turns away cards up to rare until %', format('a card above the latest rewind''s cut-off was not turned away by the older one: %s', rewind_refusal(p, rare_k)));

  -- It ends by an admin's end, and by time.
  perform tests.become(admin); perform reverse_card(r2); perform tests.unbecome();
  perform pg_temp.expect((select count(*) from live_rewind(p)) = 1 and (select play from live_rewind(p)) = r1, 'an ended rewind was still live');
  perform tests.become(admin); perform reverse_card(r1); perform tests.unbecome();
  perform pg_temp.expect((select count(*) from live_rewind(p)) = 0 and rewind_refusal(p, common_k) is null, 'a rewind an admin ended still froze the post');
  -- Written in one statement and read in the next: a STABLE function in the statement that inserts reads the snapshot from before the insert.
  gone := pg_temp.rewind_play(a, t, other, 'rwtime', base, now() - interval '1 minute', now() - interval '2 days');
  perform pg_temp.expect(gone is not null and (select count(*) from live_rewind(other)) = 0 and rewind_refusal(other, common_k) is null,
    'a rewind whose time was up still froze the post');
  -- A caught play never landed.
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'rwtime', 'reach', 'post', 'ends', now() + interval '1 day', 'rewind_at', base, 'caught', 'x'), other, now());
  perform pg_temp.expect((select count(*) from live_rewind(other)) = 0, 'a caught rewind was live');
  insert into rw_fix values ('frozen', p), ('r1', r1), ('r2', r2);
end $$;

-- ---- The index: the freeze's lookup can read play_post by post (play_post_up), never a scan of acts ----
-- On a table this small the planner prefers a sequential scan whatever the indexes; with sequential scans off, the plan shows which index the predicate can use.
select tests.unbecome();
do $$
declare plan text := ''; line text;
begin
  set local enable_seqscan = off;
  for line in execute 'explain (costs off) select pp.play from play_post pp where pp.post = ''00000000-0000-0000-0000-000000000000''::uuid and pp.over_at is null and (pp.ends_at is null or pp.ends_at > now())' loop
    plan := plan || line || E'\n';
  end loop;
  perform pg_temp.expect(plan like '%play_post_up%', format('the live-play lookup does not use play_post_up: %s', plan));
  perform pg_temp.expect(plan not like '%Seq Scan on acts%', format('the live-play lookup scans acts: %s', plan));
end $$;

-- ---- card_target carries a live rewind's rarity ----
select tests.unbecome();
do $$
declare
  a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t');
  base timestamptz := now() - interval '1 hour';
  p uuid := tests.post(a, t, 'A post a rewind is on.', base);
  r uuid := pg_temp.rewind_play(a, t, p, 'rwtime', base + interval '2 minutes', now() + interval '2 days', now() - interval '10 minutes');
  m uuid := tests.act(a, 'card', t, jsonb_build_object('card', 'rwrare', 'reach', 'post', 'ends', now() + interval '1 day'), p, now() - interval '9 minutes');
  target jsonb; eff jsonb;
begin
  target := card_target(p);
  eff := (select e from jsonb_array_elements(target -> 'effects') e where e ->> 'act' = r::text);
  perform pg_temp.expect(eff -> 'rewind' = '{"upTo": "rare"}'::jsonb, format('the rewind''s effect does not carry rewind {upTo: rare}: %s', eff));
  -- It carries when it was played, so the engine's freeze names the latest-played rewind whatever order the effects come in (frozenRefusal).
  perform pg_temp.expect((eff ->> 'at')::timestamptz = (select created_at from acts where id = r), format('the rewind''s effect does not carry when it was played: %s', eff));
  eff := (select e from jsonb_array_elements(target -> 'effects') e where e ->> 'act' = m::text);
  perform pg_temp.expect(eff is not null and not eff ? 'rewind' and not eff ? 'at', format('an effect that is no rewind carries a rewind key or its time: %s', eff));
end $$;

-- ---- rewind_view: the version at the point, the hidden placeholder, and null for what is no rewind ----
select tests.unbecome();
do $$
declare
  a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t'); admin uuid := pg_temp.fix('admin');
  base timestamptz := now() - interval '1 hour';
  p uuid := tests.post(a, t, 'As first posted.', base);
  e1 uuid := tests.act(a, 'edit', t, '{"body": "First edit."}', p, base + interval '10 minutes');
  e2 uuid := tests.act(a, 'edit', t, '{"body": "Second edit."}', p, base + interval '20 minutes');
  at_first timestamptz := rewind_point_at(p, p);
  r_first uuid := pg_temp.rewind_play(a, t, p, 'rwtime', rewind_point_at(p, p), now() + interval '2 days', base + interval '30 minutes');
  r_e1 uuid := pg_temp.rewind_play(a, t, p, 'rwtime', rewind_point_at(p, e1), now() + interval '2 days', base + interval '31 minutes');
  m uuid := tests.act(a, 'card', t, jsonb_build_object('card', 'rwrare', 'reach', 'post', 'ends', now() + interval '1 day'), p, base + interval '32 minutes');
  r_e2 uuid := pg_temp.rewind_play(a, t, p, 'rwtime', rewind_point_at(p, e2), now() + interval '2 days', base + interval '33 minutes');
  caught uuid; v jsonb;
begin
  v := rewind_view(r_first);
  perform pg_temp.expect(v ->> 'play' = r_first::text and v ->> 'post' = p::text and (v ->> 'at')::timestamptz = at_first, format('the view names the play, the post and the point: %s', v));
  perform pg_temp.expect(v -> 'version' -> 'current_payload' ->> 'body' = 'As first posted.', format('the first point shows the post as first posted: %s', v -> 'version' -> 'current_payload'));
  perform pg_temp.expect(v -> 'version' ->> 'id' = p::text, format('the version is the post''s projection: %s', v -> 'version' ->> 'id'));
  -- With an edit before it: the latest version at or before the point, not the first.
  v := rewind_view(r_e2);
  perform pg_temp.expect(v -> 'version' -> 'current_payload' ->> 'body' = 'Second edit.' and (v -> 'version' ->> 'edited_at')::timestamptz = base + interval '20 minutes', format('the second edit''s point shows an earlier version: %s', v -> 'version' -> 'current_payload'));
  v := rewind_view(r_e1);
  perform pg_temp.expect(v -> 'version' -> 'current_payload' ->> 'body' = 'First edit.', format('the edit''s point shows that edit and not the later one: %s', v -> 'version' -> 'current_payload'));
  perform pg_temp.expect((v -> 'version' ->> 'edited_at')::timestamptz = base + interval '10 minutes' and (v -> 'version' ->> 'shown_edited_at')::timestamptz = base + interval '10 minutes', format('last edited reads as of the version: %s', v -> 'version'));
  perform pg_temp.expect(card_target(p) -> 'body' = to_jsonb('Second edit.'::text), 'the post''s current words are not the latest edit (an edit during a rewind lands)');

  -- The shown version's edit falls inside the grace window: the post's own point (its time plus the grace) shows the latest edit saved by then, and that edit is part of the post as first posted, so it shows no "edited" time.
  declare
    pp uuid := tests.post(a, t, 'Posted.', base); g1 uuid := tests.act(a, 'edit', t, '{"body": "Edited inside the grace."}', pp, base + interval '1 minute');
    g2 uuid := tests.act(a, 'edit', t, '{"body": "Edited exactly at the grace."}', pp, base + interval '2 minutes');
    gr uuid; gv jsonb;
  begin
    gr := pg_temp.rewind_play(a, t, pp, 'rwtime', rewind_point_at(pp, pp), now() + interval '2 days', base + interval '34 minutes');
    gv := rewind_view(gr);
    perform pg_temp.expect(gv -> 'version' -> 'current_payload' ->> 'body' = 'Edited exactly at the grace.' and (gv -> 'version' ->> 'edited_at')::timestamptz = base + interval '2 minutes'
      and gv -> 'version' -> 'shown_edited_at' = 'null'::jsonb, format('an edit inside the grace was shown as an edit in the rewind: %s', gv -> 'version'));
  end;
  -- Not a rewind: a play of another card, a post, an Act that is not there, null.
  perform pg_temp.expect(rewind_view(m) is null, 'the view of a play that is no rewind was not null');
  perform pg_temp.expect(rewind_view(p) is null, 'the view of a post was not null');
  perform pg_temp.expect(rewind_view(gen_random_uuid()) is null and rewind_view(null) is null, 'the view of nothing was not null');
  -- A rewind that was caught never took.
  caught := tests.act(a, 'card', t, jsonb_build_object('card', 'rwtime', 'reach', 'post', 'rewind_at', base, 'caught', 'x'), p, now());
  perform pg_temp.expect(caught is not null and rewind_view(caught) is null, 'a caught rewind had a view');

  -- An admin hides the version the point shows: the view gives the hidden placeholder, as History does.
  perform tests.become(admin);
  perform decide(null, e1, 'hide', null, 'hidden for the rewind');
  perform tests.unbecome();
  v := rewind_view(r_e1);
  perform pg_temp.expect(v -> 'version' -> 'current_payload' -> 'body' = 'null'::jsonb, format('a hidden version showed its words in the rewind: %s', v -> 'version' -> 'current_payload'));
  perform pg_temp.expect(rewind_view(r_first) -> 'version' -> 'current_payload' ->> 'body' = 'As first posted.', 'hiding an edit hid the post as first posted');
  -- And it is granted as play_moment is, to signed-in players and the service role.
  perform pg_temp.expect(has_function_privilege('authenticated', 'rewind_view(uuid)', 'execute') and has_function_privilege('service_role', 'rewind_view(uuid)', 'execute')
    and has_function_privilege('anon', 'rewind_view(uuid)', 'execute') = has_function_privilege('anon', 'play_moment(uuid)', 'execute'), 'rewind_view is not granted as play_moment is');
  perform pg_temp.expect(not has_function_privilege('authenticated', 'live_rewind(uuid)', 'execute') and not has_function_privilege('authenticated', 'rewind_point_problem(uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'rewind_point_at(uuid, uuid)', 'execute') and not has_function_privilege('authenticated', 'rewind_refusal(uuid, card_kinds, text)', 'execute'), 'a helper is granted to an API role');
end $$;

-- ---- The second half (Task 2, items 9, 10 and 12, and spring_traps) ----
-- Plays go through the real play_card and set_card as the service role acts for a player; a refusal comes back as `sqlstate message`, with its hint.

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k, generate_series(1, 12)
$$;

create function pg_temp.play(who uuid, card text, through uuid, target uuid, config jsonb default '{}', out id uuid, out said text, out hint text) language plpgsql as $$
begin
  perform tests.become_service();
  begin
    id := (play_card(who, card, through, target, config, 0, '') ->> 'id')::uuid;
  exception when others then
    get stacked diagnostics hint = pg_exception_hint;
    said := sqlstate || ' ' || sqlerrm;
  end;
  perform tests.unbecome();
end $$;

create function pg_temp.back(who uuid, card text, through uuid, target uuid, catches text default null, out id uuid, out said text) language plpgsql as $$
begin
  perform tests.become_service();
  begin
    id := (set_card(who, card, through, target, '{}', 0, catches) ->> 'id')::uuid;
  exception when others then
    said := sqlstate || ' ' || sqlerrm;
  end;
  perform tests.unbecome();
end $$;

-- A post `by` wrote an hour ago and edited once past the grace: its first point is offered.
create function pg_temp.edited(by_character uuid, in_thread uuid, body text default 'As first posted.') returns uuid language plpgsql as $$
declare p uuid := tests.post(by_character, in_thread, body, now() - interval '1 hour');
begin
  perform tests.act(by_character, 'edit', in_thread, jsonb_build_object('body', body || ' Edited.'), p, now() - interval '50 minutes');
  return p;
end $$;

-- A back on the post is still face down: set, with no spring and no take-back written for it.
create function pg_temp.still_down(back uuid) returns boolean language sql as $$
  select exists (select 1 from face_down f where f.play = back and f.ends_at > now())
     and not exists (select 1 from acts s where s.kind in ('spring', 'take_back') and (s.payload ->> 'set') = back::text)
$$;

select tests.unbecome();
do $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, gimmick) values ('rwuse', 'Rw Use', 'sweet', 'uncommon', 'use', '{post}', interval '1 day', 1, '{"kind": "ward", "upTo": "common"}');
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, stack) values
    ('rwsetr', 'Rw Set Rare', 'salty', 'rare', 'set', '{"trigger": {"on": "cast"}}', '{post}', null, 1),
    ('rwrev', 'Rw Reversal', 'salty', 'legendary', 'set', '{"trigger": {"on": "cast"}}', '{post}', null, 1),
    ('rwidle', 'Rw Idle', 'pepperoni', 'common', 'set', '{"trigger": {"on": "visit"}}', '{post}', null, 1);
  insert into characters (name, staff, staff_kind, debuted_at) values ('Rw Staff', 'rw-staff', 'persona', now());
end $$;

-- ---- place_cast: the point, the freeze, and the end of the freeze ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t'); admin uuid := pg_temp.fix('admin');
  bob uuid := tests.account('rw-bob'); b uuid := tests.character(bob, 'Rw Bob');
  p0 uuid := tests.post(a, t, 'Never edited.', now() - interval '1 hour');
  p1 uuid := pg_temp.edited(a, t); p1c uuid := pg_temp.edited(a, t, 'The control.'); p2 uuid := pg_temp.edited(a, t, 'To run out.');
  r record; rev uuid; control_back uuid; back uuid; rw uuid; rw2 uuid; pl jsonb; frozen constant text := 'this post''s Rw Time turns away cards up to rare until %';
begin
  perform pg_temp.hand(bob, 'rwtime', 'rwcommon', 'rwuncommon', 'rwlegend');
  perform pg_temp.hand(ann, 'rwuse', 'rwsetr', 'rwrev', 'rwtime', 'rwcommon');
  -- The point's words, in the engine's words, and refused as a configuration refusal: no point, a post that shows the same, a version in the grace, another post's version.
  r := pg_temp.play(bob, 'rwtime', b, p0, jsonb_build_object('to', p0));
  perform pg_temp.expect(r.said = '22023 this post shows the same at that point as it does now' and r.hint = 'kayfabb.refusal', format('a rewind of a post never edited, with no plays: %s / %s', r.said, r.hint));
  r := pg_temp.play(bob, 'rwtime', b, p1, '{}');
  perform pg_temp.expect(r.said = '22023 pick a point from this post''s History' and r.hint = 'kayfabb.refusal', format('a rewind with no point: %s / %s', r.said, r.hint));
  r := pg_temp.play(bob, 'rwtime', b, p1, '{"to": "not a uuid"}');
  perform pg_temp.expect(r.said = '22023 pick a point from this post''s History' and r.hint = 'kayfabb.refusal', format('a rewind with a point that is no uuid: %s / %s', r.said, r.hint));
  r := pg_temp.play(bob, 'rwtime', b, p1, '{"to": 7}');
  perform pg_temp.expect(r.said = '22023 pick a point from this post''s History', format('a rewind with a point that is a number: %s', r.said));
  r := pg_temp.play(bob, 'rwtime', b, p1, jsonb_build_object('to', p0));
  perform pg_temp.expect(r.said = '22023 pick a point from this post''s History', format('a rewind to another post''s version: %s', r.said));
  r := pg_temp.play(bob, 'rwtime', b, pg_temp.fix('p'), jsonb_build_object('to', pg_temp.fix('e_in')));
  perform pg_temp.expect(r.said = '22023 that version was saved in the edit grace window, so it is part of the post as first posted', format('a rewind to a version inside the grace: %s', r.said));
  perform pg_temp.expect(not exists (select 1 from acts k where k.kind = 'card' and k.payload ->> 'card' = 'rwtime' and k.target_act_id in (p0, p1, pg_temp.fix('p'))), 'a refused rewind wrote a card Act');

  -- Backs set before the rewind: a Reversal that catches a legendary Move, on the post to be frozen and on a control post.
  back := (pg_temp.back(ann, 'rwrev', a, p1, 'rwlegend')).id;
  control_back := (pg_temp.back(ann, 'rwrev', a, p1c, 'rwlegend')).id;
  perform pg_temp.expect(back is not null and control_back is not null, 'the backs were not set');
  -- The control: with no rewind on the post, the same legendary Move meets its back.
  r := pg_temp.play(bob, 'rwlegend', b, p1c);
  perform pg_temp.expect(r.said is null and exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = control_back::text), format('the control: a legendary Move did not spring the back (no rewind): %s', r.said));

  -- The rewind lands, naming the point.
  r := pg_temp.play(bob, 'rwtime', b, p1, jsonb_build_object('to', p1));
  perform pg_temp.expect(r.said is null, format('the rewind was refused on a post edited past the grace: %s', r.said));
  rw := r.id;
  perform pg_temp.expect((select (k.payload ->> 'rewind_at')::timestamptz from acts k where k.id = rw) = rewind_point_at(p1, p1)
    and (select k.payload ->> 'ends' from acts k where k.id = rw) is not null and (select count(*) from live_rewind(p1) where play = rw and at = rewind_point_at(p1, p1)) = 1,
    format('the rewind''s Act does not carry rewind_at and ends: %s', (select payload from acts where id = rw)));

  -- A second rewind card (rare) on the post is refused with the freeze's words, and so is every card up to rare.
  r := pg_temp.play(bob, 'rwtime', b, p1, jsonb_build_object('to', p1));
  perform pg_temp.expect(r.said like '42501 ' || frozen and r.hint = 'kayfabb.refusal', format('a second rewind card was not refused in the freeze''s words: %s / %s', r.said, r.hint));
  r := pg_temp.play(bob, 'rwcommon', b, p1);
  perform pg_temp.expect(r.said like '42501 ' || frozen and r.hint = 'kayfabb.refusal', format('a common Move was not refused in the freeze''s words: %s', r.said));
  r := pg_temp.play(bob, 'rwuncommon', b, p1);
  perform pg_temp.expect(r.said like '42501 ' || frozen, format('an uncommon Move was not refused in the freeze''s words: %s', r.said));
  -- The author's own Use (uncommon): refused, and the words are the same as a Move's and as another character's would be.
  r := pg_temp.play(ann, 'rwuse', a, p1);
  perform pg_temp.expect(r.said like '42501 ' || frozen, format('an uncommon Use on the author''s own post was not refused in the freeze''s words: %s', r.said));
  perform pg_temp.expect(r.said = (pg_temp.play(bob, 'rwcommon', b, p1)).said, 'the freeze said different words to a Use and to a Move');
  -- A rare Set is refused, in the same words, before anything is written; the rewind card itself is never set (face up).
  r := pg_temp.back(ann, 'rwsetr', a, p1, 'rwcommon');
  perform pg_temp.expect(r.said like '42501 ' || frozen, format('a rare Set on a rewound post was not refused in the freeze''s words: %s', r.said));
  r := pg_temp.back(ann, 'rwtime', a, p1);
  perform pg_temp.expect(r.said = '22023 Rw Time is played face up and never set face down', format('a rewind card set face down: %s', r.said));
  r := pg_temp.back(ann, 'rwtime', a, p0);
  perform pg_temp.expect(r.said = '22023 Rw Time is played face up and never set face down', format('a rewind card set face down on a post with no rewind: %s', r.said));
  perform pg_temp.expect(not exists (select 1 from acts s where s.kind = 'set' and s.target_act_id = p1 and s.id <> back), 'a refused Set wrote an Act');

  -- A legendary Move lands, and the back already face down there does not spring: it is still face down after, with no spring Act.
  r := pg_temp.play(bob, 'rwlegend', b, p1);
  perform pg_temp.expect(r.said is null and r.id is not null, format('a legendary Move was refused under a rare rewind: %s', r.said));
  perform pg_temp.expect(pg_temp.still_down(back), 'a back sprang under a rewind');
  perform pg_temp.expect(not exists (select 1 from acts s where s.kind = 'spring' and s.target_act_id = p1), 'a spring Act was written on a rewound post');
  perform pg_temp.expect((select a2.payload ? 'caught' from acts a2 where a2.id = r.id) = false, 'the Move that met no back was caught');

  -- It ends by an admin: the same common Move lands. The back is still set.
  perform tests.become(admin); perform reverse_card(rw); perform tests.unbecome();
  r := pg_temp.play(bob, 'rwcommon', b, p1);
  perform pg_temp.expect(r.said is null, format('a common Move was refused after an admin ended the rewind: %s', r.said));

  -- It ends by its time: played, then its `ends` passes (written into the past by the test, as the append-only trigger is held off for this statement alone).
  r := pg_temp.play(bob, 'rwtime', b, p2, jsonb_build_object('to', p2));
  perform pg_temp.expect(r.said is null, format('the rewind on the second post was refused: %s', r.said));
  rw2 := r.id;
  perform pg_temp.expect((pg_temp.play(bob, 'rwcommon', b, p2)).said like '42501 %', 'the second post was not frozen');
  alter table acts disable trigger user;
  update acts set payload = jsonb_set(payload, '{ends}', to_jsonb(now() - interval '1 minute')) where id = rw2;
  alter table acts enable trigger user;
  update play_post set ends_at = now() - interval '1 minute' where play = rw2;
  perform pg_temp.expect((select count(*) from live_rewind(p2)) = 0, 'a rewind whose time passed was live');
  r := pg_temp.play(bob, 'rwcommon', b, p2);
  perform pg_temp.expect(r.said is null, format('a common Move was refused after the rewind''s time passed: %s', r.said));
  insert into rw_fix values ('bob', bob), ('b', b), ('p1', p1), ('rw1', rw), ('back1', back);
end $$;

-- ---- The rewind's own play lands frozen: a back that names the rewind card does not catch or spring on it ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t'); bob uuid := pg_temp.fix('bob'); b uuid := pg_temp.fix('b');
  p uuid := pg_temp.edited(a, t, 'A back waits here.'); back uuid; r record;
begin
  perform pg_temp.hand(ann, 'rwrev'); perform pg_temp.hand(bob, 'rwtime');
  back := (pg_temp.back(ann, 'rwrev', a, p, 'rwtime')).id;
  perform pg_temp.expect(back is not null, 'the back that names the rewind card was not set');
  r := pg_temp.play(bob, 'rwtime', b, p, jsonb_build_object('to', p));
  perform pg_temp.expect(r.said is null, format('the rewind was refused or caught by a back: %s', r.said));
  perform pg_temp.expect(not (select payload ? 'caught' from acts where id = r.id) and (select count(*) from live_rewind(p) where play = r.id) = 1, 'the rewind did not land');
  perform pg_temp.expect(pg_temp.still_down(back), 'a back sprang on the rewind''s own play');
  perform pg_temp.expect(not exists (select 1 from acts s where s.kind = 'spring' and s.target_act_id = p), 'a spring Act was written for the rewind''s own play');
end $$;

-- ---- No back springs under a rewind: a quote, a staff quote and a visit, each with its control ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t'); bob uuid := pg_temp.fix('bob'); b uuid := pg_temp.fix('b'); admin uuid := pg_temp.fix('admin');
  staff uuid := (select id from characters where staff = 'rw-staff');
  q uuid; qr uuid; mv uuid; idle uuid; mv_r uuid; idle_r uuid; v uuid; made jsonb; rw uuid; sprung jsonb;
begin
  perform pg_temp.hand(ann, 'rwcommon', 'rwidle'); perform pg_temp.hand(bob, 'rwtime');
  -- A Move back and an Idle back on a post with no rewind (the control) and on a post under one (the other).
  q := pg_temp.edited(a, t, 'Control, no rewind.'); qr := pg_temp.edited(a, t, 'Under a rewind.');
  mv := (pg_temp.back(ann, 'rwcommon', a, q)).id;
  mv_r := (pg_temp.back(ann, 'rwcommon', a, qr)).id;
  perform pg_temp.expect(mv is not null and mv_r is not null, 'the Move backs were not set');
  rw := (pg_temp.play(bob, 'rwtime', b, qr, jsonb_build_object('to', qr))).id;
  perform pg_temp.expect(rw is not null, 'the rewind was not played');

  -- A quote through post(): springs on the control, and on the rewound post nothing, and the back stays down.
  perform tests.become(bob);
  made := post(t, b, 'Quoting the control.', q);
  perform tests.unbecome();
  perform pg_temp.expect(made ? 'sprung' and exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = mv::text), format('the control: a quote did not spring the Move: %s', made));
  perform tests.become(bob);
  made := post(t, b, 'Quoting the rewound post.', qr);
  perform tests.unbecome();
  perform pg_temp.expect(not made ? 'sprung' and pg_temp.still_down(mv_r), format('a quote sprang a back under a rewind: %s', made));
  -- A staff quote: the control is a post of its own, since the quote above spent the first back.
  q := pg_temp.edited(a, t, 'Control for staff.');
  mv := (pg_temp.back(ann, 'rwcommon', a, q)).id;
  made := write_staff_act('rw-staff', 'post', t, q, jsonb_build_object('body', 'Staff quotes the control.'));
  perform pg_temp.expect(made ? 'sprung' and exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = mv::text), format('the control: a staff quote did not spring the Move: %s', made));
  made := write_staff_act('rw-staff', 'post', t, qr, jsonb_build_object('body', 'Staff quotes the rewound post.'));
  perform pg_temp.expect(not made ? 'sprung' and pg_temp.still_down(mv_r), format('a staff quote sprang a back under a rewind: %s', made));
  -- A visit that starts on the post: the Idle back's trigger.
  -- A post holds one back at a time, so each visit gets a post of its own.
  q := pg_temp.edited(a, t, 'Control for visits.');
  idle := (pg_temp.back(ann, 'rwidle', a, q)).id;
  perform pg_temp.expect(idle is not null, 'the Idle back was not set');
  perform set_config('kayfabb.staff_writer', 'on', true);
  v := tests.act(staff, 'visit', t, jsonb_build_object('charges', jsonb_build_array(jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'patrol', 'about_act', q::text)),
    'ends_at', now() + interval '1 hour', 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.'), q);
  perform set_config('kayfabb.staff_writer', '', true);
  sprung := spring_traps('visit', q, v);
  perform pg_temp.expect(sprung is not null and exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = idle::text), 'the control: a visit did not spring the Idle');
  -- Now the Idle on a post, then a rewind, then a visit.
  qr := pg_temp.edited(a, t, 'Idle under a rewind.');
  idle_r := (pg_temp.back(ann, 'rwidle', a, qr)).id;
  rw := (pg_temp.play(bob, 'rwtime', b, qr, jsonb_build_object('to', qr))).id;
  perform pg_temp.expect(rw is not null, 'the rewind over the Idle was refused');
  perform set_config('kayfabb.staff_writer', 'on', true);
  v := tests.act(staff, 'visit', t, jsonb_build_object('charges', jsonb_build_array(jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'patrol', 'about_act', qr::text)),
    'ends_at', now() + interval '1 hour', 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.'), qr);
  perform set_config('kayfabb.staff_writer', '', true);
  sprung := spring_traps('visit', qr, v);
  perform pg_temp.expect(sprung is null and pg_temp.still_down(idle_r), format('a visit sprang a back under a rewind: %s', sprung));
  -- A cast trigger as spring_traps meets it, and a trigger with no kind of its own, the same: nothing.
  perform pg_temp.expect(spring_traps('cast', qr, v, 'rwlegend') is null and spring_traps('quote', qr, v) is null, 'a cast or a quote sprang a back under a rewind');
  -- The rewind ends: the Idle springs again on the next visit.
  perform tests.become(admin); perform reverse_card(rw); perform tests.unbecome();
  sprung := spring_traps('visit', qr, v);
  perform pg_temp.expect(sprung is not null and exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = idle_r::text), 'a back stayed down after the rewind ended');
end $$;

-- ---- An edit during a rewind lands: the post's current words are the new ones, and the rewind's view still gives the old ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); p1 uuid := pg_temp.fix('p1'); rw uuid := pg_temp.fix('rw1'); t uuid := pg_temp.fix('t');
  p uuid := pg_temp.edited(a, t, 'Words as first posted.'); r record; played uuid; v jsonb;
begin
  r := pg_temp.play(pg_temp.fix('bob'), 'rwtime', pg_temp.fix('b'), p, jsonb_build_object('to', p));
  perform pg_temp.expect(r.said is null, format('the rewind was refused: %s', r.said));
  played := r.id;
  perform tests.become(ann);
  perform edit_post(p, a, 'Words written during the rewind.');
  perform tests.unbecome();
  perform pg_temp.expect((select a2.current_payload ->> 'body' from acts_public a2 where a2.id = p) = 'Words written during the rewind.', format('the edit during a rewind did not land: %s', (select a2.current_payload from acts_public a2 where a2.id = p)));
  v := rewind_view(played);
  perform pg_temp.expect(v -> 'version' -> 'current_payload' ->> 'body' = 'Words as first posted.', format('the rewind''s view changed with the edit: %s', v -> 'version' -> 'current_payload'));
end $$;

-- ---- thread_page carries the rewind in `rewinds`: for a post of the page, for the ORIGIN post of a spun thread, and nothing once it is ended ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); admin uuid := pg_temp.fix('admin'); bob uuid := pg_temp.fix('bob'); b uuid := pg_temp.fix('b');
  t uuid := tests.thread('Rw page'); post_on uuid; plain uuid; r record; rw uuid; origin_post uuid; made jsonb; s uuid; page jsonb; spun_page jsonb; rewound text;
begin
  post_on := pg_temp.edited(a, t, 'A post on the page, rewound.');
  plain := tests.post(a, t, 'A post on the page, not rewound.');
  perform tests.become(ann); page := thread_page(t, 1, null, 25, '{}'); perform tests.unbecome();
  perform pg_temp.expect(page -> 'rewinds' = '[]'::jsonb, format('a page with no rewind has rewinds: %s', page -> 'rewinds'));
  r := pg_temp.play(bob, 'rwtime', b, post_on, jsonb_build_object('to', post_on));
  perform pg_temp.expect(r.said is null, format('the rewind was refused: %s', r.said)); rw := r.id;
  perform tests.become(ann); page := thread_page(t, 1, null, 25, '{}'); perform tests.unbecome();
  perform pg_temp.expect(jsonb_array_length(page -> 'rewinds') = 1 and page -> 'rewinds' -> 0 ->> 'play' = rw::text and page -> 'rewinds' -> 0 ->> 'post' = post_on::text
    and page -> 'rewinds' -> 0 -> 'version' -> 'current_payload' ->> 'body' = 'A post on the page, rewound.', format('the page does not carry the rewind: %s', page -> 'rewinds'));
  perform pg_temp.expect(page -> 'rewinds' -> 0 = rewind_view(rw), 'the page''s rewind is not rewind_view''s answer');
  -- Another player's page is the same: nothing in it depends on who reads.
  perform tests.become(bob); page := thread_page(t, 1, null, 25, '{}'); perform tests.unbecome();
  perform pg_temp.expect(jsonb_array_length(page -> 'rewinds') = 1, 'another player''s page does not carry the rewind');
  -- A rewind a caught play never was: nothing.
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'rwtime', 'reach', 'post', 'ends', now() + interval '1 day', 'rewind_at', now() - interval '1 hour', 'caught', 'x'), plain);
  perform tests.become(ann); page := thread_page(t, 1, null, 25, '{}'); perform tests.unbecome();
  perform pg_temp.expect(jsonb_array_length(page -> 'rewinds') = 1, 'a caught rewind is on the page');
  -- It ends: nothing.
  perform tests.become(admin); perform reverse_card(rw); perform tests.unbecome();
  perform tests.become(ann); page := thread_page(t, 1, null, 25, '{}'); perform tests.unbecome();
  perform pg_temp.expect(page -> 'rewinds' = '[]'::jsonb, format('an ended rewind is on the page: %s', page -> 'rewinds'));

  -- The ORIGIN post of a spun thread: a rewind on the post the thread was spun from shows on the spun thread's page, and on the origin's own thread.
  origin_post := pg_temp.edited(pg_temp.fix('a'), t, 'The post that is spun.');
  r := pg_temp.play(bob, 'rwtime', b, origin_post, jsonb_build_object('to', origin_post));
  perform pg_temp.expect(r.said is null, format('the rewind on the origin post was refused: %s', r.said)); rw := r.id;
  perform tests.become(bob);
  made := spin(origin => origin_post, through => b, title => 'Rw spun thread', body => 'The opening post.', at_post => null);
  perform tests.unbecome();
  s := (select thread from acts where id = (made -> 'act' ->> 'id')::uuid);
  perform tests.become(ann); spun_page := thread_page(s, 1, null, 25, '{}'); perform tests.unbecome();
  perform pg_temp.expect(spun_page -> 'origin' ->> 'act' is not null or spun_page ? 'origin', format('the spun thread has no origin: %s', left(spun_page::text, 300)));
  perform pg_temp.expect(jsonb_array_length(spun_page -> 'rewinds') = 1 and spun_page -> 'rewinds' -> 0 ->> 'play' = rw::text and spun_page -> 'rewinds' -> 0 ->> 'post' = origin_post::text,
    format('the spun thread''s page does not carry the origin post''s rewind: %s', spun_page -> 'rewinds'));
  perform tests.become(admin); perform reverse_card(rw); perform tests.unbecome();
  perform tests.become(ann); spun_page := thread_page(s, 1, null, 25, '{}'); perform tests.unbecome();
  perform pg_temp.expect(spun_page -> 'rewinds' = '[]'::jsonb, format('an ended rewind is on the spun thread''s page: %s', spun_page -> 'rewinds'));
  -- Its grants are as they were: a signed-in player reads the page; the set-based read is granted as post_play_ids is and the one-post helpers still are not.
  perform pg_temp.expect(has_function_privilege('authenticated', 'post_rewind_plays(uuid[])', 'execute') and has_function_privilege('service_role', 'post_rewind_plays(uuid[])', 'execute')
    and not has_function_privilege('anon', 'post_rewind_plays(uuid[])', 'execute'), 'post_rewind_plays is not granted as post_play_ids is');
  perform pg_temp.expect((select count(*) from post_rewind_plays(array[post_on, origin_post, plain])) = 0, 'post_rewind_plays read an ended rewind');
end $$;

-- ---- The lookup's plan: the page's rewind lookup is a probe of play_post_up by post, never a scan of play_post or acts ----
-- 4,000 posts with a play each (a quarter of them rewinds, in force), the kept rows written as the migrations' backfills write them, then analyzed; the statement is post_rewind_plays' own, for the 25 posts of a page.
select tests.unbecome();
do $$
declare
  a uuid := pg_temp.fix('a'); t uuid := tests.thread('Rw scale'); plan text := ''; line text; ids uuid[]; n integer;
begin
  alter table acts disable trigger user;
  insert into acts (character, kind, thread, payload, seq, created_at)
  select a, 'post', t, jsonb_build_object('body', 'Post ' || g), 100 + g, now() - interval '30 days' + g * interval '1 second' from generate_series(1, 4000) g;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select a, 'card', t, x.id, jsonb_build_object('card', case when x.seq % 4 = 0 then 'rwtime' else 'rwrare' end, 'reach', 'post', 'rewind_at', x.created_at, 'ends', now() + interval '1 day', 'layer', 1), x.created_at + interval '1 minute'
  from acts x where x.thread = t and x.kind = 'post';
  alter table acts enable trigger user;
  insert into play_post select r.* from acts x cross join lateral play_row(x.id) r where x.kind = 'card' and x.thread = t;
  analyze acts; analyze play_post;
  select array_agg(x.id) into ids from (select id from acts where thread = t and kind = 'post' and seq % 4 = 0 order by seq limit 25) x;
  select count(*) into n from post_rewind_plays(ids);
  perform pg_temp.expect(n = 25, format('post_rewind_plays answered %s plays for 25 rewound posts', n));
  perform pg_temp.expect((select count(*) from post_rewind_plays((select array_agg(x.id) from (select id from acts where thread = t and kind = 'post' and seq % 4 = 1 order by seq limit 25) x))) = 0, 'post_rewind_plays answered plays that are no rewind');
  perform pg_temp.expect((select count(*) from live_rewind(ids[1])) = 1, 'live_rewind and post_rewind_plays disagree');
  for line in execute format($q$explain (costs off) select p.post, p.play from play_post p join card_kinds ck on ck.key = p.kind and ck.rewind is not null
      where p.post = any (%L::uuid[]) and p.over_at is null and p.ends_at > now() and p.reach = 'post'$q$, ids) loop
    plan := plan || line || E'\n';
  end loop;
  perform pg_temp.expect(plan like '%play_post_up%', format('the rewind lookup does not use play_post_up: %s', plan));
  perform pg_temp.expect(plan ~ 'Index Cond: \(\(?post = ANY', format('the rewind lookup''s index is not read by post: %s', plan));
  perform pg_temp.expect(plan not like '%Seq Scan on play_post%' and plan not like '%Seq Scan on acts%', format('the rewind lookup scans: %s', plan));
  raise notice 'the rewind lookup for 25 posts of 4,000: %', replace(plan, E'\n', ' | ');
end $$;

-- ---- A pierce passes the freeze when its card is no rarer than the pierce's upTo ----
-- Two characters, each with a pierce: an uncommon one (the rewind's card is rare, so it is not passed) and a rare one (it is).
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t'); bob uuid := pg_temp.fix('bob'); b uuid := pg_temp.fix('b');
  cat uuid := tests.account('rw-cat'); c uuid := tests.character(cat, 'Rw Cat');
  bp uuid := tests.post(b, t, 'Bob''s post.'); cp uuid := tests.post(c, t, 'Cat''s post.');
  p uuid := pg_temp.edited(a, t, 'Under a rare rewind.'); weak uuid; strong uuid; r record; lands uuid;
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, gimmick) values
    ('rwpierceu', 'Rw Pierce Uncommon', 'pepperoni', 'uncommon', 'use', '{character}', interval '3 days', 1, '{"kind": "pierce", "upTo": "uncommon"}'),
    ('rwpiercer', 'Rw Pierce Rare', 'pepperoni', 'rare', 'use', '{character}', interval '3 days', 1, '{"kind": "pierce", "upTo": "rare"}');
  perform pg_temp.hand(bob, 'rwtime', 'rwcommon', 'rwpierceu'); perform pg_temp.hand(cat, 'rwcommon', 'rwpiercer');
  perform pg_temp.expect((pg_temp.play(bob, 'rwtime', b, p, jsonb_build_object('to', p))).said is null, 'the rewind was refused');
  perform tests.become_service();
  weak := (play_card(bob, 'rwpierceu', b, b, '{}', 0, '', 'character', bp) ->> 'id')::uuid;
  strong := (play_card(cat, 'rwpiercer', c, c, '{}', 0, '', 'character', cp) ->> 'id')::uuid;
  perform tests.unbecome();
  -- An uncommon pierce does not pass a rare rewind: the common Move is turned away as before, and the pierce is not spent.
  r := pg_temp.play(bob, 'rwcommon', b, p);
  perform pg_temp.expect(r.said like '42501 this post''s Rw Time turns away cards up to rare until %', format('an uncommon pierce passed a rare rewind: %s', r.said));
  perform pg_temp.expect(not card_ended(weak), 'a refused cast spent the pierce');
  -- A rare pierce passes it: the common Move lands, names the pierce, and spends it.
  r := pg_temp.play(cat, 'rwcommon', c, p);
  perform pg_temp.expect(r.said is null, format('a rare pierce did not pass a rare rewind: %s', r.said));
  lands := r.id;
  perform pg_temp.expect((select a2.payload #>> '{pierce,by}' from acts a2 where a2.id = lands) = strong::text and card_ended(strong), 'the Move that passed the freeze does not name and spend the pierce');
end $$;

-- ---- The freeze guards a play whose reach is the post: a card played from a rewound post at a character or a thread lands, and springs nothing ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t'); bob uuid := pg_temp.fix('bob'); b uuid := pg_temp.fix('b');
  p uuid := pg_temp.edited(b, t, 'Bob''s rewound post.'); back uuid; said text;
begin
  perform pg_temp.hand(ann, 'rwtime', 'rwmulti'); perform pg_temp.hand(bob, 'rwrev', 'rwmulti');
  back := (pg_temp.back(bob, 'rwrev', b, p, 'rwmulti')).id;
  perform pg_temp.expect(back is not null, 'the back was not set');
  perform pg_temp.expect((pg_temp.play(ann, 'rwtime', a, p, jsonb_build_object('to', p))).said is null, 'the rewind was refused');
  perform pg_temp.expect((pg_temp.play(ann, 'rwmulti', a, p)).said like '42501 %', 'the card at the post itself was not turned away');
  perform tests.become_service();
  begin
    said := null; perform play_card(bob, 'rwmulti', b, b, '{}', 0, '', 'character', p);
  exception when others then said := sqlstate || ' ' || sqlerrm;
  end;
  perform tests.unbecome();
  perform pg_temp.expect(said is null, format('a card at a character, from a rewound post, was refused: %s', said));
  perform tests.become_service();
  begin
    said := null; perform play_card(bob, 'rwmulti', b, t, '{}', 0, '', 'thread');
  exception when others then said := sqlstate || ' ' || sqlerrm;
  end;
  perform tests.unbecome();
  perform pg_temp.expect(said is null, format('a card at a thread, from a rewound post, was refused: %s', said));
  perform pg_temp.expect(pg_temp.still_down(back) and not exists (select 1 from acts s where s.kind = 'spring' and s.target_act_id = p), 'a back sprang for a card that was not played on the post');
end $$;

-- ---- thread_page gives each post's rewinds latest played first: a rewind that turns away more, played over a lesser one ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); t uuid := tests.thread('Rw order');
  p uuid; lesser uuid; greater uuid; page jsonb; wrong integer := 0; k integer; pos_lesser integer; pos_greater integer;
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, rewind) values ('rwtimel', 'Rw Time Legendary', 'salty', 'legendary', 'cast', '{post}', interval '3 days', 3, 'legendary');
  -- Eight posts, so a page that ordered by uuid would get one of them right only by luck (one in 256 for all eight).
  for k in 1..8 loop
    p := pg_temp.edited(a, t, 'Post ' || k);
    lesser := pg_temp.rewind_play(a, t, p, 'rwtime', rewind_point_at(p, p), now() + interval '2 days', now() - interval '10 minutes');
    greater := pg_temp.rewind_play(a, t, p, 'rwtimel', rewind_point_at(p, p), now() + interval '2 days', now() - interval '5 minutes');
    perform tests.become(ann); page := thread_page(t, 1, null, 25, '{}'); perform tests.unbecome();
    select min(o.n) filter (where o.v ->> 'play' = lesser::text), min(o.n) filter (where o.v ->> 'play' = greater::text) into pos_lesser, pos_greater from jsonb_array_elements(page -> 'rewinds') with ordinality o(v, n);
    perform pg_temp.expect(pos_lesser is not null and pos_greater is not null, format('the page lacks one of the two rewinds: %s', page -> 'rewinds'));
    -- The page grows by one post each round: the new post's pair is read as it stands.
    if pos_greater > pos_lesser then wrong := wrong + 1; end if;
  end loop;
  perform pg_temp.expect(wrong = 0, format('the page put a lesser rewind before the later played one on %s of 8 posts', wrong));
end $$;
