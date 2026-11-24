-- pool_read reads by key, never by a plan (supabase/migrations/0425_pool_read_bounded.sql).
-- 0421's pool_read took a plan that read every post of the thread once for each seed whenever the statistics on `acts` said the table was small (a new or restored instance, a big import before autovacuum has run),
-- and 0421's own test, which analyzes `acts` first, failed on it in CI on some runs (`pool_read reads 1585819 rows of acts in a 4,000-post thread and 1584919 in a 1,000-post one`). A passing run proved the planner's luck.
-- 1. the states the planner can be left in: statistics on `acts` that say it is empty (the forged state of a table never vacuumed with rows in it, set here in the transaction), the same with plans made generic for every call,
--    and true statistics. Under each, pool_read reads the same number of rows of `acts` (index and heap tuples; seq_tup_read counts a scan's every row) for a thread of 1,000 posts and one of 4,000, below a fixed bound,
--    with posts that quote each other in both (the hop and each post's `quotes`).
-- 2. the test can fail: 0421's pool_read, kept here as a copy, reads more than that bound under the empty statistics, and returns the same posts where it does.
-- 3. the same security: the owner, the service role's only, the helpers with no caller.

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

do $$
begin
  -- the statistics of a table that was empty when it was last vacuumed (a new or restored instance)
  delete from pg_statistic where starelid = 'acts'::regclass;
  update pg_class set relpages = 0, reltuples = 0 where oid = 'acts'::regclass;
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
  if old is distinct from pool_read(big, 'wp-boss', null, 60) then raise exception 'the 4,000-post thread''s read is not 0421''s'; end if;
  if pg_temp.pool_read_0421(small, 'wp-boss', null, 60) is distinct from pool_read(small, 'wp-boss', null, 60) then raise exception 'the 1,000-post thread''s read is not 0421''s'; end if;
  if (select count(*) from jsonb_array_elements(old -> 'posts') x where jsonb_array_length(x -> 'quotes') > 0) = 0 then raise exception 'the compared read has no quotes in it'; end if;
end $$;

-- ---- 1. (continued) true statistics ----
analyze acts;
select pg_temp.measure('true statistics', 1500);

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
