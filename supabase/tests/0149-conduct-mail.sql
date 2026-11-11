-- The moderation mail's outbox and a new account's acceptance of the code (supabase/migrations/0147_conduct_mail.sql; the conduct plan, Tasks 3 and 5):
-- decide_report and decide enqueue the author's mail for each outcome and the reporter's reportRead (the same template and facts whatever was decided),
-- a staff author is sent nothing, mail_due lists a row until a sent or refused attempt exists (a failed one backs off 2^n minutes for n failures, at most a day), the
-- bar it carries is the account's current one, never the decision's own (a row for a suspension read after a lift clears the login), the two service doors refuse a
-- player, both tables refuse update and delete, and open_account records the acceptance in the same transaction.
--
-- The poisons, each driven red once before the check was trusted:
--   * mail_for_decision replaced by a function that enqueues nothing must fail the author's-mail assertion for a nudge;
--   * mail_due replaced by a version that returns no bar must fail the banned row's bar assertion;
--   * mail_due replaced by a version that reads the decision's own outcome, as 0147 first did, must fail the stale-row assertion (a suspension after a lift);
--   * mail_due replaced by a version that ignores 'refused' or the backoff must fail the attempts assertions.

create function tests.refusal(stmt text) returns text language plpgsql as $$
declare state text; msg text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || '|' || msg;
end $$;
grant execute on function tests.refusal(text) to authenticated, service_role;

