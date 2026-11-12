-- What my_posts_written_on (supabase/migrations/0149_card_writes.sql, rewritten by 0343_writes_start_from_the_caller.sql) reads at a busy instance's
-- scale, with the statistics of an instance that has no plays yet. This is a file of its own because that state cannot be built inside
-- 0146-card-writes.sql: the cases there write a few plays before any analyze here could run, and a planner that has seen even a few plays no longer
-- prices a scan of the plays' partial index (acts_card_created, `kind = 'card'`) as cheaper than a probe of acts_layers. The statistics here are those
-- of an instance whose characters and posts have been analyzed and whose plays and texts have not: the state a grown instance is in between two analyzes.
--

-- Cases: at a busy instance's scale: 400 accounts, 2,000 characters, 40,000 posts and 10,000 plays with a text each. The caller's five characters hold 100
-- posts, each with a play, so the view has 100 rows. With the planner left free, the read of acts and of card_texts is bounded by the caller's own rows
-- and never by the instance's, whether the statistics are true or stale: the fixture is analyzed once after the characters and posts, before the plays
-- and texts exist (the statistics of an instance that has grown since its last analyze), and again after everything. The plays' index predicate holds an
-- expression with no statistics (coalesce(payload ->> 'reach', 'post')), so a flat join is priced to read the whole index in both states.
-- The rows a plan read for one relation: the rows each scan node of it passed up, plus those its filter removed and its recheck removed, times the
-- node's loops, as 0116-search.sql counts them for post_search.
create function pg_temp.rows_read(plan jsonb, rel text) returns numeric language sql as $$
  select coalesce(sum(((n ->> 'Actual Rows')::numeric + coalesce((n ->> 'Rows Removed by Filter')::numeric, 0) + coalesce((n ->> 'Rows Removed by Index Recheck')::numeric, 0)) * (n ->> 'Actual Loops')::numeric), 0)
  from jsonb_path_query(plan, '$.**') n
  where jsonb_typeof(n) = 'object' and n ->> 'Relation Name' = rel and n ->> 'Node Type' in ('Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan') $$;
create function pg_temp.explain_run(stmt text) returns jsonb language plpgsql as $$
declare plan jsonb;
begin
  execute 'explain (analyze, format json) ' || stmt into plan;
  return plan;
end $$;
-- The assertions on one analyzed run of the view, for a state's name.
create function pg_temp.check_scale_plan(state text, view_rows bigint, own_posts bigint) returns void language plpgsql as $$
declare plan jsonb; acts_read numeric; texts_read numeric; txt text;
begin
  plan := pg_temp.explain_run('select * from my_posts_written_on');
  txt := plan::text;
  acts_read := pg_temp.rows_read(plan, 'acts');
  texts_read := pg_temp.rows_read(plan, 'card_texts');
  if view_rows is distinct from 100 or own_posts is distinct from 100 then raise exception '% statistics: the caller reads % rows over % posts, not 100 over 100', state, view_rows, own_posts; end if;
  if acts_read > 2 * own_posts + 256 then raise exception '% statistics: the read touched % rows of acts for a caller with % posts: %', state, acts_read, own_posts, plan; end if;
  if texts_read > view_rows + 256 then raise exception '% statistics: the read touched % rows of card_texts for % rows: %', state, texts_read, view_rows, plan; end if;
  if txt not like '%characters\_owner%' or txt not like '%card\_texts\_play\_version\_key%'
     or exists (select 1 from jsonb_path_query(plan, '$.**') n where jsonb_typeof(n) = 'object' and n ->> 'Node Type' = 'Seq Scan' and n ->> 'Relation Name' in ('acts', 'card_texts', 'characters')) then
    raise exception '% statistics: the read is not index-led: %', state, plan;
  end if;
end $$;

do $$
declare
  base timestamptz := '2031-01-01T00:00:00Z';
  t uuid := tests.thread('Scale log thread');
  me uuid;
begin
  insert into card_kinds (key, name, alignment, rarity, play, stack, writes) values ('cw-scribe', 'Scribe', 'salty', 'uncommon', 'cast', 3, true);
  create temp table so on commit drop as select g, tests.account('cws owner ' || g) as id from generate_series(0, 399) g;
  insert into characters (id, owner, name, created_at, debuted_at)
  select ('00000000-0000-4000-9146-' || lpad(k::text, 12, '0'))::uuid, o.id, 'Cws character ' || k, base, base
  from generate_series(1, 2000) k join so o on o.g = k % 400;
  alter table acts disable trigger user;
  -- 40,000 posts, 20 for each character
  insert into acts (id, character, kind, thread, payload, seq, created_at)
  select ('00000000-0000-4000-a146-' || lpad(g::text, 12, '0'))::uuid, ('00000000-0000-4000-9146-' || lpad((g % 2000 + 1)::text, 12, '0'))::uuid, 'post', t,
         jsonb_build_object('body', 'Post ' || g), 1000 + g, base + g * interval '1 second'
  from generate_series(1, 40000) g;
  -- The statistics of an instance before its plays and texts: characters and posts only.
  analyze characters;
  analyze acts;
  -- a play on every fourth post: 10,000 plays, and a text for each
  insert into acts (id, character, kind, thread, payload, target_act_id, seq, created_at)
  select ('00000000-0000-4000-b146-' || lpad(g::text, 12, '0'))::uuid, ('00000000-0000-4000-9146-' || lpad(((g + 7) % 2000 + 1)::text, 12, '0'))::uuid, 'card', t,
         jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), ('00000000-0000-4000-a146-' || lpad(g::text, 12, '0'))::uuid, 100000 + g, base + interval '1 day' + g * interval '1 second'
  from generate_series(4, 40000, 4) g;
  alter table acts enable trigger user;
  insert into card_texts (play, version, text, created_at)
  select ('00000000-0000-4000-b146-' || lpad(g::text, 12, '0'))::uuid, ('00000000-0000-4000-a146-' || lpad(g::text, 12, '0'))::uuid, 'tail ' || g, base + interval '2 days' + g * interval '1 second'
  from generate_series(4, 40000, 4) g;

  -- The owner of characters 1, 401, 801, 1201 and 1601: 100 posts, each with a play, so 100 rows.
  me := (select id from so where g = 1);
  perform tests.become(me);
  perform pg_temp.check_scale_plan('stale', (select count(*) from my_posts_written_on),
    (select count(*) from acts p join characters c on c.id = p.character where c.owner = auth.uid() and p.kind = 'post'));
  perform tests.unbecome();

  analyze characters;
  analyze acts;
  analyze card_texts;
  analyze card_write_refunds;
  perform tests.become(me);
  perform pg_temp.check_scale_plan('analyzed', (select count(*) from my_posts_written_on),
    (select count(*) from acts p join characters c on c.id = p.character where c.owner = auth.uid() and p.kind = 'post'));
  perform tests.unbecome();
end $$;
