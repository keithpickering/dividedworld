-- Quote conditions, the schema and the setting (supabase/migrations/0144_quote_conditions.sql, Task 4; docs/plans/2026-11-08-quote-conditions-plan.md, the design is
-- docs/plans/2026-11-08-quote-conditions-design.md, sections 3 and 4): a Move's back may hold a passage the quoted excerpt must contain and a list of characters the quoter must, or must not, be
-- ("Only these" / "Anyone but these"). Only the setter reads them (my_face_down). Every refusal reads public facts alone: a character that is not on the board is refused in one message
-- whether it is missing or has not debuted, and no refusal says who owns a character. The cards are this file's own (fdq...), never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('fdq-ann');
  bob uuid := tests.account('fdq-bob');
  a uuid := tests.character(ann, 'Quote Ann');
  a2 uuid := tests.character(ann, 'Quote Ann Two');
  b uuid := tests.character(bob, 'Quote Bob');
  gone uuid := tests.character(bob, 'Quote Retired');
  waiting_ann uuid;
  waiting_bob uuid;
  t uuid := tests.thread('Conditions');
  p1 uuid := tests.post(a, t, 'Here is [b]the punchline[/b], and nothing more.');
  p2 uuid := tests.post(a, t, 'Second post, the punchline again.');
  p3 uuid := tests.post(a, t, 'Third post, the punchline once more.');
  p4 uuid := tests.post(a, t, 'Fourth post, the punchline too.');
  p5 uuid := tests.post(a, t, 'Fifth post, the punchline at last.');
  p6 uuid := tests.post(a, t, 'Sixth post, the punchline for the gimmick.');
  p7 uuid := tests.post(a, t, 'Seventh post, with the original words.');
  p8 uuid := tests.post(a, t, 'Eighth post, the punchline for refusals.');
  p9 uuid := tests.post(a, t, 'Ninth post, the punchline for retirement.');
  placed jsonb;
  why text;
  why2 text;
  row_ face_down%rowtype;
  mine record;
  six uuid[];
  n integer;
