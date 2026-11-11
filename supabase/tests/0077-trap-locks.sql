-- Trap locks, even trap work, and the set line's springs (supabase/migrations/0075_trap_locks.sql): every path that can spring a
-- trap takes its locks in one written order, so a write that springs a trap is never refused by a deadlock; a sprung back is not
-- locked; spring_traps reads the same rows for every back before it decides; my_card_ledger says whether a set card can spring.
-- docs/plans/2026-11-03-trap-locks-plan.md, Tasks 1 to 3. Rewritten for face-down Moves (docs/plans/2026-11-07-face-down-moves-plan.md, Task 6): a back is a Trap Card
-- naming a card, a Move that springs on a quote, or an Idle (a back with a visit trap, which no quote springs), and a post meets only the back on the post it quotes. The cards are the engine's test set, never an instance's.

-- ---- Races, first, so the rows they commit wait on nothing this file has written and not committed ----

-- The cards and the players the races share, committed.
do $$
begin
  perform tests.commit($sql$
    insert into card_kinds (key, name, alignment, rarity, play, trap) values
      ('tlcatch', 'Lock Catcher', 'salty', 'rare', 'set', '{"trigger": {"on": "cast"}}'),
      ('tlhook', 'Lock Hook', 'salty', 'uncommon', 'cast', null),
      ('tlidle', 'Lock Idle', 'pepperoni', 'common', 'set', '{"trigger": {"on": "visit"}}');
  $sql$);
end $$;

-- A quote and a cast through one character on one trapped post both land. The quote's post() takes the back, the thread and the poster's count row before its
-- insert; the cast's spring_traps takes the back and then, through the caught card's insert, the caster's count row. Before 0075,
-- post() took the count row first and the back second, the other way round, and one of the two writes was refused (40P01).
do $$
declare
  quoter uuid := gen_random_uuid(); setter uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  x uuid;
  said text[];
  round integer;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'tl-quoter@test.invalid'), (%2$L, 'tl-setter@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Lock Quoter', now(), now()), (%4$L, %2$L, 'Lock Setter', now(), now());
    insert into class_history (character, class_key, started_at) values (%3$L, 'alpha', now()), (%4$L, 'alpha', now());
    insert into threads (id, board, title) select %5$L, b.id, 'Lock race' from boards b where b.slug = 'general';
    insert into card_ledger (account, card, kind, price) select %1$L, 'sweetie', 'bought', 0 from generate_series(1, 20);
    insert into card_ledger (account, card, kind, price) select %2$L, 'tlcatch', 'bought', 0 from generate_series(1, 20);
  $sql$, quoter, setter, a, s, t));
  for round in 1 .. 20 loop
    x := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into acts (id, character, kind, thread, payload) values (%1$L, %2$L, 'post', %3$L, '{"body": "Trapped."}');
      do $d$ begin perform set_card(%4$L, 'tlcatch', %2$L, %1$L, '{"card": "sweetie"}', 0, 'sweetie'); end $d$;
    $sql$, x, s, t, setter));
    said := tests.race_as(quoter, format('select post(%L, %L, %L, %L)', t, a, 'Quoting it.', x),
                          null, format('select play_card(%L, %L, %L, %L, %L, 0, %L)', quoter, 'sweetie', a, x, '{}', ''));
    if said[1] is not null or said[2] is not null then raise exception 'a quote and a cast through one character, round %: %', round, said; end if;
    if (select count(*) from acts where kind = 'post' and target_act_id = x and character = a) is distinct from 1::bigint then
      raise exception 'a quote and a cast, round %: the quote did not land', round;
    end if;
    if (select count(*) from acts where kind = 'card' and target_act_id = x and character = a) is distinct from 1::bigint then
      raise exception 'a quote and a cast, round %: the cast did not land', round;
    end if;
  end loop;
end $$;

