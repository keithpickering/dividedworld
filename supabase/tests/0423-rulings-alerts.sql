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
  if (select count(*) from alerts where account = ann and kind in ('gift', 'conduct')) is distinct from 2 then raise exception 'a gift and a conduct alert are not both stored'; end if;
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
  dest uuid; src uuid; gone uuid; into_b uuid;
  q bigint;
  landed uuid;
  before bigint;
  t2 uuid; t3 uuid;
begin
  insert into boards (slug, name) values ('ra-dest', 'Ra Dest') returning id into dest;
  perform pg_temp.say(starter, t);

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
  perform pg_temp.say(other, t2);
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
  perform write_staff_act('ra-m1', 'post', t3, null, jsonb_build_object('body', 'Staff began this.'));
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
  n := (select count(*) from alerts a where a.sub = 'pollClosed');
  poll := tests.act(author, 'poll', t, jsonb_build_object('question', 'Best kart?', 'options', jsonb_build_array('Pipe Frame', 'Badwagon'), 'pick', 1, 'secret', false, 'closes_at', now() + interval '1 day'), p);
  perform tests.become(boss);
  closed := close_poll_as_admin(poll);
  perform tests.unbecome();
  if (select count(*) from alerts a where a.account = pg_temp.owner(author) and a.kind = 'ruling' and a.sub = 'pollClosed' and a.act = (closed -> 'act' ->> 'id')::uuid and a.character = author) is distinct from 1 then raise exception 'the poll''s author was not told an admin closed it: %', closed; end if;
  if (select count(*) from alerts a where a.sub = 'pollClosed') - n is distinct from 1 then raise exception 'closing a poll wrote more than one alert'; end if;

  -- 8. grant_gear (counted as the change across the grant, as the poll's close is: the suite's database may hold committed alerts of earlier files)
  n := (select count(*) from alerts a where a.sub = 'gearGiven');
  perform tests.become(boss);
  perform grant_gear(other, 'ra-hat', 2);
  perform tests.unbecome();
  if (select count(*) from alerts a where a.sub = 'gearGiven') - n is distinct from 1 then raise exception 'a grant of two copies wrote % alerts', (select count(*) from alerts a where a.sub = 'gearGiven') - n; end if;
  if (select count(*) from alerts a where a.account = pg_temp.owner(other) and a.kind = 'ruling' and a.sub = 'gearGiven' and a.act is null and a.character = other) is distinct from 1 then raise exception 'the character given gear was not told'; end if;
end $$;

-- Task 5, review fix: reverse_card's lockout target. An admin ends a lockedOut spring: the locked character's player is told beside the setter's caster alert; one player's both, the caster's alone.
do $$
declare
  boss uuid := tests.account('ra-lk-admin');
  setter uuid := pg_temp.player('lk-setter');
  locked uuid := pg_temp.player('lk-locked');
  twin uuid := tests.character(pg_temp.owner(setter), 'Ra lk-twin');
  started jsonb; t uuid; p uuid; sset uuid; spring uuid; got jsonb; ended uuid;
