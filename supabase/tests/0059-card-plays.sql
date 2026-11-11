-- Card plays, traps and wards (supabase/migrations/0054_card_plays.sql): a Set writes a card back that names no card, a Use goes
-- on the caller's own post, a ward turns away casts at or below it, and a trap springs once on its trigger, never refusing the write
-- that springs it. docs/plans/2026-11-01-card-plays-plan.md, Tasks 2 and 3; rewritten for face-down Moves (docs/plans/2026-11-07-face-down-moves-plan.md,
-- Task 6): a Trap Card names the card it catches and takes it, a Move set face down lands on what quotes it, and nothing pays out, strikes by outcome,
-- or springs on a reaction or a reply. The cards are the engine's test set, never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The test cards, each priced in the economy (card_kinds_priced, 0006).
create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, gimmick, lasts) values
    ('snare', 'Snare', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}}', null, null),
    ('catcher', 'Catcher', 'salty', 'rare', 'set', '{"trigger": {"on": "cast"}}', null, null),
    ('idle', 'Idle', 'pepperoni', 'common', 'set', '{"trigger": {"on": "visit"}}', null, null),
    ('grandie', 'Grandie', 'sweet', 'legendary', 'cast', null, null, null),
    ('shield', 'Shield', 'sweet', 'uncommon', 'use', null, '{"kind": "ward", "upTo": "uncommon"}', interval '7 days'),
    ('hook', 'Hook', 'salty', 'uncommon', 'cast', null, null, null),
    ('quoter', 'Quoter', 'salty', 'uncommon', 'cast', null, null, null),
    ('lowtrap', 'Low Trap', 'salty', 'common', 'set', '{"trigger": {"on": "visit"}}', null, null)
  on conflict (key) do nothing;
end $$;

-- Cards in a hand, as bought.
create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- What a set Act shows anyone, its own id, author, target and times aside.
create function pg_temp.shape(projection jsonb) returns jsonb language sql as $$
  select projection - array['id', 'character', 'target_act_id', 'created_at', 'thread', 'seq']
$$;

-- ---- Two casts at once on one trapped post: exactly one is caught ----
-- First, so the rows it commits wait on nothing this file has written and not committed.
do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); cat uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  t uuid; p uuid;
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-trap-a@test.invalid'), (%2$L, 'race-trap-b@test.invalid'), (%3$L, 'race-trap-c@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L), (%3$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'Race Trapper', now(), now()), (%5$L, %2$L, 'Race Caster B', now(), now()), (%6$L, %3$L, 'Race Caster C', now(), now());
    insert into class_history (character, class_key, started_at) values (%4$L, 'alpha', now()), (%5$L, 'alpha', now()), (%6$L, 'alpha', now());
    insert into card_kinds (key, name, alignment, rarity, play, trap) values ('racecatch', 'Race Catcher', 'salty', 'rare', 'set', '{"trigger": {"on": "cast"}}');
    insert into card_ledger (account, card, kind, price) values (%1$L, 'racecatch', 'bought', 0), (%2$L, 'sweetie', 'bought', 0), (%3$L, 'sweetie', 'bought', 0);
  $sql$, ann, bob, cat, a, b, c));
  -- The post and the set, committed, then the two casts race.
  perform tests.commit(format($sql$
    do $d$ begin perform set_card(%1$L, 'racecatch', %2$L, tests.post(%2$L, tests.thread('Race trap'), 'Trapped.'), '{"card": "sweetie"}', 0, 'sweetie'); end $d$;
  $sql$, ann, a));
  select f.post, f.thread into p, t from face_down f where f.account = ann;
  said := tests.race_service(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'sweetie', b, p, '{}', ''), format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cat, 'sweetie', c, p, '{}', ''));
  -- Sweetie stacks one to a post: the catch takes no layer, so the other lands.
  if said[1] is not null or said[2] is not null then raise exception 'two casts at once on a trapped post: %', said; end if;
  if (select count(*) from acts where kind = 'card' and target_act_id = p and payload ? 'caught') is distinct from 1::bigint then raise exception 'two casts at once: not exactly one caught'; end if;
  if (select count(*) from acts where kind = 'card' and target_act_id = p and not payload ? 'caught') is distinct from 1::bigint then raise exception 'two casts at once: the other did not land'; end if;
  if (select count(*) from acts where kind = 'spring' and target_act_id = p) is distinct from 1::bigint then raise exception 'two casts at once sprang twice'; end if;
end $$;

