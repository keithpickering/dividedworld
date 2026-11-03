-- Card plays, traps and wards (supabase/migrations/0054_card_plays.sql): a Set writes a card back that names no card, a Use goes
-- on the caller's own post, a ward turns away casts at or below it, and a trap springs once on its trigger, never refusing the write
-- that springs it. docs/plans/2026-11-01-card-plays-plan.md, Tasks 2 and 3. The cards are the engine's test set, never an instance's.

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
  update settings set value = value || '{"snare.price": 150, "catcher.price": 100, "bluffy.price": 25, "grandie.price": 100, "shield.price": 150, "hook.price": 100, "quoter.price": 100, "jumpy.price": 100, "lowtrap.price": 100}' where key = 'economy';
  insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap, ward, lasts) values
    ('snare', 'Snare', 'salty', 'snare.price', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "outcome": {"do": "payout"}}', false, null),
    ('catcher', 'Catcher', 'salty', 'catcher.price', 'rare', 'set', '{"trigger": {"on": "cast"}, "outcome": {"do": "nullify"}}', false, null),
    ('bluffy', 'Bluffy', 'pepperoni', 'bluffy.price', 'common', 'set', null, false, null),
    ('grandie', 'Grandie', 'sweet', 'grandie.price', 'legendary', 'cast', null, false, null),
    ('shield', 'Shield', 'sweet', 'shield.price', 'uncommon', 'use', null, true, interval '7 days'),
    ('hook', 'Hook', 'salty', 'hook.price', 'uncommon', 'set', '{"trigger": {"on": "reply"}, "outcome": {"do": "strike", "card": "blot"}}', false, null),
    ('quoter', 'Quoter', 'salty', 'quoter.price', 'uncommon', 'set', '{"trigger": {"on": "quote"}, "outcome": {"do": "strike", "card": "sweetie"}}', false, null),
    ('jumpy', 'Jumpy', 'salty', 'jumpy.price', 'common', 'set', '{"trigger": {"on": "reaction", "quadrant": "boredNegative"}, "outcome": {"do": "nullify"}}', false, null),
    ('lowtrap', 'Low Trap', 'salty', 'lowtrap.price', 'common', 'set', '{"trigger": {"on": "cast"}, "outcome": {"do": "nullify"}}', false, null)
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
    update settings set value = value || '{"racecatch.price": 100}' where key = 'economy';
    insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap) values ('racecatch', 'Race Catcher', 'salty', 'racecatch.price', 'rare', 'set', '{"trigger": {"on": "cast"}, "outcome": {"do": "nullify"}}');
    insert into card_ledger (account, card, kind, price) values (%1$L, 'racecatch', 'bought', 0), (%2$L, 'sweetie', 'bought', 0), (%3$L, 'sweetie', 'bought', 0);
  $sql$, ann, bob, cat, a, b, c));
  -- The post and the set, committed, then the two casts race.
  perform tests.commit(format($sql$
    do $d$ begin perform set_card(%1$L, 'racecatch', %2$L, tests.post(%2$L, tests.thread('Race trap'), 'Trapped.'), '{}', 0); end $d$;
  $sql$, ann, a));
  select f.post, f.thread into p, t from face_down f where f.account = ann;
  said := tests.race_service(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'sweetie', b, p, '{}', ''), format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cat, 'sweetie', c, p, '{}', ''));
  -- Sweetie stacks one to a post: the catch takes no layer, so the other lands.
  if said[1] is not null or said[2] is not null then raise exception 'two casts at once on a trapped post: %', said; end if;
  if (select count(*) from acts where kind = 'card' and target_act_id = p and payload ? 'caught') is distinct from 1::bigint then raise exception 'two casts at once: not exactly one caught'; end if;
  if (select count(*) from acts where kind = 'card' and target_act_id = p and not payload ? 'caught') is distinct from 1::bigint then raise exception 'two casts at once: the other did not land'; end if;
  if (select count(*) from acts where kind = 'spring' and target_act_id = p) is distinct from 1::bigint then raise exception 'two casts at once sprang twice'; end if;
