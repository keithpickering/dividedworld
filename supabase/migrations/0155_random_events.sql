-- Random Events and the shared draw (the cosmetics design, docs/plans/2026-11-04-cosmetics-design.md section 5; the plan, Task 4).
--
-- A player's character sometimes finds something while they play: a line of the game's own, a piece of gear or a card. random_event is the one place that rolls it. It is
-- the service role's, for a character the caller plays; it reads the caller's own account and settings and nothing of any other account, so what it answers is the same
-- whoever else plays, and it moves no Aura. Staff characters have no owner (characters_staff_has_no_owner), so played_by refuses them as it refuses any mask the caller does not play,
-- and no staff character is ever rolled for.
--
-- The window is the last roll, never the last event: a roll that drew nothing still closes it, so a player cannot reroll until something drops. random_event_rolls is the one
-- table here that is updated in place (it is a clock for an account, not an Act), and it is no player's to read: whether a player has rolled lately is theirs alone.
-- Cost at a busy instance's scale: one roll locks and reads the account's own roll row and counts its own events of the last day (random_events_account_at), so it is
-- linear in the account's events in a day, which `dayMost` bounds, never in the instance's.
--
-- The foreign key on gear_ledger.event (below) and card_ledger's found check validate the rows that exist; no instance is deployed yet, so no row predates them and none is
-- left unchecked (a pre-alpha note, not a rule for a later migration).
--
-- draw_by_rarity is the pack's draw taken out of roll_pack so an event and a pack draw alike: a rarity by weight among the rarities that have something to give, then a key uniformly.
-- roll_pack calls it a pull at a time and consumes random() as it did, so a seed rolls the pack it rolled before.

-- ---------------------------------------------------------------------------------------------------------- the lines ----

-- The lines an instance's Random Events say (Instance.events.lines): replaced by each seed. An event keeps its line's key and text; the instance's lines are free to change after.
create table event_lines (
  key text primary key check (key ~ '^[a-z][a-z0-9-]*$'),
  outcome text not null check (outcome in ('line', 'gear', 'card')),
  text text not null check (length(btrim(text)) >= 1)
);
alter table event_lines enable row level security;
revoke all on event_lines from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------ the events ----

-- A thing that happened to a character, one row each: append-only like every ledger. It keeps its line's text beside the key, so a past event and an export read the same
-- after a re-seed has dropped or reworded the line. A `line` event has no item; a `gear` or `card` event names the item it dropped, and
-- the found row in the gear or card ledger names the event back.
create table random_events (
  id uuid primary key default gen_random_uuid(),
  account uuid not null references accounts (id),
  character uuid not null references characters (id),
  at timestamptz not null default now(),
  outcome text not null check (outcome in ('line', 'gear', 'card')),
  item text,
  line text not null,
  line_text text not null,
  check ((outcome = 'line') = (item is null))
);
create index random_events_account_at on random_events (account, at);
create trigger random_events_no_update before update or delete on random_events for each row execute function ledger_append_only();
create trigger random_events_no_truncate before truncate on random_events for each statement execute function ledger_append_only();
alter table random_events enable always trigger random_events_no_update;
alter table random_events enable always trigger random_events_no_truncate;
alter table random_events enable row level security;
revoke all on random_events from public, anon, authenticated;
grant select on random_events to authenticated;
create policy own on random_events for select to authenticated using (account = auth.uid());

-- The last roll of an account, whatever it drew. The one row an account's rolls lock, and the only table here updated in place.
create table random_event_rolls (
  account uuid primary key references accounts (id),
  rolled_at timestamptz not null
);
alter table random_event_rolls enable row level security;
revoke all on random_event_rolls from public, anon, authenticated;

-- A found gear copy names the event that dropped it (0153 left the column bare).
alter table gear_ledger add constraint gear_ledger_event_fkey foreign key (event) references random_events (id);

