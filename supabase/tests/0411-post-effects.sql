-- The database holds the limit on a post's drawn effects (supabase/migrations/0411_post_effects.sql; docs/plans/2026-11-21-post-plays-plan.md, Task 10; design docs/plans/2026-11-21-post-plays-design.md, section 4).
-- At postEffects 2:
--   * card_kinds.draws_effect and effect_state.cleared and cleared_for exist; card_kinds_problem names a drawsEffect that is no boolean; postEffects is held by the settings.
--   * Two drawing casts land and a third is refused in the words; a mark-only cast lands on the full post.
--   * `cleared` saved true frees a slot; saved false again takes it back; `cleared_for` the post's version frees one, and an edit of the post takes it back with no save.
--   * A set on a full post is refused; a live back counts one; taken back, its slot is free.
--   * reverse_card frees a slot; so does a play whose `ends` passes.
--   * A Move whose quoting post is full does not spring and its back stays set; with room, it springs.
--   * card_target shows `drawing` and `cleared`.
-- The cards are this file's own (pe...). The race for the last slot is 0411-post-effects-race.sql.

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k, generate_series(1, 12)
$$;

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

create function pg_temp.words(n integer) returns text language sql as $$
  select format('this post already shows %s effects, the most it takes. A slot opens when one ends, is ended by an admin, or its author clears it', n)
$$;

-- Casts through the service role, as the act function plays them; the answer is the Act's id, or the refusal as `sqlstate message`.
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

-- ---- The catalog: the column, the check, the setting ----
select tests.unbecome();
do $$
declare got text;
begin
  perform pg_temp.expect(exists (select 1 from information_schema.columns where table_name = 'card_kinds' and column_name = 'draws_effect' and is_nullable = 'NO' and column_default = 'false'), 'card_kinds has no draws_effect boolean not null default false');
  perform pg_temp.expect(exists (select 1 from information_schema.columns where table_name = 'effect_state' and column_name = 'cleared' and is_nullable = 'NO' and column_default = 'false'), 'effect_state has no cleared boolean not null default false');
  perform pg_temp.expect(exists (select 1 from information_schema.columns where table_name = 'effect_state' and column_name = 'cleared_for' and data_type = 'uuid'), 'effect_state has no cleared_for uuid');
  got := card_kinds_problem('[{"key": "pe-x", "rarity": "common", "play": "cast", "drawsEffect": "yes"}]'::jsonb);
  perform pg_temp.expect(got like '%card "pe-x" has drawsEffect "yes"; drawsEffect is true or false%', format('a drawsEffect that is no boolean is not named: %s', got));
  got := card_kinds_problem('[{"key": "pe-x", "rarity": "common", "play": "cast", "drawsEffect": true}]'::jsonb);
  perform pg_temp.expect(got is null, format('a boolean drawsEffect is refused: %s', got));
  got := card_kinds_problem('[{"key": "pe-x", "rarity": "common", "play": "cast"}]'::jsonb);
  perform pg_temp.expect(got is null, format('a card with no drawsEffect is refused: %s', got));
end $$;

-- ---- The fixture: one post of Ann's at the limit of two, and the cards ----
create temp table pe_fix (label text primary key, id uuid not null);
create function pg_temp.fix(l text) returns uuid language sql as $$ select id from pe_fix where label = l $$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pe-ann'); bob uuid := tests.account('pe-bob'); cat uuid := tests.account('pe-cat');
  a uuid := tests.character(ann, 'Pe Ann'); b uuid := tests.character(bob, 'Pe Bob'); c uuid := tests.character(cat, 'Pe Cat');
  t uuid := tests.thread('Pe thread');
begin
  insert into settings (key, value) values ('postEffects', '2') on conflict (key) do update set value = excluded.value;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, draws_effect) values
    ('pedraw1', 'Pe Draw One', 'salty', 'common', 'cast', '{post}', null, 3, true),
    ('pedraw2', 'Pe Draw Two', 'sweet', 'common', 'cast', '{post}', null, 3, true),
    ('pedraw3', 'Pe Draw Three', 'salty', 'common', 'cast', '{post}', null, 3, true),
    ('pemark', 'Pe Mark', 'sweet', 'common', 'cast', '{post}', null, 3, false);
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, draws_effect) values
    ('peback', 'Pe Back', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null, false),
    ('pemove', 'Pe Move', 'salty', 'uncommon', 'cast', null, '{post}', null, true);
  perform pg_temp.hand(bob, 'pedraw1', 'pedraw2', 'pedraw3', 'pemark');
  perform pg_temp.hand(cat, 'pedraw1', 'pedraw2', 'pedraw3', 'pemark');
  perform pg_temp.hand(ann, 'peback', 'pemove', 'pedraw1', 'pedraw2');
  insert into pe_fix values ('ann', ann), ('bob', bob), ('cat', cat), ('a', a), ('b', b), ('c', c), ('t', t);
