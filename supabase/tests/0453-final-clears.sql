-- A clear that is final holds no place in its stack (supabase/migrations/0453_final_clears.sql; docs/plans/2026-11-27-lasting-gags-plan.md, Task 2; design docs/plans/2026-11-27-lasting-gags-design.md, sections 2.4 and 4).
-- A card that draws an effect and clears for good (card_kinds.clears_for_good), one deep in its stack, against a card that draws and does not:
--   * the column exists; seed_instance writes it from the seed's clearsForGood.
--   * A second cast of the final card is refused while the first is uncleared; once its author's save clears it for every version, a second lands and takes the next layer.
--   * A play cleared for one version of the post only still holds its place.
--   * The same cleared play of the plain card still refuses a second.
--   * A later save on the final card's cleared play is refused in the words; a save on the plain card's cleared play is kept.
--   * spring_facts: a Move of the final card springs onto a post whose play of it is cleared for good (up is 0), and not onto one whose play is uncleared; the plain card does not spring there either.
-- The cards are this file's own (fg...). The race is 0453-final-clears-race.sql.

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k, generate_series(1, 12)
$$;

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.cast_of(who uuid, card text, through uuid, target uuid, out id uuid, out said text) language plpgsql as $$
begin
  perform tests.become_service();
  begin
    id := (play_card(who, card, through, target, '{}', 0, '') ->> 'id')::uuid;
  exception when others then
    said := sqlstate || ' ' || sqlerrm;
  end;
  perform tests.unbecome();
end $$;

create function pg_temp.save_of(who uuid, through uuid, play uuid, state jsonb, cleared boolean, cleared_for uuid) returns text language plpgsql as $$
declare said text;
begin
  perform tests.become_service();
  said := pg_temp.coded(format('select save_effect_state(%L, %L, %L, %L, %L, %L)', who, through, play, state, cleared, cleared_for));
  perform tests.unbecome();
  return said;
end $$;

-- ---- The catalog: the column ----
select tests.unbecome();
do $$
begin
  perform pg_temp.expect(exists (select 1 from information_schema.columns where table_name = 'card_kinds' and column_name = 'clears_for_good' and is_nullable = 'NO' and column_default = 'false'), 'card_kinds has no clears_for_good boolean not null default false');
end $$;

-- ---- The fixture ----
create temp table fg_fix (label text primary key, id uuid not null);
create function pg_temp.fix(l text) returns uuid language sql as $$ select id from fg_fix where label = l $$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('fg-ann'); bob uuid := tests.account('fg-bob'); cat uuid := tests.account('fg-cat'); dan uuid := tests.account('fg-dan');
  a uuid := tests.character(ann, 'Fg Ann'); b uuid := tests.character(bob, 'Fg Bob'); c uuid := tests.character(cat, 'Fg Cat'); d uuid := tests.character(dan, 'Fg Dan');
  t uuid := tests.thread('Fg thread');
begin
  insert into settings (key, value) values ('postEffects', '4') on conflict (key) do update set value = excluded.value;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, draws_effect, clears_for_good) values
    ('fgfinal', 'Fg Final', 'salty', 'common', 'cast', '{post}', null, 1, true, true),
    ('fgplain', 'Fg Plain', 'sweet', 'common', 'cast', '{post}', null, 1, true, false),
    ('fgdeep', 'Fg Deep', 'salty', 'common', 'cast', '{post}', null, 2, true, true);
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, draws_effect, clears_for_good) values
    ('fgmove', 'Fg Move', 'salty', 'uncommon', 'cast', null, '{post}', null, true, true),
    ('fgmoveplain', 'Fg Move Plain', 'salty', 'uncommon', 'cast', null, '{post}', null, true, false);
  perform pg_temp.hand(bob, 'fgfinal', 'fgplain', 'fgdeep', 'fgmove', 'fgmoveplain');
  perform pg_temp.hand(cat, 'fgfinal', 'fgplain', 'fgdeep', 'fgmove', 'fgmoveplain');
  perform pg_temp.hand(dan, 'fgfinal', 'fgplain', 'fgdeep', 'fgmove', 'fgmoveplain');
  perform pg_temp.hand(ann, 'fgmove', 'fgmoveplain');
  insert into fg_fix values ('ann', ann), ('bob', bob), ('cat', cat), ('dan', dan), ('a', a), ('b', b), ('c', c), ('d', d), ('t', t);
