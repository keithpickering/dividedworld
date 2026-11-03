-- Cost at scale (supabase/migrations/0073_followed_ranked.sql): docs/plans/2026-11-03-cost-at-scale-plan.md.
-- Task 1: my_settlement_moved answers the caller's own count and time for one settlement.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The migration exists at all (so a missing one fails here, on an assertion, and not on a missing function below).
do $$
begin
  if to_regprocedure('my_settlement_moved(bigint)') is null then raise exception 'my_settlement_moved(bigint) exists'; end if;
end $$;

-- ---- Task 1: my_settlement_moved ----
do $$
declare
  ann uuid := tests.account('fr-ann'); bob uuid := tests.account('fr-bob'); cat uuid := tests.account('fr-cat');
  a1 uuid; a2 uuid; b1 uuid;
  sid bigint; applied timestamptz := now() - interval '2 hours';
  got record; n integer;
begin
  a1 := tests.character(ann, 'Fr Ann One');
  a2 := tests.character(ann, 'Fr Ann Two');
  b1 := tests.character(bob, 'Fr Bob One');
  perform tests.character(cat, 'Fr Cat One');
  -- A settlement that moved two of Ann's characters (three lines) and one of Bob's; Cat has none.
  insert into settlements (starts_at, ends_at, season, applied_at)
  values (now() - interval '3 days', now() - interval '2 days', (select min(id) from seasons), applied) returning id into sid;
  insert into ledger (settlement, account, character, reason, amount) values
    (sid, ann, a1, 'post.reacted', 120), (sid, ann, a1, 'post.quoted', 30), (sid, ann, a2, 'post.reacted', -20), (sid, bob, b1, 'post.reacted', 50);

  perform tests.become(ann);
  select * into got from my_settlement_moved(sid);
  if got.count is distinct from 2 or got.applied_at is distinct from applied then
    raise exception 'the caller''s count is of characters moved (two, of three lines) and the time applied: %', got;
  end if;
  if (select count(*) from my_settlement_moved(sid)) is distinct from 1 then raise exception 'one row for the one settlement'; end if;
  if exists (select 1 from my_settlement_moved(sid + 100000)) then raise exception 'an id nothing holds answers no row'; end if;

  perform tests.become(bob);
  select * into got from my_settlement_moved(sid);
  if got.count is distinct from 1 then raise exception 'Bob''s count is his own character alone: %', got; end if;

  perform tests.become(cat);
  select count(*) into n from my_settlement_moved(sid);
  if n <> 0 then raise exception 'another account gets no row for the same id: %', n; end if;

  -- Visitors
  perform tests.become_anon();
  if has_function_privilege('anon', 'my_settlement_moved(bigint)', 'execute') then raise exception 'anon cannot execute my_settlement_moved'; end if;
  if pg_temp.refusal(format('select * from my_settlement_moved(%s)', sid)) is null then raise exception 'a visitor reads no settlement'; end if;
  perform tests.unbecome();
end $$;
