-- Where a hidden version's words could still leak, and the screens that must say it is hidden (supabase/migrations/0340_conduct.sql; the
-- conduct plan, Task 2): a model's and a card's reads of a post go through the public form, the screen functions give a hidden post no body, a search finds neither
-- a hidden version's words nor a version a later hide covers, the well-formedness trigger and decide_report refuse what they should, and no function a player, the digest or the
-- service can run reads a body from `acts` unreviewed. How a quote of a hidden post is concealed (the layer and the job) is 0168-conduct-concealing.sql's; the reading of BBCode itself
-- is the engine's (engine/bbcode/conceal.test.ts).

-- What a statement raises, as 'sqlstate|hint|message', or null when it ran. A helper of this file only; the rollback drops it.
create function tests.refusal(stmt text) returns text language plpgsql as $$
declare state text; hint text; msg text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics state = returned_sqlstate, hint = pg_exception_hint, msg = message_text;
  return state || '|' || coalesce(hint, '') || '|' || msg;
end $$;
grant execute on function tests.refusal(text) to authenticated;

do $$
declare
  admin_a uuid := tests.account('admin-a');
  author uuid := tests.account('author');
  other uuid := tests.account('other');
  ch_author uuid := tests.character(author, 'Ada');
  ch_other uuid := tests.character(other, 'Cy');
  th uuid := tests.thread('Leaks');
  base timestamptz := now() - interval '1 day';
  rep uuid := tests.account('reporter');
  ch_rep uuid := tests.character(rep, 'Bo');
  p1 uuid; pz uuid; e1 uuid; e2 uuid; q uuid; p2 uuid; p3 uuid;
  r1 bigint; r2 bigint;
  words text; seen text; j jsonb; found boolean;
begin
  insert into admins (account) values (admin_a);
  p1 := tests.post(ch_author, th, 'Hidden words.', base);
  perform tests.become(admin_a);
  perform decide(null, p1, 'hide', null, 'leaks');
  perform tests.unbecome();

  -- ---- The screens' functions over a hidden post: hidden, and no words ----
  perform tests.become(other);
  j := thread_page(th, 1, 20, null, null);
  select (a ->> 'hidden')::boolean, a #>> '{payload,body}', a #>> '{current_payload,body}' into found, words, seen from jsonb_array_elements(j -> 'acts') a where a ->> 'id' = p1::text;
  if found is distinct from true or words is not null or seen is not null then raise exception 'thread_page over a hidden post: hidden %, body %, current %', found, words, seen; end if;
  j := profile_page(ch_author);
  select (a ->> 'hidden')::boolean, a #>> '{payload,body}', a #>> '{current_payload,body}' into found, words, seen from jsonb_array_elements(j -> 'acts') a where a ->> 'id' = p1::text;
  if found is distinct from true or words is not null or seen is not null then raise exception 'profile_page over a hidden post: hidden %, body %, current %', found, words, seen; end if;
  if j::text like '%Hidden words%' then raise exception 'profile_page carries a hidden post''s words'; end if;
  j := thread_page(th, 1, 20, null, null);
  if j::text like '%Hidden words%' then raise exception 'thread_page carries a hidden post''s words'; end if;
  perform tests.unbecome();

  -- ---- A second hide until edited, and what search and quotes then show ----
  pz := tests.post(ch_author, th, 'The word is zanzibar.', base + interval '2 minutes');
  perform tests.become(admin_a);
  perform decide(null, pz, 'hideUntilEdited', null, 'first');
  perform tests.unbecome();
  e1 := tests.act(ch_author, 'edit', th, '{"body": "Now it is tanganyika."}', pz, now() - interval '1 hour');
  perform tests.become(admin_a);
  perform decide(null, e1, 'hideUntilEdited', null, 'second');
  perform tests.unbecome();
  e2 := tests.act(ch_author, 'edit', th, '{"body": "Finally kilimanjaro."}', pz, now() + interval '1 minute');
  perform tests.become(other);
  foreach words in array array['zanzibar', 'tanganyika', 'kilimanjaro'] loop
    if jsonb_array_length(search_posts(words, null, null, null, null, false, 'newest', null, 20) -> 'results') is distinct from 0 then
      raise exception 'a search found %, a version a second hide until edited covers', words;
    end if;
  end loop;
  perform tests.unbecome();
  -- A quote of the post is concealed while any of its versions is hidden, an edit's included: withheld until the job's layer, then emptied.
  q := tests.post(ch_other, th, format('See [quote=%s]Finally kilimanjaro.[/quote] ok', pz), base + interval '3 minutes');
  perform tests.become(rep);
  select a.current_payload ->> 'body' into words from acts_public a where a.id = q;
  perform tests.unbecome();
  if words is not null then raise exception 'a quote of a post with a hidden edit was served before its layer: %', words; end if;
  perform tests.become_service();
  if not exists (select 1 from conceal_due(10) d where d.act = q and d.hidden = array[pz]) then raise exception 'a quote of a post with a hidden edit is not due'; end if;
  perform record_layer(q, array[pz], format('See [quote=%s][/quote] ok', pz));
  perform tests.unbecome();
  perform tests.become(rep);
  select a.current_payload ->> 'body' into words from acts_public a where a.id = q;
  perform tests.unbecome();
  if words is distinct from format('See [quote=%s][/quote] ok', pz) then raise exception 'a quote of a post with a hidden edit was not served as its layer: %', words; end if;
  if quote_hidden(pz) is distinct from true then raise exception 'quote_hidden does not see the hidden edit'; end if;

  -- ---- A decision on a report names the report's version; decide_report takes no unhide, lift or approve ----
  p2 := tests.post(ch_author, th, 'Reported words.', base + interval '4 minutes');
  p3 := tests.post(ch_author, th, 'Other reported words.', base + interval '5 minutes');
  perform tests.become(rep);
  r1 := report_post(p2, 'mask', null);
  perform tests.unbecome();
  seen := tests.refusal(format('insert into conduct_decisions (report, version_act, admin, outcome) values (%s, %L, %L, %L)', r1, p3, admin_a, 'hide'));
  if seen is null or seen not like '23514|%names the version it reports%' then raise exception 'a decision on another version than its report''s was written: %', seen; end if;
  if tests.refusal(format('insert into conduct_decisions (report, version_act, admin, outcome) values (%s, %L, %L, %L)', r1, p2, admin_a, 'hide')) is not null then
    raise exception 'a decision on the report''s own version was refused';
  end if;
  perform tests.become(rep);
  r2 := report_post(p3, 'mask', null);
  perform tests.unbecome();
  perform tests.become(admin_a);
  foreach words in array array['unhide', 'lift', 'approve'] loop
    seen := tests.refusal(format('select decide_report(%s, %L)', r2, jsonb_build_array(jsonb_build_object('outcome', words))::text));
    if seen is null or seen not like '22023|kayfabb.refusal|%' then raise exception 'decide_report took %: %', words, seen; end if;
  end loop;
  perform tests.unbecome();
  if exists (select 1 from conduct_decisions where report = r2) then raise exception 'a refused decide_report still wrote a decision'; end if;
