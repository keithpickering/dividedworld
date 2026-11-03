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

-- ---- Task 4 (#22): a settle run claims its window, and a reveal waits it out ----

-- A season's first window, whose end nobody knows in advance (0014): the last settled end, where there is one, is where a new
-- season begins.
create function pg_temp.first_window() returns void language plpgsql as $$
declare last_end timestamptz := (select max(ends_at) from settlements);
begin
  if last_end is not null then
    update seasons set ends_at = last_end where ends_at is null or ends_at > last_end;
    delete from seasons where starts_at >= last_end;
    insert into seasons (number, starts_at) values ((select max(number) + 1 from seasons), last_end);
  end if;
  if next_settlement_at(now()) is not null then raise exception 'the setup is a season''s first window, with no known end'; end if;
end $$;

-- A character of a fresh player's with a Turn waiting, asked two hours ago.
create function pg_temp.turning(label text) returns uuid language plpgsql as $$
declare ann uuid := tests.account(label); a uuid := tests.character(ann, label, 'alpha', now() - interval '60 days');
begin
  perform tests.become(ann);
  perform turn(a, 'beta', 'silent');
  perform tests.unbecome();
  update pending_turns set asked_at = now() - interval '2 hours' where character = a;
  return a;
end $$;

create function pg_temp.reveal(a uuid) returns text language plpgsql as $$
declare t uuid := tests.thread('Core reveal');
begin
  perform tests.become((select owner from characters where id = a));
  perform unmask(a, t, '');
  perform tests.unbecome();
  return null;
exception when others then
  perform tests.unbecome();
  return sqlerrm;
end $$;

do $$
declare
  waiting uuid; dead uuid; earlier uuid; 
  w_end timestamptz := now() - interval '1 hour';
  said text;
begin
  perform pg_temp.first_window();
  -- A claim made now, on a window that ends after the Turn was asked and is not settled: the reveal waits.
  waiting := pg_temp.turning('core-claim-waiting');
  perform set_config('role', 'service_role', true);
  perform claim_settlement_window(w_end);
  perform tests.unbecome();
  said := pg_temp.reveal(waiting);
  if said is distinct from 'this character''s Turn takes effect at the settlement now running; reveal in a few minutes' then
    raise exception 'a reveal during the run that applies its Turn is refused, and says to try again in a few minutes: %', said;
  end if;
  -- Claimed twice (a second run on the same window): one claim, made afresh.
  perform set_config('role', 'service_role', true);
  perform claim_settlement_window(w_end);
  perform tests.unbecome();
  if (select count(*) from settlement_claims where settlement_claims.window_end = w_end) is distinct from 1::bigint then raise exception 'a window is claimed once'; end if;
  -- A claim on a window ending before the Turn was asked does not cover it.
  earlier := pg_temp.turning('core-claim-earlier');
  update pending_turns set asked_at = w_end + interval '10 minutes' where character = earlier;
  said := pg_temp.reveal(earlier);
  if said is not null then raise exception 'a claim on a window that ends before the Turn was asked leaves the reveal be: %', said; end if;
  -- A claim made six minutes ago by a run that died: its way out, by itself.
  update settlement_claims set claimed_at = now() - interval '6 minutes' where settlement_claims.window_end = w_end;
  dead := pg_temp.turning('core-claim-dead');
  said := pg_temp.reveal(dead);
  if said is not null then raise exception 'a claim five minutes old blocks no reveal: %', said; end if;
  -- Claimed afresh, then the window settled: the reveal goes through.
  update settlement_claims set claimed_at = now() where settlement_claims.window_end = w_end;
  if pg_temp.reveal(waiting) is null then raise exception 'the setup: a fresh claim refuses again'; end if;
  insert into settlements (starts_at, ends_at, season) values (w_end - interval '1 day', w_end, (select max(id) from seasons));
  said := pg_temp.reveal(waiting);
  if said is not null then raise exception 'once the claimed window is settled, the reveal goes through: %', said; end if;
end $$;

-- ---- Task 4 (#22): the claims are the service's alone ----
do $$
begin
  if has_table_privilege('authenticated', 'settlement_claims', 'select') or has_table_privilege('anon', 'settlement_claims', 'select') then
    raise exception 'no player reads the settle runs'' claims';
  end if;
  if has_function_privilege('authenticated', 'claim_settlement_window(timestamptz)', 'execute') or has_function_privilege('anon', 'claim_settlement_window(timestamptz)', 'execute') then
    raise exception 'no player claims a window';
  end if;
  if not has_function_privilege('service_role', 'claim_settlement_window(timestamptz)', 'execute') then raise exception 'the service claims a window'; end if;
end $$;

-- ---- Task 5 (#23): an announced Turn states the class it leaves, and nothing else ----
do $$
declare
  ann uuid := tests.account('core-turner');
  a uuid;
  tally uuid; entry jsonb; ended timestamptz; shown jsonb;
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
  select x.payload -> 'shown' into shown from acts x where x.kind = 'reveal' and x.payload ->> 'character' = a::text;
  if shown is null or not exists (select 1 from jsonb_array_elements(shown) e where e ->> 'kind' = 'turn' and e ->> 'was' = 'beta') then
    raise exception 'the season''s reveal lists the announced Turn with the class it left: %', shown;
  end if;
  if exists (select 1 from jsonb_array_elements(shown) e where e ? 'since') then raise exception 'the season''s reveal dates no Turn''s start: %', shown; end if;
end $$;
