-- The cosmetics log and alerts (supabase/migrations/0213_cosmetics_log.sql; the cosmetics plan, Task 12): a trophy alert goes to the owner of the character an award is for, and a beltLost alert to the
-- owner of the character that held the belt before it passed to another; log_page carries a find, an admin's gear (counted, with the mask it went through), a trophy given, one taken back and a belt lost
-- for the caller's own characters only, and another player's log shows none of them.

select tests.unbecome();
insert into gear_kinds (key, rarity) values ('cl-hat', 'common');
insert into trophy_kinds (key, name, belt) values ('cl-pet', 'Pet', false), ('cl-belt', 'The Belt', true);

do $$
declare
  ann uuid := tests.account('cl-ann'); bob uuid := tests.account('cl-bob'); boss uuid := tests.account('cl-admin');
  a uuid := tests.character(ann, 'Cl Ann'); b uuid := tests.character(bob, 'Cl Bob');
  pet uuid; belt_a uuid; belt_b uuid; ev1 uuid; ev2 uuid; r jsonb; rows jsonb; n integer;
begin
  insert into admins (account) values (boss);

  -- An award is a trophy alert to its character's player, none to anyone else, and no Act.
  insert into trophy_awards (trophy, character, by) values ('cl-pet', a, 'admin') returning id into pet;
  if (select count(*) from alerts where account = ann and kind = 'trophy' and sub = 'Pet' and character = a and act is null) is distinct from 1 then raise exception 'a trophy alert to Ann'; end if;
  if exists (select 1 from alerts where account = bob) then raise exception 'Bob was told of Ann''s trophy'; end if;

  -- A belt given first passes from no one: a trophy alert and no beltLost.
  insert into trophy_awards (trophy, character, by) values ('cl-belt', a, 'admin') returning id into belt_a;
  if exists (select 1 from alerts where kind = 'beltLost') then raise exception 'a beltLost alert with no one to lose it'; end if;
  -- It passes to Bob: Bob is given it, and Ann, the old holder, is told she lost it.
  insert into trophy_awards (trophy, character, by) values ('cl-belt', b, 'admin') returning id into belt_b;
  if (select count(*) from alerts where account = bob and kind = 'trophy' and sub = 'The Belt' and character = b) is distinct from 1 then raise exception 'a trophy alert to Bob'; end if;
  if (select count(*) from alerts where account = ann and kind = 'beltLost' and sub = 'The Belt' and character = a and act is null) is distinct from 1 then raise exception 'a beltLost alert to Ann'; end if;
  if exists (select 1 from alerts where account = bob and kind = 'beltLost') then raise exception 'Bob lost nothing'; end if;
  -- Given the belt it already holds, Bob is given it again and loses nothing.
  insert into trophy_awards (trophy, character, by) values ('cl-belt', b, 'admin');
  if (select count(*) from alerts where kind = 'beltLost') is distinct from 1 then raise exception 'a holder given its own belt lost it'; end if;
  -- A belt taken back never made its holder a loser: the next award passes from the standing holder, not from a reversed one.

  -- What happened to Ann: two Events (a gear find with its ledger row, and a line), gear an admin gave, and the pet taken back.
  insert into random_events (account, character, outcome, item, line, line_text) values (ann, a, 'gear', 'cl-hat', 'cl-found', 'a pigeon watched you type') returning id into ev1;
  insert into gear_ledger (account, gear, kind, event) values (ann, 'cl-hat', 'found', ev1);
  insert into random_events (account, character, outcome, item, line, line_text) values (ann, a, 'line', null, 'cl-line', 'a pigeon watched you type') returning id into ev2;
  perform tests.become(boss);
  perform grant_gear(a, 'cl-hat', 5);
  perform reverse_award(pet);
  perform tests.unbecome();

  perform tests.become(ann);
  r := log_page(null);
  rows := r -> 'sources' -> 'cosmetics';
  if (select count(*) from jsonb_array_elements(rows) x where x ->> 'kind' = 'found') is distinct from 2 then raise exception 'two finds, once each: %', rows; end if;
  if not exists (select 1 from jsonb_array_elements(rows) x where x ->> 'kind' = 'found' and x ->> 'outcome' = 'gear' and x ->> 'item' = 'cl-hat' and x ->> 'character' = a::text) then raise exception 'the gear find: %', rows; end if;
  if not exists (select 1 from jsonb_array_elements(rows) x where x ->> 'kind' = 'found' and x ->> 'outcome' = 'line' and x ->> 'text' = 'a pigeon watched you type') then raise exception 'the line event: %', rows; end if;
  if (select count(*) from jsonb_array_elements(rows) x where x ->> 'kind' = 'granted') is distinct from 1
     or not exists (select 1 from jsonb_array_elements(rows) x where x ->> 'kind' = 'granted' and x ->> 'item' = 'cl-hat' and (x ->> 'copies')::integer = 5 and x ->> 'character' = a::text) then raise exception 'five copies are one line, through Ann''s mask: %', rows; end if;
  if (select count(*) from jsonb_array_elements(rows) x where x ->> 'kind' = 'awarded' and x ->> 'by' = 'admin') is distinct from 2 then raise exception 'Ann''s two awards: %', rows; end if;
  if not exists (select 1 from jsonb_array_elements(rows) x where x ->> 'kind' = 'reversed' and x ->> 'id' = pet::text and x ->> 'name' = 'Pet') then raise exception 'the pet taken back: %', rows; end if;
  if (select count(*) from jsonb_array_elements(rows) x where x ->> 'kind' = 'lost') is distinct from 1
     or not exists (select 1 from jsonb_array_elements(rows) x where x ->> 'kind' = 'lost' and x ->> 'character' = a::text and x ->> 'to_name' = 'Cl Bob' and x ->> 'name' = 'The Belt' and x ->> 'id' = belt_b::text) then raise exception 'the belt lost to Bob: %', rows; end if;
  select count(*) into n from jsonb_array_elements(rows); if n is distinct from 7 then raise exception 'Ann''s log holds 7 cosmetics rows, not %: %', n, rows; end if;
  -- The view and the page agree, and a page's cursor cuts it as the others.
  if (select count(*) from my_cosmetic_log) is distinct from 7 then raise exception 'my_cosmetic_log: %', (select count(*) from my_cosmetic_log); end if;
  perform tests.unbecome();

  -- Bob sees his own: the belt given twice, and nothing of Ann's finds, gear, pet or loss.
  perform tests.become(bob);
  rows := log_page(null) -> 'sources' -> 'cosmetics';
  if (select count(*) from jsonb_array_elements(rows)) is distinct from 2 or exists (select 1 from jsonb_array_elements(rows) x where x ->> 'kind' <> 'awarded' or x ->> 'character' <> b::text) then raise exception 'Bob''s own awards only: %', rows; end if;
  if rows::text like '%Cl Ann%' or rows::text like '%' || a::text || '%' then raise exception 'Bob''s log names Ann or her mask: %', rows; end if;
  perform tests.unbecome();

  -- A cursor cuts the cosmetics source as the others: nothing newer than it.
  perform tests.become(ann);
  rows := log_page((select min((x ->> 'at')::timestamptz) from jsonb_array_elements(log_page(null) -> 'sources' -> 'cosmetics') x)) -> 'sources' -> 'cosmetics';
  if jsonb_array_length(rows) < 1 or jsonb_array_length(rows) >= 7 then raise exception 'a cursor at the oldest row leaves the rows at that instant: %', jsonb_array_length(rows); end if;
  perform tests.unbecome();

  -- The bounds reach the rows: a find a day newer than the cursor is left out of a page asked with it, and `most` caps the count of what the function returns.
  insert into random_events (account, character, outcome, item, line, line_text, at) values (ann, a, 'line', null, 'cl-later', 'a later pigeon', now() + interval '1 day');
  perform tests.become(ann);
  if jsonb_array_length(log_page(null) -> 'sources' -> 'cosmetics') is distinct from 8 then raise exception 'the newer find is in the unbounded page'; end if;
  if jsonb_array_length(log_page(now() + interval '1 hour') -> 'sources' -> 'cosmetics') is distinct from 7 or (select count(*) from cosmetic_log_rows(now() + interval '1 hour')) is distinct from 7 then raise exception 'a cursor leaves out what is newer: % / %', jsonb_array_length(log_page(now() + interval '1 hour') -> 'sources' -> 'cosmetics'), (select count(*) from cosmetic_log_rows(now() + interval '1 hour')); end if;
  if (select count(*) from cosmetic_log_rows(null, 3)) is distinct from 3 or (select count(*) from cosmetic_log_rows(now() + interval '1 hour', 2)) is distinct from 2 then raise exception 'most caps the count'; end if;
  if (select max(x.at) from cosmetic_log_rows(null, 1) x) is distinct from (select max(x.at) from cosmetic_log_rows(null, 1000) x) then raise exception 'the cap keeps the newest'; end if;
  perform tests.unbecome();

  -- The alerts are no more than the account's own, in Alerts: Ann reads hers and Bob his.
  perform tests.become(ann);
  if (select count(*) from my_alerts(null, 30) where kind in ('trophy', 'beltLost', 'beltBack')) is distinct from 3 then raise exception 'Ann''s alerts: %', (select count(*) from my_alerts(null, 30)); end if;
  perform tests.unbecome();