end $$;

-- ---- A final card: refused while uncleared, a second lands once cleared, its layer the next ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); cat uuid := pg_temp.fix('cat'); dan uuid := pg_temp.fix('dan');
  a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); c uuid := pg_temp.fix('c'); d uuid := pg_temp.fix('d'); t uuid := pg_temp.fix('t');
  p uuid := tests.post(a, t, 'A post for a final card.'); first_play uuid; second_play uuid; r record; said text;
begin
  r := pg_temp.cast_of(bob, 'fgfinal', b, p); perform pg_temp.expect(r.said is null, format('the first cast was refused: %s', r.said)); first_play := r.id;
  r := pg_temp.cast_of(cat, 'fgfinal', c, p); perform pg_temp.expect(r.said = '23505 this post already carries that card', format('a second cast on an uncleared play is not refused: %s', r.said));
  -- Cleared for one version only: still its place.
  said := pg_temp.save_of(ann, a, first_play, '{"clean": true}', true, p);
  perform pg_temp.expect(said is null, format('a save cleared for a version was refused: %s', said));
  r := pg_temp.cast_of(cat, 'fgfinal', c, p); perform pg_temp.expect(r.said = '23505 this post already carries that card', format('a play cleared for one version freed its place: %s', r.said));
  said := pg_temp.save_of(ann, a, first_play, '{"clean": false}', false, null);
  perform pg_temp.expect(said is null, format('an uncleared save was refused: %s', said));
  -- Cleared for good.
  said := pg_temp.save_of(ann, a, first_play, '{"clean": true}', true, null);
  perform pg_temp.expect(said is null, format('the author''s clear was refused: %s', said));
  r := pg_temp.cast_of(cat, 'fgfinal', c, p); perform pg_temp.expect(r.said is null, format('a second cast was refused after the clear: %s', r.said)); second_play := r.id;
  perform pg_temp.expect((select (x.payload ->> 'layer')::integer from acts x where x.id = second_play) = 2, 'the second play did not take the next layer');
  perform pg_temp.expect((select (x.payload ->> 'layer')::integer from acts x where x.id = first_play) = 1, 'the first play lost its layer');
  -- The second is up, so a third is refused.
  r := pg_temp.cast_of(dan, 'fgfinal', d, p); perform pg_temp.expect(r.said = '23505 this post already carries that card', format('a third cast was not refused: %s', r.said));
  -- A later save on the cleared play is refused in the words; the new play can still be saved.
  said := pg_temp.save_of(ann, a, first_play, '{"clean": false}', false, null);
  perform pg_temp.expect(said = '55000 that effect was cleared for good, and stays cleared', format('a save on a play cleared for good was not refused in the words: %s', said));
  said := pg_temp.save_of(ann, a, first_play, '{"clean": true}', true, null);
  perform pg_temp.expect(said = '55000 that effect was cleared for good, and stays cleared', format('a clear saved again was not refused: %s', said));
  perform pg_temp.expect((select e.cleared and e.cleared_for is null and e.state = '{"clean": true}' from effect_state e where e.play = first_play), 'the refused save changed what was kept');
  said := pg_temp.save_of(ann, a, second_play, '{"clean": false}', false, null);
  perform pg_temp.expect(said is null, format('a save on the live play was refused: %s', said));
  -- Only the author meets it: a stranger is refused as ever.
  said := pg_temp.save_of(bob, b, first_play, '{"clean": false}', false, null);
  perform pg_temp.expect(said = '42501 only the post''s author saves what is on it', format('a stranger''s save met another refusal: %s', said));
  insert into fg_fix values ('p', p);
end $$;

