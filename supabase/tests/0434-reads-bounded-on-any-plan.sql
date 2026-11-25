-- A probe of one Act through acts_public reads `acts` by its key on any plan, however many veils are live and however many card_end Acts the instance holds (supabase/migrations/0434_reads_bounded_on_any_plan.sql, item 1).
-- 0395's acts_public asked whether a live author veil covers each Act with an EXISTS a planner could hash: every live veil, and for each every card_end Act, read once for each statement, so that a probe of one post read
-- veils x card_ends rows of `acts`. With the veils and card_ends planted below, one probe of a post nobody veiled read 4424 rows of `acts` through acts_public, against Postgres 16, before 0434.
-- 1. the bound: one probe through acts_public, and one through pool_probe, under each statistics state (as planted, true, empty for `acts` with relallvisible 0, empty for the veil tables too, generic plans), with the card_end Acts
--    few and then many, reads at most 5 rows;
-- 2. the check is post_veils_live's rule: author_veil_covers answers as 0395's EXISTS did, for a live veil, one ended by a card_end, one refunded, one over by its time, a totals veil, and an Act no veil covers.

create function pg_temp.acts_read() returns bigint language sql as $$
  select coalesce(sum(seq_tup_read + idx_tup_fetch), 0)::bigint from pg_stat_xact_all_tables where relname = 'acts'
$$;

create temp table fx (k text primary key, v uuid);
grant all on fx to public;
create function pg_temp.f(k text) returns uuid language sql as $$ select v from fx where fx.k = f.k $$;

-- ---- the fixture ----
-- The plain post and the planted veils alone, as the files before a guard left them on main's CI, where the planner hashed them (6 live veils, 9 card_end Acts): the posts of section 2, which stand a veil in each other way (ended,
-- refunded, over, a totals veil), are made after the bound is measured, since a refund or a veil of another kind moves the planner's choice (Postgres 17 hashed the planted veils without them and probed by key with them).
do $$
declare
  a uuid := tests.character(tests.account('rb-ann'), 'Rb Ann');
  t uuid := tests.thread('Rb Probes');
  pt uuid;
begin
  insert into fx values ('plain', tests.act(a, 'post', t, '{"body": "Nobody veiled this."}'::jsonb, null, now() - interval '1 hour'));
  pt := tests.plant_live_veils(8, 10);
  -- a planted post a live author veil covers
  insert into fx select 'veiled', v.post from post_veils v join acts p on p.id = v.post where p.thread = pt and v.veil = 'author' limit 1;
  if pg_temp.f('veiled') is null then raise exception 'the planting veiled nothing'; end if;
end $$;

-- ---- 1. the bound, under each state ----
-- each probe through `execute`, so that it is planned in the state it is measured in; with no sequential scan, as every bounded read of `acts` runs (pool_probe, staff_request_shown, the pool's and the extras' reads): a
-- table this small is cheaper read whole, which a busy instance's never is, and that is not what is measured here
create function pg_temp.measure(label text) returns void language plpgsql as $$
declare c0 bigint; c_view bigint; c_probe bigint; r record; k text;
begin
  perform set_config('track_functions', 'all', true);
  perform set_config('enable_seqscan', 'off', true);
  foreach k in array array['plain', 'veiled'] loop
    c0 := pg_temp.acts_read(); execute 'select x.id, x."character", x.current_payload from acts_public x where x.id = $1' using pg_temp.f(k) into r; c_view := pg_temp.acts_read() - c0;
    if r.id is distinct from pg_temp.f(k) then raise exception '[%] the % post was not read', label, k; end if;
    c0 := pg_temp.acts_read(); execute 'select * from pool_probe($1)' using pg_temp.f(k) into r; c_probe := pg_temp.acts_read() - c0;
    if r.ok is not true then raise exception '[%] pool_probe did not read the % post', label, k; end if;
    if c_view > 5 or c_probe > 5 then
      raise exception '[%] one probe of the % post reads % rows of acts through acts_public and % through pool_probe, with the veils and card_end Acts planted: more than 5', label, k, c_view, c_probe;
    end if;
    raise notice '[%] rows of acts for one probe of the % post: % (acts_public), % (pool_probe)', label, k, c_view, c_probe;
  end loop;
  perform set_config('track_functions', 'none', true);
  perform set_config('enable_seqscan', 'on', true);
end $$;

