-- Sealed packs, fixed packs and the welcome gift (docs/plans/2026-11-18-starter-pack-design.md, sections 4, 5 and 8; its plan, Task 2).
--
-- A pack kind is now a pull pack (pulls, rolled when it is made) or a fixed pack (`contents`, the cards in order). A `packs` row says where it came from (`source`: bought at a slot, or a
-- `welcome` gift with no slot and no price), and is sealed until it has an opening: a row of `pack_openings`, which `open_pack` writes in one transaction with one `pulled` ledger row per card,
-- so a sealed pack's cards reach no hand until it is opened. Every pack bought before this migration has `opened_at` set and no opening row, and reads as opened.
--
--   pack_kinds       gains `contents`; `pulls` becomes nullable; exactly one of the two is held, and pack_pulls_problem judges a non-null `pulls` alone;
--   packs            gains `source`; `odds` becomes nullable (a fixed pack has none); a bought pack costs something and a welcome pack nothing and has no slot; one welcome pack per account;
--   pack_openings    one row per opened pack, append-only like `packs`; nobody but a definer function reads or writes it;
--   my_packs         answers `contents` and `opened_at` null while a pack is sealed, `opened_at` from the opening once it is open, and `source`; it no longer reads `packs` as the caller, because the
--                    caller loses every read of the table (the one place `contents` of a sealed pack could be read);
--   open_pack        the caller's own sealed pack, opened; a pack that is not the caller's and one that does not exist are refused in the same words, with the same code, by one query;
--   buy_pack         (0140's) writes a fixed kind's contents in place of a roll; the row is written opened, as today;
--   welcome_pack_kind, seed_instance (0361's), create_character (0124's)
--                    the welcome pack is written by create_character, for every character and once for the account (the unique index does nothing for a second), and by each seed's backfill;
--   settings_held    (0363's) holds `startingPack`;   log_page (0368's) carries each pack's `source`.
--
-- Append-only. Neither `packs` nor `pack_openings` takes an update or a delete; an opening is a row beside the pack, never an update of it.
-- Ways out. A sealed pack never expires: it is opened by a press in the hand, at any time, on the screen where it shows (open_pack). A refused open writes nothing.
-- Masks. A pack is the account's own row and nothing public says it exists or was opened; opening writes no Act and broadcasts nothing. open_pack's refusal of another account's pack is the
-- refusal of a pack that does not exist (one `select ... where id = $1 and account = auth.uid() for update` answers both, so the work and the words are the same). create_character's answer is
-- the same shape with a grant and without.
-- Cost at a busy instance's scale: the grant is one insert of one row in create_character; the backfill is one statement, a semi-join to characters_owner for each account and an anti-join to
-- packs_one_welcome, writing nothing on a second seed; opening is one row lock, one opening and one insert of the pack's cards.

-- ------------------------------------------------------------------------------------------------- the kinds ----

alter table pack_kinds add column contents text[];
alter table pack_kinds alter column pulls drop not null;
alter table pack_kinds drop constraint pack_kinds_pulls_check;
alter table pack_kinds add constraint pack_kinds_pulls_check check (pulls is null or pack_pulls_problem(pulls) is null);
alter table pack_kinds add constraint pack_kinds_contents_check check (contents is null or (cardinality(contents) >= 1 and array_position(contents, null) is null));
alter table pack_kinds add constraint pack_kinds_one_shape check ((pulls is null) <> (contents is null));

-- ------------------------------------------------------------------------------------------------- the packs ----

alter table packs add column source text not null default 'bought' check (source in ('bought', 'welcome'));
alter table packs alter column odds drop not null;
alter table packs drop constraint packs_price_check;
alter table packs add constraint packs_price_by_source check (case source when 'bought' then price > 0 else price = 0 and slot is null end);
-- At most one welcome pack per account: a retry, a second character and two characters made at once grant once.
create unique index packs_one_welcome on packs (account) where source = 'welcome';

-- The opening of a pack, once. A pack is open when it has a row here or its own `opened_at` is set (every pack bought before this migration).
create table pack_openings (
  pack uuid primary key references packs (id),
  at timestamptz not null default now()
);
create trigger pack_openings_no_update before update or delete on pack_openings for each row execute function ledger_append_only();
create trigger pack_openings_no_truncate before truncate on pack_openings for each statement execute function ledger_append_only();
alter table pack_openings enable always trigger pack_openings_no_update;
alter table pack_openings enable always trigger pack_openings_no_truncate;
alter table pack_openings enable row level security;
revoke all on pack_openings from public, anon, authenticated;

-- The caller loses every read of `packs`: a sealed pack's cards are readable by no one until it opens, the owner included, and my_packs (below) is the one read. The policy that showed an owner
-- their rows goes with the grant; the table keeps row level security on with no policy, which shows nobody anything.
revoke all on packs from public, anon, authenticated;
drop policy own on packs;

-- The caller's own packs, for the log and the hand. Read as its owner, not as the caller (as my_card_ledger is), so that it can leave out what the caller may not read: a sealed pack's cards and
-- its opening. A pack bought before this migration has `opened_at` and no opening, and reads as opened.
create or replace view my_packs as
  select p.id, p.slot, p.pack, p.price, p.odds,
         case when p.opened_at is not null or o.pack is not null then p.contents end as contents,
         p.bought_at, coalesce(p.opened_at, o.at) as opened_at, p.repriced, p.source
  from packs p left join pack_openings o on o.pack = p.id
  where p.account = auth.uid();
alter view my_packs set (security_invoker = false);
revoke all on my_packs from public, anon, authenticated;
grant select on my_packs to authenticated;

-- ------------------------------------------------------------------------------------------ the functions ----

-- The kind of pack an account's first character is given: the pack `startingPack` names, when it is a fixed pack the database holds; null for no gift, a name that is no pack, and a pull pack.
create function welcome_pack_kind() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select k.key from settings s join pack_kinds k on k.key = s.value #>> '{}'
  where s.key = 'startingPack' and jsonb_typeof(s.value) = 'string' and k.contents is not null
$$;
revoke execute on function welcome_pack_kind() from public, anon, authenticated;
grant execute on function welcome_pack_kind() to service_role;

-- The caller's own sealed pack, opened: its opening is recorded and one `pulled` row is written per card, in the pack's order, in this transaction. The caller's pack row is locked by the one
-- query that finds it, which finds a pack that is not the caller's and one that does not exist alike, so the two are refused in the same words with the same code and the same work. Two opens
-- at once: the second waits for the lock, then finds the opening, and is refused. Writes no Act, moves no Aura, and broadcasts nothing.
create function open_pack(pack uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  mine packs;
begin
  select p.* into mine from packs p where p.id = open_pack.pack and p.account = auth.uid() for update;
  if not found then raise exception 'there is no such pack' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if mine.opened_at is not null or exists (select 1 from pack_openings o where o.pack = mine.id) then
    raise exception 'this pack is already open' using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  insert into pack_openings (pack) values (mine.id);
  insert into card_ledger (account, card, kind, price, pack) select mine.account, c.card, 'pulled', 0, mine.id from unnest(mine.contents) with ordinality c(card, i) order by c.i;
  return jsonb_build_object('pack', mine.id, 'kind', mine.pack, 'contents', to_jsonb(mine.contents));
end $$;
revoke execute on function open_pack(uuid) from public, anon, service_role;
grant execute on function open_pack(uuid) to authenticated;

-- buy_pack (0140's), a fixed kind's cards in place of a roll (and no odds). The row is written opened, as ever, so a bought pack is never sealed; everything else as 0140 wrote it.
create or replace function buy_pack(who uuid, slot uuid, price integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  seen machine_now;
  pk pack_kinds;
  rolled text[];
  made uuid;
  left_over integer;
begin
  seen := slot_for_sale(slot, 'pack', price);
  select * into pk from pack_kinds k where k.key = seen.pack;
  rolled := coalesce(pk.contents, roll_pack(pk.pulls, pk.leaves));
  left_over := wallet_spend(who, seen.price, 'purchase', null);
  insert into packs (account, slot, pack, price, odds, contents, opened_at, repriced)
  values (who, seen.slot, pk.key, seen.price, pk.pulls, rolled, now(), coalesce(seen.move ->> 'kind' = 'repriceSlot' and seen.price is distinct from (seen.move ->> 'was')::integer, false)) returning id into made;
  insert into card_ledger (account, card, kind, price, pack) select who, c.card, 'pulled', 0, made from unnest(rolled) with ordinality c(card, i) order by c.i;
  return jsonb_build_object('pack', made, 'kind', pk.key, 'contents', to_jsonb(rolled), 'balance', left_over);
end $$;

-- ----------------------------------------------------------------------------------- the writes, as they were ----

-- seed_instance (0361's), writing a fixed pack's cards beside a pull pack's pulls and, once the settings, the packs and the slots are written, backfilling the welcome pack; everything else as 0361 wrote it.
create or replace function public.seed_instance(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
  was text := current_setting('kayfabb.seeding', true);
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  -- The settings trigger (settings_tuned) marks a row tuned for any write but a seed's: this transaction is the seed's, so its writes leave no mark.
  perform set_config('kayfabb.seeding', 'on', true);
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the numbers its rules read stay in the row with it.
  perform seed_setting(e.key, e.value) from jsonb_each(payload -> 'settings') e where jsonb_typeof(e.value) is distinct from 'null';
  -- A setting the code gives as null (`startingPack`: no gift) is no row, not a row holding a JSON null: an export reads a jsonb null back as a SQL null, which the column refuses, so a null would
  -- not round-trip. A row an admin tuned stands (0355), as every tuned row does.
  delete from settings s using jsonb_each(payload -> 'settings') e where s.key = e.key and jsonb_typeof(e.value) = 'null' and s.tuned_at is null;
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
  -- are its rarity, its play, its trap (with its match), its gimmick, its discipline, how long a Use of it is up, where it reaches, whether it pins, whether it writes, whether it replies, whether it keeps, its skim, whether it scores as a class, what it draws, its drive and the words it refuses a blank message with.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, discipline, lasts, reaches, pins, writes, replies, keeps, skim, scores_as, draws, drive, needs_message, veil, adds_reaction, surface)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), nullif(e -> 'discipline', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    coalesce((e ->> 'replies')::boolean, false), coalesce((e ->> 'keeps')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false),
    case when jsonb_typeof(e -> 'draws') = 'array' then array(select jsonb_array_elements_text(e -> 'draws')) end, nullif(e -> 'drive', 'null'), nullif(e ->> 'needsMessage', ''),
    nullif(e ->> 'veil', ''), coalesce((e ->> 'addsReaction')::boolean, false), coalesce((e ->> 'surface')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, discipline = excluded.discipline, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, replies = excluded.replies, keeps = excluded.keeps, skim = excluded.skim, scores_as = excluded.scores_as,
    draws = excluded.draws, drive = excluded.drive, needs_message = excluded.needs_message, veil = excluded.veil, adds_reaction = excluded.adds_reaction, surface = excluded.surface;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0139). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  -- A pack is a pull pack (its pulls and what it leaves out) or a fixed one (its cards in order, 0377); the table holds exactly one of the two.
  insert into pack_kinds (key, pulls, leaves, contents)
  select e ->> 'key', nullif(e -> 'pulls', 'null'), coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}'),
         case when jsonb_typeof(e -> 'contents') = 'array' then array(select jsonb_array_elements_text(e -> 'contents')) end
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves, contents = excluded.contents;
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
  -- The instance's trophy kinds (0206): added and brought up to date, the places, the Boss's kinds and the met demand's set as the catalog names them, and a kind the instance
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
  -- The welcome pack's backfill (0377): every account with a character and no welcome pack yet gets one, when `startingPack` names a fixed pack. One insert with a semi-join to characters
  -- (characters_owner) and an anti-join to packs (packs_one_welcome), which writes nothing on a second seed; the unique index makes it once ever, so a seed racing a character's creation
  -- grants once, and an instance that changes `startingPack` later gives no second.
  insert into packs (account, pack, price, contents, source)
  select a.id, k.key, 0, k.contents, 'welcome'
  from pack_kinds k
  join accounts a on exists (select 1 from characters c where c.owner = a.id)
  where k.key = welcome_pack_kind()
    and not exists (select 1 from packs w where w.account = a.id and w.source = 'welcome')
  on conflict (account) where source = 'welcome' do nothing;
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
  insert into move_kinds (key, structural, shapes_board, lasting, offices, derived)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false), coalesce((e ->> 'lasting')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end,
         case when jsonb_typeof(e -> 'derived') = 'array' then array(select jsonb_array_elements_text(e -> 'derived')) else '{}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, lasting = excluded.lasting, offices = excluded.offices, derived = excluded.derived;
  -- The rule predicates (0102), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, tags, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer,
         case when jsonb_typeof(e -> 'tags') = 'array' then array(select jsonb_array_elements_text(e -> 'tags')) end, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, tags = excluded.tags, plain = excluded.plain;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The conditions that unlock a beat (0332), as the engine lists them (engine/system/conditions.ts). A reseed upserts; a condition is never removed, since a persona's arc may name it.
  insert into condition_kinds (key, plain)
  select e ->> 'key', e ->> 'plain' from jsonb_array_elements(coalesce(payload -> 'system' -> 'conditions', '[]')) e
  on conflict (key) do update set plain = excluded.plain;
  -- A persona's arc (0332): one row each, rewritten by a reseed. An arc naming a condition the catalog lacks is refused, naming it: the check that no beat waits on a condition nothing reads.
  unknown := (select string_agg(distinct c ->> 'kind', ', ')
              from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) p, jsonb_array_elements(coalesce(p -> 'arc', '[]')) b, jsonb_array_elements(coalesce(b -> 'unlock', '[]')) c
              where not exists (select 1 from condition_kinds k where k.key = c ->> 'kind'));
  if unknown is not null then raise exception 'an arc names a condition the catalog lacks: %', unknown using errcode = '23514'; end if;
  delete from persona_arcs where staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e);
  insert into persona_arcs (staff, beats, holds_back, phase_days)
  select e ->> 'key', coalesce(e -> 'arc', '[]'), coalesce(e -> 'holdsBack', '[]'), coalesce(e -> 'phaseDays', '{}')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  perform seed_setting('bossRoster', r.roster)
  from (select jsonb_agg(e.value ->> 'key' order by e.ord) as roster
        from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
        having count(*) > 0) r;
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
     and setting_thread('systemAnnouncements') is null then
    insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id into opened;
    perform seed_setting('systemAnnouncements', to_jsonb(opened::text));
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
      perform seed_setting('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'));
    end if;
    if setting_thread('updatesThread') is null then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      perform seed_setting('updatesThread', to_jsonb(opened::text));
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  -- The anonymous poster (0357): a seed with an `anonymous` entry ({ name, title, avatar, pronouns }) makes the one stand-in, once, as it makes the developer: debuted at seed time, the tagline its profile title, the pronouns
  -- rewritten on every seed when the seed names them, the avatar's asset key the instance's to change. What an admin wrote is never written over. A seed with none makes none, and stand_in() is then null (land_refusal
  -- refuses a veil until one exists); seed.ts always sends one, the engine's own when the instance names none.
  if jsonb_typeof(payload -> 'anonymous') = 'object' then
    if payload -> 'anonymous' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'anonymous' -> 'pronouns')) then
      raise exception 'the anonymous poster has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'anonymous' ->> 'name', 'anonymous', 'anonymous', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'anonymous' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'anonymous' -> 'pronouns'), new_pronouns()) from made m;
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'anonymous' -> 'pronouns')
    from characters c
    where payload -> 'anonymous' ? 'pronouns' and c.staff = 'anonymous' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'anonymous' -> 'pronouns');
    if nullif(payload -> 'anonymous' ->> 'avatar', '') is not null then
      perform seed_setting('anonymousAvatar', to_jsonb(payload -> 'anonymous' ->> 'avatar'));
    end if;
  end if;
  -- Seeding ends here: a write later in a transaction that called this (a test file's, one session's) is not the seed's. The flag goes back to the value this found. A custom
  -- setting cannot be truly unset inside a transaction, so one that was unset (null) or empty goes back to 'off', which the trigger reads the same.
  perform set_config('kayfabb.seeding', coalesce(nullif(was, ''), 'off'), true);
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $function$;

