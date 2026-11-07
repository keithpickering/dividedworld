-- The search index (supabase/migrations/0112_search.sql; docs/plans/2026-11-07-search-design.md sections 2, 3, 4 and 6; its plan, Task 2).
--
-- 1. A post, a spin and a Mod Bot's post each get a post_search row; a card play, a tally and a reveal get none.
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
  if (select count(*) from post_search) is distinct from before_count then raise exception 'a card play, a tally or a reveal got a search row'; end if;
  if exists (select 1 from post_search where act = card) then raise exception 'a card play got a search row'; end if;

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
  if not exists (select 1 from pg_indexes where tablename = 'post_search' and indexdef like '%(thread)%') then raise exception 'no (thread) index'; end if;
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
