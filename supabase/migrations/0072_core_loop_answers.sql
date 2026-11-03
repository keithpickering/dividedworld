-- The core loop's open questions, answered: docs/plans/2026-11-03-core-loop-answers-plan.md, built from
-- docs/plans/2026-11-03-core-loop-answers-design.md. Each function replaced here is copied from its latest definition and
-- changed only as its header says.

-- ------------------------------------------------------------------------------- the estimate ----

-- estimate_input (0055), with two changes.
--
-- Task 1 (#137, the design's section 7): a card or spring the caller reacted to brings in the post it landed on, and a spin the
-- caller reacted to its origin, as settlement_input's `touched` brings in each window play's target, so estimateForOwner never meets
-- a play whose target is not in its input ("settle: Act <target> is not in the input"), and a staff post such a card landed on is
-- named in `unscored`. The spin is beyond the plan's predicate: the build's quality review found it, with the same root cause.
--
-- Task 2 (#19, the design's section 1): `all_reactions` leaves out only the caller's own reactions to the caller's own
-- characters. See its comment.
create or replace function estimate_input(account uuid, until timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  salt text := gen_random_uuid()::text;
  window_start timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  season_end timestamptz;
  window_end timestamptz;
  you text := md5(salt || 'you');
begin
  -- The window the next settlement reads begins where next_settlement_window (0004) begins it: at
  -- the last settled end, or, where no season holds that instant (a gap between seasons), at the
  -- next season's start; and it never runs past its season's end.
  if window_start is not null and not exists (select 1 from seasons where starts_at <= window_start and (ends_at is null or ends_at > window_start)) then
    window_start := (select min(starts_at) from seasons where starts_at > window_start);
  end if;
  if window_start is null then return null; end if;
  select coalesce(s.ends_at, nullif(greatest(s.starts_at + span_interval(setting('seasonLength')), window_start), window_start)) into season_end
  from seasons s where s.starts_at <= window_start and (s.ends_at is null or s.ends_at > window_start);
  window_end := least(until, coalesce(season_end, 'infinity'));
  if window_start >= window_end then return null; end if;
  return (
  with
  mine as (select id from characters where owner = account),
  win_acts as (select a.* from acts a join mine m on m.id = a.character where a.created_at >= window_start and a.created_at < window_end),
  -- The caller's Acts reacted to in the window, whenever written: each of the caller's Acts, then
  -- its reactions through the index that leads with the Act, never the whole window's reactions.
  mine_reacted as (select distinct a.id as act from acts a join mine m on m.id = a.character
                   where exists (select 1 from reactions r where r.act = a.id and r.created_at >= window_start and r.created_at < window_end)),
  -- The Acts the caller reacted to in the window, through reactions_reactor.
  reacted_by_me as (select distinct r.act from reactions r where r.reactor_account = account and r.created_at >= window_start and r.created_at < window_end),
  targets as (select target_act_id as id from win_acts where kind in ('card', 'spin', 'spring') and target_act_id is not null and coalesce(payload ->> 'reach', 'post') = 'post'),
  -- Every card of the caller's on a post the caller's window cards point at: a vote counts for the earliest.
  my_cards_there as (select a.id from acts a join mine m on m.id = a.character join targets t on t.id = a.target_act_id where a.kind in ('card', 'spring') and a.created_at < window_end and coalesce(a.payload ->> 'reach', 'post') = 'post'),
  -- Cards others played on the caller's posts in the window.
  landed as (select a.id from acts p join mine m on m.id = p.character join acts a on a.target_act_id = p.id
             where a.kind = 'card' and a.created_at >= window_start and a.created_at < window_end and coalesce(a.payload ->> 'reach', 'post') = 'post'),
  -- The caller's spun threads active in the window: the spin, and each character's first post.
  spun as (select distinct s.thread as id from acts s join mine m on m.id = s.character
           where s.kind = 'spin' and exists (select 1 from acts x where x.thread = s.thread and x.created_at >= window_start and x.created_at < window_end)),
  spins as (select a.id from acts a join spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    select f.id from spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.id from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  -- The Acts whose reactions are read.
  voted as (select id from win_acts union select act from mine_reacted union select act from reacted_by_me union select id from targets),
  touched as (
    select id from voted union select id from my_cards_there union select id from landed union select id from spins
    union select target_act_id from acts a join spins s on s.id = a.id where a.target_act_id is not null
    union select id from first_posts
    -- The post each card, spin or spring among the voted Acts points at (Task 1, #137): a card the caller only reacted to is
    -- judged against its post, and a spin the caller only reacted to is read with its origin (settle.ts reads every spin's), as
    -- settlement_input reads every window play's target.
    union select a.target_act_id from acts a join voted v on v.id = a.id
          where a.kind in ('card', 'spin', 'spring') and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post'
  ),
  -- As settlement_input (0004, as 0043 changed it): a staff character's Acts, and a card on one, are named and pay nobody.
  all_acts as (select a.* from acts a join touched t on t.id = a.id where a.created_at < window_end and a.character is not null
               and not is_staff_side(a.character, a.kind, a.target_act_id)),
  -- A staff post a window's card of the caller's landed on, as settlement_input names it (0054).
  unscored as (select a.* from acts a join characters c on c.id = a.character join touched t on t.id = a.id
               where c.staff is not null and a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start and coalesce(k.payload ->> 'reach', 'post') = 'post')),
  system_acts as (select a.id from acts a join touched t on t.id = a.id
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  -- Every reaction on an Act voted on, up to now, but the caller's own to the caller's own characters,
  -- and none on The System's own Acts: the tally every player reacts to would hand each caller who
  -- reacted to it every other player's reaction.
  --
  -- The settlement never pays a player's reactions to their own characters, and until 0072 this read
  -- left them out too, which made a live line computed from who reacted: a fire landing on Bob's post
  -- under Ann's card with no lift line told Ann it came from one of Bob's masks. The live estimate is not
  -- The System's scoring (CLAUDE.md, "A response never proves a private fact": "The live estimate is not
  -- that exception: it leaves out only the caller's own reactions, counts every other as anyone's, and
  -- the settlement is exact"). So ownership is read here only to tell the caller's own from the rest:
  -- the caller knows their own, and every other reaction, the author's own player's included, is
  -- counted under `keyed`'s per-mask keys, which the engine cannot tie to an author. The estimate can then
  -- say more than the settlement pays, as it says "up to"; the settled log is exact.
  all_reactions as (
    select r.* from reactions r join voted v on v.id = r.act
    join acts a on a.id = r.act join characters c on c.id = a.character
    where r.created_at < window_end and not (r.reactor_account = account and c.owner = account)
      and (not is_staff_side(a.character, a.kind, a.target_act_id) or a.id in (select id from unscored))
  ),
  -- Each reaction's voter and mask as the engine reads them: the caller's own, as the caller's;
  -- any other's, under keys made up for this request.
  keyed as (
    select r.id, r.act, r.kind, r.created_at,
      case when r.reactor_account = account then you else md5(salt || 'reactor' || r.reactor_character) end as player,
      case when r.reactor_account = account then r.reactor_character::text else md5(salt || 'mask' || r.reactor_character) end as character
    from all_reactions r
  ),
  others as (
    select distinct a.character::text as id, md5(salt || 'author' || a.character) as player from all_acts a where a.character not in (select id from mine)
    union select distinct k.character, k.player from keyed k where k.player <> you
  )
  select jsonb_build_object(
    'player', you,
    -- The window's start exactly, as the settlement that opened it ended: `from` is whole
    -- milliseconds, which can fall short of it. The estimate keeps its answer with this one.
    'windowStart', window_start,
    'window', jsonb_build_object('id', 'estimate',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(x order by x ->> 'id') from (
        select jsonb_build_object('id', c.id, 'player', you, 'classes', coalesce((
          select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
          from class_history h where h.character = c.id and h.started_at < window_end), '[]')) as x
        from characters c join mine m on m.id = c.id
        union all
        select jsonb_build_object('id', o.id, 'player', o.player, 'classes', '[]'::jsonb) from others o
      ) cs), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread,
        'target', case when coalesce(a.payload ->> 'reach', 'post') = 'post' then a.target_act_id end,
        'reach', case when a.kind = 'card' then nullif(coalesce(a.payload ->> 'reach', 'post'), 'post') end,
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    'unscoredTargets', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'staff', true) order by a.created_at, a.id)
      from unscored a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', k.act, 'kind', k.kind, 'at', (extract(epoch from k.created_at) * 1000)::bigint,
        'player', k.player, 'character', k.character) order by k.created_at, k.id)
      from keyed k), '[]'),
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'))
  );
end $$;

-- ------------------------------------------------------------------------ the settle run's claim ----

-- Task 4 (#22, the design's section 4). unmask() refuses while a character's waiting Turn's window has passed its end, so a reveal
-- never names the class the Turn replaces dated after the Turn took effect. Where the window's end is not known in advance (a
-- season's first window, and the window after a season's end: next_settlement_at is null) nothing told it a run was applying that
-- window. The settle function's steps (next_settlement_window, settlement_input, apply_settlement, supabase/functions/settle/core.ts)
-- are separate requests, so no transaction lock spans a run: the run records the window it has chosen, here, before it reads its
-- input, and unmask() waits while that window covers a waiting Turn and is not yet settled. The run learns the window's end from
-- next_settlement_window and claims it in the next request, so a reveal committed in that one round trip is not refused; the gap
-- was the whole run's before.
--
-- Not an Act: a run's clock, the service's alone, read by no player and by no screen. A claim ends when its window's settlement is
-- applied; a run that dies leaves its claim, so it also ends five minutes after it was made, five times a run's budget (MOST_RUN_MS,
-- 60 seconds), so a live run is never outlived by its claim's end and a dead one blocks no reveal for long. A second run on the same
-- window makes the claim afresh. One row a window, so the table grows by one row a settlement.
create table settlement_claims (
  window_end timestamptz primary key,
  claimed_at timestamptz not null default now()
);
alter table settlement_claims enable row level security;
revoke all on settlement_claims from public, anon, authenticated;

