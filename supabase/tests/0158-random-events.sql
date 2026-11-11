-- Random Events and the shared draw (supabase/migrations/0152_random_events.sql; the cosmetics plan, Task 4). The gear, cards and lines are this file's own (te-...).
-- A roll is the service role's, for a character the caller plays; its window is read from the last roll, never the last event.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
declare hint text; msg text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics hint = pg_exception_hint;
  msg := sqlerrm;
  if hint is distinct from 'kayfabb.refusal' then return 'NOT A REFUSAL (' || coalesce(hint, 'no hint') || '): ' || msg; end if;
  return msg;
end $$;

-- The cosmetics setting with the given event rules (the other fields are 0156's).
create function pg_temp.events(window_minutes integer, day_most integer, outcomes jsonb) returns void language plpgsql as $$
begin
  insert into settings (key, value) values ('cosmetics', jsonb_build_object('gear', jsonb_build_object('wornMost', 3, 'reach', 0.4), 'trophies', jsonb_build_object('shownMost', 3),
    'events', jsonb_build_object('windowMinutes', window_minutes, 'dayMost', day_most, 'outcomes', outcomes,
      'gearRarity', jsonb_build_object('common', 1, 'uncommon', 1, 'rare', 1, 'legendary', 1), 'cardRarity', jsonb_build_object('common', 1, 'uncommon', 1, 'rare', 1, 'legendary', 1))))
  on conflict (key) do update set value = excluded.value;
end $$;

-- A roll as the service role, back to the test's own role to read what it wrote.
create function pg_temp.roll(who uuid, through uuid) returns jsonb language plpgsql as $$
declare got jsonb;
begin
  got := random_event(who, through);
  perform tests.unbecome();
  return got;
end $$;

select tests.unbecome();
insert into gear_kinds (key, rarity) values ('te-hat', 'common'), ('te-cape', 'legendary');
insert into card_kinds (key, name, alignment, rarity) values
  ('te-c1', 'C1', 'sweet', 'common'), ('te-c2', 'C2', 'sweet', 'common'), ('te-c3', 'C3', 'sweet', 'common'),
  ('te-u1', 'U1', 'salty', 'uncommon'), ('te-u2', 'U2', 'salty', 'uncommon'), ('te-r1', 'R1', 'salty', 'rare');
insert into event_lines (key, outcome, text) values ('te-line-1', 'line', 'A line.'), ('te-line-2', 'line', 'Another line.'), ('te-gear-1', 'gear', 'A gear line.'), ('te-card-1', 'card', 'A card line.');

-- ---- The window is the last roll, whatever it drew ----
do $$
declare
  ann uuid := tests.account('te-ann'); a1 uuid := tests.character(ann, 'Te Ann One');
  got jsonb; first_roll timestamptz;
begin
  perform pg_temp.events(15, 100, '{"line": 1, "gear": 1, "card": 1, "none": 1000000000}');
  perform setseed(0.5);
  got := pg_temp.roll(ann, a1);
  if got is not null then raise exception 'a roll of none drew %', got; end if;
  select rolled_at into first_roll from random_event_rolls where account = ann;
  if first_roll is null then raise exception 'a roll that drew nothing still stamps the account'; end if;
  if (select count(*) from random_events where account = ann) is distinct from 0 then raise exception 'a roll of none wrote an event'; end if;
  -- The very next call would draw an event, but the window the first roll opened is still open.
  perform tests.unbecome();
  perform pg_temp.events(15, 100, '{"line": 1, "gear": 1, "card": 1}');
  got := pg_temp.roll(ann, a1);
  if got is not null then raise exception 'a second call in the window answered %', got; end if;
  if (select count(*) from random_events where account = ann) is distinct from 0 or (select rolled_at from random_event_rolls where account = ann) is distinct from first_roll then
    raise exception 'a refused second call wrote or restamped';
  end if;
  -- Once the window has passed, the roll draws.
  update random_event_rolls set rolled_at = now() - interval '16 minutes' where account = ann;
  got := pg_temp.roll(ann, a1);
  if got is null or (select count(*) from random_events where account = ann) is distinct from 1 then raise exception 'a roll after the window drew nothing: %', got; end if;
  if got ->> 'character' is distinct from a1::text or got ->> 'event' is null or got ->> 'outcome' is null then raise exception 'the answer: %', got; end if;
end $$;

-- ---- dayMost: the third event in a day is not drawn, though the window has passed ----
do $$
declare
  bob uuid := tests.account('te-bob'); b1 uuid := tests.character(bob, 'Te Bob One');
  got jsonb;
begin
  perform pg_temp.events(1, 2, '{"line": 1000000000, "gear": 1, "card": 1}');
  -- An event 25 hours old does not count toward the day.
  insert into random_events (account, character, at, outcome, line) values (bob, b1, now() - interval '25 hours', 'line', 'te-line-1');
  perform setseed(0.5);
  if pg_temp.roll(bob, b1) is null then raise exception 'the first roll of the day'; end if;
  update random_event_rolls set rolled_at = now() - interval '2 minutes' where account = bob;
  if pg_temp.roll(bob, b1) is null then raise exception 'the second roll of the day'; end if;
  update random_event_rolls set rolled_at = now() - interval '2 minutes' where account = bob;
  got := pg_temp.roll(bob, b1);
  if got is not null or (select count(*) from random_events where account = bob) is distinct from 3 then raise exception 'the third event in a day: %', got; end if;
end $$;

-- ---- A gear event writes one found row, counted by gear_held; a card event adds to card_held ----
do $$
declare
  cat uuid := tests.account('te-cat'); c1 uuid := tests.character(cat, 'Te Cat One');
  got jsonb; ev uuid;
begin
  perform tests.unbecome();
  perform pg_temp.events(1, 100, '{"line": 1, "gear": 1000000000, "card": 1}');
  perform setseed(0.5);
  got := pg_temp.roll(cat, c1);
  if got ->> 'outcome' is distinct from 'gear' then raise exception 'a gear roll drew %', got; end if;
  ev := (got ->> 'event')::uuid;
  if (select count(*) from gear_ledger where account = cat and kind = 'found' and event = ev and gear = got ->> 'item') is distinct from 1 or (select count(*) from gear_ledger where account = cat) is distinct from 1 then
    raise exception 'one found gear row naming the event: %', (select jsonb_agg(l) from gear_ledger l where account = cat);
  end if;
  if gear_held(cat, got ->> 'item') <> 1 then raise exception 'gear_held counts the found copy'; end if;
  if got ->> 'rarity' is distinct from (select rarity from gear_kinds where key = got ->> 'item') or got ->> 'line' is distinct from 'te-gear-1' then raise exception 'rarity and line: %', got; end if;
  if (select item from random_events where id = ev) is distinct from got ->> 'item' or (select character from random_events where id = ev) is distinct from c1 then raise exception 'the event row'; end if;
  update random_event_rolls set rolled_at = now() - interval '2 minutes' where account = cat;
  perform pg_temp.events(1, 100, '{"line": 1, "gear": 1, "card": 1000000000}');
  got := pg_temp.roll(cat, c1);
  if got ->> 'outcome' is distinct from 'card' then raise exception 'a card roll drew %', got; end if;
  ev := (got ->> 'event')::uuid;
  -- The pool is every card of the instance; the found row is the account's own, priced 0, naming the event and no Act.
  if (select count(*) from card_ledger where account = cat and kind = 'found' and event = ev and card = got ->> 'item' and price = 0 and act is null and pack is null) is distinct from 1 then
    raise exception 'one found card row: %', (select jsonb_agg(l) from card_ledger l where account = cat);
  end if;
  if card_held(cat, got ->> 'item') <> 1 then raise exception 'card_held counts the found card'; end if;
  -- A found row without an event, or an event without a found row, is not a ledger row.
  if pg_temp.refusal(format('insert into card_ledger (account, card, kind, price) values (%L, %L, %L, 0)', cat, 'te-c1', 'found')) is null then raise exception 'a found card with no event'; end if;
  if pg_temp.refusal(format('insert into card_ledger (account, card, kind, price, event) values (%L, %L, %L, 0, %L)', cat, 'te-c1', 'bought', ev)) is null then raise exception 'a bought card naming an event'; end if;
  if pg_temp.refusal(format('update random_events set item = %L where id = %L', 'x', ev)) is null then raise exception 'an event was updated'; end if;
  if pg_temp.refusal(format('delete from random_events where id = %L', ev)) is null then raise exception 'an event was deleted'; end if;
end $$;

-- ---- One account's events are its own to read; a roll through another player's mask is refused ----
do $$
declare
  ann uuid := (select id from auth.users where email = 'te-ann@test.invalid'); bob uuid := (select id from auth.users where email = 'te-bob@test.invalid');
  a1 uuid := (select id from characters where owner = ann limit 1); b1 uuid := (select id from characters where owner = bob limit 1);
  said text;
begin
  perform tests.become(ann);
  if (select count(*) from random_events) is distinct from (select count(*) from random_events where account = ann) or (select count(*) from random_events) = 0 then raise exception 'a player reads only their own events'; end if;
  if pg_temp.refusal('select count(*) from random_event_rolls') is null then raise exception 'rolls are not a player''s to read'; end if;
  if pg_temp.refusal(format('select random_event(%L, %L)', ann, a1)) is null then raise exception 'a player called random_event'; end if;
  perform tests.become_service();
  said := pg_temp.refusal(format('select random_event(%L, %L)', ann, b1));
  if said is distinct from 'you do not play that character' then raise exception 'a roll through another player''s mask: %', said; end if;
  update characters set retired_at = now() where id = a1;
  perform tests.become_service();
  said := pg_temp.refusal(format('select random_event(%L, %L)', ann, a1));
  if said is distinct from 'that character is retired; an admin can restore it' then raise exception 'a retired mask: %', said; end if;
end $$;

-- ---- The shared draw: buy_pack writes what roll_pack wrote before the draw was shared ----
-- (The expected list was recorded from 0149's roll_pack with this seed, before 0152 shared the draw. Every card but this file's is left out of the pool.)
do $$
declare
  rolled text[]; again text[];
  odds jsonb := '[{"weights":{"common":60,"uncommon":30,"rare":10}},{"weights":{"common":60,"uncommon":30,"rare":10}},{"weights":{"common":60,"uncommon":30,"rare":10}},
                  {"weights":{"common":60,"uncommon":30,"rare":10}},{"weights":{"uncommon":50,"rare":50}},{"weights":{"common":1,"uncommon":1,"rare":1}}]';
  gear_roll text;
