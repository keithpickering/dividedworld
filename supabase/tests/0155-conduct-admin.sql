-- The admin screen's reads (supabase/migrations/0150_conduct_admin.sql; the conduct plan, Task 7) and staff posts (Task 8): admin_reports and
-- admin_failed_mail refuse a player and an anonymous caller and answer an admin; an open report carries the version's words, its section, note and
-- author's account and that account's past decisions, and never the reporter; a decided report leaves the list; a post edited after a first
-- hide-until-edited is on the re-review list until an admin decides again; mail whose latest attempt failed or was refused is listed, and mail
-- waiting for an admin address says so, plainly, only while none is set. A staff post's version is reported and hidden as any, and no mail
-- goes to a staff author (it has no account).
--
-- The author's own reads (Task 6): my_hidden_version gives the words of a version hidden until edited to its author and to no one else, says "waiting" for an edit
-- an admin has yet to look at (with the author's own words, so Edit can start from them), and says nothing for a version an admin hid outright or one that shows; my_open_reports counts the caller's own.
--
-- The poison, driven red once on the migration before the check was trusted:
--   * admin_reports with its only_admins call removed must fail the player's refusal check.
--   * (Task 6, written with the function; not yet driven red on a poisoned migration) my_hidden_version with its owner check removed must fail "another player read the author's words".

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
  p1 uuid; p2 uuid; e1 uuid; e2 uuid; e3 uuid; p3 uuid; p4 uuid; boss uuid; pb uuid;
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
  if got ->> 'moreReports' is distinct from 'false' or got ->> 'moreReviews' is distinct from 'false' then raise exception 'two reports are no more than a page: %', got; end if;
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

  -- ---- The author's own words (my_hidden_version) ----
  p3 := tests.post(ch_author, th, 'Words that go too far.', now() - interval '20 minutes');
  perform tests.become(author);
  if my_hidden_version(p3) is not null then raise exception 'a post that shows has no hidden version'; end if;
  perform tests.unbecome();
  perform tests.claims(admin_a);
  perform decide(null, p3, 'hideUntilEdited', null, '');
  perform tests.unbecome();
  perform tests.become(author);
  got := my_hidden_version(p3);
  perform tests.unbecome();
  if got ->> 'status' is distinct from 'hiddenUntilEdited' or got ->> 'words' is distinct from 'Words that go too far.' or got ->> 'version' is distinct from p3::text then
    raise exception 'the author reads their own words, hidden until edited: %', got;
  end if;
  perform tests.become(rep);
  got := my_hidden_version(p3);
  perform tests.unbecome();
  if got is not null then raise exception 'another player read the author''s words: %', got; end if;
  perform tests.become(admin_a);
  got := my_hidden_version(p3);
  perform tests.unbecome();
  if got is not null then raise exception 'only the author reads their words through it, an admin has admin_version: %', got; end if;
  -- The first edit shows at once, so there is nothing hidden to read; the edit's own id answers the same as its post.
  e2 := tests.act(ch_author, 'edit', th, '{"body": "Softer words."}', p3, now() + interval '1 minute');
  perform tests.become(author);
  if my_hidden_version(p3) is not null or my_hidden_version(e2) is not null then raise exception 'an edit that shows has no hidden version'; end if;
  perform tests.unbecome();
  -- A second hide until edited, on that edit: the author reads the edit's words; an edit after it waits for an admin, and is the author's own words too.
  perform tests.claims(admin_a);
  perform decide(null, e2, 'hideUntilEdited', null, '');
  perform tests.unbecome();
  perform tests.become(author);
  got := my_hidden_version(e2);
  perform tests.unbecome();
  if got ->> 'status' is distinct from 'hiddenUntilEdited' or got ->> 'words' is distinct from 'Softer words.' then raise exception 'the second hide shows the author the edit''s words: %', got; end if;
  e3 := tests.act(ch_author, 'edit', th, '{"body": "Softest words."}', p3, now() + interval '2 minutes');
  perform tests.become(author);
  got := my_hidden_version(p3);
  perform tests.unbecome();
  if got ->> 'status' is distinct from 'waiting' or got ->> 'version' is distinct from e3::text or got ->> 'words' is distinct from 'Softest words.' then raise exception 'an edit after a second hide waits, carrying the author''s own words: %', got; end if;
  perform tests.become(rep);
  if my_hidden_version(p3) is not null then raise exception 'another player read the waiting state'; end if;
  perform tests.unbecome();
  perform tests.claims(admin_a);
  perform decide(null, e3, 'approve', null, '');
  perform tests.unbecome();
  perform tests.become(author);
  if my_hidden_version(p3) is not null then raise exception 'an approved edit shows'; end if;
  perform tests.unbecome();
  -- A version an admin hid outright is not the author's to read back: it has its own way out (an unhide).
  p4 := tests.post(ch_author, th, 'Hidden outright.', now() - interval '10 minutes');
  perform tests.claims(admin_a);
  perform decide(null, p4, 'hide', null, '');
  perform tests.unbecome();
  perform tests.become(author);
  if my_hidden_version(p4) is not null then raise exception 'a version hidden outright is not read back to its author'; end if;
  perform tests.unbecome();
  -- any_hidden is the predicate a quote's note stands on: a post with any version hidden, though its current version shows (p3's first version was hidden until edited), and not one never decided on.
  if (select a.any_hidden from acts_public a where a.id = p3) is distinct from true or (select a.hidden from acts_public a where a.id = p3) is distinct from false then raise exception 'p3 shows, with an older version hidden'; end if;
  if (select a.any_hidden from acts_public a where a.id = p4) is distinct from true then raise exception 'p4 is hidden'; end if;
  if (select a.any_hidden from acts_public a where a.id = p1) is distinct from false then raise exception 'a post with nothing hidden is not any_hidden'; end if;

  -- ---- The caller's own open reports ----
  perform tests.become(rep);
  n := my_open_reports();
  perform tests.unbecome();
  select count(*) into ob from conduct_reports r where r.reporter = rep and not exists (select 1 from conduct_decisions d where d.report = r.id);
  if n <> ob or n < 1 then raise exception 'my_open_reports counts the caller''s own open reports: % against %', n, ob; end if;
  perform tests.become(author);
  if my_open_reports() <> 0 then raise exception 'my_open_reports counted another account''s reports'; end if;
  perform tests.unbecome();

  -- ---- Bounds: a page of 50 open reports, newest first, and a flag that more wait ----
  select count(*) into n from conduct_reports r where not exists (select 1 from conduct_decisions d where d.report = r.id);
  insert into conduct_reports (reporter, version_act, section, note) select rep, p1, 'hate', 'bulk ' || g from generate_series(1, 60 - n) g;
  perform tests.become(admin_a);
  got := admin_reports();
  perform tests.unbecome();
  if jsonb_array_length(got -> 'reports') <> 50 or got ->> 'moreReports' is distinct from 'true' then raise exception 'a page is 50 and says more wait: % %', jsonb_array_length(got -> 'reports'), got ->> 'moreReports'; end if;
  if (got -> 'reports' -> 0 ->> 'id')::bigint < (got -> 'reports' -> 49 ->> 'id')::bigint then raise exception 'newest first'; end if;
  if got::text like '%' || rep::text || '%' or got::text like '%reporter%' then raise exception 'the reporter reached the paged screen'; end if;

  -- ---- An author's past decisions: their last 20, newest first, read through the author's own column ----
  insert into conduct_decisions (version_act, admin, outcome, note) select p1, admin_a, 'none', 'past ' || g from generate_series(1, 25) g;
  perform tests.become(admin_a);
  got := admin_reports();
  perform tests.unbecome();
  if jsonb_array_length(got -> 'reports' -> 0 -> 'past') <> 20 or got -> 'reports' -> 0 -> 'past' -> 0 ->> 'note' is distinct from 'past 25' then
    raise exception 'an author''s past decisions are the last 20, newest first: %', got -> 'reports' -> 0 -> 'past';
  end if;
  if (select d.author_account from conduct_decisions d where d.note = 'past 1') is distinct from author then raise exception 'a decision on a version is about the version''s author'; end if;
  if (select d.author_account from conduct_decisions d where d.outcome = 'nudge' and d.account = author limit 1) is distinct from author then raise exception 'a decision on an account is about that account'; end if;

  -- ---- Failed mail: 200 and a flag for more ----
  select coalesce(max(id), 0) into last_id from mail_outbox;
  insert into mail_outbox (account, template, facts) select author, 'nudge', '{}' from generate_series(1, 205);
  insert into mail_attempts (outbox, at, kind, error) select id, now() - interval '1 hour' + (id - last_id) * interval '1 second', 'failed', 'bulk' from mail_outbox where id > last_id;
  perform tests.become(admin_a);
  got := admin_failed_mail();
  perform tests.unbecome();
  if jsonb_array_length(got -> 'failed') <> 200 or got ->> 'moreFailed' is distinct from 'true' then raise exception 'failed mail is a page of 200 with a flag: % %', jsonb_array_length(got -> 'failed'), got ->> 'moreFailed'; end if;
end $$;
