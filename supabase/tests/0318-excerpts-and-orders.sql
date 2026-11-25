-- Cut excerpts say so, and an order ends with the office (supabase/migrations/0366_excerpts_and_orders.sql; docs/plans/2026-11-13-excerpts-and-orders-design.md, sections 1 and 2).
--
-- 1. pool_thread returns `cut` beside each post: true where the post's words were longer than `chars`, false where they fit (a post of exactly `chars` is not cut).
-- 2. system_digest's excerpts carry `cut` the same way.
-- 3. A Mod with an order who is made Boss: mod_standing returns no order for it, a later meeting writes it no row that carries the line, a beat or an allowance (it writes one blank row that settles what
--    was unspent, and then none), and a Mod still on staff and not ordered keeps its line with an allowance of 0.
-- 4. A Mod moved off staff and back on has no order until a meeting orders it; what it left unspent is returned to the bank once, not at every meeting.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

-- ---- 0. The world: a Boss and two Mods, the settings the meeting and the digest read ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 2, 'most', 12), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"', 'setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'eo-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'eo-boss', 'name', 'Excerpt Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'eo-m1', 'name', 'Excerpt Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'eo-m2', 'name', 'Excerpt Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', jsonb_build_array('eo-m1', 'eo-m2'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'renameBoard', 'structural', true, 'shapesBoard', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '5'), ('digestExcerptChars', '10')
  on conflict (key) do update set value = excluded.value;
  insert into move_bank (staff, balance, as_of) values ('eo-boss', 20, now()), ('eo-m1', 20, now());
end $$;

-- ---- 1 and 2. pool_thread and system_digest say when they cut ----
do $$
declare
  a uuid := tests.character(tests.account('eo-a'), 'Excerpt A');
  t uuid := tests.thread('Cuts');
  long uuid; short uuid; edge uuid;
  r jsonb;
  d jsonb;
  -- The window is far from now: other files commit rows (the race tests) that a window around now would count.
  base timestamptz := '2040-06-01T12:00:00Z';
begin
  long := tests.post(a, t, 'abcdefghijklmnopqrstuvwxyz1234', base - interval '3 minutes');
  short := tests.post(a, t, 'Hello', base - interval '2 minutes');
  edge := tests.post(a, t, '0123456789', base - interval '1 minute');
  r := pool_thread(t, 5, 10, null);
  perform pg_temp.expect(jsonb_array_length(r -> 'posts') = 3, 'three posts: ' || r::text);
  perform pg_temp.expect((select p ->> 'body' from jsonb_array_elements(r -> 'posts') p where (p ->> 'act')::uuid = long) = 'abcdefghij', 'the long post''s words are read as today: ' || r::text);
  perform pg_temp.expect((select (p -> 'cut') = 'true'::jsonb from jsonb_array_elements(r -> 'posts') p where (p ->> 'act')::uuid = long), 'a post of 30 characters over 10 is cut: ' || r::text);
  perform pg_temp.expect((select (p -> 'cut') = 'false'::jsonb from jsonb_array_elements(r -> 'posts') p where (p ->> 'act')::uuid = short), 'a post of 5 characters over 10 is not cut: ' || r::text);
  perform pg_temp.expect((select (p -> 'cut') = 'false'::jsonb from jsonb_array_elements(r -> 'posts') p where (p ->> 'act')::uuid = edge), 'a post of exactly 10 characters is not cut: ' || r::text);

  d := system_digest(base - interval '1 hour', base + interval '1 hour');
  perform pg_temp.expect((select e -> 'cut' = 'true'::jsonb and e ->> 'text' = 'abcdefghij' from jsonb_array_elements(d -> 'excerpts') e where (e ->> 'act')::uuid = long), 'the digest excerpt of the long post is cut: ' || (d -> 'excerpts')::text);
  perform pg_temp.expect((select e -> 'cut' = 'false'::jsonb from jsonb_array_elements(d -> 'excerpts') e where (e ->> 'act')::uuid = short), 'the digest excerpt of the short post is not cut: ' || (d -> 'excerpts')::text);
  perform pg_temp.expect((select e -> 'cut' = 'false'::jsonb from jsonb_array_elements(d -> 'excerpts') e where (e ->> 'act')::uuid = edge), 'the digest excerpt of an exact fit is not cut: ' || (d -> 'excerpts')::text);
end $$;