-- ---- A post and a cast by one player, and a post and a landing Move whose setter is the poster: no deadlock ----
-- Every write that may spring locks in the one order 0075_trap_locks.sql wrote (a back's face_down row, the thread, then the count rows
-- of the writer and of the setters, then the Act it inserts), and 0078_reply_passes.sql keeps it while post() locks fewer backs.
-- Statement order the other way round leaves each pair below holding one lock the other wants. 0077-trap-locks.sql drives the same
-- pairs in a loop; here a trigger that sleeps after the poster's insert makes the interleaving certain rather than likely: the poster
-- holds its count row for the time the other side needs to take the lock it will wait on. Committed rows, since two sessions read them; first, so the
-- rows this block commits wait on nothing this file has written and not committed.
do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); cat uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid();
  p uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); pc uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-pair-a@test.invalid'), (%2$L, 'race-pair-b@test.invalid'), (%3$L, 'race-pair-c@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L), (%3$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'Pair Setter', now(), now()), (%5$L, %2$L, 'Pair Poster', now(), now()), (%6$L, %3$L, 'Pair Idler', now(), now());
    insert into class_history (character, class_key, started_at) values (%4$L, 'alpha', now()), (%5$L, 'alpha', now()), (%6$L, 'alpha', now());
    insert into card_kinds (key, name, alignment, rarity, play, trap) values
      ('paircatch', 'Pair Catcher', 'salty', 'rare', 'set', '{"trigger": {"on": "cast"}}'),
      ('pairhook', 'Pair Hook', 'salty', 'uncommon', 'cast', null),
      ('pairidle', 'Pair Idle', 'pepperoni', 'common', 'set', '{"trigger": {"on": "visit"}}');
    insert into card_ledger (account, card, kind, price) values (%1$L, 'paircatch', 'bought', 0), (%1$L, 'pairhook', 'bought', 0), (%2$L, 'sweetie', 'bought', 0), (%3$L, 'pairidle', 'bought', 0);
    insert into threads (id, board, title) select %7$L, b.id, 'Pair one' from boards b where b.slug = 'general';
    insert into threads (id, board, title) select %8$L, b.id, 'Pair two' from boards b where b.slug = 'general';
    insert into threads (id, board, title) select %12$L, b.id, 'Pair three' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values
      (%9$L, %4$L, 'post', %7$L, '{"body": "Trapped by a catcher."}'), (%10$L, %4$L, 'post', %8$L, '{"body": "Trapped by a hook."}'),
      (%11$L, %6$L, 'post', %8$L, '{"body": "Idled."}');
  $sql$, ann, bob, cat, a, b, c, t, t2, p, pa, pc, t3));
  perform tests.commit(format($sql$
    do $d$ begin
      perform set_card(%1$L, 'paircatch', %2$L, %3$L, '{"card": "sweetie"}', 0, 'sweetie');
      perform set_card(%1$L, 'pairhook', %2$L, %4$L, '{"color": "red"}', 0);
      perform set_card(%5$L, 'pairidle', %6$L, %7$L, '{}', 0);
    end $d$;
  $sql$, ann, a, p, pa, cat, c, pc));
  -- A writer holds a character's count row for a while after it counts an Act of that character's. (A trigger on the count table,
  -- since the table is dropped at the end; this file's own transaction holds a lock on acts that a drop of a trigger there would wait on.)
  perform tests.commit(format($sql$
    create function public.race_sleep() returns trigger language plpgsql as $f$ begin perform pg_sleep(0.6); return null; end $f$;
    revoke execute on function public.race_sleep() from public;
    create trigger race_sleep after insert or update on character_post_counts for each row when (new.character = %1$L) execute function public.race_sleep();
  $sql$, b));
  -- One player's quoting post and cast, both through Pair Poster, on a post a cast trap sits on.
  said := tests.race_as(bob, format('select post(%L, %L, %L, %L)', t, b, 'Quoting it.', p), null, format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'sweetie', b, p, '{}', ''));
  if said[1] is not null or said[2] is not null then raise exception 'a quoting post and a cast by one player on a trapped post: %', said; end if;
  if (select count(*) from acts where kind = 'post' and target_act_id = p) is distinct from 1::bigint then raise exception 'the quoting post did not land'; end if;
  if (select count(*) from acts where kind = 'card' and target_act_id = p and payload ? 'caught') is distinct from 1::bigint then raise exception 'the cast was not caught'; end if;
  -- A post by the setter of a Move, and another character's quote that springs it: the Move lands as a card by the setter,
  -- whose count row the setter's own post holds. The setter's post is in another thread (posts of one thread already wait on each
  -- other for their place in it) and quotes the post that carries a back in the reply's thread. The sleeping trigger now follows the setter.
  perform tests.commit(format($sql$
    drop trigger race_sleep on character_post_counts;
    create trigger race_sleep after insert or update on character_post_counts for each row when (new.character = %1$L) execute function public.race_sleep();
  $sql$, a));
  said := tests.race_as(ann, format('select post(%L, %L, %L, %L)', t3, a, 'A post by the setter, quoting from the other thread.', pc), bob, format('select post(%L, %L, %L, %L)', t2, b, 'A quote that springs the setter''s Move.', pa));
  if said[1] is not null or said[2] is not null then raise exception 'a post and a landing Move whose setter is the poster: %', said; end if;
  if (select count(*) from acts where kind = 'spring' and target_act_id = pa) is distinct from 1::bigint then raise exception 'the hook did not spring'; end if;
  perform tests.commit($sql$
    drop trigger race_sleep on character_post_counts;
    drop function public.race_sleep();
  $sql$);
  -- What the racers' writes queued for these players is not left for the files after this one (an alert is a row beside the Act).
  perform tests.commit(format($sql$
    delete from alerts where account in (%1$L, %2$L, %3$L);
    delete from broadcasts_due where topic in ('account:' || %1$L, 'account:' || %2$L, 'account:' || %3$L);
  $sql$, ann, bob, cat));
end $$;

