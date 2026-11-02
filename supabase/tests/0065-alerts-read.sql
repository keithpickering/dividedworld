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

-- A suite shares one database, and 0031 commits tallies of its own, which are news for every player (0063). The counts below are of what this
-- file makes, so season news is counted apart (0068 holds it): `old_news()` is the season news newer than the signed-in account's mark, and
-- `unread()` is the HUD's count less it.
create function pg_temp.old_news() returns integer language sql security definer as $f$
  select (select count(*)::integer from (
    select 1 from seasons s join acts a on a.id = s.reveal_act where a.created_at > coalesce((select p.alerts_seen_at from account_preferences p where p.account = signed_in_account()), '-infinity')
    union all select 1 from acts a where a.kind = 'tally' and tally_names(a.payload) > 0 and a.created_at > coalesce((select p.alerts_seen_at from account_preferences p where p.account = signed_in_account()), '-infinity')
    union all select 1 from season_boss_changes h where h.at > coalesce((select p.alerts_seen_at from account_preferences p where p.account = signed_in_account()), '-infinity')
    union all select 1 from season_boss_changes h where h.outgoing is not null and h.at > coalesce((select p.alerts_seen_at from account_preferences p where p.account = signed_in_account()), '-infinity')
  ) old)
$f$;
create function pg_temp.unread() returns integer language sql security definer as $f$ select my_alerts_unread() - pg_temp.old_news() $f$;


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
  if (select count(*) from my_alerts() where kind <> 'seasonNews') is distinct from 8 then raise exception 'six written, one followed thread and one settlement make eight: %', (select count(*) from my_alerts()); end if;
  if (select string_agg(kind, ',' order by at desc, kind) from my_alerts() where kind <> 'seasonNews') is distinct from 'followed,settlement,ruling,hint,trapSprang,trapStruck,cardOnYours,quote' then
    raise exception 'newest first: %', (select string_agg(kind, ',') from my_alerts() where kind <> 'seasonNews');
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
  if my_alerts_unread() is distinct from least(10, 8 + pg_temp.old_news()) then raise exception 'with no mark set, all eight are new: %', my_alerts_unread(); end if;
  perform see_alerts(base + interval '5 hours');
  if pg_temp.unread() is distinct from 3 then
    raise exception 'after the mark at +5h, the alerts at +6h (one) and the settlement and thread are new: %', pg_temp.unread();
  end if;
  perform see_alerts(base + interval '7 hours' + interval '1 second');
  if pg_temp.unread() is distinct from 1 then raise exception 'after the mark past the settlement only the followed thread is new: %', pg_temp.unread(); end if;
  perform see_alerts(now());
  if pg_temp.unread() is distinct from 0 then raise exception 'after the mark at now nothing is new: %', pg_temp.unread(); end if;
  -- Seeing never removes a row: the list is the same.
  if (select count(*) from my_alerts() where kind <> 'seasonNews') is distinct from 8 then raise exception 'the list does not shrink when seen'; end if;
  -- A new alert, a new post and a new settlement each move the count by one (rows are added by the writers, here by the owner).
  perform tests.unbecome();
  insert into alerts (account, kind, act, character, at) values (ann, 'quote', quoted, a1, now() + interval '1 minute');
  perform tests.become(ann);
  if pg_temp.unread() is distinct from 1 then raise exception 'a written alert after the mark is new: %', pg_temp.unread(); end if;
  perform tests.unbecome();
  perform tests.post(c1, mine, 'cat 1', now() + interval '2 minutes');
  insert into settlements (starts_at, ends_at, season, applied_at)
  values (base + interval '1 day', base + interval '1 day' + interval '6 hours', (select min(id) from seasons), now() + interval '3 minutes') returning id into sid2;
  insert into ledger (settlement, account, character, reason, amount) values (sid2, ann, a1, 'post.reacted', 10);
  perform tests.become(ann);
  if pg_temp.unread() is distinct from 3 then raise exception 'a post by another in a followed thread and a settlement after the mark are new too: %', pg_temp.unread(); end if;
  select * into got from my_alerts() where kind = 'followed';
  if got.count is distinct from 3 then raise exception 'the thread now holds three posts by others: %', got; end if;
  if (select count(*) from my_alerts() where kind = 'settlement') is distinct from 2 then raise exception 'each settlement is one row'; end if;

  -- A followed thread read to its end leaves the list, and the count with it.
  perform mark_read(mine, 100, a1);
  if exists (select 1 from my_alerts() where kind = 'followed') then raise exception 'a followed thread read to its end leaves the list'; end if;
  if pg_temp.unread() is distinct from 2 then raise exception 'and the count: %', pg_temp.unread(); end if;

  -- ---- Another account sees none of Ann's ----
  perform tests.become(cat);
  if exists (select 1 from my_alerts() where kind <> 'seasonNews') then raise exception 'another account reads none of the caller''s alerts: %', (select count(*) from my_alerts() where kind <> 'seasonNews'); end if;
  if pg_temp.unread() is distinct from 0 then raise exception 'and counts none: %', pg_temp.unread(); end if;
  perform tests.become(bob);
  -- His own quote, his own settlement, and the thread he started that Cat posted in.
  if (select string_agg(kind, ',' order by kind) from my_alerts() where kind <> 'seasonNews') is distinct from 'followed,quote,settlement' then raise exception 'Bob reads his own alerts alone: %', (select string_agg(kind, ',') from my_alerts() where kind <> 'seasonNews'); end if;
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
  -- In the future, newer than any season news the suite's earlier files left, which therefore falls on the last page and is set aside.
  base timestamptz := now() + interval '30 days';
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
  if (select count(*) from my_alerts(null, 100) where kind <> 'seasonNews') is distinct from 25 then raise exception 'the list holds all 25'; end if;
  prior := null;
  loop
    select array_agg(p.act order by p.at desc, p.act) filter (where p.kind <> 'seasonNews'), min(p.at) into page, prior from my_alerts(prior, 10) p;
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

