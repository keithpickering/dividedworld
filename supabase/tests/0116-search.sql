-- The search index (supabase/migrations/0117_search.sql; docs/plans/2026-11-07-search-design.md sections 2, 3, 4 and 6; its plan, Task 2).
--
-- 1. A post, a spin and a Mod Bot's post each get a post_search row; a card play, a tally, a reveal and an announce get none.
-- 2. A thread's first post carries its thread's title at weight A, so a title and a post match in one index; a later post does not.
-- 3. An edit changes what the post matches, and a second edit again; an older edit written late does not undo a newer one; only the current version is indexed.
-- 4. A quoted post's words do not match the quoter (bbcode_plain, not raw BBCode).
-- 5. The backfill indexes a post written before the trigger, by its current version.
-- 6. searchLanguage changed: the rebuild is recorded, the job's body (search_rebuild_step) rewrites rows in Act-id order a batch at a time until none is left
--    in the old language and the record is gone; the job is scheduled.
-- 7. Each of the two settings refuses what it should, naming its key, with 23514.
-- 8. The table is behind row level security, readable by signed-in players alone; the trigram indexes exist; the screens read the two settings.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

insert into settings (key, value) values ('searchLanguage', '"english"'), ('searchRankPool', '5000');
-- Rows another file committed (a race test does) make the first write of the language record a rebuild; this file starts with none under way.
delete from search_rebuild;

create function pg_temp.matches(act_id uuid, q text) returns boolean language sql as $$
  select coalesce((select words @@ websearch_to_tsquery('english', q) from post_search where act = act_id), false)
$$;

do $test$
declare
  ann uuid := tests.account('ann');
  mod_bot uuid;
  a uuid := tests.character(ann, 'Alice');
  b uuid := tests.character(ann, 'Bobby');
  t1 uuid := tests.thread('Dancing walruses');
  t2 uuid := tests.thread('Another thread');
  first_post uuid;
  second_post uuid;
  origin uuid;
  spun_thread uuid;
  spun uuid;
  botpost uuid;
  before_count bigint;
  card uuid;
  announced uuid;
  e1 uuid;
  quoted uuid;
  quoter uuid;
  late_edit uuid;
  r record;
begin
  insert into characters (name, created_at, debuted_at, staff, staff_kind)
  values ('Modbot', now(), now(), 'search-mod', 'persona') returning id into mod_bot;

  -- 1. Which Acts get a row.
  first_post := tests.post(a, t1, 'Cats love running through gardens.');
  if (select count(*) from post_search where act = first_post and thread = t1 and character = a) is distinct from 1 then
    raise exception 'a post got no search row';
  end if;
  if (select created_at from post_search where act = first_post) is distinct from (select created_at from acts where id = first_post) then
    raise exception 'the row does not carry its Act''s time';
  end if;
  if not pg_temp.matches(first_post, 'garden') then raise exception 'the post does not match a stem of its words (garden)'; end if;
  if pg_temp.matches(first_post, 'dogs') then raise exception 'the post matches a word it does not hold'; end if;

  second_post := tests.post(b, t1, 'Dogs prefer swimming.');
  if not pg_temp.matches(second_post, 'swim') then raise exception 'a second post does not match its words'; end if;

  origin := tests.post(a, t2, 'The origin of a spin.');
  spun_thread := tests.thread('Spun thread title');
  spun := tests.act(b, 'spin', spun_thread, jsonb_build_object('title', 'Spun thread title', 'body', 'Spinning around.'), origin);
  if (select count(*) from post_search where act = spun and thread = spun_thread and character = b) is distinct from 1 then raise exception 'a spin got no search row'; end if;
  if not pg_temp.matches(spun, 'spinning') then raise exception 'a spin does not match its body'; end if;

  perform set_config('kayfabb.staff_writer', 'on', true);
  botpost := tests.post(mod_bot, t2, 'Please keep it civil, citizens.');
  perform set_config('kayfabb.staff_writer', '', true);
  if (select count(*) from post_search where act = botpost and character = mod_bot) is distinct from 1 then raise exception 'a Mod Bot''s post got no search row'; end if;

  before_count := (select count(*) from post_search);
  card := tests.act(b, 'card', t1, '{}', first_post);
  perform tests.act(null, 'tally', t1);
  perform tests.act(null, 'reveal', t1);
  announced := tests.act(a, 'announce', t1, '{"what": "debut"}');
  if (select count(*) from post_search) is distinct from before_count then raise exception 'a card play, a tally, a reveal or an announce got a search row'; end if;
  if exists (select 1 from post_search where act = card) then raise exception 'a card play got a search row'; end if;
  if exists (select 1 from post_search where act = announced) then raise exception 'an announce got a search row'; end if;

  -- 2. Titles at weight A, on a thread's first post alone (seq 1), so the title matches there and nowhere else.
  if not pg_temp.matches(first_post, 'walrus') then raise exception 'the first post of a thread does not match its title'; end if;
  if pg_temp.matches(second_post, 'walrus') then raise exception 'a later post matches its thread''s title'; end if;
  if (select words @@ websearch_to_tsquery('english', 'walrus') from post_search where act = first_post) is not true
     or (select ts_filter(words, '{a}') @@ websearch_to_tsquery('english', 'walrus') from post_search where act = first_post) is not true then
    raise exception 'the title is not at weight A';
  end if;
  if (select ts_filter(words, '{a}') @@ websearch_to_tsquery('english', 'garden') from post_search where act = first_post) then
    raise exception 'a body word is at weight A';
  end if;
  if not pg_temp.matches(spun, 'spun') then raise exception 'a spin does not match its thread''s title'; end if;

  -- 3. Edits: only the current version.
  e1 := tests.act(a, 'edit', t1, '{"body": "Ferrets love running through gardens."}', first_post, now() + interval '1 second');
  if pg_temp.matches(first_post, 'cats') then raise exception 'a post still matches a word its author took out'; end if;
  if not pg_temp.matches(first_post, 'ferrets') then raise exception 'an edit did not change what the post matches'; end if;
  if not pg_temp.matches(first_post, 'walrus') then raise exception 'an edit of a first post lost its title'; end if;
  if (select count(*) from post_search where act = first_post) is distinct from 1 then raise exception 'an edit made a second row'; end if;
  perform tests.act(a, 'edit', t1, '{"body": "Otters love running through gardens."}', first_post, now() + interval '2 seconds');
  if pg_temp.matches(first_post, 'ferrets') or not pg_temp.matches(first_post, 'otters') then raise exception 'a second edit did not change what the post matches'; end if;
  -- An edit written late, but made before the latest, is not the current version.
  late_edit := tests.act(a, 'edit', t1, '{"body": "Moles love running through gardens."}', first_post, now() + interval '1500 milliseconds');
  if pg_temp.matches(first_post, 'moles') or not pg_temp.matches(first_post, 'otters') then raise exception 'an older edit written late replaced the latest'; end if;

  -- 4. A quote's words are not the quoter's.
  quoted := tests.post(b, t2, 'Zebras are fast animals.');
  quoter := tests.post(a, t2, '[quote=' || quoted || ']Zebras are fast animals.[/quote] I [b]agree[/b] entirely.');
  if pg_temp.matches(quoter, 'zebras') then raise exception 'a quoted post''s words match the quoter'; end if;
  if pg_temp.matches(quoter, 'quote') then raise exception 'BBCode tag names are indexed'; end if;
  if not pg_temp.matches(quoter, 'agree') then raise exception 'the quoter''s own words are not indexed'; end if;

  -- 5. The backfill: a post written while the trigger is off, and one edited while it is off.
  alter table acts disable trigger acts_search;
  declare
    old_post uuid := tests.post(a, t2, 'Giraffes reach tall branches.');
    old_edited uuid := tests.post(b, t2, 'Hippos wallow in mud.');
  begin
    perform tests.act(b, 'edit', t2, '{"body": "Rhinos wallow in mud."}', old_edited, now() + interval '1 second');
    alter table acts enable trigger acts_search;
    if exists (select 1 from post_search where act in (old_post, old_edited)) then raise exception 'a disabled trigger still wrote a row'; end if;
    perform search_backfill();
    if not pg_temp.matches(old_post, 'giraffe') then raise exception 'the backfill did not index a post written before the trigger'; end if;
    if not pg_temp.matches(old_edited, 'rhino') or pg_temp.matches(old_edited, 'hippo') then raise exception 'the backfill did not index the post''s current version'; end if;
    if (select count(*) from post_search) is distinct from (select count(*) from acts where kind in ('post', 'spin')) then raise exception 'the backfill left a post or a spin without a row'; end if;
    before_count := (select count(*) from post_search);
    perform search_backfill();
    if (select count(*) from post_search) is distinct from before_count then raise exception 'the backfill is not idempotent'; end if;
  end;

  -- 6. A language change: recorded, then rewritten by the job's body a batch at a time.
  if exists (select 1 from search_rebuild) then raise exception 'a rebuild was recorded before the language changed'; end if;
  if not exists (select 1 from cron.job where jobname = 'kayfabb-search-rebuild' and command like '%search_rebuild_step%') then raise exception 'the rebuild job is not scheduled'; end if;
  update settings set value = '"english"' where key = 'searchLanguage';
  if exists (select 1 from search_rebuild) then raise exception 'a write of the same language recorded a rebuild'; end if;
  update settings set value = '"simple"' where key = 'searchLanguage';
  if (select count(*) from search_rebuild) is distinct from 1 then raise exception 'a language change recorded no rebuild'; end if;
  if not pg_temp.matches(quoter, 'agree') then raise exception 'rows changed language before the job ran'; end if;
  before_count := (select count(*) from post_search);
  if search_rebuild_step(2) <> 2 then raise exception 'a run of 2 did not rewrite 2 rows'; end if;
  if (select count(*) from search_rebuild) is distinct from 1 then raise exception 'the rebuild ended after its first run'; end if;
  loop
    exit when search_rebuild_step(3) = 0 and not exists (select 1 from search_rebuild);
  end loop;
  if exists (select 1 from search_rebuild) then raise exception 'the rebuild record outlived the rebuild'; end if;
  if (select count(*) from post_search) is distinct from before_count then raise exception 'the rebuild changed the number of rows'; end if;
  for r in select p.act, p.words, search_words(a2.current_payload ->> 'body',
                                               case when a2.seq = 1 then (select title from threads where id = a2.thread) end) as want
           from post_search p join acts_public a2 on a2.id = p.act loop
    if r.words is distinct from r.want then raise exception 'row % was not rewritten in the new language', r.act; end if;
  end loop;
  if exists (select 1 from post_search where words @@ to_tsquery('english', 'garden') and not words @@ to_tsquery('simple', 'garden')) then
    raise exception 'a row is left in the old language';
  end if;
  if not (select words @@ to_tsquery('simple', 'gardens') from post_search where act = first_post) then raise exception 'the rebuilt row does not match the new language''s words'; end if;
  if (select words @@ to_tsquery('simple', 'garden') from post_search where act = first_post) then raise exception 'the rebuilt row is still stemmed'; end if;
  -- A change while a rebuild is under way starts it again from the beginning.
  update settings set value = '"english"' where key = 'searchLanguage';
  perform search_rebuild_step(1);
  update settings set value = '"simple"' where key = 'searchLanguage';
  if (select after_act from search_rebuild) is not null then raise exception 'a second change did not restart the rebuild'; end if;
  loop exit when search_rebuild_step() = 0; end loop;
  if exists (select 1 from search_rebuild) then raise exception 'the restarted rebuild did not end'; end if;
  -- An empty run is not an error.
  if search_rebuild_step() <> 0 then raise exception 'a run with nothing to rebuild rewrote rows'; end if;
end
$test$;

-- 7. The two settings.
do $test$
declare
  got text;
  v text;
begin
  for v in select unnest(array['"klingon"', '5', 'null', '""', 'true', '["english"]']) loop
    got := pg_temp.refusal(format($s$update settings set value = %L::jsonb where key = 'searchLanguage'$s$, v));
    if got is null or got not like '23514: searchLanguage is %' then raise exception 'searchLanguage % was not refused with its key: %', v, got; end if;
  end loop;
  for v in select unnest(array['99', '100001', '1.5', '"5000"', 'null', '-1', 'true']) loop
    got := pg_temp.refusal(format($s$update settings set value = %L::jsonb where key = 'searchRankPool'$s$, v));
    if got is null or got not like '23514: searchRankPool is %' then raise exception 'searchRankPool % was not refused with its key: %', v, got; end if;
  end loop;
  for v in select unnest(array['100', '5000', '100000']) loop
    got := pg_temp.refusal(format($s$update settings set value = %L::jsonb where key = 'searchRankPool'$s$, v));
    if got is not null then raise exception 'searchRankPool % was refused: %', v, got; end if;
  end loop;
  got := pg_temp.refusal($s$update settings set value = '"english"' where key = 'searchLanguage'$s$);
  if got is not null then raise exception 'a configuration pg_ts_config holds was refused: %', got; end if;
  got := pg_temp.refusal($s$insert into settings (key, value) values ('searchLanguage2', '1')$s$);
  if got is not null then raise exception 'an unrelated key was refused: %', got; end if;
end
$test$;

-- 8. Row level security, the indexes, the screens.
do $test$
declare
  ann uuid := tests.account('reader');
  who uuid := tests.character(ann, 'Reader');
  p uuid := tests.post(who, tests.thread('Readable'), 'Readable words.');
  seen bigint;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.post_search'::regclass) then raise exception 'post_search is not behind row level security'; end if;
  perform tests.become(ann);
  select count(*) into seen from post_search where act = p;
  perform tests.unbecome();
  if seen <> 1 then raise exception 'a signed-in player cannot read the index'; end if;
  perform tests.become_anon();
  begin
    select count(*) into seen from post_search where act = p;
    perform tests.unbecome();
    raise exception 'a visitor can read the index';
  exception when insufficient_privilege then
    perform tests.unbecome();
  end;
  perform tests.become(ann);
  begin
    delete from post_search where act = p;
    perform tests.unbecome();
    raise exception 'a player can delete from the index';
  exception when insufficient_privilege then
    perform tests.unbecome();
  end;

  if not exists (select 1 from pg_indexes where tablename = 'post_search' and indexdef like '%gin (words)%') then raise exception 'no GIN index on words'; end if;
  if not exists (select 1 from pg_indexes where tablename = 'post_search' and indexdef like '%(created_at DESC, act DESC)%') then raise exception 'no (created_at desc, act desc) index'; end if;
  if not exists (select 1 from pg_indexes where tablename = 'post_search' and indexdef like '%character%, created_at DESC)%') then raise exception 'no (character, created_at desc) index'; end if;
  if not exists (select 1 from pg_indexes where tablename = 'post_search' and indexdef like '%(thread, created_at DESC, act DESC)%') then raise exception 'no (thread, created_at desc, act desc) index'; end if;
  if not exists (select 1 from pg_indexes where tablename = 'post_search' and indexdef like '%gin (((board)::text), words) WHERE first%') then raise exception 'no partial GIN index on (board::text, words) where first'; end if;
  if not exists (select 1 from pg_indexes where tablename = 'post_search' and indexdef like '%gin (((board)::text), words)' and indexdef not like '%WHERE%') then raise exception 'no GIN index on (board::text, words)'; end if;
  if not exists (select 1 from pg_indexes where tablename = 'post_search' and indexdef like '%gin (words) WHERE first%') then raise exception 'no partial GIN index on words where first'; end if;
  if not exists (select 1 from pg_indexes where tablename = 'threads' and indexdef like '%gin_trgm_ops%' and indexdef like '%fold_text(title)%') then raise exception 'no trigram index on thread titles'; end if;
  if not exists (select 1 from pg_indexes where tablename = 'characters' and indexdef like '%gin_trgm_ops%' and indexdef like '%fold_text(name)%') then raise exception 'no trigram index on character names'; end if;

  if fold_text('Mário ÉCLAIR') <> 'mario eclair' then raise exception 'fold_text does not lower and unaccent: %', fold_text('Mário ÉCLAIR'); end if;
  if (select provolatile from pg_proc where proname = 'fold_text') is distinct from 'i' then raise exception 'fold_text is not immutable'; end if;
  if (select extensions.similarity(fold_text('Mario'), fold_text('mairo'))) <= 0.1 then raise exception 'the trigram extension is not in reach of fold_text'; end if;

  perform tests.become(ann);
  select count(*) into seen from screen_settings s where s.settings ? 'searchRankPool' and s.settings ? 'searchLanguage';
  perform tests.unbecome();
  if seen <> 1 then raise exception 'the screens do not read searchLanguage and searchRankPool'; end if;