-- ---- A deeper final card: the cleared play frees one place of two ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); cat uuid := pg_temp.fix('cat'); dan uuid := pg_temp.fix('dan');
  a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); c uuid := pg_temp.fix('c'); d uuid := pg_temp.fix('d'); t uuid := pg_temp.fix('t');
  p uuid := tests.post(a, t, 'A post for a deep final card.'); r record; one uuid; said text;
begin
  r := pg_temp.cast_of(bob, 'fgdeep', b, p); one := r.id; perform pg_temp.expect(r.said is null, format('deep one: %s', r.said));
  r := pg_temp.cast_of(cat, 'fgdeep', c, p); perform pg_temp.expect(r.said is null, format('deep two: %s', r.said));
  r := pg_temp.cast_of(dan, 'fgdeep', d, p); perform pg_temp.expect(r.said = '23505 this post already carries 2 of that card, the most it takes', format('deep three was not refused: %s', r.said));
  said := pg_temp.save_of(ann, a, one, '{"clean": true}', true, null);
  perform pg_temp.expect(said is null, format('deep one''s clear was refused: %s', said));
  r := pg_temp.cast_of(dan, 'fgdeep', d, p); perform pg_temp.expect(r.said is null, format('deep three was refused after one was cleared for good: %s', r.said));
  perform pg_temp.expect((select (x.payload ->> 'layer')::integer from acts x where x.id = r.id) = 3, 'the third deep play did not take layer 3');
end $$;

-- ---- The plain card: a cleared play still holds its place, and its save is kept ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); cat uuid := pg_temp.fix('cat');
  a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); c uuid := pg_temp.fix('c'); t uuid := pg_temp.fix('t');
  p uuid := tests.post(a, t, 'A post for a plain card.'); one uuid; r record; said text;
begin
  r := pg_temp.cast_of(bob, 'fgplain', b, p); one := r.id; perform pg_temp.expect(r.said is null, format('plain one: %s', r.said));
  said := pg_temp.save_of(ann, a, one, '{"clean": true}', true, null);
  perform pg_temp.expect(said is null, format('the plain card''s clear was refused: %s', said));
  r := pg_temp.cast_of(cat, 'fgplain', c, p); perform pg_temp.expect(r.said = '23505 this post already carries that card', format('a cleared play of the plain card freed its place: %s', r.said));
  said := pg_temp.save_of(ann, a, one, '{"clean": false}', false, null);
  perform pg_temp.expect(said is null, format('a later save on the plain card''s cleared play was refused: %s', said));
  perform pg_temp.expect((select not e.cleared and e.state = '{"clean": false}' from effect_state e where e.play = one), 'the plain card''s later save was not kept');
  -- A cleared one is saved again with no refusal.
  said := pg_temp.save_of(ann, a, one, '{"clean": true}', true, null);
  perform pg_temp.expect(said is null, format('the plain card''s clear, saved again, was refused: %s', said));
  said := pg_temp.save_of(ann, a, one, '{"clean": true, "again": 1}', true, null);
  perform pg_temp.expect(said is null, format('a save on the plain card''s cleared play was refused: %s', said));
end $$;

-- ---- spring_facts: a Move springs onto a post whose play of the same card is cleared for good ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); cat uuid := pg_temp.fix('cat');
  a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); c uuid := pg_temp.fix('c'); t uuid := pg_temp.fix('t');
  backed uuid := tests.post(a, t, 'The post that holds the Moves.'); quoting uuid := tests.post(b, t, 'A reply that quotes.');
  backed2 uuid := tests.post(a, t, 'The post that holds the plain Move.'); quoting2 uuid := tests.post(b, t, 'A reply that quotes, with a plain card.');
  s uuid; s2 uuid; r record; said jsonb; fd face_down; f spring_facts; one uuid; two uuid;
