-- The concurrent cases of the pierce Gimmick (supabase/migrations/0400_pierce.sql; docs/plans/2026-11-20-cheap-shot-plan.md, Task 2; design docs/plans/2026-11-20-cheap-shot-design.md, section 3.3).
-- place_cast locks the caster's oldest live pierce (its play_reach row) and asks again, after the lock, whether a concurrent cast spent it; one that did is set aside and the caster's next live pierce is tried,
-- at most three tries. A character holds one of a card (stack 1), so the caster here holds two pierce kinds, A (played first, the older) and B. Two parts, both on posts under a ward the pierce passes:
--   1. Deterministic: another session holds A's play_reach row, a cast is started and must come to wait on it, and the holder then spends A (a card_end) and commits. The cast, woken on a spent A, must land under B.
--   2. A race: two casts by the one character at once, on two posts, each under its own ward. Both land, one naming A and the other B, and both pierces are spent. Without the fallback the second is turned away.
-- The rows are committed (tests.commit), since a racer is a session of its own; every name is this file's (pcr...), so no other file reads them.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

-- A pierce kind is a use card on a character; a ward kind is a use card on a post. A character holds one of a card, so there are two of each.

do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  pa uuid := gen_random_uuid(); pb1 uuid := gen_random_uuid(); pb2 uuid := gen_random_uuid(); pb3 uuid := gen_random_uuid();
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'pcr-ann@test.invalid'), (%2$L, 'pcr-bob@test.invalid');
    insert into accounts (id, created_at) values (%1$L, '2000-01-01T00:00:00Z'), (%2$L, '2000-01-01T00:00:00Z');
    insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Pcr Caster', now(), now()), (%4$L, %2$L, 'Pcr Warder', now(), now());
    insert into class_history (character, class_key) values (%3$L, 'alpha'), (%4$L, 'alpha');
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, gimmick, stack) values
      ('pcr-pierce-a', 'Pcr Pierce A', 'pepperoni', 'uncommon', 'use', '{character}', interval '3 days', '{"kind": "pierce", "upTo": "uncommon"}', 1),
      ('pcr-pierce-b', 'Pcr Pierce B', 'pepperoni', 'uncommon', 'use', '{character}', interval '3 days', '{"kind": "pierce", "upTo": "uncommon"}', 1),
      ('pcr-ward-1', 'Pcr Ward One', 'pepperoni', 'uncommon', 'use', '{post}', interval '3 days', '{"kind": "ward", "upTo": "common"}', 1),
      ('pcr-ward-2', 'Pcr Ward Two', 'pepperoni', 'uncommon', 'use', '{post}', interval '3 days', '{"kind": "ward", "upTo": "common"}', 1),
      ('pcr-ward-3', 'Pcr Ward Three', 'pepperoni', 'uncommon', 'use', '{post}', interval '3 days', '{"kind": "ward", "upTo": "common"}', 1);
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack) values ('pcr-move', 'Pcr Move', 'salty', 'common', 'cast', '{post}', null, 6);
    insert into card_ledger (account, card, kind, price) select %1$L, k, 'bought', 0 from unnest(array['pcr-pierce-a', 'pcr-pierce-b', 'pcr-move']) k, generate_series(1, 6);
    insert into card_ledger (account, card, kind, price) select %2$L, k, 'bought', 0 from unnest(array['pcr-ward-1', 'pcr-ward-2', 'pcr-ward-3']) k, generate_series(1, 6);
    insert into threads (id, board, title) select %5$L, b.id, 'Pcr thread' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values
      (%6$L, %3$L, 'post', %5$L, '{"body": "Caster''s own post."}'), (%7$L, %4$L, 'post', %5$L, '{"body": "Under ward one."}'),
      (%8$L, %4$L, 'post', %5$L, '{"body": "Under ward two."}'), (%9$L, %4$L, 'post', %5$L, '{"body": "Under ward three."}');
  $sql$, ann, bob, a, b, t, pa, pb1, pb2, pb3));

  -- The wards, and A then B, each in a transaction of its own so that A's created_at is the earlier.
  perform tests.commit(format($sql$
    do $d$ begin
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true); perform set_config('role', 'service_role', true);
    perform play_card(%1$L, 'pcr-ward-1', %2$L, %3$L, '{}', 0, '');
    perform play_card(%1$L, 'pcr-ward-2', %2$L, %4$L, '{}', 0, '');
    perform play_card(%1$L, 'pcr-ward-3', %2$L, %5$L, '{}', 0, '');
  end $d$;
  $sql$, bob, b, pb1, pb2, pb3));
  perform tests.commit(format($sql$
    do $d$ begin
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true); perform set_config('role', 'service_role', true);
    perform play_card(%1$L, 'pcr-pierce-a', %2$L, %2$L, '{}', 0, '', 'character', %3$L);
  end $d$;
  $sql$, ann, a, pa));
  perform pg_sleep(0.05);
  perform tests.commit(format($sql$
    do $d$ begin
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true); perform set_config('role', 'service_role', true);
    perform play_card(%1$L, 'pcr-pierce-b', %2$L, %2$L, '{}', 0, '', 'character', %3$L);
  end $d$;
  $sql$, ann, a, pa));
  perform set_config('pcr.ann', ann::text, false);
  perform set_config('pcr.a', a::text, false);
  perform set_config('pcr.p1', pb1::text, false);
  perform set_config('pcr.p2', pb2::text, false);
  perform set_config('pcr.p3', pb3::text, false);
  perform pg_temp.expect((select count(*) from play_reach r join acts k on k.id = r.play where r.character = a and k.payload ->> 'card' in ('pcr-pierce-a', 'pcr-pierce-b') and not card_ended(r.play)) = 2, 'the fixture does not hold two live pierces');
  perform pg_temp.expect((select ka.created_at < kb.created_at from acts ka, acts kb where ka.character = a and ka.payload ->> 'card' = 'pcr-pierce-a' and kb.character = a and kb.payload ->> 'card' = 'pcr-pierce-b'), 'pierce A is not older than pierce B');
