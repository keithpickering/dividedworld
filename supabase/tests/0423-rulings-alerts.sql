-- Rulings and missing alerts (supabase/migrations/0423_rulings_alerts.sql; docs/plans/2026-11-23-rulings-and-missing-alerts-plan.md; its design is docs/plans/2026-11-23-rulings-and-missing-alerts-design.md).
-- Task 2 (section 1): the kinds `gift` and `conduct` are alert kinds and toast kinds; one that is neither is still refused.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('ra-ann');
  said jsonb;
begin
  insert into alerts (account, kind, sub, act) values (ann, 'gift', null, null);
  insert into alerts (account, kind, sub, act) values (ann, 'conduct', 'hide', null);
  if (select count(*) from alerts where account = ann and kind in ('gift', 'conduct')) <> 2 then raise exception 'a gift and a conduct alert are not both stored'; end if;
  if pg_temp.refusal(format('insert into alerts (account, kind, act) values (%L, %L, null)', ann, 'confetti')) is null then raise exception 'an alert of kind confetti was stored'; end if;

  perform tests.become(ann);
  said := set_preferences(toasts => array['gift', 'conduct']);
  if said -> 'toasts' is distinct from '["gift", "conduct"]'::jsonb then raise exception 'the toasts gift and conduct are not kept: %', said; end if;
  if pg_temp.refusal($q$select set_preferences(toasts => array['confetti'])$q$) is distinct from 'not a kind of alert: confetti' then raise exception 'a toast of kind confetti was accepted'; end if;
  perform tests.unbecome();

  -- The toastDefaults setting names them too.
  if pg_temp.refusal($q$insert into settings (key, value) values ('toastDefaults', '["gift", "conduct"]') on conflict (key) do update set value = excluded.value$q$) is not null then
    raise exception 'toastDefaults refused gift and conduct: %', pg_temp.refusal($q$insert into settings (key, value) values ('toastDefaults', '["gift", "conduct"]') on conflict (key) do update set value = excluded.value$q$);
  end if;
end $$;

-- Task 3 (section 2): what a Mod Bot's work lands.
--
-- 1. A filing writes one ruling/warning alert to the author's account about the infraction; one that fills the bar writes one ruling/ban about the ban and no warning.
-- 2. A live fall: the taker gets the warning, the author gets fallTaken (about the infraction); taker and author of one account: the taker's warning alone.
-- 3. A visit that ends intercepted or dropped writes nothing to the author.
-- 4. Each appeal verdict writes one appealAnswered to the appellant, about the ruling Act; an increase that lays a ban writes no warning or ban of its own.
-- 5. An appeal that expires unheard, or is refunded, writes one appealRefunded about the appeal, from refund_appeal alone, once per refund.
-- 6. A judged report writes one reportJudged to the reporter about the verdict; a refunded one writes one reportRefunded about the report, once.
-- 7. Staff cannot appeal or report (the guards refuse), so no row is owed to a character with no account.