-- Two landings across two players' posts both land. Each quote springs the other player's Move, which lands as a card written
-- through its setter's character: a counted Act. Each post() therefore needs both characters' count rows. Locking the poster's own
-- row first and the setter's at the landing crosses; post() takes every one in character order before it writes.
do $$
declare
  one uuid := gen_random_uuid(); two uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
  t1 uuid; t2 uuid; x uuid; y uuid;
  said text[];
  round integer;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'tl-strike-one@test.invalid'), (%2$L, 'tl-strike-two@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Lock Striker One', now(), now()), (%4$L, %2$L, 'Lock Striker Two', now(), now());
    insert into class_history (character, class_key, started_at) values (%3$L, 'alpha', now()), (%4$L, 'alpha', now());
    insert into card_ledger (account, card, kind, price) select a, 'tlhook', 'bought', 0 from unnest(array[%1$L, %2$L]::uuid[]) a, generate_series(1, 20);
  $sql$, one, two, s1, s2));
  for round in 1 .. 20 loop
    t1 := gen_random_uuid(); t2 := gen_random_uuid(); x := gen_random_uuid(); y := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into threads (id, board, title) select %1$L, b.id, 'Strike one' from boards b where b.slug = 'general';
      insert into threads (id, board, title) select %2$L, b.id, 'Strike two' from boards b where b.slug = 'general';
      insert into acts (id, character, kind, thread, payload) values (%3$L, %5$L, 'post', %1$L, '{"body": "Hooked."}'), (%4$L, %6$L, 'post', %2$L, '{"body": "Hooked."}');
      do $d$ begin perform set_card(%7$L, 'tlhook', %5$L, %3$L, '{}', 0); perform set_card(%8$L, 'tlhook', %6$L, %4$L, '{}', 0); end $d$;
    $sql$, t1, t2, x, y, s1, s2, one, two));
    said := tests.race_as(two, format('select post(%L, %L, %L, %L)', t1, s2, 'Quoting in one.', x),
                          one, format('select post(%L, %L, %L, %L)', t2, s1, 'Quoting in two.', y));
    if said[1] is not null or said[2] is not null then raise exception 'two landings across two posts, round %: %', round, said; end if;
    if (select count(*) from acts where kind = 'post' and thread in (t1, t2)) is distinct from 4::bigint then
      raise exception 'two landings across two posts, round %: a quote did not land', round;
    end if;
    if (select count(*) from acts where kind = 'card' and thread in (t1, t2) and payload ? 'spring') is distinct from 2::bigint then
      raise exception 'two landings across two posts, round %: not both Moves landed', round;
    end if;
  end loop;
end $$;

-- A sprung back is not locked. A thread holds one sprung back and one live back; while another session holds the sprung back's
-- row, a quote of it lands without waiting on it.
do $$
declare
  setter uuid := gen_random_uuid(); caster uuid := gen_random_uuid(); replier uuid := gen_random_uuid();
  s uuid := gen_random_uuid(); c uuid := gen_random_uuid(); r uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); sprung_post uuid := gen_random_uuid(); live_post uuid := gen_random_uuid();
  why text;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'tl-held-setter@test.invalid'), (%2$L, 'tl-held-caster@test.invalid'), (%3$L, 'tl-held-replier@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L), (%3$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'Held Setter', now(), now()), (%5$L, %2$L, 'Held Caster', now(), now()), (%6$L, %3$L, 'Held Replier', now(), now());
    insert into class_history (character, class_key, started_at) values (%4$L, 'alpha', now()), (%5$L, 'alpha', now()), (%6$L, 'alpha', now());
    insert into threads (id, board, title) select %7$L, b.id, 'Held backs' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%8$L, %4$L, 'post', %7$L, '{"body": "Sprung."}');
    insert into acts (id, character, kind, thread, payload) values (%9$L, %4$L, 'post', %7$L, '{"body": "Live."}');
    insert into card_ledger (account, card, kind, price) values (%1$L, 'tlcatch', 'bought', 0), (%1$L, 'tlidle', 'bought', 0), (%2$L, 'sweetie', 'bought', 0);
    do $d$ begin
      perform set_card(%1$L, 'tlcatch', %4$L, %8$L, '{"card": "sweetie"}', 0, 'sweetie');
      perform set_card(%1$L, 'tlidle', %4$L, %9$L, '{}', 0);
      perform play_card(%2$L, 'sweetie', %5$L, %8$L, '{}', 0, '');
    end $d$;
  $sql$, setter, caster, replier, s, c, r, t, sprung_post, live_post));
  if not exists (select 1 from acts where kind = 'spring' and target_act_id = sprung_post) then raise exception 'the held-back setup did not spring'; end if;
  perform extensions.dblink_connect('tl_holder', current_setting('kayfabb.scratch_url'));
  begin
    perform extensions.dblink_exec('tl_holder', 'begin');
    perform extensions.dblink_exec('tl_holder', format('do $h$ begin perform 1 from face_down where post = %L for update; end $h$', sprung_post));
    perform set_config('lock_timeout', '200ms', true);
    perform tests.become(replier);
    begin
      perform post(t, r, 'Quoting a sprung back.', sprung_post);
      why := null;
    exception when others then
      why := sqlerrm;
    end;
    perform tests.unbecome();
    perform set_config('lock_timeout', '0', true);
    perform extensions.dblink_exec('tl_holder', 'rollback');
  exception when others then
    perform extensions.dblink_disconnect('tl_holder');
    raise;
  end;
  perform extensions.dblink_disconnect('tl_holder');
  if why is not null then raise exception 'a quote waited on a sprung back: %', why; end if;
