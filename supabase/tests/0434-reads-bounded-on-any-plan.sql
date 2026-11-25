-- A probe of one Act through acts_public reads `acts` by its key on any plan, however many veils are live and however many card_end Acts the instance holds (supabase/migrations/0434_reads_bounded_on_any_plan.sql, item 1).
-- 0395's acts_public asked whether a live author veil covers each Act with an EXISTS a planner could hash: every live veil, and for each every card_end Act, read once for each statement, so that a probe of one post read
-- veils x card_ends rows of `acts`. With the 8 veils and 200 card_ends planted below, one probe of a post nobody veiled read 1604 rows of `acts` with true statistics and 402 with none, against Postgres 16, before 0434.
-- 1. the bound: one probe through acts_public, and one through pool_probe, under each statistics state (as planted, true, empty for `acts` with relallvisible 0, empty for the veil tables too, generic plans), reads at most 5 rows;
-- 2. the check is post_veils_live's rule: author_veil_covers answers as 0395's EXISTS did, for a live veil, one ended by a card_end, one refunded, one over by its time, a totals veil, and an Act no veil covers.

create function pg_temp.acts_read() returns bigint language sql as $$
  select coalesce(sum(seq_tup_read + idx_tup_fetch), 0)::bigint from pg_stat_xact_all_tables where relname = 'acts'
$$;

create temp table fx (k text primary key, v uuid);
grant all on fx to public;
create function pg_temp.f(k text) returns uuid language sql as $$ select v from fx where fx.k = f.k $$;

-- ---- the fixture ----
do $$
declare
  a uuid := tests.character(tests.account('rb-ann'), 'Rb Ann');
  b uuid := tests.character(tests.account('rb-bea'), 'Rb Bea');
  t uuid := tests.thread('Rb Probes');
  base timestamptz := now() - interval '1 hour';
  p uuid; play uuid; k text;
begin
  perform tests.plant_live_veils(8, 200);
  insert into fx values ('plain', tests.act(a, 'post', t, '{"body": "Nobody veiled this."}'::jsonb, null, base));
  -- one post for each way a veil can stand: live, ended by a card_end, refunded, over by its time; a totals veil; each covering its post (post_veil_cover)
  foreach k in array array['live', 'ended', 'refunded', 'over', 'totals'] loop
    p := tests.act(a, 'post', t, jsonb_build_object('body', 'Veiled ' || k), null, base + interval '1 minute');
    play := tests.act(b, 'card', t, jsonb_build_object('card', 'pvveil', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p, base + interval '2 minutes');
    insert into post_veils (play, post, veil, author, ends_at)
      values (play, p, case when k = 'totals' then 'totals' else 'author' end, a, case when k = 'over' then now() - interval '1 minute' else now() + interval '1 day' end);
    if k in ('over', 'totals') then insert into post_veil_cover (act, play) values (p, play) on conflict do nothing; end if;
    if k = 'ended' then
      perform set_config('kayfabb.card_end_writer', 'on', true);
      insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, play, '{"why": "reversed", "by": "admin"}');
      perform set_config('kayfabb.card_end_writer', '', true);
    end if;
    if k = 'refunded' then insert into card_write_refunds (play, amount) values (play, 1); end if;
    insert into fx values (k, p);
  end loop;
  if not exists (select 1 from post_veil_cover c where c.act = pg_temp.f('live')) or not exists (select 1 from post_veil_cover c where c.act = pg_temp.f('ended')) then raise exception 'the veils cover nothing'; end if;
end $$;

-- ---- 1. the bound, under each state ----
-- each probe through `execute`, so that it is planned in the state it is measured in
create function pg_temp.measure(label text) returns void language plpgsql as $$
declare c0 bigint; c_view bigint; c_probe bigint; r record; k text;
begin
  perform set_config('track_functions', 'all', true);
  foreach k in array array['plain', 'live'] loop
    c0 := pg_temp.acts_read(); execute 'select x.id, x."character", x.current_payload from acts_public x where x.id = $1' using pg_temp.f(k) into r; c_view := pg_temp.acts_read() - c0;
    if r.id is distinct from pg_temp.f(k) then raise exception '[%] the % post was not read', label, k; end if;
    c0 := pg_temp.acts_read(); execute 'select * from pool_probe($1)' using pg_temp.f(k) into r; c_probe := pg_temp.acts_read() - c0;
    if r.ok is not true then raise exception '[%] pool_probe did not read the % post', label, k; end if;
    if c_view > 5 or c_probe > 5 then
      raise exception '[%] one probe of the % post reads % rows of acts through acts_public and % through pool_probe, with 8 live veils and 200 card_end Acts in the instance: more than 5', label, k, c_view, c_probe;
    end if;
    raise notice '[%] rows of acts for one probe of the % post: % (acts_public), % (pool_probe)', label, k, c_view, c_probe;
  end loop;
  perform set_config('track_functions', 'none', true);