end $$;

-- A taking back keeps the record true (review of Task 12): Ann was told she lost the belt; an admin takes Bob's award back, and Ann's lost line stays, a beltBack line joins it, Ann is told
-- she holds it again, and Bob's log says an admin took it back. Nobody else hears of it.
do $$
declare
  ann uuid := tests.account('cb-ann'); bob uuid := tests.account('cb-bob'); cat uuid := tests.account('cb-cat'); boss uuid := tests.account('cb-admin');
  a uuid := tests.character(ann, 'Cb Ann'); b uuid := tests.character(bob, 'Cb Bob'); c uuid := tests.character(cat, 'Cb Cat');
  ann_award uuid; bob_award uuid; rows jsonb;
begin
  insert into admins (account) values (boss);
  insert into trophy_kinds (key, name, belt) values ('cb-belt', 'The Cb Belt', true);
  insert into trophy_awards (trophy, character, by) values ('cb-belt', a, 'admin') returning id into ann_award;
  insert into trophy_awards (trophy, character, by) values ('cb-belt', b, 'admin') returning id into bob_award;
  if (select count(*) from alerts where account = ann and kind = 'beltLost') is distinct from 1 then raise exception 'Ann was told she lost it'; end if;
  perform tests.become(boss);
  perform reverse_award(bob_award);
  perform tests.unbecome();
  if (select count(*) from alerts where account = ann and kind = 'beltBack' and sub = 'The Cb Belt' and character = a and act is null) is distinct from 1 then raise exception 'Ann is told she holds it again'; end if;
  if exists (select 1 from alerts where account in (bob, cat) and kind = 'beltBack') then raise exception 'only the holder is told'; end if;
  -- A reversal of an award that was not the holder's (Ann's own, now the holder's, is not a taker's) tells no one new about a belt coming back to Bob.
  perform tests.become(ann);
  rows := log_page(null) -> 'sources' -> 'cosmetics';
  if (select count(*) from jsonb_array_elements(rows) x where x ->> 'kind' = 'lost' and x ->> 'name' = 'The Cb Belt' and x ->> 'to_name' = 'Cb Bob') is distinct from 1 then raise exception 'Ann''s lost line stays: %', rows; end if;
  if (select count(*) from jsonb_array_elements(rows) x where x ->> 'kind' = 'beltBack' and x ->> 'name' = 'The Cb Belt' and x ->> 'to_name' = 'Cb Bob' and x ->> 'character' = a::text) is distinct from 1 then raise exception 'Ann''s beltBack line: %', rows; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  rows := log_page(null) -> 'sources' -> 'cosmetics';
  if not exists (select 1 from jsonb_array_elements(rows) x where x ->> 'kind' = 'reversed' and x ->> 'name' = 'The Cb Belt') then raise exception 'Bob''s log says an admin took it back: %', rows; end if;
  if exists (select 1 from jsonb_array_elements(rows) x where x ->> 'kind' in ('lost', 'beltBack')) then raise exception 'Bob lost nothing and got nothing back: %', rows; end if;
  perform tests.unbecome();
  perform tests.become(cat);
  if exists (select 1 from jsonb_array_elements(log_page(null) -> 'sources' -> 'cosmetics')) then raise exception 'an unrelated player has no lines'; end if;
  perform tests.unbecome();
  -- A reversal of a non-holder's award or a non-belt's tells no one: Ann's own award reversed after Bob's has no earlier holder.
  perform tests.become(boss);
  perform reverse_award(ann_award);
  perform tests.unbecome();
  if (select count(*) from alerts where kind = 'beltBack') is distinct from 1 then raise exception 'one belt-back alert in all'; end if;
end $$;
