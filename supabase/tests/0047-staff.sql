-- Staff characters (supabase/migrations/0042_staff.sql; the system plan, Task 4; the seasonal Boss design, section 1; the
-- staff design, "Staff characters, like Bosses"): a Boss or a Mod Bot is a character with no account behind it, seeded once,
-- written only by write_staff_act, earning nothing, and on staff only as staff_changes says.

-- ---- A seed makes each staff member once, with its profile; a reseed changes nothing an admin wrote ----
do $$
declare
  seed jsonb := jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object(
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'director', 'name', 'The Director', 'title', 'The System', 'signature', '[i]It is decided.[/i]', 'kind', 'boss'),
        jsonb_build_object('key', 'bot-one', 'name', 'Bot One', 'title', 'Mod Bot', 'signature', 'Rules are rules.', 'kind', 'bot'),
        jsonb_build_object('key', 'bot-two', 'name', 'Bot Two', 'title', 'Mod Bot', 'signature', '', 'kind', 'bot')),
      'firstStaff', jsonb_build_array('bot-one')));
  director uuid;
  bot_one uuid;
  made_at timestamptz;
  n integer;
begin
  -- Without a `system` a seed makes none.
  perform seed_instance(seed - 'system');
  if exists (select 1 from characters where staff is not null) then raise exception 'a seed without system made a staff character'; end if;

  perform seed_instance(seed);
  select id into director from characters where staff = 'director';
  select id into bot_one from characters where staff = 'bot-one';
  if director is null or bot_one is null then raise exception 'the seed made no staff character'; end if;
  if (select count(*) from characters where staff is not null) is distinct from 3 then raise exception 'the seed made % staff characters, not 3', (select count(*) from characters where staff is not null); end if;
  if exists (select 1 from characters where staff is not null and (owner is not null or debuted_at is null)) then raise exception 'a staff character has an owner or has not debuted'; end if;
  if (select staff_kind from characters where id = director) is distinct from 'boss' or (select staff_kind from characters where id = bot_one) is distinct from 'bot'
     or (select name from characters where id = bot_one) is distinct from 'Bot One' then raise exception 'a staff character lost its kind or its name'; end if;
  if (select title from character_profiles where character = director) is distinct from 'The System'
     or (select signature from character_profiles where character = director) is distinct from '[i]It is decided.[/i]' then raise exception 'the Director''s profile is not its seed''s'; end if;
  if (select count(*) from character_profiles where character in (select id from characters where staff is not null)) is distinct from 3 then raise exception 'each staff character gets a profile'; end if;

  -- Who is on staff: the seed's firstStaff, and never a Boss.
  if (select string_agg(staff, ',' order by staff) from staff_now) is distinct from 'bot-one' then raise exception 'staff_now should hold bot-one alone: %', (select string_agg(staff, ',') from staff_now); end if;
  if (select kind from staff_now) is distinct from 'bot' or (select since from staff_now) is null then raise exception 'staff_now should name the kind and since when'; end if;
  if (select count(*) from staff_changes) is distinct from 1 then raise exception 'the seed wrote % staff_changes rows, not 1', (select count(*) from staff_changes); end if;

  -- A reseed after an admin's edits changes none of them.
  update character_profiles set title = 'Edited', signature = 'Edited sig' where character = director;
  update characters set name = 'The Director Renamed' where id = director;
  made_at := (select debuted_at from characters where id = director);
  perform seed_instance(seed);
  if (select title from character_profiles where character = director) is distinct from 'Edited' or (select signature from character_profiles where character = director) is distinct from 'Edited sig'
     or (select name from characters where id = director) is distinct from 'The Director Renamed' or (select debuted_at from characters where id = director) is distinct from made_at then
    raise exception 'a reseed changed what an admin wrote';
  end if;
  if (select count(*) from characters where staff is not null) is distinct from 3 or (select count(*) from staff_changes) is distinct from 1 then raise exception 'a reseed made a second staff character or a second row'; end if;

  -- A bot taken off staff stays off through a reseed; one taken off and hired again is on.
  insert into staff_changes (staff, on_staff) values ('bot-one', false);
  perform seed_instance(seed);
  if exists (select 1 from staff_now) then raise exception 'a reseed rehired a fired bot: %', (select string_agg(staff, ',') from staff_now); end if;
  insert into staff_changes (staff, on_staff) values ('bot-one', true), ('bot-two', true);
  select count(*) into n from staff_now;
  if n <> 2 then raise exception 'a hired bot is on staff: % on', n; end if;
  insert into staff_changes (staff, on_staff) values ('bot-two', false);
  if (select string_agg(staff, ',') from staff_now) is distinct from 'bot-one' then raise exception 'the latest row decides: %', (select string_agg(staff, ',') from staff_now); end if;

  -- A firstStaff key that is no seeded bot is a seed's mistake, said so.
  begin perform seed_instance(jsonb_set(seed, '{system,firstStaff}', '["director"]')); raise exception 'a Boss was put on staff';
  exception when invalid_parameter_value then null; end;
