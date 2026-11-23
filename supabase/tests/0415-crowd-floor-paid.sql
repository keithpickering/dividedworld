-- The crowd floor paid on a vote (0415, docs/plans/2026-11-23-crowd-floor-design.md section 5, the owner's answer on #1014): paid_votes.floored is the net floor paid on each
-- quadrant of one player's vote on one Act. apply_settlement writes what a settlement's paid votes carry, a vote that carries none is '{}', a row from before 0415 reads as '{}',
-- and settlement_input hands each paid vote's floored back.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('cf-ann');
  bob uuid := tests.account('cf-bob');
  cat uuid := tests.account('cf-cat');
  a uuid := tests.character(ann, 'Floor Author');
  b uuid := tests.character(bob, 'Floor Voter');
  t uuid := tests.thread();
  p uuid := tests.post(a, t, 'Floor me.', now() - interval '3 days');
  w1 timestamptz;
  w2 timestamptz;
  w3 timestamptz;
  whole jsonb := '{"excitedPositive": 0, "excitedNegative": 0, "calmPositive": 1, "boredNegative": 0}';
  half jsonb := '{"excitedPositive": 0.5, "excitedNegative": 0, "calmPositive": 0.5, "boredNegative": 0}';
  input jsonb;
  got jsonb;
begin
  select coalesce(max(ends_at), '2026-11-01T08:17:00Z') into w1 from settlements;
  w2 := w1 + interval '1 day';
  w3 := w2 + interval '1 day';

  -- A window writes the floor its paid votes carry, and one that carries none writes none.
  perform apply_settlement(w1, w2, '[]', '{}', jsonb_build_array(
    jsonb_build_object('player', bob, 'act', p, 'weight', 1, 'shares', whole, 'floored', '{"calmPositive": 2}'::jsonb),
    jsonb_build_object('player', ann, 'act', p, 'weight', 1, 'shares', whole)));
  if (select floored from paid_votes where account = bob and act = p) is distinct from '{"calmPositive": 2}'::jsonb then
    raise exception 'apply_settlement should write the floor a paid vote carries, got %', (select floored from paid_votes where account = bob and act = p);
  end if;
  if (select floored from paid_votes where account = ann and act = p) is distinct from '{}'::jsonb then
    raise exception 'a paid vote that carries no floor writes none';
  end if;

  -- A row written before 0415 (no floored named) holds nothing paid.
  insert into paid_votes (account, act, weight, shares, settlement) values (cat, p, 1, whole, (select max(id) from settlements));
  if (select floored from paid_votes where account = cat and act = p) is distinct from '{}'::jsonb then
    raise exception 'a paid vote from before 0415 holds no floor, got %', (select floored from paid_votes where account = cat and act = p);
  end if;

  -- A retry of the same window writes nothing again.
  perform apply_settlement(w1, w2, '[]', '{}', jsonb_build_array(jsonb_build_object('player', bob, 'act', p, 'weight', 1, 'shares', whole, 'floored', '{"calmPositive": 9}'::jsonb)));
  if (select floored from paid_votes where account = bob and act = p) is distinct from '{"calmPositive": 2}'::jsonb then
    raise exception 'a retried window changed the floor paid';
  end if;

  -- The next window moves half the vote and takes half the floor back: the new floor replaces the old, beside the new shares.
  perform apply_settlement(w2, w3, '[]', '{}', jsonb_build_array(jsonb_build_object('player', bob, 'act', p, 'weight', 1, 'shares', half, 'floored', '{"calmPositive": 1}'::jsonb)));
  if (select floored from paid_votes where account = bob and act = p) is distinct from '{"calmPositive": 1}'::jsonb then
    raise exception 'the later window should replace the floor, got %', (select floored from paid_votes where account = bob and act = p);
  end if;

  -- A floor is amounts of at least 0 on the four quadrants.
  if coalesce(pg_temp.refusal(format('select apply_settlement(%L, %L, %L, %L, %L)', w3, w3 + interval '1 day', '[]', '{}',
       jsonb_build_array(jsonb_build_object('player', bob, 'act', p, 'weight', 1, 'shares', whole, 'floored', '{"calmPositive": -1}'::jsonb)))), '') not like '%crowd floor%' then
    raise exception 'a negative floor should be refused';
  end if;
  if coalesce(pg_temp.refusal(format('select apply_settlement(%L, %L, %L, %L, %L)', w3, w3 + interval '1 day', '[]', '{}',
       jsonb_build_array(jsonb_build_object('player', bob, 'act', p, 'weight', 1, 'shares', whole, 'floored', '{"sideways": 1}'::jsonb)))), '') not like '%crowd floor%' then
    raise exception 'a floor on a quadrant there is not should be refused';
  end if;

  -- settlement_input hands each paid vote's floor back, the vote from before 0415 as '{}'.
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values (p, bob, b, 'up', 1, w3 + interval '1 hour');
  input := settlement_input(w3, w3 + interval '1 day');
  got := (select x from jsonb_array_elements(input -> 'paid') x where x ->> 'player' = bob::text);
  if got -> 'floored' is distinct from '{"calmPositive": 1}'::jsonb then
    raise exception 'settlement_input should carry the floor paid on the vote, got %', got;
  end if;
  got := (select x from jsonb_array_elements(input -> 'paid') x where x ->> 'player' = cat::text);
  if got is null or got -> 'floored' is distinct from '{}'::jsonb then
    raise exception 'settlement_input should carry a vote from before 0415 with an empty floor, got %', got;
  end if;
end $$;