end $$;

select pg_temp.measure('as planted');
analyze acts; analyze post_veils; analyze post_veil_cover; analyze card_write_refunds;
select pg_temp.measure('true statistics');
do $$
begin
  delete from pg_statistic where starelid = 'acts'::regclass;
  update pg_class set relpages = 0, reltuples = 0, relallvisible = 0 where oid = 'acts'::regclass;
end $$;
select pg_temp.measure('empty statistics');
do $$
begin
  delete from pg_statistic where starelid in ('post_veils'::regclass, 'post_veil_cover'::regclass, 'card_write_refunds'::regclass);
  update pg_class set relpages = 0, reltuples = 0, relallvisible = 0 where oid in ('post_veils'::regclass, 'post_veil_cover'::regclass, 'card_write_refunds'::regclass);
end $$;
select pg_temp.measure('empty statistics, the veils'' tables too');
set local plan_cache_mode = force_generic_plan;
select pg_temp.measure('empty statistics, generic plans');
reset plan_cache_mode;

-- ---- 2. the check is post_veils_live's rule ----
do $$
declare k text; got boolean; was boolean; want boolean;
begin
  foreach k in array array['plain', 'live', 'ended', 'refunded', 'over', 'totals'] loop
    got := author_veil_covers(pg_temp.f(k));
    was := exists (select 1 from post_veil_cover c join post_veils_live v on v.play = c.play and v.veil = 'author' where c.act = pg_temp.f(k));
    want := k = 'live';
    if got is distinct from want or was is distinct from want then raise exception 'the % post: author_veil_covers says %, 0395''s check %, and it is % that a live author veil covers it', k, got, was, want; end if;
    -- and acts_public shows it as it did: under the stand-in where a live author veil covers it, under its author otherwise, once
    if (select count(*) from acts_public x where x.id = pg_temp.f(k)) is distinct from 1
       or (select x."character" from acts_public x where x.id = pg_temp.f(k)) is distinct from (case when want then stand_in() else (select a."character" from acts a where a.id = pg_temp.f(k)) end) then
      raise exception 'acts_public shows the % post as %', k, (select jsonb_agg(jsonb_build_object('character', x."character")) from acts_public x where x.id = pg_temp.f(k));
    end if;
  end loop;
  -- every planted Act and every Act of the probes' thread answers as 0395's check did
  if exists (select 1 from acts a where (a.thread = (select x.thread from acts x where x.id = pg_temp.f('plain')) or a.id in (select c.act from post_veil_cover c))
             and author_veil_covers(a.id) is distinct from exists (select 1 from post_veil_cover c join post_veils_live v on v.play = c.play and v.veil = 'author' where c.act = a.id)) then
    raise exception 'author_veil_covers differs from 0395''s check on an Act';
  end if;
  if (select count(*) from acts a where a.id in (select c.act from post_veil_cover c) and author_veil_covers(a.id)) < 8 then raise exception 'the planted veils do not cover their posts'; end if;
end $$;

-- ---- 3. the security ----
do $$
begin
  if not exists (select 1 from pg_proc p where p.oid = 'author_veil_covers(uuid)'::regprocedure and p.prosecdef and p.proconfig = array['search_path=public, pg_temp'] and p.provolatile = 's') then
    raise exception 'author_veil_covers is not a stable security definer pinned to public, pg_temp';
  end if;
  if has_function_privilege('anon', 'author_veil_covers(uuid)', 'execute') then raise exception 'anon can call author_veil_covers'; end if;
  if not has_function_privilege('authenticated', 'author_veil_covers(uuid)', 'execute') or not has_function_privilege('kayfabb_digest', 'author_veil_covers(uuid)', 'execute') then
    raise exception 'a reader of acts_public cannot call author_veil_covers, so its read of acts_public would fail';
  end if;
end $$;
