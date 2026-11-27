-- Event rarity, named items and event-only items (supabase/migrations/0453_event_rarity.sql; docs/plans/2026-11-26-event-rarity-plan.md, Task 3).
-- The gear, cards, lines and accounts are this file's own (ev-...). A roll is the service role's, for a character the caller plays; this file resets the window before each roll so a loop of rolls is a loop of draws.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The cosmetics setting with the given event rules; a null event_rarity leaves `eventRarity` out, as a database migrated and not yet re-seeded has it.
create function pg_temp.cfg(outcomes jsonb, gear jsonb, card jsonb, event_rarity jsonb) returns void language plpgsql as $$
begin
  insert into settings (key, value) values ('cosmetics', jsonb_build_object('gear', jsonb_build_object('wornMost', 3, 'reach', 0.4), 'trophies', jsonb_build_object('shownMost', 3),
    'events', jsonb_build_object('windowMinutes', 1, 'dayMost', 100000, 'outcomes', outcomes, 'gearRarity', gear, 'cardRarity', card)
      || case when event_rarity is null then '{}'::jsonb else jsonb_build_object('eventRarity', event_rarity) end))
  on conflict (key) do update set value = excluded.value;
end $$;

-- A roll with the window already passed, as the service role, back to the test's own role to read what it wrote.
create function pg_temp.roll(who uuid, through uuid) returns jsonb language plpgsql as $$
declare got jsonb;
begin
  update random_event_rolls set rolled_at = now() - interval '2 minutes' where account = who;
  got := random_event(who, through);
  perform tests.unbecome();
  return got;
end $$;

-- A fresh set of lines: (key, outcome, rarity, item).
create function pg_temp.lines(rows jsonb) returns void language plpgsql as $$
begin
  delete from event_lines;
  insert into event_lines (key, outcome, text, rarity, item)
  select e ->> 'key', e ->> 'outcome', 'Text of ' || (e ->> 'key') || '.', coalesce(e ->> 'rarity', 'common'), e ->> 'item' from jsonb_array_elements(rows) e;
end $$;

select tests.unbecome();
insert into gear_kinds (key, rarity) values ('ev-cap', 'common'), ('ev-crown', 'rare');
insert into gear_kinds (key, rarity, event_only) values ('ev-relic', 'legendary', true), ('ev-dust', 'common', true);
insert into card_kinds (key, name, alignment, rarity) values ('ev-card-ok', 'Ev Ok', 'sweet', 'legendary'), ('ev-card-old', 'Ev Old', 'sweet', 'legendary');
insert into card_kinds (key, name, alignment, rarity, event_only) values ('ev-card-only', 'Ev Only', 'salty', 'legendary', true);
update card_kinds set retired_at = now() where key = 'ev-card-old';

-- ---- The columns ----
do $$
declare ann uuid := tests.account('ev-ann'); a1 uuid := tests.character(ann, 'Ev Ann One');
begin
  insert into event_lines (key, outcome, text) values ('ev-default', 'gear', 'Default.');
  if (select rarity from event_lines where key = 'ev-default') is distinct from 'common' or (select item from event_lines where key = 'ev-default') is not null then raise exception 'a line is common and names no item unless it says'; end if;
  if pg_temp.refusal($q$insert into event_lines (key, outcome, text, rarity) values ('ev-x', 'gear', 'x', 'mythic')$q$) is null then raise exception 'a line of a rarity outside the four'; end if;
  if pg_temp.refusal($q$insert into event_lines (key, outcome, text, item) values ('ev-x', 'line', 'x', 'ev-cap')$q$) is null then raise exception 'a line event naming an item'; end if;
  if pg_temp.refusal($q$insert into event_lines (key, outcome, text, item, rarity) values ('ev-x', 'gear', 'x', 'ev-cap', 'rare')$q$) is not null then raise exception 'a gear event may name an item'; end if;
  if (select event_only from gear_kinds where key = 'ev-cap') is distinct from false or (select event_only from card_kinds where key = 'ev-card-ok') is distinct from false then raise exception 'event_only defaults to false'; end if;
  insert into random_events (account, character, outcome, item, line, line_text) values (ann, a1, 'gear', 'ev-cap', 'ev-default', 'Default.');
  if (select rarity from random_events where account = ann) is distinct from 'common' then raise exception 'an event row is common by default'; end if;
  if pg_temp.refusal(format($q$insert into random_events (account, character, outcome, item, line, line_text, rarity) values (%L, %L, 'gear', 'ev-cap', 'ev-default', 'Default.', 'mythic')$q$, ann, a1)) is null then raise exception 'an event of a rarity outside the four'; end if;
  insert into random_events (account, character, outcome, item, line, line_text, rarity) values (ann, a1, 'gear', 'ev-cap', 'ev-default', 'Default.', 'rare');
  if (select count(*) from random_events where account = ann and rarity = 'rare') is distinct from 1 then raise exception 'an event row keeps its rarity'; end if;
  delete from event_lines;