do $$
declare seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
        'reportPrice', 25, 'reportsPerDay', 100, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 50, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'),
        'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.'),
        'appealUpheld', jsonb_build_array('{mod} turns {appellant} down.'),
        'reportDismissed', jsonb_build_array('{mod} dismisses {reporter} with a sigh.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ra-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'ra-boss', 'name', 'Alert Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'ra-m1', 'name', 'Alert Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('ra-m1'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  insert into card_kinds (key, name, alignment, rarity, play, reaches, discipline) values ('t-ra-fall', 'Test Alert Fall', 'sweet', 'uncommon', 'cast', '{post}', '{"kind": "fall"}') on conflict (key) do nothing;
end $$;

create function pg_temp.owner(c uuid) returns uuid language sql as $$ select owner from characters where id = c $$;

create function pg_temp.player(label text, cash integer default 500) returns uuid language plpgsql as $$
declare a uuid := tests.account('ra-' || label);
begin
  insert into wallets (account, balance) values (a, cash) on conflict (account) do update set balance = excluded.balance;
  return tests.character(a, 'Ra ' || label);
end $$;

create function pg_temp.say(by_character uuid, in_thread uuid, body text default null) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(pg_temp.owner(by_character));
  made := post(in_thread, by_character, coalesce(body, 'A post ' || gen_random_uuid()));
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;

create function pg_temp.visit(on_post uuid, band text default 'moderate') returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := start_visit(on_post, 'ra-m1', jsonb_build_object('rule_number', null, 'band', band, 'cause', 'patrol', 'rule', 'Rule ' || gen_random_uuid()));
  if r ->> 'visit' is null then raise exception 'no visit started: %', r; end if;
  return (r ->> 'visit')::uuid;
end $$;

-- The ruling alerts an account holds, as "sub:act" strings in a fixed order; the account is the character's owner.
create function pg_temp.rulings(c uuid) returns text[] language sql as $$
  select coalesce(array_agg(a.sub || ':' || coalesce(a.act::text, 'none') order by a.sub, a.act::text), '{}') from alerts a where a.account = pg_temp.owner(c) and a.kind = 'ruling'
$$;

create function pg_temp.appeal(c uuid, punishment uuid) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(pg_temp.owner(c));
  made := open_appeal(c, punishment, 'I did nothing wrong.');
  perform tests.unbecome();
  return (made ->> 'appeal')::uuid;
end $$;

create function pg_temp.report(c uuid, post uuid) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(pg_temp.owner(c));
  made := open_report(c, post, 'This one breaks the spirit of the board.');
  perform tests.unbecome();
  return (made ->> 'report')::uuid;
end $$;

-- ---- 1. A filing: a warning about the infraction; a full bar: a ban about the ban, and no warning ----
do $$
declare
  t uuid := tests.thread('Ra filing');
  a uuid := pg_temp.player('f-author'); b uuid := pg_temp.player('f-banned');
  pa uuid := pg_temp.say(a, t); pb1 uuid := pg_temp.say(b, t); pb2 uuid := pg_temp.say(b, t);
  v uuid; inf uuid; ban uuid;
begin
  v := pg_temp.visit(pa);
  if (file_visit(v, 'Filed.') ->> 'filed')::boolean is distinct from true then raise exception 'the visit did not file'; end if;
  inf := (select i.id from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text);
  if pg_temp.rulings(a) is distinct from array['warning:' || inf] then raise exception 'a filing writes one warning about the infraction: %', pg_temp.rulings(a); end if;
  if (select count(*) from alerts x where x.account = pg_temp.owner(a) and x.character = a) is distinct from 1::bigint then raise exception 'the alert is the author character''s, once'; end if;
  -- A second call of file_visit on the same visit writes nothing more.
  perform file_visit(v, 'Again.');
  if cardinality(pg_temp.rulings(a)) is distinct from 1 then raise exception 'a second filing wrote another alert: %', pg_temp.rulings(a); end if;

  -- The bar: a severe infraction laid directly (infract itself alerts no one), then a moderate filing that fills it.
  perform infract(b, 'severe', pb1, 'ra-m1');
  if pg_temp.rulings(b) is distinct from '{}' then raise exception 'infract alone wrote an alert: %', pg_temp.rulings(b); end if;
  v := pg_temp.visit(pb2);
  perform file_visit(v, 'Filed.');
  ban := (select x.id from acts x where x.kind = 'ban' and x.payload ->> 'character' = b::text);
  if ban is null then raise exception 'the filing did not fill the bar'; end if;
  if pg_temp.rulings(b) is distinct from array['ban:' || ban] then raise exception 'a filing that fills the bar writes one ban about the ban and no warning: %', pg_temp.rulings(b); end if;
end $$;

-- ---- 2. A live fall: warning to the taker, fallTaken to the author; one account: the taker's warning alone ----
do $$
declare
  t uuid := tests.thread('Ra fall');
  author uuid := pg_temp.player('fall-author'); taker uuid := pg_temp.player('fall-taker');
  own_author uuid := pg_temp.player('fall-own'); own_taker uuid;
  p uuid := pg_temp.say(author, t); q uuid := pg_temp.say(own_author, t);
  v uuid; inf uuid;
begin
  insert into card_ledger (account, card, kind, price) values (pg_temp.owner(taker), 't-ra-fall', 'bought', 0), (pg_temp.owner(own_author), 't-ra-fall', 'bought', 0);
  perform play_card(pg_temp.owner(taker), 't-ra-fall', taker, p, '{}', 0, '', 'post');
  v := pg_temp.visit(p);
  perform file_visit(v, 'Filed.');
  inf := (select i.id from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text);
  if inf is null or (select i.payload ->> 'character' from acts i where i.id = inf) is distinct from taker::text then raise exception 'the fall did not land on the taker'; end if;
  if pg_temp.rulings(taker) is distinct from array['warning:' || inf] then raise exception 'the taker is warned: %', pg_temp.rulings(taker); end if;
  if pg_temp.rulings(author) is distinct from array['fallTaken:' || inf] then raise exception 'the author hears fallTaken about the infraction, and no warning: %', pg_temp.rulings(author); end if;

  -- The author's own other mask takes the fall: one account, so only the taker's warning.
  own_taker := tests.character(pg_temp.owner(own_author), 'Ra fall-own-mask');
  perform play_card(pg_temp.owner(own_author), 't-ra-fall', own_taker, q, '{}', 0, '', 'post');
  v := pg_temp.visit(q);
  perform file_visit(v, 'Filed.');
  inf := (select i.id from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text);
  if (select i.payload ->> 'character' from acts i where i.id = inf) is distinct from own_taker::text then raise exception 'the own mask did not take the fall'; end if;
  if (select array_agg(x.sub || ':' || x.character order by x.sub) from alerts x where x.account = pg_temp.owner(own_author) and x.kind = 'ruling') is distinct from array['warning:' || own_taker] then
    raise exception 'one account that took its own fall hears the warning alone: %', (select array_agg(x.sub || ':' || x.character) from alerts x where x.account = pg_temp.owner(own_author) and x.kind = 'ruling');
  end if;
end $$;

-- ---- 3. A visit that ends without a filing writes nothing to the author ----
do $$
declare
  t uuid := tests.thread('Ra silent');
  a uuid := pg_temp.player('silent');
  p1 uuid := pg_temp.say(a, t); p2 uuid := pg_temp.say(a, t);
begin
  perform end_visit(pg_temp.visit(p1), 'intercepted', null, 'Talked down.');
  perform end_visit(pg_temp.visit(p2), 'dropped', null, 'Dropped.');
  if pg_temp.rulings(a) is distinct from '{}' then raise exception 'a visit that ended without a filing alerted the author: %', pg_temp.rulings(a); end if;
  if exists (select 1 from alerts x where x.account = pg_temp.owner(a)) then raise exception 'something alerted the author of a silent visit'; end if;
end $$;

-- ---- 4. Each appeal verdict: one appealAnswered to the appellant, about the ruling ----
do $$
declare
  t uuid := tests.thread('Ra appeals');
  c uuid; hit jsonb; ap uuid; closed jsonb; verdict text; ruling uuid; ps uuid[];
begin
  foreach verdict in array array['overturned', 'upheld', 'reduced', 'increased'] loop
    c := pg_temp.player('ap-' || verdict);
    hit := infract(c, 'moderate', pg_temp.say(c, t), 'ra-m1');
    ap := pg_temp.appeal(c, (hit ->> 'infraction')::uuid);
    closed := close_appeal(ap, verdict, null, 'ra-m1');
    ruling := (closed ->> 'ruling_act')::uuid;
    if ruling is null then raise exception '% did not rule: %', verdict, closed; end if;
    if pg_temp.rulings(c) is distinct from array['appealAnswered:' || ruling] then raise exception '% writes one appealAnswered about the ruling Act, and no warning: %', verdict, pg_temp.rulings(c); end if;
    if (select x.character from alerts x where x.account = pg_temp.owner(c) and x.kind = 'ruling') is distinct from c then raise exception 'the alert is the appellant character''s'; end if;
    -- A retried close writes no second alert.
    perform close_appeal(ap, verdict, null, 'ra-m1');
    if cardinality(pg_temp.rulings(c)) is distinct from 1 then raise exception 'a retried close wrote another alert: %', pg_temp.rulings(c); end if;
  end loop;

  -- An increase that lays a ban: one appealAnswered, never the ban.
  c := pg_temp.player('ap-ban');
  hit := infract(c, 'severe', pg_temp.say(c, t), 'ra-m1');
  ap := pg_temp.appeal(c, (hit ->> 'infraction')::uuid);
  closed := close_appeal(ap, 'increased', null, 'ra-m1');
  if closed -> 'ban' is null or closed ->> 'ban' is null then raise exception 'the increase did not lay a ban: %', closed; end if;
  if pg_temp.rulings(c) is distinct from array['appealAnswered:' || (closed ->> 'ruling_act')] then raise exception 'an increase that bans writes appealAnswered alone: %', pg_temp.rulings(c); end if;
end $$;

-- ---- 5. An appeal that expires unheard or is refunded: one appealRefunded about the appeal, once per refund ----
do $$
declare
  t uuid := tests.thread('Ra appeal refunds');
  c uuid := pg_temp.player('ap-exp');
  hit jsonb; ap uuid; closed jsonb; d uuid := pg_temp.player('ap-fail'); dh jsonb; dap uuid;
  p1 uuid; p2 uuid; p3 uuid;
begin
  p1 := pg_temp.say(c, t); p2 := pg_temp.say(c, t); p3 := pg_temp.say(c, t);
  hit := infract(c, 'minor', p1, 'ra-m1');
  ap := pg_temp.appeal(c, (hit ->> 'infraction')::uuid);
  -- The bar fills and bans while the appeal waits: the minor infraction no longer counts, so the appeal is refunded unheard.
  perform infract(c, 'severe', p2, 'ra-m1');
  perform infract(c, 'moderate', p3, 'ra-m1');
  closed := close_appeal(ap, 'increased', null, 'ra-m1');
  if (closed ->> 'expired')::boolean is distinct from true then raise exception 'the appeal did not expire: %', closed; end if;
  if pg_temp.rulings(c) is distinct from array['appealRefunded:' || ap] then raise exception 'an expired appeal writes one appealRefunded about the appeal, written once: %', pg_temp.rulings(c); end if;
  -- A retried close, and a refund after it, write nothing more.
  perform close_appeal(ap, 'upheld', null, 'ra-m1');
  perform refund_appeal(ap, 'failed');
  if cardinality(pg_temp.rulings(c)) is distinct from 1 then raise exception 'a refund of a refunded appeal wrote again: %', pg_temp.rulings(c); end if;

  -- A refund of an unheard appeal (a failed judgment): one alert, and a second call writes none.
  dh := infract(d, 'moderate', pg_temp.say(d, t), 'ra-m1');
  dap := pg_temp.appeal(d, (dh ->> 'infraction')::uuid);
  if (refund_appeal(dap, 'failed') ->> 'refunded')::boolean is distinct from true then raise exception 'the refund did not refund'; end if;
  perform refund_appeal(dap, 'failed');
  if pg_temp.rulings(d) is distinct from array['appealRefunded:' || dap] then raise exception 'refund_appeal writes one appealRefunded, once: %', pg_temp.rulings(d); end if;
end $$;

-- ---- 6. Reports: judged and refunded ----
do $$
declare
  t uuid := tests.thread('Ra reports');
  victim uuid := pg_temp.player('rp-victim');
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; closed jsonb; c uuid; k text; rep uuid; v uuid;
begin
  foreach k in array array['visit', 'dismissed', 'backfire'] loop
    c := pg_temp.player('rp-' || k);
    perform pg_temp.say(c, t);
    rep := pg_temp.report(c, pg_temp.say(victim, t));
    closed := close_report(rep, k, null, null, 'ra-m1');
    v := (closed ->> 'verdict_act')::uuid;
    if v is null then raise exception 'the % verdict did not close: %', k, closed; end if;
    if pg_temp.rulings(c) is distinct from array['reportJudged:' || v] then raise exception 'a % report writes one reportJudged about the verdict: %', k, pg_temp.rulings(c); end if;
    perform close_report(rep, k, null, null, 'ra-m1');
    perform refund_report(rep);
    if cardinality(pg_temp.rulings(c)) is distinct from 1 then raise exception 'a retried % close or a refund after the verdict wrote again: %', k, pg_temp.rulings(c); end if;
  end loop;

  -- A refunded, unheard report.
  c := pg_temp.player('rp-refund');
  rep := pg_temp.report(c, pg_temp.say(victim, t));
  if (refund_report(rep) ->> 'refunded')::boolean is distinct from true then raise exception 'the report was not refunded'; end if;
  perform refund_report(rep);
  if pg_temp.rulings(c) is distinct from array['reportRefunded:' || rep] then raise exception 'a refunded report writes one reportRefunded about the report, once: %', pg_temp.rulings(c); end if;
  if (select x.character from alerts x where x.account = pg_temp.owner(c) and x.kind = 'ruling') is distinct from c then raise exception 'the alert is the reporter character''s'; end if;
end $$;

-- ---- 7. Staff have no account, and cannot appeal or report: the guards refuse a staff character's appeal or report, so no ruling alert can be owed to one (write_alert skips a character with no owner) ----
do $$
declare
  t uuid := tests.thread('Ra staff');
  c uuid := pg_temp.player('staff-target');
  staff uuid := (select id from characters where staff = 'ra-m1');
  p uuid := pg_temp.say(c, t);
  hit jsonb := infract(c, 'minor', pg_temp.say(c, t), 'ra-m1');
  before bigint := (select count(*) from alerts);
  said text;
begin
  perform set_config('kayfabb.appeal_writer', 'on', true);
  perform set_config('kayfabb.report_writer', 'on', true);
  said := pg_temp.refusal(format($q$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'appeal', %L, %L, '{}')$q$, staff, t, hit ->> 'infraction'));
  if said is distinct from 'an appeal is a player''s character''s Act' then raise exception 'a staff appeal was not refused: %', said; end if;
  said := pg_temp.refusal(format($q$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'report', %L, %L, '{}')$q$, staff, t, p));
  if said is distinct from 'a report is a player''s character''s Act' then raise exception 'a staff report was not refused: %', said; end if;
  if (select count(*) from alerts) is distinct from before then raise exception 'a refused staff appeal or report wrote an alert row'; end if;