end $$;

-- ---- A post and a cast by one player, and a post and a strike whose setter is the poster: no deadlock ----
-- Reply passes (0075): every write that may spring locks in one order, a back's face_down row, then the count rows of the writer and of
-- the setters, then the Act it inserts. Today's statement order inserts first and locks after, so each pair below holds one lock the other
-- wants. A trigger that sleeps after the poster's insert makes the interleaving certain rather than likely: the poster holds its count row
-- for the time the other side needs to take the lock it will wait on. Committed rows, since two sessions read them; first, so the
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
    insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'Pair Setter', now(), now()), (%5$L, %2$L, 'Pair Poster', now(), now()), (%6$L, %3$L, 'Pair Bluffer', now(), now());
    insert into class_history (character, class_key, started_at) values (%4$L, 'alpha', now()), (%5$L, 'alpha', now()), (%6$L, 'alpha', now());
    update settings set value = value || '{"pairhook.price": 100, "pairbluff.price": 100, "paircatch.price": 100}' where key = 'economy';
    insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap) values
      ('paircatch', 'Pair Catcher', 'salty', 'paircatch.price', 'rare', 'set', '{"trigger": {"on": "cast"}, "outcome": {"do": "nullify"}}'),
      ('pairhook', 'Pair Hook', 'salty', 'pairhook.price', 'uncommon', 'set', '{"trigger": {"on": "reply"}, "outcome": {"do": "strike", "card": "blot"}}'),
      ('pairbluff', 'Pair Bluff', 'pepperoni', 'pairbluff.price', 'common', 'set', null);
    insert into card_ledger (account, card, kind, price) values (%1$L, 'paircatch', 'bought', 0), (%1$L, 'pairhook', 'bought', 0), (%2$L, 'sweetie', 'bought', 0), (%3$L, 'pairbluff', 'bought', 0);
    insert into threads (id, board, title) select %7$L, b.id, 'Pair one' from boards b where b.slug = 'general';
    insert into threads (id, board, title) select %8$L, b.id, 'Pair two' from boards b where b.slug = 'general';
    insert into threads (id, board, title) select %12$L, b.id, 'Pair three' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values
      (%9$L, %4$L, 'post', %7$L, '{"body": "Trapped by a catcher."}'), (%10$L, %4$L, 'post', %8$L, '{"body": "Trapped by a hook."}'),
      (%11$L, %6$L, 'post', %8$L, '{"body": "Bluffed."}');
  $sql$, ann, bob, cat, a, b, c, t, t2, p, pa, pc, t3));
  perform tests.commit(format($sql$
    do $d$ begin
      perform set_card(%1$L, 'paircatch', %2$L, %3$L, '{}', 0);
      perform set_card(%1$L, 'pairhook', %2$L, %4$L, '{"color": "red"}', 0);
      perform set_card(%5$L, 'pairbluff', %6$L, %7$L, '{}', 0);
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
  -- A post by the setter of a reply trap, and another character's reply that springs that trap: the strike lays a card by the setter,
  -- whose count row the setter's own post holds. The setter's post is in another thread (posts of one thread already wait on each
  -- other for their place in it) and quotes the post that carries a back in the reply's thread. The sleeping trigger now follows the setter.
  perform tests.commit(format($sql$
    drop trigger race_sleep on character_post_counts;
    create trigger race_sleep after insert or update on character_post_counts for each row when (new.character = %1$L) execute function public.race_sleep();
  $sql$, a));
  said := tests.race_as(ann, format('select post(%L, %L, %L, %L)', t3, a, 'A post by the setter, quoting from the other thread.', pc), bob, format('select post(%L, %L, %L, null)', t2, b, 'A reply that springs the setter''s trap.'));
  if said[1] is not null or said[2] is not null then raise exception 'a post and a strike whose setter is the poster: %', said; end if;
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
-- Reply passes (0075): post() reads the quoted post's live back and locks it with the setters' count rows before its Act. A trigger that
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
    update settings set value = value || '{"latequote.price": 100}' where key = 'economy';
    insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap) values
      ('latequote', 'Late Quote', 'salty', 'latequote.price', 'uncommon', 'set', '{"trigger": {"on": "quote"}, "outcome": {"do": "strike", "card": "blot"}}');
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
  set_bluff jsonb;
  why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'snare', 'snare', 'bluffy');
  insert into wallets (account, balance) values (ann, 600);
  perform tests.become_service();

  -- Through a character that did not write the post: refused, and through another of the same player's masks the same.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'snare', a, q, '{}'));
  if why is distinct from 'a card is set face down on a post of your own character''s' then raise exception 'a Set on another''s post: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'snare', a2, p, '{}'));
  if why is distinct from 'a card is set face down on a post of your own character''s' then raise exception 'a Set through another mask: %', why; end if;
  -- A Cast card is not set.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'sweetie', a, p, '{}'));
  if why is distinct from 'you hold no "sweetie" card; the Vending Machine sells them' then raise exception 'a Set of a card not held: %', why; end if;

  set_snare := set_card(ann, 'snare', a, p, '{}', 0);
  -- A second Set on the post is refused in plain words, whichever card it is.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'bluffy', a, p, '{}'));
  if why is distinct from 'this post already holds a card face down' then raise exception 'a second Set: %', why; end if;
  set_bluff := set_card(ann, 'bluffy', a, r, '{}', 0);
  -- No card left: the second snare was never spent, so one remains; spend it, then a Set with none in hand is refused.
  perform set_card(ann, 'snare', a, (select tests.post(a, t, 'Third.')), '{}', 0);
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
  -- A Bluff's set Act and a Snare's are the same bytes but for their ids and times.
  if pg_temp.shape(set_snare) is distinct from pg_temp.shape(set_bluff) then raise exception 'a Bluff''s set and a trap''s differ: % / %', set_snare, set_bluff; end if;
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
  if card_target(p) -> 'effects' -> 0 ->> 'ward' is distinct from 'uncommon' then raise exception 'card_target shows the ward and its rarity: %', card_target(p); end if;
  -- A cast at or below the ward's rarity is turned away, in the same words for anyone; a rarer one lands.
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'sweetie', b, p, '{}', ''));
  if why is distinct from 'this post''s Shield turns away cards up to uncommon' then raise exception 'a common cast under an uncommon ward: %', why; end if;
  perform play_card(bob, 'grandie', b, p, '{}', 0, '');
  -- A ward never blocks its own player's Set.
  perform set_card(ann, 'snare', a, p, '{}', 0);
  -- Once the ward ends, it refuses nothing. (A ward that ended a week ago: written as play_card would have written it then.)
  perform tests.unbecome();
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'shield', 'layer', 1, 'message', '', 'config', '{}', 'ends', now() - interval '1 second'), o, now() - interval '7 days');
  perform tests.become_service();
  perform play_card(bob, 'sweetie', b, o, '{}', 0, '');
  -- And its post can be warded again: an ended Use holds no place in the stack.
  used := play_card(ann, 'shield', a, o, '{}', 0, '');
  if card_target(o) -> 'effects' @> jsonb_build_array(jsonb_build_object('act', used ->> 'id', 'ward', 'uncommon')) is not true then raise exception 'a post warded again after its ward ended: %', card_target(o); end if;
  perform tests.unbecome();