-- ---- Pages to exhaustion across every source: no repeats, no gaps, ties kept whole ----
-- Every page of `size` read from the caller's list, each from the oldest `at` of the page before; raises on a repeat and answers
-- the keys read, so a test can compare them with the whole list read at once.
create function pg_temp.exhaust(size integer) returns text[] language plpgsql as $$
declare
  prior timestamptz; got text[] := '{}'; page text[]; pages integer := 0;
begin
  loop
    select array_agg(p.kind || '|' || coalesce(p.sub, '') || '|' || coalesce(p.act::text, '') || '|' || coalesce(p.thread::text, '') || '|' || p.at::text) filter (where p.kind <> 'seasonNews'), min(p.at)
      into page, prior from my_alerts(prior, size) p;
    exit when page is null;
    pages := pages + 1;
    if got && page then raise exception 'a page repeats a row of an earlier one (page %): %', pages, page; end if;
    got := got || page;
    if pages > 50 then raise exception 'paging does not end'; end if;
  end loop;
  return got;
end $$;
create function pg_temp.whole() returns text[] language sql as $$
  select array_agg(p.kind || '|' || coalesce(p.sub, '') || '|' || coalesce(p.act::text, '') || '|' || coalesce(p.thread::text, '') || '|' || p.at::text) from my_alerts(null, 100) p where p.kind <> 'seasonNews'
$$;

do $$
declare
  eva uuid := tests.account('ar-eva'); fay uuid := tests.account('ar-fay'); gus uuid := tests.account('ar-gus');
  e1 uuid; f1 uuid; g1 uuid; t uuid; i integer; sid bigint; page record; first_page integer; got text[]; ties timestamptz;
  base timestamptz := now() - interval '30 days';
