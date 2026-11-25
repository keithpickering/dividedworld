-- The reveal perk's input (supabase/migrations/0394_reveal_perk.sql; docs/plans/2026-11-20-class-balance-plan.md, Task 6; model: 0376-cushion.sql).
-- settlement_input gives each character `reveals`: the epoch milliseconds of its `unmask` Acts created before the window's end, oldest first, and none made at or
-- after it. estimate_input gives the caller's own characters theirs and another player's character none, as it gives that character no `classes`.

create function pg_temp.char_of(input jsonb, id uuid) returns jsonb language sql as $$
  select c from jsonb_array_elements(input -> 'characters') c where c ->> 'id' = id::text
$$;
create function pg_temp.ms(t timestamptz) returns bigint language sql as $$ select (extract(epoch from t) * 1000)::bigint $$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('rv-ann'); bob uuid := tests.account('rv-bob');
  a uuid := tests.character(ann, 'Rv Ann'); b uuid := tests.character(bob, 'Rv Bob');
  s1 constant timestamptz := (select min(starts_at) from seasons);
  w0 timestamptz; w1 timestamptz;
  t uuid := tests.thread('Rv settlement thread');
  first_at timestamptz; second_at timestamptz; late_at timestamptz; bobs_at timestamptz;
  bobs_post uuid; di_post uuid;
  cy uuid; di uuid; cy_at timestamptz; di_at timestamptz;
  input jsonb; est jsonb; got jsonb;
begin
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  w0 := (select max(ends_at) from settlements); w1 := w0 + interval '1 day';
  first_at := w0 - interval '30 hours'; second_at := w0 + interval '2 hours'; late_at := w1 + interval '1 hour'; bobs_at := w0 + interval '3 hours';
  -- The characters were made now; their class is held from before the earliest reveal, as an unmask names the class held at its own time (0027).
  update class_history set started_at = first_at - interval '1 day' where character in (a, b);
  -- Ann reveals twice before the window's end (one before the window, one inside it) and once after it; Bob reveals once inside the window. The unmask Acts are written as the one writer writes them (0027).
  perform write_unmask(a, t, 'act', second_at, '');
  perform write_unmask(a, t, 'act', first_at, '');
  perform write_unmask(a, t, 'act', late_at, '');
  perform write_unmask(b, t, 'act', bobs_at, '');

  -- Two more verified reveals that are not unmasks: Cy debuts with its class named, and Di's announced Turn names its new class. Both are announce Acts carrying a class
  -- (write_announce, 0100) and so rows of class_reveals; each is read as a reveal. Di is Bob's, Cy is Ann's.
  cy := tests.character(ann, 'Rv Cy'); di := tests.character(bob, 'Rv Di');
  cy_at := w0 + interval '90 minutes'; di_at := w0 + interval '1 hour';
  update class_history set started_at = first_at - interval '1 day' where character in (cy, di);
  perform write_announce(cy, t, 'debut', null, 'alpha', cy_at);
  insert into class_history (character, class_key, started_at) values (di, 'beta', di_at);
  perform write_announce(di, t, 'turn', 'alpha', 'beta', di_at);
  if (select count(*) from class_reveals where character in (cy, di)) is distinct from 2 then raise exception 'the setup: class_reveals does not hold the debut and the Turn'; end if;

  -- Bob posts inside the window and Ann reacts to it, so Ann's estimate names his character (as another player's).
  bobs_post := tests.post(b, t, 'Bob''s post.', w0 + interval '4 hours');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (bobs_post, a, ann, 'up', 1, w0 + interval '5 hours');

  -- Ann reacts to a post of Di's too, so her estimate names Di as another player's character.
  di_post := tests.post(di, t, 'Di''s post.', w0 + interval '4 hours');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (di_post, a, ann, 'up', 1, w0 + interval '5 hours');

  input := settlement_input(w0, w1);
  got := pg_temp.char_of(input, a) -> 'reveals';
  if got is distinct from jsonb_build_array(pg_temp.ms(first_at), pg_temp.ms(second_at)) then
    raise exception 'the settlement does not give Ann''s reveals before the window''s end, oldest first and none after it: %', got;
  end if;
  if pg_temp.char_of(input, b) -> 'reveals' is distinct from jsonb_build_array(pg_temp.ms(bobs_at)) then
    raise exception 'the settlement does not give Bob''s reveal: %', pg_temp.char_of(input, b) -> 'reveals';
  end if;
  if pg_temp.char_of(input, cy) -> 'reveals' is distinct from jsonb_build_array(pg_temp.ms(cy_at)) then
    raise exception 'the settlement does not give a debut that names its class as a reveal: %', pg_temp.char_of(input, cy) -> 'reveals';
  end if;
  if pg_temp.char_of(input, di) -> 'reveals' is distinct from jsonb_build_array(pg_temp.ms(di_at)) then
    raise exception 'the settlement does not give a Turn that names its new class as a reveal: %', pg_temp.char_of(input, di) -> 'reveals';
  end if;
  -- A character that never revealed has an empty list, not a missing one.
  if exists (select 1 from jsonb_array_elements(input -> 'characters') c where c -> 'reveals' is null or jsonb_typeof(c -> 'reveals') <> 'array') then
    raise exception 'a character in the settlement input has no reveals list';
  end if;

  est := estimate_input(ann, w0 + interval '6 hours');
  got := pg_temp.char_of(est, a) -> 'reveals';
  if got is distinct from jsonb_build_array(pg_temp.ms(first_at), pg_temp.ms(second_at)) then
    raise exception 'the caller''s estimate does not give the caller''s own reveals: %', got;
  end if;
  if pg_temp.char_of(est, cy) -> 'reveals' is distinct from jsonb_build_array(pg_temp.ms(cy_at)) then
    raise exception 'the caller''s estimate does not give the caller''s own debut reveal: %', pg_temp.char_of(est, cy) -> 'reveals';
  end if;
  if pg_temp.char_of(est, di) -> 'reveals' is distinct from '[]'::jsonb then
    raise exception 'an estimate shows another player''s Turn reveal: %', pg_temp.char_of(est, di);
  end if;
  got := pg_temp.char_of(est, b);
  if got is null or got -> 'reveals' is distinct from '[]'::jsonb then
    raise exception 'an estimate shows another player''s character''s reveals: %', got;
  end if;
end $$;
