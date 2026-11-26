-- A test instance and the helpers assertion files build on, applied once after the migrations
-- (tools/test-sql.mjs). The vocabulary is the engine's own test set, never an instance's: the
-- SQL is engine code and names no class, card or emoji of Divided World.
--
-- The helpers run as the harness's superuser, so a file makes its rows first and only then
-- impersonates a caller with tests.become(); a helper called while impersonating fails on the
-- privileges the caller lacks, which is the point.

-- The instance below is the code's, as a seed writes it, so its settings rows are not marked tuned (0355's trigger marks every write but a seed's, which
-- sets this for its transaction). This is the fixtures' own session, which ends with the file. A test that needs a tuned row writes one.
select set_config('kayfabb.seeding', 'on', false);
insert into settings (key, value) values
  ('charactersPerPlayer', '6'),
  ('reactionCap', '3'),
  ('postEffects', '8'),
  ('crowdPayEach', '2'),
  ('crowdFloor', '2'),
  ('crowdPayMost', '10'),
  ('walletCap', '600'),
  ('vote', '10'),
  ('halving', '0.5'),
  ('debateDays', '3'),
  ('settlementCron', '"17 8 * * *"'),
  ('viewCountCron', '"41 * * * *"'),
  ('settlementLength', '{"unit": "day", "count": 1}'),
  -- Long enough that no file's settlement ends the season by chance; a file that reveals one sets its own.
  ('seasonLength', '{"unit": "month", "count": 1000}'),
  ('turnCooldown', '{"unit": "day", "count": 30}'),
  ('registrationMode', '"invite"'),
  ('invitesPerPlayer', '3'),
  ('inviteLifetime', '{"unit": "day", "count": 7}'),
  ('editGrace', '{"unit": "minute", "count": 2}'),
  ('postMaxLength', '20000'),
  -- A poll (0395): the most options, the longest question and option, and the least and most a poll may last (spans may count hours).
  ('pollOptionsMax', '10'),
  ('pollQuestionMax', '200'),
  ('pollOptionMax', '100'),
  ('pollLastsMin', '{"unit": "hour", "count": 1}'),
  ('pollLastsMax', '{"unit": "day", "count": 14}'),
  -- The code of conduct (0340): its version, its sections' keys, and the most open reports an account holds.
  ('conductVersion', '1'),
  ('conductSections', '["mask", "hate", "outing"]'),
  ('conduct', '{"openReportsMost": 3, "adminAddress": null}'),
  ('titleMaxLength', '120'),
  ('postsPerPage', '20'),
  ('hotReplies', '10'),
  ('presenceWindow', '{"unit": "minute", "count": 5}'),
  ('presenceNames', '15'),
  ('presencePollSeconds', '30'),
  ('setLasts', '{"unit": "day", "count": 7}'),
  ('reachRarity', '{"character": "uncommon", "thread": "rare", "board": "legendary"}'),
  ('reachLasts', '{"character": {"unit": "day", "count": 7}, "thread": {"unit": "day", "count": 1}, "board": {"unit": "day", "count": 1}}'),
  ('cardSettings', '{"whoops.clean": 95}'),
  ('economy', '{}'),
  -- The season thread's title is the word The System needs (0440 renamed it rosterThreadTitle; 0099 made it the one word). The older keys stay in this row because the e2e files that load it
  -- onto the migrations before 0099 (e2e/0008, 0010, 0014) meet the check those migrations kept; 0099 stops asking for them.
  ('copy', '{"rosterThreadTitle": "Season {season}: Promos", "announcementsThreadTitle": "Season {season}: Promos", "turnsThreadTitle": "Season {season}: Turns", "revealTitle": "Season {season}: The Reveal", "revealBody": "Every mask, season {season}."}');
insert into class_kinds (key, name) values ('alpha', 'Alpha'), ('beta', 'Beta');
insert into reaction_kinds (key, emoji, quadrant) values
  ('up', '⬆️', 'excitedPositive'), ('boo', '👻', 'excitedNegative'),
  ('calm', '🌊', 'calmPositive'), ('meh', '😑', 'boredNegative'), ('wow', '🎆', 'excitedPositive');
