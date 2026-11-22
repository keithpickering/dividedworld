-- What the plays on a post cost to read at a busy instance's scale (supabase/migrations/0408_post_plays.sql, Task 3 of docs/plans/2026-11-21-post-plays-plan.md; design docs/plans/2026-11-21-post-plays-design.md, section 2, "At a busy instance's scale").
--
-- A page reads, for each post, one probe for the plays in force and two for each kind the post has had: bounded by the instance's stacks and its number of cards, at any age of the post. This is read from the plan, in 0372-origin-scale.sql's form:
-- the statement of each read is lifted out of its own definition, prepared with its arguments as parameters (the plan is then the generic one, made without their values, which is the plan the reads keep: plan_cache_mode = force_generic_plan),
-- and run under `explain (analyze, format json)`; the nodes that read a relation are counted (each scan node's rows, plus those its filter and its recheck removed, times its loops).
-- The kept tables are no signed-in player's, so the two reads of them (post_play_ids and kind_play_ids, the definers behind post_plays, kind_plays and thread_page) are measured as the test's own role; thread_page's own statement is measured as a reader.
--
-- The fixture: one post of 5,000 plays of 6 kinds, 4 in force (one each of four kinds), 300 of them drawn, in a thread of 6,000 posts, among 12,000 other posts in two threads with 6,000 plays between them.
--  1. post_play_ids reads at most 4 + 2 x 6 + 8 rows of play_post and no row of acts, and does not scan play_post or post_kinds sequentially.
--  2. thread_page, for the page that holds the post, reads at most that many Acts for the post's plays (its in force and stand-ins, their riders), and does not scan acts sequentially in the nodes that read them.
--  3. kind_play_ids reads at most `size` + the plays of the kind in force + 1 rows of play_post, on the first page and on a page deep in the kind's history.
--  4. The poison: with play_post_drawn dropped, the row bound of 1 goes red; so does the bound of 3 with play_post_newest dropped.
-- The fixture is written with the append-only and warn-guard triggers off for this transaction only (the runner rolls it back), the kept tables are filled from play_row as the migration's backfill fills them, and analyzed before the plan is read.

-- The nodes of a plan that read a relation, optionally only those under the named CTEs.
create function pg_temp.scan_nodes(plan jsonb, under text[]) returns setof jsonb language sql as $$
  select d from jsonb_path_query(plan, '$.**') c, jsonb_path_query(c, '$.**') d
  where jsonb_typeof(c) = 'object' and (under is null and c ? 'Plan' or c ->> 'Subplan Name' = any (under))
    and jsonb_typeof(d) = 'object' and d ? 'Node Type'
$$;

-- The rows of a relation that a plan's scan nodes read: a node's rows passed up, plus those its filter and its recheck removed, times its loops.
create function pg_temp.rows_read(plan jsonb, rel text, under text[] default null) returns numeric language sql as $$
  select coalesce(sum(((n ->> 'Actual Rows')::numeric + coalesce((n ->> 'Rows Removed by Filter')::numeric, 0) + coalesce((n ->> 'Rows Removed by Index Recheck')::numeric, 0)) * (n ->> 'Actual Loops')::numeric), 0)
  from (select distinct d from pg_temp.scan_nodes(plan, under) d) z(n)
  where n ->> 'Relation Name' = rel and n ->> 'Node Type' in ('Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan')
$$;

-- The scan nodes of a plan that read more than 100 rows of a relation, as text, for a failure's message.
create function pg_temp.big_reads(plan jsonb, under text[] default null) returns text language sql as $$
  select coalesce(string_agg(format('%s %s %s rows %s x %s, removed %s', n ->> 'Node Type', n ->> 'Relation Name', coalesce(n ->> 'Index Name', ''), n ->> 'Actual Rows', n ->> 'Actual Loops', coalesce(n ->> 'Rows Removed by Filter', '0')), '; '), 'none')
  from (select distinct d from pg_temp.scan_nodes(plan, under) d) z(n)
  where n ? 'Relation Name' and ((n ->> 'Actual Rows')::numeric + coalesce((n ->> 'Rows Removed by Filter')::numeric, 0)) * (n ->> 'Actual Loops')::numeric > 100
$$;

create function pg_temp.seq_scans(plan jsonb, rel text, under text[] default null) returns bigint language sql as $$
  select count(*) from (select distinct d from pg_temp.scan_nodes(plan, under) d) z(n) where n ->> 'Node Type' = 'Seq Scan' and n ->> 'Relation Name' = rel
$$;

-- The statement of a function, from its definition: the body of a `language sql` function, between the dollar quotes.
create function pg_temp.sql_body(fn regprocedure) returns text language plpgsql as $$
declare def text := pg_get_functiondef(fn); body text;
begin
  body := substring(def from E'(?s)\\$function\\$\\n?(.*?)\\n?\\$function\\$');
  if body is null then raise exception 'the statement of % is not found in its definition: the scale test cannot read its plan', fn; end if;
  return body;
end $$;

-- The plan of a prepared statement, generic, run as the current role: `prep` is the `prepare` text (with its parameter types), `call` the execute text.
create function pg_temp.generic_plan_of(prep text, call text) returns jsonb language plpgsql as $$
declare plan jsonb;
begin
  execute prep;
  perform set_config('plan_cache_mode', 'force_generic_plan', true);
  perform set_config('jit', 'off', true);
  execute 'explain (analyze, format json) ' || call into plan;
  execute 'deallocate ppl_q';
  perform set_config('plan_cache_mode', 'auto', true);
  return plan;
end $$;

-- post_play_ids's plan for `posts`.
create function pg_temp.ids_plan(posts uuid[]) returns jsonb language plpgsql as $$
declare body text := pg_temp.sql_body('post_play_ids(uuid[])'::regprocedure);
begin
  body := regexp_replace(body, '\mpost_play_ids\.posts\M', '$1', 'g');
  return pg_temp.generic_plan_of('prepare ppl_q(uuid[]) as ' || body, format('execute ppl_q(%L)', posts));
end $$;

-- kind_play_ids's plan: the page of a kind's plays that are over.
create function pg_temp.page_plan(p uuid, k text, b_at timestamptz, b_id uuid, lim integer) returns jsonb language plpgsql as $$
declare body text := pg_temp.sql_body('kind_play_ids(uuid, text, timestamptz, uuid, integer)'::regprocedure);
begin
  body := regexp_replace(body, '\mkind_play_ids\.post\M', '$1', 'g');
  body := regexp_replace(body, '\mkind_play_ids\.card\M', '$2', 'g');
  body := regexp_replace(body, '\mkind_play_ids\.before_at\M', '$3', 'g');
  body := regexp_replace(body, '\mkind_play_ids\.before_id\M', '$4', 'g');
  body := regexp_replace(body, '\mkind_play_ids\.lim\M', '$5', 'g');
  return pg_temp.generic_plan_of('prepare ppl_q(uuid, text, timestamptz, uuid, integer) as ' || body, format('execute ppl_q(%L, %L, %L, %L, %s)', p, k, b_at, b_id, lim));
end $$;

-- thread_page's own statement, generic, as `acct`: the plan of `thread_page(t, pg, null, per, '{ppsk1}')`.
create function pg_temp.page_statement_plan(acct uuid, t uuid, pg integer, per integer) returns jsonb language plpgsql as $$
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
  execute 'prepare ppl_q(uuid, integer, integer, integer, text[]) as select (' || body || ')';
  perform set_config('plan_cache_mode', 'force_generic_plan', true);
  perform set_config('jit', 'off', true);
  perform tests.become(acct);
  execute format($q$explain (analyze, format json) execute ppl_q(%L, %s, null, %s, '{ppsk1}')$q$, t, pg, per) into plan;
  perform tests.unbecome();
  execute 'deallocate ppl_q';
  perform set_config('plan_cache_mode', 'auto', true);
  return plan;
end $$;

-- Case 1's bound, raising when it is broken: the plays of a post read at most 4 in force + 2 stand-ins for each of 6 kinds + 8 of slack, and nothing of acts.
create function pg_temp.check_ids_bound(p uuid) returns numeric language plpgsql as $$
declare plan jsonb := pg_temp.ids_plan(array[p]); n numeric := pg_temp.rows_read(plan, 'play_post');
begin
  if n > 4 + 2 * 6 + 8 then raise exception 'ROWBOUND post_play_ids read % rows of play_post for a post of 5,000 plays: at most 4 + 2 x 6 + 8 = 24', n; end if;
  if pg_temp.rows_read(plan, 'acts') > 0 then raise exception 'post_play_ids reads acts: %', plan; end if;
  if pg_temp.seq_scans(plan, 'play_post') + pg_temp.seq_scans(plan, 'post_kinds') + pg_temp.seq_scans(plan, 'acts') > 0 then raise exception 'post_play_ids scans a table in sequence: %', plan; end if;
  return n;
end $$;

-- Case 3's bound: a page of `lim` of a kind's plays that are over reads at most lim + the kind's plays in force + 1 rows of play_post.
create function pg_temp.check_page_bound(p uuid, k text, b_at timestamptz, b_id uuid, lim integer, in_force integer) returns numeric language plpgsql as $$
declare plan jsonb := pg_temp.page_plan(p, k, b_at, b_id, lim + 1); n numeric := pg_temp.rows_read(plan, 'play_post');
begin
  -- kind_plays asks for one more than the page, to know whether more are left.
  if n > lim + in_force + 1 then raise exception 'ROWBOUND kind_play_ids read % rows of play_post for a page of %: at most % + % + 1', n, lim, lim, in_force; end if;
  if pg_temp.rows_read(plan, 'acts') > 0 then raise exception 'kind_play_ids reads acts: %', plan; end if;
  if pg_temp.seq_scans(plan, 'play_post') + pg_temp.seq_scans(plan, 'post_kinds') + pg_temp.seq_scans(plan, 'acts') > 0 then raise exception 'kind_play_ids scans a table in sequence: %', plan; end if;
  return n;
end $$;

-- The live veils that earlier files of a run may have left (the committed rows of a race, say) cost every read through acts_public a probe of `acts` for each Act it shows, whatever the Acts are: the view's own cost, which the plays'
-- reads under test do not change. This transaction ends them (a card_end, as reverse_card writes it, under the writer flag), so the rows counted are the plays', and the runner rolls them back.
create function pg_temp.end_live_veils() returns void language plpgsql as $$
begin
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  select null, 'card_end', a.thread, v.play, '{"why": "reversed", "by": "admin"}'
  from post_veils v join acts a on a.id = v.play
  where v.ends_at > now() and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = v.play);
  perform set_config('kayfabb.card_end_writer', '', true);