begin
  perform tests.unbecome();
  perform setseed(0.31);
  rolled := roll_pack(odds, (select array_agg(key) from card_kinds where key not like 'te-%') || array['te-c3']);
  if rolled is distinct from array['te-c2', 'te-u2', 'te-u1', 'te-u1', 'te-u2', 'te-c1'] then raise exception 'roll_pack drew %', rolled; end if;
  -- The draw by rarity is the same draw, a pull at a time.
  perform setseed(0.31);
  again := array[draw_by_rarity('card', '{"common":60,"uncommon":30,"rare":10}', (select array_agg(key) from card_kinds where key not like 'te-%') || array['te-c3'])];
  if again[1] is distinct from 'te-c2' then raise exception 'draw_by_rarity drew %', again; end if;
  -- The gear pool draws gear alone, at the weighted rarity, and a pool with nothing to give answers null (roll_pack puts it in words).
  gear_roll := draw_by_rarity('gear', '{"legendary": 1}', '{}');
  if gear_roll is distinct from 'te-cape' then raise exception 'a legendary gear draw: %', gear_roll; end if;
  if draw_by_rarity('gear', '{"rare": 1}', '{}') is not null then raise exception 'a rarity with no gear was drawn'; end if;
  if pg_temp.refusal($q$select draw_by_rarity('shoe', '{"rare": 1}', '{}')$q$) is null then raise exception 'an unknown pool was drawn'; end if;
