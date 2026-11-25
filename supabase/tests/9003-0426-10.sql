-- What the staff read sees of the board (supabase/migrations/0426_reads_see_the_board.sql; docs/plans/2026-11-25-reads-see-the-board-plan.md, Task 2; design sections 1, 2, 3, 3a, 3b and 5).
-- 1. post_extras: reactions (counts by kind, no character), polls (open, closed three ways, removed, secret with no ballot character anywhere in the answer), plays (a live play with its saved state, a sprung back,
--    no unsprung back), a live rewind's body and `rewoundTo`.
-- 2. pool_read: the same extras on each post, and `origin`: null for a thread that was not spun, else the right `post` (or null) for a thread spun from each kind of origin; a play spin's `plays` are its moment's.
-- 3. the bound: under empty statistics on `acts`, the same with generic plans, and true statistics, pool_read and post_extras read a number of rows of `acts` below a fixed bound that does not grow with the thread
--    or with the ballots on its polls (as 0425-pool-read-bounded.sql counts them).
-- 4. the bound can fail: the same read of plays by a join over `acts` reads more than the bound under the empty statistics.
-- 5. the security: owners, grants, search paths.
-- The rows are this file's own (ex...).

-- What the files before this one leave committed (0434_reads_bounded_on_any_plan.sql), planted first so that every run measures in it: a few live author veils and card_end Acts elsewhere in the instance, analyzed before this
-- file's own rows are written, as the earlier files' rows are by the suite's vacuum. With them, each probe of an Act through acts_public was a hashed read of every veil and card_end (CI on main at 7d8a255: `pool_read reads 4814 rows of acts: more than 4000`).
select tests.plant_live_veils(8, 10) is not null;

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;

create function pg_temp.acts_read() returns bigint language sql as $$
  select coalesce(sum(seq_tup_read + idx_tup_fetch), 0)::bigint from pg_stat_xact_all_tables where relname = 'acts'
$$;

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if ok is not true then raise exception '%', what; end if; end $$;

create function pg_temp.mkpoll(in_thread uuid, on_post uuid, by_character uuid, secret boolean default false, pick integer default 1, closes timestamptz default now() + interval '1 day', at timestamptz default now(),
                               options jsonb default '["Pipe Frame", "Badwagon", "Mach Bike"]') returns uuid language sql as $$
  select tests.act(by_character, 'poll', in_thread, jsonb_build_object('question', 'Best kart?', 'options', options, 'pick', pick, 'secret', secret, 'closes_at', closes), on_post, at)
$$;
create function pg_temp.vote(on_poll uuid, by_character uuid, picks jsonb, at timestamptz default now()) returns uuid language sql as $$
  select tests.act(by_character, 'ballot', (select p.thread from acts p where p.id = on_poll), jsonb_build_object('picks', picks), on_poll, at)
$$;
create function pg_temp.ex(post uuid) returns jsonb language sql as $$ select post_extras(array[post]) -> 0 $$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, stack) values
    ('exsplat', 'Ex Splat', 'salty', 'common', 'cast', null, '{post}', null, 8),
    ('exsweet', 'Ex Sweet', 'sweet', 'common', 'cast', null, '{post}', null, 8),
    ('exblot', 'Ex Blot', 'salty', 'common', 'cast', null, '{post}', null, 8),
    ('exwink', 'Ex Wink', 'sweet', 'common', 'cast', null, '{post}', null, 8)
  on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('exback', 'Ex Back', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null)
  on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, rewind) values ('exrewind', 'Ex Rewind', 'salty', 'rare', 'cast', '{post}', interval '1 day', 1, 'rare')
  on conflict (key) do nothing;
end $$;
select pg_temp.cards();

-- A back and its face_down row; `sprung` writes the spring a cast would.
create function pg_temp.back(ch uuid, who uuid, th uuid, post uuid, rnd integer, at timestamptz, sprung boolean default false, lockout boolean default true) returns uuid language plpgsql as $$
declare s uuid;
begin
  s := tests.act(ch, 'set', th, '{}', post, at);
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s, who, 'exback', post, th, rnd, now() + interval '1 day');
  if sprung then
    perform tests.act(ch, 'spring', th, case when lockout then jsonb_build_object('set', s::text, 'card', 'exback', 'trigger', 'cast', 'did', 'lockedOut', 'locks', ch::text, 'until', (now() + interval '1 day')::text)
                                else jsonb_build_object('set', s::text, 'card', 'exback', 'trigger', 'cast', 'did', 'returned') end, post, at + interval '1 minute');
  end if;
  return s;
end $$;

create function pg_temp.spun(through uuid, origin uuid, at_post uuid default null) returns uuid language plpgsql as $$
declare made jsonb;
begin
  made := spin_written(origin, through, 'Spun ' || left(gen_random_uuid()::text, 6), 'Discuss.', false, array[]::uuid[], at_post);
  return (made -> 'thread' ->> 'id')::uuid;
end $$;

-- A spin and the read of its origin are two statements: pool_read is stable, so one that shares a statement with the spin cannot see the thread.
create function pg_temp.spun_origin(through uuid, origin uuid) returns jsonb language plpgsql as $$
declare th uuid := pg_temp.spun(through, origin); o jsonb;
begin o := pool_read(th, 'ex-boss', null, 5) -> 'origin'; return o; end $$;
create function pg_temp.origin_of(th uuid) returns jsonb language sql as $$ select pool_read(th, 'ex-boss', null, 5) -> 'origin' $$;

insert into characters (name, staff, staff_kind, debuted_at) values ('Ex Boss', 'ex-boss', 'persona', now());
create temp table fx (k text primary key, v uuid);
grant all on fx to public;
create function pg_temp.f(k text) returns uuid language sql as $$ select v from fx where fx.k = f.k $$;

