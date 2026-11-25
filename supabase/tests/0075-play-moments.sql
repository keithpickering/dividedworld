-- A play's moment (supabase/migrations/0072_play_moments.sql): when a layer Act lands on a post (a card on the post, a Set, a spring),
-- the version of the post then and what every other layer on it had saved are copied into play_moments and play_moment_layers, by a
-- trigger on the Act's insert, so every path that lands a play takes one. docs/plans/2026-11-03-effect-history-plan.md, Task 1. The
-- cards are the engine's test set, never an instance's: Blot stacks three to a post, as a Whoops! does.

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('snare', 'Snare', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}}', '{post}', null),
    ('hook', 'Hook', 'salty', 'uncommon', 'cast', null, '{post}', null),
    ('glint', 'Glint', 'pepperoni', 'uncommon', 'cast', null, '{character}', interval '7 days'),
    ('marquee', 'Marquee', 'sweet', 'rare', 'cast', null, '{thread}', interval '1 day'),
    ('quake', 'Quake', 'salty', 'legendary', 'cast', null, '{board}', interval '1 day')
  on conflict (key) do nothing;
  if not exists (select 1 from settings where key = 'systemAnnouncements') then
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(tests.thread('Moments Announcements')::text);
  end if;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- The error a statement raises, or null.
create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---- A cast with nothing under it; a second over a saved first; edits before and after ----
do $$
declare
  ann uuid := tests.account('pm-ann'); bob uuid := tests.account('pm-bob');
  a uuid := tests.character(ann, 'Moment Ann'); b uuid := tests.character(bob, 'Moment Bob');
  t uuid := tests.thread('Moments');
  p uuid := tests.post(b, t, 'Splat me.', now() - interval '1 hour');
  q uuid := tests.post(b, t, 'Edit me first.', now() - interval '1 hour');
  first uuid; second uuid; on_q uuid; ed uuid; later_edit uuid;
  saved jsonb := '{"strokes": [{"x": 1, "y": 2}], "washed": 0.4}';
  saved_at timestamptz;
begin
  perform pg_temp.hand(ann, 'blot', 'blot', 'blot');
  first := (play_card(ann, 'blot', a, p, '{"color": "yellow"}', 0, '') ->> 'id')::uuid;
  if (select post_version from play_moments where play = first) is distinct from p then
    raise exception 'a cast on a post never edited names the post itself: %', (select jsonb_agg(to_jsonb(m)) from play_moments m where m.play = first);
  end if;
  if exists (select 1 from play_moment_layers where play = first) then raise exception 'a cast with nothing under it has no layers'; end if;

  -- The author saves 40% of the first; the second copies that save, byte for byte, with its time.
  perform save_effect_state(bob, b, first, saved);
  saved_at := (select e.saved_at from effect_state e where e.play = first);
  second := (play_card(ann, 'blot', a, p, '{"color": "green"}', 0, '') ->> 'id')::uuid;
  if (select jsonb_agg(jsonb_build_object('layer', l.layer, 'state', l.state, 'saved_at', l.saved_at)) from play_moment_layers l where l.play = second)
     is distinct from jsonb_build_array(jsonb_build_object('layer', first, 'state', saved, 'saved_at', saved_at)) then
    raise exception 'the second cast holds the first''s save: %', (select jsonb_agg(to_jsonb(l)) from play_moment_layers l where l.play = second);
  end if;
  if (select l.state::text from play_moment_layers l where l.play = second) is distinct from (select e.state::text from effect_state e where e.play = first) then
    raise exception 'the copy is byte for byte';
  end if;
  -- The first layer's later saves leave the copy as it was.
  perform save_effect_state(bob, b, first, '{"strokes": [], "washed": 1}');
  if (select l.state from play_moment_layers l where l.play = second) is distinct from saved
     or (select l.saved_at from play_moment_layers l where l.play = second) is distinct from saved_at then
    raise exception 'a later save changed the moment: %', (select jsonb_agg(to_jsonb(l)) from play_moment_layers l where l.play = second);
  end if;

  -- A cast after an edit names the edit; an edit after the cast leaves it named.
  ed := tests.act(b, 'edit', t, '{"body": "Edited first."}', q, now() - interval '30 minutes');
  on_q := (play_card(ann, 'blot', a, q, '{}', 0, '') ->> 'id')::uuid;
  if (select post_version from play_moments where play = on_q) is distinct from ed then raise exception 'a cast after an edit names the edit'; end if;
  later_edit := tests.act(b, 'edit', t, '{"body": "Edited after."}', q, now() + interval '1 minute');
  if (select post_version from play_moments where play = on_q) is distinct from ed then raise exception 'an edit after the cast changed the moment'; end if;
  if exists (select 1 from play_moments where play = later_edit) then raise exception 'an edit takes no moment'; end if;
  if exists (select 1 from play_moments where play in (p, q)) then raise exception 'a post takes no moment'; end if;
