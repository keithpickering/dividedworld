-- The core loop's open questions, answered (supabase/migrations/0073_core_loop_answers.sql):
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
  insert into characters (name, staff, staff_kind, debuted_at) values ('Core Bot', 'core-bot', 'persona', ws - interval '1 day') returning id into bot;
  perform set_config('kayfabb.staff_writer', 'on', true);
  bp := tests.post(bot, t, 'Behave.', ws + interval '1 hour');
  perform set_config('kayfabb.staff_writer', '', true);
  card := tests.act(q, 'card', t, '{"card": "sweetie", "config": {}}', bp, ws + interval '2 hours');
  perform pg_temp.react(card, c, 'up', ws + interval '3 hours');
  got := estimate_input(ca, ws + interval '1 day');
  if not exists (select 1 from jsonb_array_elements(got -> 'unscoredTargets') e where e ->> 'id' = bp::text) then
    raise exception 'the staff post a card C reacted to landed on is an unscored target: %', got;
  end if;
  if pg_temp.has_act(got, bp) then raise exception 'a staff post is named as an unscored target, never as an Act: %', got -> 'acts'; end if;
end $$;

-- ---- Task 1 (#137): a spring and a spin the caller reacted to bring in their posts; a play beyond a post brings in none ----
do $$
declare
  ws timestamptz := pg_temp.ws();
  qa uuid := tests.account('core-pq'); za uuid := tests.account('core-pz'); ca uuid := tests.account('core-pc');
  q uuid := tests.character(qa, 'Core PQ', 'alpha', ws - interval '1 day');
  z uuid := tests.character(za, 'Core PZ', 'alpha', ws - interval '1 day');
  c uuid := tests.character(ca, 'Core PC', 'alpha', ws - interval '1 day');
  t uuid := tests.thread('Core plays');
  sp_post uuid; spring uuid; spin_post uuid; spun uuid; spin uuid; far_post uuid; far uuid; got jsonb;
begin
  sp_post := tests.post(z, t, 'A trapped post.', ws + interval '1 hour');
  -- Z's card set face down on Z's post springs; C reacts to the spring.
  spring := tests.act(z, 'set', t, '{}', sp_post, ws + interval '90 minutes');
  spring := tests.act(z, 'spring', t, jsonb_build_object('card', 'sweetie', 'trigger', 'reply', 'outcome', '{"do": "nullify"}'::jsonb, 'set', spring), sp_post, ws + interval '2 hours');
  perform pg_temp.react(spring, c, 'up', ws + interval '3 hours');
  -- A thread Q spun from Z's post; C reacts to the spin.
  spin_post := tests.post(z, t, 'A post spun from.', ws + interval '1 hour');
  insert into threads (board, title, origin_act_id) select b.id, 'Core spun', spin_post from boards b where b.slug = 'general' returning id into spun;
  spin := tests.act(q, 'spin', spun, '{"title": "Core spun", "body": ""}', spin_post, ws + interval '2 hours');
  perform pg_temp.react(spin, c, 'up', ws + interval '3 hours');
  -- A play beyond a post sits on Z's post and has no target post.
  far_post := tests.post(z, t, 'A post a play sits on.', ws + interval '1 hour');
  far := tests.act(q, 'card', t, jsonb_build_object('card', 'sweetie', 'reach', 'character', 'character', z), far_post, ws + interval '2 hours');
  perform pg_temp.react(far, c, 'up', ws + interval '3 hours');
  got := estimate_input(ca, ws + interval '1 day');
  if not pg_temp.has_act(got, sp_post) then raise exception 'the post a spring C reacted to sprang on is read: %', got -> 'acts'; end if;
  if not pg_temp.has_act(got, spin_post) then raise exception 'the post a spin C reacted to was spun from is read: %', got -> 'acts'; end if;
  if not pg_temp.has_act(got, far) then raise exception 'the play beyond a post C reacted to is read: %', got -> 'acts'; end if;
  if pg_temp.has_act(got, far_post) then raise exception 'the post a play beyond a post sits on is not its target, and is not read: %', got -> 'acts'; end if;
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

-- ---- Task 7 (#57): a ledger row keeps the numbers its reason's words state, as it was settled under them ----
do $$
declare
  lu uuid := tests.account('core-ledger');
  c uuid := tests.character(lu, 'Core Ledger', 'alpha', '2000-01-01');
  s timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  got jsonb;
begin
  begin
    perform set_config('role', 'service_role', true);
    got := apply_settlement(s, s + interval '1 hour', jsonb_build_array(
      jsonb_build_object('player', lu, 'character', c, 'reason', 'alpha.postedTooMuch', 'amount', -10, 'params', jsonb_build_object('lurker.postsAllowed', 4)),
      jsonb_build_object('player', lu, 'character', c, 'reason', 'alpha.cheered', 'amount', 20)));
    perform tests.unbecome();
    if got ->> 'applied' is distinct from 'true' then raise exception 'the setup: the window is applied: %', got; end if;
    if (select params from ledger where character = c and reason = 'alpha.postedTooMuch') is distinct from '{"lurker.postsAllowed": 4}'::jsonb then
      raise exception 'a ledger row keeps the numbers it was settled under: %', (select params from ledger where character = c and reason = 'alpha.postedTooMuch');
    end if;
    if (select params from ledger where character = c and reason = 'alpha.cheered') is not null then raise exception 'a row whose reason states no number holds none'; end if;
    -- The player's own log reads them.
    perform tests.become(lu);
    if (select jsonb_object_agg(reason, params) from my_ledger where character = c) is distinct from '{"alpha.postedTooMuch": {"lurker.postsAllowed": 4}, "alpha.cheered": null}'::jsonb then
      raise exception 'my_ledger reads each row''s numbers: %', (select jsonb_object_agg(reason, params) from my_ledger where character = c);
    end if;
    perform tests.unbecome();
    -- Undone, so the blocks after this one meet the seasons and settlements as the file found them.
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- ---- Task 7 (#57): numbers that are not numbers are refused, and nothing is applied ----
do $$
declare
  lu uuid := tests.account('core-ledger-bad');
  c uuid := tests.character(lu, 'Core Ledger Bad', 'alpha', '2000-01-01');
  s timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  why text;
begin
  perform set_config('role', 'service_role', true);
  begin
    perform apply_settlement(s, s + interval '1 hour', jsonb_build_array(
      jsonb_build_object('player', lu, 'character', c, 'reason', 'alpha.postedTooMuch', 'amount', -10, 'params', jsonb_build_object('lurker.postsAllowed', 'four'))));
  exception when others then why := sqlerrm;
  end;
  perform tests.unbecome();
  if why is distinct from 'an entry''s params are numbers by key' then raise exception 'params that are not numbers are refused: %', why; end if;
  -- Params that are not an object at all are refused in the same words.
  why := null;
  perform set_config('role', 'service_role', true);
  begin
    perform apply_settlement(s, s + interval '1 hour', jsonb_build_array(
      jsonb_build_object('player', lu, 'character', c, 'reason', 'alpha.postedTooMuch', 'amount', -10, 'params', jsonb_build_array(4))));
  exception when others then why := sqlerrm;
  end;
  perform tests.unbecome();
  if why is distinct from 'an entry''s params are numbers by key' then raise exception 'params that are not an object are refused: %', why; end if;
  if exists (select 1 from ledger where character = c) then raise exception 'nothing of a refused window is applied'; end if;
end $$;

-- ---- Task 4 (#22): the settle run's claim, and the reveal it refuses, are tested in 0077-settle-claim.sql, which replaced its clock ----

-- ---- Task 5 (#23): an announced Turn states the class it leaves, and nothing else ----
do $$
declare
  ann uuid := tests.account('core-turner');
  a uuid;
  tally uuid; entry jsonb; ended timestamptz; shown jsonb;
begin
  begin
    update seasons set starts_at = now() - interval '10 days' where ends_at is null;
    insert into class_kinds (key, name) values ('gamma', 'Gamma') on conflict (key) do nothing;
    a := tests.character(ann, 'Core Turner', 'alpha', now() - interval '9 days');
    -- A silent Turn to beta five days ago: it is in no tally, and nothing public dates it.
    insert into class_history (character, class_key, started_at) values (a, 'beta', now() - interval '5 days');
    -- Then a Turn to gamma that names the class it leaves.
    insert into pending_turns (character, class_key, loudness, asked_at, show_from, show_to) values (a, 'gamma', 'announced', now() - interval '1 hour', true, false);
    tally := masks_change(now() - interval '30 minutes');
    select e into entry from acts x cross join lateral jsonb_array_elements(x.payload -> 'turns') e where x.id = tally and e ->> 'character' = a::text;
    if entry - 'character' - 'name' - 'loudness' is distinct from '{"was": "beta"}'::jsonb then
      raise exception 'an announced Turn says the class it leaves, and not since when: %', entry;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'turns_announced' and column_name = 'since') then
      raise exception 'turns_announced carries no since';
    end if;
    ended := (select starts_at from seasons where ends_at is null) + span_interval(setting('seasonLength'));
    perform reveal_season(ended);
    select x.shown into shown from season_results x where x.character = a;
    if shown is null or not exists (select 1 from jsonb_array_elements(shown) e where e ->> 'kind' = 'turn' and e ->> 'was' = 'beta') then
      raise exception 'the season''s reveal lists the announced Turn with the class it left: %', shown;
    end if;
    if exists (select 1 from jsonb_array_elements(shown) e where e ? 'since') then raise exception 'the season''s reveal dates no Turn''s start: %', shown; end if;
    -- Undone, so the blocks after this one meet the seasons and settlements as the file found them.
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;
