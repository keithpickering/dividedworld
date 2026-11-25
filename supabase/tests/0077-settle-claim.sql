-- The settle run's claim, held until its window is applied (supabase/migrations/0074_settle_claim.sql):
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
    -- A busy window: the run claimed it six minutes ago, past 0073's five-minute clock, and is still applying it.
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

-- ---- Task 1: a claim made after a settlement past its start (a late run on a window already applied) refuses nothing ----
do $$
declare
  s timestamptz := now() - interval '1 day 1 hour';
  e1 timestamptz := now() - interval '3 hours';
  a uuid; said text;
begin
  begin
    perform pg_temp.first_window();
    a := pg_temp.turning('claim-late');
    insert into settlements (starts_at, ends_at, season) values (s, e1, (select max(id) from seasons));
    perform pg_temp.claim(s, now() - interval '1 hour');
    said := pg_temp.reveal(a);
    if said is not null then raise exception 'a claim made after a settlement past its start blocks no reveal: %', said; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- ---- Task 1: a claim's window ends after it starts ----
do $$
declare w_end timestamptz := now() - interval '1 hour'; code text;
begin
  begin
    perform pg_temp.claim(w_end, w_end);
  exception when others then code := sqlstate; perform tests.unbecome();
  end;
  if code is distinct from '23514' then raise exception 'a claim on a window that does not end after it starts is refused by its check: %', code; end if;
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

-- ---- Task 2: a Turn never takes effect behind a reveal (the backstop) ----

-- Whether an announcement of a Turn is the character's.
create function pg_temp.tallied(a uuid) returns boolean language sql as $$
  select exists (select 1 from acts x where x.kind = 'announce' and x.character = a and x.payload ->> 'what' = 'turn')
$$;

create function pg_temp.class_due_at(a uuid) returns timestamptz language plpgsql as $$
declare due timestamptz;
begin
  perform tests.become((select owner from characters where id = a));
  select m.class_due_at into due from my_characters m where m.id = a;
  perform tests.unbecome();
  return due;
end $$;

-- A reveal dated after the window's end and before its settlement (the round trip before the claim): the Turn waits for the next.
do $$
declare
  w1 timestamptz := now() - interval '1 hour';
  w2 timestamptz := now() - interval '30 minutes';
  t uuid := tests.thread('Settle claim backstop');
  a uuid;
begin
  begin
    a := pg_temp.turning('backstop-late', 'announced');
    perform write_unmask(a, t, 'act', w1 + interval '1 minute');
    perform masks_change(w1);
    if (select class_key from class_now(a, 'infinity')) is distinct from 'alpha' then raise exception 'a Turn passed over by the backstop has not taken effect'; end if;
    if (select p.due_at from pending_turns p where p.character = a) is distinct from w1 then
      raise exception 'the Turn still waits, due at the window it was passed over at: %', (select to_jsonb(p) from pending_turns p where p.character = a);
    end if;
    if pg_temp.tallied(a) then raise exception 'no announcement names a Turn that did not take effect'; end if;
    -- At the next window it lands, with the date it was due at, and its announcement at the window it took effect at.
    perform masks_change(w2);
    if (select class_key from class_now(a, 'infinity')) is distinct from 'beta' then raise exception 'the passed-over Turn lands at the next window'; end if;
    if exists (select 1 from pending_turns p where p.character = a) then raise exception 'a Turn that landed no longer waits'; end if;
    if (select h.due_at from class_history h where h.character = a and h.class_key = 'beta') is distinct from w1 then raise exception 'class_history says when the Turn was due'; end if;
    if (select h.started_at from class_history h where h.character = a and h.class_key = 'beta') is distinct from w2 then raise exception 'the Turn took effect at the second window'; end if;
    if pg_temp.class_due_at(a) is distinct from w1 then raise exception 'my_characters says when the Turn was due: %', pg_temp.class_due_at(a); end if;
    if (select x.created_at from acts x where x.kind = 'announce' and x.character = a and x.payload ->> 'what' = 'turn') is distinct from w2 then
      raise exception 'an announced Turn''s announcement is at the window it took effect at';
    end if;
    -- The announcement carries nothing that marks the Turn as late.
    if exists (select 1 from acts x where x.kind = 'announce' and x.character = a and x.payload - 'what' - 'was' - 'class' <> '{}'::jsonb) then
      raise exception 'the announcement says nothing of when the Turn was due';
    end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- Passed over twice, it keeps the first window's end.