end $$;

-- ---- Every back costs the same reads before its decision ----
-- Cards in a hand, as bought.
create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- What a call to spring_traps reads from the tables it decides from, and their indexes: rows fetched and index entries returned in
-- this transaction so far, for each table (with its indexes) in name order. Taken before and after a call, the difference is the
-- call's own reads, compared as vectors, so a read moved from one table to another is a difference a sum would hide.
create function pg_temp.reads() returns bigint[] language sql as $$
  select array_agg(x.n order by x.relname) from (
    select t.relname, sum(pg_stat_get_xact_tuples_fetched(o.oid) + pg_stat_get_xact_tuples_returned(o.oid))::bigint as n
    from pg_class t cross join lateral (select t.oid union all select i.indexrelid from pg_index i where i.indrelid = t.oid) o(oid)
    where t.relname in ('characters', 'card_kinds', 'acts', 'face_down') and t.relnamespace = 'public'::regnamespace
    group by t.relname) x
$$;
create function pg_temp.since(before bigint[]) returns text language sql as $$
  select array_agg(n.v - before[n.i] order by n.i)::text from unnest(pg_temp.reads()) with ordinality n(v, i)
$$;

-- An Idle (a visit trap, so no quote springs it), a matching Move whose setter is retired, and a matching Move whose landing post already carries its card: each answers null and
-- writes nothing, and each reads the same rows before it does. Before 0075 the retired setter's check read characters for the trap alone,
-- and the stack count ran for the full-stack trap alone, so how long a quote took was computed from which card was face down.
-- (supabase/tests/0135-face-down-moves.sql counts the other backs, and the one that springs.)
do $$
declare
  ann uuid := tests.account('even-ann');
  bob uuid := tests.account('even-bob');
  idler uuid := tests.character(ann, 'Even Idler');
  retiree uuid := tests.character(ann, 'Even Retiree');
  striker uuid := tests.character(ann, 'Even Striker');
  replier uuid := tests.character(bob, 'Even Replier');
  t uuid := tests.thread('Even work');
  p_idle uuid := tests.post(idler, t, 'Idled.');
  p_retired uuid := tests.post(retiree, t, 'Retired.');
  p_full uuid := tests.post(striker, t, 'Full.');
  r uuid := tests.post(replier, t, 'A quote.');
  before bigint[];
  idle_reads text; retired_reads text; full_reads text;
  said jsonb;
  i integer;