end $$;

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('pps-ann'); a uuid := tests.character(ann, 'Pps Author'); rdr uuid := tests.account('pps-rdr'); rc uuid := tests.character(rdr, 'Pps Reader');
  casters uuid[] := '{}'; t0 uuid := tests.thread('Pps famous thread'); t_other uuid := tests.thread('Pps other thread');
  p uuid; k integer; n numeric; plan jsonb; first_page_last timestamptz; nid uuid; nat timestamptz; doc jsonb; got text;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, stack)
  select 'ppsk' || g, 'Pps Kind ' || g, 'sweet', 'common', 'cast', null, '{post}', null, 8 from generate_series(1, 6) g;
  for k in 1..5 loop casters := casters || tests.character(tests.account('pps-caster-' || k), 'Pps Caster ' || k); end loop;
  p := tests.post(a, t0, 'The famous post.', now() - interval '90 days');

  alter table acts disable trigger user;
  -- 5,000 plays of 6 kinds on the famous post, a minute apart, each over 10 minutes later but the last four, which have a day to run (one each of four kinds).
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select casters[g % 5 + 1], 'card', t0, p,
         jsonb_build_object('card', 'ppsk' || (g % 6 + 1), 'message', '', 'config', '{}'::jsonb, 'layer', g,
                            'ends', case when g > 4996 then now() + interval '1 day' else now() - interval '60 days' + g * interval '1 minute' + interval '10 minutes' end),
         now() - interval '60 days' + g * interval '1 minute'
  from generate_series(1, 5000) g;
  -- 12,000 other posts in two threads, and 6,000 plays on them, which the famous post's reads must never touch.
  insert into acts (character, kind, thread, payload, seq, created_at)
  select casters[g % 5 + 1], 'post', case when g % 2 = 0 then t0 else t_other end, jsonb_build_object('body', 'Post ' || g), 1000 + g, now() - interval '59 days' + g * interval '1 second' from generate_series(1, 12000) g;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select a2.character, 'card', a2.thread, a2.id, jsonb_build_object('card', 'ppsk' || (a2.seq % 6 + 1), 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', a2.created_at + interval '20 minutes'), a2.created_at + interval '1 minute'
  from acts a2 where a2.kind = 'post' and a2.thread in (t0, t_other) and a2.seq between 1001 and 7000;
  alter table acts enable trigger user;
  update threads t set next_seq = coalesce((select max(x.seq) from acts x where x.thread = t.id), 0) + 1 where t.id in (t0, t_other);

  perform pg_temp.end_live_veils();
  -- The kept tables of the fixture's own threads (earlier files of a run may have committed plays, whose rows the triggers kept), as the migrations' backfills fill them; then the draw, as react's tallies add it.
  insert into play_post select r.* from acts x cross join lateral play_row(x.id) r where x.kind in ('card', 'set') and x.target_act_id is not null and x.thread in (t0, t_other);
  insert into post_kinds (post, kind, plays, took) select pp.post, pp.kind, sum(c.plays), sum(c.took) from play_post pp cross join lateral play_post_counts(pp) c where pp.post in (select y.id from acts y where y.thread in (t0, t_other)) group by pp.post, pp.kind having sum(c.plays) > 0;
  insert into reaction_tallies (act, kind, count)
  select x.id, 'up', (extract(epoch from x.created_at)::bigint % 41)::integer + 1 from acts x where x.target_act_id = p and x.kind = 'card' and (extract(epoch from x.created_at)::bigint / 60) % 17 = 0;
  analyze acts; analyze play_post; analyze post_kinds; analyze threads;
  if (select count(*) from play_post where post = p) is distinct from 5000::bigint or (select count(*) from play_post where post = p and over_at is null and (ends_at is null or ends_at > now())) is distinct from 4::bigint
     or (select count(*) from post_kinds where post = p) is distinct from 6::bigint then
    raise exception 'the fixture is not a post of 5,000 plays of 6 kinds with 4 in force: % % %', (select count(*) from play_post where post = p), (select count(*) from play_post where post = p and over_at is null and (ends_at is null or ends_at > now())), (select count(*) from post_kinds where post = p);
  end if;
  if (select count(*) from play_post where post = p and drawn > 0) < 200 then raise exception 'the fixture draws too little'; end if;
  if exists (select 1 from play_post_drift()) then raise exception 'the fixture drifts'; end if;

  -- 1. post_play_ids.
  n := pg_temp.check_ids_bound(p);
  raise notice '1 post_play_ids read % rows of play_post for a post of 5,000 plays of 6 kinds (4 in force), with 17,000 others about', n;
  -- The answer: the 4 in force and each kind's newest and most drawn, distinct.
  if (select count(*) from post_play_ids(array[p])) not between 6 and 16 then raise exception '1 post_play_ids answered % plays', (select count(*) from post_play_ids(array[p])); end if;

  -- 2. thread_page: the page that holds the famous post, as a reader.
  plan := pg_temp.page_statement_plan(rdr, t0, 1, 20);
  n := pg_temp.rows_read(plan, 'acts', array['CTE on_posts', 'CTE on_all', 'CTE ends_on_posts']);
  raise notice '2 thread_page read % rows of acts for the post''s plays, their riders and ends', n;
  -- The meter sees the reads: the same nodes counted without the CTE names find rows of acts in the plan, and the plays' own nodes are among them.
  if n < 6 then raise exception '2 the meter sees %s rows of acts under the plays'' CTEs, so it reads nothing: %', n, plan; end if;
  if n > 2 * (4 + 2 * 6) + 8 then raise exception '2 thread_page read % rows of acts for the post''s plays: at most 2 x (4 + 2 x 6) + 8 = 40 (acts_public is two arms, each read by id); the big reads: %', n, pg_temp.big_reads(plan, array['CTE on_posts', 'CTE on_all', 'CTE ends_on_posts']); end if;
  if pg_temp.seq_scans(plan, 'acts', array['CTE on_posts', 'CTE on_all', 'CTE ends_on_posts']) > 0 or pg_temp.seq_scans(plan, 'play_post', array['CTE on_posts', 'CTE on_all', 'CTE ends_on_posts']) > 0 then raise exception '2 the plays'' reads scan a table in sequence: %', plan; end if;
  -- Every page of the thread, as a reader, answers the plays of the famous post: 4 in force and at most 12 stand-ins.
  perform tests.become(rdr);
  doc := thread_page(t0, 1, null, 20, array['ppsk1']);
  perform tests.unbecome();
  if (select count(*) from jsonb_array_elements(doc -> 'plays') x where x ->> 'target_act_id' = p::text and x ->> 'kind' = 'card') not between 6 and 16 then raise exception '2 the page holds % plays of the famous post', (select count(*) from jsonb_array_elements(doc -> 'plays') x where x ->> 'target_act_id' = p::text); end if;
  if jsonb_array_length(doc -> 'counts') is distinct from (select count(distinct (x ->> 'card')) from jsonb_array_elements(doc -> 'counts') x where x ->> 'post' = p::text) + (select count(*) from jsonb_array_elements(doc -> 'counts') x where x ->> 'post' <> p::text) then raise exception '2 counts'; end if;

  -- 3. kind_play_ids: the first page and a page deep in the kind's history.
  n := pg_temp.check_page_bound(p, 'ppsk1', null, null, 20, 1);
  raise notice '3 the first page of 20 of a kind of 833 plays read % rows of play_post', n;
  select x.played_at, x.play into nat, nid from play_post x where x.post = p and x.kind = 'ppsk1' and not (x.over_at is null and (x.ends_at is null or x.ends_at > now())) order by x.played_at desc, x.play desc offset 400 limit 1;
  n := pg_temp.check_page_bound(p, 'ppsk1', nat, nid, 20, 0);  -- the plays in force are newer than the cursor and are never read
  raise notice '3 a page of 20 after the 400th read % rows of play_post', n;
  -- A kind with a play in force skips it: ppsk6's (g = 4997) is the newest and in force.
  n := pg_temp.check_page_bound(p, 'ppsk6', null, null, 20, 1);
  raise notice '3 a page of a kind with a play in force read % rows of play_post', n;

  -- 4. The poison: the same bounds go red with the index the bound rests on withheld.
  drop index play_post_drawn;
  got := pg_temp.coded(format('select pg_temp.check_ids_bound(%L)', p));
  if got is null or got not like '%ROWBOUND%' then raise exception '4 post_play_ids''s row bound did not go red with play_post_drawn dropped: %', coalesce(got, 'it passed'); end if;
  raise notice '4 without play_post_drawn: %', got;
  drop index play_post_newest;
  got := pg_temp.coded(format('select pg_temp.check_page_bound(%L, %L, null, null, 20, 1)', p, 'ppsk1'));
  if got is null or got not like '%ROWBOUND%' then raise exception '4 kind_play_ids''s row bound did not go red with play_post_newest dropped: %', coalesce(got, 'it passed'); end if;
  raise notice '4 without play_post_newest: %', got;
end $$;
