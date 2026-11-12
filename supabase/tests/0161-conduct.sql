-- Reports to admins, what an admin decides and what a decision computes (supabase/migrations/0159_conduct.sql; the conduct plan, Task 2;
-- the conduct design, sections 2-5 and 8): the open-report limit, who may decide, a hidden version in acts_public, in its row and in a quote,
-- hide until edited (the author's edit the first time, an approval after), a suspension and a ban at the writers, the caller's own bar, the
-- log's read, the acceptance of the code, and the append-only tables.
--
-- The poisons, each driven red once on the migration before the check was trusted:
--   * a decision whose admin is not an admin, inserted directly, must be refused (the trigger holds it, not the functions);
--   * acts_public, read as an ordinary player, must give no words for a hidden version.

-- What a statement raises, as 'sqlstate|hint|message', or null when it ran. A helper of this file only; the rollback drops it.
create function tests.refusal(stmt text) returns text language plpgsql as $$
declare state text; hint text; msg text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics state = returned_sqlstate, hint = pg_exception_hint, msg = message_text;
  return state || '|' || coalesce(hint, '') || '|' || msg;
end $$;
grant execute on function tests.refusal(text) to authenticated;

-- As an account's claims, but still the harness's role: the writers that ask auth.uid() are called as the harness, which is how a test calls
-- a function the API roles cannot reach.
create function tests.claims(account uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', account, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  admin_a uuid := tests.account('admin-a');
  author uuid := tests.account('author');
  rep uuid := tests.account('reporter');
  other uuid := tests.account('other');
  ch_author uuid := tests.character(author, 'Ada');
  ch_rep uuid := tests.character(rep, 'Bo');
  ch_other uuid := tests.character(other, 'Cy');
  th uuid := tests.thread('Conduct');
  base timestamptz := now() - interval '1 day';
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; q uuid; e1 uuid; e2 uuid; e3 uuid; tally uuid;
  r1 bigint; r2 bigint; r3 bigint; r4 bigint;
  seen text;
  n integer;
  got jsonb;
  words text;
  hid boolean;
  rows_made bigint[];
begin
  insert into admins (account) values (admin_a);
  p1 := tests.post(ch_author, th, 'First words.', base);
  p2 := tests.post(ch_author, th, 'Second words.', base + interval '1 minute');
  p3 := tests.post(ch_author, th, 'Third words.', base + interval '2 minutes');
  p4 := tests.post(ch_other, th, 'Other words.', base + interval '3 minutes');
  tally := tests.act(null, 'tally', th, '{}', null, base);

  -- ---- The code accepted ----
  perform tests.become(rep);
  if (select conduct_accepted()) is distinct from false then raise exception 'an account that never accepted the code reads as accepted'; end if;
  perform tests.unbecome();
  perform tests.claims(rep);
  seen := tests.refusal('select accept_conduct(2)');
  perform tests.unbecome();
  perform tests.claims(rep);
  perform accept_conduct(1);
  perform accept_conduct(1);
  perform tests.unbecome();
  if (select count(*) from conduct_acceptances where account = rep) is distinct from 1 then raise exception 'accepting twice wrote % rows', (select count(*) from conduct_acceptances where account = rep); end if;
  perform tests.become(rep);
  if (select conduct_accepted()) is distinct from true then raise exception 'the account that accepted the code reads as not'; end if;
  perform tests.unbecome();
  perform tests.become(other);
  if (select conduct_accepted()) is distinct from false then raise exception 'another account''s acceptance counted'; end if;
  perform tests.unbecome();
  if seen is null or seen not like '22023|kayfabb.refusal|%' then raise exception 'accepting a version that is not the current one was not refused: %', seen; end if;

  -- ---- report_post: three open, the fourth refused, one again after a decision closes a report ----
  perform tests.become(rep);
  r1 := report_post(p1, 'mask', 'one');
  r2 := report_post(p1, 'hate', null);               -- a second report on the same version is evidence, never refused
  r3 := report_post(p4, 'outing', repeat('x', 1000));
  seen := tests.refusal(format('select report_post(%L, %L)', p2, 'mask'));
  perform tests.unbecome();
  if seen is null or seen not like '53400|kayfabb.refusal|%3 reports%' then raise exception 'the fourth open report was not refused, naming the limit: %', seen; end if;
  if (select count(*) from conduct_reports where reporter = rep) is distinct from 3 then raise exception 'a refused report was written'; end if;

  -- An admin's decision closes a report, and the account may report once more.
  perform tests.become(admin_a);
  rows_made := decide_report(r3, '[{"outcome": "none"}]');
  perform tests.unbecome();
  if cardinality(rows_made) is distinct from 1 then raise exception 'deciding a report with one outcome wrote % rows', cardinality(rows_made); end if;
  perform tests.become(rep);
  r4 := report_post(p2, 'mask', 'after');
  seen := tests.refusal(format('select report_post(%L, %L)', p3, 'mask'));
  perform tests.unbecome();
  if seen is null or seen not like '53400|%' then raise exception 'the limit was not held again after one more report: %', seen; end if;
  -- A decided report stays decided.
  perform tests.become(admin_a);
  seen := tests.refusal(format('select decide_report(%s, %L)', r3, '[{"outcome": "nudge"}]'));
  perform tests.unbecome();
  if seen is null or seen not like '55000|%' then raise exception 'a decided report was decided again: %', seen; end if;

  -- What a report names and says: a post or an edit, a section the code holds, and a signed-in account; anyone's post, one's own included.
  perform tests.become(other);
  seen := tests.refusal(format('select report_post(%L, %L)', tally, 'mask'));
  if seen is null or seen not like '23514|%' then raise exception 'a report on a tally was accepted: %', seen; end if;
  seen := tests.refusal(format('select report_post(%L, %L)', gen_random_uuid(), 'mask'));
  if seen is null or seen not like '23514|%' then raise exception 'a report on no Act was accepted: %', seen; end if;
  seen := tests.refusal(format('select report_post(%L, %L)', p1, 'no-such-section'));
  if seen is null or seen not like '23514|%' then raise exception 'a report on an unknown section was accepted: %', seen; end if;
  seen := tests.refusal(format('select report_post(%L, %L, %L)', p1, 'mask', repeat('x', 1001)));
  if seen is null or seen not like '23514|%' then raise exception 'a note over 1000 characters was accepted: %', seen; end if;
  if tests.refusal(format('select report_post(%L, %L)', p4, 'mask')) is not null then raise exception 'a report on one''s own post was refused'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  seen := tests.refusal(format('select report_post(%L, %L)', p1, 'mask'));
  perform tests.unbecome();
  if seen is null then raise exception 'a visitor reported a post'; end if;

  -- ---- Only an admin decides ----
  perform tests.become(rep);
  seen := tests.refusal(format('select decide_report(%s, %L)', r1, '[{"outcome": "hide"}]'));
  if seen is null or seen not like '42501|%' then raise exception 'a player decided a report: %', seen; end if;
  seen := tests.refusal(format('select decide(null, %L, %L)', p1, 'hide'));
  if seen is null or seen not like '42501|%' then raise exception 'a player decided: %', seen; end if;
  seen := tests.refusal(format('select admin_version(%L)', p1));
  if seen is null or seen not like '42501|%' then raise exception 'a player read a version through admin_version: %', seen; end if;
  seen := tests.refusal('select * from conduct_reports');
  if seen is null or seen not like '42501|%' then raise exception 'a player read the reports table: %', seen; end if;
  seen := tests.refusal('select * from conduct_decisions');
  if seen is null or seen not like '42501|%' then raise exception 'a player read the decisions table: %', seen; end if;
  perform tests.unbecome();
  if (select count(*) from conduct_decisions where admin <> admin_a) > 0 or (select count(*) from conduct_decisions where outcome <> 'none') > 0 then
    raise exception 'a refused decision was written';
  end if;

  -- ---- A decision's outcomes, together or not at all ----
  perform tests.become(admin_a);
  seen := tests.refusal(format('select decide_report(%s, %L)', r1, '[{"outcome": "hide"}, {"outcome": "suspend", "until": "2000-01-01T00:00:00Z"}]'));
  if seen is null or seen not like '22023|%' then raise exception 'a suspension ending in the past was accepted: %', seen; end if;
  seen := tests.refusal(format('select decide_report(%s, %L)', r1, '[{"outcome": "hide"}, {"outcome": "hideUntilEdited"}]'));
  if seen is null or seen not like '22023|%' then raise exception 'a hide with a hide until edited was accepted: %', seen; end if;
  seen := tests.refusal(format('select decide_report(%s, %L)', r1, '[{"outcome": "none"}, {"outcome": "hide"}]'));
  if seen is null or seen not like '22023|%' then raise exception 'no action with a hide was accepted: %', seen; end if;
  seen := tests.refusal(format('select decide_report(%s, %L)', r1, '[]'));
  if seen is null then raise exception 'no outcomes was accepted'; end if;
  perform tests.unbecome();
  if exists (select 1 from conduct_decisions where report = r1) then raise exception 'a refused decide_report left a row'; end if;

  -- ---- hide: acts_public's body is null and it says hidden; a hidden version's own row is not a player's ----
  perform tests.become(admin_a);
  -- A hide with a nudge is two rows, written together (a suspension is the same: its own test is below, on an account of its own).
  rows_made := decide_report(r1, '[{"outcome": "hide", "note": "n"}, {"outcome": "nudge", "note": "m"}]');
  perform tests.unbecome();
  if cardinality(rows_made) is distinct from 2 then raise exception 'a hide with a nudge wrote % rows', cardinality(rows_made); end if;
  if (select count(*) from conduct_decisions where report = r1) is distinct from 2 then raise exception 'the report names % decisions', (select count(*) from conduct_decisions where report = r1); end if;
  if (select account from conduct_decisions where report = r1 and outcome = 'nudge') is distinct from author then raise exception 'the nudge is not on the author''s account'; end if;
  if (select version_act from conduct_decisions where report = r1 and outcome = 'hide') is distinct from p1 then raise exception 'the hide is not on the reported version'; end if;
  perform tests.become(other);
  select (a.current_payload ->> 'body'), (a.payload ->> 'body'), a.hidden into words, seen, hid from acts_public a where a.id = p1;
  if words is not null or seen is not null then raise exception 'a hidden post''s words reached an ordinary player: current % original %', words, seen; end if;
  if hid is distinct from true then raise exception 'a hidden post does not say so'; end if;
  select (a.current_payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = p4;
  if words is distinct from 'Other words.' or hid is distinct from false then raise exception 'a post nobody decided on changed: % %', words, hid; end if;
  -- The table itself: a player reads no `payload` from it (words come through acts_public alone), whatever the row, so neither a hidden version's words nor the copy of them
  -- inside a post that quotes it can be read there. The rest of the row stays readable.
  seen := tests.refusal('select payload from acts');
  if seen is null or seen not like '42501|%' then raise exception 'a player read acts.payload directly: %', seen; end if;
  seen := tests.refusal('select * from acts');
  if seen is null or seen not like '42501|%' then raise exception 'a player read every column of acts: %', seen; end if;
  seen := tests.refusal(format('select a.payload from acts a where a.id = %L', p1));
  if seen is null or seen not like '42501|%' then raise exception 'a player read a hidden post''s payload directly: %', seen; end if;
  select count(*) into n from acts a where a.id = p1;
  if n is distinct from 1 then raise exception 'the rest of a hidden post''s row is not readable'; end if;
  perform tests.unbecome();
  -- Admins read the words, however hidden.
  perform tests.become(admin_a);
  if admin_version(p1) is distinct from 'First words.' then raise exception 'an admin does not read a hidden version''s words'; end if;
  select count(*) into n from acts a where a.id = p1;
  if n is distinct from 1 then raise exception 'an admin cannot read a hidden post''s row'; end if;
  perform tests.unbecome();

  -- A quote of the hidden post is emptied and keeps its id; the words around it stay; a quote of another post is whole.
  q := tests.post(ch_other, th,
    format('[quote=%s user=%s]Ada: First words.[quote]nested[/quote] more[/quote] mine [quote="%s"]kept[/quote] and [QUOTE=%s]again[/QUOTE] end', p1, ch_author, p4, upper(p1::text)),
    base + interval '5 minutes');
  perform tests.become(rep);
  select a.current_payload ->> 'body' into words from acts_public a where a.id = q;
  perform tests.unbecome();
  if words is distinct from format('[quote=%s user=%s][/quote] mine [quote="%s"]kept[/quote] and [QUOTE=%s][/QUOTE] end', p1, ch_author, p4, upper(p1::text)) then
    raise exception 'a quote of a hidden post was not emptied, or lost its id: %', words;
  end if;
  -- The body of an unhidden post with no quote, and one that quotes only a post nobody hid, is not touched.
  if (select conceal_quotes('plain [quote=' || p4 || ']x[/quote]')) is distinct from 'plain [quote=' || p4 || ']x[/quote]' then raise exception 'a quote of an unhidden post was changed'; end if;

  -- History: an edit is its own version, hidden alone. p2 is edited twice; the first edit is hidden.
  e1 := tests.act(ch_author, 'edit', th, '{"body": "Second, edited."}', p2, base + interval '10 minutes');
  e2 := tests.act(ch_author, 'edit', th, '{"body": "Second, edited again."}', p2, base + interval '11 minutes');
  perform tests.become(admin_a);
  perform decide(null, e1, 'hide', null, 'history');
  perform tests.unbecome();
  perform tests.become(other);
  select (a.payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = e1;
  if words is not null or hid is distinct from true then raise exception 'a hidden edit shows its words in History: % %', words, hid; end if;
  select (a.payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = e2;
  if words is distinct from 'Second, edited again.' or hid is distinct from false then raise exception 'an edit nobody hid is hidden: % %', words, hid; end if;
  select (a.current_payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = p2;
  if words is distinct from 'Second, edited again.' or hid is distinct from false then raise exception 'the post''s current version is not the unhidden edit: % %', words, hid; end if;
  perform tests.unbecome();

  -- unhide brings the words back.
  perform tests.become(admin_a);
  perform decide(null, p1, 'unhide', null, '');
  perform tests.unbecome();
  perform tests.become(rep);
  select (a.current_payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = p1;
  if words is distinct from 'First words.' or hid is distinct from false then raise exception 'an unhidden post is still hidden: % %', words, hid; end if;
  select a.current_payload ->> 'body' into words from acts_public a where a.id = q;
  perform tests.unbecome();
  if words not like '%First words.%' then raise exception 'a quote of an unhidden post is still emptied: %', words; end if;

  -- ---- Search: a hidden version's words match nothing, in the search or in the index a player can read ----
  declare pz uuid := tests.post(ch_author, th, 'The word is zanzibar, said once.', base + interval '6 minutes');
  begin
    perform tests.become(other);
    if jsonb_array_length(search_posts('zanzibar', null, null, null, null, false, 'newest', null, 20) -> 'results') is distinct from 1 then raise exception 'a post nobody hid is not found'; end if;
    perform tests.unbecome();
    perform tests.become(admin_a);
    perform decide(null, pz, 'hide', null, '');
    perform tests.unbecome();
    perform tests.become(other);
    if jsonb_array_length(search_posts('zanzibar', null, null, null, null, false, 'newest', null, 20) -> 'results') is distinct from 0 then raise exception 'a hidden post''s words matched a search'; end if;
    select count(*) into n from post_search ps where ps.act = pz and ps.words @@ to_tsquery('simple', 'zanzibar');
    if n is distinct from 0 then raise exception 'a hidden post''s words are in the index a player reads'; end if;
    perform tests.unbecome();
    perform tests.become(admin_a);
    perform decide(null, pz, 'unhide', null, '');
    perform tests.unbecome();
    perform tests.become(other);
    if jsonb_array_length(search_posts('zanzibar', null, null, null, null, false, 'newest', null, 20) -> 'results') is distinct from 1 then raise exception 'an unhidden post is not found again'; end if;
    perform tests.unbecome();
    -- A hide until edited, then the author's edit: the new words are found, the offending ones are not.
    perform tests.become(admin_a);
    perform decide(null, pz, 'hideUntilEdited', null, '');
    perform tests.unbecome();
    perform tests.act(ch_author, 'edit', th, '{"body": "The word is now tanganyika."}', pz, now() + interval '30 seconds');
    perform tests.become(other);
    if jsonb_array_length(search_posts('zanzibar', null, null, null, null, false, 'newest', null, 20) -> 'results') is distinct from 0 then raise exception 'an old version''s words matched after an edit'; end if;
    if jsonb_array_length(search_posts('tanganyika', null, null, null, null, false, 'newest', null, 20) -> 'results') is distinct from 1 then raise exception 'the edit that showed a post again is not found'; end if;
    perform tests.unbecome();
  end;

  -- ---- hideUntilEdited: the author's edit ends the post being hidden the first time (the offending version stays hidden), an approval the second ----
  perform tests.become(admin_a);
  perform decide(null, p3, 'hideUntilEdited', null, 'change the second line');
  perform tests.unbecome();
  perform tests.become(other);
  select (a.current_payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = p3;
  if words is not null or hid is distinct from true then raise exception 'a post hidden until edited is not hidden: % %', words, hid; end if;
  perform tests.unbecome();
  -- The author's edit brings the post back at once, and puts it on the re-review list.
  e3 := tests.act(ch_author, 'edit', th, '{"body": "Third, fixed."}', p3, now() + interval '1 minute');
  perform tests.become(other);
  select (a.current_payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = p3;
  perform tests.unbecome();
  if words is distinct from 'Third, fixed.' or hid is distinct from false then raise exception 'the author''s edit did not bring a post hidden until edited back: % %', words, hid; end if;
  perform tests.become(rep);
  -- The grant is there (a revoke without it would make this read a refusal, and Task 7's screen unreadable), and the view's own gate empties it for a player.
  if not has_table_privilege('authenticated', 'reviews_due', 'select') or has_table_privilege('anon', 'reviews_due', 'select') then raise exception 'reviews_due is not granted to signed-in players alone'; end if;
  if (select count(*) from reviews_due) is distinct from 0 then raise exception 'a player reads the re-review list'; end if;
  perform tests.unbecome();
  perform tests.become(admin_a);
  select count(*) into n from reviews_due where post = p3 and version_act = e3;
  perform tests.unbecome();
  if n is distinct from 1 then raise exception 'the re-review list does not hold the edit that brought the post back (% rows)', n; end if;
  -- The offending version stays hidden for good: its words, and its place in History, are an admin's until an unhide.
  perform tests.become(other);
  select (a.payload ->> 'body') into words from acts_public a where a.id = p3;
  perform tests.unbecome();
  if words is not null then raise exception 'the offending version of a post hidden until edited came back with the edit: %', words; end if;
  if not exists (select 1 from hidden_versions where version_act = p3) then raise exception 'the offending version is no longer listed as hidden'; end if;
  -- The second time on the same post: hidden again, the next edit does not end it, an approval does.
  perform tests.become(admin_a);
  perform decide(null, e3, 'hideUntilEdited', null, 'again');
  perform tests.unbecome();
  perform tests.become(other);
  select (a.current_payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = p3;
  perform tests.unbecome();
  if words is not null or hid is distinct from true then raise exception 'a post hidden until edited a second time is not hidden: % %', words, hid; end if;
  perform tests.become(admin_a);
  if (select count(*) from reviews_due where post = p3) is distinct from 0 then raise exception 'a post hidden again is still on the re-review list'; end if;
  perform tests.unbecome();
  declare e4 uuid := tests.act(ch_author, 'edit', th, '{"body": "Third, fixed twice."}', p3, now() + interval '2 minutes');
  begin
    perform tests.become(other);
    select (a.current_payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = p3;
    if words is not null or hid is distinct from true then raise exception 'the second edit ended a second hide until edited: % %', words, hid; end if;
    select (a.payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = e4;
    perform tests.unbecome();
    if words is not null or hid is distinct from true then raise exception 'the edit waiting for approval shows its words: % %', words, hid; end if;
    perform tests.become(admin_a);
    perform decide(null, e4, 'approve', null, '');
    perform tests.unbecome();
    perform tests.become(other);
    select (a.current_payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = p3;
    perform tests.unbecome();
    if words is distinct from 'Third, fixed twice.' or hid is distinct from false then raise exception 'an approval did not bring the edit back: % %', words, hid; end if;
  end;
  -- The approval shows the approved version alone: the versions that were hidden stay hidden until an unhide.
  if (select count(*) from hidden_versions where version_act in (p3, e3)) is distinct from 2 or exists (select 1 from hidden_versions where version_act = (select x.id from acts x where x.kind = 'edit' and x.target_act_id = p3 order by x.created_at desc limit 1)) then raise exception 'an approval did not leave the hidden versions hidden and show the approved one'; end if;
  perform tests.become(other);
  select (a.payload ->> 'body') into words from acts_public a where a.id = e3;
  perform tests.unbecome();
  if words is not null then raise exception 'a version hidden until edited came back at an approval: %', words; end if;
  perform tests.become(admin_a);
  perform decide(null, p3, 'unhide', null, '');
  perform decide(null, e3, 'unhide', null, '');
  perform tests.unbecome();
  if exists (select 1 from hidden_versions where version_act in (p3, e3)) then raise exception 'an unhide did not bring a version back'; end if;
  perform tests.become(other);
  select (a.payload ->> 'body') into words from acts_public a where a.id = p3;
  perform tests.unbecome();
  if words is distinct from 'Third words.' then raise exception 'an unhidden version''s words did not return: %', words; end if;
  if (select count(*) from hidden_versions where version_act = e1) is distinct from 1 then raise exception 'hidden_versions does not list the hidden edit'; end if;

  -- ---- A suspension: a past end bars nothing, a current one bars both writers, a lift ends it ----
  insert into conduct_decisions (account, admin, outcome, until, note) values (author, admin_a, 'suspend', now() - interval '1 day', 'lapsed');
  perform tests.claims(author);
  perform signed_in_account();
  perform played_by(ch_author, author);
  perform tests.become(author);
  if (select my_bar()) is not null then raise exception 'a lapsed suspension is a bar'; end if;
  perform tests.unbecome();
  -- The decision that suspends refuses a past end, so a current one is written the way an admin writes it.
  perform tests.become(admin_a);
  perform decide(author, null, 'suspend', now() + interval '3 days', 'see the email');
  perform tests.unbecome();
  perform tests.claims(author);
  seen := tests.refusal('select signed_in_account()');
  if seen is null or seen not like '28000|kayfabb.barred|%suspended until%' then raise exception 'signed_in_account did not refuse a suspended account with the bar''s hint: %', seen; end if;
  seen := tests.refusal(format('select played_by(%L, %L)', ch_author, author));
  if seen is null or seen not like '28000|kayfabb.barred|%suspended until%' then raise exception 'played_by did not refuse a suspended account with the bar''s hint: %', seen; end if;
  -- Another account is not barred, and a refusal names no one else.
  perform tests.claims(other);
  perform signed_in_account();
  perform played_by(ch_other, other);
  perform tests.unbecome();
  perform tests.become(author);
  got := my_bar();
  perform tests.unbecome();
  if got ->> 'kind' is distinct from 'suspended' or (got ->> 'until')::timestamptz <= now() then raise exception 'my_bar does not say the caller is suspended: %', got; end if;
  perform tests.become(rep);
  if (select my_bar()) is not null then raise exception 'my_bar read another account''s bar'; end if;
  perform tests.unbecome();
  perform tests.become(rep);
  seen := tests.refusal(format('select account_bar(%L)', author));
  perform tests.unbecome();
  if seen is null or seen not like '42501|%' then raise exception 'a player reached account_bar: %', seen; end if;
  perform tests.become(admin_a);
  perform decide(author, null, 'lift', null, '');
  perform tests.unbecome();
  perform tests.claims(author);
  perform signed_in_account();
  perform played_by(ch_author, author);
  perform tests.become(author);
  if (select my_bar()) is not null then raise exception 'a lifted suspension is still a bar'; end if;
  perform tests.unbecome();

  -- ---- A ban bars until a lift ----
  perform tests.become(admin_a);
  perform decide(author, null, 'ban', null, '');
  seen := tests.refusal(format('select decide(%L, null, %L, %L, %L)', author, 'ban', (now() + interval '1 day')::text, ''));
  perform tests.unbecome();
  if seen is null or seen not like '22023|%' then raise exception 'a ban with an end date was accepted: %', seen; end if;
  perform tests.claims(author);
  seen := tests.refusal('select signed_in_account()');
  if seen is null or seen not like '28000|kayfabb.barred|%banned%' then raise exception 'a ban did not bar: %', seen; end if;
  seen := tests.refusal(format('select played_by(%L, %L)', ch_author, author));
  if seen is null or seen not like '28000|kayfabb.barred|%banned%' then raise exception 'a ban did not bar a character: %', seen; end if;
  perform tests.become(author);
  got := my_bar();
  perform tests.unbecome();
  if got ->> 'kind' is distinct from 'banned' or got -> 'until' is distinct from 'null'::jsonb then raise exception 'my_bar does not say the caller is banned: %', got; end if;
  perform tests.become(admin_a);
  perform decide(author, null, 'lift', null, '');
  perform tests.unbecome();
  perform tests.claims(author);
  perform signed_in_account();
  perform tests.unbecome();

  -- ---- The latest suspend, ban or lift decides, and nothing earlier is looked at ----
  -- A ban followed by a suspension reads as that suspension: until its date, then nothing, even though the ban was never lifted.
  insert into conduct_decisions (account, admin, outcome, until, note) values (author, admin_a, 'ban', null, 'ban first');
  insert into conduct_decisions (account, admin, outcome, until, note) values (author, admin_a, 'suspend', now() + interval '5 days', 'then a suspension');
  perform tests.become(author);
  got := my_bar();
  perform tests.unbecome();
  if got ->> 'kind' is distinct from 'suspended' or (got ->> 'until')::timestamptz is distinct from (select x.until from conduct_decisions x where x.note = 'then a suspension') then
    raise exception 'a suspension after a ban did not read as that suspension: %', got;
  end if;
  -- A suspension then a shorter one reads the shorter, not the furthest.
  insert into conduct_decisions (account, admin, outcome, until, note) values (author, admin_a, 'suspend', now() + interval '1 day', 'shorter');
  perform tests.become(author);
  got := my_bar();
  perform tests.unbecome();
  if got ->> 'kind' is distinct from 'suspended' or (got ->> 'until')::timestamptz is distinct from (select x.until from conduct_decisions x where x.note = 'shorter') then
    raise exception 'a shorter re-suspension did not replace the longer one: %', got;
  end if;
  -- A suspension then a ban is banned.
  insert into conduct_decisions (account, admin, outcome, until, note) values (author, admin_a, 'ban', null, 'ban last');
  perform tests.become(author);
  got := my_bar();
  perform tests.unbecome();
  if got ->> 'kind' is distinct from 'banned' then raise exception 'a ban after a suspension did not read as banned: %', got; end if;
  -- A lapsed suspension after a ban is the latest decision: no bar.
  insert into conduct_decisions (account, admin, outcome, until, note) values (author, admin_a, 'suspend', now() - interval '1 hour', 'lapsed last');
  perform tests.become(author);
  got := my_bar();
  perform tests.unbecome();
  if got is not null then raise exception 'a lapsed suspension after a ban still bars: %', got; end if;
  insert into conduct_decisions (account, admin, outcome, until, note) values (author, admin_a, 'lift', null, 'clean up');

  -- ---- The log reads the caller's own versions' decisions only ----
  perform tests.become(author);
  select count(*) into n from my_conduct_log();
  perform tests.unbecome();
  if n is distinct from (select count(*) from conduct_decisions d join acts a on a.id = d.version_act where a.character = ch_author and d.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve')) or n = 0 then
    raise exception 'my_conduct_log returned % rows for the author', n;
  end if;
  perform tests.become(other);
  select count(*) into n from my_conduct_log();
  perform tests.unbecome();
  if n is distinct from 0 then raise exception 'my_conduct_log read another player''s decisions (% rows)', n; end if;

  -- ---- Every table refuses update and delete, and truncate ----
  declare t text;
  begin
    foreach t in array array['conduct_acceptances', 'conduct_reports', 'conduct_decisions'] loop
      seen := tests.refusal(format('update %I set at = now()', t));
      if seen is null or seen not like '%never edited or removed%' then raise exception '% accepted an update: %', t, seen; end if;
      seen := tests.refusal(format('delete from %I', t));
      if seen is null or seen not like '%never edited or removed%' then raise exception '% accepted a delete: %', t, seen; end if;
      seen := tests.refusal(format('truncate %I cascade', t));
      if seen is null or seen not like '%never edited or removed%' then raise exception '% accepted a truncate: %', t, seen; end if;
    end loop;
  end;

  -- ---- Poison: a decision whose admin is not an admin, inserted directly, is refused ----
  seen := tests.refusal(format('insert into conduct_decisions (version_act, admin, outcome, note) values (%L, %L, %L, %L)', p4, rep, 'hide', 'forged'));
  if seen is null or seen not like '42501|kayfabb.refusal|%admin%' then raise exception 'a decision by an account that is not an admin was written: %', seen; end if;
  seen := tests.refusal(format('insert into conduct_decisions (account, admin, outcome, note) values (%L, %L, %L, %L)', other, rep, 'ban', 'forged'));
  if seen is null or seen not like '42501|%' then raise exception 'a forged ban was written: %', seen; end if;
  -- A decision names a post or an edit.
  seen := tests.refusal(format('insert into conduct_decisions (version_act, admin, outcome) values (%L, %L, %L)', tally, admin_a, 'hide'));
  if seen is null or seen not like '23514|%' then raise exception 'a decision on a tally was written: %', seen; end if;

  -- ---- Poison: an ordinary player reading a hidden version through acts_public gets no words ----
  perform tests.become(admin_a);
  perform decide(null, p4, 'hide', null, 'for the poison');
  perform tests.unbecome();
  perform tests.become(rep);
  select count(*) into n from acts_public a
    where a.hidden and (a.current_payload ->> 'body' is not null or a.payload ->> 'body' is not null);
  if n is distinct from 0 then raise exception 'acts_public served the words of % hidden versions to an ordinary player', n; end if;
  if (select count(*) from acts_public a where a.hidden) is distinct from 2 then raise exception 'expected the hidden post and the hidden edit to be hidden, and no other: %', (select count(*) from acts_public a where a.hidden); end if;

  -- ---- A plain hide, then the author's edit: the edit is not a way back; it waits, an admin hears of it, an approval shows it ----
  perform tests.unbecome();
  declare
    ph uuid; eh uuid; eh2 uuid; w2 text; h2 boolean; m bigint;
  begin
    ph := tests.post(ch_author, th, 'The cruel part.', now() - interval '10 minutes');
    perform tests.become(admin_a);
    perform decide(null, ph, 'hide', null, 'too far');
    perform tests.unbecome();
    -- The author edits and keeps the same words.
    eh := tests.act(ch_author, 'edit', th, '{"body": "The cruel part."}', ph, now() + interval '3 minutes');
    perform tests.become(other);
    select (a.current_payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = ph;
    select (a.payload ->> 'body'), a.hidden into w2, h2 from acts_public a where a.id = eh;
    perform tests.unbecome();
    if words is not null or hid is distinct from true then raise exception 'an edit after a plain hide showed the post again: % %', words, hid; end if;
    if w2 is not null or h2 is distinct from true then raise exception 'an edit after a plain hide shows its own words: % %', w2, h2; end if;
    perform tests.become(admin_a);
    select count(*) into n from reviews_due where post = ph and version_act = eh;
    perform tests.unbecome();
    if n is distinct from 1 then raise exception 'the re-review list does not hold the edit waiting after a plain hide (% rows)', n; end if;
    -- A second edit while it waits is hidden too, and is the one the list names.
    eh2 := tests.act(ch_author, 'edit', th, '{"body": "Softer."}', ph, now() + interval '4 minutes');
    perform tests.become(admin_a);
    select count(*) into n from reviews_due where post = ph and version_act = eh2;
    select count(*) into m from reviews_due where post = ph;
    perform tests.unbecome();
    if n is distinct from 1 or m is distinct from 1 then raise exception 'the re-review list names the newest waiting edit once: % %', n, m; end if;
    -- The approval is written with its own time, after both edits (the suite's edits are dated ahead of now).
    insert into conduct_decisions (version_act, admin, outcome, note, at) values (eh2, admin_a, 'approve', 'fine now', now() + interval '4 minutes 30 seconds');
    perform tests.become(admin_a);
    select count(*) into n from reviews_due where post = ph;
    perform tests.unbecome();
    if n is distinct from 0 then raise exception 'an approved edit is still on the re-review list'; end if;
    perform tests.become(other);
    select (a.current_payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = ph;
    select (a.payload ->> 'body') into w2 from acts_public a where a.id = eh;
    perform tests.unbecome();
    if words is distinct from 'Softer.' or hid is distinct from false then raise exception 'an approval did not show the approved edit after a plain hide: % %', words, hid; end if;
    if w2 is not null then raise exception 'an approval brought back the earlier hidden edit: %', w2; end if;
    -- An unhide of the hidden version also ends it: the next edit shows at once.
    perform tests.become(admin_a);
    perform decide(null, ph, 'hide', null, 'again');
    perform tests.unbecome();
    insert into conduct_decisions (version_act, admin, outcome, note, at) values (ph, admin_a, 'unhide', 'sorry', now() + interval '4 minutes 40 seconds');
    eh := tests.act(ch_author, 'edit', th, '{"body": "Softer still."}', ph, now() + interval '5 minutes');
    perform tests.become(other);
    select (a.current_payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = ph;
    perform tests.unbecome();
    if words is distinct from 'Softer still.' or hid is distinct from false then raise exception 'an edit after an unhide stayed hidden: % %', words, hid; end if;
    -- A plain hide, the author's edit (waiting), then an admin's unhide of the original version written after the edit: the unhide frees every edit written after
    -- that hide, so the post shows the latest edit's words, nothing waits on the author or on the re-review list, and the author is not told "waiting".
    declare pu uuid; eu uuid; mine jsonb; due bigint;
    begin
      pu := tests.post(ch_author, th, 'Too cruel.', now() - interval '9 minutes');
      perform tests.become(admin_a);
      perform decide(null, pu, 'hide', null, 'unhide after an edit');
      perform tests.unbecome();
      eu := tests.act(ch_author, 'edit', th, '{"body": "Kinder."}', pu, now() + interval '6 minutes');
      perform tests.become(author);
      mine := my_hidden_version(pu);
      perform tests.unbecome();
      if mine ->> 'status' is distinct from 'waiting' then raise exception 'before the unhide the author is not told the edit is waiting: %', mine; end if;
      insert into conduct_decisions (version_act, admin, outcome, note, at) values (pu, admin_a, 'unhide', 'a mistake', now() + interval '7 minutes');
      perform tests.become(other);
      select (a.current_payload ->> 'body'), a.hidden into words, hid from acts_public a where a.id = pu;
      perform tests.unbecome();
      if words is distinct from 'Kinder.' or hid is distinct from false then raise exception 'an unhide after the author''s edit left the post hidden: % %', words, hid; end if;
      perform tests.become(author);
      mine := my_hidden_version(pu);
      perform tests.unbecome();
      if mine is not null then raise exception 'after an unhide the author is still told the edit waits: %', mine; end if;
      perform tests.become(admin_a);
      select count(*) into due from reviews_due where post = pu;
      perform tests.unbecome();
      if due is distinct from 0 then raise exception 'an unhidden post is still on the re-review list'; end if;
    end;
  end;
  perform tests.become(other);
  perform tests.unbecome();

  -- A card's moment (play_moment, 0092) serves the version a play landed on, and not its words when it is hidden.
  declare play uuid := tests.act(ch_rep, 'card', th, '{"card": "sweetie"}', p4, now());
  begin
    perform tests.become(rep);
    got := play_moment(play);
    perform tests.unbecome();
    if got -> 'version' ->> 'act' is null and got -> 'version' -> 'current_payload' is null then raise exception 'play_moment gave no version: %', got; end if;
    if got -> 'version' -> 'current_payload' ->> 'body' is not null then raise exception 'a card''s moment served the words of a hidden version: %', got -> 'version' -> 'current_payload'; end if;
    perform tests.become(admin_a);
    perform decide(null, p4, 'unhide', null, '');
    perform tests.unbecome();
    perform tests.become(rep);
    got := play_moment(play);
    perform tests.unbecome();
    if got -> 'version' -> 'current_payload' ->> 'body' is distinct from 'Other words.' then raise exception 'a card''s moment lost the words of an unhidden version: %', got -> 'version' -> 'current_payload'; end if;
  end;
end $$;
