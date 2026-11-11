-- The admin screen's reads (supabase/migrations/0150_conduct_admin.sql; the conduct plan, Task 7) and staff posts (Task 8): admin_reports and
-- admin_failed_mail refuse a player and an anonymous caller and answer an admin; an open report carries the version's words, its section, note and
-- author's account and that account's past decisions, and never the reporter; a decided report leaves the list; a post edited after a first
-- hide-until-edited is on the re-review list until an admin decides again; mail whose latest attempt failed or was refused is listed, and mail
-- waiting for an admin address says so, plainly, only while none is set. A staff post's version is reported and hidden as any, and no mail
-- goes to a staff author (it has no account).
--
-- The poison, driven red once on the migration before the check was trusted:
--   * admin_reports with its only_admins call removed must fail the player's refusal check.

create function tests.refusal(stmt text) returns text language plpgsql as $$
declare state text; hint text; msg text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics state = returned_sqlstate, hint = pg_exception_hint, msg = message_text;
  return state || '|' || coalesce(hint, '') || '|' || msg;
end $$;
grant execute on function tests.refusal(text) to authenticated, anon;

-- As an account's claims, but still the harness's role: the writers that ask auth.uid() are called as the harness, which is how a test calls a function the API roles cannot reach.
create function tests.claims(account uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', account, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  admin_a uuid := tests.account('adm-admin');
  author uuid := tests.account('adm-author');
  rep uuid := tests.account('adm-reporter');
  ch_author uuid := tests.character(author, 'Ada');
  th uuid := tests.thread('Admin');
  p1 uuid; p2 uuid; e1 uuid; boss uuid; pb uuid;
  r1 bigint; r2 bigint; rb bigint;
  got jsonb;
  seen text;
  n integer;
  ob bigint; ob2 bigint; ob3 bigint;
  last_id bigint;
begin
  insert into admins (account) values (admin_a);
  p1 := tests.post(ch_author, th, 'Reported words.', now() - interval '2 hours');
  p2 := tests.post(ch_author, th, 'Other words.', now() - interval '1 hour');

  -- ---- A player and a visitor are refused ----
  perform tests.become(rep);
  seen := tests.refusal('select admin_reports()');
  if seen is null or seen not like '42501|kayfabb.refusal|%' then raise exception 'a player read admin_reports: %', seen; end if;
  seen := tests.refusal('select admin_failed_mail()');
  if seen is null or seen not like '42501|kayfabb.refusal|%' then raise exception 'a player read admin_failed_mail: %', seen; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  seen := tests.refusal('select admin_reports()');
  if seen is null then raise exception 'a visitor read admin_reports'; end if;
  seen := tests.refusal('select admin_failed_mail()');
  if seen is null then raise exception 'a visitor read admin_failed_mail'; end if;
  perform tests.unbecome();

  -- ---- Open reports, newest first, with the version's words, the section, the note, the author's account and its past decisions ----
  perform tests.become(rep);
  r1 := report_post(p1, 'mask', 'a note on one');
  r2 := report_post(p2, 'hate', null);
  perform tests.unbecome();
  perform tests.become(admin_a);
  got := admin_reports();
  perform tests.unbecome();
  if jsonb_array_length(got -> 'reports') <> 2 then raise exception 'two open reports expected, got %', got; end if;
  if (got -> 'reports' -> 0 ->> 'id')::bigint <> r2 or (got -> 'reports' -> 1 ->> 'id')::bigint <> r1 then raise exception 'newest first expected, got %', got -> 'reports'; end if;
  if got -> 'reports' -> 1 ->> 'words' is distinct from 'Reported words.' then raise exception 'the version''s words are missing: %', got -> 'reports' -> 1; end if;
  if got -> 'reports' -> 1 ->> 'versionAct' is distinct from p1::text or got -> 'reports' -> 1 ->> 'post' is distinct from p1::text or got -> 'reports' -> 1 ->> 'thread' is distinct from th::text then raise exception 'ids: %', got -> 'reports' -> 1; end if;
  if got -> 'reports' -> 1 ->> 'section' is distinct from 'mask' or got -> 'reports' -> 1 ->> 'note' is distinct from 'a note on one' then raise exception 'section and note: %', got -> 'reports' -> 1; end if;
  if got -> 'reports' -> 1 ->> 'author' is distinct from author::text then raise exception 'the author''s account: %', got -> 'reports' -> 1; end if;
  if got::text like '%' || rep::text || '%' or got::text like '%reporter%' then raise exception 'the reporter reached the screen: %', got; end if;
  if jsonb_typeof(got -> 'reports' -> 1 -> 'past') is distinct from 'array' or jsonb_array_length(got -> 'reports' -> 1 -> 'past') <> 0 then raise exception 'no past decisions yet: %', got -> 'reports' -> 1; end if;

  -- ---- A decided report leaves the list; the author's past decisions show on the next ----
  perform tests.claims(admin_a);
  perform decide_report(r1, '[{"outcome": "nudge", "note": "easy now"}]');
  perform tests.unbecome();
  perform tests.become(admin_a);
  got := admin_reports();
  perform tests.unbecome();
  if jsonb_array_length(got -> 'reports') <> 1 or (got -> 'reports' -> 0 ->> 'id')::bigint <> r2 then raise exception 'a decided report stayed on the list: %', got -> 'reports'; end if;
  if jsonb_array_length(got -> 'reports' -> 0 -> 'past') <> 1 or got -> 'reports' -> 0 -> 'past' -> 0 ->> 'outcome' is distinct from 'nudge'
     or got -> 'reports' -> 0 -> 'past' -> 0 ->> 'note' is distinct from 'easy now' then raise exception 'the author''s past decision: %', got -> 'reports' -> 0 -> 'past'; end if;

  -- ---- Re-review: hidden until edited, then edited, is listed until an admin decides again ----
  perform tests.claims(admin_a);
  perform decide(null, p2, 'hideUntilEdited', null, '');
  perform tests.unbecome();
  perform tests.become(admin_a);
  if jsonb_array_length(admin_reports() -> 'reviews') <> 0 then raise exception 'nothing is due before the author edits'; end if;
  perform tests.unbecome();
  e1 := tests.act(ch_author, 'edit', th, '{"body": "Better words."}', p2, now() + interval '1 minute');
  perform tests.become(admin_a);
  got := admin_reports();
  perform tests.unbecome();
  if jsonb_array_length(got -> 'reviews') <> 1 then raise exception 'the edit is due for review: %', got -> 'reviews'; end if;
  if got -> 'reviews' -> 0 ->> 'versionAct' is distinct from e1::text or got -> 'reviews' -> 0 ->> 'words' is distinct from 'Better words.'
     or got -> 'reviews' -> 0 ->> 'post' is distinct from p2::text or got -> 'reviews' -> 0 ->> 'thread' is distinct from th::text then raise exception 'the review row: %', got -> 'reviews' -> 0; end if;
  perform tests.claims(admin_a);
  perform decide(null, e1, 'approve', null, '');
  perform tests.unbecome();
  perform tests.become(admin_a);
  if jsonb_array_length(admin_reports() -> 'reviews') <> 0 then raise exception 'an approved edit stayed on the list'; end if;
  perform tests.unbecome();

  -- ---- Failed mail: the latest attempt failed or was refused; sent and unattempted rows are not listed ----
  select max(id) into last_id from mail_outbox;
  insert into mail_outbox (account, template, facts) values (author, 'nudge', '{}') returning id into ob;
  insert into mail_outbox (account, template, facts) values (author, 'banned', '{}') returning id into ob2;
  insert into mail_outbox (account, template, facts) values (author, 'lifted', '{}') returning id into ob3;
  insert into mail_attempts (outbox, at, kind, error) values (ob, now() - interval '2 minutes', 'failed', 'the provider timed out');
  insert into mail_attempts (outbox, at, kind, error) values (ob2, now() - interval '2 minutes', 'failed', 'a first failure');
  insert into mail_attempts (outbox, at, kind, error) values (ob2, now() - interval '1 minute', 'sent', null);
  perform tests.become(admin_a);
  got := admin_failed_mail();
  perform tests.unbecome();
  select count(*) into n from jsonb_array_elements(got -> 'failed') f where (f ->> 'id')::bigint > coalesce(last_id, 0);
  if n <> 1 then raise exception 'one row failed its last attempt: %', got; end if;
  if not exists (select 1 from jsonb_array_elements(got -> 'failed') f where (f ->> 'id')::bigint = ob and f ->> 'template' = 'nudge' and f ->> 'error' = 'the provider timed out' and f ->> 'account' = author::text and f ->> 'kind' = 'failed') then
    raise exception 'the failed row''s facts: %', got -> 'failed';
  end if;
  insert into mail_attempts (outbox, at, kind, error) values (ob3, now(), 'refused', 'no such mailbox');
  perform tests.become(admin_a);
  got := admin_failed_mail();
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(got -> 'failed') f where (f ->> 'id')::bigint = ob3 and f ->> 'kind' = 'refused') then raise exception 'a refused row is listed: %', got -> 'failed'; end if;

  -- ---- Waiting mail: with no admin address set the rows with no attempt are counted, and the screen can say so; with one set, none are waiting on it ----
  update settings set value = jsonb_set(value, '{adminAddress}', 'null') where key = 'conduct';
  insert into mail_outbox (account, template, facts) values (author, 'nudge', '{}');
  perform tests.become(admin_a);
  got := admin_failed_mail();
  perform tests.unbecome();
  if got ->> 'addressSet' is distinct from 'false' then raise exception 'the address is not set: %', got; end if;
  select count(*) into n from mail_outbox o where not exists (select 1 from mail_attempts a where a.outbox = o.id);
  if (got ->> 'waiting')::integer <> n or n < 1 then raise exception 'waiting should count rows with no attempt (%), got %', n, got; end if;
  update settings set value = jsonb_set(value, '{adminAddress}', '"admins@example.test"') where key = 'conduct';
  perform tests.become(admin_a);
  got := admin_failed_mail();
  perform tests.unbecome();
  if got ->> 'addressSet' is distinct from 'true' or (got ->> 'waiting')::integer <> 0 then raise exception 'with an address set nothing waits on it: %', got; end if;

  -- ---- Task 8, staff posts: a Boss's post is reported and hidden as any, and its author is sent nothing ----
  insert into characters (name, staff, staff_kind, debuted_at) values ('Admin Boss', 'admin-boss', 'persona', now()) returning id into boss;
  perform set_config('kayfabb.staff_writer', 'on', true);
  pb := tests.act(boss, 'post', th, '{"body": "A Boss speaks."}', null, now() - interval '30 minutes');
  perform tests.become(rep);
  rb := report_post(pb, 'hate', 'a staff post');
  perform tests.unbecome();
  perform tests.become(admin_a);
  got := admin_reports();
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(got -> 'reports') r where (r ->> 'id')::bigint = rb and r ->> 'words' = 'A Boss speaks.' and r -> 'author' = 'null'::jsonb) then
    raise exception 'a staff post lists with its words and no account: %', got -> 'reports';
  end if;
  select coalesce(max(id), 0) into last_id from mail_outbox;
  perform tests.claims(admin_a);
  perform decide_report(rb, '[{"outcome": "hide"}]');
  perform tests.unbecome();
  if (select a.hidden from acts_public a where a.id = pb) is distinct from true then raise exception 'a staff post was not hidden'; end if;
  select count(*) into n from mail_outbox m where m.id > last_id and m.template <> 'reportRead';
  if n <> 0 then raise exception 'a staff author was sent mail'; end if;
  perform tests.claims(admin_a);
  perform decide(null, pb, 'unhide', null, '');
  perform tests.unbecome();
  if (select a.hidden from acts_public a where a.id = pb) is distinct from false then raise exception 'a staff post was not unhidden'; end if;
end $$;