end $$;

-- ---- Two drawing casts land; a third is refused in the words; a mark-only cast lands on the full post ----
select tests.unbecome();
do $$
declare
  bob uuid := pg_temp.fix('bob'); cat uuid := pg_temp.fix('cat'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); c uuid := pg_temp.fix('c'); t uuid := pg_temp.fix('t');
  p uuid := tests.post(a, t, 'Ann''s post.'); r record; third record;
begin
  insert into pe_fix values ('p', p);
  r := pg_temp.cast_of(bob, 'pedraw1', b, p); perform pg_temp.expect(r.said is null, format('the first drawing cast was refused: %s', r.said));
  r := pg_temp.cast_of(cat, 'pedraw2', c, p); perform pg_temp.expect(r.said is null, format('the second drawing cast was refused: %s', r.said));
  perform pg_temp.expect(post_effects_up(p) = 2, format('two drawing plays count %s', post_effects_up(p)));
  third := pg_temp.cast_of(bob, 'pedraw3', b, p);
  perform pg_temp.expect(third.said = '23505 ' || pg_temp.words(2), format('the third drawing cast is refused in the words, got: %s', third.said));
  perform pg_temp.expect(not exists (select 1 from acts x where x.kind = 'card' and x.payload ->> 'card' = 'pedraw3' and x.target_act_id = p), 'the refused cast wrote an Act');
  r := pg_temp.cast_of(bob, 'pemark', b, p); perform pg_temp.expect(r.said is null, format('a mark-only cast was refused on the full post: %s', r.said));
  perform pg_temp.expect(post_effects_up(p) = 2, 'a mark-only play counts');
  insert into pe_fix select 'p1', (select x.id from acts x where x.kind = 'card' and x.payload ->> 'card' = 'pedraw1' and x.target_act_id = p);
  insert into pe_fix select 'p2', (select x.id from acts x where x.kind = 'card' and x.payload ->> 'card' = 'pedraw2' and x.target_act_id = p);
end $$;

-- ---- Cleared: saved true frees a slot, saved false takes it back ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); p uuid := pg_temp.fix('p'); p1 uuid := pg_temp.fix('p1');
  r record;
begin
  perform tests.become_service();
  perform save_effect_state(ann, a, p1, '{"clean": true}', true, null);
  perform tests.unbecome();
  perform pg_temp.expect(post_effects_up(p) = 1, format('a cleared play still counts: %s', post_effects_up(p)));
  r := pg_temp.cast_of(bob, 'pedraw3', b, p); perform pg_temp.expect(r.said is null, format('the third cast was refused with a slot cleared: %s', r.said));
  perform pg_temp.expect(post_effects_up(p) = 2, 'the third cast does not count');
  perform tests.become_service();
  perform save_effect_state(ann, a, p1, '{"clean": false}', false, null);
  perform tests.unbecome();
  perform pg_temp.expect(post_effects_up(p) = 3, format('a play that un-clears on a full post draws over the limit: %s', post_effects_up(p)));
  r := pg_temp.cast_of(bob, 'pedraw1', b, p); perform pg_temp.expect(r.said = '23505 ' || pg_temp.words(2), format('a fourth cast on a post over its limit is not refused in the words: %s', r.said));
  -- The four-argument save, as every earlier caller makes it, saves cleared false.
  perform tests.become_service();
  perform save_effect_state(ann, a, p1, '{"clean": true}', true, null);
  perform save_effect_state(ann, a, p1, '{"clean": true}');
  perform tests.unbecome();
  perform pg_temp.expect((select e.cleared from effect_state e where e.play = p1) is false, 'a save with no cleared argument leaves the play cleared');
end $$;

