-- A report judged a visit that opens none (supabase/migrations/0401_report_no_visit.sql, beside 0107_reports.sql and 0357_post_veils.sql): the verdict is still written, and the price goes back beside it, in the same transaction.
--
-- 1. The veil between the payment and the judgment: the verdict lands with no visit, a `veiled` refund of the price is written beside it, the answer says so, and the wallet is back where it was.
-- 2. The stock line still stands where the Mod gave none, with no visit.
-- 3. The repeat: a post already visited on that charge (the visit ended) is refunded `visited`; with the visit still open the verdict links it and nothing is refunded.
-- 4. The same whoever owns the post: a reporter's own other mask's post, veiled, answers the same.
-- 5. Twice closes once: a second close of a no-visit report answers as the first did (`existing`, the same refund) and writes nothing.
-- 6. The invariant's other doors: refund_report, and the sweep, never write a refund beside a verdict, nor a no-visit refund without one.
-- 7. The quota counts a no-visit refund (only `failed` frees a slot), and my_reports_left says so.
-- 8. The budget counts it: judgment_load_today() does not move when the report closes.
-- 9. A backfire refunds nothing, with no post to visit or a hidden one.
-- 10. What the reporter reads (my_reports.refund) and what the Mod's log reads (moves_log's `visited`).
-- 11. start_visit names every no-visit.
-- 12. pay_report_back is unreachable to the service and to a player, and writes nothing.
-- 13. refund_report with no reason refunds as failed (0107's default, kept by 0401).
-- 14. A reason close_report cannot name is a fault: it raises, nothing is written (the staff function then refunds it as failed).
-- The veil card is this file's own (t-rn-veil), never an instance's.

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- The world: a Boss, a Mod on General's beat, the settings (reportPrice 25), the stand-in, and a veil card.
do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
        'reportPrice', 25, 'reportsPerDay', 10, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 50, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'),
        'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.'),
        'reportDismissed', jsonb_build_array('{mod} dismisses {reporter} with a sigh.'),
        'reportBackfired', jsonb_build_array('{mod} has words for {reporter}.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'anonymous', jsonb_build_object('name', 'Anonymous', 'title', 'Could be anyone.', 'avatar', 'nobody'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'rn-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'rn-boss', 'name', 'Rn Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'rn-m1', 'name', 'Rn Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('rn-m1'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts')))));
  if stand_in() is null then raise exception 'the seed made the stand-in'; end if;
  if beat_of((select id from boards where slug = 'general')) is distinct from 'rn-m1' then raise exception 'the world: the beat Mod of General is %', beat_of((select id from boards where slug = 'general')); end if;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, discipline) values
    ('t-rn-veil', 'Test Veil', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', null);
end $$;

create function pg_temp.owner(c uuid) returns uuid language sql as $$ select owner from characters where id = c $$;

create function pg_temp.player(label text) returns uuid language plpgsql as $$
declare a uuid := tests.account('rn-' || label);
begin
  insert into wallets (account, balance) values (a, 500) on conflict (account) do update set balance = excluded.balance;
  return tests.character(a, 'Rn ' || label);
end $$;

-- A second mask of the same player's account.
create function pg_temp.mask(c uuid, label text) returns uuid language sql as $$ select tests.character(pg_temp.owner(c), 'Rn ' || label) $$;

create function pg_temp.say(by_character uuid, in_thread uuid, body text default 'A quiet post') returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(pg_temp.owner(by_character));
  made := post(in_thread, by_character, body || ' ' || gen_random_uuid());
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;

-- A report through the real open_report, as the account that owns the character.
create function pg_temp.report(through uuid, on_post uuid) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(pg_temp.owner(through));
  made := open_report(through, on_post, 'It breaks the spirit of the board.');
  perform tests.unbecome();
  return (made ->> 'report')::uuid;
end $$;

-- open_report as the reporter, answering its refusal's code and words, or null when it was taken.
create function pg_temp.as_report(through uuid, on_post uuid) returns text language plpgsql as $$
declare got text;
begin
  perform tests.become(pg_temp.owner(through));
  got := pg_temp.coded(format('select open_report(%L, %L, %L)', through, on_post, 'Once more.'));
  perform tests.unbecome();
  return got;
end $$;

-- The service's close_report.
create function pg_temp.close(rep uuid, verdict text default 'visit', said text default null) returns jsonb language plpgsql as $$
declare got jsonb;
begin
  perform tests.become_service();
  got := close_report(rep, verdict, said, null);
  perform tests.unbecome();
  return got;
end $$;

-- A veil cast on a post by a player who is nobody in the story (a fresh player each time, with one card).
create function pg_temp.veil(on_post uuid) returns void language plpgsql as $$
declare
  c uuid := pg_temp.player('v' || substr(md5(gen_random_uuid()::text), 1, 8));
  got text;
begin
  insert into card_ledger (account, card, kind, price) values (pg_temp.owner(c), 't-rn-veil', 'bought', 0);
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', pg_temp.owner(c), 't-rn-veil', c, on_post, '{}', '', 'post', null));
  perform tests.unbecome();
  if got is not null then raise exception 'the veil did not land: %', got; end if;
end $$;

create function pg_temp.wallet(a uuid) returns integer language sql as $$ select coalesce((select balance from wallets where account = a), 0) $$;
create function pg_temp.verdicts(rep uuid) returns bigint language sql as $$ select count(*) from acts where kind = 'report_verdict' and target_act_id = rep $$;
create function pg_temp.refunds(rep uuid) returns bigint language sql as $$ select count(*) from report_refunds where report_act = rep $$;
create function pg_temp.refund_events(rep uuid) returns bigint language sql as $$ select count(*) from wallet_events where kind = 'refund' and ref = rep $$;
create function pg_temp.visits_on(on_post uuid) returns bigint language sql as $$ select count(*) from acts where kind = 'visit' and target_act_id = on_post $$;
create function pg_temp.verdict_payload(rep uuid) returns jsonb language sql as $$ select payload from acts where kind = 'report_verdict' and target_act_id = rep $$;
create function pg_temp.verdict_act(rep uuid) returns uuid language sql as $$ select id from acts where kind = 'report_verdict' and target_act_id = rep $$;
-- Everything a no-visit close writes, as one number per kind, so "nothing written" is one comparison.
create function pg_temp.written() returns text language sql as $$
  select (select count(*) from acts where kind in ('report_verdict', 'visit', 'visit_join', 'visit_end')) || '/' || (select count(*) from report_refunds) || '/' || (select count(*) from wallet_events)
$$;

-- ---- 1. The veil between the payment and the judgment: the verdict, and the price back beside it ----
do $$
declare
  t uuid := tests.thread('Rn veil');
  ann uuid := pg_temp.player('ann');
  bob uuid := pg_temp.player('bob');
  p uuid := pg_temp.say(bob, t);
  w0 integer := pg_temp.wallet(pg_temp.owner(ann));
  rep uuid; ans jsonb;
begin
  rep := pg_temp.report(ann, p);
  if pg_temp.wallet(pg_temp.owner(ann)) is distinct from w0 - 25 then raise exception 'the report did not cost 25: % -> %', w0, pg_temp.wallet(pg_temp.owner(ann)); end if;
  perform pg_temp.veil(p);
  ans := pg_temp.close(rep, 'visit', 'Noted.');
  if ans ->> 'closed' is distinct from 'true' then raise exception 'the veiled report did not close: %', ans; end if;
  if ans -> 'refund' is distinct from jsonb_build_object('why', 'veiled', 'amount', 25) then raise exception 'the answer carries no veiled refund: %', ans; end if;
  if ans ->> 'visit' is not null then raise exception 'the answer names a visit: %', ans; end if;
  if pg_temp.verdicts(rep) is distinct from 1::bigint then raise exception 'the veiled report has % verdicts', pg_temp.verdicts(rep); end if;
  if pg_temp.verdict_payload(rep) is distinct from jsonb_build_object('report_act', rep::text, 'verdict', 'visit', 'line', 'Noted.') then raise exception 'the verdict is %', pg_temp.verdict_payload(rep); end if;
  if pg_temp.visits_on(p) is distinct from 0::bigint then raise exception 'a visit opened on a veiled post'; end if;
  if (select count(*) from report_refunds where report_act = rep and why = 'veiled' and amount = 25) is distinct from 1::bigint then raise exception 'no veiled refund row for the report'; end if;
  if (select count(*) from wallet_events where kind = 'refund' and ref = rep and account = pg_temp.owner(ann) and change = 25) is distinct from 1::bigint then raise exception 'no refund of 25 on the reporter''s account'; end if;
  if pg_temp.wallet(pg_temp.owner(ann)) is distinct from w0 then raise exception 'the wallet is % after the refund, not %', pg_temp.wallet(pg_temp.owner(ann)), w0; end if;
end $$;

-- ---- 2. The stock line still stands where the Mod gave none, with no visit ----
do $$
declare
  t uuid := tests.thread('Rn stock');
  ann uuid := pg_temp.player('stock-ann');
  bob uuid := pg_temp.player('stock-bob');
  p uuid := pg_temp.say(bob, t);
  rep uuid := pg_temp.report(ann, p);
  ans jsonb;
begin
  perform pg_temp.veil(p);
  ans := pg_temp.close(rep, 'visit', null);
  if ans -> 'refund' is distinct from jsonb_build_object('why', 'veiled', 'amount', 25) then raise exception 'the stock-line report was not refunded: %', ans; end if;
  if coalesce(pg_temp.verdict_payload(rep) ->> 'line', '') not like 'Rn Mod One is looking at this post under %' then raise exception 'the stock line is %', pg_temp.verdict_payload(rep) ->> 'line'; end if;
  if pg_temp.visits_on(p) is distinct from 0::bigint then raise exception 'a visit opened on a veiled post'; end if;
end $$;

-- ---- 3. The repeat: visited and ended is refunded; visited and still open links the open visit, with no refund ----
do $$
declare
  t uuid := tests.thread('Rn repeat');
  ann uuid := pg_temp.player('rep-ann');
  ann2 uuid := pg_temp.mask(ann, 'rep-ann-2');
  bob uuid := pg_temp.player('rep-bob');
  p uuid := pg_temp.say(bob, t);
  p2 uuid := pg_temp.say(bob, t);
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; ans jsonb; v1 uuid; v3 uuid; w0 integer;
begin
  -- An earlier report on the board's premise opened a visit, which ended filed.
  r1 := pg_temp.report(ann, p);
  ans := pg_temp.close(r1, 'visit', 'First.');
  if ans ->> 'visit' is null or ans -> 'refund' is not null then raise exception 'the first visit did not open cleanly: %', ans; end if;
  v1 := (ans ->> 'visit')::uuid;
  perform end_visit(v1, 'filed');
  -- A second report on the same charge: no new visit, and the price back.
  w0 := pg_temp.wallet(pg_temp.owner(ann2));
  r2 := pg_temp.report(ann2, p);
  ans := pg_temp.close(r2, 'visit', 'Again.');
  if ans ->> 'closed' is distinct from 'true' or ans ->> 'visit' is not null then raise exception 'the repeat opened a visit or did not close: %', ans; end if;
  if ans -> 'refund' is distinct from jsonb_build_object('why', 'visited', 'amount', 25) then raise exception 'the repeat was not refunded visited: %', ans; end if;
  if pg_temp.visits_on(p) is distinct from 1::bigint then raise exception 'the repeat opened a second visit'; end if;
  if pg_temp.verdict_payload(r2) ? 'visit_act' then raise exception 'the repeat verdict links a visit: %', pg_temp.verdict_payload(r2); end if;
  if (select count(*) from report_refunds where report_act = r2 and why = 'visited' and amount = 25) is distinct from 1::bigint then raise exception 'no visited refund row'; end if;
  if pg_temp.refund_events(r2) is distinct from 1::bigint or pg_temp.wallet(pg_temp.owner(ann2)) is distinct from w0 then raise exception 'the repeat''s price did not go back'; end if;
  -- With the earlier visit still open, the verdict links that visit and nothing is refunded.
  r3 := pg_temp.report(ann, p2);
  ans := pg_temp.close(r3, 'visit', 'Open.');
  v3 := (ans ->> 'visit')::uuid;
  if v3 is null then raise exception 'the third visit did not open: %', ans; end if;
  r4 := pg_temp.report(ann2, p2);
  ans := pg_temp.close(r4, 'visit', 'Same charge.');
  if ans ->> 'visit' is distinct from v3::text or ans -> 'refund' is not null then raise exception 'a report on an open visit''s charge: %', ans; end if;
  if pg_temp.verdict_payload(r4) ->> 'visit_act' is distinct from v3::text then raise exception 'the verdict does not link the open visit: %', pg_temp.verdict_payload(r4); end if;
  if pg_temp.refunds(r4) is distinct from 0::bigint or pg_temp.refund_events(r4) is distinct from 0::bigint then raise exception 'a report on an open visit was refunded'; end if;
  if pg_temp.visits_on(p2) is distinct from 1::bigint then raise exception 'a second visit opened beside the open one'; end if;
end $$;

-- ---- 4. The same whoever owns the post: the reporter's own other mask's post, veiled ----
do $$
declare
  t uuid := tests.thread('Rn own');
  ann uuid := pg_temp.player('own-ann');
  ann2 uuid := pg_temp.mask(ann, 'own-ann-2');
  p uuid := pg_temp.say(ann2, t);
  w0 integer := pg_temp.wallet(pg_temp.owner(ann));
  rep uuid := pg_temp.report(ann, p);
  ans jsonb;
begin
  perform pg_temp.veil(p);
  ans := pg_temp.close(rep, 'visit', 'Noted.');
  if ans ->> 'closed' is distinct from 'true' or ans -> 'refund' is distinct from jsonb_build_object('why', 'veiled', 'amount', 25) or ans ->> 'visit' is not null then raise exception 'the own-post answer differs: %', ans; end if;
  if pg_temp.verdicts(rep) is distinct from 1::bigint or pg_temp.refunds(rep) is distinct from 1::bigint or pg_temp.refund_events(rep) is distinct from 1::bigint or pg_temp.visits_on(p) is distinct from 0::bigint
     or pg_temp.wallet(pg_temp.owner(ann)) is distinct from w0 then raise exception 'the own-post rows differ'; end if;
end $$;

-- ---- 5. Twice closes once, and 6. the invariant's other doors ----
do $$
declare
  t uuid := tests.thread('Rn twice');
  ann uuid := pg_temp.player('twice-ann');
  bob uuid := pg_temp.player('twice-bob');
  p uuid := pg_temp.say(bob, t);
  rep uuid := pg_temp.report(ann, p);
  fresh uuid := pg_temp.report(ann, pg_temp.say(bob, t));
  old uuid; first_ans jsonb; again jsonb; before text; got text;
begin
  perform pg_temp.veil(p);
  first_ans := pg_temp.close(rep, 'visit', 'Noted.');
  before := pg_temp.written();
  again := pg_temp.close(rep, 'visit', 'Noted.');
  if again ->> 'closed' is distinct from 'false' or again ->> 'existing' is distinct from 'true' then raise exception 'a second close of a no-visit report answered %', again; end if;
  if again -> 'refund' is distinct from first_ans -> 'refund' or again -> 'refund' is null then raise exception 'the second close lost the refund: % / %', first_ans -> 'refund', again -> 'refund'; end if;
  if pg_temp.written() is distinct from before then raise exception 'a second close wrote something'; end if;
  -- refund_report on the veiled report: a verdict is there, nothing is written.
  perform tests.become_service();
  got := refund_report(rep)::text;
  perform tests.unbecome();
  if got::jsonb is distinct from '{"refunded": false, "closed": true}'::jsonb then raise exception 'refund_report on a judged report answered %', got; end if;
  if pg_temp.written() is distinct from before then raise exception 'refund_report wrote beside a verdict'; end if;
  -- A no-visit reason is never the reason of a direct refund, so no no-visit refund is written without its verdict.
  perform tests.become_service();
  got := pg_temp.coded(format('select refund_report(%L, ''veiled'')', fresh));
  perform tests.unbecome();
  if got is distinct from '22023 refund_report refunds a failed or a stale report, not veiled' then raise exception 'refund_report(veiled) answered %', got; end if;
  perform tests.become_service();
  got := pg_temp.coded(format('select refund_report(%L, ''visited'')', fresh));
  perform tests.unbecome();
  if got is distinct from '22023 refund_report refunds a failed or a stale report, not visited' then raise exception 'refund_report(visited) answered %', got; end if;
  if pg_temp.written() is distinct from before then raise exception 'a refused refund wrote something'; end if;
  -- The sweep skips a judged report, however old.
  perform set_config('kayfabb.report_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
    values ((select character from acts where id = rep), 'report', t, p, '{"reason": "old"}', now() - interval '11 minutes') returning id into old;
  perform set_config('kayfabb.report_writer', '', true);
  perform tests.become_service();
  got := refund_stale_reports(10)::text;
  perform tests.unbecome();
  -- Only the backdated, unjudged report is swept; the veiled one has its verdict.
  if got::integer is distinct from 1 then raise exception 'the sweep took % reports, not the one unjudged old report', got; end if;
  if pg_temp.refunds(rep) is distinct from 1::bigint then raise exception 'the sweep refunded the veiled report again'; end if;
  if (select why from report_refunds where report_act = old) is distinct from 'stale' then raise exception 'the sweep''s refund is not stale'; end if;
end $$;

-- The sweep over a veiled report that is itself backdated: judged, so skipped (nothing written).
do $$
declare
  t uuid := tests.thread('Rn sweep');
  ann uuid := pg_temp.player('sweep-ann');
  bob uuid := pg_temp.player('sweep-bob');
  p uuid := pg_temp.say(bob, t);
  rep uuid; before text; got integer;
begin
  perform set_config('kayfabb.report_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (ann, 'report', t, p, '{"reason": "old"}', now() - interval '11 minutes') returning id into rep;
  perform set_config('kayfabb.report_writer', '', true);
  perform wallet_spend(pg_temp.owner(ann), 25, 'report', rep);
  perform pg_temp.veil(p);
  if (pg_temp.close(rep, 'visit', 'Noted.') -> 'refund' ->> 'why') is distinct from 'veiled' then raise exception 'the backdated veiled report was not refunded veiled'; end if;
  before := pg_temp.written();
  perform tests.become_service();
  got := refund_stale_reports(10);
  perform tests.unbecome();
  if got is distinct from 0 then raise exception 'the sweep took % reports, not 0', got; end if;
  if pg_temp.written() is distinct from before then raise exception 'the sweep wrote beside a verdict'; end if;
end $$;

-- ---- 7. The quota counts a no-visit refund; only a failed one frees a slot ----
do $$
declare
  t uuid := tests.thread('Rn quota');
  q uuid := pg_temp.player('quota-q');
  bob uuid := pg_temp.player('quota-bob');
  was jsonb := (select value from settings where key = 'modBots');
  p1 uuid := pg_temp.say(bob, t); p2 uuid := pg_temp.say(bob, t); p3 uuid := pg_temp.say(bob, t);
  r1 uuid; got text; left_ integer;
begin
  update settings set value = jsonb_set(value, '{reportsPerDay}', '2') where key = 'modBots';
  r1 := pg_temp.report(q, p1);
  perform pg_temp.veil(p1);
  if (pg_temp.close(r1, 'visit', 'Noted.') -> 'refund' ->> 'why') is distinct from 'veiled' then raise exception 'the quota report was not refunded veiled'; end if;
  perform pg_temp.report(q, p2);
  got := pg_temp.as_report(q, p3);
  if got is null or got not like '%has made its 2 reports%' then raise exception 'a refunded-veiled report did not count toward the quota: %', got; end if;
  perform tests.become(pg_temp.owner(q));
  left_ := (select "left" from my_reports_left where character = q);
  perform tests.unbecome();
  if left_ is distinct from 0 then raise exception 'my_reports_left says % for a character at its quota', left_; end if;
  update settings set value = was where key = 'modBots';
end $$;

-- ---- 8. The budget counts it: the ledger already holds the judgment, and the close moves nothing ----
do $$
declare
  t uuid := tests.thread('Rn budget');
  ann uuid := pg_temp.player('budget-ann');
  bob uuid := pg_temp.player('budget-bob');
  p uuid := pg_temp.say(bob, t);
  rep uuid := pg_temp.report(ann, p);
  load0 integer; ans jsonb;
begin
  insert into staff_call_records (cause_act, duty, staff, record) values (rep, 'reportJudge', 'rn-m1', '{}');
  insert into model_calls (duty, staff, provider, model, cost_microdollars, outcome) values ('reportJudge', 'rn-m1', 'fake', 'fake', 0, 'ok');
  perform pg_temp.veil(p);
  load0 := judgment_load_today();
  ans := pg_temp.close(rep, 'visit', 'Noted.');
  if ans -> 'refund' is null then raise exception 'the budget report was not refunded: %', ans; end if;
  if judgment_load_today() is distinct from load0 then raise exception 'a no-visit refund moved the judgment load: % -> %', load0, judgment_load_today(); end if;
end $$;

-- ---- 9. A backfire refunds nothing: no post to visit, or a hidden one ----
do $$
declare
  t uuid := tests.thread('Rn backfire');
  nopost uuid := pg_temp.player('bf-nopost');
  hidden uuid := pg_temp.player('bf-hidden');
  bob uuid := pg_temp.player('bf-bob');
  p uuid := pg_temp.say(bob, t);
  mine uuid := pg_temp.say(hidden, t);
  r1 uuid := pg_temp.report(nopost, p);
  r2 uuid := pg_temp.report(hidden, p);
  w0 integer := pg_temp.wallet(pg_temp.owner(nopost));
  ans jsonb;
begin
  ans := pg_temp.close(r1, 'backfire', null);
  if ans ->> 'closed' is distinct from 'true' or pg_temp.verdicts(r1) is distinct from 1::bigint or pg_temp.visits_on(mine) is distinct from 0::bigint then raise exception 'a backfire with no post to visit: %', ans; end if;
  if pg_temp.refunds(r1) is distinct from 0::bigint or pg_temp.refund_events(r1) is distinct from 0::bigint or ans ->> 'refund' is not null then raise exception 'a backfire with no post was refunded'; end if;
  perform pg_temp.veil(mine);
  ans := pg_temp.close(r2, 'backfire', null);
  if ans ->> 'closed' is distinct from 'true' or pg_temp.verdicts(r2) is distinct from 1::bigint or pg_temp.visits_on(mine) is distinct from 0::bigint then raise exception 'a backfire on a hidden post: %', ans; end if;
  if pg_temp.refunds(r2) is distinct from 0::bigint or pg_temp.refund_events(r2) is distinct from 0::bigint or ans ->> 'refund' is not null then raise exception 'a backfire on a hidden post was refunded'; end if;
  if pg_temp.wallet(pg_temp.owner(nopost)) is distinct from w0 then raise exception 'a backfire gave a price back'; end if;
end $$;

-- ---- 10. What the reporter reads, and what the Mod's log reads ----
do $$
declare
  t uuid := tests.thread('Rn reads');
  ann uuid := pg_temp.player('rd-ann');
  ann2 uuid := pg_temp.mask(ann, 'rd-ann-2');
  nopost uuid := pg_temp.player('rd-nopost');
  bob uuid := pg_temp.player('rd-bob');
  p uuid := pg_temp.say(bob, t); p2 uuid := pg_temp.say(bob, t);
  r_veil uuid; r_open uuid; r_rep uuid; r_back uuid; r_ok uuid;
  seen text;
begin
  -- A veiled report, a visit that opened, a repeat of it, and a backfire with no post.
  r_veil := pg_temp.report(ann, p2);
  perform pg_temp.veil(p2);
  perform pg_temp.close(r_veil, 'visit', 'Noted.');
  r_open := pg_temp.report(ann, p);
  perform end_visit(((pg_temp.close(r_open, 'visit', 'Opened.')) ->> 'visit')::uuid, 'filed');
  r_rep := pg_temp.report(ann2, p);
  perform pg_temp.close(r_rep, 'visit', 'Again.');
  r_back := pg_temp.report(nopost, p);
  perform pg_temp.close(r_back, 'backfire', null);
  -- As Ann.
  perform tests.become(pg_temp.owner(ann));
  seen := (select refund from my_reports where report = r_veil);
  if seen is distinct from 'veiled' then raise exception 'my_reports.refund for the veiled report is %', seen; end if;
  seen := (select refund from my_reports where report = r_rep);
  if seen is distinct from 'visited' then raise exception 'my_reports.refund for the repeat is %', seen; end if;
  if (select refund from my_reports where report = r_open) is not null then raise exception 'my_reports.refund for a report whose visit opened is not null'; end if;
  perform tests.unbecome();
  -- The Mod's log.
  r_ok := pg_temp.verdict_act(r_open);
  if (select params ->> 'visited' from moves_log where id = pg_temp.verdict_act(r_veil)) is distinct from 'false' then raise exception 'moves_log says visited for a veiled report'; end if;
  if (select params ->> 'visited' from moves_log where id = pg_temp.verdict_act(r_rep)) is distinct from 'false' then raise exception 'moves_log says visited for a repeat'; end if;
  if (select params ->> 'visited' from moves_log where id = pg_temp.verdict_act(r_back)) is distinct from 'false' then raise exception 'moves_log says visited for a backfire with no post'; end if;
  if (select params ->> 'visited' from moves_log where id = r_ok) is distinct from 'true' then raise exception 'moves_log does not say visited for a report whose visit opened'; end if;
  if (select params ->> 'verdict' from moves_log where id = r_ok) is distinct from 'visit' or (select params ->> 'post' from moves_log where id = r_ok) is null then raise exception 'moves_log lost its report keys'; end if;
end $$;

-- ---- 11. start_visit names every no-visit ----
do $$
declare
  t uuid := tests.thread('Rn names');
  bob uuid := pg_temp.player('nm-bob');
  staff_char uuid := (select id from characters where staff = 'rn-m1');
  sp uuid;
  p uuid := pg_temp.say(bob, t);
  charge jsonb := jsonb_build_object('rule_number', null, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'the premise');
  got jsonb;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  sp := tests.post(staff_char, t);
  perform set_config('kayfabb.staff_writer', '', true);
  got := start_visit(sp, 'rn-m1', charge || jsonb_build_object('about_act', sp));
  if got is distinct from '{"visit": null, "staff": true}'::jsonb then raise exception 'start_visit on a staff post answered %', got; end if;
  perform pg_temp.veil(p);
  got := start_visit(p, 'rn-m1', charge);
  if got is distinct from '{"visit": null, "veiled": true}'::jsonb then raise exception 'start_visit on a veiled post answered %', got; end if;
end $$;

-- ---- 12. pay_report_back is reachable by no role: the service and a player are refused, and nothing is written ----
do $$
declare
  t uuid := tests.thread('Rn paid back');
  ann uuid := pg_temp.player('pb-ann');
  bob uuid := pg_temp.player('pb-bob');
  rep uuid := pg_temp.report(ann, pg_temp.say(bob, t));
  before text := pg_temp.written();
  got text;
begin
  perform tests.become_service();
  got := pg_temp.coded(format('select pay_report_back(%L, ''failed'')', rep));
  perform tests.unbecome();
  if got is null or got not like '42501 %' then raise exception 'pay_report_back as the service answered %', got; end if;
  perform tests.become(pg_temp.owner(ann));
  got := pg_temp.coded(format('select pay_report_back(%L, ''failed'')', rep));
  perform tests.unbecome();
  if got is null or got not like '42501 %' then raise exception 'pay_report_back as a player answered %', got; end if;
  if pg_temp.refunds(rep) is distinct from 0::bigint or pg_temp.refund_events(rep) is distinct from 0::bigint or pg_temp.written() is distinct from before then raise exception 'a refused pay_report_back wrote something'; end if;
end $$;

-- ---- 13. refund_report with no reason refunds a fresh, unjudged report as failed ----
do $$
declare
  t uuid := tests.thread('Rn default');
  ann uuid := pg_temp.player('df-ann');
  bob uuid := pg_temp.player('df-bob');
  rep uuid := pg_temp.report(ann, pg_temp.say(bob, t));
  w0 integer := pg_temp.wallet(pg_temp.owner(ann));
  got jsonb;
begin
  perform tests.become_service();
  got := refund_report(rep, null);
  perform tests.unbecome();
  if got is distinct from '{"refunded": true, "amount": 25}'::jsonb then raise exception 'refund_report(null) answered %', got; end if;
  if (select why from report_refunds where report_act = rep) is distinct from 'failed' then raise exception 'the default refund''s why is %', (select why from report_refunds where report_act = rep); end if;
  if pg_temp.refund_events(rep) is distinct from 1::bigint or pg_temp.wallet(pg_temp.owner(ann)) is distinct from w0 + 25 then raise exception 'the default refund did not pay the price back'; end if;
end $$;

-- ---- 14. A reason close_report cannot name is a fault (last: it replaces start_visit for the rest of the transaction) ----
do $$
declare
  t uuid := tests.thread('Rn unnamed');
  ann uuid := pg_temp.player('un-ann');
  bob uuid := pg_temp.player('un-bob');
  p uuid := pg_temp.say(bob, t);
  rep uuid := pg_temp.report(ann, p);
  before text := pg_temp.written();
  got text;
begin
  execute $f$create or replace function start_visit(post_act uuid, staff text, charge jsonb) returns jsonb language plpgsql as 'begin return jsonb_build_object(''visit'', null, ''capped'', true); end'$f$;
  perform tests.become_service();
  got := pg_temp.coded(format('select close_report(%L, ''visit'', ''Noted.'', null)', rep));
  perform tests.unbecome();
  if got is null or got not like 'P0001 a report''s visit opened none, for no reason a report can meet:%' then raise exception 'close_report on a reason it cannot name answered %', got; end if;
  if pg_temp.verdicts(rep) is distinct from 0::bigint or pg_temp.refunds(rep) is distinct from 0::bigint or pg_temp.refund_events(rep) is distinct from 0::bigint then raise exception 'an unnamed reason wrote something'; end if;
  if pg_temp.written() is distinct from before then raise exception 'an unnamed reason changed the rows'; end if;
end $$;