create function tests.claims(account uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', account, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  admin_a uuid := tests.account('mail-admin');
  author uuid := tests.account('mail-author');
  rep uuid := tests.account('mail-reporter');
  ch_author uuid := tests.character(author, 'Ada');
  ch_rep uuid := tests.character(rep, 'Bo');
  boss uuid;
  th uuid := tests.thread('Mail');
  p uuid; pb uuid; e uuid;
  r bigint;
  o text;
  outs text[] := array['none', 'nudge', 'hide', 'hideUntilEdited', 'suspend', 'ban', 'close'];
  want text[] := array[null, 'nudge', 'hidden', 'hiddenUntilEdited', 'suspended', 'banned', null];
  i integer;
  last_id bigint;
  seen text;
  expected text;
  row_ record;
  got jsonb;
  n integer;
  newcomer uuid := gen_random_uuid();
  banned_acct uuid := tests.account('mail-banned');
  susp_acct uuid := tests.account('mail-suspended');
  lifted_acct uuid := tests.account('mail-lifted');
  lapsed_acct uuid := tests.account('mail-lapsed');
  ids bigint[];
  due_ids bigint[];
begin
  insert into admins (account) values (admin_a);
  p := tests.post(ch_author, th, 'Words that were reported.', now() - interval '1 hour');
  insert into characters (name, staff, staff_kind, debuted_at) values ('Mail Boss', 'mail-boss', 'persona', now()) returning id into boss;
  perform set_config('kayfabb.staff_writer', 'on', true);
  pb := tests.act(boss, 'post', th, '{"body": "A Boss."}', null, now() - interval '30 minutes');
  perform tests.claims(admin_a);

  -- ---- decide_report: the reporter's mail is the same for every outcome; the author's is the outcome's ----
  for i in 1 .. array_length(outs, 1) loop
    perform tests.claims(rep);
    insert into conduct_reports (reporter, version_act, section, note) values (rep, p, 'mask', 'because') returning id into r;
    perform tests.claims(admin_a);
    last_id := (select coalesce(max(id), 0) from mail_outbox);
    perform decide_report(r, jsonb_build_array(jsonb_build_object('outcome', outs[i], 'until', case when outs[i] = 'suspend' then now() + interval '3 days' end, 'note', 'an admin''s note')));
    select count(*) into n from mail_outbox m where m.id > last_id and m.account = rep and m.template = 'reportRead' and m.facts = '{}'::jsonb;
    if n <> 1 then raise exception 'outcome %: the reporter should get one reportRead with facts {}, got %', outs[i], n; end if;
    select count(*) into n from mail_outbox m where m.id > last_id and m.account = author;
    if want[i] is null and n <> 0 then raise exception 'outcome %: the author should be sent nothing, got %', outs[i], n; end if;
    if want[i] is not null then
      select * into row_ from mail_outbox m where m.id > last_id and m.account = author;
      if n <> 1 or row_.template is distinct from want[i] then raise exception 'outcome %: the author should get one %, got % (%)', outs[i], want[i], n, row_.template; end if;
      if row_.decision is null then raise exception 'the author''s mail names its decision'; end if;
      if (row_.facts ->> 'section') is distinct from 'mask' or (row_.facts ->> 'note') is distinct from 'an admin''s note' or row_.facts ->> 'conduct' is distinct from '/conduct' then
        raise exception 'outcome %: the facts carry the section key, the note and the code''s path, got %', outs[i], row_.facts;
      end if;
      if (row_.facts ? 'words') is distinct from (want[i] in ('hidden', 'hiddenUntilEdited')) or (row_.facts ? 'until') is distinct from (want[i] = 'suspended') then
        raise exception 'outcome %: the slots are the template''s, got %', outs[i], row_.facts;
      end if;
      if want[i] = 'hidden' and row_.facts ->> 'words' is distinct from 'Words that were reported.' then raise exception 'a hidden mail carries the author''s own words'; end if;
      if (row_.facts ->> 'post') not like '/t/' || th || '?page=1#post-%' or (row_.facts ->> 'thread') is distinct from '/t/' || th then raise exception 'post and thread are paths, got %', row_.facts; end if;
    end if;
  end loop;
  -- The facts of every reportRead are identical (the same bytes whatever was decided), and so is its template.
  if (select count(distinct (m.template, m.facts::text)) from mail_outbox m where m.template = 'reportRead') is distinct from 1 then raise exception 'the reporter''s mail differs by outcome'; end if;

  -- ---- decide with no report: the author's mail, lift's too, nothing for unhide or approve ----
  for o in select unnest(array['nudge', 'hide', 'hideUntilEdited', 'suspend', 'ban', 'lift', 'unhide', 'approve', 'none', 'close']) loop
    last_id := (select coalesce(max(id), 0) from mail_outbox);
    perform decide(author, p, o, case when o = 'suspend' then now() + interval '2 days' end, 'a note');
    select count(*) into n from mail_outbox m where m.id > last_id;
    if o in ('unhide', 'approve', 'none', 'close') then
      if n <> 0 then raise exception 'decide % should send nothing, sent %', o, n; end if;
    else
      select m.template into seen from mail_outbox m where m.id > last_id and m.account = author;
      expected := case o when 'hide' then 'hidden' when 'hideUntilEdited' then 'hiddenUntilEdited' when 'suspend' then 'suspended' when 'ban' then 'banned' when 'lift' then 'lifted' else o end;
      if n <> 1 or seen is distinct from expected then
        raise exception 'decide % sent % (%)', o, n, seen;
      end if;
    end if;
  end loop;
  if (select m.facts from mail_outbox m where m.template = 'lifted' limit 1) is distinct from '{"conduct": "/conduct"}'::jsonb then raise exception 'a lifted mail carries only the code''s path'; end if;

  -- ---- A staff author has no account: a hide of a Boss's post sends nothing to anyone ----
  insert into conduct_reports (reporter, version_act, section) values (rep, pb, 'hate') returning id into r;
  last_id := (select coalesce(max(id), 0) from mail_outbox);
  perform decide_report(r, '[{"outcome": "hide"}]');
  select count(*) into n from mail_outbox m where m.id > last_id and m.template <> 'reportRead';
  if n <> 0 then raise exception 'a staff author was sent mail'; end if;

  -- ---- mail_due: oldest first, with the bar, until an ok attempt exists; the doors are the service's ----
  perform tests.become_service();
  select count(*) into n from mail_due(1000) d where d.id in (select id from mail_outbox);
  if n <> (select count(*) from mail_outbox) then raise exception 'every unsent row is due, got % of %', n, (select count(*) from mail_outbox); end if;
  if (select array_agg(d.id order by d.id) from mail_due(1000) d) is distinct from (select array_agg(d.id) from (select id from mail_due(1000) order by id) d) then raise exception 'not oldest first'; end if;
  if (select count(*) from mail_due(2)) is distinct from 2 then raise exception 'mail_due(most) caps the rows'; end if;
  -- The bar is the account's current one, whatever decision wrote the row: `author`'s decisions above end in a lift, so every bar-carrying row of that account clears the login.
  if exists (select 1 from mail_due(1000) d where d.account = author and d.template in ('suspended', 'banned', 'lifted') and d.bar is distinct from '{"outcome": "lift", "until": null}'::jsonb) then
    raise exception 'a stale suspension or ban row of a lifted account does not clear: %', (select jsonb_agg(d.bar) from mail_due(1000) d where d.account = author and d.template in ('suspended', 'banned', 'lifted'));
  end if;
  if not exists (select 1 from mail_due(1000) d where d.account = author and d.template = 'suspended') or not exists (select 1 from mail_due(1000) d where d.account = author and d.template = 'banned') then
    raise exception 'the stale-row check has no suspended and banned rows to read';
  end if;
  if exists (select 1 from mail_due(1000) d where d.template in ('nudge', 'hidden', 'hiddenUntilEdited', 'reportRead') and d.bar is not null) then raise exception 'only suspend, ban and lift carry a bar'; end if;
  perform tests.unbecome();

  -- A fresh account for each current bar: a ban, a suspension to come, a suspension then a lift, and a suspension that has ended.
  perform tests.claims(admin_a);
  perform decide(banned_acct, null, 'ban', null, '');
  perform decide(susp_acct, null, 'suspend', now() + interval '3 days', '');
  perform decide(lifted_acct, null, 'suspend', now() + interval '3 days', '');
  perform decide(lifted_acct, null, 'lift', null, '');
  insert into conduct_decisions (account, admin, outcome, until, note) values (lapsed_acct, admin_a, 'suspend', now() - interval '1 hour', 'ended') returning id into last_id;
  perform mail_for_decision(last_id);
  perform tests.become_service();
  select d.bar into got from mail_due(1000) d where d.account = banned_acct and d.template = 'banned';
  if got ->> 'outcome' is distinct from 'ban' or got -> 'until' is distinct from 'null'::jsonb then raise exception 'a banned account''s row carries the ban, got %', got; end if;
  select d.bar into got from mail_due(1000) d where d.account = susp_acct and d.template = 'suspended';
  if got ->> 'outcome' is distinct from 'suspend' or (got ->> 'until')::timestamptz is distinct from (select x.until from conduct_decisions x where x.account = susp_acct and x.outcome = 'suspend') then raise exception 'a suspended account''s row carries its end, got %', got; end if;
  if (select d.bar from mail_due(1000) d where d.account = lifted_acct and d.template = 'suspended') ->> 'outcome' is distinct from 'lift' then raise exception 'a suspension row read after a lift must clear, not ban'; end if;
  if (select d.bar from mail_due(1000) d where d.account = lifted_acct and d.template = 'lifted') ->> 'outcome' is distinct from 'lift' then raise exception 'a lifted row carries the lift'; end if;
  if (select d.bar from mail_due(1000) d where d.account = lapsed_acct and d.template = 'suspended') ->> 'outcome' is distinct from 'lift' then raise exception 'a suspension that has ended clears the login'; end if;
  perform tests.unbecome();

  -- ---- Attempts: sent and refused are final, a failure backs off 2^n minutes (n failures, at most a day) ----
  insert into mail_outbox (account, template) select author, 'reportRead' from generate_series(1, 6);
  select array_agg(m.id order by m.id) into ids from (select id from mail_outbox order by id desc limit 6) m;
  perform tests.become_service();
  seen := tests.refusal(format('select record_mail_attempt(%s, %L, null, null)', ids[1], 'ok'));
  if seen is null or seen not like '23514|%' then raise exception 'an attempt of an unknown kind was recorded: %', seen; end if;
  perform tests.unbecome();
  -- Row 1: sent. Row 2: refused. Row 3: one failure a minute ago (backs off 2 minutes). Row 4: one failure 3 minutes ago (due). Row 5: two failures, the last 3 minutes ago (backs off 4). Row 6: 20 failures.
  perform tests.become_service();
  perform record_mail_attempt(ids[1], 'sent', 'prov-1', null);
  perform record_mail_attempt(ids[2], 'refused', null, 'HTTP 422 bad address');
  perform tests.unbecome();
  insert into mail_attempts (outbox, at, kind, error) values
    (ids[3], now() - interval '1 minute', 'failed', 'x'),
    (ids[4], now() - interval '3 minutes', 'failed', 'x'),
    (ids[5], now() - interval '1 hour', 'failed', 'x'), (ids[5], now() - interval '3 minutes', 'failed', 'x');
  insert into mail_attempts (outbox, at, kind, error) select ids[6], now() - interval '23 hours', 'failed', 'x' from generate_series(1, 20);
  perform tests.become_service();
  select array_agg(d.id order by d.id) into due_ids from mail_due(1000) d where d.id = any (ids);
  perform tests.unbecome();
  if due_ids is distinct from array[ids[4]] then raise exception 'only the row whose backoff has passed is due, got % of %', due_ids, ids; end if;
  -- The cap: 20 failures are a day's backoff, not 2^20 minutes; 25 hours after the last it is due again.
  insert into mail_attempts (outbox, at, kind, error) values (ids[6], now() - interval '25 hours', 'failed', 'x');
  -- (that attempt is older than the 23-hour ones, so the last failure is still 23 hours ago: not yet due)
  perform tests.become_service();
  if exists (select 1 from mail_due(1000) d where d.id = ids[6]) then raise exception 'a row failed 21 times 23 hours ago is due before its day is out'; end if;
  perform tests.unbecome();
  insert into mail_outbox (account, template) values (author, 'reportRead') returning id into last_id;
  insert into mail_attempts (outbox, at, kind, error) select last_id, now() - interval '25 hours', 'failed', 'x' from generate_series(1, 20);
  perform tests.become_service();
  if not exists (select 1 from mail_due(1000) d where d.id = last_id) then raise exception 'a row failed 20 times, the last 25 hours ago, is not due again: the cap is a day'; end if;
  -- A sent or refused attempt ends it, even after failures.
  perform record_mail_attempt(ids[4], 'refused', null, 'HTTP 422');
  perform record_mail_attempt(last_id, 'sent', 'prov-2', null);
  if exists (select 1 from mail_due(1000) d where d.id in (ids[4], last_id)) then raise exception 'a refused or sent row is due again'; end if;
  perform tests.unbecome();

  -- A player reaches neither door, and an admin is a player here; a visitor neither.
  perform tests.become(author);
  seen := tests.refusal('select * from mail_due(10)');
  if seen is null or seen not like '42501|%' then raise exception 'a player read mail_due: %', seen; end if;
  seen := tests.refusal(format('select record_mail_attempt(%s, ''sent'', ''x'', null)', last_id));
  if seen is null or seen not like '42501|%' then raise exception 'a player recorded an attempt: %', seen; end if;
  seen := tests.refusal('select * from mail_outbox');
  if seen is null or seen not like '42501|%' then raise exception 'a player read the outbox: %', seen; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  seen := tests.refusal('select * from mail_due(10)');
  if seen is null or seen not like '42501|%' then raise exception 'a visitor read mail_due: %', seen; end if;
  perform tests.unbecome();

  -- ---- Append-only ----
  seen := tests.refusal('update mail_outbox set template = ''lifted''');
  if seen is null or seen not like 'P0001|%never edited%' then raise exception 'mail_outbox was updated: %', seen; end if;
  seen := tests.refusal('delete from mail_outbox');
  if seen is null or seen not like 'P0001|%never edited%' then raise exception 'mail_outbox was deleted from: %', seen; end if;
  seen := tests.refusal('truncate mail_outbox');
  -- (A referenced table is refused by Postgres itself before the guard is asked; either way it is refused.)
  if seen is null then raise exception 'mail_outbox was truncated'; end if;
  seen := tests.refusal('update mail_attempts set kind = ''failed''');
  if seen is null or seen not like 'P0001|%never edited%' then raise exception 'mail_attempts was updated: %', seen; end if;
  seen := tests.refusal('delete from mail_attempts');
  if seen is null or seen not like 'P0001|%never edited%' then raise exception 'mail_attempts was deleted from: %', seen; end if;
  seen := tests.refusal('truncate mail_attempts');
  if seen is null or seen not like 'P0001|%' then raise exception 'mail_attempts was truncated: %', seen; end if;

  -- ---- The job ----
  if (select schedule from cron.job where jobname = 'kayfabb-mail') is distinct from '* * * * *' then raise exception 'the mail job runs every minute'; end if;
  if (select command from cron.job where jobname = 'kayfabb-mail') not like '%/functions/v1/mail%kayfabb_jobs_key%' then raise exception 'the mail job calls the mail function with the jobs key'; end if;

  -- ---- Task 5: open_account records the acceptance of the code ----
  update settings set value = '"open"' where key = 'registrationMode';
  insert into auth.users (id, email) values (newcomer, 'mail-new@test.invalid');
  perform tests.claims(newcomer);
  if (open_account(null) ->> 'opened')::boolean is not true then raise exception 'the account should open'; end if;
  if not exists (select 1 from conduct_acceptances c where c.account = newcomer and c.version = (select (value #>> '{}')::integer from settings where key = 'conductVersion')) then
    raise exception 'open_account should record the acceptance of the current version';
  end if;
  if (open_account(null) ->> 'opened')::boolean is not false then raise exception 'a second call changes nothing'; end if;
  if (select count(*) from conduct_acceptances c where c.account = newcomer) is distinct from 1 then raise exception 'one acceptance, once'; end if;
end $$;
