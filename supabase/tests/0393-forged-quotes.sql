-- The verdict (supabase/migrations/0393_forged_quotes.sql, section 3; docs/plans/2026-11-20-forged-quotes-plan.md, Task 3; docs/plans/2026-11-20-forged-quotes-design.md, sections 2, 3, 5, 6 and 11).
-- A real quote whose words do not stand, in order, in one eligible version of the post it names (the post itself or one of its edits, written at or before the quoting Act, not hidden) makes that post
-- forged in the Act: the trigger writes the sorted list into the payload's `forged`, a post whose target is forged is written with no target, and quote_check answers the same from a draft.
-- Each negative has a twin that must pass, so a check that always says "forged" or never does fails one of the two.

create function tests.said(by_character uuid, in_thread uuid, body text, at timestamptz, kind text default 'post', target uuid default null, extra jsonb default '{}') returns acts language plpgsql as $$
declare written uuid; r acts;
begin
  written := tests.act(by_character, kind, in_thread, jsonb_build_object('body', body) || extra, target, at);
  select * into r from acts where acts.id = written;
  return r;
end $$;
create function tests.verdict(body text, at timestamptz default now()) returns uuid[] language plpgsql as $$ begin return quote_forged(body, at); end $$;

-- ---- the functions exist, and the table is shaped as the plan says ----
do $$
begin
  if to_regprocedure('quote_forged(text, timestamptz)') is null then raise exception 'quote_forged(text, timestamptz) does not exist'; end if;
  if to_regprocedure('quote_holds(text, jsonb)') is null then raise exception 'quote_holds(text, jsonb) does not exist'; end if;
  if to_regprocedure('quote_check(text)') is null then raise exception 'quote_check(text) does not exist'; end if;
  if to_regprocedure('acts_forged_quotes()') is null or to_regprocedure('acts_quote_sources()') is null then raise exception 'the two trigger functions do not exist'; end if;
  if to_regclass('quote_sources') is null then raise exception 'quote_sources does not exist'; end if;
end $$;

-- ---- quote_holds: every piece in order, each at or after the end of the last; empty pieces and no pieces hold (engine/bbcode/quoted.ts, holds) ----
do $$
declare cut text := chr(64976);
begin
  if quote_holds('a b c d', '["a b", "c"]') is not true then raise exception 'quote_holds: two pieces in order'; end if;
  if quote_holds('a b c d', '["c", "a b"]') is not false then raise exception 'quote_holds: two pieces out of order hold'; end if;
  if quote_holds('abab', '["ab", "ab"]') is not true then raise exception 'quote_holds: a piece may start where the last ended'; end if;
  if quote_holds('ab', '["ab", "ab"]') is not false then raise exception 'quote_holds: the same words twice in one occurrence hold'; end if;
  if quote_holds('a b', '[]') is not true or quote_holds('', '[]') is not true then raise exception 'quote_holds: no pieces do not hold'; end if;
  if quote_holds('a b', '["", "b", ""]') is not true then raise exception 'quote_holds: an empty piece does not hold'; end if;
  if quote_holds('a b', '["", "zzz"]') is not false then raise exception 'quote_holds: an empty piece makes a missing one hold'; end if;
  if quote_holds('é b ' || chr(128512) || ' c', to_jsonb(array['b ' || chr(128512), 'c'])) is not true then raise exception 'quote_holds: characters outside the BMP'; end if;
  if quote_holds('before ' || cut || ' after', to_jsonb(array['before', 'after'])) is not true then raise exception 'quote_holds: a cut between the pieces'; end if;
end $$;

-- ---- the verdict, from the function ----
do $$
declare
  au uuid := tests.account('fq-author');
  ch uuid := tests.character(au, 'Fq Author');
  th uuid := tests.thread('Forged quotes');
  base timestamptz := now() - interval '1 day';
  q uuid; z uuid; q_nested uuid; r uuid; fresh uuid; card_act uuid; spun uuid;
  edit1 uuid; edit_late uuid; orig uuid;
  nobody uuid := gen_random_uuid();
  v uuid[];
  cut text := chr(64976);
  deep text; i integer;