end $$;

-- ---- A trap catches a cast, and a payout moves exactly the play's price ----
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
  set_act := (set_card(ann, 'snare', a, p, '{}', 0) ->> 'id')::uuid;
  played := play_card(bob, 'blot', b, p, '{"color": "red"}', 75, '');
  -- The cast is written, caught: its Act names the set, it takes no layer, and the answer carries the spring.
  if played -> 'payload' ->> 'caught' is distinct from set_act::text or played -> 'payload' ? 'layer' then raise exception 'a caught cast: %', played; end if;
  if played -> 'sprung' -> 'payload' ->> 'card' is distinct from 'snare' or played -> 'sprung' -> 'payload' ->> 'caught' is distinct from played ->> 'id'
     or played -> 'sprung' -> 'payload' ->> 'set' is distinct from set_act::text then
    raise exception 'the spring names the card, the play it caught and the set it ends: %', played -> 'sprung';
  end if;
  -- No response carries the amount or the setter's account.
  if played::text like '%' || ann || '%' or played::text like '%balance%' or played::text like '%wallet%'
     or (select array_agg(k order by k) from jsonb_object_keys(played -> 'sprung' -> 'payload') k) is distinct from array['by', 'card', 'caught', 'outcome', 'set', 'trigger'] then
    raise exception 'the caster''s answer carries the payout: %', played;
  end if;
  -- Spent all the same: the caster's ledger and wallet, and the setter's wallet by exactly the price, capped at the cap.
  select price into caught_ledger from card_ledger where account = bob and act = (played ->> 'id')::uuid and kind = 'played';
  if caught_ledger is distinct from 75 then raise exception 'the caught play is in the caster''s ledger at its price: %', caught_ledger; end if;
  if (select balance from wallets where account = bob) is distinct from 225 then raise exception 'the caster paid the play''s price'; end if;
  if (select change from wallet_events where account = ann and kind = 'trap') is distinct from 10
     or (select overflow from wallet_events where account = ann and kind = 'trap') is distinct from 65
     or (select ref from wallet_events where account = ann and kind = 'trap') is distinct from (played -> 'sprung' ->> 'id')::uuid then
    raise exception 'the payout is the play''s price, capped at the cap, recorded as the spring''s: %', (select jsonb_agg(to_jsonb(w)) from wallet_events w where w.account = ann);
  end if;
  if (select balance from wallets where account = ann) is distinct from 600 then raise exception 'the setter''s wallet is at the cap'; end if;
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

