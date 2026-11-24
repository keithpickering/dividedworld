-- Whole posts (supabase/migrations/0421_whole_posts.sql; docs/plans/2026-11-23-whole-posts-plan.md, Task 2; design sections 2, 3 and 5).
-- 1. The settings: the pool's `turns` has no perDay; the pool holds charsPerDay and readMost; the stored row's rewrite (perDay x 13,000) is a function the migration runs and this file re-runs on rows of its own.
-- 2. The spends: pool_spends, pool_turns and pool_attempts hold `chars`; the three writers take it as their last parameter; pool_chars_today sums the day's three tables and leaves an unpaid attempt out.
-- 3. pool_read: the persona's read of a thread, whole bodies: the opener, the newest `window` posts, the posts named, the persona's own newest posts and the replies to them, and the posts of the thread those quote (one hop); never a hidden post.

create function pg_temp.refused(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'UTC')::date $$;

-- ---- 1. The settings ----
do $$
declare
  good jsonb := '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "common", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 8,
    "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2},
    "sessions": {"perDay": 3, "minutes": {"least": 20, "most": 60}, "waking": {"from": 13, "to": 5}},
    "turns": {"waitHours": 48, "perThread": 2, "perSession": 4}, "charsPerDay": 780000, "readMost": 40000, "chatterCron": "37 17 * * *"}';
  old jsonb;
  said text;
  rewritten jsonb;