-- A found card: its Event, no Act, price 0. card_ledger_check (0148) names the kinds that carry an Act; a found card carries an Event instead.
alter table card_ledger add column event uuid references random_events (id);
alter table card_ledger drop constraint card_ledger_kind_check;
alter table card_ledger add constraint card_ledger_kind_check check (kind in ('bought', 'played', 'pulled', 'caught', 'returned', 'found'));
alter table card_ledger add constraint card_ledger_found_check check ((kind = 'found') = (event is not null));
alter table card_ledger add constraint card_ledger_found_price check (kind <> 'found' or price = 0);

-- card_held (0148), also counting a found card in. Everything else, its mode and its grants as 0148 wrote it.
create or replace function card_held(who uuid, card text) returns integer
language sql stable set search_path = public, pg_temp as $$
  select (count(*) filter (where l.kind in ('bought', 'pulled', 'caught', 'returned', 'found')) - count(*) filter (where l.kind = 'played')
          + (select count(*) from face_down f
             where f.account = card_held.who and f.card = card_held.card and f.ends_at <= now()
               and (select s.id from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text limit 1) is null
               and (select tb.id from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = f.play::text limit 1) is null))::integer
  from card_ledger l where l.account = card_held.who and l.card = card_held.card
$$;

-- --------------------------------------------------------------------------------------------------------- the draw ----

-- A rarity by weight among the rarities of `pool` ('card' or 'gear') that have a key to give, then a key uniformly at that rarity, `leaves` left out. A card that writes is
-- never eligible where the instance has no old voice (0149). Null when no weighted rarity has anything to give. Two random() draws, in this order, as roll_pack drew them.
create function draw_by_rarity(pool text, weights jsonb, leaves text[]) returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  total numeric;
  r numeric;
  upto numeric;
  w record;
  picked_rarity text;
  eligible integer;
  picked text;
  voice boolean := old_voice_on();
