-- What the origin of a spun thread's page reads at a busy instance's scale (supabase/migrations/0372_origin_in_page.sql, Task 3 of docs/plans/2026-11-14-origin-in-page-plan.md; design docs/plans/2026-11-14-origin-in-page-design.md, section 6).
--
-- thread_page now carries an `origin` key on the page that holds a spun thread's first Act. The reads behind it (o_on, o_act, o_ids, o_all, o_plays, o_shown, o_ends, o_cast) must cost what the origin's plays in force and
-- stand-ins cost (0410: the plays of post_play_ids, no longer the oldest 21), never what the origin's history or the instance's Acts cost, and a page that has no origin must execute none of them. This is read from the plan, not from a count of timings: the body of thread_page is lifted out of its own definition, prepared with its five
-- arguments as parameters (so the plan is the generic one, made without their values, which is the plan thread_page keeps: plan_cache_mode = force_generic_plan), and run under `explain (analyze, format json)` as
-- the caller. The nodes under the origin's own CTEs are then counted: the rows of `acts` they read (each scan node's rows, plus those its filter and its recheck removed, times its loops, as 0146-card-writes-at-scale.sql counts them).
--
-- Cases: a thread spun from a post that holds 400 plays (396 over, 4 in force), among 12,000 other posts in two threads, 6,000 plays on posts that are not the origin, and 3,000 posts each in the spun thread and a plain one.
--  1. The page that holds the first Act: the origin's plays handed on are the 4 in force (its one kind's newest and most drawn are two of them), the rows of `acts` its nodes read are bounded by what those few cost (and not by its 400),
--     no scan of `acts` by the list of ids in the origin's nodes is a sequential one (the rest of what acts_public does for each Act it shows is the view's cost and is not counted), and the document holds the 4 plays and the counts of 400. (Until 0410 this case held the origin to the first 21 of its plays by acts_origin_plays; the cap is gone, #871.) at most, and more.
--  2. Another page of the same thread, and a page of a thread with no origin: every node under the origin's CTEs that reads a relation was never executed (zero loops).
-- The fixture is written with the append-only and warn-guard triggers off for this transaction only (the runner rolls it back), and analyzed before the plan is read.

-- The origin's CTEs, as the nodes they are made of (the CTE's own plan node and everything under it), for the plan of one statement.
create function pg_temp.origin_nodes(plan jsonb) returns setof jsonb language sql as $$
  select d from jsonb_path_query(plan, '$.**') c, jsonb_path_query(c, '$.**') d
  where jsonb_typeof(c) = 'object' and c ->> 'Subplan Name' in ('CTE o_act', 'CTE o_ids', 'CTE o_all', 'CTE o_plays', 'CTE o_shown', 'CTE o_ends', 'CTE o_cast')
    and jsonb_typeof(d) = 'object' and d ? 'Node Type'
$$;

-- The rows a CTE of the origin passed up (its own node's `Actual Rows`).
create function pg_temp.origin_cte_rows(plan jsonb, cte text) returns numeric language sql as $$
  select coalesce(max((c ->> 'Actual Rows')::numeric), -1) from jsonb_path_query(plan, '$.**') c where jsonb_typeof(c) = 'object' and c ->> 'Subplan Name' = cte
$$;

-- The rows the origin's plays CTE passed up: what the box is handed, which the plays in force and the stand-ins bound.
create function pg_temp.origin_plays_emitted(plan jsonb) returns numeric language sql as $$
  select coalesce(max((c ->> 'Actual Rows')::numeric), -1) from jsonb_path_query(plan, '$.**') c where jsonb_typeof(c) = 'object' and c ->> 'Subplan Name' = 'CTE o_plays'
$$;

-- Reads of `acts` inside the origin that are not index reads: a sequential scan of it, anywhere under the origin's CTEs.
-- The rows of acts the origin's lookup of its plays read: the by-id scans, and not what acts_public does besides for each Act it shows (its lateral lookup of the latest edit, which a database that earlier files filled prices
-- as a seq scan of acts for each Act shown, and its probes of the veils), the view's cost, the same in 0402's thread_page there.
create function pg_temp.origin_by_id_rows(plan jsonb) returns numeric language sql as $$
  select coalesce(sum(((n ->> 'Actual Rows')::numeric + coalesce((n ->> 'Rows Removed by Filter')::numeric, 0) + coalesce((n ->> 'Rows Removed by Index Recheck')::numeric, 0)) * (n ->> 'Actual Loops')::numeric), 0)
  from pg_temp.origin_nodes(plan) n
  where n ->> 'Relation Name' = 'acts' and n ->> 'Node Type' in ('Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan')
    and coalesce(n ->> 'Index Name', '') not in ('acts_edits', 'acts_one_card_end') and coalesce(n ->> 'Filter', '') not like '%''edit''%'
