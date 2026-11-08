-- Cards beyond a post (supabase/migrations/0055_card_reach.sql): a card lands on a character, a thread or a board when it lists
-- that reach, each play beyond a post is a play_reach row that ends on its timer, a board carries one board card at a time, and a
-- page reads the live plays above its posts in one bounded read. docs/plans/2026-11-01-card-reach-plan.md, Task 2. The cards are
-- the engine's test set, never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The test cards beyond a post, each priced in the economy.
create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts) values
    ('glint', 'Glint', 'pepperoni', 'uncommon', 'cast', '{character}', interval '7 days'),
    ('marquee', 'Marquee', 'sweet', 'rare', 'cast', '{thread}', interval '1 day'),
    ('banner', 'Banner', 'sweet', 'rare', 'cast', '{thread}', interval '1 day'),
    ('quake', 'Quake', 'salty', 'legendary', 'cast', '{board}', interval '1 day'),
    ('tremor', 'Tremor', 'salty', 'legendary', 'cast', '{board}', interval '3 days'),
    ('selfie', 'Selfie', 'sweet', 'uncommon', 'use', '{character}', interval '2 days')
  on conflict (key) do nothing;
  -- Banner pins its thread to the top of its board's list (Task 5), as an instance's card may.
  update card_kinds set pins = true where key = 'banner';
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- The announcements thread on The System's board, where a board play's Act is written (seed_instance makes it on an instance).
create function pg_temp.announcements() returns uuid language plpgsql as $$
declare t uuid;
begin
  select (value #>> '{}')::uuid into t from settings where key = 'systemAnnouncements';
  if t is null then
    insert into threads (board, title) select id, 'Announcements' from boards where slug = 'the-system' returning id into t;
    insert into settings (key, value) values ('systemAnnouncements', to_jsonb(t::text));
  end if;
  return t;
end $$;

-- ---- Two board cards at once on one board: exactly one lands ----
-- First, so the rows it commits wait on nothing this file has written and not committed.
do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  brd uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-board-a@test.invalid'), (%2$L, 'race-board-b@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Race Quaker A', now(), now()), (%4$L, %2$L, 'Race Quaker B', now(), now());
    insert into class_history (character, class_key, started_at) values (%3$L, 'alpha', now()), (%4$L, 'alpha', now());
    insert into boards (id, slug, name) values (%5$L, 'race-board', 'Race Board');
    insert into card_kinds (key, name, alignment, rarity, reaches, lasts) values ('racequake', 'Race Quake', 'salty', 'legendary', '{board}', interval '1 day');
    insert into card_ledger (account, card, kind, price) values (%1$L, 'racequake', 'bought', 0), (%2$L, 'racequake', 'bought', 0);
    with t as (insert into threads (board, title) select id, 'Race Announcements' from boards where slug = 'the-system' returning id)
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(t.id::text) from t on conflict (key) do nothing;
  $sql$, ann, bob, a, b, brd));
  said := tests.race_service(
    format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ann, 'racequake', a, brd, '{}', '', 'board'),
    format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', bob, 'racequake', b, brd, '{}', '', 'board'));
  if (select count(*) from unnest(said) s where s is null) is distinct from 1 then raise exception 'two board cards at once: exactly one lands, said %', said; end if;
  if (select count(*) from unnest(said) s where s like 'this board already carries a board card until % UTC') is distinct from 1 then
    raise exception 'the other is refused in plain words, said %', said;
  end if;
  -- Committed by the racers: the scratch database is dropped at the end of the run.
end $$;

-- ---- A play beyond a post lands only on a reach its card lists ----
do $$
declare
  ann uuid := tests.account('reach-ann'); bob uuid := tests.account('reach-bob');
  pipe uuid := tests.character(ann, 'Reach Pipe'); hoo uuid := tests.character(bob, 'Reach Hoo');
  t uuid := tests.thread('Reach'); p uuid; q uuid;
  pl jsonb; why text;
  general uuid := (select id from boards where slug = 'general');
