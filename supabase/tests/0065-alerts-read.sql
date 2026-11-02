-- The Alerts read and the count (supabase/migrations/0060_alerts_read.sql): my_alerts is the caller's written alerts, their
-- followed threads with new posts and the settlements that moved their characters, newest first, each once with its kind;
-- my_alerts_unread counts what arrived after the account's alerts_seen_at, to a bound of 10. The alerts plan, Task 5; the
-- alerts design, sections 2, 4, 10 and 11.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The migration exists at all (so a missing one fails here, on an assertion, and not on a missing function below).
do $$
begin
  if to_regprocedure('my_alerts(timestamptz,integer)') is null then raise exception 'my_alerts(timestamptz, integer) exists'; end if;
  if to_regprocedure('my_alerts_unread()') is null then raise exception 'my_alerts_unread() exists'; end if;
end $$;

-- ---- Each source appears once with its kind; the count moves with the mark ----
do $$
declare
  ann uuid := tests.account('ar-ann'); bob uuid := tests.account('ar-bob'); cat uuid := tests.account('ar-cat');
  a1 uuid; a2 uuid; b1 uuid; c1 uuid;
  mine uuid; quoted uuid; played uuid; theirs uuid; k text; got record; n integer; sid bigint; sid2 bigint;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling'];
  base timestamptz := now() - interval '10 hours';
  seen timestamptz;
