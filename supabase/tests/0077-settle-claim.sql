-- The settle run's claim, held until its window is applied (supabase/migrations/0073_settle_claim.sql):
-- docs/plans/2026-11-03-settle-claim-plan.md, built from docs/plans/2026-11-03-settle-claim-design.md.

-- A season's first window, whose end nobody knows in advance (0014). Earlier files commit settlements past now, so each case moves
-- them a century back, before the open season began (next_settlement_at is then null), inside a block it undoes; the claims are
-- cleared with them. The ledger keeps its rows: it is never edited or removed.
create function pg_temp.first_window() returns void language plpgsql as $$
begin
  update settlements set starts_at = starts_at - interval '100 years', ends_at = ends_at - interval '100 years';
  if exists (select 1 from seasons where starts_at <= (select max(ends_at) from settlements)) then raise exception 'the setup: no season holds the settlements moved back'; end if;
  delete from settlement_claims;
  if next_settlement_at(now()) is not null then raise exception 'the setup is a season''s first window, with no known end'; end if;
end $$;

-- A character of a fresh player's with a Turn waiting, asked two hours ago.
create function pg_temp.turning(label text, loudness text default 'silent') returns uuid language plpgsql as $$
declare ann uuid := tests.account(label); a uuid := tests.character(ann, label, 'alpha', now() - interval '60 days');
begin
  perform tests.become(ann);
  perform turn(a, 'beta', loudness, false, loudness = 'announced');
  perform tests.unbecome();
  update pending_turns set asked_at = now() - interval '2 hours' where character = a;
  return a;
end $$;

-- The reveal as the character's player: null where it went through, or the refusal's words.
create function pg_temp.reveal(a uuid) returns text language plpgsql as $$
declare t uuid := tests.thread('Settle claim reveal');
begin
  perform tests.become((select owner from characters where id = a));
  perform unmask(a, t, '');
  perform tests.unbecome();
  return null;
exception when others then
  perform tests.unbecome();
  return sqlerrm;
end $$;

create function pg_temp.claim(window_start timestamptz, window_end timestamptz) returns void language plpgsql as $$
begin
  perform tests.become_service();
  perform claim_settlement_window(window_start, window_end);
  perform tests.unbecome();
end $$;

create function pg_temp.refusal() returns text language sql as $$
  select 'this character''s Turn takes effect at the settlement now due; reveal once it has run, or withdraw the Turn'
$$;

-- ---- Task 1: a claim older than five minutes still refuses while its window is unsettled (the defect) ----
do $$
declare
  w_end timestamptz := now() - interval '1 hour';
  a uuid; said text;
begin
  begin
    perform pg_temp.first_window();
    a := pg_temp.turning('claim-slow');
    perform pg_temp.claim(w_end - interval '1 day', w_end);
    -- A busy window: the run claimed it six minutes ago and is still applying it.
    update settlement_claims set claimed_at = now() - interval '6 minutes' where settlement_claims.window_end = w_end;
    said := pg_temp.reveal(a);
    if said is distinct from pg_temp.refusal() then
      raise exception 'a reveal while a six-minute-old claim''s window is unsettled is refused, in the new words: %', said;
    end if;
    if exists (select 1 from acts where character = a and kind = 'unmask') then raise exception 'the refused reveal wrote nothing'; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- ---- Task 1: the known-end refusal says the same words ----
do $$
declare
  w_end timestamptz := now() - interval '1 hour';
  a uuid; said text;
begin
  begin
    perform pg_temp.first_window();
    -- Settled to a day before the open window's end: the end of the window a Turn asked two hours ago waits on is known, and past.
    insert into settlements (starts_at, ends_at, season) values (w_end - interval '2 days', w_end - interval '1 day', (select max(id) from seasons));
    a := pg_temp.turning('claim-known');
    if next_settlement_at(now() - interval '2 hours') is distinct from w_end then raise exception 'the setup: the Turn takes effect at an end already past'; end if;
    said := pg_temp.reveal(a);
    if said is distinct from pg_temp.refusal() then raise exception 'the known-end refusal says the new words: %', said; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- ---- Task 1: a claim on a window that has not yet ended refuses nothing ----
