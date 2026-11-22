-- A card that cuts, a Move that ends a Gimmick early (docs/plans/2026-11-21-buzzkill-plan.md, Task 2; design docs/plans/2026-11-21-buzzkill-design.md, sections 3.1 to 3.3), for Buzzkill.
-- A play of a card that cuts ends one live Gimmick (a Use card's play) on its target, the one its configuration names (`play`), no rarer than the card's `upTo`. The Buzzkill's own Act carries `cut: {play, card}`; the Gimmick is over
-- while some landed Buzzkill names it and no admin has ended that Buzzkill, computed (card_cut_at), never written over.
-- Each object here is copied whole from its latest version on main, with only the change named.
--
--   1. card_kinds               gains `cuts jsonb`. card_kinds_beyond_lasts (0361) also lets a card that cuts reach a character with no time up (the plan's Task 2 does not name it; the table refuses a Buzzkill without it).
--   2. seed_instance            copied whole from 0403_departed_personas.sql: `cuts` joins the card insert's columns, values and on-conflict update.
--   3. card_kinds_problem       copied whole from 0402_thread_lockout.sql (the plan named 0400; #936's lockout is in 0402): the cuts sentences in the engine's words (instance.ts, cutsProblems), beside the pierce's.
--   4. card_reach_problem       copied whole from 0361_discipline_cards.sql: a card that cuts is passed by the "reaches beyond a post with no time up" case, as a relief and an unban are.
--   5. face_down_never_writes   copied whole from 0361_discipline_cards.sql: a card that cuts is refused a back in the words decideSet gives a faceUpOnly card ("<name> is cast face up and never set face down").
--   6. acts_cut_play            a partial expression index on the Acts that name a Gimmick they cut.
--   7. card_cut_at              new: when a card that cuts ended a play, or null. It reads `card_end` itself and never calls card_ended. Not granted to an API role (0005-default-deny holds the callable list): card_ended, settlement_input
--                               and estimate_input, its callers, are definers.
--   7b. cutting_acts            new: the ids of the Acts that cut any of up to 1000 plays and were not caught, for the page (acts_public cannot use acts_cut_play); granted to authenticated as the other id-list reads are.
--   8. card_ended               copied whole from 0400_pierce.sql: a fourth way a play is over, `card_cut_at(play) is not null`.
--   9. cut_refusal              new: the engine's words that turn a card that cuts away (none up, none named, not up, rarer than upTo), from the target's public plays and the cards' printed rarity. Revoked from everyone, as wards_against is.
--  10. place_cast               copied whole from 0402_thread_lockout.sql (the plan named 0400): a card that cuts is instant (also on a post: `instant`, no layer, no place in the post's stack), refused a staff caster in plain words, asked
--                               cut_refusal after the Ward check and the landing's refusal (post) or after the Ward check (character), locks the caster's live pierce rows, and a cut's named play row, in ONE statement in play order before each pierce loop (a global order over play_reach rows),
--                               and writes `cut: {play, card}` when it lands (not when a back caught it). The refunds lookup leaves out the play the cut names, so a Salty cut of a live Kick Me is not handed back by it. `is_unban` splits the unban's own work (the bans it lifts) from what every instant card shares.
--  11. reverse_card             copied whole from 0402_thread_lockout.sql (the plan named 0349, and 0402 already asks the admin's end and a refunded write in cases of their own, not through card_ended): after those, a play a card cut
--                               says "a <card> already ended that card; end that card to bring this one back", and any other play that is over (a pierce a cast spent) says "that card is already over".
--  12. settlement_input,        copied whole from 0398_debates_fixes.sql: the `ends` each card Act is sent with is the least of its own and card_cut_at (`least` skips a null), so engine/rules/settle.ts, which pays an earn, a flat earn, a
--      estimate_input           cushion, a skim and a ride only inside [at, ends), pays nothing of a cut play from the cut on, and votes before the cut keep what they earned.
--
-- Every other place the two inputs read a play's end (`ends`) is a pre-filter, left as it was, because the rules narrow it again with the `ends` they are sent:
--   settlement_input: earn_up (`ends > window_start`), cushion_plays (`ends > s.at`, both branches), skim_up (`ends > window_start`) and ride_gimmicks (`ends > rc.created_at`);
--   estimate_input: earn_up, skim_up, my_gimmicks (`ends > window_start`, and its `ends` bounds ride_casts, which only chooses which casts' reactions are read), cushion_plays.
-- Each of them admits a cut play whose own end is later than the cut, and may send it where the cut end alone would not have; the sent `ends` is then the cut's, and settle.ts reads only that. Only the `ends` sent in
-- the acts list was changed. A cut play is not in the `ended` list those functions build (it reads an admin's `card_end` Acts alone), so a cut play is never voided whole, and votes before the cut keep what they earned.
--
-- Ways out: a play of a card that cuts is over when it lands and leaves no state. A cut Gimmick is over, as an expired one is; an admin's end of the cutting play (reverse_card) brings it back, computed.
-- Masks: nothing private is read; the cut is a public fact of the play, decided from the target's public plays and the cards' printed rarity.
-- Cost at a busy instance's scale: card_ended gains one probe of acts_cut_play (partial, only the landed Buzzkills; one lookup that finds nothing for every other play), settlement and the estimate gain the same probe for each play they
-- send an `ends` for, and cut_refusal reads the target's live Gimmicks, which the Ward check already reads.

-- ---- 1. card_kinds.cuts ----

alter table card_kinds add column cuts jsonb;
-- A card beyond a post needs a time up, except a relief, an unban and a card that cuts, which are over when they land (card_kinds_beyond_lasts, 0361's, with `cuts is not null` beside the discipline).
alter table card_kinds drop constraint card_kinds_beyond_lasts;
alter table card_kinds add constraint card_kinds_beyond_lasts check (reaches = '{post}' or lasts is not null or coalesce(discipline ->> 'kind' in ('relief', 'unban'), false) or cuts is not null);

-- ---- 2. seed_instance ----

-- seed_instance (0403_departed_personas), `cuts` joins the card insert's columns, values and on-conflict update, beside `refunds`. Everything else as 0403_departed_personas wrote it.
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
  listed text[];
  first_staff text[];
  departing text[];
  departed text[] := '{}';
  returned text[] := '{}';
  open_id bigint;
  boss_was text;
  handed text;
  mods_were bigint;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  -- And then the offices lock, before any persona row is written: set_office and a handover take it first and then row-lock a persona, so a seed that took it after its persona upserts would wait on a row an admin
  -- holds while the admin waits on this lock. One order everywhere: seed lock, offices lock, rows.
  perform pg_advisory_xact_lock(hashtext('kayfabb.offices'));
  -- The settings trigger (settings_tuned) marks a row tuned for any write but a seed's: this transaction is the seed's, so its writes leave no mark.
  perform set_config('kayfabb.seeding', 'on', true);
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the numbers its rules read stay in the row with it.
  perform seed_setting(e.key, e.value) from jsonb_each(payload -> 'settings') e;
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
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, refunds, discipline, lasts, reaches, pins, writes, replies, keeps, skim, scores_as, draws, drive, needs_message, veil, adds_reaction, surface, cuts)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), nullif(e -> 'refunds', 'null'), nullif(e -> 'discipline', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    coalesce((e ->> 'replies')::boolean, false), coalesce((e ->> 'keeps')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false),
    case when jsonb_typeof(e -> 'draws') = 'array' then array(select jsonb_array_elements_text(e -> 'draws')) end, nullif(e -> 'drive', 'null'), nullif(e ->> 'needsMessage', ''),
    nullif(e ->> 'veil', ''), coalesce((e ->> 'addsReaction')::boolean, false), coalesce((e ->> 'surface')::boolean, false), nullif(e -> 'cuts', 'null')
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, refunds = excluded.refunds, discipline = excluded.discipline, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, replies = excluded.replies, keeps = excluded.keeps, skim = excluded.skim, scores_as = excluded.scores_as,
    draws = excluded.draws, drive = excluded.drive, needs_message = excluded.needs_message, veil = excluded.veil, adds_reaction = excluded.adds_reaction, surface = excluded.surface, cuts = excluded.cuts;
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
  -- The seed's roster is the whole staff (docs/plans/2026-11-21-departed-personas-design.md, sections 2 and 3). A persona the roster does not list, and that the seed has not already benched, is departing. This block runs last,
  -- after the persona files, the roster setting, the season and its first Boss and the announcements thread are in place, so a departing Boss's handover reads the roster this seed wrote and says its farewell in the thread.
  -- It runs after (and not inside) the `firstStaff` hire above, which hires only a persona with no office row: a persona the seed benched has one, so it is brought back here and only by a roster that lists it. A seed that
  -- lists no persona (a partial seed) is not a roster and benches nobody, as it leaves `bossRoster` as it was.
  listed := array(select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ->> 'key' is not null);
  first_staff := array(select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k);
  if cardinality(listed) > 0 then
    -- The offices lock is held since the top of this function, so what stands is what is read.
    select s.id, s.boss into open_id, boss_was from seasons s where s.ends_at is null;
    mods_were := (select count(*) from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and c.retired_at is null);
    -- A persona listed again after a seed benched it comes back first, so a Boss that is leaving can hand the chair to it: a Mod where firstStaff names it, else a member. A member row debuts nothing; a Mod row debuts it,
    -- as the firstStaff hire does.
    returned := array(
      select k from unnest(listed) k
      where exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona' and c.retired_at is null)
        and (select o.office = 'benched' and o.cause = 'seed' from staff_offices o where o.staff = k order by o.id desc limit 1));
    insert into staff_offices (staff, office, cause) select k, case when k = any (first_staff) then 'mod' else 'member' end, 'seed' from unnest(returned) k;
    update characters c set debuted_at = now() where c.debuted_at is null and c.staff_kind = 'persona' and c.staff = any (returned) and c.staff = any (first_staff);
    departing := array(
      select c.staff from characters c
      where c.staff_kind = 'persona' and c.retired_at is null and c.staff <> all (listed)
        and not coalesce((select o.office = 'benched' and o.cause = 'seed' from staff_offices o where o.staff = c.staff order by o.id desc limit 1), false)
      order by c.staff);
    -- The other departing personas first, so neither the rotation nor a standing nomination can seat one.
    insert into staff_offices (staff, office, cause) select k, 'benched', 'seed' from unnest(departing) k where k is distinct from boss_was;
    departed := array(select k from unnest(departing) k where k is distinct from boss_was);
    if boss_was is not null and boss_was = any (departing) then
      -- The early handover, in the open season: it refuses (and the seed with it, nothing written) where no one else can sit in the chair. Its farewell is posted before the bench below, since a benched persona writes nothing.
      perform hand_over(open_id, boss_was, now(), true);
      insert into staff_offices (staff, office, cause) values (boss_was, 'benched', 'seed');
      departed := departed || boss_was;
      select s.boss into handed from seasons s where s.id = open_id;
    end if;
    -- The staff is never empty: where a Mod stood before this seed and none stands now (it benched the last one, or the Boss's handover did), each listed firstStaff persona that is not the Boss is hired. If that still leaves none,
    -- the seed is refused. A staff that had no Mod before this seed is not this seed's doing, so it is left as it was (the firstStaff hire above is how a first seed gets its Mod).
    if mods_were > 0
       and not exists (select 1 from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and c.retired_at is null) then
      insert into staff_offices (staff, office, cause)
      select k, 'mod', 'seed' from unnest(first_staff) k
      where k = any (listed) and k is distinct from (select s.boss from seasons s where s.id = open_id)
        and exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona' and c.retired_at is null);
      update characters c set debuted_at = now() where c.debuted_at is null and c.staff_kind = 'persona' and c.staff = any (first_staff)
        and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod' and x.id = (select max(y.id) from staff_offices y where y.staff = c.staff));
      if not exists (select 1 from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and c.retired_at is null) then
        raise exception 'the seed leaves no Mod Bot on staff: name one in firstStaff' using hint = 'kayfabb.refusal', errcode = '55000';
      end if;
    end if;
  end if;
  -- Seeding ends here: a write later in a transaction that called this (a test file's, one session's) is not the seed's. The flag goes back to the value this found. A custom
  -- setting cannot be truly unset inside a transaction, so one that was unset (null) or empty goes back to 'off', which the trigger reads the same.
  perform set_config('kayfabb.seeding', coalesce(nullif(was, ''), 'off'), true);
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards),
    'departed', to_jsonb(departed), 'returned', to_jsonb(returned), 'handover', to_jsonb(handed));
end $function$;

-- ---- 3. card_kinds_problem ----

-- card_kinds_problem (0402_thread_lockout), with the cuts checks in the engine's words (instance.ts, cutsProblems), each naming the card, beside the pierce's. Everything else as 0402 wrote it. Its grants are as they were (replaced in place).
create or replace function public.card_kinds_problem(cards jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with c as (
    select e ->> 'key' as key, e ->> 'rarity' as rarity, coalesce(e ->> 'play', 'cast') as play, nullif(e -> 'trap', 'null') as trap,
      e #>> '{trap,trigger,on}' as trigger_on, e -> 'gimmick' as gimmick, e,
      case when jsonb_typeof(e -> 'reaches') = 'array' then exists (select 1 from jsonb_array_elements_text(e -> 'reaches') r where r <> 'post') else false end as beyond,
      coalesce(e -> 'reaches' = '["character"]'::jsonb, false) as character_alone,
      coalesce(coalesce(e -> 'reaches', 'null'::jsonb) in ('null'::jsonb, '["post"]'::jsonb), false) as post_alone,
      -- A card has a veil when the key is there and is not a JSON null: seed_instance reads a null through nullif as no veil, and this agrees.
      coalesce(e -> 'veil', 'null'::jsonb) <> 'null'::jsonb as has_veil,
      nullif(e -> 'discipline', 'null') as disc
    from jsonb_array_elements(coalesce(cards, '[]')) e
  ), dc as (
    -- A discipline of a kind the engine knows (the rest is said once, below): its kind, how its card is named in a sentence, and the one reach it takes.
    select c.key, c.e, c.disc, c.play, c.disc ->> 'kind' as kind, case when c.disc ->> 'kind' = 'unban' then 'an unban' else 'a ' || (c.disc ->> 'kind') end as a,
           case when c.disc ->> 'kind' = 'fall' then 'post' else 'character' end as reach_word
    from c where jsonb_typeof(c.disc) = 'object' and c.disc ->> 'kind' in ('relief', 'unban', 'fall', 'watch')
  ), eco as (
    -- The economy and the wallet's cap as the settings hold them now: a drive's gifts and overhead are economy numbers, read when the seed is checked and again at each gift.
    select coalesce((select s.value from settings s where s.key = 'economy' and jsonb_typeof(s.value) = 'object'), '{}'::jsonb) as v,
           (select (s.value #>> '{}')::numeric from settings s where s.key = 'walletCap') as cap
  ), dv as (
    select c.key, c.e, c.e -> 'drive' as d, format('card "%s" has a drive', c.key) as who from c where c.e ? 'drive'
  ), dobj as (
    select dv.*, coalesce(jsonb_typeof(dv.d -> 'lasts') = 'object' and dv.d #>> '{lasts,unit}' in ('hour', 'day', 'week')
             and case when jsonb_typeof(dv.d #> '{lasts,count}') = 'number'
                      then (dv.d #>> '{lasts,count}')::numeric between 1 and 1000 and (dv.d #>> '{lasts,count}')::numeric = trunc((dv.d #>> '{lasts,count}')::numeric)
                      else false end, false) as span_ok
    from dv where jsonb_typeof(dv.d) = 'object'
  ), gifts as (
    select dobj.key, dobj.who, g.v, g.n from dobj, jsonb_array_elements(case when jsonb_typeof(dobj.d -> 'gifts') = 'array' then dobj.d -> 'gifts' else '[]'::jsonb end) with ordinality g(v, n)
  ), draws as (
    select c.key, d.v, d.n from c, jsonb_array_elements(case when jsonb_typeof(c.e -> 'draws') = 'array' then c.e -> 'draws' else '[]'::jsonb end) with ordinality d(v, n)
  )
  select string_agg(why, '; ' order by key, n) from (
    select c.key, w.n, w.why from c, unnest(array[
      case when c.rarity is null then format('card "%s" has no rarity; a rarity is common, uncommon, rare or legendary', c.key)
           when rarity_rank(c.rarity) is null then format('card "%s" has the rarity "%s"; a rarity is common, uncommon, rare or legendary', c.key, c.rarity) end,
      case when c.play not in ('cast', 'use', 'set', 'keep') then format('card "%s" is played "%s"; a card is cast, used, set or kept', c.key, c.play) end,
      case when c.play = 'keep' then format('card "%s" is kept, and Keep is not built until it is designed', c.key) end,
      case when c.trap is not null and c.play <> 'set' then format('card "%s" has a trap, and only a set card has one', c.key) end,
      case when c.play = 'set' and c.trap is null then format('card "%s" is a set card with no trap', c.key) end,
      -- A cast card that reaches a character alone, or a post alone, may carry an earn (engine/rules/instance.ts, playProblems). A post alone is no `reaches` or exactly ["post"].
      case when c.gimmick is not null and c.play <> 'use' and not (c.play = 'cast' and coalesce(c.gimmick ->> 'kind' = 'earn', false) and (c.character_alone or c.post_alone))
           then format('card "%s" has a gimmick, and only a use card has one, or a cast card on a character alone or a post alone an earn', c.key) end,
      -- An earn on a cast card on a post ends at its time; one on a character already needs a time up, as every effect beyond a post does (card_reach_problem).
      case when c.play = 'cast' and c.gimmick ->> 'kind' = 'earn' and c.post_alone and not c.e ? 'lasts'
           then format('card "%s" has an earn with no time up (lasts); an earn on a cast card ends at its time', c.key) end,
      case when c.play = 'use' and c.gimmick is null then format('card "%s" is a use card with no gimmick', c.key) end,
      case when c.play = 'use' and c.gimmick is not null and jsonb_typeof(c.gimmick) <> 'object' then format('card "%s" has a gimmick that is not an object', c.key) end,
      case when c.play = 'use' and jsonb_typeof(c.gimmick) = 'object' and coalesce(c.gimmick ->> 'kind' not in ('ward', 'earn', 'price', 'ride', 'noQuote', 'cushion', 'pierce'), true)
           then format('card "%s" has a gimmick of kind %s; a gimmick is ward, earn, price, ride, noQuote, cushion or pierce', c.key, coalesce(to_jsonb(c.gimmick ->> 'kind')::text, 'null')) end,
      -- A pierce (engine/rules/instance.ts, gimmickProblems and playProblems): an upTo that is a rarity, on a use card that reaches a character alone, no rarer than the card itself.
      case when c.play = 'use' and jsonb_typeof(c.gimmick) = 'object' and c.gimmick ->> 'kind' = 'pierce' and rarity_rank(c.gimmick ->> 'upTo') is null
           then format('card "%s" has a pierce up to %s; a rarity is common, uncommon, rare or legendary', c.key, coalesce(compact_json(c.gimmick -> 'upTo'), 'undefined')) end,
      case when jsonb_typeof(c.gimmick) = 'object' and c.gimmick ->> 'kind' = 'pierce' and c.play <> 'use' then format('card "%s" has a pierce and is not a use card', c.key) end,
      case when jsonb_typeof(c.gimmick) = 'object' and c.gimmick ->> 'kind' = 'pierce' and not c.character_alone then format('card "%s" has a pierce and reaches more than a character', c.key) end,
      case when jsonb_typeof(c.gimmick) = 'object' and c.gimmick ->> 'kind' = 'pierce' and rarity_rank(c.gimmick ->> 'upTo') > rarity_rank(c.rarity)
           then format('card "%s" has a pierce up to %s, rarer than the card', c.key, c.gimmick ->> 'upTo') end,
      -- A card that cuts (engine/rules/instance.ts, cutsProblems; the seed sends a default for what a card leaves out, a stack of 1, pins, writes, replies, keeps, scoresAs and surface false, needsMessage and veil empty, which read as left out here): an upTo that is a rarity no rarer than the card, on a cast card that reaches a post or a character, with no time up and no other effect.
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and rarity_rank(c.e #>> '{cuts,upTo}') is null
           then format('card "%s" has cuts up to %s; a rarity is common, uncommon, rare or legendary', c.key, coalesce(compact_json(c.e #> '{cuts,upTo}'), 'nothing')) end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and c.play <> 'cast' then format('card "%s" has cuts and is not a cast card', c.key) end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and rarity_rank(c.e #>> '{cuts,upTo}') > rarity_rank(c.rarity)
           then format('card "%s" has cuts up to %s, rarer than the card', c.key, c.e #>> '{cuts,upTo}') end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and jsonb_typeof(c.e -> 'reaches') = 'array' and exists (select 1 from jsonb_array_elements_text(c.e -> 'reaches') r where r not in ('post', 'character'))
           then format('card "%s" has cuts and reaches %s; a card that cuts reaches a post or a character', c.key,
                       (select string_agg(case r.v when 'thread' then 'a thread' when 'board' then 'a board' else to_jsonb(r.v)::text end, ' and ' order by r.n)
                        from jsonb_array_elements_text(c.e -> 'reaches') with ordinality r(v, n) where r.v not in ('post', 'character'))) end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and coalesce(c.e -> 'lasts', 'null'::jsonb) <> 'null'::jsonb then format('card "%s" has cuts and a time up (lasts); a card that cuts is over when it lands', c.key) end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and coalesce(c.e -> 'stack', 'null'::jsonb) not in ('null'::jsonb, '1'::jsonb) then format('card "%s" has cuts and a stack; a card that cuts is over when it lands and has none', c.key) end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb and coalesce(c.e -> 'pins', 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb) then format('card "%s" has cuts and pins; a card that cuts is over when it lands and has none', c.key) end,
      case when coalesce(c.e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb then (select format('card "%s" has cuts and %s; a card that cuts has no other effect', c.key, o.said)
                            from (values (1, 'gimmick', 'a gimmick'), (2, 'skim', 'a skim'), (3, 'refunds', 'refunds'), (4, 'discipline', 'a discipline'), (5, 'writes', 'writes'), (6, 'replies', 'replies'),
                                         (7, 'keeps', 'keeps'), (8, 'scoresAs', 'scoresAs'), (9, 'draws', 'draws'), (10, 'drive', 'a drive'), (11, 'surface', 'a surface'), (12, 'veil', 'a veil'),
                                         (13, 'needsMessage', 'needsMessage')) o(n, k, said)
                            where coalesce(c.e -> o.k, 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb) order by o.n limit 1) end,
      case when c.play = 'use' and not c.e ? 'lasts' then format('card "%s" is a use card with no time up (lasts); a use card ends at its time', c.key) end,
      case when c.play = 'use' and jsonb_typeof(c.e -> 'reaches') = 'array' and exists (
             select 1 from jsonb_array_elements_text(c.e -> 'reaches') r where r not in ('post', 'character', 'thread'))
           then format('card "%s" is a use card and reaches %s; a use card reaches a post, a character or a thread', c.key,
             (select string_agg(case when r.v = 'board' then 'a board' else to_jsonb(r.v)::text end, ' and ' order by r.n)
              from jsonb_array_elements_text(c.e -> 'reaches') with ordinality r(v, n) where r.v not in ('post', 'character', 'thread'))) end,
      -- A cast on a post may end (a skim, a veil), so only a set card (or a keep) with a time up and no reach beyond a post is refused: instance.ts, playProblems.
      case when c.e ? 'lasts' and c.play not in ('use', 'cast') and not c.beyond
           then format('card "%s" has a time up (lasts), and only a use card, a cast card or a card reaching beyond a post does', c.key) end,
      -- The count is read as a number only once it is one: AND does not promise to read its sides in order.
      case when c.e ? 'lasts' and not coalesce(jsonb_typeof(c.e -> 'lasts') = 'object' and c.e #>> '{lasts,unit}' in ('hour', 'day', 'week', 'month')
             and case when jsonb_typeof(c.e #> '{lasts,count}') = 'number'
                      then (c.e #>> '{lasts,count}')::numeric between 1 and 1000 and (c.e #>> '{lasts,count}')::numeric = trunc((c.e #>> '{lasts,count}')::numeric)
                      else false end, false)
           then format('card "%s" lasts %s; it must be a span: a unit of hour, day, week or month and a whole count from 1 to 1000', c.key, c.e -> 'lasts') end,
      -- engine/rules/instance.ts, playProblems: a set card springs on a cast or a visit. A Move's trigger is the engine's (a quote), never a card's.
      case when c.trap is not null and coalesce(c.trigger_on not in ('cast', 'visit'), true)
           then format('card "%s" springs on %s; a set card springs on cast or visit', c.key, coalesce(nullif((c.trap #> '{trigger,on}')::text, 'null'), 'nothing')) end,
      -- Part 6 of the card notes (instance.ts: playProblems, outcomeProblems, skimProblems), each in the engine's words.
      -- A ride gimmick: its share, and a card with one reaches a post alone. (gimmickProblems is asked of a use card alone.)
      case when c.play = 'use' and jsonb_typeof(c.gimmick) = 'object' and c.gimmick ->> 'kind' = 'ride'
           then card_share_problem(format('card "%s"', c.key), c.gimmick, 'a ride', 'a ride of') end,
      case when c.gimmick ->> 'kind' = 'ride' and c.beyond then format('card "%s" has a ride, and a card with a ride reaches a post alone', c.key) end,
      -- A no-quote stops quotes of the post it is on: a card that has one names a post alone, or names nothing (a post by default).
      case when c.gimmick ->> 'kind' = 'noQuote' and c.e ? 'reaches' and c.e -> 'reaches' is distinct from '["post"]'::jsonb
           then format('card "%s" stops quotes, and a card that stops quotes reaches a post alone', c.key) end,
      -- A trap's outcome: an object, on a set card that springs on a cast, of kind ride (with a share), refund (a kind alone) or lockout (hours alone).
      case when jsonb_typeof(c.trap) = 'object' and c.trap ? 'outcome' and jsonb_typeof(c.trap -> 'outcome') is distinct from 'object'
           then format('card "%s" has an outcome that is not an object', c.key) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and (c.play <> 'set' or c.trigger_on is distinct from 'cast')
           then format('card "%s" has an outcome, and only a set card that springs on a cast does', c.key) end,
      -- A ride that pays on every quadrant says `every: true` and may sit beside a match; `every` is true or left out, and is asked of a ride alone (a refund with an `every` is refused below, as a key beside its kind).
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'ride' and c.trap -> 'outcome' ? 'every'
             and c.trap -> 'outcome' -> 'every' is distinct from 'true'::jsonb
           then format('card "%s" has an outcome whose every is %s; every is true or left out', c.key, (c.trap -> 'outcome' -> 'every')::text) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' is distinct from 'ride' and c.trap #>> '{outcome,kind}' is distinct from 'refund' and c.trap #>> '{outcome,kind}' is distinct from 'lockout'
           then format('card "%s" has an outcome of kind %s; an outcome is ride, refund or lockout', c.key, coalesce((c.trap -> 'outcome' -> 'kind')::text, 'undefined')) end,
      -- A refund outcome takes a kind alone: the first key besides `kind` is named.
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'refund'
             and exists (select 1 from jsonb_object_keys(c.trap -> 'outcome') k where k <> 'kind')
           then format('card "%s" has a refund outcome with %s; a refund outcome has a kind alone', c.key, (select k from jsonb_object_keys(c.trap -> 'outcome') k where k <> 'kind' limit 1)) end,
      -- A lockout outcome takes a kind and hours alone (the first other key is named), and hours is a whole number from 1 to 168: the words of the engine's outcomeProblems (engine/rules/instance.ts). A number reads bare
      -- and anything else as its JSON, so "24" (a string) does not read as a valid 24; a missing hours has a sentence of its own.
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'lockout'
             and exists (select 1 from jsonb_object_keys(c.trap -> 'outcome') k where k not in ('kind', 'hours'))
           then format('card "%s" has a lockout outcome with %s; a lockout outcome has hours alone', c.key, (select k from jsonb_object_keys(c.trap -> 'outcome') k where k not in ('kind', 'hours') limit 1)) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'lockout' and not c.trap -> 'outcome' ? 'hours'
           then format('card "%s" has a lockout outcome with no hours; a lockout is a whole number of hours from 1 to 168', c.key) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'lockout' and c.trap -> 'outcome' ? 'hours'
             and not coalesce(jsonb_typeof(c.trap -> 'outcome' -> 'hours') = 'number' and (c.trap -> 'outcome' ->> 'hours')::numeric = trunc((c.trap -> 'outcome' ->> 'hours')::numeric)
                              and (c.trap -> 'outcome' ->> 'hours')::numeric between 1 and 168, false)
           then format('card "%s" locks out for %s hours; a lockout is a whole number of hours from 1 to 168', c.key, (c.trap -> 'outcome' -> 'hours')::text) end,
      case when jsonb_typeof(c.trap) = 'object' and jsonb_typeof(c.trap -> 'outcome') = 'object' and c.play = 'set' and c.trigger_on = 'cast' and c.trap #>> '{outcome,kind}' = 'ride'
           then card_share_problem(format('card "%s"', c.key), c.trap -> 'outcome', 'an outcome', 'an outcome of share') end,
      -- A skim: an object with a share, on a cast card that reaches a post alone, lasts and does not write.
      case when c.e ? 'skim' and jsonb_typeof(c.e -> 'skim') is distinct from 'object' then format('card "%s" has a skim that is not an object', c.key) end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' then card_share_problem(format('card "%s"', c.key), c.e -> 'skim', 'a skim', 'a skim of') end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' and c.play <> 'cast' then format('card "%s" has a skim, and only a cast card does', c.key) end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' and c.beyond then format('card "%s" has a skim, and a card with a skim reaches a post alone', c.key) end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' and not c.e ? 'lasts' then format('card "%s" has a skim with no time up (lasts); a skim ends at its time', c.key) end,
      case when jsonb_typeof(c.e -> 'skim') = 'object' and coalesce((c.e ->> 'writes')::boolean, false) then format('card "%s" has a skim and writes; a card with a skim does not write', c.key) end,
      -- Refunds (instance.ts, refundsProblems): an object on a use card that reaches a post alone and lasts, whose flavors are one or more distinct alignments and whose count is a whole number from 1 to 10.
      case when c.e ? 'refunds' and jsonb_typeof(c.e -> 'refunds') is distinct from 'object' then format('card "%s" has refunds that are not an object', c.key) end,
      case when jsonb_typeof(c.e -> 'refunds') = 'object' and c.play <> 'use' then format('card "%s" has refunds, and only a use card does', c.key) end,
      case when jsonb_typeof(c.e -> 'refunds') = 'object' and c.e -> 'reaches' is distinct from '["post"]'::jsonb then format('card "%s" has refunds, and a card with refunds reaches a post alone', c.key) end,
      case when jsonb_typeof(c.e -> 'refunds') = 'object' and not c.e ? 'lasts' then format('card "%s" has refunds with no time up (lasts)', c.key) end,
      case when jsonb_typeof(c.e -> 'refunds') = 'object' and not coalesce(jsonb_typeof(c.e -> 'refunds' -> 'flavors') = 'array' and jsonb_array_length(c.e -> 'refunds' -> 'flavors') > 0
             and not exists (select 1 from jsonb_array_elements(c.e -> 'refunds' -> 'flavors') fl where jsonb_typeof(fl) is distinct from 'string' or fl #>> '{}' not in ('sweet', 'salty', 'pepperoni'))
             and (select count(distinct fl) from jsonb_array_elements(c.e -> 'refunds' -> 'flavors') fl) = jsonb_array_length(c.e -> 'refunds' -> 'flavors'), false)
           then format('card "%s" has refunds whose flavors are %s; flavors are one or more of sweet, salty and pepperoni', c.key, coalesce(compact_json(c.e -> 'refunds' -> 'flavors'), 'undefined')) end,
      case when jsonb_typeof(c.e -> 'refunds') = 'object' and not coalesce(case when jsonb_typeof(c.e -> 'refunds' -> 'count') = 'number'
                      then (c.e #>> '{refunds,count}')::numeric between 1 and 10 and (c.e #>> '{refunds,count}')::numeric = trunc((c.e #>> '{refunds,count}')::numeric)
                      else false end, false)
           then format('card "%s" has refunds whose count is %s; count is a whole number from 1 to 10', c.key, coalesce(compact_json(c.e -> 'refunds' -> 'count'), 'undefined')) end,
      -- Part 3 of the card notes (instance.ts: veilProblems), each in the engine's words. A veil or a reaction is a cast card on a post alone; a veil is author or totals and ends at its time (lasts); a
      -- reaction neither writes nor is seeded; a card has one of the two. `addsReaction` is the flag the seed sends (the engine's `reaction`), a boolean.
      case when c.has_veil and c.play <> 'cast' then format('card "%s" has a veil, and only a cast card does', c.key) end,
      case when c.has_veil and c.e -> 'reaches' is not null and c.e -> 'reaches' is distinct from '["post"]'::jsonb then format('card "%s" has a veil, and a card with a veil reaches a post alone', c.key) end,
      case when c.e -> 'addsReaction' = 'true'::jsonb and c.play <> 'cast' then format('card "%s" has a reaction, and only a cast card does', c.key) end,
      case when c.e -> 'addsReaction' = 'true'::jsonb and c.e -> 'reaches' is not null and c.e -> 'reaches' is distinct from '["post"]'::jsonb then format('card "%s" has a reaction, and a card with a reaction reaches a post alone', c.key) end,
      case when c.has_veil and coalesce(c.e ->> 'veil' not in ('author', 'totals'), true) then format('card "%s" has a veil of %s; a veil is author or totals', c.key, c.e -> 'veil') end,
      case when c.has_veil and not c.e ? 'lasts' then format('card "%s" has a veil with no time up (lasts); a veil ends at its time', c.key) end,
      case when c.e -> 'addsReaction' = 'true'::jsonb and coalesce((c.e ->> 'writes')::boolean, false) then format('card "%s" has a reaction and writes; a card with a reaction does not write', c.key) end,
      case when c.e -> 'addsReaction' = 'true'::jsonb and coalesce((c.e ->> 'seeded')::boolean, false) then format('card "%s" has a reaction and is seeded; a card with a reaction is not', c.key) end,
      case when c.has_veil and c.e -> 'addsReaction' = 'true'::jsonb then format('card "%s" has both a veil and a reaction; a card has one of the two', c.key) end,
      -- Scores as: true or left out, on a cast card that reaches a character alone.
      case when c.e ? 'scoresAs' and c.e -> 'scoresAs' is distinct from 'true'::jsonb then format('card "%s" has scoresAs %s; scoresAs is true or left out', c.key, c.e -> 'scoresAs') end,
      case when c.e -> 'scoresAs' = 'true'::jsonb and c.play <> 'cast' then format('card "%s" scores as a class, and only a cast card does', c.key) end,
      case when c.e -> 'scoresAs' = 'true'::jsonb and not c.character_alone then format('card "%s" scores as a class, and a card that does reaches a character alone', c.key) end
    ]) with ordinality w(why, n)
    -- engine/rules/instance.ts, drawProblems: a draw is a list of distinct keys the server can store on a play.
    union all
    select c.key, 101, format('card "%s" draws %s; draws is a list of keys', c.key, compact_json(c.e -> 'draws')) from c where c.e ? 'draws' and jsonb_typeof(c.e -> 'draws') <> 'array'
    union all
    select c.key, 102, format('card "%s" draws nothing; a card with a draw lists at least one key, or leaves draws out', c.key) from c
    where jsonb_typeof(c.e -> 'draws') = 'array' and jsonb_array_length(c.e -> 'draws') = 0
    union all
    select d.key, 110 + d.n, format('card "%s" draws %s; a draw is lowercase letters, digits and hyphens, 1 to 40', d.key, compact_json(d.v)) from draws d
    where jsonb_typeof(d.v) <> 'string' or d.v #>> '{}' !~ '^[a-z0-9-]{1,40}$'
    union all
    select d.key, 200 + min(d.n), format('card "%s" draws "%s" twice', d.key, d.v #>> '{}') from draws d
    where jsonb_typeof(d.v) = 'string' group by d.key, d.v #>> '{}' having count(*) > 1
    -- engine/rules/instance.ts, driveProblems: a Cast reaching a post alone, a span of at most 30 days, and gifts and an overhead that are economy numbers in range.
    union all
    select dv.key, 300, dv.who || ', and only a cast card does' from dv where coalesce(dv.e ->> 'play', 'cast') <> 'cast'
    union all
    select dv.key, 301, dv.who || ', and a drive card reaches a post alone' from dv where coalesce(dv.e -> 'reaches', '["post"]'::jsonb) is distinct from '["post"]'::jsonb
    union all
    select dv.key, 302, dv.who || ' that is not an object of lasts, gifts and overhead' from dv where jsonb_typeof(dv.d) <> 'object'
    union all
    select o.key, 303, format('%s that lasts %s; it must be a span: a unit of hour, day or week and a whole count from 1 to 1000', o.who, coalesce(compact_json(o.d -> 'lasts'), 'undefined')) from dobj o where not o.span_ok
    union all
    -- A drive's unit is never a month (span_interval counts a calendar month, the engine's spanMs thirty days), so the bound is the same in both.
    select o.key, 303, format('%s that lasts %s, longer than the 30 days a drive may', o.who, span_words(o.d -> 'lasts')) from dobj o where o.span_ok and span_interval(o.d -> 'lasts') > interval '30 days'
    union all
    select o.key, 304, o.who || ' with no gift amounts (gifts); a drive lists the economy keys of at least one' from dobj o
    where jsonb_typeof(o.d -> 'gifts') is distinct from 'array' or jsonb_array_length(o.d -> 'gifts') = 0
    union all
    select g.key, 350 + min(g.n), format('%s that lists gift "%s" twice', min(g.who), g.v #>> '{}') from gifts g
    where jsonb_typeof(g.v) = 'string' group by g.key, g.v #>> '{}' having count(*) > 1
    union all
    select g.key, 400 + g.n, format('%s gift %s, which is not a number the economy holds', g.who, compact_json(g.v)) from gifts g, eco
    where jsonb_typeof(g.v) <> 'string' or jsonb_typeof(eco.v -> (g.v #>> '{}')) is distinct from 'number'
    union all
    select g.key, 400 + g.n, format('%s gift %s of %s; a gift is a positive whole number of hundredths, at most the wallet''s cap (%s)', g.who, compact_json(g.v), eco.v ->> (g.v #>> '{}'), eco.cap)
    from gifts g, eco
    where jsonb_typeof(g.v) = 'string' and jsonb_typeof(eco.v -> (g.v #>> '{}')) = 'number'
      and ((eco.v ->> (g.v #>> '{}'))::numeric <> trunc((eco.v ->> (g.v #>> '{}'))::numeric) or (eco.v ->> (g.v #>> '{}'))::numeric < 1 or (eco.v ->> (g.v #>> '{}'))::numeric > eco.cap)
    union all
    select o.key, 500, format('%s overhead %s, which is not a number the economy holds', o.who, coalesce(compact_json(o.d -> 'overhead'), 'undefined')) from dobj o, eco
    where jsonb_typeof(o.d -> 'overhead') is distinct from 'string' or jsonb_typeof(eco.v -> (o.d ->> 'overhead')) is distinct from 'number'
    union all
    select o.key, 500, format('%s overhead of %s; it is a whole number from 0 to 100', o.who, eco.v ->> (o.d ->> 'overhead')) from dobj o, eco
    where jsonb_typeof(o.d -> 'overhead') = 'string' and jsonb_typeof(eco.v -> (o.d ->> 'overhead')) = 'number'
      and ((eco.v ->> (o.d ->> 'overhead'))::numeric <> trunc((eco.v ->> (o.d ->> 'overhead'))::numeric) or (eco.v ->> (o.d ->> 'overhead'))::numeric < 0 or (eco.v ->> (o.d ->> 'overhead'))::numeric > 100)
    -- engine/rules/instance.ts, needsMessageProblems: the words a blank message is refused with are a sentence, and only a cast or a use carries a message to need.
    union all
    select c.key, 600, format('card "%s" needsMessage %s; it is the sentence a blank message is refused with', c.key, compact_json(c.e -> 'needsMessage')) from c
    where c.e ? 'needsMessage' and jsonb_typeof(c.e -> 'needsMessage') <> 'string'
    union all
    select c.key, 601, format('card "%s" needs a message, and its refusal is empty', c.key) from c
    where jsonb_typeof(c.e -> 'needsMessage') = 'string' and btrim(c.e ->> 'needsMessage') = ''
    union all
    select c.key, 602, format('card "%s" needsMessage is longer than 200 characters', c.key) from c
    where jsonb_typeof(c.e -> 'needsMessage') = 'string' and char_length(c.e ->> 'needsMessage') > 200
    union all
    select c.key, 603, format('card "%s" needs a message, and only a cast or a use carries one', c.key) from c
    where jsonb_typeof(c.e -> 'needsMessage') = 'string' and c.play = 'set'
    -- engine/rules/instance.ts, disciplineProblems (card notes, Part 5): one of four kinds on a cast card with no other effect, reaching the one reach its kind takes.
    -- The seed always carries a stack (1 unless the card says), so a relief's or an unban's stack is said only above 1; every other field is as the engine reads it.
    union all
    select c.key, 700, format('card "%s" has a discipline that is not an object with a kind', c.key) from c where c.disc is not null and jsonb_typeof(c.disc) <> 'object'
    union all
    select c.key, 701, format('card "%s" has the discipline kind %s; a discipline is relief, unban, fall or watch', c.key, coalesce((c.disc -> 'kind')::text, 'undefined')) from c
    where jsonb_typeof(c.disc) = 'object' and coalesce(c.disc ->> 'kind' not in ('relief', 'unban', 'fall', 'watch'), true)
    union all
    select d.key, 702, format('card "%s" has a discipline, and only a cast card does', d.key) from dc d where d.play <> 'cast'
    union all
    select d.key, 710 + f.n, format('card "%s" has %s and %s; a card with a discipline has no other effect', d.key, d.a, f.said)
    from dc d cross join lateral (values
      (1, 'writes', d.e ->> 'writes' = 'true'), (2, 'replies', d.e ->> 'replies' = 'true'), (3, 'keeps', d.e ->> 'keeps' = 'true'),
      (4, 'a skim', nullif(d.e -> 'skim', 'null') is not null), (5, 'scoresAs', d.e -> 'scoresAs' = 'true'::jsonb),
      (6, 'a gimmick', nullif(d.e -> 'gimmick', 'null') is not null), (7, 'draws', nullif(d.e -> 'draws', 'null') is not null),
      (8, 'a drive', nullif(d.e -> 'drive', 'null') is not null), (9, 'needsMessage', nullif(d.e -> 'needsMessage', 'null') is not null),
      (10, 'a surface', d.e ->> 'surface' = 'true')) f(n, said, present)
    where f.present
    union all
    select d.key, 730, format('card "%s" has %s, and %s reaches a %s alone', d.key, d.a, d.a, d.reach_word) from dc d
    where coalesce(d.e -> 'reaches', '["post"]'::jsonb) is distinct from jsonb_build_array(d.reach_word)
    union all
    select d.key, 731, format('card "%s" has a relief of %s; relief takes the lightestBand or all', d.key, coalesce((d.disc -> 'points')::text, 'undefined')) from dc d
    where d.kind = 'relief' and coalesce(d.disc ->> 'points' not in ('lightestBand', 'all'), true)
    union all
    select d.key, 740 + f.n, format('card "%s" has %s and %s; %s is over when it lands and has none', d.key, d.a, f.said, d.a)
    from dc d cross join lateral (values
      (1, 'a time up', nullif(d.e -> 'lasts', 'null') is not null), (2, 'a stack', coalesce((d.e ->> 'stack')::integer > 1, false)), (3, 'pins', d.e ->> 'pins' = 'true')) f(n, said, present)
    where d.kind in ('relief', 'unban') and f.present
    union all
    select d.key, 750, format('card "%s" has a fall, and a fall has a stack of 1', d.key) from dc d where d.kind = 'fall' and coalesce((d.e ->> 'stack')::integer <> 1, false)
    union all
    select d.key, 751, format('card "%s" has a fall and a time up; a fall lasts until a filing spends it', d.key) from dc d where d.kind = 'fall' and nullif(d.e -> 'lasts', 'null') is not null
    union all
    select d.key, 760, format('card "%s" has a watch with no time up (lasts); a watch ends at its time', d.key) from dc d where d.kind = 'watch' and nullif(d.e -> 'lasts', 'null') is null
    union all
    select d.key, 761, format('card "%s" has a watch of weight %s; weight is a number above 1 and at most 10', d.key, coalesce((d.disc -> 'weight')::text, 'none')) from dc d
    where d.kind = 'watch' and not coalesce(jsonb_typeof(d.disc -> 'weight') = 'number' and (d.disc ->> 'weight')::numeric > 1 and (d.disc ->> 'weight')::numeric <= 10, false)
  ) p where why is not null
$function$;;

-- ---- 4. card_reach_problem ----

-- card_reach_problem (0361_discipline_cards), a card that cuts is over when it lands and has no time up, so the "beyond a post with no time up" case passes it as it passes a relief and an unban. Everything else as 0361 wrote it.
create or replace function public.card_reach_problem(cards jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with c as (
    select e ->> 'key' as key, e ->> 'rarity' as rarity, coalesce(e ->> 'play', 'cast') as play, e -> 'reaches' as reaches, e -> 'lasts' as lasts, e -> 'pins' as pins, e #>> '{discipline,kind}' as dkind, coalesce(e -> 'cuts', 'null'::jsonb) <> 'null'::jsonb as cuts
    from jsonb_array_elements(coalesce(cards, '[]')) e where e ? 'reaches'
  ), shaped as (
    select c.*, jsonb_typeof(c.reaches) = 'array' and jsonb_array_length(c.reaches) between 1 and 4
      and not exists (select 1 from jsonb_array_elements(c.reaches) r where jsonb_typeof(r) <> 'string' or r #>> '{}' not in ('post', 'character', 'thread', 'board'))
      and (select count(distinct r) from jsonb_array_elements(c.reaches) r) = jsonb_array_length(c.reaches) as ok
    from c
  ), beyond as (
    select s.key, r.reach, r.n from shaped s, unnest(array['character', 'thread', 'board']) with ordinality r(reach, n)
    where s.ok and s.reaches ? r.reach
  )
  select string_agg(why, '; ' order by key, n) from (
    select s.key, 0 as n, format('card "%s" reaches %s; a card reaches a list of post, character, thread or board, each once', s.key, compact_json(s.reaches)) as why
    from shaped s where not s.ok
    union all
    select s.key, 1, format('card "%s" is set face down, and a Set lands only on a post', s.key)
    from shaped s where s.ok and s.play = 'set' and exists (select 1 from beyond b where b.key = s.key)
    union all
    select s.key, 3, format('card "%s" pins %s; only a card that reaches a thread pins, and pins is true or left out', s.key, compact_json(s.pins))
    from shaped s where s.ok and s.pins is not null and s.pins <> 'false'::jsonb and (s.pins <> 'true'::jsonb or not s.reaches ? 'thread')
    union all
    -- A relief or an unban has no time up: it is over when it lands, and leaves no effect beyond a post to end (card notes, Part 5); nor has a card that cuts.
    select s.key, 2, format('card "%s" reaches beyond a post with no time up (lasts); every effect beyond a post ends at its time', s.key)
    from shaped s where s.ok and s.lasts is null and coalesce(s.dkind not in ('relief', 'unban'), true) and not s.cuts and exists (select 1 from beyond b where b.key = s.key)
    union all
    select b.key, 10 + 2 * b.n, format('card "%s" reaches a %s, which takes a card of %s or rarer; it is %s', b.key, b.reach, floor.rarity, s.rarity)
    from beyond b join shaped s on s.key = b.key
    cross join lateral (select setting('reachRarity') ->> b.reach as rarity) floor
    where rarity_rank(s.rarity) < rarity_rank(floor.rarity)
    union all
    select b.key, 11 + 2 * b.n, format('card "%s" lasts %s, longer than a %s effect may (reachLasts.%s, %s)', b.key, span_words(s.lasts), b.reach, b.reach, span_words(bound.span))
    from beyond b join shaped s on s.key = b.key
    cross join lateral (select setting('reachLasts') -> b.reach as span) bound
    -- A time up that is no span is card_kinds_problem's to name; it is read as an interval only once it is one.
    where s.lasts is not null and case when span_holds(s.lasts) and span_holds(bound.span) then span_interval(s.lasts) > span_interval(bound.span) else false end
  ) p where why is not null
$function$;

-- ---- 5. face_down_never_writes ----

-- face_down_never_writes (0361_discipline_cards), also refusing a back for a card that cuts, in the words decideSet gives a faceUpOnly card (engine/rules/cards.ts): "<name> is cast face up and never set face down". Everything else as 0361 wrote it.
create or replace function public.face_down_never_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare k card_kinds;
begin
  select * into k from card_kinds c where c.key = new.card;
  if k.writes then
    raise exception '% writes, so it is cast face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  elsif k.discipline is not null then
    raise exception '% acts the moment it lands, so it is cast face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  elsif k.cuts is not null then
    raise exception '% is cast face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  elsif k.draws is not null or k.drive is not null or k.needs_message is not null or k.surface then
    raise exception '% is cast face up and never set face down', k.name
      using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  return new;
end $function$;

-- ---- 6. acts_cut_play ----

-- The Acts that name a Gimmick they cut, so card_cut_at is one lookup. Written as the page's PostgREST read writes it (`payload->cut->>play`, which cannot say `?`), so that read and card_cut_at share the index. Created plainly, not concurrently, as acts_pierce_by is (0400).
create index acts_cut_play on acts ((payload -> 'cut' ->> 'play')) where kind = 'card' and (payload -> 'cut' ->> 'play') is not null;

-- ---- 7. card_cut_at ----

-- When a card that cuts ended this play, or null: the earliest landed cut that an admin has not ended. It reads `card_end` itself, not card_ended, so the two never call each other.
create function card_cut_at(play uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select min(c.created_at) from acts c
  where c.kind = 'card' and (c.payload -> 'cut' ->> 'play') = card_cut_at.play::text
    and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = c.id)
$$;
revoke execute on function card_cut_at(uuid) from public, anon, authenticated, service_role;

-- cutting_acts(plays): the ids of the card Acts that cut one of `plays` and were not caught, the page's read (acts_public cannot use acts_cut_play: its payload is shown_payload(...) of acts.payload). It returns ids alone,
-- of Acts whose `cut` is already public on acts_public; the page reads the Acts themselves through acts_public by id, which applies every veil. At most 1000 plays at a time. A security definer so the probe reads acts.
create function cutting_acts(plays uuid[]) returns setof uuid
language plpgsql stable security definer set search_path = public, pg_temp as $f$
begin
  if cardinality(plays) > 1000 then raise exception 'ask for at most 1000 plays at a time' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  return query select a.id from acts a where a.kind = 'card' and (a.payload -> 'cut' ->> 'play') = any (cutting_acts.plays::text[]) and not (a.payload ? 'caught');
end $f$;
revoke execute on function cutting_acts(uuid[]) from public, anon;
grant execute on function cutting_acts(uuid[]) to authenticated;
-- A client read keeps one generic plan and is never compiled by JIT (0368; tests/0320-client-reads-plan-once.sql holds every client read to it).
alter function cutting_acts(uuid[]) set plan_cache_mode = force_generic_plan;
alter function cutting_acts(uuid[]) set jit = off;

-- ---- 8. card_ended ----

-- card_ended (0400_pierce), with a fourth way a play is over: a card that cuts ended it (card_cut_at). Its grants are as they were (replaced in place).
create or replace function card_ended(play uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = card_ended.play)
      or exists (select 1 from card_write_refunds r where r.play = card_ended.play)
      or exists (select 1 from acts c where c.kind = 'card' and c.payload ? 'pierce' and (c.payload #>> '{pierce,by}') = card_ended.play::text)
      or card_cut_at(card_ended.play) is not null
$$;

-- ---- 9. cut_refusal ----

-- The words that turn a card that cuts away, or null (also null for a card that does not cut). The Gimmicks live on the target are the target's public plays: on a post, the card Acts on it that reach it, are not caught, end after now, are not
-- over (card_ended) and whose card is a Use card; on a character, its play_reach rows that end after now, are not over and whose card is a Use card. Then, in order, the engine's words (cards.ts, decidePlay and decided):
-- none at or below `upTo`, no play named, the play not among them, the play rarer than `upTo`. Reads no owner and no private fact, so the words are the same for every caster.
create function cut_refusal(kind_of card_kinds, of_reach text, of_target uuid, config jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  up_to text := kind_of.cuts ->> 'upTo';
  said text := config ->> 'play';
  named uuid;
  any_ok boolean;
  is_named boolean;
  named_name text;
  named_rarity text;
begin
  if kind_of.cuts is null then return null; end if;
  if said ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then named := said::uuid; end if;
  select coalesce(bool_or(rarity_rank(g.rarity) <= rarity_rank(up_to)), false), coalesce(bool_or(g.play = named), false), max(case when g.play = named then g.name end), max(case when g.play = named then g.rarity end)
  into any_ok, is_named, named_name, named_rarity
  from (
    select k.id as play, ck.name, ck.rarity from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where of_reach = 'post' and k.kind = 'card' and k.target_act_id = of_target and not (k.payload ? 'caught') and coalesce(k.payload ->> 'reach', 'post') = 'post'
      and (k.payload ->> 'ends')::timestamptz > now() and not card_ended(k.id) and ck.play = 'use'
    union all
    select r.play, ck.name, ck.rarity from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
    where of_reach = 'character' and r.character = of_target and r.ends_at > now() and not card_ended(r.play) and ck.play = 'use'
  ) g;
  if not any_ok then return 'there''s no Gimmick up on this ' || of_reach || ' for ' || kind_of.name || ' to end'; end if;
  if named is null then return kind_of.name || ' names the Gimmick it ends'; end if;
  if not is_named then return 'that Gimmick isn''t up on this ' || of_reach; end if;
  if rarity_rank(named_rarity) > rarity_rank(up_to) then return kind_of.name || ' ends a Gimmick up to ' || up_to || ', and ' || named_name || ' is ' || named_rarity; end if;
  return null;
end $$;
revoke execute on function cut_refusal(card_kinds, text, uuid, jsonb) from public, anon, authenticated, service_role;

-- ---- 10. place_cast ----

-- place_cast (0402_thread_lockout), the cut (design, section 3.3). Everything else as 0402 wrote it. Its grants are as they were (replaced in place).
create or replace function public.place_cast(caster uuid, card text, target uuid, config jsonb, message text, reach text, from_post uuid, payer uuid, price integer, marker jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  target_kind text;
  author uuid;
  in_thread uuid;
  on_post uuid := target;
  written uuid := gen_random_uuid();
  kind_of card_kinds%rowtype;
  layer integer;
  said text := coalesce(message, '');
  warded text;
  sprung jsonb;
  up integer;
  ends timestamptz;
  live_board timestamptz;
  where_words text;
  target_name text;
  staff_caster boolean;
  drive_id uuid;
  drive_up integer;
  quad text;
  w_why text;
  w_opens timestamptz;
  w_closes timestamptz;
  last_settled timestamptz;
  rode boolean := false;
  is_instant boolean;
  is_relief boolean;
  lightest integer;
  took integer;
  relief_rows jsonb;
  lifts jsonb;
  landing text;
  shown uuid;
  lands boolean := true;
  handed jsonb;
  shot_play uuid;
  shot_up_to text;
  shot_card text;
  shot_tried uuid[] := '{}';
  shot_try integer;
  passed_ward text;
  passed_back boolean := false;
  is_unban boolean;
  cut_play uuid;
  cut_words text;
begin
  select c.staff is not null into staff_caster from characters c where c.id = caster;
  if staff_caster is null then raise exception 'there is no such character' using errcode = 'P0002'; end if;
  -- Nobody pays for a staff character's card, and a player's is always paid for: the two must agree before anything is written.
  if staff_caster is distinct from (payer is null) then
    raise exception 'a staff character''s card is paid by no one, and a player''s by its player' using errcode = '22023';
  end if;
  if payer is null and coalesce(price, 0) <> 0 then raise exception 'a staff character''s card costs nothing' using errcode = '22023'; end if;
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  if reach is null or reach not in ('post', 'character', 'thread', 'board') then
    raise exception 'a card lands on a post, a character, a thread or a board' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  select * into kind_of from card_kinds k where k.key = place_cast.card;
  if kind_of.key is null then raise exception 'there is no such card' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if kind_of.play = 'set' then raise exception '% is set face down on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if kind_of.play not in ('cast', 'use') then raise exception '% is not played on a post', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if not (reach = any (kind_of.reaches)) then
    raise exception 'this card lands on %', reach_list(kind_of.reaches) using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A Gimmick never goes on a board, whatever its card lists (the catalog check refuses a card that lists one).
  if kind_of.play = 'use' and reach = 'board' then
    raise exception '% is never used on a board', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A staff character casts no card that carries a gimmick (a cast earn): the settlement leaves a staff character's Acts out, so the play's Lens would claim a boost that is never paid. Plain words, no refusal hint:
  -- a pool persona is never offered one (cards.ts, staffOffers), so this is for a caller that skipped the offer.
  if staff_caster and kind_of.play = 'cast' and kind_of.gimmick is not null then
    raise exception 'a staff character casts no card that carries an earn' using errcode = '22023';
  end if;
  -- Nor a card with a discipline: infract refuses a staff character, and the staff's rulings are The System's own, which these are player moves around. Plain words, no refusal hint, for the same reason.
  if staff_caster and kind_of.play = 'cast' and kind_of.discipline is not null then
    raise exception 'a staff character casts no card that has a discipline' using errcode = '42501';
  end if;
  -- Nor a card that ends a Gimmick: the Gimmick it names is a player's play, and a persona does not choose one (the Buzzkill design, section 2.5). Plain words, no refusal hint, for the same reason.
  if staff_caster and kind_of.cuts is not null then
    raise exception 'a staff character casts no card that ends a Gimmick' using errcode = '42501';
  end if;
  -- A relief or an unban is over when it lands (card notes, Part 5): it leaves no effect, takes no place in a stack and has no time up, so it writes no `ends` and no play_reach row.
  is_relief := kind_of.discipline ->> 'kind' = 'relief';
  is_unban := coalesce(kind_of.discipline ->> 'kind' = 'unban', false);
  -- A card that cuts is over when it lands too: no `ends`, no play_reach row, no layer, no place in a stack. The play it names is read here only when it is a uuid (cut_refusal says the rest).
  is_instant := coalesce(kind_of.discipline ->> 'kind' in ('relief', 'unban'), false) or kind_of.cuts is not null;
  if kind_of.cuts is not null and config ->> 'play' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then cut_play := (config ->> 'play')::uuid; end if;

  if reach = 'post' then
    -- The target's row is locked, so plays on one post are laid one at a time and each counts the last.
    select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
    if not coalesce(post_kind(target_kind), false) then raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- A character locked out of the post's thread plays nothing there. Asked here, before the ward, the back or anything written, so the Move that springs a lockout is not refused by the lockout it springs: the spring is
    -- written below, after this, and nothing after it asks again. It reads the public spring alone, so the same words come whoever owns the caster.
    perform not_locked_out(caster, in_thread);
    if kind_of.play = 'use' and author is distinct from caster then
      raise exception '% is used on your own post' , kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    -- Task 4 (section 3), taking the fall: a fall is played on a post whose author is not hidden, on a player's post, and on another character's. Both read public facts of the post's author (a staff flag, a character: who wrote a post is public),
    -- and compare characters, never accounts, so a second mask of the author's account may take the fall and no refusal differs with who owns the caster or the author. The stack count below is as for any card.
    if kind_of.discipline ->> 'kind' = 'fall' then
      -- A post under a live author veil (0357) is shown under the stand-in to everyone, and a fall is all about whose post it is: the refusals below compare the caster with the TRUE author, so the author's own
      -- masks would meet the own-post words while every other caster's fall landed. So while the veil is up a fall is refused first, in one sentence and one code for every caster alike, before anything is
      -- paid or written (no Mod Bot visits a veiled post, so a fall there could not be taken before the veil ends in any case). The time is the veil's own end, public as the veil is.
      if author_veiled(target) then
        raise exception 'this post''s author is hidden until %; nobody takes the fall for it before then', refusal_time(author_veil_ends(target)) using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
      if exists (select 1 from characters c where c.id = author and c.staff is not null) then
        raise exception '% is played on a player''s post', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      if author is not distinct from caster then
        raise exception '% is played on another character''s post', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    end if;
    -- A card that stops quotes is not laid on a post that holds a card face down: a back springs on a quote, and the two would pull against each other. A back is live by the predicate place_set uses (public, since
    -- the back is); the post's row is locked above and place_set takes the same row first, so the two are laid one at a time.
    if kind_of.play = 'use' and kind_of.gimmick ->> 'kind' = 'noQuote'
       and exists (select 1 from face_down f where f.post = target and f.ends_at > now()
                   and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)
                   and not exists (select 1 from acts s where s.kind = 'take_back' and (s.payload ->> 'set') = f.play::text)) then
      raise exception '% stops quotes, and this post holds a card face down; take that card back first', kind_of.name using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    -- One global order over play_reach rows: every cast takes the caster's live pierce rows up front, in ONE statement ordered by play id (a cut of a Gimmick on a character adds the named play's row to that same
    -- statement), before the loop below chooses which pierce to spend. The loop keeps its own choosing order (oldest first) but then takes no row it does not already hold, so no two casts can hold rows in opposite
    -- orders: a cut of a Cheap Shot and that Cheap Shot's spending cast, or two casts of one character, wait on one another's rows one way round only. cut_refusal is asked after the lock, so a play spent or
    -- ended while this waited is read as it now stands. The pierce loop never chooses the play a cut names: a cut spends no pierce on the Gimmick it ends (else reversing the cut would leave it ended by the pierce clause). (A pierce played after this statement by the same caster in another session is a row this one never holds.)
    if kind_of.play = 'cast' and not staff_caster then
      perform 1 from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
      where r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce'
      order by r.play for update of r;
    end if;
    -- The caster's pierce, locked last before the Ward check (no other writer locks a play_reach row), so two casts by one character take it one after the other, and the second, reading after the
    -- lock, finds it spent. A pierce is read by a cast alone (not a Use) and not by a staff character's, which holds none. A pierce found spent once the lock is held (a concurrent cast spent it) is
    -- set aside and the next live, unspent one is locked and asked in turn, at most three tries; a caster holding no other pierce goes on with none.
    if kind_of.play = 'cast' and not staff_caster then
      shot_tried := '{}';
      for shot_try in 1..3 loop
        select r.play, ck.gimmick ->> 'upTo', k.payload ->> 'card' into shot_play, shot_up_to, shot_card
        from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
        where r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce' and not card_ended(r.play) and r.play <> all (shot_tried) and r.play is distinct from cut_play
        order by k.created_at, k.id limit 1 for update of r;
        -- Asked again in a statement of its own, after the lock: a cast that held the row first may have spent it.
        exit when shot_play is null or not card_ended(shot_play);
        shot_tried := shot_tried || shot_play;
        shot_play := null; shot_up_to := null; shot_card := null;
      end loop;
    end if;
    -- A live ward Gimmick on the post turns away a cast its rarity, flavor or name covers, in the same words for everyone (cards.ts's wardWords). A pierce passes a ward whose card is no rarer than it.
    if kind_of.play = 'cast' then
      warded := ward_refusal('post', target, kind_of, shot_up_to);
      if warded is not null then raise exception '%', warded using hint = 'kayfabb.refusal', errcode = '42501'; end if;
      if shot_play is not null then
        select w.card into passed_ward from wards_against('post', target, kind_of) w where rarity_rank(w.rarity) <= rarity_rank(shot_up_to) order by w.at, w.play limit 1;
      end if;
      -- What the card's landing refuses on this post (land_refusal): public facts alone, the same words for every caster, and before anything is written.
      landing := land_refusal(kind_of, target, coalesce(config, '{}'));
      if landing is not null then raise exception '%', landing using hint = 'kayfabb.refusal', errcode = land_refusal_code(landing); end if;
      -- A card that cuts: the Gimmick it names is up on this post and no rarer than its upTo (public plays and printed rarity alone, the same words for every caster). The post's row is held, so the Gimmicks are read as they stand.
      cut_words := cut_refusal(kind_of, 'post', target, coalesce(config, '{}'));
      if cut_words is not null then raise exception '%', cut_words using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    end if;
    -- A card with a time up ends at it, whatever it holds (a skim, a veil, a use card): the stack below and the end both read the play's `ends`.
    if kind_of.lasts is not null then ends := now() + kind_of.lasts; end if;
    -- The stack counts the plays still up: a caught play, an ended Use and a play beyond a post sitting here hold no place. The
    -- layer goes on from the last one taken, so no layer is taken twice (acts_card_layers); a play written before layers counts as
    -- one (0016).
    -- A skim card names the reaction quadrant it skims, one of the four, in its configuration.
    quad := coalesce(config, '{}') ->> 'quadrant';
    if kind_of.skim is not null and not coalesce(quad = any (array['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative']), false) then
      raise exception 'this card names a reaction quadrant' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    select count(*) filter (where (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()) and not card_ended(k.id)),
           greatest(coalesce(max((k.payload ->> 'layer')::integer), 0), count(*)) + 1
      into up, layer
    from acts k where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught')
      and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'instant');
    -- A drive card's stack is counted in the post's open drive only: the drive whose latest play, plus the card's `lasts`, is still ahead. A play joins it, or opens a drive of its own id.
    if kind_of.drive is not null then
      select d.drive, count(*) into drive_id, drive_up from drive_plays(target, card) d
      group by d.drive having max(d.created_at) + span_interval(kind_of.drive -> 'lasts') > now()
      order by max(d.created_at) desc limit 1;
      if drive_id is null then
        drive_id := written;
        up := 0;
      else
        up := drive_up;
        if up >= kind_of.stack then raise exception 'this post''s drive already carries % appeals', kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      end if;
    end if;
    if kind_of.skim is not null then
      -- A skim card's stack is one live play of it per quadrant on the post (the plays still up, as above), whatever the card's `stack` says.
      select count(*) into up from acts k
      where k.kind = 'card' and k.target_act_id = target and k.payload ->> 'card' = card and not (k.payload ? 'caught')
        and coalesce(k.payload ->> 'reach', 'post') = 'post' and k.payload #>> '{config,quadrant}' = quad
        and (k.payload ->> 'ends' is null or (k.payload ->> 'ends')::timestamptz > now()) and not card_ended(k.id);
      if up >= 1 then raise exception 'this post already carries that card for that quadrant' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
    elsif up >= kind_of.stack then
      if kind_of.surface then raise exception 'This post is already a wall. Draw on it instead.' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      if kind_of.stack = 1 then raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505'; end if;
      raise exception 'this post already carries % of that card, the most it takes', kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
    end if;
    if kind_of.play = 'cast' then
      -- A cast on a post meets that post's back: a Trap Card that names this very card catches it, whatever its rarity, and takes it; a ride back lets it land and is paid by its votes (`did` is
      -- rode). Nothing pays out here, so spring_traps is given the card's key and neither a price nor a caster; the paying account goes only as the one who is not told of their own back.
      sprung := spring_traps('cast', target, written, card, actor => payer, passing => shot_up_to, locking => caster);
      -- A back the pierce passed answers `passed` and wrote nothing: the cast met no back.
      if sprung ->> 'passed' = 'true' then passed_back := true; sprung := null; end if;
      rode := sprung is not null and sprung -> 'payload' ->> 'did' = 'rode';
      -- The cast lands when no back caught it: it met none, or a back that rides, refunds or locks its caster out. The order is the Ward first (above), then the back, then the sign; a cast is handed back once at most.
      lands := sprung is null or sprung -> 'payload' ->> 'did' in ('rode', 'returned', 'lockedOut');
      if lands and payer is not null then
        if sprung -> 'payload' ->> 'did' = 'returned' then
          handed := jsonb_build_object('by', sprung -> 'payload' ->> 'set', 'card', sprung -> 'payload' ->> 'card');
        else
          -- The post's live refunds Gimmick: the latest play on this post whose card has refunds, is still up, names this card's flavor and has handed back fewer casts than its count. A card that cuts is never handed back by the Gimmick it names (the owner's answer, #965): the cutting card is consumed; a cut of another Gimmick is handed back by a refunds Gimmick still up as any Salty Move is. The post's row is locked
          -- above, so two casts are counted one after the other.
          select jsonb_build_object('by', k.id, 'card', k.payload ->> 'card') into handed
          from acts k join card_kinds rk on rk.key = k.payload ->> 'card'
          where k.kind = 'card' and k.target_act_id = target and coalesce(k.payload ->> 'reach', 'post') = 'post' and rk.refunds is not null
            and k.id is distinct from cut_play
            and (k.payload ->> 'ends')::timestamptz > now() and not card_ended(k.id)
            and rk.refunds -> 'flavors' ? kind_of.alignment
            and (select count(*) from acts h where h.kind = 'card' and h.target_act_id = target and h.payload #>> '{handedBack,by}' = k.id::text) < (rk.refunds ->> 'count')::integer
          order by k.created_at desc, k.id desc limit 1;
        end if;
      end if;
    end if;
  else
    -- The target's row is locked, so plays on one target are laid one at a time and each counts the last; two board cards on one
    -- board both wait here, and the second sees the first.
    if reach = 'character' then
      -- The lock order is post, then visits_open, then character, everywhere (a visit's filing takes the post's row first and, in infract, its author's character after): the post the card is played from is held `for share`
      -- before the target character's row, so a card on a character and a filing on that post never hold one each and wait on the other. (Before 0357 the character came first.)
      perform 1 from acts a where a.id = from_post and post_kind(a.kind) for share;
      perform 1 from characters c where c.id = target for no key update;
      if not found then raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select c.name into target_name from characters c where c.id = target;
      -- The stand-in is shown in place of an author, so a card on it would be a card on whoever it stands for.
      if target is not distinct from stand_in() then raise exception 'no card is played on a stand-in' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      -- The post it is played from is held `for share` before it is read: a veil cast on that post (which takes the row `for no key update`) checks for a card played from it after taking it, so the card and the veil
      -- are laid one at a time, and whichever is second reads what the first left (a veiled post is not its character's, so the card is refused; a post a card was played from takes no veil). The post's row is
      -- held already (above, before the character's), and a veil cast holds the post's row and takes no character's row, so the order closes no cycle.
      select a.thread, a.character into in_thread, shown from acts_public a where a.id = from_post and post_kind(a.kind);
      -- A post under a live author veil is shown under the stand-in to everyone, so a card on a character played from it is a card on the stand-in whoever the caster names, the post's author included: one refusal, in the
      -- words and the code a third player meets naming the stand-in itself, and the same whoever owns the post. (A post that is not veiled is refused as it was, for a character that is not its own.)
      if shown is not null and shown is not distinct from stand_in() then raise exception 'no card is played on a stand-in' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      if in_thread is null or shown is distinct from target then raise exception 'a card on a character is played from one of its posts' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
      perform not_locked_out(caster, in_thread);
      on_post := from_post;
      if kind_of.play = 'use' and target is distinct from caster then
        raise exception '% is used on your own character', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
      -- A card with a discipline lands on a player's character, never a staff character: who is on staff is public, and the words are the same for every caller.
      if kind_of.discipline is not null and exists (select 1 from characters c where c.id = target and c.staff is not null) then
        raise exception '% lands on a player''s character', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
    elsif reach = 'thread' then
      perform 1 from threads t where t.id = target for no key update;
      if not found then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select t.title into target_name from threads t where t.id = target;
      in_thread := target;
      perform not_locked_out(caster, in_thread);
      select a.id, a.character into on_post, author from acts a where a.thread = target and a.seq = 1;
      if on_post is null then raise exception 'that thread has no post yet' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      -- A Gimmick on a thread is a match stipulation, so only on a thread the caster's own character started. Who started a thread is public, and the refusal says nothing of anyone else's.
      if kind_of.play = 'use' and author is distinct from caster then
        raise exception '% is used on a thread your own character started', kind_of.name using hint = 'kayfabb.refusal', errcode = '42501';
      end if;
    else
      perform 1 from boards b where b.id = target for no key update;
      if not found then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
      select b.name into target_name from boards_now b where b.id = target;
      in_thread := setting_thread('systemAnnouncements');
      if in_thread is null then
        raise exception 'there is no announcements thread to play a board card in yet' using hint = 'kayfabb.refusal', errcode = '55000';
      end if;
      on_post := null;
      -- One board card at a time, of any card.
      select max(r.ends_at) into live_board from play_reach r where r.board = target and r.ends_at > now() and not card_ended(r.play);
      if live_board is not null then
        raise exception 'this board already carries a board card until %', refusal_time(live_board) using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
    end if;
    -- A scored-as card on a character names a class the instance has and a window that can be named, once for the character in that window. The window is public (settlements, seasons, settings).
    if kind_of.scores_as then
      if not exists (select 1 from class_kinds ck where ck.key = coalesce(config, '{}') ->> 'class') then
        raise exception 'there is no such class' using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      select w.opens, w.closes, w.why into w_opens, w_closes, w_why from scored_as_window(now()) w;
      if w_why is not null then raise exception '%', w_why using hint = 'kayfabb.refusal', errcode = '55000'; end if;
      select max(x.ends_at) into last_settled from settlements x;
      if exists (select 1 from play_reach r join acts k on k.id = r.play join card_kinds sk on sk.key = k.payload ->> 'card'
                 where r.character = target and sk.scores_as and k.created_at >= last_settled and not card_ended(k.id)) then
        raise exception 'this character already has a class named for the window after the next settlement' using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
    end if;
    -- One global order over play_reach rows: every cast takes the caster's live pierce rows up front, in ONE statement ordered by play id (a cut of a Gimmick on a character adds the named play's row to that same
    -- statement), before the loop below chooses which pierce to spend. The loop keeps its own choosing order (oldest first) but then takes no row it does not already hold, so no two casts can hold rows in opposite
    -- orders: a cut of a Cheap Shot and that Cheap Shot's spending cast, or two casts of one character, wait on one another's rows one way round only. cut_refusal is asked after the lock, so a play spent or
    -- ended while this waited is read as it now stands. (A pierce played after this statement by the same caster in another session is a row this one never holds.)
    if kind_of.play = 'cast' and not staff_caster then
      perform 1 from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
      where (r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce') or (kind_of.cuts is not null and r.play = cut_play)
      order by r.play for update of r;
    end if;
    -- The caster's pierce, locked last before the Ward check (no other writer locks a play_reach row), so two casts by one character take it one after the other, and the second, reading after the
    -- lock, finds it spent. A pierce is read by a cast alone (not a Use) and not by a staff character's, which holds none. A pierce found spent once the lock is held (a concurrent cast spent it) is
    -- set aside and the next live, unspent one is locked and asked in turn, at most three tries; a caster holding no other pierce goes on with none.
    if kind_of.play = 'cast' and not staff_caster then
      shot_tried := '{}';
      for shot_try in 1..3 loop
        select r.play, ck.gimmick ->> 'upTo', k.payload ->> 'card' into shot_play, shot_up_to, shot_card
        from play_reach r join acts k on k.id = r.play join card_kinds ck on ck.key = k.payload ->> 'card'
        where r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce' and not card_ended(r.play) and r.play <> all (shot_tried) and r.play is distinct from cut_play
        order by k.created_at, k.id limit 1 for update of r;
        -- Asked again in a statement of its own, after the lock: a cast that held the row first may have spent it.
        exit when shot_play is null or not card_ended(shot_play);
        shot_tried := shot_tried || shot_play;
        shot_play := null; shot_up_to := null; shot_card := null;
      end loop;
    end if;
    -- A live ward Gimmick on the character, thread or board turns away a cast its rarity, flavor or name covers, on its own target only. A pierce passes a ward whose card is no rarer than it.
    if kind_of.play = 'cast' then
      warded := ward_refusal(reach, target, kind_of, shot_up_to);
      if warded is not null then raise exception '%', warded using hint = 'kayfabb.refusal', errcode = '42501'; end if;
      if shot_play is not null then
        select w.card into passed_ward from wards_against(reach, target, kind_of) w where rarity_rank(w.rarity) <= rarity_rank(shot_up_to) order by w.at, w.play limit 1;
      end if;
      -- A card that cuts: the Gimmick it names is up on this character and no rarer than its upTo, asked after the Ward and after the lock above.
      cut_words := cut_refusal(kind_of, 'character', target, coalesce(config, '{}'));
      if cut_words is not null then raise exception '%', cut_words using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    end if;
    -- A relief or an unban reads the character's public bar or bans with its row held (the lock infract takes, so a filing and a heart on one character go one after the other), and is
    -- refused before anything is spent or written, in the same words for every caller (a bar and a ban are public: warn_points and banned_until are on every postbit).
    if is_relief then
      -- The lightest band is the least of the three band values the settings hold; a bar with fewer points than the card takes gives what it has. The walk is read once, in one statement: the live infractions
      -- (live_infractions, the predicate warn_points sums), oldest first, each giving what is left on it until the card has taken what it says. `took` is the sum of those rows and the rows are what is
      -- written below, so the Act's words and its relief rows cannot disagree (an appeal's ruling takes no lock on the character and may land between two reads).
      lightest := (select min(v::integer) from jsonb_each_text(setting('warnBar') -> 'bands') b(k, v));
      select jsonb_agg(jsonb_build_object('infraction', w.id, 'points', w.pts) order by w.created_at, w.id), coalesce(sum(w.pts), 0)::integer into relief_rows, took
      from (
        select l.id, l.created_at,
               least(l.left_over, greatest(0, least(case when kind_of.discipline ->> 'points' = 'all' then sum(l.left_over) over () else lightest end, sum(l.left_over) over ())
                                                    - (sum(l.left_over) over (order by l.created_at, l.id) - l.left_over))) as pts
        from live_infractions(target) l where l.left_over > 0
      ) w where w.pts > 0;
      if took = 0 then raise exception 'this character''s warn bar is empty' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    elsif is_unban then
      -- Every ban running on the character, by the end each has now: a late filing can lay a second.
      select jsonb_agg(jsonb_build_object('ban', x.id, 'until', x.ends) order by x.created_at, x.id) into lifts
      from (select b.id, b.created_at, ban_ends(b.id) as ends from acts b where b.kind = 'ban' and b.payload ->> 'character' = target::text) x where x.ends > now();
      if lifts is null then raise exception 'this character is not banned' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    end if;
    if not is_instant then
      select count(*) into up from play_reach r join acts k on k.id = r.play
      where r.ends_at > now() and not card_ended(r.play) and k.payload ->> 'card' = card
        and case place_cast.reach when 'character' then r.character = target when 'thread' then r.thread = target else r.board = target end;
      if up >= kind_of.stack then
        where_words := 'this ' || reach;
        if kind_of.stack = 1 then raise exception '% already carries that card', where_words using hint = 'kayfabb.refusal', errcode = '23505'; end if;
        raise exception '% already carries % of that card, the most it takes', where_words, kind_of.stack using hint = 'kayfabb.refusal', errcode = '23505';
      end if;
      ends := now() + least(coalesce(kind_of.lasts, span_interval(setting('reachLasts') -> reach)), span_interval(setting('reachLasts') -> reach));
      -- A scored-as play lasts until its window closes, not a time from now.
      if kind_of.scores_as then ends := w_closes; end if;
    end if;
  end if;

  -- A card that needs words refuses a blank message in its own words, after the landing's refusals as the engine says them (decided, engine/rules/cards.ts); the message is trimmed as casterMessage trims it.
  if kind_of.needs_message is not null and btrim(said, E' \t\r\n\f\v') = '' then
    raise exception '%', kind_of.needs_message using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  begin
    insert into acts (id, character, kind, thread, target_act_id, payload)
    values (written, caster, 'card', in_thread, on_post, jsonb_build_object('card', card, 'message', said,
      'config', (case when kind_of.seeded then coalesce(config, '{}') - 'seed' else coalesce(config, '{}') end) - case when kind_of.draws is not null then array['drawn'] else '{}'::text[] end)
      || case when reach <> 'post' then jsonb_build_object('reach', reach, reach, target, 'targetName', target_name)
                || case when not is_instant then jsonb_build_object('ends', ends)
                        when is_relief then jsonb_build_object('instant', true, 'took', took)
                        when kind_of.cuts is not null then jsonb_build_object('instant', true)
                        else jsonb_build_object('instant', true, 'lifted', lifts) end
              when not lands then jsonb_build_object('caught', sprung -> 'payload' ->> 'set')
              -- A card that cuts is over when it lands: no layer, so no place in a stack and nothing for acts_card_layers to collide on. A back that rode or locked its caster out is still named.
              when kind_of.cuts is not null then jsonb_build_object('instant', true)
                || case when rode then jsonb_build_object('rode', sprung -> 'payload' ->> 'set')
                        when sprung is not null and sprung -> 'payload' ->> 'did' = 'lockedOut' then jsonb_build_object('lockedOut', sprung ->> 'id') else '{}'::jsonb end
              when rode then jsonb_build_object('layer', layer, 'rode', sprung -> 'payload' ->> 'set')
              -- A lockout back's spring names the play (`by`); the play names the spring (`lockedOut`), so the caster's alert and log line read it on from the play as a ride's are read from `rode`.
              when sprung is not null and sprung -> 'payload' ->> 'did' = 'lockedOut' then jsonb_build_object('layer', layer, 'lockedOut', sprung ->> 'id')
              else jsonb_build_object('layer', layer) end
      -- What handed the cast back to its caster's hand (the back's set play or the sign's play, with its card), as a public fact of the cast; the caster's ledger row below is the other half.
      || case when handed is not null then jsonb_build_object('handedBack', handed) else '{}'::jsonb end
      -- The Gimmick a landed cut ended (its play and its card), a public fact of the Move that card_cut_at reads; a play a back caught never lands and carries none.
      || case when kind_of.cuts is not null and lands then jsonb_build_object('cut', jsonb_build_object('play', cut_play, 'card', (select a.payload ->> 'card' from acts a where a.id = cut_play))) else '{}'::jsonb end
      -- The pierce the cast was made under, whether it lands or is caught: its play, its card, and the oldest ward it got past (a public fact of the Move, which the Lens line reads).
      || case when shot_play is not null then jsonb_build_object('pierce', jsonb_strip_nulls(jsonb_build_object('by', shot_play, 'card', shot_card, 'ward', passed_ward))) else '{}'::jsonb end
      || case when kind_of.scores_as then jsonb_build_object('starts', w_opens) else '{}'::jsonb end
      || case when kind_of.seeded then jsonb_build_object('seed', floor(random() * 2147483648)::bigint) else '{}'::jsonb end
      || case when kind_of.draws is not null then jsonb_build_object('drawn', kind_of.draws[1 + floor(random() * cardinality(kind_of.draws))::integer]) else '{}'::jsonb end
      || case when reach = 'post' and drive_id is not null then jsonb_build_object('drive', drive_id) else '{}'::jsonb end
      -- A play a back caught never lands and is never in effect, so it holds no end (0370): settle.ts boosts and skims only with a play's `ends`.
      || case when reach = 'post' and kind_of.lasts is not null and lands then jsonb_build_object('ends', ends) else '{}'::jsonb end
      || coalesce(marker, '{}'::jsonb));
  exception when unique_violation then
    -- Only a writer that skipped the lock above could take the same layer.
    raise exception 'this post already carries that card' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  -- A cast handed back returns to its caster's hand: a `returned` row naming the cast, as a take-back writes (card_held counts it). Written beside the Act, once, whichever of the back or the sign handed it.
  if handed is not null then
    insert into card_ledger (account, card, kind, act, price) values (payer, card, 'returned', written, 0);
  end if;
  -- What a landed play on a post needs beside its Act (a veil's row): not for a play a back caught, which never lands.
  if reach = 'post' and lands then perform land_rows(written, kind_of, on_post, coalesce(config, '{}'), caster); end if;
  if kind_of.surface and reach = 'post' and lands then perform open_surface(written); end if;
  if reach <> 'post' and not is_instant then
    insert into play_reach (play, reach, character, thread, board, pins_board, ends_at)
    values (written, reach, case when reach = 'character' then target end, case when reach = 'thread' then target end,
            case when reach = 'board' then target end,
            case when reach = 'thread' and kind_of.pins then (select t.board from threads t where t.id = target) end, ends);
  end if;
  -- What a relief took, and what an unban lifted, as rows beside the play (the play's own Act is never changed): the rows the walk above gave, the ones `took` is the sum of; an unban lifts each ban it found.
  if is_relief then
    insert into warn_reliefs (play, infraction, points) select written, (e ->> 'infraction')::uuid, (e ->> 'points')::integer from jsonb_array_elements(relief_rows) e;
  elsif is_unban then
    insert into ban_lifts (play, ban) select written, (e ->> 'ban')::uuid from jsonb_array_elements(lifts) e;
  end if;
  -- A card Cast at thread reach talks down the open visits on the thread whose Mod a distraction moves (0108), once for each, as this caster's attempt.
  if reach = 'thread' and not staff_caster then perform distract_visits(caster, target, written); end if;
  if reach <> 'board' then
    perform write_alert(case reach when 'character' then target else (select a.character from acts a where a.id = on_post) end, 'cardOnYours', null, written, payer);
  end if;
  -- A caught cast tells its caster, as a card landed from a back tells the struck: a trapStruck on the caught play, naming nothing but the play (the spring names the setter's
  -- character). The setter's account is the alert's actor only so that a player's cast on their own other mask's Trap Card tells nobody; the alert reads no owner into any answer.
  if sprung is not null then
    perform write_alert(caster, 'trapStruck', null, written, (select f.account from face_down f where f.play = (sprung -> 'payload' ->> 'set')::uuid));
  end if;
  -- A back a pierce passed tells the caster alone, in the same alert a caught cast writes with a sub of `passed`; the setter is told nothing (a spring that never was).
  if passed_back then perform write_alert(caster, 'trapStruck', 'passed', written); end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $function$;;

-- ---- 11. reverse_card ----

-- reverse_card (0402_thread_lockout), the refusal for a play already over is split: an admin's end keeps its words; a cut play names the card that cut it; any other play that is over (a pierce a cast spent) says it is over.
-- 0402 asked each of these in a case of its own (the admin's end, a refunded write); the cut and the spent pierce are added after them. Everything else as 0402 wrote it. Its grants are as they were (replaced in place).
create or replace function reverse_card(play uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p acts%rowtype;
  written uuid;
begin
  perform only_admins('ends a card');
  -- The play's row is locked, so two admins at once write one end between them and the second sees the first's.
  select * into p from acts a where a.id = play and (a.kind = 'card' or (a.kind = 'spring' and a.payload ->> 'did' = 'lockedOut')) for no key update;
  if not found then raise exception 'that is not a card play' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.kind = 'spring' then
    -- A sprung lockout: over once its `until` has passed. It has no caught, ends, reach, keeps or refunds: those are a card play's.
    if (p.payload ->> 'until')::timestamptz <= now() then
      raise exception 'that card has already worn off' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = p.id) then
      raise exception 'an admin has already ended that card' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  else
  if p.payload ? 'caught' then raise exception 'that card was caught by a trap, so it never landed' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  -- A play of a kind that keeps still counts on the posts it was up over after its time (thread_page's `kept`), so an admin may end it then.
  if ((p.payload ->> 'ends')::timestamptz <= now() or exists (select 1 from play_reach r where r.play = p.id and r.ends_at <= now()))
     and not coalesce((select ck.keeps from card_kinds ck where ck.key = p.payload ->> 'card'), false) then
    raise exception 'that card has already worn off' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = p.id) then
    raise exception 'an admin has already ended that card' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if exists (select 1 from card_write_refunds r where r.play = p.id) then
    raise exception 'That card didn''t take, so there is nothing of it on this post.' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- A play a card that cuts ended: the card that did it is named, since ending that card is what brings this one back (card_cut_at reads the cutting plays an admin has not ended).
  if card_cut_at(p.id) is not null then
    raise exception 'a % already ended that card; end that card to bring this one back',
      (select ck.name from acts c join card_kinds ck on ck.key = c.payload ->> 'card'
       where c.kind = 'card' and (c.payload -> 'cut' ->> 'play') = p.id::text and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = c.id)
       order by c.created_at, c.id limit 1)
      using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- Any other way a play is over (a pierce a cast spent): it is not an admin's to end again.
  if card_ended(p.id) then raise exception 'that card is already over' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  end if;
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (null, 'card_end', p.thread, p.id, jsonb_build_object('why', 'reversed', 'by', 'admin')) returning id into written;
  perform set_config('kayfabb.card_end_writer', '', true);
  -- The caster's alert (Task 4; for a lockout, the setter's, as the spring is the setter's Act): one, in this transaction, for the caster's own player, about the card_end. write_alert writes none
  -- for a staff character (no owner), so a staff play's end tells nobody. `acting` is null: the admin is not told apart from the caster.
  perform write_alert(p.character, 'cardEnded', null, written, null);
  -- The answer carries the play, and for a play beyond a post its reach, so the act function can broadcast the end on `reach`.
  return act_projection(written) || jsonb_strip_nulls(jsonb_build_object('play', p.id,
    'reach', case when p.payload ->> 'reach' in ('character', 'thread', 'board') then p.payload ->> 'reach' end));
end $$;;

-- ---- 12. settlement_input and estimate_input ----

-- settlement_input (0398_debates_fixes), the `ends` each card Act is sent with is the least of its own and card_cut_at. Everything else as 0398 wrote it.
create or replace function settlement_input(window_start timestamptz, window_end timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive
  -- The plays an admin ended before the window's end (Task 3): out of this window, with the votes on them. `<` as every other bound
  -- here is, so a card_end written at the instant window_end is after the window, as a vote written then is.
  ended as (select e.target_act_id as id from acts e where e.kind = 'card_end' and e.created_at < window_end),
  -- Every live Earn Gimmick play still up when the window opens, played before it (a play inside it is a window Act already): settle.ts boosts only with the play in the input, and an Earn play of an earlier window
  -- is still up in this one. Live is not ended by an admin, not caught, and ending after the window's start; found by creation time, a window of the longest Earn `lasts` before the window, and each comes with its post.
  earn_up as (
    select k.id, case when coalesce(k.payload ->> 'reach', 'post') = 'post' then k.target_act_id end as post
    from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.gimmick ->> 'kind' in ('earn', 'cushion')
      and k.created_at < window_start and k.created_at >= window_start - (select max(e.lasts) from card_kinds e where e.gimmick ->> 'kind' in ('earn', 'cushion'))
      and coalesce(k.payload ->> 'reach', 'post') in ('post', 'character') and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)),
  -- The System's own Acts (the reveal) are no character's, and nobody's to settle; a staff character's
  -- are The System's too (0043): staff earn nothing, and a card on a staff Act is nobody's to score.
  -- A gift (a donation) is no one's to settle (design, section 5): it earns nothing, is never counted as posting or in the halving, and is no one's reaction to count. It is left out here, of the window's Acts and of
  -- the reactions to one; `all_acts` leaves it out once more, since an Act a reaction touched is read whatever its kind.
  win_acts as (select * from acts a where a.created_at >= window_start and a.created_at < window_end and a.character is not null and a.kind <> 'donation' and a.kind not in ('poll', 'ballot', 'poll_close')
               and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)),
  win_reactions as (select * from reactions r where r.created_at >= window_start and r.created_at < window_end and r.act not in (select id from ended)
                    and not exists (select 1 from acts d where d.id = r.act and d.kind = 'donation')),
  reacted as (select distinct act from win_reactions),
  -- ---- The debates the window reached (0390; docs/plans/2026-11-18-tweener-catalyst-design.md, section 1) ----
  -- The earliest a spark may be made for its debate to be followed: `debateDays` before the window opens, as engine/rules/settle.ts reads it.
  cutoff as (select window_start - make_interval(days => (setting('debateDays') #>> '{}')::integer) as at),
  -- The paid sparks (0398): a post that has a nonzero tallied sum for some reason (tallied_lines, the settlements that ended by the window's start, read by the `act` index) and that a reaction reached in the window, of any age, so a vote
  -- that moves on it takes back what was paid, however old the post is. A post the sums net to 0 on is no spark of this kind. The members of its debate are walked to below with no cutoff, as for any spark.
  paid_sparks as (
    select x.act as id from reacted x
    where exists (select 1 from tallied_lines l join settlements st on st.id = l.settlement where l.act = x.act and st.ends_at <= window_start group by l.reason having sum(l.amount) <> 0)),
  -- Walk up: from each window post or spin, through quote_refs (`act` to `quoted`, its primary key), to the posts it quotes and the posts those quote, none made before the cutoff, each earlier than the one that
  -- quotes it. `anc` is false for the window's own Acts and true for one reached by a quote. A node is a post or a spin that is in the input's terms (no staff, no System, no donation, not ended by an admin).
  -- Time-bounded below by the cutoff and above by the window's end (a window Act is made before it), and each step is a probe of quote_refs by `act` then of acts by its key: no step scans acts. The key probe is a lateral with `offset 0`, which fences it: left as a join, the planner read acts by time (acts_created) and filtered by key, 500 rows a step at 1,000 posts, a cost that grew as the square of a quote chain (the walks below do the same).
  up as (
    select a.id, a.created_at as at, a.kind, false as anc from win_acts a where a.kind in ('post', 'spin')
    union
    select b.id, b.created_at, b.kind, true
    from up u cross join lateral (
      select b.id, b.created_at, b.kind from quote_refs r cross join lateral (select * from acts where id = r.quoted offset 0) b
      where r.act = u.id and b.kind in ('post', 'spin') and b.created_at >= (select at from cutoff) and b.created_at < window_end and (b.created_at, b.id) < (u.at, u.id)
        and b.character is not null and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)
      offset 0) b),
  -- The sparks: a post made no earlier than the cutoff that a window Act quotes or sits under (a quote chain's ancestor; the origin of a spun thread with an Act in the window), or that a reaction reached in the window while it
  -- has a debate by the window's end (a quote or another player's spin made before it; one made after is no debate yet), so that a nod that moves after the debate has gone quiet still moves the refund: engine/rules/settle.ts reads a spark whose vote moved. The origin is read through the thread's own row (threads_origin's key).
  sparks as (
    select b.id, b.created_at as at, b.character, c.owner, b.thread
    from (
      select u.id from up u where u.anc and u.kind = 'post'
      union select t.origin_act_id from win_acts a join threads t on t.id = a.thread where a.kind in ('post', 'spin') and t.origin_act_id is not null
      union select x.act from reacted x join acts sa on sa.id = x.act join characters sc on sc.id = sa.character
        where exists (select 1 from quote_refs q cross join lateral (select * from acts where id = q.act offset 0) a where q.quoted = x.act and a.kind in ('post', 'spin') and a.created_at < window_end and (a.created_at, a.id) > (sa.created_at, sa.id)
                        and a.character is not null and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended))
           or exists (select 1 from acts sp join characters pc on pc.id = sp.character where sp.target_act_id = x.act and sp.kind = 'spin' and sp.created_at < window_end and sp.created_at >= sa.created_at
                        and pc.owner <> sc.owner and pc.staff is null and sp.id not in (select id from ended))
      union select id from paid_sparks
    ) k cross join lateral (select b.* from acts b where b.id = k.id offset 0) b
    cross join lateral (select c.owner from characters c where c.id = b.character offset 0) c
    where b.kind = 'post' and (b.created_at >= (select at from cutoff) or b.id in (select id from paid_sparks)) and b.created_at < window_end
      and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)),
  -- Walk up again from every spark, by whatever branch reached it (a spark reached as the origin of a spun thread or by a reaction has no ancestor in `up`): the engine reads whether a spark is in an earlier post's debate by its own
  -- player (inOwnDebate) from the edges above it, so each ancestor, and the edges to it, are in the input, however old (0398: a post in the debate of an earlier post by the same player is never a spark, and the earlier post may be older than `debateDays`; the climb is as long as the quote chain, each step a keyed probe). The same step as `up`, bounded by the window's end and by each step being strictly earlier. It no longer stops at a node `up` holds: `up` is bound by the cutoff, so its ancestors are not all there, and a node reached from two sparks is held once (UNION), so a chain is climbed once.
  ancestry as (
    select s.id, s.at from sparks s
    union
    select b.id, b.created_at
    from ancestry u cross join lateral (
      select b.id, b.created_at from quote_refs r cross join lateral (select * from acts where id = r.quoted offset 0) b
      where r.act = u.id and b.kind in ('post', 'spin') and b.created_at < window_end and (b.created_at, b.id) < (u.at, u.id)
        and b.character is not null and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)
      offset 0) b),
  -- The origin a spark's own thread was spun from, and the spin that made it (0398), whatever their age: the engine reads inOwnDebate from the spin's target as well as from the edges above (a post in a thread another player spun from an
  -- earlier post by the same player), so a spark in a spun thread has both in the input even where no Act of the thread is in the window. Read only where the origin is by the spark's own player, the one case inOwnDebate asks about. Two keyed probes a spark: the thread's own row, then the spin by the thread and its target.
  origin_reads as (
    select sp.id, sp.created_at as at from sparks s
    cross join lateral (select t.origin_act_id as o from threads t where t.id = s.thread and t.origin_act_id is not null and exists (select 1 from acts oa join characters oc on oc.id = oa.character where oa.id = t.origin_act_id and oc.owner = s.owner) offset 0) t
    cross join lateral (select sp.id, sp.created_at from acts sp where sp.thread = s.thread and sp.kind = 'spin' and sp.target_act_id = t.o and sp.created_at < window_end
                          and sp.character is not null and not is_staff_side(sp.character, sp.kind, sp.target_act_id) and sp.id not in (select id from ended) offset 0) sp
    union
    select o.id, o.created_at from sparks s
    cross join lateral (select t.origin_act_id as o from threads t where t.id = s.thread and t.origin_act_id is not null and exists (select 1 from acts oa join characters oc on oc.id = oa.character where oa.id = t.origin_act_id and oc.owner = s.owner) offset 0) t
    cross join lateral (select o.id, o.created_at from acts o where o.id = t.o and o.kind in ('post', 'spin') and o.created_at < window_end
                          and o.character is not null and not is_staff_side(o.character, o.kind, o.target_act_id) and o.id not in (select id from ended) offset 0) o),
  -- Walk down: from each spark, through quote_refs_quoted (`quoted` to `act`), to every post or spin that quotes a member, made before the window's end and after what it quotes.
  down as (
    select s.id, s.at from sparks s
    union
    select a.id, a.created_at
    from down d cross join lateral (
      select a.id, a.created_at from quote_refs r cross join lateral (select * from acts where id = r.act offset 0) a
      where r.quoted = d.id and a.kind in ('post', 'spin') and a.created_at < window_end and (a.created_at, a.id) > (d.at, d.id)
        and a.character is not null and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)
      offset 0) a),
  -- And the spin and the posts of each thread another player spun from a spark: the spin through acts_target (the spark), the posts through the thread's own index.
  spun_spins as (
    select sp.id, sp.created_at as at, sp.thread
    from sparks s cross join lateral (
      select sp.id, sp.created_at, sp.thread from acts sp join characters c on c.id = sp.character
      where sp.target_act_id = s.id and sp.kind = 'spin' and sp.created_at < window_end and sp.created_at >= s.at and c.owner <> s.owner and c.staff is null and sp.id not in (select id from ended)
      offset 0) sp),
  spun_posts as (
    select p.id from spun_spins sp cross join lateral (
      select p.id from acts p where p.thread = sp.thread and p.kind = 'post' and p.created_at < window_end and p.created_at >= sp.at
        and p.character is not null and not is_staff_side(p.character, p.kind, p.target_act_id) and p.id not in (select id from ended)
      offset 0) p),
  members as (select id from down union select id from spun_spins union select id from spun_posts),
  -- Each cushion play (Thick Skin) on a spark or on its character that ended after the spark was made, whether or not it is still up: the engine cuts the refund by the largest share that was ever up on the spark.
  -- A play on the post is found by its key (acts_layers); one on the character by a probe for each spark, through acts_card_on_character (the character it lies on, then creation time), from the longest cushion `lasts` before that spark's own
  -- creation, whatever its age (an old paid spark has no cutoff): a play made earlier than that ended before the spark was made. A caught play is never in effect.
  cushion_plays as (
    select k.id from sparks s cross join lateral (
      select k.id from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.gimmick ->> 'kind' = 'cushion'
      where k.target_act_id = s.id and k.kind = 'card' and coalesce(k.payload ->> 'reach', 'post') = 'post'
        and k.created_at < window_end and not (k.payload ? 'caught') and (k.payload ->> 'ends')::timestamptz > s.at and k.id not in (select id from ended)
      offset 0) k
    union
    select k.id from sparks s cross join lateral (
      select k.id from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.gimmick ->> 'kind' = 'cushion'
      where k.kind = 'card' and k.payload ->> 'reach' = 'character' and k.payload ->> 'character' = s.character::text
        and k.created_at < window_end and k.created_at >= s.at - (select max(c.lasts) from card_kinds c where c.gimmick ->> 'kind' = 'cushion')
        and not (k.payload ? 'caught') and (k.payload ->> 'ends')::timestamptz > s.at and k.id not in (select id from ended)
      offset 0) k),
  -- What each play of the window is scored against (0378): the Act a card or a spring lies on, and the cast a spring caught (`by`). A class's rule reads how the room took that Act (engine/rules/settle.ts, targetLean), and a
  -- reaction before the window counts as much as one inside it, so the Act's earlier reactions are sent whether or not a reaction reached it today. One probe by Act for each play of the window, never a scan of reactions.
  scored as (
    select a.target_act_id as id from win_acts a where a.kind in ('card', 'spring') and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post'
    union
    select (a.payload ->> 'by')::uuid from win_acts a where a.kind = 'spring' and a.payload ->> 'by' is not null),
  -- Only what a reaction reached is paid for a scored Act (`paid`, below, still joins `reacted`): an earlier reaction on a scored Act is read for the lean and pays nothing. A spark's (0390) are read and its paid rows sent, so
  -- its standing votes are in the input in a window no reaction reached it; the vote math pays only a vote with a reaction in the window, so nothing is paid twice.
  earlier_reactions as (select r.* from (select act from reacted union select id from scored where id not in (select id from ended) union select id from sparks) x cross join lateral (select r.* from reactions r where r.act = x.act and r.created_at < window_start offset 0) r),
  -- Every skim play made before the window and still up in it (a play inside it is a window Act already), as earn_up carries Earn plays: live is not ended by an admin, not caught, and ending after the window's start;
  -- found by creation time through acts_card_created, a window of the longest skim `lasts` before the window, and each comes with its post.
  skim_up as (
    select k.id, k.target_act_id as post
    from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.skim is not null and k.target_act_id is not null
      and k.created_at < window_start and k.created_at >= window_start - (select max(s.lasts) from card_kinds s where s.skim is not null)
      and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)),
  -- The cards on a post among the Acts reacted to in the window, and what pays on them: the ride springs that rode (acts_spring_by, one probe each), and the ride gimmick plays on the post that were up when the cast was made
  -- (acts_layers, the plays on the post), each with the post. A cast that drew no reaction in the window brings none of them, however many have sprung.
  rc as (select a.id, a.target_act_id as post, a.created_at from acts a join reacted x on x.act = a.id
         where a.kind = 'card' and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post' and a.id not in (select id from ended)),
  ride_springs as (select s.id from rc join acts s on s.kind = 'spring' and (s.payload ->> 'by') = rc.id::text where s.payload ->> 'did' = 'rode'),
  ride_gimmicks as (
    select g.id from rc
    join acts g on g.target_act_id = rc.post and g.kind = 'card' and coalesce(g.payload ->> 'reach', 'post') = 'post' and g.id <> rc.id
    join card_kinds ck on ck.key = g.payload ->> 'card' and ck.gimmick ->> 'kind' = 'ride'
    where not (g.payload ? 'caught') and g.created_at <= rc.created_at and (g.payload ->> 'ends')::timestamptz > rc.created_at and g.id not in (select id from ended)),
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
    union select id from earn_up union select post from earn_up where post is not null
    union select target_act_id from win_acts where kind in ('card', 'spin', 'spring') and target_act_id is not null and coalesce(payload ->> 'reach', 'post') = 'post'
    union select id from spins union select target_act_id from spins where target_act_id is not null
    -- Every card on an Act a reaction touches, an earlier window's too: a vote counts once per
    -- player and alignment, for the earliest card (engine/rules/settle.ts).
    union select a.id from acts a join reacted x on x.act = a.target_act_id where a.kind in ('card', 'spring') and coalesce(a.payload ->> 'reach', 'post') = 'post'
    union select id from first_posts
    union select id from skim_up union select post from skim_up
    union select id from ride_springs union select id from ride_gimmicks union select post from rc
    union select id from scored
    union select id from ancestry union select id from members union select id from cushion_plays union select id from origin_reads
  ),
  all_acts as (select a.* from touched t cross join lateral (select a.* from acts a where a.id = t.id offset 0) a where a.created_at < window_end and a.character is not null and a.kind <> 'donation'
               and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)),
  -- A staff post a window's card landed on (0054): named with its reactions, so the card is judged against it, and paid nobody. And, since 0378, a staff cast a window spring caught, which `scored` names, so the spring is
  -- judged against it as a card on a post is.
  unscored as (select a.* from acts a join characters c on c.id = a.character
               where c.staff is not null and (a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start and coalesce(k.payload ->> 'reach', 'post') = 'post')
                                              or a.id in (select id from scored))),
  -- Named, never settled: settle.ts drops a reaction to one, and reads a spin from one as from another.
  system_acts as (select a.id from touched t cross join lateral (select a.* from acts a where a.id = t.id offset 0) a
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  all_reactions as (select * from win_reactions union all select * from earlier_reactions),
  named as (select character as id from all_acts union select reactor_character from all_reactions),
  ms as (select 1)
  select jsonb_build_object(
    'window', jsonb_build_object('id', to_jsonb(window_start) #>> '{}',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'player', c.owner, 'classes', coalesce((
        select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
        from class_history h where h.character = c.id and h.started_at < window_end), '[]'),
        'reveals', coalesce((select jsonb_agg((extract(epoch from u.at) * 1000)::bigint order by u.at, u.act)
          from class_reveals u where u.character = c.id and u.at < window_end), '[]')) order by c.id)
      from characters c join named n on n.id = c.id), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread,
        'target', case when coalesce(a.payload ->> 'reach', 'post') = 'post' then a.target_act_id end,
        'reach', case when a.kind = 'card' then nullif(coalesce(a.payload ->> 'reach', 'post'), 'post') end,
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end,
        'by', case when a.kind = 'spring' then a.payload ->> 'by' end,
        -- A caught play is never in effect (0370): its `ends`, where a row written before 0370 holds one, is not sent, so it boosts and skims nothing. A cut play's `ends` is the cut's time at the latest (card_cut_at), so it pays nothing from then on.
        'ends', case when a.kind = 'card' and not (a.payload ? 'caught') and (select ck.gimmick is not null or ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card')
                     then (extract(epoch from least((a.payload ->> 'ends')::timestamptz, card_cut_at(a.id))) * 1000)::bigint end,
        'quadrant', case when a.kind = 'card' and (select ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card') then a.payload #>> '{config,quadrant}'
                         when a.kind = 'spring' then a.payload ->> 'quadrant' end,
        'on', case when a.kind = 'card' and a.payload ->> 'reach' = 'character' then a.payload ->> 'character' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    -- A staff Act that is a card's play carries its `card` (0378), so a class's rule can tell a cast of a Salty card from any other Act the room reacted to.
    'unscoredTargets', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'kind', a.kind, 'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'staff', true,
        'card', case when a.kind = 'card' then a.payload ->> 'card' end)) order by a.created_at, a.id)
      from unscored a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'at', (extract(epoch from r.created_at) * 1000)::bigint,
        'player', r.reactor_account, 'character', r.reactor_character)
        || case when r.kind like 'x-%' then jsonb_build_object('quadrant', reaction_quadrant(r.act, r.kind)) else '{}'::jsonb end order by r.created_at, r.id)
      from all_reactions r), '[]'),
    -- The System's Acts an input Act points at (a spin from the reveal): named, never settled.
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'),
    -- The plays that name a class for this window (scored_as_plays), each with its character, its class and the play.
    'scoredAs', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'class', s.class_key, 'play', s.play) order by s.character) from scored_as_plays(window_start, window_end) s), '[]'),
    -- Each quote with both ends among the input's Acts: `act` quotes `quoted`. The engine reads a post's debate from them (0390).
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'quoted', r.quoted) order by r.act, r.quoted)
      from all_acts a cross join lateral (select r.act, r.quoted from quote_refs r where r.act = a.id offset 0) r join all_acts q on q.id = r.quoted), '[]'),
    -- What earlier windows paid for every player's vote on each Act this window's reactions touch (section 9), and, since 0390, on each spark.
    'paid', coalesce((
      select jsonb_agg(jsonb_build_object('player', q.account, 'act', q.act, 'weight', q.weight, 'shares', q.shares) order by q.account, q.act)
      from (select p.* from paid_votes p join reacted r on r.act = p.act
            union all select p.* from (select s.id from sparks s where s.id not in (select act from reacted)) s cross join lateral (select p.* from paid_votes p where p.act = s.id offset 0) p) q), '[]'),
    -- What the settlements that ended by the window's start tallied on each spark (0398), by reason, nonzero only: the class is handed it as `paid` (engine/rules/settle.ts, SparkedDebate). One probe of tallied_lines by `act` for each spark.
    'tallied', coalesce((
      select jsonb_agg(jsonb_build_object('act', t.act, 'reason', t.reason, 'amount', t.amount) order by t.act, t.reason)
      from sparks s cross join lateral (
        select l.act, l.reason, sum(l.amount)::integer as amount from tallied_lines l join settlements st on st.id = l.settlement
        where l.act = s.id and st.ends_at <= window_start group by l.act, l.reason having sum(l.amount) <> 0 offset 0) t), '[]'))
$$;

-- estimate_input (0398_debates_fixes), the same change to the `ends` it sends. Everything else as 0398 wrote it.
create or replace function estimate_input(account uuid, until timestamptz default now()) returns jsonb
-- jit = off as every client read has it (0368): this plan costs above jit_above_cost, and a client read that compiled 878 functions spent about 6 s on a chain of two posts.
-- No plan_cache_mode = force_generic_plan (0368's other half): that is for a client read a page calls many times, and this is called once per request, not in ALLOWED_RPCS, where a generic plan would forget the window's and the cutoff's values.
language plpgsql stable security definer set search_path = public, pg_temp set jit = off as $$
declare
  salt text := gen_random_uuid()::text;
  window_start timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  season_end timestamptz;
  window_end timestamptz;
  you text := md5(salt || 'you');
begin
  -- The window the next settlement reads begins where next_settlement_window (0004) begins it: at
  -- the last settled end, or, where no season holds that instant (a gap between seasons), at the
  -- next season's start; and it never runs past its season's end.
  if window_start is not null and not exists (select 1 from seasons where starts_at <= window_start and (ends_at is null or ends_at > window_start)) then
    window_start := (select min(starts_at) from seasons where starts_at > window_start);
  end if;
  if window_start is null then return null; end if;
  select coalesce(s.ends_at, nullif(greatest(s.starts_at + span_interval(setting('seasonLength')), window_start), window_start)) into season_end
  from seasons s where s.starts_at <= window_start and (s.ends_at is null or s.ends_at > window_start);
  window_end := least(until, coalesce(season_end, 'infinity'));
  if window_start >= window_end then return null; end if;
  return (
  with recursive
  -- The plays an admin ended before the window's end (Task 3): out of this window, with the votes on them. `<` as every other bound
  -- here is, so a card_end written at the instant window_end is after the window, as a vote written then is.
  ended as (select e.target_act_id as id from acts e where e.kind = 'card_end' and e.created_at < window_end),
  mine as (select id from characters where owner = account),
  -- The live Earn plays on the caller's characters and posts, played before the window and still up in it (settlement_input's earn_up, for what the caller's earnings can carry): another player's play on
  -- the caller's post is a public Act and counts as one of the caller's own.
  earn_up as (
    select k.id, case when coalesce(k.payload ->> 'reach', 'post') = 'post' then k.target_act_id end as post
    from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.gimmick ->> 'kind' in ('earn', 'cushion')
      and k.created_at < window_end and k.created_at >= window_start - (select max(e.lasts) from card_kinds e where e.gimmick ->> 'kind' in ('earn', 'cushion'))
      and coalesce(k.payload ->> 'reach', 'post') in ('post', 'character') and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)
      and case when coalesce(k.payload ->> 'reach', 'post') = 'character' then (k.payload ->> 'character')::uuid in (select id from mine)
               else exists (select 1 from acts p join mine m on m.id = p.character where p.id = k.target_act_id) end),
  win_acts as (select a.* from acts a join mine m on m.id = a.character where a.created_at >= window_start and a.created_at < window_end and a.kind <> 'donation' and a.kind not in ('poll', 'ballot', 'poll_close')
               and a.id not in (select id from ended)),
  -- (Task 5) The caller's skim plays made before the window and still up in it, by acts_card_plays (the caller's own plays), with their posts: the posts' reactions are read, as settlement_input reads them.
  skim_up as (
    select k.id, k.target_act_id as post
    from acts k join mine m on m.id = k.character join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.skim is not null and k.target_act_id is not null
      and k.created_at < window_start and k.created_at >= window_start - (select max(s.lasts) from card_kinds s where s.skim is not null)
      and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)),
  -- The caller's live ride gimmick plays (a Toll on a post of the caller's player's), and the casts one covers on its post that a reaction reached in the window (reactions_window, one probe each); and the caller's ride springs
  -- whose cast a reaction reached in the window (one probe each). Only the caller's own plays lead: a bystander has none, so none of this is in a bystander's input.
  my_gimmicks as (
    select g.id, g.target_act_id as post, g.created_at, (g.payload ->> 'ends')::timestamptz as ends
    from acts g join mine m on m.id = g.character join card_kinds ck on ck.key = g.payload ->> 'card' and ck.gimmick ->> 'kind' = 'ride'
    where g.kind = 'card' and g.target_act_id is not null and coalesce(g.payload ->> 'reach', 'post') = 'post' and not (g.payload ? 'caught')
      and g.created_at < window_end and g.created_at >= window_start - (select max(r.lasts) from card_kinds r where r.gimmick ->> 'kind' = 'ride')
      and (g.payload ->> 'ends')::timestamptz > window_start and g.id not in (select id from ended)),
  rode as (
    select s.id as spring, (s.payload ->> 'by')::uuid as by_cast
    from acts s join mine m on m.id = s.character
    where s.kind = 'spring' and s.payload ->> 'did' = 'rode' and s.id not in (select id from ended)
      and exists (select 1 from reactions r where r.act = (s.payload ->> 'by')::uuid and r.created_at >= window_start and r.created_at < window_end)),
  ride_casts as (
    select c.id from my_gimmicks g join acts c on c.target_act_id = g.post and c.kind = 'card' and coalesce(c.payload ->> 'reach', 'post') = 'post'
    where c.id <> g.id and c.created_at >= g.created_at and c.created_at < g.ends and c.created_at < window_end and c.id not in (select id from ended)
      and exists (select 1 from reactions r where r.act = c.id and r.created_at >= window_start and r.created_at < window_end)
    union select by_cast from rode),
  -- The caller's Acts reacted to in the window, whenever written: each of the caller's Acts, then
  -- its reactions through the index that leads with the Act, never the whole window's reactions.
  mine_reacted as (select distinct a.id as act from acts a join mine m on m.id = a.character
                   where exists (select 1 from reactions r where r.act = a.id and r.created_at >= window_start and r.created_at < window_end)),
  -- The Acts the caller reacted to in the window, through reactions_reactor.
  reacted_by_me as (select distinct r.act from reactions r where r.reactor_account = account and r.created_at >= window_start and r.created_at < window_end),
  -- ---- The caller's debates (0390) ----
  cutoff as (select window_start - make_interval(days => (setting('debateDays') #>> '{}')::integer) as at),
  -- The caller's own posts made no earlier than the cutoff, through acts_character: the only Acts a walk starts from. A bystander's posts lead nothing about anyone else's debate.
  my_posts as (select a.id, a.created_at as at, a.character, a.kind, a.thread from acts a join mine m on m.id = a.character
               where a.kind = 'post' and a.created_at >= (select at from cutoff) and a.created_at < window_end and a.id not in (select id from ended)),
  -- The caller's own paid sparks (0398), of any age: a post of the caller's with a nonzero tallied sum for some reason (the settlements that ended by the window's start, by the `act` index) that a reaction reached in the window.
  -- Another player's post is never read here, so a bystander has none, and the amounts are the caller's own.
  old_paid as (
    select a.id, a.created_at as at, a.character, a.kind, a.thread from acts a join mine m on m.id = a.character join mine_reacted r on r.act = a.id
    where a.kind = 'post' and a.created_at < window_end and a.id not in (select id from ended)
      and exists (select 1 from tallied_lines l join settlements st on st.id = l.settlement where l.act = a.id and st.ends_at <= window_start group by l.reason having sum(l.amount) <> 0)),
  -- Walk down from the caller's posts (settlement_input's `down`) to find which have a member in the window. Another player's Acts, and the caller's own spun threads' (the same player), only; a staff Act is no member.
  down1 as (
    select p.id, p.at from my_posts p
    union
    select a.id, a.created_at from down1 d cross join lateral (
      select a.id, a.created_at from quote_refs r cross join lateral (select * from acts where id = r.act offset 0) a
      where r.quoted = d.id and a.kind in ('post', 'spin') and a.created_at < window_end and (a.created_at, a.id) > (d.at, d.id)
        and a.character is not null and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)
      offset 0) a),
  spun1 as (
    select sp.id, sp.created_at as at, sp.thread, s.id as spark
    from my_posts s cross join lateral (
      select sp.id, sp.created_at, sp.thread from acts sp
      where sp.target_act_id = s.id and sp.kind = 'spin' and sp.created_at < window_end and sp.created_at >= s.at and sp.character not in (select id from mine)
        and not is_staff_side(sp.character, sp.kind, sp.target_act_id) and sp.id not in (select id from ended)
      offset 0) sp),
  spun_in1 as (
    select p.id, p.created_at as at, sp.spark from spun1 sp cross join lateral (
      select p.id, p.created_at from acts p where p.thread = sp.thread and p.kind = 'post' and p.created_at < window_end and p.created_at >= sp.at
        and p.character is not null and not is_staff_side(p.character, p.kind, p.target_act_id) and p.id not in (select id from ended)
      offset 0) p),
  -- Walk up from each member in the window, through quote_refs, to ancestors made no earlier than the cutoff (and earlier than what quotes them): the caller's posts among them have a member in the window.
  up1 as (
    select d.id, d.at from down1 d where d.at >= window_start
    union
    select b.id, b.created_at from up1 u cross join lateral (
      select b.id, b.created_at from quote_refs r cross join lateral (select * from acts where id = r.quoted offset 0) b
      where r.act = u.id and b.kind in ('post', 'spin') and b.created_at >= (select at from cutoff) and (b.created_at, b.id) < (u.at, u.id)
        and b.character is not null and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)
      offset 0) b),
  -- Each is a join, so none is a subplan read once for every post of the caller's: a post with a member in the window by a quote (up1) or by a spun thread, and a post of the caller's a reaction reached in the window while it has
  -- a debate by the window's end (a quote or another player's spin made before it), as settlement_input reads a spark whose vote moved.
  sparks as (
    select p.id, p.at, p.character, p.thread from (select * from my_posts union select * from old_paid) p join (
      select id from up1
      union select spark from spun_in1 where at >= window_start
      union select spark from spun1 where at >= window_start
      union select id from old_paid
      union select p.id from my_posts p join mine_reacted r on r.act = p.id
        where exists (select 1 from quote_refs q cross join lateral (select * from acts where id = q.act offset 0) a where q.quoted = p.id and a.kind in ('post', 'spin') and a.created_at < window_end and (a.created_at, a.id) > (p.at, p.id)
                        and a.character is not null and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended))
           or exists (select 1 from acts sp where sp.target_act_id = p.id and sp.kind = 'spin' and sp.created_at < window_end and sp.created_at >= p.at and sp.character not in (select id from mine)
                        and not is_staff_side(sp.character, sp.kind, sp.target_act_id) and sp.id not in (select id from ended))
    ) k on k.id = p.id),
  -- Walk up from every spark of the caller's (as settlement_input's `ancestry`, which holds each ancestor however old since 0398), by whatever branch reached it: a spark reached through a spun thread or a reaction has no ancestor in `up1`, and the engine reads inOwnDebate from
  -- the edges above a spark. Another player's post it quotes is a public Act, keyed under the salt like any other; a bystander has no spark, so none of this is in a bystander's input.
  ancestry as (
    select s.id, s.at from sparks s
    union
    select b.id, b.created_at from ancestry u cross join lateral (
      select b.id, b.created_at from quote_refs r cross join lateral (select * from acts where id = r.quoted offset 0) b
      where r.act = u.id and b.kind in ('post', 'spin') and b.created_at < window_end and (b.created_at, b.id) < (u.at, u.id)
        and b.character is not null and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)
      offset 0) b),
  -- The origin a spark's thread was spun from and the spin that made it (settlement_input's `origin_reads`, 0398): public Acts, keyed under the salt like any other, for the caller's sparks alone and only where the origin is the caller's own post (the one case inOwnDebate asks about), so a post of the caller's in a thread spun from another player's brings none of that player's debate.
  origin_reads as (
    select sp.id, sp.created_at as at from sparks s
    cross join lateral (select t.origin_act_id as o from threads t where t.id = s.thread and t.origin_act_id is not null and exists (select 1 from acts oa join mine m on m.id = oa.character where oa.id = t.origin_act_id) offset 0) t
    cross join lateral (select sp.id, sp.created_at from acts sp where sp.thread = s.thread and sp.kind = 'spin' and sp.target_act_id = t.o and sp.created_at < window_end
                          and sp.character is not null and not is_staff_side(sp.character, sp.kind, sp.target_act_id) and sp.id not in (select id from ended) offset 0) sp
    union
    select o.id, o.created_at from sparks s
    cross join lateral (select t.origin_act_id as o from threads t where t.id = s.thread and t.origin_act_id is not null and exists (select 1 from acts oa join mine m on m.id = oa.character where oa.id = t.origin_act_id) offset 0) t
    cross join lateral (select o.id, o.created_at from acts o where o.id = t.o and o.kind in ('post', 'spin') and o.created_at < window_end
                          and o.character is not null and not is_staff_side(o.character, o.kind, o.target_act_id) and o.id not in (select id from ended) offset 0) o),
  -- The members of the sparks alone: walk down again from them, so the input holds nothing of the caller's posts that have no member in the window.
  down as (
    select s.id, s.at from sparks s
    union
    select a.id, a.created_at from down d cross join lateral (
      select a.id, a.created_at from quote_refs r cross join lateral (select * from acts where id = r.act offset 0) a
      where r.quoted = d.id and a.kind in ('post', 'spin') and a.created_at < window_end and (a.created_at, a.id) > (d.at, d.id)
        and a.character is not null and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)
      offset 0) a),
  spun_spins as (
    select sp.id, sp.created_at as at, sp.thread
    from sparks s cross join lateral (
      select sp.id, sp.created_at, sp.thread from acts sp
      where sp.target_act_id = s.id and sp.kind = 'spin' and sp.created_at < window_end and sp.created_at >= s.at and sp.character not in (select id from mine)
        and not is_staff_side(sp.character, sp.kind, sp.target_act_id) and sp.id not in (select id from ended)
      offset 0) sp),
  spun_posts as (
    select p.id from spun_spins sp cross join lateral (
      select p.id from acts p where p.thread = sp.thread and p.kind = 'post' and p.created_at < window_end and p.created_at >= sp.at
        and p.character is not null and not is_staff_side(p.character, p.kind, p.target_act_id) and p.id not in (select id from ended)
      offset 0) p),
  members as (select id from down union select id from spun_spins union select id from spun_posts),
  -- Each cushion play on a spark of the caller's, or on its character, that ended after the spark was made (settlement_input's `cushion_plays`); another player's play on the caller's post is public, as an earn's is.
  cushion_plays as (
    select k.id from sparks s cross join lateral (
      select k.id from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.gimmick ->> 'kind' = 'cushion'
      where k.target_act_id = s.id and k.kind = 'card' and coalesce(k.payload ->> 'reach', 'post') = 'post'
        and k.created_at < window_end and not (k.payload ? 'caught') and (k.payload ->> 'ends')::timestamptz > s.at and k.id not in (select id from ended)
      offset 0) k
    union
    select k.id from sparks s cross join lateral (
      select k.id from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.gimmick ->> 'kind' = 'cushion'
      where k.kind = 'card' and k.payload ->> 'reach' = 'character' and k.payload ->> 'character' = s.character::text
        and k.created_at < window_end and k.created_at >= s.at - (select max(c.lasts) from card_kinds c where c.gimmick ->> 'kind' = 'cushion')
        and not (k.payload ? 'caught') and (k.payload ->> 'ends')::timestamptz > s.at and k.id not in (select id from ended)
      offset 0) k),
  targets as (select target_act_id as id from win_acts where kind in ('card', 'spin', 'spring') and target_act_id is not null and coalesce(payload ->> 'reach', 'post') = 'post'),
  -- The casts the caller's window springs caught (settlement_input's `scored`, 0378): a spring is scored against the cast it caught, so the cast's reactions are read. They go through `all_reactions`, `keyed` and
  -- `totals_withheld` as every other does, and nothing here is keyed by who owns the cast or its reactors.
  spring_by as (select (payload ->> 'by')::uuid as id from win_acts where kind = 'spring' and payload ->> 'by' is not null),
  -- Every card of the caller's on a post the caller's window cards point at: a vote counts for the earliest.
  my_cards_there as (select a.id from acts a join mine m on m.id = a.character join targets t on t.id = a.target_act_id where a.kind in ('card', 'spring') and a.created_at < window_end and coalesce(a.payload ->> 'reach', 'post') = 'post'),
  -- Cards others played on the caller's posts in the window.
  landed as (select a.id from acts p join mine m on m.id = p.character join acts a on a.target_act_id = p.id
             where a.kind = 'card' and a.created_at >= window_start and a.created_at < window_end and coalesce(a.payload ->> 'reach', 'post') = 'post'),
  -- The caller's spun threads active in the window: the spin, and each character's first post.
  spun as (select distinct s.thread as id from acts s join mine m on m.id = s.character
           where s.kind = 'spin' and exists (select 1 from acts x where x.thread = s.thread and x.created_at >= window_start and x.created_at < window_end)),
  spins as (select a.id from acts a join spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    select f.id from spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.id from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  -- The Acts whose reactions are read.
  voted as (select id from win_acts union select act from mine_reacted union select act from reacted_by_me union select id from targets
            union select post from skim_up union select id from ride_casts union select id from spring_by
            -- The caller's own sparks (0390): their posts, whose reactions the caller's log already shows. Their members are never voted, so no reaction on one is read.
            union select id from sparks),
  touched as (
    select id from voted union select id from my_cards_there union select id from landed union select id from spins
    union select id from earn_up union select post from earn_up where post is not null
    union select target_act_id from acts a join spins s on s.id = a.id where a.target_act_id is not null
    union select id from first_posts
    union select id from skim_up union select id from my_gimmicks union select spring from rode
    union select id from ancestry union select id from members union select id from cushion_plays union select id from origin_reads
    -- The post each card, spin or spring among the voted Acts points at (Task 1, #137): a card the caller only reacted to is
    -- judged against its post, and a spin the caller only reacted to is read with its origin (settle.ts reads every spin's), as
    -- settlement_input reads every window play's target.
    union select a.target_act_id from acts a join voted v on v.id = a.id
          where a.kind in ('card', 'spin', 'spring') and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post'
  ),
  -- As settlement_input (0004, as 0043 changed it): a staff character's Acts, and a card on one, are named and pay nobody.
  all_acts as (select a.* from touched t cross join lateral (select a.* from acts a where a.id = t.id offset 0) a where a.created_at < window_end and a.character is not null and a.kind <> 'donation'
               and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)),
  -- A staff post a window's card of the caller's landed on, as settlement_input names it (0054).
  unscored as (select a.* from touched t cross join lateral (select a.* from acts a where a.id = t.id offset 0) a join characters c on c.id = a.character
               where c.staff is not null and a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start and coalesce(k.payload ->> 'reach', 'post') = 'post')),
  system_acts as (select a.id from touched t cross join lateral (select a.* from acts a where a.id = t.id offset 0) a
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  -- Every reaction on an Act voted on, up to now, but the caller's own to the caller's own characters,
  -- and none on The System's own Acts: the tally every player reacts to would hand each caller who
  -- reacted to it every other player's reaction.
  --
  -- The settlement never pays a player's reactions to their own characters, and until 0073 this read
  -- left them out too, which made a live line computed from who reacted: a fire landing on Bob's post
  -- under Ann's card with no lift line told Ann it came from one of Bob's masks. The live estimate is not
  -- The System's scoring (CLAUDE.md, "A response never proves a private fact": "The live estimate is not
  -- that exception: it leaves out only the caller's own reactions, counts every other as anyone's, and
  -- the settlement is exact"). So ownership is read here only to tell the caller's own from the rest:
  -- the caller knows their own, and every other reaction, the author's own player's included, is
  -- counted under `keyed`'s per-mask keys, which the engine cannot tie to an author. The estimate can then
  -- say more than the settlement pays, as it says "up to"; the settled log is exact.
  all_reactions as (
    select r.* from voted v cross join lateral (select r.* from reactions r where r.act = v.id and r.created_at < window_end offset 0) r
    join acts a on a.id = r.act join characters c on c.id = a.character
    where r.created_at < window_end and not (r.reactor_account = account and c.owner = account) and r.act not in (select id from ended) and a.kind <> 'donation'
      and not (r.reactor_account <> account and totals_withheld(r.act, account))
      and (not is_staff_side(a.character, a.kind, a.target_act_id) or a.id in (select id from unscored))
  ),
  -- Each reaction's voter and mask as the engine reads them: the caller's own, as the caller's;
  -- any other's, under keys made up for this request.
  keyed as (
    select r.id, r.act, r.kind, r.created_at,
      case when r.reactor_account = account then you else md5(salt || 'reactor' || r.reactor_character) end as player,
      case when r.reactor_account = account then r.reactor_character::text else md5(salt || 'mask' || r.reactor_character) end as character
    from all_reactions r
  ),
  others as (
    select distinct a.character::text as id, md5(salt || 'author' || a.character) as player from all_acts a where a.character not in (select id from mine)
    union select distinct k.character, k.player from keyed k where k.player <> you
  )
  select jsonb_build_object(
    'player', you,
    -- The window's start exactly, as the settlement that opened it ended: `from` is whole
    -- milliseconds, which can fall short of it. The estimate keeps its answer with this one.
    'windowStart', window_start,
    -- The classes the caller's own characters are scored as for this window (scored_as_plays), beside the window's start: the estimate can say it.
    'scoredAs', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'class', s.class_key, 'play', s.play) order by s.character)
                          from scored_as_plays(window_start, window_end) s join mine m on m.id = s.character), '[]'),
    'window', jsonb_build_object('id', 'estimate',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(x order by x ->> 'id') from (
        select jsonb_build_object('id', c.id, 'player', you, 'classes', coalesce((
          select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
          from class_history h where h.character = c.id and h.started_at < window_end), '[]'),
          'reveals', coalesce((select jsonb_agg((extract(epoch from u.at) * 1000)::bigint order by u.at, u.act)
            from class_reveals u where u.character = c.id and u.at < window_end), '[]')) as x
        from characters c join mine m on m.id = c.id
        union all
        select jsonb_build_object('id', o.id, 'player', o.player, 'classes', '[]'::jsonb, 'reveals', '[]'::jsonb) from others o
      ) cs), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread,
        'target', case when coalesce(a.payload ->> 'reach', 'post') = 'post' then a.target_act_id end,
        'reach', case when a.kind = 'card' then nullif(coalesce(a.payload ->> 'reach', 'post'), 'post') end,
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end,
        'by', case when a.kind = 'spring' then a.payload ->> 'by' end,
        -- A caught play is never in effect (0370): its `ends`, where a row written before 0370 holds one, is not sent, so it boosts and skims nothing. A cut play's `ends` is the cut's time at the latest (card_cut_at), so it pays nothing from then on.
        'ends', case when a.kind = 'card' and not (a.payload ? 'caught') and (select ck.gimmick is not null or ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card')
                     then (extract(epoch from least((a.payload ->> 'ends')::timestamptz, card_cut_at(a.id))) * 1000)::bigint end,
        'quadrant', case when a.kind = 'card' and (select ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card') then a.payload #>> '{config,quadrant}'
                         when a.kind = 'spring' then a.payload ->> 'quadrant' end,
        'on', case when a.kind = 'card' and a.payload ->> 'reach' = 'character' then a.payload ->> 'character' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    'unscoredTargets', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'staff', true) order by a.created_at, a.id)
      from unscored a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', k.act, 'kind', k.kind, 'at', (extract(epoch from k.created_at) * 1000)::bigint,
        'player', k.player, 'character', k.character)
        || case when k.kind like 'x-%' then jsonb_build_object('quadrant', reaction_quadrant(k.act, k.kind)) else '{}'::jsonb end order by k.created_at, k.id)
      from keyed k), '[]'),
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'),
    -- Each quote with both ends among the caller's sparks and their members, so a bystander's input holds none (0390).
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'quoted', r.quoted) order by r.act, r.quoted)
      from all_acts a cross join lateral (select r.act, r.quoted from quote_refs r where r.act = a.id offset 0) r join all_acts q on q.id = r.quoted
      where a.id in (select id from ancestry union select id from members) and q.id in (select id from ancestry union select id from members)), '[]'),
    -- What the settlements that ended by the window's start tallied on each of the caller's sparks (settlement_input's `tallied`, 0398): the caller's own sums alone, since a bystander has no spark.
    'tallied', coalesce((
      select jsonb_agg(jsonb_build_object('act', t.act, 'reason', t.reason, 'amount', t.amount) order by t.act, t.reason)
      from sparks s cross join lateral (
        select l.act, l.reason, sum(l.amount)::integer as amount from tallied_lines l join settlements st on st.id = l.settlement
        where l.act = s.id and st.ends_at <= window_start group by l.act, l.reason having sum(l.amount) <> 0 offset 0) t), '[]'))
  );
end $$;
