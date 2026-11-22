-- Two casts raced for a post's last slot (supabase/migrations/0410_post_effects.sql; docs/plans/2026-11-21-post-plays-plan.md, Task 10, "Where it is held").
-- place_cast reads post_effects_up after taking the post's row, and a play's own row (play_post) is written by the trigger inside the cast's transaction, so the second cast, which waited on the row, reads the first's play
-- and is refused. A post holds one drawing play of two; two drawing casts of two characters at once: exactly one lands, the other is refused in the words, and the post holds two. Eight rounds, each of fresh characters,
-- committed (tests.commit), since a racer is a session of its own. Every name is this file's (pex...).

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

do $$
declare
  rnd integer; ann uuid; bob uuid; cat uuid; a uuid; b uuid; c uuid; t uuid; p uuid; first_play uuid; said text[]; landed integer;
  words constant text := 'this post already shows 2 effects, the most it takes. A slot opens when one ends, is ended by an admin, or its author clears it';
begin
  perform tests.commit($sql$
    insert into settings (key, value) values ('postEffects', '2') on conflict (key) do update set value = excluded.value;
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, draws_effect) values
      ('pex-first', 'Pex First', 'salty', 'common', 'cast', '{post}', null, 3, true),
      ('pex-left', 'Pex Left', 'sweet', 'common', 'cast', '{post}', null, 3, true),
      ('pex-right', 'Pex Right', 'salty', 'common', 'cast', '{post}', null, 3, true);
  $sql$);
  for rnd in 1..8 loop
    ann := gen_random_uuid(); bob := gen_random_uuid(); cat := gen_random_uuid(); a := gen_random_uuid(); b := gen_random_uuid(); c := gen_random_uuid(); t := gen_random_uuid(); p := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into auth.users (id, email) values (%1$L, 'pex-ann-%8$s@test.invalid'), (%2$L, 'pex-bob-%8$s@test.invalid'), (%3$L, 'pex-cat-%8$s@test.invalid');
      insert into accounts (id, created_at) values (%1$L, '2000-01-01T00:00:00Z'), (%2$L, '2000-01-01T00:00:00Z'), (%3$L, '2000-01-01T00:00:00Z');
      insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'Pex Ann %8$s', now(), now()), (%5$L, %2$L, 'Pex Bob %8$s', now(), now()), (%6$L, %3$L, 'Pex Cat %8$s', now(), now());
      insert into class_history (character, class_key) values (%4$L, 'alpha'), (%5$L, 'alpha'), (%6$L, 'alpha');
      insert into card_ledger (account, card, kind, price) values (%1$L, 'pex-first', 'bought', 0), (%2$L, 'pex-left', 'bought', 0), (%3$L, 'pex-right', 'bought', 0);
      insert into threads (id, board, title) select %7$L, b.id, 'Pex thread %8$s' from boards b where b.slug = 'general';
      insert into acts (id, character, kind, thread, payload) values (%9$L, %4$L, 'post', %7$L, '{"body": "A post with one slot left."}');
    $sql$, ann, bob, cat, a, b, c, t, rnd, p));
    -- One drawing play already in force; the post has one slot left. A post's own character may cast on it.
    perform tests.commit(format($sql$
      do $d$ begin
        perform set_config('request.jwt.claims', '{"role": "service_role"}', true); perform set_config('role', 'service_role', true);
        perform play_card(%1$L, 'pex-first', %2$L, %3$L, '{}', 0, '');
      end $d$;
    $sql$, ann, a, p));
    select k.id into first_play from acts k where k.kind = 'card' and k.target_act_id = p and k.payload ->> 'card' = 'pex-first';
    perform pg_temp.expect(post_effects_up(p) = 1, format('round %s: the post''s first play does not count one', rnd));

    said := tests.race_service(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'pex-left', b, p, '{}', ''),
                               format('select play_card(%L, %L, %L, %L, %L, 0, %L)', cat, 'pex-right', c, p, '{}', ''));
    select count(*) into landed from acts k where k.kind = 'card' and k.target_act_id = p and k.payload ->> 'card' in ('pex-left', 'pex-right');
    perform pg_temp.expect(landed = 1, format('round %s: %s of the two casts landed (said %s)', rnd, landed, said));
    perform pg_temp.expect((said[1] is null) <> (said[2] is null), format('round %s: exactly one cast is refused (said %s)', rnd, said));
    perform pg_temp.expect(coalesce(said[1], said[2]) = words, format('round %s: the refusal is not the words: %s', rnd, coalesce(said[1], said[2])));
    perform pg_temp.expect(post_effects_up(p) = 2, format('round %s: the post holds %s', rnd, post_effects_up(p)));
  end loop;
end $$;