-- create_character (0124's, the same signature and grants), also granting the welcome pack.
create or replace function create_character(name text, class text, timing text default 'now', loudness text default 'announced', pronouns jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  named text := btrim(name, ' ');
  made uuid;
  at timestamptz;
  announced jsonb;
begin
  if named is null or char_length(named) not between 1 and 40 then
    raise exception 'a name is 1 to 40 characters' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A name nobody's can be made to look like: unique whatever its case or script (0011), and holding no
  -- invisible, control or direction character and no space but a single one. The same set as
  -- engine/rules/actions.ts's NAME_HIDDEN.
  if named ~ '[\u0001-\u001f\u007f- ­͏؜ᅟᅠ ឴឵᠋-᠎ -‏ -  -⁯　ㅤ︀-️﻿ﾠ￰-￿⠀\U0001d173-\U0001d17a\U000e0000-\U000e0fff]' or named like '%  %' then
    raise exception 'a name can hold letters, marks, digits, symbols and single spaces, nothing hidden' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if not exists (select 1 from class_kinds where key = class) then
    raise exception 'there is no class "%"', class using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if create_character.pronouns is not null and not pronouns_hold(pronouns_lowered(create_character.pronouns)) then
    raise exception 'pronouns are five words of 1 to 12 letters' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform debut_options(timing, loudness);
  begin
    -- A drop is debuted in the insert itself, at its creation (both are the transaction's now()).
    insert into characters (owner, name, debut_loudness, debuted_at) values (caller, named, loudness, case when timing = 'now' then now() end)
    returning id, created_at into made, at;
  exception when unique_violation then
    raise exception 'that name is taken' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  insert into class_history (character, class_key, started_at) values (made, class, at);
  insert into character_profiles (character, pronouns) values (made, coalesce(pronouns_lowered(create_character.pronouns), new_pronouns()));
  -- The account's welcome pack (0377), sealed, where `startingPack` names a fixed pack: the same insert for every character, and the unique index (one per account) does nothing for a second, so a retry,
  -- a second character and two made at once grant once, and the answer below is the same shape whether or not a pack was granted.
  insert into packs (account, pack, price, contents, source)
  select caller, k.key, 0, k.contents, 'welcome' from pack_kinds k where k.key = welcome_pack_kind()
  on conflict (account) where source = 'welcome' do nothing;
  if timing = 'now' and loudness <> 'silent' then announced := announce_drop(made, at); end if;
  return jsonb_build_object('id', made, 'name', named, 'class', class, 'waiting', timing = 'tally', 'loudness', loudness, 'announcement', announced);
end $$;

-- settings_held (0363's), also holding `startingPack`; everything else as 0363 wrote it.
create or replace function public.settings_held()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed', 'trophy', 'beltLost', 'beltBack'];
begin
  why := case new.key
    when 'walletCap' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'vote' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'halving' then case when not coalesce(jsonb_typeof(v) = 'number' and setting_positive(v) and (v #>> '{}')::numeric <= 1, false)
      then 'a fraction above 0 and at most 1' end
    when 'reactionCap' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'charactersPerPlayer' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'settlementCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'viewCountCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'meetingCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    -- The spans the earlier triggers hold, but let through with a field missing.
    when 'settlementLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'seasonLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'turnCooldown' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'inviteLifetime' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'setLasts' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'editGrace' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'presenceWindow' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'registrationMode' then case when v not in ('"open"', '"invite"', '"closed"') then '"open", "invite" or "closed"' end
    when 'postMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'titleMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'postsPerPage' then case when not setting_whole(v, 1) then 'a whole number of posts, at least 1' end
    when 'hotReplies' then case when not setting_whole(v, 1) then 'a whole number of replies, at least 1' end
    when 'presenceNames' then case when not setting_whole(v, 1) then 'a whole number of names, at least 1' end
    when 'presencePollSeconds' then case when not setting_whole(v, 10, 300) then 'a whole number of seconds from 10 to 300' end
    when 'cardSettings' then case when not setting_named_numbers(v) then 'an object of named numbers' end
    when 'systemEnabled' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'oldVoice' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'cardWriteSettleSeconds' then case when not setting_whole(v, 0, 600) then 'a whole number of seconds, at least 0 and at most 600' end
    -- The old voice's window (§4 of docs/plans/2026-11-12-old-voice-window-design.md), in the words engine/rules/instance.ts gives each.
    when 'oldVoiceWindow' then case when not setting_whole(v, 64, 1000000) then 'a whole number of tokens from 64 to 1,000,000' end
    when 'oldVoiceTokenizer' then case when v not in ('"gpt2"', '"bytes"') then '"gpt2" or "bytes"' end
    when 'oldVoicePromptFloor' then case when not setting_whole(v, 1) then 'a whole number of tokens, at least 1' end
    when 'cardWriteFullShare' then case when not coalesce(case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric between 0 and 1 end, false) then 'a number from 0 to 1' end
    when 'cardWriteTopUps' then case when not setting_whole(v, 0, 5) then 'a whole number from 0 to 5' end
    when 'hints' then case when not coalesce(jsonb_typeof(v) = 'object'
        and setting_whole(v -> 'least', 1)
        and jsonb_typeof(v -> 'share') = 'number' and (v ->> 'share')::numeric > 0.5 and (v ->> 'share')::numeric <= 1
        and jsonb_typeof(v -> 'split') = 'number' and setting_positive(v -> 'split') and (v ->> 'split')::numeric <= 0.5
        and setting_span(v -> 'window', array['minute', 'day', 'week', 'month']), false)
      then 'an object giving least (a whole number of reactions, at least 1), share (above 0.5, at most 1), split (above 0, at most 0.5) and window (a span: a unit of minute, day, week or month and a whole count from 1 to 1000)' end
    when 'toastDefaults' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all (kinds))
        and (select count(*) = count(distinct e) from jsonb_array_elements(v) e), false)
      then 'a list of the kinds of alert that toast (' || array_to_string(kinds, ', ') || '), each named once' end
    when 'phases' then null  -- below: it needs a loop
    when 'inheritanceGraceDays' then case when not setting_whole(v, 0) then 'a whole number of days, at least 0' end
    when 'rosterRecentExcluded' then case when not setting_whole(v, 0) then 'a whole number of Bosses, at least 0' end
    when 'structuralHoldHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'microEventDailyCalls' then case when not setting_whole(v, 0) then 'a whole number of calls, at least 0' end
    when 'digestThreads' then case when not setting_whole(v, 1, 25) then 'a whole number of threads, at least 1 and at most 25' end
    when 'digestExcerpts' then case when not setting_whole(v, 1, 20) then 'a whole number of posts, at least 1 and at most 20' end
    when 'digestBoards' then case when not setting_whole(v, 1, 30) then 'a whole number of boards, at least 1 and at most 30' end
    when 'digestBoardDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'movedStubDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'bundleMostParts' then case when not setting_whole(v, 1, 16) then 'a whole number of parts, at least 1 and at most 16' end
    when 'bundleAuthoredMostParts' then case when not setting_whole(v, 1, 16) then 'a whole number of parts, at least 1 and at most 16' end
    when 'farewellWindowHours' then case when not setting_whole(v, 1, 720) then 'a whole number of hours, at least 1 and at most 720' end
    when 'digestExcerptChars' then case when not setting_whole(v, 1, 1000) then 'a whole number of characters, at least 1 and at most 1000' end
    when 'memoryOpinions' then case when not setting_whole(v, 1) then 'a whole number of opinions, at least 1' end
    when 'memoryGrudges' then case when not setting_whole(v, 1) then 'a whole number of grudges, at least 1' end
    when 'memoryWheelhouse' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'memoryRealWorld' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'boardNameMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'moveExpiryMostDays' then case when not setting_whole(v, 1) then 'a whole number of days, at least 1' end
    when 'moveExpiryLeastHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'demandCheckMinutes' then case when not setting_whole(v, 1, 1440) then 'a whole number of minutes, at least 1 and at most 1440' end
    when 'demandChecksPerTick' then case when not setting_whole(v, 1, 1000) then 'a whole number of moves, at least 1 and at most 1000' end
    when 'searchLanguage' then case when not coalesce(jsonb_typeof(v) = 'string' and exists (select 1 from pg_ts_config c where c.cfgname = v #>> '{}'), false)
      then 'the name of a text search configuration this database holds (english or simple, for example)' end
    when 'searchRankPool' then case when not setting_whole(v, 100, 100000) then 'a whole number of matches from 100 to 100,000' end
    when 'pool' then setting_pool(v)
    when 'modBots' then setting_modbots(v)
    when 'warnBar' then setting_warnbar(v)
    when 'pronouns' then case when not pronouns_hold(pronouns_lowered(v)) then 'an object of five words of 1 to 12 letters each (an apostrophe or a hyphen between two letters is allowed) and a plural, true or false' end
    when 'apology' then setting_apology(v)
    when 'conduct' then setting_conduct(v)
    when 'conductVersion' then case when not setting_whole(v, 1) then 'a whole number, at least 1 (the version of the code of conduct)' end
    when 'conductSections' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) is distinct from 'string' or btrim(e #>> '{}', E' \t\n\r\f\v') = ''), false)
      then 'an array of section keys, each a non-blank string' end
    when 'cosmetics' then setting_cosmetics(v)
    -- The pack an account's first character is given (0377): the key of a pack, or null for none. That it names a fixed pack of the instance is the instance check's (engine/rules/instance.ts) and
    -- welcome_pack_kind's: a name that is no fixed pack grants nothing.
    when 'startingPack' then case when not (jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}', E' \t\n\r\f\v') <> '')) then 'the key of a fixed pack, or null for none' end
    when 'modelTiers' then case when not coalesce(jsonb_typeof(v) = 'object'
        and jsonb_typeof(v -> 'strong') = 'string' and btrim(v ->> 'strong', E' \t\n\r\f\v') <> ''
        and jsonb_typeof(v -> 'light') = 'string' and btrim(v ->> 'light', E' \t\n\r\f\v') <> '', false)
      then 'an object naming a model id for "strong" and for "light"' end
    else null
  end;
  if new.key = 'phases' then
    shape := 'an object of honeymoon, reign and meltdown, each holding its numbers (honeymoon and meltdown also their days) as whole numbers, at least 1';
    if jsonb_typeof(v) <> 'object' then raise exception 'phases is %', shape using errcode = '23514'; end if;
    foreach phase in array array['honeymoon', 'reign', 'meltdown'] loop
      if jsonb_typeof(v -> phase) is distinct from 'object' then raise exception 'phases is %; "%" is missing', shape, phase using errcode = '23514'; end if;
      foreach pkey in array case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                                 else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end loop
        if not setting_whole(v -> phase -> pkey, 1) then raise exception 'phases is %; "%.%" is not', shape, phase, pkey using errcode = '23514'; end if;
      end loop;
      select k into pkey from jsonb_object_keys(v -> phase) k
        where k <> all (case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                             else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end) limit 1;
      if pkey is not null then raise exception 'phases is %; "%.%" is not a number a phase holds', shape, phase, pkey using errcode = '23514'; end if;
    end loop;
  end if;
  if why is not null then raise exception '% is %', new.key, why using errcode = '23514'; end if;
  return new;
end $function$;

-- log_page (0368's), whose `packs` source also carries each pack's `source` (and, through my_packs, answers `contents` null while a pack is sealed); everything else as 0368 wrote it.
create or replace function public.log_page(in_before timestamp with time zone)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  WITH RECURSIVE mine AS (
          SELECT m.id,
             m.class_since
            FROM my_characters m
         ), lg AS MATERIALIZED (
          SELECT l.settlement,
             l.starts_at,
             l.ends_at,
             l."character",
             l.reason,
             l.amount,
             l.shares_kept,
             l.params
            FROM my_ledger l
           WHERE (l.ends_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY l.ends_at DESC, l.settlement, l."character", l.reason
          LIMIT 200
         ), wl AS MATERIALIZED (
          SELECT e.settlement,
             e.kind,
             e.change,
             e.overflow,
             e.floored,
             e.balance_after,
             e.ref,
             e.at
            FROM my_wallet_events e
           WHERE (e.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY e.at DESC, e.settlement, e.kind, e.ref, e.change, e.overflow, e.floored, e.balance_after
          LIMIT 200
         ), cd AS MATERIALIZED (
          SELECT c.card,
             c.kind,
             c.act,
             c.price,
             c.at,
             c.springs,
             c.pack,
             c.repriced
            FROM my_card_ledger c
           WHERE (c.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY c.at DESC, c.card, c.kind, c.act, c.price, c.pack
          LIMIT 200
         ), pk AS MATERIALIZED (
          SELECT p.id,
             p.pack,
             p.price,
             p.repriced,
             p.contents,
             p.bought_at,
             p.source
            FROM my_packs p
           WHERE (p.bought_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY p.bought_at DESC, p.id
          LIMIT 200
         ), po AS MATERIALIZED (
          SELECT p.play,
             p.post,
             p.at,
             p.reach,
             p.target_name,
             p.target_character
            FROM my_posts_played_on p
           WHERE (p.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY p.at DESC, p.play
          LIMIT 200
         ), wr AS MATERIALIZED (
          SELECT w.play,
             w.post,
             w.version,
             w.failed,
             w.opening,
             w.over,
             w.at
            FROM my_posts_written_on w
           WHERE (w.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY w.at DESC, w.play, w.version
          LIMIT 200
         ), dr AS MATERIALIZED (
          SELECT r.act,
             r.kind,
             r.play,
             r.post,
             r."character",
             r.mine,
             r.at,
             r.cells
            FROM my_draws r
           WHERE (r.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY r.at DESC, r.act, r.mine
          LIMIT 200
         ), wd AS MATERIALIZED (
          SELECT r.act,
             r.kind,
             r.play,
             r.post,
             r."character",
             r.mine,
             r.at,
             r.cells
            FROM my_walls_drawn_on r
           WHERE (r.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY r.at DESC, r.act, r.mine
          LIMIT 200
         ), sv AS MATERIALIZED (
          SELECT p.play,
             p.post,
             p.saved_at
            FROM my_posts_played_on p
           WHERE ((p.saved_at IS NOT NULL) AND (p.saved_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone)))
           ORDER BY p.saved_at DESC, p.play
          LIMIT 200
         ), se AS MATERIALIZED (
          SELECT f.play,
             f.card,
             f.post,
             f.spring,
             f.ended_at,
             f.ended_by
            FROM my_face_down f
           WHERE ((f.ended_at IS NOT NULL) AND (f.ended_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone)))
           ORDER BY f.ended_at DESC, f.play
          LIMIT 200
         ), sp AS MATERIALIZED (
          SELECT f.play,
             f.card,
             f.post,
             f.ends_at,
             f.passed_at
            FROM my_face_down f
           WHERE ((f.passed_at IS NOT NULL) AND (f.spring IS NULL) AND (f.passed_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone)))
           ORDER BY f.passed_at DESC, f.play
          LIMIT 200
         ), ca AS MATERIALIZED (
          SELECT c.play,
             c.card,
             c.post,
             c.trap,
             c.spring,
             c.price,
             c.at
            FROM my_caught c
           WHERE (c.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY c.at DESC, c.play
          LIMIT 200
         ), en AS MATERIALIZED (
          SELECT e.card_end,
             e.play,
             e.card,
             e.at,
             e.side,
             e.reach,
             e.target_name,
             e.post_author_name,
             e.caster_name,
             e."character"
            FROM my_cards_ended e
           WHERE (e.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY e.at DESC, e.card_end
          LIMIT 200
         ), inf AS MATERIALIZED (
          SELECT i.infraction,
             i."character",
             i.at,
             i.band,
             i.points,
             i.rule_number,
             i.rule,
             i.mod_name,
             i.post,
             i.post_seq,
             i.thread,
             i.expires_at,
             i.relief,
             i.emptied_at,
             i.card_relief,
             i.fall_play
            FROM my_infractions i
           WHERE (i.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY i.at DESC, i.infraction
          LIMIT 200
         ), bn AS MATERIALIZED (
          SELECT b.ban,
             b."character",
             b.at,
             b.days,
             b.until,
             b.infraction,
             b.rule,
             b.thread,
             b.ruling,
             b.own_until,
             b.lifted_at,
             b.lifted_card
            FROM my_bans b
           WHERE (b.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY b.at DESC, b.ban
          LIMIT 200
         ), fl AS MATERIALIZED (
          SELECT f.infraction,
             f."character",
             f.at,
             f.post,
             f.post_seq,
             f.thread,
             f.rule,
             f.points,
             f.mod_name,
             f.taker_name
            FROM my_falls_taken f
           WHERE (f.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY f.at DESC, f.infraction
          LIMIT 200
         ), gm AS MATERIALIZED (
          SELECT g.move,
             g."character",
             g.at,
             g.thread,
             g.seq,
             g."group",
             g.board,
             g.board_name,
             g.expires_at,
             g.landed_until,
             g.check_at,
             g.demand,
             g.office,
             g.ended_why,
             g.ended_by,
             g.ended_at,
             g.ruling,
             g.ruled_at,
             g.ruled_until,
             g.ruled_office
            FROM my_group_moves g
           WHERE (g.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY g.at DESC, g.move
          LIMIT 200
         ), rp AS MATERIALIZED (
          SELECT r.report,
             r."character",
             r.at,
             r.post,
             r.post_seq,
             r.thread,
             r.verdict,
             r.verdict_at,
             r.mod_name,
             r.refund
            FROM my_reports r
           WHERE (r.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY r.at DESC, r.report
          LIMIT 200
         ), ap AS MATERIALIZED (
          SELECT a.appeal,
             a."character",
             a.at,
             a.punishment,
             a.punishment_kind,
             a.post_seq,
             a.thread,
             a.verdict,
             a.ruled_at,
             a.points_delta,
             a.hearer_name,
             a.refund
            FROM my_appeals a
           WHERE (a.at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY a.at DESC, a.appeal
          LIMIT 200
         ), cs AS MATERIALIZED (
          SELECT c.kind,
             c.id,
             c.at,
             c."character",
             c.outcome,
             c.item,
             c.text,
             c.copies,
             c.trophy,
             c.name,
             c.by,
             c.by_name,
             c.season,
             c.place,
             c.line,
             c.to_name
            FROM cosmetic_log_rows(log_page.in_before, 200) c(kind, id, at, "character", outcome, item, text, copies, trophy, name, by, by_name, season, place, line, to_name)
           ORDER BY c.at DESC, c.kind, c.id
         ), sh AS MATERIALIZED (
          SELECT s.settlement,
             s."character",
             s.reason,
             s.act,
             s.quadrant,
             s.amount,
             s.card
            FROM my_ledger_shares s
           WHERE (s.settlement IN ( SELECT x.settlement
                    FROM lg x))
         ), sa AS MATERIALIZED (
          SELECT s.settlement,
             s."character",
             s.named_class,
             s.play,
             s.card,
             s.starts_at,
             s.ends_at
            FROM my_scored_as s
           WHERE (s.ends_at <= COALESCE(log_page.in_before, 'infinity'::timestamp with time zone))
           ORDER BY s.ends_at DESC, s.settlement, s."character"
          LIMIT 200
         ), tn AS MATERIALIZED (
          SELECT t.act,
             t."character",
             t.at,
             t.was
            FROM turns_announced t
           WHERE (t."character" IN ( SELECT m.id
                    FROM mine m))
         ), named(id) AS (
          SELECT x.act
            FROM sh x
           WHERE (x.act IS NOT NULL)
         UNION
          SELECT t.act
            FROM tn t
           WHERE (EXISTS ( SELECT 1
                    FROM mine m
                   WHERE ((m.id = t."character") AND (date_trunc('milliseconds'::text, m.class_since) = date_trunc('milliseconds'::text, t.at)))))
         UNION
          SELECT x.act
            FROM cd x
           WHERE (x.act IS NOT NULL)
         UNION
          SELECT x.play
            FROM po x
         UNION
          SELECT x.post
            FROM po x
           WHERE (x.post IS NOT NULL)
         UNION
          SELECT x.play
            FROM wr x
         UNION
          SELECT x.post
            FROM wr x
         UNION
          SELECT x.play
            FROM dr x
         UNION
          SELECT x.post
            FROM dr x
         UNION
          SELECT x.play
            FROM wd x
         UNION
          SELECT x.post
            FROM wd x
         UNION
          SELECT x.play
            FROM sv x
         UNION
          SELECT x.post
            FROM sv x
           WHERE (x.post IS NOT NULL)
         UNION
          SELECT x.post
            FROM se x
           WHERE (x.post IS NOT NULL)
         UNION
          SELECT x.spring
            FROM se x
           WHERE (x.spring IS NOT NULL)
         UNION
          SELECT x.post
            FROM sp x
           WHERE (x.post IS NOT NULL)
         UNION
          SELECT x.play
            FROM ca x
         UNION
          SELECT x.post
            FROM ca x
           WHERE (x.post IS NOT NULL)
         UNION
          SELECT x.play
            FROM en x
         UNION
          SELECT x.ref
            FROM wl x
           WHERE ((x.kind = ANY (ARRAY['bribe'::text, 'gift_out'::text, 'gift_in'::text])) AND (x.ref IS NOT NULL))
         ), walk(id, depth) AS (
          SELECT n.id,
             0 AS "?column?"
            FROM named n
         UNION
          SELECT f.id,
             (w.depth + 1)
            FROM ((walk w
              JOIN acts_public a ON ((a.id = w.id)))
              CROSS JOIN LATERAL ( VALUES (
                         CASE
                             WHEN (a.kind = ANY (ARRAY['card'::text, 'spring'::text, 'set'::text, 'donation'::text])) THEN a.target_act_id
                             ELSE NULL::uuid
                         END), (
                         CASE
                             WHEN ((a.kind = 'intercept'::text) AND ((a.payload ->> 'visit_act'::text) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)) THEN ((a.payload ->> 'visit_act'::text))::uuid
                             ELSE NULL::uuid
                         END), (
                         CASE
                             WHEN ((a.kind = ANY (ARRAY['spring'::text, 'card'::text])) AND ((a.payload ->> 'spring'::text) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)) THEN ((a.payload ->> 'spring'::text))::uuid
                             ELSE NULL::uuid
                         END), (
                         CASE
                             WHEN ((a.kind = 'spring'::text) AND ((a.payload ->> 'caught'::text) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)) THEN ((a.payload ->> 'caught'::text))::uuid
                             ELSE NULL::uuid
                         END), (
                         CASE
                             WHEN ((a.kind = 'spring'::text) AND ((a.payload ->> 'by'::text) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)) THEN ((a.payload ->> 'by'::text))::uuid
                             ELSE NULL::uuid
                         END)) f(id))
           WHERE ((w.depth < 2) AND (f.id IS NOT NULL))
         ), ac AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a
           WHERE (a.id IN ( SELECT w.id
                    FROM walk w))
         ), reach AS MATERIALIZED (
          SELECT (a.payload ->> 'reach'::text) AS kind,
                 CASE
                     WHEN ((a.payload ->> (a.payload ->> 'reach'::text)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN ((a.payload ->> (a.payload ->> 'reach'::text)))::uuid
                     ELSE NULL::uuid
                 END AS target
            FROM ac a
           WHERE ((a.kind = 'card'::text) AND (jsonb_typeof((a.payload -> 'targetName'::text)) IS DISTINCT FROM 'string'::text) AND ((a.payload ->> 'reach'::text) = ANY (ARRAY['character'::text, 'thread'::text, 'board'::text])))
         ), pe(id) AS (
          SELECT a."character"
            FROM ac a
           WHERE ((a."character" IS NOT NULL) AND (NOT (a."character" IN ( SELECT m.id
                    FROM mine m))))
         UNION
          SELECT x."character"
            FROM dr x
           WHERE (NOT (x."character" IN ( SELECT m.id
                    FROM mine m)))
         UNION
          SELECT x."character"
            FROM wd x
           WHERE (NOT (x."character" IN ( SELECT m.id
                    FROM mine m)))
         UNION
          SELECT r.target
            FROM reach r
           WHERE ((r.kind = 'character'::text) AND (r.target IS NOT NULL) AND (NOT (r.target IN ( SELECT m.id
                    FROM mine m))))
         ), th(id) AS (
          SELECT a.thread
            FROM ac a
           WHERE (a.id IN ( SELECT t.act
                    FROM tn t
                   WHERE (EXISTS ( SELECT 1
                            FROM mine m
                           WHERE ((m.id = t."character") AND (date_trunc('milliseconds'::text, m.class_since) = date_trunc('milliseconds'::text, t.at)))))))
         UNION
          SELECT r.target
            FROM reach r
           WHERE ((r.kind = 'thread'::text) AND (r.target IS NOT NULL))
         )
  SELECT jsonb_build_object('sources', jsonb_build_object('ledger', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.ends_at DESC, x.settlement, x."character", x.reason) AS jsonb_agg
            FROM lg x), '[]'::jsonb), 'wallet', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.settlement, x.kind, x.ref, x.change, x.overflow, x.floored, x.balance_after) AS jsonb_agg
            FROM wl x), '[]'::jsonb), 'cards', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.card, x.kind, x.act, x.price, x.pack) AS jsonb_agg
            FROM cd x), '[]'::jsonb), 'packs', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.bought_at DESC, x.id) AS jsonb_agg
            FROM pk x), '[]'::jsonb), 'playsOnMine', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.play) AS jsonb_agg
            FROM po x), '[]'::jsonb), 'writes', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.play, x.version) AS jsonb_agg
            FROM wr x), '[]'::jsonb), 'draws', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.act, x.mine) AS jsonb_agg
            FROM dr x), '[]'::jsonb), 'wallsDrawn', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.act, x.mine) AS jsonb_agg
            FROM wd x), '[]'::jsonb), 'saves', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.saved_at DESC, x.play) AS jsonb_agg
            FROM sv x), '[]'::jsonb), 'setEnds', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.ended_at DESC, x.play) AS jsonb_agg
            FROM se x), '[]'::jsonb), 'setPasses', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.passed_at DESC, x.play) AS jsonb_agg
            FROM sp x), '[]'::jsonb), 'caught', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.play) AS jsonb_agg
            FROM ca x), '[]'::jsonb), 'ended', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.card_end) AS jsonb_agg
            FROM en x), '[]'::jsonb), 'infractions', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.infraction) AS jsonb_agg
            FROM inf x), '[]'::jsonb), 'bans', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.ban) AS jsonb_agg
            FROM bn x), '[]'::jsonb), 'falls', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.infraction) AS jsonb_agg
            FROM fl x), '[]'::jsonb), 'groupMoves', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.move) AS jsonb_agg
            FROM gm x), '[]'::jsonb), 'reports', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.report) AS jsonb_agg
            FROM rp x), '[]'::jsonb), 'appeals', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.appeal) AS jsonb_agg
            FROM ap x), '[]'::jsonb), 'cosmetics', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.at DESC, x.kind, x.id) AS jsonb_agg
            FROM cs x), '[]'::jsonb)), 'shares', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.settlement DESC, x."character", x.reason, x.card, x.act, x.quadrant) AS jsonb_agg
            FROM sh x), '[]'::jsonb), 'scoredAs', COALESCE(( SELECT jsonb_agg(to_jsonb(x.*) ORDER BY x.ends_at DESC, x.settlement, x."character") AS jsonb_agg
            FROM sa x), '[]'::jsonb), 'acts', COALESCE(( SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.created_at, ((a.id)::text COLLATE "C")) AS jsonb_agg
            FROM ac a), '[]'::jsonb), 'states', COALESCE(( SELECT jsonb_agg(to_jsonb(e.*) ORDER BY ((e.play)::text COLLATE "C")) AS jsonb_agg
            FROM ( SELECT s.play,
                     s.state,
                     s.saved_at
                    FROM effect_state s
                   WHERE (s.play IN ( SELECT v.play
                            FROM sv v))) e), '[]'::jsonb), 'people', COALESCE(( SELECT jsonb_agg(f.face ORDER BY f.name, f.id) AS jsonb_agg
            FROM ( SELECT cp.name,
                     cp.id,
                     (to_jsonb(cp.*) || jsonb_build_object('profile', ( SELECT (to_jsonb(p.*) || profile_cosmetics(p."character"))
                            FROM ( SELECT r."character",
                                     r.title,
                                     r.signature,
                                     r.avatar_square,
                                     r.avatar_portrait,
                                     r.square_frame,
                                     r.portrait_frame,
                                     r.pip_style,
                                     r.pronouns
                                    FROM character_profiles r
                                   WHERE (r."character" = cp.id)) p))) AS face
                    FROM ( SELECT c.id,
                             c.name,
                             c.joined,
                             c.staff,
                             c.office,
                             c."group"
                            FROM characters_public c
                           WHERE (c.id IN ( SELECT p.id
                                    FROM pe p))) cp) f), '[]'::jsonb), 'threads', COALESCE(( SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.created_at, ((t.id)::text COLLATE "C")) AS jsonb_agg
            FROM thread_open t
           WHERE (t.id IN ( SELECT h.id
                    FROM th h))), '[]'::jsonb), 'boards', COALESCE(( SELECT jsonb_agg(to_jsonb(b.*) ORDER BY ((b.id)::text COLLATE "C")) AS jsonb_agg
            FROM ( SELECT n.id,
                     n.slug,
                     n.name,
                     n.description,
                     n.is_system,
                     n.move_act
                    FROM boards_now n
                   WHERE (n.id IN ( SELECT r.target
                            FROM reach r
                           WHERE ((r.kind = 'board'::text) AND (r.target IS NOT NULL))))) b), '[]'::jsonb), 'standings', COALESCE(( SELECT jsonb_agg(to_jsonb(s.*) ORDER BY ((s."character")::text COLLATE "C")) AS jsonb_agg
            FROM ( SELECT c."character",
                     c.standing
                    FROM current_standings c
                   WHERE (c."character" IN ( SELECT m.id
                            FROM mine m))) s), '[]'::jsonb), 'turns', COALESCE(( SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.at, ((t.act)::text COLLATE "C")) AS jsonb_agg
            FROM tn t), '[]'::jsonb), 'season', ( SELECT to_jsonb(s.*) AS to_jsonb
            FROM current_season s
          LIMIT 1)) AS jsonb_build_object
  );
end
$function$;

-- Grants: create or replace keeps each replaced function's, and the new ones are granted where they are made (welcome_pack_kind to the service role, open_pack to authenticated alone).

-- card_in_open_pack (0140's, the same signature, search_path and grants), also counting a fixed pack on sale: it can give a card that is in its `contents`. A pull pack as 0140 wrote it.
create or replace function card_in_open_pack(card text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from card_kinds c
    join machine_slots s on s.pack is not null and s.availability = 'onSale'
    join pack_kinds p on p.key = s.pack
    where c.key = card_in_open_pack.card
      and case when p.contents is not null then c.key = any (p.contents)
               else c.key <> all (p.leaves) and exists (select 1 from jsonb_array_elements(p.pulls) e where (e -> 'weights') ? c.rarity) end
  )
$$;