begin
  if setting_pool(good) is not null then raise exception 'the whole-posts pool settings are refused: %', setting_pool(good); end if;
  if setting_pool(good || '{"charsPerDay": 0}') is not null or setting_pool(good || '{"charsPerDay": 20000000}') is not null
     or setting_pool(good || '{"readMost": 1000}') is not null or setting_pool(good || '{"readMost": 200000}') is not null then
    raise exception 'a charsPerDay or readMost at its edge is refused';
  end if;
  -- the old turns.perDay is refused, and a missing charsPerDay or readMost
  old := jsonb_set(good, '{turns,perDay}', '60');
  said := setting_pool(old);
  if said is null then raise exception 'a pool with turns.perDay is accepted'; end if;
  if setting_pool(good - 'charsPerDay') is null then raise exception 'a pool with no charsPerDay is accepted'; end if;
  if setting_pool(good - 'readMost') is null then raise exception 'a pool with no readMost is accepted'; end if;
  foreach said in array array['-1', '20000001', '1.5', '"5"', 'null', 'true'] loop
    if setting_pool(good || jsonb_build_object('charsPerDay', said::jsonb)) is null then raise exception 'charsPerDay % is accepted', said; end if;
  end loop;
  foreach said in array array['0', '999', '200001', '1000.5', '"5"', 'null', 'true'] loop
    if setting_pool(good || jsonb_build_object('readMost', said::jsonb)) is null then raise exception 'readMost % is accepted', said; end if;
  end loop;
  if setting_pool(good) is not null or setting_pool(good || '{"extra": 1}') is null then raise exception 'the pool''s fields are not held'; end if;
  -- the shape sentence says so
  said := setting_pool(good - 'charsPerDay');
  if said !~ 'charsPerDay' or said !~ 'readMost' or said ~ 'perDay, from 0 to 500' then raise exception 'the shape sentence does not describe the new pool: %', said; end if;
  -- seed_setting cannot put turns.perDay back: its write is the settings trigger's, which holds setting_pool
  said := pg_temp.refused(format('select seed_setting(%L, %L::jsonb)', 'pool', old::text));
  if said is null or said !~ '^23514' then raise exception 'seed_setting wrote a pool with turns.perDay: %', said; end if;

  -- the stored row's rewrite: perDay 60 is charsPerDay 780,000; readMost 40,000 where absent; perDay gone from turns
  old := good - 'charsPerDay' - 'readMost';
  old := jsonb_set(old, '{turns,perDay}', '60');
  rewritten := pool_rewrite_whole_posts(old);
  if rewritten -> 'charsPerDay' is distinct from '780000'::jsonb then raise exception 'perDay 60 became charsPerDay %', rewritten -> 'charsPerDay'; end if;
  if rewritten -> 'readMost' is distinct from '40000'::jsonb then raise exception 'readMost was set to %', rewritten -> 'readMost'; end if;
  if rewritten -> 'turns' ? 'perDay' then raise exception 'perDay is still in turns'; end if;
  if rewritten -> 'turns' is distinct from '{"waitHours": 48, "perThread": 2, "perSession": 4}'::jsonb then raise exception 'turns changed: %', rewritten -> 'turns'; end if;
  if setting_pool(rewritten) is not null then raise exception 'the rewritten row is refused: %', setting_pool(rewritten); end if;
  if (rewritten - 'turns' - 'charsPerDay' - 'readMost') is distinct from (good - 'turns' - 'charsPerDay' - 'readMost') then raise exception 'the rewrite touched other fields'; end if;
  -- a tuned readMost and a row that is already rewritten stay as they are
  if pool_rewrite_whole_posts(jsonb_set(old, '{readMost}', '1234')) -> 'readMost' is distinct from '1234'::jsonb then raise exception 'a stored readMost was overwritten'; end if;
  if pool_rewrite_whole_posts(good) is distinct from good then raise exception 'a rewritten row was rewritten again'; end if;
  -- no perDay: the draft's 800,000; perDay 500 is 6,500,000
  if pool_rewrite_whole_posts(old #- '{turns,perDay}') -> 'charsPerDay' is distinct from '800000'::jsonb then raise exception 'a row with no perDay did not get 800000'; end if;
  if pool_rewrite_whole_posts(jsonb_set(old, '{turns,perDay}', '500')) -> 'charsPerDay' is distinct from '6500000'::jsonb then raise exception 'perDay 500 did not become 6500000'; end if;
  if pool_rewrite_whole_posts(jsonb_set(old, '{turns,perDay}', '0')) -> 'charsPerDay' is distinct from '0'::jsonb then raise exception 'perDay 0 did not become 0'; end if;
end $$;

-- ---- 2. The spends ----
insert into characters (name, staff, staff_kind, debuted_at) values ('Wp Boss', 'wp-boss', 'persona', now());

do $$
declare
  t uuid := tests.thread('Wp Spends');
  ann uuid := tests.account('wp-ann'); a uuid := tests.character(ann, 'Wp Ann');
  p uuid := (write_staff_act('wp-boss', 'post', t, null, jsonb_build_object('body', 'A boss post.')) ->> 'id')::uuid;
  r1 uuid := tests.act(a, 'post', t, '{"body": "One."}', p);
  r2 uuid := tests.act(a, 'post', t, '{"body": "Two."}', p);
  r3 uuid := tests.act(a, 'post', t, '{"body": "Three."}', p);
  spent uuid := (write_staff_act('wp-boss', 'post', t, null, jsonb_build_object('body', 'The spend''s post.')) ->> 'id')::uuid;
  sid bigint; said text; n integer; d date := pg_temp.today();
  f text;
begin
  -- the old signatures are gone, the new ones are the service role's
  foreach f in array array['record_pool_spend(date,text,text,uuid,uuid,boolean,jsonb)', 'write_staff_turn(text,bigint,uuid,uuid,uuid[],text)', 'record_turn_attempt(text,bigint,uuid,uuid[],text,boolean)'] loop
    if to_regprocedure(f) is not null then raise exception 'the old signature % is still there', f; end if;
  end loop;
  foreach f in array array['record_pool_spend(date,text,text,uuid,uuid,boolean,jsonb,integer)', 'write_staff_turn(text,bigint,uuid,uuid,uuid[],text,integer)',
                           'record_turn_attempt(text,bigint,uuid,uuid[],text,boolean,integer)', 'pool_chars_today(date)', 'pool_turns_today(date)'] loop
    if to_regprocedure(f) is null then raise exception '% is missing', f; end if;
    if has_function_privilege('anon', to_regprocedure(f), 'execute') or has_function_privilege('authenticated', to_regprocedure(f), 'execute')
       or not has_function_privilege('service_role', to_regprocedure(f), 'execute') then
      raise exception '% is not the service role''s alone', f;
    end if;
  end loop;
  -- the columns
  if (select count(*) from information_schema.columns where table_name in ('pool_spends', 'pool_turns', 'pool_attempts') and column_name = 'chars'
        and data_type = 'integer' and is_nullable = 'NO' and column_default = '0') is distinct from 3 then
    raise exception 'chars is not an integer not null default 0 on the three tables';
  end if;

  perform tests.become_service();
  perform write_sessions(d, '[{"staff": "wp-boss", "start": 0, "end": 1440}]');
  sid := (select id from staff_sessions where staff = 'wp-boss' and day = d);
  if pool_chars_today(d) is distinct from 0 then raise exception 'a day with nothing spent counts %', pool_chars_today(d); end if;
  perform record_pool_spend(d, 'wp-boss', 'named', spent, null, false, '{}', 1200);
  perform write_staff_turn('wp-boss', sid, t, r1, array[r1], 'A turn.', 4000);
  perform record_turn_attempt('wp-boss', sid, t, array[r2], 'rejected', true, 300);
  perform record_turn_attempt('wp-boss', sid, t, array[r3], 'failed', false, 999999);
  if (select chars from pool_spends where post_act = spent) is distinct from 1200 then raise exception 'the spend did not keep its chars'; end if;
  if (select chars from pool_turns where thread = t) is distinct from 4000 then raise exception 'the turn did not keep its chars'; end if;
  if (select array_agg(chars order by id) from pool_attempts where thread = t) is distinct from array[300, 999999] then raise exception 'the attempts did not keep their chars'; end if;
  if pool_chars_today(d) is distinct from 1200 + 4000 + 300 then raise exception 'the day counts % characters, not 5500 (an unpaid attempt is left out)', pool_chars_today(d); end if;
  if pool_chars_today(d + 1) is distinct from 0 or pool_chars_today(d - 1) is distinct from 0 then raise exception 'another day counts characters'; end if;
  if pool_turns_today(d) is distinct from 2 then raise exception 'pool_turns_today changed: %', pool_turns_today(d); end if;
  -- chars are never negative
  said := pg_temp.refused(format('select record_pool_spend(%L, %L, %L, %L, null, false, %L, -1)', d + 1, 'wp-boss', 'named', spent, '{}'));
  if said is null or said !~ '^23514' then raise exception 'a negative chars was written: %', said; end if;
  said := pg_temp.refused(format('select record_turn_attempt(%L, %s, %L, array[%L::uuid], %L, true, -5)', 'wp-boss', sid, t, r3, 'failed'));
  if said is null or said !~ '^23514' then raise exception 'a negative attempt chars was written: %', said; end if;
  perform tests.unbecome();
end $$;

-- ---- 3. pool_read ----
do $$
declare
  t uuid := tests.thread('Wp Read');
  ann uuid := tests.account('wp-r-ann'); a uuid := tests.character(ann, 'Wp R Ann');
  bea uuid := tests.account('wp-r-bea'); b uuid := tests.character(bea, 'Wp R Bea');
  boss uuid := (select id from characters where staff = 'wp-boss');
  adm uuid := tests.account('wp-r-admin');
  base timestamptz := now() - interval '1 day';
  ids uuid[] := '{}';
  big text := repeat('x', 19995) || ' END.';
  r jsonb; posts jsonb; seqs integer[]; want integer[]; got integer[]; e jsonb; hidden uuid; named uuid[]; said text; i integer; who uuid; body text;
begin
  insert into admins (account) values (adm);
  -- the persona's posts are written at the times the fixture gives them, as the game's own writer would (staff_writer lets a staff character's Act through)
  perform set_config('kayfabb.staff_writer', 'on', true);
  for i in 1..100 loop
    who := case when i = 5 or i = 95 then boss when i % 2 = 0 then a else b end;
    body := case when i = 20 then format('Twenty, after [quote="%s" user=%s]Post 3.[/quote] done.', ids[3], b)
                 when i = 90 then format('Ninety [quote="%s" user=%s]Twenty, after[/quote] ok [quote="%s" user=%s]Post 70.[/quote]', ids[20], a, ids[70], a)
                 when i = 100 then big
                 else format('Post %s.', i) end;
    ids := ids || tests.act(who, 'post', t, jsonb_build_object('body', body),
      case when i between 6 and 17 then ids[5] end, base + i * interval '1 minute');
  end loop;
  -- post 70 is hidden by an admin (acts_public still lists it, with `hidden` set and no words)
  hidden := ids[70];
  insert into conduct_decisions (version_act, post, admin, outcome) values (hidden, hidden, adm, 'hide');
  named := array[ids[30], hidden];

  perform tests.become_service();
  r := pool_read(t, 'wp-boss', named, 60);
  perform tests.unbecome();
  if r ->> 'title' is distinct from 'Wp Read' then raise exception 'the title is %', r ->> 'title'; end if;
  if (r ->> 'self')::uuid is distinct from boss then raise exception 'self is %, not the persona', r ->> 'self'; end if;
  posts := r -> 'posts';
  select array_agg((p ->> 'seq')::integer order by (p ->> 'seq')::integer) into got from jsonb_array_elements(posts) p;
  -- the opener; the newest 60 (visible: 100 down to 40, without the hidden 70); the named 30; the persona's 5 and 95; the newest 10 replies to 5 (8 to 17); the one post quoted by 90 (20), and not what 20 quotes (3)
  select array_agg(x order by x) into want from (select 1 x union select generate_series(40, 100) except select 70
    union select 30 union select 5 union select generate_series(8, 17) union select 20) w;
  if got is distinct from want then raise exception 'pool_read returned seqs %, not %', got, want; end if;
  if got @> array[3] or got @> array[6] or got @> array[7] or got @> array[39] or got @> array[70] then raise exception 'pool_read returned a post it should not: %', got; end if;
  -- each once, in thread order
  if (select count(distinct p ->> 'act') from jsonb_array_elements(posts) p) is distinct from jsonb_array_length(posts) then raise exception 'a post is returned twice'; end if;
  if (select array_agg(p ->> 'seq' order by ord) from jsonb_array_elements(posts) with ordinality as e(p, ord)) is distinct from (select array_agg(x::text order by x) from unnest(want) x) then
    raise exception 'posts are not in thread order';
  end if;
  -- never the hidden post, by id or by words
  -- (post 90 quotes it: it is in no post's `quotes` and not read through the hop)
  if posts::text ~ hidden::text then raise exception 'the hidden post is named'; end if;
  if posts::text ~ 'Post 70[.]' then raise exception 'the hidden post''s words are returned'; end if;
  -- the fields
  select p into e from jsonb_array_elements(posts) p where (p ->> 'seq')::integer = 100;
  if e ->> 'body' is distinct from big or length(e ->> 'body') <> 20000 then raise exception 'a 20,000 character body was cut to %', length(e ->> 'body'); end if;
  if (e ->> 'act')::uuid is distinct from ids[100] or (e ->> 'author')::uuid is distinct from a or e ->> 'name' <> 'Wp R Ann' or not e ? 'pronouns' or not e ? 'at' or not e ? 'replyTo' or not e ? 'quotes' then
    raise exception 'a post''s fields are wrong: %', e - 'body';
  end if;
  select p into e from jsonb_array_elements(posts) p where (p ->> 'seq')::integer = 90;
  if e -> 'quotes' is distinct from jsonb_build_array(ids[20]) then raise exception 'post 90 quotes %', e -> 'quotes'; end if;
  select p into e from jsonb_array_elements(posts) p where (p ->> 'seq')::integer = 20;
  -- quotes lists the posts of the thread a post quotes, in the read or not (post 3 is not: one hop only)
  if e -> 'quotes' is distinct from jsonb_build_array(ids[3]) then raise exception 'post 20 quotes %', e -> 'quotes'; end if;
  select p into e from jsonb_array_elements(posts) p where (p ->> 'seq')::integer = 12;
  if (e ->> 'replyTo')::uuid is distinct from ids[5] then raise exception 'a reply does not name its target: %', e; end if;
  select p into e from jsonb_array_elements(posts) p where (p ->> 'seq')::integer = 5;
  if e ->> 'replyTo' is not null or (e ->> 'author')::uuid is distinct from boss or e ->> 'body' <> 'Post 5.' then raise exception 'the persona''s post is wrong: %', e; end if;

  -- an unknown persona: self is null, the rest is the window and the named post; a window of 0 is the opener and what is named
  r := pool_read(t, 'nobody', named, 3);
  if r -> 'self' <> 'null'::jsonb then raise exception 'an unknown key has a self: %', r -> 'self'; end if;
  select array_agg((p ->> 'seq')::integer order by (p ->> 'seq')::integer) into got from jsonb_array_elements(r -> 'posts') p;
  if got is distinct from array[1, 30, 98, 99, 100] then raise exception 'an unknown persona, window 3: %', got; end if;
  r := pool_read(t, 'nobody', null, 0);
  select array_agg((p ->> 'seq')::integer order by (p ->> 'seq')::integer) into got from jsonb_array_elements(r -> 'posts') p;
  if got is distinct from array[1] then raise exception 'window 0 and nothing named: %', got; end if;
  -- named is capped at 50
  select array_agg(x) into named from unnest(ids[2:61]) x;
  r := pool_read(t, 'nobody', named, 0);
  if jsonb_array_length(r -> 'posts') <> 51 then raise exception 'named is capped at 50, plus the opener: % posts', jsonb_array_length(r -> 'posts'); end if;
  -- a thread with no posts, and one that is not there
  r := pool_read(tests.thread('Wp Empty'), 'wp-boss', null, 60);
  if r -> 'posts' <> '[]'::jsonb then raise exception 'an empty thread has posts: %', r -> 'posts'; end if;
  r := pool_read(gen_random_uuid(), 'wp-boss', null, 60);
  if r -> 'posts' <> '[]'::jsonb or r ->> 'title' <> '' then raise exception 'a missing thread reads as %', r; end if;

  -- the owner and the grants are pool_thread's
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = to_regprocedure('pool_read(uuid,text,uuid[],integer)')) is distinct from 'kayfabb_digest'
     or (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = to_regprocedure('pool_thread(uuid,integer,integer,uuid,uuid[])')) is distinct from 'kayfabb_digest' then
    raise exception 'pool_read is not owned by kayfabb_digest';
  end if;
  if not (select p.prosecdef and p.provolatile = 's' and 'search_path=public, pg_temp' = any (p.proconfig) from pg_proc p where p.oid = to_regprocedure('pool_read(uuid,text,uuid[],integer)')) then
    raise exception 'pool_read is not stable security definer with a pinned search_path';
  end if;
  if has_function_privilege('anon', to_regprocedure('pool_read(uuid,text,uuid[],integer)'), 'execute') or has_function_privilege('authenticated', to_regprocedure('pool_read(uuid,text,uuid[],integer)'), 'execute')
     or not has_function_privilege('service_role', to_regprocedure('pool_read(uuid,text,uuid[],integer)'), 'execute') then
    raise exception 'pool_read is not the service role''s alone';
  end if;
  perform tests.become(ann);
  said := pg_temp.refused(format('select pool_read(%L, %L, null, 60)', t, 'wp-boss'));
  perform tests.unbecome();
  if said is null or said !~ '^42501' then raise exception 'a player called pool_read: %', said; end if;
end $$;

-- ---- 3b. pool_read: an edited post's quotes, a veiled author, and the caps ----
do $$
declare
  a uuid := tests.character(tests.account('wp-c-ann'), 'Wp C Ann');
  b uuid := tests.character(tests.account('wp-c-bea'), 'Wp C Bea');
  boss uuid := (select id from characters where staff = 'wp-boss');
  stand uuid;
  base timestamptz := now() - interval '1 day';
  t uuid; ids uuid[]; r jsonb; got integer[]; e jsonb; i integer; qs text; edited uuid; veiled uuid; play uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);

  -- An edit is an Act of its own and its quotes hang on its id: a post edited to drop one quote and add another is read by its edited body.
  t := tests.thread('Wp Edit');
  ids := array[tests.post(b, t, 'Opener.', base), tests.post(a, t, 'Q one.', base + interval '1 minute'), tests.post(a, t, 'Q two.', base + interval '2 minutes')];
  ids := ids || tests.post(b, t, format('Edited [quote="%s" user=%s]Q one.[/quote] soon', ids[2], a), base + interval '3 minutes');
  perform tests.act(b, 'edit', t, jsonb_build_object('body', format('Edited [quote="%s" user=%s]Q two.[/quote] now', ids[3], a)), ids[4], base + interval '4 minutes');
  r := pool_read(t, 'nobody', null, 1);
  select p into e from jsonb_array_elements(r -> 'posts') p where (p ->> 'act')::uuid = ids[4];
  if e -> 'quotes' is distinct from jsonb_build_array(ids[3]) then raise exception 'an edited post''s quotes are %, not the edited body''s', e -> 'quotes'; end if;
  select array_agg((p ->> 'seq')::integer order by (p ->> 'seq')::integer) into got from jsonb_array_elements(r -> 'posts') p;
  if got is distinct from array[1, 3, 4] then raise exception 'the hop does not follow the edit: %', got; end if;

  -- A veiled post's author and name are the stand-in's, as acts_public answers them.
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack) values ('wpveil', 'Wp Veil', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1);
  select c.id into stand from characters c where c.staff_kind = 'anonymous';
  if stand is null then
    insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning id into stand;
    insert into character_profiles (character, title, signature) values (stand, 'Could be anyone.', '');
  end if;
  veiled := tests.post(a, t, 'A veiled post.', base + interval '5 minutes');
  play := tests.act(b, 'card', t, jsonb_build_object('card', 'wpveil', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() + interval '1 day'), veiled, base + interval '6 minutes');
  insert into post_veils (play, post, veil, author, ends_at) values (play, veiled, 'author', a, now() + interval '1 day');
  r := pool_read(t, 'nobody', array[veiled], 0);
  select p into e from jsonb_array_elements(r -> 'posts') p where (p ->> 'act')::uuid = veiled;
  if e is null or (e ->> 'author')::uuid is distinct from stand or e ->> 'name' is distinct from 'Anonymous' then raise exception 'a veiled post reads as %', e - 'body'; end if;

  -- The persona's newest 20 posts, and the newest 10 replies to the newest of them (window 0: nothing else is read).
  t := tests.thread('Wp Caps');
  ids := array[tests.post(b, t, 'Opener.', base)];
  for i in 1..25 loop ids := ids || tests.act(boss, 'post', t, jsonb_build_object('body', 'Persona ' || i), null, base + i * interval '1 minute'); end loop;
  for i in 1..12 loop ids := ids || tests.act(a, 'post', t, jsonb_build_object('body', 'Reply ' || i), ids[26], base + (30 + i) * interval '1 minute'); end loop;
  r := pool_read(t, 'wp-boss', null, 0);
  if jsonb_array_length(r -> 'posts') is distinct from 1 + 20 + 10 then raise exception 'a persona read holds % posts, not 31', jsonb_array_length(r -> 'posts'); end if;
  if exists (select 1 from jsonb_array_elements(r -> 'posts') p where p ->> 'body' in ('Persona 5', 'Reply 1', 'Reply 2')) then
    raise exception 'the 20-post or the 10-reply cap is not the newest';
  end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'posts') p where p ->> 'body' = 'Persona 6') or not exists (select 1 from jsonb_array_elements(r -> 'posts') p where p ->> 'body' = 'Reply 3') then
    raise exception 'the capped reads are missing their newest';
  end if;

  -- A post quoting twelve: its quotes and the hop are the newest ten, newest first.
  t := tests.thread('Wp Quotes');
  ids := array[tests.post(b, t, 'Opener.', base)];
  for i in 1..12 loop ids := ids || tests.post(a, t, 'Quoted ' || i || '.', base + i * interval '1 minute'); end loop;
  qs := '';
  for i in 2..13 loop qs := qs || format('[quote="%s" user=%s]Quoted %s.[/quote] ', ids[i], a, i - 1); end loop;
  ids := ids || tests.post(b, t, qs, base + interval '20 minutes');
  r := pool_read(t, 'nobody', null, 1);
  select p into e from jsonb_array_elements(r -> 'posts') p where (p ->> 'act')::uuid = ids[14];
  if jsonb_array_length(e -> 'quotes') is distinct from 10 or e -> 'quotes' -> 0 is distinct from to_jsonb(ids[13]) or e -> 'quotes' -> 9 is distinct from to_jsonb(ids[4]) then
    raise exception 'the quotes are not the newest ten, newest first: %', e -> 'quotes';
  end if;
  if jsonb_array_length(r -> 'posts') is distinct from 12 then raise exception 'the hop adds % posts, not ten', jsonb_array_length(r -> 'posts') - 2; end if;
