-- Two sessions at one present (supabase/migrations/0457_gift_boxes.sql; docs/plans/2026-11-27-season-two-cards-plan.md, Task 5).
-- open_gift locks the opener's account, the post, the box's Act and its gift_box row, in that order, and reverse_card takes the box's Act and then the row, so:
--   * two opens at once: the one that took the row first lands the gift, the other is refused as an open of an opened box; one open Act, one gift play.
--   * an open and an admin's end at once: exactly one of them wins. The box has one end Act (an open_gift or a card_end), never both; a gift lands only where the open won, and goes back to the giver only where the end won.
-- Four rounds of each, each of fresh characters, committed (tests.commit), since a racer is a session of its own. Every name is this file's (gbr...).

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

do $$
declare
  rnd integer; kind text; ann uuid; bob uuid; boss uuid; a uuid; b uuid; t uuid; p uuid; bx uuid; said text[]; ends integer; landed integer; returned integer; words constant text := 'this present was already opened or ended';
begin
  perform tests.commit($sql$
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, draws_effect, wraps) values
      ('gbr-box', 'Gbr Present', 'sweet', 'uncommon', 'cast', '{post}', null, 1, false, true),
      ('gbr-move', 'Gbr Move', 'salty', 'common', 'cast', '{post}', null, 3, false, false);
  $sql$);
  for rnd in 1..8 loop
    kind := case when rnd <= 4 then 'open-open' else 'open-end' end;
    ann := gen_random_uuid(); bob := gen_random_uuid(); boss := gen_random_uuid(); a := gen_random_uuid(); b := gen_random_uuid(); t := gen_random_uuid(); p := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into auth.users (id, email) values (%1$L, 'gbr-ann-%7$s@test.invalid'), (%2$L, 'gbr-bob-%7$s@test.invalid'), (%3$L, 'gbr-boss-%7$s@test.invalid');
      insert into accounts (id, created_at) values (%1$L, '2000-01-01T00:00:00Z'), (%2$L, '2000-01-01T00:00:00Z'), (%3$L, '2000-01-01T00:00:00Z');
      insert into admins (account) values (%3$L);
      insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'Gbr Ann %7$s', now(), now()), (%5$L, %2$L, 'Gbr Bob %7$s', now(), now());
      insert into class_history (character, class_key) values (%4$L, 'alpha'), (%5$L, 'alpha');
      insert into card_ledger (account, card, kind, price) values (%1$L, 'gbr-box', 'bought', 0), (%1$L, 'gbr-move', 'bought', 0);
      insert into wallets (account, balance) values (%1$L, 600) on conflict (account) do update set balance = excluded.balance;
      insert into threads (id, board, title) select %6$L, bd.id, 'Gbr thread %7$s' from boards bd where bd.slug = 'general';
      insert into acts (id, character, kind, thread, payload) values (%8$L, %5$L, 'post', %6$L, '{"body": "A post that gets a present."}');
    $sql$, ann, bob, boss, a, b, t, rnd, p));
    perform tests.commit(format($sql$
      do $d$ begin
        perform set_config('request.jwt.claims', '{"role": "service_role"}', true); perform set_config('role', 'service_role', true);
        perform play_card(%1$L, 'gbr-box', %2$L, %3$L, '{}', 150, '', 'post', null, null, null, null, '{}', null, 'gbr-move', '{}', 0);
      end $d$;
    $sql$, ann, a, p));
    select k.id into bx from acts k where k.kind = 'card' and k.target_act_id = p and k.payload ->> 'card' = 'gbr-box';
    perform pg_temp.expect(bx is not null and exists (select 1 from gift_box g where g.box = bx), format('round %s: the box was not wrapped', rnd));

    if kind = 'open-open' then
      said := tests.race_service(format('select open_gift(%L, %L)', bob, bx), format('select open_gift(%L, %L)', bob, bx));
      perform pg_temp.expect((said[1] is null) <> (said[2] is null), format('round %s: exactly one open is refused (said %s)', rnd, said));
      perform pg_temp.expect(coalesce(said[1], said[2]) = words, format('round %s: the refusal is not the words: %s', rnd, coalesce(said[1], said[2])));
    else
      said := tests.race_as(boss, format('select reverse_card(%L)', bx), null, format('select open_gift(%L, %L)', bob, bx));
      perform pg_temp.expect((said[1] is null) <> (said[2] is null), format('round %s: exactly one of the end and the open wins (said %s)', rnd, said));
    end if;
    select count(*) into ends from acts e where e.kind in ('card_end', 'open_gift') and e.target_act_id = bx;
    select count(*) into landed from acts k where k.kind = 'card' and k.target_act_id = p and k.payload ->> 'card' = 'gbr-move';
    select count(*) into returned from card_ledger l where l.account = ann and l.card = 'gbr-move' and l.kind = 'returned';
    perform pg_temp.expect(ends = 1, format('round %s: the box has %s end Acts', rnd, ends));
    if kind = 'open-open' then
      perform pg_temp.expect(landed = 1 and returned = 0, format('round %s: %s gifts landed and %s returned', rnd, landed, returned));
    else
      -- The open won (a gift landed, nothing returned) or the end won (no gift, one returned): never both, never neither.
      perform pg_temp.expect((landed = 1 and returned = 0) or (landed = 0 and returned = 1), format('round %s: %s gifts landed and %s returned', rnd, landed, returned));
    end if;
  end loop;
end $$;