end $$;

-- ---- The pool leaves an event-only item out, for the draw and the pack ----
do $$
begin
  if exists (select 1 from draw_pool('gear', '{}', true) where key in ('ev-relic', 'ev-dust')) then raise exception 'the gear pool holds an event-only piece'; end if;
  if not exists (select 1 from draw_pool('gear', '{}', true) where key = 'ev-cap') then raise exception 'the gear pool lost a piece that is not event-only'; end if;
  if exists (select 1 from draw_pool('card', '{}', true) where key = 'ev-card-only') then raise exception 'the card pool holds an event-only card'; end if;
  if not exists (select 1 from draw_pool('card', '{}', true) where key = 'ev-card-ok') then raise exception 'the card pool lost a card that is not event-only'; end if;
  -- Every legendary card but ev-card-only is left out, so a pack pulling a legendary has nothing to give.
  if pg_temp.refusal($q$select roll_pack('[{"weights":{"legendary":1}}]', (select array_agg(key) from card_kinds where key not like 'ev-%') || array['ev-card-ok', 'ev-card-old'])$q$) is distinct from 'this pack has no legendary card to give' then
    raise exception 'a pack rolled an event-only card: %', pg_temp.refusal($q$select roll_pack('[{"weights":{"legendary":1}}]', (select array_agg(key) from card_kinds where key not like 'ev-%') || array['ev-card-ok', 'ev-card-old'])$q$);
  end if;
  for i in 1..60 loop
    if roll_pack('[{"weights":{"legendary":1}}]', (select array_agg(key) from card_kinds where key not like 'ev-%') || array['ev-card-old']) is distinct from array['ev-card-ok'] then raise exception 'a pack pulled something but the one legendary card that is not event-only'; end if;
  end loop;
end $$;

-- ---- The roll: the event's rarity first ----
do $$
declare
  bea uuid := tests.account('ev-bea'); b1 uuid := tests.character(bea, 'Ev Bea One');
  got jsonb; ev uuid;
begin
  perform tests.unbecome();
  perform pg_temp.cfg('{"line": 1, "gear": 1000000000, "card": 1}', '{"common": 1, "rare": 1}', '{"legendary": 1}', '{"common": 1, "rare": 1000000000}');
  perform pg_temp.lines('[{"key":"ev-g-common","outcome":"gear"},{"key":"ev-g-rare","outcome":"gear","rarity":"rare"}]');
  perform setseed(0.5);
  for i in 1..10 loop
    got := pg_temp.roll(bea, b1);
    if got ->> 'eventRarity' is distinct from 'rare' or got ->> 'lineKey' is distinct from 'ev-g-rare' then raise exception 'a rare event is weighed a billion to one and was not rolled: %', got; end if;
    ev := (got ->> 'event')::uuid;
    if (select rarity from random_events where id = ev) is distinct from 'rare' then raise exception 'the event row keeps its event''s rarity'; end if;
  end loop;
  -- The weight, not the existence, decides: with the weights the other way round the common line comes.
  perform pg_temp.cfg('{"line": 1, "gear": 1000000000, "card": 1}', '{"common": 1, "rare": 1}', '{"legendary": 1}', '{"common": 1000000000, "rare": 1}');
  got := pg_temp.roll(bea, b1);
  if got ->> 'eventRarity' is distinct from 'common' or (select rarity from random_events where id = (got ->> 'event')::uuid) is distinct from 'common' then raise exception 'a common event: %', got; end if;
end $$;

-- ---- An event that names its item gives it ----
do $$
declare
  cal uuid := tests.account('ev-cal'); c1 uuid := tests.character(cal, 'Ev Cal One');
  got jsonb; ev uuid;
