-- Trap locks, even trap work, and the set line's springs (supabase/migrations/0073_trap_locks.sql): every path that can spring a
-- trap takes its locks in one written order, so a write that springs a trap is never refused by a deadlock; a sprung back is not
-- locked; spring_traps reads the same rows for every back before it decides; my_card_ledger says whether a set card can spring.
-- docs/plans/2026-11-03-trap-locks-plan.md, Tasks 1 to 3. The cards are the engine's test set, never an instance's.

-- ---- Races, first, so the rows they commit wait on nothing this file has written and not committed ----

-- The cards and the players the races share, committed.
do $$
begin
  perform tests.commit($sql$
    update settings set value = value || '{"tlcatch.price": 100, "tlhook.price": 100, "tlbluff.price": 25}' where key = 'economy';
    insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap) values
      ('tlcatch', 'Lock Catcher', 'salty', 'tlcatch.price', 'rare', 'set', '{"trigger": {"on": "cast"}, "outcome": {"do": "nullify"}}'),
      ('tlhook', 'Lock Hook', 'salty', 'tlhook.price', 'uncommon', 'set', '{"trigger": {"on": "reply"}, "outcome": {"do": "strike", "card": "blot"}}'),
      ('tlbluff', 'Lock Bluff', 'pepperoni', 'tlbluff.price', 'common', 'set', null);
  $sql$);
end $$;

-- A quote and a cast through one character on one trapped post both land. The quote's post() takes the poster's count row with its
-- insert; the cast's spring_traps takes the back and then, through the caught card's insert, the caster's count row. Before 0073,
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
      do $d$ begin perform set_card(%4$L, 'tlcatch', %2$L, %1$L, '{}', 0); end $d$;
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

-- Two strikes across two players' posts both land. Each reply springs the other player's reply trap, whose strike is a card written
-- through its setter's character: a counted Act. Each post() therefore needs both characters' count rows. Locking the poster's own
-- row first and the setter's at the strike crosses; post() takes every one in character order before it writes.
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
    said := tests.race_as(two, format('select post(%L, %L, %L)', t1, s2, 'Replying in one.'),
                          one, format('select post(%L, %L, %L)', t2, s1, 'Replying in two.'));
    if said[1] is not null or said[2] is not null then raise exception 'two strikes across two posts, round %: %', round, said; end if;
    if (select count(*) from acts where kind = 'post' and thread in (t1, t2)) is distinct from 4::bigint then
      raise exception 'two strikes across two posts, round %: a reply did not land', round;
    end if;
    if (select count(*) from acts where kind = 'card' and thread in (t1, t2) and payload ? 'spring') is distinct from 2::bigint then
      raise exception 'two strikes across two posts, round %: not both strikes landed', round;
    end if;
  end loop;
end $$;

-- A sprung back is not locked. A thread holds one sprung back and one live back; while another session holds the sprung back's
-- row, a reply lands without waiting on it.
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
    insert into card_ledger (account, card, kind, price) values (%1$L, 'tlcatch', 'bought', 0), (%1$L, 'tlbluff', 'bought', 0), (%2$L, 'sweetie', 'bought', 0);
    do $d$ begin
      perform set_card(%1$L, 'tlcatch', %4$L, %8$L, '{}', 0);
      perform set_card(%1$L, 'tlbluff', %4$L, %9$L, '{}', 0);
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
      perform post(t, r, 'Replying past a sprung back.');
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
  if why is not null then raise exception 'a reply waited on a sprung back: %', why; end if;
end $$;

-- ---- Every back costs the same reads before its decision ----
-- Cards in a hand, as bought.
create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- What a call to spring_traps reads from the tables it decides from, and their indexes: rows fetched and index entries returned in
-- this transaction so far. Taken before and after a call, the difference is the call's own reads.
create function pg_temp.reads() returns bigint language sql as $$
  select sum(pg_stat_get_xact_tuples_fetched(r.oid) + pg_stat_get_xact_tuples_returned(r.oid))::bigint
  from pg_class r
  where r.oid in (select t.oid from pg_class t where t.relname in ('characters', 'card_kinds', 'acts', 'face_down') and t.relnamespace = 'public'::regnamespace
                  union select i.indexrelid from pg_index i join pg_class t on t.oid = i.indrelid
                  where t.relname in ('characters', 'card_kinds', 'acts', 'face_down') and t.relnamespace = 'public'::regnamespace)
$$;

