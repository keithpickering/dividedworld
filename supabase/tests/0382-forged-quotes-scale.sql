-- The verdict's cost (supabase/migrations/0379_forged_quotes.sql, section 3; docs/plans/2026-11-20-forged-quotes-design.md, section 12). The budgets and the sizes are written once, here, at the top of the block:
--   hostile: a 20,000-character body quotes one post that has 20 distinct 20,000-character versions, in each of four shapes that make a string search slow (a run of one letter, `ab...`, `aaaaaaaab...`,
--     `abcdefgh...`), the quote a near-miss of 10,000 characters (the shape's own words, then a letter the post never has), so every version is searched and none holds: quote_forged under SHAPE_BUDGET each.
--   busy: 300 quotes of 300 posts with 3 versions each, doctored (all three versions searched for each) and authentic of the oldest version (the last one tried): under BUSY_BUDGET each.
-- A shape that misses its budget stops the task and goes to the owner, who chooses the search (the plan's Task 3), so the assertions here are the budgets and nothing is tuned around them.
-- Each version's text is distinct by a suffix (the same text twice is searched once, by digest), and the shape's words are what the quote's cap on runs (quote_run_cap, eight) leaves of them.
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
  i integer; j integer; ids uuid[] := '{}'; parts text[]; filler text; walk_spent interval; w record;
begin
  for s in 1..array_length(shapes, 1) loop
    label := shapes[s][1]; unit := shapes[s][2];
    post_id := tests.post(ch, th, left(repeat(unit, BODY_CHARS), BODY_CHARS - 10) || ' version 0', base);
    for i in 1..VERSIONS - 1 loop
      perform tests.act(ch, 'edit', th, jsonb_build_object('body', left(repeat(unit, BODY_CHARS), BODY_CHARS - 10) || ' version ' || i), post_id, base + make_interval(mins => i));
    end loop;
    if (select count(distinct s2.digest) from quote_sources s2 where s2.act = post_id or s2.act in (select e.id from acts e where e.kind = 'edit' and e.target_act_id = post_id)) is distinct from VERSIONS::bigint then
      raise exception '% : the versions are not % distinct sources', label, VERSIONS;
    end if;
    filler := repeat('own words here ', 1000);
    qbody := format('[quote=%s]%sz[/quote] ', post_id, left(repeat(unit, NEEDLE_CHARS), NEEDLE_CHARS)) || left(filler, BODY_CHARS - NEEDLE_CHARS - 80);
    t0 := clock_timestamp();
    select w2.held into w from bbcode_walk(qbody, null) w2;
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
