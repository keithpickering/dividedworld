-- Two refusals (docs/plans/2026-11-11-plain-words-plan.md, Task 9): unmask's claim arm skips a character whose reveal the settlement
-- already reads, and wallet_spend names a price as orbs.

create function pg_temp.first_window() returns void language plpgsql as $$
begin
  update settlements set starts_at = starts_at - interval '100 years', ends_at = ends_at - interval '100 years';
  delete from settlement_claims;
  if next_settlement_at(now()) is not null then raise exception 'the setup is a season''s first window, with no known end'; end if;
end $$;

create function pg_temp.turning(label text) returns uuid language plpgsql as $$
declare ann uuid := tests.account(label); a uuid := tests.character(ann, label, 'alpha', now() - interval '60 days');
begin
  perform tests.become(ann);
  perform turn(a, 'beta', 'silent', false, false);
  perform tests.unbecome();
  update pending_turns set asked_at = now() - interval '2 hours' where character = a;
  return a;
end $$;

create function pg_temp.reveal(a uuid) returns text language plpgsql as $$
declare t uuid := tests.thread('Two refusals reveal');
begin
  perform tests.become((select owner from characters where id = a));
  perform unmask(a, t, '');
  perform tests.unbecome();
  return null;
exception when others then
  perform tests.unbecome();
  return sqlerrm;
end $$;

create function pg_temp.settlement_words() returns text language sql as $$
  select 'this character''s Turn takes effect at the settlement now due; reveal once it has run, or withdraw the Turn'
$$;

-- A first window, a reveal, the run's claim, a second reveal: not the settlement's words; the class-already-public rule answers.
do $$
declare a uuid; said text;
begin
  begin
    perform pg_temp.first_window();
    a := pg_temp.turning('two-claim');
    said := pg_temp.reveal(a);
    if said is not null then raise exception 'the setup: the first reveal goes through: %', said; end if;
    perform tests.become_service();
    perform claim_settlement_window(now() - interval '1 day', now() - interval '1 hour');
    perform tests.unbecome();
    said := pg_temp.reveal(a);
    if said = pg_temp.settlement_words() then raise exception 'a reveal the settlement already reads is not refused as waiting on it'; end if;
    if said is distinct from 'that character''s class is already public; after a Turn, the new class can be revealed' then
      raise exception 'the second reveal is refused by the class already being public: %', said;
    end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- A pending Turn and no earlier reveal is still refused, in the same words, while a claim holds its window.
do $$
declare a uuid; said text;
begin
  begin
    perform pg_temp.first_window();
    a := pg_temp.turning('two-pending');
    perform tests.become_service();
    perform claim_settlement_window(now() - interval '1 day', now() - interval '1 hour');
    perform tests.unbecome();
    said := pg_temp.reveal(a);
    if said is distinct from pg_temp.settlement_words() then raise exception 'a pending Turn with no reveal is still refused: %', said; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- The claim arm reads the reveal as the settlement does (masks_change passes a Turn over for an unmask Act at or after the window's
-- end): one dated at the end rules the Turn out, one dated before it does not. The class is given a start after both reveals, so the
-- class-already-public rule, which answers first, does not hide which refusal the claim arm gives. That state is built by hand: no
-- player reaches it today (0153's header says why), and this holds the arm's own condition.
do $$
declare
  w_end timestamptz := now() - interval '1 hour';
  t uuid := tests.thread('Two refusals claim arm');
  a uuid; b uuid; said text;
begin
  begin
    perform pg_temp.first_window();
    a := pg_temp.turning('two-arm-at');
    b := pg_temp.turning('two-arm-before');
    perform write_unmask(a, t, 'act', w_end);
    perform write_unmask(b, t, 'act', w_end - interval '1 minute');
    update class_history set started_at = now() - interval '10 minutes' where character in (a, b);
    perform tests.become_service();
    perform claim_settlement_window(w_end - interval '1 day', w_end);
    perform tests.unbecome();
    said := pg_temp.reveal(a);
    if said is not null then raise exception 'a reveal dated at the window''s end rules the Turn out, so the claim does not refuse: %', said; end if;
    said := pg_temp.reveal(b);
    if said is distinct from pg_temp.settlement_words() then raise exception 'a reveal dated before the window''s end is not read by the settlement: %', said; end if;
    raise exception 'undone' using errcode = 'KB001';
  exception when sqlstate 'KB001' then null;
  end;
end $$;

-- A purchase of 3.00 against a wallet of 1.50.
do $$
declare ann uuid := tests.account('two-wallet'); said text;
begin
  begin
    insert into wallets (account, balance) values (ann, 150) on conflict (account) do update set balance = 150;
    perform wallet_spend(ann, 300, 'purchase', null);
    raise exception 'the purchase was not refused';
  exception when sqlstate 'P0001' then said := sqlerrm;
  end;
  if said is distinct from 'that costs 3.00, and your wallet holds 1.50' then raise exception 'the refusal names the price as orbs: %', said; end if;
end $$;
