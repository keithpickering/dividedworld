-- pool_read reads by key, never by a plan (supabase/migrations/0425_pool_read_bounded.sql).
-- 0421's pool_read took a plan that read every post of the thread once for each seed whenever the statistics on `acts` said the table was small (a new or restored instance, a big import before autovacuum has run),
-- and 0421's own test, which analyzes `acts` first, failed on it in CI on some runs (`pool_read reads 1585819 rows of acts in a 4,000-post thread and 1584919 in a 1,000-post one`). A passing run proved the planner's luck.
-- 1. the states the planner can be left in: statistics on `acts` that say it is empty (the forged state of a table never vacuumed with rows in it, set here in the transaction), the same with plans made generic for every call,
--    and true statistics. Under each, pool_read reads the same number of rows of `acts` (index and heap tuples; seq_tup_read counts a scan's every row) for a thread of 1,000 posts and one of 4,000, below a fixed bound,
--    with posts that quote each other in both (the hop and each post's `quotes`).
-- 2. the test can fail: 0421's pool_read, kept here as a copy, reads more than that bound under the empty statistics, and returns the same posts where it does.
-- 3. the same security: the owner, the service role's only, the helpers with no caller.

-- 0426 added keys to pool_read (an origin, and each post's poll, plays, reactions and rewoundTo); 0421's read, kept below, has none, so the comparisons strip them.
-- What the files before this one leave committed (0434_reads_bounded_on_any_plan.sql), planted first so that every run measures in it: a few live author veils and card_end Acts elsewhere in the instance, analyzed before this
-- file's own rows are written, as the earlier files' rows are by the suite's vacuum. With them, each probe of an Act through acts_public was a hashed read of every veil and card_end (CI on main at 7d8a255: `pool_read reads 1924 rows of acts in a 4,000-post thread`).
-- The fixtures here write thousands of Acts one statement at a time; 0455's trigger would add two projections (a few ms) to each, and these files measure other costs (the file is rolled back).
alter table acts disable trigger acts_live_lists;

select tests.plant_live_veils(8, 10) is not null;

create function pg_temp.strip(r jsonb) returns jsonb language sql as $$
  select (r - 'origin') || jsonb_build_object('posts', (select coalesce(jsonb_agg(x - 'poll' - 'plays' - 'reactions' - 'rewoundTo'), '[]'::jsonb) from jsonb_array_elements(r -> 'posts') x))
$$;

create function pg_temp.acts_read() returns bigint language sql as $$
  select coalesce(sum(seq_tup_read + idx_tup_fetch), 0)::bigint from pg_stat_xact_all_tables where relname = 'acts'
$$;

-- 0421's pool_read, as it was merged (supabase/migrations/0421_whole_posts.sql), under another name.
create function pg_temp.pool_read_0421(in_thread uuid, staff_key text, named uuid[], "window" integer) returns jsonb
language sql stable set jit = off as $$
  with me as (select c.id from characters_public c where c.staff = pool_read_0421.staff_key),
  mine as (
    select o.id from (
      select a.id, a.created_at from acts_public a where a.hidden is not true and a.character = (select m.id from me m)
        and a.id = any (pool_own_post_ids(in_thread, (select m.id from me m), 40))
      union all
      select a.id, a.created_at from acts_public a where a.thread = in_thread and a.seq = 1 and a.kind = 'spin' and a.hidden is not true and a.character = (select m.id from me m)) o
    order by o.created_at desc, o.id desc limit 20
  ),
  seeds as (
    select a.id from acts_public a where a.thread = in_thread and a.seq = 1 and a.kind in ('post', 'spin') and a.hidden is not true
    union
    (select n.id from acts_public n
     where n.thread = in_thread and n.kind = 'post' and n.hidden is not true
       and n.seq > coalesce((select t.last_seq from thread_list t where t.id = in_thread), 0) - 2 * least(greatest(coalesce("window", 0), 0), 200) - 60
     order by n.seq desc, n.id desc limit least(greatest(coalesce("window", 0), 0), 200))
    union
    select a.id from acts_public a where a.thread = in_thread and a.kind = 'post' and a.hidden is not true and a.id = any (coalesce(pool_read_0421.named[1:50], '{}'::uuid[]))
    union
    select m.id from mine m
    union
    select r.id from mine m cross join lateral (
      select x.id from acts_public x where x.hidden is not true
        and x.id = any (pool_reply_ids(in_thread, m.id, 20))
      order by x.created_at desc, x.id desc limit 10) r
  ),
  seed_refs as (
    select s.id, coalesce((select e.id from acts_public e where e.kind = 'edit' and e.target_act_id = s.id order by e.created_at desc, e.id desc limit 1), s.id) as ref from seeds s
  ),
  hop as (
    select q.id from seed_refs s cross join lateral (
      select x.id from quote_refs r join acts_public x on x.id = r.quoted
      where r.act = s.ref and x.thread = in_thread and x.hidden is not true and (x.kind = 'post' or (x.kind = 'spin' and x.seq = 1))
      order by x.created_at desc, x.id desc limit 10) q
  ),
  chosen as (select s.id from seeds s union select h.id from hop h),
  page as (
    select a.id, a.seq, a.created_at, a.character, a.target_act_id, c.name,
           coalesce((select e.id from acts_public e where e.kind = 'edit' and e.target_act_id = a.id order by e.created_at desc, e.id desc limit 1), a.id) as ref,
           (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
           coalesce(a.current_payload ->> 'body', '') as body
    from acts_public a join characters_public c on c.id = a.character
    where a.id = any (array(select k.id from chosen k)) and a.thread = in_thread and a.hidden is not true
  )
  select jsonb_build_object(
    'title', coalesce((select t.title from thread_list t where t.id = in_thread), ''),
    'self', (select m.id from me m),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object('act', p.id, 'seq', p.seq, 'at', p.created_at, 'author', p.character, 'name', p.name, 'pronouns', p.pronouns,
                                          'body', p.body, 'replyTo', p.target_act_id,
                                          'quotes', coalesce((
                                            select jsonb_agg(z.id order by z.created_at desc, z.id desc)
                                            from (select x.id, x.created_at from quote_refs r join acts_public x on x.id = r.quoted
                                                  where r.act = p.ref and x.thread = in_thread and x.hidden is not true and (x.kind = 'post' or (x.kind = 'spin' and x.seq = 1))
                                                  order by x.created_at desc, x.id desc limit 10) z), '[]'::jsonb))
                       order by p.created_at, p.id)
      from page p), '[]'::jsonb))
$$;

-- A thread of n posts as 0421's 3d builds it (the persona posts all through it; one of its newest posts is answered n / 10 times, and in the longer one 300 cards are played on it), and in its last stretch posts that quote one another.
create function pg_temp.long_thread(n integer) returns uuid language plpgsql as $$
declare
  a uuid := (select id from characters where name = 'Wp Len Ann');
  b uuid := (select id from characters where name = 'Wp Len Bea');
  boss uuid := (select id from characters where staff = 'wp-boss');
  t uuid := tests.thread('Wp Bounded ' || n);
  base timestamptz := now() - interval '2 days';
  ids uuid[] := '{}'; authors uuid[] := '{}'; i integer; body text; who uuid;
begin
  for i in 1..n loop
    who := case when i % 10 = 0 then boss when i % 2 = 0 then a else b end;
    body := case when i > n - 90 and i % 3 = 0 then format('Quoting [quote="%s" user=%s]Long post %s[/quote] and [quote="%s" user=%s]Long post %s[/quote].', ids[i - 2], authors[i - 2], i - 2, ids[i - 40], authors[i - 40], i - 40)
                 else 'Long post ' || i end;
    authors := authors || who;
    ids := ids || tests.act(who, 'post', t, jsonb_build_object('body', body),
                            case when i > n - 90 and i % 10 = 5 then ids[i - 5] end, base + i * interval '1 second');
  end loop;
  for i in 1..n / 10 loop
    perform tests.act(case when i % 2 = 0 then a else b end, 'post', t, jsonb_build_object('body', 'Late reply ' || i), ids[n - 80], base + (n + i) * interval '1 second');
  end loop;
  if n > 1000 then
    for i in 1..300 loop
      perform tests.act(a, 'card', t, '{}'::jsonb, ids[n - 80], base + (n + 1000 + i) * interval '1 second');
    end loop;
  end if;
  return t;
end $$;

insert into characters (name, staff, staff_kind, debuted_at) values ('Wp Boss', 'wp-boss', 'persona', now());
create temp table fixture (small uuid, big uuid);
grant all on fixture to public;
do $$
declare s uuid; b uuid;
begin
  perform tests.character(tests.account('wp-len-ann'), 'Wp Len Ann');
  perform tests.character(tests.account('wp-len-bea'), 'Wp Len Bea');
  perform set_config('kayfabb.staff_writer', 'on', true);
  s := pg_temp.long_thread(1000);
  b := pg_temp.long_thread(4000);
  insert into fixture values (s, b);
end $$;

-- ---- 1. the same reads, under each state ----
create function pg_temp.measure(label text, bound bigint) returns void language plpgsql as $$
declare
  small uuid := (select f.small from fixture f); big uuid := (select f.big from fixture f);
  c0 bigint; c_small bigint; c_big bigint; r_small jsonb; r_big jsonb;
begin
  perform set_config('track_functions', 'all', true);
  c0 := pg_temp.acts_read(); r_small := pool_read(small, 'wp-boss', null, 60); c_small := pg_temp.acts_read() - c0;
  c0 := pg_temp.acts_read(); r_big := pool_read(big, 'wp-boss', null, 60); c_big := pg_temp.acts_read() - c0;
  perform set_config('track_functions', 'none', true);
  if jsonb_array_length(r_small -> 'posts') is distinct from jsonb_array_length(r_big -> 'posts') or jsonb_array_length(r_big -> 'posts') < 60 then
    raise exception '[%] the two reads are not alike: % and % posts', label, jsonb_array_length(r_small -> 'posts'), jsonb_array_length(r_big -> 'posts');
  end if;
  if not exists (select 1 from jsonb_array_elements(r_big -> 'posts') x where jsonb_array_length(x -> 'quotes') > 0) then raise exception '[%] no post of the read quotes another', label; end if;
  if c_big > c_small + 20 then raise exception '[%] pool_read reads % rows of acts in a 4,000-post thread and % in a 1,000-post one: it grows with the thread', label, c_big, c_small; end if;
  if c_big > bound then raise exception '[%] pool_read reads % rows of acts in a 4,000-post thread: more than %', label, c_big, bound; end if;
  raise notice '[%] rows of acts: % (1,000 posts), % (4,000 posts)', label, c_small, c_big;
end $$;

-- And the dead rows the files before this one leave in `acts`' indexes (a rolled-back file's index entries stay until a vacuum reclaims them, and an index never shrinks): 20,000 posts written and rolled back. Under the empty
-- statistics below they make acts_patrol_posts the index the planner prices lowest for 0425's helpers, which read the thread's posts through it (issue #1080: 84,833 rows of `acts` here for 0425's helpers, against Postgres 16).
savepoint pad;
insert into acts (character, kind, thread, payload, created_at)
select (select c.id from characters c where c.name = 'Wp Len Ann'), 'post', tests.thread('Wp Padding'), jsonb_build_object('body', 'Padding ' || i), now() - interval '20 days' + i * interval '1 second'
from generate_series(1, 20000) i;
rollback to savepoint pad;
do $$
begin
  -- the statistics of a table that was empty when it was last vacuumed (a new or restored instance), and a visibility map that counts no page all-visible (relallvisible 0: with it the planner took acts_patrol_posts for
  -- pool_own_post_ids, issue #1080's 1241 and 941 rows; the files before this one leave it as they leave it, so it is set here)
  delete from pg_statistic where starelid = 'acts'::regclass;
  update pg_class set relpages = 0, reltuples = 0, relallvisible = 0 where oid = 'acts'::regclass;
  if (select reltuples from pg_class where oid = 'acts'::regclass) is distinct from 0 then raise exception 'the statistics were not set'; end if;
end $$;
select pg_temp.measure('empty statistics', 1500);

set local plan_cache_mode = force_generic_plan;
select pg_temp.measure('empty statistics, generic plans', 1500);
reset plan_cache_mode;

-- ---- 2. the test can fail: 0421's pool_read under the same empty statistics ----
do $$
declare
  small uuid := (select f.small from fixture f); big uuid := (select f.big from fixture f);
  c0 bigint; c_big bigint; old jsonb; new jsonb;
begin
  c0 := pg_temp.acts_read(); old := pg_temp.pool_read_0421(big, 'wp-boss', null, 60); c_big := pg_temp.acts_read() - c0;
  if c_big <= 1500 then raise exception '0421''s pool_read read only % rows of acts under empty statistics: this test cannot tell the bounded read from it', c_big; end if;
  raise notice '0421 pool_read under empty statistics: % rows of acts', c_big;
  -- and it returns the same posts, in the same shape, where it returns at all
  if old is distinct from pg_temp.strip(pool_read(big, 'wp-boss', null, 60)) then raise exception 'the 4,000-post thread''s read is not 0421''s'; end if;
  if pg_temp.pool_read_0421(small, 'wp-boss', null, 60) is distinct from pg_temp.strip(pool_read(small, 'wp-boss', null, 60)) then raise exception 'the 1,000-post thread''s read is not 0421''s'; end if;
  if (select count(*) from jsonb_array_elements(old -> 'posts') x where jsonb_array_length(x -> 'quotes') > 0) = 0 then raise exception 'the compared read has no quotes in it'; end if;
end $$;

-- ... and over the paths a big thread of plain posts does not take: the persona's own post hidden, edited and veiled, replies to its post that are hidden, edited and veiled, edits that move a quote, a post named that is hidden.
do $$
declare
  a uuid := (select id from characters where name = 'Wp Len Ann');
  boss uuid := (select id from characters where staff = 'wp-boss');
  adm uuid := tests.account('wp-paths-admin');
  t uuid := tests.thread('Wp Paths');
  base timestamptz := now() - interval '1 day';
  ids uuid[] := '{}'; stand uuid; play uuid; i integer; w integer; seen integer := 0; old jsonb; new jsonb;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into admins (account) values (adm);
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack) values ('wpveil2', 'Wp Veil Two', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1);
  select c.id into stand from characters c where c.staff_kind = 'anonymous';
  if stand is null then
    insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning id into stand;
    insert into character_profiles (character, title, signature) values (stand, 'Could be anyone.', '');
  end if;
  for i in 1..40 loop
    ids := ids || tests.act(case when i in (2, 4, 5, 6, 20) then boss else a end, 'post', t,
      jsonb_build_object('body', case when i = 4 then format('Path post 4 [quote="%s" user=%s]Path post 3[/quote]', ids[3], a) else 'Path post ' || i end),
      case when i between 7 and 11 or i = 14 then ids[4] when i = 15 then ids[20 - 20 + 2] end, base + i * interval '1 minute');
  end loop;
  -- the persona's 4 is edited (its quotes move to 3) and its 5 is hidden; its 6 is veiled to a stand-in
  perform tests.act(boss, 'edit', t, jsonb_build_object('body', format('Four, edited [quote="%s" user=%s]Path post 1[/quote]', ids[1], a)), ids[4], base + interval '4 minutes 30 seconds');
  insert into conduct_decisions (version_act, post, admin, outcome) values (ids[5], ids[5], adm, 'hide');
  play := tests.act(a, 'card', t, jsonb_build_object('card', 'wpveil2', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() + interval '1 day'), ids[6], base + interval '51 minutes');
  insert into post_veils (play, post, veil, author, ends_at) values (play, ids[6], 'author', boss, now() + interval '1 day');
  -- replies to the persona's 4: 8 is hidden, 9 is edited, 10 is veiled (its author's, a)
  insert into conduct_decisions (version_act, post, admin, outcome) values (ids[8], ids[8], adm, 'hide');
  perform tests.act(a, 'edit', t, jsonb_build_object('body', format('Nine, edited [quote="%s" user=%s]Path post 13[/quote]', ids[13], a)), ids[9], base + interval '9 minutes 30 seconds');
  play := tests.act(boss, 'card', t, jsonb_build_object('card', 'wpveil2', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() + interval '1 day'), ids[10], base + interval '53 minutes');
  insert into post_veils (play, post, veil, author, ends_at) values (play, ids[10], 'author', a, now() + interval '1 day');
  foreach w in array array[0, 5, 60] loop
    old := pg_temp.pool_read_0421(t, 'wp-boss', array[ids[5], ids[6], ids[8], ids[12]], w); new := pg_temp.strip(pool_read(t, 'wp-boss', array[ids[5], ids[6], ids[8], ids[12]], w));
    if old is distinct from new then raise exception 'the path thread, window %, is not 0421''s: % posts in 0421''s, % in this one', w, jsonb_array_length(old -> 'posts'), jsonb_array_length(new -> 'posts'); end if;
    seen := seen + jsonb_array_length(new -> 'posts');
  end loop;
  new := pool_read(t, 'wp-boss', array[ids[5], ids[6], ids[8], ids[12]], 5);
  if new::text ~ ids[5]::text or new::text ~ ids[8]::text then raise exception 'a hidden post is in the read'; end if;
  if not exists (select 1 from jsonb_array_elements(new -> 'posts') x where (x ->> 'act')::uuid = ids[4] and x -> 'quotes' = jsonb_build_array(ids[1])) then raise exception 'the persona''s edited post is not read by its edited quotes: %', (select jsonb_agg(x - 'body' - 'pronouns') from jsonb_array_elements(new -> 'posts') x); end if;
  if not exists (select 1 from jsonb_array_elements(new -> 'posts') x where (x ->> 'author')::uuid = stand) then raise exception 'no veiled post is read under its stand-in'; end if;
  if seen < 20 then raise exception 'the path thread was read as % posts', seen; end if;
