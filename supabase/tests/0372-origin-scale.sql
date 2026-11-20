-- What the origin of a spun thread's page reads at a busy instance's scale (supabase/migrations/0372_origin_in_page.sql, Task 3 of docs/plans/2026-11-14-origin-in-page-plan.md; design docs/plans/2026-11-14-origin-in-page-design.md, section 6).
--
-- thread_page now carries an `origin` key on the page that holds a spun thread's first Act. The reads behind it (o_on, o_act, o_plays, o_shown, o_ends, o_cast) must cost what the origin's 21 plays cost, never what the
-- instance's Acts cost, and a page that has no origin must execute none of them. This is read from the plan, not from a count of timings: the body of thread_page is lifted out of its own definition, prepared with its five
-- arguments as parameters (so the plan is the generic one, made without their values, which is the plan thread_page keeps: plan_cache_mode = force_generic_plan), and run under `explain (analyze, format json)` as
-- the caller. The nodes under the origin's own CTEs are then counted: the rows of `acts` they read (each scan node's rows, plus those its filter and its recheck removed, times its loops, as 0146-card-writes-at-scale.sql counts them).
--
-- Cases: a thread spun from a post that holds 400 plays, among 12,000 other posts in two threads, 6,000 plays on posts that are not the origin, and 3,000 posts each in the spun thread and a plain one.
--  1. The page that holds the first Act: the origin's plays handed on are bounded by 21 (limit 21), its plays come up in order from an index and stop at 21, no scan of `acts` in the origin's nodes is a sequential scan, and the document holds 20 plays, 20 ends at most, and more.
--  2. Another page of the same thread, and a page of a thread with no origin: every node under the origin's CTEs that reads a relation was never executed (zero loops).
-- The fixture is written with the append-only and warn-guard triggers off for this transaction only (the runner rolls it back), and analyzed before the plan is read.

-- The origin's CTEs, as the nodes they are made of (the CTE's own plan node and everything under it), for the plan of one statement.
create function pg_temp.origin_nodes(plan jsonb) returns setof jsonb language sql as $$
  select d from jsonb_path_query(plan, '$.**') c, jsonb_path_query(c, '$.**') d
  where jsonb_typeof(c) = 'object' and c ->> 'Subplan Name' in ('CTE o_act', 'CTE o_plays', 'CTE o_shown', 'CTE o_ends', 'CTE o_cast')
    and jsonb_typeof(d) = 'object' and d ? 'Node Type'
$$;

-- The rows of `acts` the origin's nodes read (a node's rows passed up, plus those its filter and its recheck removed, times its loops).
create function pg_temp.origin_rows_read(plan jsonb) returns numeric language sql as $$
  select coalesce(sum(((n ->> 'Actual Rows')::numeric + coalesce((n ->> 'Rows Removed by Filter')::numeric, 0) + coalesce((n ->> 'Rows Removed by Index Recheck')::numeric, 0)) * (n ->> 'Actual Loops')::numeric), 0)
  from pg_temp.origin_nodes(plan) n
  where n ->> 'Relation Name' = 'acts' and n ->> 'Node Type' in ('Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan')
$$;

-- The rows the origin's plays CTE passed up: what the box is handed, which the limit of 21 bounds (the 21st says there is more).
create function pg_temp.origin_plays_emitted(plan jsonb) returns numeric language sql as $$
  select coalesce(max((c ->> 'Actual Rows')::numeric), -1) from jsonb_path_query(plan, '$.**') c where jsonb_typeof(c) = 'object' and c ->> 'Subplan Name' = 'CTE o_plays'
$$;

-- The rows an index gave up under the origin's CTEs: what its scan nodes passed up, times their loops.
create function pg_temp.origin_index_rows(plan jsonb, idx text) returns numeric language sql as $$
  select coalesce(sum((n ->> 'Actual Rows')::numeric * (n ->> 'Actual Loops')::numeric), 0) from pg_temp.origin_nodes(plan) n where n ->> 'Index Name' = idx
$$;

