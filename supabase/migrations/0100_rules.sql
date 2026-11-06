-- Rules (Mod Bots design, section 4; its plan, Task 3): move kinds name the offices that may make them, the predicates a rule may
-- demand are a catalog seeded from the engine's one list (engine/rules/predicates.ts), `rules_now` is the rules in force, `rule_conflict`
-- refuses a rule that would leave no compliant post, and `rule_breaks` says which rules a post breaks. A rule never refuses a post: it
-- draws a visit (Task 6), so this file only reads.
--
-- Two lists, one list: `rule_breaks` has a branch for every key of `rule_predicates` and raises `no check for predicate %` for a key that
-- has none; supabase/tests/0102-rule-predicates.sql proves it, and its poison is a planted key with no branch.
--
-- Reads by index, on a busy instance: a post's previous post in its thread is the (thread, seq) unique index walked back one entry; a
-- thread's quiet is the time of that same post; a board's live titles are `threads_board_title` below. A post is checked against only
-- the rules in force (a handful: moves expire and the bank bounds them), never against every post.
--
-- A rule compares characters, never accounts: noDoublePost reads the previous post's character, so a reply under another mask of
-- the same account is not a double post ("A response never proves a private fact").
--
-- Its way out: a rule ends by its expiry, its demand, or an admin's reversal, as every move does (0046); nothing here holds a player.

-- ------------------------------------------------------------------------------------- the catalogs ----

-- Which offices may make a move (the Boss, a Mod): seeded from the engine's catalog. A kind seeded before this file is the Boss's.
alter table move_kinds add column offices text[] not null default '{boss}' check (offices <> '{}' and offices <@ array['boss', 'mod']);

-- The predicates a rule may name, as the engine lists them. `param_kind` is none, count, word or tag; `least` and `most` bound a count
-- or a word's length; `plain` is the rule in plain words with `{param}` where the parameter goes.
create table rule_predicates (
  key text primary key,
  param_kind text not null check (param_kind in ('none', 'count', 'word', 'tag')),
  least integer,
  most integer,
  plain text not null
);
alter table rule_predicates enable row level security;
revoke all on rule_predicates from public, anon, authenticated;

