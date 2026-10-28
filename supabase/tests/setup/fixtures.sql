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
  ('registrationMode', '"invite"'),
  ('postMaxLength', '20000'),
  ('titleMaxLength', '120');
insert into class_kinds (key, name) values ('alpha', 'Alpha'), ('beta', 'Beta');
insert into reaction_kinds (key, emoji, quadrant) values
  ('up', '⬆️', 'excitedPositive'), ('boo', '👻', 'excitedNegative'),
  ('calm', '🌊', 'calmPositive'), ('meh', '😑', 'boredNegative'), ('wow', '🎆', 'excitedPositive');
insert into card_kinds (key, name, alignment, base_price) values ('sweetie', 'Sweetie', 'sweet', 100), ('splat', 'Splat', 'salty', 100);
insert into boards (slug, name) values ('general', 'General');
insert into seasons (number, starts_at) values (1, '2000-01-01T00:00:00Z');

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

-- ---- Races ----
-- A race test needs two sessions at once, which one assertion file cannot be: it opens two
-- connections to the scratch database (dblink, which Supabase also offers), parks both on an
-- advisory lock this session holds until both are seen waiting on it, and lets them go
-- together. Rows they read must be committed, so a race test sets up through tests.commit(),
-- which runs its SQL on a connection of its own and commits it; the scratch database is dropped
-- at the end of the run, so nothing is left.
create extension if not exists dblink with schema extensions;

create function tests.commit(statements text) returns void language plpgsql as $$
begin
  perform extensions.dblink_connect('tests_setup', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_exec('tests_setup', statements);
  perform extensions.dblink_disconnect('tests_setup');
end $$;

-- One racer: waits at the barrier, becomes `who` (an account, or null for the service role),
-- runs one statement, and returns null, or the error it raised. One statement on the wire, so
-- dblink returns this function's answer and nothing of the racer's is lost.
create function tests.raced(who uuid, stmt text) returns text language plpgsql as $$
begin
  -- A lock the racers wait on that the test's own transaction holds would hang both; this
  -- makes that a failure with a name.
  perform set_config('lock_timeout', '20s', true);
  perform pg_advisory_xact_lock_shared(4242);
  if who is null then
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
    perform set_config('role', 'service_role', true);
  else
    perform set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- Runs two racers at the same instant and returns what each said.
create function tests.race_as(who_a uuid, stmt_a text, who_b uuid, stmt_b text) returns text[] language plpgsql as $$
declare
  url text := current_setting('kayfabb.scratch_url');
  out text[] := '{}';
  said text;
  conn text;
  waiting integer;
  tries integer := 0;
begin
  perform pg_advisory_lock(4242);
  begin
    perform extensions.dblink_connect('race_a', url);
    perform extensions.dblink_connect('race_b', url);
    perform extensions.dblink_send_query('race_a', format('select tests.raced(%L, %L)', who_a, stmt_a));
    perform extensions.dblink_send_query('race_b', format('select tests.raced(%L, %L)', who_b, stmt_b));
    -- Both parked on the barrier before it lifts, or the race is a sequence and proves nothing.
    loop
      select count(*) into waiting from pg_locks l
      where l.locktype = 'advisory' and l.objid = 4242 and not l.granted and l.database = (select oid from pg_database where datname = current_database());
      exit when waiting >= 2;
      tries := tries + 1;
      if tries > 400 then raise exception 'tests.race: the two sessions never both reached the barrier'; end if;
      perform pg_sleep(0.025);
    end loop;
  exception when others then
    perform pg_advisory_unlock(4242);
    raise;
  end;
  perform pg_advisory_unlock(4242);
  foreach conn in array array['race_a', 'race_b'] loop
    begin
      select r.said into said from extensions.dblink_get_result(conn) as r(said text);
      out := out || said;
      perform * from extensions.dblink_get_result(conn) as r(said text);
    exception when others then
      perform extensions.dblink_disconnect(conn);
      raise;
    end;
    perform extensions.dblink_disconnect(conn);
  end loop;
  return out;
end $$;

-- Two players' statements at once.
create function tests.race(account_a uuid, stmt_a text, account_b uuid, stmt_b text) returns text[] language sql as $$
  select tests.race_as(account_a, stmt_a, account_b, stmt_b)
$$;

-- Two of the service role's statements at once, as two Edge Function runs.
create function tests.race_service(stmt_a text, stmt_b text) returns text[] language sql as $$
  select tests.race_as(null, stmt_a, null, stmt_b)
$$;

-- Be the service role, as an Edge Function holding the service key is.
create function tests.become_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;