begin
  e1 := tests.character(eva, 'Ar Eva'); f1 := tests.character(fay, 'Ar Fay'); g1 := tests.character(gus, 'Ar Gus');

  -- (a) More settlements than a page, two of them applied at one instant across the page's edge (the 5th and 6th newest of 9).
  -- Applied in order, later than every settlement before in this file, so the later id is the newer (a page is ordered by id).
  for i in 1..9 loop
    insert into settlements (starts_at, ends_at, season, applied_at)
    values (base + i * interval '1 day', base + i * interval '1 day' + interval '6 hours', (select min(id) from seasons),
            now() + interval '10 days' + (case when i = 4 then 5 else i end) * interval '1 day') returning id into sid;
    insert into ledger (settlement, account, character, reason, amount) values (sid, eva, e1, 'post.reacted', 10);
  end loop;
  perform tests.become(eva);
  select count(*) into first_page from my_alerts(null, 5);
  if first_page is distinct from 6 then raise exception '(a) a tie of settlements across the edge is kept whole: a page of five holds %', first_page; end if;
  got := pg_temp.exhaust(5);
  if cardinality(got) is distinct from 9 or (select array_agg(x order by x) from unnest(got) x) is distinct from (select array_agg(x order by x) from unnest(pg_temp.whole()) x) then
    raise exception '(a) paging settlements reads every one once: % of 9', cardinality(got);
  end if;
  perform tests.unbecome();

  -- (b) Followed threads, two with their newest post at one instant across the edge (the 5th and 6th newest of 9).
  for i in 1..9 loop
    t := tests.thread('Ar followed ' || i);
    perform tests.post(f1, t, 'opening', base);
    -- Newer than any season news the suite's earlier files left, which therefore falls after these rows.
    perform tests.post(g1, t, 'later', now() + interval '60 days' + (case when i = 4 then 5 else i end) * interval '1 day');
    -- Fay started it and Gus replied; the thread is Fay's.
  end loop;
  perform tests.become(fay);
  select count(*) into first_page from my_alerts(null, 5);
  if first_page is distinct from 6 then raise exception '(b) a tie of followed threads across the edge is kept whole: a page of five holds %', first_page; end if;
  got := pg_temp.exhaust(5);
  if cardinality(got) is distinct from 9 or (select array_agg(x order by x) from unnest(got) x) is distinct from (select array_agg(x order by x) from unnest(pg_temp.whole()) x) then
    raise exception '(b) paging followed threads reads every one once: % of 9', cardinality(got);
  end if;
  perform tests.unbecome();

  -- (c) A settlement and a written alert at one instant, on the edge between sources: newest first, three written, then the
  -- settlement and a written alert together (the 4th and 5th), then one written; a page of four ends inside the tie.
  t := tests.thread('Ar cross');
  perform tests.post(g1, t, 'opening', base);
  ties := now() + interval '100 days';
  for i in 1..6 loop
    insert into alerts (account, kind, act, character, at)
    values (gus, 'quote', tests.post(g1, t, 'p' || i, base + i * interval '1 minute'), g1,
            case i when 1 then ties - interval '2 hours' when 2 then ties - interval '1 hour' when 3 then ties else ties + (i - 3) * interval '1 hour' end);
  end loop;
  -- Order, newest first: i=6 (+3h), 5 (+2h), 4 (+1h), then i=3 and the settlement (both at `ties`), then 2 (-1h), 1 (-2h).
  insert into settlements (starts_at, ends_at, season, applied_at)
  values (base + interval '40 days', base + interval '40 days' + interval '6 hours', (select min(id) from seasons), ties) returning id into sid;
  insert into ledger (settlement, account, character, reason, amount) values (sid, gus, g1, 'post.reacted', 10);
  perform tests.become(gus);
  select count(*) into first_page from my_alerts(null, 4);
  if first_page is distinct from 5 then raise exception '(c) a tie across sources on the edge is kept whole: a page of four holds %', first_page; end if;
  if not exists (select 1 from my_alerts(null, 4) where kind = 'settlement') then raise exception '(c) the settlement is on the page of its tie'; end if;
  got := pg_temp.exhaust(4);
  if cardinality(got) is distinct from 7 or (select array_agg(x order by x) from unnest(got) x) is distinct from (select array_agg(x order by x) from unnest(pg_temp.whole()) x) then
    raise exception '(c) paging across sources reads every row once: % of 7', cardinality(got);
  end if;
  perform tests.unbecome();
end $$;

-- ---- The count at the settlement boundary: a settlement applied at the mark is seen, one an instant after is new ----
do $$
declare
  hal uuid := tests.account('ar-hal'); h1 uuid; sid bigint; sid2 bigint; at_mark timestamptz := now() - interval '5 days';
begin
  h1 := tests.character(hal, 'Ar Hal');
  insert into settlements (starts_at, ends_at, season, applied_at)
  values (now() - interval '9 days', now() - interval '9 days' + interval '6 hours', (select min(id) from seasons), at_mark) returning id into sid;
  insert into settlements (starts_at, ends_at, season, applied_at)
  values (now() - interval '8 days', now() - interval '8 days' + interval '6 hours', (select min(id) from seasons), at_mark + interval '1 microsecond') returning id into sid2;
  insert into ledger (settlement, account, character, reason, amount) values (sid, hal, h1, 'post.reacted', 10), (sid2, hal, h1, 'post.quoted', 10);
  perform tests.become(hal);
  if pg_temp.unread() is distinct from 2 then raise exception 'with no mark, both settlements are new: %', pg_temp.unread(); end if;
  perform see_alerts(at_mark);
  if pg_temp.unread() is distinct from 1 then raise exception 'a settlement applied at the mark is seen, one an instant after it is new: %', pg_temp.unread(); end if;
  perform see_alerts(at_mark + interval '1 microsecond');
  if pg_temp.unread() is distinct from 0 then raise exception 'and seen once the mark reaches it: %', pg_temp.unread(); end if;
  perform tests.unbecome();
end $$;