end $$;

-- ---- random_event's guards: a player cannot call it; the seed's lines are held ----
do $$
declare ann uuid := (select id from auth.users where email = 'te-ann@test.invalid');
begin
  perform tests.become(ann);
  if pg_temp.refusal(format('insert into event_lines (key, outcome, text) values (%L, %L, %L)', 'te-x', 'line', 'x')) is null then raise exception 'a player wrote an event line'; end if;
  perform tests.unbecome();
  if pg_temp.refusal(format('insert into event_lines (key, outcome, text) values (%L, %L, %L)', 'te-x', 'trophy', 'x')) is null then raise exception 'a line of an unknown outcome'; end if;
end $$;

-- ---- A seed replaces the instance's event lines, and one with no list touches none (last, since a seed removes the lines it does not name) ----
select tests.unbecome();
do $$
declare
  base jsonb := jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'cards', '[]'::jsonb, 'boards', '[]'::jsonb);
begin
  perform seed_instance(base || jsonb_build_object('eventLines', jsonb_build_array(jsonb_build_object('key', 'te-s1', 'outcome', 'line', 'text', 'One.'), jsonb_build_object('key', 'te-s2', 'outcome', 'gear', 'text', 'Two.'))));
  if (select string_agg(key || ':' || outcome || ':' || text, ',' order by key) from event_lines) is distinct from 'te-s1:line:One.,te-s2:gear:Two.' then raise exception 'a seed writes its lines: %', (select jsonb_agg(l) from event_lines l); end if;
  perform seed_instance(base || jsonb_build_object('eventLines', jsonb_build_array(jsonb_build_object('key', 'te-s1', 'outcome', 'card', 'text', 'One, changed.'))));
  if (select string_agg(key || ':' || outcome || ':' || text, ',' order by key) from event_lines) is distinct from 'te-s1:card:One, changed.' then raise exception 'a re-seed replaces them: %', (select jsonb_agg(l) from event_lines l); end if;
  perform seed_instance(base);
  if (select count(*) from event_lines) is distinct from 1 then raise exception 'a seed with no lines list touches none'; end if;
end $$;