begin
  insert into admins (account) values (boss);
  perform tests.become(pg_temp.owner(locked));
  started := start_thread('general', locked, 'Ra lockout', 'Ra lk starter.');
  perform tests.unbecome();
  t := (started -> 'thread' ->> 'id')::uuid;
  p := tests.post(setter, t, 'Ra lk setter post.');

  -- (a) The locked character belongs to someone else: the setter's caster alert and the locked player's onYours, about the one card_end.
  sset := tests.act(setter, 'set', t, '{}', p);
  spring := tests.act(setter, 'spring', t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', sset::text, 'locks', locked::text, 'until', (now() + interval '1 day')::text), p);
  perform tests.become(boss);
  got := reverse_card(spring);
  perform tests.unbecome();
  ended := (got ->> 'id')::uuid;
  if (select count(*) from alerts a where a.account = pg_temp.owner(setter) and a.kind = 'cardEnded' and a.sub is null and a.act = ended and a.character = setter) is distinct from 1 then raise exception 'the setter was not told of the end of a lockout'; end if;
  if (select count(*) from alerts a where a.account = pg_temp.owner(locked) and a.kind = 'cardEnded' and a.sub = 'onYours' and a.act = ended and a.character = locked) is distinct from 1 then raise exception 'the locked character was not told an admin ended its lockout'; end if;
  if (select count(*) from alerts a where a.kind = 'cardEnded' and a.act = ended) is distinct from 2 then raise exception 'an admin''s end of a lockout wrote % alerts', (select count(*) from alerts a where a.kind = 'cardEnded' and a.act = ended); end if;

  -- (b) Setter and locked character one player's: the caster's alert alone.
  sset := tests.act(setter, 'set', t, '{}', p);
  spring := tests.act(setter, 'spring', t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', sset::text, 'locks', twin::text, 'until', (now() + interval '1 day')::text), p);
  perform tests.become(boss);
  got := reverse_card(spring);
  perform tests.unbecome();
  ended := (got ->> 'id')::uuid;
  if (select array_agg(a.account || ':' || coalesce(a.sub, 'null')) from alerts a where a.kind = 'cardEnded' and a.act = ended) is distinct from array[pg_temp.owner(setter)::text || ':null'] then
    raise exception 'a lockout on one''s own other mask wrote: %', (select array_agg(a.account || ':' || coalesce(a.sub, 'null')) from alerts a where a.kind = 'cardEnded' and a.act = ended);
  end if;
end $$;


-- Task 6 (section 5): real moderation on a post.
--
-- 1. decide with hide, hideUntilEdited, unhide or approve writes one conduct alert with that sub to the post author's account, about the version Act.
-- 2. A nudge and a suspend write none.
-- 3. The mail queue's rows are the same as before: the alerts add no mail, and the outcomes that sent mail still send exactly one.

do $$
declare
  boss uuid := tests.account('ra-cd-admin');
  author uuid := pg_temp.player('cd-author');
  t uuid; p uuid; started jsonb;
  o text; n bigint; m bigint; mails bigint;
  want_mail jsonb := '{"hide": 1, "hideUntilEdited": 1, "unhide": 0, "approve": 0, "nudge": 1, "suspend": 1}';
begin
  insert into admins (account) values (boss) on conflict do nothing;
  perform tests.become(pg_temp.owner(author));
  started := start_thread('general', author, 'Ra conduct', 'Ra words.');
  perform tests.unbecome();
  p := (started -> 'act' ->> 'id')::uuid;
  if p is null then raise exception 'no post to decide on: %', started; end if;

  foreach o in array array['hide', 'hideUntilEdited', 'unhide', 'approve', 'nudge', 'suspend'] loop
    n := (select count(*) from alerts a where a.kind = 'conduct');
    mails := (select count(*) from mail_outbox);
    perform tests.become(boss);
    perform decide(null, p, o, case when o = 'suspend' then now() + interval '2 days' end, 'a note');
    perform tests.unbecome();
    m := (select count(*) from alerts a where a.kind = 'conduct') - n;
    if o in ('nudge', 'suspend') then
      if m is distinct from 0 then raise exception 'decide % wrote % conduct alerts', o, m; end if;
    else
      if m is distinct from 1 then raise exception 'decide % wrote % conduct alerts, not one', o, m; end if;
      if (select count(*) from alerts a where a.kind = 'conduct' and a.sub = o and a.act = p and a.character = author and a.account = pg_temp.owner(author)) is distinct from 1 then
        raise exception 'decide % did not tell the post''s author about the version', o;
      end if;
    end if;
    if (select count(*) from mail_outbox) - mails is distinct from (want_mail ->> o)::bigint then
      raise exception 'decide % queued % mail rows, not %', o, (select count(*) from mail_outbox) - mails, want_mail ->> o;
    end if;
  end loop;
end $$;

-- Task 7 (section 6): gifts and drawings.
--
-- 1. A gift writes one gift alert to the drive post's author's account, about the donation Act; a gift between one player's two masks writes none.
-- 2. A draw on a wall writes one cardOnYours/drew alert to the wall post's author, about the draw Act; a draw by the author's other mask writes none; a staff draw writes one.
-- 3. A wash writes none.
-- 4. A refused gift or draw writes none.
-- 5. The answers do not differ in shape with whether an alert was written (write_alert returns nothing the caller uses).

insert into card_kinds (key, name, alignment, rarity, play, stack, drive) values
  ('t-ra-drive', 'Test Alert Drive', 'sweet', 'uncommon', 'cast', 3, '{"lasts": {"unit": "hour", "count": 1}, "gifts": ["raGift"], "overhead": "raOver"}');
insert into card_kinds (key, name, alignment, rarity, play, reaches, stack, surface) values
  ('t-ra-wall', 'Test Alert Wall', 'pepperoni', 'rare', 'cast', '{post}', 1, true);
update settings set value = value || '{"raGift": 10, "raOver": 25}'::jsonb where key = 'economy';

create function pg_temp.cells(first integer, n integer) returns bit(10000) language sql as $$
  select (repeat('0', first) || repeat('1', n) || repeat('0', 10000 - first - n))::bit(10000)
$$;

do $$
declare
  author uuid := pg_temp.player('gw-author');
  author2 uuid := tests.character(pg_temp.owner(author), 'Ra gw author two');
  donor uuid := pg_temp.player('gw-donor');
  caster uuid := pg_temp.player('gw-caster');
  t uuid; p uuid; drive uuid; wall uuid; played jsonb;
  said jsonb; said2 jsonb; refused text; gifted uuid; drew uuid; washed uuid;
  persona uuid;
  n bigint;
  payload jsonb := '{"strokes": [{"width": 0.01, "points": [[0.1, 0.1]]}]}';
begin
  perform tests.become(pg_temp.owner(author));
  t := ((start_thread('general', author, 'Ra gifts two', 'Ra gift words two.')) -> 'act' ->> 'thread')::uuid;
  perform tests.unbecome();
  p := (select a.id from acts a where a.thread = t and a.kind = 'post' order by a.created_at limit 1);
  insert into card_ledger (account, card, kind, price) select pg_temp.owner(caster), k, 'bought', 0 from unnest(array['t-ra-drive', 't-ra-wall']) k, generate_series(1, 3);
  perform tests.become_service();
  played := play_card(pg_temp.owner(caster), 't-ra-drive', caster, p, '{}', 0, 'Please give.');
  drive := (played ->> 'id')::uuid;
  played := play_card(pg_temp.owner(caster), 't-ra-wall', caster, p, '{}', 0, '');
  wall := (played ->> 'id')::uuid;
  perform tests.unbecome();
  if drive is null or wall is null or not exists (select 1 from surfaces s where s.play = wall) then raise exception 'no drive or wall to act on: % %', drive, wall; end if;
  insert into wallets (account, balance) values (pg_temp.owner(donor), 400), (pg_temp.owner(author), 400)
    on conflict (account) do update set balance = excluded.balance;

  -- 1. A gift: one gift alert to the author's account, about the donation Act. Counted as the change across the gift: a race test commits its gifts
  -- (0161-drives.sql, through dblink), so the suite's database holds other gifts' alerts before this file runs.
  n := (select count(*) from alerts a where a.kind = 'gift' and a.character is not null);
  perform tests.become_service();
  said := donate(pg_temp.owner(donor), donor, drive, 10);
  perform tests.unbecome();
  gifted := (said #>> '{gift,id}')::uuid;
  if (select count(*) from alerts a where a.kind = 'gift' and a.character is not null) - n is distinct from 1
     or (select count(*) from alerts a where a.kind = 'gift' and a.sub is null and a.act = gifted and a.character = author and a.account = pg_temp.owner(author)) is distinct from 1 then
    raise exception 'a gift did not write one gift alert to the author about the donation: %', (select jsonb_agg(to_jsonb(a)) from alerts a where a.kind = 'gift' and a.character is not null);
  end if;

  -- A gift between one player's two masks writes none.
  n := (select count(*) from alerts a where a.kind = 'gift' and a.character is not null);
  perform tests.become_service();
  said2 := donate(pg_temp.owner(author), author2, drive, 10);
  perform tests.unbecome();
  if (select count(*) from alerts a where a.kind = 'gift' and a.character is not null) is distinct from n then raise exception 'a gift between one player''s masks wrote an alert'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(said) k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(said2) k)
     or (select array_agg(k order by k) from jsonb_object_keys(said -> 'gift') k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(said2 -> 'gift') k) then
    raise exception 'the answer of a gift differs with whether an alert was written: % / %', said, said2;
  end if;

  -- 4a. A refused gift writes none.
  n := (select count(*) from alerts a where a.kind = 'gift' and a.character is not null);
  perform tests.become_service();
  refused := pg_temp.refusal(format('select donate(%L, %L, %L, 13)', pg_temp.owner(donor), donor, drive));
  perform tests.unbecome();
  if refused is null then raise exception 'a gift of an amount the card does not offer was not refused'; end if;
  if (select count(*) from alerts a where a.kind = 'gift' and a.character is not null) is distinct from n then raise exception 'a refused gift wrote an alert'; end if;

  -- 2. A draw by another player: one cardOnYours/drew alert to the author, about the draw Act (counted as the change across the draw, as the gift is).
  n := (select count(*) from alerts a where a.kind = 'cardOnYours' and a.sub = 'drew');
  perform tests.become_service();
  said := draw_on_surface(pg_temp.owner(donor), donor, wall, payload, pg_temp.cells(0, 100), 4000);
  perform tests.unbecome();
  drew := (said ->> 'id')::uuid;
  if (select count(*) from alerts a where a.kind = 'cardOnYours' and a.sub = 'drew') - n is distinct from 1
     or (select count(*) from alerts a where a.kind = 'cardOnYours' and a.sub = 'drew' and a.act = drew and a.character = author and a.account = pg_temp.owner(author)) is distinct from 1 then
    raise exception 'a draw did not write one drew alert to the wall post''s author about the draw: %', (select jsonb_agg(to_jsonb(a)) from alerts a where a.kind = 'cardOnYours' and a.sub = 'drew');
  end if;

  -- By the author's other mask: none.
  n := (select count(*) from alerts a where a.sub = 'drew');
  perform tests.become_service();
  said2 := draw_on_surface(pg_temp.owner(author), author2, wall, payload, pg_temp.cells(200, 100), 4000);
  perform tests.unbecome();
  if (select count(*) from alerts a where a.sub = 'drew') is distinct from n then raise exception 'a draw by the author''s other mask wrote an alert'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(said) k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(said2) k) then
    raise exception 'the answer of a draw differs with whether an alert was written: % / %', said, said2;
  end if;

  -- A staff draw (a persona's): a null owner, so the author is told.
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into characters (name, staff, staff_kind, debuted_at) values ('Ra Gw Persona', 'ra-gw-persona', 'persona', now()) returning id into persona;
  perform set_config('kayfabb.staff_writer', '', true);
  n := (select count(*) from alerts a where a.sub = 'drew');
  perform tests.become_service();
  said := staff_draw_on_surface('ra-gw-persona', wall, payload, pg_temp.cells(400, 100), 4000);
  perform tests.unbecome();
  if (select count(*) from alerts a where a.sub = 'drew') - n is distinct from 1
     or (select count(*) from alerts a where a.sub = 'drew' and a.act = (said ->> 'id')::uuid and a.character = author and a.account = pg_temp.owner(author)) is distinct from 1 then
    raise exception 'a staff draw did not write one drew alert to the author';
  end if;

  -- 3. A wash writes none.
  n := (select count(*) from alerts a where a.kind = 'cardOnYours');
  perform tests.become_service();
  said := wash_surface(pg_temp.owner(author), author, wall, payload, pg_temp.cells(0, 50));
  perform tests.unbecome();
  if (said ->> 'kind') is distinct from 'wash' then raise exception 'the wash did not land: %', said; end if;
  if (select count(*) from alerts a where a.kind = 'cardOnYours') is distinct from n then raise exception 'a wash wrote a cardOnYours alert'; end if;

  -- 4b. A refused draw (past the wall's limit) writes none.
  n := (select count(*) from alerts a where a.kind = 'cardOnYours');
  perform tests.become_service();
  refused := pg_temp.refusal(format('select draw_on_surface(%L, %L, %L, %L, %L, 10)', pg_temp.owner(donor), donor, wall, payload, pg_temp.cells(1000, 500)::text));
  perform tests.unbecome();
  if refused is null then raise exception 'a draw past the limit was not refused'; end if;
  if (select count(*) from alerts a where a.kind = 'cardOnYours') is distinct from n then raise exception 'a refused draw wrote an alert'; end if;
end $$;

-- Task 8 (section 7): the refunded writing card, and crowd pay in the settlement alert.
--
-- 1. A write that failed and was refunded writes one cardEnded/refunded alert to the caster's account about the play; a second refund writes none.
-- 2. my_alerts lists a settlement that paid the account crowd pay and no ledger line, with count 0; one with ledger lines is as before (count = characters with lines); another account sees neither.
-- 3. A tie of settlements across a page's edge keeps the crowd-only one.
-- 4. my_alerts_unread counts the crowd-only settlement the account has not seen, as the list does, and not one it has.

insert into settings (key, value) values ('oldVoice', 'true') on conflict (key) do update set value = excluded.value;
insert into card_kinds (key, name, alignment, rarity, play, stack, writes) values ('ra-scribe', 'Ra Scribe', 'salty', 'uncommon', 'cast', 3, true);

do $$
declare
  ann uuid := tests.account('rr-ann'); bob uuid := tests.account('rr-bob');
  a uuid := tests.character(ann, 'Rr Caster'); b uuid := tests.character(bob, 'Rr Author');
  t uuid := tests.thread('Rr refund thread');
  p uuid; pl uuid; played jsonb; said jsonb;
begin
  insert into wallets (account, balance) values (ann, 600) on conflict (account) do update set balance = 600;
  insert into card_ledger (account, card, kind, price) values (ann, 'ra-scribe', 'bought', 0);
  p := tests.post(b, t, 'A post a writing card is played on.', '2030-03-01T00:00:00Z');
  perform tests.become_service();
  played := play_card(ann, 'ra-scribe', a, p, '{}', 50, '', tokens => 100);
  perform tests.unbecome();
  pl := (played ->> 'id')::uuid;
  if exists (select 1 from alerts x where x.kind = 'cardEnded' and x.act = pl) then raise exception 'a play wrote a cardEnded alert before any refund'; end if;

  perform tests.become_service();
  said := finish_card_write(pl, p, null, 'unreachable');
  perform tests.unbecome();
  if (select count(*) from alerts x where x.kind = 'cardEnded' and x.act = pl) is distinct from 1
     or (select count(*) from alerts x where x.kind = 'cardEnded' and x.sub = 'refunded' and x.act = pl and x.account = ann and x.character = a) is distinct from 1 then
    raise exception 'a refunded write did not write one cardEnded/refunded alert to the caster about the play: %', (select jsonb_agg(to_jsonb(x)) from alerts x where x.kind = 'cardEnded' and x.act = pl);
  end if;

  perform tests.become_service();
  said := refund_card_write(pl);
  perform tests.unbecome();
  if (select count(*) from alerts x where x.kind = 'cardEnded' and x.act = pl) is distinct from 1 then raise exception 'a second refund wrote another alert: %', (select jsonb_agg(to_jsonb(x)) from alerts x where x.kind = 'cardEnded' and x.act = pl); end if;
  if exists (select 1 from alerts x where x.account = bob and x.kind = 'cardEnded') then raise exception 'the post''s author was told of the caster''s refund'; end if;
end $$;

do $$
declare
  dan uuid := tests.account('rr-dan'); eve uuid := tests.account('rr-eve');
  d1 uuid := tests.character(dan, 'Rr Dan One'); d2 uuid := tests.character(dan, 'Rr Dan Two'); e1 uuid := tests.character(eve, 'Rr Eve One');
  at1 timestamptz := now() + interval '300 days';
  s_crowd bigint; s_lines bigint; s_tie_a bigint; s_tie_b bigint;
  got record;
  n integer;
begin
  insert into wallets (account, balance) values (dan, 100), (eve, 100) on conflict (account) do update set balance = 100;
  -- A settlement that paid Dan crowd pay and no ledger line.
  insert into settlements (starts_at, ends_at, season, applied_at) values (at1 - interval '9 days', at1 - interval '8 days', (select min(id) from seasons), at1) returning id into s_crowd;
  insert into wallet_events (account, settlement, kind, change, balance_after) values (dan, s_crowd, 'crowd', 4, 100);
  -- One that moved two of Dan's characters (three lines), and paid Eve crowd pay.
  insert into settlements (starts_at, ends_at, season, applied_at) values (at1 - interval '8 days', at1 - interval '7 days', (select min(id) from seasons), at1 + interval '1 day') returning id into s_lines;
  insert into ledger (settlement, account, character, reason, amount) values (s_lines, dan, d1, 'post.reacted', 10), (s_lines, dan, d1, 'post.quoted', 5), (s_lines, dan, d2, 'post.reacted', 7);
  insert into wallet_events (account, settlement, kind, change, balance_after) values (eve, s_lines, 'crowd', 2, 100);

  perform tests.become(dan);
  select count(*) into n from my_alerts(null, 30) m where m.kind = 'settlement';
  if n is distinct from 2 then raise exception 'Dan reads two settlements, one of crowd pay alone and one of ledger lines: %', n; end if;
  select * into got from my_alerts(null, 30) m where m.kind = 'settlement' and m.sub = s_crowd::text;
  if not found or got.count is distinct from 0 or got.at is distinct from at1 or got.thread is not null or got.act is not null or got.character is not null then
    raise exception 'a settlement of crowd pay alone is listed with count 0 at its applied time: %', got;
  end if;
  select * into got from my_alerts(null, 30) m where m.kind = 'settlement' and m.sub = s_lines::text;
  if not found or got.count is distinct from 2 or got.at is distinct from at1 + interval '1 day' then raise exception 'a settlement with ledger lines counts the characters it moved (2): %', got; end if;
  perform tests.unbecome();

  -- Eve was paid crowd pay in the second settlement alone: one row, count 0.
  perform tests.become(eve);
  if (select count(*) from my_alerts(null, 30) m where m.kind = 'settlement') is distinct from 1
     or (select m.count from my_alerts(null, 30) m where m.kind = 'settlement') is distinct from 0
     or (select m.sub from my_alerts(null, 30) m where m.kind = 'settlement') is distinct from s_lines::text then
    raise exception 'Eve reads the one settlement that paid her crowd pay, with count 0: %', (select jsonb_agg(to_jsonb(m)) from my_alerts(null, 30) m where m.kind = 'settlement');
  end if;
  perform tests.unbecome();

  -- The HUD's unread count reads settlements as the list does: Dan's two (one of crowd pay alone) count, Eve's one counts; once the account has seen past a settlement it no longer counts.
  -- Both have seen up to now: the count also holds the instance's news since the mark (alerts_news_unread), and a race test commits news (through dblink) that a
  -- test account made in 2000 has not seen, so without the mark the count reads the suite's leftovers. The settlements are 300 days ahead, past the mark.
  insert into account_preferences (account, alerts_seen_at) values (dan, now()), (eve, now()) on conflict (account) do update set alerts_seen_at = excluded.alerts_seen_at;
  perform tests.become(dan);
  if my_alerts_unread() is distinct from 2 then raise exception 'Dan''s unread count is the two settlements, the crowd-only one included: %', my_alerts_unread(); end if;
  perform tests.unbecome();
  perform tests.become(eve);
  if my_alerts_unread() is distinct from 1 then raise exception 'Eve''s unread count is the one settlement that paid her crowd pay: %', my_alerts_unread(); end if;
  perform tests.unbecome();
  insert into account_preferences (account, alerts_seen_at) values (dan, at1 + interval '12 hours') on conflict (account) do update set alerts_seen_at = excluded.alerts_seen_at;
  perform tests.become(dan);
  if my_alerts_unread() is distinct from 1 then raise exception 'a crowd-only settlement the account has seen no longer counts, the newer one does: %', my_alerts_unread(); end if;
  perform tests.unbecome();
  insert into account_preferences (account, alerts_seen_at) values (eve, at1 + interval '12 hours') on conflict (account) do update set alerts_seen_at = excluded.alerts_seen_at;
  perform tests.become(eve);
  if my_alerts_unread() is distinct from 1 then raise exception 'Eve''s newer crowd-only settlement is still unread: %', my_alerts_unread(); end if;
  perform tests.unbecome();
  update account_preferences set alerts_seen_at = at1 + interval '2 days' where account in (dan, eve);
  perform tests.become(dan);
  if my_alerts_unread() is distinct from 0 then raise exception 'all settlements seen, none count: %', my_alerts_unread(); end if;
  perform tests.unbecome();
  update account_preferences set alerts_seen_at = null where account in (dan, eve);

  -- A page of one: the newest settlement, and a crowd-only one applied at the same instant is its tie and stays.
  insert into settlements (starts_at, ends_at, season, applied_at) values (at1 + interval '1 day', at1 + interval '2 days', (select min(id) from seasons), at1 + interval '40 days') returning id into s_tie_a;
  insert into settlements (starts_at, ends_at, season, applied_at) values (at1 + interval '2 days', at1 + interval '3 days', (select min(id) from seasons), at1 + interval '40 days') returning id into s_tie_b;
  insert into wallet_events (account, settlement, kind, change, balance_after) values (dan, s_tie_a, 'crowd', 1, 100);
  insert into ledger (settlement, account, character, reason, amount) values (s_tie_b, dan, d2, 'post.reacted', 3);
  perform tests.become(dan);
  if (select array_agg(m.sub order by m.sub) from my_alerts(null, 1) m where m.kind = 'settlement') is distinct from (select array_agg(x order by x) from unnest(array[s_tie_a::text, s_tie_b::text]) x)
     or (select m.count from my_alerts(null, 1) m where m.sub = s_tie_a::text) is distinct from 0
     or (select m.count from my_alerts(null, 1) m where m.sub = s_tie_b::text) is distinct from 1 then
    raise exception 'a page of one keeps the crowd-only settlement applied at the newest one''s instant: %', (select jsonb_agg(to_jsonb(m)) from my_alerts(null, 1) m where m.kind = 'settlement');
  end if;
  perform tests.unbecome();
end $$;

-- Task 9 (design section 2): a thread moved, in My log.
--
-- 1. log_page's `moved` holds one entry for a landed moveThread of a thread one of the caller's characters started: {move, at, thread, character, from, to}, with the thread's title and the two boards' names.
-- 2. Another account reads none, and neither does a player who only posted in the thread.

do $$
declare
  t uuid := tests.thread('Ra logged move');
  starter uuid := pg_temp.player('lg-starter');
  poster uuid := pg_temp.player('lg-poster');
  other uuid := pg_temp.player('lg-other');
  dest uuid; home uuid;
  q bigint; landed uuid;
  got jsonb;
begin
  insert into boards (slug, name) values ('ra-log-dest', 'Ra Log Dest') returning id into dest;
  perform pg_temp.say(starter, t);
  perform pg_temp.say(poster, t);
  home := (select th.board from threads th where th.id = t);
  q := pg_temp.mv_queue('moveThread', jsonb_build_object('thread', t, 'board', dest), true);
  landed := pg_temp.mv_land(q);
  if landed is null then raise exception 'the moveThread did not land: %', (select r.failure from queued_moves r where r.id = q); end if;

  perform tests.become(pg_temp.owner(starter));
  got := log_page(null) -> 'sources' -> 'moved';
  perform tests.unbecome();
  if jsonb_typeof(got) is distinct from 'array' or jsonb_array_length(got) is distinct from 1 then raise exception 'the starter reads one moved thread: %', got; end if;
  if (got -> 0 ->> 'move')::uuid is distinct from landed or (got -> 0 ->> 'thread')::uuid is distinct from t or (got -> 0 ->> 'character')::uuid is distinct from starter
     or (got -> 0 ->> 'to_board')::uuid is distinct from dest or (got -> 0 ->> 'from_board')::uuid is distinct from home or got -> 0 ->> 'at' is null then
    raise exception 'the moved entry is wrong: %', got -> 0;
  end if;
  if got -> 0 ->> 'title' is distinct from 'Ra logged move' or got -> 0 ->> 'to_name' is distinct from 'Ra Log Dest' or got -> 0 ->> 'from_name' is null then raise exception 'the moved entry does not name the thread and board: %', got -> 0; end if;

  perform tests.become(pg_temp.owner(other));
  got := log_page(null) -> 'sources' -> 'moved';
  perform tests.unbecome();
  if got is distinct from '[]'::jsonb then raise exception 'another account read a moved thread: %', got; end if;
  perform tests.become(pg_temp.owner(poster));
  got := log_page(null) -> 'sources' -> 'moved';
  perform tests.unbecome();
  if got is distinct from '[]'::jsonb then raise exception 'a player who only posted read a moved thread: %', got; end if;
end $$;

-- Review fix for Task 11 (design section 7; section 9 of the migration): what alerts_page loads for the new lines.
--
-- 1. A warning and a fallTaken name the post they were filed on (`about_act`): that post, with its number, is among the Acts; the warning's Mod is among the people by its staff key; fallTaken's people hold the taker.
-- 2. A gift's and a drawing's post, three links from the alert's Act, is among the Acts; a drawing's people hold the drawer.
-- 3. A threadMoved row's board is among the boards, by name.
-- 4. Nothing is loaded for another account's rows, and a page holds no more than its 30 rows' worth.

create function pg_temp.page_as(c uuid) returns jsonb language plpgsql as $$
declare got jsonb;
begin
  perform tests.become(pg_temp.owner(c));
  got := alerts_page(null);
  perform tests.unbecome();
  return got;
end $$;

do $$
declare
  t uuid := tests.thread('Ra loads fall');
  author uuid := pg_temp.player('ld-author'); taker uuid := pg_temp.player('ld-taker'); other uuid := pg_temp.player('ld-other');
  p uuid := pg_temp.say(author, t);
  v uuid; inf uuid; got jsonb; staff_key text;
begin
  insert into card_ledger (account, card, kind, price) values (pg_temp.owner(taker), 't-ra-fall', 'bought', 0);
  perform play_card(pg_temp.owner(taker), 't-ra-fall', taker, p, '{}', 0, '', 'post');
  v := pg_temp.visit(p);
  perform file_visit(v, 'Filed.');
  inf := (select i.id from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text);
  staff_key := (select i.payload ->> 'staff' from acts i where i.id = inf);

  got := pg_temp.page_as(author);
  if not exists (select 1 from jsonb_array_elements(got -> 'acts') a where a ->> 'id' = p::text and (a ->> 'seq') is not null) then raise exception 'fallTaken: the post the infraction names is not loaded with its number: %', got -> 'acts'; end if;
  if not exists (select 1 from jsonb_array_elements(got -> 'people') c where c ->> 'id' = taker::text) then raise exception 'fallTaken: the taker is not among the people: %', got -> 'people'; end if;

  got := pg_temp.page_as(taker);
  if not exists (select 1 from jsonb_array_elements(got -> 'acts') a where a ->> 'id' = p::text and (a ->> 'seq') is not null) then raise exception 'warning: the post the infraction names is not loaded with its number'; end if;
  if not exists (select 1 from jsonb_array_elements(got -> 'people') c where c ->> 'staff' = staff_key) then raise exception 'warning: the Mod that filed (%) is not among the people by its staff key: %', staff_key, got -> 'people'; end if;

  -- Another account's page loads what a page of an account with no rows at all loads, read at the same moment: the instance's news, the same for everyone,
  -- which a race test commits (through dblink) before this file runs, and nothing of the filing.
  got := pg_temp.page_as(other);
  if got is distinct from pg_temp.page_as(pg_temp.player('ld-nobody'))
     or exists (select 1 from jsonb_array_elements(got -> 'acts') a where a ->> 'id' in (p::text, v::text, inf::text))
     or exists (select 1 from jsonb_array_elements(got -> 'people') c where c ->> 'id' in (author::text, taker::text)) then
    raise exception 'another account''s page loads Acts or people it has no row for: %', got;
  end if;
end $$;

do $$
declare
  author uuid := pg_temp.player('ld2-author');
  donor uuid := pg_temp.player('ld2-donor');
  caster uuid := pg_temp.player('ld2-caster');
  t uuid; p uuid; drive uuid; wall uuid; played jsonb; said jsonb; gifted uuid; drew uuid; got jsonb;
  payload jsonb := '{"strokes": [{"width": 0.01, "points": [[0.1, 0.1]]}]}';
begin
  perform tests.become(pg_temp.owner(author));
  t := ((start_thread('general', author, 'Ra loads gifts', 'Ra load words.')) -> 'act' ->> 'thread')::uuid;
  perform tests.unbecome();
  p := (select a.id from acts a where a.thread = t and a.kind = 'post' order by a.created_at limit 1);
  insert into card_ledger (account, card, kind, price) select pg_temp.owner(caster), k, 'bought', 0 from unnest(array['t-ra-drive', 't-ra-wall']) k, generate_series(1, 3);
  perform tests.become_service();
  played := play_card(pg_temp.owner(caster), 't-ra-drive', caster, p, '{}', 0, 'Please give.');
  drive := (played ->> 'id')::uuid;
  played := play_card(pg_temp.owner(caster), 't-ra-wall', caster, p, '{}', 0, '');
  wall := (played ->> 'id')::uuid;
  perform tests.unbecome();
  insert into wallets (account, balance) values (pg_temp.owner(donor), 400) on conflict (account) do update set balance = excluded.balance;
  perform tests.become_service();
  said := donate(pg_temp.owner(donor), donor, drive, 10);
  gifted := (said #>> '{gift,id}')::uuid;
  said := draw_on_surface(pg_temp.owner(donor), donor, wall, payload, pg_temp.cells(0, 100), 4000);
  drew := (said ->> 'id')::uuid;
  perform tests.unbecome();

  got := pg_temp.page_as(author);
  if not exists (select 1 from jsonb_array_elements(got -> 'acts') a where a ->> 'id' = gifted::text) or not exists (select 1 from jsonb_array_elements(got -> 'acts') a where a ->> 'id' = drew::text) then raise exception 'the gift or the draw is not loaded: %', got -> 'acts'; end if;
  if not exists (select 1 from jsonb_array_elements(got -> 'acts') a where a ->> 'id' = p::text and (a ->> 'seq') is not null) then raise exception 'the post three links from a gift and a draw is not loaded: %', got -> 'acts'; end if;
  if not exists (select 1 from jsonb_array_elements(got -> 'people') c where c ->> 'id' = donor::text and c ->> 'name' = 'Ra ld2-donor') then raise exception 'the drawer is not among the people by name: %', got -> 'people'; end if;
end $$;

do $$
declare
  t uuid := tests.thread('Ra loads moved');
  starter uuid := pg_temp.player('ld3-starter');
  dest uuid; q bigint; landed uuid; got jsonb;
begin
  insert into boards (slug, name) values ('ra-ld-dest', 'Ra Load Dest') returning id into dest;
  perform pg_temp.say(starter, t);
  q := pg_temp.mv_queue('moveThread', jsonb_build_object('thread', t, 'board', dest), true);
  landed := pg_temp.mv_land(q);
  got := pg_temp.page_as(starter);
  if not exists (select 1 from jsonb_array_elements(got -> 'acts') a where a ->> 'id' = landed::text) then raise exception 'the move is not loaded'; end if;
  if (select b ->> 'name' from jsonb_array_elements(got -> 'boards') b where b ->> 'id' = dest::text) is distinct from 'Ra Load Dest' then raise exception 'the board the thread moved to is not among the boards by name: %', got -> 'boards'; end if;
  if jsonb_array_length(got -> 'boards') <> 1 then raise exception 'the page holds boards it has no row for: %', got -> 'boards'; end if;
  -- The alert's own thread is the move's (the Announcements thread); the thread that moved is the move's `params.thread`, so its title comes with the page.
  if (select x ->> 'title' from jsonb_array_elements(got -> 'threads') x where x ->> 'id' = t::text) is distinct from 'Ra loads moved' then raise exception 'the thread that moved is not among the threads by title: %', got -> 'threads'; end if;
  if jsonb_array_length(got -> 'threads') <> 1 then raise exception 'the page holds threads it has no row for: %', got -> 'threads'; end if;
end $$;