-- A Bluff, a matching reply-strike trap whose setter is retired, and a matching reply-strike trap whose struck post already carries
-- its stack: each answers null and writes nothing, and each reads the same rows before it does. Before 0073 the retired setter's
-- check read characters for the trap alone, and the stack count ran for the full-stack trap alone, so how long a reply took was
-- computed from which card was face down.
do $$
declare
  ann uuid := tests.account('even-ann');
  bob uuid := tests.account('even-bob');
  bluffer uuid := tests.character(ann, 'Even Bluffer');
  retiree uuid := tests.character(ann, 'Even Retiree');
  striker uuid := tests.character(ann, 'Even Striker');
  replier uuid := tests.character(bob, 'Even Replier');
  t uuid := tests.thread('Even work');
  p_bluff uuid := tests.post(bluffer, t, 'Bluffed.');
  p_retired uuid := tests.post(retiree, t, 'Retired.');
  p_full uuid := tests.post(striker, t, 'Full.');
  r uuid := tests.post(replier, t, 'A reply.');
  before bigint;
  bluff_reads bigint; retired_reads bigint; full_reads bigint;
  said jsonb;
  i integer;
begin
  perform pg_temp.hand(ann, 'tlbluff', 'tlhook', 'tlhook');
  perform set_card(ann, 'tlbluff', bluffer, p_bluff, '{}', 0);
  perform set_card(ann, 'tlhook', retiree, p_retired, '{}', 0);
  perform set_card(ann, 'tlhook', striker, p_full, '{}', 0);
  -- The reply already carries blot's stack, three to a post.
  for i in 1 .. 3 loop
    perform tests.act(replier, 'card', t, jsonb_build_object('card', 'blot', 'layer', i, 'message', '', 'config', '{}', 'seed', i), r);
  end loop;
  update characters set retired_at = now() where id = retiree;
  -- Warm: each statement planned, so a call's reads are its execution's alone.
  for i in 1 .. 8 loop perform spring_traps('reply', p_bluff, r); end loop;

  before := pg_temp.reads(); said := spring_traps('reply', p_bluff, r); bluff_reads := pg_temp.reads() - before;
  if said is not null then raise exception 'a Bluff sprang: %', said; end if;
  before := pg_temp.reads(); said := spring_traps('reply', p_retired, r); retired_reads := pg_temp.reads() - before;
  if said is not null then raise exception 'a retired setter''s trap sprang: %', said; end if;
  before := pg_temp.reads(); said := spring_traps('reply', p_full, r); full_reads := pg_temp.reads() - before;
  if said is not null then raise exception 'a strike on a full stack sprang: %', said; end if;
  if exists (select 1 from acts where kind = 'spring' and target_act_id in (p_bluff, p_retired, p_full)) then raise exception 'a back that cannot spring wrote a spring'; end if;

  if retired_reads is distinct from bluff_reads then
    raise exception 'a retired setter''s trap read % rows and a Bluff %: the work before the decision differs with the card', retired_reads, bluff_reads;
  end if;
  if full_reads is distinct from bluff_reads then
    raise exception 'a full-stack strike read % rows and a Bluff %: the work before the decision differs with the card', full_reads, bluff_reads;
  end if;
end $$;

-- ---- my_card_ledger says whether a set card can spring ----
-- True for a trap set face down, false for a Bluff set face down, and null for any other row: a purchase, or a card cast.
do $$
declare
  ann uuid := tests.account('ledger-ann');
  bob uuid := tests.account('ledger-bob');
  a uuid := tests.character(ann, 'Ledger Setter');
  b uuid := tests.character(bob, 'Ledger Other');
  t uuid := tests.thread('Ledger');
  p uuid := tests.post(a, t, 'Trapped.');
  q uuid := tests.post(a, t, 'Bluffed.');
  o uuid := tests.post(b, t, 'Cast on.');
  trap_set uuid; bluff_set uuid; cast_play uuid;
begin
  perform pg_temp.hand(ann, 'tlhook', 'tlbluff', 'sweetie');
  trap_set := (set_card(ann, 'tlhook', a, p, '{}', 0) ->> 'id')::uuid;
  bluff_set := (set_card(ann, 'tlbluff', a, q, '{}', 0) ->> 'id')::uuid;
  cast_play := (play_card(ann, 'sweetie', a, o, '{}', 0, '') ->> 'id')::uuid;
  perform tests.become(ann);
  if (select springs from my_card_ledger where act = trap_set) is distinct from true then raise exception 'a trap set face down: springs is not true'; end if;
  if (select springs from my_card_ledger where act = bluff_set) is distinct from false then raise exception 'a Bluff set face down: springs is not false'; end if;
  if (select springs from my_card_ledger where act = cast_play) is not null then raise exception 'a card cast has a springs'; end if;
  if (select count(*) from my_card_ledger where kind = 'bought' and springs is not null) is distinct from 0::bigint then raise exception 'a purchase has a springs'; end if;
  if (select count(*) from my_card_ledger where kind = 'bought') is distinct from 3::bigint then raise exception 'the ledger lost a purchase'; end if;
  perform tests.unbecome();
end $$;