begin
  perform tests.unbecome();
  -- Gear weighed at common alone, and an event-only legendary piece named by a legendary event.
  perform pg_temp.cfg('{"line": 1, "gear": 1000000000, "card": 1}', '{"common": 1}', '{"legendary": 1}', '{"legendary": 1}');
  perform pg_temp.lines('[{"key":"ev-g-relic","outcome":"gear","rarity":"legendary","item":"ev-relic"}]');
  got := pg_temp.roll(cal, c1);
  if got ->> 'item' is distinct from 'ev-relic' or got ->> 'rarity' is distinct from 'legendary' or got ->> 'eventRarity' is distinct from 'legendary' or got ->> 'lineKey' is distinct from 'ev-g-relic' then raise exception 'a named event-only piece: %', got; end if;
  ev := (got ->> 'event')::uuid;
  if (select count(*) from gear_ledger where account = cal and kind = 'found' and event = ev and gear = 'ev-relic') is distinct from 1 then raise exception 'the found row names the item: %', (select jsonb_agg(l) from gear_ledger l where account = cal); end if;
  if (select item from random_events where id = ev) is distinct from 'ev-relic' then raise exception 'the event row names the item'; end if;
  -- A rare event naming a common piece: the answer's rarity is the item's, its eventRarity the event's.
  perform pg_temp.cfg('{"line": 1, "gear": 1000000000, "card": 1}', '{"legendary": 1}', '{"legendary": 1}', '{"rare": 1}');
  perform pg_temp.lines('[{"key":"ev-g-cap","outcome":"gear","rarity":"rare","item":"ev-cap"}]');
  got := pg_temp.roll(cal, c1);
  if got ->> 'item' is distinct from 'ev-cap' or got ->> 'rarity' is distinct from 'common' or got ->> 'eventRarity' is distinct from 'rare' then raise exception 'a rare event naming a common piece: %', got; end if;
  -- A card event naming an event-only card gives it, and the found row names the event.
  perform pg_temp.cfg('{"line": 1, "gear": 1, "card": 1000000000}', '{"common": 1}', '{"common": 1}', '{"legendary": 1}');
  perform pg_temp.lines('[{"key":"ev-c-only","outcome":"card","rarity":"legendary","item":"ev-card-only"}]');
  got := pg_temp.roll(cal, c1);
  if got ->> 'item' is distinct from 'ev-card-only' or got ->> 'eventRarity' is distinct from 'legendary' then raise exception 'a named event-only card: %', got; end if;
  if (select count(*) from card_ledger where account = cal and kind = 'found' and event = (got ->> 'event')::uuid and card = 'ev-card-only') is distinct from 1 then raise exception 'the found card row names the item'; end if;
end $$;

-- ---- An event-only piece is never given by an event that names no item ----
do $$
declare
  dee uuid := tests.account('ev-dee'); d1 uuid := tests.character(dee, 'Ev Dee One');
  got jsonb; saw_cap boolean := false; before bigint;
begin
  perform tests.unbecome();
  perform pg_temp.cfg('{"line": 1, "gear": 1000000000, "card": 1}', '{"common": 1, "rare": 1, "legendary": 1}', '{"legendary": 1}', '{"common": 1}');
  perform pg_temp.lines('[{"key":"ev-g-any","outcome":"gear"}]');
  perform setseed(0.25);
  for i in 1..80 loop
    got := pg_temp.roll(dee, d1);
    if got ->> 'item' in ('ev-relic', 'ev-dust') then raise exception 'an event naming no item gave an event-only piece: %', got; end if;
    if got ->> 'item' = 'ev-cap' then saw_cap := true; end if;
  end loop;
  if not saw_cap then raise exception 'the draw never gave the common cap in 80 rolls'; end if;
  -- With only event-only gear at the weighted rarity, the roll finds nothing: the window is stamped and nothing is written.
  perform pg_temp.cfg('{"line": 1, "gear": 1000000000, "card": 1}', '{"legendary": 1}', '{"legendary": 1}', '{"common": 1}');
  select count(*) into before from random_events where account = dee;
  got := pg_temp.roll(dee, d1);
  if got is not null then raise exception 'a gear event with nothing to give answered %', got; end if;
  if (select rolled_at from random_event_rolls where account = dee) < now() - interval '1 minute' then raise exception 'the window stays stamped'; end if;
  if (select count(*) from random_events where account = dee) is distinct from before then raise exception 'nothing is written'; end if;
end $$;

-- ---- A named card that is out of print is not eligible; a rarity with nothing eligible is skipped ----
do $$
declare
  eli uuid := tests.account('ev-eli'); e1 uuid := tests.character(eli, 'Ev Eli One');
  got jsonb; stamped timestamptz;