-- Reads of `acts` inside the origin that are not index reads: a sequential scan of it, anywhere under the origin's CTEs.
create function pg_temp.origin_seq_scans(plan jsonb) returns bigint language sql as $$
  select count(*) from pg_temp.origin_nodes(plan) n where n ->> 'Node Type' = 'Seq Scan' and n ->> 'Relation Name' = 'acts'
$$;

-- Nodes under the origin's CTEs that read a relation and ran at all (a loop or more).
create function pg_temp.origin_relation_loops(plan jsonb) returns numeric language sql as $$
  select coalesce(sum((n ->> 'Actual Loops')::numeric), 0) from pg_temp.origin_nodes(plan) n
  where n ? 'Relation Name' and n ->> 'Node Type' in ('Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan', 'Bitmap Index Scan')
$$;

-- thread_page's own statement, read from its definition and run generic: the plan of `thread_page(t, pg, null, per, '{orfx}')` as `acct`, as explain (analyze, format json) gives it.
create function pg_temp.generic_plan(acct uuid, t uuid, pg integer, per integer) returns jsonb language plpgsql as $$
declare
  def text := pg_get_functiondef('thread_page(uuid, integer, integer, integer, text[])'::regprocedure);
  body text; plan jsonb;
begin
  body := substring(def from E'(?s)\\n  return \\(\\n(.*)\\n  \\);\\nend\\n\\$function\\$');
  if body is null then raise exception 'thread_page''s statement is no longer found in its definition: the scale test cannot read its plan'; end if;
  body := regexp_replace(body, '\mthread_page\.', '', 'g');
  body := regexp_replace(body, '\min_thread\M', '$1', 'g');
  body := regexp_replace(body, '\min_page\M', '$2', 'g');
  body := regexp_replace(body, '\min_seq\M', '$3', 'g');
  body := regexp_replace(body, '\mper_page\M', '$4', 'g');
  body := regexp_replace(body, '\meffect_cards\M', '$5', 'g');
  execute 'prepare origin_scale_q(uuid, integer, integer, integer, text[]) as select (' || body || ')';
  perform set_config('plan_cache_mode', 'force_generic_plan', true);
  perform set_config('jit', 'off', true);
  perform tests.become(acct);
  execute format($q$explain (analyze, format json) execute origin_scale_q(%L, %s, null, %s, '{orfx}')$q$, t, pg, per) into plan;
  perform tests.unbecome();
  execute 'deallocate origin_scale_q';
  perform set_config('plan_cache_mode', 'auto', true);
  return plan;
end $$;

create function pg_temp.spun_from(who uuid, through uuid, origin uuid) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(who);
  made := spin(origin => origin, through => through, title => 'Scale spun ' || left(gen_random_uuid()::text, 6), body => 'Discuss.', at_post => null);
  perform tests.unbecome();
  return (made -> 'act' ->> 'id')::uuid;
end $$;