end $$;

-- ---- 3c. pool_read: the window is clamped to 200, and a post whose latest edit is hidden is left out ----
do $$
declare
  a uuid := tests.character(tests.account('wp-d-ann'), 'Wp D Ann');
  adm uuid := tests.account('wp-d-admin');
  base timestamptz := now() - interval '1 day';
  t uuid := tests.thread('Wp Window'); i integer; p uuid; ed uuid; r jsonb;
begin
  insert into admins (account) values (adm);
  for i in 1..250 loop perform tests.post(a, t, 'Post ' || i, base + i * interval '1 minute'); end loop;
  r := pool_read(t, 'nobody', null, 1000);
  if jsonb_array_length(r -> 'posts') is distinct from 201 then raise exception 'a window of 1000 reads % posts, not 200 and the opener', jsonb_array_length(r -> 'posts'); end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'posts') x where x ->> 'body' = 'Post 250') or exists (select 1 from jsonb_array_elements(r -> 'posts') x where x ->> 'body' = 'Post 50') then
    raise exception 'the clamped window is not the newest 200';
  end if;
  r := pool_read(t, 'nobody', null, -5);
  if jsonb_array_length(r -> 'posts') is distinct from 1 then raise exception 'a negative window reads % posts', jsonb_array_length(r -> 'posts'); end if;

  p := tests.post(a, t, 'Soon to be hidden.', base + interval '300 minutes');
  ed := tests.act(a, 'edit', t, '{"body": "An edit an admin hides."}', p, base + interval '301 minutes');
  if not exists (select 1 from jsonb_array_elements(pool_read(t, 'nobody', array[p], 0) -> 'posts') x where (x ->> 'act')::uuid = p) then raise exception 'the edited post is not read before the hide'; end if;
  insert into conduct_decisions (version_act, post, admin, outcome) values (ed, p, adm, 'hide');
  if exists (select 1 from jsonb_array_elements(pool_read(t, 'nobody', array[p], 5) -> 'posts') x where (x ->> 'act')::uuid = p or x ->> 'body' like '%an admin hides%') then
    raise exception 'a post whose latest edit is hidden is read';
  end if;