$$;

create function pg_temp.origin_seq_scans(plan jsonb, filter_like text default null) returns bigint language sql as $$
  select count(*) from pg_temp.origin_nodes(plan) n where n ->> 'Node Type' = 'Seq Scan' and n ->> 'Relation Name' = 'acts' and (filter_like is null or coalesce(n ->> 'Filter', '') like filter_like)
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
  p uuid; s uuid; spun_t uuid; plan jsonb; plan2 jsonb; plan3 jsonb; doc jsonb; k integer;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values ('orfx', 'Os Effect', 'sweet', 'rare', 'cast', null, '{post}', null), ('orplain', 'Os Plain', 'sweet', 'common', 'cast', null, '{post}', null);
  for k in 1..5 loop casters := casters || tests.character(tests.account('os-caster-' || k), 'Os Caster ' || k); end loop;
  p := tests.post(oa, t0, 'The origin post.', now() - interval '30 days');
  s := pg_temp.spun_from(spn, sp, p);
  spun_t := (select thread from acts where id = s);

  alter table acts disable trigger user;
  -- 400 plays on the origin post (a card's layers are its own plays), a minute apart, as the casters wrote them: each over ten minutes later but the last four, which have a day to run (a post holds a few in force, never 400).
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select casters[g % 5 + 1], 'card', t0, p,
         jsonb_build_object('card', 'orplain', 'message', '', 'config', '{}'::jsonb, 'layer', g, 'ends', case when g > 396 then now() + interval '1 day' else now() - interval '20 days' + g * interval '1 minute' + interval '10 minutes' end),
         now() - interval '20 days' + g * interval '1 minute' from generate_series(1, 400) g;
  -- 12,000 other posts in two threads, and 6,000 plays on them, which the origin's reads must never touch.
  insert into acts (character, kind, thread, payload, seq, created_at)
  select casters[g % 5 + 1], 'post', case when g % 2 = 0 then t0 else t_other end, jsonb_build_object('body', 'Post ' || g), 1000 + g, now() - interval '19 days' + g * interval '1 second' from generate_series(1, 12000) g;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select a.character, 'card', a.thread, a.id, jsonb_build_object('card', 'orplain', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', a.created_at + interval '20 minutes'), a.created_at + interval '1 minute'
  from acts a where a.kind = 'post' and a.thread in (t0, t_other) and a.seq between 1001 and 7000;
  -- The spun thread holds 3,000 posts, and a plain thread 3,000 more.
  insert into acts (character, kind, thread, payload, seq, created_at)
  select casters[g % 5 + 1], 'post', spun_t, jsonb_build_object('body', 'Reply ' || g), 10 + g, now() - interval '10 days' + g * interval '1 second' from generate_series(1, 3000) g;
  insert into acts (character, kind, thread, payload, seq, created_at)
  select casters[g % 5 + 1], 'post', plain, jsonb_build_object('body', 'Plain ' || g), g, now() - interval '9 days' + g * interval '1 second' from generate_series(1, 3000) g;
  alter table acts enable trigger user;
  -- The kept rows of the plays, as the migrations' backfills fill them (the triggers that keep them were off for the bulk insert).
  insert into play_post select r.* from acts x cross join lateral play_row(x.id) r where x.kind in ('card', 'set') and x.target_act_id is not null and x.thread in (t0, t_other);
  insert into post_kinds (post, kind, plays, took) select pp.post, pp.kind, sum(c.plays), sum(c.took) from play_post pp cross join lateral play_post_counts(pp) c where pp.post in (select y.id from acts y where y.thread in (t0, t_other)) group by pp.post, pp.kind having sum(c.plays) > 0;
  analyze play_post; analyze post_kinds;
  -- The threads' counters follow the numbers written (pages are ranges of them, and the last page is the counter's).
  update threads t set next_seq = coalesce((select max(a.seq) from acts a where a.thread = t.id), 0) + 1 where t.id in (t0, t_other, spun_t, plain);
  analyze acts;
  if (select count(*) from acts where target_act_id = p and kind = 'card') is distinct from 400::bigint then raise exception 'the origin holds 400 plays'; end if;

  -- 1. The page that holds the first Act.
  plan := pg_temp.generic_plan(rdr, spun_t, 1, 20);
  if (select count(*) from pg_temp.origin_nodes(plan)) < 5 then raise exception '1 the plan holds no nodes under the origin''s CTEs, so the test reads nothing: %', plan; end if;
  -- What is bounded is the list of ids the origin's plays are looked up by, and the lookup is by that list: `o_all` holds the 4 plays in force of the origin's 400 (the one kind's newest and most drawn are two of them), `o_plays` reads exactly
  -- those from acts_public, and no scan of acts has that list for its filter. What acts_public does besides for each Act it shows (probes of its veils, its edits and its ballots, each by a plan of its own that depends on what the instance
  -- holds, and a database that earlier files filled with veils runs them) is the view's cost, the same for any Act read through it, which this change does not alter; it is not what the plays' ids cost, and it is not counted.
  raise notice '1 the origin looked up % plays by id, of 400 (4 in force), with 24,000 other Acts about', pg_temp.origin_plays_emitted(plan);
  if pg_temp.origin_seq_scans(plan, '%ANY%') > 0 then raise exception '1 the origin''s plays are looked up by scanning acts: %', plan; end if;
  if pg_temp.origin_plays_emitted(plan) is distinct from 4::numeric then raise exception '1 the origin''s plays CTE handed on % rows for an origin of 400 plays, 4 in force: it must be the 4', pg_temp.origin_plays_emitted(plan); end if;
  if pg_temp.origin_by_id_rows(plan) > 2 * (4 + 2 * 1) + 8 or pg_temp.origin_by_id_rows(plan) < 4 then raise exception '1 the origin read % rows of acts by id for an origin of 400 plays, 4 in force: at least the 4 and at most 2 x (4 + 2 x 1) + 8 = 28', pg_temp.origin_by_id_rows(plan); end if;
  if pg_temp.origin_cte_rows(plan, 'CTE o_all') is distinct from 4::numeric then raise exception '1 the origin''s list of ids holds % for an origin of 400 plays, 4 in force: it must be the 4', pg_temp.origin_cte_rows(plan, 'CTE o_all'); end if;
  -- The document names the bound too: the 4 plays in force (no end of theirs, none was written), and the counts of 400.
  perform tests.become(rdr);
  doc := thread_page(spun_t, 1, null, 20, array['orfx']);
  perform tests.unbecome();
  if jsonb_array_length(doc -> 'origin' -> 'plays') is distinct from 4 or doc -> 'origin' ? 'more' or doc -> 'origin' -> 'counts' is distinct from jsonb_build_array(jsonb_build_object('post', p, 'card', 'orplain', 'all', 400, 'took', 400)) then
    raise exception '1 the origin shows the 4 plays in force of 400, counted 400: % %', jsonb_array_length(doc -> 'origin' -> 'plays'), doc -> 'origin' -> 'counts';
  end if;

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

-- ---- 3. The polls of a page (supabase/migrations/0395_poll_reads.sql, Task 2 of docs/plans/2026-11-20-polls-plan.md) ----
-- thread_page now carries the current poll of each post it draws, with its counts and the voters of a public poll. The reads (pl_cur, pl_polls, pl_voters, pl_cast, pl_mine, and o_post that finds the origin's post) must cost what a page's
-- polls cost, bounded by the 50 voters each poll lists and by acts_ballots, never by the instance's Acts: a page of 20 posts, each with a public poll of 200 characters' ballots and 3 changes each (800 ballots a poll, 16,000 in all), among
-- the 12,000 other posts and 6,000 plays above. The plan is read as case 1 reads it: the generic plan under explain (analyze, format json), the nodes under the poll CTEs counted.
--  3. The page of 20 posts with polls: no sequential scan of `acts` under the poll CTEs; the voters handed on are 50 a poll (1,000 in all) and `votersMore` names each of the 20 polls; the counts are two passes over the 16,000 ballots at most
--     (poll_counts, inherent) and the voter list the newest of the poll's latest-ballot rows (poll_latest_ballots), stopped at 50 (60 rows of acts for the 20 polls since 2026-11-21; a walk of the newest ballots before, 3,300); the time is recorded in the notice and held to 5 s. Recorded 2026-11-20 on Postgres 16, localhost:
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
  p uuid; k integer; plan jsonb; doc jsonb; read_rows numeric; voters_out numeric; started timestamptz; took numeric; read0 numeric; read1 numeric; deep_id uuid; deep_at timestamptz; first_read numeric; deep_read numeric;
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
  -- The ballots went in with the triggers off, so the latest ballot of each character (poll_latest_ballots, which the trigger keeps) is computed from them.
  perform rebuild_poll_latest_ballots();
  analyze acts;
  analyze poll_latest_ballots;
  if (select count(*) from acts where kind = 'ballot' and thread = t) is distinct from 16000::bigint then raise exception '3 the fixture holds 16,000 ballots'; end if;

  plan := pg_temp.generic_plan(rdr, t, 1, 20);
  if (select count(*) from pg_temp.poll_nodes(plan)) < 5 then raise exception '3 the plan holds no nodes under the poll CTEs, so the test reads nothing: %', plan; end if;
  read_rows := pg_temp.poll_rows_read(plan);
  voters_out := coalesce((select max((c ->> 'Actual Rows')::numeric) from jsonb_path_query(plan, '$.**') c where jsonb_typeof(c) = 'object' and c ->> 'Subplan Name' = 'CTE pl_voters'), -1);
  raise notice '3 a page of 20 polls of 800 ballots read % rows of acts under the poll CTEs and handed on % voters, in % ms (the plan''s own time), among 16,000 ballots and 18,000 other Acts', read_rows, voters_out, round((plan -> 0 ->> 'Execution Time')::numeric, 1);
  if (select count(*) from pg_temp.poll_nodes(plan) n where n ->> 'Node Type' = 'Seq Scan' and n ->> 'Relation Name' = 'acts') > 0 then raise exception '3 the polls'' reads scan acts: %', plan; end if;
  if plan::text not like '%acts_ballots%' or plan::text not like '%acts_polls%' then raise exception '3 the polls'' reads do not go through acts_polls and acts_ballots: %', plan; end if;
  if voters_out is distinct from 1000::numeric then raise exception '3 the voters handed on are % for 20 polls of 200 voters: they are bounded by 50 a poll', voters_out; end if;
  -- Under the poll CTEs the plan shows poll_counts' passes over the 16,000 ballots through acts_ballots_recent (two nodes of 16,000) and the polls' own rows; the voters' read is inside poll_voter_acts and is measured below from the
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
  -- A deep page of poll_ballots costs what the first does: page 10 of a poll of 800 ballots (the cursor is the 450th newest) fetches about as many rows of acts as page 1, since the keyset walks acts_ballots_recent from the cursor
  -- and stops at 51, where an offset would read the 450 before it.
  select b.id, b.created_at into deep_id, deep_at from acts b where b.kind = 'ballot' and b.target_act_id = (select id from acts where kind = 'poll' and thread = t order by created_at limit 1) order by b.created_at desc, b.id desc offset 449 limit 1;
  perform tests.become(rdr);
  perform pg_stat_force_next_flush();
  read0 := (select idx_tup_fetch from pg_stat_xact_user_tables where relname = 'acts');
  perform poll_ballots((select id from acts where kind = 'poll' and thread = t order by created_at limit 1));
  perform pg_stat_force_next_flush();
  first_read := (select idx_tup_fetch from pg_stat_xact_user_tables where relname = 'acts') - read0;
  read0 := (select idx_tup_fetch from pg_stat_xact_user_tables where relname = 'acts');
  perform poll_ballots((select id from acts where kind = 'poll' and thread = t order by created_at limit 1), deep_at, deep_id);
  perform pg_stat_force_next_flush();
  deep_read := (select idx_tup_fetch from pg_stat_xact_user_tables where relname = 'acts') - read0;
  perform tests.unbecome();
  raise notice '3 poll_ballots fetched % rows of acts for page 1 and % for page 10 of 800 ballots', first_read, deep_read;
  if deep_read > first_read + 100 or first_read > 600 then raise exception '3 page 10 of poll_ballots fetched % rows of acts and page 1 %: a keyset page must cost the same however deep (and a page is 50 ballots)', deep_read, first_read; end if;
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

-- ---- 4. A character that votes again and again (blocking finding B1 of the polls' review) ----
-- Nothing limits how often a character may change its ballot, so a poll's cost may not follow the number of ballots ever cast, only its voters: one public poll with 50 characters' single ballots and one more character that cast 20,000 ballots
-- (every one newer than the 50). The voter list (poll_voter_acts), the counts (poll_counts) and the page (thread_page) read a row of the poll's own for each character that voted (its latest ballot, poll_latest_ballots) and never walk the
-- superseded ones: each is read from the statistics, as case 3 reads them, and held to a few hundred rows however many ballots were cast. (Before the row existed: poll_voter_acts 36 s and thread_page 38 s for 200,000 re-votes.)
--  4. poll_voter_acts fetches under 1,000 rows of acts, poll_counts under 1,000 (and reads no acts by a sequential scan), the page's poll CTEs read under 1,000 rows of acts, and the counts and the voters are right: 51 voters, 50 listed.
do $$
declare
  ann uuid := tests.account('pr-ann'); rdr uuid := tests.account('pr-rdr'); fan uuid := tests.account('pr-fan');
  oa uuid := tests.character(ann, 'Pr Author'); fanc uuid := tests.character(fan, 'Pr Fan');
  voters uuid[] := '{}'; owner uuid; t uuid := tests.thread('Pr revoting'); p uuid; pl uuid; k integer; plan jsonb; doc jsonb;
  read0 numeric; read1 numeric; seq0 numeric; seq1 numeric; got record; listed integer; read_rows numeric;
begin
  for k in 1..10 loop
    owner := tests.account('pr-voter-' || k);
    for j in 1..5 loop voters := voters || tests.character(owner, 'Pr Voter ' || k || '-' || j); end loop;
  end loop;
  p := tests.post(oa, t, 'A poll that one character votes on again and again.', now() - interval '3 days');
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (oa, 'poll', t, p, jsonb_build_object('question', 'Re-voted?', 'options', '["Yes", "No", "Maybe"]'::jsonb, 'pick', 1, 'secret', false, 'closes_at', now() + interval '10 days'), now() - interval '3 days' + interval '1 second')
  returning id into pl;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select voters[g], 'ballot', t, pl, jsonb_build_object('picks', jsonb_build_array(g % 3)), now() - interval '2 days' + g * interval '1 second' from generate_series(1, 50) g;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select fanc, 'ballot', t, pl, jsonb_build_object('picks', jsonb_build_array(g % 3)), now() - interval '1 day' + g * interval '1 second' from generate_series(1, 20000) g;
  analyze acts;
  analyze poll_latest_ballots;
  if (select count(*) from acts where kind = 'ballot' and target_act_id = pl) is distinct from 20050::bigint then raise exception '4 the fixture holds 20,050 ballots'; end if;

  -- The voter list.
  perform pg_stat_force_next_flush();
  read0 := (select idx_tup_fetch + seq_tup_read from pg_stat_xact_user_tables where relname = 'acts');
  select count(*) into listed from poll_voter_acts(pl, now() + interval '9 days', 50);
  perform pg_stat_force_next_flush();
  read1 := (select idx_tup_fetch + seq_tup_read from pg_stat_xact_user_tables where relname = 'acts') - read0;
  raise notice '4 the voter list of a poll of 51 voters and 20,050 ballots listed % and fetched % rows of acts', listed, read1;
  if listed is distinct from 50 then raise exception '4 the voter list holds % for 51 voters (50 at most are listed)', listed; end if;
  if read1 >= 1000 then raise exception '4 the voter list fetched % rows of acts for a poll of 51 voters and 20,050 ballots: it must be bounded by the voters listed, never the ballots cast', read1; end if;

  -- The counts.
  perform pg_stat_force_next_flush();
  read0 := (select idx_tup_fetch + seq_tup_read from pg_stat_xact_user_tables where relname = 'acts');
  select c.counts, c.voters into got from poll_counts c where c.poll = pl;
  perform pg_stat_force_next_flush();
  read1 := (select idx_tup_fetch + seq_tup_read from pg_stat_xact_user_tables where relname = 'acts') - read0;
  raise notice '4 poll_counts for 51 voters and 20,050 ballots gave % of % voters and fetched % rows of acts', got.counts, got.voters, read1;
  if got.voters is distinct from 51 or (select sum(x) from unnest(got.counts) x) is distinct from 51::bigint then raise exception '4 poll_counts holds % voters and counts %: one counted ballot for each of 51 characters', got.voters, got.counts; end if;
  if read1 >= 1000 then raise exception '4 poll_counts fetched % rows of acts for 51 voters and 20,050 ballots: it must be bounded by the voters, never the ballots cast', read1; end if;

  -- The page.
  plan := pg_temp.generic_plan(rdr, t, 1, 20);
  if (select count(*) from pg_temp.poll_nodes(plan)) < 5 then raise exception '4 the plan holds no nodes under the poll CTEs, so the test reads nothing'; end if;
  read_rows := pg_temp.poll_rows_read(plan);
  raise notice '4 a page with that poll read % rows of acts under the poll CTEs, in % ms (the plan''s own time)', read_rows, round((plan -> 0 ->> 'Execution Time')::numeric, 1);
  if read_rows >= 1000 then raise exception '4 the page''s poll CTEs read % rows of acts for 51 voters and 20,050 ballots: they must be bounded by the voters', read_rows; end if;
  -- The page of the character that voted 20,000 times: its own latest ballot is one row (my_latest_ballots), not its 20,000.
  plan := pg_temp.generic_plan(fan, t, 1, 20);
  read_rows := pg_temp.poll_rows_read(plan);
  raise notice '4 the same page for the character that voted 20,000 times read % rows of acts under the poll CTEs, in % ms', read_rows, round((plan -> 0 ->> 'Execution Time')::numeric, 1);
  if read_rows >= 1000 then raise exception '4 the page of the character that cast 20,000 ballots read % rows of acts under the poll CTEs: its own ballot is one row, not its changes', read_rows; end if;
  perform tests.become(fan);
  doc := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  if jsonb_array_length(doc -> 'myBallots') is distinct from 1 or (doc -> 'myBallots' -> 0 ->> 'picks') is distinct from '[2]' then raise exception '4 the re-voter reads % as its own ballots: its latest is the 20,000th, which picks 20000 %% 3 = 2', doc -> 'myBallots'; end if;
  perform tests.become(rdr);
  doc := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  if jsonb_array_length(doc -> 'voters') is distinct from 50 or (doc -> 'polls' -> 0 ->> 'voters') is distinct from '51' then
    raise exception '4 the page holds % voters listed and the poll says % voters', jsonb_array_length(doc -> 'voters'), doc -> 'polls' -> 0 -> 'voters';
  end if;
end $$;
