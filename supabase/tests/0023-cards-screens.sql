-- Cards for the screens (supabase/migrations/0016_cards_screens.sql): a card stacks up to its
-- stack on one post, each play its own layer; a seeded card's play carries a seed the server
-- chose; every play carries its caster's message; and a reader's release from an effect is kept
-- per account, read by that account alone. The screens' engine plan, Task 4.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---- Stacking, layers, seeds and messages ----
do $$
declare
  ann uuid := tests.account('stack-ann');
  bob uuid := tests.account('stack-bob');
  a uuid := tests.character(ann, 'Stacker');
  b uuid := tests.character(bob, 'Stacked');
  t uuid := tests.thread();
  p uuid := tests.post(b, t, 'Splat me.');
  q uuid := tests.post(b, t, 'And me.');
  played jsonb;
  why text;
  old_play uuid;
begin
  insert into wallets (account, balance) values (ann, 600);
  insert into card_ledger (account, card, kind, price) select ann, k, 'bought', 0 from unnest(array['blot', 'blot', 'blot', 'blot', 'blot', 'sweetie', 'sweetie']) k;
  perform tests.become_service();

  -- Three land, each its own layer, with a seed the server chose; a fourth is refused in words.
  played := play_card(ann, 'blot', a, p, '{"color": "red", "seed": 12345}', 0, 'Take that.');
  if (played -> 'payload' ->> 'layer')::integer is distinct from 1 then raise exception 'the first play is layer 1: %', played; end if;
  if played -> 'payload' ->> 'message' is distinct from 'Take that.' then raise exception 'a play carries its caster''s message: %', played; end if;
  if jsonb_typeof(played -> 'payload' -> 'seed') is distinct from 'number' or (played -> 'payload' ->> 'seed')::bigint not between 0 and 2147483647 then raise exception 'a seeded play carries a 31-bit seed: %', played; end if;
  if played -> 'payload' -> 'config' ? 'seed' then raise exception 'a seed sent in the configuration was kept: %', played; end if;
  played := play_card(ann, 'blot', a, p, '{"color": "blue"}', 0, '');
  if (played -> 'payload' ->> 'layer')::integer is distinct from 2 or played -> 'payload' ->> 'message' is distinct from '' then raise exception 'the second play is layer 2, with no words: %', played; end if;
  played := play_card(ann, 'blot', a, p, '{"color": "green"}', 0, null);
  if (played -> 'payload' ->> 'layer')::integer is distinct from 3 or played -> 'payload' ->> 'message' is distinct from '' then raise exception 'the third play is layer 3, and no message is an empty one: %', played; end if;
  if (select count(distinct payload ->> 'seed') from acts where kind = 'card' and target_act_id = p) < 2 then raise exception 'three seeds drawn alike'; end if;
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'blot', a, p, '{}', ''));
  if why is distinct from 'this post already carries 3 of that card, the most it takes' then raise exception 'a fourth play: %', why; end if;

  -- A card of one to a post is refused in the words it always was; an unseeded play has no seed.
  played := play_card(ann, 'sweetie', a, q, '{}', 0, '');
  if played -> 'payload' ? 'seed' then raise exception 'an unseeded card''s play carries a seed: %', played; end if;
  if (played -> 'payload' ->> 'layer')::integer is distinct from 1 then raise exception 'a single card is layer 1: %', played; end if;
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'sweetie', a, q, '{}', ''));
  if why is distinct from 'this post already carries that card' then raise exception 'a second Sweetie: %', why; end if;

  -- The message: at most 200 characters, counted as characters.
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'blot', a, q, '{}', repeat('x', 201)));
  if why is distinct from 'the message is at most 200 characters' then raise exception 'a 201-character message: %', why; end if;
  played := play_card(ann, 'blot', a, q, '{}', 0, repeat('🔥', 200));
  if char_length(played -> 'payload' ->> 'message') is distinct from 200 then raise exception 'a 200-character message is kept whole'; end if;
  perform tests.unbecome();

  -- A play written before layers (an instance that holds 0006's plays) counts as one: the next is layer 2.
  insert into acts (character, kind, thread, target_act_id, payload) values (a, 'card', t, (select tests.post(b, t, 'Old.')), '{"card": "blot", "config": {}}') returning target_act_id into old_play;
  perform tests.become_service();
  played := play_card(ann, 'blot', a, old_play, '{}', 0, '');
  perform tests.unbecome();
  if (played -> 'payload' ->> 'layer')::integer is distinct from 2 then raise exception 'a play after one from before layers is layer 2: %', played; end if;
end $$;

-- ---- The stack and the seed reach the database from the instance's seed ----
do $$
begin
  perform seed_instance(jsonb_build_object('settings', jsonb_build_object('economy', jsonb_build_object('stacky.price', 50)), 'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'boards', '[]'::jsonb,
    'cards', jsonb_build_array(jsonb_build_object('key', 'stacky', 'name', 'Stacky', 'alignment', 'sweet', 'priceSetting', 'stacky.price', 'stack', 2, 'seeded', true),
                               jsonb_build_object('key', 'plain', 'name', 'Plain', 'alignment', 'sweet', 'priceSetting', 'stacky.price'))));
  if (select (stack, seeded) from card_kinds where key = 'stacky') is distinct from (2, true) then raise exception 'the seed''s stack and seeded reach card_kinds'; end if;
  if (select (stack, seeded) from card_kinds where key = 'plain') is distinct from (1, false) then raise exception 'a card that says neither is one to a post, unseeded'; end if;
  if pg_temp.refusal($q$update card_kinds set stack = 0 where key = 'plain'$q$) is null then raise exception 'a stack of 0 was written'; end if;
  -- Seeded again, as an instance that already holds the card is: its stack and seed are the code's now.
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'boards', '[]'::jsonb,
    'cards', jsonb_build_array(jsonb_build_object('key', 'stacky', 'name', 'Stacky', 'alignment', 'sweet', 'priceSetting', 'stacky.price', 'stack', 3, 'seeded', false))));
  if (select (stack, seeded) from card_kinds where key = 'stacky') is distinct from (3, false) then raise exception 'seeding again kept the old stack and seed'; end if;