end $$;

-- ---- The shape: a staff character has a key and a kind and no owner; nothing else has a key ----
do $$
declare
  ann uuid := tests.account('staff-shape');
  seen text;
begin
  -- The poison: a staff character with an owner.
  begin insert into characters (owner, name, staff, staff_kind, debuted_at) values (ann, 'Owned Staff', 'owned', 'bot', now()); raise exception 'a staff character with an owner was made';
  exception when check_violation then null; end;
  -- A character with no owner and no staff key; a staff key with no kind; a kind with no key; a kind outside the two.
  begin insert into characters (name, debuted_at) values ('Nobody''s', now()); raise exception 'a character with no owner and no staff key was made';
  exception when check_violation then null; end;
  begin insert into characters (name, staff, debuted_at) values ('Kindless', 'kindless', now()); raise exception 'a staff key with no kind was made';
  exception when check_violation then null; end;
  begin insert into characters (owner, name, staff_kind, debuted_at) values (ann, 'Keyless', 'bot', now()); raise exception 'a kind with no staff key was made';
  exception when check_violation then null; end;
  begin insert into characters (name, staff, staff_kind, debuted_at) values ('Odd Kind', 'odd', 'henchman', now()); raise exception 'a kind outside boss and bot was made';
  exception when check_violation then null; end;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Shape Boss', 'shape-boss', 'boss', now());
  begin insert into characters (name, staff, staff_kind, debuted_at) values ('Shape Twin', 'shape-boss', 'bot', now()); raise exception 'two staff characters shared a key';
  exception when unique_violation then null; end;

  -- A Boss is never in staff_changes; a row is never changed or removed.
  begin insert into staff_changes (staff, on_staff) values ('shape-boss', true); raise exception 'a Boss was put in staff_changes';
  exception when check_violation then null; end;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Shape Bot', 'shape-bot', 'bot', now());
  insert into staff_changes (staff, on_staff) values ('shape-bot', true);
  begin update staff_changes set on_staff = false where staff = 'shape-bot'; raise exception 'a staff_changes row was updated';
  exception when sqlstate 'P0001' then null; end;
  begin delete from staff_changes where staff = 'shape-bot'; raise exception 'a staff_changes row was removed';
  exception when sqlstate 'P0001' then null; end;
  begin truncate staff_changes; raise exception 'staff_changes was truncated';
  exception when sqlstate 'P0001' then null; end;
  if (select count(*) from pg_trigger t where t.tgrelid = 'public.staff_changes'::regclass and t.tgname in ('staff_changes_no_update', 'staff_changes_no_truncate') and t.tgenabled = 'A') is distinct from 2 then
    raise exception 'staff_changes'' append-only triggers must fire always';
  end if;
  begin insert into staff_changes (staff, on_staff) values ('nobody-at-all', true); raise exception 'a row named a staff member who is not one';
  exception when foreign_key_violation then null; end;

  -- No client reads or writes staff_changes; both read staff_now.
  if not (select relrowsecurity from pg_class where oid = 'public.staff_changes'::regclass) then raise exception 'staff_changes has no row-level security'; end if;
  foreach seen in array array['anon', 'authenticated'] loop
    perform set_config('role', seen, true);
    begin perform count(*) from staff_changes; raise exception '% read staff_changes', seen; exception when insufficient_privilege then null; end;
    begin insert into staff_changes (staff, on_staff) values ('shape-bot', true); raise exception '% wrote staff_changes', seen; exception when insufficient_privilege then null; end;
    if not exists (select 1 from staff_now where staff = 'shape-bot') then raise exception '% could not read staff_now', seen; end if;
    perform tests.unbecome();
  end loop;