-- Three cards: sweetie and splat, and a card that stacks three to a post, each play drawn from a seed the server chooses. A card's price is its
-- slot's from 0139, on sale here at one orb; before it, the economy's (card_kinds.price_setting). The e2e files that load these onto the migrations
-- before 0139 (e2e/0010, 0014) meet the older shape, so this meets whichever it finds.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'card_kinds' and column_name = 'price_setting') then
    update settings set value = '{"sweetie.price": 100, "splat.price": 100, "blot.price": 100}' where key = 'economy';
    insert into card_kinds (key, name, alignment, price_setting) values ('sweetie', 'Sweetie', 'sweet', 'sweetie.price'), ('splat', 'Splat', 'salty', 'splat.price');
    insert into card_kinds (key, name, alignment, price_setting, stack, seeded) values ('blot', 'Blot', 'salty', 'blot.price', 3, true);
  else
    insert into card_kinds (key, name, alignment) values ('sweetie', 'Sweetie', 'sweet'), ('splat', 'Splat', 'salty');
    insert into card_kinds (key, name, alignment, stack, seeded) values ('blot', 'Blot', 'salty', 3, true);
    insert into machine_slots (position, card, availability, price) values (1, 'sweetie', 'onSale', 100), (2, 'splat', 'onSale', 100), (3, 'blot', 'onSale', 100);
  end if;
end $$;
insert into boards (slug, name, is_system) values ('general', 'General', false), ('the-system', 'The System', true);
insert into seasons (number, starts_at) values (1, '2000-01-01T00:00:00Z');
insert into pip_styles (key, name, full_image, empty_image) values ('default', 'Default', 'full.svg', 'empty.svg'), ('stars', 'Stars', 'star.svg', 'hollow.svg');

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

-- A player: an auth user and their account, opened when the fixture's season began, so what a test makes later arrived after the
-- player joined (a mark that was never set counts from the account's opening: 0066). A test of joining sets created_at itself.
create function tests.account(label text) returns uuid language plpgsql as $$
declare id uuid;
begin
  insert into auth.users (email) values (label || '@test.invalid') returning auth.users.id into id;
  insert into accounts (id, created_at) values (id, '2000-01-01T00:00:00Z');
  return id;
end $$;

-- A character of a player's, with its first class. It has debuted, as one a settlement has passed since; a character made by create_character is active at once, as this one is.
create function tests.character(owner uuid, name text, class_key text default 'alpha', at timestamptz default now()) returns uuid language plpgsql as $$
declare id uuid;
begin
  insert into characters (owner, name, created_at, debuted_at) values (owner, name, at, at) returning characters.id into id;
  insert into class_history (character, class_key, started_at) values (id, class_key, at);
  return id;
end $$;

-- A character that has not debuted: the state a staff persona waits in until an office debuts it (0082), and the one no player character is made in. Nothing debuts it but an office, so a test
-- of what a waiting character cannot do makes one here.
create function tests.waiting(owner uuid, name text, class_key text default 'alpha', at timestamptz default now()) returns uuid language plpgsql as $$
declare id uuid;
begin
  insert into characters (owner, name, created_at) values (owner, name, at) returning characters.id into id;
  insert into class_history (character, class_key, started_at) values (id, class_key, at);
  return id;
end $$;

-- The slot that sells a card.
create function tests.slot(card text) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare found uuid;
begin
  select s.id into found from machine_slots s where s.card = slot.card;
  return found;
end $$;

create function tests.thread(title text default 'A thread') returns uuid language sql as $$
  insert into threads (board, title) select b.id, title from boards b where b.slug = 'general' returning id
$$;

-- An Act, written as the action functions will write it.
create function tests.act(by_character uuid, kind text, in_thread uuid, payload jsonb default '{}', target uuid default null, at timestamptz default now()) returns uuid language sql as $$
  insert into acts (character, kind, thread, payload, target_act_id, created_at) values (by_character, kind, in_thread, payload, target, at) returning id
$$;

-- A debut announcement as the settlement wrote one before 0436: an old Act, read as a reveal, a clue and a post's author's. Nothing writes one now (acts_well_formed refuses it), so a test
-- that needs an old one stands the trigger down for the insert, which a rollback gives back. Standing the trigger down skips every acts_well_formed check for that insert, and `alter table` takes a lock that
-- keeps acts locked until the transaction ends. Answers the Act's projection, as write_announce does.
create function tests.old_debut(of_character uuid, in_thread uuid, cls text default null, at timestamptz default now()) returns jsonb language plpgsql as $$
declare written uuid;
begin
  alter table acts disable trigger acts_well_formed;
  insert into acts (character, kind, thread, payload, created_at)
  values (of_character, 'announce', in_thread, jsonb_build_object('what', 'debut') || case when cls is not null then jsonb_build_object('class', cls) else '{}'::jsonb end, at)
  returning id into written;
  alter table acts enable trigger acts_well_formed;
  return act_projection(written);
end $$;

create function tests.post(by_character uuid, in_thread uuid, body text default 'Hello.', at timestamptz default now()) returns uuid language sql as $$
  select tests.act(by_character, 'post', in_thread, jsonb_build_object('body', body), null, at)
$$;

-- Elsewhere in the instance, in a thread of their own: `veils` posts each under a live author veil, and `ended` card plays each ended by a card_end Act. These are what the files before a read-cost guard leave committed (the race files
-- write through dblink), and what made acts_public's author-veil check a hashed read of every veil and card_end for each probe of one post (0434_reads_bounded_on_any_plan.sql). A guard plants them so that it measures in that state
-- on every run, not only on the runs whose earlier files happened to leave them. Returns the thread.
create function tests.plant_live_veils(veils integer, ended integer) returns uuid language plpgsql as $$
declare
  tag text := substr(md5(random()::text), 1, 8);
  a uuid := tests.character(tests.account('pv-ann-' || tag), 'Pv Ann ' || tag);
  b uuid := tests.character(tests.account('pv-bea-' || tag), 'Pv Bea ' || tag);
  t uuid := tests.thread('Planted veils ' || tag);
  base timestamptz := now() - interval '1 day';
  p uuid; play uuid; i integer;
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack) values ('pvveil', 'Pv Veil', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1) on conflict do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack) values ('pvplain', 'Pv Plain', 'salty', 'rare', 'cast', '{post}', interval '3 days', 1) on conflict do nothing;
  for i in 1..greatest(veils, ended) loop
    p := tests.act(a, 'post', t, jsonb_build_object('body', 'Planted ' || i), null, base + i * interval '1 second');
    if i <= veils then
      play := tests.act(b, 'card', t, jsonb_build_object('card', 'pvveil', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() + interval '1 day'), p, base + i * interval '1 second');
      insert into post_veils (play, post, veil, author, ends_at) values (play, p, 'author', a, now() + interval '1 day');
    end if;
    if i <= ended then
      play := tests.act(b, 'card', t, jsonb_build_object('card', 'pvplain', 'message', '', 'config', '{}'::jsonb, 'layer', 2), p, base + i * interval '1 second');
      perform set_config('kayfabb.card_end_writer', 'on', true);
      insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, play, '{"why": "reversed", "by": "admin"}');
      perform set_config('kayfabb.card_end_writer', '', true);
    end if;
  end loop;
  -- analyzed, as the files before a guard leave them (each file runs after a `vacuum (analyze)`): the planner then knows the veils are few, which is when it hashes them
  analyze post_veils; analyze post_veil_cover; analyze card_write_refunds;
  return t;