begin
  perform pg_temp.cards();
  p := tests.post(hoo, t, 'First.');
  q := tests.post(hoo, t, 'Second.');
  perform pg_temp.hand(ann, 'glint', 'glint', 'sweetie', 'marquee', 'quake');
  -- A card that lists no character is refused on one, before its stack or its wallet.
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'sweetie', pipe, hoo, '{}', '', 'character', q));
  if why is distinct from 'this card lands on a post' then raise exception 'a card with no character reach is refused on one, said %', why; end if;
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'glint', pipe, q, '{}', ''));
  if why is distinct from 'this card lands on a character' then raise exception 'a character card is refused on a post, said %', why; end if;
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ann, 'marquee', pipe, general, '{}', '', 'board'));
  if why is distinct from 'this card lands on a thread' then raise exception 'a thread card is refused on a board, said %', why; end if;
  -- A character play needs the post whose postbit took it, by that character.
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ann, 'glint', pipe, hoo, '{}', '', 'character'));
  if why is distinct from 'a card on a character is played from one of its posts' then raise exception 'a character play names its post, said %', why; end if;
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'glint', pipe, pipe, '{}', '', 'character', q));
  if why is distinct from 'a card on a character is played from one of its posts' then raise exception 'the post is the character''s own, said %', why; end if;

  -- It lands: in the post's thread, on that post, with its reach and its end, and a play_reach row that ends with it.
  pl := play_card(ann, 'glint', pipe, hoo, '{}', 0, 'Sparkle.', 'character', q);
  if pl ->> 'thread' <> t::text or pl ->> 'target_act_id' <> q::text then raise exception 'a character play sits in its post''s thread, on that post: %', pl; end if;
  if pl -> 'payload' ->> 'reach' <> 'character' or pl -> 'payload' ->> 'character' <> hoo::text then raise exception 'its payload names its reach and target: %', pl; end if;
  if not exists (select 1 from play_reach r where r.play = (pl ->> 'id')::uuid and r.reach = 'character' and r.character = hoo
                 and r.thread is null and r.board is null and r.ends_at between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days') then
    raise exception 'a character play''s row names the character and ends at least(lasts, reachLasts)';
  end if;
  if (pl -> 'payload' ->> 'ends')::timestamptz <> (select ends_at from play_reach where play = (pl ->> 'id')::uuid) then raise exception 'its payload carries the same end'; end if;
  -- A second on the same character is refused while the first is up; the post it was played from can still take a post card.
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'glint', pipe, hoo, '{}', '', 'character', p));
  if why is distinct from 'this character already carries that card' then raise exception 'a character''s stack, said %', why; end if;
  perform play_card(ann, 'sweetie', pipe, q, '{}', 0, '');
  -- A character play is no effect on the post it sits on.
  if exists (select 1 from jsonb_array_elements(card_target(q) -> 'effects') e where e ->> 'card' = 'glint') then raise exception 'card_target leaves a character play off its post'; end if;
  if card_target(q) ->> 'reach' is distinct from 'post' then raise exception 'card_target says its reach'; end if;

  -- A thread play sits in that thread, on its first post.
  pl := play_card(ann, 'marquee', pipe, t, '{}', 0, '', 'thread');
  if pl ->> 'thread' <> t::text or pl ->> 'target_act_id' <> p::text then raise exception 'a thread play sits on its first post: %', pl; end if;
  if (select ends_at from play_reach where play = (pl ->> 'id')::uuid) > now() + interval '1 day' then raise exception 'a thread play ends within a day'; end if;

  -- A board play sits in The System's announcements thread, pointing at no post.
  delete from settings where key = 'systemAnnouncements';
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ann, 'quake', pipe, general, '{}', '', 'board'));
  if why is distinct from 'there is no announcements thread to play a board card in yet' then raise exception 'a board play needs the announcements thread, said %', why; end if;
  perform pg_temp.announcements();
  pl := play_card(ann, 'quake', pipe, general, '{}', 0, '', 'board');
  if pl ->> 'thread' <> pg_temp.announcements()::text or pl ->> 'target_act_id' is not null then raise exception 'a board play sits in the announcements thread, on no post: %', pl; end if;
  -- The hand and the wallet are spent as any play's.
  if (select count(*) from card_ledger where account = ann and kind = 'played') is distinct from 4 then raise exception 'each play spends its card'; end if;
