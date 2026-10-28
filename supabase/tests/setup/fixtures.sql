-- A test instance and the helpers assertion files build on, applied once after the migrations
-- (tools/test-sql.mjs). The vocabulary is the engine's own test set, never an instance's: the
-- SQL is engine code and names no class, card or emoji of Divided World.
--
-- The helpers run as the harness's superuser, so a file makes its rows first and only then
-- impersonates a caller with tests.become(); a helper called while impersonating fails on the
-- privileges the caller lacks, which is the point.

insert into settings (key, value) values
  ('charactersPerPlayer', '6'),
  ('reactionCap', '3'),
  ('walletCap', '600'),
  ('vote', '10'),
  ('halving', '0.5'),
  ('settlementCron', '"17 8 * * *"'),
  ('seasonLength', '{"unit": "month", "count": 3}'),
  ('turnCooldown', '{"unit": "day", "count": 30}'),
  ('registrationMode', '"invite"');
insert into class_kinds (key, name) values ('alpha', 'Alpha'), ('beta', 'Beta');
insert into reaction_kinds (key, emoji, quadrant) values
  ('up', '⬆️', 'excitedPositive'), ('boo', '👻', 'excitedNegative'),
  ('calm', '🌊', 'calmPositive'), ('meh', '😑', 'boredNegative'), ('wow', '🎆', 'excitedPositive');
insert into card_kinds (key, name, alignment, base_price) values ('sweetie', 'Sweetie', 'sweet', 100), ('splat', 'Splat', 'salty', 100);
insert into boards (slug, name) values ('general', 'General');

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

-- A player: an auth user and their account.
create function tests.account(label text) returns uuid language plpgsql as $$
declare id uuid;
begin
  insert into auth.users (email) values (label || '@test.invalid') returning auth.users.id into id;
  insert into accounts (id) values (id);
  return id;
end $$;

-- A character of a player's, with its first class.
create function tests.character(owner uuid, name text, class_key text default 'alpha', at timestamptz default now()) returns uuid language plpgsql as $$
declare id uuid;
begin
  insert into characters (owner, name, created_at) values (owner, name, at) returning characters.id into id;
  insert into class_history (character, class_key, started_at) values (id, class_key, at);
  return id;
end $$;

create function tests.thread(title text default 'A thread') returns uuid language sql as $$
  insert into threads (board, title) select b.id, title from boards b where b.slug = 'general' returning id
$$;

-- An Act, written as the action functions will write it.
create function tests.act(by_character uuid, kind text, in_thread uuid, payload jsonb default '{}', target uuid default null, at timestamptz default now()) returns uuid language sql as $$
  insert into acts (character, kind, thread, payload, target_act_id, created_at) values (by_character, kind, in_thread, payload, target, at) returning id
$$;

create function tests.post(by_character uuid, in_thread uuid, body text default 'Hello.', at timestamptz default now()) returns uuid language sql as $$
  select tests.act(by_character, 'post', in_thread, jsonb_build_object('body', body), null, at)
$$;

-- Be a signed-in player until tests.unbecome(), or the end of the file's transaction.
create function tests.become(account uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', account, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Be a visitor with no session.
create function tests.become_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end $$;

create function tests.unbecome() returns void language plpgsql as $$
begin
  -- RESET ROLE needs no privilege; switching to postgres by name would.
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