begin
  a1 := tests.character(ann, 'Ar Ann One');
  a2 := tests.character(ann, 'Ar Ann Two');
  b1 := tests.character(bob, 'Ar Bob One');
  c1 := tests.character(cat, 'Ar Cat One');
  mine := tests.thread('Ann started this');
  quoted := tests.post(a1, mine, 'opening', base - interval '1 hour');
  played := tests.post(b1, mine, 'bob 1', base - interval '50 minutes');
  -- One written alert of each kind for Ann, an hour apart, and one for Bob that Ann must never see.
  for n in 1..6 loop
    insert into alerts (account, kind, sub, act, character, at)
    values (ann, kinds[n], case when kinds[n] = 'ruling' then 'x' end, quoted, a1, base + n * interval '1 hour');
  end loop;
  insert into alerts (account, kind, act, character, at) values (bob, 'quote', played, b1, base + interval '2 hours');
  -- A settlement that moved two of Ann's characters (three lines) and one of Bob's.
  insert into settlements (starts_at, ends_at, season, applied_at)
  values (base - interval '3 days', base - interval '3 days' + interval '6 hours', (select min(id) from seasons), base + interval '7 hours') returning id into sid;
  insert into ledger (settlement, account, character, reason, amount) values
    (sid, ann, a1, 'post.reacted', 120), (sid, ann, a1, 'post.quoted', 30), (sid, ann, a2, 'post.reacted', -20), (sid, bob, b1, 'post.reacted', 50);
  -- A followed thread: Ann's character started "mine"; Bob has posted after her opening. Its newest such post is at +8 hours.
  perform tests.post(b1, mine, 'bob 2', base + interval '8 hours');
  perform tests.post(a2, mine, 'my other mask', base + interval '9 hours');
  -- A thread Ann does not follow, with posts in it.
  theirs := tests.thread('Not followed');
  perform tests.post(b1, theirs, 'opening', base);
  perform tests.post(c1, theirs, 'another', base + interval '1 hour');

  perform tests.become(ann);
  -- Each source once, with its kind, newest first.
  for k in select x from unnest(kinds || array['settlement', 'followed']) x loop
    if (select count(*) from my_alerts() where kind = k) is distinct from 1 then
      raise exception 'each source appears once with its kind: % appears % times', k, (select count(*) from my_alerts() where kind = k);
    end if;
  end loop;
  if (select count(*) from my_alerts()) is distinct from 8 then raise exception 'six written, one followed thread and one settlement make eight: %', (select count(*) from my_alerts()); end if;
  if (select string_agg(kind, ',' order by at desc, kind) from my_alerts()) is distinct from 'followed,settlement,ruling,hint,trapSprang,trapStruck,cardOnYours,quote' then
    raise exception 'newest first: %', (select string_agg(kind, ',') from my_alerts());
  end if;
  -- The rows carry the public words' inputs.
  select * into got from my_alerts() where kind = 'quote';
  if got.act is distinct from quoted or got.character is distinct from a1 or got.name is distinct from 'Ar Ann One' or got.title is distinct from 'Ann started this'
     or got.thread is distinct from mine or got.at is distinct from base + interval '1 hour' then
    raise exception 'a written alert names its Act, character, the character''s public name, the thread and its title: %', got;
  end if;
  select * into got from my_alerts() where kind = 'ruling';
  if got.sub is distinct from 'x' then raise exception 'a written alert keeps its sub-key: %', got; end if;
  select * into got from my_alerts() where kind = 'followed';
  if got.thread is distinct from mine or got.title is distinct from 'Ann started this' or got.count is distinct from 2
     or got.at is distinct from base + interval '8 hours' or got.act is not null or got.character is not null then
    raise exception 'a followed thread names the thread and its title, counts the posts by others (Bob''s two, not her other mask) and is as new as the newest: %', got;
  end if;
  select * into got from my_alerts() where kind = 'settlement';
  if got.sub is distinct from sid::text or got.count is distinct from 2 or got.at is distinct from base + interval '7 hours' or got.act is not null then
    raise exception 'a settlement names itself, counts the player''s characters it moved (two, of three lines; Bob''s line is not hers) and is as new as it was applied: %', got;
  end if;
  -- A thread not followed is no row; neither is another player's alert.
  if exists (select 1 from my_alerts() where title = 'Not followed') then raise exception 'a thread not followed is no alert'; end if;

  -- The count: everything is new until the mark is set; the mark moves it.
  if my_alerts_unread() is distinct from 8 then raise exception 'with no mark set, all eight are new: %', my_alerts_unread(); end if;
  perform see_alerts(base + interval '5 hours');
  if my_alerts_unread() is distinct from 3 then
    raise exception 'after the mark at +5h, the alerts at +6h (one) and the settlement and thread are new: %', my_alerts_unread();
  end if;
  perform see_alerts(base + interval '7 hours' + interval '1 second');
  if my_alerts_unread() is distinct from 1 then raise exception 'after the mark past the settlement only the followed thread is new: %', my_alerts_unread(); end if;
  perform see_alerts(now());
  if my_alerts_unread() is distinct from 0 then raise exception 'after the mark at now nothing is new: %', my_alerts_unread(); end if;
  -- Seeing never removes a row: the list is the same.
  if (select count(*) from my_alerts()) is distinct from 8 then raise exception 'the list does not shrink when seen'; end if;
  -- A new alert, a new post and a new settlement each move the count by one (rows are added by the writers, here by the owner).
  perform tests.unbecome();
  insert into alerts (account, kind, act, character, at) values (ann, 'quote', quoted, a1, now() + interval '1 minute');
  perform tests.become(ann);
  if my_alerts_unread() is distinct from 1 then raise exception 'a written alert after the mark is new: %', my_alerts_unread(); end if;
  perform tests.unbecome();
  perform tests.post(c1, mine, 'cat 1', now() + interval '2 minutes');
  insert into settlements (starts_at, ends_at, season, applied_at)
  values (base + interval '1 day', base + interval '1 day' + interval '6 hours', (select min(id) from seasons), now() + interval '3 minutes') returning id into sid2;
  insert into ledger (settlement, account, character, reason, amount) values (sid2, ann, a1, 'post.reacted', 10);
  perform tests.become(ann);
  if my_alerts_unread() is distinct from 3 then raise exception 'a post by another in a followed thread and a settlement after the mark are new too: %', my_alerts_unread(); end if;
  select * into got from my_alerts() where kind = 'followed';
  if got.count is distinct from 3 then raise exception 'the thread now holds three posts by others: %', got; end if;
  if (select count(*) from my_alerts() where kind = 'settlement') is distinct from 2 then raise exception 'each settlement is one row'; end if;

  -- A followed thread read to its end leaves the list, and the count with it.
  perform mark_read(mine, 100, a1);
  if exists (select 1 from my_alerts() where kind = 'followed') then raise exception 'a followed thread read to its end leaves the list'; end if;
  if my_alerts_unread() is distinct from 2 then raise exception 'and the count: %', my_alerts_unread(); end if;

  -- ---- Another account sees none of Ann's ----
  perform tests.become(cat);
  if exists (select 1 from my_alerts()) then raise exception 'another account reads none of the caller''s alerts: %', (select count(*) from my_alerts()); end if;
  if my_alerts_unread() is distinct from 0 then raise exception 'and counts none: %', my_alerts_unread(); end if;
  perform tests.become(bob);
  -- His own quote, his own settlement, and the thread he started that Cat posted in.
  if (select string_agg(kind, ',' order by kind) from my_alerts()) is distinct from 'followed,quote,settlement' then raise exception 'Bob reads his own alerts alone: %', (select string_agg(kind, ',') from my_alerts()); end if;
  if (select count from my_alerts() where kind = 'settlement') is distinct from 1 then raise exception 'Bob''s settlement counts his own character alone'; end if;
  if exists (select 1 from my_alerts() where kind = 'quote' and act is distinct from played) then raise exception 'Bob reads his own quote alert'; end if;

  -- ---- Visitors ----
  perform tests.become_anon();
  if pg_temp.refusal('select * from my_alerts()') is null then raise exception 'a visitor reads no alerts'; end if;
  if pg_temp.refusal('select my_alerts_unread()') is null then raise exception 'a visitor has no count'; end if;
  perform tests.unbecome();