-- seed_instance (0091), also seeding each move kind's offices and the rule predicates. Everything else as 0091 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the price of one
  -- the code no longer sells stays in the row with it (settings_economy_whole, 0006).
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  -- Reaction kinds are the one vocabulary a seed removes. Classes and cards never are: a card's price must outlive the card
  -- (0006). A reaction kind has nothing that must outlive it once nothing uses it, and a kind something does use is never removed.
  if payload ? 'reactions' then
    select string_agg(k.key || ' (' || (select count(*) from reactions r where r.kind = k.key) || ' reactions)', ', ' order by k.key) into unknown
    from reaction_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key)
      and (exists (select 1 from reactions r where r.kind = k.key) or exists (select 1 from reaction_tallies t where t.kind = k.key));
    if unknown is not null then
      raise exception 'the instance no longer lists reaction kinds that reactions use: %; a used kind is never removed (#216)', unknown using errcode = '22023';
    end if;
    -- `not exists`, not `not in`: an element with no key would make `not in` null for every kind, hiding a used one.
    delete from reaction_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key);
  end if;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- A card's play, rarity, trap, ward and time up (0054), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name and price are; so
  -- are its rarity, its play, its trap, whether it is a ward, how long a Use of it is up, where it reaches and whether it pins.
  insert into card_kinds (key, name, alignment, price_setting, stack, seeded, reads, rarity, play, trap, ward, lasts, reaches, pins)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', e ->> 'priceSetting', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), e -> 'trap', coalesce((e ->> 'ward')::boolean, false), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment, price_setting = excluded.price_setting,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, ward = excluded.ward, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins;
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  -- A seed naming one slug twice is refused by the upsert ("cannot affect row a second time"),
  -- where 0004 took its first; an instance never holds one (instanceProblems).
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false) from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  -- A pip style is added or renamed, never removed: a profile may name it.
  insert into pip_styles (key, name, full_image, empty_image)
  select e ->> 'key', e ->> 'name', e ->> 'full', e ->> 'empty' from jsonb_array_elements(coalesce(payload -> 'pipStyles', '[]')) e
  on conflict (key) do update set name = excluded.name, full_image = excluded.full_image, empty_image = excluded.empty_image;
  -- The instance's personas (0082), once each: a persona is made when its key has no character yet, with the profile its seed gives (its
  -- title and its signature, cut to what a profile holds). The first Boss and the first staff debut at seed time; every other persona
  -- is made waiting, with no debut, and debuts the moment it first takes an office. What an admin wrote is never written over: a reseed
  -- finds the key and does nothing. A persona in firstStaff with no office row is hired as a Mod Bot, cause `seed`; one with a row,
  -- a benched one's included, is left as that row says, so a reseed never rehires.
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature)
  select m.id, left(s.title, 40), left(s.signature, 500) from made m join seeded s on s.staff = m.staff;
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona');
  if unknown is not null then raise exception 'firstStaff names %, which no persona in the seed''s roster is', unknown using errcode = '22023'; end if;
  insert into staff_offices (staff, office, cause)
  select k, 'mod', 'seed' from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_offices x where x.staff = k);
  -- A persona the seed seats as a mod is debuted: a reseed that adds a still-waiting persona to firstStaff hires it above, and it debuts here.
  update characters c set debuted_at = now()
  where c.debuted_at is null and c.staff_kind = 'persona'
    and c.staff in (select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k)
    and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod');
  -- The name of the member group every persona is in, which the instance gives.
  insert into settings (key, value)
  select 'staffGroup', payload -> 'system' -> 'staffGroup' where jsonb_typeof(payload -> 'system' -> 'staffGroup') = 'object'
  on conflict (key) do update set value = excluded.value;
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board, offices)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, offices = excluded.offices;
  -- The rule predicates (0100), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, plain = excluded.plain;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  insert into settings (key, value)
  select 'bossRoster', jsonb_agg(e.value ->> 'key' order by e.ord)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
  having count(*) > 0
  on conflict (key) do update set value = excluded.value;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  -- The open season's Boss (0043's seasons.boss) is the seed's firstBoss when it has none: a season opened before a Boss
  -- existed, or by this seed. A season that already has a Boss keeps it.
  if nullif(payload -> 'system' ->> 'firstBoss', '') is not null then
    update seasons set boss = payload -> 'system' ->> 'firstBoss' where ends_at is null and boss is null;
  end if;
  -- The announcements thread: the one thread on The System's board where a landed move is written and a move's end is said. Made once,
  -- titled from the seed (`system.announcementsTitle`), and its id recorded in the setting `systemAnnouncements` where the tick finds it.
  -- A reseed finds the setting (and the thread it names) and makes nothing; a seed with no title makes none, and until a seed has one
  -- the tick lands nothing (a board with nowhere to say a move is no board it can move). The setting is not in a seed's `settings`,
  -- so no seed writes it over.
  if nullif(payload -> 'system' ->> 'announcementsTitle', '') is not null
     and not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements') then
    with made as (
      insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id
    )
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(made.id::text) from made
    on conflict (key) do update set value = excluded.value;
  end if;
  -- The developer persona and its thread (0062): a seed with a `developer` entry ({ name, title, avatar }) makes the one developer, once,
  -- as it makes a persona: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
  -- never written over: a reseed finds the key and does nothing, except that the avatar's asset key is the instance's to change. Then
  -- the updates thread, on The System's board, recorded in the setting `updatesThread` (not in a seed's `settings`, so no seed
  -- writes it over); the board's thread counter is netted by the thread's own, since a board's count is the length of its list and
  -- thread_list never lists this one.
  if jsonb_typeof(payload -> 'developer') = 'object' then
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '' from made m;
    if nullif(payload -> 'developer' ->> 'avatar', '') is not null then
      insert into settings (key, value) values ('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'))
      on conflict (key) do update set value = excluded.value;
    end if;
    if not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'updatesThread') then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      insert into settings (key, value) values ('updatesThread', to_jsonb(opened::text)) on conflict (key) do update set value = excluded.value;
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;

