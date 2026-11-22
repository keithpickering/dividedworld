-- The rewind, the first half (supabase/migrations/0412_rewind.sql; docs/plans/2026-11-21-time-machine-plan.md, Task 2; design docs/plans/2026-11-21-time-machine-design.md, sections 3, 4.1, 4.2, 6 and 7).
-- A rewind card shows a post as of an earlier point of its history and freezes the post while it is up. This half holds:
--   * the column card_kinds.rewind and its check; card_kinds_problem takes a good rewind and names each poison in the engine's words (engine/rules/instance.ts, rewindProblems);
--   * rewind_point_at: the post (its time plus the edit grace), an edit inside the grace (null), an edit past it, another post's edit (null);
--   * rewind_point_problem: each of the engine's three sentences in order, and null for an offered point, with a play still showing or ended, a back, and a point still to come;
--   * live_rewind and rewind_refusal: the live plays, latest first, the exact words (the engine's rewindWords), the rarity cut-off, `passing`, the end by time and by an admin;
--   * card_target carries `rewind: { upTo }` on a live rewind's effect;
--   * rewind_view: the version at the point, and the hidden placeholder where an admin hid that version; null for a play that is no rewind.
-- place_cast, place_set, thread_page and spring_traps, and the tests of them, are the second half of this file.
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
  tally uuid;
begin
  insert into rw_fix values ('p', p), ('q', q), ('e_in', e_in), ('e_edge', e_edge), ('e_out', e_out), ('q_out', q_out);
  perform pg_temp.expect(rewind_point_at(p, p) = base + interval '2 minutes', format('the post''s point is its time plus the grace: %s', rewind_point_at(p, p)));
  perform pg_temp.expect(rewind_point_at(p, e_in) is null, 'an edit inside the grace named a point');
  perform pg_temp.expect(rewind_point_at(p, e_edge) is null, 'an edit exactly at the end of the grace named a point (the grace is inclusive, as shown_edited_at reads it)');
  perform pg_temp.expect(rewind_point_at(p, e_out) = base + interval '10 minutes', format('an edit past the grace gives its own time: %s', rewind_point_at(p, e_out)));
  perform pg_temp.expect(rewind_point_at(p, q_out) is null, 'another post''s edit named a point');
  perform pg_temp.expect(rewind_point_at(p, q) is null, 'another post named a point');
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
  r1 uuid; r2 uuid; ends1 timestamptz := date_trunc('minute', now() + interval '2 days'); words text; n integer; rec record;
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
  perform pg_temp.expect(pg_temp.rewind_play(a, t, other, 'rwtime', base, now() - interval '1 minute', now() - interval '2 days') is not null and (select count(*) from live_rewind(other)) = 0 and rewind_refusal(other, common_k) is null,
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
  eff := (select e from jsonb_array_elements(target -> 'effects') e where e ->> 'act' = m::text);
  perform pg_temp.expect(eff is not null and not eff ? 'rewind', format('an effect that is no rewind carries a rewind key: %s', eff));
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
  v jsonb;
begin
  v := rewind_view(r_first);
  perform pg_temp.expect(v ->> 'play' = r_first::text and v ->> 'post' = p::text and (v ->> 'at')::timestamptz = at_first, format('the view names the play, the post and the point: %s', v));
  perform pg_temp.expect(v -> 'version' -> 'current_payload' ->> 'body' = 'As first posted.', format('the first point shows the post as first posted: %s', v -> 'version' -> 'current_payload'));
  perform pg_temp.expect(v -> 'version' ->> 'id' = p::text, format('the version is the post''s projection: %s', v -> 'version' ->> 'id'));
  v := rewind_view(r_e1);
  perform pg_temp.expect(v -> 'version' -> 'current_payload' ->> 'body' = 'First edit.', format('the edit''s point shows that edit and not the later one: %s', v -> 'version' -> 'current_payload'));
  perform pg_temp.expect((v -> 'version' ->> 'edited_at')::timestamptz = base + interval '10 minutes' and (v -> 'version' ->> 'shown_edited_at')::timestamptz = base + interval '10 minutes', format('last edited reads as of the version: %s', v -> 'version'));
  perform pg_temp.expect(card_target(p) -> 'body' = to_jsonb('Second edit.'::text), 'the post''s current words are not the latest edit (an edit during a rewind lands)');

  -- Not a rewind: a play of another card, a post, an Act that is not there, null.
  perform pg_temp.expect(rewind_view(m) is null, 'the view of a play that is no rewind was not null');
  perform pg_temp.expect(rewind_view(p) is null, 'the view of a post was not null');
  perform pg_temp.expect(rewind_view(gen_random_uuid()) is null and rewind_view(null) is null, 'the view of nothing was not null');
  -- A rewind that was caught never took.
  perform pg_temp.expect(rewind_view(tests.act(a, 'card', t, jsonb_build_object('card', 'rwtime', 'reach', 'post', 'rewind_at', base, 'caught', 'x'), p, now())) is null, 'a caught rewind had a view');

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