end $$;

-- ---- The cap counts no staff character ----
do $$
declare ann uuid := tests.account('staff-cap');
begin
  perform tests.character(ann, 'Capped One');
  update settings set value = '0' where key = 'charactersPerPlayer';
  -- With no slot to give, a staff character is still made (it takes none), and a player's is still refused.
  insert into characters (name, staff, staff_kind, debuted_at) values ('Cap Bot', 'cap-bot', 'bot', now());
  begin insert into characters (owner, name) values (ann, 'Capped Two'); raise exception 'the cap did not hold';
  exception when sqlstate 'P0001' then if sqlerrm = 'the cap did not hold' then raise; end if; end;
  update settings set value = '6' where key = 'charactersPerPlayer';
end $$;

-- ---- Only write_staff_act writes a staff character's Act; no player can act as one ----
do $$
declare
  ann uuid := tests.account('staff-acts');
  mask uuid := tests.character(ann, 'Staff Acts Mask');
  boss uuid;
  t uuid := tests.thread('Staff acts');
  mine uuid;
  theirs uuid;
  written jsonb;
  said text;
  stmt text;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Acts Boss', 'acts-boss', 'boss', now()) returning id into boss;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Acts Bot', 'acts-bot', 'bot', now());
  mine := tests.post(mask, t, 'A player''s post.');

  -- The poison: an Act naming a staff character, written by any other path, is refused.
  begin perform tests.post(boss, t, 'Forged.'); raise exception 'an Act naming a staff character was written';
  exception when sqlstate '42501' then null; end;
  begin perform tests.act(boss, 'spin', t, '{}', mine); raise exception 'a spin naming a staff character was written';
  exception when sqlstate '42501' then null; end;

  -- write_staff_act posts as it, and only the service role can call it.
  perform tests.become_service();
  written := write_staff_act('acts-boss', 'post', t, null, '{"body": "It is decided."}');
  perform tests.unbecome();
  if written is null then raise exception 'write_staff_act returned nothing'; end if;
  select id into theirs from acts where character = boss and kind = 'post';
  if theirs is null or (select payload ->> 'body' from acts where id = theirs) is distinct from 'It is decided.' or (select seq from acts where id = theirs) is null then
    raise exception 'write_staff_act did not post as the staff character';
  end if;
  -- The writer takes the table's own rules with it.
  perform tests.become_service();
  perform write_staff_act('acts-bot', 'post', t, mine, '{"body": "Noted."}');
  perform write_staff_act('acts-boss', 'edit', t, theirs, '{"body": "It is decided, again."}');
  begin perform write_staff_act('acts-boss', 'edit', t, mine, '{"body": "Not yours."}'); raise exception 'a staff character edited a player''s post';
  exception when sqlstate '23514' then null; end;
  begin perform write_staff_act('acts-boss', 'unmask', t, null, '{}'); raise exception 'a staff character unmasked';
  exception when invalid_parameter_value then null; end;
  begin perform write_staff_act('acts-boss', 'tally', t, null, '{}'); raise exception 'a staff character wrote a tally';
  exception when invalid_parameter_value then null; end;
  begin perform write_staff_act('nobody-at-all', 'post', t, null, '{"body": "x"}'); raise exception 'an unknown staff key wrote';
  exception when sqlstate 'P0002' then null; end;
  begin perform write_staff_act('acts-boss', 'post', t, null, '[]'); raise exception 'a payload that is no object was written';
  exception when invalid_parameter_value then null; end;
  perform tests.unbecome();

  -- It does not stay open: the transaction's next Act naming a staff character is refused again.
  begin perform tests.post(boss, t, 'Forged after.'); raise exception 'write_staff_act left the door open';
  exception when sqlstate '42501' then null; end;

  foreach said in array array['anon', 'authenticated'] loop
    perform set_config('role', said, true);
    begin perform write_staff_act('acts-boss', 'post', t, null, '{"body": "x"}'); raise exception '% called write_staff_act', said;
    exception when insufficient_privilege then null; end;
    perform tests.unbecome();
  end loop;

  -- No player can post, edit, spin, react, start a thread or unmask as it, whatever they say.
  perform tests.become(ann);
  foreach stmt in array array[
    format('select post(%L, %L, %L)', t, boss, 'As the Boss.'),
    format('select post(%L, %L, %L)', t, (select id from characters where staff = 'acts-bot'), 'As the Bot.'),
    format('select edit_post(%L, %L, %L)', theirs, boss, 'Edited.'),
    format('select spin(%L, %L, %L, %L)', theirs, boss, 'A spin', 'Body.'),
    format('select start_thread(%L, %L, %L, %L)', 'general', boss, 'A thread', 'Body.'),
    format('select react(%L, %L, %L)', mine, boss, 'up'),
    format('select unmask(%L, %L)', boss, t),
    format('select turn(%L, %L, %L)', boss, 'beta', 'x')] loop
    said := null;
    begin execute stmt; exception when others then said := sqlstate; end;
    if said is distinct from '42501' then raise exception 'a player acted as a staff character (%): %', stmt, coalesce(said, 'no refusal'); end if;
  end loop;
  perform tests.unbecome();
  -- Nor can the service play a card through it on a player's behalf.
  perform tests.become_service();
  said := null;
  begin perform play_card(ann, 'sweetie', boss, mine, '{}', 100, ''); exception when others then said := sqlstate; end;
  perform tests.unbecome();
  if said is distinct from '42501' then raise exception 'a card was played as a staff character: %', coalesce(said, 'no refusal'); end if;
  -- A null player is no match for a staff character's null owner.
  begin perform played_by(boss, null); raise exception 'played_by took a null player for a staff character';
  exception when sqlstate '42501' then null; end;