end $$;

-- ---- Only a board card may point at nothing, and a play_reach row is never edited ----
do $$
declare
  ann uuid := tests.account('reach-row'); pipe uuid := tests.character(ann, 'Row Pipe');
  t uuid := tests.thread('Row'); why text; row_play uuid;
begin
  perform pg_temp.cards();
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (%L, 'card', %L, '{"card": "sweetie", "reach": "post"}')$s$, pipe, t));
  if why is null then raise exception 'a post card points at its post'; end if;
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (%L, 'spin', %L, '{"card": "quake", "reach": "board"}')$s$, pipe, t));
  if why is null then raise exception 'only a card may be a board play pointing at nothing'; end if;
  perform pg_temp.hand(ann, 'marquee');
  perform tests.post(pipe, t, 'Row.');
  row_play := (play_card(ann, 'marquee', pipe, t, '{}', 0, '', 'thread') ->> 'id')::uuid;
  why := pg_temp.refusal(format('update play_reach set ends_at = now() where play = %L', row_play));
  if why is null then raise exception 'play_reach refuses UPDATE'; end if;
  why := pg_temp.refusal(format('delete from play_reach where play = %L', row_play));
  if why is null then raise exception 'play_reach refuses DELETE'; end if;
  -- A row's target is exactly one column, the one its reach names.
  why := pg_temp.refusal(format($s$insert into play_reach (play, reach, thread, character, ends_at) values (%L, 'thread', %L, %L, now())$s$, row_play, t, pipe));
  if why is null then raise exception 'a row names one target'; end if;
end $$;

-- ---- A play ends at its card's time, cut to its reach's bound; a Use beyond a post goes on the caller's own character ----
do $$
declare
  ann uuid := tests.account('reach-clamp'); bob uuid := tests.account('reach-clamp-b');
  pipe uuid := tests.character(ann, 'Clamp Pipe'); hoo uuid := tests.character(bob, 'Clamp Hoo');
  t uuid := tests.thread('Clamp'); mine uuid; theirs uuid; brd uuid; pl jsonb; why text;
begin
  perform pg_temp.cards();
  perform pg_temp.announcements();
  mine := tests.post(pipe, t, 'Mine.');
  theirs := tests.post(hoo, t, 'Theirs.');
  insert into boards (slug, name) values ('clamp-board', 'Clamp Board') returning id into brd;
  perform pg_temp.hand(ann, 'tremor', 'selfie', 'selfie');
  -- Tremor lasts 3 days; a board effect lasts at most a day (reachLasts.board).
  pl := play_card(ann, 'tremor', pipe, brd, '{}', 0, '', 'board');
  if (select ends_at from play_reach where play = (pl ->> 'id')::uuid) is distinct from now() + interval '1 day' then raise exception 'a play ends at least(lasts, reachLasts)'; end if;
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'selfie', pipe, hoo, '{}', '', 'character', theirs));
  if why is distinct from 'Selfie is used on your own character' then raise exception 'a Use on another''s character, said %', why; end if;
  pl := play_card(ann, 'selfie', pipe, pipe, '{}', 0, '', 'character', mine);
  if (select ends_at from play_reach where play = (pl ->> 'id')::uuid) is distinct from now() + interval '2 days' then raise exception 'a Use beyond a post ends at its own time'; end if;
end $$;

-- ---- A play beyond a post on a staff character lands ----
do $$
declare
  ann uuid := tests.account('reach-staff'); pipe uuid := tests.character(ann, 'Staff Glinter');
  bot uuid; t uuid := tests.thread('Staff reach'); p uuid; pl jsonb;
begin
  perform pg_temp.cards();
  insert into characters (name, staff, staff_kind, debuted_at) values ('Reach Bot', 'reach-bot', 'persona', now()) returning id into bot;
  perform set_config('kayfabb.staff_writer', 'on', true);
  p := tests.post(bot, t, 'Behave.');
  perform set_config('kayfabb.staff_writer', '', true);
  perform pg_temp.hand(ann, 'glint');
  pl := play_card(ann, 'glint', pipe, bot, '{}', 0, '', 'character', p);
  if not exists (select 1 from play_reach where play = (pl ->> 'id')::uuid and character = bot) then raise exception 'a card lands on a staff character'; end if;
