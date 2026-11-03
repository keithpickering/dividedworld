-- The core loop's open questions, answered (supabase/migrations/0072_core_loop_answers.sql):
-- docs/plans/2026-11-03-core-loop-answers-plan.md, built from docs/plans/2026-11-03-core-loop-answers-design.md.

-- The window the next estimate reads opens here; each case writes its Acts and reactions a few hours past it, and asks for the
-- estimate a day on, so a settlement an earlier file committed never puts them outside it.
create function pg_temp.ws() returns timestamptz language sql as $$
  select (estimate_input(tests.account('core-ws-' || gen_random_uuid()), '3000-01-01') ->> 'windowStart')::timestamptz
$$;

create function pg_temp.react(on_act uuid, by_character uuid, kind text, at timestamptz) returns void language sql as $$
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at)
  select on_act, by_character, c.owner, kind,
    coalesce((select max(slot) + 1 from reactions r where r.act = on_act and r.reactor_account = c.owner), 1), at
  from characters c where c.id = by_character
$$;

create function pg_temp.has_act(input jsonb, id uuid) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = id::text)
$$;

-- ---- Task 1 (#137): a card the caller only reacted to brings in the post it landed on ----
do $$
declare
  ws timestamptz := pg_temp.ws();
  qa uuid := tests.account('core-q'); za uuid := tests.account('core-z'); ca uuid := tests.account('core-c');
  q uuid := tests.character(qa, 'Core Q', 'alpha', ws - interval '1 day');
  z uuid := tests.character(za, 'Core Z', 'alpha', ws - interval '1 day');
  c uuid := tests.character(ca, 'Core C', 'alpha', ws - interval '1 day');
  t uuid := tests.thread('Core cards');
  zp uuid; card uuid; got jsonb;
begin
  zp := tests.post(z, t, 'A post of Z''s.', ws + interval '1 hour');
  card := tests.act(q, 'card', t, '{"card": "sweetie", "config": {}}', zp, ws + interval '2 hours');
  perform pg_temp.react(card, c, 'up', ws + interval '3 hours');
  got := estimate_input(ca, ws + interval '1 day');
  if not pg_temp.has_act(got, card) then raise exception 'the card C reacted to is read: %', got -> 'acts'; end if;
  if not pg_temp.has_act(got, zp) then raise exception 'the post a card C reacted to landed on is read: %', got -> 'acts'; end if;
end $$;

-- ---- Task 1 (#137): the same on a staff post, which is named as an unscored target ----
do $$
declare
  ws timestamptz := pg_temp.ws();
  qa uuid := tests.account('core-sq'); ca uuid := tests.account('core-sc');
  q uuid := tests.character(qa, 'Core SQ', 'alpha', ws - interval '1 day');
  c uuid := tests.character(ca, 'Core SC', 'alpha', ws - interval '1 day');
  t uuid := tests.thread('Core staff');
  bot uuid; bp uuid; card uuid; got jsonb;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Core Bot', 'core-bot', 'bot', ws - interval '1 day') returning id into bot;
  perform set_config('kayfabb.staff_writer', 'on', true);
  bp := tests.post(bot, t, 'Behave.', ws + interval '1 hour');
  perform set_config('kayfabb.staff_writer', '', true);
  card := tests.act(q, 'card', t, '{"card": "sweetie", "config": {}}', bp, ws + interval '2 hours');
  perform pg_temp.react(card, c, 'up', ws + interval '3 hours');
  got := estimate_input(ca, ws + interval '1 day');
  if not exists (select 1 from jsonb_array_elements(got -> 'unscoredTargets') e where e ->> 'id' = bp::text) then
    raise exception 'the staff post a card C reacted to landed on is an unscored target: %', got;
  end if;
end $$;

-- ---- Task 2 (#19): the estimate leaves out only the caller's own reactions to the caller's own characters ----
do $$
declare
  ws timestamptz := pg_temp.ws();
  ann uuid := tests.account('core-ann'); bob uuid := tests.account('core-bob');
  a1 uuid := tests.character(ann, 'Core Ann', 'alpha', ws - interval '1 day');
  a2 uuid := tests.character(ann, 'Core Ann Two', 'alpha', ws - interval '1 day');
  b1 uuid := tests.character(bob, 'Core Bob', 'alpha', ws - interval '1 day');
  b2 uuid := tests.character(bob, 'Core Bob Two', 'alpha', ws - interval '1 day');
  t uuid := tests.thread('Core own');
  p uuid; card uuid; mine uuid; got jsonb; r jsonb; author_key text;
begin
  p := tests.post(b1, t, 'A post of Bob''s.', ws + interval '1 hour');
  card := tests.act(a1, 'card', t, '{"card": "sweetie", "config": {}}', p, ws + interval '2 hours');
  perform pg_temp.react(p, b2, 'up', ws + interval '3 hours');
  mine := tests.post(a1, t, 'A post of Ann''s.', ws + interval '4 hours');
  perform pg_temp.react(mine, a2, 'up', ws + interval '5 hours');
  got := estimate_input(ann, ws + interval '1 day');
  -- Bob's second mask's reaction to Bob's post, under a key of its own: the engine can tie it to no author.
  select e into r from jsonb_array_elements(got -> 'reactions') e where e ->> 'act' = p::text;
  if r is null then raise exception 'a reaction by the author''s own player, on a post the caller''s card sits on, is counted: %', got -> 'reactions'; end if;
  select o ->> 'player' into author_key from jsonb_array_elements(got -> 'characters') o where o ->> 'id' = b1::text;
  if author_key is null then raise exception 'the post''s author is named under a key: %', got -> 'characters'; end if;
  if r ->> 'player' = got ->> 'player' or r ->> 'player' = author_key then
    raise exception 'the author''s own player''s reaction is keyed as neither the caller nor the author: %, author %', r, author_key;
  end if;
  if r ->> 'character' = b2::text then raise exception 'the reacting mask is named by a key made up for the request, not its id'; end if;
  -- Ann's own reaction to Ann's own post is the one left out.
  if exists (select 1 from jsonb_array_elements(got -> 'reactions') e where e ->> 'act' = mine::text) then
    raise exception 'the caller''s own reaction to the caller''s own post is left out: %', got -> 'reactions';
  end if;
end $$;