-- ---- cleared_for: the version it names frees a slot, an edit takes it back with no save ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); cat uuid := pg_temp.fix('cat'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); c uuid := pg_temp.fix('c'); t uuid := pg_temp.fix('t');
  p uuid := tests.post(a, t, 'A post that will be edited.'); d1 uuid; d2 uuid; ed uuid; r record;
begin
  r := pg_temp.cast_of(bob, 'pedraw1', b, p); d1 := r.id;
  r := pg_temp.cast_of(cat, 'pedraw2', c, p); d2 := r.id;
  perform pg_temp.expect(post_effects_up(p) = 2, 'two drawing plays on the new post count');
  perform tests.become_service();
  perform save_effect_state(ann, a, d1, jsonb_build_object('cleared', p), true, p);
  perform tests.unbecome();
  perform pg_temp.expect(post_effects_up(p) = 1, format('a play cleared for the post''s current version still counts: %s', post_effects_up(p)));
  ed := tests.act(a, 'edit', t, '{"body": "Edited."}', p, now() + interval '1 second');
  perform pg_temp.expect(post_version(p) = ed, 'the edit is the post''s version');
  perform pg_temp.expect(post_effects_up(p) = 2, format('an edit of the post does not take the slot back: %s', post_effects_up(p)));
  perform tests.become_service();
  perform save_effect_state(ann, a, d1, jsonb_build_object('cleared', ed), true, ed);
  perform tests.unbecome();
  perform pg_temp.expect(post_effects_up(p) = 1, format('clearing for the new version does not free the slot: %s', post_effects_up(p)));
  -- A clear that names no version (Whoops!, Autocorrect) holds through the edit.
  perform tests.become_service();
  perform save_effect_state(ann, a, d1, '{"clean": true}', true, null);
  perform tests.unbecome();
  perform tests.act(a, 'edit', t, '{"body": "Edited again."}', p, now() + interval '2 seconds');
  perform pg_temp.expect(post_effects_up(p) = 1, 'a clear with no version does not hold through an edit');
end $$;

-- ---- A set on a full post is refused; a live back counts one; taken back, its slot is free ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); cat uuid := pg_temp.fix('cat'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); c uuid := pg_temp.fix('c'); t uuid := pg_temp.fix('t');
  full_post uuid := tests.post(a, t, 'A full post.'); backed uuid := tests.post(a, t, 'A post with a back.'); s uuid; r record; said text;