end $$;

-- ---- Releases: written as the player, read by that account alone ----
do $$
declare
  ann uuid := tests.account('rel-ann');
  bob uuid := tests.account('rel-bob');
  a uuid := tests.character(ann, 'Releaser');
  b uuid := tests.character(bob, 'Released');
  t uuid := tests.thread();
  p uuid := tests.post(b, t, 'Stay.');
  k uuid;
  said jsonb;
  first_at timestamptz;
begin
  insert into card_ledger (account, card, kind, price) values (bob, 'sweetie', 'bought', 0);
  perform tests.become_service();
  k := (play_card(bob, 'sweetie', b, p, '{}', 0, 'Read it.') ->> 'id')::uuid;
  perform tests.unbecome();

  perform tests.become(ann);
  said := release_effect(k);
  if (said ->> 'play')::uuid is distinct from k or said ->> 'released_at' is null then raise exception 'a release says what it released, and when: %', said; end if;
  first_at := (said ->> 'released_at')::timestamptz;
  -- Released again, it is the same release.
  if (release_effect(k) ->> 'released_at')::timestamptz is distinct from first_at then raise exception 'a second release moved the first'; end if;
  if (select count(*) from effect_releases where play = k) is distinct from 1::bigint then raise exception 'its own account reads its release'; end if;
  if pg_temp.refusal(format('select release_effect(%L)', p)) is distinct from 'there is no such card on a post' then raise exception 'a release of a post that is not a card'; end if;
  if pg_temp.refusal(format('select release_effect(%L)', gen_random_uuid())) is distinct from 'there is no such card on a post' then raise exception 'a release of nothing'; end if;
  perform tests.unbecome();

  perform tests.become(bob);
  perform auth.assert_impersonating();
  if exists (select 1 from effect_releases) then raise exception 'another account read a release'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  if pg_temp.refusal('select count(*) from effect_releases') is null then raise exception 'a visitor read releases'; end if;
  if pg_temp.refusal(format('select release_effect(%L)', k)) is null then raise exception 'a visitor released an effect'; end if;
  perform tests.unbecome();
end $$;

-- ---- Two plays of a stacking card on one post at once take layers 1 and 2 ----
do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); cat uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-blot-a@test.invalid'), (%2$L, 'race-blot-b@test.invalid'), (%3$L, 'race-blot-c@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L), (%3$L);
    insert into characters (id, owner, name, debuted_at) values (%4$L, %1$L, 'Race Blot A', now()), (%5$L, %2$L, 'Race Blot B', now()), (%6$L, %3$L, 'Race Blot C', now());
    insert into class_history (character, class_key) values (%4$L, 'alpha'), (%5$L, 'alpha'), (%6$L, 'alpha');
    insert into threads (id, board, title) select %7$L, id, 'Race blot' from boards where slug = 'general';
    insert into acts (id, character, kind, thread) values (%8$L, %6$L, 'post', %7$L);
    insert into card_ledger (account, card, kind, price) values (%1$L, 'blot', 'bought', 100), (%2$L, 'blot', 'bought', 100);
  $sql$, ann, bob, cat, a, b, c, t, p));
  said := tests.race_service(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'blot', a, p, '{}', ''), format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'blot', b, p, '{}', ''));
  if said[1] is not null or said[2] is not null then raise exception 'both plays land: %', said; end if;
  if (select array_agg((payload ->> 'layer')::integer order by (payload ->> 'layer')::integer) from acts where kind = 'card' and target_act_id = p) is distinct from array[1, 2] then
    raise exception 'two plays at once take layers 1 and 2: %', (select array_agg(payload) from acts where kind = 'card' and target_act_id = p);
  end if;
end $$;