end $$;

-- ---- 1. A cast waiting on A's lock while another session spends A lands under B ----
do $$
declare
  url text := current_setting('kayfabb.scratch_url');
  ann uuid := current_setting('pcr.ann')::uuid; a uuid := current_setting('pcr.a')::uuid; p1 uuid := current_setting('pcr.p1')::uuid;
  pierce_a uuid; pierce_b uuid; waiting integer; tries integer := 0; max_tries constant integer := 1200; said text; cast_by text;
begin
  select k.id into pierce_a from acts k where k.character = a and k.payload ->> 'card' = 'pcr-pierce-a';
  select k.id into pierce_b from acts k where k.character = a and k.payload ->> 'card' = 'pcr-pierce-b';
  perform extensions.dblink_connect('holder', url);
  perform extensions.dblink_exec('holder', 'begin');
  perform * from extensions.dblink('holder', format('select 1 from play_reach where play = %L for update', pierce_a)) as r(x integer);
  perform extensions.dblink_connect('player', url);
  perform extensions.dblink_send_query('player', format('select tests.raced(null, %L)', format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'pcr-move', a, p1, '{}', '')));
  loop
    -- A transaction reads one snapshot of pg_stat_activity until it is cleared, so a session that began to wait after the last look is not seen.
    perform pg_stat_clear_snapshot();
    select count(*) into waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%play_card%' and query like '%tests.raced%';
    exit when waiting >= 1;
    tries := tries + 1;
    -- Gives up at 30 s, the lock_timeout (tools/test-sql.mjs, SESSION_BOUNDS), 1200 looks of 25 ms: the pool runs several files at once, so a parked session can take seconds to show here on a loaded runner. The loop leaves the moment the wait shows, so the bound is only how long a broken race takes to fail.
    if tries > max_tries then
      perform extensions.dblink_exec('holder', 'rollback');
      raise exception 'a cast never waited on its pierce''s lock held by another session';
    end if;
    perform pg_sleep(0.025);
  end loop;
  -- The holder spends A as a cast would, by an Act that ends it, and lets go.
  perform extensions.dblink_exec('holder', format($e$
    select set_config('kayfabb.card_end_writer', 'on', true);
    insert into acts (character, kind, thread, target_act_id, payload) select null, 'card_end', thread, %L, '{"why": "reversed", "by": "admin"}' from acts where id = %L;
    commit
  $e$, pierce_a, pierce_a));
  select r.said into said from extensions.dblink_get_result('player') as r(said text);
  perform * from extensions.dblink_get_result('player') as r(said text);
  perform extensions.dblink_disconnect('player');
  perform extensions.dblink_disconnect('holder');
  perform pg_temp.expect(said is null, format('the cast woken on a spent pierce said %s', said));
  select c.payload #>> '{pierce,by}' into cast_by from acts c where c.character = a and c.kind = 'card' and c.payload ->> 'card' = 'pcr-move' and c.target_act_id = p1;
  perform pg_temp.expect(cast_by is not distinct from pierce_b::text, format('the cast woken on a spent pierce did not fall back to the next pierce: names %s, B is %s', cast_by, pierce_b));
  perform pg_temp.expect(card_ended(pierce_b), 'the fallback cast did not spend B');