-- ---- The rarity bound, a Bluff, a trap on another trigger, and an ended trap: the cast lands, and the reads are alike ----
do $$
declare
  ann uuid := tests.account('pass-ann');
  bob uuid := tests.account('pass-bob');
  a uuid := tests.character(ann, 'Setter Of Many');
  b uuid := tests.character(bob, 'Big Caster');
  t uuid := tests.thread();
  p_low uuid := tests.post(a, t, 'A common trap.');
  p_bluff uuid := tests.post(a, t, 'A bluff.');
  p_hook uuid := tests.post(a, t, 'A reply trap.');
  p_old uuid := tests.post(a, t, 'An ended trap.');
  played jsonb;
  set_old uuid;
  reads_bluff jsonb;
  reads_hook jsonb;
  before jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'snare', 'bluffy', 'hook');
  perform pg_temp.hand(bob, 'grandie', 'sweetie', 'sweetie', 'sweetie');
  perform tests.become_service();
  perform set_card(ann, 'snare', a, p_low, '{}', 0);
  perform set_card(ann, 'bluffy', a, p_bluff, '{}', 0);
  perform set_card(ann, 'hook', a, p_hook, '{}', 0);
  perform tests.unbecome();
  -- A trap set eight days ago, ended a day since: written as set_card would have written it then.
  set_old := tests.act(a, 'set', t, '{}', p_old, now() - interval '8 days');
  insert into face_down (play, account, card, post, thread, round, ends_at) values (set_old, ann, 'catcher', p_old, t, 1, now() - interval '1 day');
  perform tests.become_service();
  -- A legendary passes over an uncommon trap, which stays set.
  played := play_card(bob, 'grandie', b, p_low, '{}', 0, '');
  if played ? 'sprung' or played -> 'payload' ? 'caught' then raise exception 'a legendary was caught by an uncommon trap: %', played; end if;
  if (card_target(p_low) -> 'effects' -> 0 ->> 'ends')::timestamptz <= now() then raise exception 'the passed-over trap is no longer set'; end if;
  -- A Bluff, a trap waiting on a reply and an ended trap leave a cast untouched.
  foreach before in array array[to_jsonb(p_bluff), to_jsonb(p_hook), to_jsonb(p_old)] loop
    played := play_card(bob, 'sweetie', b, (before #>> '{}')::uuid, '{}', 0, '');
    if played ? 'sprung' or played -> 'payload' ? 'caught' then raise exception 'a cast was caught by no cast trap: %', played; end if;
  end loop;
  if exists (select 1 from acts where kind = 'spring' and target_act_id in (p_low, p_bluff, p_hook, p_old)) then raise exception 'something sprang'; end if;
  perform tests.unbecome();
  -- The same reads for a Bluff as for a trap waiting on another trigger: each table read the same number of times, the same way.
  before := (select jsonb_object_agg(relname, jsonb_build_array(seq_scan, idx_scan)) from pg_stat_xact_user_tables where relname in ('face_down', 'card_kinds', 'acts'));
  perform spring_traps('cast', p_bluff, gen_random_uuid(), null, 'common', bob, 0);
  reads_bluff := (select jsonb_object_agg(relname, jsonb_build_array(seq_scan - (before -> relname ->> 0)::bigint, idx_scan - (before -> relname ->> 1)::bigint)) from pg_stat_xact_user_tables where relname in ('face_down', 'card_kinds', 'acts'));
  before := (select jsonb_object_agg(relname, jsonb_build_array(seq_scan, idx_scan)) from pg_stat_xact_user_tables where relname in ('face_down', 'card_kinds', 'acts'));
  perform spring_traps('cast', p_hook, gen_random_uuid(), null, 'common', bob, 0);
  reads_hook := (select jsonb_object_agg(relname, jsonb_build_array(seq_scan - (before -> relname ->> 0)::bigint, idx_scan - (before -> relname ->> 1)::bigint)) from pg_stat_xact_user_tables where relname in ('face_down', 'card_kinds', 'acts'));
  if reads_bluff is distinct from reads_hook then raise exception 'a Bluff and a waiting trap read differently: % / %', reads_bluff, reads_hook; end if;
end $$;

-- ---- Each trigger springs its trap once, and only once, and never refuses the write ----
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
  perform pg_temp.hand(ann, 'catcher', 'jumpy', 'quoter', 'hook');
  perform pg_temp.hand(bob, 'sweetie', 'sweetie');
  perform tests.become_service();
  perform set_card(ann, 'catcher', a, p_cast, '{}', 0);
  perform set_card(ann, 'jumpy', a, p_react, '{}', 0);
  perform set_card(ann, 'quoter', a, p_quote, '{}', 0);
  perform set_card(ann, 'hook', a, p_reply, '{"color": "green"}', 0);
  -- cast
  answer := play_card(bob, 'sweetie', b, p_cast, '{}', 0, '');
  if answer -> 'sprung' -> 'payload' ->> 'trigger' is distinct from 'cast' then raise exception 'a cast trap on a cast: %', answer; end if;
  perform tests.unbecome();
  -- reaction: one of another quadrant does nothing, the trap's own quadrant springs it, and a second reaction does not again.
  perform tests.become(bob);
  answer := react(p_react, b, 'up');
  if answer ? 'sprung' then raise exception 'a reaction of another quadrant sprang a trap: %', answer; end if;
  answer := react(p_react, b, 'meh');
  if answer -> 'sprung' -> 'payload' ->> 'trigger' is distinct from 'reaction' or answer -> 'sprung' -> 'payload' ? 'caught' then raise exception 'a reaction trap: %', answer; end if;
  if answer -> 'tally' ->> 'meh' is distinct from '1' then raise exception 'the reaction that sprang a trap landed: %', answer; end if;
  answer := react(p_react, b, 'calm');
  if answer ? 'sprung' then raise exception 'a reaction trap sprang twice'; end if;
  -- quote: a post quoting it springs it, and strikes its card on the quoting post.
  answer := post(t, b, 'As you said.', p_quote);
  if answer -> 'sprung' -> 'payload' ->> 'trigger' is distinct from 'quote' then raise exception 'a quote trap: %', answer; end if;
  if not exists (select 1 from acts k where k.kind = 'card' and k.target_act_id = (answer ->> 'id')::uuid and k.payload ->> 'card' = 'sweetie' and k.character = a
                   and k.payload ->> 'spring' = answer -> 'sprung' ->> 'id') then
    raise exception 'a quote trap''s strike laid its card on the quoting post';
  end if;
  if answer -> 'sprung' -> 'struck' ->> 'target_act_id' is distinct from answer ->> 'id' or answer -> 'sprung' -> 'struck' -> 'payload' ->> 'card' is distinct from 'sweetie' then
    raise exception 'the answer carries the struck card''s play, to be sent live: %', answer -> 'sprung';
  end if;
  answer := post(t, b, 'And again.', p_quote);
  if answer ? 'sprung' then raise exception 'a quote trap sprang twice'; end if;
  perform tests.unbecome();
  -- reply: its own author's post does not spring it; another character's does, once, laying a seeded Blot with the setter's ink.
  perform tests.become(ann);
  answer := post(t2, a, 'Me again.');
  if answer ? 'sprung' then raise exception 'a reply trap sprang on its own author''s post'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  reply := post(t2, b, 'A reply.');
  if reply -> 'sprung' -> 'payload' ->> 'trigger' is distinct from 'reply' then raise exception 'a reply trap: %', reply; end if;
  if not exists (select 1 from acts k where k.kind = 'card' and k.target_act_id = (reply ->> 'id')::uuid and k.payload ->> 'card' = 'blot'
                   and k.payload -> 'config' ->> 'color' = 'green' and jsonb_typeof(k.payload -> 'seed') = 'number' and (k.payload ->> 'layer')::integer = 1) then
    raise exception 'a reply trap''s strike laid a seeded Blot in the setter''s ink on the reply';
  end if;
  answer := post(t2, b, 'Another reply.');
  if answer ? 'sprung' then raise exception 'a reply trap sprang twice'; end if;
  perform tests.unbecome();
  if (select count(*) from acts where kind = 'spring' and target_act_id in (p_cast, p_react, p_quote, p_reply)) is distinct from 4::bigint then
    raise exception 'each trigger sprang its trap once: %', (select count(*) from acts where kind = 'spring' and target_act_id in (p_cast, p_react, p_quote, p_reply));
  end if;
  -- A spring is no post: it takes no place and counts nowhere.
  if exists (select 1 from acts where kind = 'spring' and seq is not null) then raise exception 'a spring took a place in its thread'; end if;
end $$;

-- ---- A strike that cannot land leaves the trap set ----
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
  perform pg_temp.hand(ann, 'quoter', 'sweetie');
  perform tests.become_service();
  perform set_card(ann, 'quoter', a, p, '{}', 0);
  perform play_card(ann, 'sweetie', a, q, '{}', 0, '');
  perform tests.unbecome();
  -- q carries its one Sweetie, the most it takes: a quote from q springs nothing, and the trap stays set.
  if spring_traps('quote', p, q) is not null then raise exception 'a strike onto a full stack sprang'; end if;
  if exists (select 1 from acts where kind = 'spring' and target_act_id = p) then raise exception 'a strike onto a full stack wrote a spring'; end if;
  if (card_target(p) -> 'effects' -> 0 ->> 'ends')::timestamptz <= now() then raise exception 'the trap is no longer set'; end if;
end $$;

-- ---- The seed: the pairings instanceProblems refuses, refused naming the card ----
do $$
declare why text;
begin
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "reactions": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "priceSetting": "sweetie.price", "trap": {"trigger": {"on": "cast"}, "outcome": {"do": "nullify"}}, "rarity": "common"}]}')$s$);
  if why is distinct from 'card "seedling" has a trap, and only a Set card does' then raise exception 'a trap on a Cast seeded: %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "reactions": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "priceSetting": "sweetie.price"}]}')$s$);
  if why is distinct from 'card "seedling" has no rarity; a rarity is common, uncommon, rare or legendary' then raise exception 'a card with no rarity seeded: %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "reactions": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "priceSetting": "sweetie.price", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "reply"}, "outcome": {"do": "strike", "card": "nothing"}}}]}')$s$);
  if why is distinct from 'card "seedling" strikes with "nothing", which the instance does not have' then raise exception 'a strike of no card seeded: %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "reactions": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "priceSetting": "sweetie.price", "rarity": "common", "play": "use", "ward": true, "lasts": {"unit": "day", "count": 7}}]}')$s$);
  if why is not null then raise exception 'a ward was refused: %', why; end if;
  if (select lasts from card_kinds where key = 'seedling') is distinct from interval '7 days' or not (select ward from card_kinds where key = 'seedling') then raise exception 'the seed wrote the ward and its time up'; end if;
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
  insert into characters (name, staff, staff_kind, debuted_at) values ('Settle Boss', 'settle-boss', 'boss', now()) returning id into boss;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload) values (boss, 'post', t, '{"body": "A decree."}') returning id into decree;
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.become_service();
  perform set_card(ann, 'catcher', a, p, '{}', 0);
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
  perform set_card(ann, 'catcher', a, p_cast, '{}', 0);
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
  answer := post(t2, b, 'A reply.');
  if answer ? 'sprung' then raise exception 'a retired setter''s trap struck a reply: %', answer; end if;
  perform tests.unbecome();