end $$;

-- ---- A Set, a spring, a caught play and a Move landed from a back each take a moment, and so does a play on a character; a thread's and a board's take none ----
do $$
declare
  ann uuid := tests.account('pm2-ann'); bob uuid := tests.account('pm2-bob');
  a uuid := tests.character(ann, 'Moment2 Ann'); b uuid := tests.character(bob, 'Moment2 Bob');
  t uuid := tests.thread('Moments two');
  p_cast uuid := tests.post(a, t, 'Trapped.');
  p_reply uuid := tests.post(a, t, 'Reply to me.');
  set_cast uuid; set_reply uuid; caught jsonb; spring uuid; reply jsonb; struck uuid;
  on_char uuid; on_thread uuid; on_board uuid; brd uuid;
  before_moments bigint;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'snare', 'hook');
  perform pg_temp.hand(bob, 'blot', 'glint', 'marquee', 'quake');
  -- The Set: a moment like any play's, under which nothing lies yet.
  set_cast := (set_card(ann, 'snare', a, p_cast, '{"card": "blot"}', 0, 'blot') ->> 'id')::uuid;
  if (select post_version from play_moments where play = set_cast) is distinct from p_cast then raise exception 'a Set takes a moment'; end if;
  -- A cast the trap catches: the spring and the caught play each take one, the caught play's holding the set and the spring.
  caught := play_card(bob, 'blot', b, p_cast, '{}', 0, '');
  if not (caught -> 'payload' ? 'caught') then raise exception 'the cast was caught: %', caught; end if;
  spring := (caught -> 'sprung' ->> 'id')::uuid;
  if (select post_version from play_moments where play = spring) is distinct from p_cast then raise exception 'a spring takes a moment'; end if;
  if (select array_agg(layer order by layer) from play_moment_layers where play = spring) is distinct from array[set_cast] then
    raise exception 'the spring''s moment holds the card back under it: %', (select array_agg(layer) from play_moment_layers where play = spring);
  end if;
  if (select post_version from play_moments where play = (caught ->> 'id')::uuid) is distinct from p_cast then raise exception 'a caught play takes a moment'; end if;
  if (select array_agg(layer order by layer) from play_moment_layers where play = (caught ->> 'id')::uuid) is distinct from (select array_agg(x order by x) from unnest(array[set_cast, spring]) x) then
    raise exception 'the caught play''s moment holds the back and the spring: %', (select array_agg(layer) from play_moment_layers where play = (caught ->> 'id')::uuid);
  end if;
  -- A card back's layer carries the Set's state, which is none, and nothing in the table names the card behind it.
  if exists (select 1 from play_moment_layers where layer = set_cast and (state is not null or saved_at is not null)) then raise exception 'a card back''s layer carries no state'; end if;

  -- A Move lands through spring_traps, never play_card: the landed play takes a moment all the same.
  set_reply := (set_card(ann, 'hook', a, p_reply, '{"color": "green"}', 0) ->> 'id')::uuid;
  perform tests.become(bob);
  reply := post(t, b, 'A quote.', p_reply);
  perform tests.unbecome();
  struck := (reply -> 'sprung' -> 'struck' ->> 'id')::uuid;
  if struck is null then raise exception 'the quote sprang nothing: %', reply; end if;
  if (select post_version from play_moments where play = struck) is distinct from (reply ->> 'id')::uuid then
    raise exception 'a landed Move takes a moment, naming the post it landed on';
  end if;
  if (select post_version from play_moments where play = (reply -> 'sprung' ->> 'id')::uuid) is distinct from p_reply then raise exception 'the Move''s spring takes a moment'; end if;
  if exists (select 1 from play_moment_layers l where l::text like '%snare%' or l::text like '%hook%') then raise exception 'the snapshot names a card behind a back'; end if;

  -- A character play takes a moment of its cast-from post (0352), itself no layer of it; a thread and a board play take none.
  insert into boards (slug, name) values ('pm-board', 'Moments Board') returning id into brd;
  before_moments := (select count(*) from play_moments);
  on_char := (play_card(bob, 'glint', b, a, '{}', 0, '', 'character', p_cast) ->> 'id')::uuid;
  on_thread := (play_card(bob, 'marquee', b, t, '{}', 0, '', 'thread') ->> 'id')::uuid;
  on_board := (play_card(bob, 'quake', b, brd, '{}', 0, '', 'board') ->> 'id')::uuid;
  if (select post_version from play_moments where play = on_char) is distinct from p_cast then raise exception 'a play on a character takes a moment of its cast-from post'; end if;
  if exists (select 1 from play_moment_layers where layer in (on_char, on_thread, on_board)) then raise exception 'a play beyond a post is copied as a layer'; end if;
  if (select count(*) from play_moments) is distinct from before_moments + 1 or exists (select 1 from play_moments where play in (on_thread, on_board)) then
    raise exception 'a play on a thread or a board took a moment';
  end if;
  -- And a later cast on the post the character and thread plays sit on (the thread's first post, and the character play's postbit's)
  -- does not count them as layers: its layers are the post's own, the back and the spring and the caught play.
  if (select count(*) from acts where target_act_id = p_cast and kind = 'card' and payload ? 'reach') is distinct from 2::bigint then
    raise exception 'the character and thread plays sit on the post cast on below';
  end if;
  perform pg_temp.hand(bob, 'sweetie');
  caught := play_card(bob, 'sweetie', b, p_cast, '{}', 0, '');
  if (select array_agg(layer order by layer) from play_moment_layers where play = (caught ->> 'id')::uuid)
     is distinct from (select array_agg(x order by x) from unnest(array[set_cast, spring, (select id from acts where kind = 'card' and target_act_id = p_cast and payload ? 'caught')]) x) then
    raise exception 'a play beyond a post is no layer: %', (select array_agg(layer) from play_moment_layers where play = (caught ->> 'id')::uuid);
  end if;
end $$;

-- ---- Both tables are written once and never changed, and a visitor reads neither ----
do $$
declare
  ann uuid := tests.account('pm3-ann'); a uuid := tests.character(ann, 'Moment3 Ann');
  t uuid := tests.thread('Moments three'); p uuid := tests.post(a, t, 'Me.');
  k1 uuid; k2 uuid; why text;
begin
  perform pg_temp.hand(ann, 'blot', 'blot');
  k1 := (play_card(ann, 'blot', a, p, '{}', 0, '') ->> 'id')::uuid;
  k2 := (play_card(ann, 'blot', a, p, '{}', 0, '') ->> 'id')::uuid;
  foreach why in array array[
    pg_temp.refusal(format('update play_moments set taken_at = now() where play = %L', k1)),
    pg_temp.refusal(format('delete from play_moments where play = %L', k1)),
    pg_temp.refusal('truncate play_moments, play_moment_layers'),
    pg_temp.refusal(format('update play_moment_layers set state = %L where play = %L', '{}', k2)),
    pg_temp.refusal(format('delete from play_moment_layers where play = %L', k2)),
    pg_temp.refusal('truncate play_moment_layers')] loop
    if why is null or why not like '%moment%never%' then raise exception 'a moment was changed, or refused for the wrong reason: %', why; end if;
  end loop;
  -- The truncate guard fires on a restore too.
  if (select string_agg(tgname || ':' || tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid in ('play_moments'::regclass, 'play_moment_layers'::regclass) and tgname like '%no_truncate')
     is distinct from 'play_moment_layers_no_truncate:A,play_moments_no_truncate:A' then
    raise exception 'the truncate guards fire always: %', (select string_agg(tgname || ':' || tgenabled::text, ',') from pg_trigger where tgrelid in ('play_moments'::regclass, 'play_moment_layers'::regclass));
  end if;
  -- The trigger that takes a moment is an ordinary one, so an import written as a replica does not fire it.
  if (select tgenabled from pg_trigger where tgname = 'acts_take_play_moment') is distinct from 'O' then raise exception 'the moment''s trigger is an ordinary one'; end if;

  perform tests.become_anon();
  if pg_temp.refusal('select count(*) from play_moments') is null or pg_temp.refusal('select count(*) from play_moment_layers') is null then
    raise exception 'a visitor reads a moment';
  end if;
  perform tests.unbecome();
  perform tests.become(ann);
  if (select count(*) from play_moments where play in (k1, k2)) is distinct from 2::bigint or (select count(*) from play_moment_layers where play = k2) is distinct from 1::bigint then
    raise exception 'a signed-in player reads the moments, as effect_state is read';
  end if;
  if pg_temp.refusal(format('insert into play_moments (play, post_version) values (%L, %L)', p, p)) is null then raise exception 'a player wrote a moment'; end if;
  perform tests.unbecome();
end $$;

-- ---- The read: play_moment answers each case with the version, the layers as saved, the plays above then, and whether it was recorded ----
-- Task 2: the post's version as the projection of the post with that version's payload; the play's own Act first, then each layer row's
-- Act with its state and savedAt; the plays beyond a post live on the post's author, thread or board when the play landed.
do $$
declare
  ann uuid := tests.account('pmr-ann'); bob uuid := tests.account('pmr-bob');
  a uuid := tests.character(ann, 'Read Ann'); b uuid := tests.character(bob, 'Read Bob');
  t uuid := tests.thread('Moments read');
  brd uuid := (select board from threads where id = t);
  p uuid := tests.post(b, t, 'Splat me.', now() - interval '1 hour');
  q uuid := tests.post(b, t, 'Edit me first.', now() - interval '1 hour');
  first uuid; second uuid; on_q uuid; ed uuid; set_p uuid; got jsonb; why text;
  live_char uuid; live_thread uuid; live_board uuid; ended uuid; begun_after uuid; on_other uuid;
  saved jsonb := '{"washed": 0.4}';
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'blot', 'blot', 'blot');
  perform pg_temp.hand(bob, 'snare');
  first := (play_card(ann, 'blot', a, p, '{"color": "yellow"}', 0, '') ->> 'id')::uuid;
  got := play_moment(first);
  if got -> 'version' is distinct from act_projection(p) then raise exception 'a post never edited is its own version: %', got -> 'version'; end if;
  if got -> 'layers' is distinct from jsonb_build_array(jsonb_build_object('act', act_projection(first), 'state', null, 'savedAt', null)) then
    raise exception 'a cast with nothing under it holds itself alone: %', got -> 'layers';
  end if;
  if got -> 'above' is distinct from '[]'::jsonb or got -> 'recorded' is distinct from 'true'::jsonb then raise exception 'nothing above, and recorded: %', got; end if;

  perform save_effect_state(bob, b, first, saved);
  second := (play_card(ann, 'blot', a, p, '{"color": "green"}', 0, '') ->> 'id')::uuid;
  perform save_effect_state(bob, b, first, '{"washed": 1}');
  got := play_moment(second);
  if jsonb_path_query_array(got -> 'layers', '$[*].act.id') is distinct from jsonb_build_array(second, first) then raise exception 'the play first, then its layers: %', got -> 'layers'; end if;
  if got -> 'layers' -> 1 -> 'state' is distinct from saved
     or (got -> 'layers' -> 1 ->> 'savedAt')::timestamptz is distinct from (select saved_at from play_moment_layers where play = second and layer = first) then
    raise exception 'a layer is drawn as it was saved then, not now: %', got -> 'layers' -> 1;
  end if;

  ed := tests.act(b, 'edit', t, '{"body": "Edited first."}', q, now() - interval '30 minutes');
  on_q := (play_card(ann, 'blot', a, q, '{}', 0, '') ->> 'id')::uuid;
  perform tests.act(b, 'edit', t, '{"body": "Edited after."}', q, now() + interval '1 minute');
  got := play_moment(on_q);
  if got -> 'version' ->> 'id' is distinct from q::text or got -> 'version' -> 'current_payload' is distinct from '{"body": "Edited first."}'::jsonb
     or (got -> 'version' ->> 'edited_at')::timestamptz is distinct from now() - interval '30 minutes' then
    raise exception 'the version is the post with the edit''s words: %', got -> 'version';
  end if;
  if got -> 'version' -> 'payload' is distinct from '{"body": "Edit me first."}'::jsonb then raise exception 'the post''s own payload is kept: %', got -> 'version'; end if;
  -- Edited 30 minutes after it was written, past the grace: "Last edited" says so, as it did then.
  if (got -> 'version' ->> 'shown_edited_at')::timestamptz is distinct from now() - interval '30 minutes' then raise exception 'the version shows its edit as acts_public did: %', got -> 'version'; end if;

  -- A Set's moment, and a card back in another's moment, show no card.
  set_p := (set_card(bob, 'snare', b, q, '{"card": "blot"}', 0, 'blot') ->> 'id')::uuid;
  got := play_moment(set_p);
  if jsonb_path_query_array(got -> 'layers', '$[*].act.id') is distinct from jsonb_build_array(set_p, on_q) then raise exception 'a Set''s moment: %', got -> 'layers'; end if;
  if got::text like '%snare%' then raise exception 'a Set''s moment names its card: %', got; end if;

  -- The plays above: live on the post's author, its thread and its board when the play landed; one ended before and one begun after
  -- are not, nor one on another character.
  insert into acts (id, character, kind, thread, target_act_id, payload, created_at) values
    (gen_random_uuid(), a, 'card', t, p, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', b), now() - interval '2 hours') returning id into live_char;
  insert into play_reach (play, reach, character, ends_at) values (live_char, 'character', b, now() + interval '1 day');
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values
    (a, 'card', t, p, jsonb_build_object('card', 'marquee', 'reach', 'thread', 'thread', t), now() - interval '2 hours') returning id into live_thread;
  insert into play_reach (play, reach, thread, ends_at) values (live_thread, 'thread', t, now() + interval '1 minute');
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values
    (a, 'card', t, null, jsonb_build_object('card', 'quake', 'reach', 'board', 'board', brd), now() - interval '2 hours') returning id into live_board;
  insert into play_reach (play, reach, board, ends_at) values (live_board, 'board', brd, now() + interval '1 hour');
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values
    (a, 'card', t, p, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', b), now() - interval '3 days') returning id into ended;
  insert into play_reach (play, reach, character, ends_at) values (ended, 'character', b, now() - interval '1 second');
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values
    (a, 'card', t, p, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', b), now() + interval '1 second') returning id into begun_after;
  insert into play_reach (play, reach, character, ends_at) values (begun_after, 'character', b, now() + interval '7 days');
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values
    (b, 'card', t, p, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', a), now() - interval '2 hours') returning id into on_other;
  insert into play_reach (play, reach, character, ends_at) values (on_other, 'character', a, now() + interval '1 day');
  got := play_moment(first);
  if (select jsonb_agg(e ->> 'play' order by e ->> 'play') from jsonb_array_elements(got -> 'above') e)
     is distinct from (select jsonb_agg(x::text order by x::text) from unnest(array[live_char, live_thread, live_board]) x) then
    raise exception 'the plays above then are the ones live on the author, the thread and the board: %', got -> 'above';
  end if;
  if (select e from jsonb_array_elements(got -> 'above') e where e ->> 'play' = live_char::text)
     is distinct from jsonb_build_object('play', live_char, 'reach', 'character', 'target', b, 'ends_at', now() + interval '1 day', 'act', act_projection(live_char)) then
    raise exception 'each play above as effects_above gives it: %', got -> 'above';
  end if;
  -- A thread's or a board's play is no play on a post (a character's is, since 0352): its read is refused, as a post's and an edit's are, in words.
  foreach why in array array[pg_temp.refusal(format('select play_moment(%L)', p)), pg_temp.refusal(format('select play_moment(%L)', ed)),
                             pg_temp.refusal(format('select play_moment(%L)', live_thread)), pg_temp.refusal(format('select play_moment(%L)', live_board)), pg_temp.refusal(format('select play_moment(%L)', gen_random_uuid()))] loop
    if why is distinct from 'that is no play on a post' then raise exception 'a read of something else is refused in words: %', why; end if;
  end loop;
end $$;

-- ---- A play from before snapshots answers from its time, with itself alone, and says so ----
do $$
declare
  ann uuid := tests.account('pmo-ann'); a uuid := tests.character(ann, 'Old Ann');
  t uuid := tests.thread('Moments old');
  p uuid := tests.post(a, t, 'Old words.', now() - interval '2 hours');
  k1 uuid; k2 uuid; ed uuid; got jsonb;
begin
  perform pg_temp.hand(ann, 'blot', 'blot');
  ed := tests.act(a, 'edit', t, '{"body": "Before the play."}', p, now() - interval '1 hour');
  k1 := (play_card(ann, 'blot', a, p, '{}', 0, '') ->> 'id')::uuid;
  k2 := (play_card(ann, 'blot', a, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.act(a, 'edit', t, '{"body": "After the play."}', p, now() + interval '1 hour');
  -- As if both had landed before 0072: their rows removed, with the guards off in this file's own transaction.
  alter table play_moment_layers disable trigger play_moment_layers_no_update;
  alter table play_moments disable trigger play_moments_no_update;
  delete from play_moment_layers where play in (k1, k2);
  delete from play_moments where play in (k1, k2);
  alter table play_moment_layers enable trigger play_moment_layers_no_update;
  alter table play_moments enable trigger play_moments_no_update;
  got := play_moment(k2);
  if got -> 'recorded' is distinct from 'false'::jsonb then raise exception 'a play from before snapshots is not recorded: %', got; end if;
  if got -> 'version' -> 'current_payload' is distinct from '{"body": "Before the play."}'::jsonb then raise exception 'its version is found by time: %', got -> 'version'; end if;
  if got -> 'layers' is distinct from jsonb_build_array(jsonb_build_object('act', act_projection(k2), 'state', null, 'savedAt', null)) then
    raise exception 'it holds itself alone: %', got -> 'layers';
  end if;
end $$;

-- ---- The read's cost: flat between a thread of 2,000 posts and one of 20,000, and bounded by a post's stack ----
-- Shared buffers (hit or read) one call touches, from EXPLAIN (ANALYZE, BUFFERS), as 0058-progress-scale.sql measures; run once first,
-- unmeasured, so a plan's first catalog reads are not counted.
create function pg_temp.buffers_of(call_sql text) returns bigint language plpgsql as $$
declare plan jsonb;
begin
  -- Past PL/pgSQL's first five calls, which it plans afresh each time and whose catalog reads would be counted.
  for i in 1..8 loop execute call_sql; end loop;
  execute 'explain (analyze, buffers, format json) ' || call_sql into plan;
  return coalesce((plan -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint, 0) + coalesce((plan -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint, 0);
end $$;

-- Posts added so the thread holds `upto` of them, each with its place given, written as a replica writes rows: acts_take_seq would
-- rewrite the thread's row once a post, and in this file's one transaction those 2,000 dead versions of it (which vacuum clears on an
-- instance, where each post is its own transaction) would be read by every probe of the thread, measuring this file and not the read.
create function pg_temp.fill(in_thread uuid, by_character uuid, upto integer) returns void language plpgsql as $$
declare have integer := (select count(*) from acts where thread = in_thread and kind = 'post');
begin
  set local session_replication_role = replica;
  insert into acts (character, kind, thread, payload, seq, created_at)
  select by_character, 'post', in_thread, jsonb_build_object('body', 'p' || i), 1000 + i, now() - interval '1 day' + make_interval(secs => i)
  from generate_series(have + 1, upto) i;
  set local session_replication_role = origin;
  analyze acts;
end $$;

do $$
declare
  ann uuid := tests.account('pms-ann'); bob uuid := tests.account('pms-bob');
  a uuid := tests.character(ann, 'Scale Ann'); b uuid := tests.character(bob, 'Scale Bob');
  t uuid := tests.thread('Moments scale');
  lone uuid := tests.post(b, t, 'One layer.', now() - interval '1 day');
  stacked_post uuid := tests.post(b, t, 'A full stack.', now() - interval '1 day');
  one_play uuid; top uuid; small bigint; big bigint; stacked bigint; aged bigint;
begin
  perform pg_temp.cards();
  insert into card_kinds (key, name, alignment, play, trap) values ('idle', 'Idle', 'pepperoni', 'set', '{"trigger": {"on": "visit"}}') on conflict (key) do nothing;
  perform pg_temp.hand(ann, 'blot', 'blot', 'blot', 'blot', 'sweetie');
  perform pg_temp.hand(bob, 'idle');
  perform pg_temp.fill(t, b, 2000);
  one_play := (play_card(ann, 'blot', a, lone, '{}', 0, '') ->> 'id')::uuid;
  perform play_card(ann, 'blot', a, stacked_post, '{}', 0, '');
  perform play_card(ann, 'blot', a, stacked_post, '{}', 0, '');
  perform play_card(ann, 'sweetie', a, stacked_post, '{}', 0, '');
  perform set_card(bob, 'idle', b, stacked_post, '{}', 0);
  top := (play_card(ann, 'blot', a, stacked_post, '{}', 0, '') ->> 'id')::uuid;
  small := pg_temp.buffers_of(format('select play_moment(%L)', one_play));
  perform pg_temp.fill(t, b, 20000);
  big := pg_temp.buffers_of(format('select play_moment(%L)', one_play));
  stacked := pg_temp.buffers_of(format('select play_moment(%L)', top));
  raise notice 'play_moment touched % buffers in a thread of 2,000 posts, % in one of 20,000, and % on a post with its stack full', small, big, stacked;
  -- A few buffers either way are no growth: an index of acts gains a level as the thread fills (one more page a probe), and the plan
  -- cache's choices move a count by a handful between runs (CI read 38 and 44 at 200 and 2,000 posts). Work that grows with the
  -- thread grows tenfold between these two sizes, so the guard allows 25.
  if big > small + 25 then raise exception 'play_moment touches % buffers in a thread of 2,000 posts and % in one of 20,000; it is a few probes', small, big; end if;
  -- A full stack reads its few more layers, two probes each (the version, and whether an admin hid it: 0340's public_payload), and nothing that grows: at most a stack's
  -- worth (five layers) over one layer. Measured 27 more buffers before the conduct migration and 35 to 45 after it, in the same run order; 55 holds both and still fails a read that grows.
  -- An old play: 2,000 plays on its post's author began after it, each still live then and since. The read is the plays live then.
  set local session_replication_role = replica;
  with later as (
    insert into acts (character, kind, thread, target_act_id, payload, created_at)
    select a, 'card', t, lone, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', b), now() + make_interval(secs => i)
    from generate_series(1, 2000) i returning id, created_at)
  insert into play_reach (play, reach, character, started_at, ends_at) select id, 'character', b, created_at, created_at + interval '7 days' from later;
  set local session_replication_role = origin;
  analyze play_reach;
  analyze acts;
  aged := pg_temp.buffers_of(format('select play_moment(%L)', one_play));
  raise notice 'play_moment touched % buffers for a play with 2,000 later plays on its author', aged;
  if aged > big + 25 then raise exception 'play_moment touches % buffers for a play and % once 2,000 plays began after it; it reads the plays live then', big, aged; end if;
  -- Each layer is a probe of acts_public, which since 0357 pays the two probes of post_veils_post a read of an Act pays (one for the row, one for the Act it targets): about 17 buffers a layer where it was 7.
  if stacked > small + 90 then raise exception 'play_moment touches % buffers on a post with one layer and % with its stack full; it is a probe per layer', small, stacked; end if;
end $$;