do $$
declare
  ann uuid := tests.account('os-ann'); spn uuid := tests.account('os-spn'); rdr uuid := tests.account('os-rdr');
  oa uuid := tests.character(ann, 'Os Author'); sp uuid := tests.character(spn, 'Os Spinner'); rd uuid := tests.character(rdr, 'Os Reader');
  casters uuid[] := '{}'; t0 uuid := tests.thread('Os origin thread'); t_other uuid := tests.thread('Os other thread'); plain uuid := tests.thread('Os plain thread');
  p uuid; s uuid; spun_t uuid; plan jsonb; plan2 jsonb; plan3 jsonb; doc jsonb; plays_read numeric; k integer;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values ('orfx', 'Os Effect', 'sweet', 'rare', 'cast', null, '{post}', null), ('orplain', 'Os Plain', 'sweet', 'common', 'cast', null, '{post}', null);
  for k in 1..5 loop casters := casters || tests.character(tests.account('os-caster-' || k), 'Os Caster ' || k); end loop;
  p := tests.post(oa, t0, 'The origin post.', now() - interval '30 days');
  s := pg_temp.spun_from(spn, sp, p);
  spun_t := (select thread from acts where id = s);

  alter table acts disable trigger user;
  -- 400 plays on the origin post (a card's layers are its own plays), a minute apart, as the casters wrote them.
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select casters[g % 5 + 1], 'card', t0, p, jsonb_build_object('card', 'orplain', 'message', '', 'config', '{}'::jsonb, 'layer', g), now() - interval '20 days' + g * interval '1 minute' from generate_series(1, 400) g;
  -- 12,000 other posts in two threads, and 6,000 plays on them, which the origin's reads must never touch.
  insert into acts (character, kind, thread, payload, seq, created_at)
  select casters[g % 5 + 1], 'post', case when g % 2 = 0 then t0 else t_other end, jsonb_build_object('body', 'Post ' || g), 1000 + g, now() - interval '19 days' + g * interval '1 second' from generate_series(1, 12000) g;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select a.character, 'card', a.thread, a.id, jsonb_build_object('card', 'orplain', 'message', '', 'config', '{}'::jsonb, 'layer', 1), a.created_at + interval '1 minute'
  from acts a where a.kind = 'post' and a.thread in (t0, t_other) and a.seq between 1001 and 7000;
  -- The spun thread holds 3,000 posts, and a plain thread 3,000 more.
  insert into acts (character, kind, thread, payload, seq, created_at)
  select casters[g % 5 + 1], 'post', spun_t, jsonb_build_object('body', 'Reply ' || g), 10 + g, now() - interval '10 days' + g * interval '1 second' from generate_series(1, 3000) g;
  insert into acts (character, kind, thread, payload, seq, created_at)
  select casters[g % 5 + 1], 'post', plain, jsonb_build_object('body', 'Plain ' || g), g, now() - interval '9 days' + g * interval '1 second' from generate_series(1, 3000) g;
  alter table acts enable trigger user;
  -- The threads' counters follow the numbers written (pages are ranges of them, and the last page is the counter's).
  update threads t set next_seq = coalesce((select max(a.seq) from acts a where a.thread = t.id), 0) + 1 where t.id in (t0, t_other, spun_t, plain);
  analyze acts;
  if (select count(*) from acts where target_act_id = p and kind = 'card') is distinct from 400::bigint then raise exception 'the origin holds 400 plays'; end if;

  -- 1. The page that holds the first Act.
  plan := pg_temp.generic_plan(rdr, spun_t, 1, 20);
  if (select count(*) from pg_temp.origin_nodes(plan)) < 5 then raise exception '1 the plan holds no nodes under the origin''s CTEs, so the test reads nothing: %', plan; end if;
  plays_read := pg_temp.origin_rows_read(plan);
  raise notice '1 the origin read % rows of acts for 400 plays, with 24,000 other Acts about', plays_read;
  if pg_temp.origin_seq_scans(plan) > 0 then raise exception '1 the origin''s reads scan acts: %', plan; end if;
  -- The bound: what the origin's plays hand on is 21 (limit 21), read oldest first from acts_origin_plays (target_act_id, created_at, id), which stops at the limit: the rows that index gives up are 21 and not the
  -- origin's 400 sorted down to 21. acts_public is two arms, though, and its concealing arm (a veiled play's own) takes the same index range with a filter that no index can serve (a set computed from post_veils),
  -- so it reads the origin's plays to pass none of them: what is read in all is bounded by the origin's own plays (400 here) and never the instance's Acts. That is the view's cost, and it is held where it is.
  if pg_temp.origin_plays_emitted(plan) is distinct from 21::numeric then raise exception '1 the origin''s plays CTE handed on % rows for an origin of 400 plays: it must be bounded by 21 (limit 21)', pg_temp.origin_plays_emitted(plan); end if;
  if plan::text not like '%acts_origin_plays%' then raise exception '1 the origin''s plays are not read through acts_origin_plays: %', plan; end if;
  if pg_temp.origin_index_rows(plan, 'acts_origin_plays') > 21 then raise exception '1 the origin''s plays came up % rows of acts_origin_plays for an origin of 400 plays: they must be read in order and stopped at the limit of 21', pg_temp.origin_index_rows(plan, 'acts_origin_plays'); end if;
  if plays_read > 400 + 21 + 40 then raise exception '1 the origin read % rows of acts for an origin of 400 plays: its reads must be those of the origin''s own plays and not the instance''s Acts', plays_read; end if;
  -- The document names the bound too: 20 plays drawn (and no end of theirs, none was written), and a 21st there.
  perform tests.become(rdr);
  doc := thread_page(spun_t, 1, null, 20, array['orfx']);
  perform tests.unbecome();
  if jsonb_array_length(doc -> 'origin' -> 'plays') is distinct from 20 or doc -> 'origin' -> 'more' is distinct from 'true'::jsonb then raise exception '1 the origin shows 20 of 400 plays and more: % %', jsonb_array_length(doc -> 'origin' -> 'plays'), doc -> 'origin' -> 'more'; end if;

  -- 2. A page that has no origin runs none of the origin's reads: another page of the spun thread, and a thread that was never spun.
  plan2 := pg_temp.generic_plan(rdr, spun_t, 2, 20);
  plan3 := pg_temp.generic_plan(rdr, plain, 1, 20);
  if (select count(*) from pg_temp.origin_nodes(plan2)) < 5 or (select count(*) from pg_temp.origin_nodes(plan3)) < 5 then raise exception '2 the plans hold no nodes under the origin''s CTEs, so the test reads nothing'; end if;
  if pg_temp.origin_relation_loops(plan2) > 0 then raise exception '2 page 2 of a spun thread ran a read of the origin: %', plan2; end if;
  if pg_temp.origin_relation_loops(plan3) > 0 then raise exception '2 a page of a thread with no origin ran a read of the origin: %', plan3; end if;
  raise notice '2 a page with no origin ran none of the origin''s reads (% and % loops)', pg_temp.origin_relation_loops(plan2), pg_temp.origin_relation_loops(plan3);
  -- The meter sees an origin: the same nodes on page 1 did run, so a zero above is a read that did not happen and not a blind meter.
  if pg_temp.origin_relation_loops(plan) < 1 then raise exception '2 the meter sees no read of the origin on the page that holds it: it cannot tell a read that did not happen'; end if;
