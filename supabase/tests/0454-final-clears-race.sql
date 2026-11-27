-- Two casts raced for the place a final clear gave up (supabase/migrations/0454_final_clears.sql; docs/plans/2026-11-27-lasting-gags-plan.md, Task 2).
-- A card that clears for good, one deep in its stack: its play on a post has just been cleared for every version, so its place is free. place_cast counts the stack after taking the post's row, and the first cast's play
-- is written inside its transaction, so the second cast, which waited on the row, counts it and is refused: exactly one of two casts of the card at the post lands, the other is refused in the words, and the post
-- holds one play of it not cleared. Eight rounds, each of fresh characters, committed (tests.commit), since a racer is a session of its own. Every name is this file's (fgr...).

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

do $$
declare
  rnd integer; ann uuid; bob uuid; cat uuid; a uuid; b uuid; c uuid; t uuid; p uuid; first_play uuid; said text[]; landed integer;
  words constant text := 'this post already carries that card';
begin
  perform tests.commit($sql$
    insert into settings (key, value) values ('postEffects', '4') on conflict (key) do update set value = excluded.value;
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, draws_effect, clears_for_good) values
      ('fgr-final', 'Fgr Final', 'salty', 'common', 'cast', '{post}', null, 1, true, true);
  $sql$);
  for rnd in 1..8 loop
    ann := gen_random_uuid(); bob := gen_random_uuid(); cat := gen_random_uuid(); a := gen_random_uuid(); b := gen_random_uuid(); c := gen_random_uuid(); t := gen_random_uuid(); p := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into auth.users (id, email) values (%1$L, 'fgr-ann-%8$s@test.invalid'), (%2$L, 'fgr-bob-%8$s@test.invalid'), (%3$L, 'fgr-cat-%8$s@test.invalid');
      insert into accounts (id, created_at) values (%1$L, '2000-01-01T00:00:00Z'), (%2$L, '2000-01-01T00:00:00Z'), (%3$L, '2000-01-01T00:00:00Z');
      insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'Fgr Ann %8$s', now(), now()), (%5$L, %2$L, 'Fgr Bob %8$s', now(), now()), (%6$L, %3$L, 'Fgr Cat %8$s', now(), now());
      insert into class_history (character, class_key) values (%4$L, 'alpha'), (%5$L, 'alpha'), (%6$L, 'alpha');
      insert into card_ledger (account, card, kind, price) values (%1$L, 'fgr-final', 'bought', 0), (%2$L, 'fgr-final', 'bought', 0), (%3$L, 'fgr-final', 'bought', 0);
      insert into threads (id, board, title) select %7$L, b.id, 'Fgr thread %8$s' from boards b where b.slug = 'general';
      insert into acts (id, character, kind, thread, payload) values (%9$L, %4$L, 'post', %7$L, '{"body": "A post whose card was just cleared."}');
    $sql$, ann, bob, cat, a, b, c, t, rnd, p));
    -- The post's own character plays the card, then clears it for every version: the card's one place is free.
    perform tests.commit(format($sql$
      do $d$ begin
        perform set_config('request.jwt.claims', '{"role": "service_role"}', true); perform set_config('role', 'service_role', true);
        perform play_card(%1$L, 'fgr-final', %2$L, %3$L, '{}', 0, '');
        perform save_effect_state(%1$L, %2$L, (select k.id from acts k where k.kind = 'card' and k.target_act_id = %3$L), '{"clean": true}', true, null);
      end $d$;
    $sql$, ann, a, p));
    select k.id into first_play from acts k where k.kind = 'card' and k.target_act_id = p and k.payload ->> 'card' = 'fgr-final';
    perform pg_temp.expect((select e.cleared and e.cleared_for is null from effect_state e where e.play = first_play), format('round %s: the first play is not cleared for good', rnd));

    said := tests.race_service(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'fgr-final', b, p, '{}', ''),
                               format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cat, 'fgr-final', c, p, '{}', ''));
    select count(*) into landed from acts k where k.kind = 'card' and k.target_act_id = p and k.payload ->> 'card' = 'fgr-final' and k.id <> first_play;
    perform pg_temp.expect(landed = 1, format('round %s: %s of the two casts landed (said %s)', rnd, landed, said));
    perform pg_temp.expect((said[1] is null) <> (said[2] is null), format('round %s: exactly one cast is refused (said %s)', rnd, said));
    perform pg_temp.expect(coalesce(said[1], said[2]) = words, format('round %s: the refusal is not the words: %s', rnd, coalesce(said[1], said[2])));
    perform pg_temp.expect((select max((k.payload ->> 'layer')::integer) from acts k where k.kind = 'card' and k.target_act_id = p) = 2, format('round %s: the landed play did not take layer 2', rnd));
  end loop;