begin
  perform tests.unbecome();
  perform pg_temp.cfg('{"line": 1, "gear": 1, "card": 1000000000}', '{"common": 1}', '{"legendary": 1}', '{"common": 1}');
  perform pg_temp.lines('[{"key":"ev-c-old","outcome":"card","item":"ev-card-old"}]');
  got := pg_temp.roll(eli, e1);
  if got is not null then raise exception 'an event naming a retired card answered %', got; end if;
  select rolled_at into stamped from random_event_rolls where account = eli;
  if stamped is null or stamped < now() - interval '1 minute' then raise exception 'the window is stamped'; end if;
  if (select count(*) from random_events where account = eli) is distinct from 0 or (select count(*) from card_ledger where account = eli) is distinct from 0 then raise exception 'nothing is written'; end if;
  -- A card gone from the game is not eligible either.
  update card_kinds set retired_at = null, became = 'ev-card-ok', gone_at = now() where key = 'ev-card-old';
  if pg_temp.roll(eli, e1) is not null then raise exception 'an event naming a gone card answered'; end if;
  update card_kinds set gone_at = null, became = null, retired_at = now() where key = 'ev-card-old';
  -- A rare event that cannot be given never hides a common one that can.
  perform pg_temp.cfg('{"line": 1, "gear": 1, "card": 1000000000}', '{"common": 1}', '{"legendary": 1}', '{"common": 1, "rare": 1000000000}');
  perform pg_temp.lines('[{"key":"ev-c-old","outcome":"card","rarity":"rare","item":"ev-card-old"},{"key":"ev-c-ok","outcome":"card","item":"ev-card-ok"}]');
  for i in 1..10 loop
    got := pg_temp.roll(eli, e1);
    if got is null or got ->> 'lineKey' is distinct from 'ev-c-ok' or got ->> 'eventRarity' is distinct from 'common' then raise exception 'a rarity with nothing eligible was not skipped: %', got; end if;
  end loop;
  -- A card event naming no item is eligible only when the card pool has something at a weighted rarity (here only an event-only legendary).
  perform pg_temp.cfg('{"line": 1, "gear": 1, "card": 1000000000}', '{"common": 1}', '{"legendary": 1}', '{"common": 1, "rare": 1000000000}');
  perform pg_temp.lines('[{"key":"ev-c-any","outcome":"card","rarity":"rare"},{"key":"ev-c-ok","outcome":"card","item":"ev-card-ok"}]');
  update card_kinds set rarity = 'common' where key = 'ev-card-ok';
  got := pg_temp.roll(eli, e1);
  if got is null or got ->> 'lineKey' is distinct from 'ev-c-ok' then raise exception 'a rare card event with no card to give was rolled: %', got; end if;
  update card_kinds set rarity = 'legendary' where key = 'ev-card-ok';
end $$;

-- ---- A database not yet re-seeded: no eventRarity, every line common ----
do $$
declare
  fay uuid := tests.account('ev-fay'); f1 uuid := tests.character(fay, 'Ev Fay One');
  got jsonb;
begin
  perform tests.unbecome();
  perform pg_temp.cfg('{"line": 1000000000, "gear": 1, "card": 1}', '{"common": 1}', '{"legendary": 1}', null);
  perform pg_temp.lines('[{"key":"ev-l-1","outcome":"line"},{"key":"ev-l-2","outcome":"line"}]');
  for i in 1..10 loop
    got := pg_temp.roll(fay, f1);
    if got is null or got ->> 'outcome' is distinct from 'line' or got ->> 'eventRarity' is distinct from 'common' or got ->> 'item' is not null then raise exception 'a setting with no eventRarity rolls every event as common: %', got; end if;
  end loop;
  if (select count(*) from random_events where account = fay and rarity = 'common') is distinct from 10 then raise exception 'the rows are common'; end if;
  -- Both lines come up over many rolls (a line is drawn uniformly by key, as before).
  if (select count(distinct line) from random_events where account = fay) < 2 then raise exception 'the lines were not both drawn in 10 rolls (a 1 in 512 chance)'; end if;
end $$;

-- ---- The pool reads the instance's lines and items, no account's rows ----
do $$
begin
  if exists (select 1 from pg_proc p where p.proname = 'event_pool' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) then raise exception 'event_pool is a client''s'; end if;
end $$;

-- ---- The seed: rarity, item and event-only travel; a bad line is refused naming it (last, since a seed removes the lines it does not name) ----
select tests.unbecome();
create function pg_temp.err(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
do $$
declare
  base jsonb := jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb);
  gear jsonb := '[{"key":"sd-cap","rarity":"common"},{"key":"sd-crown","rarity":"rare","eventOnly":true}]';
  cards jsonb := '[{"key":"sd-card","name":"Sd Card","alignment":"sweet","rarity":"uncommon","eventOnly":true}]';
  said text;