end $$;

-- ---- 3. The polls of a page (supabase/migrations/0382_poll_reads.sql, Task 2 of docs/plans/2026-11-20-polls-plan.md) ----
-- thread_page now carries the current poll of each post it draws, with its counts and the voters of a public poll. The reads (pl_cur, pl_polls, pl_voters, pl_cast, pl_mine, and o_post that finds the origin's post) must cost what a page's
-- polls cost, bounded by the 50 voters each poll lists and by acts_ballots, never by the instance's Acts: a page of 20 posts, each with a public poll of 200 characters' ballots and 3 changes each (800 ballots a poll, 16,000 in all), among
-- the 12,000 other posts and 6,000 plays above. The plan is read as case 1 reads it: the generic plan under explain (analyze, format json), the nodes under the poll CTEs counted.
--  3. The page of 20 posts with polls: no sequential scan of `acts` under the poll CTEs; the voters handed on are 50 a poll (1,000 in all) and `votersMore` names each of the 20 polls; the counts are two passes over the 16,000 ballots at most
--     (poll_counts, inherent) and the voter list a walk of the newest ballots that stops at 50 (a few hundred rows a poll, from the statistics, never another pass); the time is recorded in the notice and held to 5 s. Recorded 2026-11-20 on Postgres 16, localhost:
--     35,060 rows read under the poll CTEs, the voter lists 3,300 rows for the 20 polls (165 a poll; 25,765 in the one-statement form that read every ballot), 1,000 voters handed on, the plan's own time about 120-260 ms and the document's call about 200-370 ms (480 ms and 550 ms
--     when the voters were a DISTINCT ON over every ballot); the other cases above hold row counts (origin 423 rows for 400 plays) and no time, so these are the first.

create function pg_temp.poll_nodes(plan jsonb) returns setof jsonb language sql as $$
  select d from jsonb_path_query(plan, '$.**') c, jsonb_path_query(c, '$.**') d
  where jsonb_typeof(c) = 'object' and c ->> 'Subplan Name' in ('CTE o_post', 'CTE pl_post', 'CTE pl_cur', 'CTE pl_polls', 'CTE pl_voters', 'CTE pl_cast', 'CTE pl_mine')
    and jsonb_typeof(d) = 'object' and d ? 'Node Type'
$$;

create function pg_temp.poll_rows_read(plan jsonb) returns numeric language sql as $$
  select coalesce(sum(((n ->> 'Actual Rows')::numeric + coalesce((n ->> 'Rows Removed by Filter')::numeric, 0) + coalesce((n ->> 'Rows Removed by Index Recheck')::numeric, 0)) * (n ->> 'Actual Loops')::numeric), 0)
  from pg_temp.poll_nodes(plan) n
  where n ->> 'Relation Name' = 'acts' and n ->> 'Node Type' in ('Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan')
$$;

do $$
declare
  ann uuid := tests.account('ps-ann'); rdr uuid := tests.account('ps-rdr');
  oa uuid := tests.character(ann, 'Ps Author'); rd uuid := tests.character(rdr, 'Ps Reader');
  voters uuid[] := '{}'; owners uuid[] := '{}'; t uuid := tests.thread('Ps polls'); other uuid := tests.thread('Ps other thread');
  p uuid; k integer; plan jsonb; doc jsonb; read_rows numeric; voters_out numeric; started timestamptz; took numeric; read0 numeric; read1 numeric;
begin
  for k in 0..39 loop owners := owners || tests.account('ps-voter-' || k); end loop;
  for k in 1..200 loop voters := voters || tests.character(owners[k % 40 + 1], 'Ps Voter ' || k); end loop;
  -- 20 posts, each with a poll (a page of 20); a poll is a public one of three options.
  for k in 1..20 loop p := tests.post(oa, t, 'Poll post ' || k, now() - interval '3 days' + k * interval '1 minute'); end loop;
  alter table acts disable trigger user;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select oa, 'poll', t, a.id, jsonb_build_object('question', 'Best kart ' || a.seq || '?', 'options', '["Pipe Frame", "Badwagon", "Mach Bike"]'::jsonb, 'pick', 1, 'secret', false, 'closes_at', now() + interval '10 days'), a.created_at + interval '1 second'
  from acts a where a.thread = t and a.kind = 'post';
  -- 200 characters' ballots on each poll, and 3 changes each.
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select voters[c], 'ballot', t, l.id, jsonb_build_object('picks', jsonb_build_array((c + g + l.n) % 3)), now() - interval '2 days' + (g * 1000 + c) * interval '1 second' + l.n * interval '1 millisecond'
  from (select a.id, row_number() over (order by a.created_at) as n from acts a where a.thread = t and a.kind = 'poll') l, generate_series(1, 200) c, generate_series(1, 4) g;
  -- 12,000 other posts and 6,000 plays on them, which the page's polls must never touch.
  insert into acts (character, kind, thread, payload, seq, created_at)
  select oa, 'post', other, jsonb_build_object('body', 'Other ' || g), g, now() - interval '19 days' + g * interval '1 second' from generate_series(1, 12000) g;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select a.character, 'card', a.thread, a.id, jsonb_build_object('card', 'orplain', 'message', '', 'config', '{}'::jsonb, 'layer', 1), a.created_at + interval '1 minute'
  from acts a where a.kind = 'post' and a.thread = other and a.seq <= 6000;
  alter table acts enable trigger user;
  analyze acts;
  if (select count(*) from acts where kind = 'ballot' and thread = t) is distinct from 16000::bigint then raise exception '3 the fixture holds 16,000 ballots'; end if;

  plan := pg_temp.generic_plan(rdr, t, 1, 20);
  if (select count(*) from pg_temp.poll_nodes(plan)) < 5 then raise exception '3 the plan holds no nodes under the poll CTEs, so the test reads nothing: %', plan; end if;
  read_rows := pg_temp.poll_rows_read(plan);
  voters_out := coalesce((select max((c ->> 'Actual Rows')::numeric) from jsonb_path_query(plan, '$.**') c where jsonb_typeof(c) = 'object' and c ->> 'Subplan Name' = 'CTE pl_voters'), -1);
  raise notice '3 a page of 20 polls of 800 ballots read % rows of acts under the poll CTEs and handed on % voters, in % ms (the plan''s own time), among 16,000 ballots and 18,000 other Acts', read_rows, voters_out, round((plan -> 0 ->> 'Execution Time')::numeric, 1);
  if (select count(*) from pg_temp.poll_nodes(plan) n where n ->> 'Node Type' = 'Seq Scan' and n ->> 'Relation Name' = 'acts') > 0 then raise exception '3 the polls'' reads scan acts: %', plan; end if;
  if plan::text not like '%acts_ballots%' or plan::text not like '%acts_polls%' then raise exception '3 the polls'' reads do not go through acts_polls and acts_ballots: %', plan; end if;
  if voters_out is distinct from 1000::numeric then raise exception '3 the voters handed on are % for 20 polls of 200 voters: they are bounded by 50 a poll', voters_out; end if;
  -- Under the poll CTEs the plan shows poll_counts' passes over the 16,000 ballots through acts_ballots_recent (two nodes of 16,000) and the polls' own rows; the voters' walk is inside poll_voter_acts and is measured below from the
  -- statistics. A read that follows the instance's 18,000 other Acts is far above this.
  if read_rows > 2 * 16000 + 4000 then raise exception '3 the poll CTEs read % rows of acts for 16,000 ballots: two passes of the counts at most, they must be those of the polls'' own ballots and not the instance''s Acts', read_rows; end if;
  -- The voter list alone: the walk of the newest ballots stops at 50 voters, so for 20 polls it reads a few hundred rows each (64 of the newest and a probe for each), never the polls' 16,000 ballots.
  perform pg_stat_force_next_flush();
  read0 := (select idx_tup_fetch from pg_stat_xact_user_tables where relname = 'acts');
  perform count(*) from acts a, lateral poll_voter_acts(a.id, now() + interval '9 days', 50) where a.kind = 'poll' and a.thread = t;
  perform pg_stat_force_next_flush();
  read1 := (select idx_tup_fetch from pg_stat_xact_user_tables where relname = 'acts') - read0;
  raise notice '3 the voters of 20 polls of 800 ballots (50 each) fetched % rows of acts', read1;
  if read1 > 20 * 300 then raise exception '3 the voter list fetched % rows of acts for 20 polls of 800 ballots: it must walk the newest ballots and stop at 50 (a few hundred a poll), not read every ballot', read1; end if;
  perform pg_stat_force_next_flush();
  read0 := (select idx_tup_fetch from pg_stat_xact_user_tables where relname = 'acts');
  perform tests.become(rdr);
  started := clock_timestamp();
  doc := thread_page(t, 1, null, 20, '{}');
  took := extract(epoch from clock_timestamp() - started) * 1000;
  perform tests.unbecome();
  perform pg_stat_force_next_flush();
  read1 := (select idx_tup_fetch from pg_stat_xact_user_tables where relname = 'acts') - read0;
  raise notice '3 the page of 20 polls took % ms in the document''s own call and fetched % rows of acts through indexes', round(took, 1), read1;
  if read1 > 3 * 16000 then raise exception '3 the page fetched % rows of acts for 20 polls of 800 ballots: the counts are passes over them (16,000 each) and the voters a few hundred a poll, not another pass each', read1; end if;
  if jsonb_array_length(doc -> 'polls') is distinct from 20 or jsonb_array_length(doc -> 'voters') is distinct from 1000 or jsonb_array_length(doc -> 'votersMore') is distinct from 20 or jsonb_array_length(doc -> 'voterCast') is distinct from 50 then
    raise exception '3 the document holds % polls, % voters, % polls with more, % heads: 20, 1,000, 20 and 50 are those of 20 polls of 200 voters (the 50 newest characters are the same on each poll, so 50 heads)', jsonb_array_length(doc -> 'polls'), jsonb_array_length(doc -> 'voters'), jsonb_array_length(doc -> 'votersMore'), jsonb_array_length(doc -> 'voterCast');
  end if;
  if took > 5000 then raise exception '3 a page of 20 polls of 800 ballots took % ms', took; end if;
end $$;