end $$;

-- ---- 1. (continued) true statistics ----
analyze acts;
select pg_temp.measure('true statistics', 1500);

-- ---- 4. the two ordered helpers, and pool_read over them, on any plan ----
-- pool_own_post_ids and pool_reply_ids are one ordered, limited read each, and a cost estimate is again all that kept them short: where the persona dominates `acts` (30,000 posts in another thread) and has 60 old posts among 4,600 in this
-- one, a planner that prices a random read dear (random_page_cost 100 below) takes 0421's helpers through the whole table in a sort and reads 40,600 rows of `acts` for 40 ids; with 0421's helpers, that is the state that fails here.
-- The other states pass for 0421's helpers on this fixture too; they are kept so that the fix is shown bounded under each, not because each catches 0421's. (A backward scan of acts_created or acts_character with a filter was
-- seen once, with rows in random order and the default sample, and is not reproduced here.)
-- The reply side is a post with 400 replies and 300 cards played on it (the 4,000-post thread's). Each helper, and pool_read over them, reads about as many rows of `acts` as it returns, in each state.
-- (the helpers are called through `execute`, so that each state is planned afresh: a plpgsql expression keeps the plan of a SQL function it called earlier in the transaction, and the first state's plan would answer for all of them.
-- track_functions is on while counting, as in measure: the table's counts of a statement run inside a function are not seen from the caller without it)
create function pg_temp.helper_reads(label text, bound bigint) returns void language plpgsql as $$
declare
  d uuid := (select f.dom from fixture f); ds uuid := (select f.dom_small from fixture f); t uuid := (select f.big from fixture f);
  target uuid := (select a.id from acts a where a.thread = (select f.big from fixture f) and a.payload ->> 'body' = 'Long post 3920');
  boss uuid := (select id from characters where staff = 'wp-boss');
  c0 bigint; c_own bigint; c_rep bigint; c_dom bigint; c_dom_small bigint; got_own integer; got_rep integer; r_dom jsonb; r_small jsonb;
begin
  perform set_config('track_functions', 'all', true);
  c0 := pg_temp.acts_read(); execute 'select cardinality(pool_own_post_ids($1, $2, 40))' using d, boss into got_own; c_own := pg_temp.acts_read() - c0;
  c0 := pg_temp.acts_read(); execute 'select cardinality(pool_reply_ids($1, $2, 20))' using t, target into got_rep; c_rep := pg_temp.acts_read() - c0;
  if got_own <> 40 or got_rep <> 20 then raise exception '[%] the helpers returned % and % ids', label, got_own, got_rep; end if;
  if c_own > bound then raise exception '[%] pool_own_post_ids reads % rows of acts for 40 ids: more than %', label, c_own, bound; end if;
  if c_rep > bound then raise exception '[%] pool_reply_ids reads % rows of acts for 20 ids: more than %', label, c_rep, bound; end if;
  c0 := pg_temp.acts_read(); execute 'select pool_read($1, ''wp-boss'', null, 60)' using d into r_dom; c_dom := pg_temp.acts_read() - c0;
  c0 := pg_temp.acts_read(); execute 'select pool_read($1, ''wp-boss'', null, 60)' using ds into r_small; c_dom_small := pg_temp.acts_read() - c0;
  perform set_config('track_functions', 'none', true);
  if jsonb_array_length(r_dom -> 'posts') < 60 then raise exception '[%] the dominated thread''s read has % posts', label, jsonb_array_length(r_dom -> 'posts'); end if;
  if c_dom > c_dom_small + 20 then raise exception '[%] pool_read reads % rows of acts where the persona dominates the table and % where it does not: it grows with the table', label, c_dom, c_dom_small; end if;
  if c_dom > 1500 then raise exception '[%] pool_read reads % rows of acts where the persona dominates the table: more than 1500', label, c_dom; end if;
  raise notice '[%] rows of acts: % (own posts), % (replies), % (pool_read, dominating persona), % (without)', label, c_own, c_rep, c_dom, c_dom_small;
end $$;
alter table fixture add column dom uuid;
alter table fixture add column dom_small uuid;
do $$
declare
  boss uuid := (select id from characters where staff = 'wp-boss');
  a uuid := (select id from characters where name = 'Wp Len Ann');
  d uuid := tests.thread('Wp Dominated'); ds uuid := tests.thread('Wp Not Dominated'); other uuid := tests.thread('Wp Dominating');
  base timestamptz := now() - interval '10 days';
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  -- 4,600 posts, the persona's 60 the oldest of them; the same 60 among 200 in a thread of their own; and 30,000 posts of the persona's in another thread, newer than all of them. They are written in no order of time, as
  -- a restored or imported instance's rows are, so that no index of `acts` is read in the order of its heap.
  insert into acts (character, kind, thread, payload, created_at)
  select q.c, 'post', q.t, jsonb_build_object('body', q.b), q.at from (
    select case when i <= 60 then boss else a end as c, d as t, 'Old ' || i as b, base + i * interval '1 second' as at from generate_series(1, 4600) i
    union all
    select case when i <= 60 then boss else a end, ds, 'Small ' || i, base + i * interval '1 second' from generate_series(1, 200) i
    union all
    select boss, other, 'Elsewhere ' || i, base + interval '1 day' + i * interval '1 second' from generate_series(1, 30000) i) q
  order by md5(q.b);
  update fixture set dom = d, dom_small = ds;
end $$;
-- every row is sampled, so that the statistics, and with them the plans below, are the same on every run
alter table acts alter column thread set statistics 1000;
alter table acts alter column "character" set statistics 1000;
alter table acts alter column created_at set statistics 1000;
alter table acts alter column kind set statistics 1000;
analyze acts;
select pg_temp.helper_reads('true statistics, a dominating persona', 200);
-- A planner that prices a random read dear (a database on a disk that seeks slowly, a setting nobody revisited) takes the whole table in a sort, or acts_created or acts_character backward with a filter, where it has a choice.
-- Which of those it takes under a given set of statistics is a matter of a few percent of cost (the helpers' limit is a parameter, so the estimate is a tenth of the rows they could return), so the test names the price.
set local random_page_cost = 100;
select pg_temp.helper_reads('true statistics, random_page_cost 100', 200);
reset random_page_cost;
do $$
begin
  delete from pg_statistic where starelid = 'acts'::regclass;
  update pg_class set relpages = 0, reltuples = 0, relallvisible = 0 where oid = 'acts'::regclass;
end $$;
select pg_temp.helper_reads('empty statistics', 200);
set local plan_cache_mode = force_generic_plan;
select pg_temp.helper_reads('empty statistics, generic plans', 200);
reset plan_cache_mode;

-- ---- 3. the same security ----
do $$
declare f text;
begin
  if (select pg_get_userbyid(proowner) from pg_proc where oid = 'pool_read(uuid, text, uuid[], integer)'::regprocedure) is distinct from 'kayfabb_digest'
     or not (select prosecdef from pg_proc where oid = 'pool_read(uuid, text, uuid[], integer)'::regprocedure)
     or (select proconfig from pg_proc where oid = 'pool_read(uuid, text, uuid[], integer)'::regprocedure) is null
     or not has_function_privilege('service_role', 'pool_read(uuid, text, uuid[], integer)', 'execute')
     or has_function_privilege('authenticated', 'pool_read(uuid, text, uuid[], integer)', 'execute')
     or has_function_privilege('anon', 'pool_read(uuid, text, uuid[], integer)', 'execute') then
    raise exception 'pool_read is not the service role''s alone, owned by the digest role, security definer with its settings';
  end if;
  foreach f in array array['pool_probe(uuid)', 'pool_quoted(uuid, uuid)', 'pool_read_rows(uuid, text, uuid[], integer)', 'pool_seq_ids(uuid, integer, integer)'] loop
    if has_function_privilege('service_role', f::regprocedure, 'execute') or has_function_privilege('authenticated', f::regprocedure, 'execute') or has_function_privilege('anon', f::regprocedure, 'execute') then
      raise exception '% is callable by a client role', f;
    end if;
    if not (select prosecdef from pg_proc where oid = f::regprocedure) or (select proconfig from pg_proc where oid = f::regprocedure) is null then raise exception '% is not security definer with its settings', f; end if;
  end loop;
end $$;