end $$;

-- ---- A reaction to a staff character's Act is tallied and pays nobody ----
do $$
declare
  ann uuid := tests.account('staff-pay');
  bob uuid := tests.account('staff-pay-b');
  a uuid := tests.character(ann, 'Pay Ann', 'alpha', '2000-01-02');
  b uuid := tests.character(bob, 'Pay Bob', 'beta', '2000-01-02');
  boss uuid;
  -- The window the next settlement reads: another file's settlement may have moved it, so the Acts are written inside it.
  s timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  t uuid := tests.thread('Staff pay');
  spun uuid;
  own uuid := tests.post(a, t, 'Ann earns for this.', s + interval '30 minutes');
  decree uuid;
  card uuid;
  spin uuid;
  staff_reply uuid;
  input jsonb;
  est jsonb;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Pay Boss', 'pay-boss', 'boss', now()) returning id into boss;
  -- The Boss's decree, written at a time inside the window as write_staff_act would write it at that time.
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at) values (boss, 'post', t, '{"body": "A decree."}', s + interval '1 hour') returning id into decree;
  perform set_config('kayfabb.staff_writer', '', true);
  -- A reaction and a card on the decree, a spin from it, and a staff reply and Bob's in the spun thread.
  perform tests.become(bob);
  perform react(decree, b, 'up');
  perform react(own, b, 'up');
  perform tests.unbecome();
  update reactions set created_at = s + interval '2 hours';
  card := tests.act(b, 'card', t, '{"card": "sweetie"}', decree, s + interval '3 hours');
  insert into threads (board, title, origin_act_id) select board, 'Spun from the decree', decree from threads where id = t returning id into spun;
  spin := tests.act(a, 'spin', spun, '{"title": "Spun from the decree"}', decree, s + interval '4 hours');
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at) values (boss, 'post', spun, '{"body": "The Boss replies."}', s + interval '5 hours') returning id into staff_reply;
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.post(b, spun, 'Bob replies.', s + interval '6 hours');

  if not exists (select 1 from reaction_tallies where act = decree and kind = 'up' and count = 1) then raise exception 'a reaction to a staff Act is not tallied'; end if;

  input := settlement_input(s, s + interval '1 day');
  if exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'character' = boss::text or x ->> 'id' in (decree::text, staff_reply::text)) then raise exception 'a staff character''s Act is in what earns: %', input -> 'acts'; end if;
  if exists (select 1 from jsonb_array_elements(input -> 'characters') x where x ->> 'id' = boss::text) then raise exception 'a staff character is among the settlement''s characters'; end if;
  if not (input -> 'systemActs') @> to_jsonb(decree::text) then raise exception 'the staff Act is not named a System Act: %', input -> 'systemActs'; end if;
  if not exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'id' = own::text) then raise exception 'an ordinary Act should still be settled'; end if;
  if not exists (select 1 from jsonb_array_elements(input -> 'reactions') x where x ->> 'act' = decree::text) then raise exception 'the reaction to the decree should be in the input, for settle.ts to drop'; end if;
  if exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'id' = card::text) then raise exception 'a card on a staff Act is in what earns (settle.ts could not find its target): %', input -> 'acts'; end if;
  if not (input -> 'systemActs') @> to_jsonb(card::text) then raise exception 'a card on a staff Act is not named a System Act, so a reaction to it would be settled'; end if;
  if not exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'id' = spin::text) then raise exception 'a spin from a staff Act should be settled (settle.ts reads it as from another)'; end if;

  -- The estimate reads the same, and hands the caller no reaction to an Act left out.
  est := estimate_input(bob, s + interval '1 day');
  if est is null then raise exception 'the estimate had no window'; end if;
  if exists (select 1 from jsonb_array_elements(est -> 'acts') x where x ->> 'id' in (decree::text, card::text, staff_reply::text) or x ->> 'character' = boss::text) then raise exception 'the estimate settles a staff Act or a card on one: %', est -> 'acts'; end if;
  if not (est -> 'systemActs') @> to_jsonb(decree::text) then raise exception 'the estimate does not name the staff Act a System Act: %', est -> 'systemActs'; end if;
  if exists (select 1 from jsonb_array_elements(est -> 'reactions') x where x ->> 'act' = decree::text) then raise exception 'the estimate hands over reactions to a staff Act'; end if;
  est := estimate_input(ann, s + interval '1 day');
  if exists (select 1 from jsonb_array_elements(est -> 'acts') x where x ->> 'id' = decree::text or x ->> 'character' = boss::text) then raise exception 'the estimate for the spinner settles a staff Act: %', est -> 'acts'; end if;

  -- No ledger row for a staff character, and no entry can name one: it has no player.
  begin perform apply_settlement(s, s + interval '1 day',
      jsonb_build_array(jsonb_build_object('player', ann, 'character', boss, 'reason', 'alpha.cheered', 'amount', 5)));
    raise exception 'an entry named a staff character';
  exception when sqlstate '22023' then null; end;
  perform apply_settlement(s, s + interval '1 day',
    jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 5)));
  if exists (select 1 from ledger where character = boss) then raise exception 'a staff character has a ledger row'; end if;
  if not exists (select 1 from ledger where character = a) then raise exception 'the ordinary entry was not written'; end if;
