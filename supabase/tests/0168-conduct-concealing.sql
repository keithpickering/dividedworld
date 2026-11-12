-- Quotes of hidden posts, concealed as a layer (supabase/migrations/0340_conduct.sql; the conduct plan, Task 2, amended 2026-11-12): the database does not read BBCode. quote_refs records what a
-- body names after `[quote=`; a decision that changes what is hidden, and the writing of a post that quotes a hidden one, ask for a layer; the conceal job (engine/bbcode/conceal.ts's concealQuotes,
-- supabase/functions/conceal) records it; acts_public serves the layer made for the hidden set of now, and until then withholds the body behind `concealing`. The reading of BBCode itself is the
-- engine's (engine/bbcode/conceal.test.ts over the shared corpus); here the layer's plumbing is held to what it must never do: show a hidden quote's words, store a stale layer, or strand a post.
--
-- The poisons come last, each a function replaced by the defect the check exists to catch, which must then be seen.

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
grant execute on function tests.refusal(text) to authenticated, anon, service_role;

-- What a player reads of one Act through acts_public: the current body, whether it is withheld, and the row as text, so a hidden word anywhere in it is found.
create function tests.read_as(who uuid, act uuid, out body text, out concealing boolean, out everything text) language plpgsql as $$
begin
  perform tests.become(who);
  select a.current_payload ->> 'body', a.concealing, to_jsonb(a)::text into body, concealing, everything from acts_public a where a.id = act;
  perform tests.unbecome();
end $$;

-- The job's side, as the service role: what is due, and a layer recorded.
create function tests.due_for(act uuid) returns record language plpgsql as $$
declare r record;
begin
  perform tests.become_service();
  select d.act, d.hidden, d.body into r from conceal_due(1000) d where d.act = due_for.act;
  perform tests.unbecome();
  return r;
end $$;

create function tests.is_due(act uuid) returns boolean language plpgsql as $$
declare found boolean;
begin
  perform tests.become_service();
  select exists (select 1 from conceal_due(1000) d where d.act = is_due.act) into found;
  perform tests.unbecome();
  return found;
end $$;