end $$;

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

-- Commits the four shards of debuted_count, empty, so a race test can debut characters from two sessions. A fresh instance
-- holds no shard (characters_count_debuted() makes one on the first debut), and a file's open transaction that has debuted
-- a character holds shard 0 uncommitted: a racer that debuts another then picks shard 0 too (none committed to skip) and
-- waits on a transaction that ends only after the race. With all four committed, the open transaction locks one and the
-- racer's `for update skip locked` takes another. Called before the file's own transaction debuts anyone.
create function tests.commit_debuted_shards() returns void language sql as $$
  select tests.commit('insert into debuted_count (shard, characters) values (0, 0), (1, 0), (2, 0), (3, 0) on conflict (shard) do nothing');
$$;

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
  tries integer := 0; max_tries constant integer := 1200;
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
      -- Gives up at 30 s, the lock_timeout (tools/test-sql.mjs, SESSION_BOUNDS), 1200 looks of 25 ms: the pool runs several files at once, so a parked session can take seconds to show here on a loaded runner. The loop leaves the moment the wait shows, so the bound is only how long a broken race takes to fail.
      if tries > max_tries then raise exception 'tests.race: the two sessions never both reached the barrier'; end if;
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

-- A pending announced Turn as it was queued before turns were announced at once (0435): announced, naming what its player chose, with no announcement
-- written (announce_act null), so the settlement writes it the old way, in the season's Promos thread. As turn() wrote the row then.
create function tests.queue_old_turn(c uuid, to_class text, show_from boolean default false, show_to boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- plpgsql, so that fixtures.sql still loads on the older schemas the end-to-end files build it on (pending_turns has no due_at before 0100).
  insert into pending_turns (character, class_key, loudness, show_from, show_to) values (c, to_class, 'announced', show_from, show_to)
  on conflict (character) do update set class_key = excluded.class_key, loudness = 'announced', show_from = excluded.show_from, show_to = excluded.show_to, asked_at = clock_timestamp(), due_at = null;
end $$;