end $$;

-- Task 4 (design section 2): a Boss's moves that land on yours.
--
-- 1. A landed conferGroup writes one ruling/grouped alert to the character's account, about the landed Act.
-- 2. A landed moveThread writes one ruling/threadMoved alert to the thread starter's account, about the landed Act.
-- 3. A landed mergeBoard writes none.
-- 4. A moveThread whose landing is refused writes none.
-- 5. A thread started by staff gets none (no account).

insert into move_kinds (key, structural, shapes_board, lasting, offices, derived) values
  ('conferGroup', false, false, false, '{boss,mod}', '{groupName}'),
  ('moveThread', false, false, true, '{boss}', '{}'),
  ('mergeBoard', true, true, true, '{boss}', '{}') on conflict (key) do nothing;
insert into group_kinds (key, name, color, source, tone) values ('raTrial', 'Ra Trial', '#d2691e', 'conferred', 'punishment') on conflict (key) do nothing;

create function pg_temp.mv_queue(kind text, params jsonb, lasting boolean, shift interval default interval '0') returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
  at timestamptz := now() - interval '1 minute' + shift;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'ra-boss', kind, params, null, 'because', at, case when lasting then at else now() + interval '3 days' end, kind = 'mergeBoard') returning id into q;
  return q;
end $$;

