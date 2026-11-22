-- The concurrent case of a card that cuts (supabase/migrations/0405_cut.sql; docs/plans/2026-11-21-buzzkill-plan.md, Task 2, "The lock").
-- A cut of a Cheap Shot on a character and that Cheap Shot's spending cast, at once: place_cast locks the caster's live pierce rows, and a cut the named play's row too, in ONE statement in play order, so the two go one
-- after the other and neither deadlocks. Exactly one wins, and the other sees it: the cut landed and the cast carries no pierce, or the cast spent the pierce and the cut is refused for want of a Gimmick. Eight rounds,
-- each of fresh characters, committed (tests.commit), since a racer is a session of its own. Every name is this file's (bkr...).

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

do $$
declare
  rnd integer; ann uuid; bob uuid; a uuid; b uuid; t uuid; pa uuid; pb uuid; pierce uuid; said text[]; moved jsonb; cut_landed boolean; spent_by uuid;
  cut_wins integer := 0; cast_wins integer := 0;
begin
  perform tests.commit($sql$
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, gimmick, stack) values ('bkr-pierce', 'Bkr Pierce', 'pepperoni', 'uncommon', 'use', '{character}', interval '3 days', '{"kind": "pierce", "upTo": "uncommon"}', 1);
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, cuts, stack) values ('bkr-cut', 'Bkr Buzzkill', 'salty', 'rare', 'cast', '{post,character}', null, '{"upTo": "rare"}', 1);
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack) values ('bkr-move', 'Bkr Move', 'sweet', 'common', 'cast', '{post}', null, 8);
  $sql$);
  for rnd in 1..8 loop
    ann := gen_random_uuid(); bob := gen_random_uuid(); a := gen_random_uuid(); b := gen_random_uuid(); t := gen_random_uuid(); pa := gen_random_uuid(); pb := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into auth.users (id, email) values (%1$L, 'bkr-ann-%7$s@test.invalid'), (%2$L, 'bkr-bob-%7$s@test.invalid');
      insert into accounts (id, created_at) values (%1$L, '2000-01-01T00:00:00Z'), (%2$L, '2000-01-01T00:00:00Z');
      insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Bkr Ann %7$s', now(), now()), (%4$L, %2$L, 'Bkr Bob %7$s', now(), now());
      insert into class_history (character, class_key) values (%3$L, 'alpha'), (%4$L, 'alpha');
      insert into card_ledger (account, card, kind, price) values (%1$L, 'bkr-cut', 'bought', 0), (%2$L, 'bkr-pierce', 'bought', 0), (%2$L, 'bkr-move', 'bought', 0);
      insert into threads (id, board, title) select %5$L, b.id, 'Bkr thread %7$s' from boards b where b.slug = 'general';
      insert into acts (id, character, kind, thread, payload) values (%6$L, %3$L, 'post', %5$L, '{"body": "Ann''s post."}'), (%8$L, %4$L, 'post', %5$L, '{"body": "Bob''s post."}');
    $sql$, ann, bob, a, b, t, pa, rnd, pb));
    perform tests.commit(format($sql$
      do $d$ begin
      perform set_config('request.jwt.claims', '{"role": "service_role"}', true); perform set_config('role', 'service_role', true);
      perform play_card(%1$L, 'bkr-pierce', %2$L, %2$L, '{}', 0, '', 'character', %3$L);
    end $d$;
    $sql$, bob, b, pb));
    select k.id into pierce from acts k where k.character = b and k.payload ->> 'card' = 'bkr-pierce';
    perform pg_temp.expect(not card_ended(pierce), 'the round''s pierce is not live');

    said := tests.race_service(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'bkr-cut', a, b, jsonb_build_object('play', pierce), '', 'character', pb),
                               format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'bkr-move', b, pa, '{}', ''));
    -- The cast is never refused; the cut is refused only for want of a Gimmick (the pierce was spent first). No deadlock, no other error.
    perform pg_temp.expect(said[2] is null, format('round %s: the spending cast said %s', rnd, said[2]));
    perform pg_temp.expect(said[1] is null or said[1] like '%there''s no Gimmick up on this character for Bkr Buzzkill to end', format('round %s: the cut said %s', rnd, said[1]));
    cut_landed := exists (select 1 from acts c where c.kind = 'card' and c.character = a and c.payload ->> 'card' = 'bkr-cut' and c.payload #>> '{cut,play}' = pierce::text);
    select (c.payload #>> '{pierce,by}')::uuid into spent_by from acts c where c.kind = 'card' and c.character = b and c.payload ->> 'card' = 'bkr-move' and c.target_act_id = pa;
    perform pg_temp.expect(cut_landed = (spent_by is null) and cut_landed = (said[1] is null), format('round %s: one winner expected; cut landed %s, cast spent %s, cut said %s', rnd, cut_landed, spent_by, said[1]));
    perform pg_temp.expect(card_ended(pierce), format('round %s: the pierce is still live', rnd));
    if cut_landed then cut_wins := cut_wins + 1; else cast_wins := cast_wins + 1; end if;
  end loop;
  raise notice 'cut wins %, cast wins %', cut_wins, cast_wins;
end $$;