-- ---- A saved state of 0006's shape (strokes with no tool) is moved under `legacy` with no
-- strokes; a state of the new shape is untouched; the author's next save is taken
-- (supabase/migrations/0026_whoops_legacy.sql; the clues plan, Task 5) ----
do $$
declare
  ann uuid := tests.account('legacy-ann');
  bob uuid := tests.account('legacy-bob');
  author uuid := tests.character(ann, 'Legacy Author');
  caster uuid := tests.character(bob, 'Legacy Caster');
  t uuid := tests.thread('Legacy strokes');
  p uuid := tests.post(author, t, 'Splatted long ago.');
  q uuid := tests.post(author, t, 'Splatted lately.');
  old_play uuid := tests.act(caster, 'card', t, '{"card": "splat", "config": {"color": "red"}}', p);
  new_play uuid := tests.act(caster, 'card', t, '{"card": "splat", "config": {"color": "blue"}}', q);
  old_state jsonb := '{"strokes": [{"width": 0.05, "points": [[0.1, 0.2], [0.3, 0.25]]}, {"tool": "wash", "width": 0.05, "points": [[0.5, 0.5]]}]}';
  new_state jsonb := '{"strokes": [{"tool": "wash", "width": 0.05, "points": [[0.1, 2.5]]}], "clean": false}';
  said jsonb;
begin
  insert into effect_state (play, state, saved_by) values (old_play, old_state, author), (new_play, new_state, author);
  perform effect_states_of_0006();
  if (select state from effect_state where play = old_play) is distinct from jsonb_build_object('strokes', '[]'::jsonb, 'legacy', old_state) then
    raise exception 'a state of 0006''s shape is moved under legacy, with no strokes: %', (select state from effect_state where play = old_play);
  end if;
  if (select state from effect_state where play = new_play) is distinct from new_state then raise exception 'a state of the new shape is untouched: %', (select state from effect_state where play = new_play); end if;
  -- A state of 0006's shape at the bound's very edge is wrapped too: the bytes the wrapping adds
  -- never refuse it.
  declare
    edge_play uuid := tests.act(caster, 'card', t, '{"card": "splat", "config": {"color": "green"}}', tests.post(author, t, 'Splatted to the edge.'));
    edge jsonb := jsonb_build_object('strokes', jsonb_build_array(jsonb_build_object('width', 0.05, 'points', '[[0.1, 0.2]]'::jsonb)), 'pad', '');
  begin
    edge := jsonb_set(edge, '{pad}', to_jsonb(repeat('x', 262144 - octet_length(edge::text))));
    if octet_length(edge::text) is distinct from 262144 then raise exception 'the edge state is not at the edge: %', octet_length(edge::text); end if;
    insert into effect_state (play, state, saved_by) values (edge_play, edge, author);
    begin
      perform effect_states_of_0006();
    exception when check_violation then
      raise exception 'a state at the bound''s edge is wrapped, not refused: %', sqlerrm;
    end;
    if (select state -> 'legacy' from effect_state where play = edge_play) is distinct from edge then raise exception 'a state at the bound''s edge is wrapped'; end if;
  end;
  -- One its author washed clean stays clean; a state whose strokes are not a list is no stroke of 0006's.
  declare
    washed_play uuid := tests.act(caster, 'card', t, '{"card": "splat", "config": {"color": "teal"}}', tests.post(author, t, 'Washed long ago.'));
    odd_play uuid := tests.act(caster, 'card', t, '{"card": "splat", "config": {"color": "gray"}}', tests.post(author, t, 'Saved oddly.'));
    washed jsonb := '{"strokes": [{"width": 0.05, "points": [[0.1, 0.2]]}], "clean": true}';
  begin
    insert into effect_state (play, state, saved_by) values (washed_play, washed, author), (odd_play, '{"strokes": "none"}', author);
    perform effect_states_of_0006();
    if (select state from effect_state where play = washed_play) is distinct from jsonb_build_object('strokes', '[]'::jsonb, 'clean', true, 'legacy', washed) then
      raise exception 'a layer washed clean stays clean: %', (select state from effect_state where play = washed_play);
    end if;
    if (select state from effect_state where play = odd_play) is distinct from '{"strokes": "none"}'::jsonb then raise exception 'a state whose strokes are not a list was wrapped'; end if;
  end;
  -- Run again, a wrapped state is not wrapped twice.
  perform effect_states_of_0006();
  if (select state -> 'legacy' from effect_state where play = old_play) is distinct from old_state then raise exception 'a legacy state was wrapped twice'; end if;
  -- The author's next save, with new strokes, is taken, and the legacy goes with it.
  perform tests.become_service();
  said := save_effect_state(ann, author, old_play, '{"strokes": [{"tool": "ink", "color": "#112233", "width": 0.02, "points": [[0.2, 1.5]]}]}');
  perform tests.unbecome();
  if said -> 'state' ? 'legacy' or jsonb_array_length(said -> 'state' -> 'strokes') is distinct from 1 then raise exception 'the author''s next save is taken: %', said; end if;
end $$;
