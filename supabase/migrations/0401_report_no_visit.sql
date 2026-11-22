-- A report judged a visit that opens none gets its price back (docs/plans/2026-11-20-report-no-visit-plan.md, Task 1; design docs/plans/2026-11-20-report-no-visit-design.md, sections 3 to 5).
-- A `visit` verdict whose start_visit opens no visit, because the post's author is hidden (`veiled`) or because an earlier visit of the post already carried the charge (`visited`), is
-- closed with its verdict, and in the same transaction its price goes back to the account that paid it, in a report_refunds row whose `why` names the reason.
--
--   1. report_refunds.why   also 'veiled' and 'visited'. No column is added, so my_reports, my_reports_left, open_report, log_page and the export are unchanged.
--   2. start_visit          copied whole from 0357_post_veils.sql: a staff post answers {visit: null, staff: true} and a hidden author {visit: null, veiled: true}, where each answered null. Every no-visit
--                           is now an object with `visit: null` and one flag naming why (staff, veiled, repeat, capped); every caller reads `visit` (draw_visits, close_report, patrol.ts).
--   3. pay_report_back      new: the payment of refund_report's body, in one place for the two functions that may make it.
--   4. refund_report        copied whole from 0107_reports.sql: refuses a `why` other than failed or stale; the payment is pay_report_back.
--   5. close_report         copied whole from 0107_reports.sql: checks the verdict before the refund, and on a visit verdict that opened none writes the refund beside the verdict.
--   6. moves_log            copied whole from 0329_bundles.sql: a report row's params also say whether the verdict opened a visit (`visited`).
--
-- Append-only: the refund is a row of its own beside the verdict Act, never an edit of it; the verdict Act is written as before, with no visit_act.
-- Ways out: nothing is added to a player's state; the price is back at once, and the report counts toward the day's quota as a `stale` one does (only `failed` frees a slot).
-- Masks: close_report's answer is the service's; every reason is a public fact (a live author veil shows the stand-in to every reader, an earlier visit's charges are public Acts), the refund is the
-- reporter's own wallet, and nothing here differs with who owns the post or the reporter.
-- At a busy instance's scale: one more branch per `visit` verdict, at most one insert and one wallet move under the report's lock, and one more key read per moves_log report row.

-- ----------------------------------------------------------------------------------------------- 1. the reasons ----

alter table report_refunds drop constraint report_refunds_why_check;
alter table report_refunds add constraint report_refunds_why_check check (why in ('failed', 'stale', 'veiled', 'visited'));
comment on column report_refunds.why is 'Why the price went back. failed: the judgment failed (frees the quota slot). stale: never judged. veiled and visited: a visit verdict that opened no visit (the author was hidden, or the post had already been visited on that charge), written beside the verdict by close_report; counted toward the quota as stale is.';

-- ------------------------------------------------------------------------------------------------ 2. start_visit ----

-- start_visit (0357_post_veils), answering what it did for a post that gets no visit. The two answers that were null are now {visit: null, staff: true} and {visit: null, veiled: true}, beside the repeat and capped
-- it already names. Everything else as 0357 wrote it.
create or replace function start_visit(post_act uuid, staff text, charge jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  ch jsonb;
  open_visit uuid;
  held jsonb;
  top text;
  same boolean;
  ends timestamptz;
  written uuid;
  joined uuid;
  sprung jsonb;
  cap jsonb;
  patrol bigint;
begin
  select a.id, a.thread, t.board, a.character as author, c.staff is not null as by_staff into p
  from acts a join threads t on t.id = a.thread join characters c on c.id = a.character where a.id = post_act and a.kind in ('post', 'spin') for share of a;
  if not found then raise exception 'there is no such post to visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.by_staff then return jsonb_build_object('visit', null, 'staff', true); end if;
  -- No Mod Bot visits a post while its author is hidden: a visit names the author in its record and its filing, which is a read carrying the author. The same as a staff post: nothing written.
  if author_veiled(post_act) then return jsonb_build_object('visit', null, 'veiled', true); end if;
  if jsonb_typeof(charge) is distinct from 'object' or charge ->> 'band' is null or charge ->> 'band' not in ('minor', 'moderate', 'severe') or charge ->> 'cause' is null or charge ->> 'cause' not in ('rule', 'report', 'patrol', 'tail', 'backfire') then
    raise exception 'a charge names its band and its cause' using errcode = '22023';
  end if;
  ch := jsonb_strip_nulls(jsonb_build_object('predicate', charge -> 'predicate', 'rule', charge -> 'rule')) || jsonb_build_object(
    'rule_number', coalesce(charge -> 'rule_number', 'null'::jsonb), 'board', coalesce(charge ->> 'board', p.board::text), 'band', charge ->> 'band', 'cause', charge ->> 'cause',
    'about_act', coalesce(charge ->> 'about_act', post_act::text));
  -- One decision per post at a time: two charges drawn at once meet here, and the second joins.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.visit:' || post_act::text, 0));
  -- The targeting cap (the Mod Bots design, section 8): a patrol's finding is refused for a character that staff has already punished `cap.punishments` times in `cap.days`
  -- (staff_punishments, from public Acts: patrol findings and backfires that landed or are still open). Nothing is shown to anyone; the drop is recorded on the patrol's
  -- row, once per post. Only a patrol's choice meets it: a rule break, a player's report and a tail are never refused. The character's own lock makes the count and the
  -- visit one decision, so two patrols at once do not both pass a cap with room for one.
  if ch ->> 'cause' = 'patrol' then
    perform pg_advisory_xact_lock(hashtextextended('kayfabb.cap:' || p.author::text, 0));
    cap := mod_cap();
    if staff_punishments(p.author, (cap ->> 'days')::integer) >= (cap ->> 'punishments')::integer then
      if charge ->> 'patrol_id' ~ '^[0-9]{1,18}$' then
        patrol := (charge ->> 'patrol_id')::bigint;
        update patrols x set dropped = x.dropped || jsonb_build_array(jsonb_build_object('post', post_act, 'why', 'cap', 'staff', start_visit.staff))
        where x.id = patrol and not x.dropped @> jsonb_build_array(jsonb_build_object('post', post_act::text, 'why', 'cap'));
      end if;
      return jsonb_build_object('visit', null, 'capped', true);
    end if;
  end if;
  -- The open row is taken for update: a filing (or any end) holding it makes this wait, and then it finds the visit gone and decides afresh, never joining a visit that
  -- has ended.
  select o.visit_act into open_visit from visits_open o where o.post = post_act for update;
  same := visit_charge_repeats(post_act, ch);
  if same then
    return case when open_visit is not null then jsonb_build_object('visit', open_visit, 'joined', false) else jsonb_build_object('visit', null, 'repeat', true) end;
  end if;
  if open_visit is not null then
    -- A second charge joins; the band the visit holds is the highest of its charges.
    held := visit_charges(open_visit);
    top := (select c ->> 'band' from jsonb_array_elements(held || jsonb_build_array(ch)) c
            order by case c ->> 'band' when 'severe' then 3 when 'moderate' then 2 else 1 end desc limit 1);
    joined := (write_staff_act(staff, 'visit_join', p.thread, open_visit, jsonb_build_object('charge', ch, 'band', top)) ->> 'id')::uuid;
    return jsonb_build_object('visit', open_visit, 'joined', true, 'join', joined);
  end if;
  ends := now() + visit_window(post_act, staff);
  written := (write_staff_act(staff, 'visit', p.thread, post_act, jsonb_build_object(
    'charges', jsonb_build_array(ch), 'ends_at', ends, 'challenge', visit_challenge(post_act, staff), 'line', visit_line('visitArrived', staff, jsonb_build_array(ch)))) ->> 'id')::uuid;
  -- A trap set on the post springs when a visit starts on it, and the sprung trap ends the visit (trapped, by the spring): its Acts stay.
  sprung := spring_traps('visit', post_act, written);
  if sprung is not null then
    perform end_visit(written, 'trapped', (sprung ->> 'id')::uuid, 'A trap set on this post sprang as the visit began, and the visit ended.');
  end if;
  return jsonb_build_object('visit', written, 'joined', false, 'ends_at', ends) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;
comment on function start_visit(uuid, text, jsonb) is 'Opens, joins or declines a visit on a post. Every no-visit is an object with visit: null and one flag naming why (staff, veiled, repeat, capped); every caller reads visit.';

-- -------------------------------------------------------------------------------------------- 3. pay_report_back ----

-- The price of a report going back to the account that paid it: the row naming why, and the wallet move where the price was above zero. It takes no lock and checks nothing: its callers (close_report for a
-- no-visit verdict, refund_report for a failed or stale report) hold the report's lock and have decided.
create function pay_report_back(report_act uuid, why text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  paid record;
  amount integer;
begin
  select w.account, -w.change as price into paid from wallet_events w where w.kind = 'report' and w.ref = pay_report_back.report_act;
  amount := coalesce(paid.price, 0);
  insert into report_refunds (report_act, amount, why) values (pay_report_back.report_act, amount, pay_report_back.why);
  if amount > 0 then perform wallet_move(paid.account, amount, 'refund', null, pay_report_back.report_act); end if;
  return amount;
end $$;
revoke execute on function pay_report_back(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------- 4. refund_report ----

-- refund_report (0107_reports), refusing a `why` other than failed or stale, and paying through pay_report_back. Everything else as 0107 wrote it.
create or replace function refund_report(report_act uuid, why text default 'failed') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r acts%rowtype;
  amount integer;
begin
  -- A no-visit refund (veiled, visited) is written by close_report beside its verdict and by nothing else, so no call can write one without it.
  if refund_report.why is not null and refund_report.why not in ('failed', 'stale') then
    raise exception 'refund_report refunds a failed or a stale report, not %', refund_report.why using errcode = '22023';
  end if;
  select * into r from acts a where a.id = refund_report.report_act and a.kind = 'report';
  if not found then raise exception 'there is no such report' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.report.' || r.id::text, 0));
  if exists (select 1 from acts a where a.kind = 'report_verdict' and a.target_act_id = r.id) then
    return jsonb_build_object('refunded', false, 'closed', true);
  end if;
  if exists (select 1 from report_refunds f where f.report_act = r.id) then
    return jsonb_build_object('refunded', false, 'already', true);
  end if;
  amount := pay_report_back(r.id, coalesce(refund_report.why, 'failed'));
  return jsonb_build_object('refunded', true, 'amount', amount);
end $$;
revoke execute on function refund_report(uuid, text) from public, anon, authenticated;
grant execute on function refund_report(uuid, text) to service_role;

-- ----------------------------------------------------------------------------------------------- 5. close_report ----

-- close_report (0107_reports). The invariant: a report ends in exactly one of three ways, each decided under the report's own advisory lock: a verdict alone; a refund alone, why failed or stale, with no
-- verdict ever after; or a `visit` verdict with no visit_act and a refund beside it, why veiled or visited, both written here in one transaction. A refund of failed or stale is never beside a verdict, and a
-- refund of veiled or visited is never without one. So the verdict is checked before the refund (a retried close of a no-visit report answers as the first did), a visit that opened none for a reason a report
-- cannot meet raises (nothing is written and the staff function refunds the report as failed), and a backfire that opens no visit refunds nothing. Everything else as 0107 wrote it.
create or replace function close_report(report_act uuid, verdict text, line text default null, charge jsonb default null, staff text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r acts%rowtype;
  v acts%rowtype;
  thr_board uuid;
  board record;
  mod_key text;
  reporter text;
  said text := left(btrim(coalesce(close_report.line, '')), 280);
  rn integer;
  house boolean;
  rule_row rules_now%rowtype;
  ch jsonb;
  band text;
  words text;
  started jsonb;
  target uuid;
  payload jsonb;
  written uuid;
  repaired boolean := false;
  reason text;
  amount integer;
begin
  select * into r from acts a where a.id = close_report.report_act and a.kind = 'report';
  if not found then raise exception 'there is no such report' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The report's own lock: closing and refunding it are one decision, so it is closed once, or refunded once, never both.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.report.' || r.id::text, 0));
  -- The verdict is checked first: a no-visit report holds a verdict and a refund, so a refund found first would answer a retried close with "refunded before the Mod answered
  -- it", which is false. A verdict answers as it did, with its refund where it has one; a refund with no verdict is a report refunded before it was judged.
  select * into v from acts a where a.kind = 'report_verdict' and a.target_act_id = r.id;
  if found then
    return jsonb_build_object('closed', false, 'existing', true, 'verdict_act', v.id, 'verdict', v.payload ->> 'verdict') ||
      case when v.payload ? 'visit_act' then jsonb_build_object('visit', v.payload -> 'visit_act') else '{}'::jsonb end ||
      coalesce((select jsonb_build_object('refund', jsonb_build_object('why', f.why, 'amount', f.amount)) from report_refunds f where f.report_act = r.id), '{}'::jsonb);
  end if;
  if exists (select 1 from report_refunds f where f.report_act = r.id) then
    return jsonb_build_object('closed', false, 'refunded', true);
  end if;
  if close_report.verdict is null or close_report.verdict not in ('visit', 'dismissed', 'backfire') then
    raise exception 'a report is answered with a visit, a dismissal or a backfire, not %', coalesce(close_report.verdict, 'nothing') using errcode = '22023';
  end if;
  select t.board into thr_board from threads t where t.id = r.thread;
  select b.id, b.name, b.premise into board from boards_now b where b.id = thr_board;
  mod_key := case when close_report.staff is not null and exists (select 1 from staff_now n where n.staff = close_report.staff) then close_report.staff else beat_of(board.id) end;
  if mod_key is null then raise exception 'no Mod is on staff to answer a report' using errcode = '55000'; end if;
  reporter := (select c.name from characters c where c.id = r.character);

  if close_report.verdict = 'visit' then
    -- The charge, repaired: a rule in force on the board (or a house rule, when it says so) with the rule's own band, else the board's premise at the minor band.
    if jsonb_typeof(close_report.charge) = 'object' then
      if jsonb_typeof(close_report.charge -> 'rule_number') = 'number' and (close_report.charge ->> 'rule_number')::numeric = trunc((close_report.charge ->> 'rule_number')::numeric)
         and (close_report.charge ->> 'rule_number')::numeric between 1 and 100000 then
        rn := (close_report.charge ->> 'rule_number')::integer;
      end if;
      house := coalesce(close_report.charge -> 'house' = 'true'::jsonb, false);
      band := close_report.charge ->> 'band';
    end if;
    if rn is not null then
      select * into rule_row from rules_now x where x.number = rn and case when house then x.board is null else x.board = board.id end limit 1;
    end if;
    if rule_row.move_act is not null then
      select 'Rule ' || rule_row.number || ': ' || fill_tokens(x.plain, jsonb_build_object('param', coalesce(rule_row.param #>> '{}', ''))) into words from rule_predicates x where x.key = rule_row.predicate;
      if rule_row.board is null then words := 'House ' || words; end if;
      ch := jsonb_build_object('rule_number', rule_row.number, 'board', board.id, 'band', rule_row.band, 'cause', 'report', 'about_act', r.target_act_id, 'predicate', rule_row.predicate, 'rule', words);
    else
      if rn is not null or band is null or band not in ('minor', 'moderate', 'severe') then band := 'minor'; repaired := rn is not null; end if;
      ch := jsonb_build_object('rule_number', null, 'board', board.id, 'band', band, 'cause', 'report', 'about_act', r.target_act_id, 'rule', 'the premise of ' || board.name);
    end if;
    started := start_visit(r.target_act_id, mod_key, ch);
    -- A visit that opened none: the reason start_visit named, or a fault. Nothing is written for a reason a report cannot meet (the staff function then refunds the report as failed).
    if started ->> 'visit' is null then
      reason := case when started ->> 'veiled' = 'true' then 'veiled' when started ->> 'repeat' = 'true' then 'visited' end;
      if reason is null then
        raise exception 'a report''s visit opened none, for no reason a report can meet: %', started using errcode = 'P0001';
      end if;
    end if;
    said := coalesce(nullif(said, ''), visit_line('visitArrived', mod_key, jsonb_build_array(ch)));
  elsif close_report.verdict = 'dismissed' then
    said := coalesce(nullif(said, ''), report_line('reportDismissed', mod_key, reporter));
  else
    -- The reporter's latest post, charged minor with wasting the staff's time. A reporter with no post has nothing to visit: the verdict still lands.
    select a.id into target from acts a where a.character = r.character and a.kind in ('post', 'spin') order by a.created_at desc, a.id desc limit 1;
    if target is not null then
      started := start_visit(target, mod_key, jsonb_build_object('rule_number', null, 'board', (select t.board from threads t join acts a on a.thread = t.id where a.id = target), 'band', 'minor',
        'cause', 'backfire', 'about_act', target, 'rule', 'wasting the staff''s time'));
    end if;
    said := coalesce(nullif(said, ''), report_line('reportBackfired', mod_key, reporter));
  end if;

  payload := jsonb_build_object('report_act', r.id, 'verdict', close_report.verdict, 'line', said);
  if started is not null and started ->> 'visit' is not null then payload := payload || jsonb_build_object('visit_act', started ->> 'visit'); end if;
  written := (write_staff_act(mod_key, 'report_verdict', r.thread, r.id, payload) ->> 'id')::uuid;
  if reason is not null then amount := pay_report_back(r.id, reason); end if;
  return jsonb_build_object('closed', true, 'verdict_act', written, 'verdict', close_report.verdict, 'staff', mod_key, 'line', said, 'charge_repaired', repaired)
    || case when started is not null then jsonb_build_object('visit', started ->> 'visit', 'started', started) else '{}'::jsonb end
    || case when reason is not null then jsonb_build_object('refund', jsonb_build_object('why', reason, 'amount', amount)) else '{}'::jsonb end;
end $$;
revoke execute on function close_report(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function close_report(uuid, text, text, jsonb, text) to service_role;

-- --------------------------------------------------------------------------------------------------- 6. moves_log ----

-- moves_log (0329_bundles), a report row's params also saying whether its verdict opened a visit (`visited`: the verdict names a visit_act). Columns, rows and grants as 0329 left them.
create or replace view moves_log as
  select a.id, c.staff, a.payload ->> 'kind' as kind, a.payload -> 'params' as params, a.payload -> 'demand' as demand,
         move_expires_at(a.id) as expires_at, a.thread, a.created_at as at,
         e.payload ->> 'why' as ended_why, e.payload ->> 'by' as ended_by, e.created_at as ended_at,
         k.staff as kept_by, k.at as kept_at,
         bq.bundle, bq.role
  from characters c
  cross join lateral (select x.* from acts x where x.character = c.id and x.kind = 'move') a
  left join lateral (select x.* from acts x where x.kind = 'move_end' and x.target_act_id = a.id order by x.created_at desc, x.seq desc nulls last, x.id desc limit 1) e on true
  left join lateral (
    select kc.staff, ka.created_at as at from acts ka join characters kc on kc.id = ka.character
    where ka.kind = 'move_keep' and ka.target_act_id = a.id order by ka.created_at desc, ka.id desc limit 1
  ) k on true
  left join queued_moves bq on bq.landed_act = a.id
  where c.staff is not null
  union all
  select v.id, c.staff, 'visit'::text, jsonb_build_object('post', p.seq, 'rule', v.payload #>> '{charges,0,rule}', 'rule_number', v.payload #> '{charges,0,rule_number}', 'band', v.payload #>> '{charges,0,band}', 'cause', v.payload #>> '{charges,0,cause}'),
         null::jsonb, (v.payload ->> 'ends_at')::timestamptz, v.thread, v.created_at,
         case when e.payload ->> 'outcome' = 'reversed' and e.payload ->> 'by_act' is null then 'dropped' else e.payload ->> 'outcome' end, null::text, e.created_at, null::text, null::timestamptz, null::uuid, null::text
  from characters c
  join acts v on v.character = c.id and v.kind = 'visit'
  join acts p on p.id = v.target_act_id
  left join acts e on e.kind = 'visit_end' and e.target_act_id = v.id
  where c.staff is not null
  union all
  select d.id, c.staff, 'report'::text, jsonb_build_object('post', p.seq, 'verdict', d.payload ->> 'verdict', 'visited', d.payload ? 'visit_act'),
         null::jsonb, null::timestamptz, d.thread, d.created_at,
         d.payload ->> 'verdict', null::text, d.created_at, null::text, null::timestamptz, null::uuid, null::text
  from characters c
  join acts d on d.character = c.id and d.kind = 'report_verdict'
  join acts r on r.id = d.target_act_id
  join acts p on p.id = r.target_act_id
  where c.staff is not null
  union all
  select u.id, c.staff, 'appeal'::text,
         jsonb_build_object('post', (select x.seq from acts x where x.id = case when pu.kind = 'infraction' then (pu.payload ->> 'about_act')::uuid else (select (i.payload ->> 'about_act')::uuid from acts i where i.id = (pu.payload ->> 'infraction_act')::uuid) end),
                            'punishment', pu.kind, 'verdict', u.payload ->> 'verdict', 'points_delta', u.payload -> 'points_delta')
           || case when pu.kind = 'move' then jsonb_build_object('group', pu.payload #>> '{params,group}', 'until', u.payload ->> 'until') else '{}'::jsonb end,
         null::jsonb, null::timestamptz, u.thread, u.created_at,
         u.payload ->> 'verdict', null::text, u.created_at, null::text, null::timestamptz, null::uuid, null::text
  from characters c
  join acts u on u.character = c.id and u.kind = 'appeal_ruling'
  join acts ap on ap.id = u.target_act_id
  join acts pu on pu.id = ap.target_act_id
  where c.staff is not null;