-- ---- A back set while a post waits to insert its Act is not sprung by that post: the set it locked is the set it springs ----
-- Face-down Moves: post() reads the quoted post's live back and locks it with the setters' count rows before its Act. A trigger that
-- sleeps after the poster's Act insert holds the post there while a set_card lands a quote trap on the quoted post; the post never locked
-- that back, so it must not spring it (it was set after the post, and the next quote springs it). Committed rows, as above.
do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-late-a@test.invalid'), (%2$L, 'race-late-b@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Late Setter', now(), now()), (%4$L, %2$L, 'Late Quoter', now(), now());
    insert into class_history (character, class_key, started_at) values (%3$L, 'alpha', now()), (%4$L, 'alpha', now());
    insert into card_kinds (key, name, alignment, rarity, play, trap) values
      ('latequote', 'Late Quote', 'salty', 'uncommon', 'cast', null);
    insert into card_ledger (account, card, kind, price) values (%1$L, 'latequote', 'bought', 0);
    insert into threads (id, board, title) select %5$L, b.id, 'Late set' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%6$L, %3$L, 'post', %5$L, '{"body": "Quoted while the trap goes on."}');
  $sql$, ann, bob, a, b, t, p));
  perform tests.commit(format($sql$
    create function public.race_sleep() returns trigger language plpgsql as $f$ begin perform pg_sleep(1.2); return null; end $f$;
    revoke execute on function public.race_sleep() from public;
    create trigger race_sleep after insert or update on character_post_counts for each row when (new.character = %1$L) execute function public.race_sleep();
  $sql$, b));
  said := tests.race_as(bob, format('select post(%L, %L, %L, %L)', t, b, 'Quoting it.', p), null,
    format('do $d$ begin perform pg_sleep(0.4); perform set_card(%L, %L, %L, %L, %L, 0); end $d$', ann, 'latequote', a, p, '{}'));
  perform tests.commit('drop trigger race_sleep on character_post_counts; drop function public.race_sleep();');
  if said[1] is not null or said[2] is not null then raise exception 'a quoting post and a set that lands while it waits: %', said; end if;
  if (select count(*) from face_down where post = p) is distinct from 1::bigint then raise exception 'the set did not land'; end if;
  if (select count(*) from acts where kind = 'post' and target_act_id = p) is distinct from 1::bigint then raise exception 'the quoting post did not land'; end if;
  if (select count(*) from acts where kind = 'spring' and target_act_id = p) is distinct from 0::bigint then
    raise exception 'a post sprang a back it had not locked (set after the post read its locks)';
  end if;
  perform tests.commit(format($sql$
    delete from alerts where account in (%1$L, %2$L);
    delete from broadcasts_due where topic in ('account:' || %1$L, 'account:' || %2$L);
  $sql$, ann, bob));
end $$;

-- ---- Set: by the post's author, from a hand that holds the card, one card back to a post ----
do $$
declare
  ann uuid := tests.account('set-ann');
  bob uuid := tests.account('set-bob');
  a uuid := tests.character(ann, 'Setter');
  a2 uuid := tests.character(ann, 'Setter Two');
  b uuid := tests.character(bob, 'Passerby');
  t uuid := tests.thread();
  p uuid := tests.post(a, t, 'Mine.');
  q uuid := tests.post(b, t, 'Not mine.');
  r uuid := tests.post(a, t, 'Also mine.');
  set_snare jsonb;
  set_idle jsonb;
  why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'snare', 'snare', 'idle');
  insert into wallets (account, balance) values (ann, 600);
  perform tests.become_service();

  -- Through a character that did not write the post: refused, and through another of the same player's masks the same.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'snare', a, q, '{}', 'sweetie'));
  if why is distinct from 'a card is set face down on a post of your own character''s' then raise exception 'a Set on another''s post: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'snare', a2, p, '{}', 'sweetie'));
  if why is distinct from 'a card is set face down on a post of your own character''s' then raise exception 'a Set through another mask: %', why; end if;
  -- A Cast card is not set.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'sweetie', a, p, '{}'));
  if why is distinct from 'you hold no "sweetie" card; the Vending Machine sells them' then raise exception 'a Set of a card not held: %', why; end if;

  set_snare := set_card(ann, 'snare', a, p, '{"card": "sweetie"}', 0, 'sweetie');
  -- A second Set on the post is refused in plain words, whichever card it is.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'idle', a, p, '{}'));
  if why is distinct from 'this post already holds a card face down' then raise exception 'a second Set: %', why; end if;
  set_idle := set_card(ann, 'idle', a, r, '{}', 0);
  -- No card left: the second snare was never spent, so one remains; spend it, then a Set with none in hand is refused.
  perform set_card(ann, 'snare', a, (select tests.post(a, t, 'Third.')), '{"card": "sweetie"}', 0, 'sweetie');
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'snare', a, (select tests.post(a, t, 'Fourth.')), '{}'));
  if why is distinct from 'you hold no "snare" card; the Vending Machine sells them' then raise exception 'a Set with no card in hand: %', why; end if;

  -- The set Act, its broadcast (the projection the act function sends) and card_target carry no card key.
  if set_snare -> 'payload' is distinct from '{}'::jsonb or set_snare::text like '%snare%' then raise exception 'a set Act names its card: %', set_snare; end if;
  if act_projection((set_snare ->> 'id')::uuid)::text like '%snare%' then raise exception 'a set Act''s projection names its card'; end if;
  if card_target(p)::text like '%snare%' then raise exception 'card_target names a face-down card: %', card_target(p); end if;
  if card_target(p) -> 'effects' -> 0 ->> 'faceDown' is distinct from 'true' or card_target(p) -> 'effects' -> 0 -> 'card' is distinct from 'null'::jsonb
     or (card_target(p) -> 'effects' -> 0 ->> 'ends')::timestamptz <= now() + interval '6 days' then
    raise exception 'card_target shows a live back with its end and no card: %', card_target(p);
  end if;
  -- An Idle's set Act and a Snare's are the same bytes but for their ids and times.
  if pg_temp.shape(set_snare) is distinct from pg_temp.shape(set_idle) then raise exception 'an Idle''s set and a trap''s differ: % / %', set_snare, set_idle; end if;
  -- It takes no place in the thread and is no post in its author's counts.
  if set_snare -> 'seq' is distinct from 'null'::jsonb then raise exception 'a set took a place in its thread: %', set_snare; end if;
  if (select posts + spins + cards from character_post_counts where character = a) is distinct from 4 then raise exception 'a set counted as a post'; end if;
  -- The face-down row is the setter's: the hand and the log read it.
  perform tests.unbecome();
  perform tests.become(ann);
  if (select count(*) from my_face_down) is distinct from 3::bigint then raise exception 'the setter reads their own face-down cards'; end if;
  if (select card from my_face_down where play = (set_snare ->> 'id')::uuid) is distinct from 'snare' then raise exception 'the setter reads which card'; end if;
  if (select count(*) from face_down) is distinct from 3::bigint then raise exception 'the setter reads their own face_down rows'; end if;
  -- Nobody else reads it, signed in or not.
  perform tests.unbecome();
  perform tests.become(bob);
  if (select count(*) from face_down) is distinct from 0::bigint or (select count(*) from my_face_down) is distinct from 0::bigint then raise exception 'another account reads a face-down card'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  why := pg_temp.refusal('select count(*) from face_down');
  if why is null or why not like 'permission denied%' then raise exception 'anon reads face_down: %', why; end if;
  why := pg_temp.refusal('select count(*) from my_face_down');
  if why is null or why not like 'permission denied%' then raise exception 'anon reads my_face_down: %', why; end if;
  perform tests.unbecome();
  -- And no client writes it.
  perform tests.become(ann);
  why := pg_temp.refusal(format('insert into face_down (play, account, card, post, thread, round, ends_at) values (%L, %L, %L, %L, %L, 9, now())', set_snare ->> 'id', ann, 'snare', p, t));
  if why is null then raise exception 'a client wrote face_down'; end if;
  perform tests.unbecome();