end $$;

-- ---- The count stops at its bound; paging with `before` returns the next page without repeats or gaps ----
do $$
declare
  dee uuid := tests.account('ar-dee');
  d1 uuid; t uuid; i integer; prior timestamptz; got integer; pages integer := 0; seen_acts uuid[] := '{}'; page uuid[];
  base timestamptz := now() - interval '20 hours';
begin
  d1 := tests.character(dee, 'Ar Dee');
  t := tests.thread('Dee''s');
  -- 25 alerts on 25 Acts: 22 at distinct minutes, and three that share one instant (i = 16, 17, 18), the 8th to 10th newest.
  for i in 1..25 loop
    insert into alerts (account, kind, act, character, at)
    values (dee, 'quote', tests.post(d1, t, 'p' || i, base + i * interval '1 second'), d1,
            base + (case when i in (16, 17, 18) then 16 else i end + 100) * interval '1 minute');
  end loop;
  -- A page of ten ends after the tie here, so none is split; the second set below puts the tie across the edge.
  perform tests.become(dee);
  if my_alerts_unread() is distinct from 10 then raise exception 'the count stops at its bound of 10 with 25 new: %', my_alerts_unread(); end if;
  if (select count(*) from my_alerts(null, 100)) is distinct from 25 then raise exception 'the list holds all 25'; end if;
  prior := null;
  loop
    select array_agg(p.act order by p.at desc, p.act), min(p.at) into page, prior from my_alerts(prior, 10) p;
    exit when page is null;
    pages := pages + 1;
    if seen_acts && page then raise exception 'paging with before repeats a row on page %', pages; end if;
    seen_acts := seen_acts || page;
    exit when pages > 10;
  end loop;
  if cardinality(seen_acts) is distinct from 25 then raise exception 'paging reads every row once: % of 25 in % pages', cardinality(seen_acts), pages; end if;
  if pages is distinct from 3 then raise exception 'ten, ten and five make three pages: %', pages; end if;
  perform tests.unbecome();

  -- A tie across a page's edge is not split: the page holds all of them, the next starts after.
  delete from alerts where account = dee;
  for i in 1..25 loop
    insert into alerts (account, kind, act, character, at)
    values (dee, 'quote', (select a.id from acts a where a.thread = t and a.seq = i), d1,
            base + (case when i in (14, 15, 16) then 15 else i end + 100) * interval '1 minute');
  end loop;
  -- Newest first: 25..17 are nine rows, then 16, 15, 14 share an instant: the 10th, 11th and 12th.
  perform tests.become(dee);
  select array_agg(p.act), min(p.at) into page, prior from my_alerts(null, 10) p;
  if cardinality(page) is distinct from 12 then raise exception 'a tie across the edge is kept whole: a page of ten holds %', cardinality(page); end if;
  seen_acts := page;
  select array_agg(p.act) into page from my_alerts(prior, 10) p;
  if cardinality(page) is distinct from 10 then raise exception 'the next page is ten rows after the tie, none of them tied: %', cardinality(page); end if;
  if seen_acts && page then raise exception 'a tied row is on both pages'; end if;
  perform tests.unbecome();
