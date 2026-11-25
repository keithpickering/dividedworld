-- kayfabb-sql: alone
-- This file holds wall-clock budgets, so it runs with nothing beside it (#1099).
-- The debates the inputs carry (supabase/migrations/0390_debates.sql; docs/plans/2026-11-18-tweener-catalyst-plan.md, Task 2; models: 0378-target-lean.sql and 0376-cushion.sql).
-- settlement_input holds each spark a window reached (a post made no earlier than `debateDays` before the window that a window Act quotes or sits under), every member of its debate made before the window's end, the quote
-- edges among the input's Acts, the votes standing on the spark (reactions and paid rows, even where none reached it in the window) and each cushion play that was up on the spark or its character after it was made.
-- estimate_input holds the same for the caller's own sparks alone, with no reaction on a member and no edge in a bystander's. The 2,000-post chain at the end measures both walks (the count of edges and Acts, and the time taken).
-- The posts and cards are this file's own (db...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
create function pg_temp.entry(input jsonb, id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = id::text
$$;
create function pg_temp.edge(input jsonb, act uuid, quoted uuid) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(input -> 'quotes') e where e ->> 'act' = act::text and e ->> 'quoted' = quoted::text)
$$;
create function pg_temp.reactions_on(input jsonb, act uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(e), '[]') from jsonb_array_elements(input -> 'reactions') e where e ->> 'act' = act::text
$$;
create function pg_temp.q(post uuid) returns text language sql as $$ select '[quote=x|' || post || ']hi[/quote] and more' $$;
create function pg_temp.canon(j jsonb) returns text language plpgsql as $$
declare t text := j::text; m text; seen text[] := '{}'; i integer;
begin
  -- The keys an estimate makes up for its request (md5 hashes) renamed in the order they appear, so two calls are equal when they differ in nothing but the salt.
  for m in select x[1] from regexp_matches(t, '\m[0-9a-f]{32}\M', 'g') x loop
    if not m = any (seen) then seen := seen || m; end if;
  end loop;
  for i in 1..coalesce(array_length(seen, 1), 0) loop t := replace(t, seen[i], 'K' || i); end loop;
  -- `characters` is ordered by an id that may be one of those keys, so its order is the salt's too: put it in text order.
  return (select jsonb_set(t::jsonb, '{characters}', coalesce((select jsonb_agg(x order by x::text) from jsonb_array_elements(t::jsonb -> 'characters') x), '[]'))::text);
end $$;
create function pg_temp.first_window() returns timestamptz language plpgsql as $$
declare s1 constant timestamptz := (select min(starts_at) from seasons);
begin
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  return (select max(ends_at) from settlements);
end $$;

-- ---- The setting is held: 0, a fraction and text are refused, and a whole number of days is taken ----
select tests.unbecome();
do $$
declare why text;
begin
  foreach why in array array['0', '1.5', '"3"', 'null', 'true', '-1'] loop
    if pg_temp.coded(format('update settings set value = %L::jsonb where key = %L', why, 'debateDays')) is null then raise exception 'debateDays = % was taken', why; end if;
  end loop;
  if pg_temp.coded($q$update settings set value = '2'::jsonb where key = 'debateDays'$q$) is not null then raise exception 'debateDays = 2 was refused'; end if;
  update settings set value = '3'::jsonb where key = 'debateDays';
end $$;

-- ---- A spark from two days before the window with a quote in it: the spark, every member (by quote, by a quote of a quote, and by a thread another player spun from it) and each edge are in the input ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann'); bob uuid := tests.account('db-bob'); cat uuid := tests.account('db-cat');
  a uuid := tests.character(ann, 'Db Ann'); b uuid := tests.character(bob, 'Db Bob'); c uuid := tests.character(cat, 'Db Cat');
  w0 timestamptz := pg_temp.first_window() + interval '10 days'; w1 timestamptz;
  t uuid := tests.thread('Db thread'); spun uuid; spun_own uuid;
  spark uuid; old uuid; qb uuid; qc uuid; qa uuid; spin uuid; reply uuid; own_spin uuid; own_reply uuid; later uuid; stranger uuid; staff uuid; staffq uuid; boss uuid;
  input jsonb;
begin
  w1 := w0 + interval '1 day';
  spark := tests.post(a, t, 'The spark.', w0 - interval '2 days');
  old := tests.post(a, t, 'Four days old.', w0 - interval '4 days');
  stranger := tests.post(c, t, 'Nobody quotes this.', w0 - interval '1 day');
  qb := tests.post(b, t, pg_temp.q(spark), w0 + interval '1 hour');
  qc := tests.post(c, t, pg_temp.q(qb), w0 + interval '2 hours');
  qa := tests.post(a, t, pg_temp.q(spark), w0 + interval '3 hours');
  insert into threads (board, title, origin_act_id) select board, 'Db spun', spark from threads where id = t returning id into spun;
  spin := tests.act(c, 'spin', spun, '{"title": "Db spun"}', spark, w0 + interval '4 hours');
  reply := tests.post(b, spun, 'A reply in the spun thread.', w0 + interval '5 hours');
  -- A thread the spark's own player spun from it is not followed, and neither is a post after the window's end or a staff post that quotes.
  insert into threads (board, title, origin_act_id) select board, 'Db own spun', spark from threads where id = t returning id into spun_own;
  own_spin := tests.act(a, 'spin', spun_own, '{"title": "Db own"}', spark, w0 - interval '3 hours');
  own_reply := tests.post(c, spun_own, 'A reply under the spark''s own spin.', w0 - interval '2 hours');
  later := tests.post(b, t, pg_temp.q(spark), w1 + interval '1 hour');
  insert into characters (name, staff, staff_kind, debuted_at) values ('Db Boss', 'db-bot', 'persona', now()) returning id into boss;
  perform set_config('kayfabb.staff_writer', 'on', true);
  staffq := tests.act(boss, 'post', t, jsonb_build_object('body', pg_temp.q(spark)), null, w0 + interval '8 hours');
  perform set_config('kayfabb.staff_writer', '', true);
  -- A quote of a post that quotes a post in the window's reach but with an old root: the old post's debate is not followed (four days is past debateDays).
  perform tests.post(b, t, pg_temp.q(old), w0 + interval '9 hours');

  input := settlement_input(w0, w1);
  if pg_temp.entry(input, spark) is null then raise exception 'the spark two days before the window is not in the input'; end if;
  if pg_temp.entry(input, qb) is null or pg_temp.entry(input, qc) is null or pg_temp.entry(input, qa) is null then raise exception 'a member by quote is missing from the input'; end if;
  if pg_temp.entry(input, spin) is null or pg_temp.entry(input, reply) is null then raise exception 'the spin and a post of a thread another player spun from the spark are not in the input'; end if;
  if not pg_temp.edge(input, qb, spark) or not pg_temp.edge(input, qc, qb) or not pg_temp.edge(input, qa, spark) then raise exception 'a quote edge is missing: %', input -> 'quotes'; end if;
  if pg_temp.entry(input, later) is not null then raise exception 'a post made after the window''s end is in the input'; end if;
  if pg_temp.entry(input, staffq) is not null then raise exception 'a staff post is in the input'; end if;
  if pg_temp.edge(input, staffq, spark) then raise exception 'an edge from a staff post is in the input'; end if;
  if pg_temp.entry(input, own_reply) is not null then raise exception 'a post under a thread the spark''s own player spun is in the input'; end if;
  if pg_temp.entry(input, stranger) is not null then raise exception 'a post nobody quoted is in the input'; end if;
end $$;

-- ---- A spark four days old with a quote in the window is not in the input ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann2'); bob uuid := tests.account('db-bob2');
  a uuid := tests.character(ann, 'Db Ann Two'); b uuid := tests.character(bob, 'Db Bob Two');
  w0 timestamptz := pg_temp.first_window() + interval '20 days'; w1 timestamptz;
  t uuid := tests.thread('Db old thread'); spark uuid; q uuid; input jsonb;
begin
  w1 := w0 + interval '1 day';
  spark := tests.post(a, t, 'Four days old.', w0 - interval '4 days');
  q := tests.post(b, t, pg_temp.q(spark), w0 + interval '1 hour');
  input := settlement_input(w0, w1);
  if pg_temp.entry(input, spark) is not null then raise exception 'a spark four days old is in the input'; end if;
  if pg_temp.entry(input, q) is null then raise exception 'the window''s own post is not in the input'; end if;
  if jsonb_array_length(input -> 'quotes') <> 0 then raise exception 'an edge to a post that is not in the input: %', input -> 'quotes'; end if;
  -- And one made exactly debateDays (three days) before the window's start is a spark.
  spark := tests.post(a, t, 'Exactly three days old.', w0 - interval '3 days');
  q := tests.post(b, t, pg_temp.q(spark), w0 + interval '2 hours');
  input := settlement_input(w0, w1);
  if pg_temp.entry(input, spark) is null or not pg_temp.edge(input, q, spark) then raise exception 'a spark exactly debateDays old is not in the input'; end if;
end $$;

-- ---- A window with no quote and no spun thread returns what it did before, with an empty `quotes` ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann3'); bob uuid := tests.account('db-bob3');
  a uuid := tests.character(ann, 'Db Ann Three'); b uuid := tests.character(bob, 'Db Bob Three');
  w0 timestamptz := pg_temp.first_window() + interval '30 days'; w1 timestamptz;
  t uuid := tests.thread('Db plain thread'); p1 uuid; p2 uuid; yesterday uuid; input jsonb; n integer;
begin
  w1 := w0 + interval '1 day';
  yesterday := tests.post(a, t, 'Yesterday, with no reaction in the window.', w0 - interval '10 hours');
  p1 := tests.post(a, t, 'One.', w0 + interval '1 hour');
  p2 := tests.post(b, t, 'Two.', w0 + interval '2 hours');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (p1, b, bob, 'up', 1, w0 + interval '3 hours');
  input := settlement_input(w0, w1);
  if input -> 'quotes' is distinct from '[]'::jsonb then raise exception 'a window with no quote has quotes: %', input -> 'quotes'; end if;
  select count(*) into n from jsonb_array_elements(input -> 'acts');
  if n <> 2 or pg_temp.entry(input, p1) is null or pg_temp.entry(input, p2) is null then raise exception 'the input holds Acts that are neither the window''s nor reached by a reaction: %', input -> 'acts'; end if;
  if jsonb_array_length(input -> 'paid') <> 0 then raise exception 'paid rows with none earlier: %', input -> 'paid'; end if;
end $$;

-- ---- estimate_input: a bystander's holds no edge; the author's holds the debate and no reaction on a member ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann4'); bob uuid := tests.account('db-bob4'); cat uuid := tests.account('db-cat4'); eve uuid := tests.account('db-eve4');
  a uuid := tests.character(ann, 'Db Ann Four'); b uuid := tests.character(bob, 'Db Bob Four'); c uuid := tests.character(cat, 'Db Cat Four'); e uuid := tests.character(eve, 'Db Eve Four');
  w0 timestamptz := pg_temp.first_window(); w1 timestamptz;
  t uuid := tests.thread('Db estimate thread'); spun uuid;
  spark uuid; qb uuid; qc uuid; spin uuid; reply uuid; plain uuid; est jsonb; got jsonb;
begin
  w1 := w0 + interval '1 day';
  spark := tests.post(a, t, 'The spark.', w0 - interval '2 days');
  qb := tests.post(b, t, pg_temp.q(spark), w0 + interval '1 hour');
  qc := tests.post(c, t, pg_temp.q(qb), w0 + interval '2 hours');
  insert into threads (board, title, origin_act_id) select board, 'Db est spun', spark from threads where id = t returning id into spun;
  spin := tests.act(c, 'spin', spun, '{"title": "Db est spun"}', spark, w0 + interval '3 hours');
  reply := tests.post(b, spun, 'A reply.', w0 + interval '4 hours');
  plain := tests.post(e, t, 'A bystander''s own post.', w0 + interval '5 hours');
  -- A reaction on a member (Cat reacted to Bob's quote), one on the spark, and the room before the window on the spark.
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    (qb, c, cat, 'up', 1, w0 + interval '2 hours'), (spark, c, cat, 'up', 1, w0 - interval '1 day'), (spark, b, bob, 'meh', 1, w0 + interval '90 minutes');

  est := estimate_input(eve, w0 + interval '8 hours');
  if jsonb_array_length(est -> 'quotes') <> 0 then raise exception 'a bystander''s estimate holds a quote edge: %', est -> 'quotes'; end if;
  if pg_temp.entry(est, spark) is not null or pg_temp.entry(est, qb) is not null or pg_temp.entry(est, reply) is not null then raise exception 'a bystander''s estimate holds a debate it is no part of'; end if;
  if pg_temp.entry(est, plain) is null then raise exception 'a bystander''s own post is gone from their estimate'; end if;

  est := estimate_input(ann, w0 + interval '8 hours');
  if pg_temp.entry(est, spark) is null or pg_temp.entry(est, qb) is null or pg_temp.entry(est, qc) is null or pg_temp.entry(est, spin) is null or pg_temp.entry(est, reply) is null then
    raise exception 'the author''s estimate lacks a member of the debate: %', est -> 'acts';
  end if;
  if pg_temp.entry(est, plain) is not null then raise exception 'the author''s estimate holds an unrelated post'; end if;
  if not pg_temp.edge(est, qb, spark) or not pg_temp.edge(est, qc, qb) then raise exception 'the author''s estimate lacks an edge: %', est -> 'quotes'; end if;
  if jsonb_array_length(pg_temp.reactions_on(est, qb)) <> 0 or jsonb_array_length(pg_temp.reactions_on(est, qc)) <> 0 then raise exception 'a reaction on a member is in the author''s estimate: %', pg_temp.reactions_on(est, qb); end if;
  if jsonb_array_length(pg_temp.reactions_on(est, spark)) <> 2 then raise exception 'the spark''s own reactions are not in the author''s estimate: %', pg_temp.reactions_on(est, spark); end if;
  -- The member's author is keyed by character under the request's salt, not by the account's player.
  if exists (select 1 from jsonb_array_elements(est -> 'characters') x where x ->> 'id' = qb::text) then raise exception 'a post is named as a character'; end if;
  got := est -> 'characters';
  if not exists (select 1 from jsonb_array_elements(got) x where x ->> 'id' = b::text and x ->> 'player' <> x ->> 'id') then raise exception 'a debater is not named: %', got; end if;
  -- Bob's own estimate holds his own spark (Cat quoted his quote) and not the rest of Ann's debate.
  est := estimate_input(bob, w0 + interval '8 hours');
  if not pg_temp.edge(est, qc, qb) then raise exception 'the debater''s estimate lacks the debate his own post sparked: %', est -> 'quotes'; end if;
  -- What his post quotes is above it (the edge to the spark, a public Act, is there for inOwnDebate), but the rest of the author's debate is not: the spin of the thread spun from it is no part of his (his own reply in that thread is his own post).
  if not pg_temp.edge(est, qb, spark) then raise exception 'the debater''s estimate lacks the edge above his own spark: %', est -> 'quotes'; end if;
  if pg_temp.entry(est, spin) is not null then raise exception 'the debater''s estimate holds the thread spun from the author''s spark'; end if;
end $$;

-- ---- A spark with reactions only before the window and a quote inside it: the reactions and their paid rows are in the input ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann5'); bob uuid := tests.account('db-bob5'); cat uuid := tests.account('db-cat5');
  a uuid := tests.character(ann, 'Db Ann Five'); b uuid := tests.character(bob, 'Db Bob Five'); c uuid := tests.character(cat, 'Db Cat Five');
  w0 timestamptz := pg_temp.first_window() + interval '50 days'; w1 timestamptz;
  t uuid := tests.thread('Db paid thread'); spark uuid; q uuid; input jsonb; got jsonb;
begin
  w1 := w0 + interval '1 day';
  spark := tests.post(a, t, 'The spark.', w0 - interval '20 hours');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (spark, c, cat, 'meh', 1, w0 - interval '10 hours');
  insert into paid_votes (account, act, weight, shares, settlement) values (cat, spark, 1, '{"calmPositive": 1}', (select max(id) from settlements));
  q := tests.post(b, t, pg_temp.q(spark), w0 + interval '2 hours');
  input := settlement_input(w0, w1);
  got := pg_temp.reactions_on(input, spark);
  if jsonb_array_length(got) <> 1 then raise exception 'the spark''s earlier reaction is not in the input: %', got; end if;
  if not exists (select 1 from jsonb_array_elements(input -> 'paid') p where p ->> 'act' = spark::text and p ->> 'player' = cat::text) then raise exception 'the spark''s paid row is not in the input: %', input -> 'paid'; end if;
  -- A reaction in the window beside it: the paid row is sent once, not twice.
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (spark, b, bob, 'up', 1, w0 + interval '3 hours');
  input := settlement_input(w0, w1);
  if (select count(*) from jsonb_array_elements(input -> 'paid') p where p ->> 'act' = spark::text) is distinct from 1 then raise exception 'a paid row is sent twice: %', input -> 'paid'; end if;
end $$;

-- ---- A Thick Skin on the spark's character that ended yesterday is in the input; one that ended before the spark was made is not; one on the post itself too ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann6'); bob uuid := tests.account('db-bob6');
  a uuid := tests.character(ann, 'Db Ann Six'); b uuid := tests.character(bob, 'Db Bob Six');
  w0 timestamptz := pg_temp.first_window() + interval '60 days'; w1 timestamptz;
  t uuid := tests.thread('Db skin thread'); spark uuid; q uuid; gone uuid; before_spark uuid; on_post uuid; ended_play uuid; input jsonb;
begin
  w1 := w0 + interval '1 day';
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('dbthick', 'Db Thick', 'sweet', 'uncommon', 'use', interval '3 days', '{character,post}', '{"kind": "cushion", "share": 0.5}')
  on conflict (key) do nothing;
  spark := tests.post(a, t, 'The spark.', w0 - interval '2 days');
  q := tests.post(b, t, pg_temp.q(spark), w0 + interval '1 hour');
  -- Played the day before the spark, up until yesterday (a day before the window): it ended after the spark was made.
  gone := tests.act(a, 'card', t, jsonb_build_object('card', 'dbthick', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', w0 - interval '1 day', 'targetName', 'Db Ann Six'), spark, w0 - interval '3 days');
  insert into play_reach (play, reach, character, ends_at) values (gone, 'character', a, w0 - interval '1 day');
  before_spark := tests.act(a, 'card', t, jsonb_build_object('card', 'dbthick', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', w0 - interval '2 days 1 hour', 'targetName', 'Db Ann Six'), spark, w0 - interval '4 days');
  insert into play_reach (play, reach, character, ends_at) values (before_spark, 'character', a, w0 - interval '2 days 1 hour');
  on_post := tests.act(b, 'card', t, jsonb_build_object('card', 'dbthick', 'message', '', 'config', '{}'::jsonb), spark, w0 - interval '1 day');
  ended_play := tests.act(b, 'card', t, jsonb_build_object('card', 'dbthick', 'message', '', 'config', '{}'::jsonb, 'ends', w0 - interval '12 hours'), spark, w0 - interval '40 hours');
  input := settlement_input(w0, w1);
  if pg_temp.entry(input, gone) is null then raise exception 'a cushion on the spark''s character that ended after the spark was made is not in the input'; end if;
  if pg_temp.entry(input, before_spark) is not null then raise exception 'a cushion that ended before the spark was made is in the input'; end if;
  if pg_temp.entry(input, ended_play) is null then raise exception 'a cushion on the post that has ended is not in the input'; end if;
  if (pg_temp.entry(input, gone) ->> 'ends')::bigint is distinct from (extract(epoch from w0 - interval '1 day') * 1000)::bigint then raise exception 'the cushion carries no end: %', pg_temp.entry(input, gone); end if;
  -- The estimate carries the same for the author.
  if pg_temp.entry(estimate_input(ann, w0 + interval '2 hours'), gone) is null then raise exception 'the author''s estimate lacks the cushion'; end if;
end $$;

-- ---- A spark a reaction reached, whose only quote was made after the window's end, is no spark: the cushion play on its character is not in either input ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann8'); bob uuid := tests.account('db-bob8'); cat uuid := tests.account('db-cat8');
  a uuid := tests.character(ann, 'Db Ann Eight'); a2 uuid := tests.character(ann, 'Db Ann Eight Too'); b uuid := tests.character(bob, 'Db Bob Eight'); c uuid := tests.character(cat, 'Db Cat Eight');
  w0 timestamptz := pg_temp.first_window(); w1 timestamptz;
  t uuid := tests.thread('Db late thread'); late_spark uuid; early_spark uuid; late_q uuid; early_q uuid; late_play uuid; early_play uuid; input jsonb;
begin
  w1 := w0 + interval '1 day';
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('dbthick', 'Db Thick', 'sweet', 'uncommon', 'use', interval '3 days', '{character,post}', '{"kind": "cushion", "share": 0.5}')
  on conflict (key) do nothing;
  late_spark := tests.post(a, t, 'Quoted only after the window.', w0 - interval '20 hours');
  early_spark := tests.post(a2, t, 'Quoted before the window.', w0 - interval '19 hours');
  late_play := tests.act(a, 'card', t, jsonb_build_object('card', 'dbthick', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', w0 - interval '2 hours', 'targetName', 'Db Ann Eight'), late_spark, w0 - interval '3 days');
  insert into play_reach (play, reach, character, ends_at) values (late_play, 'character', a, w0 - interval '2 hours');
  early_play := tests.act(a2, 'card', t, jsonb_build_object('card', 'dbthick', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a2, 'ends', w0 - interval '2 hours', 'targetName', 'Db Ann Eight Too'), early_spark, w0 - interval '3 days');
  insert into play_reach (play, reach, character, ends_at) values (early_play, 'character', a2, w0 - interval '2 hours');
  early_q := tests.post(c, t, pg_temp.q(early_spark), w0 - interval '10 hours');
  late_q := tests.post(c, t, pg_temp.q(late_spark), w1 + interval '1 hour');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    (late_spark, b, bob, 'up', 1, w0 + interval '1 hour'), (early_spark, b, bob, 'up', 1, w0 + interval '1 hour');
  input := settlement_input(w0, w1);
  if pg_temp.entry(input, early_play) is null then raise exception 'the cushion on the character of a spark a reaction reached, quoted before the window''s end, is not in the input'; end if;
  if pg_temp.entry(input, late_play) is not null then raise exception 'the cushion on the character of a post whose only quote came after the window''s end is in the input (a spark)'; end if;
  input := estimate_input(ann, w0 + interval '8 hours');
  if pg_temp.entry(input, early_play) is null then raise exception 'the estimate lacks the cushion on the character of a spark quoted before the window''s end'; end if;
  if pg_temp.entry(input, late_play) is not null then raise exception 'the estimate holds the cushion on the character of a post whose only quote came after the window''s end'; end if;
end $$;

-- ---- A quote chain through a staff post is no chain in the estimate, as in the settlement: a member that quotes a real spark and a staff post that quotes another of the author's posts makes only the first a spark ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann9'); bob uuid := tests.account('db-bob9');
  a uuid := tests.character(ann, 'Db Ann Nine'); a2 uuid := tests.character(ann, 'Db Ann Nine Too'); b uuid := tests.character(bob, 'Db Bob Nine');
  w0 timestamptz := pg_temp.first_window(); w1 timestamptz;
  t uuid := tests.thread('Db staff chain thread'); real_spark uuid; bridged uuid; staffq uuid; member uuid; boss uuid; play uuid; est jsonb;
begin
  w1 := w0 + interval '1 day';
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('dbthick', 'Db Thick', 'sweet', 'uncommon', 'use', interval '3 days', '{character,post}', '{"kind": "cushion", "share": 0.5}')
  on conflict (key) do nothing;
  real_spark := tests.post(a, t, 'A spark a member quotes.', w0 - interval '2 days');
  bridged := tests.post(a2, t, 'A post only a staff post quotes.', w0 - interval '2 days');
  play := tests.act(a2, 'card', t, jsonb_build_object('card', 'dbthick', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a2, 'ends', w0 - interval '2 hours', 'targetName', 'Db Ann Nine Too'), bridged, w0 - interval '3 days');
  insert into play_reach (play, reach, character, ends_at) values (play, 'character', a2, w0 - interval '2 hours');
  insert into characters (name, staff, staff_kind, debuted_at) values ('Db Boss Nine', 'db-bot9', 'persona', now()) returning id into boss;
  perform set_config('kayfabb.staff_writer', 'on', true);
  staffq := tests.act(boss, 'post', t, jsonb_build_object('body', pg_temp.q(bridged)), null, w0 - interval '1 day');
  perform set_config('kayfabb.staff_writer', '', true);
  member := tests.post(b, t, pg_temp.q(real_spark) || pg_temp.q(staffq), w0 + interval '1 hour');
  est := estimate_input(ann, w0 + interval '8 hours');
  if pg_temp.entry(est, member) is null then raise exception 'the estimate lacks the member of the real spark'; end if;
  if pg_temp.entry(est, play) is not null then raise exception 'the estimate climbed a quote chain through a staff post to a spark (its cushion is in)'; end if;
  if pg_temp.entry(settlement_input(w0, w1), play) is not null then raise exception 'the settlement climbed a quote chain through a staff post to a spark'; end if;
end $$;

-- ---- A spark reached through a spun thread's origin or through a reaction brings its own ancestors: the engine reads inOwnDebate from the edges above it ----
-- Ann's post P, two days old, is quoted by her own post S (a day and a half old). S is the origin of a thread Bob spun with a post of Cat's in the window; a second pair is reached by a reaction. Neither S is reached by a quote
-- of the window, so neither input could climb to P; with no edge S to P the engine reads S as in nobody's debate, and Ann's own debate would be paid as another's.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann10'); bob uuid := tests.account('db-bob10'); cat uuid := tests.account('db-cat10');
  a uuid := tests.character(ann, 'Db Ann Ten'); b uuid := tests.character(bob, 'Db Bob Ten'); c uuid := tests.character(cat, 'Db Cat Ten');
  w0 timestamptz := pg_temp.first_window(); w1 timestamptz;
  t uuid := tests.thread('Db ancestor thread'); spun uuid;
  p uuid; s uuid; spin uuid; wp uuid; p2 uuid; s2 uuid; qb uuid; input jsonb; est jsonb;
begin
  w1 := w0 + interval '1 day';
  p := tests.post(a, t, 'P.', w0 - interval '2 days');
  s := tests.post(a, t, pg_temp.q(p), w0 - interval '36 hours');
  insert into threads (board, title, origin_act_id) select board, 'Db ancestor spun', s from threads where id = t returning id into spun;
  spin := tests.act(b, 'spin', spun, '{"title": "Db ancestor spun"}', s, w0 + interval '1 hour');
  wp := tests.post(c, spun, 'A window post in the spun thread.', w0 + interval '2 hours');
  p2 := tests.post(a, t, 'P two.', w0 - interval '2 days');
  s2 := tests.post(a, t, pg_temp.q(p2), w0 - interval '30 hours');
  qb := tests.post(b, t, pg_temp.q(s2), w0 - interval '2 hours');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (s2, c, cat, 'up', 1, w0 + interval '3 hours');

  input := settlement_input(w0, w1);
  if pg_temp.entry(input, s) is null then raise exception 'the spun origin is not in the input'; end if;
  if pg_temp.entry(input, p) is null or not pg_temp.edge(input, s, p) then raise exception 'the spun origin has no edge to the post it quotes: %', input -> 'quotes'; end if;
  if pg_temp.entry(input, s2) is null then raise exception 'the post a reaction reached is not in the input'; end if;
  if pg_temp.entry(input, p2) is null or not pg_temp.edge(input, s2, p2) then raise exception 'the spark a reaction reached has no edge to the post it quotes: %', input -> 'quotes'; end if;

  est := estimate_input(ann, w0 + interval '8 hours');
  if pg_temp.entry(est, s) is null or pg_temp.entry(est, s2) is null then raise exception 'the author''s estimate lacks a spark'; end if;
  if pg_temp.entry(est, p) is null or not pg_temp.edge(est, s, p) then raise exception 'the estimate''s spun origin has no edge to the post it quotes: %', est -> 'quotes'; end if;
  if pg_temp.entry(est, p2) is null or not pg_temp.edge(est, s2, p2) then raise exception 'the estimate''s reacted spark has no edge to the post it quotes: %', est -> 'quotes'; end if;
end $$;

-- ---- A bystander's estimate is what it was before the debate: the same bytes but for the keys made up for the request ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann11'); bob uuid := tests.account('db-bob11'); cat uuid := tests.account('db-cat11'); eve uuid := tests.account('db-eve11');
  a uuid := tests.character(ann, 'Db Ann Eleven'); b uuid := tests.character(bob, 'Db Bob Eleven'); c uuid := tests.character(cat, 'Db Cat Eleven'); e uuid := tests.character(eve, 'Db Eve Eleven');
  w0 timestamptz := pg_temp.first_window(); w1 timestamptz;
  t uuid := tests.thread('Db bystander thread'); spun uuid; plain uuid; spark uuid; qb uuid; qc uuid; spin uuid; reply uuid; before_ text; after_ text;
begin
  w1 := w0 + interval '1 day';
  plain := tests.post(e, t, 'A bystander''s own post.', w0 + interval '1 hour');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (plain, c, cat, 'up', 1, w0 + interval '2 hours');
  before_ := pg_temp.canon(estimate_input(eve, w0 + interval '8 hours'));
  -- Then a debate among the others: a spark, quotes of it, a thread spun from it, and a reaction on the spark.
  spark := tests.post(a, t, 'The spark.', w0 - interval '2 days');
  qb := tests.post(b, t, pg_temp.q(spark), w0 + interval '3 hours');
  qc := tests.post(c, t, pg_temp.q(qb), w0 + interval '4 hours');
  insert into threads (board, title, origin_act_id) select board, 'Db bystander spun', spark from threads where id = t returning id into spun;
  spin := tests.act(c, 'spin', spun, '{"title": "Db bystander spun"}', spark, w0 + interval '5 hours');
  reply := tests.post(b, spun, 'A reply.', w0 + interval '6 hours');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (spark, c, cat, 'up', 1, w0 + interval '7 hours');
  after_ := pg_temp.canon(estimate_input(eve, w0 + interval '8 hours'));
  if after_ is distinct from before_ then raise exception 'a debate among others changed a bystander''s estimate: % versus %', before_, after_; end if;
  if estimate_input(eve, w0 + interval '8 hours') -> 'quotes' is distinct from '[]'::jsonb then raise exception 'a bystander''s estimate has quotes'; end if;
end $$;

-- ---- An ended play is no cushion; a member reached by a quote and by a spun thread is sent once; a spark's paid rows are sent once however it was reached ----
-- An admin's card_end is of a card play (acts_well_formed), never of a post or a spin, so no member can be ended: what an end changes in a debate is the cushion play on its spark.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann12'); bob uuid := tests.account('db-bob12'); cat uuid := tests.account('db-cat12');
  a uuid := tests.character(ann, 'Db Ann Twelve'); b uuid := tests.character(bob, 'Db Bob Twelve'); c uuid := tests.character(cat, 'Db Cat Twelve');
  w0 timestamptz := pg_temp.first_window(); w1 timestamptz;
  t uuid := tests.thread('Db twice thread'); spun uuid; spark uuid; both_ uuid; q uuid; live uuid; stopped uuid; input jsonb; est jsonb; n integer;
begin
  w1 := w0 + interval '1 day';
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('dbthick', 'Db Thick', 'sweet', 'uncommon', 'use', interval '3 days', '{character,post}', '{"kind": "cushion", "share": 0.5}')
  on conflict (key) do nothing;
  spark := tests.post(a, t, 'The spark.', w0 - interval '20 hours');
  insert into threads (board, title, origin_act_id) select board, 'Db twice spun', spark from threads where id = t returning id into spun;
  perform tests.act(c, 'spin', spun, '{"title": "Db twice spun"}', spark, w0 + interval '1 hour');
  -- A post in the spun thread that also quotes the spark: a member by the quote and by the thread.
  both_ := tests.post(b, spun, pg_temp.q(spark), w0 + interval '2 hours');
  q := tests.post(b, t, pg_temp.q(both_), w0 + interval '3 hours');
  live := tests.act(b, 'card', t, jsonb_build_object('card', 'dbthick', 'message', '', 'config', '{}'::jsonb, 'ends', w0 + interval '2 days'), spark, w0 - interval '10 hours');
  stopped := tests.act(b, 'card', t, jsonb_build_object('card', 'dbthick', 'message', '', 'config', '{}'::jsonb, 'ends', w0 + interval '2 days'), spark, w0 - interval '9 hours');
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (null, 'card_end', t, stopped, '{"why": "reversed", "by": "admin"}', w0 - interval '8 hours');
  perform set_config('kayfabb.card_end_writer', '', true);
  -- The spark's reactions in the window and before it, and a paid row each for two players.
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (spark, b, bob, 'up', 1, w0 + interval '4 hours'), (spark, c, cat, 'meh', 1, w0 - interval '5 hours');
  insert into paid_votes (account, act, weight, shares, settlement) values
    (cat, spark, 1, '{"calmPositive": 1}', (select max(id) from settlements)), (bob, spark, 1, '{"calmPositive": 1}', (select max(id) from settlements));

  for input in select settlement_input(w0, w1) union all select estimate_input(ann, w0 + interval '8 hours') loop
    select count(*) into n from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = both_::text;
    if n <> 1 then raise exception 'a member reached two ways is sent % times', n; end if;
    select count(*) into n from jsonb_array_elements(input -> 'quotes') e where e ->> 'act' = both_::text and e ->> 'quoted' = spark::text;
    if n <> 1 then raise exception 'the edge of a member reached two ways is sent % times', n; end if;
    select count(*) into n from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = spark::text;
    if n <> 1 then raise exception 'the spark is sent % times', n; end if;
    if pg_temp.entry(input, live) is null then raise exception 'a live cushion on the spark is not in the input'; end if;
    if pg_temp.entry(input, stopped) is not null then raise exception 'a cushion an admin ended is in the input'; end if;
  end loop;
  input := settlement_input(w0, w1);
  select count(*) into n from jsonb_array_elements(input -> 'paid') p where p ->> 'act' = spark::text;
  if n <> 2 then raise exception 'the spark''s paid rows (one for each of two players) are sent % times', n; end if;
end $$;

-- ---- An edit is no node: one that adds a quote pulls nothing into a debate, and a quote it removes stays an edge of the post it was written in ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann13'); bob uuid := tests.account('db-bob13'); cat uuid := tests.account('db-cat13');
  a uuid := tests.character(ann, 'Db Ann Thirteen'); b uuid := tests.character(bob, 'Db Bob Thirteen'); c uuid := tests.character(cat, 'Db Cat Thirteen');
  w0 timestamptz := pg_temp.first_window(); w1 timestamptz;
  t uuid := tests.thread('Db edit thread'); spark uuid; plain uuid; plain_edit uuid; quoting uuid; quoting_edit uuid; real_q uuid; input jsonb; est jsonb;
begin
  w1 := w0 + interval '1 day';
  spark := tests.post(a, t, 'The spark.', w0 - interval '2 days');
  -- Bob's post of an hour before the window quotes nothing; an edit in the window adds a quote of the spark.
  plain := tests.post(b, t, 'Quotes nothing, until edited.', w0 - interval '1 hour');
  plain_edit := tests.act(b, 'edit', t, jsonb_build_object('body', pg_temp.q(spark)), plain, w0 + interval '1 hour');
  input := settlement_input(w0, w1);
  if pg_temp.entry(input, plain) is not null or pg_temp.entry(input, spark) is not null then raise exception 'an edit that adds a quote pulled a post or its spark into the input'; end if;
  est := estimate_input(ann, w0 + interval '8 hours');
  if pg_temp.entry(est, plain) is not null then raise exception 'an edit that adds a quote pulled a post into the author''s estimate'; end if;
  -- A post that quotes the spark, in the window, is edited to leave the quote out: the original still quotes it.
  quoting := tests.post(c, t, pg_temp.q(spark), w0 + interval '2 hours');
  quoting_edit := tests.act(c, 'edit', t, jsonb_build_object('body', 'Never mind.'), quoting, w0 + interval '3 hours');
  real_q := tests.post(b, t, pg_temp.q(spark), w0 + interval '4 hours');
  input := settlement_input(w0, w1);
  if not pg_temp.edge(input, quoting, spark) or not pg_temp.edge(input, real_q, spark) then raise exception 'a quote an edit removed is no edge from the original post: %', input -> 'quotes'; end if;
  if pg_temp.edge(input, plain, spark) then raise exception 'an edit''s added quote is an edge from the post it edits: %', input -> 'quotes'; end if;
  est := estimate_input(ann, w0 + interval '8 hours');
  if not pg_temp.edge(est, quoting, spark) then raise exception 'a quote an edit removed is no edge in the estimate: %', est -> 'quotes'; end if;
  if pg_temp.entry(est, plain) is not null then raise exception 'an edit that adds a quote pulled a post into the author''s estimate'; end if;
end $$;

-- ---- The author's own later post that quotes an earlier post of the author's makes it a spark in the estimate, as in the settlement ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann14'); a uuid := tests.character(ann, 'Db Ann Fourteen'); a2 uuid := tests.character(ann, 'Db Ann Fourteen Too');
  w0 timestamptz := pg_temp.first_window(); w1 timestamptz;
  t uuid := tests.thread('Db own thread'); earlier uuid; later uuid; input jsonb; est jsonb;
begin
  w1 := w0 + interval '1 day';
  earlier := tests.post(a, t, 'An earlier post.', w0 - interval '2 days');
  later := tests.post(a2, t, pg_temp.q(earlier), w0 + interval '1 hour');
  input := settlement_input(w0, w1);
  if pg_temp.entry(input, earlier) is null or not pg_temp.edge(input, later, earlier) then raise exception 'the settlement lacks the post quoted by the author''s own window post'; end if;
  est := estimate_input(ann, w0 + interval '8 hours');
  if pg_temp.entry(est, earlier) is null or not pg_temp.edge(est, later, earlier) then raise exception 'the estimate lacks the post quoted by the author''s own window post: %', est -> 'quotes'; end if;
end $$;

-- ---- A chain of posts, each quoting the one before: both inputs hold the whole chain, and the rows they read grow in step with the chain (this asserts counts and rows read, not the plans) ----
-- A quadratic walk is no slower than a linear one at a few hundred posts, so a cap on 2,000 alone passes a cost that grows as the square (an earlier plan probed acts by time and filtered by key,
-- 500 rows a step, 14.5 s at 2,000), and a ratio of two timings passes it on a machine fast enough that both are noise. So the same chain is built at 1,000 and at 2,000 posts, each in a window of its own, and
-- what is compared is the rows of acts each input reads (the transaction's own counters: rows a sequential scan returned plus rows fetched through an index), which do not depend on the machine's speed: doubling
-- the chain may not more than triple either input's reads (a linear walk reads twice as many, a quadratic one four times). The time stays as a cap on the whole.
select tests.unbecome();
-- Rows of acts read so far by this transaction: returned by sequential scans plus fetched through indexes.
create function pg_temp.acts_rows_read() returns bigint language sql as $$
  select coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0) from pg_stat_xact_user_tables where relid = 'public.acts'::regclass
$$;
create function pg_temp.chain(n integer, tag text, win timestamptz, out edges integer, out whole boolean, out ends boolean, out settle numeric, out est numeric, out settle_rows bigint, out est_rows bigint) language plpgsql as $$
declare
  ann uuid := tests.account('db-ann7' || tag); bob uuid := tests.account('db-bob7' || tag);
  a uuid := tests.character(ann, 'Db Ann Seven ' || tag); b uuid := tests.character(bob, 'Db Bob Seven ' || tag);
  w1 timestamptz := win + interval '1 day';
  t uuid := tests.thread('Db chain thread ' || tag);
  ids uuid[] := array(select gen_random_uuid() from generate_series(1, n)); i integer; input jsonb; estimate jsonb; started timestamptz; r0 bigint;
begin
  -- The chain alternates two players; the first is made two days before the window, the rest inside it.
  for i in 1..n loop
    insert into acts (id, character, kind, thread, payload, created_at)
    values (ids[i], case when i % 2 = 1 then a else b end, 'post', t,
            jsonb_build_object('body', case when i = 1 then 'The root.' else pg_temp.q(ids[i - 1]) end),
            case when i = 1 then win - interval '2 days' else win + (i * interval '1 second') end);
  end loop;
  analyze acts; analyze quote_refs;
  r0 := pg_temp.acts_rows_read();
  started := clock_timestamp();
  input := settlement_input(win, w1);
  settle := extract(epoch from clock_timestamp() - started);
  settle_rows := pg_temp.acts_rows_read() - r0;
  edges := (select count(*) from jsonb_array_elements(input -> 'quotes') e where (e ->> 'act')::uuid = any (ids));
  whole := (select count(*) from jsonb_array_elements(input -> 'acts') e where (e ->> 'id')::uuid = any (ids)) = n;
  r0 := pg_temp.acts_rows_read();
  started := clock_timestamp();
  estimate := estimate_input(ann, w1);
  est := extract(epoch from clock_timestamp() - started);
  est_rows := pg_temp.acts_rows_read() - r0;
  ends := pg_temp.entry(estimate, ids[1]) is not null and pg_temp.entry(estimate, ids[n]) is not null and jsonb_array_length(estimate -> 'quotes') = n - 1;
  raise notice 'chain of %: settlement_input % s (% acts rows), estimate_input % s (% acts rows), % edges', n, settle, settle_rows, est, est_rows, edges;
end $$;
do $$
declare w0 timestamptz := pg_temp.first_window(); small record; big record; n constant integer := 1000;
begin
  -- Rows a parallel worker reads never reach this backend's counters, so the comparison runs with none: what it counts is every row read.
  perform set_config('max_parallel_workers_per_gather', '0', false);
  select * into small from pg_temp.chain(n, 'a', w0 + interval '20 days');
  select * into big from pg_temp.chain(2 * n, 'b', w0 + interval '30 days');
  if small.edges <> n - 1 or big.edges <> 2 * n - 1 or not small.whole or not big.whole then raise exception 'the chain is not whole in the input: % and % edges', small.edges, big.edges; end if;
  if not small.ends or not big.ends then raise exception 'the author''s estimate lacks the chain''s ends or its edges'; end if;
  -- Doubling the chain may not more than triple the rows read: a floor of one read per post keeps a build that reads nothing from passing (it would not have built the input).
  if small.settle_rows < n or small.est_rows < n then raise exception 'the chain read too few rows of acts to measure: % / % at % posts', small.settle_rows, small.est_rows, n; end if;
  if big.settle_rows > 3 * small.settle_rows then raise exception 'settlement_input does not scale with the chain: % acts rows at % posts, % at %', small.settle_rows, n, big.settle_rows, 2 * n; end if;
  if big.est_rows > 3 * small.est_rows then raise exception 'estimate_input does not scale with the chain: % acts rows at % posts, % at %', small.est_rows, n, big.est_rows, 2 * n; end if;
  -- The cap on the whole, after the comparison so that a cost that grows as the square is named as that.
  if big.settle > 3 or big.est > 3 then raise exception 'an input took % / % seconds (settlement / estimate) over a 2,000-post chain', big.settle, big.est; end if;
  reset max_parallel_workers_per_gather;
end $$;
