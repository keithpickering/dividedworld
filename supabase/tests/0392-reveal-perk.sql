-- The reveal perk's input (supabase/migrations/0392_reveal_perk.sql; docs/plans/2026-11-20-class-balance-plan.md, Task 6; model: 0376-cushion.sql).
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
  bobs_post uuid;
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

  -- Bob posts inside the window and Ann reacts to it, so Ann's estimate names his character (as another player's).
  bobs_post := tests.post(b, t, 'Bob''s post.', w0 + interval '4 hours');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (bobs_post, a, ann, 'up', 1, w0 + interval '5 hours');

  input := settlement_input(w0, w1);
  got := pg_temp.char_of(input, a) -> 'reveals';
  if got is distinct from jsonb_build_array(pg_temp.ms(first_at), pg_temp.ms(second_at)) then
    raise exception 'the settlement does not give Ann''s reveals before the window''s end, oldest first and none after it: %', got;
  end if;
  if pg_temp.char_of(input, b) -> 'reveals' is distinct from jsonb_build_array(pg_temp.ms(bobs_at)) then
    raise exception 'the settlement does not give Bob''s reveal: %', pg_temp.char_of(input, b) -> 'reveals';
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
  got := pg_temp.char_of(est, b);
  if got is null or got -> 'reveals' is distinct from '[]'::jsonb then
    raise exception 'an estimate shows another player''s character''s reveals: %', got;
  end if;
end $$;