end $$;

-- ---- 3d. pool_read is bounded by constants, not by the thread's length ----
-- The Acts it reads (index and heap tuples of `acts`, which acts_public is built from) are the same for a thread of 1,000 posts and one of 4,000 with the same last hundred: the view is evaluated for the seeds, never for the whole thread.
create function pg_temp.acts_read() returns bigint language sql as $$
  select coalesce(sum(seq_tup_read + idx_tup_fetch), 0)::bigint from pg_stat_xact_all_tables where relname = 'acts'
$$;
create function pg_temp.long_thread(n integer) returns uuid language plpgsql as $$
declare
  a uuid := (select id from characters where name = 'Wp Len Ann');
  b uuid := (select id from characters where name = 'Wp Len Bea');
  boss uuid := (select id from characters where staff = 'wp-boss');
  t uuid := tests.thread('Wp Long ' || n);
  base timestamptz := now() - interval '2 days';
  ids uuid[] := '{}'; i integer;
begin
  for i in 1..n loop
    ids := ids || tests.act(case when i % 10 = 0 then boss when i % 2 = 0 then a else b end, 'post', t, jsonb_build_object('body', 'Long post ' || i),
                            case when i > n - 90 and i % 10 = 5 then ids[i - 5] end, base + i * interval '1 second');
  end loop;
  -- The persona posts all through the thread (every tenth: 100 and 400 posts), and one of its newest posts has 300 replies.
  for i in 1..300 loop
    perform tests.act(case when i % 2 = 0 then a else b end, 'post', t, jsonb_build_object('body', 'Late reply ' || i), ids[n - 80], base + (n + i) * interval '1 second');
  end loop;
  return t;
