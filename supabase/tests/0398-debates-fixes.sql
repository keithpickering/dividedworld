-- The debates fixes in the inputs (supabase/migrations/0398_debates_fixes.sql; docs/plans/2026-11-21-debates-fixes-plan.md, Task 3; issues #893 and #894; model: 0390-debates.sql).
-- tallied_lines holds what a settlement's tallied earnings summed to on each Act, by reason, once, in the settlement's own transaction. settlement_input and estimate_input hand a post with a nonzero sum as a spark
-- at any age when a reaction reached it in the window, with its debate and its sums (`tallied`), and climb the quote chain above a spark with no cutoff, so a post in an earlier post's debate by its own player is read as one.
-- The posts here are this file's own (dx...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
create function pg_temp.entry(input jsonb, id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = id::text
$$;
create function pg_temp.edge(input jsonb, act uuid, quoted uuid) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(input -> 'quotes') e where e ->> 'act' = act::text and e ->> 'quoted' = quoted::text)
$$;
create function pg_temp.sum_of(input jsonb, act uuid, reason text) returns integer language sql as $$
  select (e ->> 'amount')::integer from jsonb_array_elements(input -> 'tallied') e where e ->> 'act' = act::text and e ->> 'reason' = reason
$$;
create function pg_temp.q(post uuid) returns text language sql as $$ select '[quote=x|' || post || ']hi[/quote] and more' $$;
create function pg_temp.first_window() returns timestamptz language plpgsql as $$
declare s1 constant timestamptz := (select min(starts_at) from seasons);
begin
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  return (select max(ends_at) from settlements);
end $$;

-- ---- (F4) A post inside the debate of an earlier post by its own player is never a spark, however old the posts above it ----
-- Ann's P (12 hours after d0), Bob's R quoting it (14 hours), and Ann's S quoting R (3 days 5 hours): P and R are both older than debateDays (3 days) before the window that opens at d0 + 4 days, where Cat quotes S.
-- With no edge S to R to P in the input, the engine reads S as in nobody's debate and pays Ann's own debate as another's (litTheFuse).
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('dx-ann'); bob uuid := tests.account('dx-bob'); cat uuid := tests.account('dx-cat');
  a uuid := tests.character(ann, 'Dx Ann'); b uuid := tests.character(bob, 'Dx Bob'); c uuid := tests.character(cat, 'Dx Cat');
  d0 timestamptz := pg_temp.first_window() + interval '10 days'; w0 timestamptz; w1 timestamptz;
  t uuid := tests.thread('Dx thread'); p uuid; r uuid; s uuid; q uuid; input jsonb;
begin
  w0 := d0 + interval '4 days'; w1 := w0 + interval '1 day';
  p := tests.post(a, t, 'P.', d0 + interval '12 hours');
  r := tests.post(b, t, pg_temp.q(p), d0 + interval '14 hours');
  s := tests.post(a, t, pg_temp.q(r), d0 + interval '3 days 5 hours');
  q := tests.post(c, t, pg_temp.q(s), w0 + interval '1 hour');
  input := settlement_input(w0, w1);
  if pg_temp.entry(input, s) is null or not pg_temp.edge(input, q, s) then raise exception 'the spark S is not in the input: %', input -> 'quotes'; end if;
  if pg_temp.entry(input, r) is null or pg_temp.entry(input, p) is null then raise exception 'the posts above S (R, P), older than debateDays, are not in the input'; end if;
  if not pg_temp.edge(input, s, r) or not pg_temp.edge(input, r, p) then raise exception 'the edges S to R and R to P are not in the input: %', input -> 'quotes'; end if;
  -- The window's end still bounds the climb: a quote of P made after the window's end is no edge of it.
  perform tests.post(b, t, pg_temp.q(p), w1 + interval '1 hour');
  if jsonb_array_length(settlement_input(w0, w1) -> 'quotes') <> jsonb_array_length(input -> 'quotes') then raise exception 'a quote made after the window''s end is in the input'; end if;
end $$;

-- ---- An old paid spark with a reaction in the window is in settlement_input with its tallied sums and its members; without the rows it is not ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('dx-ann2'); bob uuid := tests.account('dx-bob2'); cat uuid := tests.account('dx-cat2');
  a uuid := tests.character(ann, 'Dx Ann Two'); b uuid := tests.character(bob, 'Dx Bob Two'); c uuid := tests.character(cat, 'Dx Cat Two');
  w0 timestamptz := pg_temp.first_window() + interval '20 days'; w1 timestamptz;
  t uuid := tests.thread('Dx old thread'); paid uuid; unpaid uuid; q_paid uuid; q_unpaid uuid; input jsonb;
begin
  w1 := w0 + interval '1 day';
  paid := tests.post(a, t, 'Ten days old, and paid.', w0 - interval '10 days');
  unpaid := tests.post(a, t, 'Ten days old, never paid.', w0 - interval '10 days');
  q_paid := tests.post(b, t, pg_temp.q(paid), w0 - interval '9 days');
  q_unpaid := tests.post(b, t, pg_temp.q(unpaid), w0 - interval '9 days');
  insert into tallied_lines (settlement, act, reason, amount) values ((select max(id) from settlements), paid, 'tweener.outvoted', 20), ((select max(id) from settlements), paid, 'tweener.litTheFuse', 20);
  -- No reaction in the window: neither is handed.
  input := settlement_input(w0, w1);
  if pg_temp.entry(input, paid) is not null then raise exception 'a paid spark no reaction reached is in the input'; end if;
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (paid, c, cat, 'up', 1, w0 + interval '1 hour'), (unpaid, c, cat, 'up', 1, w0 + interval '1 hour');
  input := settlement_input(w0, w1);
  if pg_temp.entry(input, paid) is null then raise exception 'an old paid spark with a reaction in the window is not in the input'; end if;
  if pg_temp.entry(input, q_paid) is null or not pg_temp.edge(input, q_paid, paid) then raise exception 'the members of an old paid spark are not in the input: %', input -> 'quotes'; end if;
  if pg_temp.sum_of(input, paid, 'tweener.outvoted') is distinct from 20 or pg_temp.sum_of(input, paid, 'tweener.litTheFuse') is distinct from 20 then raise exception 'the spark''s tallied sums are not in the input: %', input -> 'tallied'; end if;
  if jsonb_array_length(input -> 'tallied') <> 2 then raise exception 'tallied holds more than the spark''s sums: %', input -> 'tallied'; end if;
  -- The old post a reaction reached is in the input as any reacted Act is; with no rows it is no spark, so nothing of its debate is.
  if pg_temp.entry(input, q_unpaid) is not null or pg_temp.edge(input, q_unpaid, unpaid) then raise exception 'the debate of an old spark with no tallied rows is in the input'; end if;
  -- The rows are the settlements that ended by the window's start: a window that opens before the settlement ended reads none.
  if pg_temp.entry(settlement_input(w0 - interval '19 days 23 hours', w0 - interval '19 days 22 hours'), paid) is not null then raise exception 'a window before the settlement that tallied reads its rows'; end if;
end $$;

-- ---- A paid spark's sums that net to 0 hand nothing: the rows are per reason, and the spark is old ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('dx-ann3'); bob uuid := tests.account('dx-bob3'); cat uuid := tests.account('dx-cat3');
  a uuid := tests.character(ann, 'Dx Ann Three'); b uuid := tests.character(bob, 'Dx Bob Three'); c uuid := tests.character(cat, 'Dx Cat Three');
  w0 timestamptz := pg_temp.first_window() + interval '30 days'; w1 timestamptz;
  first_s bigint := (select max(id) from settlements); second_s bigint;
  t uuid := tests.thread('Dx zero thread'); spark uuid; member uuid; input jsonb;
begin
  w1 := w0 + interval '1 day';
  spark := tests.post(a, t, 'Old, paid and taken back to 0.', w0 - interval '10 days');
  member := tests.post(b, t, pg_temp.q(spark), w0 - interval '9 days');
  insert into settlements (starts_at, ends_at, season) select ends_at, ends_at + interval '1 day', season from settlements where id = first_s returning id into second_s;
  insert into tallied_lines (settlement, act, reason, amount) values (first_s, spark, 'tweener.outvoted', 20), (second_s, spark, 'tweener.outvoted', -20);
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (spark, c, cat, 'up', 1, w0 + interval '1 hour');
  input := settlement_input(w0, w1);
  if pg_temp.entry(input, member) is not null or jsonb_array_length(input -> 'tallied') <> 0 then raise exception 'an old spark whose sums net to 0 is handed: %', input -> 'tallied'; end if;
end $$;

-- ---- A thread spun from an earlier post by the same player: the spin and the origin are in the input of a spark whose thread has no Act in the window (the engine reads inOwnDebate from the spin's target) ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('dx-ann4'); bob uuid := tests.account('dx-bob4'); cat uuid := tests.account('dx-cat4');
  a uuid := tests.character(ann, 'Dx Ann Four'); b uuid := tests.character(bob, 'Dx Bob Four'); c uuid := tests.character(cat, 'Dx Cat Four');
  w0 timestamptz := pg_temp.first_window() + interval '40 days'; w1 timestamptz;
  t uuid := tests.thread('Dx origin thread'); spun uuid; o uuid; spin uuid; s uuid; qc uuid; input jsonb;
begin
  w1 := w0 + interval '1 day';
  o := tests.post(a, t, 'The origin, ten days old.', w0 - interval '10 days');
  insert into threads (board, title, origin_act_id) select board, 'Dx spun', o from threads where id = t returning id into spun;
  spin := tests.act(b, 'spin', spun, '{"title": "Dx spun"}', o, w0 - interval '9 days');
  s := tests.post(a, spun, 'Ann replies under her own origin.', w0 - interval '30 hours');
  qc := tests.post(c, spun, pg_temp.q(s), w0 - interval '20 hours');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (s, c, cat, 'up', 1, w0 + interval '1 hour');
  input := settlement_input(w0, w1);
  if pg_temp.entry(input, s) is null then raise exception 'the spark in the spun thread is not in the input'; end if;
  if pg_temp.entry(input, spin) is null or pg_temp.entry(input, o) is null then raise exception 'the spin and the origin of the spark''s thread, older than debateDays, are not in the input'; end if;
end $$;

-- ---- apply_settlement writes the window's tallied sums once, with the settlement ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('dx-ann5'); a uuid := tests.character(ann, 'Dx Ann Five'); t uuid := tests.thread('Dx apply thread');
  w0 timestamptz := pg_temp.first_window(); w1 timestamptz; spark uuid; other uuid; applied jsonb; before_n integer; n integer;
begin
  w1 := w0 + interval '1 day';
  spark := tests.post(a, t, 'A paid spark.', w0 - interval '1 day');
  other := tests.post(a, t, 'Another.', w0 - interval '1 day');
  perform tests.become_service();
  -- Refused before anything is written: an Act that does not exist, a reason that is no ledger reason, an amount that is 0 or not whole, a row listed twice and what is no list.
  if pg_temp.coded(format($c$select apply_settlement(%L, %L, '[]', '{}', '[]', '[]', '[]', %L::jsonb)$c$, w0, w1, jsonb_build_array(jsonb_build_object('act', gen_random_uuid(), 'reason', 'tweener.outvoted', 'amount', 5)))) not like '22023 %' then raise exception 'a tallied sum on an Act that does not exist was not refused'; end if;
  if pg_temp.coded(format($c$select apply_settlement(%L, %L, '[]', '{}', '[]', '[]', '[]', %L::jsonb)$c$, w0, w1, jsonb_build_array(jsonb_build_object('act', spark, 'reason', 'Tweener', 'amount', 5)))) not like '22023 %' then raise exception 'a tallied sum with a reason that is no ledger reason was not refused'; end if;
  if pg_temp.coded(format($c$select apply_settlement(%L, %L, '[]', '{}', '[]', '[]', '[]', %L::jsonb)$c$, w0, w1, jsonb_build_array(jsonb_build_object('act', spark, 'reason', 'tweener.outvoted', 'amount', 0)))) not like '22023 %' then raise exception 'a tallied sum of 0 was not refused'; end if;
  if pg_temp.coded(format($c$select apply_settlement(%L, %L, '[]', '{}', '[]', '[]', '[]', %L::jsonb)$c$, w0, w1, jsonb_build_array(jsonb_build_object('act', spark, 'reason', 'tweener.outvoted', 'amount', 1.5)))) not like '22023 %' then raise exception 'a tallied sum that is not whole was not refused'; end if;
  if pg_temp.coded(format($c$select apply_settlement(%L, %L, '[]', '{}', '[]', '[]', '[]', %L::jsonb)$c$, w0, w1, jsonb_build_array(jsonb_build_object('act', spark, 'reason', 'tweener.outvoted', 'amount', 5), jsonb_build_object('act', spark, 'reason', 'tweener.outvoted', 'amount', 6)))) not like '22023 %' then raise exception 'two tallied sums for one Act and reason were not refused'; end if;
  if pg_temp.coded(format($c$select apply_settlement(%L, %L, '[]', '{}', '[]', '[]', '[]', '{"act": 1}'::jsonb)$c$, w0, w1)) not like '22023 %' then raise exception 'tallied sums that are no list were not refused'; end if;
  if exists (select 1 from settlements where starts_at = w0) then raise exception 'a refused call wrote a settlement'; end if;

  applied := apply_settlement(w0, w1, '[]', '{}', '[]', '[]', '[]', jsonb_build_array(
    jsonb_build_object('act', spark, 'reason', 'tweener.outvoted', 'amount', 20), jsonb_build_object('act', spark, 'reason', 'tweener.litTheFuse', 'amount', 20), jsonb_build_object('act', other, 'reason', 'tweener.outvoted', 'amount', -7)));
  if applied ->> 'applied' is distinct from 'true' then raise exception 'the window was not applied: %', applied; end if;
  select count(*) into n from tallied_lines where settlement = (applied ->> 'settlement')::bigint;
  if n <> 3 then raise exception 'the window wrote % tallied rows, not 3', n; end if;
  if (select amount from tallied_lines where settlement = (applied ->> 'settlement')::bigint and act = other and reason = 'tweener.outvoted') is distinct from -7 then raise exception 'a tallied row is not as sent'; end if;
  -- The same window again is answered as already settled and writes nothing, whatever it sends.
  select count(*) into before_n from tallied_lines;
  applied := apply_settlement(w0, w1, '[]', '{}', '[]', '[]', '[]', jsonb_build_array(jsonb_build_object('act', spark, 'reason', 'tweener.outvoted', 'amount', 20)));
  if applied ->> 'applied' is distinct from 'false' then raise exception 'a window applied twice: %', applied; end if;
  select count(*) into n from tallied_lines;
  if n <> before_n then raise exception 'a second apply of the same window wrote tallied rows (% to %)', before_n, n; end if;
  -- A call that sends none (an old caller's) is applied as before and writes none.
  perform apply_settlement(w1, w1 + interval '1 day', '[]');
  if exists (select 1 from tallied_lines l join settlements s on s.id = l.settlement where s.starts_at = w1) then raise exception 'a window that sent no sums wrote some'; end if;
  perform tests.unbecome();
end $$;

-- ---- tallied_lines is the system's alone and append-only ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('dx-ann6'); a uuid := tests.character(ann, 'Dx Ann Six'); t uuid := tests.thread('Dx rows thread'); p uuid := tests.post(a, t, 'P.', now());
  s bigint := (select max(id) from settlements);
begin
  if s is null then perform pg_temp.first_window(); s := (select max(id) from settlements); end if;
  insert into tallied_lines (settlement, act, reason, amount) values (s, p, 'tweener.outvoted', 3);
  if pg_temp.coded(format($c$insert into tallied_lines (settlement, act, reason, amount) values (%s, %L, 'tweener.outvoted', 4)$c$, s, p)) not like '23505 %' then raise exception 'a second row for one settlement, Act and reason was taken'; end if;
  if pg_temp.coded(format($c$insert into tallied_lines (settlement, act, reason, amount) values (%s, %L, 'tweener.shrugged', 0)$c$, s, p)) not like '23514 %' then raise exception 'a row of 0 was taken'; end if;
  if pg_temp.coded(format($c$insert into tallied_lines (settlement, act, reason, amount) values (%s, %L, 'Tweener', 4)$c$, s, p)) not like '23514 %' then raise exception 'a row with a reason that is no ledger reason was taken'; end if;
  if pg_temp.coded('update tallied_lines set amount = 9') is null then raise exception 'a tallied row was updated'; end if;
  if pg_temp.coded('delete from tallied_lines') is null then raise exception 'a tallied row was deleted'; end if;
  if pg_temp.coded('truncate tallied_lines') is null then raise exception 'tallied_lines was truncated'; end if;
  perform tests.become(ann);
  if pg_temp.coded('select * from tallied_lines') not like '42501 %' then raise exception 'a player read tallied_lines'; end if;
  perform tests.become_anon();
  if pg_temp.coded('select * from tallied_lines') not like '42501 %' then raise exception 'a visitor read tallied_lines'; end if;
  perform tests.unbecome();
  if not (select relrowsecurity from pg_class where oid = 'public.tallied_lines'::regclass) then raise exception 'tallied_lines has no row-level security'; end if;
end $$;

-- ---- estimate_input: the caller's own old paid spark is in it with its sums and members; another player's is not ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('dx-ann7'); bob uuid := tests.account('dx-bob7'); cat uuid := tests.account('dx-cat7'); eve uuid := tests.account('dx-eve7');
  a uuid := tests.character(ann, 'Dx Ann Seven'); b uuid := tests.character(bob, 'Dx Bob Seven'); c uuid := tests.character(cat, 'Dx Cat Seven'); e uuid := tests.character(eve, 'Dx Eve Seven');
  w0 timestamptz; t uuid := tests.thread('Dx estimate thread'); paid uuid; theirs uuid; unpaid uuid; q_paid uuid; q_theirs uuid; est jsonb;
  p uuid; r uuid; s uuid; qs uuid; q_unpaid uuid;
begin
  perform pg_temp.first_window();
  w0 := (select max(ends_at) from settlements);
  paid := tests.post(a, t, 'Ann''s, ten days old, and paid.', w0 - interval '10 days');
  theirs := tests.post(b, t, 'Bob''s, ten days old, and paid.', w0 - interval '10 days');
  unpaid := tests.post(a, t, 'Ann''s, ten days old, never paid.', w0 - interval '10 days');
  q_paid := tests.post(c, t, pg_temp.q(paid), w0 - interval '9 days');
  q_theirs := tests.post(c, t, pg_temp.q(theirs), w0 - interval '9 days');
  q_unpaid := tests.post(c, t, pg_temp.q(unpaid), w0 - interval '9 days');
  insert into tallied_lines (settlement, act, reason, amount) values ((select max(id) from settlements), paid, 'tweener.outvoted', 20), ((select max(id) from settlements), theirs, 'tweener.outvoted', 30);
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    (paid, c, cat, 'up', 1, w0 + interval '1 hour'), (theirs, e, eve, 'up', 1, w0 + interval '1 hour'), (unpaid, c, cat, 'up', 1, w0 + interval '1 hour');

  est := estimate_input(ann, w0 + interval '8 hours');
  if pg_temp.entry(est, paid) is null then raise exception 'the caller''s own old paid spark is not in their estimate'; end if;
  if pg_temp.entry(est, q_paid) is null or not pg_temp.edge(est, q_paid, paid) then raise exception 'the members of the caller''s old paid spark are not in their estimate: %', est -> 'quotes'; end if;
  if pg_temp.sum_of(est, paid, 'tweener.outvoted') is distinct from 20 or jsonb_array_length(est -> 'tallied') <> 1 then raise exception 'the estimate''s tallied is not the caller''s own sums: %', est -> 'tallied'; end if;
  if pg_temp.entry(est, theirs) is not null or pg_temp.entry(est, q_theirs) is not null or pg_temp.sum_of(est, theirs, 'tweener.outvoted') is not null then raise exception 'another player''s old paid spark is in the caller''s estimate'; end if;
  if pg_temp.entry(est, q_unpaid) is not null then raise exception 'the debate of the caller''s old spark with no tallied rows is in their estimate'; end if;
  est := estimate_input(eve, w0 + interval '8 hours');
  if pg_temp.entry(est, paid) is not null or pg_temp.entry(est, q_theirs) is not null or pg_temp.entry(est, q_paid) is not null or jsonb_array_length(est -> 'tallied') <> 0 then raise exception 'a bystander''s estimate holds an old paid spark or its sums: %', est -> 'tallied'; end if;
  est := estimate_input(bob, w0 + interval '8 hours');
  if pg_temp.entry(est, theirs) is null or pg_temp.sum_of(est, theirs, 'tweener.outvoted') is distinct from 30 or pg_temp.entry(est, paid) is not null then raise exception 'Bob''s estimate is not his own paid spark alone: %', est -> 'tallied'; end if;

  -- (F4) in the estimate: the author's spark S, in the debate of her own earlier post P by R, with P and R older than debateDays.
  p := tests.post(a, t, 'P.', w0 - interval '5 days');
  r := tests.post(b, t, pg_temp.q(p), w0 - interval '5 days' + interval '2 hours');
  s := tests.post(a, t, pg_temp.q(r), w0 - interval '1 day');
  qs := tests.post(c, t, pg_temp.q(s), w0 + interval '1 hour');
  est := estimate_input(ann, w0 + interval '8 hours');
  if pg_temp.entry(est, s) is null or pg_temp.entry(est, r) is null or pg_temp.entry(est, p) is null then raise exception 'the estimate lacks the posts above the author''s spark S (R, P)'; end if;
  if not pg_temp.edge(est, s, r) or not pg_temp.edge(est, r, p) then raise exception 'the estimate lacks the edges above S: %', est -> 'quotes'; end if;
end $$;