-- ---- 1. post_extras ----
do $$
declare
  aa uuid := tests.account('ex-ann'); ab uuid := tests.account('ex-bob'); ac uuid := tests.account('ex-cat');
  a uuid := tests.character(aa, 'Ex Ann'); b uuid := tests.character(ab, 'Ex Bob'); c uuid := tests.character(ac, 'Ex Cat');
  t uuid := tests.thread('Ex Main');
  base timestamptz := now() - interval '3 days';
  p_react uuid; p_open uuid; p_time uuid; p_auth uuid; p_adm uuid; p_gone uuid; p_sec uuid; p_plain uuid; p_play uuid; p_rw uuid; p_ed uuid;
  pl uuid; r jsonb; e jsonb; w uuid; sp uuid; us uuid; plays jsonb; rpoint timestamptz; adm_close uuid; auth_close uuid; secret_ballot uuid;
  txt text; ended_back uuid; ended_time uuid; ended_admin uuid; adm1 uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into fx values ('a', a), ('b', b), ('c', c), ('t', t), ('aa', aa), ('ab', ab);
  p_plain := tests.post(a, t, 'Plain.', base);
  -- reactions: two kinds, one with a zero count, and who reacted
  p_react := tests.post(a, t, 'Reacted.', base + interval '1 minute');
  insert into reaction_tallies (act, kind, count) values (p_react, 'up', 3), (p_react, 'boo', 1), (p_react, 'calm', 0);
  insert into reactions (act, reactor_character, reactor_account, kind, slot) values (p_react, b, ab, 'up', 1), (p_react, c, ac, 'up', 1), (p_react, c, ac, 'boo', 2);
  e := pg_temp.ex(p_react);
  perform pg_temp.expect(e -> 'reactions' = '{"up": 3, "boo": 1}'::jsonb, 'reactions: ' || (e -> 'reactions')::text);
  perform pg_temp.expect(pg_temp.ex(p_plain) -> 'reactions' = '{}'::jsonb, 'a post with no reactions has {}');
  perform pg_temp.expect(e::text !~ b::text and e::text !~ c::text and e::text !~ ab::text and e::text !~ ac::text, 'reactions name a character or account: ' || e::text);
  perform pg_temp.expect((e -> 'poll') = 'null'::jsonb and e -> 'plays' = '[]'::jsonb and e -> 'rewoundTo' = 'null'::jsonb and not e ? 'body' and e ->> 'post' = p_react::text, 'the empty extras: ' || e::text);

  -- polls
  p_open := tests.post(a, t, 'Open poll.', base + interval '2 minutes');
  pl := pg_temp.mkpoll(t, p_open, a, closes => now() + interval '1 day', at => now() - interval '1 day');
  perform pg_temp.vote(pl, a, '[0]', now() - interval '5 hours'); perform pg_temp.vote(pl, b, '[0]', now() - interval '4 hours');
  perform pg_temp.vote(pl, c, '[1]', now() - interval '3 hours'); perform pg_temp.vote(pl, a, '[1]', now() - interval '2 hours');
  e := pg_temp.ex(p_open) -> 'poll';
  perform pg_temp.expect(e ->> 'question' = 'Best kart?' and e -> 'options' = '["Pipe Frame", "Badwagon", "Mach Bike"]'::jsonb and e -> 'pick' = '1'::jsonb and e -> 'secret' = 'false'::jsonb
    and e -> 'closed' = 'false'::jsonb and e -> 'closedBy' = 'null'::jsonb and e -> 'closedAt' = 'null'::jsonb and e -> 'counts' = '[1, 2, 0]'::jsonb and e -> 'voters' = '3'::jsonb
    and (e ->> 'endsAt')::timestamptz = (select (payload ->> 'closes_at')::timestamptz from acts where id = pl), 'the open poll: ' || e::text);
  perform pg_temp.expect(not e ? 'names', 'a poll carries no names key');
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys(e) k) = array['closed', 'closedAt', 'closedBy', 'counts', 'endsAt', 'options', 'pick', 'question', 'secret', 'voters'], 'the poll keys: ' || e::text);
  -- closed by time
  p_time := tests.post(a, t, 'Timed out.', base + interval '3 minutes');
  pl := pg_temp.mkpoll(t, p_time, a, closes => now() - interval '1 hour', at => now() - interval '2 days');
  perform pg_temp.vote(pl, b, '[2]', now() - interval '1 day');
  e := pg_temp.ex(p_time) -> 'poll';
  perform pg_temp.expect(e -> 'closed' = 'true'::jsonb and e -> 'closedBy' = 'null'::jsonb and e -> 'counts' = '[0, 0, 1]'::jsonb and (e ->> 'closedAt')::timestamptz = (e ->> 'endsAt')::timestamptz
    and (e ->> 'endsAt')::timestamptz = (select (payload ->> 'closes_at')::timestamptz from acts where id = pl), 'poll closed by its time: ' || e::text);
  -- closed by its author, and by an admin
  p_auth := tests.post(a, t, 'Author closes.', base + interval '4 minutes');
  pl := pg_temp.mkpoll(t, p_auth, a, at => now() - interval '1 day');
  perform pg_temp.vote(pl, b, '[0]', now() - interval '5 hours');
  auth_close := tests.act(a, 'poll_close', t, '{"by": "author"}', pl, now() - interval '2 hours');
  perform pg_temp.vote(pl, c, '[1]', now() - interval '30 minutes');
  e := pg_temp.ex(p_auth) -> 'poll';
  perform pg_temp.expect(e -> 'closed' = 'true'::jsonb and e ->> 'closedBy' = 'author' and e -> 'counts' = '[1, 0, 0]'::jsonb and (e ->> 'closedAt')::timestamptz = (select created_at from acts where id = auth_close), 'poll closed by its author: ' || e::text);
  p_adm := tests.post(a, t, 'Admin closes.', base + interval '5 minutes');
  pl := pg_temp.mkpoll(t, p_adm, a, at => now() - interval '1 day');
  perform pg_temp.vote(pl, b, '[0]', now() - interval '5 hours');
  adm_close := tests.act(null, 'poll_close', t, '{"by": "admin"}', pl, now() - interval '2 hours');
  e := pg_temp.ex(p_adm) -> 'poll';
  perform pg_temp.expect(e -> 'closed' = 'true'::jsonb and e ->> 'closedBy' = 'admin' and (e ->> 'closedAt')::timestamptz = (select created_at from acts where id = adm_close), 'poll closed by an admin: ' || e::text);
  -- removed
  p_gone := tests.post(a, t, 'Poll removed.', base + interval '6 minutes');
  pl := pg_temp.mkpoll(t, p_gone, a, at => now() - interval '1 day');
  perform tests.act(a, 'poll', t, '{"removed": true}', p_gone, now() - interval '3 hours');
  perform pg_temp.expect(pg_temp.ex(p_gone) -> 'poll' = 'null'::jsonb, 'a removed poll is null: ' || (pg_temp.ex(p_gone))::text);
  -- secret: no ballot character, no picks, anywhere
  p_sec := tests.post(a, t, 'Secret poll.', base + interval '7 minutes');
  pl := pg_temp.mkpoll(t, p_sec, a, secret => true, at => now() - interval '1 day');
  secret_ballot := pg_temp.vote(pl, b, '[1]', now() - interval '3 hours'); perform pg_temp.vote(pl, c, '[1]', now() - interval '2 hours');
  insert into fx values ('sec_poll', pl), ('sec_ballot', secret_ballot);
  r := post_extras(array[p_sec]);
  perform pg_temp.expect(r -> 0 -> 'poll' -> 'counts' = '[0, 2, 0]'::jsonb and r -> 0 -> 'poll' -> 'secret' = 'true'::jsonb and r -> 0 -> 'poll' -> 'voters' = '2'::jsonb, 'the secret poll: ' || r::text);
  perform pg_temp.expect(r::text !~ b::text and r::text !~ c::text and r::text !~ ab::text and r::text !~ ac::text and r::text !~ secret_ballot::text and r::text !~ 'picks', 'a secret poll names a ballot character: ' || r::text);

  -- plays: a live play with a saved state and a config, a sprung back, an unsprung back, a caught play
  p_play := tests.post(b, t, 'Played on.', base + interval '8 minutes');
  w := tests.act(a, 'card', t, jsonb_build_object('card', 'exsplat', 'config', jsonb_build_object('color', 'teal')), p_play, now() - interval '2 days');
  insert into effect_state (play, state, saved_by, saved_at) values (w, '{"strokes": [[1, 2]], "washed": 0.25}', a, now() - interval '1 day');
  sp := pg_temp.back(b, ab, t, p_play, 1, now() - interval '1 day', true);
  us := pg_temp.back(b, ab, t, p_play, 2, now() - interval '20 hours', false);
  -- plays that ended are no layer the board draws: a back that sprang with no lockout, a play past its end, and a play an admin ended
  ended_back := pg_temp.back(b, ab, t, p_play, 3, now() - interval '19 hours', true, false);
  ended_time := tests.act(a, 'card', t, jsonb_build_object('card', 'exsweet', 'ends', now() - interval '1 hour'), p_play, now() - interval '12 hours');
  ended_admin := tests.act(a, 'card', t, jsonb_build_object('card', 'exblot'), p_play, now() - interval '11 hours');
  adm1 := tests.account('ex-adm1');
  insert into admins (account) values (adm1);
  perform tests.become(adm1);
  perform reverse_card(ended_admin);
  perform tests.unbecome();
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'exwink', 'caught', 'x'), p_play, now() - interval '10 hours');
  e := pg_temp.ex(p_play);
  plays := e -> 'plays';
  perform pg_temp.expect(jsonb_array_length(plays) = 2, 'the plays are the Whoops and the back sprung into a lockout, not an unsprung back, a caught play or plays that ended: ' || plays::text);
  perform pg_temp.expect(plays -> 0 = jsonb_build_object('play', w, 'card', 'exsplat', 'at', (select created_at from acts where id = w), 'by', 'Ex Ann', 'config', '{"color": "teal"}'::jsonb,
    'state', '{"strokes": [[1, 2]], "washed": 0.25}'::jsonb, 'text', null, 'covered', null), 'the live play: ' || (plays -> 0)::text);
  perform pg_temp.expect((plays -> 1 ->> 'play')::uuid = sp and plays -> 1 -> 'card' = 'null'::jsonb and plays -> 1 -> 'state' = 'null'::jsonb and plays -> 1 ->> 'by' = 'Ex Bob', 'the sprung back: ' || (plays -> 1)::text);
  perform pg_temp.expect(e::text !~ us::text and e::text !~ ended_back::text and e::text !~ ended_time::text and e::text !~ ended_admin::text and e::text !~ 'exback', 'an unsprung back or a back''s card appears: ' || e::text);
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys(plays -> 0) k) = array['at', 'by', 'card', 'config', 'covered', 'play', 'state', 'text'], 'the play keys');

  -- a writing play's words (the current version's, else the latest) and a surface's share covered
  w := tests.act(c, 'card', t, jsonb_build_object('card', 'exwink'), p_play, now() - interval '8 hours');
  insert into card_texts (play, version, text) values (w, p_play, 'A tail for the old version.');
  insert into surfaces (play, post, cover, owners, live) values (w, p_play, (repeat('1', 2500) || repeat('0', 7500))::bit(10000), array_fill(0::smallint, array[10000]), '{}');
  insert into fx values ('tail_play', w), ('unsprung', us), ('shown_post', p_play);
  plays := pg_temp.ex(p_play) -> 'plays';
  perform pg_temp.expect((select x ->> 'text' from jsonb_array_elements(plays) x where x ->> 'play' = w::text) = 'A tail for the old version.'
    and (select (x ->> 'covered')::numeric from jsonb_array_elements(plays) x where x ->> 'play' = w::text) = 0.25, 'the text and covered of a play: ' || plays::text);
  perform tests.act(b, 'edit', t, '{"body": "Edited."}', p_play, now() - interval '7 hours');
  perform pg_temp.expect((select x ->> 'text' from jsonb_array_elements(pg_temp.ex(p_play) -> 'plays') x where x ->> 'play' = w::text) = 'A tail for the old version.', 'with no text for the current version the latest is shown');
  insert into card_texts (play, version, text) values (w, (select id from acts where kind = 'edit' and target_act_id = p_play), 'A tail for the new version.');
  perform pg_temp.expect((select x ->> 'text' from jsonb_array_elements(pg_temp.ex(p_play) -> 'plays') x where x ->> 'play' = w::text) = 'A tail for the new version.', 'the current version''s text is shown');
  -- a live rewind: the older version's body and its time
  p_rw := tests.post(a, t, 'First words.', base + interval '9 minutes');
  p_ed := tests.act(a, 'edit', t, '{"body": "Second words."}', p_rw, now() - interval '2 days');
  perform tests.act(a, 'edit', t, '{"body": "Third words."}', p_rw, now() - interval '1 day');
  rpoint := now() - interval '36 hours';
  perform tests.act(b, 'card', t, jsonb_build_object('card', 'exrewind', 'reach', 'post', 'ends', now() + interval '1 day', 'rewind_at', rpoint), p_rw, now() - interval '1 hour');
  e := pg_temp.ex(p_rw);
  perform pg_temp.expect(e ->> 'body' = 'Second words.' and (e ->> 'rewoundTo')::timestamptz = rpoint, 'the rewound post: ' || e::text);
  perform pg_temp.expect(not pg_temp.ex(p_plain) ? 'body', 'a post under no rewind carries no body');
  insert into fx values ('p_rw', p_rw), ('p_play', p_play), ('p_open', p_open), ('p_sec', p_sec), ('p_react', p_react), ('p_plain', p_plain);
  -- more than 200 posts are refused plainly, and an empty list is an empty answer
  perform pg_temp.expect(pg_temp.coded('select post_extras(array(select gen_random_uuid() from generate_series(1, 201)))') ~ '^22023 ask for at most 200 posts at a time', 'more than 200 posts are not refused');
  perform pg_temp.expect(post_extras('{}') = '[]'::jsonb, 'an empty list');
  -- one entry for each post, in the order given
  r := post_extras(array[p_rw, p_react, p_rw]);
  perform pg_temp.expect(jsonb_array_length(r) = 2 and r -> 0 ->> 'post' = p_rw::text and r -> 1 ->> 'post' = p_react::text, 'the entries: ' || r::text);

  -- pool_read carries the same on each post, and the rewound body
  r := pool_read(t, 'ex-boss', null, 200);
  -- ... and, whole, names no one who only voted or reacted, no account, no ballot and no picks (the authors of its posts, a and b, are in it as authors)
  perform pg_temp.expect(r::text !~ c::text and r::text !~ ab::text and r::text !~ ac::text and r::text !~ aa::text and r::text !~ 'picks'
    and not exists (select 1 from acts x where x.kind = 'ballot' and x.thread = t and r::text ~ x.id::text), 'pool_read of the thread names a ballot, a voter or an account: ' || left(r::text, 2000));
  perform pg_temp.expect((select x ->> 'body' from jsonb_array_elements(r -> 'posts') x where x ->> 'act' = p_rw::text) = 'Second words.', 'pool_read shows the rewound body');
  perform pg_temp.expect((select x -> 'reactions' from jsonb_array_elements(r -> 'posts') x where x ->> 'act' = p_react::text) = '{"up": 3, "boo": 1}'::jsonb, 'pool_read carries reactions');
  perform pg_temp.expect((select (x -> 'poll' ->> 'voters')::integer from jsonb_array_elements(r -> 'posts') x where x ->> 'act' = p_open::text) = 3, 'pool_read carries the poll');
  perform pg_temp.expect((select jsonb_array_length(x -> 'plays') from jsonb_array_elements(r -> 'posts') x where x ->> 'act' = p_play::text) = 3, 'pool_read carries the plays');
  perform pg_temp.expect(r -> 'origin' = 'null'::jsonb, 'an unspun thread''s origin is null: ' || (r -> 'origin')::text);
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys(r) k) = array['origin', 'posts', 'self', 'title'], 'pool_read keys');
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys(r -> 'posts' -> 0) k) = array['act', 'at', 'author', 'body', 'name', 'plays', 'poll', 'pronouns', 'quotes', 'reactions', 'replyTo', 'rewoundTo', 'seq'], 'a post''s keys');
end $$;