begin
  if pool is null or pool not in ('card', 'gear') then raise exception 'there is no pool "%"', pool using errcode = '22023'; end if;
  select sum((x.value #>> '{}')::numeric) into total from jsonb_each(weights) x
  where (x.value #>> '{}')::numeric > 0 and exists (select 1 from draw_pool(pool, leaves, voice) p where p.rarity = x.key);
  if total is null then return null; end if;
  r := random() * total;
  upto := 0;
  picked_rarity := null;
  for w in select x.key, (x.value #>> '{}')::numeric as weight from jsonb_each(weights) x
           where (x.value #>> '{}')::numeric > 0 and exists (select 1 from draw_pool(pool, leaves, voice) p where p.rarity = x.key)
           order by x.key loop
    upto := upto + w.weight;
    if r < upto then picked_rarity := w.key; exit; end if;
  end loop;
  select count(*) into eligible from draw_pool(pool, leaves, voice) p where p.rarity = picked_rarity;
  select p.key into picked from draw_pool(pool, leaves, voice) p where p.rarity = picked_rarity order by p.key offset floor(random() * eligible)::integer limit 1;
  return picked;
end $$;

-- The keys a pool can give: the one place that says which cards and which gear are eligible.
create function draw_pool(pool text, leaves text[], voice boolean) returns table (key text, rarity text)
language sql stable set search_path = public, pg_temp as $$
  select k.key, k.rarity from card_kinds k where pool = 'card' and k.key <> all (leaves) and (voice or not k.writes)
  union all
  select g.key, g.rarity from gear_kinds g where pool = 'gear' and g.key <> all (leaves)
$$;
revoke execute on function draw_pool(text, text[], boolean), draw_by_rarity(text, jsonb, text[]) from public, anon, authenticated;

-- roll_pack (0149), drawing each pull with draw_by_rarity. A pull with nothing to give is refused in the same words, naming the rarities it weighed.
create or replace function roll_pack(pulls jsonb, leaves text[]) returns text[]
language plpgsql set search_path = public, pg_temp as $$
declare
  pull jsonb;
  picked text;
  got text[] := '{}';
begin
  for pull in select e.pull from jsonb_array_elements(pulls) with ordinality e(pull, i) order by e.i loop
    picked := draw_by_rarity('card', pull -> 'weights', leaves);
    if picked is null then
      raise exception 'this pack has no % card to give', (select string_agg(x.key, ', ' order by x.key) from jsonb_each(pull -> 'weights') x) using hint = 'kayfabb.refusal', errcode = 'P0001';
    end if;
    got := got || picked;
  end loop;
  return got;
end $$;

-- ------------------------------------------------------------------------------------------------------- the roll ----

-- A roll for a character its player plays. The character's row first, then who plays it (as set_outfit does), then the account's roll row, locked: inserted if it is
-- not there and then read for update, so two rolls of one account at once are taken one after the other, and the second reads the first's stamp. Refused for another
-- player's character, a retired one and a staff one, before anything is written. Null, and nothing written, inside the window or at the day's most; otherwise the roll
-- is stamped, and a draw of `none`, of a pool with nothing to give, or of an outcome the instance has no line for answers null, the window still closed and nothing written
-- (an event with nothing to show would only count toward the day). The answer is {event, outcome, item, rarity, lineKey, line, character}: `line` is the line's text as the
-- event row keeps it, and the dialog fills {item} itself. The item and the found ledger row come in one transaction with the event.
create function random_event(who uuid, through uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb;
  last_roll timestamptz;
  outs jsonb;
  total numeric;
  r numeric;
  upto numeric;
  w record;
  chosen text;
  item_key text;
  item_rarity text;
  line_key text;
  line_text text;
  lines integer;
  ev uuid;
begin
  select s.value -> 'events' into cfg from settings s where s.key = 'cosmetics';
  if cfg is null then raise exception 'this instance has no event settings' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  perform 1 from characters where id = through and owner = who for no key update;
  perform played_by(through, who);
  insert into random_event_rolls (account, rolled_at) values (who, '-infinity') on conflict (account) do nothing;
  select rolled_at into last_roll from random_event_rolls where account = who for update;
  if last_roll > now() - make_interval(mins => (cfg ->> 'windowMinutes')::integer) then return null; end if;
  if (select count(*) from random_events e where e.account = who and e.at > now() - interval '24 hours') >= (cfg ->> 'dayMost')::integer then return null; end if;
  update random_event_rolls set rolled_at = now() where account = who;
  outs := cfg -> 'outcomes';
  select sum(coalesce((outs ->> k)::numeric, 0)) into total from unnest(array['line', 'gear', 'card', 'none']) k;
  r := random() * total;
  upto := 0;
  for w in select k, coalesce((outs ->> k)::numeric, 0) as weight from unnest(array['line', 'gear', 'card', 'none']) k loop
    upto := upto + w.weight;
    if w.weight > 0 and r < upto then chosen := w.k; exit; end if;
  end loop;
  if chosen is null or chosen = 'none' then return null; end if;
  if chosen = 'gear' then
    item_key := draw_by_rarity('gear', cfg -> 'gearRarity', '{}');
    if item_key is null then return null; end if;
    select rarity into item_rarity from gear_kinds where key = item_key;
  elsif chosen = 'card' then
    item_key := draw_by_rarity('card', cfg -> 'cardRarity', '{}');
    if item_key is null then return null; end if;
    select rarity into item_rarity from card_kinds where key = item_key;
  end if;
  select count(*) into lines from event_lines where outcome = chosen;
  if lines = 0 then return null; end if;
  select l.key, l.text into line_key, line_text from event_lines l where l.outcome = chosen order by l.key offset floor(random() * lines)::integer limit 1;
  insert into random_events (account, character, outcome, item, line, line_text) values (who, through, chosen, item_key, line_key, line_text) returning id into ev;
  if chosen = 'gear' then
    insert into gear_ledger (account, gear, kind, event) values (who, item_key, 'found', ev);
  elsif chosen = 'card' then
    insert into card_ledger (account, card, kind, price, event) values (who, item_key, 'found', 0, ev);
  end if;
  return jsonb_build_object('event', ev, 'outcome', chosen, 'item', item_key, 'rarity', item_rarity, 'lineKey', line_key, 'line', line_text, 'character', through);
end $$;
revoke execute on function random_event(uuid, uuid) from public, anon, authenticated;
grant execute on function random_event(uuid, uuid) to service_role;

-- ------------------------------------------------------------------------------------------------------ the seed ----

-- seed_instance (0154), also writing the instance's Random Event lines (event_lines, below): replaced as the seed gives them, so a line the instance dropped is gone, and a past event keeps its line's text on its own row. Everything else as 0154 wrote it.
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
  -- The economy is merged, number by number: a card kind is never removed, so the numbers its rules read stay in the row with it.
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  -- Reaction kinds are the one vocabulary a seed removes. Classes and cards never are: a card must outlive its slot and its pulls
  -- (0139). A reaction kind has nothing that must outlive it once nothing uses it, and a kind something does use is never removed.
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
  -- Member groups (0128): the instance's whole set, the ladder and the groups a move confers. A condition kind group_now has no case for stops the seed,
  -- naming the group. A group the payload no longer lists is deleted unless a move (landed or queued) names it, so the log line that names it still can.
  if payload ? 'groups' then
    select string_agg(e ->> 'key' || ' (' || coalesce(e ->> 'condition', 'none') || ')', ', ') into unknown
    from jsonb_array_elements(payload -> 'groups') e
    where e ->> 'source' = 'ladder' and coalesce(e ->> 'condition', '') <> all (array['default', 'posts', 'seasons', 'staff']);
    if unknown is not null then
      raise exception 'the instance''s groups name a condition kind group_now has no case for: %', unknown using errcode = '22023';
    end if;
    delete from group_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'groups') e where e ->> 'key' = k.key)
      and not exists (select 1 from acts a where a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,group}' = k.key)
      and not exists (select 1 from queued_moves q where q.kind = 'conferGroup' and q.params ->> 'group' = k.key);
    insert into group_kinds (key, name, badge, color, stripe, source, rung, condition, at_least, tone)
    select e ->> 'key', e ->> 'name', e ->> 'badge', e ->> 'color', coalesce((e ->> 'stripe')::boolean, false), e ->> 'source', (e ->> 'rung')::integer,
      e ->> 'condition', (e ->> 'atLeast')::integer, e ->> 'tone'
    from jsonb_array_elements(payload -> 'groups') e
    on conflict (key) do update set name = excluded.name, badge = excluded.badge, color = excluded.color, stripe = excluded.stripe, source = excluded.source, rung = excluded.rung,
      condition = excluded.condition, at_least = excluded.at_least, tone = excluded.tone;
  end if;
  -- A card's play, rarity, trap, gimmick and time up (0054, 0148), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name is; so
  -- are its rarity, its play, its trap (with its match), its gimmick, how long a Use of it is up, where it reaches, whether it pins and whether it writes.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, lasts, reaches, pins, writes, skim, scores_as)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, skim = excluded.skim, scores_as = excluded.scores_as;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0139). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  insert into pack_kinds (key, pulls, leaves)
  select e ->> 'key', e -> 'pulls', coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}')
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves;
  if payload ? 'gear' then
    insert into gear_kinds (key, rarity) select e ->> 'key', e ->> 'rarity' from jsonb_array_elements(payload -> 'gear') e
    on conflict (key) do update set rarity = excluded.rarity;
    delete from gear_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'gear') e where e ->> 'key' = k.key)
      and not exists (select 1 from gear_ledger l where l.gear = k.key) and not exists (select 1 from gear_worn w where w.gear = k.key);
  end if;
  if payload ? 'eventLines' then
    insert into event_lines (key, outcome, text) select e ->> 'key', e ->> 'outcome', e ->> 'text' from jsonb_array_elements(payload -> 'eventLines') e
    on conflict (key) do update set outcome = excluded.outcome, text = excluded.text;
    delete from event_lines l where not exists (select 1 from jsonb_array_elements(payload -> 'eventLines') e where e ->> 'key' = l.key);
  end if;
  -- The instance's trophy kinds (0154): added and brought up to date, the places, the Boss's kinds and the met demand's set as the catalog names them, and a kind the instance
  -- dropped removed unless an award names it. An admin-made kind is never touched, and an instance key that begins `made-` is refused (those are the admin page's).
  if payload ? 'trophies' then
    select string_agg(e ->> 'key', ', ') into unknown from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' like 'made-%';
    if unknown is not null then raise exception 'a trophy key begins "made-" only on the admin page: %', unknown using errcode = '22023'; end if;
    select string_agg(k, ', ') into unknown
    from (select jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'seasonPlaces', '[]') || coalesce(payload -> 'trophies' -> 'boss', '[]')
                                           || case when payload -> 'trophies' ? 'demandMet' then jsonb_build_array(payload -> 'trophies' ->> 'demandMet') else '[]'::jsonb end) k) n
    where not exists (select 1 from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' = n.k);
    if unknown is not null then raise exception 'the trophy catalog names kinds it does not define: %', unknown using errcode = '22023'; end if;
    -- The flags are cleared and set again, so that the unique indexes never see a place twice.
    update trophy_kinds set season_place = null, boss_gives = false, demand_met = false where made_by is null and (season_place is not null or boss_gives or demand_met);
    insert into trophy_kinds (key, name, line, belt) select e ->> 'key', e ->> 'name', nullif(e ->> 'line', ''), coalesce((e ->> 'belt')::boolean, false)
    from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e
    on conflict (key) do update set name = excluded.name, line = excluded.line, belt = excluded.belt;
    update trophy_kinds k set season_place = p.n::smallint
    from jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'seasonPlaces', '[]')) with ordinality p(key, n) where k.key = p.key;
    update trophy_kinds k set boss_gives = true where k.key in (select jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'boss', '[]')));
    update trophy_kinds k set demand_met = true where k.key = payload -> 'trophies' ->> 'demandMet';
    delete from trophy_kinds k where k.made_by is null and not exists (select 1 from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' = k.key)
      and not exists (select 1 from trophy_awards a where a.trophy = k.key);
  end if;
  insert into machine_slots (position, card, pack, availability, price)
  select (select coalesce(max(position), 0) from machine_slots) + row_number() over (order by m.i), m.e ->> 'card', m.e ->> 'pack', m.e ->> 'availability', (m.e ->> 'price')::integer
  from jsonb_array_elements(coalesce(payload -> 'machine', '[]')) with ordinality m(e, i)
  where not exists (select 1 from machine_slots s where s.card = m.e ->> 'card' or s.pack = m.e ->> 'pack');
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
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where e ? 'pronouns' and not pronouns_hold(pronouns_lowered(e -> 'pronouns')));
  if unknown is not null then raise exception 'persona % has pronouns that are not five words of 1 to 12 letters and a plural', unknown using errcode = '22023'; end if;
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature,
      pronouns_lowered(e -> 'pronouns') as pronouns
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature, pronouns)
  select m.id, left(s.title, 40), left(s.signature, 500), coalesce(s.pronouns, new_pronouns()) from made m join seeded s on s.staff = m.staff;
  -- Each listed persona's pronouns (0124), as its beats below: the seed's set is the persona's, so a reseed rewrites what an earlier seed or an earlier
  -- persona file wrote; a persona the seed gives none is left as it was. Its title and its signature stay as the first seed wrote them.
  update character_profiles p set pronouns = pronouns_lowered(e.value -> 'pronouns')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e, characters c
  where e.value ? 'pronouns' and c.staff = e.value ->> 'key' and c.staff_kind = 'persona' and p.character = c.id
    and p.pronouns is distinct from pronouns_lowered(e.value -> 'pronouns');
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona');
  if unknown is not null then raise exception 'firstStaff names %, which no persona in the seed''s roster is', unknown using errcode = '22023'; end if;
  -- Each listed persona's beat preferences (0103): the slugs of the kinds of board it likes. The seed's list is the persona's whole list, so a reseed
  -- replaces what an earlier seed wrote; a persona the seed gives no `beats` is left as it was.
  delete from staff_beats b where b.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'beats');
  insert into staff_beats (staff, slug)
  select distinct e ->> 'key', s
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements_text(case when jsonb_typeof(e -> 'beats') = 'array' then e -> 'beats' else '[]'::jsonb end) s
  where e ? 'beats';
  -- Each listed persona's visit traits (0105): the hours a visit of its runs and what talks it down. The seed's entry is the persona's whole traits, so a
  -- reseed replaces what an earlier seed wrote; a persona the seed gives neither is left as it was. A challenge carries a kind and its number (how many
  -- questions, or the price) and nothing else: a quiz's answers are never seeded here, where a client could read them.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null);
  if unknown is not null then
    raise exception 'persona % has visit traits that are wrong: %', unknown, (select visit_traits_problem(e -> 'visitHours', e -> 'challenge')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null limit 1) using errcode = '22023';
  end if;
  -- A quiz persona's questions (0108): the question, its choices and the right one, kept where no client can read them. The seed's entry is the persona's whole quiz, so a
  -- reseed replaces what an earlier seed wrote. A quiz that cannot be played is refused with the persona's name, and nothing is written.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null);
  if unknown is not null then
    raise exception 'persona % has a quiz that cannot be played: %', unknown, (select quiz_problem(e -> 'challenge', e -> 'quiz')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null limit 1) using errcode = '22023';
  end if;
  insert into staff_visit_traits (staff, visit_least, visit_most, challenge)
  select e ->> 'key', coalesce((e #>> '{visitHours,least}')::integer, 1), coalesce((e #>> '{visitHours,most}')::integer, 1000), coalesce(e -> 'challenge', '{"kind": "distraction"}'::jsonb)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  where e ? 'visitHours' or e ? 'challenge'
  on conflict (staff) do update set visit_least = excluded.visit_least, visit_most = excluded.visit_most, challenge = excluded.challenge;
  delete from staff_quiz_questions q where q.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'visitHours' or e ? 'challenge' or e ? 'quiz');
  insert into staff_quiz_questions (staff, idx, question, choices, answer)
  select e ->> 'key', (x.n - 1)::integer, btrim(x.q ->> 'question'), x.q -> 'choices', x.q ->> 'answer'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements(case when jsonb_typeof(e -> 'quiz') = 'array' then e -> 'quiz' else '[]'::jsonb end) with ordinality x(q, n)
  where e #>> '{challenge,kind}' = 'quiz';
  insert into staff_offices (staff, office, cause)
  select k, 'mod', 'seed' from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_offices x where x.staff = k);
  -- A persona the seed seats as a mod is debuted: a reseed that adds a still-waiting persona to firstStaff hires it above, and it debuts here.
  update characters c set debuted_at = now()
  where c.debuted_at is null and c.staff_kind = 'persona'
    and c.staff in (select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k)
    and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod');
  -- The staff group is the ladder's staff rung (group_kinds, seeded above), so no staffGroup setting is written; a row an earlier seed left is read by no one.
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board, offices, derived)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end,
         case when jsonb_typeof(e -> 'derived') = 'array' then array(select jsonb_array_elements_text(e -> 'derived')) else '{}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, offices = excluded.offices, derived = excluded.derived;
  -- The rule predicates (0102), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, tags, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer,
         case when jsonb_typeof(e -> 'tags') = 'array' then array(select jsonb_array_elements_text(e -> 'tags')) end, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, tags = excluded.tags, plain = excluded.plain;
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
    if payload -> 'developer' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'developer' -> 'pronouns')) then
      raise exception 'the developer has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'developer' -> 'pronouns'), new_pronouns()) from made m;
    -- The developer's pronouns, when the seed names them, are rewritten on every seed (0124); its title and signature are not.
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'developer' -> 'pronouns')
    from characters c
    where payload -> 'developer' ? 'pronouns' and c.staff = 'developer' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'developer' -> 'pronouns');
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
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;
