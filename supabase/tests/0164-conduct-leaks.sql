-- Where a hidden version's words could still leak, and the screens that must say it is hidden (supabase/migrations/0152_conduct.sql; the
-- conduct plan, Task 2): conceal_quotes reads a tag the way engine/bbcode/parse.ts does, a model's and a card's reads of a post go through the
-- public form, the screen functions give a hidden post no body, a search finds neither a hidden version's words nor a version a later hide
-- covers, and the well-formedness trigger and decide_report refuse what they should.

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

do $$
declare
  admin_a uuid := tests.account('admin-a');
  author uuid := tests.account('author');
  other uuid := tests.account('other');
  ch_author uuid := tests.character(author, 'Ada');
  ch_other uuid := tests.character(other, 'Cy');
  th uuid := tests.thread('Leaks');
  base timestamptz := now() - interval '1 day';
  rep uuid := tests.account('reporter');
  ch_rep uuid := tests.character(rep, 'Bo');
  p1 uuid; pz uuid; e1 uuid; e2 uuid; q uuid; p2 uuid; p3 uuid;
  r1 bigint; r2 bigint;
  words text; seen text; j jsonb; found boolean;
begin
  insert into admins (account) values (admin_a);
  p1 := tests.post(ch_author, th, 'Hidden words.', base);
  perform tests.become(admin_a);
  perform decide(null, p1, 'hide', null, 'leaks');
  perform tests.unbecome();

  -- ---- conceal_quotes finds a tag where the parser does ----
  -- A bracket run that holds a second `[` is text to the parser (engine/bbcode/parse.ts), so the quote that opens inside it is the one that counts.
  words := conceal_quotes(format('[quote=zz[quote=%s]words[/quote] after', p1));
  if words is distinct from format('[quote=zz[quote=%s][/quote] after', p1) then
    raise exception 'a quote opened after a stray bracket was not emptied: %', words;
  end if;

  -- ---- The screens' functions over a hidden post: hidden, and no words ----
  perform tests.become(other);
  j := thread_page(th, 1, 20, null, null);
  select (a ->> 'hidden')::boolean, a #>> '{payload,body}', a #>> '{current_payload,body}' into found, words, seen from jsonb_array_elements(j -> 'acts') a where a ->> 'id' = p1::text;
  if found is distinct from true or words is not null or seen is not null then raise exception 'thread_page over a hidden post: hidden %, body %, current %', found, words, seen; end if;
  j := profile_page(ch_author);
  select (a ->> 'hidden')::boolean, a #>> '{payload,body}', a #>> '{current_payload,body}' into found, words, seen from jsonb_array_elements(j -> 'acts') a where a ->> 'id' = p1::text;
  if found is distinct from true or words is not null or seen is not null then raise exception 'profile_page over a hidden post: hidden %, body %, current %', found, words, seen; end if;
  if j::text like '%Hidden words%' then raise exception 'profile_page carries a hidden post''s words'; end if;
  j := thread_page(th, 1, 20, null, null);
  if j::text like '%Hidden words%' then raise exception 'thread_page carries a hidden post''s words'; end if;
  perform tests.unbecome();

  -- ---- A second hide until edited, and what search and quotes then show ----
  pz := tests.post(ch_author, th, 'The word is zanzibar.', base + interval '2 minutes');
  perform tests.become(admin_a);
  perform decide(null, pz, 'hideUntilEdited', null, 'first');
  perform tests.unbecome();
  e1 := tests.act(ch_author, 'edit', th, '{"body": "Now it is tanganyika."}', pz, now() - interval '1 hour');
  perform tests.become(admin_a);
  perform decide(null, e1, 'hideUntilEdited', null, 'second');
  perform tests.unbecome();
  e2 := tests.act(ch_author, 'edit', th, '{"body": "Finally kilimanjaro."}', pz, now() + interval '1 minute');
  perform tests.become(other);
  foreach words in array array['zanzibar', 'tanganyika', 'kilimanjaro'] loop
    if jsonb_array_length(search_posts(words, null, null, null, null, false, 'newest', null, 20) -> 'results') is distinct from 0 then
      raise exception 'a search found %, a version a second hide until edited covers', words;
    end if;
  end loop;
  perform tests.unbecome();
  -- A quote of the post is emptied while any of its versions is hidden, an edit's included.
  q := tests.post(ch_other, th, format('See [quote=%s]Finally kilimanjaro.[/quote] ok', pz), base + interval '3 minutes');
  perform tests.become(rep);
  select a.current_payload ->> 'body' into words from acts_public a where a.id = q;
  perform tests.unbecome();
  if words is distinct from format('See [quote=%s][/quote] ok', pz) then raise exception 'a quote of a post with a hidden edit was not emptied: %', words; end if;
  if quote_hidden(pz) is distinct from true then raise exception 'quote_hidden does not see the hidden edit'; end if;

  -- ---- A decision on a report names the report's version; decide_report takes no unhide, lift or approve ----
  p2 := tests.post(ch_author, th, 'Reported words.', base + interval '4 minutes');
  p3 := tests.post(ch_author, th, 'Other reported words.', base + interval '5 minutes');
  perform tests.become(rep);
  r1 := report_post(p2, 'mask', null);
  perform tests.unbecome();
  seen := tests.refusal(format('insert into conduct_decisions (report, version_act, admin, outcome) values (%s, %L, %L, %L)', r1, p3, admin_a, 'hide'));
  if seen is null or seen not like '23514|%names the version it reports%' then raise exception 'a decision on another version than its report''s was written: %', seen; end if;
  if tests.refusal(format('insert into conduct_decisions (report, version_act, admin, outcome) values (%s, %L, %L, %L)', r1, p2, admin_a, 'hide')) is not null then
    raise exception 'a decision on the report''s own version was refused';
  end if;
  perform tests.become(rep);
  r2 := report_post(p3, 'mask', null);
  perform tests.unbecome();
  perform tests.become(admin_a);
  foreach words in array array['unhide', 'lift', 'approve'] loop
    seen := tests.refusal(format('select decide_report(%s, %L)', r2, jsonb_build_array(jsonb_build_object('outcome', words))::text));
    if seen is null or seen not like '22023|kayfabb.refusal|%' then raise exception 'decide_report took %: %', words, seen; end if;
  end loop;
  perform tests.unbecome();
  if exists (select 1 from conduct_decisions where report = r2) then raise exception 'a refused decide_report still wrote a decision'; end if;
end $$;
