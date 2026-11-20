-- boot's newestSettlement counts crowd pay (supabase/migrations/0386_crowd_boot.sql; docs/plans/2026-11-20-crowd-pay-plan.md, Task 5): a settlement whose only line of the caller's is crowd pay is the newest settlement of
-- hers, so it opens the summary on the first load; another player's crowd row moves nothing of hers.

do $$
declare
  ann uuid := tests.account('cb-ann'); bob uuid := tests.account('cb-bob');
  a uuid := tests.character(ann, 'Cb Ann'); b uuid := tests.character(bob, 'Cb Bob');
  t uuid := tests.thread('Cb thread');
  s1 bigint; s2 bigint; s3 bigint; pa uuid; pb uuid;
  e1 timestamptz := date_trunc('second', now() + interval '3000 days');
  e2 timestamptz := date_trunc('second', now() + interval '3002 days');
  e3 timestamptz := date_trunc('second', now() + interval '3004 days');
  got jsonb;
begin
  pa := tests.post(a, t, 'Ann.', now()); pb := tests.post(b, t, 'Bob.', now());
  insert into settlements (starts_at, ends_at, season) values (e1 - interval '1 day', e1, (select id from seasons order by starts_at limit 1)) returning id into s1;
  insert into settlements (starts_at, ends_at, season) values (e2 - interval '1 day', e2, (select id from seasons order by starts_at limit 1)) returning id into s2;
  insert into settlements (starts_at, ends_at, season) values (e3 - interval '1 day', e3, (select id from seasons order by starts_at limit 1)) returning id into s3;
  insert into ledger (settlement, account, character, reason, amount) values (s1, ann, a, 'post.liked', 3);
  -- Ann has a ledger line in s1 and crowd pay alone in s2; Bob has crowd pay alone in the newer s3.
  insert into crowd_paid (settlement, account, act, most) values (s2, ann, pb, 10), (s3, bob, pa, 10);
  perform tests.become(ann);
  got := boot();
  perform tests.unbecome();
  if (got ->> 'newestSettlement')::timestamptz is distinct from e2 then raise exception 'crowd pay alone is the newest settlement of hers (wanted %): %', e2, got -> 'newestSettlement'; end if;
  perform tests.become(bob);
  got := boot();
  perform tests.unbecome();
  if (got ->> 'newestSettlement')::timestamptz is distinct from e3 then raise exception 'Bob''s own crowd pay is his newest (wanted %): %', e3, got -> 'newestSettlement'; end if;
end $$;