-- Each state in turn, the statistics of `acts` and of the veils' tables forged as each says; `size` names the planting.
create function pg_temp.states(size text) returns void language plpgsql as $$
begin
  perform pg_temp.measure(size || ', as planted');
  analyze acts; analyze post_veils; analyze post_veil_cover; analyze card_write_refunds;
  perform pg_temp.measure(size || ', true statistics');
  delete from pg_statistic where starelid = 'acts'::regclass;
  update pg_class set relpages = 0, reltuples = 0, relallvisible = 0 where oid = 'acts'::regclass;
  perform pg_temp.measure(size || ', empty statistics');
  delete from pg_statistic where starelid in ('post_veils'::regclass, 'post_veil_cover'::regclass, 'card_write_refunds'::regclass);
  update pg_class set relpages = 0, reltuples = 0, relallvisible = 0 where oid in ('post_veils'::regclass, 'post_veil_cover'::regclass, 'card_write_refunds'::regclass);
  perform pg_temp.measure(size || ', empty statistics, the veils'' tables too');
  perform set_config('plan_cache_mode', 'force_generic_plan', true);
  perform pg_temp.measure(size || ', empty statistics, generic plans');
  perform set_config('plan_cache_mode', 'auto', true);
end $$;
select pg_temp.states('8 live author veils, 10 card_ends');
-- and with the card_end Acts many and the veils still few, which a planner prices differently (Postgres 16 hashed them at 200 card_ends where it did not at 10)
select tests.plant_live_veils(0, 190) is not null;
select pg_temp.states('8 live author veils, 200 card_ends');

-- ---- 2. the check is post_veils_live's rule ----
-- one post for each way a veil can stand: live, ended by a card_end, refunded, over by its time; a totals veil; each covering its post (post_veil_cover)
do $$
declare
  a uuid := tests.character(tests.account('rb-cy'), 'Rb Cy');
  b uuid := tests.character(tests.account('rb-bea'), 'Rb Bea');
  t uuid := tests.thread('Rb Rule');
  base timestamptz := now() - interval '1 hour';
  p uuid; play uuid; k text;
begin
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

-- ---- 4. the stand-in's own Acts, read from the live veils (the owner's answer on #1107) ----
-- The stand-in's profile and record list the Acts a live author veil covers. Read as a filter of acts_public they walk every Act of the instance (0395's hashed check made each row nearly free; a per-Act check, which a probe of
-- one Act needs, makes each an index probe: 3,175 buffers in 0304). They now read stand_in_acts, which starts from the live veils: here an author holds 3,000 posts and 30 live author veils, so each page reads its rows of
-- `acts` by the veils and the page, never by the author's posts; and each lists the Acts, in the order, that the view read lists (main's read).
do $$
declare
  a uuid := tests.character(tests.account('rb-vee'), 'Rb Vee');
  b uuid := tests.character(tests.account('rb-wil'), 'Rb Wil');
  t uuid := tests.thread('Rb Stand-in');
  -- newer than every other Act the stand-in shows (the planted veils' posts are a day old), so that its newest are this author's
  base timestamptz := now() - interval '2 hours';
  ps uuid[]; play uuid; i integer;
begin
  if not exists (select 1 from characters where staff_kind = 'anonymous') then
    insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now());
  end if;
  insert into acts (character, kind, thread, payload, created_at) select a, 'post', t, jsonb_build_object('body', 'Vee ' || g), base + g * interval '1 second' from generate_series(1, 3000) g;
  ps := array(select x.id from acts x where x.thread = t order by x.created_at);
  -- thirty live author veils on the author's oldest posts, so that a walk of the author's Acts newest first passes all 3,000 to find them; one ended and one over by its time
  for i in 1..32 loop
    play := tests.act(b, 'card', t, jsonb_build_object('card', 'pvveil', 'message', '', 'config', '{}'::jsonb, 'layer', 1), ps[i], base + interval '1 hour' + i * interval '1 second');
    insert into post_veils (play, post, veil, author, ends_at) values (play, ps[i], 'author', a, case when i = 32 then now() - interval '1 minute' else now() + interval '1 day' end);
    if i = 31 then
      perform set_config('kayfabb.card_end_writer', 'on', true);
      insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, play, '{"why": "reversed", "by": "admin"}');
      perform set_config('kayfabb.card_end_writer', '', true);
    end if;
  end loop;
  insert into fx values ('stand', (select c.id from characters c where c.staff_kind = 'anonymous'));
  analyze acts; analyze post_veils; analyze post_veil_cover;
