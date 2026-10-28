-- Aura: the private wallet per player, the public standing per character, and the
-- settlement's writes.
--
-- Task 7 of docs/plans/2026-10-28-core-loop-engine-plan.md; the design's sections 4 and 8. The
-- amounts are computed in TypeScript (engine/rules/settle.ts) by the settlement job; this file
-- holds what must be true whatever that code does:
--   - a window is settled once, and windows follow one another with no gap and no overlap;
--   - a wallet stays between zero and the cap, and what either bound cut off is recorded;
--   - a standing moves only at a settlement;
--   - a ledger entry is never edited ("Append-only"), and names a character its account plays.
-- Every change to a wallet is a row in wallet_events, so the player's own log can say exactly
-- what moved and why ("The fiction may lie; the log never does").

-- A season: the standings' span. Its Turns and its reveal arrive with 0006.
create table seasons (
  id bigint generated always as identity primary key,
  number integer not null unique check (number >= 1),
  starts_at timestamptz not null,
  ends_at timestamptz,
  check (ends_at is null or ends_at > starts_at)
);
-- One season open at a time.
create unique index seasons_one_open on seasons ((true)) where ends_at is null;

create table settlements (
  id bigint generated always as identity primary key,
  starts_at timestamptz not null unique,
  ends_at timestamptz not null unique,
  season bigint not null references seasons (id),
  applied_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- What each class earned in a window, for the season review. Private: with a small cast, one
-- class's total can say who plays it.
create table settlement_class_totals (
  settlement bigint not null references settlements (id),
  class_key text not null references class_kinds (key),
  amount integer not null,
  primary key (settlement, class_key)
);

create table ledger (
  id bigint generated always as identity primary key,
  settlement bigint not null references settlements (id),
  account uuid not null references accounts (id),
  character uuid not null references characters (id),
  reason text not null check (reason ~ '^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$'),
  amount integer not null check (amount <> 0)
);
create index ledger_account on ledger (account, settlement);

create table wallets (
  account uuid primary key references accounts (id),
  balance integer not null default 0 check (balance >= 0)
);

-- Every change to a wallet: a settlement's credit with what the cap and the floor cut off, and
-- (0005) a card bought or played.
create table wallet_events (
  id bigint generated always as identity primary key,
  account uuid not null references accounts (id),
  settlement bigint references settlements (id),
  kind text not null check (kind in ('settlement', 'purchase', 'play')),
  change integer not null,
  overflow integer not null default 0 check (overflow >= 0),
  floored integer not null default 0 check (floored >= 0),
  balance_after integer not null check (balance_after >= 0),
  ref uuid,
  at timestamptz not null default now()
);
create index wallet_events_account on wallet_events (account, at);

create table standings (
  character uuid not null references characters (id),
  season bigint not null references seasons (id),
  amount integer not null default 0,
  primary key (season, character)
);

-- The cap is a setting, so it is held by a trigger rather than a check.
create function wallets_within_cap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.balance > (setting('walletCap'))::integer then
    raise exception 'a wallet holds at most %', setting('walletCap') using errcode = '23514';
  end if;
  return new;
end $$;
create trigger wallets_within_cap before insert or update on wallets for each row execute function wallets_within_cap();

create function ledger_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a ledger row is never edited or removed (%)', tg_op using errcode = 'P0001';
end $$;
create trigger ledger_no_update before update or delete on ledger for each row execute function ledger_append_only();
create trigger ledger_no_truncate before truncate on ledger for each statement execute function ledger_append_only();
create trigger wallet_events_no_update before update or delete on wallet_events for each row execute function ledger_append_only();
create trigger wallet_events_no_truncate before truncate on wallet_events for each statement execute function ledger_append_only();
alter table ledger enable always trigger ledger_no_update;
alter table ledger enable always trigger ledger_no_truncate;
alter table wallet_events enable always trigger wallet_events_no_update;
alter table wallet_events enable always trigger wallet_events_no_truncate;

-- Credit or debit one wallet, inside the caller's transaction: the floor and the cap applied,
-- the row locked, and the change recorded. Returns the new balance.
create function wallet_move(who uuid, delta integer, what text, settled bigint, about uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cap integer := (setting('walletCap'))::integer;
  was integer;
  raw integer;
  now_is integer;
begin
  insert into wallets (account) values (who) on conflict (account) do nothing;
  select balance into was from wallets where account = who for update;
  raw := was + delta;
  now_is := least(cap, greatest(0, raw));
  update wallets set balance = now_is where account = who;
  insert into wallet_events (account, settlement, kind, change, overflow, floored, balance_after, ref)
  values (who, settled, what, now_is - was, greatest(0, raw - cap), greatest(0, -raw), now_is, about);
  return now_is;
end $$;

-- Apply one settled window: its ledger entries, each player's wallet and each character's
-- standing, in one transaction. Entries are `[{player, character, reason, amount}]` and class
-- totals `{class: amount}`, as engine/rules/settle.ts returns them. A window already applied
-- is a no-op that says so; a window that does not start where the last one ended is refused.
create function apply_settlement(window_start timestamptz, window_end timestamptz, entries jsonb, class_totals jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  last_end timestamptz;
  open_season bigint;
  settled bigint;
  bad integer;
  r record;
begin
  -- One settlement at a time, whoever runs it.
  perform pg_advisory_xact_lock(hashtext('kayfabb.apply_settlement'));
  if window_end <= window_start then raise exception 'a window ends after it starts' using errcode = '22023'; end if;
  if exists (select 1 from settlements where starts_at = window_start and ends_at = window_end) then
    return jsonb_build_object('applied', false, 'reason', 'already settled');
  end if;
  select max(ends_at) into last_end from settlements;
  if last_end is not null and window_start <> last_end then
    raise exception 'this window starts at %, but the last settled window ended at %', window_start, last_end using errcode = '22023';
  end if;
  select id into open_season from seasons where starts_at <= window_start and (ends_at is null or ends_at >= window_end);
  if open_season is null then raise exception 'no season holds the window from % to %', window_start, window_end using errcode = 'P0002'; end if;

  if jsonb_typeof(entries) <> 'array' then raise exception 'entries are a list' using errcode = '22023'; end if;
  select count(*) into bad from jsonb_array_elements(entries) e
  where not exists (select 1 from characters c where c.id = (e ->> 'character')::uuid and c.owner = (e ->> 'player')::uuid)
     or jsonb_typeof(e -> 'amount') <> 'number' or (e ->> 'amount')::numeric <> trunc((e ->> 'amount')::numeric);
  if bad > 0 then raise exception '% entries name a character their player does not play, or an amount that is not whole', bad using errcode = '22023'; end if;

  insert into settlements (starts_at, ends_at, season) values (window_start, window_end, open_season) returning id into settled;
  insert into ledger (settlement, account, character, reason, amount)
  select settled, (e ->> 'player')::uuid, (e ->> 'character')::uuid, e ->> 'reason', (e ->> 'amount')::integer
  from jsonb_array_elements(entries) e where (e ->> 'amount')::integer <> 0;

  for r in select account, sum(amount)::integer as total from ledger where settlement = settled group by account order by account loop
    perform wallet_move(r.account, r.total, 'settlement', settled, null);
  end loop;

  insert into standings (character, season, amount)
  select character, open_season, sum(amount) from ledger where settlement = settled group by character
  on conflict (season, character) do update set amount = standings.amount + excluded.amount;

  insert into settlement_class_totals (settlement, class_key, amount)
  select settled, key, (value)::integer from jsonb_each_text(coalesce(class_totals, '{}'));

  return jsonb_build_object('applied', true, 'settlement', settled,
    'entries', (select count(*) from ledger where settlement = settled));
end $$;

-- ------------------------------------------------------------------- who reads what ----

alter table seasons enable row level security;
alter table settlements enable row level security;
alter table settlement_class_totals enable row level security;
alter table ledger enable row level security;
alter table wallets enable row level security;
alter table wallet_events enable row level security;
alter table standings enable row level security;
revoke all on seasons, settlements, settlement_class_totals, ledger, wallets, wallet_events, standings from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on seasons, settlements, standings to authenticated;
create policy read on seasons for select to authenticated using (true);
create policy read on settlements for select to authenticated using (true);
create policy read on standings for select to authenticated using (true);

grant select on ledger, wallets, wallet_events to authenticated;
create policy own on ledger for select to authenticated using (account = auth.uid());
create policy own on wallets for select to authenticated using (account = auth.uid());
create policy own on wallet_events for select to authenticated using (account = auth.uid());

revoke execute on function wallets_within_cap(), ledger_append_only(), wallet_move(uuid, integer, text, bigint, uuid),
  apply_settlement(timestamptz, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function apply_settlement(timestamptz, timestamptz, jsonb, jsonb) to service_role;