begin
  perform pg_temp.cast_of(bob, 'pedraw1', b, full_post); perform pg_temp.cast_of(cat, 'pedraw2', c, full_post);
  perform tests.become_service();
  said := pg_temp.coded(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'peback', a, full_post, '{}'));
  perform tests.unbecome();
  perform pg_temp.expect(said = '23505 ' || pg_temp.words(2), format('a set on a full post is not refused in the words: %s', said));
  -- One drawing play and a back: the post is full.
  perform pg_temp.cast_of(bob, 'pedraw1', b, backed);
  perform tests.become_service();
  s := (set_card(ann, 'peback', a, backed, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  perform pg_temp.expect(post_effects_up(backed) = 2, format('a live back and a drawing play count %s', post_effects_up(backed)));
  r := pg_temp.cast_of(cat, 'pedraw3', c, backed); perform pg_temp.expect(r.said = '23505 ' || pg_temp.words(2), format('the post with a back and a play takes a third: %s', r.said));
  perform tests.become_service();
  perform take_back(ann, a, s);
  perform tests.unbecome();
  perform pg_temp.expect(post_effects_up(backed) = 1, format('a back taken back still counts: %s', post_effects_up(backed)));
  r := pg_temp.cast_of(cat, 'pedraw3', c, backed); perform pg_temp.expect(r.said is null, format('a cast was refused after the back was taken back: %s', r.said));
end $$;

-- ---- reverse_card frees a slot; so does a play whose `ends` passes ----
select tests.unbecome();
do $$
declare
  bob uuid := pg_temp.fix('bob'); cat uuid := pg_temp.fix('cat'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); c uuid := pg_temp.fix('c'); t uuid := pg_temp.fix('t');
  p uuid := tests.post(a, t, 'A post to end plays on.'); d1 uuid; r record; gone uuid; boss uuid := tests.account('pe-admin');
begin
  insert into admins (account) values (boss);
  r := pg_temp.cast_of(bob, 'pedraw1', b, p); d1 := r.id;
  perform pg_temp.cast_of(cat, 'pedraw2', c, p);
  r := pg_temp.cast_of(bob, 'pedraw3', b, p); perform pg_temp.expect(r.said is not null, 'the post is not full');
  perform tests.become(boss);
  perform reverse_card(d1);
  perform tests.unbecome();
  perform pg_temp.expect(post_effects_up(p) = 1, format('an ended play still counts: %s', post_effects_up(p)));
  r := pg_temp.cast_of(bob, 'pedraw3', b, p); perform pg_temp.expect(r.said is null, format('a cast was refused after reverse_card: %s', r.said));
  -- A play whose time has passed holds no slot.
  gone := tests.act(c, 'card', t, jsonb_build_object('card', 'pedraw2', 'layer', 9, 'ends', now() - interval '1 day'), p, now() - interval '4 days');
  perform pg_temp.expect(post_effects_up(p) = 2, format('a play whose time passed counts: %s', post_effects_up(p)));
end $$;

-- ---- A Move whose quoting post is full does not spring, and its back stays set ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); cat uuid := pg_temp.fix('cat'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); c uuid := pg_temp.fix('c'); t uuid := pg_temp.fix('t');
  backed uuid := tests.post(a, t, 'The post that holds the Move.'); quoting uuid := tests.post(b, t, 'A reply that quotes.'); s uuid; d1 uuid; r record; said jsonb; sprung boolean;
begin
  perform tests.become_service();
  s := (set_card(ann, 'pemove', a, backed, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  r := pg_temp.cast_of(cat, 'pedraw1', c, quoting); d1 := r.id;
  perform pg_temp.cast_of(cat, 'pedraw2', c, quoting);
  perform pg_temp.expect(post_effects_up(quoting) = 2, 'the quoting post is not full');
  said := spring_traps('quote', backed, quoting);
  perform pg_temp.expect(said is null, format('a Move sprang onto a full post: %s', said));
  perform pg_temp.expect(not exists (select 1 from acts x where x.kind = 'spring' and x.payload ->> 'set' = s::text), 'a spring was written for a Move with no room');
  perform pg_temp.expect(not exists (select 1 from acts x where x.kind = 'card' and x.target_act_id = quoting and x.payload ->> 'card' = 'pemove'), 'a Move landed on a full post');
  perform pg_temp.expect(post_effects_up(quoting) = 2, 'the Move took a slot on a full post');
  -- A slot opens, and the same back springs.
  perform tests.become((select a.id from accounts a join admins m on m.account = a.id limit 1));
  perform reverse_card(d1);
  perform tests.unbecome();
  said := spring_traps('quote', backed, quoting);
  perform pg_temp.expect(said is not null, 'a Move did not spring onto a post with room');
  perform pg_temp.expect(post_effects_up(quoting) = 2, format('the sprung Move did not take the open slot: %s', post_effects_up(quoting)));
end $$;

-- ---- card_target shows `drawing` and `cleared` ----
select tests.unbecome();
do $$
declare
  p uuid := pg_temp.fix('p'); p1 uuid := pg_temp.fix('p1'); p2 uuid := pg_temp.fix('p2'); ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); got jsonb; e1 jsonb; e2 jsonb; em jsonb;
begin
  perform tests.become_service();
  perform save_effect_state(ann, a, p1, '{"clean": true}', true, null);
  perform tests.unbecome();
  got := card_target(p);
  select x into e1 from jsonb_array_elements(got -> 'effects') x where x ->> 'act' = p1::text;
  select x into e2 from jsonb_array_elements(got -> 'effects') x where x ->> 'act' = p2::text;
  select x into em from jsonb_array_elements(got -> 'effects') x where x ->> 'card' = 'pemark';
  perform pg_temp.expect(e1 -> 'drawing' = 'true' and e1 -> 'cleared' = 'true', format('a cleared drawing play is not shown drawing and cleared: %s', e1));
  perform pg_temp.expect(e2 -> 'drawing' = 'true' and not (e2 ? 'cleared'), format('an uncleared drawing play is not shown drawing alone: %s', e2));
  perform pg_temp.expect(not (em ? 'drawing') and not (em ? 'cleared'), format('a mark-only play is shown drawing: %s', em));
  got := card_target_reach('post', p);
  perform pg_temp.expect((select x ->> 'drawing' from jsonb_array_elements(got -> 'effects') x where x ->> 'act' = p2::text) = 'true', 'card_target_reach does not pass drawing through');
end $$;