end $$;

-- The pages are measured with no sequential scan, as section 1 measures its probes: the rest of a page (my_alerts_unread's followed threads, among others) reads `acts` whole when the planner thinks the table small, which
-- is not what is measured here.
create function pg_temp.stand_in_pages() returns void language plpgsql as $$
declare
  stand uuid := pg_temp.f('stand'); c0 bigint; c bigint; got jsonb; want uuid[]; have uuid[]; pg integer; kind text; kinds text[];
begin
  perform set_config('track_functions', 'all', true);
  perform set_config('enable_seqscan', 'off', true);
  -- main's read of the stand-in's Acts: acts_public by the character, newest first (as 0357's profile_page and record_page ask it)
  want := array(select x.id from acts_public x where x."character" = stand and x.kind in ('post', 'spin', 'card') order by x.created_at desc, x.id desc limit 5);
  if cardinality(want) < 5 then raise exception 'the stand-in shows % Acts, not five', cardinality(want); end if;
  perform tests.become((select u.id from auth.users u where u.email = 'rb-wil@test.invalid'));
  c0 := pg_temp.acts_read(); got := profile_page(stand); c := pg_temp.acts_read() - c0;
  perform tests.unbecome();
  have := array(select (e ->> 'id')::uuid from jsonb_array_elements(got -> 'acts') e);
  if have is distinct from want then raise exception 'the stand-in''s profile lists % where the view read lists %', have, want; end if;
  if c > 300 then raise exception 'the stand-in''s profile reads % rows of acts, with an author of 3,000 posts under 30 live veils: it reads the author''s posts, not the veils', c; end if;
  raise notice 'the stand-in''s profile: % rows of acts', c;
  foreach kind in array array['all', 'post', 'card'] loop
    kinds := case kind when 'all' then array['post', 'spin', 'card'] else array[kind] end;
    foreach pg in array array[1, 2] loop
      want := array(select x.id from acts_public x where x."character" = stand and x.kind = any (kinds) order by x.created_at desc, x.id desc offset (pg - 1) * 20 limit 20);
      perform tests.become((select u.id from auth.users u where u.email = 'rb-wil@test.invalid'));
      c0 := pg_temp.acts_read(); got := record_page(stand, kind, pg); c := pg_temp.acts_read() - c0;
      perform tests.unbecome();
      have := coalesce(array(select (e ->> 'id')::uuid from jsonb_array_elements(got -> 'acts') e), '{}');
      if have is distinct from want then raise exception 'the stand-in''s record (%, page %) lists % where the view read lists %', kind, pg, have, want; end if;
      if c > 300 then raise exception 'the stand-in''s record (%, page %) reads % rows of acts, with an author of 3,000 posts under 30 live veils', kind, pg, c; end if;
      raise notice 'the stand-in''s record (%, page %): % Acts, % rows of acts', kind, pg, cardinality(have), c;
    end loop;
  end loop;
  perform set_config('track_functions', 'none', true);
  perform set_config('enable_seqscan', 'on', true);
end $$;
select pg_temp.stand_in_pages();

-- ---- 3. the security ----
do $$
declare f text;
begin
  foreach f in array array['author_veil_covers(uuid)', 'author_veil_live(uuid)', 'stand_in_acts(uuid,text[],integer,integer)'] loop
    if not exists (select 1 from pg_proc p where p.oid = f::regprocedure and p.prosecdef and p.proconfig[1] = 'search_path=public, pg_temp' and p.provolatile = 's') then
      raise exception '% is not a stable security definer pinned to public, pg_temp', f;
    end if;
    if has_function_privilege('anon', f, 'execute') then raise exception 'anon can call %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'a signed-in reader cannot call %, so a read that calls it would fail', f; end if;
  end loop;
  foreach f in array array['author_veil_covers(uuid)', 'author_veil_live(uuid)'] loop
    if not has_function_privilege('kayfabb_digest', f, 'execute') then raise exception 'the digest role reads acts_public and cannot call %', f; end if;
  end loop;
  -- card_end_written is the definers' own, called as their owner: no API role runs it
  if has_function_privilege('authenticated', 'card_end_written(uuid)', 'execute') or has_function_privilege('service_role', 'card_end_written(uuid)', 'execute') then raise exception 'an API role can call card_end_written'; end if;
end $$;
