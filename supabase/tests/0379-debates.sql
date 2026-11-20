-- The debates the inputs carry (supabase/migrations/0379_debates.sql; docs/plans/2026-11-18-tweener-catalyst-plan.md, Task 2; models: 0378-target-lean.sql and 0376-cushion.sql).
-- settlement_input holds each spark a window reached (a post made no earlier than `debateDays` before the window that a window Act quotes or sits under), every member of its debate made before the window's end, the quote
-- edges among the input's Acts, the votes standing on the spark (reactions and paid rows, even where none reached it in the window) and each cushion play that was up on the spark or its character after it was made.
-- estimate_input holds the same for the caller's own sparks alone, with no reaction on a member and no edge in a bystander's. The 2,000-post chain at the end measures both walks and reads their plans.
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
  -- Bob's own estimate holds his own spark (Cat quoted his quote) and not Ann's debate: the edge from his quote to her spark is not among his sparks' members.
  est := estimate_input(bob, w0 + interval '8 hours');
  if not pg_temp.edge(est, qc, qb) then raise exception 'the debater''s estimate lacks the debate his own post sparked: %', est -> 'quotes'; end if;
  if pg_temp.edge(est, qb, spark) then raise exception 'the debater''s estimate holds the author''s debate: %', est -> 'quotes'; end if;
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

-- ---- A chain of 2,000 posts, each quoting the one before: both walks hold their bound, and neither reads acts as a whole ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('db-ann7'); bob uuid := tests.account('db-bob7');
  a uuid := tests.character(ann, 'Db Ann Seven'); b uuid := tests.character(bob, 'Db Bob Seven');
  w0 timestamptz := pg_temp.first_window(); w1 timestamptz;
  t uuid := tests.thread('Db chain thread');
  ids uuid[]; n constant integer := 2000; i integer; input jsonb; est jsonb; started timestamptz; took numeric; plan text; ln record; edges integer;
begin
  w1 := w0 + interval '1 day';
  ids := array(select gen_random_uuid() from generate_series(1, n));
  -- The chain alternates two players; the first is made two days before the window, the rest inside it.
  for i in 1..n loop
    insert into acts (id, character, kind, thread, payload, created_at)
    values (ids[i], case when i % 2 = 1 then a else b end, 'post', t,
            jsonb_build_object('body', case when i = 1 then 'The root.' else pg_temp.q(ids[i - 1]) end),
            case when i = 1 then w0 - interval '2 days' else w0 + (i * interval '1 second') end);
  end loop;
  analyze acts; analyze quote_refs;
  started := clock_timestamp();
  input := settlement_input(w0, w1);
  took := extract(epoch from clock_timestamp() - started);
  -- Earlier blocks of this file wrote into the same window, so the chain is counted by its own ids.
  select count(*) into edges from jsonb_array_elements(input -> 'quotes') e where (e ->> 'act')::uuid = any (ids);
  raise notice 'settlement_input over a 2,000-post chain: % edges in % seconds', edges, took;
  if edges <> n - 1 then raise exception 'the chain is not whole in the input: % edges', edges; end if;
  if (select count(*) from jsonb_array_elements(input -> 'acts') e where (e ->> 'id')::uuid = any (ids)) is distinct from n then raise exception 'the chain is not whole in the input'; end if;
  if took > 20 then raise exception 'settlement_input took % seconds over a 2,000-post chain', took; end if;
  started := clock_timestamp();
  est := estimate_input(ann, w1);
  took := extract(epoch from clock_timestamp() - started);
  raise notice 'estimate_input over the same chain: % seconds, % edges', took, jsonb_array_length(est -> 'quotes');
  if took > 20 then raise exception 'estimate_input took % seconds over a 2,000-post chain', took; end if;
  if pg_temp.entry(est, ids[1]) is null or pg_temp.entry(est, ids[n]) is null then raise exception 'the author''s estimate lacks the chain''s ends'; end if;
end $$;