end $$;

-- ---- Use and wards ----
do $$
declare
  ann uuid := tests.account('ward-ann');
  bob uuid := tests.account('ward-bob');
  a uuid := tests.character(ann, 'Warded');
  b uuid := tests.character(bob, 'Caster');
  t uuid := tests.thread();
  p uuid := tests.post(a, t, 'Shielded.');
  q uuid := tests.post(b, t, 'Not Ann''s.');
  o uuid := tests.post(a, t, 'Shield gone.');
  used jsonb;
  why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'shield', 'shield', 'sweetie', 'snare');
  perform pg_temp.hand(bob, 'sweetie', 'sweetie', 'grandie', 'shield');
  perform tests.become_service();
  -- A Use through someone else's post is refused.
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'shield', b, p, '{}', ''));
  if why is distinct from 'Shield is used on your own post' then raise exception 'a Use on another''s post: %', why; end if;
  -- A Set card is not played through play_card.
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'snare', a, p, '{}', ''));
  if why is distinct from 'Snare is set face down on your own post' then raise exception 'a Set card through play_card: %', why; end if;
  used := play_card(ann, 'shield', a, p, '{}', 0, '');
  if (used -> 'payload' ->> 'ends')::timestamptz not between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' then
    raise exception 'a Use carries its end, written when it lands: %', used;
  end if;
  if card_target(p) -> 'effects' -> 0 -> 'gimmick' is distinct from '{"kind": "ward", "upTo": "uncommon"}'::jsonb then raise exception 'card_target shows the gimmick: %', card_target(p); end if;
  -- A cast at or below the ward's rarity is turned away, in the same words for anyone; a rarer one lands.
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'sweetie', b, p, '{}', ''));
  if why is distinct from 'this post''s Shield turns away cards up to uncommon' then raise exception 'a common cast under an uncommon ward: %', why; end if;
  perform play_card(bob, 'grandie', b, p, '{}', 0, '');
  -- A ward never blocks its own player's Set.
  perform set_card(ann, 'snare', a, p, '{"card": "sweetie"}', 0, 'sweetie');
  -- Once the ward ends, it refuses nothing. (A ward that ended a week ago: written as play_card would have written it then.)
  perform tests.unbecome();
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'shield', 'layer', 1, 'message', '', 'config', '{}', 'ends', now() - interval '1 second'), o, now() - interval '7 days');
  perform tests.become_service();
  perform play_card(bob, 'sweetie', b, o, '{}', 0, '');
  -- And its post can be warded again: an ended Use holds no place in the stack.
  used := play_card(ann, 'shield', a, o, '{}', 0, '');
  if card_target(o) -> 'effects' @> jsonb_build_array(jsonb_build_object('act', used ->> 'id', 'gimmick', '{"kind": "ward", "upTo": "uncommon"}'::jsonb)) is not true then raise exception 'a post warded again after its ward ended: %', card_target(o); end if;
  perform tests.unbecome();
end $$;