begin
  -- The columns first, so a missing one fails here on an assertion and not later on a field read.
  if (select count(*) from information_schema.columns where table_name = 'face_down' and column_name in ('passage', 'who', 'who_except')) is distinct from 3::bigint then
    raise exception 'face_down does not hold passage, who and who_except';
  end if;
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('fdqmove', 'Cond Move', 'salty', 'common', 'cast', null, '{post}', null),
    ('fdqidle', 'Cond Idle', 'pepperoni', 'common', 'set', '{"trigger": {"on": "visit"}}', '{post}', null);
  insert into card_ledger (account, card, kind, price) select ann, k, 'bought', 0 from unnest(array['fdqmove', 'fdqidle']) k, generate_series(1, 14);
  -- A character that has not debuted, one account's and another's; and one retired.
  insert into characters (owner, name) values (ann, 'Quote Waiting Ann') returning id into waiting_ann;
  insert into characters (owner, name) values (bob, 'Quote Waiting Bob') returning id into waiting_bob;
  update characters set retired_at = now() where id = gone;

  -- A Move with no condition holds none.
  placed := set_card(ann, 'fdqmove', a, p1, '{}', 0);
  select * into row_ from face_down where play = (placed ->> 'id')::uuid;
  if row_.passage is not null or row_.who is not null or row_.who_except is not null then raise exception 'a back with no condition holds one: %', to_jsonb(row_); end if;

  -- A passage alone.
  placed := set_card(ann, 'fdqmove', a, p2, '{}', 0, passage => 'the punchline');
  select * into row_ from face_down where play = (placed ->> 'id')::uuid;
  if row_.passage is distinct from 'the punchline' or row_.who is not null or row_.who_except is not null then raise exception 'the passage was not stored alone: %', to_jsonb(row_); end if;

  -- Only these: another's character, and one's own other mask (accepted without a word).
  placed := set_card(ann, 'fdqmove', a, p3, '{}', 0, named => array[b, a2], who_except => false);
  select * into row_ from face_down where play = (placed ->> 'id')::uuid;
  if row_.who is distinct from array[b, a2] or row_.who_except is distinct from false or row_.passage is not null then raise exception 'Only these was not stored: %', to_jsonb(row_); end if;

  -- Anyone but these, naming the setting character itself and a retired character (accepted: design section 4).
  placed := set_card(ann, 'fdqmove', a, p4, '{}', 0, named => array[a, gone], who_except => true);
  select * into row_ from face_down where play = (placed ->> 'id')::uuid;
  if row_.who is distinct from array[a, gone] or row_.who_except is distinct from true then raise exception 'Anyone but was not stored: %', to_jsonb(row_); end if;

  -- All three conditions together, with a Says beside them.
  placed := set_card(ann, 'fdqmove', a, p5, '{}', 0, phrase => 'nice try', passage => 'punchline at last', named => array[b], who_except => false);
  select * into row_ from face_down where play = (placed ->> 'id')::uuid;
  if row_.phrase is distinct from 'nice try' or row_.passage is distinct from 'punchline at last' or row_.who is distinct from array[b] or row_.who_except is distinct from false then
    raise exception 'the three conditions were not stored together: %', to_jsonb(row_);
  end if;

  -- The setter reads them through my_face_down, last; no other account reads the row.
  perform tests.become(ann);
  select f.passage, f.who, f.who_except into mine from my_face_down f where f.play = (placed ->> 'id')::uuid;
  if mine.passage is distinct from 'punchline at last' or mine.who is distinct from array[b] or mine.who_except is distinct from false then raise exception 'my_face_down does not return the conditions: %', mine; end if;
  perform tests.become(bob);
  if exists (select 1 from my_face_down f where f.play = (placed ->> 'id')::uuid) then raise exception 'another account read a back through my_face_down'; end if;
  perform tests.unbecome();
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_name = 'my_face_down' and column_name in ('catches', 'phrase', 'passage', 'who', 'who_except'))
     is distinct from array['catches', 'phrase', 'passage', 'who', 'who_except'] then raise exception 'my_face_down does not end catches, phrase, passage, who, who_except'; end if;
  if (select max(ordinal_position) from information_schema.columns where table_name = 'my_face_down' and column_name = 'who_except') is distinct from (select max(ordinal_position) from information_schema.columns where table_name = 'my_face_down') then
    raise exception 'who_except is not my_face_down''s last column';
  end if;

  -- A passage is held to the post's current words: one the original held and an edit removed is refused, and one an edit added is accepted.
  perform tests.act(a, 'edit', t, jsonb_build_object('body', 'Seventh post, now with the edited words.'), p7);
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, passage => %L)', ann, 'fdqmove', a, p7, '{}', 'original words'));
  if why is distinct from 'that passage is not in this post''s words' then raise exception 'a passage the edit removed was accepted: %', why; end if;
  placed := set_card(ann, 'fdqmove', a, p7, '{}', 0, passage => 'edited words');
  if (select passage from face_down where play = (placed ->> 'id')::uuid) is distinct from 'edited words' then raise exception 'a passage the edit added was not stored'; end if;

  -- The refusals, in plain words. Each leaves no back and spends no card.
  n := card_held(ann, 'fdqmove');
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, passage => %L)', ann, 'fdqmove', a, p8, '{}', 'not in the post'));
  if why is distinct from 'that passage is not in this post''s words' then raise exception 'a passage not in the post was accepted: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, passage => %L)', ann, 'fdqidle', a, p6, '{}', 'the punchline'));
  if why is distinct from 'Cond Idle takes no conditions' then raise exception 'a Gimmick took a passage: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, named => %L, who_except => false)', ann, 'fdqidle', a, p6, '{}', array[b]));
  if why is distinct from 'Cond Idle takes no conditions' then raise exception 'a Gimmick took a Who: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, passage => %L)', ann, 'fdqmove', a, p8, '{}', '   '));
  if why is null then raise exception 'a blank passage was accepted'; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, passage => %L)', ann, 'fdqmove', a, p8, '{}', '!!!'));
  if why is distinct from 'the passage needs a letter or a digit' then raise exception 'a passage with no letter or digit gave: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, passage => %L)', ann, 'fdqmove', a, p8, '{}', repeat('the punchline ', 8)));
  if why is null then raise exception 'a passage over 100 characters was accepted'; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, named => %L)', ann, 'fdqmove', a, p8, '{}', array[b]));
  if why is null then raise exception 'a list with no Only/Anyone but was accepted'; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, who_except => true)', ann, 'fdqmove', a, p8, '{}'));
  if why is null then raise exception 'Anyone but with no list was accepted'; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, named => %L, who_except => false)', ann, 'fdqmove', a, p8, '{}', '{}'::uuid[]));
  if why is null then raise exception 'an empty list was accepted'; end if;
  six := array(select tests.character(tests.account('fdq-many-' || i), 'Quote Many ' || i) from generate_series(1, 6) i);
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, named => %L, who_except => false)', ann, 'fdqmove', a, p8, '{}', six));
  if why is null then raise exception 'a list of six was accepted'; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, named => %L, who_except => false)', ann, 'fdqmove', a, p8, '{}', array[b, b]));
  if why is null then raise exception 'a character named twice was accepted'; end if;
  -- One message for a character that does not exist and one that has not debuted, whoever owns it: the position in the list, never the id or the owner.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, named => %L, who_except => false)', ann, 'fdqmove', a, p8, '{}', array[b, gen_random_uuid()]));
  if why is distinct from '2 is not a character on the board' then raise exception 'a missing character: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, named => %L, who_except => false)', ann, 'fdqmove', a, p8, '{}', array[b, waiting_bob]));
  if why is distinct from '2 is not a character on the board' then raise exception 'another account''s undebuted character: %', why; end if;
  why2 := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, named => %L, who_except => true)', ann, 'fdqmove', a, p8, '{}', array[b, waiting_ann]));
  if why2 is distinct from why then raise exception 'the setter''s own undebuted character is refused differently from another''s: % / %', why2, why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, named => %L, who_except => false)', ann, 'fdqmove', a, p8, '{}', array[waiting_bob, b]));
  if why is distinct from '1 is not a character on the board' then raise exception 'the first position: %', why; end if;
  if card_held(ann, 'fdqmove') is distinct from n or exists (select 1 from face_down where post = p8) then raise exception 'a refused set spent a card or left a back'; end if;

  -- The table holds the same rules whoever writes it.
  why := pg_temp.refusal(format($q$insert into face_down (play, account, card, config, post, thread, round, ends_at, passage) values (%L, %L, 'fdqmove', '{}', %L, %L, 9, now() + interval '1 day', '  ')$q$, gen_random_uuid(), ann, p9, t));
  if why not like '%face_down_passage%' then raise exception 'a blank passage reached the table: %', why; end if;
  why := pg_temp.refusal(format($q$insert into face_down (play, account, card, config, post, thread, round, ends_at, who) values (%L, %L, 'fdqmove', '{}', %L, %L, 9, now() + interval '1 day', %L)$q$, gen_random_uuid(), ann, p9, t, array[b]));
  if why not like '%face_down_who%' then raise exception 'a list with no flag reached the table: %', why; end if;
  why := pg_temp.refusal(format($q$insert into face_down (play, account, card, config, post, thread, round, ends_at, who, who_except) values (%L, %L, 'fdqmove', '{}', %L, %L, 9, now() + interval '1 day', %L, false)$q$, gen_random_uuid(), ann, p9, t, six));
  if why not like '%face_down_who%' then raise exception 'six ids reached the table: %', why; end if;
  why := pg_temp.refusal(format($q$insert into face_down (play, account, card, config, post, thread, round, ends_at, who, who_except) values (%L, %L, 'fdqmove', '{}', %L, %L, 9, now() + interval '1 day', %L, false)$q$, gen_random_uuid(), ann, p9, t, array[b, b]));
  if why not like '%face_down_who%' then raise exception 'a repeated id reached the table: %', why; end if;
  why := pg_temp.refusal(format($q$insert into face_down (play, account, card, config, post, thread, round, ends_at, catches, passage) values (%L, %L, 'fdqmove', '{}', %L, %L, 9, now() + interval '1 day', 'fdqmove', 'x')$q$, gen_random_uuid(), ann, p9, t));
  if why not like '%face_down_one_of%' then raise exception 'a catch beside a passage reached the table: %', why; end if;
  why := pg_temp.refusal(format($q$insert into face_down (play, account, card, config, post, thread, round, ends_at, catches, who, who_except) values (%L, %L, 'fdqmove', '{}', %L, %L, 9, now() + interval '1 day', 'fdqmove', %L, true)$q$, gen_random_uuid(), ann, p9, t, array[b]));
  if why not like '%face_down_one_of%' then raise exception 'a catch beside a Who reached the table: %', why; end if;

  -- One signature each: the old ones are dropped, so a call by position cannot be ambiguous.
  if (select count(*) from pg_proc where proname = 'set_card' and pronamespace = 'public'::regnamespace) is distinct from 1::bigint then raise exception 'set_card has more than one signature'; end if;
  if (select count(*) from pg_proc where proname = 'place_set' and pronamespace = 'public'::regnamespace) is distinct from 1::bigint then raise exception 'place_set has more than one signature'; end if;
  if has_function_privilege('authenticated', (select oid from pg_proc where proname = 'set_card' and pronamespace = 'public'::regnamespace), 'execute')
     or not has_function_privilege('service_role', (select oid from pg_proc where proname = 'set_card' and pronamespace = 'public'::regnamespace), 'execute') then raise exception 'set_card''s grants are not service_role alone'; end if;
  if has_function_privilege('service_role', (select oid from pg_proc where proname = 'place_set' and pronamespace = 'public'::regnamespace), 'execute') then raise exception 'place_set is callable'; end if;
end $$;
