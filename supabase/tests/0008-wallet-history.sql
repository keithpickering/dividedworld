-- A wallet's history and the seasons' shape (supabase/migrations/0003_aura.sql), in a file of
-- its own so its windows start the settlement history.

-- ---- A wallet's history adds up to its balance, through the cap lowered and a whole 1.0 ----
do $$
declare
  ann uuid := tests.account('h-ann');
  a uuid := tests.character(ann, 'History');
  -- From wherever the history ends: a race file before this one commits a window of its own.
  w1 timestamptz := coalesce((select max(ends_at) from settlements), '2030-01-01T00:00:00Z');
  w2 timestamptz := w1 + interval '1 day';
  w3 timestamptz := w1 + interval '2 days';
  w4 timestamptz := w1 + interval '3 days';
  ev record;
begin
  perform apply_settlement(w1, w2, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 500.0)));
  update settings set value = '300' where key = 'walletCap';
  perform apply_settlement(w2, w3, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 10)));
  if (select balance from wallets where account = ann) <> 300 then raise exception 'a credit after the cap was lowered should land at the new cap'; end if;
  select change, overflow into ev from wallet_events e join settlements x on x.id = e.settlement where e.account = ann and x.starts_at = w2;
  if ev.change <> -200 or ev.overflow <> 210 then raise exception 'the event should say the balance fell by 200 and 210 overflowed: % %', ev.change, ev.overflow; end if;
  perform apply_settlement(w3, w4, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.groaned', 'amount', -1000)));
  if (select sum(change) from wallet_events where account = ann) <> (select balance from wallets where account = ann) then
    raise exception 'the wallet''s history does not add up to its balance';
  end if;
  if (select amount from standings where character = a) <> -490 then raise exception 'the standing keeps every entry'; end if;
end $$;

-- ---- Seasons never overlap ----
do $$
declare refused boolean := false;
begin
  begin insert into seasons (number, starts_at, ends_at) values (99, '2001-01-01', '2001-02-01');
  exception when exclusion_violation then refused := true; end;
  if not refused then raise exception 'a season overlapping another was made'; end if;
end $$;