create function pg_temp.mv_land(q bigint) returns uuid language plpgsql as $$
begin
  perform system_tick();
  return (select r.landed_act from queued_moves r where r.id = q);
end $$;

do $$
declare
  t uuid := tests.thread('Ra moved');
  starter uuid := pg_temp.player('mv-starter');
  member uuid := pg_temp.player('mv-member');
  other uuid := pg_temp.player('mv-other');
  origin uuid;
  dest uuid; src uuid; gone uuid; into_b uuid;
  q bigint;
  landed uuid;
  before bigint;
  t2 uuid; t3 uuid;
begin
  insert into boards (slug, name) values ('ra-dest', 'Ra Dest') returning id into dest;
  origin := pg_temp.say(starter, t);
  update threads set origin_act_id = origin where id = t;

  -- 1. conferGroup
  q := pg_temp.mv_queue('conferGroup', jsonb_build_object('character', member, 'group', 'raTrial'), false);
  landed := pg_temp.mv_land(q);
  if landed is null then raise exception 'the conferGroup did not land: %', (select r.failure from queued_moves r where r.id = q); end if;
  if pg_temp.rulings(member) is distinct from array['grouped:' || landed] then raise exception 'a landed conferGroup writes one grouped about its Act: %', pg_temp.rulings(member); end if;
  if (select x.character from alerts x where x.account = pg_temp.owner(member) and x.sub = 'grouped') is distinct from member then raise exception 'the grouped alert is the member character''s'; end if;
  if pg_temp.rulings(starter) is distinct from '{}'::text[] then raise exception 'the starter got a ruling from a conferGroup: %', pg_temp.rulings(starter); end if;

  -- 2. moveThread
  q := pg_temp.mv_queue('moveThread', jsonb_build_object('thread', t, 'board', dest), true);
  landed := pg_temp.mv_land(q);
  if landed is null then raise exception 'the moveThread did not land: %', (select r.failure from queued_moves r where r.id = q); end if;
  if pg_temp.rulings(starter) is distinct from array['threadMoved:' || landed] then raise exception 'a landed moveThread writes one threadMoved about its Act: %', pg_temp.rulings(starter); end if;
  if (select x.character from alerts x where x.account = pg_temp.owner(starter) and x.sub = 'threadMoved') is distinct from starter then raise exception 'the threadMoved alert is the starter character''s'; end if;
  if pg_temp.rulings(member) is distinct from array['grouped:' || (select q2.landed_act from queued_moves q2 where q2.kind = 'conferGroup' order by q2.id desc limit 1)] then raise exception 'the move of a thread alerted the member: %', pg_temp.rulings(member); end if;

  -- 3. mergeBoard
  insert into boards (slug, name) values ('ra-src', 'Ra Src') returning id into src;
  insert into boards (slug, name) values ('ra-into', 'Ra Into') returning id into into_b;
  before := (select count(*) from alerts);
  q := pg_temp.mv_queue('mergeBoard', jsonb_build_object('board', src, 'into', into_b), true);
  landed := pg_temp.mv_land(q);
  if landed is null then raise exception 'the mergeBoard did not land: %', (select r.failure from queued_moves r where r.id = q); end if;
  if (select count(*) from alerts) is distinct from before then raise exception 'a mergeBoard wrote an alert row'; end if;

  -- 4. A moveThread refused at its landing (its board is closed by then) writes nothing.
  t2 := tests.thread('Ra refused');
  origin := pg_temp.say(other, t2);
  update threads set origin_act_id = origin where id = t2;
  insert into boards (slug, name) values ('ra-gone', 'Ra Gone') returning id into gone;
  q := pg_temp.mv_queue('moveThread', jsonb_build_object('thread', t2, 'board', gone), true);
  -- The board it names is merged into another a minute sooner in the same tick, so it is closed when this move meets it.
  perform pg_temp.mv_queue('mergeBoard', jsonb_build_object('board', gone, 'into', into_b), true, interval '-1 minute');
  before := (select count(*) from alerts);
  landed := pg_temp.mv_land(q);
  if landed is not null or (select r.refused_at from queued_moves r where r.id = q) is null then raise exception 'the move to a closed board was not refused'; end if;
  if (select count(*) from alerts) is distinct from before or pg_temp.rulings(other) is distinct from '{}'::text[] then raise exception 'a refused moveThread wrote an alert'; end if;

  -- 5. A staff starter has no account: no alert, and the move lands.
  t3 := tests.thread('Ra staffed');
  origin := (write_staff_act('ra-m1', 'post', t3, null, jsonb_build_object('body', 'Staff began this.')) ->> 'id')::uuid;
  update threads set origin_act_id = origin where id = t3;
  before := (select count(*) from alerts);
  q := pg_temp.mv_queue('moveThread', jsonb_build_object('thread', t3, 'board', dest), true);
  landed := pg_temp.mv_land(q);
  if landed is null then raise exception 'the move of a staff thread did not land: %', (select r.failure from queued_moves r where r.id = q); end if;
  if (select count(*) from alerts) is distinct from before then raise exception 'a staff starter was alerted'; end if;