end $$;

-- ---- season_news reads a Boss's arrival post as a player would: hide the post and its words are gone from the item ----
do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'rosterRecentExcluded', 1,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'cn-a',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'cn-a', 'name', 'Cn A', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'cn-b', 'name', 'Cn B', 'title', 'Boss', 'signature', 'b')),
      'firstStaff', '[]'::jsonb, 'moves', '[]'::jsonb, 'demands', '[]'::jsonb)));
  update seasons set starts_at = now() - interval '60 days' where ends_at is null;
  if reveal_season((select starts_at from seasons where ends_at is null) + interval '1 day') is null then raise exception 'the season did not roll over'; end if;
end $$;

do $$
declare
  admin_n uuid := tests.account('admin-news');
  arrival uuid;
  said text;
begin
  select a.id into arrival from acts a join characters c on c.id = a.character
  where c.staff = 'cn-b' and a.kind = 'post' and a.thread = (select (value #>> '{}')::uuid from settings where key = 'systemAnnouncements');
  select n.quote into said from season_news(null, 50) n where n.kind = 'bossArrived' and n.act = arrival;
  if said is distinct from 'Hello from Cn B.' then raise exception 'the arrival quotes its post while the post shows: %', said; end if;
  insert into admins (account) values (admin_n);
  perform tests.become(admin_n);
  perform decide(null, arrival, 'hide', null, 'news');
  perform tests.unbecome();
  select n.quote into said from season_news(null, 50) n where n.kind = 'bossArrived' and n.act = arrival;
  if not found then raise exception 'the arrival item is gone once its post is hidden; it should stay, without the words'; end if;
  if said is not null then raise exception 'season_news quotes a hidden arrival post: %', said; end if;
end $$;

-- ---- Nothing a player, a model or the digest can run reads a post's words from `acts` itself ----
-- A function or a view that reads `payload ->> 'body'` or `'title'` from the `acts` table hands out what an admin hid, since a hide is a layer over the Act
-- and `acts` holds the original. The way to read a post's words is acts_public, or public_payload(…, version_hidden(…)). This lists every function in `public` that
-- a player (authenticated or anon), the digest or the service can execute, and every view they can select from, whose source reads a body or a title out of
-- a payload and reads from `acts` itself, and refuses any that is not on the list below with its reason. A new reader fails here until someone looks at it and
-- either fixes it or writes why it is safe.
create function tests.body_readers() returns setof text language sql stable as $$
  with src as (
    -- A read through the public form (`public_payload(…) ->> 'body'`, with or without a `version_hidden(…)` inside it) is the safe way and is not a read.
    select p.oid::regprocedure::text as name,
           regexp_replace(p.prosrc, $re$public_payload\([^()]*(\([^()]*\))?[^()]*\)\s*(->>|->)\s*'(body|title)'$re$, '', 'gi') as code,
           exists (select 1 from unnest(array['authenticated', 'anon', 'kayfabb_digest', 'service_role']) r where has_function_privilege(r, p.oid, 'execute')) as runnable
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    union all
    select c.oid::regclass::text,
           regexp_replace(pg_get_viewdef(c.oid), $re$public_payload\([^()]*(\([^()]*\))?[^()]*\)\s*(->>|->)\s*'(body|title)'$re$, '', 'gi'),
           exists (select 1 from unnest(array['authenticated', 'anon', 'kayfabb_digest', 'service_role']) r where has_table_privilege(r, c.oid, 'select'))
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
  )
  select s.name from src s
  where s.runnable
    and s.code ~* $re$(->>|->|#>>|#>)\s*'(\{)?(body|title)\M$re$
    and s.code ~* $re$\m(from|join)\s+(public\.)?acts\M$re$
$$;

do $$
declare
  -- Each one, and why it may read a body or a title from `acts`:
  allowed constant text[] := array[
    -- Admin-only: the function refuses anyone who is not an admin (only_admins), and an admin reads the words in order to decide on them.
    'admin_reports()', 'admin_version(uuid)',
    -- The author's own words, for the author: my_hidden_version answers only for a version of the caller's own character, and mail_for_decision (service role only)
    -- writes the author's own hidden words back to that author in the mail about the decision.
    'my_hidden_version(uuid)', 'mail_for_decision(bigint)',
    -- The conceal job's own reads (service role only): conceal_due hands the job the quoting Act's own words, which its parser (the engine's concealQuotes) reads, and the trigger that records
    -- what an Act's body quotes (quote_refs) reads the body of the Act being written, `new.payload`, from its own writer. Neither answers a player.
    'conceal_due(integer)', 'acts_quote_refs()',
    -- Judges a post's own words against the rules in force and returns the rules it breaks, never the words: it reads nothing of a hidden version (version_hidden), and passes the body through
    -- bbcode_walk's `unquoted`, which cuts every quote out, so no one's quoted words, hidden or not, are judged. (public_payload is null while a post that quotes a hidden one waits for its layer.)
    'rule_breaks(uuid,uuid)',
    -- Runs from the service role to seed an instance from a document; its `'title'` is the document's, and its one read of `acts` is a move's kind.
    'seed_instance(jsonb)',
    -- A trigger function that indexes an Act as it is written, which only the table's trigger runs; acts_search_hidden and conduct_decisions_search (0340) take a hidden version's
    -- words out of the index and keep them out.
    'acts_search()',
    -- 0350's one-time rewrite of post_search.words for every post whose body can read differently under the new cap (a quote, or more than 16 open brackets), from each post's current raw body through search_words (the words the insert and edit triggers write, bbcode_plain, which cuts every quote out). It skips
    -- every post whose current version is hidden (version_hidden), so a hidden version's words are never indexed, and returns only a count. No grant to a client role; the migration calls it once.
    'search_reindex_past_cap()',
    -- Read a post's body through acts_public (card_target) or public_payload with version_hidden (claim_card_writes, which the check no longer sees in that form); the
    -- other reads of `acts` in them are card plays and sets, whose payloads hold a card key and no words.
    'card_target(uuid)', 'claim_card_writes(integer,uuid)',
    -- The words of an apology, which is a spin; a decision names a post or an edit and refuses any other kind (conduct_decisions_well_formed), so an apology cannot be
    -- hidden. The service role hands them to the judge.
    'pending_apologies()',
    -- A before-insert trigger (0316's No quote guard) that reads only the body of the Act being written, `new.payload`, which is its own writer's, and a post's seq and thread from
    -- `acts`; the words of a post already written, which an edit's guard needs, it reads through acts_public. It returns the row or raises; nobody reads its words back.
    'acts_quote_guard()',
    -- Views whose titles are an update Act's (an admin's own words, on the Updates page, which are never hidden).
    'thread_open', 'updates_read'
  ];
  found text[];
  extra text[];
begin
  -- The check sees a reader: a poisoned function a player can run, reading a body from `acts`, is found.
  create function public.poison_reader() returns text language sql stable security definer as $f$ select a.payload ->> 'body' from acts a limit 1 $f$;
  grant execute on function public.poison_reader() to authenticated;
  select array_agg(x) into found from tests.body_readers() x;
  if not 'poison_reader()' = any (found) then raise exception 'the body-reader check does not see a function that reads acts.payload: %', found; end if;
  drop function public.poison_reader();

  select array_agg(x order by x) into extra from tests.body_readers() x where x <> all (allowed);
  if extra is not null then
    raise exception 'a function or view a player, the digest or the service can use reads a post''s words from acts itself, which gives away a hidden version; read acts_public or public_payload(…, version_hidden(…), …) instead, or say why it is safe above: %', extra;
  end if;
end $$;