end $$;

-- ---- The read is index ranges at a busy instance: 10,000 alerts for one account, 100,000 for others ----
do $$
declare
  hog uuid := tests.account('ar-hog');
  h1 uuid; t uuid; act uuid; ln record; plan text := ''; others uuid[] := '{}'; other_chars uuid[] := '{}'; i integer; src text; bufs integer; stmt text;
  base timestamptz := now() - interval '100 days';
  shown text;
begin
  h1 := tests.character(hog, 'Ar Hog');
  t := tests.thread('Hog''s');
  act := tests.post(h1, t, 'opening');
  for i in 1..5 loop
    others := others || tests.account('ar-other-' || i);
    other_chars := other_chars || tests.character(others[i], 'Ar Other ' || i);
  end loop;
  insert into alerts (account, kind, act, character, at)
  select hog, 'quote', act, h1, base + g * interval '10 minutes' from generate_series(1, 10000) g;
  insert into alerts (account, kind, act, at)
  select others[1 + g % 5], 'quote', act, base + g * interval '1 minute' from generate_series(1, 100000) g;
  -- Three hundred settlements that moved the account's character, and as many that moved others'.
  insert into settlements (starts_at, ends_at, season, applied_at)
  select base + g * interval '1 hour', base + g * interval '1 hour' + interval '30 minutes', (select min(id) from seasons), base + g * interval '1 hour' + interval '31 minutes'
  from generate_series(1, 300) g;
  insert into ledger (settlement, account, character, reason, amount)
  select s.id, hog, h1, 'post.reacted', 10 from settlements s where s.starts_at >= base;
  for i in 1..5 loop
    insert into ledger (settlement, account, character, reason, amount)
    select s.id, others[i], other_chars[i], 'post.reacted', 10 from settlements s where s.starts_at >= base;
  end loop;
  analyze alerts; analyze ledger; analyze settlements;

  perform tests.become(hog);
  if (select count(*) from my_alerts()) is distinct from 30 then raise exception 'a page of the busy account''s list is 30 rows: %', (select count(*) from my_alerts()); end if;
  if my_alerts_unread() is distinct from 10 then raise exception 'the busy account''s count stops at 10: %', my_alerts_unread(); end if;
  perform tests.unbecome();

  -- The statements as shipped (the functions' text, arguments by position), planned as the signed-in account would run them,
  -- with table scans off so that a missing index shows as a scan.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', hog, 'role', 'authenticated')::text, true);
  set local enable_seqscan = off;
  set local plan_cache_mode = force_generic_plan;
  for src in select unnest(array['my_alerts', 'my_alerts_unread']) loop
    select p.prosrc into shown from pg_proc p where p.proname = src and p.pronamespace = 'public'::regnamespace;
    if shown is null then raise exception '% is a SQL function with text to plan', src; end if;
    if src = 'my_alerts' then execute format('prepare plan_%s(timestamptz, integer) as %s', src, shown); else execute format('prepare plan_%s as %s', src, shown); end if;
    plan := '';
    stmt := case when src = 'my_alerts' then 'explain (analyze, buffers) execute plan_my_alerts(null, 30)' else 'explain (analyze, buffers) execute plan_my_alerts_unread' end;
    for ln in execute stmt loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
    if plan ~ 'Seq Scan on (alerts|ledger)' then raise exception '% never scans alerts or ledger: %', src, plan; end if;
    if plan !~ 'Index (Only )?Scan( Backward)? using alerts_by_account' then raise exception '%: written alerts are one range of (account, at): %', src, plan; end if;
    if plan !~ '(Index (Only )?Scan( Backward)? using|Bitmap Index Scan on) ledger_account' then raise exception '%: settlements are found by ledger_account: %', src, plan; end if;
    bufs := (regexp_match(plan, 'Buffers: shared hit=(\d+)'))[1]::integer;
    if bufs > 300 then raise exception '%: a page of the busy account''s list reads a bounded number of buffers, not %: %', src, bufs, plan; end if;
    raise notice '% reads % buffers', src, bufs;
    execute format('deallocate plan_%s', src);
  end loop;
  set local enable_seqscan = on;
  set local plan_cache_mode = auto;
  perform set_config('request.jwt.claims', '', true);
end $$;
