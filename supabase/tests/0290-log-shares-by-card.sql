-- A share finds its line by its card (supabase/migrations/0290_log_shares_by_card.sql; docs/plans/2026-11-12-log-shares-by-card-plan.md, Task 1; issue #470 F1).
-- Two card.ride entries of one character in one settlement, naming cards x and y, hold a share each on the same Act and quadrant; an entry naming no card holds one too.
-- my_ledger_shares and log_page's shares say which card's line each belongs to. The column is read as to_jsonb(s) ->> 'card' so a missing column fails an assertion, not the parse.

do $$
declare
  ann uuid := tests.account('lsc-ann');
  bob uuid := tests.account('lsc-bob');
  a uuid := tests.character(ann, 'Lsc Ann');
  b uuid := tests.character(bob, 'Lsc Bob');
  t uuid := tests.thread();
  p1 uuid := tests.post(a, t, 'One.');
  w1 timestamptz := coalesce((select max(ends_at) from settlements), '2030-01-01T00:00:00Z');
  w2 timestamptz := w1 + interval '1 day';
  said jsonb;
  sid bigint;
  old_ledger bigint;
  doc jsonb;
  got text;
begin
  -- The card y is sent before the card x, entry and share, so the order log_page reads them in is its own and never the order they were written in.
  said := apply_settlement(w1, w2, jsonb_build_array(
      jsonb_build_object('player', ann, 'character', a, 'reason', 'card.ride', 'amount', 4, 'params', '{"card": "y"}'::jsonb),
      jsonb_build_object('player', ann, 'character', a, 'reason', 'card.ride', 'amount', 10, 'params', '{"card": "x"}'::jsonb),
      jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 3),
      jsonb_build_object('player', bob, 'character', b, 'reason', 'alpha.cheered', 'amount', 2)),
    '{}', '[]',
    jsonb_build_array(
      jsonb_build_object('character', a, 'reason', 'card.ride', 'card', 'y', 'act', p1, 'quadrant', 'excitedPositive', 'amount', 4),
      jsonb_build_object('character', a, 'reason', 'card.ride', 'card', 'x', 'act', p1, 'quadrant', 'excitedPositive', 'amount', 10),
      jsonb_build_object('character', a, 'reason', 'alpha.cheered', 'act', p1, 'quadrant', 'excitedPositive', 'amount', 3),
      jsonb_build_object('character', b, 'reason', 'alpha.cheered', 'act', p1, 'quadrant', 'excitedPositive', 'amount', 2)));
  if not (said ->> 'applied')::boolean then raise exception 'the settlement should apply: %', said; end if;
  sid := (said ->> 'settlement')::bigint;

  -- A share written before this migration: a ledger row naming a card and a share of it, inserted as 0150 left them.
  insert into ledger (settlement, account, character, reason, amount, params) values (sid, ann, a, 'card.skim', 7, '{"card": "z"}'::jsonb) returning id into old_ledger;
  insert into ledger_shares (ledger, act, quadrant, amount) values (old_ledger, p1, 'excitedPositive', 7);

  perform tests.become(ann);
  if (select count(*) from my_ledger_shares) is distinct from 4::bigint then raise exception 'Ann reads her four shares, read %', (select count(*) from my_ledger_shares); end if;
  select to_jsonb(s) ->> 'card' into got from my_ledger_shares s where s.reason = 'card.ride' and s.amount = 10;
  if got is distinct from 'x' then raise exception 'the 10 share reads card x, read %', got; end if;
  select to_jsonb(s) ->> 'card' into got from my_ledger_shares s where s.reason = 'card.ride' and s.amount = 4;
  if got is distinct from 'y' then raise exception 'the 4 share reads card y, read %', got; end if;
  if (select count(*) from my_ledger_shares s where s.reason = 'alpha.cheered' and to_jsonb(s) ->> 'card' is null) is distinct from 1::bigint then
    raise exception 'the share of the entry naming no card reads card null';
  end if;
  select to_jsonb(s) ->> 'card' into got from my_ledger_shares s where s.reason = 'card.skim';
  if got is distinct from 'z' then raise exception 'a share written before this reads its ledger row''s card, read %', got; end if;

  -- The columns are exactly these.
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'my_ledger_shares')
       is distinct from array['settlement', 'character', 'reason', 'act', 'quadrant', 'amount', 'card'] then
    raise exception 'my_ledger_shares columns: %', (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'my_ledger_shares');
  end if;

  -- log_page carries the same rows with card, ordered settlement desc, character, reason, card, act, quadrant.
  doc := log_page(null);
  if doc -> 'shares' is distinct from (select jsonb_agg(to_jsonb(r)) from (
       select settlement, character, reason, act, quadrant, amount, to_jsonb(s) ->> 'card' as card from my_ledger_shares s
       order by settlement desc, character, reason, to_jsonb(s) ->> 'card', act, quadrant) r) then
    raise exception 'log_page shares: %', doc -> 'shares';
  end if;
  if (select array_agg(x ->> 'card' order by ord) from jsonb_array_elements(doc -> 'shares') with ordinality as e(x, ord) where x ->> 'reason' = 'card.ride') is distinct from array['x', 'y'] then
    raise exception 'log_page orders the two card lines by card: %', doc -> 'shares';
  end if;
  perform tests.unbecome();

  -- Bob reads none of Ann's.
  perform tests.become(bob);
  if exists (select 1 from my_ledger_shares s where s.character = a) or exists (select 1 from jsonb_array_elements(log_page(null) -> 'shares') x where x ->> 'character' = a::text) then
    raise exception 'Bob reads one of Ann''s shares';
  end if;
  if (select count(*) from my_ledger_shares) is distinct from 1::bigint then raise exception 'Bob reads his one share'; end if;
  perform tests.unbecome();
end $$;