end $$;

-- ---- card_target_reach: the target's own live effects, and the live ones above it ----
do $$
declare
  ann uuid := tests.account('reach-target'); bob uuid := tests.account('reach-target-b');
  pipe uuid := tests.character(ann, 'Target Pipe'); hoo uuid := tests.character(bob, 'Target Hoo');
  general uuid; t uuid; p uuid; got jsonb;
begin
  -- A board of its own, since the block above left a board card live on General.
  insert into boards (slug, name) values ('target-board', 'Target Board') returning id into general;
  insert into threads (board, title) values (general, 'Target') returning id into t;
  perform pg_temp.cards();
  perform pg_temp.announcements();
  p := tests.post(hoo, t, 'Here.');
  perform pg_temp.hand(ann, 'glint', 'marquee', 'quake');
  perform play_card(ann, 'glint', pipe, hoo, '{}', 0, '', 'character', p);
  perform play_card(ann, 'marquee', pipe, t, '{}', 0, '', 'thread');
  perform play_card(ann, 'quake', pipe, general, '{}', 0, '', 'board');
  got := card_target_reach('post', p);
  if got ->> 'reach' <> 'post' or got ->> 'act' <> p::text or (got ->> 'length')::integer <> 5 then raise exception 'a post target as card_target reads it: %', got; end if;
  if got #>> '{above,character,0,card}' <> 'glint' or got #>> '{above,thread,0,card}' <> 'marquee' or got #>> '{above,board,0,card}' <> 'quake' then
    raise exception 'a post sees its author''s, its thread''s and its board''s effects: %', got;
  end if;
  if got #>> '{above,board,0,reach}' <> 'board' then raise exception 'each effect above says its reach: %', got; end if;
  got := card_target_reach('character', hoo, p);
  if got ->> 'character' <> hoo::text or got #>> '{effects,0,card}' <> 'glint' or got #>> '{effects,0,reach}' <> 'character' or got #> '{effects,0,ends}' is null then raise exception 'a character''s own effects: %', got; end if;
  if got #>> '{above,thread,0,card}' <> 'marquee' or got #>> '{above,board,0,card}' <> 'quake' or got -> 'above' ? 'character' then raise exception 'above a character are its post''s thread and board: %', got; end if;
  got := card_target_reach('board', general);
  if got #>> '{effects,0,card}' <> 'quake' or jsonb_array_length(got -> 'effects') <> 1 then raise exception 'a board''s own effect: %', got; end if;
  if card_target_reach('thread', gen_random_uuid()) is not null then raise exception 'no such target reads as none'; end if;
  if card_target_reach('room', t) is not null then raise exception 'no such reach reads as none'; end if;
end $$;

-- ---- effects_above: the live plays on a page's characters, its thread and its board, in one bounded read ----
do $$
declare
  ann uuid := tests.account('above-ann'); bob uuid := tests.account('above-bob'); cy uuid := tests.account('above-cy');
  pipe uuid := tests.character(ann, 'Above Pipe'); hoo uuid := tests.character(bob, 'Above Hoo'); zed uuid := tests.character(cy, 'Above Zed');
  hoo2 uuid := tests.character(bob, 'Above Hoo Two');
  t uuid := tests.thread('Above'); p uuid; ended uuid; got jsonb;
  general uuid := (select id from boards where slug = 'general');