-- ---- 2. the origin, one thread spun from each kind ----
do $$
declare
  a uuid := pg_temp.f('a'); b uuid := pg_temp.f('b'); c uuid := pg_temp.f('c'); ac uuid := tests.account('ex-dee');
  d uuid := tests.character(ac, 'Ex Dee');
  t uuid := tests.thread('Ex Origins'); board_thread uuid := tests.thread('Ex Board Plays');
  base timestamptz := now() - interval '5 days';
  p uuid; empty uuid; pl uuid; bl uuid; play uuid; spl uuid; bplay uuid; upd uuid; dev uuid; rep uuid; ver uuid; inf uuid; ban uuid; mov uuid; apl uuid; apm uuid; rul uuid; rulm uuid;
  later uuid; first_play uuid; second_play uuid; hidden uuid; adm uuid := tests.account('ex-admin'); kassie uuid; boss uuid; ann_thread uuid := tests.thread('Ex Announcements');
  th uuid; o jsonb; chp uuid; reach_play uuid;
  general uuid := (select id from boards where slug = 'general');
  pv uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into admins (account) values (adm);
  -- the post, whose words are empty and whose poll and plays are the whole of it
  empty := tests.post(a, t, '', base);
  p := empty;
  insert into fx values ('d', d), ('o_post', p);
  th := pg_temp.spun(d, p); o := pg_temp.origin_of(th);
  perform pg_temp.expect(o ->> 'kind' = 'post' and o -> 'moment' = 'false'::jsonb and (o -> 'post' ->> 'act')::uuid = p and o -> 'post' ->> 'name' = 'Ex Ann' and o -> 'post' ->> 'title' = 'Ex Origins'
    and (o ->> 'at')::timestamptz = (select created_at from acts where id = p) and (o ->> 'spunAt')::timestamptz = (select created_at from threads where id = th)
    and o -> 'place' = (select origin_place from thread_list where id = th) and o -> 'post' ? 'poll' and o -> 'post' ? 'plays' and o -> 'post' ? 'reactions' and o -> 'post' ? 'seq' and o -> 'post' ? 'thread',
    'a post origin: ' || o::text);
  -- the poll, and a public ballot: the post the poll is on, with its poll
  pl := pg_temp.mkpoll(t, p, a, at => base + interval '1 minute');
  bl := pg_temp.vote(pl, b, '[1]', base + interval '2 minutes');
  insert into fx values ('o_poll', pl), ('o_ballot', bl);
  o := pg_temp.spun_origin(d, pl);
  perform pg_temp.expect(o ->> 'kind' = 'poll' and (o -> 'post' ->> 'act')::uuid = p and o -> 'post' -> 'poll' ->> 'voters' = '1', 'a poll origin: ' || o::text);
  o := pg_temp.spun_origin(d, bl);
  perform pg_temp.expect(o ->> 'kind' = 'ballot' and (o -> 'post' ->> 'act')::uuid = p, 'a ballot origin: ' || o::text);
  -- a spin of the secret poll: its post with its counts and no ballot's character anywhere; a secret ballot cannot be spun; a public ballot's place names its public character and the poll part none
  o := pg_temp.spun_origin(d, pg_temp.f('sec_poll'));
  perform pg_temp.expect(o ->> 'kind' = 'poll' and o -> 'post' -> 'poll' -> 'secret' = 'true'::jsonb and o -> 'post' -> 'poll' -> 'voters' = '2'
    and o::text !~ b::text and o::text !~ c::text and o::text !~ pg_temp.f('ab')::text and o::text !~ pg_temp.f('sec_ballot')::text and o::text !~ 'picks', 'the origin of a secret poll names a ballot: ' || o::text);
  perform pg_temp.expect(pg_temp.coded(format('select spin_written(%L, %L, ''x'', ''y'', false, array[]::uuid[], null)', pg_temp.f('sec_ballot'), d)) is not null, 'a secret ballot was spun');
  o := pg_temp.spun_origin(d, bl);
  perform pg_temp.expect(o -> 'place' -> 'character' ->> 'id' = b::text and (o -> 'post' -> 'poll')::text !~ b::text and (o -> 'post' -> 'poll')::text !~ c::text and (o -> 'post' -> 'poll')::text !~ 'picks', 'the poll of a spun ballot: ' || (o -> 'post' -> 'poll')::text);
  -- a play on a post: a moment; the plays are those as they stood, and a play landed after the spin is absent
  p := tests.post(b, t, 'Played on.', base + interval '3 minutes');
  first_play := tests.act(a, 'card', t, jsonb_build_object('card', 'exsplat', 'reach', 'post'), p, base + interval '4 minutes');
  insert into effect_state (play, state, saved_by, saved_at) values (first_play, '{"strokes": [[9]]}', a, base + interval '5 minutes');
  second_play := tests.act(c, 'card', t, jsonb_build_object('card', 'exblot', 'reach', 'post'), p, base + interval '6 minutes');
  insert into fx values ('o_play', second_play);
  th := pg_temp.spun(d, second_play);
  later := tests.act(a, 'card', t, jsonb_build_object('card', 'exsweet', 'reach', 'post'), p, base + interval '7 minutes');
  o := pg_temp.origin_of(th);
  perform pg_temp.expect(o ->> 'kind' = 'card' and o -> 'moment' = 'true'::jsonb and (o -> 'post' ->> 'act')::uuid = p, 'a play origin: ' || o::text);
  perform pg_temp.expect((select array_agg((x ->> 'play')::uuid order by x ->> 'at') from jsonb_array_elements(o -> 'post' -> 'plays') x) = array[first_play, second_play], 'the moment''s plays: ' || (o -> 'post' -> 'plays')::text);
  perform pg_temp.expect(o::text !~ later::text, 'a play landed after the spin is in the origin');
  perform pg_temp.expect((select x -> 'state' from jsonb_array_elements(o -> 'post' -> 'plays') x where x ->> 'play' = first_play::text) = '{"strokes": [[9]]}'::jsonb, 'the moment''s state of the first play');
  perform pg_temp.expect(jsonb_array_length(post_extras(array[p]) -> 0 -> 'plays') = 3, 'the live plays are three');
  -- a play on a character, spun at a post: spin_moment's
  chp := tests.character(tests.account('ex-eve'), 'Ex Eve');
  p := tests.post(chp, t, 'Pressed at.', base + interval '8 minutes');
  first_play := tests.act(a, 'card', t, jsonb_build_object('card', 'exsplat', 'reach', 'post'), p, base + interval '9 minutes');
  reach_play := tests.act(b, 'card', t, jsonb_build_object('card', 'exsweet', 'reach', 'character', 'character', chp), p, base + interval '10 minutes');
  insert into play_reach (play, reach, character, ends_at) values (reach_play, 'character', chp, now() + interval '1 day');
  insert into fx values ('o_char', reach_play), ('o_char_at', p);
  th := pg_temp.spun(d, reach_play, p);
  later := tests.act(a, 'card', t, jsonb_build_object('card', 'exblot', 'reach', 'post'), p, base + interval '11 minutes');
  o := pg_temp.origin_of(th);
  perform pg_temp.expect(o ->> 'kind' = 'card' and o -> 'moment' = 'true'::jsonb and o -> 'post' is not null and (o -> 'post' ->> 'act')::uuid = p, 'a play on a character: ' || o::text);
  perform pg_temp.expect((select array_agg((x ->> 'play')::uuid) from jsonb_array_elements(o -> 'post' -> 'plays') x) = array[first_play] and o::text !~ later::text,
    'the spin_moment branch: the plays are the layers recorded at the spin and not the play landed after it: ' || (o -> 'post' -> 'plays')::text);
  -- a play on a character spun with no post pressed: the post it was cast from, with the play's own moment (play_moment's), the character play not among the post's plays
  th := pg_temp.spun(d, reach_play);
  o := pg_temp.origin_of(th);
  perform pg_temp.expect((o -> 'post' ->> 'act')::uuid = p and o -> 'moment' = 'true'::jsonb and (select array_agg((x ->> 'play')::uuid) from jsonb_array_elements(o -> 'post' -> 'plays') x) = array[first_play], 'a play on a character, no post pressed: ' || o::text);
  -- a play on a board: no post
  bplay := tests.act(a, 'card', board_thread, jsonb_build_object('card', 'exsweet', 'reach', 'board', 'board', general), null);
  insert into play_reach (play, reach, board, ends_at) values (bplay, 'board', general, now() + interval '1 day');
  insert into fx values ('o_board', bplay);
  o := pg_temp.spun_origin(d, bplay);
  perform pg_temp.expect(o ->> 'kind' = 'card' and o -> 'moment' = 'true'::jsonb and o -> 'post' = 'null'::jsonb and o -> 'place' -> 'on' ->> 'kind' = 'board', 'a board play: ' || o::text);
  -- an update
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb, 'developer', jsonb_build_object('name', 'Ex Gabe', 'title', 'Made this.', 'avatar', 'gabe')));
  select id into dev from characters where staff_kind = 'developer';
  perform set_config('kayfabb.update_writer', 'on', true);
  upd := tests.act(dev, 'update', (select (value #>> '{}')::uuid from settings where key = 'updatesThread'), '{"title": "Ex Headline", "body": "Update body.", "changes": []}');
  perform set_config('kayfabb.update_writer', 'off', true);
  insert into fx values ('o_update', upd);
  o := pg_temp.spun_origin(d, upd);
  perform pg_temp.expect(o ->> 'kind' = 'update' and (o -> 'post' ->> 'act')::uuid = upd and o -> 'post' ->> 'body' = 'Update body.' and o -> 'post' ->> 'title' = 'Ex Headline', 'an update origin: ' || o::text);
  -- reports, verdicts, appeals and rulings
  insert into characters (name, staff, staff_kind, debuted_at) values ('Ex Kassie', 'ex-kassie', 'persona', now()) returning id into kassie;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Ex Judge', 'ex-judge', 'persona', now()) returning id into boss;
  p := tests.post(b, t, 'Reported post.', base + interval '12 minutes');
  perform set_config('kayfabb.report_writer', 'on', true); perform set_config('kayfabb.warn_writer', 'on', true); perform set_config('kayfabb.appeal_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (a, 'report', t, p, '{"reason": "a"}') returning id into rep;
  insert into acts (character, kind, thread, target_act_id, payload) values (kassie, 'report_verdict', t, rep, jsonb_build_object('report_act', rep, 'verdict', 'dismissed', 'line', 'No.')) returning id into ver;
  insert into acts (character, kind, thread, payload) values (null, 'infraction', t, jsonb_build_object('character', b, 'band', 'severe', 'points', 7, 'rule_number', null, 'board', general, 'about_act', p, 'visit_act', null, 'staff', 'ex-kassie', 'expires_at', now() + interval '14 days')) returning id into inf;
  insert into move_kinds (key, structural) values ('conferGroup', false) on conflict (key) do nothing;
  insert into group_kinds (key, name, color, source, tone) values ('exTrial', 'Ex Trial', '#cc0000', 'conferred', 'punishment') on conflict (key) do nothing;
  insert into acts (character, kind, thread, payload) values (kassie, 'move', ann_thread, jsonb_build_object('kind', 'conferGroup', 'params', jsonb_build_object('group', 'exTrial', 'character', b))) returning id into mov;
  insert into acts (character, kind, thread, target_act_id, payload) values (b, 'appeal', t, inf, '{"plea": "i"}') returning id into apl;
  insert into acts (character, kind, thread, target_act_id, payload) values (b, 'appeal', ann_thread, mov, '{"plea": "m"}') returning id into apm;
  insert into acts (character, kind, thread, target_act_id, payload) values (boss, 'appeal_ruling', t, apl, jsonb_build_object('appeal_act', apl, 'verdict', 'upheld', 'points_delta', 0, 'line', 'Upheld.')) returning id into rul;
  insert into acts (character, kind, thread, target_act_id, payload) values (boss, 'appeal_ruling', ann_thread, apm, jsonb_build_object('appeal_act', apm, 'verdict', 'upheld', 'points_delta', 0, 'line', 'Upheld.')) returning id into rulm;
  perform set_config('kayfabb.report_writer', '', true); perform set_config('kayfabb.warn_writer', '', true); perform set_config('kayfabb.appeal_writer', '', true);
  insert into fx values ('o_report', rep), ('o_verdict', ver), ('o_appeal', apl), ('o_ruling', rul);
  foreach hidden in array array[rep, ver, apl, rul] loop
    o := pg_temp.spun_origin(d, hidden);
    perform pg_temp.expect(o ->> 'kind' in ('report', 'report_verdict', 'appeal', 'appeal_ruling') and o -> 'place' ->> 'kind' = 'answer' and (o -> 'post' ->> 'act')::uuid in (p, p) and o -> 'post' ->> 'seq' = (select seq::text from acts where id = p),
      'an ask or answer origin ' || (o ->> 'kind') || ': ' || o::text);
  end loop;
  -- an appeal of a move: the move's line is no post
  o := pg_temp.spun_origin(d, rulm);
  perform pg_temp.expect(o ->> 'kind' = 'appeal_ruling' and o -> 'post' = 'null'::jsonb and o -> 'place' ->> 'kind' = 'answer', 'an appeal of a move has no post: ' || o::text);
  -- an origin post an admin hid is null, as the board shows none
  hidden := tests.post(b, t, 'Hidden words.', base + interval '13 minutes');
  th := pg_temp.spun(d, hidden);
  insert into conduct_decisions (version_act, post, admin, outcome) values (hidden, hidden, adm, 'hide');
  o := pg_temp.origin_of(th);
  perform pg_temp.expect(o ->> 'kind' = 'post' and o -> 'post' = 'null'::jsonb and o::text !~ 'Hidden words', 'a hidden origin post: ' || o::text);

  -- ---- the digest role asks for what the board does not show: a hidden post's poll, plays and a writing play's words; a secret ballot; an unsprung back ----
  declare hp uuid; hpoll uuid; hplay uuid; hplay2 uuid; refunded uuid; shown_text text; tp uuid; got jsonb; n integer;
  begin
    hp := tests.post(b, t, 'Hidden with extras.', base + interval '14 minutes');
    hpoll := pg_temp.mkpoll(t, hp, b, at => base + interval '15 minutes');
    hplay := tests.act(a, 'card', t, jsonb_build_object('card', 'exwink', 'reach', 'post'), hp, base + interval '16 minutes');
    insert into card_texts (play, version, text) values (hplay, hp, 'SECRET TAIL ON HIDDEN POST');
    hplay2 := tests.act(c, 'card', t, jsonb_build_object('card', 'exsplat', 'reach', 'post'), hp, base + interval '17 minutes');
    insert into reaction_tallies (act, kind, count) values (hp, 'up', 4);
    -- a writing play on a post the board shows, whose write was refunded: the board shows no such play, and its words are not for the digest role to read by its id
    refunded := tests.act(a, 'card', t, jsonb_build_object('card', 'exwink', 'reach', 'post'), pg_temp.f('shown_post'), base + interval '16 minutes 30 seconds');
    insert into card_texts (play, version, text) values (refunded, pg_temp.f('shown_post'), 'REFUNDED WORDS');
    insert into card_write_refunds (play) values (refunded);
    insert into conduct_decisions (version_act, post, admin, outcome) values (hp, hp, adm, 'hide');
    -- post_extras, asked for the hidden post directly, says nothing of it (an entry for it all the same, so one entry stays one post asked for, in the order asked)
    got := post_extras(array[pg_temp.f('shown_post'), hp, pg_temp.f('p_react')]);
    perform pg_temp.expect(jsonb_array_length(got) = 3 and got -> 1 = jsonb_build_object('post', hp, 'poll', null, 'plays', '[]'::jsonb, 'reactions', '{}'::jsonb, 'rewoundTo', null), 'post_extras of a hidden post: ' || (got -> 1)::text);
    perform pg_temp.expect(got::text !~ 'SECRET TAIL' and got::text !~ hplay::text and got ->> 0 is not null and (got -> 0 ->> 'post') = pg_temp.f('shown_post')::text and jsonb_array_length(got -> 0 -> 'plays') > 0 and got -> 2 -> 'reactions' = '{"up": 3, "boo": 1}'::jsonb,
      'post_extras beside a hidden post still reads the others: ' || got::text);
    perform pg_temp.expect(pg_temp.ex(hp) -> 'poll' = 'null'::jsonb, 'a hidden post''s poll');
    -- extras_layers, run as the digest role (the role is set around each call alone: it has no right to the session's temp schema)
    foreach hplay in array array[hplay, hplay2, refunded, pg_temp.f('sec_ballot'), pg_temp.f('unsprung'), gen_random_uuid()] loop
      perform set_config('role', 'kayfabb_digest', true);
      select count(*) into n from extras_layers('play', hplay);
      reset role;
      perform pg_temp.expect(n = 0, 'extras_layers gives back ' || hplay::text || ' (a play on a hidden post, a secret ballot, an unsprung back or nothing)');
      perform set_config('role', 'kayfabb_digest', true);
      select count(*) into n from extras_layers('spin', hplay);
      reset role;
      perform pg_temp.expect(n = 0, 'extras_layers (spin) gives back ' || hplay::text);
    end loop;
    -- and the gate is not closed to the board's own plays: a shown writing play comes back, with its words
    tp := pg_temp.f('tail_play');
    perform set_config('role', 'kayfabb_digest', true);
    select count(*), max(x.text) into n, shown_text from extras_layers('play', tp) x;
    reset role;
    perform pg_temp.expect(n >= 1 and shown_text = 'A tail for the new version.', 'extras_layers of a shown play: ' || n::text || ' ' || coalesce(shown_text, 'null'));
  end;
end $$;

-- ---- 5. the security ----
do $$
declare f text; bad text;
begin
  if has_function_privilege('service_role', 'post_extras_rows(uuid[], uuid[])'::regprocedure, 'execute') or has_function_privilege('authenticated', 'post_extras_rows(uuid[], uuid[])'::regprocedure, 'execute') or has_function_privilege('anon', 'post_extras_rows(uuid[], uuid[])'::regprocedure, 'execute') then
    raise exception 'post_extras_rows is callable by a client role';
  end if;
  foreach f in array array['post_extras(uuid[])', 'pool_read(uuid, text, uuid[], integer)'] loop
    if (select pg_get_userbyid(proowner) from pg_proc where oid = f::regprocedure) is distinct from 'kayfabb_digest'
       or not has_function_privilege('service_role', f::regprocedure, 'execute') or has_function_privilege('authenticated', f::regprocedure, 'execute') or has_function_privilege('anon', f::regprocedure, 'execute')
       or not (select prosecdef from pg_proc where oid = f::regprocedure) then
      raise exception '% is not owned by the digest role, the service role''s alone and a definer', f;
    end if;
  end loop;
  foreach f in array array['extras_ids(uuid[])', 'extras_layers(text, uuid)', 'pool_read_origin(uuid, jsonb)', 'post_extras(uuid[])', 'pool_read(uuid, text, uuid[], integer)', 'spin_answer_place(uuid)'] loop
    if not has_function_privilege('kayfabb_digest', f::regprocedure, 'execute') and f not in ('post_extras(uuid[])', 'pool_read(uuid, text, uuid[], integer)', 'pool_read_origin(uuid, jsonb)') then raise exception 'the digest role cannot run %', f; end if;
    if f not in ('post_extras(uuid[])', 'pool_read(uuid, text, uuid[], integer)', 'spin_answer_place(uuid)') and (has_function_privilege('service_role', f::regprocedure, 'execute') or has_function_privilege('authenticated', f::regprocedure, 'execute') or has_function_privilege('anon', f::regprocedure, 'execute')) then
      raise exception '% is callable by a client role', f;
    end if;
    -- security definer with search_path pinned, ending pg_temp
    if not (select prosecdef from pg_proc where oid = f::regprocedure) or (select proconfig from pg_proc where oid = f::regprocedure) is null
       or not exists (select 1 from pg_proc p, unnest(p.proconfig) c where p.oid = f::regprocedure and c like 'search_path=%pg_temp') then
      raise exception '% is not security definer with a search_path ending pg_temp', f;
    end if;
  end loop;
  -- the grants to the digest role are the ones the migration names: none on the page functions, none on the tables the helpers read
  foreach f in array array['post_plays(uuid[])', 'latest_poll(uuid)', 'spin_moment(uuid)', 'post_rewind_plays(uuid[])', 'post_play_ids(uuid[])', 'play_moment(uuid)', 'rewind_view(uuid)'] loop
    if has_function_privilege('kayfabb_digest', f::regprocedure, 'execute') then raise exception 'the digest role runs %, which no migration of this change gave it', f; end if;
  end loop;
  foreach f in array array['play_post', 'effect_state', 'spin_moment_layers', 'play_moment_layers', 'card_kinds', 'acts', 'post_kinds', 'poll_latest_ballots', 'reactions', 'my_ballots'] loop
    if has_table_privilege('kayfabb_digest', f, 'select') then raise exception 'the digest role reads %', f; end if;
  end loop;
  if not has_table_privilege('kayfabb_digest', 'poll_counts', 'select') or not has_table_privilege('kayfabb_digest', 'reaction_tallies_open', 'select') then raise exception 'the digest role lost a view it had'; end if;
  -- every definer function of the migration pins its search_path
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p
  where p.proname in ('extras_ids', 'extras_layers', 'pool_read_origin', 'post_extras', 'post_extras_rows', 'pool_read') and p.prosecdef
    and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp');
  if bad is not null then raise exception 'unpinned: %', bad; end if;
end $$;

-- ---- 3. the bound ----
-- Threads whose posts each carry a poll (with `bal` ballots by five characters) and eight plays (four kinds, two each). `n` posts. The persona writes none of them: a persona's own posts that nobody answered make 0425's pool_reply_ids read the
-- thread under empty statistics (acts_patrol_posts, filtered by target: the reply read finds none and does not stop). That is pre-existing on main and inside 0425's own documented exception (the helpers
-- may read the thread, never the table); the owner files it separately, so it is not this file's subject.
-- A thread of `n` plain posts spun from the origin section 2 kept as `o_<kind>` (a play on a character is spun at the post it was pressed at).
create function pg_temp.kind_thread(k text, n integer) returns uuid language plpgsql as $$
declare
  ch uuid[] := array[pg_temp.f('a'), pg_temp.f('b'), pg_temp.f('c')];
  made jsonb; th uuid; i integer;
begin
  made := spin_written(pg_temp.f('o_' || k), pg_temp.f('d'), 'Kind ' || k || ' ' || n, 'Discuss.', false, array[]::uuid[], case when k = 'char' then pg_temp.f('o_char_at') end);
  th := (made -> 'thread' ->> 'id')::uuid;
  for i in 1..n loop
    perform tests.act(ch[1 + i % 3], 'post', th, jsonb_build_object('body', 'Kind post ' || i), null, now() - interval '1 day' + i * interval '1 second');
  end loop;
  return th;
end $$;

-- A post (in a thread of its own) with `m` plays landed one after another; the post's id and the last play's.
create function pg_temp.layered_post(m integer) returns uuid[] language plpgsql as $$
declare
  t uuid := tests.thread('Ex Layered ' || m); ch uuid[] := array[pg_temp.f('a'), pg_temp.f('b'), pg_temp.f('c')];
  kinds text[] := array['exsplat', 'exsweet', 'exblot', 'exwink']; p uuid; pl uuid; i integer; base timestamptz := now() - interval '3 days';
begin
  p := tests.act(ch[1], 'post', t, jsonb_build_object('body', 'Layered post'), null, base);
  for i in 1..m loop
    pl := tests.act(ch[1 + i % 3], 'card', t, jsonb_build_object('card', kinds[1 + i % 4], 'reach', 'post'), p, base + i * interval '1 minute');
  end loop;
  return array[p, pl];
end $$;

create function pg_temp.ex_thread(n integer, bal integer, title text) returns uuid language plpgsql as $$
declare
  ot uuid := tests.thread(title || ' origin');
  ch uuid[] := array(select id from characters where name in ('Ex Ann', 'Ex Bob', 'Ex Cat', 'Ex Dee', 'Ex Eve') order by name);
  base timestamptz := now() - interval '2 days';
  op uuid; first_play uuid; origin_play uuid; made jsonb; t uuid;
  p uuid; pl uuid; i integer; j integer; who uuid;
  kinds text[] := array['exsplat', 'exsweet', 'exblot', 'exwink'];
begin
  -- the thread is spun from a play on a post of another thread, so that pool_read reads a moment origin (a post with a poll and plays) as well
  op := tests.act(ch[1], 'post', ot, jsonb_build_object('body', 'The origin post'), null, base - interval '1 hour');
  perform pg_temp.mkpoll(ot, op, ch[1], at => base - interval '59 minutes');
  first_play := tests.act(ch[2], 'card', ot, jsonb_build_object('card', 'exsplat', 'reach', 'post'), op, base - interval '58 minutes');
  origin_play := tests.act(ch[3], 'card', ot, jsonb_build_object('card', 'exblot', 'reach', 'post'), op, base - interval '57 minutes');
  made := spin_written(origin_play, ch[4], title, 'Discuss.', false, array[]::uuid[], null);
  t := (made -> 'thread' ->> 'id')::uuid;
  for i in 1..n loop
    who := ch[1 + i % 5];
    p := tests.act(who, 'post', t, jsonb_build_object('body', 'Bound post ' || i), null, base + i * interval '1 second');
    pl := pg_temp.mkpoll(t, p, who, secret => i % 3 = 0, closes => now() + interval '1 day', at => base + i * interval '1 second');
    for j in 1..bal loop
      perform pg_temp.vote(pl, ch[1 + j % 5], jsonb_build_array(j % 3), base + i * interval '1 second' + j * interval '1 millisecond');
    end loop;
    for j in 1..8 loop
      perform tests.act(ch[1 + (i + j) % 5], 'card', t, jsonb_build_object('card', kinds[1 + j % 4], 'reach', 'post'), p, base + i * interval '1 second' + j * interval '2 milliseconds');
    end loop;
    -- every arm of extras_ids on the newest 200 posts: a removed poll on every fifth, a back that sprang into a lockout, and a live rewind (the post edited twice, the card naming the point between)
    if i > n - 200 then
      if i % 5 = 0 then perform tests.act(who, 'poll', t, '{"removed": true}', p, base + i * interval '1 second' + interval '500 milliseconds'); end if;
      perform pg_temp.back(who, (select c.owner from characters c where c.id = who), t, p, 1, base + i * interval '1 second' + interval '600 milliseconds', true, true);
      perform tests.act(who, 'edit', t, '{"body": "Edited once"}', p, base + i * interval '1 second' + interval '700 milliseconds');
      perform tests.act(who, 'edit', t, '{"body": "Edited twice"}', p, base + i * interval '1 second' + interval '800 milliseconds');
      perform tests.act(ch[1 + (i + 1) % 5], 'card', t, jsonb_build_object('card', 'exrewind', 'reach', 'post', 'ends', now() + interval '1 day', 'rewind_at', base + i * interval '1 second' + interval '750 milliseconds'), p, base + i * interval '1 second' + interval '900 milliseconds');
    end if;
  end loop;
  return t;
end $$;
do $$
declare k text;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into fx values ('small', pg_temp.ex_thread(200, 5, 'Ex Bound 200'));
  insert into fx values ('big', pg_temp.ex_thread(400, 5, 'Ex Bound 400'));
  insert into fx values ('ballots', pg_temp.ex_thread(200, 40, 'Ex Bound 200 ballots'));
  -- for each kind of origin of section 2, a thread of plain posts spun from it at two sizes (the origins are those the section made)
  -- what the origin read does depend on: the plays on the origin post (2 or 9), read live for a post origin and as a moment's recorded layers (1 + 1, or 1 + 8) for a play origin
  insert into fx select 'o_post2', (pg_temp.layered_post(2))[1];
  insert into fx select 'o_play2', (pg_temp.layered_post(2))[2];
  insert into fx select 'o_post9', (pg_temp.layered_post(9))[1];
  insert into fx select 'o_play9', (pg_temp.layered_post(9))[2];
  foreach k in array array['post2', 'post9', 'play2', 'play9'] loop
    insert into fx values ('k_' || k || '_200', pg_temp.kind_thread(k, 200));
  end loop;
  foreach k in array array['post', 'poll', 'ballot', 'play', 'char', 'board', 'update', 'report', 'verdict', 'appeal', 'ruling'] loop
    insert into fx values ('k_' || k || '_200', pg_temp.kind_thread(k, 200)), ('k_' || k || '_400', pg_temp.kind_thread(k, 400));
  end loop;
end $$;

-- `per` is the bound on post_extras for each post it is asked about (a post's polls, plays, edits and tallies are read by key, so the cost is a number of rows for each), `bound` on pool_read, which asks for about 70 posts;
-- neither may differ between a thread of 200 posts, one of 400 and one whose polls hold 40 ballots each, by more than 20 rows.
create function pg_temp.measure(label text, bound bigint, per bigint) returns void language plpgsql as $$
declare
  c0 bigint; cs bigint; cb bigint; cv bigint; e1 bigint[] := '{}'; e2 bigint[] := '{}'; rs jsonb; rb jsonb; rv jsonb; k text; ids uuid[]; r jsonb;
begin
  perform set_config('track_functions', 'all', true);
  c0 := pg_temp.acts_read(); rs := pool_read(pg_temp.f('small'), 'ex-boss', null, 60); cs := pg_temp.acts_read() - c0;
  c0 := pg_temp.acts_read(); rb := pool_read(pg_temp.f('big'), 'ex-boss', null, 60); cb := pg_temp.acts_read() - c0;
  c0 := pg_temp.acts_read(); rv := pool_read(pg_temp.f('ballots'), 'ex-boss', null, 60); cv := pg_temp.acts_read() - c0;
  foreach k in array array['small', 'big', 'ballots'] loop
    ids := array(select a.id from acts a where a.thread = pg_temp.f(k) and a.kind = 'post' order by a.seq desc limit 200);
    c0 := pg_temp.acts_read(); r := post_extras(ids[1:100]); e1 := e1 || (pg_temp.acts_read() - c0);
    c0 := pg_temp.acts_read(); perform post_extras(ids); e2 := e2 || (pg_temp.acts_read() - c0);
  end loop;
  perform set_config('track_functions', 'none', true);
  if jsonb_array_length(rb -> 'posts') < 60 or jsonb_array_length(rs -> 'posts') < 60 then raise exception '[%] the reads are short: % and % posts', label, jsonb_array_length(rs -> 'posts'), jsonb_array_length(rb -> 'posts'); end if;
  if (select count(*) from jsonb_array_elements(rb -> 'posts') x where jsonb_array_length(x -> 'plays') >= 10 and x -> 'poll' <> 'null'::jsonb and x -> 'rewoundTo' <> 'null'::jsonb) < 40 then raise exception '[%] the posts do not carry a poll, eight plays, a back and a rewind: % with plays >= 10, % with a poll, % rewound; one post: %', label, (select count(*) from jsonb_array_elements(rb -> 'posts') x where jsonb_array_length(x -> 'plays') >= 10), (select count(*) from jsonb_array_elements(rb -> 'posts') x where x -> 'poll' <> 'null'::jsonb), (select count(*) from jsonb_array_elements(rb -> 'posts') x where x -> 'rewoundTo' <> 'null'::jsonb), rb -> 'posts' -> 30; end if;
  if (select count(*) from jsonb_array_elements(r -> 0 -> 'plays') x where x -> 'card' = 'null'::jsonb) is distinct from 1 or r -> 0 -> 'rewoundTo' = 'null'::jsonb then raise exception '[%] the measured posts hold no sprung back or rewind', label; end if;
  if rb -> 'origin' -> 'post' is null or jsonb_array_length(rb -> 'origin' -> 'post' -> 'plays') <> 2 or rb -> 'origin' -> 'post' -> 'poll' = 'null'::jsonb then raise exception '[%] the origin is no moment of a post with a poll: %', label, rb -> 'origin'; end if;
  if cb > cs + 20 or cv > cs + 20 then raise exception '[%] pool_read reads % rows of acts (400 posts), % (200 posts), % (40 ballots a poll): it grows with the thread or the ballots', label, cb, cs, cv; end if;
  if e1[2] > e1[1] + 20 or e1[3] > e1[1] + 20 or e2[2] > e2[1] + 20 or e2[3] > e2[1] + 20 then raise exception '[%] post_extras reads % / % / % rows of acts (200 / 400 posts / 40 ballots) for 100 posts and % / % / % for 200: it grows', label, e1[1], e1[2], e1[3], e2[1], e2[2], e2[3]; end if;
  if cb > bound or cv > bound then raise exception '[%] pool_read reads % rows of acts: more than %', label, greatest(cb, cv), bound; end if;
  if greatest(e1[1], e1[2], e1[3]) > per * 100 or greatest(e2[1], e2[2], e2[3]) > per * 200 then raise exception '[%] post_extras reads more than % rows of acts for each post: % for 100 posts, % for 200', label, per, greatest(e1[1], e1[2], e1[3]), greatest(e2[1], e2[2], e2[3]); end if;
  raise notice '[%] rows of acts, pool_read: % (200 posts), % (400), % (40 ballots); post_extras for 100 posts: %, %, % and for 200: %, %, %', label, cs, cb, cv, e1[1], e1[2], e1[3], e2[1], e2[2], e2[3];
end $$;

-- pool_read of a thread of 200 and of 400 plain posts spun from each kind of origin: the same rows of `acts`, below the bound (the plain thread's own read, 0425's, is about 450; the rest is the origin's read; 600 is the stated bound).
create function pg_temp.measure_kinds(label text, bound bigint) returns void language plpgsql as $$
declare
  k text; c0 bigint; lo bigint; hi bigint; worst bigint := 0; r jsonb; line text := ''; trw jsonb;
begin
  perform set_config('track_functions', 'all', true);
  foreach k in array array['post', 'poll', 'ballot', 'play', 'char', 'board', 'update', 'report', 'verdict', 'appeal', 'ruling'] loop
    c0 := pg_temp.acts_read(); r := pool_read(pg_temp.f('k_' || k || '_200'), 'ex-boss', null, 60); lo := pg_temp.acts_read() - c0;
    c0 := pg_temp.acts_read(); r := pool_read(pg_temp.f('k_' || k || '_400'), 'ex-boss', null, 60); hi := pg_temp.acts_read() - c0;
    -- a thread whose origin is no post (a board's play) and whose posts carry no poll, play, edit or tally: what pool_read adds to the posts' own read (pool_read_rows) is a few rows (at most 20: the origin's and the thread's), whatever the number of posts it returns, not a probe of every post
    -- again (0425's dominating-persona thread returns 81 posts and the same persona-free one 76, and CI saw each extra post cost the read rows it already had)
    if k = 'board' then
      c0 := pg_temp.acts_read(); perform count(*) from pool_read_rows(pg_temp.f('k_board_400'), 'ex-boss', null, 60); lo := pg_temp.acts_read() - c0;
      if hi - lo > 20 then raise exception '[%] pool_read reads % rows of acts for the extras of 60 plain posts beyond the % of their own read: it reads each post again', label, hi - lo, lo; end if;
    end if;
    if r -> 'origin' is null or r -> 'origin' = 'null'::jsonb or r -> 'origin' ->> 'kind' is null then raise exception '[%] the thread spun from a % has no origin', label, k; end if;
    if hi > lo + 20 then raise exception '[%] pool_read reads % rows of acts in a thread of 400 posts spun from a % and % in one of 200: it grows', label, hi, k, lo; end if;
    if hi > bound then raise exception '[%] pool_read reads % rows of acts in a thread spun from a %: more than %', label, hi, k, bound; end if;
    line := line || ' ' || k || ' ' || lo || '/' || hi;
    worst := greatest(worst, hi);
  end loop;
  -- a thread that was not spun costs the origin read nothing in `acts` (its first statement reads the thread's row and no Act; CI's 0425 compares threads whose reads differ by a few rows, and a constant here is a row more in one and not the other)
  trw := (select to_jsonb(l) from (select x.title, x.origin_act_id, x.created_at, x.origin_place, x.first_act from thread_list x where x.id = pg_temp.f('t')) l);
  c0 := pg_temp.acts_read(); perform pool_read_origin(pg_temp.f('t'), trw); lo := pg_temp.acts_read() - c0;
  if lo <> 0 then raise exception '[%] the origin read of an unspun thread reads % rows of acts', label, lo; end if;
  perform set_config('track_functions', 'none', true);
  raise notice '[%] rows of acts by kind of origin (200 / 400 posts):%, worst %', label, line, worst;
end $$;

-- The origin read grows with the layers of the origin post, by key, and by a stated allowance for each: a post origin with 9 plays against 2, a play origin whose moment lists 9 layers (itself and 8 recorded) against 2.
create function pg_temp.measure_layers(label text, bound bigint, per_layer bigint) returns void language plpgsql as $$
declare
  k text; c0 bigint; rows bigint[] := '{}'; r jsonb; n integer; want integer;
begin
  perform set_config('track_functions', 'all', true);
  foreach k in array array['post2', 'post9', 'play2', 'play9'] loop
    c0 := pg_temp.acts_read(); r := pool_read(pg_temp.f('k_' || k || '_200'), 'ex-boss', null, 60); rows := rows || (pg_temp.acts_read() - c0);
    n := jsonb_array_length(r -> 'origin' -> 'post' -> 'plays');
    want := case k when 'post2' then 2 when 'post9' then 9 when 'play2' then 2 else 9 end;
    if n is distinct from want then raise exception '[%] the origin of the % thread carries % plays: %', label, k, n, r -> 'origin' -> 'post' -> 'plays'; end if;
  end loop;
  perform set_config('track_functions', 'none', true);
  if greatest(rows[1], rows[2], rows[3], rows[4]) > bound then raise exception '[%] pool_read reads % rows of acts with plays on the origin post: more than %', label, greatest(rows[1], rows[2], rows[3], rows[4]), bound; end if;
  if rows[2] - rows[1] > per_layer * 7 or rows[4] - rows[3] > per_layer * 7 then raise exception '[%] 7 more plays on the origin post cost % rows of acts as a post origin and % as a moment: more than % for each', label, rows[2] - rows[1], rows[4] - rows[3], per_layer; end if;
  raise notice '[%] rows of acts with 2 / 9 plays on the origin post: post origin %, % and play origin %, %', label, rows[1], rows[2], rows[3], rows[4];
end $$;

do $$
begin
  -- relallvisible 0 as well: a visibility map that counts no page all-visible, as 0425's states set it
  delete from pg_statistic where starelid = 'acts'::regclass;
  update pg_class set relpages = 0, reltuples = 0, relallvisible = 0 where oid = 'acts'::regclass;
  if (select reltuples from pg_class where oid = 'acts'::regclass) is distinct from 0 then raise exception 'the statistics were not set'; end if;
end $$;
select pg_temp.measure('empty statistics', 4000, 50);
select pg_temp.measure_kinds('empty statistics', 600);
select pg_temp.measure_layers('empty statistics', 700, 10);
set local plan_cache_mode = force_generic_plan;
select pg_temp.measure('empty statistics, generic plans', 4000, 50);
select pg_temp.measure_kinds('empty statistics, generic plans', 600);
select pg_temp.measure_layers('empty statistics, generic plans', 700, 10);
reset plan_cache_mode;

-- ---- 4. the bound can fail: the plays of 200 posts read by a join over `acts`, as a first draft would ----
do $$
declare ids uuid[] := array(select a.id from acts a where a.thread = pg_temp.f('big') and a.kind = 'post' order by a.seq limit 100); c0 bigint; c bigint;
begin
  perform set_config('track_functions', 'all', true);
  c0 := pg_temp.acts_read();
  perform count(*) from acts_public p join play_post pp on pp.play = p.id where pp.post = any (ids) and p.kind = 'card';
  c := pg_temp.acts_read() - c0;
  if c <= 4000 then raise exception 'a read of plays by a join over acts read only % rows under empty statistics: this test cannot tell the bounded read from it', c; end if;
  raise notice 'the join over acts: % rows of acts', c;
end $$;

analyze acts;
select pg_temp.measure('true statistics', 4000, 50);
select pg_temp.measure_kinds('true statistics', 600);
select pg_temp.measure_layers('true statistics', 700, 10);