end
$test$;

-- ------------------------------------------------------------------------------------------------- Task 3: the reads ----
--
-- 9.  search_posts: each filter alone and together (text, author, board, time range, titles only); each sort (relevance equals ts_rank_cd's order); the Updates thread is never found and an
--     unlisted thread is; a snippet is the post's plain words with <<, >> around the match and no HTML; the post's page in its thread; the marks of the cards live on it, at most 8.
-- 10. The cursor walks a result set, whatever the sort, with no repeat and no gap; the count stops at 1,001 and `more` says past 1,000; a pool lowered to its least sets `pooled` and bounds what
--     relevance reaches; the pool's flag is off when the pool was not full.
-- 11. An author who is not a debuted character finds exactly what a random id finds, which is nothing.
-- 12. search_threads: one result for each thread with its matches counted to 100; the same filters, sorts and cursor.
-- 13. search_suggest: "mairo" and "MAR" find Mario; a character who has not debuted is never suggested; an accent folds; an empty prefix lists the newest threads; the system board can be left out;
--     suggest_characters shows what characters_public shows and nothing that changes with who asks or who owns.
-- 14. Every refusal, with the refusal hint and 22023; a visitor is refused; the functions are invokers and stable, the one definer pins its search_path.
-- The plans of what a search runs are read in the scale test (this file's last block).

create function pg_temp.sp(q text default null, author uuid default null, board uuid default null, from_at timestamptz default null, to_at timestamptz default null,
                           titles_only boolean default false, sort text default null, after jsonb default null, per_page integer default null) returns jsonb
language sql as $$ select search_posts(q, author, board, from_at, to_at, titles_only, sort, after, per_page) $$;
create function pg_temp.st(q text default null, author uuid default null, board uuid default null, from_at timestamptz default null, to_at timestamptz default null,
                           titles_only boolean default false, sort text default null, after jsonb default null, per_page integer default null) returns jsonb
language sql as $$ select search_threads(q, author, board, from_at, to_at, titles_only, sort, after, per_page) $$;
-- The acts, or the threads, of a result page in order.
create function pg_temp.acts_of(j jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((r ->> 'act')::uuid order by o), '{}') from jsonb_array_elements(j -> 'results') with ordinality as t(r, o) $$;
create function pg_temp.threads_of(j jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((r ->> 'thread')::uuid order by o), '{}') from jsonb_array_elements(j -> 'results') with ordinality as t(r, o) $$;
-- Every page of a search in order by following `next`, one `per` at a time (posts or threads); fails if a page repeats a result or the walk does not end.
create function pg_temp.walk(kind text, q text, author uuid, board uuid, sort text, per integer, titles boolean default false) returns uuid[] language plpgsql as $$
declare
  got uuid[] := '{}';
  page jsonb;
  after jsonb := null;
  ids uuid[];
  guard integer := 0;
begin
  loop
    page := case when kind = 'posts' then pg_temp.sp(q => q, author => author, board => board, sort => sort, after => after, per_page => per, titles_only => titles)
                 else pg_temp.st(q => q, author => author, board => board, sort => sort, after => after, per_page => per, titles_only => titles) end;
    ids := case when kind = 'posts' then pg_temp.acts_of(page) else pg_temp.threads_of(page) end;
    if exists (select 1 from unnest(ids) i where i = any (got)) then raise exception 'a page repeated a result (% % %)', kind, q, sort; end if;
    got := got || ids;
    after := page -> 'next';
    exit when after is null or after = 'null'::jsonb;
    guard := guard + 1;
    if guard > 5000 then raise exception 'the walk does not end'; end if;
  end loop;
  return got;
end $$;
create function pg_temp.hint_of(stmt text) returns text language plpgsql as $$
declare hint text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics hint = pg_exception_hint;
  return sqlstate || '/' || coalesce(hint, '');
end $$;

-- The setting the reads use, at its ordinary value, the language they were written for, and every row in it.
update settings set value = '5000' where key = 'searchRankPool';
update settings set value = '"english"' where key = 'searchLanguage';
do $rebuild$ begin loop exit when search_rebuild_step() = 0 and not exists (select 1 from search_rebuild); end loop; end $rebuild$;

create table pg_temp.world (k text primary key, v uuid, at timestamptz);

do $test$
declare
  base timestamptz := now() - interval '30 days';
  ann uuid := tests.account('searcher');
  other uuid := tests.account('other searcher');
  quincy uuid := tests.character(ann, 'Quincy');
  rosalind uuid := tests.character(ann, 'Rosalind');
  sylvia uuid := tests.character(other, 'Sylvia');
  board_a uuid;
  board_b uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid;
  ok_t uuid; ax_a uuid; ax_b uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p7 uuid;
  j jsonb;
  want uuid[];
  r jsonb;
  c1 uuid; c2 uuid;
  i integer;
begin
  insert into boards (slug, name) values ('search-a', 'Search A') returning id into board_a;
  insert into boards (slug, name) values ('search-b', 'Search B') returning id into board_b;
  insert into threads (board, title) values (board_a, 'Marmot migration') returning id into t1;
  insert into threads (board, title) values (board_b, 'Quiet corner') returning id into t2;
  insert into threads (board, title) values (board_a, 'Hidden burrow') returning id into t3;
  insert into threads (board, title) values (board_a, 'Updates') returning id into t4;
  insert into unlisted_threads (thread) values (t3);
  insert into settings (key, value) values ('updatesThread', to_jsonb(t4::text));

  p1 := tests.post(quincy,   t1, 'Marmots love running through meadows.', base + interval '1 day');
  p2 := tests.post(rosalind, t1, 'Dingos prefer paddling in meadows.', base + interval '2 days');
  p3 := tests.post(quincy,   t1, 'The [b]marmot[/b] sat [quote=' || p2 || ']Dingos prefer paddling in meadows.[/quote] quietly.', base + interval '6 days');
  p4 := tests.post(quincy,   t2, 'Meadows are quiet places.', base + interval '3 days');
  p5 := tests.post(sylvia,   t2, 'Marmots hide in burrows, marmots everywhere, marmots marmots.', base + interval '4 days');
  p6 := tests.post(rosalind, t3, 'Secret marmots dwell here.', base + interval '7 days');
  p7 := tests.post(quincy,   t4, 'Marmots in the updates.', base + interval '8 days');
  insert into pg_temp.world values ('board_a', board_a, null), ('board_b', board_b, null), ('quincy', quincy, null), ('rosalind', rosalind, null), ('sylvia', sylvia, null),
    ('t1', t1, null), ('t2', t2, null), ('t3', t3, null), ('t4', t4, null), ('p1', p1, null), ('p2', p2, null), ('p3', p3, null), ('p4', p4, null), ('p5', p5, null), ('p6', p6, null),
    ('p7', p7, null), ('ann', ann, null), ('other', other, null);

  -- Every read below is the signed-in player's.
  perform tests.become(ann);

  -- The threads a search reads are the threads thread_open holds: every thread but the Updates thread, the unlisted ones included.
  if exists (select o.id from thread_open o except select t.id from threads t where t.id <> t4) or exists (select t.id from threads t where t.id <> t4 except select o.id from thread_open o) then
    raise exception 'thread_open and the threads a search reads are not the same set';
  end if;
  if not exists (select 1 from thread_open o where o.id = t3) or exists (select 1 from thread_open o where o.id = t4) then raise exception 'the fixture''s unlisted or Updates thread is not as thread_open holds them'; end if;

  -- 9. The text alone: the unlisted thread's post is found, the Updates thread's is not; newest, oldest and relevance.
  j := pg_temp.sp(q => 'marmot', sort => 'newest');
  if pg_temp.acts_of(j) is distinct from array[p6, p3, p5, p1] then raise exception 'newest: % (the Updates thread must not be found, the unlisted thread must)', pg_temp.acts_of(j); end if;
  if (j ->> 'count')::integer <> 4 or (j ->> 'more')::boolean or (j ->> 'pooled')::boolean or j -> 'next' <> 'null'::jsonb then raise exception 'count, more, pooled or next wrong: %', j - 'results'; end if;
  if pg_temp.acts_of(pg_temp.sp(q => 'marmot', sort => 'oldest')) is distinct from array[p1, p5, p3, p6] then raise exception 'oldest wrong'; end if;
  perform tests.unbecome();
  select coalesce(array_agg(x.act order by x.rank desc, x.created_at desc, x.act desc), '{}') into want
  from (select s.act, s.created_at, ts_rank_cd(s.words, websearch_to_tsquery('english', 'marmot'), 1)::float8 as rank from post_search s
        where s.words @@ websearch_to_tsquery('english', 'marmot') and s.thread <> t4) x;
  perform tests.become(ann);
  j := pg_temp.sp(q => 'marmot');
  if pg_temp.acts_of(j) is distinct from want then raise exception 'relevance (the default with a query) is not ts_rank_cd''s order: % want %', pg_temp.acts_of(j), want; end if;
  if pg_temp.acts_of(pg_temp.sp(q => 'marmot', sort => 'relevance')) is distinct from want then raise exception 'sort relevance differs from the default'; end if;
  if pg_temp.acts_of(pg_temp.sp(q => 'marmot')) is not distinct from pg_temp.acts_of(pg_temp.sp(q => 'marmot', sort => 'newest')) then
    raise exception 'the fixture cannot tell relevance from newest';
  end if;
  -- Stemming (marmots / marmot), a phrase, an exclusion and "or" as people type them.
  if pg_temp.acts_of(pg_temp.sp(q => 'marmots', sort => 'newest')) is distinct from array[p6, p3, p5, p1] then raise exception 'the query is not stemmed'; end if;
  if pg_temp.acts_of(pg_temp.sp(q => '"dingos prefer"', sort => 'newest')) is distinct from array[p2] then raise exception 'a quoted phrase did not match (a quote''s words must not match the quoter): %', pg_temp.acts_of(pg_temp.sp(q => '"dogs prefer"', sort => 'newest')); end if;
  if pg_temp.acts_of(pg_temp.sp(q => 'marmot -burrows', sort => 'newest')) is distinct from array[p3, p1] then raise exception 'an exclusion did not exclude (the title of a first post counts: Hidden burrow): %', pg_temp.acts_of(pg_temp.sp(q => 'marmot -burrows', sort => 'newest')); end if;
  if pg_temp.acts_of(pg_temp.sp(q => 'burrows or paddling', sort => 'newest')) is distinct from array[p6, p5, p2] then raise exception '"or" did not widen (p6 holds burrow in its thread''s title)'; end if;
  if (pg_temp.sp(q => 'the')) -> 'count' <> '0'::jsonb or (pg_temp.sp(q => '!!!')) -> 'count' <> '0'::jsonb then raise exception 'a query of only stop words or symbols found something'; end if;

  -- Each filter alone, and together. Without a query the order is newest.
  if pg_temp.acts_of(pg_temp.sp(author => quincy)) is distinct from array[p3, p4, p1] then raise exception 'author alone: %', pg_temp.acts_of(pg_temp.sp(author => quincy)); end if;
  if pg_temp.acts_of(pg_temp.sp(q => 'marmot', author => quincy, sort => 'newest')) is distinct from array[p3, p1] then raise exception 'author with a query'; end if;
  if pg_temp.acts_of(pg_temp.sp(board => board_b)) is distinct from array[p5, p4] then raise exception 'board alone: %', pg_temp.acts_of(pg_temp.sp(board => board_b)); end if;
  if pg_temp.acts_of(pg_temp.sp(q => 'marmot', board => board_a, sort => 'newest')) is distinct from array[p6, p3, p1] then raise exception 'board with a query'; end if;
  if pg_temp.acts_of(pg_temp.sp(from_at => base + interval '3 days', to_at => base + interval '6 days')) is distinct from array[p5, p4] then
    raise exception 'a range is [from, to): %', pg_temp.acts_of(pg_temp.sp(from_at => base + interval '3 days', to_at => base + interval '6 days')); end if;
  if pg_temp.acts_of(pg_temp.sp(from_at => base + interval '6 days', board => board_a)) is distinct from array[p6, p3] then raise exception 'from alone (the Updates thread must stay out)'; end if;
  if pg_temp.acts_of(pg_temp.sp(to_at => base + interval '2 days')) is distinct from array[p1] then raise exception 'to alone'; end if;
  if pg_temp.acts_of(pg_temp.sp(q => 'marmot', from_at => base + interval '3 days', to_at => base + interval '6 days 1 hour', sort => 'newest')) is distinct from array[p3, p5] then raise exception 'range with a query'; end if;
  if pg_temp.acts_of(pg_temp.sp(q => 'marmot', author => quincy, board => board_a, from_at => base, to_at => base + interval '7 days', sort => 'oldest')) is distinct from array[p1, p3] then
    raise exception 'every filter together: %', pg_temp.acts_of(pg_temp.sp(q => 'marmot', author => quincy, board => board_a, from_at => base, to_at => base + interval '7 days', sort => 'oldest')); end if;
  if pg_temp.acts_of(pg_temp.sp(author => quincy, board => board_b, sort => 'oldest')) is distinct from array[p4] then raise exception 'author and board, oldest'; end if;
  if (pg_temp.sp(author => sylvia, board => board_a)) -> 'count' <> '0'::jsonb then raise exception 'a filter that matches nothing found something'; end if;

  -- Titles only: the first post of a thread, matched in its title; without a query, the first posts.
  if pg_temp.acts_of(pg_temp.sp(q => 'marmot', titles_only => true)) is distinct from array[p1] then raise exception 'titles only: %', pg_temp.acts_of(pg_temp.sp(q => 'marmot', titles_only => true)); end if;
  if pg_temp.acts_of(pg_temp.sp(q => 'quiet', titles_only => true)) is distinct from array[p4] then raise exception 'titles only matched a body (quietly) or missed a title'; end if;
  if pg_temp.acts_of(pg_temp.sp(titles_only => true, board => board_a)) is distinct from array[p6, p1] then raise exception 'titles only without a query: %', pg_temp.acts_of(pg_temp.sp(titles_only => true, board => board_a)); end if;

  -- A result: its thread, board, page, author, snippet.
  j := pg_temp.sp(q => 'marmot', sort => 'newest');
  r := j -> 'results' -> 1;  -- p3
  if r ->> 'act' <> p3::text or r ->> 'thread' <> t1::text or r ->> 'title' <> 'Marmot migration' or r ->> 'board' <> board_a::text or r ->> 'board_slug' <> 'search-a' or r ->> 'board_name' <> 'Search A'
     or (r ->> 'seq')::integer <> 3 or (r ->> 'page')::integer <> 1 or r ->> 'character' <> quincy::text or r ->> 'name' <> 'Quincy' or (r ->> 'created_at')::timestamptz <> base + interval '6 days' then
    raise exception 'a result is missing a field or has a wrong one: %', r;
  end if;
  if regexp_replace(r ->> 'snippet', '\s+', ' ', 'g') not like '%<<marmot>> sat quietly%' or r ->> 'snippet' ~ '\[|\]|Dingos|paddling' then
    raise exception 'the snippet is not the plain words with markers (no tags, no quote): %', r ->> 'snippet';
  end if;
  if (j -> 'results' -> 3) ->> 'snippet' not like '<<Marmots>> love running%' then raise exception 'the first snippet: %', (j -> 'results' -> 3) ->> 'snippet'; end if;
  if (select count(*) from jsonb_array_elements(j -> 'results') e where e::text ~ '<b>|</b>|<mark>|&lt;') > 0 then raise exception 'a snippet holds HTML'; end if;
  if (pg_temp.sp(author => quincy, per_page => 1)) -> 'results' -> 0 ->> 'snippet' <> 'The marmot sat quietly.' then raise exception 'a snippet with no query is the post''s beginning: %', (pg_temp.sp(author => quincy, per_page => 1)) -> 'results' -> 0 ->> 'snippet'; end if;
  if jsonb_typeof(r -> 'cards') <> 'array' or jsonb_array_length(r -> 'cards') <> 0 then raise exception 'a post with no card shows cards: %', r -> 'cards'; end if;
  perform tests.unbecome();

  -- Cards: the keys of the plays live on the post, at most 8; a face-down card shows no key, a play an admin ended is gone.
  perform tests.act(rosalind, 'card', t1, '{"card": "sweetie"}', p1, base + interval '9 days');
  c1 := tests.act(sylvia, 'card', t1, '{"card": "splat"}', p1, base + interval '9 days 1 hour');
  perform set_config('kayfabb.card_end_writer', 'on', true);
  perform tests.act(null, 'card_end', t1, '{"by": "admin", "why": "reversed"}', c1);
  perform set_config('kayfabb.card_end_writer', 'off', true);
  perform tests.act(quincy, 'set', t1, '{}', p1, base + interval '9 days 2 hours');
  perform tests.become(ann);
  if (pg_temp.sp(q => 'marmot', board => board_a, sort => 'oldest')) -> 'results' -> 0 -> 'cards' <> '["sweetie"]'::jsonb then
    raise exception 'cards: %', (pg_temp.sp(q => 'marmot', board => board_a, sort => 'oldest')) -> 'results' -> 0 -> 'cards'; end if;
  perform tests.unbecome();
  for i in 1..10 loop perform tests.act(rosalind, 'card', t1, jsonb_build_object('card', 'extra' || lpad(i::text, 2, '0')), p1, base + interval '10 days' + i * interval '1 minute'); end loop;
  perform tests.become(ann);
  if jsonb_array_length((pg_temp.sp(q => 'marmot', board => board_a, sort => 'oldest')) -> 'results' -> 0 -> 'cards') <> 8 then raise exception 'cards are at most 8'; end if;
  perform tests.unbecome();

  -- 10. The cursor, whatever the sort and the page size: no repeat, no gap.
  perform tests.become(ann);
  for i in 1..3 loop
    if pg_temp.walk('posts', 'marmot', null, null, 'newest', i) is distinct from array[p6, p3, p5, p1] then raise exception 'newest walk by %', i; end if;
    if pg_temp.walk('posts', 'marmot', null, null, 'oldest', i) is distinct from array[p1, p5, p3, p6] then raise exception 'oldest walk by %', i; end if;
    if pg_temp.walk('posts', 'marmot', null, null, 'relevance', i) is distinct from want then raise exception 'relevance walk by %: % want %', i, pg_temp.walk('posts', 'marmot', null, null, 'relevance', i), want; end if;
    if pg_temp.walk('posts', null, quincy, null, null, i) is distinct from array[p3, p4, p1] then raise exception 'filter-only walk by %', i; end if;
    if pg_temp.walk('posts', 'marmot', null, null, 'newest', i, true) is distinct from array[p1] then raise exception 'titles-only walk by %', i; end if;
  end loop;
  if (pg_temp.sp(q => 'marmot', sort => 'newest', per_page => 2)) -> 'next' = 'null'::jsonb then raise exception 'a page with more after it has no next'; end if;
  if (pg_temp.sp(q => 'marmot', sort => 'newest', per_page => 4)) -> 'next' <> 'null'::jsonb then raise exception 'the last page has a next'; end if;
  if jsonb_array_length((pg_temp.sp(q => 'marmot', sort => 'newest', per_page => 3)) -> 'results') <> 3 then raise exception 'per_page is not honored'; end if;
  perform tests.unbecome();

  -- The count stops at 1,001; a broad word is the post's page in its thread (postsPerPage 20).
  insert into threads (board, title) values (board_a, 'Pangolin parade') returning id into t5;
  insert into acts (character, kind, thread, payload, created_at)
  select quincy, 'post', t5, jsonb_build_object('body', 'Pangolins parade number ' || g), base + interval '11 days' + g * interval '1 second' from generate_series(1, 1100) g;
  insert into pg_temp.world values ('t5', t5, null);
  perform tests.become(ann);
  j := pg_temp.sp(q => 'pangolin', sort => 'newest');
  if (j ->> 'count')::integer <> 1001 or not (j ->> 'more')::boolean then raise exception 'the count did not stop at 1,001: %', j - 'results'; end if;
  if jsonb_array_length(j -> 'results') <> 20 then raise exception 'the default page is not 20 results'; end if;
  j := pg_temp.sp(q => 'pangolin', sort => 'oldest', per_page => 50);
  if (j -> 'results' -> 40 ->> 'seq')::integer <> 41 or (j -> 'results' -> 40 ->> 'page')::integer <> 3 or (j -> 'results' -> 19 ->> 'page')::integer <> 1 or (j -> 'results' -> 20 ->> 'page')::integer <> 2 then
    raise exception 'a post''s page in its thread: % % %', j -> 'results' -> 19 ->> 'page', j -> 'results' -> 20 ->> 'page', j -> 'results' -> 40 ->> 'page'; end if;
  if (pg_temp.sp(q => 'pangolin', sort => 'newest', per_page => 50, from_at => base + interval '11 days 1000 seconds')) -> 'count' <> '101'::jsonb then raise exception 'the count under a range'; end if;
  -- The cursor reaches past the first thousand.
  j := pg_temp.sp(q => 'pangolin', sort => 'newest', per_page => 50, after => (select (pg_temp.sp(q => 'pangolin', sort => 'newest', per_page => 50)) -> 'next'));
  if j -> 'results' -> 0 ->> 'seq' is distinct from '1050' then raise exception 'the second page of newest starts at seq %', j -> 'results' -> 0 ->> 'seq'; end if;
  if cardinality(pg_temp.walk('posts', 'pangolin', null, null, 'newest', 50)) <> 1100 then raise exception 'a walk past the count did not reach every post'; end if;
  -- The pool: lowered to its least (100), relevance reaches only the newest 100 and says so; newest and oldest are not pooled; a pool that was not full is not flagged.
  perform tests.unbecome();
  update settings set value = '100' where key = 'searchRankPool';
  perform tests.become(ann);
  j := pg_temp.sp(q => 'pangolin');
  if not (j ->> 'pooled')::boolean then raise exception 'a full pool did not set pooled: %', j - 'results'; end if;
  if (j ->> 'count')::integer <> 1001 then raise exception 'the count is of matches, not of the pool'; end if;
  if cardinality(pg_temp.walk('posts', 'pangolin', null, null, 'relevance', 30)) <> 100 then raise exception 'relevance reached % results, the pool is 100', cardinality(pg_temp.walk('posts', 'pangolin', null, null, 'relevance', 30)); end if;
  if exists (select 1 from unnest(pg_temp.walk('posts', 'pangolin', null, null, 'relevance', 30)) a join acts x on x.id = a where x.seq <= 1000) then raise exception 'the pool is not the newest matches'; end if;
  if (pg_temp.sp(q => 'pangolin', sort => 'newest')) -> 'pooled' <> 'false'::jsonb or (pg_temp.sp(q => 'pangolin', sort => 'oldest')) -> 'pooled' <> 'false'::jsonb then raise exception 'newest or oldest is pooled'; end if;
  if (pg_temp.sp(q => 'marmot')) -> 'pooled' <> 'false'::jsonb then raise exception 'a pool that was not full set pooled'; end if;
  perform tests.unbecome();
  update settings set value = '5000' where key = 'searchRankPool';
  perform tests.become(ann);
  if (pg_temp.sp(q => 'pangolin')) -> 'pooled' <> 'false'::jsonb then raise exception 'pooled stayed on with a larger pool'; end if;
  perform tests.unbecome();

  -- Q-5: `pooled` says more than the pool matched, not that the pool is exactly full. Pool 100: a word in exactly 100 posts is not pooled, in 101 it is (posts and threads, by relevance).
  update settings set value = '100' where key = 'searchRankPool';
  insert into threads (board, title) values (board_a, 'Okapi crossing') returning id into ok_t;
  insert into acts (character, kind, thread, payload, created_at)
  select quincy, 'post', ok_t, jsonb_build_object('body', 'Okapis wander ' || g), base + interval '13 days' + g * interval '1 second' from generate_series(1, 100) g;
  perform tests.become(ann);
  if (select count(*) from post_search where words @@ websearch_to_tsquery('english', 'okapi')) is distinct from 100 then raise exception 'the okapi fixture is not 100 posts'; end if;
  j := pg_temp.sp(q => 'okapi');
  if (j ->> 'pooled')::boolean or (j ->> 'count')::integer <> 100 then raise exception 'exactly a pool of matches was called pooled (posts): %', j - 'results'; end if;
  j := pg_temp.st(q => 'okapi');
  if (j ->> 'pooled')::boolean then raise exception 'exactly a pool of matches was called pooled (threads): %', j - 'results'; end if;
  perform tests.unbecome();
  insert into acts (character, kind, thread, payload, created_at) values (quincy, 'post', ok_t, '{"body": "One more okapi."}', base + interval '13 days 1 hour');
  perform tests.become(ann);
  if not (pg_temp.sp(q => 'okapi') ->> 'pooled')::boolean then raise exception 'a pool and one more match was not called pooled (posts)'; end if;
  if not (pg_temp.st(q => 'okapi') ->> 'pooled')::boolean then raise exception 'a pool and one more match was not called pooled (threads)'; end if;
  if cardinality(pg_temp.walk('posts', 'okapi', null, null, 'relevance', 30)) <> 100 then raise exception 'relevance ranks more or less than the pool of 100'; end if;
  perform tests.unbecome();

  -- SPEC-1: newest and oldest page threads by time and have no pool. Pool 100; one thread (axolotl A) holds a single match, older than 150 newer matches in another (axolotl B):
  -- under a pool of the newest 100 matches the first thread would be unreachable. Newest and oldest find both and count both; relevance ranks the pool and counts both.
  insert into threads (board, title) values (board_a, 'Axolotl A') returning id into ax_a;
  insert into threads (board, title) values (board_a, 'Axolotl B') returning id into ax_b;
  insert into acts (character, kind, thread, payload, created_at) values (quincy, 'post', ax_a, '{"body": "Axolotls regenerate."}', base + interval '14 days');
  insert into acts (character, kind, thread, payload, created_at)
  select quincy, 'post', ax_b, jsonb_build_object('body', 'Axolotls swim ' || g), base + interval '15 days' + g * interval '1 second' from generate_series(1, 150) g;
  perform tests.become(ann);
  j := pg_temp.st(q => 'axolotl', sort => 'newest');
  -- A page reads at most the pool's worth (100) of matches: the first page holds the thread of the newest, and the older thread is reached by Next (BOUND-1 below walks more).
  if pg_temp.threads_of(j) is distinct from array[ax_b] or j -> 'next' = 'null'::jsonb then raise exception 'newest threads under a pool of 100: % %', pg_temp.threads_of(j), j -> 'next'; end if;
  if (j ->> 'count')::integer <> 1 or not (j ->> 'more')::boolean or (j ->> 'pooled')::boolean then raise exception 'newest thread count or pooled: %', j - 'results'; end if;
  if (j -> 'results' -> 0 ->> 'matches')::integer <> 100 or not (j -> 'results' -> 0 ->> 'matches_more')::boolean then raise exception 'matches under newest: %', j -> 'results'; end if;
  j := pg_temp.st(q => 'axolotl', sort => 'oldest');
  -- The count is the same for both sorts: the threads among the newest 100 matches, and `more` says the walk was cut.
  if pg_temp.threads_of(j) is distinct from array[ax_a, ax_b] or (j ->> 'count')::integer <> 1 or not (j ->> 'more')::boolean or (j ->> 'pooled')::boolean then raise exception 'oldest threads: %', j - 'results'; end if;
  if pg_temp.walk('threads', 'axolotl', null, null, 'newest', 1) is distinct from array[ax_b, ax_a] then raise exception 'newest thread walk by 1'; end if;
  if pg_temp.walk('threads', 'axolotl', null, null, 'oldest', 1) is distinct from array[ax_a, ax_b] then raise exception 'oldest thread walk by 1'; end if;
  j := pg_temp.st(q => 'axolotl');
  if (j ->> 'count')::integer <> 1 or not (j ->> 'more')::boolean or not (j ->> 'pooled')::boolean then raise exception 'relevance thread count (the threads of the pool) or pooled: %', j - 'results'; end if;
  -- A range that holds only the old thread's match.
  if pg_temp.threads_of(pg_temp.st(q => 'axolotl', sort => 'newest', to_at => base + interval '14 days 1 hour')) is distinct from array[ax_a] then raise exception 'newest threads under a range'; end if;
  perform tests.unbecome();

  -- BOUND-1: a walk by time reads at most the pool's worth of matches, whatever the matches are. Pool 100; one thread (wombat C) with 300 matches, the newest, and one (wombat D) with one match,
  -- older. A page walks from the cursor, keeps the threads whose key it passes, and when it has read 100 matches without a page it returns what it found (here none, after the first) and a cursor at
  -- the last match it read: every thread is reached by Next, in at most ceil(301 / 100) pages, none twice, and the count says it stopped.
  declare
    wm_c uuid; wm_d uuid;
    pages integer; cur jsonb; seen uuid[]; got uuid[]; empties integer; srt text;
  begin
    insert into threads (board, title) values (board_a, 'Wombat C') returning id into wm_c;
    insert into threads (board, title) values (board_a, 'Wombat D') returning id into wm_d;
    insert into acts (character, kind, thread, payload, created_at) values (quincy, 'post', wm_d, '{"body": "Wombats smile."}', base + interval '16 days');
    insert into acts (character, kind, thread, payload, created_at)
    select quincy, 'post', wm_c, jsonb_build_object('body', 'Wombats hop ' || g), base + interval '17 days' + g * interval '1 second' from generate_series(1, 300) g;
    perform tests.become(ann);
    foreach srt in array array['newest', 'oldest'] loop
      pages := 0; cur := null; seen := '{}'; empties := 0;
      loop
        j := pg_temp.st(q => 'wombat', sort => srt, after => cur, per_page => 20);
        pages := pages + 1;
        got := pg_temp.threads_of(j);
        if exists (select 1 from unnest(got) g where g = any (seen)) then raise exception 'a thread repeated (%, page %)', srt, pages; end if;
        seen := seen || got;
        if cardinality(got) = 0 then empties := empties + 1; end if;
        if (j ->> 'count')::integer > 2 or not (j ->> 'more')::boolean then raise exception 'the count of a walk cut at the pool (%): %', srt, j - 'results'; end if;
        cur := j -> 'next';
        exit when cur is null or cur = 'null'::jsonb;
        if pages > 6 then raise exception 'the walk does not end (%)', srt; end if;
      end loop;
      if pages > 4 then raise exception 'the walk by % took % pages, more than ceil(301 / 100)', srt, pages; end if;
      if not (seen @> array[wm_c, wm_d] and cardinality(seen) = 2) then raise exception 'the walk by % did not reach both threads: %', srt, seen; end if;
      if empties = 0 then raise exception 'the walk by % found no page without a thread, so it did not cross a run of non-key matches', srt; end if;
    end loop;
    -- A pool that reaches the whole match set is not cut: no more, an exact count.
    perform tests.unbecome();
    update settings set value = '1000' where key = 'searchRankPool';
    perform tests.become(ann);
    j := pg_temp.st(q => 'wombat', sort => 'newest');
    if (j ->> 'count')::integer <> 2 or (j ->> 'more')::boolean or pg_temp.threads_of(j) is distinct from array[wm_c, wm_d] or j -> 'next' <> 'null'::jsonb then raise exception 'a walk the pool covers: %', j - 'results'; end if;
    perform tests.unbecome();
    update settings set value = '100' where key = 'searchRankPool';
  end;
  update settings set value = '5000' where key = 'searchRankPool';

  -- SPEC-4: ties. Posts of one instant (same created_at, told apart by Act id), in three threads, and an older one; walked by 1 to 4 under each sort. Identical words, so relevance ties too.
  declare
    tq uuid[];
    tie_at timestamptz := base + interval '20 days';
    q1 tsquery := websearch_to_tsquery('english', 'quokka');
    want_p uuid[]; want_t uuid[];
    sort_name text;
  begin
    for i in 1..3 loop
      insert into threads (board, title) values (board_a, 'Tie ' || i) returning id into ok_t;
      tq := tq || ok_t;
      insert into acts (character, kind, thread, payload, created_at) values (quincy, 'post', ok_t, '{"body": "Quokkas bounce."}', tie_at), (sylvia, 'post', ok_t, '{"body": "Quokkas bounce."}', tie_at);
    end loop;
    insert into acts (character, kind, thread, payload, created_at) values (quincy, 'post', tq[1], '{"body": "Quokkas bounce."}', tie_at - interval '1 day');
    if (select count(distinct created_at) from post_search where words @@ q1) is distinct from 2 or (select count(*) from post_search where words @@ q1 and created_at = tie_at) is distinct from 6 then raise exception 'the tie fixture has no ties'; end if;
    perform tests.become(ann);
    foreach sort_name in array array['newest', 'oldest', 'relevance'] loop
      perform tests.unbecome();
      select coalesce(array_agg(x.act order by case when sort_name = 'relevance' then x.rank end desc nulls last, case when sort_name = 'oldest' then x.created_at end asc, case when sort_name <> 'oldest' then x.created_at end desc,
                                                case when sort_name = 'oldest' then x.act end asc, case when sort_name <> 'oldest' then x.act end desc), '{}') into want_p
      from (select s.act, s.created_at, ts_rank_cd(s.words, q1, 1)::float8 as rank from post_search s where s.words @@ q1) x;
      select coalesce(array_agg(k.thread order by case when sort_name = 'relevance' then k.rank end desc nulls last, case when sort_name = 'oldest' then k.created_at end asc, case when sort_name <> 'oldest' then k.created_at end desc,
                                                case when sort_name = 'oldest' then k.act end asc, case when sort_name <> 'oldest' then k.act end desc), '{}') into want_t
      from (select distinct on (s.thread) s.thread, s.act, s.created_at, ts_rank_cd(s.words, q1, 1)::float8 as rank from post_search s where s.words @@ q1
            order by s.thread, case when sort_name = 'relevance' then ts_rank_cd(s.words, q1, 1)::float8 end desc nulls last,
                     case when sort_name = 'oldest' then s.created_at end asc, case when sort_name <> 'oldest' then s.created_at end desc,
                     case when sort_name = 'oldest' then s.act end asc, case when sort_name <> 'oldest' then s.act end desc) k;
      perform tests.become(ann);
      for i in 1..4 loop
        if pg_temp.walk('posts', 'quokka', null, null, sort_name, i) is distinct from want_p then raise exception 'tied posts, % by %: % want %', sort_name, i, pg_temp.walk('posts', 'quokka', null, null, sort_name, i), want_p; end if;
        if pg_temp.walk('threads', 'quokka', null, null, sort_name, i) is distinct from want_t then raise exception 'tied threads, % by %: % want %', sort_name, i, pg_temp.walk('threads', 'quokka', null, null, sort_name, i), want_t; end if;
      end loop;
      if cardinality(want_p) <> 7 or cardinality(want_t) <> 3 then raise exception 'the tie fixture is not 7 posts in 3 threads'; end if;
    end loop;
    perform tests.unbecome();
  end;

  -- 11. An author who has not debuted, a retired id, a random id: one answer.
  declare
    shy uuid;
    asked jsonb[];
    none jsonb;
    ids uuid[];
  begin
    -- A character who posted and then lost its debut (posting needs one), so the index holds a post by a character characters_public does not show.
    shy := tests.character(ann, 'Shyone');
    insert into acts (character, kind, thread, payload, created_at) values (shy, 'post', t1, '{"body": "Marmots, said the shy one."}', base + interval '12 days');
    update characters set debuted_at = null where id = shy;
    if exists (select 1 from characters_public where id = shy) then raise exception 'the fixture''s character still shows'; end if;
    perform tests.become(ann);
    asked := array[pg_temp.sp(author => shy), pg_temp.sp(author => gen_random_uuid()), pg_temp.sp(author => '00000000-0000-0000-0000-000000000000'),
                   pg_temp.sp(q => 'marmot', author => shy), pg_temp.sp(q => 'marmot', author => gen_random_uuid())];
    none := pg_temp.sp(author => gen_random_uuid());
    for i in 1..5 loop
      if asked[i] -> 'count' <> '0'::jsonb or asked[i] -> 'results' <> '[]'::jsonb then raise exception 'an author who is no debuted character found something: %', asked[i]; end if;
    end loop;
    if asked[1] is distinct from asked[2] or asked[1] is distinct from none or asked[4] is distinct from asked[5] then raise exception 'an undebuted author and a random id answer differently'; end if;
    if (pg_temp.st(author => shy)) is distinct from (pg_temp.st(author => gen_random_uuid())) then raise exception 'search_threads answers an undebuted author differently'; end if;
    -- And the same posts are found by their words, under no author.
    if not exists (select 1 from acts_public a where a.character = shy and a.id = any (pg_temp.acts_of(pg_temp.sp(q => 'shy', sort => 'newest')))) then raise exception 'the undebuted character''s post is not found by its words'; end if;
    perform tests.unbecome();
  end;

  -- 12. search_threads.
  perform tests.become(ann);
  -- The shy character's post (day 12) is the newest match in t1.
  j := pg_temp.st(q => 'marmot', sort => 'newest');
  if pg_temp.threads_of(j) is distinct from array[t1, t3, t2] then raise exception 'threads, newest, by each thread''s newest match: %', pg_temp.threads_of(j); end if;
  if (j ->> 'count')::integer <> 3 or (j ->> 'more')::boolean or (j ->> 'pooled')::boolean then raise exception 'thread count: %', j - 'results'; end if;
  if (j -> 'results' -> 0 ->> 'matches')::integer <> 3 or (j -> 'results' -> 0 ->> 'matches_more')::boolean or (j -> 'results' -> 1 ->> 'matches')::integer <> 1 then raise exception 'matches: %', j -> 'results'; end if;
  if j -> 'results' -> 0 ->> 'title' <> 'Marmot migration' or j -> 'results' -> 0 ->> 'board_slug' <> 'search-a' or j -> 'results' -> 0 ->> 'snippet' not like '%<<%' then raise exception 'a thread result: %', j -> 'results' -> 0; end if;
  if pg_temp.threads_of(pg_temp.st(q => 'marmot', sort => 'oldest')) is distinct from array[t1, t2, t3] then raise exception 'threads, oldest: %', pg_temp.threads_of(pg_temp.st(q => 'marmot', sort => 'oldest')); end if;
  perform tests.unbecome();
  select coalesce(array_agg(x.thread order by x.rank desc, x.created_at desc, x.act desc), '{}') into want
  from (select distinct on (s.thread) s.thread, s.act, s.created_at, ts_rank_cd(s.words, websearch_to_tsquery('english', 'marmot'), 1)::float8 as rank
        from post_search s where s.words @@ websearch_to_tsquery('english', 'marmot') and s.thread <> t4
        order by s.thread, rank desc, s.created_at desc, s.act desc) x;
  perform tests.become(ann);
  if pg_temp.threads_of(pg_temp.st(q => 'marmot')) is distinct from want then raise exception 'threads by relevance are not each thread''s best match in rank order: % want %', pg_temp.threads_of(pg_temp.st(q => 'marmot')), want; end if;
  for i in 1..3 loop
    if pg_temp.walk('threads', 'marmot', null, null, 'newest', i) is distinct from array[t1, t3, t2] then raise exception 'thread newest walk by %', i; end if;
    if pg_temp.walk('threads', 'marmot', null, null, 'oldest', i) is distinct from array[t1, t2, t3] then raise exception 'thread oldest walk by %', i; end if;
    if pg_temp.walk('threads', 'marmot', null, null, 'relevance', i) is distinct from want then raise exception 'thread relevance walk by %', i; end if;
  end loop;
  if pg_temp.threads_of(pg_temp.st(author => rosalind)) is distinct from array[t3, t1] then raise exception 'threads by author: %', pg_temp.threads_of(pg_temp.st(author => rosalind)); end if;
  if pg_temp.threads_of(pg_temp.st(q => 'marmot', board => board_b)) is distinct from array[t2] then raise exception 'threads by board'; end if;
  if pg_temp.threads_of(pg_temp.st(q => 'marmot', titles_only => true)) is distinct from array[t1] then raise exception 'threads, titles only'; end if;
  if (pg_temp.st(q => 'marmot', titles_only => true)) -> 'results' -> 0 ->> 'matches' <> '1' then raise exception 'titles only counts a post that is not the title''s'; end if;
  if pg_temp.threads_of(pg_temp.st(q => 'marmot', sort => 'newest', from_at => base + interval '5 days', to_at => base + interval '7 days 1 hour')) is distinct from array[t3, t1] then raise exception 'threads by range: %', pg_temp.threads_of(pg_temp.st(q => 'marmot', sort => 'newest', from_at => base + interval '5 days', to_at => base + interval '7 days 1 hour')); end if;
  j := pg_temp.st(q => 'pangolin');
  if (j ->> 'count')::integer <> 1 or (j -> 'results' -> 0 ->> 'matches')::integer <> 100 or not (j -> 'results' -> 0 ->> 'matches_more')::boolean then raise exception 'matches are counted to 100 then 100+: %', j; end if;
  perform tests.unbecome();

  -- 13. Suggest.
  declare
    mario uuid := tests.character(ann, 'Mario');
    zoe uuid := tests.character(other, 'Zoë');
    undebuted uuid;
    mt uuid; mbt uuid; sys_t uuid;
    sg jsonb;
    sys_board uuid := (select id from boards where is_system);
    mario_board uuid;
    newest uuid[];
    own text[];
    own2 jsonb;
  begin
    insert into characters (owner, name, created_at) values (other, 'Marietta', now()) returning id into undebuted;
    insert into threads (board, title) values (board_a, 'Mario Kart tournament') returning id into mt;
    insert into threads (board, title) values (board_b, 'Super Mario Bros') returning id into mbt;
    insert into threads (board, title) values (sys_board, 'Mario at the system desk') returning id into sys_t;
    insert into boards (slug, name) values ('mario-land', 'Mario Land') returning id into mario_board;
    perform tests.become(ann);
    foreach sg in array array[search_suggest('mairo', null, null, false, 5), search_suggest('MAR', null, null, false, 5), search_suggest('mar', '{characters}', null, false, 5), search_suggest('  Mari', null, null, false, 5)] loop
      if not exists (select 1 from jsonb_array_elements(sg -> 'characters') e where e ->> 'id' = mario::text and e ->> 'name' = 'Mario') then raise exception 'the suggestions did not find Mario: %', sg; end if;
      if exists (select 1 from jsonb_array_elements(sg -> 'characters') e where e ->> 'id' = undebuted::text or e ->> 'name' = 'Marietta') then raise exception 'a character who has not debuted was suggested: %', sg; end if;
    end loop;
    sg := search_suggest('mairo', null, null, false, 5);
    if not exists (select 1 from jsonb_array_elements(sg -> 'threads') e where e ->> 'id' = mt::text and e ->> 'board_name' = 'Search A' and e ->> 'board' = board_a::text) then raise exception '"mairo" did not find the Mario Kart thread: %', sg; end if;
    if not exists (select 1 from jsonb_array_elements(sg -> 'boards') e where e ->> 'id' = mario_board::text and e ->> 'slug' = 'mario-land' and e ->> 'name' = 'Mario Land') then raise exception '"mairo" did not find the Mario Land board: %', sg; end if;
    -- Q-3: called by itself, the threads function reads the 0.3 threshold the screen read does (it carries the setting), and reads the same threads.
    if not exists (select 1 from search_suggest_threads('mairo', null, false, 5) s where s.id = mt) then raise exception 'search_suggest_threads called directly did not find "mairo" (the default trigram threshold)'; end if;
    if (select array_agg(s.id order by s.id) from search_suggest_threads('mairo', null, false, 5) s) is distinct from (select array_agg((e ->> 'id')::uuid order by (e ->> 'id')::uuid) from jsonb_array_elements(sg -> 'threads') e) then
      raise exception 'search_suggest_threads and search_suggest read different threads';
    end if;
    sg := search_suggest('MAR', null, null, false, 5);
    if not exists (select 1 from jsonb_array_elements(sg -> 'threads') e where e ->> 'id' = mbt::text) then raise exception '"MAR" did not find a thread with the word at its middle: %', sg; end if;
    -- Accents fold both ways; the plain "Mario" is first of the characters for its own name, ahead of the nearer-by.
    if not exists (select 1 from jsonb_array_elements(search_suggest('zoe', '{characters}', null, false, 5) -> 'characters') e where e ->> 'id' = zoe::text and e ->> 'name' = 'Zoë') then raise exception 'an accent did not fold'; end if;
    if not exists (select 1 from jsonb_array_elements(search_suggest('ZOË', '{characters}', null, false, 5) -> 'characters') e where e ->> 'id' = zoe::text) then raise exception 'an accent in the prefix did not fold'; end if;
    -- Only the kinds asked for, and `most` each.
    sg := search_suggest('mar', '{boards}', null, false, 5);
    if sg -> 'threads' <> '[]'::jsonb or sg -> 'characters' <> '[]'::jsonb or jsonb_array_length(sg -> 'boards') < 1 then raise exception 'kinds: %', sg; end if;
    if jsonb_array_length(search_suggest('mar', '{threads}', null, false, 1) -> 'threads') <> 1 then raise exception 'most 1'; end if;
    if jsonb_array_length(search_suggest('mar', '{threads}', null, false, 2) -> 'threads') <> 2 then raise exception 'most 2'; end if;
    -- The system board is left out when asked; a board narrows the threads.
    if not exists (select 1 from jsonb_array_elements(search_suggest('mario at', '{threads}', null, false, 5) -> 'threads') e where e ->> 'id' = sys_t::text) then raise exception 'a thread of the system board was not found'; end if;
    if exists (select 1 from jsonb_array_elements(search_suggest('mario at', '{threads}', null, true, 5) -> 'threads') e where e ->> 'id' = sys_t::text) then raise exception 'exclude_system kept a thread of the system board'; end if;
    if exists (select 1 from jsonb_array_elements(search_suggest('the sys', '{boards}', null, true, 5) -> 'boards') e where e ->> 'id' = sys_board::text) then raise exception 'exclude_system kept the system board'; end if;
    if not exists (select 1 from jsonb_array_elements(search_suggest('the sys', '{boards}', null, false, 5) -> 'boards') e where e ->> 'id' = sys_board::text) then raise exception 'the system board was not found by name'; end if;
    if search_suggest('mario', '{threads}', board_a, false, 5) -> 'threads' -> 0 ->> 'id' <> mt::text or exists (select 1 from jsonb_array_elements(search_suggest('mario', '{threads}', board_a, false, 5) -> 'threads') e where e ->> 'board' <> board_a::text) then
      raise exception 'a board did not narrow the threads, or the best match is not first: %', search_suggest('mario', '{threads}', board_a, false, 5); end if;
    -- The Updates thread is not suggested; a pattern character is only itself.
    if exists (select 1 from jsonb_array_elements(search_suggest('updates', '{threads}', null, false, 10) -> 'threads') e where e ->> 'id' = t4::text) then raise exception 'the Updates thread was suggested'; end if;
    if search_suggest('%%', null, null, false, 10) <> '{"threads": [], "characters": [], "boards": []}'::jsonb then raise exception 'a %% is a pattern in a prefix: %', search_suggest('%%', null, null, false, 10); end if;
    if search_suggest('zzzzqq', null, null, false, 10) <> '{"threads": [], "characters": [], "boards": []}'::jsonb then raise exception 'a prefix nothing starts with found something'; end if;
    -- An empty prefix with threads: the newest threads.
    select coalesce(array_agg(x.id order by x.last_at desc nulls last, x.id desc), '{}') into newest
    from (select t.id, t.last_at from threads t where t.id <> t4 and t.board <> sys_board order by t.last_at desc nulls last, t.id desc limit 4) x;
    if (select coalesce(array_agg((e ->> 'id')::uuid order by o), '{}') from jsonb_array_elements(search_suggest('', '{threads}', null, true, 4) -> 'threads') with ordinality t(e, o)) is distinct from newest then
      raise exception 'the empty prefix did not list the newest threads: % want %', search_suggest('', '{threads}', null, true, 4), newest; end if;
    if search_suggest(null, '{threads}', board_b, false, 10) -> 'threads' -> 0 ->> 'board' <> board_b::text then raise exception 'the empty prefix ignores the board'; end if;
    -- suggest_characters: id and name of the debuted, what characters_public shows, the same for any caller and any owner.
    if exists (select 1 from suggest_characters('mar', 10) s where s.id = undebuted) then raise exception 'suggest_characters returned a character who has not debuted'; end if;
    if exists (select 1 from suggest_characters('', 10)) then raise exception 'an empty prefix found characters'; end if;
    if (select count(*) from suggest_characters('mar', 10) s where not exists (select 1 from characters_public c where c.id = s.id and c.name = s.name)) is distinct from 0 then raise exception 'suggest_characters shows what characters_public does not'; end if;
    if (select array_agg(s.id order by s.name, s.id) from suggest_characters('mar', 10) s) is distinct from (select array_agg(c.id order by c.name, c.id) from characters_public c where fold_text(c.name) like 'mar%') then
      raise exception 'suggest_characters differs from the characters a prefix starts'; end if;
    own := (select array_agg(row(s.id, s.name)::text order by s.name, s.id) from suggest_characters('mar', 10) s);
    perform tests.unbecome();
    perform tests.become(other);
    if own is distinct from (select array_agg(row(s.id, s.name)::text order by s.name, s.id) from suggest_characters('mar', 10) s) then raise exception 'suggest_characters changes with who asks'; end if;
    perform tests.unbecome();
    perform tests.become(ann);
    own2 := search_suggest('mar', '{characters}', null, false, 5);
    perform tests.unbecome();
    perform tests.become(other);
    if own2 is distinct from search_suggest('mar', '{characters}', null, false, 5) then raise exception 'the suggested characters change with who asks (or who owns)'; end if;
    perform tests.unbecome();
  end;
end
$test$;

-- 14. Refusals, a visitor, and what the functions are.
do $test$
declare
  who uuid := tests.account('refused');
  fn text;
  bad text;
  got text;
  q201 text := 'repeat(''a'', 201)';
  good_cursor text := $c$'{"at": "2026-01-01T00:00:00+00:00", "act": "00000000-0000-0000-0000-000000000000"}'::jsonb$c$;
begin
  perform tests.become(who);
  for fn in select unnest(array['sp', 'st']) loop
    for bad in select unnest(array['per_page => 0', 'per_page => 51', 'per_page => -1', 'sort => ''bogus''', 'sort => ''''', 'q => ' || q201,
                                   'from_at => now(), to_at => now() - interval ''1 second''', 'from_at => now(), to_at => now()',
                                   'after => ''"x"''::jsonb', 'after => ''{}''::jsonb', 'after => ''[]''::jsonb', 'after => ''{"at": "nope", "act": "x"}''::jsonb',
                                   'after => ''{"at": "2026-01-01T00:00:00Z", "act": "not-a-uuid"}''::jsonb',
                                   'after => ''{"at": "2026-01-01T00:00:00Z", "act": "00000000-0000-0000-0000-000000000000", "rank": "high"}''::jsonb',
                                   'after => ''{"act": "00000000-0000-0000-0000-000000000000"}''::jsonb',
                                   -- Q-1: a cursor of the right shape whose values do not cast is a refusal, not a raw Postgres error; a relevance search needs the rank.
                                   'after => ''{"at": "2026-13-45T00:00:00Z", "act": "00000000-0000-0000-0000-000000000000"}''::jsonb',
                                   'after => ''{"at": "2026-02-30T00:00:00Z", "act": "00000000-0000-0000-0000-000000000000"}''::jsonb',
                                   'after => ''{"at": "2026-01-01T25:00:00Z", "act": "00000000-0000-0000-0000-000000000000"}''::jsonb',
                                   'after => ''{"at": "2026-01-01T00:00:00+99:99", "act": "00000000-0000-0000-0000-000000000000"}''::jsonb',
                                   'after => ''{"rank": 1e400, "at": "2026-01-01T00:00:00Z", "act": "00000000-0000-0000-0000-000000000000"}''::jsonb',
                                   'sort => ''newest'', after => ''{"rank": 1e400, "at": "2026-01-01T00:00:00Z", "act": "00000000-0000-0000-0000-000000000000"}''::jsonb',
                                   'q => ''x'', after => ' || good_cursor,
                                   'q => ''x'', sort => ''relevance'', after => ' || good_cursor,
                                   'q => ''x'', after => ''{"rank": null, "at": "2026-01-01T00:00:00Z", "act": "00000000-0000-0000-0000-000000000000"}''::jsonb']) loop
      got := pg_temp.hint_of(format('select pg_temp.%s(%s)', fn, bad));
      if got is distinct from '22023/kayfabb.refusal' then raise exception '%: % was not refused as a refusal: %', fn, bad, got; end if;
    end loop;
    for bad in select unnest(array['per_page => 1', 'per_page => 50', 'sort => ''newest''', 'q => repeat(''a'', 200)', 'from_at => now() - interval ''1 day'', to_at => now()', 'after => ' || good_cursor,
                                   'sort => ''relevance'', after => ' || good_cursor, 'q => ''x'', sort => ''newest'', after => ' || good_cursor, 'q => ''x'', sort => ''oldest'', after => ' || good_cursor,
                                   'sort => ''relevance'', q => ''x'', after => ''{"rank": 0.5, "at": "2026-01-01T00:00:00Z", "act": "00000000-0000-0000-0000-000000000000"}''::jsonb']) loop
      got := pg_temp.hint_of(format('select pg_temp.%s(%s)', fn, bad));
      if got is not null then raise exception '%: % was refused: %', fn, bad, got; end if;
    end loop;
  end loop;
  for bad in select unnest(array[
      'search_suggest(null, ''{}'', null, false, 5)', 'search_suggest(''ab'', ''{x}'', null, false, 5)', 'search_suggest(''ab'', ''{threads,x}'', null, false, 5)', 'search_suggest(''ab'', null, null, false, 0)',
      'search_suggest(''ab'', null, null, false, 11)', 'search_suggest(''a'', null, null, false, 5)', 'search_suggest(''a'', ''{threads}'', null, false, 5)', 'search_suggest(repeat(''a'', 101), null, null, false, 5)',
      'search_suggest('''', null, null, false, 5)', 'search_suggest('''', ''{characters}'', null, false, 5)', 'search_suggest('''', ''{threads,boards}'', null, false, 5)', 'search_suggest(null, null, null, false, 5)',
      'search_suggest('' a '', ''{threads}'', null, false, 5)', 'search_suggest(''ab'', ''{null}'', null, false, 5)']) loop
    got := pg_temp.hint_of('select ' || bad);
    if got is distinct from '22023/kayfabb.refusal' then raise exception '% was not refused as a refusal: %', bad, got; end if;
  end loop;
  for bad in select unnest(array['search_suggest(''ab'', null, null, false, 10)', 'search_suggest(repeat(''a'', 100), null, null, false, 1)', 'search_suggest('''', ''{threads}'', null, true, null)',
                                 'search_suggest(null, ''{threads}'', null, true, 3)', 'search_suggest('' ab '', ''{boards,characters}'', null, null, 2)']) loop
    got := pg_temp.hint_of('select ' || bad);
    if got is not null then raise exception '% was refused: %', bad, got; end if;
  end loop;
  perform tests.unbecome();

  -- A visitor reads no thread, and so searches none.
  perform tests.become_anon();
  for bad in select unnest(array['search_posts(null, null, null, null, null, false, null, null, null)', 'search_threads(null, null, null, null, null, false, null, null, null)',
                                 'search_suggest(''ab'', null, null, false, 5)', 'suggest_characters(''ab'', 5)', 'search_matches(null, null, null, null, null, false, true, null, null, 5)', 'search_walk(null, null, null, null, null, false, true, null, null, 5, 5)']) loop
    got := pg_temp.hint_of('select * from ' || case when bad like 'suggest_characters%' or bad like 'search_matches%' or bad like 'search_walk%' then bad else '(select ' || bad || ') x' end);
    if got is distinct from '42501/' then raise exception 'a visitor could run %: %', bad, got; end if;
  end loop;
  perform tests.unbecome();

  -- What they are: invokers and stable; the reads, the suggested threads and the cursor check in plpgsql with one generic plan kept per connection (0368; a screen's dependencies are checked by the call-coverage guard in tools/test-sql.mjs, not recorded); the matches are built as text and
  -- run, in plpgsql, invoker and stable too; the two definers pin their search_path.
  for fn in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('search_posts', 'search_threads', 'search_suggest', 'search_cursor_ok') and (p.prosecdef or p.provolatile = 'v' or (p.proname <> 'search_cursor_ok' and (p.prolang <> (select oid from pg_language where lanname = 'plpgsql') or p.proconfig is null or not p.proconfig @> array['plan_cache_mode=force_generic_plan', 'jit=off']))) loop
    raise exception '% is a definer, volatile, or not plpgsql with the fixed plan', fn;
  end loop;
  for fn in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('search_matches_sql', 'search_walk_sql', 'search_match_conds') and (p.prosecdef or p.provolatile <> 's') loop
    raise exception '% is a definer or not stable', fn;
  end loop;
  -- The three that run the built text read post_search.character, which a signed-in player is not granted (the post's author is shown through shown_author): definers, stable, search_path pinned ending in pg_temp.
  for fn in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('search_matches', 'search_walk', 'search_thread_matches')
            and not (p.prosecdef and p.provolatile = 's' and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp')) loop
    raise exception '% is not a stable definer with a pinned search_path', fn;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('search_posts', 'search_threads', 'search_suggest', 'search_matches', 'search_matches_sql', 'search_suggest_threads', 'search_cursor_ok', 'search_updates_thread', 'suggest_characters',
                        'search_cursor_cast', 'search_match_conds', 'search_thread_matches', 'search_post_cards', 'search_walk', 'search_walk_sql')) is distinct from 15 then
    raise exception 'a search function is missing';
  end if;
  if not exists (select 1 from pg_proc p where p.proname = 'search_updates_thread' and p.prosecdef and p.provolatile = 's' and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp')) then
    raise exception 'search_updates_thread is not a stable definer with a pinned search_path';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('search_posts', 'search_threads', 'search_suggest') and p.provolatile <> 's') then raise exception 'a search read is not stable'; end if;
  -- Q-3: the suggested threads are an invoker, stable, with a pinned search_path and the trigram threshold (a string body, so the scale test can read its plan; a function with settings is not inlined).
  if not exists (select 1 from pg_proc p where p.proname = 'search_suggest_threads' and not p.prosecdef and p.provolatile = 's' and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp')
                 and exists (select 1 from unnest(p.proconfig) c where c like 'pg_trgm.word_similarity_threshold=%0.3%')) then
    raise exception 'search_suggest_threads is not a stable invoker with a pinned search_path and the trigram threshold';
  end if;
  if not exists (select 1 from pg_proc p where p.proname = 'suggest_characters' and p.prosecdef and p.provolatile = 's'
                 and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp')) then raise exception 'suggest_characters is not a stable definer with a pinned search_path'; end if;
  for fn in select unnest(array['search_posts(text,uuid,uuid,timestamptz,timestamptz,boolean,text,jsonb,integer)', 'search_threads(text,uuid,uuid,timestamptz,timestamptz,boolean,text,jsonb,integer)',
                                'search_suggest(text,text[],uuid,boolean,integer)', 'suggest_characters(text,integer)', 'search_matches(text,uuid,uuid,timestamptz,timestamptz,boolean,boolean,timestamptz,uuid,integer)',
                                'search_walk(text,uuid,uuid,timestamptz,timestamptz,boolean,boolean,timestamptz,uuid,integer,integer)',
                                'search_suggest_threads(text,uuid,boolean,integer)', 'search_cursor_ok(jsonb,boolean)', 'search_updates_thread()', 'search_cursor_cast(jsonb)',
                                'search_thread_matches(uuid,tsquery,uuid,timestamptz,timestamptz,boolean)', 'search_post_cards(uuid)']) loop
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') or has_function_privilege('anon', fn::regprocedure, 'execute') then raise exception '% is not for signed-in players alone', fn; end if;
  end loop;
end
$test$;

-- 14b. The board and the first-post flag are copied onto the row ("the board is copied, kept in sync", migration header): written by the trigger and the backfill, and a thread moved to another
--      board takes its posts with it, so a board-filtered search finds them in the new board and no longer in the old one.
do $test$
declare
  ann uuid := tests.account('mover');
  c uuid := tests.character(ann, 'Mover');
  b1 uuid;
  b2 uuid;
  t uuid;
  p1 uuid;
  p2 uuid;
  who uuid;
begin
  insert into boards (slug, name) values ('move-1', 'Move 1') returning id into b1;
  insert into boards (slug, name) values ('move-2', 'Move 2') returning id into b2;
  insert into threads (board, title) values (b1, 'Zebrafish census') returning id into t;
  p1 := tests.post(c, t, 'Zebrafish swim in schools.');
  p2 := tests.post(c, t, 'More zebrafish, later.');
  if (select p.board from post_search p where p.act = p1) is distinct from b1 or (select p.board from post_search p where p.act = p2) is distinct from b1 then raise exception 'the trigger did not copy the board'; end if;
  if (select p.first from post_search p where p.act = p1) is distinct from true or (select p.first from post_search p where p.act = p2) is distinct from false then raise exception 'the trigger did not flag the first post, and only it'; end if;
  -- The backfill writes both too.
  delete from post_search where act in (p1, p2);
  if search_backfill() < 2 then raise exception 'the backfill did not rewrite the two rows'; end if;
  if (select array_agg(p.board::text || p.first::text order by a.seq) from post_search p join acts a on a.id = p.act where p.thread = t) is distinct from array[b1::text || 'true', b1::text || 'false'] then
    raise exception 'the backfill did not fill the board and the flag'; end if;
  -- An edit and a language rebuild leave them.
  perform tests.act(c, 'edit', t, '{"body": "Zebrafish swim in big schools."}', p1, now() + interval '1 second');
  update settings set value = '"simple"' where key = 'searchLanguage';
  loop exit when search_rebuild_step() = 0 and not exists (select 1 from search_rebuild); end loop;
  update settings set value = '"english"' where key = 'searchLanguage';
  loop exit when search_rebuild_step() = 0 and not exists (select 1 from search_rebuild); end loop;
  if (select array_agg(p.board::text || p.first::text order by a.seq) from post_search p join acts a on a.id = p.act where p.thread = t) is distinct from array[b1::text || 'true', b1::text || 'false'] then
    raise exception 'an edit or a rebuild changed the board or the flag'; end if;
  who := tests.account('mover reader');
  perform tests.become(who);
  if jsonb_array_length(search_posts('zebrafish', null, b1, null, null, false, null, null, 20) -> 'results') is distinct from 2 or jsonb_array_length(search_posts('zebrafish', null, b2, null, null, false, null, null, 20) -> 'results') is distinct from 0 then
    raise exception 'before the move the posts are in board 1'; end if;
  perform tests.unbecome();
  -- A moveThread in force and the rebuild that lands it (0339): the thread's board and its posts' search copy move together, in rebuild_thread_places, the one writer of threads.board.
  -- (The Act is written in replica mode, which skips the staff-character check this test has no staff for; its open_moves row is what the move's trigger would write.)
  set local session_replication_role = replica;
  insert into acts (id, character, kind, thread, payload, seq) values (gen_random_uuid(), c, 'move', t, jsonb_build_object('kind', 'moveThread', 'body', 'Moved.', 'params', jsonb_build_object('thread', t, 'board', b2)), 3);
  insert into open_moves (move_act, landed_at) select a.id, a.created_at from acts a where a.thread = t and a.kind = 'move';
  set local session_replication_role = origin;
  if rebuild_thread_places(array[t]) is distinct from 1 then raise exception 'the rebuild did not move the thread'; end if;
  perform tests.become(who);
  if jsonb_array_length(search_posts('zebrafish', null, b2, null, null, false, null, null, 20) -> 'results') is distinct from 2 or jsonb_array_length(search_posts('zebrafish', null, b1, null, null, false, null, null, 20) -> 'results') is distinct from 0 then
    raise exception 'a thread moved to another board did not take its posts in board-filtered search'; end if;
  if jsonb_array_length(search_threads('zebrafish', null, b2, null, null, true, null, null, 20) -> 'results') is distinct from 1 or jsonb_array_length(search_posts('zebrafish', null, b2, null, null, true, null, null, 20) -> 'results') is distinct from 1
     or (search_threads('zebrafish', null, b2, null, null, false, 'newest', null, 20) -> 'results' -> 0 ->> 'board')::uuid is distinct from b2 then
    raise exception 'a moved thread is not found, titles only or by its newest match, in its new board'; end if;
  perform tests.unbecome();
end
$test$;

-- 14c. A post under a live author veil (supabase/migrations/0357_post_veils.sql, section on search): the search finds it under the stand-in and not under its author, a word in it finds it
--      shown as the stand-in's, and post_search.character is no column a signed-in player reads. The veil is left in the table, live, for the scale test below: every bound there holds with it.
do $test$
declare
  ann uuid := tests.account('veil searcher');
  rdr uuid := tests.account('veil reader');
  a uuid := tests.character(ann, 'Veiled Vera');
  b uuid := tests.character(ann, 'Veiled Vince');
  stand uuid;
  t uuid := tests.thread('Veiled pie thread');
  p uuid; q uuid; play uuid;
  j jsonb; got text;
begin
  select c.id into stand from characters c where c.staff_kind = 'anonymous';
  if stand is null then
    insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning id into stand;
    insert into character_profiles (character, title, signature) values (stand, 'Could be anyone.', '');
  end if;
  p := tests.post(a, t, 'A persimmon cobbler, whose author hides.');
  q := tests.post(a, t, 'A persimmon pudding, in the open.');
  -- A veil as a cast leaves it (the post's play is a card Act on it); written here as the table holds it, so this file needs no card.
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack) values ('srchveil', 'Srch Veil', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1) on conflict (key) do nothing;
  play := tests.act(b, 'card', t, '{"card": "srchveil", "reach": "post"}', p);
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (play, p, 'author', a, ann, now() + interval '3 days');

  perform tests.become(rdr);
  -- By the author: the open post is found and the veiled one is not.
  j := search_posts('persimmon', a, null, null, null, false, 'newest', null, 20);
  if (select array_agg(r ->> 'act' order by r ->> 'act') from jsonb_array_elements(j -> 'results') r) is distinct from array[q::text] or (j ->> 'count')::integer is distinct from 1 then
    raise exception 'a search by the author finds the veiled post, or misses the open one: %', j;
  end if;
  j := search_threads('cobbler', a, null, null, null, false, 'newest', null, 20);
  if jsonb_array_length(j -> 'results') is distinct from 0 then raise exception 'a thread search by the author finds the veiled post: %', j; end if;
  -- By the stand-in: the veiled post is found, as the stand-in's, and the open one is not.
  j := search_posts('persimmon', stand, null, null, null, false, 'newest', null, 20);
  if (select array_agg(r ->> 'act' order by r ->> 'act') from jsonb_array_elements(j -> 'results') r) is distinct from array[p::text] or (j ->> 'count')::integer is distinct from 1
     or (j -> 'results' -> 0 ->> 'character')::uuid is distinct from stand or j::text like '%' || a::text || '%' then
    raise exception 'a search by the stand-in does not find the veiled post as the stand-in''s: %', j;
  end if;
  j := search_threads('cobbler', stand, null, null, null, false, 'newest', null, 20);
  if jsonb_array_length(j -> 'results') is distinct from 1 or (j -> 'results' -> 0 ->> 'matches')::integer is distinct from 1 or j::text like '%' || a::text || '%' then
    raise exception 'a thread search by the stand-in does not find the veiled post: %', j;
  end if;
  -- By a word in it, with no author: found, under the stand-in, the author's id nowhere.
  for got in select unnest(array['newest', 'oldest', 'relevance']) loop
    j := search_posts('cobbler', null, null, null, null, false, got, null, 20);
    if jsonb_array_length(j -> 'results') is distinct from 1 or (j -> 'results' -> 0 ->> 'character')::uuid is distinct from stand or j::text like '%' || a::text || '%' then
      raise exception 'a word in the veiled post (%) does not find it under the stand-in: %', got, j;
    end if;
    j := search_threads('cobbler', null, null, null, null, false, got, null, 20);
    if jsonb_array_length(j -> 'results') is distinct from 1 or (j -> 'results' -> 0 ->> 'character')::uuid is distinct from stand or j::text like '%' || a::text || '%' then
      raise exception 'a word in the veiled post (%) does not find its thread under the stand-in: %', got, j;
    end if;
  end loop;
  -- The open post of the same author shows the author, as it always did.
  j := search_posts('pudding', null, null, null, null, false, 'newest', null, 20);
  if (j -> 'results' -> 0 ->> 'character')::uuid is distinct from a then raise exception 'an open post shows someone else: %', j; end if;
  -- The column is not a signed-in player's to read; the rest of the table is.
  got := pg_temp.refusal('select character from post_search');
  if got is null or got not like '42501%' then raise exception 'post_search.character is readable by a signed-in player: %', got; end if;
  got := pg_temp.refusal('select act, thread, board, first, created_at, words from post_search limit 1');
  if got is not null then raise exception 'the rest of post_search is no longer readable: %', got; end if;
  got := pg_temp.refusal('select * from post_search limit 1');
  if got is null or got not like '42501%' then raise exception 'select * from post_search is allowed: %', got; end if;
  perform tests.unbecome();
end
$test$;

-- 15. The scale test. 200,000 posts over 2,000 threads, 2,000 characters; a common word in half of the posts and a rare one in ten. Written straight into acts, threads, characters and post_search
-- (with the Act triggers off for the insert, since the writers' rules are tested elsewhere and a trigger a row is minutes), then analyzed, as a busy instance's tables are. The plans are read, not
-- timed: with sequential scans turned off, a plan that still has one has no index to use, so a loaded machine cannot trip this. What is held: no sequential scan on post_search, acts, threads or
-- characters in any plan of the matches (each sort, with and without the filters, the count and the pool) or of the suggestions, and that a relevance search's ranked rows never exceed the pool.
-- The matches are read as the text search_matches_sql builds and search_matches runs (the planner sees the word); the suggested threads, which run inside a SQL function, as a generic plan of a
-- prepared statement, which is how that function plans them.
create function pg_temp.plan_of(stmt text) returns jsonb language plpgsql as $$
declare plan jsonb;
begin
  execute 'explain (format json) ' || stmt into plan;
  return plan;
end $$;
create function pg_temp.seq_scans(plan jsonb) returns text language sql as $$
  select string_agg(distinct n ->> 'Relation Name', ', ') from jsonb_path_query(plan, '$.**') n
  where jsonb_typeof(n) = 'object' and n ->> 'Node Type' = 'Seq Scan' and n ->> 'Relation Name' in ('post_search', 'acts', 'threads', 'characters') $$;
create function pg_temp.index_scans(plan jsonb, rel text) returns bigint language sql as $$
  select count(*) from jsonb_path_query(plan, '$.**') n where jsonb_typeof(n) = 'object' and n ->> 'Relation Name' = rel and n ->> 'Node Type' in ('Index Scan', 'Index Only Scan', 'Bitmap Heap Scan') $$;
create function pg_temp.max_limit(plan jsonb) returns numeric language sql as $$
  select max((n ->> 'Plan Rows')::numeric) from jsonb_path_query(plan, '$.**') n where jsonb_typeof(n) = 'object' and n ->> 'Node Type' = 'Limit' $$;

create function pg_temp.max_limit_read(plan jsonb) returns numeric language sql as $$
  select max((n ->> 'Actual Rows')::numeric) from jsonb_path_query(plan, '$.**') n where jsonb_typeof(n) = 'object' and n ->> 'Node Type' = 'Limit' $$;

-- The rows of post_search a plan read (BOUND-2): for each scan node of post_search, the rows it passed up (Actual Rows), the rows its filter removed (Rows Removed by Filter) and, for a bitmap heap
-- scan, the rows its recheck removed (Rows Removed by Index Recheck: the heap rows a lossy bitmap fetched and dropped), times Actual Loops, summed over every scan of post_search (the walk's probe by
-- thread is one, run once for each match it tests). A row a scan fetched and then dropped was read; counting only the rows passed up would let a plan read the whole table through a filter and
-- pass. `explain (analyze)` runs the statement, so these are the rows that really came. The Limit checks above read the rows a Limit passed up, which a filter under the Limit (a board, titles
-- only) does not bound.
-- A bitmap index scan names its index and no relation, and passes up the entries it found (its Actual Rows: every posting of the word it matched, before the heap is touched), so a BitmapAnd
-- that reads a word's postings across the whole instance and keeps the heap at M would pass on the heap rows alone. Those entries are counted too, for the indexes of post_search (read from
-- pg_indexes when the check runs, so an index added later is covered), times Actual Loops. The two are not summed: an entry the bitmap found and the heap row it led to are one row read twice,
-- and summing would hold a plan that is right to twice the allowance. The rows read are the larger of what the plan's heap scans read (above) and what its bitmap index scans found.
create function pg_temp.rows_read(plan jsonb) returns numeric language sql as $$
  select greatest(
    coalesce(sum(((n ->> 'Actual Rows')::numeric + coalesce((n ->> 'Rows Removed by Filter')::numeric, 0) + coalesce((n ->> 'Rows Removed by Index Recheck')::numeric, 0)) * (n ->> 'Actual Loops')::numeric)
      filter (where n ->> 'Relation Name' = 'post_search' and n ->> 'Node Type' in ('Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan')), 0),
    coalesce(sum((n ->> 'Actual Rows')::numeric * (n ->> 'Actual Loops')::numeric)
      filter (where n ->> 'Node Type' = 'Bitmap Index Scan' and n ->> 'Index Name' in (select indexname from pg_indexes where tablename = 'post_search')), 0))
  from jsonb_path_query(plan, '$.**') n
  where jsonb_typeof(n) = 'object' $$;
create function pg_temp.explain_run(stmt text) returns jsonb language plpgsql as $$
declare plan jsonb;
begin
  execute 'explain (analyze, format json) ' || stmt into plan;
  return plan;
end $$;

do $test$
declare
  base timestamptz := now() - interval '100 days';
  started timestamptz := clock_timestamp();
  scale_board uuid;
  board10 uuid;
  board1 uuid;
  read_n numeric;
  m_rows bigint;
  allowed numeric;
  fb uuid;
  ft boolean;
  worst numeric := 0;
  bounded_shapes integer := 0;
  probe_words text[] := array['common', 'zyxwv'];
  w text;
  ok_n integer;
  other_rows bigint;
  walk boolean;
  plan jsonb;
  seqs text;
  stmt text;
  pool constant integer := 5000;
  shapes text[];
  s text;
  who uuid;
  a_char uuid;
  a_board uuid;
  n bigint;
  j jsonb;
  tdone timestamptz;
  t0 timestamptz;
  cur jsonb;
  seen uuid[] := '{}';
begin
  insert into boards (slug, name) values ('scale', 'Scale') returning id into scale_board;
  -- Two more boards: one holds 10% of the threads (numbered 1 or 2 in twenty: half odd, so half hold the common word, which is 10% of its matches) and one 1% (3 in a hundred, all odd). Odd threads carry the common word in their title too.
  insert into boards (slug, name) values ('scale-ten', 'Scale ten') returning id into board10;
  insert into boards (slug, name) values ('scale-one', 'Scale one') returning id into board1;
  insert into threads (id, board, title, created_at, next_seq, last_at, replies)
  select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, case when g % 20 in (1, 2) then board10 when g % 100 = 3 then board1 else scale_board end,
         'Scale thread ' || g || case when g % 100 = 0 then ' marmot' else '' end || case when g % 2 = 1 then ' common' else '' end, base + g * interval '1 minute', 101, base + interval '100 days', 99
  from generate_series(1, 2000) g;
  create temp table scale_owners on commit drop as select g, tests.account('scale owner ' || g) as id from generate_series(0, 399) g;
  insert into characters (id, owner, name, created_at, debuted_at)
  select ('00000000-0000-4000-9000-' || lpad(gs.k::text, 12, '0'))::uuid, o.id, 'Scale character ' || gs.k || case when gs.k % 500 = 0 then ' Mario' else '' end, base, base
  from generate_series(1, 2000) as gs(k) join scale_owners o on o.g = gs.k % 400;
  alter table acts disable trigger user;
  insert into acts (id, character, kind, thread, payload, seq, created_at)
  select ('00000000-0000-4000-a000-' || lpad(g::text, 12, '0'))::uuid,
         ('00000000-0000-4000-9000-' || lpad((g % 2000 + 1)::text, 12, '0'))::uuid, 'post',
         ('00000000-0000-4000-8000-' || lpad((g % 2000 + 1)::text, 12, '0'))::uuid,
         jsonb_build_object('body', 'Post ' || g || ' about topic' || (g % 997) || case when g % 2 = 0 then ' common' else '' end || case when g % 20000 = 0 then ' zyxwv' else '' end),
         (g - 1) / 2000 + 1, base + g * interval '1 second'
  from generate_series(1, 200000) g;
  alter table acts enable trigger user;
  insert into post_search (act, thread, board, first, character, created_at, words)
  select a.id, a.thread, t.board, a.seq = 1, a.character, a.created_at,
         case when a.seq = 1 then setweight(to_tsvector('english', t.title), 'A') else ''::tsvector end || to_tsvector('english', a.payload ->> 'body')
  from acts a join threads t on t.id = a.thread and t.board in (scale_board, board10, board1);
  analyze post_search; analyze acts; analyze threads; analyze characters;
  raise notice 'scale: % posts in % threads written in %', (select count(*) from post_search p where p.board in (scale_board, board10, board1)), 2000, clock_timestamp() - started;
  if (select count(*) from post_search p where p.board in (scale_board, board10, board1)) is distinct from 200000 then raise exception 'the scale fixture is not 200,000 posts'; end if;
  if (select count(*) from post_search where board = board10) is distinct from 20000 or (select count(*) from post_search where board = board1) is distinct from 2000 or (select count(*) from post_search where first and board in (scale_board, board10, board1)) is distinct from 2000 then
    raise exception 'the scale fixture''s boards are not 10%% and 1%% of the posts, or its first posts are not one for each thread'; end if;
  if (select count(*) from post_search where words @@ to_tsquery('english', 'zyxwv')) is distinct from 10 then raise exception 'the rare word is not in ten posts'; end if;
  if (select count(*) from post_search where words @@ to_tsquery('english', 'common')) < 100000 then raise exception 'the common word is not in half the posts'; end if;
  a_char := '00000000-0000-4000-9000-000000000007'::uuid;
  a_board := scale_board;

  set local enable_seqscan = off;
  -- The text of what a search runs, with the arguments written into it (search_matches_sql): the plan a search gets.
  foreach w in array probe_words loop
    -- text alone; newest, oldest; the page of 21, the pool, the count; with each filter and all of them; titles only; a cursor.
    foreach s in array array[
      search_matches_sql(w, null, null, null, null, false, true, null, null, 21),
      search_matches_sql(w, null, null, null, null, false, false, null, null, 21),
      search_matches_sql(w, null, null, null, null, false, true, null, null, pool),
      search_matches_sql(w, null, null, null, null, false, true, null, null, 1001),
      search_matches_sql(w, a_char, null, null, null, false, true, null, null, 21),
      search_matches_sql(w, null, a_board, null, null, false, true, null, null, 21),
      search_matches_sql(w, a_char, a_board, base, now(), false, false, base + interval '1 day', gen_random_uuid(), 21),
      search_matches_sql(w, null, null, null, null, true, true, null, null, 21),
      search_matches_sql(w, null, null, null, null, false, true, base + interval '2 days', gen_random_uuid(), 21),
      -- BOUND-1: the walk by time newest and oldest page and count by (the matches in order, the pool's worth at most, each tested for its thread's key): the same shapes.
      search_walk_sql(w, null, null, null, null, false, true, null, null, pool),
      search_walk_sql(w, null, null, null, null, false, false, null, null, pool),
      search_walk_sql(w, a_char, null, null, null, false, true, null, null, pool),
      search_walk_sql(w, null, a_board, null, null, false, true, null, null, pool),
      search_walk_sql(w, a_char, a_board, base, now(), false, false, base + interval '1 day', gen_random_uuid(), pool),
      search_walk_sql(w, null, null, null, null, true, true, null, null, pool),
      search_walk_sql(w, null, null, null, null, false, true, base + interval '2 days', gen_random_uuid(), pool),
      search_walk_sql(w, null, null, null, null, false, false, base + interval '2 days', gen_random_uuid(), pool)
    ] loop
      plan := pg_temp.plan_of(s);
      seqs := pg_temp.seq_scans(plan);
      if seqs is not null then raise exception 'a sequential scan on % in the plan of: %', seqs, s; end if;
      if pg_temp.index_scans(plan, 'post_search') = 0 then raise exception 'the plan does not read post_search through an index (the check would be vacuous): %', s; end if;
      if s like '%order by k.created_at%' and pg_temp.index_scans(plan, 'post_search') < 2 then raise exception 'the thread key''s probe does not read post_search through an index: %', s; end if;
      if pg_temp.max_limit(plan) > greatest(pool + 1, 1001) then raise exception 'a limit above the pool and one in: %', s; end if;
      if s like '% as is_key %' and pg_temp.max_limit(plan) > pool + 1 then raise exception 'a walk by time reads more than the pool and one in: %', s; end if;
      if s like '% limit ' || pool and pg_temp.max_limit(plan) > pool then raise exception 'relevance would rank more than the pool in: %', s; end if;
    end loop;
  end loop;
  -- Without a text query: the filters alone, each way.
  foreach s in array array[
    search_matches_sql(null, null, null, null, null, false, true, null, null, 21),
    search_matches_sql(null, null, null, null, null, false, true, null, null, 1001),
    search_matches_sql(null, null, null, null, null, false, false, null, null, 21),
    search_matches_sql(null, a_char, null, null, null, false, true, null, null, 21),
    search_matches_sql(null, a_char, null, null, null, false, false, null, null, 21),
    search_matches_sql(null, a_char, null, null, null, false, true, null, null, 1001),
    search_matches_sql(null, null, a_board, null, null, false, true, null, null, 21),
    search_matches_sql(null, null, null, base, now(), false, true, null, null, 21),
    search_matches_sql(null, null, null, null, null, true, true, null, null, 21),
    search_walk_sql(null, null, null, null, null, false, true, null, null, pool),
    search_walk_sql(null, null, null, null, null, false, false, null, null, pool),
    search_walk_sql(null, a_char, null, null, null, false, true, null, null, pool),
    search_walk_sql(null, null, a_board, null, null, false, true, null, null, pool),
    search_walk_sql(null, null, null, base, now(), false, true, null, null, pool)
  ] loop
    plan := pg_temp.plan_of(s);
    seqs := pg_temp.seq_scans(plan);
    if seqs is not null then raise exception 'a sequential scan on % in the plan of: %', seqs, s; end if;
    if pg_temp.index_scans(plan, 'post_search') = 0 then raise exception 'the plan does not read post_search through an index: %', s; end if;
  end loop;

  -- BOUND-2: a filtered search reads the filter's own matches, never the whole instance's. Each shape is run for real (`explain (analyze)`) and the rows of post_search it read (rows_read: every
  -- row a scan fetched, kept or dropped) are held to an allowance of M, the number of rows that meet the filter (the word, the board, titles only), and what the planner may rightly add:
  --   * 2 * M + 256 for the matches. Two ways to find a board's matches are both right: the board-and-word GIN reads M, and the board's own index with the word as a filter reads the board's posts,
  --     M / d for a word in a share d of them; the planner takes the second when the word is dense (here d is a half: 20,000 rows for 10,000 matches, and which one it takes flips with the sample
  --     ANALYZE draws), so 2 * M. The 256 is what a planner rather reads whole than looks up in a second index (a rare word's 10 matches elsewhere, a board's 20 or 200 first posts): about two
  --     pages of rows, a constant that grows with nothing. What it never reads is the word's matches in every board (100,000 for the common word) or the instance's posts: the board indexes
  --     (post_search_board_words, on the board's text, which only a search with a word asks of it) and the first-post ones keep it from that. Nothing else can meet a word's board: the plain-column btrees
  --     (post_search_board_newest) are not offered to a search with a word, whose matches are a materialized CTE found before they are ordered (search_matches_sql), so no estimate of the word can send
  --     the plan through the board's posts, or a bitmap of its entries, to find none (the defect this was red on: a rare word in a board with none of it read 2,010 rows of 256 allowed).
  --   * for a walk, also its probes: one for each match it tests, `least(M, pool + 1)` of them, except titles only, which has none (a thread has one first post, so each match is its key). A probe
  --     starts at the match and ends at the first match of its thread in the walk's direction. The fixture's plans read that range through post_search_thread_at: alone for the common word (the next
  --     match is the next row), and for the rare word ANDed with post_search_board_words on the word, as a bitmap. Its allowance, per probe: 2 for the common word, which is in every post of its threads, so the next match is the next row (a probe that read a thread's rows, 100 here, would read
  --     390,000 for the pool); 100 for the rare word, whose 10 matches are 10 posts apart in one thread of 100 posts, where the planner may read a short thread's range rather than look up its
  --     10 matches. At a busy instance a probe reads the gap to its thread's next match or that thread's matches, whichever the planner finds fewer, and across a walk about each thread's rows once.
  -- A plan may read fewer (a keyset walk stops at its limit); it may not read the rows the filter would have dropped. The boards are 10% and 1% of the threads, and the common word is in 100,000
  -- posts of 200,000. Titles only runs unfiltered too: 1,000 threads carry the word in their title, and a plan that reads the word's body matches across it reads 100,000. Each of these is red
  -- when its index is gone (a planted poison: the title probe back to the older `exists` form, the board indexes dropped, the first-post indexes dropped).
  foreach w in array array['common', 'zyxwv'] loop
    for fb, ft in select * from (values (board10, false), (board10, true), (null::uuid, true), (board1, false), (board1, true)) as v(b, t) loop
      m_rows := (select count(*) from post_search p
                 where p.words @@ to_tsquery('english', w) and (fb is null or p.board = fb) and (not ft or (p.first and ts_filter(p.words, '{a}') @@ to_tsquery('english', w))));
      foreach s in array array[
        search_matches_sql(w, null, fb, null, null, ft, true, null, null, pool + 1),         -- relevance: the pool and one over
        search_matches_sql(w, null, fb, null, null, ft, true, null, null, 21),               -- newest page
        search_matches_sql(w, null, fb, null, null, ft, false, null, null, 21),              -- oldest page
        search_matches_sql(w, null, fb, null, null, ft, true, null, null, 1001),             -- the count
        search_walk_sql(w, null, fb, null, null, ft, true, null, null, pool),                -- the threads walk, newest
        search_walk_sql(w, null, fb, null, null, ft, false, null, null, pool)                -- and oldest
      ] loop
        plan := pg_temp.explain_run(s);
        read_n := pg_temp.rows_read(plan);
        allowed := 2 * m_rows + 256 + case when s like '%order by k.created_at%' then least(m_rows, pool + 1) * case when w = 'common' then 2 else 100 end else 0 end;
        worst := greatest(worst, read_n);
        bounded_shapes := bounded_shapes + 1;
        if read_n > allowed then raise exception 'a filtered search read % rows of post_search, and the filter has % matches (% allowed): %', read_n, m_rows, allowed, s; end if;
      end loop;
    end loop;
  end loop;
  -- The common word with no filter (BOUND-2 for the shapes that have none): the matches are the newest rows of post_search that hold the word, a page of 21 of them, the pool and one for relevance, 1,001 for the
  -- count, and the threads walk's pool and one with its probes. A walk newest-first (or oldest-first) finds each in `n` matches, and the word is in every other post, so it reads 2 * n rows; the allowance is 4 * n + 256,
  -- twice that for the sample ANALYZE draws (the word's density is an estimate to the planner, which can take the walk for a share of the table a little over or under a half) and the 256 the other shapes above
  -- allow for, and the rows the earlier sections of this file left in post_search (`other_rows`: a walk by time passes the ones newer or older than the fixture that do not hold the word, 1,700 of them, a constant that
  -- grows with nothing). What it must not do is what a plan that finds the word's matches first and sorts them does: read all 100,000 of them for every page, 200 ms at this scale, growing with the instance (the
  -- `materialized` form that bounds a board's matches, applied here, reads 100,000 for each of these and is red on all of them). A walk adds its probes: 2 for each match tested, as for a board above.
  other_rows := (select count(*) from post_search p where p.board not in (scale_board, board10, board1));
  for s, ok_n, walk in select v.s, v.n, v.walk from (values
    (search_matches_sql('common', null, null, null, null, false, true, null, null, pool + 1), pool + 1, false),
    (search_matches_sql('common', null, null, null, null, false, true, null, null, 21), 21, false),
    (search_matches_sql('common', null, null, null, null, false, false, null, null, 21), 21, false),
    (search_matches_sql('common', null, null, null, null, false, true, null, null, 1001), 1001, false),
    (search_walk_sql('common', null, null, null, null, false, true, null, null, pool), pool + 1, true),
    (search_walk_sql('common', null, null, null, null, false, false, null, null, pool), pool + 1, true)
  ) as v(s, n, walk) loop
    plan := pg_temp.explain_run(s);
    read_n := pg_temp.rows_read(plan);
    allowed := 4 * ok_n + 256 + other_rows + case when walk then 2 * ok_n else 0 end;
    worst := greatest(worst, read_n);
    bounded_shapes := bounded_shapes + 1;
    if read_n > allowed then raise exception 'an unfiltered search for the common word read % rows of post_search (% allowed): %', read_n, allowed, s; end if;
  end loop;
  -- An author: the author's own posts (A) bound it. Without statistics for the author's column and the words the planner took the word's index and filtered 100,000 matches down to the author's 50, so the
  -- statistics for the two are dropped here (as a table nothing has analyzed has them) and the plan is held to 2 * A + 256: the author's index, with the word as a filter on what it finds. Analyzed again after.
  delete from pg_statistic where starelid = 'post_search'::regclass and staattnum in (select a.attnum from pg_attribute a where a.attrelid = 'post_search'::regclass and a.attname in ('character', 'words'));
  foreach w in array array['common', 'zyxwv'] loop
    foreach s in array array[
      search_matches_sql(w, a_char, null, null, null, false, true, null, null, pool + 1),
      search_matches_sql(w, a_char, null, null, null, false, true, null, null, 21),
      search_matches_sql(w, a_char, null, null, null, false, false, null, null, 21)
    ] loop
      m_rows := (select count(*) from post_search p where p."character" = a_char);
      plan := pg_temp.explain_run(s);
      read_n := pg_temp.rows_read(plan);
      allowed := 2 * m_rows + 256;
      bounded_shapes := bounded_shapes + 1;
      if read_n > allowed then raise exception 'a search by an author read % rows of post_search, and the author has % (% allowed): %', read_n, m_rows, allowed, s; end if;
    end loop;
  end loop;
  -- A prolific author (BOUND-2, J1): an author with a word and no board is bounded by the keyset walk down the author's index, which stops at its limit; the plan's cost is its limit times the word's density
  -- there, 2 for the common word (it is in every other post), and not the author's posts (A). The author above has 100 posts, and 2 * A + 256 holds a plan that reads all of them, so it could not be red for a
  -- plan that does. This one has 40,000 (a fifth of the instance, the figure of a prolific player's character), A well over 5 * 5,001 + 256 (the most any shape below is allowed), and its posts in 2,000 threads of their own, 20 in a row (a thread's next match is then the next row or the one after, as for the unfiltered shapes above, so the probes are not the fixture's), and the statistics
  -- are present (analyzed, as a deployed instance's are): the author's word is read through `words || ''`, an expression with no statistics of its own, so the planner took 0.5% of A for its matches and, for any
  -- limit above that (the count's 1,001, the pool's 5,001, the threads walk's budget), planned a read of all of A and a sort (post_search_words_expr, the expression statistics in the migration, are what it is
  -- costed from). The allowance, per shape: 2 * lim + 256 for the matches (two rows read for each, and the 256 of the other shapes), and for the threads walk 3 * lim more for its probes (2 rows for each match tested here: the match's next row, and the one after). Red without the expression
  -- statistics (the plan reads 40,000 for the count, the pool and the walk) and red for the materialized form (it reads all of the word's matches in every board).
  declare
    pro uuid := '00000000-0000-4000-9000-000000009999';
  begin
    insert into characters (id, owner, name, created_at, debuted_at) values (pro, tests.account('prolific owner'), 'Prolific', base, base);
    insert into threads (id, board, title, created_at, next_seq, last_at, replies)
    select ('00000000-0000-4000-8100-' || lpad(g::text, 12, '0'))::uuid, scale_board, 'Prolific thread ' || g, base, 21, base + interval '1 day', 19 from generate_series(1, 2000) g;
    alter table acts disable trigger user;
    insert into acts (id, character, kind, thread, payload, seq, created_at)
    select ('00000000-0000-4000-a900-' || lpad(g::text, 12, '0'))::uuid, pro, 'post', ('00000000-0000-4000-8100-' || lpad(((g - 1) / 20 + 1)::text, 12, '0'))::uuid,
           jsonb_build_object('body', 'Prolific post ' || g || case when g % 2 = 0 then ' common' else '' end), (g - 1) % 20 + 1, base + g * interval '2 seconds'
    from generate_series(1, 40000) g;
    insert into post_search (act, thread, board, first, character, created_at, words)
    select a.id, a.thread, t.board, false, a.character, a.created_at, to_tsvector('english', a.payload ->> 'body') from acts a join threads t on t.id = a.thread where a.character = pro;
    analyze post_search;
    if (select count(*) from post_search p where p."character" = pro) is distinct from 40000 then raise exception 'the prolific author does not have 40,000 posts'; end if;
    for s, ok_n in select v.s, v.n from (values
      (search_matches_sql('common', pro, null, null, null, false, true, null, null, 21), 21),
      (search_matches_sql('common', pro, null, null, null, false, false, null, null, 21), 21),
      (search_matches_sql('common', pro, null, null, null, false, true, null, null, 1001), 1001),
      (search_matches_sql('common', pro, null, null, null, false, true, null, null, pool + 1), pool + 1),
      (search_walk_sql('common', pro, null, null, null, false, true, null, null, pool), pool + 1),
      (search_walk_sql('common', pro, null, null, null, false, false, null, null, pool), pool + 1)
    ) as v(s, n) loop
      plan := pg_temp.explain_run(s);
      read_n := pg_temp.rows_read(plan);
      allowed := 2 * ok_n + 256 + case when s like '%order by k.created_at%' then 3 * ok_n else 0 end;
      -- The pool and the walk (a limit of the pool, 5,001) may read the author's own posts, A: the bound a filtered search is held to is the filter's own rows, as a
      -- board's is its matches (M), and whether the planner walks or sorts for a limit this near A's matches turns on its sample of the word (CI's Postgres sorted).
      -- The page and the count stay held to their limits, which is what a search by a prolific author pays on every request.
      -- A walk adds its per-match probes to that, as every walk's allowance above does (3 rows a match).
      if ok_n > 1001 then allowed := greatest(allowed, 40000 + 256 + case when s like '%order by k.created_at%' then 3 * ok_n else 0 end); end if;
      bounded_shapes := bounded_shapes + 1;
      worst := greatest(worst, read_n);
      raise notice 'prolific: % rows read (% allowed) for limit %', read_n, allowed, ok_n;
      if read_n > allowed then raise exception 'a search by a prolific author (40,000 posts) for the common word read % rows of post_search (% allowed): %', read_n, allowed, s; end if;
    end loop;
    -- The fixture is undone by rolling this block back (the acts are append-only, and deleting 40,000 of them checks each against every table that points at one).
    raise exception 'prolific fixture done' using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'prolific fixture done' then raise; end if;
  end;
  analyze post_search;
  analyze post_search;
  raise notice 'scale: % filtered shapes, the most rows of post_search read by one: %', bounded_shapes, worst;

  -- The suggestions: threads (a prefix, none, a board, the system board left out) and characters, whose body is the definer's own string.
  set local plan_cache_mode = force_generic_plan;   -- the suggestions run inside a SQL function, planned without the prefix
  execute format('prepare s_th(text, uuid, boolean, integer) as %s', (select p.prosrc from pg_proc p where p.proname = 'search_suggest_threads' and p.pronamespace = 'public'::regnamespace));
  foreach s in array array[
    'execute s_th(''scale'', null, false, 5)', 'execute s_th(''mairo'', null, true, 5)', 'execute s_th(''MAR'', null, false, 10)', 'execute s_th('''', null, false, 5)',
    format('execute s_th(''thread 1'', %L, true, 5)', scale_board), format('execute s_th('''', %L, true, 5)', scale_board)
  ] loop
    plan := pg_temp.plan_of(s);
    seqs := pg_temp.seq_scans(plan);
    if seqs is not null then raise exception 'a sequential scan on % in the plan of: %', seqs, s; end if;
    if pg_temp.index_scans(plan, 'threads') = 0 then raise exception 'the suggested threads do not read threads through an index (the check would be vacuous): %', s; end if;
  end loop;
  deallocate s_th;
  -- SPEC-2: what a thread result adds to its match, read in its own plan: how many of the thread's posts match (counted to 100, a probe of post_search by thread) and the card plays on the post (acts by target).
  execute format('prepare s_tm(uuid, tsquery, uuid, timestamptz, timestamptz, boolean) as %s', (select p.prosrc from pg_proc p where p.proname = 'search_thread_matches' and p.pronamespace = 'public'::regnamespace));
  foreach s in array array[
    'execute s_tm(''00000000-0000-4000-8000-000000000002'', to_tsquery(''english'', ''common''), null, null, null, false)',
    'execute s_tm(''00000000-0000-4000-8000-000000000002'', null, null, null, null, false)',
    format('execute s_tm(''00000000-0000-4000-8000-000000000002'', to_tsquery(''english'', ''common''), %L, %L, %L, true)', a_char, base, now()),
    'execute s_tm(''00000000-0000-4000-8000-000000000002'', to_tsquery(''english'', ''zyxwv''), null, null, null, true)'
  ] loop
    plan := pg_temp.plan_of(s);
    seqs := pg_temp.seq_scans(plan);
    if seqs is not null then raise exception 'a sequential scan on % in the plan of: %', seqs, s; end if;
    if pg_temp.index_scans(plan, 'post_search') = 0 then raise exception 'the matches of a thread do not read post_search through an index: %', s; end if;
  end loop;
  deallocate s_tm;
  execute format('prepare s_pc(uuid) as %s', (select p.prosrc from pg_proc p where p.proname = 'search_post_cards' and p.pronamespace = 'public'::regnamespace));
  plan := pg_temp.plan_of('execute s_pc(''00000000-0000-4000-a000-000000000001'')');
  seqs := pg_temp.seq_scans(plan);
  if seqs is not null then raise exception 'a sequential scan on % in the plan of the cards of a post', seqs; end if;
  if pg_temp.index_scans(plan, 'acts') = 0 then raise exception 'the cards of a post do not read acts through an index (the check would be vacuous)'; end if;
  deallocate s_pc;
  execute format('prepare s_ch(text, integer) as %s', (select p.prosrc from pg_proc p where p.proname = 'suggest_characters' and p.pronamespace = 'public'::regnamespace));
  foreach s in array array['execute s_ch(''mario'', 5)', 'execute s_ch(''mairo'', 3)', 'execute s_ch(''sc'', 10)', 'execute s_ch(''Scale char'', 10)'] loop
    plan := pg_temp.plan_of(s);
    seqs := pg_temp.seq_scans(plan);
    if seqs is not null then raise exception 'a sequential scan on % in the plan of: %', seqs, s; end if;
  end loop;
  deallocate s_ch;
  reset plan_cache_mode;
  reset enable_seqscan;

  -- The reads themselves, over the scale tables: the answers are what the fixture says they are.
  who := tests.account('scale reader');
  perform tests.become(who);
  j := search_posts('zyxwv', null, null, null, null, false, null, null, 20);
  if (j ->> 'count')::integer <> 10 or jsonb_array_length(j -> 'results') <> 10 or (j ->> 'pooled')::boolean then raise exception 'the rare word: %', j - 'results'; end if;
  j := search_posts('common', null, null, null, null, false, null, null, 20);
  if (j ->> 'count')::integer <> 1001 or not (j ->> 'more')::boolean or not (j ->> 'pooled')::boolean or jsonb_array_length(j -> 'results') <> 20 or (j -> 'next') is null then raise exception 'the common word: %', j - 'results'; end if;
  j := search_posts('common', null, null, null, null, false, 'newest', null, 50);
  if j -> 'results' -> 0 ->> 'seq' <> '100' then raise exception 'the newest common post is not the last one written: %', j -> 'results' -> 0; end if;
  t0 := clock_timestamp();
  j := search_threads('common', null, null, null, null, false, null, null, 50);
  raise notice 'scale: search_threads common relevance page 1 in %', clock_timestamp() - t0;
  -- The count is of the first `pool` matches (5,000): the newest 1,000 are the keys of the 1,000 odd threads, and more matches than the pool remain, so it says so.
  if (j ->> 'count')::integer <> 1000 or not (j ->> 'more')::boolean or not (j ->> 'pooled')::boolean then raise exception 'threads for the common word: %', j - 'results'; end if;
  -- BOUND-1: no walk by time reads more than the pool's worth of matches, however many there are (100,000 here, the thread keys among the newest 1,000), read in the plan that runs.
  -- The text is run by the definer that builds it (search_walk), so its plan is read as the owner here: the signed-in role is granted neither post_search.character nor shown_author.
  perform tests.unbecome();
  execute 'explain (analyze, format json) ' || search_walk_sql('common', null, null, null, null, false, true, null, null, pool) into plan;
  perform tests.become(who);
  if pg_temp.max_limit_read(plan) > pool + 1 then raise exception 'a walk read more than the pool and one: %', plan; end if;
  if (select count(*) from search_walk('common', null, null, null, null, false, true, null, null, 100000, pool) w where not w.stop) is distinct from 1000 or (select count(*) from search_walk('common', null, null, null, null, false, true, null, null, 100000, pool) w where w.stop) is distinct from 1 then
    raise exception 'a walk of the common word did not find the 1,000 keys among the first % matches and stop', pool; end if;
  -- Newest and oldest page threads by time: every thread that holds the word is reached by Next with no repeat, 20 pages of 50 and then the stretches of matches that are no thread's key, each a page of at most
  -- `pool` matches read (here 100,000 matches in 20 stretches). Timed: the first page, a deep one (the last of the threads), the empty stretches' last page, and the count (a page of 1: the count is most of it).
  foreach s in array array['newest', 'oldest'] loop
    cur := null; seen := '{}'; n := 0;
    loop
      n := n + 1;
      t0 := clock_timestamp();
      j := search_threads('common', null, null, null, null, false, s, cur, 50);
      if n in (1, 20) or (j -> 'next') = 'null'::jsonb then raise notice 'scale: search_threads common % page % in %', s, n, clock_timestamp() - t0; end if;
      if (j ->> 'count')::integer <> 1000 or not (j ->> 'more')::boolean or (j ->> 'pooled')::boolean then raise exception 'threads for the common word, %, page %: %', s, n, j - 'results'; end if;
      if n < 20 and jsonb_array_length(j -> 'results') <> 50 then raise exception 'threads for the common word, %, page % holds % results', s, n, jsonb_array_length(j -> 'results'); end if;
      if exists (select 1 from jsonb_array_elements(j -> 'results') r where (r ->> 'thread')::uuid = any (seen)) then raise exception 'a thread repeated on page % (%)', n, s; end if;
      seen := seen || coalesce((select array_agg((r ->> 'thread')::uuid) from jsonb_array_elements(j -> 'results') r), '{}');
      cur := j -> 'next';
      exit when cur is null or cur = 'null'::jsonb;
      if n > 60 then raise exception 'the walk by % does not end', s; end if;
    end loop;
    if cardinality(seen) <> 1000 then raise exception 'the walk by % reached % threads of 1,000', s, cardinality(seen); end if;
    if n > 20 + ceil(100000.0 / pool) + 1 then raise exception 'the walk by % took % pages: more than the threads'' pages and the matches over the pool', s, n; end if;
  end loop;
  t0 := clock_timestamp();
  j := search_threads('common', null, null, null, null, false, 'newest', null, 1);
  raise notice 'scale: search_threads common newest (page of 1: the count is most of it) in %', clock_timestamp() - t0;
  j := search_suggest('mairo', null, null, false, 5);
  if jsonb_array_length(j -> 'characters') <> 5 or j -> 'characters' -> 0 ->> 'name' <> 'Mario' then raise exception 'the characters named Mario (one before, four here, five asked for): %', j -> 'characters'; end if;
  perform tests.unbecome();
  tdone := clock_timestamp();
  raise notice 'scale: whole block in %', tdone - started;
end
$test$;