end $$;

-- ---- No standing, no reveal line, no count: a staff character is not in the game being scored ----
do $$
declare
  ann uuid := tests.account('staff-stand');
  a uuid := tests.character(ann, 'Stand Ann');
  boss uuid;
  before_count integer := (select coalesce(sum(characters), 0) from debuted_count);
  after_count integer;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Stand Boss', 'stand-boss', 'boss', now()) returning id into boss;
  select coalesce(sum(characters), 0) into after_count from debuted_count;
  if after_count <> before_count then raise exception 'a staff character was counted among the debuted characters'; end if;
  if exists (select 1 from standings where character = boss) then raise exception 'a staff character has a standing'; end if;
  if not exists (select 1 from standings where character = a) then raise exception 'a player''s character should have one'; end if;
  perform backfill_standings_roster();
  perform backfill_debuted_count();
  if exists (select 1 from standings where character = boss) or (select coalesce(sum(characters), 0) from debuted_count) is distinct from (select count(*) from characters where debuted_at is not null and staff is null) then
    raise exception 'a backfill counted or ranked a staff character';
  end if;
  -- The season's reveal names none.
  if reveal_season('2100-01-01T00:00:00Z') is null then raise exception 'the season did not reveal'; end if;
  if exists (select 1 from acts where kind = 'reveal' and payload ->> 'character' = boss::text) then raise exception 'the reveal names a staff character'; end if;
  if (select (payload ->> 'characters')::integer from acts where kind = 'reveal' and character is null and payload ? 'body') is distinct from (select count(*)::integer from characters where debuted_at < '2100-01-01' and staff is null) then
    raise exception 'the reveal counts a staff character';
  end if;
  -- And the season it opens has no row for it.
  if exists (select 1 from standings where character = boss) then raise exception 'the next season''s roster holds a staff character'; end if;