-- ---- Nothing the news stubs are reachable by an API role; nothing hides a thread from a player today ----
do $$
begin
  if has_function_privilege('anon', 'alerts_news(timestamptz,integer)', 'execute') or has_function_privilege('authenticated', 'alerts_news(timestamptz,integer)', 'execute')
     or has_function_privilege('anon', 'alerts_news_unread(timestamptz)', 'execute') or has_function_privilege('authenticated', 'alerts_news_unread(timestamptz)', 'execute') then
    raise exception 'alerts_news and alerts_news_unread are read through my_alerts alone, never by an API role';
  end if;
  -- my_alerts names a thread's title under its owner's rights, which is right while every signed-in player may read every thread and
  -- board (0001). A feature that hides one fails this, and must null the title where the caller cannot read the thread (0060's header).
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('threads', 'boards', 'acts') and (permissive <> 'PERMISSIVE' or qual is distinct from 'true')) then
    raise exception 'a thread, board or Act can be hidden from a player now: my_alerts must null the titles of those the caller cannot read';
  end if;
end $$;

-- ---- The count of followed threads is a probe that stops at 10: 500 followed threads, each with a post past the place ----
do $$
declare
  ivy uuid := tests.account('ar-ivy'); jon uuid := tests.account('ar-jon'); i1 uuid; j1 uuid; t uuid; i integer; ln record; plan text := ''; bufs integer;
begin
  i1 := tests.character(ivy, 'Ar Ivy'); j1 := tests.character(jon, 'Ar Jon');
  for i in 1..500 loop
    t := tests.thread('Ar heavy ' || i);
    perform tests.post(i1, t, 'opening', now() - interval '3 days');
    perform tests.post(j1, t, 'reply', now() - interval '2 days');
  end loop;
  analyze acts; analyze threads;
  perform tests.become(ivy);
  if my_alerts_unread() is distinct from 10 then raise exception '500 followed threads with new posts count to the bound: %', my_alerts_unread(); end if;
  perform tests.unbecome();
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ivy, 'role', 'authenticated')::text, true);
  set local enable_seqscan = off;
  plan := '';
  -- The function's own statement, as shipped, so the plan shows the statement and not the call.
  execute format('prepare plan_heavy as %s', (select prosrc from pg_proc where proname = 'my_alerts_unread' and pronamespace = 'public'::regnamespace));
  for ln in execute 'explain (analyze, buffers) execute plan_heavy' loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  deallocate plan_heavy;
  set local enable_seqscan = on;
  perform set_config('request.jwt.claims', '', true);
  bufs := (regexp_match(plan, 'Buffers: shared hit=(\d+)'))[1]::integer;
  raise notice 'followed-heavy my_alerts_unread reads % buffers', bufs;
  if bufs > 400 then raise exception 'the count of 500 followed threads stops at its bound and reads few buffers, not %: %', bufs, plan; end if;
end $$;

-- ---- The ledger is bounded exactly, whatever order settlement ids and times came in ----
-- A settlement committed earlier (a race test's, in the full suite) can be applied later than one with a higher id; the read
-- must still find every settlement that qualifies by applied_at.
do $$
declare
  kim uuid := tests.account('ar-kim'); k1 uuid; w bigint; x bigint; v bigint;
begin
  k1 := tests.character(kim, 'Ar Kim');
  insert into settlements (starts_at, ends_at, season, applied_at)
  values (now() - interval '400 days', now() - interval '400 days' + interval '6 hours', (select min(id) from seasons), now() - interval '12 hours') returning id into w;
  insert into settlements (starts_at, ends_at, season, applied_at)
  values (now() - interval '401 days', now() - interval '401 days' + interval '6 hours', (select min(id) from seasons), now() + interval '500 days') returning id into x;
  insert into settlements (starts_at, ends_at, season, applied_at)
  values (now() - interval '402 days', now() - interval '402 days' + interval '6 hours', (select min(id) from seasons), now() - interval '3 days') returning id into v;
  insert into ledger (settlement, account, character, reason, amount) values (w, kim, k1, 'post.reacted', 10), (v, kim, k1, 'post.reacted', 10);
  perform tests.become(kim);
  if (select count(*) from my_alerts() where kind = 'settlement') is distinct from 2 then
    raise exception 'both settlements are found though a later-applied one has a lower id: %', (select count(*) from my_alerts() where kind = 'settlement');
  end if;
  if pg_temp.unread() is distinct from 2 then raise exception 'with no mark both are new: %', pg_temp.unread(); end if;
  perform see_alerts(now() - interval '1 day');
  if pg_temp.unread() is distinct from 1 then raise exception 'the settlement applied after the mark is new, whatever its id: %', pg_temp.unread(); end if;
  if (select count(*) from my_alerts(now() - interval '1 day', 10) where kind = 'settlement') is distinct from 1 then raise exception 'a page before the cursor finds the older one'; end if;
  perform tests.unbecome();
end $$;