begin
  perform seed_instance(base || jsonb_build_object('gear', gear, 'cards', cards, 'eventLines', jsonb_build_array(
    jsonb_build_object('key', 'sd-plain', 'outcome', 'gear', 'text', 'Plain.'),
    jsonb_build_object('key', 'sd-crown', 'outcome', 'gear', 'text', 'The crown.', 'rarity', 'rare', 'item', 'sd-crown'),
    jsonb_build_object('key', 'sd-hi', 'outcome', 'gear', 'text', 'A rare cap.', 'rarity', 'legendary', 'item', 'sd-cap'),
    jsonb_build_object('key', 'sd-card', 'outcome', 'card', 'text', 'The card.', 'rarity', 'uncommon', 'item', 'sd-card'))));
  if (select string_agg(key || ':' || rarity || ':' || coalesce(item, '-'), ',' order by key) from event_lines) is distinct from 'sd-card:uncommon:sd-card,sd-crown:rare:sd-crown,sd-hi:legendary:sd-cap,sd-plain:common:-' then
    raise exception 'a seed writes rarity and item: %', (select jsonb_agg(l) from event_lines l);
  end if;
  if (select event_only from gear_kinds where key = 'sd-crown') is distinct from true or (select event_only from gear_kinds where key = 'sd-cap') is distinct from false or (select event_only from card_kinds where key = 'sd-card') is distinct from true then
    raise exception 'a seed writes event_only';
  end if;
  -- An event naming no gear, naming no card, or less rare than its item is refused, and the message names the line.
  said := pg_temp.err(format('select seed_instance(%L::jsonb)', (base || jsonb_build_object('eventLines', jsonb_build_array(jsonb_build_object('key', 'sd-bad-gear', 'outcome', 'gear', 'text', 'x', 'item', 'sd-nope'))))::text));
  if said is null or said not like '22023:%' or position('sd-bad-gear' in said) = 0 then raise exception 'an event naming no gear: %', said; end if;
  said := pg_temp.err(format('select seed_instance(%L::jsonb)', (base || jsonb_build_object('eventLines', jsonb_build_array(jsonb_build_object('key', 'sd-bad-card', 'outcome', 'card', 'text', 'x', 'item', 'sd-cap'))))::text));
  if said is null or said not like '22023:%' or position('sd-bad-card' in said) = 0 then raise exception 'a card event naming gear: %', said; end if;
  said := pg_temp.err(format('select seed_instance(%L::jsonb)', (base || jsonb_build_object('eventLines', jsonb_build_array(jsonb_build_object('key', 'sd-bad-gear2', 'outcome', 'gear', 'text', 'x', 'item', 'sd-card'))))::text));
  if said is null or said not like '22023:%' or position('sd-bad-gear2' in said) = 0 then raise exception 'a gear event naming a card: %', said; end if;
  said := pg_temp.err(format('select seed_instance(%L::jsonb)', (base || jsonb_build_object('eventLines', jsonb_build_array(jsonb_build_object('key', 'sd-too-common', 'outcome', 'gear', 'text', 'x', 'rarity', 'common', 'item', 'sd-crown'))))::text));
  if said is null or said not like '22023:%' or position('sd-too-common' in said) = 0 then raise exception 'an event less rare than its item: %', said; end if;
  -- A re-seed that takes eventOnly off clears the column, and a line that says no rarity is common again.
  perform seed_instance(base || jsonb_build_object('gear', '[{"key":"sd-cap","rarity":"common"},{"key":"sd-crown","rarity":"rare"}]'::jsonb, 'cards', '[{"key":"sd-card","name":"Sd Card","alignment":"sweet","rarity":"uncommon"}]'::jsonb,
    'eventLines', jsonb_build_array(jsonb_build_object('key', 'sd-plain', 'outcome', 'gear', 'text', 'Plain.'), jsonb_build_object('key', 'sd-crown', 'outcome', 'gear', 'text', 'The crown.', 'rarity', 'rare', 'item', 'sd-crown'))));
  if exists (select 1 from gear_kinds where key like 'sd-%' and event_only) or exists (select 1 from card_kinds where key like 'sd-%' and event_only) then raise exception 'a re-seed clears event_only'; end if;
  perform seed_instance(base || jsonb_build_object('eventLines', jsonb_build_array(jsonb_build_object('key', 'sd-crown', 'outcome', 'gear', 'text', 'The crown.', 'item', 'sd-cap'))));
  if (select rarity || ':' || item from event_lines where key = 'sd-crown') is distinct from 'common:sd-cap' then raise exception 'a re-seed rewrites rarity and item: %', (select jsonb_agg(l) from event_lines l); end if;
end $$;