-- ---------------------------------------------------------------------------------------- indexes ----

-- A board's live titles, for noDuplicateTitle: one probe per new thread, by the title as the rule reads it (case and edge space ignored).
create index threads_board_title on threads (board, lower(btrim(title)));

-- ---------------------------------------------------------------------------------------- rules_now ----

-- The rules in force: each open `setRule` move with its board (null: every board), predicate, parameter (null: none), band, number, and
-- the staff member who made it. A rule is numbered among its board's rules in landing order ("Rule 2"); the every-board rules are
-- numbered on their own ("House Rule 2"). The number is of the rules in force, so it falls when an earlier rule ends.
create view rules_now as
  select o.move_act,
         nullif(a.payload #>> '{params,board}', '')::uuid as board,
         a.payload #>> '{params,predicate}' as predicate,
         nullif(a.payload #> '{params,param}', 'null'::jsonb) as param,
         a.payload #>> '{params,band}' as band,
         (row_number() over (partition by (a.payload #>> '{params,board}') order by o.landed_at, o.move_act))::integer as number,
         c.staff as staff,
         o.landed_at,
         (a.payload ->> 'expires_at')::timestamptz as expires_at
  from open_moves o
  join acts a on a.id = o.move_act and a.kind = 'move' and a.payload ->> 'kind' = 'setRule'
  join characters c on c.id = a.character;
revoke all on rules_now from public, anon, authenticated;

-- ------------------------------------------------------------------------------------ conflicts ----

-- A regular expression that matches a string literally.
create function regex_escape(raw text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select regexp_replace(raw, '([.^$|?*+()\[\]{}\\])', '\\\1', 'g')
$$;
revoke execute on function regex_escape(text) from public, anon, authenticated;

-- What is wrong with a rule's params as the database holds them, or null: a board that is none or a board, a predicate in the catalog, a
-- parameter of the predicate's kind within its bounds, a band. The engine checks the same (engine/rules/predicates.ts); this is the
-- second door, for a queue row that did not come through the engine.
create function rule_params_problem(params jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p rule_predicates%rowtype;
  given jsonb := nullif(params -> 'param', 'null'::jsonb);
  board jsonb := nullif(params -> 'board', 'null'::jsonb);
begin
  if jsonb_typeof(params) is distinct from 'object' then return 'the params are no object'; end if;
  if board is not null and (jsonb_typeof(board) <> 'string' or not exists (select 1 from boards b where b.id::text = lower(params ->> 'board') and not b.is_system)) then
    return 'the board is no board of the players'; end if;
  if params ->> 'band' is null or params ->> 'band' not in ('minor', 'moderate', 'severe') then return 'the band is minor, moderate or severe'; end if;
  select * into p from rule_predicates x where x.key = params ->> 'predicate';
  if not found then return format('there is no predicate "%s"', coalesce(params ->> 'predicate', '')); end if;
  if p.param_kind = 'none' then
    if given is not null then return format('%s takes no parameter', p.key); end if;
  elsif given is null then return format('%s needs a parameter', p.key);
  elsif p.param_kind = 'count' then
    if jsonb_typeof(given) <> 'number' or (given #>> '{}') !~ '^[0-9]+$' or (given #>> '{}')::numeric < p.least or (given #>> '{}')::numeric > p.most then
      return format('%s takes a whole number from %s to %s', p.key, p.least, p.most); end if;
  elsif p.param_kind = 'word' then
    if jsonb_typeof(given) <> 'string' or char_length(given #>> '{}') not between p.least and p.most or (given #>> '{}') ~ '\s' then
      return format('%s takes one word of %s to %s characters', p.key, p.least, p.most); end if;
  elsif p.param_kind = 'tag' then
    if jsonb_typeof(given) <> 'string' or (given #>> '{}') !~ '^[a-z]+$' then return format('%s takes a tag name', p.key); end if;
  end if;
  return null;
end $$;
revoke execute on function rule_params_problem(jsonb) from public, anon, authenticated;

-- The plain reason a new rule would leave no compliant post against the rules in force where it would apply, or null. A rule on one board
-- applies there and wherever an every-board rule does; an every-board rule applies on every board, so it meets the rules of all of them.
-- The pairs: a banned word that is also required (either way round); a minimum length above a maximum (either way round); a tag that a
-- required word is only written with (none is today: a word is plain text and a tag is not part of one, kept as the pattern for the day a
-- predicate makes one); a second rule of the same predicate and parameter.
create function rule_conflict(board uuid, predicate text, param jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r rules_now%rowtype;
  mine jsonb := nullif(param, 'null'::jsonb);
  theirs jsonb;
  where_ text;
begin
  for r in select * from rules_now x where rule_conflict.board is null or x.board is null or x.board = rule_conflict.board order by x.board nulls last, x.number loop
    theirs := r.param;
    where_ := case when r.board is null then 'a house rule' else 'Rule ' || r.number end;
    if r.predicate = predicate and theirs is not distinct from mine then
      return format('%s already says that', where_);
    elsif r.predicate = 'bannedWord' and predicate = 'requiredWord' and lower(theirs #>> '{}') = lower(mine #>> '{}') then
      return format('%s bans the word "%s", which this rule would require', where_, theirs #>> '{}');
    elsif r.predicate = 'requiredWord' and predicate = 'bannedWord' and lower(theirs #>> '{}') = lower(mine #>> '{}') then
      return format('%s requires the word "%s", which this rule would ban', where_, theirs #>> '{}');
    elsif r.predicate = 'maxLength' and predicate = 'minLength' and (mine #>> '{}')::numeric > (theirs #>> '{}')::numeric then
      return format('%s allows at most %s characters, below the %s this rule would require', where_, theirs #>> '{}', mine #>> '{}');
    elsif r.predicate = 'minLength' and predicate = 'maxLength' and (theirs #>> '{}')::numeric > (mine #>> '{}')::numeric then
      return format('%s requires at least %s characters, above the %s this rule would allow', where_, theirs #>> '{}', mine #>> '{}');
    end if;
  end loop;
  return null;
end $$;
revoke execute on function rule_conflict(uuid, text, jsonb) from public, anon, authenticated;

-- queued_moves_guard (0099), refusing a setRule whose params are malformed or whose rule would leave no compliant post, naming why.
-- Everything else as 0099 wrote it.
create or replace function queued_moves_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  params_ok boolean;
  problem text;
begin
  if tg_op = 'DELETE' then
    raise exception 'a queued move is held or landed, never removed' using errcode = '23514';
  elsif tg_op = 'INSERT' then
    if new.demand is not null and not exists (select 1 from demand_kinds d where d.key = new.demand ->> 'kind') then
      raise exception 'there is no demand kind "%"', coalesce(new.demand ->> 'kind', '') using errcode = '23514';
    end if;
    if new.demand is not null and demand_params_problem(new.demand) is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.demand) using errcode = '23514';
    end if;
    if not exists (select 1 from move_kinds k where k.key = new.kind) then
      raise exception 'there is no move kind "%"', new.kind using errcode = '23514';
    end if;
    if new.structural is distinct from (select k.structural from move_kinds k where k.key = new.kind) then
      raise exception 'a % move is not queued as structural = %', new.kind, new.structural using errcode = '23514';
    end if;
    if new.kind = 'nameSuccessor' then
      if new.demand is not null or new.expires_at is not null then raise exception 'a nomination has no demand and no expiry' using errcode = '23514'; end if;
      if jsonb_typeof(new.params -> 'boss') is distinct from 'string'
         or not (new.params ->> 'boss' = any (boss_roster())) then
        raise exception 'a nomination names a persona on the Boss roster, not a benched or retired one' using errcode = '23514';
      end if;
      if new.params ->> 'boss' = new.staff then raise exception 'a Boss does not name itself' using errcode = '23514'; end if;
    end if;
    if new.admin_description is not null then raise exception 'a queued move is queued without an admin''s replacement' using errcode = '23514'; end if;
    if new.kind = 'setRule' then
      problem := rule_params_problem(new.params);
      if problem is not null then raise exception 'a rule is malformed: %', problem using errcode = '23514'; end if;
      problem := rule_conflict(nullif(new.params ->> 'board', '')::uuid, new.params ->> 'predicate', nullif(new.params -> 'param', 'null'::jsonb));
      if problem is not null then raise exception 'that rule would leave no post that follows the rules: %', problem using errcode = '23514'; end if;
    end if;
  else
    params_ok := new.params is not distinct from old.params
      or (old.kind = 'nameSuccessor' and old.landed_act is null and old.held_at is null
          and new.params - 'boss' = old.params - 'boss' and jsonb_typeof(new.params -> 'boss') = 'string');
    if not params_ok
       or (new.id, new.meeting, new.staff, new.kind, new.demand, new.why, new.go_live_at, new.expires_at, new.structural)
          is distinct from (old.id, old.meeting, old.staff, old.kind, old.demand, old.why, old.go_live_at, old.expires_at, old.structural) then
      raise exception 'a queued move is only ever held or landed' using errcode = '23514';
    end if;
    -- Who replaced a nomination and when change only with the Boss they replace, and with each other.
    if (new.replaced_by, new.replaced_at) is distinct from (old.replaced_by, old.replaced_at)
       and (new.params is not distinct from old.params or new.replaced_by is null or new.replaced_at is null) then
      raise exception 'a replacement is recorded with the Boss it puts in place' using errcode = '23514';
    end if;
    -- An admin's replacement of a description is for a rename still waiting, and never leaves the row afterward.
    if (new.admin_description, new.described_by, new.described_at) is distinct from (old.admin_description, old.described_by, old.described_at)
       and (old.kind <> 'renameBoard' or old.landed_act is not null or old.held_at is not null or new.admin_description is null) then
      raise exception 'only a rename that is still waiting takes an admin''s description' using errcode = '23514';
    end if;
    if (old.held_at is not null and (new.held_at, new.held_by) is distinct from (old.held_at, old.held_by))
       or (old.landed_act is not null and new.landed_act is distinct from old.landed_act) then
      raise exception 'a queued move that is held or landed stays so' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- ----------------------------------------------------------------------------------- rule_breaks ----

-- The rules a post breaks: the rules in force on its thread's board and every board, each checked by plain code from the post, its thread
-- and its previous post in the thread. A rule never refuses a post, and a post by a staff character is the caller's to skip (Task 6). Takes
-- a post or the spin that opens a thread. A key with no branch raises, so a predicate added to the catalog and not here fails loudly.
create function rule_breaks(post_act uuid) returns setof rules_now
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p record;
  prev record;
  r rules_now%rowtype;
  body text;
  broken boolean;
begin
  select a.character, a.thread, a.seq, a.created_at, coalesce(a.payload ->> 'body', '') as body, t.board, t.title into p
  from acts a join threads t on t.id = a.thread where a.id = post_act and a.kind in ('post', 'spin');
  if not found then return; end if;
  body := p.body;
  -- The post before this one in the thread: the unique (thread, seq) index walked back. A thread's opener has none.
  select x.character, x.created_at into prev from acts x
  where x.thread = p.thread and x.seq < p.seq and x.kind in ('post', 'spin') order by x.seq desc limit 1;
  for r in select * from rules_now x where x.board is null or x.board = p.board order by x.board nulls first, x.number loop
    broken := case r.predicate
      when 'minLength' then char_length(body) < (r.param #>> '{}')::integer
      when 'maxLength' then char_length(body) > (r.param #>> '{}')::integer
      when 'noAllCaps' then (
        select w.letters > 0 and w.uppers * 2 > w.letters
        from (select length(regexp_replace(q.s, '[^[:alpha:]]', '', 'g')) as letters, length(regexp_replace(q.s, '[^[:upper:]]', '', 'g')) as uppers
              from (select regexp_replace(body, '\[/?[a-zA-Z*]+(=[^\]]*)?\]', '', 'g') as s) q) w)
      when 'noDoublePost' then prev.character is not null and prev.character = p.character
      when 'noNecropost' then prev.created_at is not null and p.created_at - prev.created_at > make_interval(days => (r.param #>> '{}')::integer)
      when 'noDuplicateTitle' then p.seq = 1 and exists (
        select 1 from threads o where o.board = p.board and o.id <> p.thread and lower(btrim(o.title)) = lower(btrim(p.title)))
      when 'bannedWord' then body ~* ('(^|[^[:alnum:]_])' || regex_escape(r.param #>> '{}') || '([^[:alnum:]_]|$)')
      when 'requiredWord' then body !~* ('(^|[^[:alnum:]_])' || regex_escape(r.param #>> '{}') || '([^[:alnum:]_]|$)')
      when 'noTag' then body ~* ('\[' || regex_escape(r.param #>> '{}') || '([=\] ]|$)')
      when 'repliesOnly' then p.seq = 1
      else null end;
    if broken is null then raise exception 'no check for predicate %', r.predicate using errcode = '0A000'; end if;
    if broken then return next r; end if;
  end loop;
end $$;
revoke execute on function rule_breaks(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------ the lines ----

-- system_line (0048), also filling `{rule}` for a setRule: "Rule 3: no double posting", or "House Rule 1: ..." for an every-board rule, numbered as
-- it will be once it lands (the rules in force there, plus this one); and `{board}` reads "every board" for a rule with no board. A kind
-- that is no rule reads as before. Everything else as 0048 wrote it.
create or replace function system_line(line_key text, move_kind text, params jsonb, staff_key text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  words text;
  line text;
  boss_name text;
  board_name text := '';
  rule_words text := '';
  rule_board uuid;
  predicate_words text;
begin
  select s.value -> line_key into lines from settings s where s.key = 'systemLines';
  select s.value ->> move_kind into words from settings s where s.key = 'systemMoveWords';
  words := coalesce(words, 'a move');
  if jsonb_typeof(params) = 'object' then
    words := fill_tokens(words, params);
    if lower(params ->> 'board') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      board_name := coalesce((select b.name from boards_now b where b.id = (params ->> 'board')::uuid), '');
    end if;
    if move_kind = 'setRule' then
      rule_board := case when lower(params ->> 'board') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (params ->> 'board')::uuid end;
      if rule_board is null then board_name := 'every board'; end if;
      select fill_tokens(x.plain, jsonb_build_object('param', coalesce(params #>> '{param}', ''))) into predicate_words from rule_predicates x where x.key = params ->> 'predicate';
      rule_words := case when rule_board is null then 'House Rule ' else 'Rule ' end
        || ((select count(*) from rules_now r where r.board is not distinct from rule_board) + 1)::text
        || ': ' || coalesce(predicate_words, 'a rule');
    end if;
  end if;
  select c.name into boss_name from characters c where c.staff = staff_key;
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    line := lines ->> floor(random() * jsonb_array_length(lines))::integer;
  else
    return words;
  end if;
  return fill_tokens(line, jsonb_build_object('boss', coalesce(boss_name, ''), 'board', board_name, 'move', words, 'rule', rule_words));
end $$;

-- system_tick (0099), saying a landed setRule in its own stock line (`ruleSet`). Everything else as 0099 wrote it.
create or replace function system_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  ann uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  check_every interval := make_interval(mins => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandCheckMinutes'), 5));
  cap integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandChecksPerTick'), 40);
  budget_ends timestamptz := clock_timestamp() + make_interval(secs => coalesce(nullif(current_setting('kayfabb.tick_budget_seconds', true), '')::numeric, 20));
  due record;
  inforce record;
  written uuid;
  why text;
  ended_by text;
  counted jsonb;
  expires timestamptz;
  did_end boolean;
  landed integer := 0;
  met integer := 0;
  expired integer := 0;
  failed integer := 0;
  checked integer := 0;
  out_of_time boolean := false;
  superseded integer := 0;
  boss text := current_boss();
  season_start timestamptz := (select x.starts_at from seasons x where x.ends_at is null);
  grace interval := make_interval(days => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'inheritanceGraceDays'), 3));
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- 1. Landing: only while The System is on, and only where there is a thread to say it in.
  if enabled and ann is not null then
    for due in
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at, q.admin_description from queued_moves q where q.landed_act is null and q.held_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
    loop
      begin
        written := (write_staff_act(due.staff, 'move', ann, null,
          jsonb_build_object('kind', due.kind, 'params', due.params, 'body', system_line(case when due.kind = 'setRule' then 'ruleSet' else 'moveLanded' end, due.kind, due.params, due.staff))
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
        if due.kind = 'renameBoard' and due.admin_description is not null then
          perform write_describe((due.params ->> 'board')::uuid, due.admin_description, written);
        end if;
        landed := landed + 1;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: queued move % did not land: % (%)', due.id, sqlerrm, sqlstate;
        -- Recorded on the row (the latest failure), so the admin queue can show it and an admin can hold the row. The row stays due.
        update queued_moves set failed_at = now(), failure = left(sqlerrm || ' (' || sqlstate || ')', 500) where id = due.id;
      end;
    end loop;
  end if;

  -- 2. Expiry: whatever the switch says, for every move in force, every tick. It is a comparison.
  for inforce in
    select o.move_act, a.character, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act order by o.landed_at, o.move_act
  loop
    expires := (inforce.payload ->> 'expires_at')::timestamptz;
    if expires is not null and expires <= now() then
      begin
        did_end := (end_move(inforce.move_act, 'expired', 'expiry') ->> 'ended')::boolean;
        if did_end then expired := expired + 1; perform say_move_end(inforce.move_act, 'expired'); end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end if;
  end loop;

  -- 2b. The handover's leftovers, whatever the switch says. A nomination in force whose Boss is not the season's is spent (a nomination that
  -- landed after the handover it was for); a move that shapes a board and is not the season's Boss's, still unaddressed `inheritanceGraceDays`
  -- after the handover (or after it landed, if later), ends `superseded`: the new Boss's review never came, or never reached it. A move the
  -- Boss kept is its own (move_owner), so it never ends here. The read is of the moves in force, a handful of rows.
  if boss is not null then
    for inforce in
      select o.move_act, a.payload ->> 'kind' as kind, o.landed_at
      from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' and (k.shapes_board or k.key = 'nameSuccessor')
      where move_owner(o.move_act) is distinct from boss
      order by o.landed_at, o.move_act
    loop
      begin
        if inforce.kind = 'nameSuccessor' then
          perform end_move(inforce.move_act, 'spent', 'handover');
        elsif greatest(inforce.landed_at, season_start) + grace <= now() then
          did_end := (end_move(inforce.move_act, 'superseded', 'inheritance') ->> 'ended')::boolean;
          if did_end then superseded := superseded + 1; perform say_move_end(inforce.move_act, 'superseded'); end if;
        end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: inherited move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end loop;
  end if;

  -- 3. Demands: the moves least recently checked, at most `cap`, none checked within `check_every`, and none once the budget is spent.
  -- A move with no demand is never read. `checked_at` is set before the read, so a move whose progress errors takes its turn like the
  -- rest instead of holding the front of the line; the count it read is stored beside it (`open_moves.progress`, 0053).
  for inforce in
    select o.move_act, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act where jsonb_typeof(a.payload -> 'demand') = 'object' and (o.checked_at is null or o.checked_at <= now() - check_every) order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    update open_moves set checked_at = now() where move_act = inforce.move_act;
    checked := checked + 1;
    did_end := false;
    counted := null;
    begin
      counted := demand_progress_or_error(inforce.move_act);
      if coalesce((counted ->> 'met')::boolean, false) then
        did_end := (end_move(inforce.move_act, 'met', 'demand') ->> 'ended')::boolean;
        if did_end then met := met + 1; end if;
      end if;
    exception when others then
      failed := failed + 1;
      did_end := false;
      raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
    -- What it read is kept on the move's row (a move just ended has no row left, and the update finds none), outside the block above so
    -- that a failure in ending the move does not take the count with it. The board and the admin queue read this, not the evaluator.
    if counted is not null then update open_moves set progress = counted where move_act = inforce.move_act; end if;
    -- The Boss says it. The move is ended whether or not the line is posted.
    if did_end then perform say_move_end(inforce.move_act, 'met'); end if;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'failed', failed, 'checked', checked, 'budget', out_of_time,
    'noThread', enabled and ann is null);
end $$;