begin
  perform pg_temp.cards();
  p := tests.post(hoo, t, 'Here.');
  perform tests.post(zed, t, 'There.');
  perform pg_temp.hand(ann, 'glint', 'glint', 'marquee');
  perform play_card(ann, 'glint', pipe, hoo, '{}', 0, 'Shine.', 'character', p);
  perform play_card(ann, 'marquee', pipe, t, '{}', 0, '', 'thread');
  -- An ended play, written as an old one would be: it is not live, so it is not read.
  ended := tests.act(pipe, 'card', t, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', zed, 'ends', now() - interval '1 hour'), p, now() - interval '8 days');
  insert into play_reach (play, reach, character, ends_at) values (ended, 'character', zed, now() - interval '1 hour');
  -- Read as the Acts are: by a signed-in player, never by a visitor with no session.
  perform tests.become_anon();
  if pg_temp.refusal(format('select * from effects_above(%L::uuid[], %L, %L)', array[hoo], t, general)) is null then raise exception 'a visitor reads no Acts through effects_above'; end if;
  if pg_temp.refusal('select * from play_reach') is null then raise exception 'a visitor reads no play_reach'; end if;
  perform tests.unbecome();
  perform tests.become(cy);
  got := (select jsonb_agg(to_jsonb(e) order by e.reach) from effects_above(array[hoo, zed, hoo2], t, general) e);
  perform tests.unbecome();
  -- General still carries the board card an earlier block played.
  if jsonb_array_length(got) <> 3 then raise exception 'only the live plays: %', got; end if;
  if got #>> '{0,reach}' <> 'board' or got #>> '{0,target}' <> general::text then raise exception 'the board''s play: %', got; end if;
  if got #>> '{1,reach}' <> 'character' or got #>> '{1,target}' <> hoo::text or got #>> '{1,act,payload,message}' <> 'Shine.' or got #> '{1,ends_at}' is null then raise exception 'a character play with its Act: %', got; end if;
  if got #>> '{2,reach}' <> 'thread' or got #>> '{2,target}' <> t::text then raise exception 'the thread''s play: %', got; end if;
  -- Hoo's other mask is untouched: a character effect falls on the mask alone.
  if exists (select 1 from jsonb_array_elements(got) e where e ->> 'target' = hoo2::text) then raise exception 'a character effect reaches no other mask'; end if;
  -- Bounded by its arguments: at most 200 characters in one read.
  if pg_temp.refusal(format('select * from effects_above(%L::uuid[], null, null)', (select array_agg(gen_random_uuid()) from generate_series(1, 201)))) is distinct from 'effects_above reads at most 200 characters at once' then
    raise exception 'effects_above is bounded';
  end if;
  -- One index probe per character asked: no scan of play_reach or acts, whatever they hold.
  if (select pg_get_functiondef('effects_above(uuid[], uuid, uuid)'::regprocedure)) ~* 'owner' then raise exception 'effects_above never reads who owns a character'; end if;
  if (select pg_get_functiondef('card_target_reach(text, uuid, uuid)'::regprocedure)) ~* 'owner' then raise exception 'card_target_reach never reads who owns a character'; end if;
end $$;

-- The probe itself, outside the function: each character asked is one probe of play_reach_character.
do $$
declare plan text := ''; ln record; chars uuid[] := (select array_agg(gen_random_uuid()) from generate_series(1, 3));
begin
  -- The function reads each character's live plays by exactly this predicate.
  if pg_get_functiondef('effects_above(uuid[], uuid, uuid)'::regprocedure) !~ 'x\.character = any \(coalesce\(effects_above\.characters' then raise exception 'effects_above probes by character'; end if;
  set local enable_seqscan = off;
  for ln in execute format($q$explain select r.play from play_reach r where r.character = any (%L::uuid[]) and r.ends_at > now()$q$, chars) loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan !~ '(Index (Only )?Scan using|Bitmap Index Scan on) play_reach_character' then raise exception 'a character''s live plays are an index probe: %', plan; end if;
  if plan ~ 'Seq Scan' then raise exception 'never a scan of play_reach: %', plan; end if;
  set local enable_seqscan = on;
end $$;

-- ---- The seed: a card that reaches further than its rarity allows, or beyond a post with no time up, is refused naming it ----
do $$
declare why text;
begin
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "common", "reaches": ["character"], "lasts": {"unit": "day", "count": 1}}]}')$s$);
  if why is distinct from 'card "seedling" reaches a character, which takes a card of uncommon or rarer; it is common' then raise exception 'the seed holds reachRarity, said %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "uncommon", "reaches": ["character"]}]}')$s$);
  if why is distinct from 'card "seedling" reaches beyond a post with no time up (lasts); every effect beyond a post ends at its time' then raise exception 'a card beyond a post has a time up, said %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "legendary", "reaches": ["thread"], "lasts": {"unit": "week", "count": 1}}]}')$s$);
  if why is distinct from 'card "seedling" lasts 1 week, longer than a thread effect may (reachLasts.thread, 1 day)' then raise exception 'a time up is at most its reach''s, said %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "legendary", "play": "set", "reaches": ["post", "board"], "lasts": {"unit": "day", "count": 1}}]}')$s$);
  if why is distinct from 'card "seedling" is set face down, and a Set lands only on a post' then raise exception 'a Set lands on a post alone, said %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "common", "reaches": ["room"]}]}')$s$);
  if why is distinct from 'card "seedling" reaches ["room"]; a card reaches a list of post, character, thread or board, each once' then raise exception 'a reach is one of four, said %', why; end if;
  -- Quoted as JSON.stringify quotes it, so the seed and instanceProblems say the same words.
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "common", "reaches": ["post", "post"]}]}')$s$);
  if why is distinct from 'card "seedling" reaches ["post","post"]; a card reaches a list of post, character, thread or board, each once' then raise exception 'a reach is listed once, said %', why; end if;
  -- A time up that is no span is named, never a cast error.
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "legendary", "reaches": ["thread"], "lasts": {"unit": "day", "count": 1.5}}]}')$s$);
  if why !~ '^card "seedling" lasts \{"unit": "day", "count": 1.5\}; it must be a span' then raise exception 'a malformed time up is named, said %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "uncommon", "reaches": ["character"], "lasts": {"unit": "day", "count": 1}, "pins": true}]}')$s$);
  if why is distinct from 'card "seedling" pins true; only a card that reaches a thread pins, and pins is true or left out' then raise exception 'only a thread card pins, said %', why; end if;
  -- One that holds is written with its reaches.
  perform seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "uncommon", "reaches": ["character"], "lasts": {"unit": "day", "count": 7}}]}');
  if (select reaches from card_kinds where key = 'seedling') is distinct from '{character}' then raise exception 'the seed writes a card''s reaches'; end if;
  -- reachRarity and reachLasts are held to their shapes.
  if pg_temp.refusal($s$update settings set value = '{"character": "uncommon"}' where key = 'reachRarity'$s$) is null then raise exception 'reachRarity names all three reaches'; end if;
  if pg_temp.refusal($s$update settings set value = '{"character": {"unit": "day", "count": 7}, "thread": {"unit": "hour", "count": 1}, "board": {"unit": "day", "count": 1}}' where key = 'reachLasts'$s$) is null then raise exception 'reachLasts gives each a span'; end if;