do $$
declare a uuid; said text;
begin
  begin
    perform pg_temp.first_window();
    a := pg_temp.turning('claim-future');
    -- A run called by hand with a future `until`.
    perform pg_temp.claim(now() - interval '1 day', now() + interval '1 hour');
    said := pg_temp.reveal(a);
    if said is not null then raise exception 'a claim on a window that ends after now blocks no reveal: %', said; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- ---- Task 1: a stale claim gives way once any settlement past its start is written, and the trigger deletes it ----
do $$
declare
  s timestamptz := now() - interval '1 day 1 hour';
  e1 timestamptz := now() - interval '3 hours';
  e2 timestamptz := now() - interval '1 hour';
  a uuid; said text;
begin
  begin
    perform pg_temp.first_window();
    a := pg_temp.turning('claim-stale');
    -- Two overlapping runs: one claimed S to E2, the other settled S to E1. And a claim on the window after E1, which that settlement
    -- does not void.
    perform pg_temp.claim(s, e2);
    perform pg_temp.claim(e1, e1 + interval '1 day');
    if pg_temp.reveal(a) is distinct from pg_temp.refusal() then raise exception 'the setup: the claim on S to E2 refuses'; end if;
    insert into settlements (starts_at, ends_at, season) values (s, e1, (select max(id) from seasons));
    if exists (select 1 from settlement_claims k where k.window_end = e2) then raise exception 'the settlement from S to E1 deleted the claim from S to E2'; end if;
    if not exists (select 1 from settlement_claims k where k.window_start = e1) then raise exception 'a claim starting at the settlement''s end is kept'; end if;
    -- The claim on E1 onward has not ended, and the Turn now waits on the known end E1 + 1 day: nothing refuses.
    said := pg_temp.reveal(a);
    if said is not null then raise exception 'a stale claim refuses nothing once a settlement past its start is written: %', said; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- ---- Task 1: a claim on a window ending before the Turn was asked does not cover it (carried from 0076) ----
do $$
declare
  w_end timestamptz := now() - interval '1 hour';
  a uuid; said text;
begin
  begin
    perform pg_temp.first_window();
    a := pg_temp.turning('claim-earlier');
    update pending_turns set asked_at = w_end + interval '10 minutes' where character = a;
    perform pg_temp.claim(w_end - interval '1 day', w_end);
    said := pg_temp.reveal(a);
    if said is not null then raise exception 'a claim on a window that ends before the Turn was asked leaves the reveal be: %', said; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- ---- Task 1: claimed twice, one row, with the second claim's start ----
do $$
declare w_end timestamptz := now() - interval '1 hour';
begin
  begin
    perform pg_temp.first_window();
    perform pg_temp.claim(w_end - interval '1 day', w_end);
    update settlement_claims set claimed_at = now() - interval '1 hour' where settlement_claims.window_end = w_end;
    perform pg_temp.claim(w_end - interval '2 days', w_end);
    if (select count(*) from settlement_claims k where k.window_end = w_end) is distinct from 1::bigint then raise exception 'a window is claimed once'; end if;
    if (select k.window_start from settlement_claims k where k.window_end = w_end) is distinct from w_end - interval '2 days' then
      raise exception 'a second claim on a window sets its start afresh';
    end if;
    if (select k.claimed_at from settlement_claims k where k.window_end = w_end) is distinct from now() then raise exception 'a second claim is made now'; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- ---- Task 1: the claims are the service's alone ----
do $$
begin
  if has_table_privilege('authenticated', 'settlement_claims', 'select') or has_table_privilege('anon', 'settlement_claims', 'select') then
    raise exception 'no player reads the settle runs'' claims';
  end if;
  if has_function_privilege('authenticated', 'claim_settlement_window(timestamptz, timestamptz)', 'execute')
     or has_function_privilege('anon', 'claim_settlement_window(timestamptz, timestamptz)', 'execute') then
    raise exception 'no player claims a window';
  end if;
  if not has_function_privilege('service_role', 'claim_settlement_window(timestamptz, timestamptz)', 'execute') then raise exception 'the service claims a window'; end if;
  if to_regprocedure('claim_settlement_window(timestamptz)') is not null then raise exception 'the one-argument claim is gone'; end if;
end $$;