-- ---- A Trap Card catches the card it names and takes it: nothing pays out, and the card is the setter's ----
do $$
declare
  ann uuid := tests.account('trap-ann');
  bob uuid := tests.account('trap-bob');
  a uuid := tests.character(ann, 'Trapper');
  b uuid := tests.character(bob, 'Spritey');
  t uuid := tests.thread();
  p uuid := tests.post(a, t, 'Go on, splat me.');
  played jsonb;
  set_act uuid;
  caught_ledger integer;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'snare');
  perform pg_temp.hand(bob, 'blot');
  insert into wallets (account, balance) values (ann, 590), (bob, 300);
  perform tests.become_service();
  set_act := (set_card(ann, 'snare', a, p, '{"card": "blot"}', 0, 'blot') ->> 'id')::uuid;
  played := play_card(bob, 'blot', b, p, '{"color": "red"}', 75, '');
  -- The cast is written, caught: its Act names the set, it takes no layer, and the answer carries the spring.
  if played -> 'payload' ->> 'caught' is distinct from set_act::text or played -> 'payload' ? 'layer' then raise exception 'a caught cast: %', played; end if;
  if played -> 'sprung' -> 'payload' ->> 'card' is distinct from 'snare' or played -> 'sprung' -> 'payload' ->> 'caught' is distinct from played ->> 'id'
     or played -> 'sprung' -> 'payload' ->> 'set' is distinct from set_act::text then
    raise exception 'the spring names the card, the play it caught and the set it ends: %', played -> 'sprung';
  end if;
  -- No response carries the setter's account, and the spring says what it did.
  if played::text like '%' || ann || '%' or played::text like '%balance%' or played::text like '%wallet%'
     or (select array_agg(k order by k) from jsonb_object_keys(played -> 'sprung' -> 'payload') k) is distinct from array['by', 'card', 'caught', 'did', 'set', 'trigger']
     or played -> 'sprung' -> 'payload' ->> 'did' is distinct from 'caught' then
    raise exception 'the caster''s answer carries more than the spring: %', played;
  end if;
  -- Spent all the same: the caster's ledger and wallet. Nothing is paid to the setter: the card is hers.
  select price into caught_ledger from card_ledger where account = bob and act = (played ->> 'id')::uuid and kind = 'played';
  if caught_ledger is distinct from 75 then raise exception 'the caught play is in the caster''s ledger at its price: %', caught_ledger; end if;
  if (select balance from wallets where account = bob) is distinct from 225 then raise exception 'the caster paid the play''s price'; end if;
  if exists (select 1 from wallet_events where account = ann) or (select balance from wallets where account = ann) is distinct from 590 then
    raise exception 'a catch moved the setter''s wallet: %', (select jsonb_agg(to_jsonb(w)) from wallet_events w where w.account = ann);
  end if;
  if card_held(ann, 'blot') is distinct from 1 or card_held(bob, 'blot') is distinct from 0 then raise exception 'the caught card is not the setter''s'; end if;
  -- The caster's log reads the catch from their own rows: the trap's card, the play's price and the card's at the machine.
  perform tests.unbecome();
  perform tests.become(bob);
  if (select jsonb_agg(jsonb_build_object('card', card, 'trap', trap, 'price', price, 'bought', bought_price, 'spring', spring)) from my_caught)
     is distinct from jsonb_build_array(jsonb_build_object('card', 'blot', 'trap', 'snare', 'price', 75, 'bought', 0, 'spring', played -> 'sprung' ->> 'id')) then
    raise exception 'the caster reads their caught play: %', (select jsonb_agg(to_jsonb(c)) from my_caught c);
  end if;
  perform tests.unbecome();
  -- Nobody else reads it: not the setter, whose trap caught it, and not anon.
  perform tests.become(ann);
  if (select count(*) from my_caught) is distinct from 0::bigint then raise exception 'another account reads a caught play'; end if;
  if (select count(*) from my_face_down where spring is not null and ended_at is not null) is distinct from 1::bigint then raise exception 'the setter''s log reads the spring and its end'; end if;
  perform tests.unbecome();
  perform tests.become_service();
  -- The trap is spent: the back is gone from card_target's live effects, and a second cast lands.
  if (card_target(p) -> 'effects' -> 0 ->> 'ends')::timestamptz > now() then raise exception 'a sprung back is still live: %', card_target(p); end if;
  if card_target(p)::text like '%"blot"%' then raise exception 'a caught play is an effect on its post: %', card_target(p); end if;
  perform tests.unbecome();
  perform pg_temp.hand(bob, 'blot');
  perform tests.become_service();
  played := play_card(bob, 'blot', b, p, '{"color": "blue"}', 0, '');
  if played ? 'sprung' or (played -> 'payload' ->> 'layer')::integer is distinct from 1 then raise exception 'a cast after the spring lands, at layer 1: %', played; end if;
  if (select count(*) from acts where kind = 'spring' and target_act_id = p) is distinct from 1::bigint then raise exception 'a trap sprang twice'; end if;
  perform tests.unbecome();
end $$;