end $$;

-- Task 5 (section 4): an admin's in-game acts on yours.
--
-- 1. reverse_card tells the target beside the caster: a post's author at post reach, the character at character reach, the thread's starter at thread reach, `cardEnded/onYours` about the card_end.
-- 2. Where the caster and the target are one player's, the caster's alert alone; at board reach, the caster's alone.
-- 3. reverse_award writes ruling/trophyReversed to the award's character's account, about no Act.
-- 4. close_poll_as_admin writes ruling/pollClosed to the poll post's author, about the close Act.
-- 5. grant_gear writes ruling/gearGiven to the character's account, about no Act.

do $$
declare
  boss uuid := tests.account('ra-admin');
  caster uuid := pg_temp.player('ad-caster');
  author uuid := pg_temp.player('ad-author');
  other uuid := pg_temp.player('ad-other');
  twin uuid := tests.character(pg_temp.owner(caster), 'Ra ad-twin');
  t uuid;
  p uuid; own_post uuid; started jsonb;
  play uuid; got jsonb; ended uuid;
  trophy text; award uuid; poll uuid; closed jsonb; n integer;
begin
  insert into admins (account) values (boss);
  insert into gear_kinds (key, rarity) values ('ra-hat', 'common');
  -- The thread is started by `other` through the real path, so its starter is the character of its first Act.
  perform tests.become(pg_temp.owner(other));
  started := start_thread('general', other, 'Ra admin acts', 'Ra starter.');
  perform tests.unbecome();
  t := (started -> 'thread' ->> 'id')::uuid;
  p := tests.post(author, t, 'Ra target post.');
  own_post := tests.post(twin, t, 'Ra twin post.');

  -- 1. A card on a post: the caster's alert, and the author's onYours about the same card_end.
  play := tests.act(caster, 'card', t, '{"card": "splat"}', p);
  perform tests.become(boss);
  got := reverse_card(play);
  perform tests.unbecome();
  ended := (got ->> 'id')::uuid;
  if (select count(*) from alerts a where a.account = pg_temp.owner(caster) and a.kind = 'cardEnded' and a.sub is null and a.act = ended and a.character = caster) is distinct from 1 then raise exception 'the caster was not told of the end of a card on a post'; end if;
  if (select count(*) from alerts a where a.account = pg_temp.owner(author) and a.kind = 'cardEnded' and a.sub = 'onYours' and a.act = ended and a.character = author) is distinct from 1 then raise exception 'the post author was not told of an admin ending a card on a post'; end if;
  if (select count(*) from alerts a where a.kind = 'cardEnded' and a.act = ended) is distinct from 2 then raise exception 'an admin''s end of a card on a post wrote % alerts', (select count(*) from alerts a where a.kind = 'cardEnded' and a.act = ended); end if;

  -- 2. Caster and target one player's: the caster's alert alone.
  play := tests.act(caster, 'card', t, '{"card": "splat"}', own_post);
  perform tests.become(boss);
  got := reverse_card(play);
  perform tests.unbecome();
  ended := (got ->> 'id')::uuid;
  if (select array_agg(a.account || ':' || coalesce(a.sub, 'null')) from alerts a where a.kind = 'cardEnded' and a.act = ended) is distinct from array[pg_temp.owner(caster)::text || ':null'] then
    raise exception 'a card on one''s own other mask wrote: %', (select array_agg(a.account || ':' || coalesce(a.sub, 'null')) from alerts a where a.kind = 'cardEnded' and a.act = ended);
  end if;

  -- 3. Character reach: the character's player.
  play := tests.act(caster, 'card', t, '{"card": "selfie", "reach": "character"}', p);
  insert into play_reach (play, reach, character, ends_at) values (play, 'character', other, now() + interval '1 day');
  perform tests.become(boss);
  got := reverse_card(play);
  perform tests.unbecome();
  ended := (got ->> 'id')::uuid;
  if (select count(*) from alerts a where a.account = pg_temp.owner(other) and a.kind = 'cardEnded' and a.sub = 'onYours' and a.act = ended and a.character = other) is distinct from 1 then raise exception 'the character at character reach was not told'; end if;
  if (select count(*) from alerts a where a.kind = 'cardEnded' and a.act = ended) is distinct from 2 then raise exception 'an end at character reach wrote % alerts', (select count(*) from alerts a where a.kind = 'cardEnded' and a.act = ended); end if;

  -- 4. Thread reach: the thread's starter.
  play := tests.act(caster, 'card', t, '{"card": "marquee", "reach": "thread"}', p);
  insert into play_reach (play, reach, thread, ends_at) values (play, 'thread', t, now() + interval '1 day');
  perform tests.become(boss);
  got := reverse_card(play);
  perform tests.unbecome();
  ended := (got ->> 'id')::uuid;
  if (select count(*) from alerts a where a.account = pg_temp.owner(other) and a.kind = 'cardEnded' and a.sub = 'onYours' and a.act = ended and a.character = other) is distinct from 1 then raise exception 'the thread''s starter was not told'; end if;
  if (select count(*) from alerts a where a.kind = 'cardEnded' and a.act = ended) is distinct from 2 then raise exception 'an end at thread reach wrote % alerts', (select count(*) from alerts a where a.kind = 'cardEnded' and a.act = ended); end if;

  -- 5. Board reach: the caster's alert alone.
  play := tests.act(caster, 'card', t, '{"card": "quake", "reach": "board"}', null);
  insert into play_reach (play, reach, board, ends_at) values (play, 'board', (select board from threads where id = t), now() + interval '1 day');
  perform tests.become(boss);
  got := reverse_card(play);
  perform tests.unbecome();
  ended := (got ->> 'id')::uuid;
  if (select array_agg(a.account || ':' || coalesce(a.sub, 'null')) from alerts a where a.kind = 'cardEnded' and a.act = ended) is distinct from array[pg_temp.owner(caster)::text || ':null'] then
    raise exception 'a card at board reach wrote: %', (select array_agg(a.account || ':' || coalesce(a.sub, 'null')) from alerts a where a.kind = 'cardEnded' and a.act = ended);
  end if;

  -- 6. reverse_award
  perform tests.become(boss);
  trophy := make_trophy('Ra Cup') ->> 'trophy';
  award := (award_trophy(trophy, author, 'Well done.') ->> 'award')::uuid;
  perform tests.unbecome();
  n := (select count(*) from alerts a where a.kind = 'ruling');
  perform tests.become(boss);
  perform reverse_award(award);
  perform tests.unbecome();
  if (select count(*) from alerts a where a.kind = 'ruling') is distinct from n + 1 then raise exception 'reverse_award wrote % ruling alerts', (select count(*) from alerts a where a.kind = 'ruling') - n; end if;
  if (select count(*) from alerts a where a.account = pg_temp.owner(author) and a.kind = 'ruling' and a.sub = 'trophyReversed' and a.act is null and a.character = author) is distinct from 1 then raise exception 'the award''s character was not told its trophy was taken back'; end if;

  -- 7. close_poll_as_admin
  poll := tests.act(author, 'poll', t, jsonb_build_object('question', 'Best kart?', 'options', jsonb_build_array('Pipe Frame', 'Badwagon'), 'pick', 1, 'secret', false, 'closes_at', now() + interval '1 day'), p);
  perform tests.become(boss);
  closed := close_poll_as_admin(poll);
  perform tests.unbecome();
  if (select count(*) from alerts a where a.account = pg_temp.owner(author) and a.kind = 'ruling' and a.sub = 'pollClosed' and a.act = (closed -> 'act' ->> 'id')::uuid and a.character = author) is distinct from 1 then raise exception 'the poll''s author was not told an admin closed it: %', closed; end if;
  if (select count(*) from alerts a where a.sub = 'pollClosed') is distinct from 1 then raise exception 'closing a poll wrote more than one alert'; end if;

  -- 8. grant_gear
  perform tests.become(boss);
  perform grant_gear(other, 'ra-hat', 2);
  perform tests.unbecome();
  if (select count(*) from alerts a where a.sub = 'gearGiven') is distinct from 1 then raise exception 'a grant of two copies wrote % alerts', (select count(*) from alerts a where a.sub = 'gearGiven'); end if;
  if (select count(*) from alerts a where a.account = pg_temp.owner(other) and a.kind = 'ruling' and a.sub = 'gearGiven' and a.act is null and a.character = other) is distinct from 1 then raise exception 'the character given gear was not told'; end if;
end $$;
