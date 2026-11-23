-- The crowd floor is taken back only as it was paid (docs/plans/2026-11-23-crowd-floor-design.md, section 5, the owner's answer on #1014; plan docs/plans/2026-11-23-crowd-floor-plan.md): a moved vote never takes back a floor that was not paid.
-- `paid_votes.floored` is the net floor, in hundredths, paid so far on each quadrant of one player's vote on one Act; engine/rules/settle.ts pays into it and takes back from it, so a take-back is that floor times the share lost over the share held.
-- Each row so far starts at '{}': nothing paid, so nothing taken back, whether the vote was paid before the floor existed or while `crowdFloor` was 0. Each object is copied whole from its latest version, with only the change named.
--
--   1. paid_votes        gains `floored jsonb not null default '{}'`. It is written by apply_settlement in the window's own transaction, and updated in place as `shares` is: it is the vote's running state, never an Act (CLAUDE.md, Append-only).
--   2. apply_settlement  copied whole from 0398_debates_fixes.sql (its latest; 0405 does not touch it): each paid vote may carry `floored`, an object of the four quadrants' amounts none below 0, checked, and written beside `shares` (absent is '{}').
--                        The signature is the one 0398 made, so the grants it holds stay as they were (replaced in place).
--   3. settlement_input  copied whole from 0405_cut.sql (its latest): each entry of `paid` carries the vote's `floored`.
-- estimate_input reads no paid vote, so it is unchanged. Masks. paid_votes has no grant and is read by no API role; floored is a sum of what the System paid and is never computed from who reacted to a response.

alter table paid_votes add column floored jsonb not null default '{}';

create or replace function apply_settlement(window_start timestamptz, window_end timestamptz, entries jsonb, class_totals jsonb default '{}', paid jsonb default '[]',
  shares jsonb default '[]', crowd jsonb default '[]', tallied jsonb default '[]')
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
  -- The net crowd floor each paid vote carries (0417), when it carries one: an object of the four quadrants' amounts, none below 0; absent is none paid.
  if exists (select 1 from jsonb_array_elements(coalesce(paid, '[]')) v
             where v ? 'floored' and (jsonb_typeof(v -> 'floored') <> 'object'
                or exists (select 1 from jsonb_each(v -> 'floored') f
                           where f.key not in ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative')
                              or jsonb_typeof(f.value) <> 'number' or (f.value #>> '{}')::numeric < 0))) then
    raise exception 'a paid vote''s crowd floor is an amount of at least 0 on each of the four quadrants' using errcode = '22023';
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

  -- The window's tallied sums (0398): `[{act, reason, amount}]`, one for each Act and reason, as engine/rules/settle.ts returns them. An Act there is, a reason by the ledger's pattern, a whole amount that is not 0.
  -- Checked with the rest, before anything is written; written below with the window and nowhere else, so a window already applied (answered above) writes none.
  if jsonb_typeof(coalesce(tallied, '[]')) <> 'array' then raise exception 'tallied sums are a list' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(tallied, '[]')) t
             where case when jsonb_typeof(t) <> 'object' then true
                        when jsonb_typeof(t -> 'act') is distinct from 'string' or (t ->> 'act') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
                        when jsonb_typeof(t -> 'reason') is distinct from 'string' or (t ->> 'reason') !~ '^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$' then true
                        when jsonb_typeof(t -> 'amount') is distinct from 'number' then true
                        else (t ->> 'amount')::numeric = 0 or (t ->> 'amount')::numeric <> trunc((t ->> 'amount')::numeric) or abs((t ->> 'amount')::numeric) > 2147483647 end) then
    raise exception 'a tallied sum is an Act, a reason of the ledger''s form and a whole amount that is not 0' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(tallied, '[]')) t where not exists (select 1 from acts x where x.id = (t ->> 'act')::uuid)) then
    raise exception 'a tallied sum names an Act that does not exist' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(tallied, '[]')) t group by (t ->> 'act')::uuid, t ->> 'reason' having count(*) > 1) then
    raise exception 'two tallied sums name one Act and reason' using errcode = '22023';
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

  -- Crowd pay, after the settlement's own moves, so the wallet's cap's overflow lands on it: each player's Acts kept, then one wallet move of the Acts counted times crowdPayEach, in player order. No ledger row,
  -- no share, no standing and no class's total: it is no character's (design, section 2).
  for r in select (c ->> 'player')::uuid as account, c -> 'acts' as acts from jsonb_array_elements(coalesce(crowd, '[]')) c order by 1 loop
    insert into crowd_paid (settlement, account, act, most) select settled, r.account, a::uuid, crowd_most from jsonb_array_elements_text(r.acts) a;
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

  insert into paid_votes (account, act, weight, shares, floored, settlement)
  select (v ->> 'player')::uuid, (v ->> 'act')::uuid, (v ->> 'weight')::numeric, v -> 'shares', coalesce(v -> 'floored', '{}'), settled from jsonb_array_elements(coalesce(paid, '[]')) v
  on conflict (account, act) do update set shares = excluded.shares, floored = excluded.floored, settlement = excluded.settlement;

  -- The window's tallied sums, in this transaction: a retried window answered above writes none, and a window never writes a row twice (the primary key says so as well).
  insert into tallied_lines (settlement, act, reason, amount)
  select settled, (t ->> 'act')::uuid, t ->> 'reason', (t ->> 'amount')::numeric::integer from jsonb_array_elements(coalesce(tallied, '[]')) t;

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