end $$;

-- ---- 2. Two casts at once: both land, one under each pierce, both pierces spent ----
-- A fresh pair of pierces (the first part spent B), each in a transaction of its own so that the first is the older.
do $$
declare
  ann uuid := current_setting('pcr.ann')::uuid; a uuid := current_setting('pcr.a')::uuid;
  p2 uuid := current_setting('pcr.p2')::uuid; p3 uuid := current_setting('pcr.p3')::uuid;
  pierce_a uuid; pierce_b uuid; said text[]; names text[];
begin
  -- Part 1 left A ended by the holder's card_end and B spent by the cast; a new pair is played on the caster's other card slots by ending the old plays' stack, so each kind can be held again.
  perform tests.commit(format($sql$
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, gimmick, stack) values
      ('pcr-pierce-c', 'Pcr Pierce C', 'pepperoni', 'uncommon', 'use', '{character}', interval '3 days', '{"kind": "pierce", "upTo": "uncommon"}', 1),
      ('pcr-pierce-d', 'Pcr Pierce D', 'pepperoni', 'uncommon', 'use', '{character}', interval '3 days', '{"kind": "pierce", "upTo": "uncommon"}', 1);
    insert into card_ledger (account, card, kind, price) select %1$L, k, 'bought', 0 from unnest(array['pcr-pierce-c', 'pcr-pierce-d']) k, generate_series(1, 6);
  $sql$, ann));
  perform tests.commit(format($sql$
    do $d$ begin
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true); perform set_config('role', 'service_role', true);
    perform play_card(%1$L, 'pcr-pierce-c', %2$L, %2$L, '{}', 0, '', 'character', (select id from acts where character = %2$L and kind = 'post' limit 1));
  end $d$;
  $sql$, ann, a));
  perform pg_sleep(0.05);
  perform tests.commit(format($sql$
    do $d$ begin
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true); perform set_config('role', 'service_role', true);
    perform play_card(%1$L, 'pcr-pierce-d', %2$L, %2$L, '{}', 0, '', 'character', (select id from acts where character = %2$L and kind = 'post' limit 1));
  end $d$;
  $sql$, ann, a));
  select k.id into pierce_a from acts k where k.character = a and k.payload ->> 'card' = 'pcr-pierce-c';
  select k.id into pierce_b from acts k where k.character = a and k.payload ->> 'card' = 'pcr-pierce-d';
  perform pg_temp.expect(not card_ended(pierce_a) and not card_ended(pierce_b), 'the second pair of pierces is not live');

  said := tests.race_service(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'pcr-move', a, p2, '{}', ''),
                             format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'pcr-move', a, p3, '{}', ''));
  perform pg_temp.expect(said[1] is null and said[2] is null, format('two casts at once under two pierces: %s', said));
  select array_agg(c.payload #>> '{pierce,by}' order by c.payload #>> '{pierce,by}') into names
  from acts c where c.character = a and c.kind = 'card' and c.payload ->> 'card' = 'pcr-move' and c.target_act_id in (p2, p3);
  perform pg_temp.expect(names = (select array_agg(x order by x) from unnest(array[pierce_a::text, pierce_b::text]) x), format('the two casts did not name one pierce each: %s', names));
  perform pg_temp.expect(card_ended(pierce_a) and card_ended(pierce_b), 'a pierce was left unspent by the two casts');
end $$;
