-- kayfabb-sql: alone
-- This file holds wall-clock budgets, so it runs with nothing beside it (#1099).
-- The verdict's cost (supabase/migrations/0393_forged_quotes.sql, section 3; docs/plans/2026-11-20-forged-quotes-design.md, section 12). The budgets and the sizes are written once, here, at the top of the block:
--   hostile: a 20,000-character body quotes one post that has 20 distinct 20,000-character versions, in each of four shapes that make a string search slow (a run of one letter, `ab...`, `aaaaaaaab...`,
--     `abcdefgh...`), the quote a near-miss of 10,000 characters (the shape's own words, then a letter the post never has), so every version is searched and none holds: quote_forged under SHAPE_BUDGET each.
--   busy: 300 quotes of 300 posts with 3 versions each, doctored (all three versions searched for each) and authentic of the oldest version (the last one tried): under BUSY_BUDGET each.
-- A shape that misses its budget stops the task and goes to the owner, who chooses the search (the plan's Task 3), so the assertions here are the budgets and nothing is tuned around them.
-- The time cap (quote_search_cap) bounds the search whatever the shape: the cases further down add the shapes that a count of characters could not bound (a periodic quote whose odd letter comes first, many versions,
-- thousands of tiny versions). Each version's text is distinct by a suffix (the same text twice is searched once, by digest), and the shape's words are what the quote's cap on runs (quote_run_cap, eight) leaves of them.
do $$
declare
  SHAPE_BUDGET constant interval := interval '250 milliseconds';
  BUSY_BUDGET constant interval := interval '250 milliseconds';
  BODY_CHARS constant integer := 20000;
  VERSIONS constant integer := 20;
  NEEDLE_CHARS constant integer := 10000;
  POSTS constant integer := 300;
  POST_VERSIONS constant integer := 3;

  au uuid := tests.account('fqs-author');
  ch uuid := tests.character(au, 'Fqs Author');
  th uuid := tests.thread('Forged scale');
  base timestamptz := now() - interval '1 day';
  shapes constant text[][] := array[['a run of one letter', 'a'], ['ab...', 'ab'], ['aaaaaaaab...', 'aaaaaaaab'], ['abcdefgh...', 'abcdefgh']];
  unit text; label text; post_id uuid; qbody text; v uuid[]; t0 timestamptz; spent interval;
  i integer; j integer; ids uuid[] := '{}'; parts text[]; filler text; walk_spent interval; w record; front boolean;
begin
  for s in 1..array_length(shapes, 1) * 2 loop
    -- the first four are the near-miss with its odd letter at the end, the next four with it at the FRONT (strpos, Boyer-Moore-Horspool, skips at once from the end and costs the length times the needle's for a periodic one at the front)
    front := s > array_length(shapes, 1);
    label := shapes[(s - 1) % array_length(shapes, 1) + 1][1] || case when front then ', odd letter first' else '' end; unit := shapes[(s - 1) % array_length(shapes, 1) + 1][2];
    post_id := tests.post(ch, th, left(repeat(unit, BODY_CHARS), BODY_CHARS - 10) || ' version 0', base);
    for i in 1..VERSIONS - 1 loop
      perform tests.act(ch, 'edit', th, jsonb_build_object('body', left(repeat(unit, BODY_CHARS), BODY_CHARS - 10) || ' version ' || i), post_id, base + make_interval(mins => i));
    end loop;
    if (select count(distinct s2.digest) from quote_sources s2 where s2.act = post_id or s2.act in (select e.id from acts e where e.kind = 'edit' and e.target_act_id = post_id)) is distinct from VERSIONS::bigint then
      raise exception '% : the versions are not % distinct sources', label, VERSIONS;
    end if;
    filler := repeat('own words here ', 1000);
    qbody := format('[quote=%s]%s[/quote] ', post_id, case when front then 'z' || left(repeat(unit, NEEDLE_CHARS), NEEDLE_CHARS) else left(repeat(unit, NEEDLE_CHARS), NEEDLE_CHARS) || 'z' end) || left(filler, BODY_CHARS - NEEDLE_CHARS - 80);
    t0 := clock_timestamp();
    select w2.held into w from bbcode_walk(qbody, null, '{}', true) w2;
    walk_spent := clock_timestamp() - t0;
    t0 := clock_timestamp();
    v := quote_forged(qbody, now());
    spent := clock_timestamp() - t0;
    raise notice 'shape %: body % chars, quote_forged %, of which the walk %', label, char_length(qbody), spent, walk_spent;
    if v is distinct from array[post_id] then raise exception '% : a near-miss is not forged: %', label, v; end if;
    if spent > SHAPE_BUDGET then raise exception '% : quote_forged took %, over the budget of %', label, spent, SHAPE_BUDGET; end if;
  end loop;

  -- busy: 300 posts, three versions each
  for i in 1..POSTS loop
    ids := ids || tests.post(ch, th, format('Post %s of the busy instance said these words in its first version, number %s.', i, i * 7), base + make_interval(secs => i));
  end loop;
  for i in 1..POSTS loop
    for j in 1..POST_VERSIONS - 1 loop
      perform tests.act(ch, 'edit', th, jsonb_build_object('body', format('Post %s of the busy instance, edited %s times, says other words.', i, j)), ids[i], base + interval '1 hour' + make_interval(secs => i * 10 + j));
    end loop;
  end loop;
  -- the fixture is analyzed, as a busy instance's tables are: the version scan is an ordered index scan whose plan the statistics choose (final review G1)
  analyze acts; analyze quote_sources;
  -- doctored: every version of every post searched
  parts := '{}';
  for i in 1..POSTS loop parts := parts || format('[quote=%s]Post %s of the busy instance said these words in no version, number %s.[/quote]', ids[i], i, i * 7); end loop;
  qbody := array_to_string(parts, ' ');
  t0 := clock_timestamp(); v := quote_forged(qbody, now()); spent := clock_timestamp() - t0;
  raise notice 'busy, doctored: % quotes, quote_forged %', POSTS, spent;
  if cardinality(v) <> POSTS then raise exception 'busy: % of % doctored posts are forged', cardinality(v), POSTS; end if;
  if spent > BUSY_BUDGET then raise exception 'busy, doctored: quote_forged took %, over the budget of %', spent, BUSY_BUDGET; end if;
  -- authentic, of the oldest version: the last one tried
  parts := '{}';
  for i in 1..POSTS loop parts := parts || format('[quote=%s]Post %s of the busy instance said these words in its first version, number %s.[/quote]', ids[i], i, i * 7); end loop;
  qbody := array_to_string(parts, ' ');
  t0 := clock_timestamp(); v := quote_forged(qbody, now()); spent := clock_timestamp() - t0;
  raise notice 'busy, authentic of the oldest: % quotes, quote_forged %', POSTS, spent;
  if cardinality(v) is distinct from 0::bigint then raise exception 'busy: % authentic quotes are forged', cardinality(v); end if;
  if spent > BUSY_BUDGET then raise exception 'busy, authentic: quote_forged took %, over the budget of %', spent, BUSY_BUDGET; end if;
end $$;

-- many versions (final review, F1): one post of about 20,000 characters with VERSIONS_MANY distinct versions, the words searched for only in the oldest, quoted by a body of about 370 quotes. Every version
-- newer than the oldest is searched and misses, so a search that fetched the text once for each quote and version (370 x 50 reads of 20 KB) took seconds. quote_forged, and a post() insert (the verdict is
-- worked out in post(), before the thread lock, and handed to the trigger), are each under MANY_BUDGET. Three shapes of body: the reviewer's (the same quote 370 times), 350 distinct quotes that all hold in
-- the oldest version (so the budget, not the search, decides: the work is over QUOTE_WORK_BUDGET and the post is forged, in time), and 20 distinct quotes (the same search, within the budget: authentic).
create function pg_temp.noise(n integer) returns text language sql as $$
  select left(string_agg(md5(random()::text || g::text), ' '), n) from generate_series(1, n / 32 + 1) g
$$;
do $$
declare
  MANY_BUDGET constant interval := interval '250 milliseconds';
  VERSIONS_MANY constant integer := 50;
  BODY_CHARS constant integer := 20000;

  au uuid := tests.account('fqm-author');
  ch uuid := tests.character(au, 'Fqm Author');
  th uuid := tests.thread('Forged many versions');
  base timestamptz := now() - interval '1 day';
  post_id uuid; qbody text; v uuid[]; t0 timestamptz; spent interval; i integer; parts text[]; oldest text; r jsonb; new_id uuid;
begin
  -- the oldest version holds the words `zq` and `w000` ... `w369`; the newer ones hold none of them (noise that does not compress, so a read of one pays its full detoast, distinct by a suffix)
  oldest := 'zq ' || (select string_agg(format('w%s', lpad(n::text, 3, '0')), ' ') from generate_series(0, 369) n);
  oldest := oldest || ' ' || pg_temp.noise(BODY_CHARS - char_length(oldest) - 20) || ' version 0';
  post_id := tests.post(ch, th, oldest, base);
  for i in 1..VERSIONS_MANY - 1 loop
    perform tests.act(ch, 'edit', th, jsonb_build_object('body', pg_temp.noise(BODY_CHARS - 20) || ' version ' || i), post_id, base + make_interval(mins => i));
  end loop;
  if (select count(distinct s2.digest) from quote_sources s2 where s2.act = post_id or s2.act in (select e.id from acts e where e.kind = 'edit' and e.target_act_id = post_id)) is distinct from VERSIONS_MANY::bigint then
    raise exception 'many: the versions are not % distinct sources', VERSIONS_MANY;
  end if;

  -- the reviewer's body: the same quote, about 370 times
  parts := '{}';
  for i in 1..370 loop parts := parts || format('[quote=%s]zq[/quote]', post_id); end loop;
  qbody := array_to_string(parts, '');
  t0 := clock_timestamp(); v := quote_forged(qbody, now()); spent := clock_timestamp() - t0;
  raise notice 'many, the same quote 370 times: body % chars, quote_forged %', char_length(qbody), spent;
  if cardinality(v) <> 0 then raise exception 'many: a quote that holds in the oldest version is forged: %', v; end if;
  if spent > MANY_BUDGET then raise exception 'many: quote_forged took %, over the budget of %', spent, MANY_BUDGET; end if;
  perform tests.become(au);
  t0 := clock_timestamp(); r := post(th, ch, qbody); spent := clock_timestamp() - t0; new_id := (r ->> 'id')::uuid;
  perform tests.unbecome();
  raise notice 'many, the same quote 370 times: post() %', spent;
  if jsonb_typeof(r) is distinct from 'object' then raise exception 'many: post returned %', r; end if;
  if spent > MANY_BUDGET then raise exception 'many: the post insert took %, over the budget of %', spent, MANY_BUDGET; end if;
  if (select a.payload ? 'forged' from acts a where a.character = ch and a.kind = 'post' and a.payload ->> 'body' = qbody) then raise exception 'many: the authentic post was written forged'; end if;

  -- the hostile body: 350 distinct quotes, each holds in the oldest version only; 350 x 50 x 20,000 is over the budget
  parts := '{}';
  for i in 0..349 loop parts := parts || format('[quote=%s]w%s[/quote]', post_id, lpad(i::text, 3, '0')); end loop;
  qbody := array_to_string(parts, '');
  t0 := clock_timestamp(); v := quote_forged(qbody, now()); spent := clock_timestamp() - t0;
  raise notice 'many, 350 distinct quotes: body % chars, quote_forged %', char_length(qbody), spent;
  if v is distinct from array[post_id] then raise exception 'many: a body over the work budget is not forged: %', v; end if;
  if spent > MANY_BUDGET then raise exception 'many: the hostile body took %, over the budget of %', spent, MANY_BUDGET; end if;
  perform tests.become(au);
  t0 := clock_timestamp(); r := post(th, ch, qbody); spent := clock_timestamp() - t0;
  perform tests.unbecome();
  raise notice 'many, 350 distinct quotes: post() %', spent;
  if spent > MANY_BUDGET then raise exception 'many: the hostile post insert took %, over the budget of %', spent, MANY_BUDGET; end if;
  if (select not coalesce(a.payload -> 'forged' @> to_jsonb(array[post_id]), false) from acts a where a.character = ch and a.kind = 'post' and a.payload ->> 'body' = qbody) then raise exception 'many: the hostile post was not written forged'; end if;

  -- 20 distinct quotes: 20 x 50 x 20,000 is under the budget, and every one holds in the oldest version
  parts := '{}';
  for i in 0..19 loop parts := parts || format('[quote=%s]w%s[/quote]', post_id, lpad(i::text, 3, '0')); end loop;
  qbody := array_to_string(parts, '');
  t0 := clock_timestamp(); v := quote_forged(qbody, now()); spent := clock_timestamp() - t0;
  raise notice 'many, 20 distinct quotes: quote_forged %', spent;
  if cardinality(v) <> 0 then raise exception 'many: 20 quotes within the budget are forged: %', v; end if;
  if spent > MANY_BUDGET then raise exception 'many: 20 quotes took %, over the budget of %', spent, MANY_BUDGET; end if;
end $$;

-- The time cap (final delta review, D1 and D2; supabase/migrations/0393_forged_quotes.sql, quote_search_cap). A count of characters cannot bound strpos, so the search stops by the clock: past 100 ms every post with an
-- unmatched quote is forged. Three shapes whose full search takes seconds or whose rows cost a few hundred milliseconds, so a cap taken out or set far higher fails by the clock on every runner, and none of the
-- assertions depends on a timing that a slow runner could miss by a little: the full search is 5 s or more (50 times the cap, and 20 times the budget asserted), and the budget asserted is the plan's 250 ms.
--   front-odd, 200 versions: versions `vN ab ab ...` (20,000 characters), two quotes `zN ab ab ...` of about 9,000: a near-miss quote (not in any version) and the same quote that DOES hold in the oldest version
--     (the cap forges an honest quote that asks for 5 s of search); each quote_forged and a post() insert under CAP_BUDGET, forged.
--   tiny, 5,000 versions of about 20 characters: a near-miss quote, so every row is read and missed (about 300 ms uncapped; a near-miss, because a runner three times faster would finish and an honest quote would then
--     be authentic, so the verdict is forged either way and the assertion is the clock): forged, under CAP_BUDGET.
--   the constant: quote_search_cap() is 100 ms; a change of it goes through this test and the two above.
do $$
declare
  CAP_BUDGET constant interval := interval '250 milliseconds';
  au uuid := tests.account('fqc-author');
  ch uuid := tests.character(au, 'Fqc Author');
  th uuid := tests.thread('Forged time cap');
  base timestamptz := now() - interval '1 day';
  post_id uuid; i integer; qbody text; v uuid[]; t0 timestamptz; spent interval; r jsonb;
begin
  if quote_search_cap() is distinct from interval '100 milliseconds' then raise exception 'cap: quote_search_cap is %, not 100 ms', quote_search_cap(); end if;

  -- front-odd: the oldest version is `z1 ab ab ...`, the 199 newer are `vN ab ab ...`
  post_id := tests.post(ch, th, 'z1' || repeat(' ab', 6600) || ' end0', base);
  for i in 1..199 loop
    perform tests.act(ch, 'edit', th, jsonb_build_object('body', 'v' || i || repeat(' ab', 6600) || ' end' || i), post_id, base + make_interval(mins => i));
  end loop;
  -- a near-miss (`z2 ab ...` stands in no version) and an honest one (`z1 ab ...` stands in the oldest)
  foreach qbody in array array[format('[quote=%s]z2%s[/quote] [quote=%s]z3%s[/quote]', post_id, repeat(' ab', 3000), post_id, repeat(' ab', 3000)),
                              format('[quote=%s]z1%s[/quote] [quote=%s]z1%s[/quote]', post_id, repeat(' ab', 3000), post_id, repeat(' ab', 2999))] loop
    t0 := clock_timestamp(); v := quote_forged(qbody, now()); spent := clock_timestamp() - t0;
    raise notice 'cap, front-odd 200 versions: body % chars, quote_forged %, %', char_length(qbody), spent, v;
    if v is distinct from array[post_id] then raise exception 'cap: front-odd, 200 versions, is not forged: %', v; end if;
    if spent > CAP_BUDGET then raise exception 'cap: front-odd, 200 versions, quote_forged took %, over the budget of %', spent, CAP_BUDGET; end if;
    perform tests.become(au);
    t0 := clock_timestamp(); r := post(th, ch, qbody); spent := clock_timestamp() - t0;
    perform tests.unbecome();
    raise notice 'cap, front-odd 200 versions: post() %', spent;
    if spent > CAP_BUDGET then raise exception 'cap: front-odd, 200 versions, the post insert took %, over the budget of %', spent, CAP_BUDGET; end if;
    if (select not coalesce(a.payload -> 'forged' @> to_jsonb(array[post_id]), false) from acts a where a.id = (r ->> 'id')::uuid) then raise exception 'cap: the front-odd post was not written forged'; end if;
  end loop;

  -- tiny: 5,000 versions, a quote of words none of them has
  post_id := tests.post(ch, th, 'oldest tiny words', base);
  for i in 1..5000 loop
    perform tests.act(ch, 'edit', th, jsonb_build_object('body', 'tiny version number ' || i), post_id, base + make_interval(secs => i));
  end loop;
  qbody := format('[quote=%s]never said these words[/quote]', post_id);
  t0 := clock_timestamp(); v := quote_forged(qbody, now()); spent := clock_timestamp() - t0;
  raise notice 'cap, 5,000 tiny versions: quote_forged %, %', spent, v;
  if v is distinct from array[post_id] then raise exception 'cap: 5,000 tiny versions are not forged: %', v; end if;
  if spent > CAP_BUDGET then raise exception 'cap: 5,000 tiny versions took %, over the budget of %', spent, CAP_BUDGET; end if;
  -- the twin: the same quote of the newest version is found at once, and is authentic
  v := quote_forged(format('[quote=%s]tiny version number 5000[/quote]', post_id), now());
  if cardinality(v) <> 0 then raise exception 'cap: a quote of the newest of 5,000 versions is forged: %', v; end if;
end $$;
