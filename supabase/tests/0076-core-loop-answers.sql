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
