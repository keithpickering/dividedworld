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