-- ---- A card the trap did not name, an Idle, a Move, and an ended trap: the cast lands, and the reads are alike ----
do $$
declare
  ann uuid := tests.account('pass-ann');
  bob uuid := tests.account('pass-bob');
  a uuid := tests.character(ann, 'Setter Of Many');
  b uuid := tests.character(bob, 'Big Caster');
  t uuid := tests.thread();
  p_low uuid := tests.post(a, t, 'A trap naming another card.');
  p_idle uuid := tests.post(a, t, 'An idle.');
  p_hook uuid := tests.post(a, t, 'A Move under this.');
  p_old uuid := tests.post(a, t, 'An ended trap.');
  played jsonb;
  set_old uuid;
  reads_idle jsonb;
  reads_hook jsonb;
  before jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'snare', 'idle', 'hook');
  perform pg_temp.hand(bob, 'grandie', 'sweetie', 'sweetie', 'sweetie');
  perform tests.become_service();
  perform set_card(ann, 'snare', a, p_low, '{"card": "blot"}', 0, 'blot');
  perform set_card(ann, 'idle', a, p_idle, '{}', 0);
  perform set_card(ann, 'hook', a, p_hook, '{}', 0);
  perform tests.unbecome();
  -- A trap set eight days ago, ended a day since: written as set_card would have written it then.
  set_old := tests.act(a, 'set', t, '{}', p_old, now() - interval '8 days');
  insert into face_down (play, account, card, post, thread, round, ends_at, catches) values (set_old, ann, 'catcher', p_old, t, 1, now() - interval '1 day', 'sweetie');
  perform tests.become_service();
  -- A card the trap does not name passes over it, whatever its rarity, and the trap stays set.
  played := play_card(bob, 'grandie', b, p_low, '{}', 0, '');
  if played ? 'sprung' or played -> 'payload' ? 'caught' then raise exception 'a card the trap did not name was caught: %', played; end if;
  if (card_target(p_low) -> 'effects' -> 0 ->> 'ends')::timestamptz <= now() then raise exception 'the passed-over trap is no longer set'; end if;
  -- An Idle, a Move and an ended trap leave a cast untouched.
  foreach before in array array[to_jsonb(p_idle), to_jsonb(p_hook), to_jsonb(p_old)] loop
    played := play_card(bob, 'sweetie', b, (before #>> '{}')::uuid, '{}', 0, '');
    if played ? 'sprung' or played -> 'payload' ? 'caught' then raise exception 'a cast was caught by no trap that names it: %', played; end if;
  end loop;
  if exists (select 1 from acts where kind = 'spring' and target_act_id in (p_low, p_idle, p_hook, p_old)) then raise exception 'something sprang'; end if;
  perform tests.unbecome();
  -- The same reads for an Idle as for a Move: each table read the same number of times, the same way.
  before := (select jsonb_object_agg(relname, jsonb_build_array(seq_scan, idx_scan)) from pg_stat_xact_user_tables where relname in ('face_down', 'card_kinds', 'acts'));
  perform spring_traps('cast', p_idle, gen_random_uuid(), 'sweetie');
  reads_idle := (select jsonb_object_agg(relname, jsonb_build_array(seq_scan - (before -> relname ->> 0)::bigint, idx_scan - (before -> relname ->> 1)::bigint)) from pg_stat_xact_user_tables where relname in ('face_down', 'card_kinds', 'acts'));
  before := (select jsonb_object_agg(relname, jsonb_build_array(seq_scan, idx_scan)) from pg_stat_xact_user_tables where relname in ('face_down', 'card_kinds', 'acts'));
  perform spring_traps('cast', p_hook, gen_random_uuid(), 'sweetie');
  reads_hook := (select jsonb_object_agg(relname, jsonb_build_array(seq_scan - (before -> relname ->> 0)::bigint, idx_scan - (before -> relname ->> 1)::bigint)) from pg_stat_xact_user_tables where relname in ('face_down', 'card_kinds', 'acts'));
  if reads_idle is distinct from reads_hook then raise exception 'an Idle and a Move read differently: % / %', reads_idle, reads_hook; end if;
end $$;

-- ---- Each trigger springs its back once, and only once, and never refuses the write ----
-- A cast springs a Trap Card that names it; a quote springs a Move. A reaction and a reply spring nothing (the reaction's who is private, and a reply is not an answer to any one post).
do $$
declare
  ann uuid := tests.account('trig-ann');
  bob uuid := tests.account('trig-bob');
  a uuid := tests.character(ann, 'Trigger Setter');
  b uuid := tests.character(bob, 'Trigger Puller');
  t uuid := tests.thread();
  t2 uuid := tests.thread('Another');
  p_cast uuid := tests.post(a, t, 'Cast on me.');
  p_react uuid := tests.post(a, t, 'React to me.');
  p_quote uuid := tests.post(a, t, 'Quote me.');
  p_reply uuid := tests.post(a, t2, 'Reply to me.');
  answer jsonb;
  reply jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'catcher', 'quoter', 'hook', 'idle');
  perform pg_temp.hand(bob, 'sweetie', 'sweetie');
  perform tests.become_service();
  perform set_card(ann, 'catcher', a, p_cast, '{"card": "sweetie"}', 0, 'sweetie');
  perform set_card(ann, 'idle', a, p_react, '{}', 0);
  perform set_card(ann, 'quoter', a, p_quote, '{}', 0);
  perform set_card(ann, 'hook', a, p_reply, '{"color": "green"}', 0);
  -- cast
  answer := play_card(bob, 'sweetie', b, p_cast, '{}', 0, '');
  if answer -> 'sprung' -> 'payload' ->> 'trigger' is distinct from 'cast' then raise exception 'a cast trap on a cast: %', answer; end if;
  perform tests.unbecome();
  -- reaction: none of them springs anything, an Idle's or a Move's.
  perform tests.become(bob);
  answer := react(p_react, b, 'up');
  if answer ? 'sprung' then raise exception 'a reaction sprang a back: %', answer; end if;
  answer := react(p_quote, b, 'meh');
  if answer ? 'sprung' or answer -> 'tally' ->> 'meh' is distinct from '1' then raise exception 'a reaction sprang a Move, or did not land: %', answer; end if;
  -- quote: a post quoting it springs it, and lands its card on the quoting post.
  answer := post(t, b, 'As you said.', p_quote);
  if answer -> 'sprung' -> 'payload' ->> 'trigger' is distinct from 'quote' then raise exception 'a quote trap: %', answer; end if;
  if not exists (select 1 from acts k where k.kind = 'card' and k.target_act_id = (answer ->> 'id')::uuid and k.payload ->> 'card' = 'quoter' and k.character = a
                   and k.payload ->> 'spring' = answer -> 'sprung' ->> 'id') then
    raise exception 'a Move landed its card on the quoting post';
  end if;
  if answer -> 'sprung' -> 'struck' ->> 'target_act_id' is distinct from answer ->> 'id' or answer -> 'sprung' -> 'struck' -> 'payload' ->> 'card' is distinct from 'quoter' then
    raise exception 'the answer carries the landed card''s play, to be sent live: %', answer -> 'sprung';
  end if;
  answer := post(t, b, 'And again.', p_quote);
  if answer ? 'sprung' then raise exception 'a Move sprang twice'; end if;
  perform tests.unbecome();
  -- reply: a reply to the thread, by its own author or another character's, springs nothing; the quote that names the post springs it, laying a seeded Hook in the setter's ink.
  perform tests.become(ann);
  answer := post(t2, a, 'Me again.');
  if answer ? 'sprung' then raise exception 'a plain post sprang a back on its own author''s post'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  reply := post(t2, b, 'A reply.');
  if reply ? 'sprung' then raise exception 'a reply sprang a back: %', reply; end if;
  reply := post(t2, b, 'A quote.', p_reply);
  if reply -> 'sprung' -> 'payload' ->> 'trigger' is distinct from 'quote' then raise exception 'a quote of the post with a Move: %', reply; end if;
  if not exists (select 1 from acts k where k.kind = 'card' and k.target_act_id = (reply ->> 'id')::uuid and k.payload ->> 'card' = 'hook'
                   and k.payload -> 'config' ->> 'color' = 'green' and (k.payload ->> 'layer')::integer = 1) then
    raise exception 'a Move landed in the setter''s ink on the quote';
  end if;
  answer := post(t2, b, 'Another quote.', p_reply);
  if answer ? 'sprung' then raise exception 'a Move sprang twice'; end if;
  perform tests.unbecome();
  if (select count(*) from acts where kind = 'spring' and target_act_id in (p_cast, p_react, p_quote, p_reply)) is distinct from 3::bigint then
    raise exception 'each trigger sprang its back once, and an Idle never: %', (select count(*) from acts where kind = 'spring' and target_act_id in (p_cast, p_react, p_quote, p_reply));
  end if;
  -- A spring is no post: it takes no place and counts nowhere.
  if exists (select 1 from acts where kind = 'spring' and seq is not null) then raise exception 'a spring took a place in its thread'; end if;
end $$;

-- ---- A Move that cannot land leaves its back set ----
-- The quoting post already carries its one Sweetie, the most it takes: the quote is treated as if no card were there.
do $$
declare
  ann uuid := tests.account('full-ann');
  bob uuid := tests.account('full-bob');
  a uuid := tests.character(ann, 'Quote Trapper');
  b uuid := tests.character(bob, 'Full Poster');
  t uuid := tests.thread();
  p uuid := tests.post(a, t, 'Quote me.');
  q uuid := tests.post(b, t, 'Already sweet.');
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'sweetie', 'sweetie');
  perform tests.become_service();
  perform set_card(ann, 'sweetie', a, p, '{}', 0);
  perform play_card(ann, 'sweetie', a, q, '{}', 0, '');
  perform tests.unbecome();
  if spring_traps('quote', p, q) is not null then raise exception 'a Move onto a full stack sprang'; end if;
  if exists (select 1 from acts where kind = 'spring' and target_act_id = p) then raise exception 'a Move onto a full stack wrote a spring'; end if;
  if (card_target(p) -> 'effects' -> 0 ->> 'ends')::timestamptz <= now() then raise exception 'the back is no longer set'; end if;
end $$;

-- ---- The seed: the pairings instanceProblems refuses, refused naming the card ----
do $$
declare why text;
begin
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "trap": {"trigger": {"on": "cast"}}, "rarity": "common"}]}')$s$);
  if why is distinct from 'card "seedling" has a trap, and only a set card has one' then raise exception 'a trap on a Cast seeded: %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet"}]}')$s$);
  if why is distinct from 'card "seedling" has no rarity; a rarity is common, uncommon, rare or legendary' then raise exception 'a card with no rarity seeded: %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "common", "play": "use", "gimmick": {"kind": "ward", "upTo": "common"}, "lasts": {"unit": "day", "count": 7}}]}')$s$);
  if why is not null then raise exception 'a ward was refused: %', why; end if;
  if (select lasts from card_kinds where key = 'seedling') is distinct from interval '7 days' or (select gimmick from card_kinds where key = 'seedling') is distinct from '{"kind": "ward", "upTo": "common"}'::jsonb then raise exception 'the seed wrote the gimmick and its time up'; end if;
  why := pg_temp.refusal($s$insert into settings (key, value) values ('setLasts', '{"unit": "minute", "count": 5}') on conflict (key) do update set value = excluded.value$s$);
  if why is distinct from 'setLasts is a span: a unit of day, week or month and a whole count from 1 to 1000' then raise exception 'a setLasts in minutes: %', why; end if;
