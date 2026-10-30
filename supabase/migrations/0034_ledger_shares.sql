-- Each settled entry's shares: the log shares design (docs/plans/2026-10-30-log-shares-design.md)
-- and its plan's Task 2.
--
-- A ledger row is one reason's amount for one character in one window. Its shares split that
-- amount across the posts the live estimate valued for it (engine/rules/settle.ts's shareEntries),
-- and add up to it exactly. They are written once, by the settlement, in apply_settlement's own
-- transaction, and never change after: a later fix to the scoring code never rewrites an old line
-- ("Append-only"). A settlement applied before this has none, and is never back-filled.
--
-- A share is computed from no private fact: it is the entry's total, which the player's ledger
-- already shows, split by the estimate the player watched live, in which no reaction is grouped
-- with another by who left it. It is read by its own player alone, through my_ledger_shares,
-- and never broadcast.

-- The settlement writes one row per character and reason per window already (settle() sums by
-- them); the index makes that a fact the shares and the view below join on.
create unique index ledger_entry on ledger (settlement, character, reason);

create table ledger_shares (
  id bigint generated always as identity primary key,
  ledger bigint not null references ledger (id),
  act uuid not null references acts (id),
  quadrant text check (quadrant in ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative')),
  amount integer not null check (amount <> 0)
);
create unique index ledger_shares_post on ledger_shares (ledger, act, coalesce(quadrant, ''));
create index ledger_shares_ledger on ledger_shares (ledger);

create trigger ledger_shares_no_update before update or delete on ledger_shares for each row execute function ledger_append_only();
create trigger ledger_shares_no_truncate before truncate on ledger_shares for each statement execute function ledger_append_only();
alter table ledger_shares enable always trigger ledger_shares_no_update;
alter table ledger_shares enable always trigger ledger_shares_no_truncate;

alter table ledger_shares enable row level security;
revoke all on ledger_shares from anon, authenticated;

-- apply_settlement (0003), with the shares. Dropped and made again rather than overloaded, so the
-- five-parameter signature is not left callable beside this one; a call without shares still
-- applies, as every settlement before this did, and an entry with none is scored over the window.
-- The body is 0003's otherwise, unchanged: the shares are checked with the rest, before anything
-- is written, and inserted against their ledger rows after the ledger, so a window already settled
-- is still a no-op that writes no share twice.
drop function apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb);

-- Apply one settled window: its ledger entries and their shares, each player's wallet and each
-- character's standing, in one transaction. Entries are `[{player, character, reason, amount}]`,
-- class totals `{class: amount}` and shares `[{character, reason, act, quadrant, amount}]`, as
-- engine/rules/settle.ts returns them. A window already applied is a no-op that says so; a window
-- that does not start where the last one ended is refused.
create function apply_settlement(window_start timestamptz, window_end timestamptz, entries jsonb, class_totals jsonb default '{}', paid jsonb default '[]',
  shares jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  last_end timestamptz;
  open_season bigint;
  season_end timestamptz;
  settled bigint;
  tally uuid;
  revealed jsonb;
  masks_failed text;
  reveal_failed text;
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

  -- Each share: an entry of this call by its character and reason, an Act there is, one of the
  -- four quadrants or none, and whole hundredths that are not 0; one per entry, Act and quadrant;
  -- and an entry's shares, where it has any, add up to it (engine/rules/settle.ts's shareEntries).
  if jsonb_typeof(coalesce(shares, '[]')) <> 'array' then raise exception 'shares are a list' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(shares, '[]')) s
             where jsonb_typeof(s) <> 'object' or not exists (
               select 1 from jsonb_array_elements(entries) e
               where e ->> 'character' = s ->> 'character' and e ->> 'reason' = s ->> 'reason' and (e ->> 'amount')::numeric <> 0)) then
    raise exception 'a share names no entry of this call' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(shares, '[]')) s
             where case when coalesce(s ->> 'act', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
                        else not exists (select 1 from acts x where x.id = (s ->> 'act')::uuid) end) then
    raise exception 'a share names an Act that does not exist' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(shares, '[]')) s
             where jsonb_typeof(s -> 'quadrant') is distinct from 'null' and s ? 'quadrant'
               and (jsonb_typeof(s -> 'quadrant') <> 'string' or s ->> 'quadrant' not in ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'))) then
    raise exception 'a share''s quadrant is none of the four' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(shares, '[]')) s
             where case when jsonb_typeof(s -> 'amount') is distinct from 'number' then true
                        else (s ->> 'amount')::numeric = 0 or (s ->> 'amount')::numeric <> trunc((s ->> 'amount')::numeric) or abs((s ->> 'amount')::numeric) > 2147483647 end) then
    raise exception 'a share''s amount is whole hundredths, never 0' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(shares, '[]')) s
             group by s ->> 'character', s ->> 'reason', s ->> 'act', coalesce(s ->> 'quadrant', '') having count(*) > 1) then
    raise exception 'two shares name one entry''s Act and quadrant' using errcode = '22023';
  end if;
  if exists (select 1 from (select s ->> 'character' as character, s ->> 'reason' as reason, sum((s ->> 'amount')::numeric) as total
                            from jsonb_array_elements(coalesce(shares, '[]')) s group by 1, 2) g
             where g.total is distinct from (select sum((e ->> 'amount')::numeric) from jsonb_array_elements(entries) e
                                             where e ->> 'character' = g.character and e ->> 'reason' = g.reason)) then
    raise exception 'an entry''s shares add up to it' using errcode = '22023';
  end if;

  insert into settlements (starts_at, ends_at, season) values (window_start, window_end, open_season) returning id into settled;
  insert into ledger (settlement, account, character, reason, amount)
  select settled, (e ->> 'player')::uuid, (e ->> 'character')::uuid, e ->> 'reason', (e ->> 'amount')::numeric::integer
  from jsonb_array_elements(entries) e where (e ->> 'amount')::numeric <> 0;

  insert into ledger_shares (ledger, act, quadrant, amount)
  select l.id, (s ->> 'act')::uuid, s ->> 'quadrant', (s ->> 'amount')::numeric::integer
  from jsonb_array_elements(coalesce(shares, '[]')) s
  join ledger l on l.settlement = settled and l.character = (s ->> 'character')::uuid and l.reason = s ->> 'reason';

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
  -- written once with the window, so a retried window posts neither twice (0007). Each is a
  -- block of its own, so one that cannot be written (the instance's words lost, say) leaves
  -- what waited for the next settlement and says why, and never holds back the Aura: the way
  -- out is an admin's seed of what is missing, after which the next settlement does them. The
  -- tally goes first, and a Turn it makes take effect at this window's end, the season's last,
  -- is the next season's: the reveal reads only what began before its end.
  begin
    tally := masks_change(window_end);
  exception when others then
    masks_failed := sqlerrm;
  end;
  if season_end <= window_end then
    begin
      revealed := reveal_season(window_end);
    exception when others then
      reveal_failed := sqlerrm;
    end;
  end if;

  return jsonb_strip_nulls(jsonb_build_object('applied', true, 'settlement', settled,
    'entries', (select count(*) from ledger where settlement = settled),
    'tally', tally, 'revealed', revealed -> 'season', 'masks', masks_failed, 'reveal', reveal_failed));
end $$;

revoke execute on function apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb) to service_role;

-- The caller's shares, beside my_ledger (0030): which settlement, character and reason each
-- belongs to, never the account or either id.
create view my_ledger_shares as
  select l.settlement, l.character, l.reason, sh.act, sh.quadrant, sh.amount
  from ledger_shares sh join ledger l on l.id = sh.ledger
  where l.account = auth.uid();

revoke all on my_ledger_shares from anon, public;
grant select on my_ledger_shares to authenticated;