end $$;

-- ---- What a staff character shows, publicly ----
do $$
declare
  ann uuid := tests.account('staff-public');
  seen record;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Public Boss', 'public-boss', 'boss', now());
  insert into characters (name, staff, staff_kind) values ('Waiting Bot', 'waiting-bot', 'bot');
  perform tests.character(ann, 'Plain Mask');
  perform tests.become(ann);
  select staff, staff_kind into seen from characters_public where name = 'Public Boss';
  if seen.staff is distinct from 'public-boss' or seen.staff_kind is distinct from 'boss' then raise exception 'characters_public should name a staff character''s key and kind'; end if;
  if exists (select 1 from characters_public where name = 'Waiting Bot') then raise exception 'a staff character that has not debuted is listed'; end if;
  if (select staff from characters_public where name = 'Plain Mask') is not null then raise exception 'a player''s character shows a staff key'; end if;
  if exists (select 1 from characters where staff is not null) then raise exception 'a player read a staff character''s row directly'; end if;
  perform tests.unbecome();
end $$;

-- ---- The season names its Boss ----
do $$
declare
  ann uuid := tests.account('staff-boss');
  got text;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Season Boss', 'season-boss', 'boss', now());
  perform tests.become_service();
  if current_boss() is not null then raise exception 'a season with no Boss has one: %', current_boss(); end if;
  perform tests.unbecome();
  begin update seasons set boss = 'nobody-at-all' where ends_at is null; raise exception 'a season named a Boss who is no staff character';
  exception when foreign_key_violation then null; end;
  update seasons set boss = 'season-boss' where ends_at is null;
  perform tests.become_service();
  got := current_boss();
  perform tests.unbecome();
  if got is distinct from 'season-boss' then raise exception 'current_boss() should be the open season''s Boss: %', got; end if;
  perform tests.become(ann);
  begin perform current_boss(); raise exception 'a player called current_boss()'; exception when insufficient_privilege then null; end;
  perform tests.unbecome();
end $$;

-- ---- An admin restoring a retired staff character: it has no roster to fill ----
do $$
declare
  admin uuid := tests.account('staff-admin');
  boss uuid;
begin
  insert into admins (account) values (admin);
  insert into characters (name, staff, staff_kind, debuted_at) values ('Retired Boss', 'retired-boss', 'boss', now()) returning id into boss;
  perform tests.become(admin);
  perform retire_character(boss);
  perform restore_character(boss);
  perform tests.unbecome();
  if (select retired_at from characters where id = boss) is not null then raise exception 'a retired staff character was not restored'; end if;
end $$;