begin
  -- The small tables (card_kinds, characters) are read in order by a sequential scan that stops at the first match, so the rows it reads say where a row sits in the table and not what
  -- the statement does; key lookups through the indexes read the same rows for every key, and are the statements being counted. (A busy instance's tables are read through them.)
  -- Without this, Postgres 17 in CI counted 54 for the retired setter's Move and 51 for the Idle: the retiree's rewritten row sits last in characters, and a scan from the top reads
  -- past more rows to reach it (forced to sequential scans here, characters alone reads 43 for the retiree and 40 for the Idle's setter).
  perform set_config('enable_seqscan', 'off', true);
  discard plans;
  perform pg_temp.hand(ann, 'tlidle', 'tlhook', 'tlhook');
  perform set_card(ann, 'tlidle', idler, p_idle, '{}', 0);
  perform set_card(ann, 'tlhook', retiree, p_retired, '{}', 0);
  perform set_card(ann, 'tlhook', striker, p_full, '{}', 0);
  -- The quoting post already carries the Move's card, which takes one to a post.
  perform tests.act(replier, 'card', t, jsonb_build_object('card', 'tlhook', 'layer', 1, 'message', '', 'config', '{}'), r);
  update characters set retired_at = now() where id = retiree;
  -- Every setter's row has been rewritten once, as the retiree's was (a rewritten row is a longer chain to read, which says nothing of the statement).
  update characters set debuted_at = debuted_at where id in (idler, striker);
  -- Warm: each statement planned, so a call's reads are its execution's alone.
  for i in 1 .. 8 loop perform spring_traps('quote', p_idle, r); end loop;

  before := pg_temp.reads(); said := spring_traps('quote', p_idle, r); idle_reads := pg_temp.since(before);
  if said is not null then raise exception 'an Idle sprang: %', said; end if;
  before := pg_temp.reads(); said := spring_traps('quote', p_retired, r); retired_reads := pg_temp.since(before);
  if said is not null then raise exception 'a retired setter''s Move sprang: %', said; end if;
  before := pg_temp.reads(); said := spring_traps('quote', p_full, r); full_reads := pg_temp.since(before);
  if said is not null then raise exception 'a Move onto a full stack sprang: %', said; end if;
  if exists (select 1 from acts where kind = 'spring' and target_act_id in (p_idle, p_retired, p_full)) then raise exception 'a back that does not spring in this test (an Idle with a visit trap, a retired setter, a full stack) wrote a spring'; end if;

  if retired_reads is distinct from idle_reads then
    raise exception 'a retired setter''s Move read % and an Idle % (acts, card_kinds, characters, face_down): the work before the decision differs with the card', retired_reads, idle_reads;
  end if;
  if full_reads is distinct from idle_reads then
    raise exception 'a Move onto a full stack read % and an Idle % (acts, card_kinds, characters, face_down): the work before the decision differs with the card', full_reads, idle_reads;
  end if;
  if (select sum(v) from unnest(idle_reads::bigint[]) v) < 4 then raise exception 'the reads were not counted (%)', idle_reads; end if;
  perform set_config('enable_seqscan', 'on', true);
end $$;

-- ---- my_card_ledger says whether a set card can spring ----
-- True for a trap set face down, and null for any other row: a purchase, or a card cast.
do $$
declare
  ann uuid := tests.account('ledger-ann');
  bob uuid := tests.account('ledger-bob');
  a uuid := tests.character(ann, 'Ledger Setter');
  b uuid := tests.character(bob, 'Ledger Other');
  t uuid := tests.thread('Ledger');
  p uuid := tests.post(a, t, 'Trapped.');
  q uuid := tests.post(a, t, 'Idled.');
  o uuid := tests.post(b, t, 'Cast on.');
  trap_set uuid; idle_set uuid; cast_play uuid;
begin
  perform pg_temp.hand(ann, 'tlhook', 'tlidle', 'sweetie');
  trap_set := (set_card(ann, 'tlhook', a, p, '{}', 0) ->> 'id')::uuid;
  idle_set := (set_card(ann, 'tlidle', a, q, '{}', 0) ->> 'id')::uuid;
  cast_play := (play_card(ann, 'sweetie', a, o, '{}', 0, '') ->> 'id')::uuid;
  perform tests.become(ann);
  if (select springs from my_card_ledger where act = trap_set) is distinct from true then raise exception 'a trap set face down: springs is not true'; end if;
  if (select springs from my_card_ledger where act = cast_play) is not null then raise exception 'a card cast has a springs'; end if;
  if (select count(*) from my_card_ledger where kind = 'bought' and springs is not null) is distinct from 0::bigint then raise exception 'a purchase has a springs'; end if;
  if (select count(*) from my_card_ledger where kind = 'bought') is distinct from 3::bigint then raise exception 'the ledger lost a purchase'; end if;
  perform tests.unbecome();
end $$;
