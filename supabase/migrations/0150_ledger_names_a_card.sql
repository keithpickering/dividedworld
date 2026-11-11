-- The ledger takes an entry that names a card (the plan for card notes Part 6, Task 1; issue #452).
--
-- settle() writes one `card.boost` entry per character and card, with params {"card": "<key>"} (engine/rules/settle.ts). apply_settlement (0073)
-- refused any params value that was not a number, refused two entries with one character and reason, the index ledger_entry (0034) was
-- unique on (settlement, character, reason), and a share was matched to its entry by character and reason alone. So the first window in
-- which an Earn Gimmick boosted anything could not be applied, and every settlement after it waited.
--
-- Now an entry's params are numbers by key, except the key `card`, a string of 1 to 64 characters. Two entries may share a character and a
-- reason when their card differs, and the index says so. A share carries `card` where its entry has one, is matched to its entry by
-- character, reason and card, and an entry's shares add up to it grouped by the same three. my_ledger (0073) already reads params, so it
-- needs no change. Everything else in apply_settlement is 0073's, its lock kept and its search_path pinned.

drop index ledger_entry;
create unique index ledger_entry on ledger (settlement, character, reason, (coalesce(params ->> 'card', '')));

-- apply_settlement (0073), with an entry that names a card. Everything else as 0073 wrote it.
create or replace function apply_settlement(window_start timestamptz, window_end timestamptz, entries jsonb, class_totals jsonb default '{}', paid jsonb default '[]',
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
  -- An entry's params, where it has them: the numbers its reason's words state, each a number by its key (0073), and the card it names, a string. The engine writes
  -- them from the settings it settled under, so anything else is a fault in the call, never repaired here.
  if exists (select 1 from jsonb_array_elements(entries) e
             -- CASE, so the type is read before jsonb_each, which refuses anything but an object in words of its own.
             where e ? 'params' and jsonb_typeof(e -> 'params') <> 'null'
               and case when jsonb_typeof(e -> 'params') <> 'object' then true
                        else exists (select 1 from jsonb_each(e -> 'params') p
                                     where case when p.key = 'card' then jsonb_typeof(p.value) <> 'string' or char_length(p.value #>> '{}') not between 1 and 64
                                                else jsonb_typeof(p.value) <> 'number' end) end) then
    raise exception 'an entry''s params are numbers by key' using errcode = '22023';
  end if;
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
  -- One entry per character, reason and card, as settle() sums them (the ledger's unique index, above):
  -- the shares are checked against it, and it against them.
  if exists (select 1 from jsonb_array_elements(entries) e group by (e ->> 'character')::uuid, e ->> 'reason', coalesce(e -> 'params' ->> 'card', '') having count(*) > 1) then
    raise exception 'two entries name one character and reason and card' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(shares, '[]')) <> 'array' then raise exception 'shares are a list' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(shares, '[]')) s
             where jsonb_typeof(s) <> 'object' or not exists (
               select 1 from jsonb_array_elements(entries) e
               where e ->> 'character' = s ->> 'character' and e ->> 'reason' = s ->> 'reason' and coalesce(e -> 'params' ->> 'card', '') = coalesce(s ->> 'card', '')
                 and (e ->> 'amount')::numeric <> 0)) then
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
             group by (s ->> 'character')::uuid, s ->> 'reason', coalesce(s ->> 'card', ''), (s ->> 'act')::uuid, coalesce(s ->> 'quadrant', '') having count(*) > 1) then
    raise exception 'two shares name one entry''s Act and quadrant' using errcode = '22023';
  end if;
  if exists (select 1 from (select s ->> 'character' as character, s ->> 'reason' as reason, coalesce(s ->> 'card', '') as card, sum((s ->> 'amount')::numeric) as total
                            from jsonb_array_elements(coalesce(shares, '[]')) s group by 1, 2, 3) g
             where g.total is distinct from (select sum((e ->> 'amount')::numeric) from jsonb_array_elements(entries) e
                                             where e ->> 'character' = g.character and e ->> 'reason' = g.reason and coalesce(e -> 'params' ->> 'card', '') = g.card)) then
    raise exception 'an entry''s shares add up to it' using errcode = '22023';
  end if;

  insert into settlements (starts_at, ends_at, season) values (window_start, window_end, open_season) returning id into settled;
  insert into ledger (settlement, account, character, reason, amount, params)
  select settled, (e ->> 'player')::uuid, (e ->> 'character')::uuid, e ->> 'reason', (e ->> 'amount')::numeric::integer, nullif(e -> 'params', 'null'::jsonb)
  from jsonb_array_elements(entries) e where (e ->> 'amount')::numeric <> 0;

  insert into ledger_shares (ledger, act, quadrant, amount)
  select l.id, (s ->> 'act')::uuid, s ->> 'quadrant', (s ->> 'amount')::numeric::integer
  from jsonb_array_elements(coalesce(shares, '[]')) s
  join ledger l on l.settlement = settled and l.character = (s ->> 'character')::uuid and l.reason = s ->> 'reason'
                and coalesce(l.params ->> 'card', '') = coalesce(s ->> 'card', '');

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