-- A request committed out of order is not answered by a layer made without it (the dead end a "done" read from `upto` alone made): admin A hides P and has not committed, so the request it
-- wrote for S (a post quoting P and R) has the lower id; admin B hides R and commits, its request has the higher id; the job records a layer for {R} with everything seen up to B's request; A
-- commits. S must be due again, for {P, R}, and served once that layer exists. The rows are committed (tests.commit), each name this file's; the job's side is this session, the service role.
do $$
declare
  url text := current_setting('kayfabb.scratch_url');
  adm_a uuid := gen_random_uuid(); adm_b uuid := gen_random_uuid(); wr uuid := gen_random_uuid();
  ch uuid := gen_random_uuid(); th uuid := gen_random_uuid();
  p uuid := gen_random_uuid(); r uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  due record;
  said text;
  shown text;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'cc-ooo-a@test.invalid'), (%2$L, 'cc-ooo-b@test.invalid'), (%3$L, 'cc-ooo-w@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L), (%3$L);
    insert into admins (account) values (%1$L), (%2$L);
    insert into characters (id, owner, name, debuted_at) values (%4$L, %3$L, 'Ooo Writer', now());
    insert into class_history (character, class_key) values (%4$L, 'alpha');
    insert into threads (id, board, title) select %5$L, b.id, 'Out of order' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%6$L, %4$L, 'post', %5$L, '{"body": "Words of P."}'), (%7$L, %4$L, 'post', %5$L, '{"body": "Words of R."}');
    insert into acts (id, character, kind, thread, payload) values (%8$L, %4$L, 'post', %5$L, jsonb_build_object('body', format('[quote=%%s]Words of P.[/quote] [quote=%%s]Words of R.[/quote]', %6$L::text, %7$L::text)));
  $sql$, adm_a, adm_b, wr, ch, th, p, r, s));

  -- A hides P and holds its transaction open.
  perform extensions.dblink_connect('holder', url);
  perform extensions.dblink_exec('holder', 'begin');
  perform extensions.dblink_exec('holder', format($e$
    select set_config('request.jwt.claims', jsonb_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
    select set_config('role', 'authenticated', true);
    do $d$ begin perform decide(null, %L, 'hide', null, 'a'); end $d$
  $e$, adm_a, p));
  -- B hides R and commits.
  perform tests.commit(format($e$
    select set_config('request.jwt.claims', jsonb_build_object('sub', %L::uuid, 'role', 'authenticated')::text, true);
    select set_config('role', 'authenticated', true);
    do $d$ begin perform decide(null, %L, 'hide', null, 'b'); end $d$
  $e$, adm_b, r));
  -- The job reads what B's decision made due, and records its layer.
  select * into due from tests.due_for(s) as t(act uuid, hidden uuid[], body text);
  if due.act is null or due.hidden is distinct from array[r] then
    perform extensions.dblink_exec('holder', 'rollback');
    raise exception 'out of order: S is not due for {R} after B''s committed hide: %', due;
  end if;
  perform tests.become_service();
  perform record_layer(s, array[r], format('[quote=%s]Words of P.[/quote] [quote=%s][/quote]', p, r));
  perform tests.unbecome();
  -- A commits.
  perform extensions.dblink_exec('holder', 'commit');
  perform extensions.dblink_disconnect('holder');

  if not tests.is_due(s) then raise exception 'out of order: S, whose request was committed after a layer made without it, is not due again; it stays concealing forever'; end if;
  select * into due from tests.due_for(s) as t(act uuid, hidden uuid[], body text);
  if due.hidden is distinct from (select array_agg(x order by x) from unnest(array[p, r]) x) then raise exception 'out of order: S is due for % and not {P, R}', due.hidden; end if;
  perform tests.become_service();
  perform record_layer(s, array[p, r], format('[quote=%s][/quote] [quote=%s][/quote]', p, r));
  perform tests.unbecome();
  if tests.is_due(s) then raise exception 'out of order: S is still due after the layer for {P, R}'; end if;
  perform tests.become(wr);
  select a.current_payload ->> 'body', a.concealing::text into shown, said from acts_public a where a.id = s;
  perform tests.unbecome();
  if shown is distinct from format('[quote=%s][/quote] [quote=%s][/quote]', p, r) or said is distinct from 'false' then raise exception 'out of order: S is not served its layer: % %', shown, said; end if;
end $$;

-- ---- What a row's own `payload` is, apart from the current version: payload_concealing and payload_hidden (History reads them) ----
-- A post whose original quotes a hidden post and whose current version is a clean edit is not concealing (the version a player reads is the edit's), but its original is, until its layer exists; an edit an
-- admin hid has its own words hidden.
do $$
declare
  admin_d uuid := tests.account('admin-payload');
  author uuid := tests.account('author-payload');
  reader uuid := tests.account('reader-payload');
  ch_author uuid := tests.character(author, 'Pat');
  ch_reader uuid := tests.character(reader, 'Rae');
  th uuid := tests.thread('Payload flags');
  base timestamptz := now() - interval '1 day';
  hid uuid; orig uuid; clean_edit uuid; bad_edit uuid;
  row_a record;
begin
  insert into admins (account) values (admin_d);
  hid := tests.post(ch_author, th, 'Hidden for the payload flags.', base);
  perform tests.become(admin_d);
  perform decide(null, hid, 'hide', null, 'payload flags');
  perform tests.unbecome();
  orig := tests.post(ch_reader, th, format('[quote=%s]Hidden for the payload flags.[/quote] original', hid), base + interval '1 minute');
  clean_edit := tests.act(ch_reader, 'edit', th, '{"body": "A clean edit."}', orig, base + interval '2 minutes');
  perform tests.become(reader);
  select a.concealing, a.payload_concealing, a.payload_hidden, a.hidden, a.current_payload ->> 'body' as cur, a.payload::text as raw into row_a from acts_public a where a.id = orig;
  perform tests.unbecome();
  if row_a.cur is distinct from 'A clean edit.' or row_a.concealing is distinct from false then raise exception 'the current version of a post with a clean edit is withheld: %', row_a; end if;
  if row_a.payload_concealing is distinct from true then raise exception 'the original of a post that quotes a hidden post, under a clean edit, is not payload_concealing: %', row_a.payload_concealing; end if;
  if row_a.payload_hidden is distinct from false or row_a.raw like '%Hidden for the payload flags%' then raise exception 'payload_hidden is set for a clean original, or the hidden words are in its payload: %', row_a; end if;
  -- an edit an admin hid: its own words are hidden
  bad_edit := tests.act(ch_reader, 'edit', th, '{"body": "An edit an admin will hide."}', orig, base + interval '3 minutes');
  perform tests.become(admin_d);
  perform decide(null, bad_edit, 'hide', null, 'the edit');
  perform tests.unbecome();
  perform tests.become(reader);
  select a.payload_hidden, a.hidden, a.payload::text as raw into row_a from acts_public a where a.id = bad_edit;
  perform tests.unbecome();
  if row_a.payload_hidden is distinct from true or row_a.raw like '%will hide%' then raise exception 'a hidden edit is not payload_hidden, or its words reach a player: %', row_a; end if;
end $$;

do $$
declare
  admin_a uuid := tests.account('admin-a');
  author uuid := tests.account('author');
  reader uuid := tests.account('reader');
  ch_author uuid := tests.character(author, 'Ada');
  ch_reader uuid := tests.character(reader, 'Bo');
  th uuid := tests.thread('Concealing');
  base timestamptz := now() - interval '1 day';
  p1 uuid; p2 uuid; q uuid; q2 uuid; qe uuid; plain uuid; e1 uuid;
  rd record;
  refs uuid[];
  reqs bigint;
  said text;
  layers bigint;
begin
  insert into admins (account) values (admin_a);
  p1 := tests.post(ch_author, th, 'Hidden words.', base);
  p2 := tests.post(ch_author, th, 'Shown words.', base + interval '1 minute');
  plain := tests.post(ch_author, th, 'No quote here, just words.', base + interval '2 minutes');

  -- ---- quote_refs: every id named after `[quote=`, a superset of what the parser reads ----
  q := tests.post(ch_reader, th, format('a [quote="  %s  " user=%s]%s[/quote] b [QUOTE=%s]y[/quote] c [quote=%s]z[/quote] d [quote=Bob %s]w[/quote]', upper(p1::text), ch_author, 'Hidden words.', p2, p2, ch_reader), base + interval '3 minutes');
  select array_agg(r.quoted order by r.quoted) into refs from quote_refs r where r.act = q;
  if refs is distinct from (select array_agg(x order by x) from unnest(array[p1, p2, ch_reader]) x) then raise exception 'quote_refs holds % for a body naming a padded, an upper-case, a repeated and a counterfeit quote', refs; end if;
  if exists (select 1 from quote_refs r where r.act = plain) then raise exception 'a body with no quote has quote_refs'; end if;
  if exists (select 1 from conceal_requests r where r.act = q) then raise exception 'a quote of posts nobody hid asked for a layer'; end if;
  select * into rd from tests.read_as(reader, q) x;
  if rd.body not like '%Hidden words.%' or rd.concealing is distinct from false then raise exception 'a quote of posts nobody hid is withheld or changed: % %', rd.body, rd.concealing; end if;

  -- ---- a hide asks for a layer of each Act that quotes the post, and no other ----
  perform tests.become(admin_a);
  perform decide(null, p1, 'hide', null, 'concealing');
  perform tests.unbecome();
  if (select count(*) from conceal_requests where act = q) is distinct from 1 then raise exception 'the hide did not ask for the quoting post''s layer once'; end if;
  if exists (select 1 from conceal_requests r where r.act in (plain, p1, p2)) then raise exception 'the hide asked for a layer of a post that quotes nothing'; end if;

  -- ---- before the job: withheld, and the hidden words are nowhere in what a player reads ----
  select * into rd from tests.read_as(reader, q) x;
  if rd.body is not null or rd.concealing is distinct from true then raise exception 'a quote of a hidden post is not withheld before its layer exists: % %', rd.body, rd.concealing; end if;
  if rd.everything like '%Hidden words%' then raise exception 'the hidden words reach a player in a row withheld for concealing: %', rd.everything; end if;
  select * into rd from tests.read_as(reader, plain) x;
  if rd.body is distinct from 'No quote here, just words.' or rd.concealing is distinct from false then raise exception 'a post that quotes nothing is changed by a hide elsewhere'; end if;

  -- ---- the job reads what is due: the hidden set of now and the Act's own words ----
  select * into rd from tests.due_for(q) as t(act uuid, hidden uuid[], body text);
  if rd.act is null or rd.hidden is distinct from array[p1] or rd.body not like '%Hidden words.%' then raise exception 'the quoting post is not due with its hidden set: %', rd; end if;
  if tests.is_due(plain) then raise exception 'a post that quotes nothing is due'; end if;

  -- ---- record_layer refuses a stale set, and nothing is stored ----
  select count(*) into layers from quote_layers;
  perform tests.become_service();
  said := tests.refusal(format('select record_layer(%L, %L, %L)', q, array[p1, p2], 'x'));
  if said is null or said not like 'P0001|kayfabb.conceal_stale|%' then raise exception 'record_layer took a set that is not the current one: %', said; end if;
  said := tests.refusal(format('select record_layer(%L, %L, null)', q, '{}'::uuid[]));
  if said is null or said not like 'P0001|kayfabb.conceal_stale|%' then raise exception 'record_layer took an empty set for a post that quotes a hidden one: %', said; end if;
  perform tests.unbecome();
  if (select count(*) from quote_layers) is distinct from layers then raise exception 'a refused layer was stored'; end if;

  -- ---- the layer, recorded for the set of now, is served; the job is not due again ----
  perform tests.become_service();
  perform record_layer(q, array[p1], format('a [quote="  %s  " user=%s][/quote] b [QUOTE=%s]y[/QUOTE] c [quote=%s]z[/quote] d [quote=Bob %s]w[/quote]', upper(p1::text), ch_author, p2, p2, ch_reader));
  perform tests.unbecome();
  select * into rd from tests.read_as(reader, q) x;
  if rd.concealing is distinct from false or rd.body like '%Hidden words%' or rd.body not like '%[/quote]%' then raise exception 'the recorded layer is not served: % %', rd.body, rd.concealing; end if;
  if tests.is_due(q) then raise exception 'a post with its layer recorded is still due'; end if;

  -- ---- a second hidden post changes the set: the old layer no longer matches, the post is withheld again until the new one ----
  perform tests.become(admin_a);
  perform decide(null, p2, 'hide', null, 'second');
  perform tests.unbecome();
  select * into rd from tests.read_as(reader, q) x;
  if rd.body is not null or rd.concealing is distinct from true then raise exception 'a layer made for another hidden set was served: % %', rd.body, rd.concealing; end if;
  select * into rd from tests.due_for(q) as t(act uuid, hidden uuid[], body text);
  if rd.hidden is distinct from (select array_agg(x order by x) from unnest(array[p1, p2]) x) then raise exception 'the second hide is not due with both ids: %', rd.hidden; end if;
  perform tests.become_service();
  perform record_layer(q, array[p2, p1, p1], 'layer of both');
  perform tests.unbecome();
  select * into rd from tests.read_as(reader, q) x;
  if rd.body is distinct from 'layer of both' or rd.concealing then raise exception 'the newest layer is not the one served: %', rd.body; end if;
  -- a layer already made for the set of now is not made again: the job's repeat is answered with the one there is
  select count(*) into layers from quote_layers where act = q;
  perform tests.become_service();
  perform record_layer(q, array[p1, p2], 'layer of both, again');
  perform tests.unbecome();
  if (select count(*) from quote_layers where act = q) is distinct from layers then raise exception 'a layer for the set the latest layer is already for was written again'; end if;

  -- ---- an unhide needs no job: with nothing hidden among its quotes a post serves its own words at once ----
  perform tests.become(admin_a);
  perform decide(null, p1, 'unhide', null, '');
  perform decide(null, p2, 'unhide', null, '');
  perform tests.unbecome();
  select * into rd from tests.read_as(reader, q) x;
  if rd.body not like '%Hidden words.%' or rd.concealing is distinct from false then raise exception 'a quote of unhidden posts is withheld or still concealed: % %', rd.body, rd.concealing; end if;
  -- the requests the unhides made are answered by an empty layer, which is never served and holds no words
  select * into rd from tests.due_for(q) as t(act uuid, hidden uuid[], body text);
  if rd.act is null or cardinality(rd.hidden) <> 0 then raise exception 'the unhide is not due with an empty set: %', rd; end if;
  perform tests.become_service();
  perform record_layer(q, '{}', null);
  perform tests.unbecome();
  if tests.is_due(q) then raise exception 'the empty layer leaves the post due'; end if;
  if (select body from quote_layers where act = q order by id desc limit 1) is not null then raise exception 'an empty set stored words'; end if;

  -- ---- hidden again: the latest layer (empty) wins over the older ones, so the post is withheld until a new one ----
  perform tests.become(admin_a);
  perform decide(null, p1, 'hide', null, 'again');
  perform tests.unbecome();
  select * into rd from tests.read_as(reader, q) x;
  if rd.body is not null or rd.concealing is distinct from true then raise exception 'an older layer of the same set was served over the newest: % %', rd.body, rd.concealing; end if;

  -- ---- a post written after the hide, quoting the hidden post, asks at once and is withheld ----
  q2 := tests.post(ch_reader, th, format('[quote=%s]Hidden words.[/quote] later', p1), base + interval '10 minutes');
  if not exists (select 1 from conceal_requests where act = q2) then raise exception 'a post quoting a hidden post did not ask for its layer'; end if;
  select * into rd from tests.read_as(reader, q2) x;
  if rd.body is not null or rd.concealing is distinct from true or rd.everything like '%Hidden words%' then raise exception 'a new quote of a hidden post is not withheld: %', rd; end if;

  -- ---- an edit that quotes a hidden post is its own version: the post's current version is withheld, the original is as written ----
  qe := tests.post(ch_reader, th, 'original, nothing quoted', base + interval '11 minutes');
  e1 := tests.act(ch_reader, 'edit', th, jsonb_build_object('body', format('now [quote=%s]Hidden words.[/quote]', p1)), qe, base + interval '12 minutes');
  if not exists (select 1 from conceal_requests where act = e1) then raise exception 'an edit quoting a hidden post did not ask for its layer'; end if;
  perform tests.become(reader);
  select a.current_payload ->> 'body', a.payload ->> 'body', a.concealing into said, rd.body, rd.concealing from acts_public a where a.id = qe;
  perform tests.unbecome();
  if said is not null or rd.concealing is distinct from true or rd.body is distinct from 'original, nothing quoted' then raise exception 'the current version is not withheld, or the original is not as written: % % %', said, rd.body, rd.concealing; end if;

  -- ---- a hide until edited ends at the author's edit, computed: the quoters are asked again ----
  perform tests.become(admin_a);
  perform decide(null, plain, 'hideUntilEdited', null, 'edit it');
  perform tests.unbecome();
  q := tests.post(ch_reader, th, format('[quote=%s]No quote here[/quote]', plain), base + interval '13 minutes');
  select count(*) into reqs from conceal_requests where act = q;
  perform tests.act(ch_author, 'edit', th, '{"body": "Fixed words."}', plain, base + interval '14 minutes');
  if (select count(*) from conceal_requests where act = q) <= reqs then raise exception 'the author''s edit did not ask for the quoters'' layers again'; end if;

  -- ---- conceal_layer is granted to acts_public's readers, so a player can ask it of any Act: it never hands out the layer of a version an admin hid ----
  perform tests.become_service();
  perform record_layer(q2, array[p1], 'LAYERWORDS');
  perform tests.unbecome();
  perform tests.become(reader);
  select c.body into said from conceal_layer(q2) c;
  perform tests.unbecome();
  if said is distinct from 'LAYERWORDS' then raise exception 'the layer of a version nobody hid is not served by conceal_layer, so the check below proves nothing: %', said; end if;
  perform tests.become(admin_a);
  perform decide(null, q2, 'hide', null, 'the quoting version');
  perform tests.unbecome();
  perform tests.become(reader);
  select c.body into said from conceal_layer(q2) c;
  perform tests.unbecome();
  if said is not null then raise exception 'a player reads the words of a hidden version through conceal_layer: %', said; end if;

  -- ---- who may call, who may read, and nothing is ever edited ----
  perform tests.become(reader);
  foreach said in array array[format('select * from conceal_due(5)'), format('select record_layer(%L, %L, %L)', q, array[p1], 'x'),
    'select * from quote_layers', 'select * from quote_refs', 'select * from conceal_requests', 'select * from conceal_answers', 'select hidden_refs(' || quote_literal(q) || ')'] loop
    if coalesce(tests.refusal(said), 'ran') not like '42501|%' then raise exception 'a player reached the conceal machinery: % -> %', said, coalesce(tests.refusal(said), 'ran'); end if;
  end loop;
  perform tests.unbecome();
  perform tests.become_anon();
  if coalesce(tests.refusal('select * from conceal_due(5)'), 'ran') not like '42501|%' then raise exception 'a visitor reached conceal_due'; end if;
  perform tests.unbecome();
  foreach said in array array['update quote_layers set body = null', 'delete from quote_layers', 'truncate quote_layers cascade', 'update quote_refs set quoted = quoted', 'delete from quote_refs', 'truncate quote_refs',
    'update conceal_requests set act = act', 'delete from conceal_requests', 'truncate conceal_requests cascade',
    'update conceal_answers set layer = null', 'delete from conceal_answers', 'truncate conceal_answers'] loop
    if coalesce(tests.refusal(said), 'ran') not like 'P0001|%' then raise exception 'a conceal table was edited or emptied: % -> %', said, coalesce(tests.refusal(said), 'ran'); end if;
  end loop;

  -- ---- A page of hostile bodies costs the same whatever their length: nothing on a read walks a body's characters ----
  -- Twenty posts a thread, each a quote of a hidden post wrapping a thousand openers, the layer recorded (what the job makes of it is the engine's). Work per character on a read would show as a
  -- ratio of about 4 between bodies of 10,000 and of 40,000 characters; a read that only looks the Act up shows about 1 (a body is copied once from its TOAST, a memory copy). The old reading in SQL took
  -- 357 ms a post at 20,000 characters and passed the statement timeout over a page.
  declare
    th_of uuid;
    ids uuid[];
    n integer;
    chars integer;
    t0 timestamptz;
    ms numeric;
    best numeric;
    small numeric;
    big numeric;
    one uuid;
    served bigint;
  begin
    for chars in select * from unnest(array[10000, 40000]) loop
      th_of := tests.thread('Hostile ' || chars);
      ids := '{}';
      for n in 1 .. 20 loop
        ids := ids || tests.post(ch_reader, th_of, format('[quote=%s]', p1) || repeat('[quote=zz][b]', chars / 13) || '[/quote]', base + (n || ' seconds')::interval);
      end loop;
      perform tests.become_service();
      foreach one in array ids loop perform record_layer(one, array[p1], format('[quote=%s][/quote]', p1)); end loop;
      perform tests.unbecome();
      perform tests.become(reader);
      best := null;
      for n in 1 .. 4 loop
        t0 := clock_timestamp();
        select count(*) into served from acts_public a where a.thread = th_of and a.concealing is false and a.current_payload ->> 'body' = format('[quote=%s][/quote]', p1);
        ms := extract(epoch from clock_timestamp() - t0) * 1000;
        if n > 1 then best := least(coalesce(best, ms), ms); end if;
      end loop;
      perform tests.unbecome();
      if served <> 20 then raise exception 'a page of 20 hostile posts of % characters served % layers', chars, served; end if;
      if best > 2000 then raise exception 'acts_public took % ms on a page of 20 posts of % characters', round(best), chars; end if;
      if chars = 10000 then small := best; else big := best; end if;
    end loop;
    raise notice 'acts_public over 20 hostile posts: 10k % ms, 40k % ms, ratio %', round(small, 2), round(big, 2), round(big / greatest(small, 0.05), 1);
    if big / greatest(small, 0.05) >= 3 then
      raise exception 'a read of a page grows with the bodies'' length: % ms at 10,000 characters, % ms at 40,000 (ratio %, work per character is about 4)', round(small, 2), round(big, 2), round(big / greatest(small, 0.05), 1);
    end if;
  end;

  -- ---- The poisons: each defect the checks above exist to catch is put in, and must be seen ----
  -- (a) acts_public serves the raw body when no layer matches: a hidden quote's words reach a player.
  create or replace function shown_payload(p jsonb, hidden boolean, refs boolean, ready boolean, layer text) returns jsonb
  language sql immutable as $f$ select case when hidden then jsonb_set(p, '{body}', 'null'::jsonb) when refs and ready then jsonb_set(p, '{body}', to_jsonb(layer)) else p end $f$;
  perform tests.become(admin_a);
  perform decide(null, p2, 'hide', null, 'poison');
  perform tests.unbecome();
  q := tests.post(ch_reader, th, format('[quote=%s]Shown words.[/quote] poison', p2), base + interval '20 minutes');
  select * into rd from tests.read_as(reader, q) x;
  if rd.everything not like '%Shown words.%' then raise exception 'POISON (a) was not seen: a body served raw when no layer matches did not reach the reader (%)', rd.everything; end if;

  -- (b) record_layer accepts a stale set.
  create or replace function record_layer(act uuid, hidden uuid[], body text) returns bigint
  language sql security definer set search_path = public, pg_temp as $f$
    insert into quote_layers (act, hidden, body) values (record_layer.act, record_layer.hidden, record_layer.body) returning id $f$;
  select count(*) into layers from quote_layers;
  perform tests.become_service();
  said := tests.refusal(format('select record_layer(%L, %L, %L)', q, array[p1], 'stale'));
  perform tests.unbecome();
  if said is not null or (select count(*) from quote_layers) is distinct from layers + 1 then raise exception 'POISON (b) was not seen: a stale set was refused by a record_layer that checks nothing (%)', said; end if;
end $$;

-- ---- What the job reads costs what is open, not what was ever asked: conceal_due over thousands of Acts whose requests are answered ----
-- A busy instance holds tens of thousands of Acts that quote a hidden post, every request answered. The reading before conceal_answers grouped every request ever made and read the hidden set
-- and the layer of each before it filtered (4.7 to 6.7 s at 20,000 Acts, 11 s at 40,000, nothing due). It is measured against the least any reading of the open requests costs, the same two
-- tables anti-joined and grouped: a reading that does more per answered Act than that is a multiple of it that grows with the Acts (hundreds of times, with a hidden set read for each).
-- Run last: the poison replaces conceal_due.

-- The time of conceal_due over the time of the bare scan of open requests, the better of three runs of each, with one Act open; and, when `exact`, that only that Act comes out.
create function tests.due_ratio(open_act uuid, p uuid, exact boolean, out due_ms numeric, out scan_ms numeric) language plpgsql as $$
declare t0 timestamptz; ms numeric; r record; n integer;
begin
  for n in 1 .. 4 loop
    t0 := clock_timestamp();
    select d.act, d.hidden into r from conceal_due(100) d;
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    if n > 1 then due_ms := least(coalesce(due_ms, ms), ms); end if;
    t0 := clock_timestamp();
    perform count(*) from (select r2.act from conceal_requests r2 where not exists (select 1 from conceal_answers a where a.request = r2.id) group by r2.act) x;
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    if n > 1 then scan_ms := least(coalesce(scan_ms, ms), ms); end if;
  end loop;
  if exact and (r.act is distinct from open_act or r.hidden is distinct from array[p] or (select count(*) from conceal_due(100)) is distinct from 1) then
    raise exception 'conceal_due does not return exactly the one Act with an open request: %', r;
  end if;
end $$;

do $$
declare
  admin_c uuid := tests.account('admin-cost');
  author uuid := tests.account('author-cost');
  ch uuid := tests.character(author, 'Cost');
  th uuid := tests.thread('Cost of the job');
  base timestamptz := now() - interval '1 day';
  p uuid;
  open_act uuid;
  have integer := 0;
  total integer;
  m record;
  ratio numeric;
  small numeric;
begin
  insert into admins (account) values (admin_c);
  p := tests.post(ch, th, 'Hidden for the cost.', base);
  perform tests.become(admin_c);
  perform decide(null, p, 'hide', null, 'cost');
  perform tests.unbecome();
  foreach total in array array[2000, 20000] loop
    -- Finished Acts: each quotes the hidden post (the trigger asks for its layer), its layer recorded for the set of now and its request answered, as the job leaves them.
    insert into acts (character, kind, thread, payload, created_at)
    select ch, 'post', th, jsonb_build_object('body', format('[quote=%s]words %s[/quote] done', p, g)), base + (g || ' seconds')::interval from generate_series(have + 1, total) g;
    insert into quote_layers (act, hidden, body, upto)
    select r.act, array[p], format('[quote=%s][/quote] done', p), r.id from conceal_requests r where not exists (select 1 from conceal_answers n where n.request = r.id);
    insert into conceal_answers (request, layer)
    select r.id, (select l.id from quote_layers l where l.act = r.act order by l.id desc limit 1) from conceal_requests r where not exists (select 1 from conceal_answers n where n.request = r.id);
    have := total;
    open_act := tests.post(ch, th, format('[quote=%s]open[/quote]', p), base + interval '2 days');
    analyze conceal_requests; analyze conceal_answers; analyze quote_layers; analyze quote_refs;
    select * into m from tests.due_ratio(open_act, p, true);
    ratio := m.due_ms / greatest(m.scan_ms, 0.05);
    raise notice 'conceal_due at % answered Acts: % ms, the bare scan of open requests % ms, ratio %', total, round(m.due_ms, 2), round(m.scan_ms, 2), round(ratio, 1);
    if total = 2000 then small := ratio; end if;
    if ratio > 25 then
      raise exception 'conceal_due costs % times the bare scan of open requests at % Acts (% at 2,000): it does work for every Act ever requested', round(ratio, 1), total, round(small, 1);
    end if;
    -- The job answers it, as it leaves every Act.
    perform tests.become_service();
    perform record_layer(open_act, array[p], format('[quote=%s][/quote]', p));
    perform tests.unbecome();
    have := have + 1;
  end loop;

  -- The poison: the reading that groups every request ever made, reads each Act's hidden set and layer, and filters after. It must be seen at 20,000 Acts.
  create or replace function conceal_due(most integer) returns table (act uuid, hidden uuid[], body text)
  language sql stable security definer set search_path = public, pg_temp as $f$
    select d.act, h.hs, x.payload ->> 'body'
    from (select r.act, min(r.id) as first from conceal_requests r group by r.act) d
    cross join lateral (select hidden_refs(d.act) as hs) h
    join acts x on x.id = d.act
    where (select l.hidden from quote_layers l where l.act = d.act order by l.at desc, l.id desc limit 1) is distinct from h.hs
    order by d.first
    limit greatest(conceal_due.most, 0)
  $f$;
  open_act := tests.post(ch, th, format('[quote=%s]open[/quote]', p), base + interval '3 days');
  analyze conceal_requests;
  select * into m from tests.due_ratio(open_act, p, false);
  ratio := m.due_ms / greatest(m.scan_ms, 0.05);
  raise notice 'POISON conceal_due (the old reading) at % Acts: % ms, ratio %', have, round(m.due_ms, 2), round(ratio, 1);
  if ratio <= 25 then raise exception 'POISON (c) was not seen: the reading of every request ever made costs only % times the bare scan at % Acts', round(ratio, 1), have; end if;
end $$;
