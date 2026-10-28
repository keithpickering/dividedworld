-- The wallet, the standing and the settlement's writes (supabase/migrations/0003_aura.sql).
-- Plan Task 7.

do $$
declare
  ann uuid := tests.account('w-ann');
  bob uuid := tests.account('w-bob');
  a uuid := tests.character(ann, 'Wallet One');
  a2 uuid := tests.character(ann, 'Wallet Two');
  b uuid := tests.character(bob, 'Wallet Three');
  w1 timestamptz := '2026-11-01T08:17:00Z';
  w2 timestamptz := '2026-11-02T08:17:00Z';
  w3 timestamptz := '2026-11-03T08:17:00Z';
  w4 timestamptz := '2026-11-04T08:17:00Z';
  said jsonb;
  bal integer;
  refused boolean;
begin
  -- A window applied twice is written once.
  said := apply_settlement(w1, w2, jsonb_build_array(
    jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 350),
    jsonb_build_object('player', ann, 'character', a2, 'reason', 'alpha.cheered', 'amount', 400),
    jsonb_build_object('player', bob, 'character', b, 'reason', 'alpha.groaned', 'amount', -20)), '{"alpha": 730}');
  if not (said ->> 'applied')::boolean then raise exception 'the first application should apply: %', said; end if;
  said := apply_settlement(w1, w2, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 350)));
  if (said ->> 'applied')::boolean then raise exception 'a window was applied twice'; end if;
  if (select count(*) from ledger l join settlements x on x.id = l.settlement where x.starts_at = w1) <> 3
     or (select count(*) from settlements where starts_at = w1) <> 1 then raise exception 'the second application wrote something'; end if;

  -- The wallet caps at 600 and the standing keeps all of it; a hostile entry floors at zero.
  select balance into bal from wallets where account = ann;
  if bal <> 600 then raise exception 'ann''s wallet should cap at 600, holds %', bal; end if;
  if (select overflow from wallet_events where account = ann) <> 150 then raise exception 'the overflow should be recorded'; end if;
  if (select amount from standings where character = a) <> 350 or (select amount from standings where character = a2) <> 400 then
    raise exception 'the standings should keep all of it';
  end if;
  select balance into bal from wallets where account = bob;
  if bal <> 0 then raise exception 'bob''s wallet should stay at zero, holds %', bal; end if;
  if (select floored from wallet_events where account = bob) <> 20 then raise exception 'the floor should be recorded'; end if;
  if (select amount from standings where character = b) <> -20 then raise exception 'the standing goes below zero; the wallet does not'; end if;

  -- The next window follows on; a gap or an overlap is refused.
  refused := false;
  begin perform apply_settlement(w3, w4, '[]');
  exception when invalid_parameter_value then refused := true; end;
  if not refused then raise exception 'a window with a gap before it was applied'; end if;
  refused := false;
  begin perform apply_settlement(w1 + interval '1 hour', w3, '[]');
  exception when invalid_parameter_value then refused := true; end;
  if not refused then raise exception 'an overlapping window was applied'; end if;
  said := apply_settlement(w2, w3, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.groaned', 'amount', -45)));
  if (select balance from wallets where account = ann) <> 555 then raise exception 'a debit from the cap'; end if;

  -- An entry for a character its player does not play, or an amount that is not whole, applies nothing.
  refused := false;
  begin perform apply_settlement(w3, w4, jsonb_build_array(jsonb_build_object('player', bob, 'character', a, 'reason', 'alpha.cheered', 'amount', 10)));
  exception when invalid_parameter_value then refused := true; end;
  if not refused then raise exception 'an entry crediting another player''s character was applied'; end if;
  refused := false;
  begin perform apply_settlement(w3, w4, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 1.5)));
  exception when invalid_parameter_value then refused := true; end;
  if not refused then raise exception 'a fractional amount was applied'; end if;
  refused := false;
  begin perform apply_settlement(w3, w4, '[]', '{"alpha": 2.5}');
  exception when invalid_parameter_value then refused := true; end;
  if not refused then raise exception 'a fractional class total was applied'; end if;
  refused := false;
  begin perform apply_settlement(w3, w4, '[]', '{"ghost": 2}');
  exception when invalid_parameter_value then refused := true; end;
  if not refused then raise exception 'a class total for no class was applied'; end if;
  if exists (select 1 from settlements where starts_at = w3) then raise exception 'a refused window left a settlement row'; end if;

  -- A wallet cannot be set past its bounds even by hand.
  refused := false;
  begin update wallets set balance = 601 where account = ann; exception when check_violation then refused := true; end;
  if not refused then raise exception 'a wallet was set past the cap'; end if;
  refused := false;
  begin update wallets set balance = -1 where account = ann; exception when check_violation then refused := true; end;
  if not refused then raise exception 'a wallet was set below zero'; end if;
  refused := false;
  begin update ledger set amount = 1; exception when raise_exception then refused := true; end;
  if not refused then raise exception 'a ledger row was edited'; end if;

  -- Another account reads neither the wallet, the ledger nor the wallet's history; standings are public.
  perform tests.become(bob);
  if exists (select 1 from wallets where account = ann) or exists (select 1 from ledger where account = ann)
     or exists (select 1 from wallet_events where account = ann) then
    raise exception 'another account read a wallet';
  end if;
  if (select amount from standings where character = a) <> 305 then raise exception 'a standing should be public'; end if;
  if not exists (select 1 from wallets where account = bob) then raise exception 'a player reads their own wallet'; end if;
  refused := false;
  begin perform apply_settlement(w3, w4, '[]'); exception when insufficient_privilege then refused := true; end;
  if not refused then raise exception 'a player applied a settlement'; end if;
  begin perform 1 from settlement_class_totals; refused := false; exception when insufficient_privilege then refused := true; end;
  if not refused then raise exception 'a player read what each class earned'; end if;
  perform tests.unbecome();
end $$;

-- ---- A standing changes only at a settlement ----
do $$
declare
  ann uuid := tests.account('st-ann');
  bob uuid := tests.account('st-bob');
  a uuid := tests.character(ann, 'Standing One');
  b uuid := tests.character(bob, 'Standing Two');
  p uuid := tests.post(a, tests.thread());
  before text;
  refused boolean := false;
begin
  select coalesce(jsonb_agg(s order by s.character), '[]')::text into before from standings s;
  perform tests.become(bob);
  perform react(p, b, 'up');
  begin insert into standings (character, season, amount) values (b, 1, 100);
  exception when insufficient_privilege then refused := true; end;
  perform tests.unbecome();
  if not refused then raise exception 'a player wrote a standing'; end if;
  if (select coalesce(jsonb_agg(s order by s.character), '[]')::text from standings s) <> before then
    raise exception 'a reaction moved a standing before any settlement';
  end if;
end $$;