begin
  perform tests.become_service();
  s := (set_card(ann, 'fgmove', a, backed, '{}', 0) ->> 'id')::uuid;
  s2 := (set_card(ann, 'fgmoveplain', a, backed2, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  r := pg_temp.cast_of(cat, 'fgmove', c, quoting); one := r.id; perform pg_temp.expect(r.said is null, format('the move on the quoting post: %s', r.said));
  r := pg_temp.cast_of(cat, 'fgmoveplain', c, quoting2); two := r.id; perform pg_temp.expect(r.said is null, format('the plain move on the quoting post: %s', r.said));
  -- Uncleared: it has no room (stack 1), the back stays set.
  said := spring_traps('quote', backed, quoting);
  perform pg_temp.expect(said is null, format('a Move sprang onto a post that holds its card uncleared: %s', said));
  -- Cleared for good: facts say up is 0, the Move springs.
  perform tests.become_service();
  perform save_effect_state(bob, b, one, '{"clean": true}', true, null);
  perform tests.unbecome();
  select * into fd from face_down x where x.play = s;
  f := spring_facts(fd, 'quote', quoting, null);
  perform pg_temp.expect(f.up = 0, format('spring_facts counted a play cleared for good: up %s', f.up));
  perform pg_temp.expect(f.layer = 2, format('spring_facts took layer %s, not the next one', f.layer));
  said := spring_traps('quote', backed, quoting);
  perform pg_temp.expect(said is not null, 'a Move did not spring onto a post whose play of it is cleared for good');
  -- The plain card, cleared, still holds its place: no spring.
  perform tests.become_service();
  perform save_effect_state(bob, b, two, '{"clean": true}', true, null);
  perform tests.unbecome();
  select * into fd from face_down x where x.play = s2;
  f := spring_facts(fd, 'quote', quoting2, null);
  perform pg_temp.expect(f.up = 1, format('spring_facts freed the plain card''s cleared play: up %s', f.up));
  said := spring_traps('quote', backed2, quoting2);
  perform pg_temp.expect(said is null, format('a Move sprang onto a post whose plain play is cleared: %s', said));
end $$;

-- ---- seed_instance writes the column from the seed's clearsForGood, and a reseed that drops the flag clears it ----
select tests.unbecome();
do $$
declare
  seed_of jsonb;
begin
  seed_of := jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'formerly', '[]'::jsonb, 'withdrawn', '[]'::jsonb, 'packs', '[]'::jsonb, 'machine', '[]'::jsonb,
    'cards', jsonb_build_array(
      jsonb_build_object('key', 'fgseedyes', 'name', 'Fg Seed Yes', 'alignment', 'salty', 'rarity', 'common', 'play', 'cast', 'stack', 1, 'drawsEffect', true, 'clearsForGood', true),
      jsonb_build_object('key', 'fgseedno', 'name', 'Fg Seed No', 'alignment', 'salty', 'rarity', 'common', 'play', 'cast', 'stack', 1, 'drawsEffect', true, 'clearsForGood', false),
      jsonb_build_object('key', 'fgseedmissing', 'name', 'Fg Seed Missing', 'alignment', 'salty', 'rarity', 'common', 'play', 'cast', 'stack', 1)));
  perform tests.become_service();
  perform seed_instance(seed_of);
  perform tests.unbecome();
  perform pg_temp.expect((select k.clears_for_good from card_kinds k where k.key = 'fgseedyes') is true, 'a card with clearsForGood true was not seeded clearing for good');
  perform pg_temp.expect((select k.clears_for_good from card_kinds k where k.key = 'fgseedno') is false, 'a card with clearsForGood false was seeded clearing for good');
  perform pg_temp.expect((select k.clears_for_good from card_kinds k where k.key = 'fgseedmissing') is false, 'a card with no clearsForGood was seeded clearing for good');
  seed_of := jsonb_set(seed_of, '{cards,0,clearsForGood}', 'false'::jsonb);
  perform tests.become_service();
  perform seed_instance(seed_of);
  perform tests.unbecome();
  perform pg_temp.expect((select k.clears_for_good from card_kinds k where k.key = 'fgseedyes') is false, 'a reseed that drops the flag left the card clearing for good');
end $$;