create function claim_settlement_window(window_end timestamptz) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into settlement_claims (window_end, claimed_at) values (claim_settlement_window.window_end, now())
  on conflict on constraint settlement_claims_pkey do update set claimed_at = now()
$$;
revoke execute on function claim_settlement_window(timestamptz) from public, anon, authenticated;
grant execute on function claim_settlement_window(timestamptz) to service_role;

-- unmask() (0027), refusing too while a fresh claim covers a waiting Turn and its window is unsettled; both refusals say the same.
-- The refusal turns on the caller's own character's own Turn and on the run's clock, never on another player; that a run is under
-- way is public, since when The System settles is the same for everyone. Its way out: the run applies the window, or the claim is
-- five minutes old, by itself, and the player may withdraw the Turn. Everything else as 0027 wrote it.
create or replace function unmask(through uuid, in_thread uuid, message text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  said text := coalesce(message, '');
  on_board uuid;
begin
  perform acting(through);
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  perform 1 from characters where id = through for no key update;
  if exists (select 1 from pending_turns p where p.character = through and (
       next_settlement_at(p.asked_at) <= now()
       or exists (select 1 from settlement_claims k
                  where k.window_end > p.asked_at and k.claimed_at > now() - interval '5 minutes'
                    and not exists (select 1 from settlements s where s.ends_at = k.window_end)))) then
    raise exception 'this character''s Turn takes effect at the settlement now running; reveal in a few minutes' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  return write_unmask(through, in_thread, 'act', now(), said);
end $$;

-- --------------------------------------------------------------------------- an announced Turn ----

-- Task 5 (#23, the design's section 5). A Turn that names its old class (show_from) wrote `was` and `since` into its tally. `since`
-- is the date the old class began, so where an earlier silent Turn began it, the announcement dated the silent Turn in public. A
-- Turn announced with its old class makes that fact public as of its date, and nothing else about it is (CLAUDE.md, "A response
-- never proves a private fact"): an announced Turn says what the character was, as of the Turn, and the read projections carry no
-- `since`. Tallies already written keep their payload (Append-only); the export carries Acts as written.

-- masks_change (0028), writing `{was}` alone where the Turn names the class it leaves. Everything else as 0028 wrote it.
create or replace function masks_change(window_end timestamptz) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  most constant integer := 100;
  in_season bigint;
  first_tally uuid;
  posted jsonb;
  unmasked jsonb;
  parts integer;
  r record;
begin
  if to_regclass('pg_temp.masks_named') is null then
    create temp table masks_named (n bigint, kind text, entry jsonb, unmasks boolean) on commit drop;
    create temp table masks_turns (character uuid, class_key text, loudness text, show_from boolean, show_to boolean, name text, was text) on commit drop;
  end if;
  truncate masks_named, masks_turns;
  -- The characters made before the window's end, and still waiting, debut at it; the announced
  -- ones are named. One made in a transaction this one could not see yet waits for the next
  -- settlement. A drop locks its character's row first, so one dropped while this runs is either
  -- debuted here (and its drop refused, "it has debuted") or by its drop (and not here).
  -- A retired character makes no Act: one owed its announcement across a gap and retired since is
  -- named, as it was due to be, and never unmasked, or no settlement could write its tally.
  with d as (
    update characters set debuted_at = window_end where debuted_at is null and created_at < window_end returning id, name, debut_loudness, retired_at
  ), owed as (
    update characters set debut_announcement_due = false where debut_announcement_due and debuted_at < window_end returning id, name, debut_loudness, retired_at
  ) insert into masks_named (n, kind, entry, unmasks)
    select row_number() over (order by name, id), 'debut', jsonb_build_object('character', id, 'name', name), debut_loudness = 'with_class' and retired_at is null
    from (select id, name, debut_loudness, retired_at from d where debut_loudness <> 'silent' union all select id, name, debut_loudness, retired_at from owed) named;
  -- The Turns asked before the window's end take effect at it; their characters' rows are locked
  -- first, in one order, so a turn() racing this one waits and then reads what took effect. What
  -- a loud Turn says is read before the Turn is written.
  perform 1 from characters c where c.id in (select character from pending_turns where asked_at < window_end) order by c.id for no key update;
  insert into masks_turns
    select p.character, p.class_key, p.loudness, p.show_from, p.show_to, c.name, n.class_key
    from pending_turns p join characters c on c.id = p.character cross join lateral class_now(p.character, window_end) n
    where p.asked_at < window_end;
  insert into class_history (character, class_key, started_at) select character, class_key, window_end from masks_turns;
  delete from pending_turns p using masks_turns t where p.character = t.character;
  insert into masks_named (n, kind, entry, unmasks)
    select (select count(*) from masks_named) + row_number() over (order by name, character), 'turn',
      jsonb_build_object('character', character, 'name', name, 'loudness', loudness)
      || case when show_from then jsonb_build_object('was', was) else '{}'::jsonb end
      || case when show_to then jsonb_build_object('class', class_key) else '{}'::jsonb end,
      show_to
    from masks_turns where loudness <> 'silent';
  update masks_named m set entry = m.entry || jsonb_build_object('class', (select class_key from class_now((m.entry ->> 'character')::uuid, window_end)))
  where m.kind = 'debut' and m.unmasks;
  if not exists (select 1 from masks_named) then return null; end if;

  select id into in_season from seasons where starts_at < window_end and (ends_at is null or ends_at >= window_end) order by starts_at desc limit 1;
  parts := ((select count(*) from masks_named) + most - 1) / most;
  for part in 1..parts loop
    posted := post_tally(in_season,
      (select coalesce(jsonb_agg(entry order by n) filter (where kind = 'debut'), '[]') from masks_named where (n - 1) / most = part - 1),
      (select coalesce(jsonb_agg(entry order by n) filter (where kind = 'turn'), '[]') from masks_named where (n - 1) / most = part - 1),
      window_end, part, parts);
    if posted -> 'thread' <> 'null'::jsonb then
      perform broadcast_later('board:' || (posted -> 'thread' ->> 'board'), 'thread', posted -> 'thread');
    end if;
    first_tally := coalesce(first_tally, (posted -> 'act' ->> 'id')::uuid);
    perform broadcast_later('thread:' || (posted -> 'act' ->> 'thread'), 'act', posted -> 'act');
    -- The part's reveals, in its order, right after it: the character's own Acts, by The System's hand.
    for r in select kind, entry from masks_named where (n - 1) / most = part - 1 and unmasks order by n loop
      unmasked := write_unmask((r.entry ->> 'character')::uuid, (posted -> 'act' ->> 'thread')::uuid, r.kind, window_end);
      perform broadcast_later('thread:' || (unmasked ->> 'thread'), 'act', unmasked);
    end loop;
  end loop;
  return first_tally;
end $$;

-- turns_announced (0027), without `since`. A view cannot lose a column in place, so it is made again, with its grants.
drop view turns_announced;
create view turns_announced as
  select a.id as act, c.id as character, a.created_at as at, e.entry ->> 'was' as was
  from characters c
  cross join lateral (
    select x.id, x.created_at, x.payload from acts x
    where x.kind = 'tally' and x.payload -> 'turns' @> jsonb_build_array(jsonb_build_object('character', c.id))
  ) a
  cross join lateral jsonb_array_elements(a.payload -> 'turns') e(entry)
  where e.entry ->> 'character' = c.id::text;
revoke all on turns_announced from anon, authenticated;
grant select on turns_announced to authenticated;

-- reveal_season (0051), its `shown` naming the class an announced Turn left and not since when. Everything else as 0051 wrote it.
create or replace function reveal_season(ended timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  new_season bigint;
  in_thread uuid;
  written uuid;
begin
  select * into s from seasons where ends_at is null for no key update;
  if s.id is null or s.starts_at + span_interval(setting('seasonLength')) > ended then return null; end if;

  update seasons set ends_at = ended where id = s.id;
  insert into seasons (number, starts_at) values (s.number + 1, ended) returning id into new_season;
  begin
    perform hand_over(new_season, s.boss, ended);
  exception when others then
    raise warning 'reveal_season: the handover of season % failed: % (%)', s.number + 1, sqlerrm, sqlstate;
    -- The season keeps its outgoing Boss rather than none, where that much can still be done.
    begin
      update seasons set boss = s.boss where id = new_season and boss is null;
      insert into season_handovers (season, outgoing, boss, how, note, at)
      values (new_season, s.boss, s.boss, case when s.boss is null then 'none' else 'unchanged' end, left('the handover failed: ' || sqlerrm, 1000), ended)
      on conflict (season) do nothing;
    exception when others then null;
    end;
  end;
  insert into threads (board, title) values (system_board(), copy_of('revealTitle', s.number)) returning id into in_thread;
  perform broadcast_later('board:' || (select board from threads where id = in_thread), 'thread', thread_projection(in_thread));
  -- The reveal's own Act says what the season was; each character follows it as an Act of its
  -- own, so the reveal is many small rows at any size of cast, never one payload holding all of
  -- them. Characters by name; who plays them, never. A character that debuts at this very
  -- settlement played no part in the season, and is the next one's.
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'reveal', in_thread, jsonb_build_object('season', s.number, 'from', s.starts_at, 'to', ended,
    'body', copy_of('revealBody', s.number), 'characters', (select count(*) from characters where debuted_at < ended and staff is null)), ended) returning id into written;
  perform broadcast_later('thread:' || in_thread, 'act', act_projection(written));
  -- Each character in order of final standing, with its place and its standing, and only what its
  -- player made public in the season (`shown`): its reveals, and its announced Turns with the class
  -- each left where the Turn named it, in order. Read from class_reveals and turns_announced (0027),
  -- which read Acts alone, so no unrevealed class and no silent Turn is in it: they roll over into
  -- the next season, a clue rather than a stated fact (the class reveal design, section 5). A Turn
  -- that took effect at this very end is the next season's, as before. At one instant a Turn comes
  -- before the reveal it wrote (0028), as its tally stands before it in the thread.
  insert into acts (character, kind, thread, payload, created_at)
    select null, 'reveal', in_thread, jsonb_build_object('season', s.number, 'character', c.id, 'name', c.name,
        'place', rank() over (order by coalesce(st.amount, 0) desc), 'standing', coalesce(st.amount, 0),
        'shown', coalesce((
          select jsonb_agg(x.entry order by x.at, x.after, x.act) from (
            select r.at, 1 as after, r.act, jsonb_build_object('kind', 'reveal', 'act', r.act, 'at', r.at, 'class', r.class, 'via', r.via) as entry
            from class_reveals r where r.character = c.id and r.at >= s.starts_at and r.at < ended
            union all
            select t.at, 0, t.act, jsonb_build_object('kind', 'turn', 'act', t.act, 'at', t.at)
              || case when t.was is null then '{}'::jsonb else jsonb_build_object('was', t.was) end
            from turns_announced t where t.character = c.id and t.at >= s.starts_at and t.at < ended
          ) x), '[]'::jsonb)), ended
    from characters c left join standings st on st.character = c.id and st.season = s.id
    where c.debuted_at < ended and c.staff is null
    order by coalesce(st.amount, 0) desc, c.name, c.id;
  -- Each in the thread's order, in a statement of its own, which sees the rows the one above wrote.
  insert into broadcasts_due (topic, event, payload)
  select 'thread:' || in_thread, 'act', act_projection(a.id) from acts a where a.thread = in_thread and a.id <> written order by a.seq;
  update seasons set reveal_act = written where id = s.id;
  return jsonb_build_object('season', s.number, 'thread', thread_projection(in_thread), 'act', act_projection(written));
end $$;

-- -------------------------------------------------------------------- the numbers a line was settled under ----

-- Task 7 (#57, the design's section 6). A class's words state numbers an admin can retune (`lurker.postsAllowed`), and a ledger row
-- held only its reason, so a line settled before a retune was said with the number in force when it was read. The log must not lie
-- about an old line either: the settlement writes the numbers each entry's words state (engine/rules/types.ts, Earning.params) into
-- its row, and the log reads them first, and today's settings only where a row has none (a row from before this column, or one
-- whose reason states no number). Settings, which are public; the row is the player's own, read through my_ledger as before.
alter table ledger add column params jsonb check (params is null or jsonb_typeof(params) = 'object');

-- my_ledger (0037), with each row's numbers as its last column.
create or replace view my_ledger as
  select l.settlement, s.starts_at, s.ends_at, l.character, l.reason, l.amount,
         l.settlement >= coalesce((select k.from_settlement from ledger_shares_kept k), 1) as shares_kept,
         l.params
  from ledger l join settlements s on s.id = l.settlement
  where l.account = auth.uid();

-- apply_settlement (0034), checking each entry's params and writing them into its row. Everything else as 0034 wrote it.
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
  -- An entry's params, where it has them: the numbers its reason's words state, each a number by its key (0072). The engine writes
  -- them from the settings it settled under, so anything else is a fault in the call, never repaired here.
  if exists (select 1 from jsonb_array_elements(entries) e
             -- CASE, so the type is read before jsonb_each, which refuses anything but an object in words of its own.
             where e ? 'params' and jsonb_typeof(e -> 'params') <> 'null'
               and case when jsonb_typeof(e -> 'params') <> 'object' then true
                        else exists (select 1 from jsonb_each(e -> 'params') p where jsonb_typeof(p.value) <> 'number') end) then
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
  -- One entry per character and reason, as settle() sums them (the ledger's unique index, above):
  -- the shares are checked against it, and it against them.
  if exists (select 1 from jsonb_array_elements(entries) e group by (e ->> 'character')::uuid, e ->> 'reason' having count(*) > 1) then
    raise exception 'two entries name one character and reason' using errcode = '22023';
  end if;
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
             group by (s ->> 'character')::uuid, s ->> 'reason', (s ->> 'act')::uuid, coalesce(s ->> 'quadrant', '') having count(*) > 1) then
    raise exception 'two shares name one entry''s Act and quadrant' using errcode = '22023';
  end if;
  if exists (select 1 from (select s ->> 'character' as character, s ->> 'reason' as reason, sum((s ->> 'amount')::numeric) as total
                            from jsonb_array_elements(coalesce(shares, '[]')) s group by 1, 2) g
             where g.total is distinct from (select sum((e ->> 'amount')::numeric) from jsonb_array_elements(entries) e
                                             where e ->> 'character' = g.character and e ->> 'reason' = g.reason)) then
    raise exception 'an entry''s shares add up to it' using errcode = '22023';
  end if;

  insert into settlements (starts_at, ends_at, season) values (window_start, window_end, open_season) returning id into settled;
  insert into ledger (settlement, account, character, reason, amount, params)
  select settled, (e ->> 'player')::uuid, (e ->> 'character')::uuid, e ->> 'reason', (e ->> 'amount')::numeric::integer, nullif(e -> 'params', 'null'::jsonb)
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

-- screen_settings (0064), handing the screens the economy row too: the numbers a class's words state, which are settings and public
-- (Task 7; ScreenSettings.economy, engine/ui/economy.ts). Everything else as 0064 wrote it.
create or replace view screen_settings as
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
         || jsonb_build_object('cardEconomy', (
              select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
              from settings x cross join lateral jsonb_each(x.value) e
              where x.key = 'economy' and jsonb_typeof(x.value) = 'object'
                and e.key in (select k.price_setting from card_kinds k union select unnest(k.reads) from card_kinds k))) as settings
  from settings s
  where s.key in ('postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime',
                  'turnCooldown', 'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength', 'cardSettings',
                  'presencePollSeconds', 'presenceWindow', 'toastDefaults', 'economy');
