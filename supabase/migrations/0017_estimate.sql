-- What a player's live estimate reads (engine/rules/settle.ts's estimateForOwner): the open
-- window so far, scoped to what one player's characters did and received. The screens' engine
-- plan, Task 5; the screens' design, section 7, where the live preview became an estimate.
--
-- settlement_input (0004) reads every player's window, with who reacted, for the settlement's
-- arithmetic. This reads only what the caller's estimate needs, and names nobody: the caller's
-- characters, with their classes, under one key that stands for the caller; every other
-- character that wrote an Act read here under a key of its own, with no class; and every other
-- reaction under a key for its reactor's character that this request made up. Keys are drawn from a
-- salt chosen afresh for each call, so no two answers share one, and no key groups two masks of
-- one player: a player's reaction to their own character's Act is dropped here, where who owns
-- what is known, rather than handed to the engine to drop. With the shared vote and the halving
-- off (settle.ts), nothing the engine computes for the caller then depends on how anyone else's
-- reactions group into players ("A response never varies with a private fact").
--
-- It reads, in the open window (from the last settled window's end, or the season's start, to
-- now): the caller's Acts; the caller's Acts reacted to, whenever written; the Acts the caller
-- reacted to; the posts the caller's cards and spins point at, and every card of the caller's on
-- those posts; the cards others played on the caller's posts; and for each thread a caller's
-- character spun that is active, its spin and each character's first post in it. With every
-- reaction on the Acts reacted to, earlier ones included, for a post's reactors and lean, but
-- none on The System's own Acts, which are named and pay nobody. Its
-- cost is the caller's own activity and the reactions it drew, never the instance's: each of the
-- caller's Acts is looked up by acts_character, its reactions and cards by the indexes that lead
-- with the Act (reactions' unique index, acts_target), and the caller's own reactions by
-- reactions_reactor. A post with thousands of reactions is thousands of rows; a player with
-- thousands of posts is that many index probes. Read by the service only.

-- `until` is now for every caller the estimate function makes; a test reads a window it wrote.
create function estimate_input(account uuid, until timestamptz default now()) returns jsonb
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
  targets as (select target_act_id as id from win_acts where kind in ('card', 'spin') and target_act_id is not null),
  -- Every card of the caller's on a post the caller's window cards point at: a vote counts for the earliest.
  my_cards_there as (select a.id from acts a join mine m on m.id = a.character join targets t on t.id = a.target_act_id where a.kind = 'card' and a.created_at < window_end),
  -- Cards others played on the caller's posts in the window.
  landed as (select a.id from acts p join mine m on m.id = p.character join acts a on a.target_act_id = p.id
             where a.kind = 'card' and a.created_at >= window_start and a.created_at < window_end),
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
  ),
  all_acts as (select a.* from acts a join touched t on t.id = a.id where a.created_at < window_end and a.character is not null),
  system_acts as (select a.id from acts a join touched t on t.id = a.id where a.character is null),
  -- Every reaction on an Act voted on, up to now, but a player's to their own character's, and none
  -- on The System's own Acts: the settlement pays nobody for those (Task 3), and the tally every
  -- player reacts to would hand each caller who reacted to it every other player's reaction.
  all_reactions as (
    select r.* from reactions r join voted v on v.id = r.act
    join acts a on a.id = r.act join characters c on c.id = a.character
    where r.created_at < window_end and r.reactor_account <> c.owner
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
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'target', a.target_act_id,
        'card', case when a.kind = 'card' then a.payload ->> 'card' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', k.act, 'kind', k.kind, 'at', (extract(epoch from k.created_at) * 1000)::bigint,
        'player', k.player, 'character', k.character) order by k.created_at, k.id)
      from keyed k), '[]'),
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'))
  );
end $$;

revoke execute on function estimate_input(uuid, timestamptz) from public, anon, authenticated;
grant execute on function estimate_input(uuid, timestamptz) to service_role;

-- Each player's last estimate, kept for the estimate function to give again to every ask inside its
-- hold (supabase/functions/estimate/core.ts): a post drawing a crowd of reactions is one read of the
-- window per hold, never one per reaction. Private, the service's alone: it is the player's own
-- estimate, never read by anyone else, and a newer one replaces it.
create table estimates (
  account uuid primary key references accounts (id),
  made_at timestamptz not null,
  -- Where the window it was read from opens: a settlement of that window ends the answer.
  window_from timestamptz not null,
  answer jsonb not null
);

-- The kept answer, inside its hold and only while its window is unsettled: a settled window's
-- lines are never shown as still to come. Read from the window, not the clock, so a settlement
-- whose transaction began before the answer was kept and committed after it ends it too.
create function estimate_kept(account uuid, within_seconds integer) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select e.answer from estimates e
  where e.account = estimate_kept.account and e.made_at > clock_timestamp() - make_interval(secs => within_seconds)
    and not exists (select 1 from settlements s where s.ends_at > e.window_from)
$$;

-- Keeps an answer, and gives it back as every ask in its hold will be given it: with asOf, when
-- it was made, and freshAfter, when an ask is answered anew. The screens ask again at freshAfter
-- when a reaction landed while they held it (supabase/functions/estimate/index.ts).
create function estimate_keep(account uuid, answer jsonb, within_seconds integer, window_from timestamptz) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  insert into estimates as e (account, made_at, window_from, answer)
  select account, t.at, window_from, answer || jsonb_build_object('asOf', t.at, 'freshAfter', t.at + make_interval(secs => within_seconds))
  from (select clock_timestamp() as at) t
  on conflict (account) do update set made_at = excluded.made_at, window_from = excluded.window_from, answer = excluded.answer
  returning e.answer
$$;

alter table estimates enable row level security;
revoke all on estimates from anon, authenticated;
revoke execute on function estimate_kept(uuid, integer), estimate_keep(uuid, jsonb, integer, timestamptz) from public, anon, authenticated;
grant execute on function estimate_kept(uuid, integer), estimate_keep(uuid, jsonb, integer, timestamptz) to service_role;