begin
  z := tests.post(ch, th, 'Nested words.', base);
  q := tests.post(ch, th, format('I do not like Mario. Hello [b]bold[/b] and [i]italic[/i] world, [quote=%s]Nested words.[/quote] the end', z), base + interval '1 minute');

  -- an authentic whole-body quote, and the body's own words around it
  v := tests.verdict(format('[quote=%s]I do not like Mario. Hello bold and italic world, Nested words. the end[/quote] and mine', q), base + interval '5 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'a whole-body quote is forged: %', v; end if;
  -- a highlight-shaped quote: plain words across formatting and a nested quote, and a bit of it
  v := tests.verdict(format('[quote=%s]bold and italic world, Nested words.[/quote]', q), base + interval '5 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'a highlight across formatting and a nested quote is forged: %', v; end if;
  v := tests.verdict(format('[quote=%s]Hello [b]bold[/b] and [i]italic[/i][/quote]', q), base + interval '5 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'the same words with their formatting are forged: %', v; end if;
  -- markup the poster never wrote is not the words: a spoiler and a link wrapped around words stand as the words
  v := tests.verdict(format('[quote=%s]I do not like [url=https://example.invalid]Mario.[/url][/quote]', q), base + interval '5 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'a link around authentic words makes them forged: %', v; end if;
  -- spacing is loose: runs of whitespace are one space, and a run of one character past eight is eight
  v := tests.verdict(format(E'[quote=%s]I   do not\n like   Mario.[/quote]', q), base + interval '5 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'spacing makes a quote forged: %', v; end if;

  -- a word changed, punctuation changed, case changed
  v := tests.verdict(format('[quote=%s]I do not love Mario.[/quote]', q), base + interval '5 minutes');
  if v is distinct from array[q] then raise exception 'a word changed is not forged: %', v; end if;
  v := tests.verdict(format('[quote=%s]I do not like Mario![/quote]', q), base + interval '5 minutes');
  if v is distinct from array[q] then raise exception 'punctuation changed is not forged: %', v; end if;
  v := tests.verdict(format('[quote=%s]i do not like mario.[/quote]', q), base + interval '5 minutes');
  if v is distinct from array[q] then raise exception 'case changed is not forged: %', v; end if;

  -- an ellipsis in the middle is words like any: spliced, it is forged; where the post has it, it is authentic
  v := tests.verdict(format('[quote=%s]I do not ... like Mario.[/quote]', q), base + interval '5 minutes');
  if v is distinct from array[q] then raise exception 'a middle ellipsis is special: %', v; end if;
  fresh := tests.post(ch, th, 'I do ... like it', base + interval '2 minutes');
  v := tests.verdict(format('[quote=%s]I do ... like it[/quote]', fresh), base + interval '5 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'a middle ellipsis the post has is forged: %', v; end if;
  -- leading and trailing ellipses are taken off, in either spelling
  v := tests.verdict(format('[quote=%s]...do not like Mario...[/quote] and [quote=%s]… not like Mario. Hello …[/quote]', q, q), base + interval '5 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'leading and trailing ellipses make a quote forged: %', v; end if;

  -- an empty quote of a post stands; an id that is no Act, and an Act with no text body, have no version
  v := tests.verdict(format('[quote=%s][/quote]', q), base + interval '5 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'an empty quote of a post is forged: %', v; end if;
  v := tests.verdict(format('[quote=%s]words[/quote]', nobody), base + interval '5 minutes');
  if v is distinct from array[nobody] then raise exception 'an id that is no Act is not forged: %', v; end if;
  v := tests.verdict(format('[quote=%s][/quote]', nobody), base + interval '5 minutes');
  if v is distinct from array[nobody] then raise exception 'an empty quote of an id that is no Act is not forged: %', v; end if;
  card_act := tests.act(null, 'tally', th, '{"note": "no text"}', null, base + interval '3 minutes');
  v := tests.verdict(format('[quote=%s]words[/quote]', card_act), base + interval '5 minutes');
  if v is distinct from array[card_act] then raise exception 'an Act with no text body is not forged: %', v; end if;

  -- two quotes of one post, one doctored: the post is forged, once
  v := tests.verdict(format('[quote=%s]I do not like Mario.[/quote] then [quote=%s]I do like Mario.[/quote]', q, q), base + interval '5 minutes');
  if v is distinct from array[q] then raise exception 'two quotes of one post, one doctored: %', v; end if;
  -- two posts, one forged: only it is listed, and the list is sorted
  v := tests.verdict(format('[quote=%s]Nested words.[/quote] [quote=%s]zzz[/quote] [quote=%s]zzz[/quote]', z, q, fresh), base + interval '5 minutes');
  if v is distinct from (select array_agg(x order by x) from unnest(array[q, fresh]) x) then raise exception 'two forged posts are not listed, sorted: %', v; end if;
  -- the quotes of one post are judged together: words from two places in the post, in one quote, in order
  v := tests.verdict(format('[quote=%s]I do not like Mario.[/quote] [quote=%s]Hello bold[/quote]', q, q), base + interval '5 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'two honest quotes of one post are forged: %', v; end if;

  -- a quote in a code block, in a noparse and a counterfeit's name are no real quote: they are never judged
  v := tests.verdict(format('[code][quote=%s]nonsense[/quote][/code] [noparse][quote=%s]nonsense[/quote][/noparse] [quote=Geno]nonsense[/quote]', q, q), base + interval '5 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'a quote that is not real is judged: %', v; end if;

  -- a quote the words of which are in no version but are in the nested post's: the nested quote's words count as the post's, not as another post's
  v := tests.verdict(format('[quote=%s]Hello bold[/quote]', z), base + interval '5 minutes');
  if v is distinct from array[z] then raise exception 'words of another post are authentic for this one: %', v;  end if;

  -- a cut quote: the pieces stand in the post, in order
  r := tests.post(ch, th, 'before after', base + interval '2 minutes');
  q_nested := tests.post(ch, th, 'deep', base + interval '2 minutes');
  deep := '';
  for i in 1..16 loop deep := deep || format('[quote=%s]', r); end loop;
  deep := deep || format('before [quote=%s][quote=%s]deep[/quote][/quote] after', q_nested, q_nested) || repeat('[/quote]', 16);
  v := tests.verdict(deep, base + interval '5 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'an honest whole-post quote at the foot of a deep pyramid is forged: %', v; end if;
  -- the same, the post's words out of order, and with a piece missing
  fresh := tests.post(ch, th, 'after before', base + interval '2 minutes');
  v := tests.verdict(replace(deep, r::text, fresh::text), base + interval '5 minutes');
  if v is distinct from array[fresh] then raise exception 'a cut quote whose pieces stand out of order is not forged: %', v; end if;
  fresh := tests.post(ch, th, 'before only', base + interval '2 minutes');
  v := tests.verdict(replace(deep, r::text, fresh::text), base + interval '5 minutes');
  if v is distinct from array[fresh] then raise exception 'a cut quote with a missing piece is not forged: %', v; end if;

  -- the versions: a quote of the original after an edit stays authentic, and so does one of the edit
  orig := tests.post(ch, th, 'Original words here.', base + interval '10 minutes');
  edit1 := tests.act(ch, 'edit', th, '{"body": "Edited words there."}', orig, base + interval '20 minutes');
  v := tests.verdict(format('[quote=%s]Original words here.[/quote]', orig), base + interval '30 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'a quote of the original after an edit is forged: %', v; end if;
  v := tests.verdict(format('[quote=%s]Edited words there.[/quote]', orig), base + interval '30 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'a quote of an edit is forged: %', v; end if;
  -- each quote is judged on its own against any eligible version (design, section 2): one from the original and one from the edit are both authentic; one doctored among them forges the post (section 5)
  v := tests.verdict(format('[quote=%s]Original words here.[/quote] [quote=%s]Edited words there.[/quote]', orig, orig), base + interval '30 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'two honest quotes of one post from two versions are forged: %', v; end if;
  v := tests.verdict(format('[quote=%s]Original words here.[/quote] [quote=%s]Edited words there.[/quote] [quote=%s]Never said.[/quote]', orig, orig, orig), base + interval '30 minutes');
  if v is distinct from array[orig] then raise exception 'one doctored quote among honest ones of two versions is not forged: %', v; end if;
  v := tests.verdict(format('[quote=%s]Original words there.[/quote]', orig), base + interval '30 minutes');
  if v is distinct from array[orig] then raise exception 'words spliced from two versions are authentic: %', v; end if;
  -- a version written after the quoting Act is not one: by `at`
  edit_late := tests.act(ch, 'edit', th, '{"body": "Later words everywhere."}', orig, base + interval '40 minutes');
  v := tests.verdict(format('[quote=%s]Later words everywhere.[/quote]', orig), base + interval '30 minutes');
  if v is distinct from array[orig] then raise exception 'a version written after the Act counts: %', v; end if;
  v := tests.verdict(format('[quote=%s]Later words everywhere.[/quote]', orig), base + interval '40 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'a version written at the Act does not count: %', v; end if;
  v := tests.verdict(format('[quote=%s]Original words here.[/quote]', orig), base + interval '5 minutes');
  if v is distinct from array[orig] then raise exception 'the post itself counts before it was written: %', v; end if;
  -- the same version twice (a post edited back to the same words) is no trouble
  perform tests.act(ch, 'edit', th, '{"body": "Original words here."}', orig, base + interval '50 minutes');
  v := tests.verdict(format('[quote=%s]Original words here.[/quote]', orig), base + interval '60 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'a post edited back to its first words: %', v; end if;
end $$;

-- ---- hidden versions ----
do $$
declare
  au uuid := tests.account('fq-hid-author');
  ch uuid := tests.character(au, 'Fq Hidden');
  other uuid := tests.account('fq-hid-other');
  admin_d uuid := tests.account('fq-hid-admin');
  th uuid := tests.thread('Forged hidden');
  base timestamptz := now() - interval '1 day';
  orig uuid; ed uuid; written acts;
  secret text; clean text; wrong text;
  a_author uuid[]; a_other uuid[]; a_anon uuid[]; a_wrong uuid[]; before_hide acts;
begin
  insert into admins (account) values (admin_d);
  orig := tests.post(ch, th, 'Alpha secret words', base);
  ed := tests.act(ch, 'edit', th, '{"body": "Beta clean words"}', orig, base + interval '1 minute');
  before_hide := tests.said(ch, th, format('[quote=%s]Alpha secret words[/quote]', orig), base + interval '2 minutes');
  if before_hide.payload ? 'forged' then raise exception 'a quote of a version not yet hidden is forged: %', before_hide.payload; end if;
  perform tests.become(admin_d);
  perform decide(null, orig, 'hide', null, 'hidden original');
  perform tests.unbecome();
  secret := format('[quote=%s]Alpha secret words[/quote]', orig);
  clean := format('[quote=%s]Beta clean words[/quote]', orig);
  wrong := format('[quote=%s]Alpha secret word[/quote]', orig);
  if tests.verdict(secret, base + interval '1 hour') is distinct from array[orig] then raise exception 'a quote that matches only a hidden version is authentic: %', tests.verdict(secret, base + interval '1 hour'); end if;
  if tests.verdict(clean, base + interval '1 hour') is distinct from '{}'::uuid[] then raise exception 'a quote of the visible edit is forged'; end if;
  -- the answer is the same for the hidden post's author and for anyone, and a right guess and a wrong one cannot be told apart
  perform tests.become(au);
  a_author := quote_check(secret); a_wrong := quote_check(wrong);
  perform tests.unbecome();
  perform tests.become(other);
  a_other := quote_check(secret);
  perform tests.unbecome();
  if a_author is distinct from array[orig] or a_other is distinct from array[orig] or a_wrong is distinct from array[orig] then
    raise exception 'quote_check of a hidden version: author %, other %, wrong guess %', a_author, a_other, a_wrong;
  end if;
  -- the Act written after the hide: forged and written so; the one written before it stands as written
  written := tests.said(ch, th, secret, base + interval '3 minutes');
  if act_forged(written.payload) is distinct from array[orig] then raise exception 'a post quoting a hidden version is written authentic: %', written.payload; end if;
  if (select a.payload from acts a where a.id = before_hide.id) ? 'forged' then raise exception 'a hide changed an Act already written'; end if;
  -- an unhide makes it a version again, for the next Act only
  perform tests.become(admin_d);
  perform decide(null, orig, 'unhide', null, 'back');
  perform tests.unbecome();
  if tests.verdict(secret, base + interval '1 hour') is distinct from '{}'::uuid[] then raise exception 'an unhidden version does not count again'; end if;
  if act_forged((select a.payload from acts a where a.id = written.id)) is distinct from array[orig] then raise exception 'an unhide re-judged an Act already written'; end if;
end $$;

-- ---- quote_check ----
do $$
declare
  au uuid := tests.account('fq-check');
  ch uuid := tests.character(au, 'Fq Check');
  th uuid := tests.thread('Forged check');
  q uuid;
  v uuid[];
  most integer := setting('postMaxLength')::integer;
begin
  q := tests.post(ch, th, 'Words in the post', now() - interval '1 hour');
  perform tests.become(au);
  if quote_check(format('[quote=%s]Words in the post[/quote]', q)) is distinct from '{}'::uuid[] then raise exception 'quote_check of an authentic quote'; end if;
  if quote_check(format('[quote=%s]Words not in the post[/quote]', q)) is distinct from array[q] then raise exception 'quote_check of a doctored quote'; end if;
  if quote_check('no quote at all') is distinct from '{}'::uuid[] then raise exception 'quote_check of no quote'; end if;
  begin
    perform quote_check('   ');
    raise exception 'quote_check of a blank body answered';
  exception when sqlstate '22023' then null; end;
  begin
    perform quote_check(repeat('a', most + 1));
    raise exception 'quote_check of a body past postMaxLength answered';
  exception when sqlstate '22001' then null; end;
  perform tests.unbecome();
  -- no signed-out caller, and the verdict itself is no client's
  perform tests.become_anon();
  begin
    perform quote_check('x');
    raise exception 'quote_check answered a signed-out caller';
  exception when insufficient_privilege then null; end;
  perform tests.unbecome();
  perform tests.become(au);
  begin
    perform quote_forged('x', now());
    raise exception 'a player called quote_forged';
  exception when insufficient_privilege then null; end;
  begin
    perform quote_holds('x', '[]');
    raise exception 'a player called quote_holds';
  exception when insufficient_privilege then null; end;
  perform tests.unbecome();
end $$;

-- ---- the trigger: the verdict is written, a client's is overwritten, a forged post is no target ----
do $$
declare
  au uuid := tests.account('fq-trigger');
  ch uuid := tests.character(au, 'Fq Trigger');
  ch2 uuid := tests.character(au, 'Fq Trigger Two');
  th uuid := tests.thread('Forged trigger');
  base timestamptz := now() - interval '1 day';
  q uuid; q2 uuid; w acts; e acts; p acts; s acts; v uuid[];
  stranger uuid := gen_random_uuid();
begin
  q := tests.post(ch, th, 'The quoted words.', base);
  q2 := tests.post(ch, th, 'Other quoted words.', base + interval '1 minute');
  -- an authentic quote: written with no `forged` at all, not an empty list
  w := tests.said(ch2, th, format('[quote=%s]The quoted words.[/quote]', q), base + interval '2 minutes');
  if w.payload ? 'forged' then raise exception 'an authentic post carries forged: %', w.payload; end if;
  -- a doctored one: the list
  w := tests.said(ch2, th, format('[quote=%s]Words never said.[/quote]', q), base + interval '2 minutes');
  if w.payload -> 'forged' is distinct from jsonb_build_array(q) then raise exception 'a doctored post is written with %', w.payload; end if;
  -- two, sorted, lowercase, each once, whatever the quote's id was written in
  w := tests.said(ch2, th, format('[quote=%s]never[/quote] [quote=%s]never[/quote] [quote=%s]never again[/quote]', q2, upper(q::text), q), base + interval '2 minutes');
  if w.payload -> 'forged' is distinct from (select jsonb_agg(x order by x) from unnest(array[q, q2]) x) then raise exception 'two doctored posts are written with %', w.payload; end if;
  -- a client's `forged` is always overwritten: names an innocent, and an empty one on a doctored post
  w := tests.said(ch2, th, format('[quote=%s]The quoted words.[/quote]', q), base + interval '2 minutes', 'post', null, jsonb_build_object('forged', jsonb_build_array(q, stranger)));
  if w.payload ? 'forged' then raise exception 'a client''s forged survives on an authentic post: %', w.payload; end if;
  w := tests.said(ch2, th, 'No quotes here', base + interval '2 minutes', 'post', null, jsonb_build_object('forged', jsonb_build_array(q)));
  if w.payload ? 'forged' then raise exception 'a client''s forged survives on a post with no quote: %', w.payload; end if;
  w := tests.said(ch2, th, format('[quote=%s]Words never said.[/quote]', q), base + interval '2 minutes', 'post', null, jsonb_build_object('forged', jsonb_build_array(q2, stranger)));
  if w.payload -> 'forged' is distinct from jsonb_build_array(q) then raise exception 'a client''s forged is not replaced by the verdict: %', w.payload; end if;
  w := tests.said(ch2, th, format('[quote=%s]Words never said.[/quote]', q), base + interval '2 minutes', 'post', null, jsonb_build_object('forged', 'not a list'));
  if w.payload -> 'forged' is distinct from jsonb_build_array(q) then raise exception 'a client''s forged that is no list is not replaced: %', w.payload; end if;
  -- the other keys of the payload stay as written
  w := tests.said(ch2, th, format('[quote=%s]Words never said.[/quote]', q), base + interval '2 minutes', 'post', null, jsonb_build_object('framing', jsonb_build_array(q2)));
  if w.payload -> 'framing' is distinct from jsonb_build_array(q2) then raise exception 'the trigger dropped another key: %', w.payload; end if;

  -- a post whose target is forged is written with none; one whose target is authentic, or no quoted post, keeps it
  w := tests.said(ch2, th, format('[quote=%s]Words never said.[/quote]', q), base + interval '3 minutes', 'post', q);
  if w.target_act_id is not null then raise exception 'a post replying to a forged post keeps its target: %', w.target_act_id; end if;
  w := tests.said(ch2, th, format('[quote=%s]The quoted words.[/quote]', q), base + interval '3 minutes', 'post', q);
  if w.target_act_id is distinct from q then raise exception 'a post replying to an authentic post lost its target: %', w.target_act_id; end if;
  w := tests.said(ch2, th, format('[quote=%s]Words never said.[/quote] and a reply to the other', q), base + interval '3 minutes', 'post', q2);
  if w.target_act_id is distinct from q2 then raise exception 'a post whose target is not forged lost it: %', w.target_act_id; end if;
  w := tests.said(ch2, th, 'No quote, a reply', base + interval '3 minutes', 'post', q);
  if w.target_act_id is distinct from q then raise exception 'a post with no quote lost its target: %', w.target_act_id; end if;

  -- an edit's verdict is its own, and the post's current payload carries the latest edit's
  p := tests.said(ch2, th, format('[quote=%s]Words never said.[/quote]', q), base + interval '4 minutes');
  if act_forged(p.payload) is distinct from array[q] then raise exception 'the post''s own verdict: %', p.payload; end if;
  e := tests.said(ch2, th, format('[quote=%s]The quoted words.[/quote] fixed', q), base + interval '5 minutes', 'edit', p.id);
  if e.payload ? 'forged' or e.target_act_id is distinct from p.id then raise exception 'an honest edit of a forged post carries a verdict or lost its post: %', e; end if;
  if (select act_forged(a.current_payload) from acts_public a where a.id = p.id) is distinct from '{}'::uuid[] then raise exception 'the post''s current payload still carries the first verdict'; end if;
  if act_forged((select a.payload from acts a where a.id = p.id)) is distinct from array[q] then raise exception 'an edit changed the post''s own payload'; end if;
  e := tests.said(ch2, th, format('[quote=%s]Words never said again.[/quote]', q2), base + interval '6 minutes', 'edit', p.id);
  if act_forged(e.payload) is distinct from array[q2] then raise exception 'a doctored edit''s verdict: %', e.payload; end if;
  if (select act_forged(a.current_payload) from acts_public a where a.id = p.id) is distinct from array[q2] then raise exception 'the post''s current payload does not carry the latest edit''s verdict'; end if;
  -- an edit's own target stays: it is its post whatever its verdict
  if e.target_act_id is distinct from p.id then raise exception 'an edit lost its post'; end if;
  -- a client's forged on an edit is overwritten
  e := tests.said(ch2, th, 'Plain edit', base + interval '7 minutes', 'edit', p.id, jsonb_build_object('forged', jsonb_build_array(q)));
  if e.payload ? 'forged' then raise exception 'a client''s forged survives on an edit: %', e.payload; end if;

  -- a spin (written with the origin post as its target, as a spin is): the verdict is written for a doctored quote and absent for an honest one, and its target (the origin) is never nulled,
  -- even when the origin is the forged post
  s := tests.said(ch2, th, format('[quote=%s]Words never said.[/quote]', q), base + interval '8 minutes', 'spin', q);
  if s.kind is distinct from 'spin' or act_forged(s.payload) is distinct from array[q] then raise exception 'a spin''s verdict: %', s; end if;
  if s.target_act_id is distinct from q then raise exception 'a spin whose origin is forged lost its origin: %', s.target_act_id; end if;
  s := tests.said(ch2, th, format('[quote=%s]The quoted words.[/quote]', q), base + interval '8 minutes', 'spin', q);
  if s.kind is distinct from 'spin' or s.payload ? 'forged' or s.target_act_id is distinct from q then raise exception 'an honest spin: %', s; end if;
  if not exists (select 1 from quote_sources x where x.act = s.id) then raise exception 'a spin has no source'; end if;
  -- a spin is a version too: quoted, its body is what an honest quote stands in
  s := tests.said(ch2, th, 'Spun words of the origin.', base + interval '9 minutes', 'spin', q);
  v := quote_forged(format('[quote=%s]Spun words of the origin.[/quote]', s.id), base + interval '10 minutes');
  if v is distinct from '{}'::uuid[] then raise exception 'an honest quote of a spin is forged: %', v; end if;
  v := quote_forged(format('[quote=%s]Spun words never said.[/quote]', s.id), base + interval '10 minutes');
  if v is distinct from array[s.id] then raise exception 'a doctored quote of a spin is not forged: %', v; end if;
  -- the trigger's kinds, and its place: before acts_quote_guard, an ordinary trigger (not `always`)
  if (select count(*) from pg_trigger t where t.tgrelid = 'acts'::regclass and t.tgname = 'acts_forged_quotes' and t.tgenabled = 'O' and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4) is distinct from 1::bigint then
    raise exception 'acts_forged_quotes is not an ordinary before-insert trigger';
  end if;
  if not ('acts_forged_quotes' < 'acts_quote_guard') then raise exception 'acts_forged_quotes does not fire before acts_quote_guard'; end if;
  if pg_get_triggerdef((select t.oid from pg_trigger t where t.tgrelid = 'acts'::regclass and t.tgname = 'acts_forged_quotes')) !~ '''post''.*''spin''.*''edit''' then
    raise exception 'acts_forged_quotes is not for post, spin and edit: %', pg_get_triggerdef((select t.oid from pg_trigger t where t.tgrelid = 'acts'::regclass and t.tgname = 'acts_forged_quotes'));
  end if;
  -- the guard sees the verdict: a post that quotes what it has doctored is written after the trigger, so its target is gone before the guard reads it
  if (select min(t.tgname) from pg_trigger t where t.tgrelid = 'acts'::regclass and t.tgtype & 2 = 2 and t.tgname in ('acts_forged_quotes', 'acts_quote_guard')) is distinct from 'acts_forged_quotes' then
    raise exception 'acts_forged_quotes sorts after acts_quote_guard';
  end if;
end $$;

-- ---- quote_sources: one row for each version with a text body, insert-only, read by no client ----
do $$
declare
  au uuid := tests.account('fq-sources');
  ch uuid := tests.character(au, 'Fq Sources');
  th uuid := tests.thread('Forged sources');
  base timestamptz := now() - interval '1 day';
  q uuid; ed uuid; tally uuid; w acts; n integer; cut text := chr(64976);
begin
  q := tests.post(ch, th, 'Source   words [b]here[/b].', base);
  ed := tests.act(ch, 'edit', th, '{"body": "Edited ... source"}', q, base + interval '1 minute');
  tally := tests.act(null, 'tally', th, '{"note": "no body"}', null, base + interval '2 minutes');
  if (select s.source from quote_sources s where s.act = q) is distinct from 'Source words here.' then raise exception 'a post''s source: %', (select s.source from quote_sources s where s.act = q); end if;
  if (select s.digest from quote_sources s where s.act = q) is distinct from md5('Source words here.') then raise exception 'a source''s digest is not its md5'; end if;
  if (select s.source from quote_sources s where s.act = ed) is distinct from 'Edited ... source' then raise exception 'an edit''s source: %', (select s.source from quote_sources s where s.act = ed); end if;
  if exists (select 1 from quote_sources s where s.act = tally) then raise exception 'an Act with no body has a source'; end if;
  -- a cut is kept as a separator in the source
  w := tests.said(ch, th, repeat('[quote=' || q || ']', 17) || 'x' || repeat('[/quote]', 17), base + interval '3 minutes');
  if (select s.source from quote_sources s where s.act = w.id) is null then raise exception 'a post of deep quotes has no source'; end if;
  -- the source is the walk of the whole body, for a post that quotes
  w := tests.said(ch, th, format('Mine [quote=%s]Source words here.[/quote] and more', q), base + interval '4 minutes');
  if (select s.source from quote_sources s where s.act = w.id) is distinct from 'Mine Source words here. and more' then raise exception 'a quoting post''s source: %', (select s.source from quote_sources s where s.act = w.id); end if;

  -- insert-only: an update, a delete and a truncate refuse, even with triggers off
  begin update quote_sources set digest = 'x' where act = q; raise exception 'a source was updated'; exception when sqlstate 'P0001' then null; end;
  begin delete from quote_sources where act = q; raise exception 'a source was deleted'; exception when sqlstate 'P0001' then null; end;
  begin truncate quote_sources; raise exception 'sources were truncated'; exception when sqlstate 'P0001' then null; end;
  set local session_replication_role = replica;
  begin update quote_sources set digest = 'x' where act = q; raise exception 'a source was updated in replica mode'; exception when sqlstate 'P0001' then null; end;
  begin delete from quote_sources where act = q; raise exception 'a source was deleted in replica mode'; exception when sqlstate 'P0001' then null; end;
  set local session_replication_role = origin;
  if (select count(*) from pg_trigger t where t.tgrelid = 'quote_sources'::regclass and not t.tgisinternal and t.tgenabled = 'A') is distinct from 2::bigint then raise exception 'quote_sources has not its two append-only triggers, enabled always'; end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'quote_sources'::regclass) then raise exception 'quote_sources has no row level security'; end if;
  -- read by no client role
  if exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = 'quote_sources' and g.grantee in ('anon', 'authenticated', 'public')) then
    raise exception 'a client role is granted quote_sources';
  end if;
  perform tests.become(au);
  begin perform count(*) from quote_sources; raise exception 'a player read quote_sources'; exception when insufficient_privilege then null; end;
  perform tests.unbecome();
  perform tests.become_anon();
  begin perform count(*) from quote_sources; raise exception 'a signed-out reader read quote_sources'; exception when insufficient_privilege then null; end;
  perform tests.unbecome();
end $$;

-- ---- Acts already written: a restore keeps what was written, the backfill writes sources and never a verdict ----
do $$
declare
  au uuid := tests.account('fq-old');
  ch uuid := tests.character(au, 'Fq Old');
  th uuid := tests.thread('Forged old');
  base timestamptz := now() - interval '1 day';
  q uuid; old_post uuid; kept uuid; before_payload jsonb; n bigint;
begin
  q := tests.post(ch, th, 'The words of the old post.', base);
  -- written with the two triggers off (as every Act before the migration was; a restore with triggers off keeps them off too, they are ordinary triggers): as written, no verdict, no source
  alter table acts disable trigger acts_forged_quotes;
  alter table acts disable trigger acts_quote_sources;
  old_post := tests.act(ch, 'post', th, jsonb_build_object('body', format('[quote=%s]Never said.[/quote]', q)), null, base + interval '1 minute');
  kept := tests.act(ch, 'post', th, jsonb_build_object('body', format('[quote=%s]Never said.[/quote]', q), 'forged', jsonb_build_array(q)), null, base + interval '2 minutes');
  alter table acts enable trigger acts_forged_quotes;
  alter table acts enable trigger acts_quote_sources;
  if (select a.payload from acts a where a.id = old_post) ? 'forged' then raise exception 'a restore wrote a verdict'; end if;
  if act_forged((select a.payload from acts a where a.id = kept)) is distinct from array[q] then raise exception 'a restore did not keep the verdict it was handed'; end if;
  if exists (select 1 from quote_sources s where s.act in (old_post, kept)) then raise exception 'a restore wrote sources'; end if;
  before_payload := (select a.payload from acts a where a.id = old_post);
  -- the migration's backfill, as written there: a source for each version already written, and no verdict
  insert into quote_sources (act, source, digest)
  select a.id, w.source, md5(w.source)
  from acts a, lateral bbcode_walk(a.payload ->> 'body', null, act_forged(a.payload), true) w
  where a.kind in ('post', 'spin', 'edit') and jsonb_typeof(a.payload -> 'body') = 'string'
  on conflict do nothing;
  if (select s.source from quote_sources s where s.act = old_post) is distinct from 'Never said.' then raise exception 'the backfill wrote no source for an old post'; end if;
  if (select a.payload from acts a where a.id = old_post) is distinct from before_payload then raise exception 'the backfill changed an Act'; end if;
  -- an old post is a version like any: quoting it is judged by its source
  if tests.verdict(format('[quote=%s]Never said.[/quote]', old_post), base + interval '1 hour') is distinct from '{}'::uuid[] then raise exception 'a quote of an old post is forged'; end if;
  if tests.verdict(format('[quote=%s]Said.[/quote]', old_post), base + interval '1 hour') is distinct from array[old_post] then raise exception 'a doctored quote of an old post is authentic'; end if;
end $$;