end $$;

-- ---- The settlement reads a spring as a play of its card, and a card on a staff post against the post ----
do $$
declare
  ann uuid := tests.account('settle-ann');
  bob uuid := tests.account('settle-bob');
  a uuid := tests.character(ann, 'Settled Setter');
  b uuid := tests.character(bob, 'Settled Caster');
  t uuid := tests.thread();
  p uuid := tests.post(a, t, 'Trapped.');
  boss uuid;
  decree uuid;
  played jsonb;
  input jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'catcher');
  perform pg_temp.hand(bob, 'sweetie', 'splat');
  insert into characters (name, staff, staff_kind, debuted_at) values ('Settle Boss', 'settle-boss', 'persona', now()) returning id into boss;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload) values (boss, 'post', t, '{"body": "A decree."}') returning id into decree;
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.become_service();
  perform set_card(ann, 'catcher', a, p, '{"card": "sweetie"}', 0, 'sweetie');
  played := play_card(bob, 'sweetie', b, p, '{}', 0, '');
  perform play_card(bob, 'splat', b, decree, '{}', 0, '');
  perform tests.unbecome();
  input := settlement_input(now() - interval '1 hour', now() + interval '1 hour');
  if not exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'kind' = 'spring' and x ->> 'card' = 'catcher' and x ->> 'target' = p::text and x ->> 'character' = a::text) then
    raise exception 'a spring is settled as a play of its card on the trapped post: %', input -> 'acts';
  end if;
  if not exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'id' = played ->> 'id' and x ->> 'card' = 'sweetie') then raise exception 'a caught play settles as the play it is'; end if;
  if (select count(*) from jsonb_array_elements(input -> 'acts') x where x ->> 'target' = decree::text) is distinct from 1::bigint then raise exception 'a card on a staff post is in what earns, once: %', input -> 'acts'; end if;
  if exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'id' = decree::text or x ->> 'character' = boss::text) then raise exception 'a staff post is in what earns'; end if;
  if not exists (select 1 from jsonb_array_elements(input -> 'unscoredTargets') x where x ->> 'id' = decree::text) then raise exception 'the staff post is not an unscored target: %', input; end if;
  -- A set is no play: it settles as an Act of its author's, naming no card.
  if exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'kind' = 'set' and x ? 'card') then raise exception 'a set names a card in the settlement''s input'; end if;
