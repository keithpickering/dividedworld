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
-- reaction on the Acts reacted to, earlier ones included, for a post's reactors and lean. Its
-- cost is the caller's own activity and the reactions it drew: a post with thousands of reactions
-- is thousands of rows, read through reactions' unique index, which leads with the Act. Read by
-- the service only.

-- `until` is now for every caller the estimate function makes; a test reads a window it wrote.
create function estimate_input(account uuid, until timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  salt text := gen_random_uuid()::text;
  window_start timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  window_end timestamptz := until;
  you text := md5(salt || 'you');
begin
  if window_start is null or window_start >= window_end then return null; end if;
  return (
  with
  mine as (select id from characters where owner = account),
  win_acts as (select a.* from acts a join mine m on m.id = a.character where a.created_at >= window_start and a.created_at < window_end),
  win_reactions as (select r.* from reactions r where r.created_at >= window_start and r.created_at < window_end),
  -- The caller's Acts reacted to in the window, whenever written.
  mine_reacted as (select distinct r.act from win_reactions r join acts a on a.id = r.act join mine m on m.id = a.character),
  -- The Acts the caller reacted to in the window.
  reacted_by_me as (select distinct r.act from win_reactions r where r.reactor_account = account),
  targets as (select target_act_id as id from win_acts where kind in ('card', 'spin') and target_act_id is not null),
  -- Every card of the caller's on a post the caller's window cards point at: a vote counts for the earliest.
  my_cards_there as (select a.id from acts a join mine m on m.id = a.character join targets t on t.id = a.target_act_id where a.kind = 'card' and a.created_at < window_end),
  -- Cards others played on the caller's posts in the window.
  landed as (select a.id from acts a join acts p on p.id = a.target_act_id join mine m on m.id = p.character
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
  -- Every reaction on an Act voted on, up to now, but a player's to their own character's.
  all_reactions as (
    select r.* from reactions r join voted v on v.id = r.act
    join acts a on a.id = r.act left join characters c on c.id = a.character
    where r.created_at < window_end and r.reactor_account is distinct from c.owner
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
