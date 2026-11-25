-- kayfabb-sql: alone
-- This file holds wall-clock budgets, so it runs with nothing beside it (#1099).
-- The clock of quote_forged covers every step that grows with a post's history, not only the strpos tests (supabase/migrations/0393_forged_quotes.sql, quote_forged and quote_search_cap; final review G1 and G2).
-- Three cases, each red against the build that lacked what it names:
--   G2a, many cheap versions: a post of 100,000 versions an admin hid. A hidden version never reaches the per-quote clock read, so only the clock read before each version bounds the loop; without it the
--     loop asks version_hidden of every row (seconds), and with it the call stops at the cap and the post is forged.
--   G2b, many quotes against one huge version: 20 distinct near-miss quotes of about 9,000 characters against one version of 20,000 characters (periodic, the odd letter first: a strpos of about 30 ms
--     each); only the clock read before each quote bounds the one version, so without it the call takes about the sum of them (seconds).
--   G1, many edits: a post of 200,000 edits, a quote of words only its oldest version holds. The version scan streams from the ordered index acts_edits, so the clock bounds reading the versions as well;
--     a query that read and sorted every version before its first clock read spent a time linear in the edits (over 300 ms here) before the loop began. The quote forges by the cap, under BUDGET.
-- The rows of G2a and G1 are written cheaply: the replica role (no triggers, no foreign keys) for this transaction's inserts, the sources written by hand as the trigger writes them, and then analyzed, as the
-- repository's own tests do for a fixture at scale. The assertions are on a verdict and on a budget over twice the cap with a full search at seconds, so no runner's speed decides one.
do $$
declare
  BUDGET constant interval := interval '250 milliseconds';
  EDITS constant integer := 200000;
  au uuid := tests.account('fqk-author');
  adm uuid := tests.account('fqk-admin');
  ch uuid := tests.character(au, 'Fqk Author');
  th uuid := tests.thread('Forged clock');
  base timestamptz := now() - interval '3 days';
  post_id uuid; qbody text; v uuid[]; t0 timestamptz; spent interval; walk interval; i integer; parts text[];
begin
  -- G2a: 100,000 hidden versions (one decision hides the post's first version, and every edit written after a `hide` is hidden with it)
  post_id := tests.post(ch, th, 'hidden root words', base);
  set local session_replication_role = replica;
  insert into acts (character, kind, thread, payload, target_act_id, created_at)
  select ch, 'edit', th, jsonb_build_object('body', 'hidden edit ' || g), post_id, base + make_interval(secs => g) from generate_series(1, 100000) g;
  insert into quote_sources (act, source, digest) select a.id, a.payload ->> 'body', md5(a.payload ->> 'body') from acts a where a.target_act_id = post_id and a.kind = 'edit';
  insert into conduct_decisions (version_act, post, admin, outcome, at) values (post_id, post_id, adm, 'hide', base);
  set local session_replication_role = origin;
  analyze acts; analyze quote_sources; analyze conduct_decisions;
  qbody := format('[quote=%s]never said these words[/quote]', post_id);
  t0 := clock_timestamp(); v := quote_forged(qbody, now()); spent := clock_timestamp() - t0;
  raise notice 'clock, 100,000 hidden versions: quote_forged %, %', spent, v;
  if v is distinct from array[post_id] then raise exception 'clock: 100,000 hidden versions are not forged: %', v; end if;
  if spent > BUDGET then raise exception 'clock: 100,000 hidden versions took %, over the budget of %', spent, BUDGET; end if;

  -- G2b: one version, 20 distinct near-miss quotes (multibyte, the odd letter first: one strpos is about 30 ms here, and the walk of such a body is the larger part of its time, so it is timed apart and the
  -- assertion is on the search that follows it)
  post_id := tests.post(ch, th, 'z1' || repeat(' 😀😁', 6600) || ' end', base);
  parts := '{}';
  for i in 2..21 loop parts := parts || format('[quote=%s]z%s%s[/quote]', post_id, i, repeat(' 😀😁', 3000)); end loop;
  qbody := array_to_string(parts, ' ');
  t0 := clock_timestamp(); perform bbcode_walk(qbody, null, '{}', true); walk := clock_timestamp() - t0;
  t0 := clock_timestamp(); v := quote_forged(qbody, now()); spent := clock_timestamp() - t0 - walk;
  raise notice 'clock, 20 quotes of one version: quote_forged % past its walk of %, %', spent, walk, v;
  if v is distinct from array[post_id] then raise exception 'clock: 20 near-miss quotes are not forged: %', v; end if;
  if spent > interval '200 milliseconds' then raise exception 'clock: 20 quotes against one version took % past the walk, over the budget of 200 ms', spent; end if;

  -- G1: 200,000 edits of one post, the words only in the oldest version
  post_id := tests.post(ch, th, 'the oldest words only here', base);
  set local session_replication_role = replica;
  insert into acts (character, kind, thread, payload, target_act_id, created_at)
  select ch, 'edit', th, jsonb_build_object('body', 'a later edit, number ' || g), post_id, base + make_interval(secs => g) from generate_series(1, EDITS) g;
  insert into quote_sources (act, source, digest) select a.id, a.payload ->> 'body', md5(a.payload ->> 'body') from acts a where a.target_act_id = post_id and a.kind = 'edit';
  set local session_replication_role = origin;
  analyze acts; analyze quote_sources;
  qbody := format('[quote=%s]oldest words only[/quote]', post_id);
  t0 := clock_timestamp(); v := quote_forged(qbody, now()); spent := clock_timestamp() - t0;
  raise notice 'clock, % edits: quote_forged %, %', EDITS, spent, v;
  if v is distinct from array[post_id] then raise exception 'clock: a quote of the oldest of % edits is not forged by the cap: %', EDITS, v; end if;
  if spent > interval '200 milliseconds' then raise exception 'clock: % edits took %, over the budget (the cap and what one test can run past it)', EDITS, spent; end if;
  -- and the newest version, found at once, is authentic whatever the history
  v := quote_forged(format('[quote=%s]a later edit, number %s[/quote]', post_id, EDITS), now());
  if cardinality(v) <> 0 then raise exception 'clock: a quote of the newest of % edits is forged: %', EDITS, v; end if;
end $$;