do $$
declare
  w1 timestamptz := now() - interval '1 hour';
  w2 timestamptz := now() - interval '30 minutes';
  t uuid := tests.thread('Settle claim backstop twice');
  a uuid;
begin
  begin
    a := pg_temp.turning('backstop-twice');
    perform write_unmask(a, t, 'act', w1 + interval '1 minute');
    perform masks_change(w1);
    perform write_unmask(a, t, 'act', w2 + interval '1 minute');
    perform masks_change(w2);
    if (select class_key from class_now(a, 'infinity')) is distinct from 'alpha' then raise exception 'passed over twice, the Turn still waits'; end if;
    if (select p.due_at from pending_turns p where p.character = a) is distinct from w1 then raise exception 'passed over twice, it keeps the first end'; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- A reveal dated before the window's end leaves the Turn to land at it, never due earlier.
do $$
declare
  w1 timestamptz := now() - interval '1 hour';
  t uuid := tests.thread('Settle claim backstop early');
  a uuid;
begin
  begin
    a := pg_temp.turning('backstop-early');
    perform write_unmask(a, t, 'act', w1 - interval '30 minutes');
    perform masks_change(w1);
    if (select class_key from class_now(a, 'infinity')) is distinct from 'beta' then raise exception 'a reveal before the window''s end does not hold back the Turn'; end if;
    if (select h.due_at from class_history h where h.character = a and h.class_key = 'beta') is not null then raise exception 'a Turn that landed when due has no due_at'; end if;
    if pg_temp.class_due_at(a) is not null then raise exception 'my_characters has no class_due_at for a Turn that landed when due'; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- Changing a passed-over Turn is a new ask, and clears due_at. Withdrawing it removes the row.
do $$
declare
  w1 timestamptz := now() - interval '1 hour';
  t uuid := tests.thread('Settle claim backstop changed');
  a uuid;
begin
  begin
    a := pg_temp.turning('backstop-changed');
    perform write_unmask(a, t, 'act', w1 + interval '1 minute');
    perform masks_change(w1);
    if (select p.due_at from pending_turns p where p.character = a) is null then raise exception 'the setup: the Turn was passed over'; end if;
    perform tests.become((select owner from characters where id = a));
    perform turn(a, 'beta', 'announced', true, false);
    perform tests.unbecome();
    if (select p.due_at from pending_turns p where p.character = a) is not null then raise exception 'a changed Turn is a new ask, with no due_at'; end if;
    perform tests.become((select owner from characters where id = a));
    perform withdraw_turn(a);
    perform tests.unbecome();
    if exists (select 1 from pending_turns p where p.character = a) then raise exception 'a withdrawn Turn no longer waits'; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- The reveals masks_change writes itself, at this window's end, hold back no Turn in the same settlement: a character that debuts
-- with its class and has a Turn waiting takes the Turn, and its debut names the class it took.
do $$
declare
  w1 timestamptz := now() - interval '1 hour';
  ann uuid := tests.account('backstop-debut');
  a uuid; b uuid;
begin
  begin
    insert into characters (owner, name, created_at, debut_loudness) values (ann, 'Backstop Debut', now() - interval '1 day', 'with_class') returning id into a;
    insert into class_history (character, class_key, started_at) values (a, 'alpha', now() - interval '1 day');
    insert into pending_turns (character, class_key, loudness, show_from, show_to, asked_at) values (a, 'beta', 'silent', false, false, now() - interval '2 hours');
    -- And another character whose Turn names its new class, so masks_change writes its reveal at this window's end too.
    b := pg_temp.turning('backstop-loud', 'announced');
    perform masks_change(w1);
    if (select class_key from class_now(a, 'infinity')) is distinct from 'beta' then raise exception 'a debut''s own reveal does not hold back its Turn'; end if;
    if (select class_key from class_now(b, 'infinity')) is distinct from 'beta' then raise exception 'a Turn''s own reveal does not hold back its Turn'; end if;
    if not exists (select 1 from acts x where x.character = a and x.kind = 'announce' and x.created_at = w1 and x.payload = '{"what": "debut", "class": "beta"}'::jsonb) then
      raise exception 'the debut names the class the Turn took';
    end if;
    if exists (select 1 from pending_turns p where p.character in (a, b)) then raise exception 'both Turns landed'; end if;
    -- Neither landed late: no record says either was due earlier.
    if exists (select 1 from class_history h where h.character in (a, b) and h.due_at is not null) then raise exception 'neither Turn waited'; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;