end $$;

-- ---- A play beyond a post is not the post's: not in its author's log, and not a state its author saves ----
do $$
declare
  ann uuid := tests.account('reach-log'); bob uuid := tests.account('reach-log-b');
  pipe uuid := tests.character(ann, 'Log Pipe'); hoo uuid := tests.character(bob, 'Log Hoo');
  t uuid := tests.thread('Log'); p uuid; pl jsonb;
begin
  perform pg_temp.cards();
  p := tests.post(hoo, t, 'Opener.');
  perform pg_temp.hand(ann, 'marquee', 'glint', 'sweetie');
  perform play_card(ann, 'marquee', pipe, t, '{}', 0, '', 'thread');
  pl := play_card(ann, 'glint', pipe, hoo, '{}', 0, '', 'character', p);
  perform play_card(ann, 'sweetie', pipe, p, '{}', 0, '');
  perform tests.become(bob);
  -- 0056 reads a character's and a thread's play as its own row, with its reach (0061 holds those): as plays on a post, the log still has the one.
  if (select count(*) from my_posts_played_on where post = p and reach = 'post') is distinct from 1::bigint then raise exception 'the opener''s author''s log lists the post''s own play alone'; end if;
  perform tests.unbecome();
  if pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', bob, hoo, pl ->> 'id', '{}')) is distinct from 'there is no such card on a post' then
    raise exception 'a play beyond a post keeps no state its post''s author saves';
  end if;
end $$;