-- ---- 3 and 4. An order ends with the office ----
create function pg_temp.payload(boss text, orders jsonb) returns jsonb language sql as $$
  select jsonb_build_object('boss', boss, 'weekly_moves', 0, 'bank_cap', 20,
    'memory', jsonb_build_object('hobby', jsonb_build_object('name', 'wrestling', 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb, 'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', '[]'::jsonb, 'orders', orders, 'record', '{}'::jsonb)
$$;
create function pg_temp.order_for(mod text, line text, allowance integer) returns jsonb language sql as $$
  select jsonb_build_object('mod', mod, 'boards', '[]'::jsonb, 'order', line, 'allowance', allowance)
$$;
create function pg_temp.meet(at timestamptz, boss text, orders jsonb) returns bigint language plpgsql as $$
declare m bigint := (begin_meeting(at) ->> 'meeting')::bigint;
begin
  perform apply_meeting(m, pg_temp.payload(boss, orders));
  return m;
end $$;
create function pg_temp.rows(who text, in_meeting bigint) returns jsonb language sql as $$
  select to_jsonb(o) from staff_orders o where o.staff = who and o.meeting = in_meeting
$$;

do $$
declare
  m1 bigint; m2 bigint; m3 bigint; m4 bigint; m5 bigint;
  bank_before numeric;
  n integer;
begin
  -- The Boss orders both Mods; eo-m1 is given 2 moves, which it does not spend.
  m1 := pg_temp.meet('2031-02-01T09:00:00Z', 'eo-boss', jsonb_build_array(pg_temp.order_for('eo-m1', 'Watch the games.', 2), pg_temp.order_for('eo-m2', 'Watch the rest.', 0)));
  perform pg_temp.expect((mod_standing('eo-m1') ->> 'order') = 'Watch the games.' and (mod_standing('eo-m2') ->> 'order') = 'Watch the rest.', 'a Mod with an order reads it: ' || mod_standing('eo-m1')::text);

  -- eo-m1 becomes the Boss (the open season names it).
  update seasons set boss = 'eo-m1' where ends_at is null;
  perform pg_temp.expect(mod_standing('eo-m1') ->> 'office' = 'boss', 'eo-m1 is the Boss: ' || mod_standing('eo-m1')::text);
  perform pg_temp.expect(mod_standing('eo-m1') -> 'order' = 'null'::jsonb, 'the Boss has no standing order: ' || mod_standing('eo-m1')::text);

  -- A meeting after the change: eo-m1 is carried no line, no beat and no allowance; eo-m2, a Mod still on staff and not ordered, keeps its line with 0.
  m2 := pg_temp.meet('2031-02-02T09:00:00Z', 'eo-m1', '[]');
  perform pg_temp.expect(not exists (select 1 from staff_orders o where o.meeting = m2 and o.staff = 'eo-m1' and (o.order_line <> '' or o.allowance <> 0 or o.boards <> '{}')), 'the Boss was carried an order: ' || coalesce(pg_temp.rows('eo-m1', m2)::text, 'none'));
  perform pg_temp.expect(pg_temp.rows('eo-m2', m2) ->> 'order_line' = 'Watch the rest.' and (pg_temp.rows('eo-m2', m2) ->> 'allowance')::integer = 0, 'a Mod on staff keeps its line with 0: ' || coalesce(pg_temp.rows('eo-m2', m2)::text, 'none'));
  perform pg_temp.expect(mod_standing('eo-m2') ->> 'order' = 'Watch the rest.' and (mod_standing('eo-m2') ->> 'allowance')::integer = 0, 'eo-m2 still reads its line, allowance 0: ' || mod_standing('eo-m2')::text);
  -- What eo-m1 left unspent was returned once. The bank is then lowered, under its cap, so that a second return would show.
  perform pg_temp.expect(order_unspent('eo-m1') = 0, 'nothing of eo-m1''s allowance is left to return: ' || order_unspent('eo-m1'));
  update move_bank set balance = 5 where staff = 'eo-m1';
  select balance into bank_before from move_bank where staff = 'eo-m1';
  m3 := pg_temp.meet('2031-02-03T09:00:00Z', 'eo-m1', '[]');
  perform pg_temp.expect(pg_temp.rows('eo-m1', m3) is null, 'a later meeting writes the Boss no row: ' || coalesce(pg_temp.rows('eo-m1', m3)::text, 'none'));
  perform pg_temp.expect((select balance from move_bank where staff = 'eo-m1') = bank_before, 'the bank was returned to twice: ' || bank_before || ' then ' || (select balance from move_bank where staff = 'eo-m1'));

  -- 4. eo-m2 is moved off staff, a meeting passes, and it comes back: no order until a meeting orders it.
  insert into staff_offices (staff, office, cause) values ('eo-m2', 'benched', 'admin');
  perform pg_temp.expect(mod_standing('eo-m2') -> 'order' = 'null'::jsonb, 'a benched persona reads no order: ' || mod_standing('eo-m2')::text);
  m4 := pg_temp.meet('2031-02-04T09:00:00Z', 'eo-m1', '[]');
  perform pg_temp.expect(not exists (select 1 from staff_orders o where o.meeting = m4 and o.staff = 'eo-m2' and (o.order_line <> '' or o.allowance <> 0 or o.boards <> '{}')), 'a persona off staff was carried an order: ' || coalesce(pg_temp.rows('eo-m2', m4)::text, 'none'));
  insert into staff_offices (staff, office, cause) values ('eo-m2', 'mod', 'admin');
  perform pg_temp.expect(mod_standing('eo-m2') ->> 'office' = 'mod' and mod_standing('eo-m2') -> 'order' = 'null'::jsonb, 'a Mod back on staff has no order yet: ' || mod_standing('eo-m2')::text);
  perform pg_temp.expect((mod_standing('eo-m2') ->> 'allowance')::integer = 0, 'and no allowance: ' || mod_standing('eo-m2')::text);
  -- A meeting that carries it does not bring the old line back; one that orders it gives it a new one.
  m5 := pg_temp.meet('2031-02-05T09:00:00Z', 'eo-m1', '[]');
  perform pg_temp.expect(mod_standing('eo-m2') -> 'order' = 'null'::jsonb, 'a meeting that did not order it brought the old line back: ' || mod_standing('eo-m2')::text);
  m5 := pg_temp.meet('2031-02-06T09:00:00Z', 'eo-m1', jsonb_build_array(pg_temp.order_for('eo-m2', 'Welcome back.', 1)));
  perform pg_temp.expect(mod_standing('eo-m2') ->> 'order' = 'Welcome back.' and (mod_standing('eo-m2') ->> 'allowance')::integer = 1, 'a meeting that orders it gives the new line: ' || mod_standing('eo-m2')::text);
end $$;