end $$;
do $$
declare
  small uuid; big uuid; c0 bigint; c_small bigint; c_big bigint; r_small jsonb; r_big jsonb;
begin
  perform tests.character(tests.account('wp-len-ann'), 'Wp Len Ann');
  perform tests.character(tests.account('wp-len-bea'), 'Wp Len Bea');
  perform set_config('kayfabb.staff_writer', 'on', true);
  small := pg_temp.long_thread(1000);
  big := pg_temp.long_thread(4000);
  analyze acts;
  perform set_config('track_functions', 'all', true);
  c0 := pg_temp.acts_read(); r_small := pool_read(small, 'wp-boss', null, 60); c_small := pg_temp.acts_read() - c0;
  c0 := pg_temp.acts_read(); r_big := pool_read(big, 'wp-boss', null, 60); c_big := pg_temp.acts_read() - c0;
  perform set_config('track_functions', 'none', true);
  if jsonb_array_length(r_small -> 'posts') is distinct from jsonb_array_length(r_big -> 'posts') or jsonb_array_length(r_big -> 'posts') < 60 then
    raise exception 'the two reads are not alike: % and % posts', jsonb_array_length(r_small -> 'posts'), jsonb_array_length(r_big -> 'posts');
  end if;
  if c_big > c_small + 20 then raise exception 'pool_read reads % rows of acts in a 4,000-post thread and % in a 1,000-post one: it grows with the thread', c_big, c_small; end if;
end $$;