create or replace function settlement_input(window_start timestamptz, window_end timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive
  -- The plays an admin ended before the window's end (Task 3): out of this window, with the votes on them. `<` as every other bound
  -- here is, so a card_end written at the instant window_end is after the window, as a vote written then is.
  ended as (select e.target_act_id as id from acts e where e.kind = 'card_end' and e.created_at < window_end),
  -- Every live Earn Gimmick play still up when the window opens, played before it (a play inside it is a window Act already): settle.ts boosts only with the play in the input, and an Earn play of an earlier window
  -- is still up in this one. Live is not ended by an admin, not caught, and ending after the window's start; found by creation time, a window of the longest Earn `lasts` before the window, and each comes with its post.
  earn_up as (
    select k.id, case when coalesce(k.payload ->> 'reach', 'post') = 'post' then k.target_act_id end as post
    from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.gimmick ->> 'kind' in ('earn', 'cushion')
      and k.created_at < window_start and k.created_at >= window_start - (select max(e.lasts) from card_kinds e where e.gimmick ->> 'kind' in ('earn', 'cushion'))
      and coalesce(k.payload ->> 'reach', 'post') in ('post', 'character') and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)),
  -- The System's own Acts (the reveal) are no character's, and nobody's to settle; a staff character's
  -- are The System's too (0043): staff earn nothing, and a card on a staff Act is nobody's to score.
  -- A gift (a donation) is no one's to settle (design, section 5): it earns nothing, is never counted as posting or in the halving, and is no one's reaction to count. It is left out here, of the window's Acts and of
  -- the reactions to one; `all_acts` leaves it out once more, since an Act a reaction touched is read whatever its kind.
  win_acts as (select * from acts a where a.created_at >= window_start and a.created_at < window_end and a.character is not null and a.kind <> 'donation' and a.kind not in ('poll', 'ballot', 'poll_close')
               and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)),
  win_reactions as (select * from reactions r where r.created_at >= window_start and r.created_at < window_end and r.act not in (select id from ended)
                    and not exists (select 1 from acts d where d.id = r.act and d.kind = 'donation')),
  reacted as (select distinct act from win_reactions),
  -- ---- The debates the window reached (0390; docs/plans/2026-11-18-tweener-catalyst-design.md, section 1) ----
  -- The earliest a spark may be made for its debate to be followed: `debateDays` before the window opens, as engine/rules/settle.ts reads it.
  cutoff as (select window_start - make_interval(days => (setting('debateDays') #>> '{}')::integer) as at),
  -- The paid sparks (0398): a post that has a nonzero tallied sum for some reason (tallied_lines, the settlements that ended by the window's start, read by the `act` index) and that a reaction reached in the window, of any age, so a vote
  -- that moves on it takes back what was paid, however old the post is. A post the sums net to 0 on is no spark of this kind. The members of its debate are walked to below with no cutoff, as for any spark.
  paid_sparks as (
    select x.act as id from reacted x
    where exists (select 1 from tallied_lines l join settlements st on st.id = l.settlement where l.act = x.act and st.ends_at <= window_start group by l.reason having sum(l.amount) <> 0)),
  -- Walk up: from each window post or spin, through quote_refs (`act` to `quoted`, its primary key), to the posts it quotes and the posts those quote, none made before the cutoff, each earlier than the one that
  -- quotes it. `anc` is false for the window's own Acts and true for one reached by a quote. A node is a post or a spin that is in the input's terms (no staff, no System, no donation, not ended by an admin).
  -- Time-bounded below by the cutoff and above by the window's end (a window Act is made before it), and each step is a probe of quote_refs by `act` then of acts by its key: no step scans acts. The key probe is a lateral with `offset 0`, which fences it: left as a join, the planner read acts by time (acts_created) and filtered by key, 500 rows a step at 1,000 posts, a cost that grew as the square of a quote chain (the walks below do the same).
  up as (
    select a.id, a.created_at as at, a.kind, false as anc from win_acts a where a.kind in ('post', 'spin')
    union
    select b.id, b.created_at, b.kind, true
    from up u cross join lateral (
      select b.id, b.created_at, b.kind from quote_refs r cross join lateral (select * from acts where id = r.quoted offset 0) b
      where r.act = u.id and b.kind in ('post', 'spin') and b.created_at >= (select at from cutoff) and b.created_at < window_end and (b.created_at, b.id) < (u.at, u.id)
        and b.character is not null and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)
      offset 0) b),
  -- The sparks: a post made no earlier than the cutoff that a window Act quotes or sits under (a quote chain's ancestor; the origin of a spun thread with an Act in the window), or that a reaction reached in the window while it
  -- has a debate by the window's end (a quote or another player's spin made before it; one made after is no debate yet), so that a nod that moves after the debate has gone quiet still moves the refund: engine/rules/settle.ts reads a spark whose vote moved. The origin is read through the thread's own row (threads_origin's key).
  sparks as (
    select b.id, b.created_at as at, b.character, c.owner, b.thread
    from (
      select u.id from up u where u.anc and u.kind = 'post'
      union select t.origin_act_id from win_acts a join threads t on t.id = a.thread where a.kind in ('post', 'spin') and t.origin_act_id is not null
      union select x.act from reacted x join acts sa on sa.id = x.act join characters sc on sc.id = sa.character
        where exists (select 1 from quote_refs q cross join lateral (select * from acts where id = q.act offset 0) a where q.quoted = x.act and a.kind in ('post', 'spin') and a.created_at < window_end and (a.created_at, a.id) > (sa.created_at, sa.id)
                        and a.character is not null and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended))
           or exists (select 1 from acts sp join characters pc on pc.id = sp.character where sp.target_act_id = x.act and sp.kind = 'spin' and sp.created_at < window_end and sp.created_at >= sa.created_at
                        and pc.owner <> sc.owner and pc.staff is null and sp.id not in (select id from ended))
      union select id from paid_sparks
    ) k cross join lateral (select b.* from acts b where b.id = k.id offset 0) b
    cross join lateral (select c.owner from characters c where c.id = b.character offset 0) c
    where b.kind = 'post' and (b.created_at >= (select at from cutoff) or b.id in (select id from paid_sparks)) and b.created_at < window_end
      and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)),
  -- Walk up again from every spark, by whatever branch reached it (a spark reached as the origin of a spun thread or by a reaction has no ancestor in `up`): the engine reads whether a spark is in an earlier post's debate by its own
  -- player (inOwnDebate) from the edges above it, so each ancestor, and the edges to it, are in the input, however old (0398: a post in the debate of an earlier post by the same player is never a spark, and the earlier post may be older than `debateDays`; the climb is as long as the quote chain, each step a keyed probe). The same step as `up`, bounded by the window's end and by each step being strictly earlier. It no longer stops at a node `up` holds: `up` is bound by the cutoff, so its ancestors are not all there, and a node reached from two sparks is held once (UNION), so a chain is climbed once.
  ancestry as (
    select s.id, s.at from sparks s
    union
    select b.id, b.created_at
    from ancestry u cross join lateral (
      select b.id, b.created_at from quote_refs r cross join lateral (select * from acts where id = r.quoted offset 0) b
      where r.act = u.id and b.kind in ('post', 'spin') and b.created_at < window_end and (b.created_at, b.id) < (u.at, u.id)
        and b.character is not null and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)
      offset 0) b),
  -- The origin a spark's own thread was spun from, and the spin that made it (0398), whatever their age: the engine reads inOwnDebate from the spin's target as well as from the edges above (a post in a thread another player spun from an
  -- earlier post by the same player), so a spark in a spun thread has both in the input even where no Act of the thread is in the window. Read only where the origin is by the spark's own player, the one case inOwnDebate asks about. Two keyed probes a spark: the thread's own row, then the spin by the thread and its target.
  origin_reads as (
    select sp.id, sp.created_at as at from sparks s
    cross join lateral (select t.origin_act_id as o from threads t where t.id = s.thread and t.origin_act_id is not null and exists (select 1 from acts oa join characters oc on oc.id = oa.character where oa.id = t.origin_act_id and oc.owner = s.owner) offset 0) t
    cross join lateral (select sp.id, sp.created_at from acts sp where sp.thread = s.thread and sp.kind = 'spin' and sp.target_act_id = t.o and sp.created_at < window_end
                          and sp.character is not null and not is_staff_side(sp.character, sp.kind, sp.target_act_id) and sp.id not in (select id from ended) offset 0) sp
    union
    select o.id, o.created_at from sparks s
    cross join lateral (select t.origin_act_id as o from threads t where t.id = s.thread and t.origin_act_id is not null and exists (select 1 from acts oa join characters oc on oc.id = oa.character where oa.id = t.origin_act_id and oc.owner = s.owner) offset 0) t
    cross join lateral (select o.id, o.created_at from acts o where o.id = t.o and o.kind in ('post', 'spin') and o.created_at < window_end
                          and o.character is not null and not is_staff_side(o.character, o.kind, o.target_act_id) and o.id not in (select id from ended) offset 0) o),
  -- Walk down: from each spark, through quote_refs_quoted (`quoted` to `act`), to every post or spin that quotes a member, made before the window's end and after what it quotes.
  down as (
    select s.id, s.at from sparks s
    union
    select a.id, a.created_at
    from down d cross join lateral (
      select a.id, a.created_at from quote_refs r cross join lateral (select * from acts where id = r.act offset 0) a
      where r.quoted = d.id and a.kind in ('post', 'spin') and a.created_at < window_end and (a.created_at, a.id) > (d.at, d.id)
        and a.character is not null and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)
      offset 0) a),
  -- And the spin and the posts of each thread another player spun from a spark: the spin through acts_target (the spark), the posts through the thread's own index.
  spun_spins as (
    select sp.id, sp.created_at as at, sp.thread
    from sparks s cross join lateral (
      select sp.id, sp.created_at, sp.thread from acts sp join characters c on c.id = sp.character
      where sp.target_act_id = s.id and sp.kind = 'spin' and sp.created_at < window_end and sp.created_at >= s.at and c.owner <> s.owner and c.staff is null and sp.id not in (select id from ended)
      offset 0) sp),
  spun_posts as (
    select p.id from spun_spins sp cross join lateral (
      select p.id from acts p where p.thread = sp.thread and p.kind = 'post' and p.created_at < window_end and p.created_at >= sp.at
        and p.character is not null and not is_staff_side(p.character, p.kind, p.target_act_id) and p.id not in (select id from ended)
      offset 0) p),
  members as (select id from down union select id from spun_spins union select id from spun_posts),
  -- Each cushion play (Thick Skin) on a spark or on its character that ended after the spark was made, whether or not it is still up: the engine cuts the refund by the largest share that was ever up on the spark.
  -- A play on the post is found by its key (acts_layers); one on the character by a probe for each spark, through acts_card_on_character (the character it lies on, then creation time), from the longest cushion `lasts` before that spark's own
  -- creation, whatever its age (an old paid spark has no cutoff): a play made earlier than that ended before the spark was made. A caught play is never in effect.
  cushion_plays as (
    select k.id from sparks s cross join lateral (
      select k.id from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.gimmick ->> 'kind' = 'cushion'
      where k.target_act_id = s.id and k.kind = 'card' and coalesce(k.payload ->> 'reach', 'post') = 'post'
        and k.created_at < window_end and not (k.payload ? 'caught') and (k.payload ->> 'ends')::timestamptz > s.at and k.id not in (select id from ended)
      offset 0) k
    union
    select k.id from sparks s cross join lateral (
      select k.id from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.gimmick ->> 'kind' = 'cushion'
      where k.kind = 'card' and k.payload ->> 'reach' = 'character' and k.payload ->> 'character' = s.character::text
        and k.created_at < window_end and k.created_at >= s.at - (select max(c.lasts) from card_kinds c where c.gimmick ->> 'kind' = 'cushion')
        and not (k.payload ? 'caught') and (k.payload ->> 'ends')::timestamptz > s.at and k.id not in (select id from ended)
      offset 0) k),
  -- What each play of the window is scored against (0378): the Act a card or a spring lies on, and the cast a spring caught (`by`). A class's rule reads how the room took that Act (engine/rules/settle.ts, targetLean), and a
  -- reaction before the window counts as much as one inside it, so the Act's earlier reactions are sent whether or not a reaction reached it today. One probe by Act for each play of the window, never a scan of reactions.
  scored as (
    select a.target_act_id as id from win_acts a where a.kind in ('card', 'spring') and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post'
    union
    select (a.payload ->> 'by')::uuid from win_acts a where a.kind = 'spring' and a.payload ->> 'by' is not null),
  -- Only what a reaction reached is paid for a scored Act (`paid`, below, still joins `reacted`): an earlier reaction on a scored Act is read for the lean and pays nothing. A spark's (0390) are read and its paid rows sent, so
  -- its standing votes are in the input in a window no reaction reached it; the vote math pays only a vote with a reaction in the window, so nothing is paid twice.
  earlier_reactions as (select r.* from (select act from reacted union select id from scored where id not in (select id from ended) union select id from sparks) x cross join lateral (select r.* from reactions r where r.act = x.act and r.created_at < window_start offset 0) r),
  -- Every skim play made before the window and still up in it (a play inside it is a window Act already), as earn_up carries Earn plays: live is not ended by an admin, not caught, and ending after the window's start;
  -- found by creation time through acts_card_created, a window of the longest skim `lasts` before the window, and each comes with its post.
  skim_up as (
    select k.id, k.target_act_id as post
    from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.skim is not null and k.target_act_id is not null
      and k.created_at < window_start and k.created_at >= window_start - (select max(s.lasts) from card_kinds s where s.skim is not null)
      and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)),
  -- The cards on a post among the Acts reacted to in the window, and what pays on them: the ride springs that rode (acts_spring_by, one probe each), and the ride gimmick plays on the post that were up when the cast was made
  -- (acts_layers, the plays on the post), each with the post. A cast that drew no reaction in the window brings none of them, however many have sprung.
  rc as (select a.id, a.target_act_id as post, a.created_at from acts a join reacted x on x.act = a.id
         where a.kind = 'card' and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post' and a.id not in (select id from ended)),
  ride_springs as (select s.id from rc join acts s on s.kind = 'spring' and (s.payload ->> 'by') = rc.id::text where s.payload ->> 'did' = 'rode'),
  ride_gimmicks as (
    select g.id from rc
    join acts g on g.target_act_id = rc.post and g.kind = 'card' and coalesce(g.payload ->> 'reach', 'post') = 'post' and g.id <> rc.id
    join card_kinds ck on ck.key = g.payload ->> 'card' and ck.gimmick ->> 'kind' = 'ride'
    where not (g.payload ? 'caught') and g.created_at <= rc.created_at and (g.payload ->> 'ends')::timestamptz > rc.created_at and g.id not in (select id from ended)),
  active_spun as (select distinct t.id from threads t join win_acts a on a.thread = t.id where t.origin_act_id is not null),
  spins as (select a.* from acts a join active_spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    -- Each character's first post in the thread, read through acts_thread_posts, one per
    -- character rather than a sort of the whole thread.
    select f.* from active_spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.* from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  touched as (
    select id from win_acts union select act from reacted
    union select id from earn_up union select post from earn_up where post is not null
    union select target_act_id from win_acts where kind in ('card', 'spin', 'spring') and target_act_id is not null and coalesce(payload ->> 'reach', 'post') = 'post'
    union select id from spins union select target_act_id from spins where target_act_id is not null
    -- Every card on an Act a reaction touches, an earlier window's too: a vote counts once per
    -- player and alignment, for the earliest card (engine/rules/settle.ts).
    union select a.id from acts a join reacted x on x.act = a.target_act_id where a.kind in ('card', 'spring') and coalesce(a.payload ->> 'reach', 'post') = 'post'
    union select id from first_posts
    union select id from skim_up union select post from skim_up
    union select id from ride_springs union select id from ride_gimmicks union select post from rc
    union select id from scored
    union select id from ancestry union select id from members union select id from cushion_plays union select id from origin_reads
  ),
  all_acts as (select a.* from touched t cross join lateral (select a.* from acts a where a.id = t.id offset 0) a where a.created_at < window_end and a.character is not null and a.kind <> 'donation'
               and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)),
  -- A staff post a window's card landed on (0054): named with its reactions, so the card is judged against it, and paid nobody. And, since 0378, a staff cast a window spring caught, which `scored` names, so the spring is
  -- judged against it as a card on a post is.
  unscored as (select a.* from acts a join characters c on c.id = a.character
               where c.staff is not null and (a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start and coalesce(k.payload ->> 'reach', 'post') = 'post')
                                              or a.id in (select id from scored))),
  -- Named, never settled: settle.ts drops a reaction to one, and reads a spin from one as from another.
  system_acts as (select a.id from touched t cross join lateral (select a.* from acts a where a.id = t.id offset 0) a
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  all_reactions as (select * from win_reactions union all select * from earlier_reactions),
  named as (select character as id from all_acts union select reactor_character from all_reactions),
  ms as (select 1)
  select jsonb_build_object(
    'window', jsonb_build_object('id', to_jsonb(window_start) #>> '{}',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'player', c.owner, 'classes', coalesce((
        select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
        from class_history h where h.character = c.id and h.started_at < window_end), '[]'),
        'reveals', coalesce((select jsonb_agg((extract(epoch from u.at) * 1000)::bigint order by u.at, u.act)
          from class_reveals u where u.character = c.id and u.at < window_end), '[]')) order by c.id)
      from characters c join named n on n.id = c.id), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread,
        'target', case when coalesce(a.payload ->> 'reach', 'post') = 'post' then a.target_act_id end,
        'reach', case when a.kind = 'card' then nullif(coalesce(a.payload ->> 'reach', 'post'), 'post') end,
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end,
        'by', case when a.kind = 'spring' then a.payload ->> 'by' end,
        -- A caught play is never in effect (0370): its `ends`, where a row written before 0370 holds one, is not sent, so it boosts and skims nothing. A cut play's `ends` is the cut's time at the latest (card_cut_at), so it pays nothing from then on.
        'ends', case when a.kind = 'card' and not (a.payload ? 'caught') and (select ck.gimmick is not null or ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card')
                     then (extract(epoch from least((a.payload ->> 'ends')::timestamptz, card_cut_at(a.id))) * 1000)::bigint end,
        'quadrant', case when a.kind = 'card' and (select ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card') then a.payload #>> '{config,quadrant}'
                         when a.kind = 'spring' then a.payload ->> 'quadrant' end,
        'on', case when a.kind = 'card' and a.payload ->> 'reach' = 'character' then a.payload ->> 'character' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    -- A staff Act that is a card's play carries its `card` (0378), so a class's rule can tell a cast of a Salty card from any other Act the room reacted to.
    'unscoredTargets', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'kind', a.kind, 'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'staff', true,
        'card', case when a.kind = 'card' then a.payload ->> 'card' end)) order by a.created_at, a.id)
      from unscored a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'at', (extract(epoch from r.created_at) * 1000)::bigint,
        'player', r.reactor_account, 'character', r.reactor_character)
        || case when r.kind like 'x-%' then jsonb_build_object('quadrant', reaction_quadrant(r.act, r.kind)) else '{}'::jsonb end order by r.created_at, r.id)
      from all_reactions r), '[]'),
    -- The System's Acts an input Act points at (a spin from the reveal): named, never settled.
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'),
    -- The plays that name a class for this window (scored_as_plays), each with its character, its class and the play.
    'scoredAs', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'class', s.class_key, 'play', s.play) order by s.character) from scored_as_plays(window_start, window_end) s), '[]'),
    -- Each quote with both ends among the input's Acts: `act` quotes `quoted`. The engine reads a post's debate from them (0390).
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'quoted', r.quoted) order by r.act, r.quoted)
      from all_acts a cross join lateral (select r.act, r.quoted from quote_refs r where r.act = a.id offset 0) r join all_acts q on q.id = r.quoted), '[]'),
    -- What earlier windows paid for every player's vote on each Act this window's reactions touch (section 9), and, since 0390, on each spark.
    'paid', coalesce((
      select jsonb_agg(jsonb_build_object('player', q.account, 'act', q.act, 'weight', q.weight, 'shares', q.shares, 'floored', q.floored) order by q.account, q.act)
      from (select p.* from paid_votes p join reacted r on r.act = p.act
            union all select p.* from (select s.id from sparks s where s.id not in (select act from reacted)) s cross join lateral (select p.* from paid_votes p where p.act = s.id offset 0) p) q), '[]'),
    -- What the settlements that ended by the window's start tallied on each spark (0398), by reason, nonzero only: the class is handed it as `paid` (engine/rules/settle.ts, SparkedDebate). One probe of tallied_lines by `act` for each spark.
    'tallied', coalesce((
      select jsonb_agg(jsonb_build_object('act', t.act, 'reason', t.reason, 'amount', t.amount) order by t.act, t.reason)
      from sparks s cross join lateral (
        select l.act, l.reason, sum(l.amount)::integer as amount from tallied_lines l join settlements st on st.id = l.settlement
        where l.act = s.id and st.ends_at <= window_start group by l.act, l.reason having sum(l.amount) <> 0 offset 0) t), '[]'))
$$;
