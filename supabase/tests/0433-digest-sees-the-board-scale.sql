-- What the digest's new reads cost at a busy instance's scale (supabase/migrations/0433_digest_sees_the_board.sql; docs/plans/2026-11-25-digest-sees-the-board-plan.md, Task 2, "A busy week"; as 0410-post-plays-scale.sql is for the plays on a post).
--
-- The guarantee: the four helpers system_digest reads the Acts through read the rows of the span and the window, by an index ordered by time for their kind, and nothing outside it. The fixture is a week of a busy instance (until the 8th at noon, a window of
-- the last day, the standouts' span of seven days): 60 posts and 6,000 replies, 2,400 plays (a third of them in the window), 30 polls open in the window with 120 voters each (3,600 ballots), 20 spun threads, and 300 older threads, 8,000 older posts
-- and 3,000 older plays, ballots and polls outside the span. It is written with the triggers off for this transaction (the runner rolls it back); the kept tables are filled as the migrations' triggers fill them, and analyzed.
--  1. digest_standouts reads rows of `acts` at most 2 x (plays + springs of the span) + ballots + 3 x polls + 3 x spun + 20: the plays once from the index and once for the target post, the ballots once, a probe of each poll voted on (not of each
--     voter), one of each spin's origin. Not one older Act, one reply post.
--  2. digest_polls is planned over acts_digest_polls_at and reads at most 6 x (the polls created in the 14 days and the window) + 20 rows of `acts`; digest_spins at most 2 x its spins + 20 rows of `threads` and `acts`; digest_plays at most 5 x its cap + 10 rows of `acts`, and rows of
--     play_post that are those played in the window (less than a third of the table) and no more, and is planned over play_post_digest_at.
--  3. system_digest reads as many rows of `acts` with 10,000 more Acts outside the span (older posts, plays and ballots) as it did without them, to within 2%, and no more than 1.5 x the Acts created in the span (about 12,000: each Act of the
--     span once and half again; the standouts alone are held to 2 x the plays + the ballots + a few hundred, the window's posts, polls, plays and persona turns to what is left). The fixture holds 70 turns of a persona (210 answered replies), which the
--     exchanges' standouts and the conversations read through acts_public: a read of it that hashes the view whole (as the first so_x did: 36,000 rows) goes over both.
--  4. The poison: with acts_digest_plays_at dropped (and again with acts_digest_ballots_at dropped) digest_standouts goes over its bound (it reads the span's replies); with every one of the five indexes dropped the whole digest reads more than the bound of 3; with acts_digest_polls_at dropped digest_polls is no longer planned over it (read from the plan: the entries it walks are not row counts); with play_post_digest_at dropped digest_plays is no longer planned over it (read from the plan, as the polls' are); with
--     threads_digest_spun dropped digest_spins reads every thread.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if ok is not true then raise exception '%', what; end if; end $$;

create function pg_temp.rows_read(rel text) returns bigint language sql as $$
  select coalesce(sum(seq_tup_read + idx_tup_fetch), 0)::bigint from pg_stat_xact_all_tables where relname = rel
$$;

-- Whether the statement of a helper, lifted from its own definition with its arguments given (the window of the last day, a cap of 5), is planned over the index `idx`. The rows it fetches are the polls and plays of the window either way, and
-- what an index ordered by time saves is the entries it need not walk (the row counters count no entry a filter inside an index skips), so these two are read from the plan.
create function pg_temp.plan_uses(fn regprocedure, idx text) returns boolean language plpgsql as $$
declare def text := pg_get_functiondef(fn); nm text := (select proname from pg_proc where oid = fn); stmt text; plan jsonb;
begin
  stmt := coalesce(substring(def from '(?s)return query\s*(select .*?);\s*end \$[a-z]*\$'), substring(def from '(?s)AS \$[a-z]*\$\s*(select .*?)\s*\$[a-z]*\$'));
  stmt := replace(replace(replace(replace(stmt, nm || '.since', '''2050-01-07T12:00:00Z''::timestamptz'), nm || '.until', '''2050-01-08T12:00:00Z''::timestamptz'), nm || '.most', '5'), 'lasts', 'interval ''14 days''');
  perform set_config('enable_seqscan', 'off', true); perform set_config('enable_bitmapscan', 'off', true);
  execute 'explain (format json) ' || stmt into plan;
  return exists (select 1 from jsonb_path_query(plan, '$.**') n where jsonb_typeof(n) = 'object' and n ->> 'Index Name' = idx);
end $$;

create temp table sc (k text primary key, v bigint);
grant all on sc to public;

-- The rows of `rel` a statement reads: the difference of the transaction's counters around it.
create function pg_temp.reads(rel text, stmt text) returns bigint language plpgsql as $$
declare before bigint := pg_temp.rows_read(rel);
begin
  execute stmt;
  return pg_temp.rows_read(rel) - before;
end $$;

do $$
declare
  until_at timestamptz := '2050-01-08T12:00:00Z'; since_at timestamptz := '2050-01-07T12:00:00Z'; span_at timestamptz := '2050-01-01T12:00:00Z';
  owners uuid[]; chars uuid[]; t uuid := tests.thread('Dsc busy'); told uuid := tests.thread('Dsc old'); posts uuid[]; po uuid; th uuid; i integer;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, stack)
  select 'dsk' || g, 'Dsc Kind ' || g, 'sweet', 'common', 'cast', null, '{post}', null, 8 from generate_series(1, 4) g;
  alter table acts disable trigger user; alter table threads disable trigger user;
  owners := array(select tests.account('dsc-owner-' || g) from generate_series(1, 40) g);
  insert into characters (owner, name, created_at, debuted_at) select owners[g % 40 + 1], 'Dsc ' || lpad(g::text, 3, '0'), '2000-01-02', '2000-01-02' from generate_series(1, 200) g;
  chars := array(select id from characters where name like 'Dsc %' order by name);
  -- the week: 60 posts (the first 30 carry a poll) and 6,000 replies in it
  insert into acts (character, kind, thread, payload, seq, created_at)
  select chars[g % 200 + 1], 'post', t, jsonb_build_object('body', 'Post ' || g), 1000 + g, span_at + g * interval '2 hours' from generate_series(1, 60) g;
  posts := array(select id from acts where thread = t and kind = 'post' and seq between 1001 and 1060 order by seq);
  insert into acts (character, kind, thread, payload, seq, created_at)
  select chars[g % 200 + 1], 'post', t, jsonb_build_object('body', 'Reply ' || g), 2000 + g, span_at + (g % 10080) * interval '1 minute' from generate_series(1, 6000) g;
  -- 2,400 plays on the 60 posts (40 each), spread over the week, so about a third are in the window and the rest in the span
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select chars[(g * 7 + n) % 200 + 1], 'card', t, posts[n], jsonb_build_object('card', 'dsk' || (g % 4 + 1), 'message', '', 'config', '{}'::jsonb, 'layer', g), span_at + ((g * 311 + n * 97) % 10080) * interval '1 minute'
  from generate_series(1, 60) n cross join generate_series(1, 40) g;
  -- 30 polls open in the window with 120 voters each; every third is secret
  for i in 1..30 loop
    insert into acts (character, kind, thread, target_act_id, payload, created_at)
    values (chars[i], 'poll', t, posts[i], jsonb_build_object('question', 'Q' || i, 'options', '["a", "b"]'::jsonb, 'pick', 1, 'secret', i % 3 = 0, 'closes_at', until_at + interval '1 day'), since_at - interval '2 hours' + i * interval '1 minute')
    returning id into po;
    insert into acts (character, kind, thread, target_act_id, payload, created_at)
    select chars[v + 1], 'ballot', t, po, '{"picks": [0]}', since_at + v * interval '1 minute' from generate_series(1, 120) v;
    insert into poll_latest_ballots (poll, "character", act, picks, created_at)
    select po, b."character", b.id, b.payload -> 'picks', b.created_at from acts b where b.kind = 'ballot' and b.target_act_id = po;
  end loop;
  -- 20 spun threads in the window and the span
  for i in 1..20 loop
    insert into threads (board, title, origin_act_id, origin_board, created_at, replies) select b.id, 'Dsc spin ' || i, posts[i], b.id, since_at + i * interval '10 minutes', i % 4 from boards b where b.slug = 'general' returning id into th;
    insert into acts (character, kind, thread, target_act_id, payload, seq, created_at) values (chars[i], 'spin', th, posts[i], '{"title": "x", "body": "y"}', 1, since_at + i * interval '10 minutes');
  end loop;
  -- what is older than the span: 8,000 posts, 3,000 plays and 3,000 ballots on an old poll, 300 threads
  insert into acts (character, kind, thread, payload, seq, created_at)
  select chars[g % 200 + 1], 'post', told, jsonb_build_object('body', 'Old ' || g), 100000 + g, until_at - interval '100 days' + g * interval '1 minute' from generate_series(1, 8000) g;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select chars[g % 200 + 1], 'card', told, (select id from acts where thread = told and seq = 100001), jsonb_build_object('card', 'dsk1', 'message', '', 'config', '{}'::jsonb, 'layer', g), until_at - interval '90 days' + g * interval '1 minute' from generate_series(1, 3000) g;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (chars[1], 'poll', told, (select id from acts where thread = told and seq = 100002), jsonb_build_object('question', 'Old', 'options', '["a", "b"]'::jsonb, 'pick', 1, 'secret', false, 'closes_at', until_at - interval '80 days'), until_at - interval '81 days')
  returning id into po;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select chars[g % 200 + 1], 'ballot', told, po, '{"picks": [0]}', until_at - interval '81 days' + g * interval '1 second' from generate_series(1, 3000) g;
  -- and 3,000 older polls (a busy instance's history), which a read of every poll would find
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select chars[g % 200 + 1], 'poll', told, (select id from acts where thread = told and seq = 100003 + g % 100), jsonb_build_object('question', 'Older', 'options', '["a", "b"]'::jsonb, 'pick', 1, 'secret', false, 'closes_at', until_at - interval '80 days'), until_at - interval '85 days' + g * interval '1 minute' from generate_series(1, 3000) g;
  insert into threads (board, title, origin_act_id, origin_board, created_at) select b.id, 'Dsc old spin ' || g, posts[1 + g % 60], b.id, until_at - interval '60 days' + g * interval '1 minute' from boards b cross join generate_series(1, 300) g where b.slug = 'general';
  -- 70 turns of a persona in the week (one every two hours, each answering three of the week's replies, the first quoted): the exchanges' standouts and the conversations read them
  insert into characters (name, staff, staff_kind, debuted_at) values ('Dsc Mod', 'dsc-mod', 'persona', '2000-01-02');
  insert into staff_sessions (day, staff, starts_at, ends_at) select (span_at + g * interval '1 day')::date, 'dsc-mod', (span_at + g * interval '1 day')::date, (span_at + g * interval '1 day')::date + 1 from generate_series(-1, 7) g;
  insert into acts (character, kind, thread, payload, seq, created_at)
  select (select id from characters where staff = 'dsc-mod'), 'post', t, jsonb_build_object('body', 'Turn ' || g), 20000 + g, span_at + g * interval '2 hours' from generate_series(1, 70) g;
  insert into pool_turns (day, staff, session, thread, post_act, quoting, at)
  select (p.created_at at time zone 'UTC')::date, 'dsc-mod', (select s.id from staff_sessions s where s.day = (p.created_at at time zone 'UTC')::date and s.staff = 'dsc-mod'), t, p.id,
         (select r.id from acts r where r.thread = t and r.seq = 2000 + 3 * (p.seq - 20000)), p.created_at
  from acts p where p.thread = t and p.seq between 20001 and 20070;
  insert into pool_answered (reply, turn)
  select r.id, pt.id from pool_turns pt join acts p on p.id = pt.post_act cross join generate_series(0, 2) k join acts r on r.thread = t and r.seq = 2000 + 3 * (p.seq - 20000) + k;
  alter table acts enable trigger user; alter table threads enable trigger user;
  update threads x set next_seq = coalesce((select max(a.seq) from acts a where a.thread = x.id), 0) + 1 where x.id in (t, told);
  insert into play_post select r.* from acts x cross join lateral play_row(x.id) r where x.kind in ('card', 'set') and x.target_act_id is not null and x.thread in (t, told);
  update play_post set drawn = (extract(epoch from played_at)::bigint % 29)::integer where post = any (posts);
  analyze acts; analyze play_post; analyze threads; analyze poll_latest_ballots; analyze pool_turns; analyze pool_answered; analyze characters;
  insert into settings (key, value) values ('digestExcerptChars', '30'), ('digestExcerpts', '8'), ('digestThreads', '5'), ('digestConversations', '6'),
    ('digestPolls', '5'), ('digestSpins', '5'), ('digestPlays', '5'), ('digestStandoutDays', '7') on conflict (key) do update set value = excluded.value;
  insert into sc values ('cards', (select count(*) from acts where kind = 'card' and created_at >= span_at and created_at < until_at)),
                        ('ballots', (select count(*) from acts where kind = 'ballot' and created_at >= span_at and created_at < until_at)),
                        ('polls_all', (select count(*) from acts where kind = 'poll' and created_at >= until_at - interval '16 days')),
                        ('plays_window', (select count(*) from play_post where played_at >= since_at and played_at < until_at)),
                        ('play_post', (select count(*) from play_post)), ('threads', (select count(*) from threads));
  if (select v from sc where k = 'cards') < 2400 or (select v from sc where k = 'ballots') < 3600 then raise exception 'the fixture is not a busy week'; end if;
end $$;

-- 3. the whole digest reads no more with 10,000 more Acts outside the span
do $$
declare
  until_at timestamptz := '2050-01-08T12:00:00Z'; since_at timestamptz := '2050-01-07T12:00:00Z';
  told uuid := (select id from threads where title = 'Dsc old'); chars uuid[] := array(select id from characters where name like 'Dsc %' order by name);
  n1 bigint; n2 bigint; d jsonb; old_post uuid := (select id from acts where thread = told and seq = 100001);
  span_acts bigint := (select count(*) from acts where created_at >= since_at - interval '6 days' and created_at < until_at);
begin
  perform tests.become_service();
  perform system_digest(since_at, until_at);
  n1 := pg_temp.reads('acts', format('select system_digest(%L, %L)', since_at, until_at));
  d := system_digest(since_at, until_at);
  perform tests.unbecome();
  perform pg_temp.expect(jsonb_array_length(d -> 'polls') = 5 and jsonb_array_length(d -> 'spins') = 5 and jsonb_array_length(d -> 'plays') = 5 and jsonb_array_length(d -> 'standouts' -> 'cards') = 3, '3 the digest of the busy week is not full: ' || left(d::text, 300));
  alter table acts disable trigger user;
  insert into acts (character, kind, thread, payload, seq, created_at)
  select chars[g % 200 + 1], 'post', told, jsonb_build_object('body', 'Older ' || g), 300000 + g, until_at - interval '120 days' + g * interval '1 minute' from generate_series(1, 4000) g;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select chars[g % 200 + 1], 'card', told, old_post, jsonb_build_object('card', 'dsk1', 'message', '', 'config', '{}'::jsonb, 'layer', 10000 + g), until_at - interval '110 days' + g * interval '1 minute' from generate_series(1, 3000) g;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select chars[g % 200 + 1], 'ballot', told, (select id from acts where kind = 'poll' and thread = told limit 1), '{"picks": [0]}', until_at - interval '100 days' + g * interval '1 second' from generate_series(1, 3000) g;
  alter table acts enable trigger user;
  analyze acts;
  perform tests.become_service();
  n2 := pg_temp.reads('acts', format('select system_digest(%L, %L)', since_at, until_at));
  perform tests.unbecome();
  raise notice '3 system_digest read % rows of acts, and % with 10,000 more Acts outside the span', n1, n2;
  perform pg_temp.expect(n1 <= 1.5 * span_acts, '3 system_digest read ' || n1 || ' rows of acts, over 1.5 x the ' || span_acts || ' Acts of the span');
  insert into sc values ('whole_bound', (1.5 * span_acts)::bigint);
  raise notice '3 the bound: % rows of acts (1.5 x the % Acts of the span)', (1.5 * span_acts)::bigint, span_acts;
  perform pg_temp.expect(abs(n2 - n1) <= n1 * 0.02, '3 system_digest read ' || n1 || ' rows of acts, then ' || n2 || ' with 10,000 more Acts outside the span');
end $$;

do $$
declare
  until_at timestamptz := '2050-01-08T12:00:00Z'; since_at timestamptz := '2050-01-07T12:00:00Z'; span_at timestamptz := '2050-01-01T12:00:00Z';
  cards bigint := (select v from sc where k = 'cards'); ballots bigint := (select v from sc where k = 'ballots'); polls_all bigint := (select v from sc where k = 'polls_all');
  n bigint; bound bigint; n2 bigint; pp bigint; w bigint; before bigint; after bigint; idef text;
begin
  -- 1. digest_standouts
  bound := 2 * cards + ballots + 3 * 31 + 3 * 20 + 20; -- a spin: its origin Act, digest_origin's read of it and the spring probe for a set
  n := pg_temp.reads('acts', format('select * from digest_standouts(%L, %L)', span_at, until_at));
  raise notice '1 digest_standouts read % rows of acts (bound %) in a week of % plays and % ballots, with 14,000 older Acts and 6,000 replies about', n, bound, cards, ballots;
  perform pg_temp.expect(n <= bound, '1 digest_standouts read ' || n || ' rows of acts, over ' || bound);
  perform pg_temp.expect((select max(c) from (select count(*) c from digest_standouts(span_at, until_at) group by category) z) = 3, '1 the standouts are not top threes');
  -- 2. the other three
  bound := 6 * polls_all + 20;
  n := pg_temp.reads('acts', format('select * from digest_polls(%L, %L)', since_at, until_at));
  raise notice '2 digest_polls read % rows of acts (bound %)', n, bound;
  perform pg_temp.expect(n <= bound, '2 digest_polls read ' || n || ' rows of acts, over ' || bound);
  perform pg_temp.expect(pg_temp.plan_uses('digest_polls(timestamptz, timestamptz)'::regprocedure, 'acts_digest_polls_at'), '2 digest_polls is not planned over acts_digest_polls_at');
  perform pg_temp.expect((select count(*) from digest_polls(since_at, until_at)) = 30, '2 digest_polls did not find the 30 open polls: ' || (select count(*) from digest_polls(since_at, until_at)));
  n := pg_temp.reads('acts', format('select * from digest_spins(%L, %L, 5)', since_at, until_at)); n2 := pg_temp.reads('threads', format('select * from digest_spins(%L, %L, 5)', since_at, until_at));
  raise notice '2 digest_spins read % rows of acts and % of threads', n, n2;
  perform pg_temp.expect(n <= 2 * 20 + 20 and n2 <= 2 * 20 + 20, '2 digest_spins read ' || n || ' and ' || n2);
  perform pg_temp.expect(pg_temp.plan_uses('digest_spins(timestamptz, timestamptz, integer)'::regprocedure, 'threads_digest_spun'), '2 digest_spins is not planned over threads_digest_spun');
  n := pg_temp.reads('acts', format('select * from digest_plays(%L, %L, 5)', since_at, until_at)); pp := pg_temp.reads('play_post', format('select * from digest_plays(%L, %L, 5)', since_at, until_at));
  w := (select v from sc where k = 'plays_window');
  raise notice '2 digest_plays read % rows of acts and % of play_post (the window holds %, the table %)', n, pp, w, (select v from sc where k = 'play_post');
  perform pg_temp.expect(n <= 5 * 5 + 10 and pp <= w and pp * 3 < (select v from sc where k = 'play_post'), '2 digest_plays read ' || n || ' rows of acts and ' || pp || ' of play_post');
  perform pg_temp.expect((select count(*) from digest_plays(since_at, until_at, 5)) = 5, '2 digest_plays did not fill its cap');
  perform pg_temp.expect(pg_temp.plan_uses('digest_plays(timestamptz, timestamptz, integer)'::regprocedure, 'play_post_digest_at'), '2 digest_plays is not planned over play_post_digest_at');

  -- 4. the poison, first: each index withheld in turn sends its read over its bound (the drops are this transaction's own)
  idef := pg_get_indexdef('acts_digest_plays_at'::regclass);
  drop index acts_digest_plays_at;
  n := pg_temp.reads('acts', format('select * from digest_standouts(%L, %L)', span_at, until_at));
  raise notice '4 digest_standouts without acts_digest_plays_at read % rows of acts', n;
  perform pg_temp.expect(n > 2 * cards + ballots + 3 * 31 + 3 * 20 + 20, '4 the bound of 1 does not go red without acts_digest_plays_at: ' || n);
  execute idef;
  drop index acts_digest_ballots_at;
  n := pg_temp.reads('acts', format('select * from digest_standouts(%L, %L)', span_at, until_at));
  raise notice '4 digest_standouts without acts_digest_ballots_at read % rows of acts', n;
  perform pg_temp.expect(n > 2 * cards + ballots + 3 * 31 + 3 * 20 + 20, '4 the bound of 1 does not go red without acts_digest_ballots_at: ' || n);
  drop index acts_digest_polls_at;
  raise notice '4 digest_polls without acts_digest_polls_at is planned over it: %', pg_temp.plan_uses('digest_polls(timestamptz, timestamptz)'::regprocedure, 'acts_digest_polls_at');
  perform pg_temp.expect(not pg_temp.plan_uses('digest_polls(timestamptz, timestamptz)'::regprocedure, 'acts_digest_polls_at'), '4 the plan check of 2 does not go red without acts_digest_polls_at');
  drop index play_post_digest_at;
  raise notice '4 digest_plays without play_post_digest_at is planned over it: %', pg_temp.plan_uses('digest_plays(timestamptz, timestamptz, integer)'::regprocedure, 'play_post_digest_at');
  perform pg_temp.expect(not pg_temp.plan_uses('digest_plays(timestamptz, timestamptz, integer)'::regprocedure, 'play_post_digest_at'), '4 the plan check of 2 does not go red without play_post_digest_at');
  drop index threads_digest_spun;
  raise notice '4 digest_spins without threads_digest_spun is planned over it: %', pg_temp.plan_uses('digest_spins(timestamptz, timestamptz, integer)'::regprocedure, 'threads_digest_spun');
  perform pg_temp.expect(not pg_temp.plan_uses('digest_spins(timestamptz, timestamptz, integer)'::regprocedure, 'threads_digest_spun'), '4 the plan check of 2 does not go red without threads_digest_spun');
  -- every one of the five is dropped now: the whole digest reads more than the bound of 3
  perform tests.become_service();
  n := pg_temp.reads('acts', format('select system_digest(%L, %L)', since_at, until_at));
  perform tests.unbecome();
  raise notice '4 system_digest without the five indexes read % rows of acts (the bound of 3 is %)', n, (select v from sc where k = 'whole_bound');
  perform pg_temp.expect(n > (select v from sc where k = 'whole_bound'), '4 the bound of 3 does not go red without the indexes: ' || n);
end $$;
