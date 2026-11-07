-- settlement_input's `paid` holds every reactor's paid vote on each Act a window's reactions touch, not only the votes of players
-- who reacted in that window (0116_tweener_standings.sql; docs/plans/2026-11-07-tweener-design.md, section 9). The Tweener's balance
-- reads everyone's reactions on an Act whenever it settles, so a player who voted earlier and did not react again must still have the
-- vote they were paid for in the input.
--
-- Poison: the join 0092 wrote, on (act, reactor_account) from the window's reactions. The last block of the first test runs that
-- join on the same fixture and requires it to lose A's row, so the check below is shown to detect the defect it exists for.

do $$
declare
  ann uuid := tests.account('tw-ann');
  bob uuid := tests.account('tw-bob');
  cat uuid := tests.account('tw-cat');
  a uuid := tests.character(ann, 'Tweener Voter A');
  b uuid := tests.character(bob, 'Tweener Voter B');
  c uuid := tests.character(cat, 'Tweener Author');
  t uuid := tests.thread();
  p uuid := tests.post(c, t, 'Vote on me.', now() - interval '9 days');
  q uuid := tests.post(c, t, 'Nobody votes on me in the window.', now() - interval '9 days');
  w1 timestamptz;
  w2 timestamptz;
  w3 timestamptz;
  whole jsonb := '{"excitedPositive": 1, "excitedNegative": 0, "calmPositive": 0, "boredNegative": 0}';
  input jsonb;
  old_paid jsonb;
begin
  select coalesce(max(ends_at), '2026-11-01T08:17:00Z') into w1 from settlements;
  w2 := w1 + interval '1 day';
  w3 := w2 + interval '1 day';

  -- A reacted to p in the first window and was paid for it there; A also has a paid vote on q.
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values (p, ann, a, 'up', 1, w1 + interval '1 hour');
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values (q, ann, a, 'up', 1, w1 + interval '2 hours');
  perform apply_settlement(w1, w2, '[]', '{}', jsonb_build_array(
    jsonb_build_object('player', ann, 'act', p, 'weight', 1, 'shares', whole),
    jsonb_build_object('player', ann, 'act', q, 'weight', 1, 'shares', whole)));

  -- (2) A window in which nobody reacted to p or q carries neither paid vote.
  input := settlement_input(w2, w3);
  if input -> 'paid' is distinct from '[]'::jsonb then
    raise exception 'a window with no reaction on an Act should carry none of its paid votes: %', input -> 'paid';
  end if;

  -- (1) B reacts to p in the second window; A's earlier paid vote on p is in the input, and A's on q (untouched) is not.
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values (p, bob, b, 'up', 1, w2 + interval '1 hour');
  input := settlement_input(w2, w3);
  if input -> 'paid' is distinct from jsonb_build_array(jsonb_build_object('player', ann, 'act', p, 'weight', 1, 'shares', whole)) then
    raise exception 'settlement_input should carry A''s earlier paid vote on an Act B reacted to in the window, and only that: %', input -> 'paid';
  end if;

  -- The poison: 0092's join, over the same fixture, loses A's row. The check above is red on it.
  select coalesce(jsonb_agg(jsonb_build_object('player', p2.account, 'act', p2.act, 'weight', p2.weight, 'shares', p2.shares) order by p2.account, p2.act), '[]')
    into old_paid
    from paid_votes p2 join (select distinct act, reactor_account from reactions where created_at >= w2 and created_at < w3) w
      on w.act = p2.act and w.reactor_account = p2.account;
  if old_paid = input -> 'paid' then
    raise exception 'the poison (0092''s join on the reactor) should miss A''s paid vote, and did not: the first check cannot tell';
  end if;
end $$;

create function pg_temp.explain_lines(stmt text) returns setof text language plpgsql as $$
declare line text;
begin
  for line in execute 'explain ' || stmt loop return next line; end loop;
end $$;

-- (3) The paid read goes through paid_votes_act. A busy fixture: 50 players' paid votes on each of 400 posts, so 20,000 rows, and a
-- window whose reactions touch one post. The statement is the function's own `paid` join; the function body is also required to
-- say it, since a plan of a copy cannot show what the function runs.
do $$
declare
  author uuid := tests.character(tests.account('tw-busy-author'), 'Busy Author');
  t uuid := tests.thread();
  s bigint;
  plan text;
  target uuid;
begin
  insert into acts (character, kind, thread, payload, created_at)
    select author, 'post', t, jsonb_build_object('body', 'p' || g), now() - interval '9 days' from generate_series(1, 400) g;
  insert into auth.users (email) select 'tw-busy-' || g || '@test.invalid' from generate_series(1, 50) g;
  insert into accounts (id, created_at) select id, '2000-01-01T00:00:00Z' from auth.users where email ~ '^tw-busy-[0-9]+@test.invalid$';
  perform apply_settlement(w, w + interval '1 day', '[]', '{}', '[]') from (select coalesce(max(ends_at), '2026-11-01T08:17:00Z') as w from settlements) x;
  select max(id) into s from settlements;
  insert into paid_votes (account, act, weight, shares, settlement)
    select u.id, a.id, 1, '{"excitedPositive": 1, "excitedNegative": 0, "calmPositive": 0, "boredNegative": 0}', s
    from auth.users u cross join acts a where u.email ~ '^tw-busy-[0-9]+@test.invalid$' and a.thread = t;
  analyze paid_votes;
  select id into target from acts where thread = t limit 1;

  select string_agg(l, E'\n') into plan from pg_temp.explain_lines(format($q$select p.account, p.act from paid_votes p join (select %L::uuid as act) r on r.act = p.act$q$, target)) l;
  if plan not like '%paid_votes_act%' then
    raise exception 'the paid read should use paid_votes_act, the plan is: %', plan;
  end if;
  if pg_get_functiondef('settlement_input(timestamptz, timestamptz)'::regprocedure) not like '%from paid_votes p join reacted r on r.act = p.act%' then
    raise exception 'settlement_input''s paid should read paid_votes joined to reacted on the Act';
  end if;
end $$;
