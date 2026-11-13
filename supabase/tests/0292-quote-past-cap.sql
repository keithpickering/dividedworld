-- A real quote past the cap is read, never text (docs/plans/2026-11-13-quote-cut-plan.md, Tasks 1 and 3). bbcode_walk is the SQL port of engine/bbcode/parse.ts; a quote the parser reads at any depth is
-- read here, and what stands inside one that is past the cap is in none of the reads: not `plain` (search, Says), not `unquoted` (own_words, rule_breaks, spring_facts), not an `excerpt`; its Act is
-- in `quotes` (so No-quote sees it).
--
-- The cap is written once, here, and must equal parse.ts's MAX_DEPTH and the `max_depth` of the newest migration that defines bbcode_walk; engine/bbcode/plain.test.ts reads this line and fails when
-- the three differ. The cases stand at the cap, a few past it and twice it, as bold tags around a quote and as a pyramid of quotes. Every failing case is collected before one raise, on purpose: a
-- sweep over depths is read for which depths fail, where the neighbors, which test one thing, raise at the first.
create function pg_temp.cap() returns integer language sql immutable as $$ select 16 $$;

-- A body with `n` bold tags around a real quote of `q` that holds `words`: the quote is the tag at level n + 1.
create function pg_temp.deep(n integer, q uuid, words text) returns text language sql immutable as $$
  select 'before ' || repeat('[b]', n) || format('[quote=%s]%s[/quote]', q, words) || repeat('[/b]', n) || ' after'
$$;
-- The same as a pyramid of real quotes of a visible post, the last of the hidden one.
create function pg_temp.pyramid(n integer, shown uuid, q uuid, words text) returns text language sql immutable as $$
  select 'before ' || repeat(format('[quote=%s]', shown), n) || format('[quote=%s]%s[/quote]', q, words) || repeat('[/quote]', n) || ' after'
$$;

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- ---- bbcode_walk: nothing inside a quote past the cap is in plain, unquoted or the excerpt; the quote's Act is in quotes ----
-- Every case is run and every failure listed, so one run says which depths hold.
do $$
declare
  q uuid := '11111111-1111-4111-8111-111111111111';
  s uuid := '22222222-2222-4222-8222-222222222222';
  words constant text := 'zqxjkvdeepwords';
  n integer;
  body text;
  shape text;
  w record;
  bad text[] := '{}';
begin
  -- the cases, by the number of tags around the quote: at the cap (the quote is level cap + 1), seven past it, twice the cap, twice the cap plus seven, and 200; each as bold tags and as a pyramid of quotes
  for n in select unnest(array[pg_temp.cap(), pg_temp.cap() + 7, 2 * pg_temp.cap(), 2 * pg_temp.cap() + 7, 200]) loop
    foreach shape in array array['tags', 'quotes'] loop
      body := case shape when 'tags' then pg_temp.deep(n, q, words) else pg_temp.pyramid(n, s, q, words) end;
      select * into w from bbcode_walk(body, null);
      if w.plain like '%' || words || '%' then bad := bad || format('plain holds the words (%s around, %s)', n, shape); end if;
      if w.unquoted like '%' || words || '%' then bad := bad || format('unquoted holds the words (%s around, %s)', n, shape); end if;
      if not (q::text = any (w.quotes)) then bad := bad || format('quotes lacks the Act (%s around, %s)', n, shape); end if;
      select * into w from bbcode_walk(body, q);
      if coalesce(w.excerpt, '') <> '' then bad := bad || format('the excerpt of the Act is not empty (%s around, %s)', n, shape); end if;
      if own_words(body) like '%' || words || '%' then bad := bad || format('own_words judges the words (%s around, %s)', n, shape); end if;
    end loop;
  end loop;
  if cardinality(bad) > 0 then raise exception 'a quote past the cap is read as text: %', array_to_string(bad, '; '); end if;
  -- the control: under the cap the quote is read as it always was, so the same questions find its words where they belong
  select * into w from bbcode_walk(pg_temp.deep(1, q, words), q);
  if w.excerpt is distinct from words then raise exception 'the control (a quote under the cap) has no excerpt: %', w.excerpt; end if;
  select * into w from bbcode_walk(pg_temp.deep(1, q, words), null);
  if w.plain like '%' || words || '%' then raise exception 'the control (a quote under the cap) is in plain'; end if;
  if w.unquoted like '%' || words || '%' then raise exception 'the control (a quote under the cap) is in unquoted'; end if;
  if not (q::text = any (w.quotes)) then raise exception 'the control (a quote under the cap) is not in quotes'; end if;
  -- the control at the edge: a real quote at the last uncut level (level cap, behind cap - 1 wrappers) is still a quote that is shown, with its excerpt
  select * into w from bbcode_walk(pg_temp.deep(pg_temp.cap() - 1, q, words), q);
  if w.excerpt is distinct from words then raise exception 'a quote at the last uncut level (level %) has no excerpt: %', pg_temp.cap(), w.excerpt; end if;
  select * into w from bbcode_walk(pg_temp.deep(pg_temp.cap() - 1, q, words), null);
  if w.plain like '%' || words || '%' or w.unquoted like '%' || words || '%' or not (q::text = any (w.quotes)) then
    raise exception 'a quote at the last uncut level (level %) is not read as a quote', pg_temp.cap();
  end if;
