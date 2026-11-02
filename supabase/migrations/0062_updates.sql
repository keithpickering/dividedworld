-- Updates: the developer persona, its Acts, and the alert every player gets. The alerts plan, Task 7; the alerts design, sections
-- 3 and 6.
--
-- The developer is a staff character of a third kind (0043 has a Boss and a Mod Bot): no owner, no class, no wallet, no standing,
-- and every Act of its earns nothing (is_staff_side, 0054, reads only that an Act's author is staff, so a reaction to an update is
-- tallied and pays no one, as one to The System's own Acts does). One exists at most. It is the instance's developer persona
-- ("Gabe", for Divided World): the one in-character voice the glass has, its Updates page. CLAUDE.md's "The fiction may lie; the log
-- never does" lets it speak because it is written only by admins, never by a model, and always true. So this migration makes it
-- reachable by nothing but an admin:
--   - an update is the Act kind `update`, and acts_update_guard refuses one unless post_update has opened `kayfabb.update_writer`
--     for the insert, and unless its author is the developer;
--   - write_staff_act, the one door The System's Edge Functions (the Director) write staff Acts through, refuses the developer
--     whatever kind it is asked for, by key; and the guard refuses any Act by the developer, other than an update, under the staff
--     flag, so a writer that forgets still cannot;
--   - no player writer reaches it either: every one asks played_by(character, caller), which reads `owner = who` (0043), and the
--     developer's owner is null;
--   - post_update itself is an admin's (is_admin, which reads auth.uid()), so the service role, whose uid is null, is refused too.
--
-- The seed supplies the persona: seed_instance reads a `developer` entry ({ name, title, avatar }). `title` is the tagline
-- ("Made this. Sorry."), kept as the character's profile title like any staff member's, cut to what a profile holds; `avatar` is
-- an asset key the instance's UI resolves to a picture (the way a pip style is a key), kept in the setting `developerAvatar`. A seed
-- with no developer entry makes no developer and no thread (the engine's own seed always has one, "The developers"). It opens the
-- updates thread on The System's board, once, and records it in the setting `updatesThread` as it does the announcements thread
-- (`systemAnnouncements`, 0048). That thread is never listed: thread_list leaves it out and the thread counter is netted so a
-- board's count stays the length of its list. A link to it is not a dead end: the Updates page is its reader (`updates()`).
--
-- post_update(title, body, changes) is the only way in. The title and body are held to the settings every post is
-- (titleMaxLength, postMaxLength). `changes` is the page's plain "What changed" list, [{ label, text }]; an admin typed it and is
-- in front of the answer, but the spirit of "A validator tighter than the schema is a place a paid answer goes to die" holds: what
-- can be repaired without inventing words is repaired (whitespace around a label or a text, a row with neither, a missing label,
-- a null or missing list, keys that are no part of a change), and what cannot is refused naming the predicate and the change's
-- number (a change that is no object, a label with no text, a label or text over its bound, more than 30 changes). The bounds
-- live in update_payload_problem, which the table's check constraint runs too, so nothing writes around the function.
--
-- A new update is an alert for every player at once (design, section 6): not a row per player, so it cannot vary with anything
-- private. alerts_news and alerts_news_unread (0060) read the update Acts, and the same is true for every player; Task 8 adds season
-- news to the same two functions. The index acts_updates makes each an index range from the newest back.
--
-- Its way out: an update is a post, not a state. A mistaken one is corrected by a newer one; the Acts themselves are never edited.

alter table characters drop constraint characters_staff_kind_check;
alter table characters add constraint characters_staff_kind_check check (staff_kind in ('boss', 'bot', 'developer'));
-- The instance has one developer persona.
create unique index characters_one_developer on characters ((true)) where staff_kind = 'developer';

-- ---------------------------------------------------------------------------- the Act ----

alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring', 'update'));
-- An update points at nothing (it is its thread's own post). acts_character_null needs no change: an update is a character's, the developer's.
alter table acts drop constraint acts_check1;
alter table acts add constraint acts_check1 check (kind in ('post', 'tally', 'reveal', 'unmask', 'move', 'update') or target_act_id is not null
  or (kind = 'card' and payload ->> 'reach' = 'board'));

-- What is wrong with an update's payload, in words naming the predicate and where, or null when nothing is. The one list of bounds:
-- post_update repairs and then asks it, and the table's constraint asks it again.
create function update_payload_problem(p jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  e jsonb;
  n integer := 0;
  k text;
begin
  if jsonb_typeof(p) is distinct from 'object' then return 'an update is an object'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('title', 'body', 'changes') then return format('an update holds a title, a body and changes, not "%s"', left(k, 40)); end if;
  end loop;
  if jsonb_typeof(p -> 'title') is distinct from 'string' or char_length(p ->> 'title') not between 1 and 500 then return 'an update''s title is 1 to 500 characters'; end if;
  if jsonb_typeof(p -> 'body') is distinct from 'string' or char_length(p ->> 'body') not between 1 and 200000 then return 'an update''s body is 1 to 200000 characters'; end if;
  if jsonb_typeof(p -> 'changes') is distinct from 'array' then return 'changes is a list of { label, text }'; end if;
  if jsonb_array_length(p -> 'changes') > 30 then return 'an update lists at most 30 changes'; end if;
  for e in select x from jsonb_array_elements(p -> 'changes') x loop
    n := n + 1;
    if jsonb_typeof(e) is distinct from 'object' then return format('change %s is { label, text }, not a %s', n, jsonb_typeof(e)); end if;
    for k in select jsonb_object_keys(e) loop
      if k not in ('label', 'text') then return format('change %s is { label, text }, not "%s"', n, left(k, 40)); end if;
    end loop;
    if jsonb_typeof(e -> 'label') is distinct from 'string' then return format('change %s has a label that is a string (empty if it has none)', n); end if;
    if char_length(e ->> 'label') > 80 then return format('change %s has a label of at most 80 characters', n); end if;
    if jsonb_typeof(e -> 'text') is distinct from 'string' or char_length(e ->> 'text') not between 1 and 600 then return format('change %s has a text of 1 to 600 characters', n); end if;
  end loop;
  return null;
end $$;
revoke execute on function update_payload_problem(jsonb) from public, anon, authenticated;

alter table acts add constraint acts_update_payload check (kind <> 'update' or update_payload_problem(payload) is null);

-- The newest updates, from the newest back: Updates reads a page of them, and alerts_news the ones newer than a mark.
create index acts_updates on acts (created_at desc, id desc) where kind = 'update';

-- An update is written only through post_update, only by the developer; the developer writes nothing else. A before-insert trigger and
-- not a clause of acts_well_formed (0054), which is a long function that every write already runs; this one reads a setting, and a
-- table only when the staff flag is open or the Act is an update.
create function acts_update_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'update' then
    if coalesce(current_setting('kayfabb.update_writer', true), '') <> 'on' then
      raise exception 'an update is written only through post_update' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if new.character is null or not exists (select 1 from characters c where c.id = new.character and c.staff_kind = 'developer') then
      raise exception 'an update is the developer''s' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
  elsif new.character is not null and coalesce(current_setting('kayfabb.staff_writer', true), '') = 'on'
        and exists (select 1 from characters c where c.id = new.character and c.staff_kind = 'developer') then
    raise exception 'the developer speaks only through post_update, by an admin' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  return new;
end $$;
create trigger acts_update_guard before insert on acts for each row execute function acts_update_guard();
revoke execute on function acts_update_guard() from public, anon, authenticated;

-- write_staff_act (0051), refusing the developer. The Director and the Mod Bots write through it by staff key, and a model's words
-- reach a key, so the developer's key is refused here, before any kind is looked at. Everything else as 0051 wrote it.
create or replace function write_staff_act(staff_key text, kind text, thread uuid, target uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  written uuid;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if whose = 'developer' then
    raise exception 'the developer speaks only through post_update, by an admin' using errcode = '42501';
  end if;
  if kind is null or kind not in ('post', 'spin', 'card', 'edit', 'move', 'move_keep') then
    raise exception 'a staff character posts, spins, plays a card, edits, moves or keeps a move, not %', coalesce(kind, 'nothing') using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'an Act''s payload is an object' using errcode = '22023'; end if;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (who, kind, thread, target, payload) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return act_projection(written);
end $$;

-- ------------------------------------------------------------------------------ writing ----

-- An admin's update, as the developer, in the updates thread. See the head of this file for the repair and the refusals. It answers with the
-- update as `updates` reads it, persona and all.
create function post_update(title text, body text, changes jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  home uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'updatesThread');
  dev uuid;
  fixed jsonb := '[]';
  e jsonb;
  n integer := 0;
  lab text;
  txt text;
  problem text;
  written uuid;
begin
  if auth.uid() is null or not is_admin() then
    raise exception 'only an admin writes an update' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  perform within('title', title, 'titleMaxLength');
  perform within('body', body, 'postMaxLength');
  if changes is null or jsonb_typeof(changes) = 'null' then
    fixed := '[]';
  elsif jsonb_typeof(changes) <> 'array' then
    raise exception 'changes is a list of { label, text }, not a %', jsonb_typeof(changes) using hint = 'kayfabb.refusal', errcode = '22023';
  else
    for e in select x from jsonb_array_elements(changes) x loop
      n := n + 1;
      if jsonb_typeof(e) <> 'object' then
        raise exception 'change % is { label, text }, not a %', n, jsonb_typeof(e) using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      if jsonb_typeof(e -> 'label') not in ('string', 'null') and e ? 'label' then
        raise exception 'change % has a label that is a string (empty if it has none)', n using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      if jsonb_typeof(e -> 'text') not in ('string', 'null') and e ? 'text' then
        raise exception 'change % has a text that is a string', n using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      lab := regexp_replace(coalesce(e ->> 'label', ''), '^\s+|\s+$', '', 'g');
      txt := regexp_replace(coalesce(e ->> 'text', ''), '^\s+|\s+$', '', 'g');
      if lab = '' and txt = '' then continue; end if;
      if txt = '' then
        raise exception 'change % has a label and no text; give it a text, or leave the row out', n using hint = 'kayfabb.refusal', errcode = '22023';
      end if;
      fixed := fixed || jsonb_build_array(jsonb_build_object('label', lab, 'text', txt));
    end loop;
  end if;
  problem := update_payload_problem(jsonb_build_object('title', title, 'body', body, 'changes', fixed));
  if problem is not null then raise exception '%', problem using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  select c.id into dev from characters c where c.staff_kind = 'developer';
  if dev is null or home is null then
    raise exception 'this instance has no developer or no updates thread; its seed has no developer' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform set_config('kayfabb.update_writer', 'on', true);
  insert into acts (character, kind, thread, payload)
  values (dev, 'update', home, jsonb_build_object('title', title, 'body', body, 'changes', fixed)) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  perform set_config('kayfabb.update_writer', '', true);
  return (select to_jsonb(u) from updates_read u where u.act = written);
end $$;
revoke execute on function post_update(text, text, jsonb) from public, anon;
grant execute on function post_update(text, text, jsonb) to authenticated;

-- --------------------------------------------------------------------------- the reading ----

-- One update with the persona that wrote it: the Act, its thread (to spin from), the developer's character, name and tagline (its
-- profile title), the asset key of its avatar, and the update itself. A view for the two functions below and for no API role: it runs
-- as its owner, and `updates` and post_update are the doors. Public in what it holds, as the Acts are: nothing here depends on who reads.
create view updates_read as
  select a.id as act, a.thread, a.character, c.name, coalesce(p.title, '') as tagline,
         (select s.value #>> '{}' from settings s where s.key = 'developerAvatar') as avatar,
         a.payload ->> 'title' as title, a.payload ->> 'body' as body, a.payload -> 'changes' as changes, a.created_at as at, a.seq
  from acts a join characters c on c.id = a.character left join character_profiles p on p.character = c.id
  where a.kind = 'update';
revoke all on updates_read from public, anon, authenticated;

-- A page of updates, newest first: `most` (1 to 50, 20 by default) older than `before` (exclusive; none for the newest page). Two
-- updates at one instant are two posts of one transaction, which post_update never makes, so the time is a cursor that loses none.
create function updates(before timestamptz default null, most integer default 20) returns setof updates_read
language sql stable security definer set search_path = public, pg_temp as $$
  select * from updates_read u where u.at < coalesce($1, 'infinity'::timestamptz) order by u.at desc, u.act desc limit greatest(1, least(coalesce($2, 20), 50))
$$;
revoke execute on function updates(timestamptz, integer) from public, anon;
grant execute on function updates(timestamptz, integer) to authenticated;

-- thread_list (0030), leaving out the updates thread: the board never lists it. Everything else as 0030 wrote it. The thread is
-- read by the Updates page through updates(), and a spin from an update names it as its origin (origin_thread, origin_title).
create or replace view thread_list as
  select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.next_seq - 1 as last_seq, t.replies,
         f.id as first_act, f.character as first_character,
         l.id as last_act, l.character as last_character,
         (select count(*) from (
            select 1 from acts r where r.thread = t.id and r.kind = 'post' and r.seq > 1 and r.created_at > now() - interval '7 days'
            limit (select (h.value #>> '{}')::integer from settings h where h.key = 'hotReplies')
          ) capped) as replies_this_week,
         o.thread as origin_thread, ot.title as origin_title, o.seq as origin_seq
  from threads t
  left join acts f on f.thread = t.id and f.seq = 1
  left join acts l on l.thread = t.id and l.seq = t.next_seq - 1
  left join acts o on o.id = t.origin_act_id
  left join threads ot on ot.id = o.thread
  where t.id::text is distinct from (select u.value #>> '{}' from settings u where u.key = 'updatesThread');

-- ---------------------------------------------------------------------- the alert for all ----

-- alerts_news and alerts_news_unread (0060), now reading updates: every player's, the same for each, so nothing here is computed from
-- anything of the caller's. An update row: its Act, its thread, the persona's name, the update's title; no character (it is nobody
-- of the player's), no sub, no count. `before` is exclusive and the page is the newest `most`, extended to every row sharing the
-- instant of its last, as my_alerts asks. Season news (Task 8) is a second select unioned into `news` below, and a second count
-- added to the unread, in the same two functions; it replaces them again, as this does.
create or replace function alerts_news(before timestamptz, most integer) returns setof alert_row
language sql stable as $$
  with
  floor_at as (
    select coalesce((select x.created_at from acts x where x.kind = 'update' and x.created_at < $1 order by x.created_at desc offset greatest($2, 1) - 1 limit 1), '-infinity'::timestamptz) as at
  ),
  updates_news as (
    select 'update'::text as kind, null::text as sub, a.id as act, null::uuid as character, a.created_at as at, a.thread, c.name, a.payload ->> 'title' as title, null::integer as count
    from acts a join characters c on c.id = a.character
    where a.kind = 'update' and a.created_at < $1 and a.created_at >= (select at from floor_at)
  )
  -- (season news, Task 8: another select here, unioned.)
  select * from updates_news
$$;
create or replace function alerts_news_unread(seen timestamptz) returns integer
language sql stable as $$
  select (select count(*) from (select 1 from acts a where a.kind = 'update' and a.created_at > $1 limit 10) u)::integer
  -- (season news, Task 8: plus its count here.)
$$;
revoke execute on function alerts_news(timestamptz, integer), alerts_news_unread(timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------- the seed ----

-- seed_instance (0055), with the developer and the updates thread. Everything else as 0055 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
begin
  -- Two seeds at once would each find no hire row and both write one into append-only staff_changes. An advisory
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
  -- The instance's staff (0043), once each: a Boss or a Mod Bot is made when its key has no character yet, debuted at
  -- seed time, with the profile its seed gives (its title and its signature, cut to what a profile holds). What an admin
  -- wrote is never written over: a reseed finds the key and does nothing. A bot in firstStaff with no staff_changes row
  -- is hired; one with a row, a fired bot's included, is left as that row says.
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, e ->> 'kind' as kind, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at) select s.name, s.staff, s.kind, now() from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature)
  select m.id, left(s.title, 40), left(s.signature, 500) from made m join seeded s on s.staff = m.staff;
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'bot');
  if unknown is not null then raise exception 'firstStaff names %, which no bot in the seed''s staff is', unknown using errcode = '22023'; end if;
  insert into staff_changes (staff, on_staff)
  select k, true from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_changes x where x.staff = k);
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board) select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false) from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The roster's order (0051): the Bosses of the seed's staff, in the order it lists them, so the rotation has one to follow. A seed with no
  -- Boss leaves the setting as it was.
  insert into settings (key, value)
  select 'bossRoster', jsonb_agg(e.value ->> 'key' order by e.ord)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord) where e.value ->> 'kind' = 'boss'
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
  -- as it makes a Boss: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
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

