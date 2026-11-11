-- A ledger entry names a card (supabase/migrations/0150_ledger_names_a_card.sql; docs/plans/2026-11-11-card-notes-part-6-plan.md, Task 1; issue #452).
-- settle() writes one `card.boost` entry per character and card, with params {"card": "<key>"}: apply_settlement refused the string, and the
-- index ledger_entry allowed one entry per character and reason. The key `card` is a string of 1 to 64 characters; any other params value is a number.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('lc-ann');
  a uuid := tests.character(ann, 'Lc Ann');
  t uuid := tests.thread();
  p1 uuid := tests.post(a, t, 'One.');
  p2 uuid := tests.post(a, t, 'Two.');
  w1 timestamptz := coalesce((select max(ends_at) from settlements), '2030-01-01T00:00:00Z');
  w2 timestamptz := w1 + interval '1 day';
  w3 timestamptz := w2 + interval '1 day';
  said jsonb;
  why text;
  sid bigint;
  r record;
begin
  -- Two boost entries for one character naming two cards, each with its own shares, are applied.
  said := apply_settlement(w1, w2, jsonb_build_array(
      jsonb_build_object('player', ann, 'character', a, 'reason', 'card.boost', 'amount', 10, 'params', '{"card": "x"}'::jsonb),
      jsonb_build_object('player', ann, 'character', a, 'reason', 'card.boost', 'amount', 6, 'params', '{"card": "y"}'::jsonb),
      jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 3)),
    '{}', '[]',
    jsonb_build_array(
      jsonb_build_object('character', a, 'reason', 'card.boost', 'card', 'x', 'act', p1, 'quadrant', 'excitedPositive', 'amount', 10),
      jsonb_build_object('character', a, 'reason', 'card.boost', 'card', 'y', 'act', p1, 'quadrant', 'excitedPositive', 'amount', 2),
      jsonb_build_object('character', a, 'reason', 'card.boost', 'card', 'y', 'act', p2, 'quadrant', 'excitedPositive', 'amount', 4),
      jsonb_build_object('character', a, 'reason', 'alpha.cheered', 'act', p1, 'amount', 3)));
  if not (said ->> 'applied')::boolean then raise exception 'a settlement holding two card.boost entries should apply: %', said; end if;
  sid := (said ->> 'settlement')::bigint;
  if (select count(*) from ledger where settlement = sid and reason = 'card.boost') is distinct from 2::bigint then
    raise exception 'two boost entries are two rows, read %', (select count(*) from ledger where settlement = sid and reason = 'card.boost');
  end if;
  if (select sum(sh.amount) from ledger_shares sh join ledger l on l.id = sh.ledger where l.settlement = sid and l.params ->> 'card' = 'x') is distinct from 10::bigint
     or (select count(*) from ledger_shares sh join ledger l on l.id = sh.ledger where l.settlement = sid and l.params ->> 'card' = 'y') is distinct from 2::bigint
     or (select sum(sh.amount) from ledger_shares sh join ledger l on l.id = sh.ledger where l.settlement = sid and l.params ->> 'card' = 'y') is distinct from 6::bigint then
    raise exception 'each boost entry holds its own card''s shares';
  end if;

  -- Read back through my_ledger and my_ledger_shares.
  perform tests.become(ann);
  if (select count(*) from my_ledger where reason = 'card.boost') is distinct from 2::bigint
     or (select amount from my_ledger where reason = 'card.boost' and params ->> 'card' = 'x') is distinct from 10
     or (select amount from my_ledger where reason = 'card.boost' and params ->> 'card' = 'y') is distinct from 6 then
    raise exception 'my_ledger reads each boost entry with its card: %', (select jsonb_agg(to_jsonb(x)) from my_ledger x);
  end if;
  perform tests.unbecome();

  -- Refused: a share whose card no entry names; a string under another key; a number under card; an empty or long card; a duplicate card.
  why := pg_temp.refusal(format($q$select apply_settlement(%L, %L, %L::jsonb, '{}', '[]', %L::jsonb)$q$, w2, w3,
    jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'card.boost', 'amount', 5, 'params', '{"card": "x"}'::jsonb)),
    jsonb_build_array(jsonb_build_object('character', a, 'reason', 'card.boost', 'card', 'z', 'act', p1, 'amount', 5))));
  if why is distinct from 'a share names no entry of this call' then raise exception 'a share with no matching card is refused, got %', why; end if;
  why := pg_temp.refusal(format($q$select apply_settlement(%L, %L, %L::jsonb)$q$, w2, w3,
    jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'card.boost', 'amount', 5, 'params', '{"other": "x"}'::jsonb))));
  if why is distinct from 'an entry''s params are numbers by key' then raise exception 'a string under another key is refused, got %', why; end if;
  why := pg_temp.refusal(format($q$select apply_settlement(%L, %L, %L::jsonb)$q$, w2, w3,
    jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'card.boost', 'amount', 5, 'params', '{"card": 7}'::jsonb))));
  if why is distinct from 'an entry''s params are numbers by key' then raise exception 'a number under card is refused, got %', why; end if;
  why := pg_temp.refusal(format($q$select apply_settlement(%L, %L, %L::jsonb)$q$, w2, w3,
    jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'card.boost', 'amount', 5, 'params', '{"card": ""}'::jsonb))));
  if why is distinct from 'an entry''s params are numbers by key' then raise exception 'an empty card is refused, got %', why; end if;
  why := pg_temp.refusal(format($q$select apply_settlement(%L, %L, %L::jsonb)$q$, w2, w3,
    jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'card.boost', 'amount', 5, 'params', jsonb_build_object('card', repeat('c', 65))))));
  if why is distinct from 'an entry''s params are numbers by key' then raise exception 'a 65-character card is refused, got %', why; end if;
  why := pg_temp.refusal(format($q$select apply_settlement(%L, %L, %L::jsonb)$q$, w2, w3,
    jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'card.boost', 'amount', 5, 'params', '{"card": "x"}'::jsonb),
                      jsonb_build_object('player', ann, 'character', a, 'reason', 'card.boost', 'amount', 5, 'params', '{"card": "x"}'::jsonb))));
  if why is distinct from 'two entries name one character and reason and card' then raise exception 'two entries of one card are refused, got %', why; end if;
  if exists (select 1 from settlements where starts_at = w2) then raise exception 'a refused call settled a window'; end if;

  -- A number under another key still passes, and a share's entry still adds up per card.
  why := pg_temp.refusal(format($q$select apply_settlement(%L, %L, %L::jsonb, '{}', '[]', %L::jsonb)$q$, w2, w3,
    jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'card.boost', 'amount', 5, 'params', '{"card": "x"}'::jsonb),
                      jsonb_build_object('player', ann, 'character', a, 'reason', 'card.boost', 'amount', 5, 'params', '{"card": "y"}'::jsonb)),
    jsonb_build_array(jsonb_build_object('character', a, 'reason', 'card.boost', 'card', 'x', 'act', p1, 'amount', 5),
                      jsonb_build_object('character', a, 'reason', 'card.boost', 'card', 'y', 'act', p1, 'amount', 4))));
  if why is distinct from 'an entry''s shares add up to it' then raise exception 'shares add up per card, got %', why; end if;

  -- A retried window still answers "already settled".
  said := apply_settlement(w1, w2, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'card.boost', 'amount', 10, 'params', '{"card": "x"}'::jsonb)));
  if (said ->> 'applied')::boolean or said ->> 'reason' is distinct from 'already settled' then raise exception 'a retried window answers already settled: %', said; end if;
end $$;
