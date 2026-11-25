-- A caught cast holds no place on its post and is never in effect (supabase/migrations/0370_caught_casts_never_end.sql; issue #689).
-- A cast a face-down set card catches writes no `ends`, an earn (Hype-Up on a post) and a skim alike, and settlement_input and estimate_input carry a caught play, inside its window or brought back by a later
-- window's reaction to its post, with no `ends`, so settle.ts boosts and skims nothing with it (a play with no `ends` boosts nothing, and a skim needs one). A caught row that holds `ends` (one written before 0370;
-- an Act is never edited) is read the same way. The cards are this file's own (cg...).

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('cghype', 'Cg Hype', 'sweet', 'common', 'cast', interval '3 days', '{post}',
      '{"kind": "earn", "quadrants": ["excitedPositive", "calmPositive"], "by": 1, "group": "publicity"}')
  on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, skim, stack) values
    ('cgskim', 'Cg Skim', 'salty', 'uncommon', 'cast', interval '7 days', '{post}', '{"share": 0.1}', 4)
  on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('cgcollector', 'Cg Collector', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}}', '{post}', null)
  on conflict (key) do nothing;
end $$;

create function pg_temp.entry(input jsonb, id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = id::text
$$;

-- ---- A caught cast writes no `ends`: an earn on a post and a skim ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('cg-ann'); bob uuid := tests.account('cg-bob');
  a uuid := tests.character(ann, 'Cg Ann'); b uuid := tests.character(bob, 'Cg Bob');
  t uuid := tests.thread('Cg thread');
  p1 uuid := tests.post(a, t, 'Ann''s first post.'); p2 uuid := tests.post(a, t, 'Ann''s second post.');
  hype uuid; skim uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'cgcollector', 'cgcollector');
  perform pg_temp.hand(bob, 'cghype', 'cgskim');
  perform tests.become_service();
  perform set_card(ann, 'cgcollector', a, p1, '{}', 0, 'cghype');
  perform set_card(ann, 'cgcollector', a, p2, '{}', 0, 'cgskim');
  hype := (play_card(bob, 'cghype', b, p1, '{}', 0, '') ->> 'id')::uuid;
  skim := (play_card(bob, 'cgskim', b, p2, '{"quadrant": "excitedPositive"}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  if (select (k.payload ? 'caught', k.payload ? 'ends') from acts k where k.id = hype) is distinct from (true, false) then
    raise exception 'a caught cast earn on a post holds an end: %', (select k.payload from acts k where k.id = hype);
  end if;
  if (select (k.payload ? 'caught', k.payload ? 'ends') from acts k where k.id = skim) is distinct from (true, false) then
    raise exception 'a caught skim holds an end: %', (select k.payload from acts k where k.id = skim);
  end if;
end $$;

-- ---- The settlement and the estimate carry a caught play with no end, in its own window and in a later one ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('cg-st-ann'); bob uuid := tests.account('cg-st-bob'); cat uuid := tests.account('cg-st-cat');
  a uuid := tests.character(ann, 'Cg St Ann'); b uuid := tests.character(bob, 'Cg St Bob'); c uuid := tests.character(cat, 'Cg St Cat');
  s1 constant timestamptz := (select min(starts_at) from seasons);
  w0 timestamptz; w1 timestamptz; w2 timestamptz;
  t uuid := tests.thread('Cg settlement thread');
  pa uuid; hype uuid; skim uuid; live uuid; got jsonb; input jsonb;
begin
  perform pg_temp.cards();
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  w0 := (select max(ends_at) from settlements); w1 := w0 + interval '1 day'; w2 := w1 + interval '1 day';
  pa := tests.post(a, t, 'Ann''s post.', w0 - interval '20 hours');
  -- Caught plays as a back caught them before 0370, `ends` and all, cast inside the window; and a live Hype-Up beside them, which keeps its end.
  hype := tests.act(b, 'card', t, jsonb_build_object('card', 'cghype', 'message', '', 'config', '{}'::jsonb, 'caught', gen_random_uuid()::text, 'ends', w0 + interval '74 hours'), pa, w0 + interval '2 hours');
  skim := tests.act(b, 'card', t, jsonb_build_object('card', 'cgskim', 'message', '', 'config', '{"quadrant": "excitedPositive"}'::jsonb, 'caught', gen_random_uuid()::text, 'ends', w0 + interval '170 hours'), pa, w0 + interval '2 hours 1 minute');
  live := tests.act(c, 'card', t, jsonb_build_object('card', 'cgskim', 'message', '', 'config', '{"quadrant": "calmPositive"}'::jsonb, 'layer', 1, 'ends', w0 + interval '170 hours'), pa, w0 + interval '2 hours 2 minutes');
  -- The post draws a reaction in each window.
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    (pa, c, cat, 'up', 1, w0 + interval '3 hours'), (pa, c, cat, 'wow', 2, w1 + interval '3 hours');

  -- Its own window.
  input := settlement_input(w0, w1);
  got := pg_temp.entry(input, hype);
  if got is null or got ? 'ends' then raise exception 'settlement_input carries a caught cast earn cast in its window with an end, or not at all: %', got; end if;
  got := pg_temp.entry(input, skim);
  if got is null or got ? 'ends' then raise exception 'settlement_input carries a caught skim cast in its window with an end, or not at all: %', got; end if;
  got := pg_temp.entry(input, live);
  if got is null or not (got ? 'ends') then raise exception 'settlement_input lost the end of a live skim: %', got; end if;

  -- A later window, where a reaction to the post brings every card on it back.
  input := settlement_input(w1, w2);
  got := pg_temp.entry(input, hype);
  if got is null or got ? 'ends' then raise exception 'settlement_input carries a caught cast earn into a later window with an end, or not at all: %', got; end if;
  got := pg_temp.entry(input, skim);
  if got is null or got ? 'ends' then raise exception 'settlement_input carries a caught skim into a later window with an end, or not at all: %', got; end if;

  -- The live estimate: the post's author (a card landed on their post) and the caster (their own window card).
  perform tests.become_service();
  got := pg_temp.entry(estimate_input(ann, w1), hype);
  if got is null or got ? 'ends' then raise exception 'estimate_input carries a caught cast earn on the caller''s post with an end, or not at all: %', got; end if;
  got := pg_temp.entry(estimate_input(bob, w1), skim);
  if got is null or got ? 'ends' then raise exception 'estimate_input carries the caller''s caught skim with an end, or not at all: %', got; end if;
  got := pg_temp.entry(estimate_input(bob, w1), hype);
  if got is null or got ? 'ends' then raise exception 'estimate_input carries the caller''s caught cast earn with an end, or not at all: %', got; end if;
  perform tests.unbecome();
end $$;
