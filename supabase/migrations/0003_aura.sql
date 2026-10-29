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
  check (ends_at is null or ends_at > starts_at),
  -- Seasons never overlap, so every instant has at most one season.
  exclude using gist (tstzrange(starts_at, coalesce(ends_at, 'infinity'::timestamptz)) with &&)
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
create index ledger_settlement on ledger (settlement);

-- One player, one vote per Act, across windows (engine/rules/votes.ts's payVotes): the weight
-- each player's vote on an Act was given in the window of their first reaction there, and each
-- quadrant's share of it paid so far. Written by apply_settlement in the window's own
-- transaction, so a retried window never pays a difference twice; read by settlement_input.
-- Who voted how is private: no grant.
create table paid_votes (
  account uuid not null references accounts (id),
  act uuid not null references acts (id),
  -- 0 where the halving has run a vote down to nothing; never above one vote.
  weight numeric not null check (weight >= 0 and weight <= 1),
  shares jsonb not null,
  settlement bigint not null references settlements (id),
  primary key (account, act)
);

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

-- The cap is a setting, so it is held by a trigger rather than a check. It refuses a balance
-- rising past it; a wallet left above a cap an admin lowered can still be spent from, and the
-- next credit brings it to the cap.
create function wallets_within_cap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.balance > (setting('walletCap'))::integer and (tg_op = 'INSERT' or new.balance > old.balance) then
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
create function wallet_move(who uuid, delta bigint, what text, settled bigint, about uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cap integer := (setting('walletCap'))::integer;
  was integer;
  raw bigint;
  now_is integer;
begin
  if delta is null then raise exception 'a wallet move needs an amount' using errcode = '22004'; end if;
  insert into wallets (account) values (who) on conflict (account) do nothing;
  select balance into was from wallets where account = who for update;
  raw := was::bigint + delta;
  now_is := least(cap, greatest(0, raw))::integer;
  update wallets set balance = now_is where account = who;
  insert into wallet_events (account, settlement, kind, change, overflow, floored, balance_after, ref)
  values (who, settled, what, now_is - was, greatest(0, raw - cap), greatest(0, -raw), now_is, about);
  return now_is;
end $$;

-- Apply one settled window: its ledger entries, each player's wallet and each character's
-- standing, in one transaction. Entries are `[{player, character, reason, amount}]` and class
-- totals `{class: amount}`, as engine/rules/settle.ts returns them. A window already applied
-- is a no-op that says so; a window that does not start where the last one ended is refused.
create function apply_settlement(window_start timestamptz, window_end timestamptz, entries jsonb, class_totals jsonb default '{}', paid jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  last_end timestamptz;
  open_season bigint;
  season_end timestamptz;
  settled bigint;
  tally uuid;
  revealed jsonb;
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
  -- Windows follow one another; the one gap allowed is between two seasons, where no season
  -- holds the last window's end and this one starts at the next season's start.
  if last_end is not null and window_start <> last_end and not (
       not exists (select 1 from seasons where starts_at <= last_end and (ends_at is null or ends_at > last_end))
       and window_start = (select min(starts_at) from seasons where starts_at > last_end)) then
    raise exception 'this window starts at %, but the last settled window ended at %', window_start, last_end using errcode = '22023';
  end if;
  select id, coalesce(ends_at, starts_at + span_interval(setting('seasonLength'))) into open_season, season_end
  from seasons where starts_at <= window_start and (ends_at is null or ends_at >= window_end);
  -- An open season ends where its length runs out, and a window never runs past that: the one
  -- that reaches it is the season's last (next_settlement_window, 0004, stops there too). Where
  -- the length was shortened past the windows already settled, the next window is whole and the
  -- season ends with it.
  if open_season is null or (window_start < season_end and season_end < window_end) then
    raise exception 'no season holds the window from % to %', window_start, window_end using errcode = 'P0002';
  end if;

  if jsonb_typeof(entries) <> 'array' then raise exception 'entries are a list' using errcode = '22023'; end if;
  -- CASE, so the type is read before the cast; the range is an integer's.
  select count(*) into bad from jsonb_array_elements(entries) e
  where not exists (select 1 from characters c where c.id = (e ->> 'character')::uuid and c.owner = (e ->> 'player')::uuid)
     or case when jsonb_typeof(e -> 'amount') <> 'number' then true
             else (e ->> 'amount')::numeric <> trunc((e ->> 'amount')::numeric) or abs((e ->> 'amount')::numeric) > 2147483647 end;
  if bad > 0 then raise exception '% entries name a character their player does not play, or an amount that is not whole', bad using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(class_totals, '{}')) <> 'object' or exists (
    select 1 from jsonb_each(coalesce(class_totals, '{}')) t
    where case when jsonb_typeof(t.value) <> 'number' then true
               else (t.value #>> '{}')::numeric <> trunc((t.value #>> '{}')::numeric) or abs((t.value #>> '{}')::numeric) > 2147483647 end
       or not exists (select 1 from class_kinds k where k.key = t.key)) then
    raise exception 'class totals are whole amounts keyed by a class the instance has' using errcode = '22023';
  end if;
  -- Each paid vote: a player who has an account, an Act, a weight inside one vote, and the four
  -- quadrants' shares of it, each from 0 to 1, together one vote. A vote paid before keeps its weight.
  if jsonb_typeof(coalesce(paid, '[]')) <> 'array' or exists (
    select 1 from jsonb_array_elements(coalesce(paid, '[]')) v
    where jsonb_typeof(v -> 'weight') is distinct from 'number' or (v ->> 'weight')::numeric < 0 or (v ->> 'weight')::numeric > 1
       or jsonb_typeof(v -> 'shares') is distinct from 'object'
       or (select count(*) from jsonb_each(v -> 'shares')) <> 4
       or exists (select 1 from jsonb_each(v -> 'shares') s
                  where s.key not in ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative')
                     or jsonb_typeof(s.value) <> 'number' or (s.value #>> '{}')::numeric < 0 or (s.value #>> '{}')::numeric > 1)
       or abs((select sum((s.value #>> '{}')::numeric) from jsonb_each(v -> 'shares') s) - 1) > 0.000001
       or not exists (select 1 from accounts x where x.id = (v ->> 'player')::uuid)
       or not exists (select 1 from acts x where x.id = (v ->> 'act')::uuid)) then
    raise exception 'paid votes are a player, an Act, a weight of at most one vote, and four shares that make one vote' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(paid, '[]')) v join paid_votes p on p.account = (v ->> 'player')::uuid and p.act = (v ->> 'act')::uuid
             where p.weight <> (v ->> 'weight')::numeric) then
    raise exception 'a paid vote''s weight is fixed in the window it was first paid; this one changes it' using errcode = '22023';
  end if;

  insert into settlements (starts_at, ends_at, season) values (window_start, window_end, open_season) returning id into settled;
  insert into ledger (settlement, account, character, reason, amount)
  select settled, (e ->> 'player')::uuid, (e ->> 'character')::uuid, e ->> 'reason', (e ->> 'amount')::numeric::integer
  from jsonb_array_elements(entries) e where (e ->> 'amount')::numeric <> 0;

  for r in select account, sum(amount) as total from ledger where settlement = settled group by account having sum(amount) <> 0 order by account loop
    perform wallet_move(r.account, r.total, 'settlement', settled, null);
  end loop;

  insert into standings (character, season, amount)
  select character, open_season, sum(amount)::integer from ledger where settlement = settled group by character
  on conflict (season, character) do update set amount = standings.amount + excluded.amount;

  insert into settlement_class_totals (settlement, class_key, amount)
  select settled, key, (value)::numeric::integer from jsonb_each_text(coalesce(class_totals, '{}'));

  insert into paid_votes (account, act, weight, shares, settlement)
  select (v ->> 'player')::uuid, (v ->> 'act')::uuid, (v ->> 'weight')::numeric, v -> 'shares', settled from jsonb_array_elements(coalesce(paid, '[]')) v
  on conflict (account, act) do update set shares = excluded.shares, settlement = excluded.settlement;

  -- Masks change at the tally, and the season's last window reveals it, in this transaction:
  -- written once with the window, so a retried window posts neither twice (0007).
  tally := masks_change(window_end);
  if season_end <= window_end then revealed := reveal_season(window_end); end if;

  return jsonb_build_object('applied', true, 'settlement', settled,
    'entries', (select count(*) from ledger where settlement = settled),
    'tally', tally, 'revealed', revealed -> 'season');
end $$;

-- ------------------------------------------------------------------- who reads what ----

alter table seasons enable row level security;
alter table settlements enable row level security;
alter table settlement_class_totals enable row level security;
alter table ledger enable row level security;
alter table wallets enable row level security;
alter table wallet_events enable row level security;
alter table standings enable row level security;
alter table paid_votes enable row level security;
revoke all on seasons, settlements, settlement_class_totals, ledger, wallets, wallet_events, standings, paid_votes from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on seasons, settlements, standings to authenticated;
create policy read on seasons for select to authenticated using (true);
create policy read on settlements for select to authenticated using (true);
create policy read on standings for select to authenticated using (true);

grant select on ledger, wallets, wallet_events to authenticated;
create policy own on ledger for select to authenticated using (account = auth.uid());
create policy own on wallets for select to authenticated using (account = auth.uid());
create policy own on wallet_events for select to authenticated using (account = auth.uid());

revoke execute on function wallets_within_cap(), ledger_append_only(), wallet_move(uuid, bigint, text, bigint, uuid),
  apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb) to service_role;