-- ---- The settlement reads a play beyond a post with its reach and no target, and as no card on the post it sits on ----
do $$
declare
  ann uuid := tests.account('reach-settle'); bob uuid := tests.account('reach-settle-b'); cy uuid := tests.account('reach-settle-c');
  pipe uuid := tests.character(ann, 'Settle Pipe'); hoo uuid := tests.character(bob, 'Settle Hoo'); zed uuid := tests.character(cy, 'Settle Zed');
  t uuid := tests.thread('Settle reach'); p uuid; pl jsonb; post_play jsonb; got jsonb; mine jsonb; old uuid; bot uuid; bot_post uuid;
begin
  perform pg_temp.cards();
  -- Written before the window, so only something in the window could bring it into the input.
  p := tests.post(hoo, t, 'Settle opener.', now() - interval '2 days');
  perform pg_temp.hand(ann, 'glint', 'sweetie');
  pl := play_card(ann, 'glint', pipe, hoo, '{}', 0, '', 'character', p);
  perform tests.become(cy);
  perform react((pl ->> 'id')::uuid, zed, 'up');
  perform tests.unbecome();
  got := settlement_input(now() - interval '1 day', now() + interval '1 minute');
  select e into mine from jsonb_array_elements(got -> 'acts') e where e ->> 'id' = pl ->> 'id';
  if mine ->> 'reach' is distinct from 'character' or mine ? 'target' then raise exception 'a character play is read with its reach and no target: %', mine; end if;
  -- The post the character play sits on is not its target, so nothing brings it in.
  if exists (select 1 from jsonb_array_elements(got -> 'acts') e where e ->> 'id' = p::text) then raise exception 'the post a character play sits on is not its target: %', got -> 'acts'; end if;
  -- The estimate reads the window after the last settlement; an earlier file's committed settlement can put that window past now, and
  -- then there is nothing of this play's to estimate. Where the window holds it, it is read the same.
  got := estimate_input(ann, now() + interval '1 minute');
  if got is not null and (got ->> 'windowStart')::timestamptz <= now() then
    mine := (select e from jsonb_array_elements(got -> 'acts') e where e ->> 'id' = pl ->> 'id');
    if mine ->> 'reach' is distinct from 'character' or mine ? 'target' then raise exception 'the estimate reads it the same: %', mine; end if;
    if exists (select 1 from jsonb_array_elements(got -> 'acts') e where e ->> 'id' = p::text) then raise exception 'the estimate reads no post a character play sits on: %', got -> 'acts'; end if;
  end if;
  -- A play beyond a post from before the window, on the same post: a reaction to the post in the window does not bring it in as an
  -- earlier card there, since it is no card on that post.
  old := tests.act(pipe, 'card', t, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', hoo, 'ends', now() + interval '1 day'), p, now() - interval '30 hours');
  insert into play_reach (play, reach, character, ends_at) values (old, 'character', hoo, now() + interval '1 day');
  perform tests.become(cy);
  perform react(p, zed, 'up');
  perform tests.unbecome();
  got := settlement_input(now() - interval '1 day', now() + interval '1 minute');
  if exists (select 1 from jsonb_array_elements(got -> 'acts') e where e ->> 'id' = old::text) then raise exception 'an earlier play beyond a post is no earlier card on the post a reaction touches'; end if;
  -- A character play on a staff mask, from its post, makes that post no unscored target: the play has no target post.
  insert into characters (name, staff, staff_kind, debuted_at) values ('Settle Bot', 'settle-bot', 'persona', now()) returning id into bot;
  perform set_config('kayfabb.staff_writer', 'on', true);
  bot_post := tests.post(bot, t, 'Behave.', now() - interval '2 days');
  perform set_config('kayfabb.staff_writer', '', true);
  perform pg_temp.hand(ann, 'glint');
  perform play_card(ann, 'glint', pipe, bot, '{}', 0, '', 'character', bot_post);
  got := settlement_input(now() - interval '1 day', now() + interval '1 minute');
  if exists (select 1 from jsonb_array_elements(got -> 'unscoredTargets') e where e ->> 'id' = bot_post::text) then raise exception 'a staff post a character play sits on is no unscored target'; end if;
  if exists (select 1 from jsonb_array_elements(estimate_input(ann, now() + interval '1 minute') -> 'unscoredTargets') e where e ->> 'id' = bot_post::text) then raise exception 'nor in the estimate'; end if;
  -- A post play keeps its target and names no reach.
  post_play := play_card(ann, 'sweetie', pipe, p, '{}', 0, '');
  got := settlement_input(now() - interval '1 day', now() + interval '1 minute');
  select e into mine from jsonb_array_elements(got -> 'acts') e where e ->> 'id' = post_play ->> 'id';
  if mine ->> 'target' is distinct from p::text or mine ? 'reach' then raise exception 'a post play keeps its target and names no reach: %', mine; end if;
end $$;

-- ---- pinned_threads: a board's threads with a live thread play whose card pins, in one probe of the board's live pins ----
do $$
declare
  ann uuid := tests.account('pin-ann'); pipe uuid := tests.character(ann, 'Pin Pipe');
  brd uuid; t1 uuid; t2 uuid; t3 uuid; got jsonb; plan text := ''; ln record; old uuid;
begin
  perform pg_temp.cards();
  insert into boards (slug, name) values ('pin-board', 'Pin Board') returning id into brd;
  insert into threads (board, title) values (brd, 'Pinned') returning id into t1;
  insert into threads (board, title) values (brd, 'Marqueed') returning id into t2;
  insert into threads (board, title) values (brd, 'Was pinned') returning id into t3;
  perform tests.post(pipe, t1, 'One.'); perform tests.post(pipe, t2, 'Two.'); perform tests.post(pipe, t3, 'Three.');
  perform pg_temp.hand(ann, 'banner', 'marquee');
  perform play_card(ann, 'banner', pipe, t1, '{}', 0, 'Look here.', 'thread');
  -- A thread card that does not pin is no pin.
  perform play_card(ann, 'marquee', pipe, t2, '{}', 0, '', 'thread');
  -- An ended pin, written as an old one would be.
  old := tests.act(pipe, 'card', t3, jsonb_build_object('card', 'banner', 'reach', 'thread', 'thread', t3, 'ends', now() - interval '1 hour'),
                   (select id from acts where thread = t3 and seq = 1), now() - interval '2 days');
  insert into play_reach (play, reach, thread, pins_board, ends_at) values (old, 'thread', t3, brd, now() - interval '1 hour');
  perform tests.become(ann);
  got := (select jsonb_agg(to_jsonb(x)) from pinned_threads(brd) x);
  perform tests.unbecome();
  if jsonb_array_length(got) is distinct from 1 or got #>> '{0,thread,id}' <> t1::text or got #>> '{0,thread,title}' <> 'Pinned' then raise exception 'only the live pin: %', got; end if;
  if got #>> '{0,act,payload,message}' <> 'Look here.' or got #> '{0,ends_at}' is null then raise exception 'a pin with its play and its end: %', got; end if;
  perform tests.become_anon();
  if pg_temp.refusal(format('select * from pinned_threads(%L)', brd)) is null then raise exception 'a visitor reads no plays through pinned_threads'; end if;
  perform tests.unbecome();
  -- Only a pinning card's thread play names a board to pin on, and only that board's.
  if (select pins_board from play_reach r join acts k on k.id = r.play where k.payload ->> 'card' = 'marquee' and r.thread = t2) is not null then raise exception 'a card that does not pin pins nothing'; end if;
  if pg_get_functiondef('pinned_threads(uuid)'::regprocedure) !~ 'r\.pins_board = pinned_threads\.board and r\.ends_at > now\(\)' then raise exception 'pinned_threads probes the board''s live pins'; end if;
  set local enable_seqscan = off;
  for ln in execute format($q$explain select r.play from play_reach r where r.pins_board = %L and r.ends_at > now()$q$, brd) loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  set local enable_seqscan = on;
  if plan !~ '(Index (Only )?Scan using|Bitmap Index Scan on) play_reach_pins' then raise exception 'a board''s live pins are one index probe: %', plan; end if;
end $$;

-- ---- An instance from before 0055: every card is a post card, and every play reads as one ----
do $$
begin
  if (select reaches from card_kinds where key = 'sweetie') is distinct from '{post}' then raise exception 'a card seeded before 0055 reaches a post'; end if;
end $$;
