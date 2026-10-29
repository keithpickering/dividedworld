-- One player, one vote per Act, across windows: what each window paid is stored with the
-- settlement and read by the next (supabase/migrations/0003_aura.sql's paid_votes,
-- 0004_schedule.sql's settlement_input). The owner's answer 2; the fix round's Task A.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('pv-ann');
  bob uuid := tests.account('pv-bob');
  a uuid := tests.character(ann, 'Paid Author');
  b uuid := tests.character(bob, 'Paid Voter');
  t uuid := tests.thread();
  p uuid := tests.post(a, t, 'Vote on me.', now() - interval '3 days');
  w1 timestamptz := '2026-11-01T08:17:00Z';
  w2 timestamptz := '2026-11-02T08:17:00Z';
  w3 timestamptz := '2026-11-03T08:17:00Z';
  half jsonb := '{"excitedPositive": 0.5, "excitedNegative": 0, "calmPositive": 0, "boredNegative": 0.5}';
  whole jsonb := '{"excitedPositive": 1, "excitedNegative": 0, "calmPositive": 0, "boredNegative": 0}';
  input jsonb;
begin
  -- The windows start where the history ends (a race file commits one).
  select coalesce(max(ends_at), w1) into w1 from settlements;
  w2 := w1 + interval '1 day';
  w3 := w2 + interval '1 day';

  perform apply_settlement(w1, w2, '[]', '{}', jsonb_build_array(jsonb_build_object('player', bob, 'act', p, 'weight', 1, 'shares', whole)));
  if (select shares from paid_votes where account = bob and act = p) is distinct from whole then raise exception 'a window''s paid vote is stored'; end if;

  -- A retry of the same window writes nothing again.
  perform apply_settlement(w1, w2, '[]', '{}', jsonb_build_array(jsonb_build_object('player', bob, 'act', p, 'weight', 1, 'shares', half)));
  if (select shares from paid_votes where account = bob and act = p) is distinct from whole then raise exception 'a retried window paid a difference twice'; end if;

  -- The next settlement reads it back for the Act a reaction touches.
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values (p, bob, b, 'up', 1, w2 + interval '1 hour');
  input := settlement_input(w2, w3);
  if input -> 'paid' is distinct from jsonb_build_array(jsonb_build_object('player', bob, 'act', p, 'weight', 1, 'shares', whole)) then
    raise exception 'settlement_input should carry what was paid for the votes it touches: %', input -> 'paid';
  end if;

  -- A later window's shares are stored at the weight the vote was given; a new weight is refused.
  if coalesce(pg_temp.refusal(format('select apply_settlement(%L, %L, %L, %L, %L)', w2, w3, '[]', '{}',
       jsonb_build_array(jsonb_build_object('player', bob, 'act', p, 'weight', 0.5, 'shares', half)))), '') not like '%weight%' then
    raise exception 'a vote''s weight changed after the window it was given in';
  end if;
  perform apply_settlement(w2, w3, '[]', '{}', jsonb_build_array(jsonb_build_object('player', bob, 'act', p, 'weight', 1, 'shares', half)));
  if (select shares from paid_votes where account = bob and act = p) is distinct from half then raise exception 'the later shares are stored'; end if;

  -- Shares that are not one vote across the four quadrants, and a weight outside the halving's range, are refused.
  if pg_temp.refusal(format('select apply_settlement(%L, %L, %L, %L, %L)', w3, w3 + interval '1 day', '[]', '{}',
       jsonb_build_array(jsonb_build_object('player', ann, 'act', p, 'weight', 1, 'shares', '{"excitedPositive": 2}')))) is null then
    raise exception 'malformed shares were stored';
  end if;
  if pg_temp.refusal(format('select apply_settlement(%L, %L, %L, %L, %L)', w3, w3 + interval '1 day', '[]', '{}',
       jsonb_build_array(jsonb_build_object('player', ann, 'act', p, 'weight', 3, 'shares', whole)))) is null then
    raise exception 'a weight above one vote was stored';
  end if;

  -- A vote whose halving ran to nothing is stored at a weight of 0, never refused.
  perform apply_settlement(w3, w3 + interval '1 day', '[]', '{}', jsonb_build_array(jsonb_build_object('player', ann, 'act', p, 'weight', 0, 'shares', whole)));
  if (select weight from paid_votes where account = ann and act = p) is distinct from 0 then raise exception 'a weight of 0 is stored'; end if;

  -- Who voted how is private: no player reads it.
  perform tests.become(bob);
  begin
    perform 1 from paid_votes;
    raise exception 'a player read paid_votes';
  exception when insufficient_privilege then null;
  end;
  perform tests.unbecome();
end $$;
