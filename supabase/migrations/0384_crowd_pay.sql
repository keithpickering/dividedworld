-- Crowd pay, kept, checked and paid (docs/plans/2026-11-20-crowd-pay-plan.md, Task 4; design docs/plans/2026-11-20-crowd-pay-design.md, sections 1, 2 and 5).
--
--   1. wallet_events_kind_check   (0153's) also admits 'crowd', a wallet move of its own kind: no character's, so no ledger row and no standing.
--   2. crowd_paid                 each Act a player was paid crowd pay for in a settlement. Private: RLS on, no grant to anon or authenticated, and append-only as the rows it sits beside are. It is read through
--                                 my_crowd_paid, the player's own, as my_ledger_shares (0034) is: the settlement and the Act, never the account. Its index (account, act) serves the check that an Act is paid to a player once
--                                 (apply_settlement below) and the log's read of a player's own rows; the primary key (settlement, account, act) serves a settlement's. reactions needs none: its unique (act, reactor_account, kind)
--                                 is the one probe for a player's reactions to an Act, whose first one is the earliest of those.
--   3. apply_settlement           (0151's, whole) gains a last parameter `crowd jsonb default '[]'`. A new parameter is a new overload, so the old signature is dropped and the new one created, its grants stated again
--                                 (0034's): the service role's alone. It defaults to none, so a caller that sends none (an old one, a window already applied) is answered as before. Everything else as 0151 wrote it.
-- Masks. crowd_paid is read from who reacted: private, and the one public-facing read is the caller's own rows.

alter table wallet_events drop constraint wallet_events_kind_check;
alter table wallet_events add constraint wallet_events_kind_check check (kind in ('settlement', 'purchase', 'play', 'trap', 'trapSystem', 'report', 'refund', 'bribe', 'appeal', 'grant', 'gift_out', 'gift_in', 'crowd'));

create table crowd_paid (
  settlement bigint not null references settlements (id),
  account uuid not null references accounts (id),
  act uuid not null references acts (id),
  primary key (settlement, account, act)
);
create index crowd_paid_account on crowd_paid (account, act);
create trigger crowd_paid_no_update before update or delete on crowd_paid for each row execute function ledger_append_only();
create trigger crowd_paid_no_truncate before truncate on crowd_paid for each statement execute function ledger_append_only();
alter table crowd_paid enable always trigger crowd_paid_no_update;
alter table crowd_paid enable always trigger crowd_paid_no_truncate;
alter table crowd_paid enable row level security;
revoke all on crowd_paid from anon, authenticated;

create view my_crowd_paid as
  select settlement, act from crowd_paid where account = auth.uid();
revoke all on my_crowd_paid from anon, public;
grant select on my_crowd_paid to authenticated;

drop function apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb);

-- apply_settlement (0151), with the crowd pay it keeps, checks and pays. Everything else as 0151 wrote it, its lock first.
create or replace function apply_settlement(window_start timestamptz, window_end timestamptz, entries jsonb, class_totals jsonb default '{}', paid jsonb default '[]',
  shares jsonb default '[]', crowd jsonb default '[]')
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
  crowd_each bigint;
  crowd_most integer;
  problem text;
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

  -- Crowd pay (docs/plans/2026-11-20-crowd-pay-design.md, section 5): the Acts each player is paid for, as engine/rules/settle.ts's crowdPay sends them. Each is read here against what settlement_input sends, line for line, and refused
  -- in words of its own where the engine would never have sent it: an Act of the window's `acts` (a character's, not a gift, not a staff character's, not a play an admin ended before the window's end), by a character of another
  -- player, that the player first reacted to inside the window (reactions: unique (act, reactor_account, kind) serves the one probe for each Act). The amount is never sent: it is the Acts counted times crowdPayEach, below.
  if jsonb_typeof(coalesce(crowd, '[]')) <> 'array' then raise exception 'crowd pay is a list' using errcode = '22023'; end if;
  -- Times are compared in the whole milliseconds settlement_input sends, as the engine counts them.
  -- Read only where there is crowd pay to check, so a window that sends none (an old caller's, a retried one's) needs neither setting.
  if jsonb_array_length(coalesce(crowd, '[]')) > 0 then
    crowd_each := (setting('crowdPayEach'))::bigint;
    crowd_most := (setting('crowdPayMost'))::integer;
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(crowd, '[]')) c
             where case when jsonb_typeof(c) <> 'object' then true
                        when (select count(*) from jsonb_object_keys(c)) <> 2 or not (c ? 'player' and c ? 'acts') then true
                        when jsonb_typeof(c -> 'player') <> 'string' or (c ->> 'player') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
                        when jsonb_typeof(c -> 'acts') <> 'array' or jsonb_array_length(c -> 'acts') = 0 then true
                        else exists (select 1 from jsonb_array_elements(c -> 'acts') a
                                     where jsonb_typeof(a) <> 'string' or (a #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') end) then
    raise exception 'a crowd pay row is a player and a list of Act ids, and nothing else' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(crowd, '[]')) c where not exists (select 1 from accounts x where x.id = (c ->> 'player')::uuid)) then
    raise exception 'a crowd pay row names a player with no account' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(crowd, '[]')) c group by (c ->> 'player')::uuid having count(*) > 1) then
    raise exception 'crowd pay has two rows for one player' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(crowd, '[]')) c, jsonb_array_elements_text(c -> 'acts') a group by (c ->> 'player')::uuid, a::uuid having count(*) > 1) then
    raise exception 'an Act is listed twice for one player''s crowd pay' using errcode = '22023';
  end if;
  if crowd_each = 0 and jsonb_array_length(coalesce(crowd, '[]')) > 0 then
    raise exception 'crowd pay is switched off (crowdPayEach is 0), and a row asks for it' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(crowd, '[]')) c where jsonb_array_length(c -> 'acts') > crowd_most) then
    raise exception 'a player''s crowd pay is for more Acts than the most one settlement pays (%)', crowd_most using errcode = '22023';
  end if;
  select format(case q.why when 1 then 'crowd pay names an Act that does not exist (%s)'
                           when 2 then 'a crowd pay Act is no character''s, but The System''s own (%s)'
                           when 3 then 'a crowd pay Act is a gift, which nobody is paid for reacting to (%s)'
                           when 4 then 'a crowd pay Act is a staff character''s (%s)'
                           when 5 then 'a crowd pay Act is by one of the player''s own characters (%s)'
                           when 6 then 'a crowd pay Act is a card play ended by an admin before the window closed (%s)'
                           when 7 then 'the player did not react to a crowd pay Act inside the window (%s)'
                           when 8 then 'the player first reacted to a crowd pay Act before the window (%s)'
                           else 'a crowd pay Act was already paid to the player in an earlier settlement (%s)' end, q.act)
    into problem
  from (
    select p.act, case when x.id is null then 1
                       when x.character is null then 2
                       when x.kind = 'donation' then 3
                       when is_staff_side(x.character, x.kind, x.target_act_id) then 4
                       when exists (select 1 from characters o where o.id = x.character and o.owner = p.player) then 5
                       when exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = x.id and e.created_at < window_end) then 6
                       when f.first_ms is null or f.first_ms >= (extract(epoch from window_end) * 1000)::bigint then 7
                       when f.first_ms < (extract(epoch from window_start) * 1000)::bigint then 8
                       when exists (select 1 from crowd_paid k where k.account = p.player and k.act = p.act) then 9 end as why
    from (select (c ->> 'player')::uuid as player, a::uuid as act from jsonb_array_elements(coalesce(crowd, '[]')) c, jsonb_array_elements_text(c -> 'acts') a) p
    left join acts x on x.id = p.act
    left join lateral (select (extract(epoch from min(rx.created_at)) * 1000)::bigint as first_ms from reactions rx where rx.act = p.act and rx.reactor_account = p.player) f on true
  ) q where q.why is not null limit 1;
  if problem is not null then raise exception '%', problem using errcode = '22023'; end if;

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

  -- Crowd pay, after the settlement's own moves, so the wallet's cap's overflow lands on it: each player's Acts kept, then one wallet move of the Acts counted times crowdPayEach, in player order. No ledger row,
  -- no share, no standing and no class's total: it is no character's (design, section 2).
  for r in select (c ->> 'player')::uuid as account, c -> 'acts' as acts from jsonb_array_elements(coalesce(crowd, '[]')) c order by 1 loop
    insert into crowd_paid (settlement, account, act) select settled, r.account, a::uuid from jsonb_array_elements_text(r.acts) a;
    perform wallet_move(r.account, jsonb_array_length(r.acts) * crowd_each, 'crowd', settled, null);
  end loop;

  insert into standings (character, season, amount)
  select character, open_season, sum(amount)::integer from ledger where settlement = settled group by character
  on conflict (season, character) do update set amount = standings.amount + excluded.amount;

  -- What the window scored characters as (Task 5): the plays settlement_input sent as `scoredAs`, whether or not the character earned anything. A retried window answered above and writes none.
  insert into scored_as (settlement, character, class_key, play)
  select settled, s.character, s.class_key, s.play from scored_as_plays(window_start, window_end) s;

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

revoke execute on function apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