end $$;

-- ---- rule_breaks does not judge the words of a quote past the cap ----
select tests.unbecome();
do $$
declare
  seed jsonb;
  author uuid := tests.account('qc-author');
  ch uuid := tests.character(author, 'Qc Ada');
  th uuid;
  rule uuid;
  base timestamptz := now() - interval '1 day';
  q uuid; deepest uuid; shallow uuid; own uuid;
  n integer;
  bad text[] := '{}';
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'qc-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'qc-boss', 'name', 'Qc Boss', 'title', 'Boss', 'signature', 'Hi')),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'bannedWord', 'param', 'word', 'least', 1, 'most', 40, 'plain', 'the word "{param}" is banned'))));
  perform seed_instance(seed);
  th := tests.thread('Quote past the cap');
  perform set_config('kayfabb.staff_writer', 'on', true);
  rule := tests.act((select id from characters where staff = 'qc-boss'), 'move', (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'),
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.', 'params', jsonb_build_object('board', null, 'predicate', 'bannedWord', 'param', 'zqxjkvdeepwords', 'band', 'minor')), null, base);
  perform set_config('kayfabb.staff_writer', '', true);
  q := tests.post(ch, th, 'The quoted post.', base + interval '1 minute');
  -- the rule fires on the post's own words, so the checks below can tell
  own := tests.post(ch, th, 'I say zqxjkvdeepwords myself.', base + interval '2 minutes');
  select count(*) into n from rule_breaks(own);
  if n is distinct from 1 then raise exception 'the planted rule does not fire on a post''s own words (% rows), so the test below proves nothing', n; end if;
  -- the words are in a quote nested past the cap: not the post's own
  shallow := tests.post(ch, th, pg_temp.deep(1, q, 'zqxjkvdeepwords'), base + interval '3 minutes');
  select count(*) into n from rule_breaks(shallow);
  if n is distinct from 0 then raise exception 'rule_breaks judges the words of a quote under the cap (% rows)', n; end if;
  for n in select unnest(array[pg_temp.cap(), pg_temp.cap() + 7, 2 * pg_temp.cap(), 2 * pg_temp.cap() + 7]) loop
    deepest := tests.post(ch, th, pg_temp.deep(n, q, 'zqxjkvdeepwords'), base + (10 + n) * interval '1 minute');
    if (select count(*) from rule_breaks(deepest)) is distinct from 0 then bad := bad || format('a quote nested %s deep inside tags', n); end if;
    deepest := tests.post(ch, th, pg_temp.pyramid(n, q, q, 'zqxjkvdeepwords'), base + (100 + n) * interval '1 minute');
    if (select count(*) from rule_breaks(deepest)) is distinct from 0 then bad := bad || format('a quote nested %s deep inside quotes', n); end if;
  end loop;
  if cardinality(bad) > 0 then raise exception 'rule_breaks judges the words of: %', array_to_string(bad, '; '); end if;
end $$;

-- ---- No-quote refuses a post that quotes the stopped post past the cap ----
select tests.unbecome();
create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;
do $$
declare
  ann uuid := tests.account('qc-ann'); bob uuid := tests.account('qc-bob');
  a uuid := tests.character(ann, 'Qc Ann'); b uuid := tests.character(bob, 'Qc Bob');
  t uuid := tests.thread('Qc thread');
  p uuid := tests.post(a, t, 'Stopped.'); p2 uuid := tests.post(a, t, 'Another post.');
  got text; n integer;
  bad text[] := '{}';
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick) values
    ('qclast', 'Qc Last Word', 'salty', 'uncommon', 'use', null, '{post}', interval '7 days', '{"kind": "noQuote"}')
  on conflict (key) do nothing;
  perform pg_temp.hand(ann, 'qclast');
  perform tests.become_service();
  perform play_card(ann, 'qclast', a, p, '{}', 0, '');
  perform tests.unbecome();
  -- control: a quote of the stopped post under the cap is refused, so the cases below ask the same question
  perform tests.become(bob);
  got := pg_temp.coded(format('select post(%L, %L, %L)', t, b, pg_temp.deep(1, p, 'hello')));
  perform tests.unbecome();
  if got is null or got not like '42501 % carries Qc Last Word, so it cannot be quoted until %' then raise exception 'a quote of a stopped post under the cap: %', got; end if;
  for n in select unnest(array[pg_temp.cap(), pg_temp.cap() + 7, 2 * pg_temp.cap(), 2 * pg_temp.cap() + 7]) loop
    perform tests.become(bob);
    got := pg_temp.coded(format('select post(%L, %L, %L)', t, b, pg_temp.deep(n, p, 'hello')));
    if got is null or got not like '42501 % carries Qc Last Word, so it cannot be quoted until %' then bad := bad || format('a quote nested %s deep inside tags: %s', n, coalesce(got, 'written')); end if;
    got := pg_temp.coded(format('select post(%L, %L, %L)', t, b, pg_temp.pyramid(n, p2, p, 'hello')));
    perform tests.unbecome();
    if got is null or got not like '42501 % carries Qc Last Word, so it cannot be quoted until %' then bad := bad || format('a quote nested %s deep inside quotes: %s', n, coalesce(got, 'written')); end if;
  end loop;
  if cardinality(bad) > 0 then raise exception 'No-quote does not refuse: %', array_to_string(bad, '; '); end if;
end $$;

-- ---- bbcode_walk stays linear on real quotes nested past the cap (each one is a frame that is cut) ----
-- 10,000 and 40,000 characters of `[quote=<uuid>]` repeated, the same questions, timed, as 0118-bbcode-plain-scale.sql does: a linear walk takes about four times as long at four times the length, a quadratic
-- one sixteen, and the bound between them is 8x. Ratios, not a clock; the floor on the small run keeps timer noise out of a ratio of tiny times.
do $$
declare
  unit constant text := '[quote=11111111-1111-4111-8111-111111111111]';
  t0 timestamp;
  t_small double precision;
  t_big double precision;
  w record;
begin
  t0 := clock_timestamp();
  select * into w from bbcode_walk(left(repeat(unit, 10000 / length(unit) + 1), 10000), null);
  t_small := greatest(extract(epoch from clock_timestamp() - t0), 0.02);
  t0 := clock_timestamp();
  select * into w from bbcode_walk(left(repeat(unit, 40000 / length(unit) + 1), 40000), null);
  t_big := extract(epoch from clock_timestamp() - t0);
  if w.quotes is distinct from array['11111111-1111-4111-8111-111111111111'] then raise exception 'the nested quotes past the cap are not read: %', w.quotes; end if;
  if t_big > t_small * 8 then
    raise exception 'bbcode_walk is not linear on nested real quotes past the cap: 10,000 characters took % s, 40,000 took % s (more than 8x)', round(t_small::numeric, 3), round(t_big::numeric, 3);
  end if;
end $$;