end $$;

-- Two saves of one play raced, one clearing it for good and one saving a partial state (save_effect_state, same migration). Without a row lock between its "already cleared for good?" check and its upsert, the partial save
-- reads the play as not yet cleared (the clear is uncommitted), waits on the effect_state row, and overwrites the clear when it lands, so the clear is not final. The clearing save is held open after its write
-- (pg_sleep) and the partial one starts after it has written (a shorter sleep), so the window is the same every round: the partial save sits inside it. With the post's row locked first, the partial save waits there, then
-- reads the clear and is refused in the words, or it ran first and the clear came after. Either way the play stays cleared for good. Three rounds, each of fresh characters, committed.
do $$
declare
  rnd integer; ann uuid; a uuid; t uuid; p uuid; the_play uuid; said text[];
  words constant text := 'that effect was cleared for good, and stays cleared';
begin
  for rnd in 1..3 loop
    ann := gen_random_uuid(); a := gen_random_uuid(); t := gen_random_uuid(); p := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into auth.users (id, email) values (%1$L, 'fgs-ann-%4$s@test.invalid');
      insert into accounts (id, created_at) values (%1$L, '2000-01-01T00:00:00Z');
      insert into characters (id, owner, name, created_at, debuted_at) values (%2$L, %1$L, 'Fgs Ann %4$s', now(), now());
      insert into class_history (character, class_key) values (%2$L, 'alpha');
      insert into card_ledger (account, card, kind, price) values (%1$L, 'fgr-final', 'bought', 0);
      insert into threads (id, board, title) select %3$L, b.id, 'Fgs thread %4$s' from boards b where b.slug = 'general';
      insert into acts (id, character, kind, thread, payload) values (%5$L, %2$L, 'post', %3$L, '{"body": "A post whose clear is raced."}');
    $sql$, ann, a, t, rnd, p));
    perform tests.commit(format($sql$
      do $d$ begin
        perform set_config('request.jwt.claims', '{"role": "service_role"}', true); perform set_config('role', 'service_role', true);
        perform play_card(%1$L, 'fgr-final', %2$L, %3$L, '{}', 0, '');
      end $d$;
    $sql$, ann, a, p));
    select k.id into the_play from acts k where k.kind = 'card' and k.target_act_id = p and k.payload ->> 'card' = 'fgr-final';
    said := tests.race_service(
      format('do $d$ begin perform save_effect_state(%L, %L, %L, %L, true, null); perform pg_sleep(2); end $d$', ann, a, the_play, '{"clean": true}'),
      format('do $d$ begin perform pg_sleep(0.7); perform save_effect_state(%L, %L, %L, %L, false, null); end $d$', ann, a, the_play, '{"clean": false}'));
    perform pg_temp.expect(said[1] is null, format('round %s: the clearing save was refused: %s', rnd, said[1]));
    perform pg_temp.expect(said[2] is null or said[2] = words, format('round %s: the partial save met another refusal: %s', rnd, said[2]));
    perform pg_temp.expect((select e.cleared and e.cleared_for is null and e.state = '{"clean": true}' from effect_state e where e.play = the_play),
      format('round %s: the clear was overwritten by the racing save (said %s)', rnd, said));
    perform pg_temp.expect(said[2] = words, format('round %s: the partial save, started after the clear was written, was not refused in the words (said %s)', rnd, said));
  end loop;
end $$;