end $$;

-- ---- The seed names the card for every pairing instanceProblems refuses, and a ward has a time up ----
do $$
declare why text;
begin
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "reactions": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "priceSetting": "sweetie.price", "rarity": "common", "play": "use", "ward": true}]}')$s$);
  if why is distinct from 'card "seedling" is a ward with no time up (lasts); a ward ends at its time' then raise exception 'a ward with no time up seeded: %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "reactions": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "priceSetting": "sweetie.price", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "reply"}, "outcome": {"do": "payout"}}}]}')$s$);
  if why is distinct from 'card "seedling" pays out on a reply; it pays out only on a cast, since only a cast is paid for' then raise exception 'a payout on a reply seeded: %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "reactions": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "priceSetting": "sweetie.price", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "sneeze"}, "outcome": {"do": "nullify"}}}]}')$s$);
  if why is distinct from 'card "seedling" springs on "sneeze"; a trap springs on cast, reaction, reply, quote, visit' then raise exception 'a trap on no trigger seeded: %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "reactions": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "priceSetting": "sweetie.price", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "cast"}, "outcome": {"do": "strike", "card": "sweetie"}}}]}')$s$);
  if why is distinct from 'card "seedling" strikes on a cast; a strike lays its card on a reply or a quote, until cards reach characters' then raise exception 'a strike on a cast seeded: %', why; end if;
  -- A struck card already in the table, rarer than the trap, is refused as one in the seed is.
  update card_kinds set rarity = 'legendary' where key = 'blot';
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "reactions": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "priceSetting": "sweetie.price", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "reply"}, "outcome": {"do": "strike", "card": "blot"}}}]}')$s$);
  if why is distinct from 'card "seedling" strikes with "blot", which is rarer than the trap (common)' then raise exception 'a strike of a rarer card in the table seeded: %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "reactions": [], "boards": [], "cards": [{"key": "seedling", "name": "Seedling", "alignment": "sweet", "priceSetting": "sweetie.price", "rarity": "common", "play": "use", "ward": true, "lasts": {"unit": "day", "count": "seven"}}]}')$s$);
  if why is distinct from 'card "seedling" lasts {"unit": "day", "count": "seven"}; it must be a span: a unit of day, week or month and a whole count from 1 to 1000' then raise exception 'a time up of no number seeded: %', why; end if;
  -- An invite's lifetime is still a span of days or more (0020), beside setLasts.
  why := pg_temp.refusal($s$insert into settings (key, value) values ('inviteLifetime', '{"unit": "minute", "count": 5}') on conflict (key) do update set value = excluded.value$s$);
  if why is distinct from 'inviteLifetime is a span: a unit of day, week or month and a whole count from 1 to 1000' then raise exception 'an invite lifetime in minutes: %', why; end if;
end $$;
