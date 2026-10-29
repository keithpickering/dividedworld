-- The settlement job's database side: the instance's vocabulary arriving as data, the schedule,
-- the next window, and what one window's settlement reads.
--
-- Task 8 of docs/plans/2026-10-28-core-loop-engine-plan.md. The job itself is
-- supabase/functions/settle/: pg_cron fires it at the instance's settlementCron, it asks for the
-- next window, reads the window's input, runs the engine's settle() with the instance, and calls
-- apply_settlement() (0003). Every function here is the service role's alone.
--
-- pg_cron and pg_net are created when the database has them (a Supabase project does) and
-- stood in for by the harness when it does not (supabase/tests/setup/auth-shim.sql): bare
-- Postgres raises feature_not_supported, caught by that code alone, so any other failure still
-- stops the migration. The function's URL and the key it is called with live in Vault, never in
-- this file; until both secrets exist the job sends nothing rather than a request with no URL.

create index acts_thread_posts on acts (thread, character, created_at, id) where kind = 'post';

do $$ begin
  execute 'create extension if not exists pg_cron';
exception when feature_not_supported or undefined_file then
  raise notice 'pg_cron is not installable here; the harness stands in for it';
end $$;
do $$ begin
  execute 'create extension if not exists pg_net with schema extensions';
exception when feature_not_supported or undefined_file then
  raise notice 'pg_net is not installable here; the harness stands in for it';
end $$;

-- ------------------------------------------------------------------ the instance arrives ----

-- Write an instance's vocabulary and numbers: `{settings, classes, reactions, cards, boards}`,
-- as supabase/functions/_shared/seed.ts builds it from the Instance the composition root holds.
-- A kind is added or renamed, never removed (the rows that name it stay); a board is added once
-- and then belongs to the instance's admins. A fresh instance's first season opens with it.
create function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = excluded.value;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  insert into card_kinds (key, name, alignment, price_setting)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', e ->> 'priceSetting' from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment, price_setting = excluded.price_setting;
  insert into boards (slug, name, description)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', '') from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do nothing;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;

-- ------------------------------------------------------------------------ the schedule ----

-- (Re)schedule the job at the instance's settlementCron. The body carries the minute before
-- the one the job fired in: a window closes a minute before the job reads it, so an Act or a
-- reaction whose transaction began just before the boundary and committed just after (its
-- created_at is its transaction's start) is in the window it is stamped in, not one already
-- read. The same `until` sent again (a call retried by hand) asks for a window already settled,
-- and is a no-op.
create function schedule_settlement() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-settle', setting('settlementCron') #>> '{}', $job$
    select net.http_post(
      url := s.base || '/functions/v1/settle',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || s.secret),
      body := jsonb_build_object('until', date_trunc('minute', now()) - interval '1 minute'),
      timeout_milliseconds := 60000
    )
    from (
      select (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_functions_url') as base,
             (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_service_key') as secret
    ) s
    where s.base is not null and s.secret is not null
  $job$);
end $$;

create function settings_reschedule() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform schedule_settlement();
  return null;
end $$;
create trigger settings_reschedule after insert or update on settings
  for each row when (new.key = 'settlementCron') execute function settings_reschedule();

-- ----------------------------------------------------------------------- the windows ----

-- The next window to settle, up to `until`: from where the last settled window ended (or the
-- first season's start), to `until` or its season's end, whichever is sooner, so no window
-- ever straddles two seasons. Where no season holds that instant (a gap between two seasons),
-- the window starts at the next season's start; null when there is nothing to settle yet.
create function next_settlement_window(until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  start_at timestamptz;
  season_end timestamptz;
  end_at timestamptz;
  found boolean;
begin
  select coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons)) into start_at;
  if start_at is null then return null; end if;
  select true, s.ends_at into found, season_end from seasons s
  where s.starts_at <= start_at and (s.ends_at is null or s.ends_at > start_at);
  if not coalesce(found, false) then
    select s.starts_at, s.ends_at into start_at, season_end from seasons s where s.starts_at > start_at order by s.starts_at limit 1;
    if start_at is null then return null; end if;
  end if;
  end_at := least(until, coalesce(season_end, until));
  if end_at <= start_at then return null; end if;
  return jsonb_build_object('start', start_at, 'end', end_at);
end $$;

-- Everything one window's settlement reads, in the shape engine/rules/types.ts names
-- SettlementInput, times in epoch milliseconds: the window's Acts and reactions; every earlier
-- reaction on an Act reacted to in the window (for the shared vote, the rank and where a post
-- ends up); every Act those touch (a reacted-to post, a card's or a spin's target); for each
-- spun thread active in the window, its spin and each character's first post in it (for its
-- repliers); and every character named, with its player and its classes. Who reacted leaves
-- the database only here, to the service role, for the settlement's arithmetic.
create function settlement_input(window_start timestamptz, window_end timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with
  -- The System's own Acts (the reveal) are no character's, and nobody's to settle.
  win_acts as (select * from acts a where a.created_at >= window_start and a.created_at < window_end and a.character is not null),
  win_reactions as (select * from reactions r where r.created_at >= window_start and r.created_at < window_end),
  reacted as (select distinct act from win_reactions),
  earlier_reactions as (select r.* from reactions r join reacted x on x.act = r.act where r.created_at < window_start),
  active_spun as (select distinct t.id from threads t join win_acts a on a.thread = t.id where t.origin_act_id is not null),
  spins as (select a.* from acts a join active_spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    -- Each character's first post in the thread, read through acts_thread_posts, one per
    -- character rather than a sort of the whole thread.
    select f.* from active_spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.* from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  touched as (
    select id from win_acts union select act from reacted
    union select target_act_id from win_acts where kind in ('card', 'spin') and target_act_id is not null
    union select id from spins union select target_act_id from spins where target_act_id is not null
    union select id from first_posts
  ),
  all_acts as (select a.* from acts a join touched t on t.id = a.id where a.created_at < window_end and a.character is not null),
  system_acts as (select a.id from acts a join touched t on t.id = a.id where a.character is null),
  all_reactions as (select * from win_reactions union all select * from earlier_reactions),
  named as (select character as id from all_acts union select reactor_character from all_reactions),
  ms as (select 1)
  select jsonb_build_object(
    'window', jsonb_build_object('id', to_jsonb(window_start) #>> '{}',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'player', c.owner, 'classes', coalesce((
        select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
        from class_history h where h.character = c.id and h.started_at < window_end), '[]')) order by c.id)
      from characters c join named n on n.id = c.id), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'target', a.target_act_id,
        'card', case when a.kind = 'card' then a.payload ->> 'card' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'at', (extract(epoch from r.created_at) * 1000)::bigint,
        'player', r.reactor_account, 'character', r.reactor_character) order by r.created_at, r.id)
      from all_reactions r), '[]'),
    -- The System's Acts an input Act points at (a spin from the reveal): named, never settled.
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'))
$$;

-- Every setting as the rows hold it now, for the functions that run the instance's rules, so
-- what an admin tunes in a row reaches the settlement and the Vending Machine without a deploy.
create function instance_settings() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(key, value), '{}') from settings
$$;

revoke execute on function instance_settings() from public, anon, authenticated;
grant execute on function instance_settings() to service_role;

revoke execute on function seed_instance(jsonb), schedule_settlement(), settings_reschedule(),
  next_settlement_window(timestamptz), settlement_input(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function seed_instance(jsonb), next_settlement_window(timestamptz), settlement_input(timestamptz, timestamptz) to service_role;