end $$;

-- ---- A trap whose setter can no longer act springs nothing, and never refuses the write ----
do $$
declare
  ann uuid := tests.account('retired-ann');
  bob uuid := tests.account('retired-bob');
  a uuid := tests.character(ann, 'Retired Setter');
  b uuid := tests.character(bob, 'Lively Caster');
  t uuid := tests.thread();
  p_cast uuid := tests.post(a, t, 'Cast on me.');
  t2 uuid := tests.thread('Hooked');
  p_reply uuid := tests.post(a, t2, 'Reply to me.');
  answer jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'catcher', 'hook');
  perform pg_temp.hand(bob, 'sweetie');
  perform tests.become_service();
  perform set_card(ann, 'catcher', a, p_cast, '{"card": "sweetie"}', 0, 'sweetie');
  perform tests.unbecome();
  perform tests.become_service();
  perform set_card(ann, 'hook', a, p_reply, '{"color": "red"}', 0);
  perform tests.unbecome();
  update characters set retired_at = now() where id = a;
  perform tests.become_service();
  answer := play_card(bob, 'sweetie', b, p_cast, '{}', 0, '');
  if answer ? 'sprung' or answer -> 'payload' ? 'caught' then raise exception 'a retired setter''s trap caught a cast: %', answer; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  answer := post(t2, b, 'A quote.', p_reply);
  if answer ? 'sprung' then raise exception 'a retired setter''s Move landed on a quote: %', answer; end if;
  perform tests.unbecome();
end $$;

-- ---- The seed names the card for every pairing instanceProblems refuses, and a ward has a time up ----
do $$
declare why text;
begin
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "common", "play": "use", "gimmick": {"kind": "ward", "upTo": "common"}}]}')$s$);
  if why is distinct from 'card "seedling" is a use card with no time up (lasts); a use card ends at its time' then raise exception 'a ward with no time up seeded: %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "sneeze"}}}]}')$s$);
  if why is distinct from 'card "seedling" springs on "sneeze"; a set card springs on cast or visit' then raise exception 'a trap on no trigger seeded: %', why; end if;
  -- A Move's trigger is the engine's, never a card's: a trap on a reply, a reaction or a quote is refused as any trigger but a cast or a visit is.
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "reply"}}}]}')$s$);
  if why is distinct from 'card "seedling" springs on "reply"; a set card springs on cast or visit' then raise exception 'a trap on a reply seeded: %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "rarity": "common", "play": "use", "gimmick": {"kind": "ward", "upTo": "common"}, "lasts": {"unit": "day", "count": "seven"}}]}')$s$);
  if why is distinct from 'card "seedling" lasts {"unit": "day", "count": "seven"}; it must be a span: a unit of day, week or month and a whole count from 1 to 1000' then raise exception 'a time up of no number seeded: %', why; end if;
  -- An invite's lifetime is still a span of days or more (0020), beside setLasts.
  why := pg_temp.refusal($s$insert into settings (key, value) values ('inviteLifetime', '{"unit": "minute", "count": 5}') on conflict (key) do update set value = excluded.value$s$);
  if why is distinct from 'inviteLifetime is a span: a unit of day, week or month and a whole count from 1 to 1000' then raise exception 'an invite lifetime in minutes: %', why; end if;
end $$;
