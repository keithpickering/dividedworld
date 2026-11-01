-- The digest and the role that reads it. The system plan, Task 7; the system design, sections 5 and 13.
--
-- The meeting's Boss reads a digest of the board and decides on moves. The digest is built from what
-- every player can see and from nothing else, and that is held by the database, not by a promise: a
-- role, `kayfabb_digest`, is granted select on public relations only, and `system_digest` is OWNED by
-- it and security definer, so the function runs with that role's privileges and no one's. A later edit
-- that made the function read who reacted, a character's owner or a class would be refused by Postgres
-- with insufficient_privilege (supabase/tests/0049-digest.sql creates exactly such functions and calls them).
-- That test also lists every function the role owns, so a function later given its ownership is reviewed.
--
-- What the role reads, and why each is public:
--   acts_public, characters_public   every Act and every debuted character, as any signed-in player sees them
--   reaction_tallies, reaction_kinds how many of each kind an Act drew (never who), and the kinds' quadrants
--   boards, thread_list              the board and thread names and counters players see
--   settlements, current_standings   the settled standings, as the standings screen shows them
--   staff_profile_now                a Boss's in-character profile, public by design
-- Four of those are tables with row-level security (reaction_tallies, reaction_kinds, boards, settlements): the
-- role gets a policy of its own on each, since a role that is neither a client nor the owner has none. Nothing
-- is granted on characters, class_history, reactions, accounts, ledger, staff_memory, meetings, move_bank or any
-- my_* view. thread_list, current_standings and staff_profile_now run as their owner and carry public columns only.
--
-- Cost on a busy instance. A meeting runs a few times a week and reads the window's posts once: the cost is
-- the posts made in the window (the acts_created index, plus one latest-edit probe each), the tallies on them
-- (primary key on act), and the Boss's own Acts of two windows (acts_character). Every list is cut by a
-- setting before it is returned, so the digest's size does not grow with the instance, only the meeting's read does,
-- and that grows with the window, not with the instance's history. The standings are read only when a settlement
-- landed in the window, as a sort of the season's rows once; that is the one cost that grows with characters.

-- ------------------------------------------------------------------------------------- the role ----

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'kayfabb_digest') then
    create role kayfabb_digest nologin;
  end if;
end $$;

-- On a hosted Supabase the migrating role `postgres` is not a superuser: it may hand a function to a role only
-- while it is a member of that role (and the role holds create on the schema). Locally, as a superuser, this is
-- harmless. The membership gives `postgres` the ability to act as the role, which a superuser has anyway;
-- no client role is a member.
do $$ begin
  if not pg_has_role(current_user, 'kayfabb_digest', 'member') then
    execute format('grant kayfabb_digest to %I', current_user);
  end if;
end $$;

grant usage on schema public to kayfabb_digest;
-- Never what defaults would give: nothing but what is granted below.
revoke all on all tables in schema public from kayfabb_digest;

grant select on acts_public, characters_public, reaction_tallies, reaction_kinds, boards, thread_list,
                settlements, current_standings, staff_profile_now to kayfabb_digest;

create policy digest_reads on reaction_tallies for select to kayfabb_digest using (true);
create policy digest_reads on reaction_kinds for select to kayfabb_digest using (true);
create policy digest_reads on boards for select to kayfabb_digest using (true);
create policy digest_reads on settlements for select to kayfabb_digest using (true);

-- The functions the digest calls: its caps, the season's Boss, the season the standings read, and the grace
-- acts_public's view applies. Each is security definer or reads nothing, and says nothing a player cannot see.
grant execute on function setting(text), current_boss(), standings_season(), span_interval(jsonb) to kayfabb_digest;

-- ---------------------------------------------------------------------------------- the digest ----

-- The digest of the window [since, until), as jsonb:
--   threads        the hottest threads, at most digestThreads: each {thread, title, board, posts, heat, controversy, length}.
--                  heat is the thread's posts in the window per hour of the window. controversy is how split the
--                  reactions on those posts are across the four quadrants: 1 - (the largest quadrant's reactions /
--                  all of them), 0 where there are none. Equal reactions in two quadrants give 0.5, in four 0.75, and
--                  all in one quadrant 0, so equal fire and skull score above fire alone. Ranked by heat, then
--                  controversy, then id.
--   standings      when a settlement ended in the window: the season's top standings, at most digestExcerpts, each
--                  {rank, character, amount}; otherwise empty. (A standing has no history to difference, so "moved"
--                  is "a settlement landed", and the Boss sees where everyone now stands.)
--   moves          empty: Task 8 replaces this function to fill it with the landed moves and their demands' progress.
--   quotes         at most digestExcerpts pairs {from, to, count}: a post in the window quoting another character's
--                  post (a quote is the post's target_act_id, which acts_public carries), the most quoted first.
--   bossReactions  at most digestExcerpts of the current Boss's own Acts from the window and the window before it,
--                  each {act, thread, total, tally}, most reacted first; tally is the public count of each kind.
--   excerpts       at most digestExcerpts of the window's posts that drew the most reactions, each
--                  {act, thread, character, reactions, text}, the text cut to digestExcerptChars.
--   characters     the debuted, public characters the lists above name: [{id, name, staff}]. This is the set the
--                  meeting passes to repairMemory as `publicCharacters` (engine/system/memory.ts), minus
--                  `staff` ones if it wants none. A character that has not debuted has no Act and is never in it.
-- Nothing in it is computed from who reacted, who owns a mask or a class: the role cannot read them.
create function system_digest(since timestamptz, until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  threads_cap integer := (setting('digestThreads'))::integer;
  short_cap integer := (setting('digestExcerpts'))::integer;
  chars integer := (setting('digestExcerptChars'))::integer;
  hours numeric;
  result jsonb;
begin
  if since is null or until is null or until <= since then
    raise exception 'a digest covers a window that ends after it starts' using errcode = '22023';
  end if;
  hours := greatest(extract(epoch from (until - since)) / 3600.0, 1.0 / 60);
  with
  w as (
    select p.id, p.thread, p.character, p.target_act_id, p.created_at, left(p.current_payload ->> 'body', chars) as excerpt
    from acts_public p
    where p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
  ),
  react as (
    select w.thread, k.quadrant, sum(t.count)::integer as n
    from w join reaction_tallies t on t.act = w.id join reaction_kinds k on k.key = t.kind
    group by w.thread, k.quadrant
  ),
  split as (
    select r.thread, sum(r.n) as total, max(r.n) as biggest from react r group by r.thread
  ),
  hot as (
    select tl.id as thread, left(tl.title, 120) as title, b.name as board, h.posts,
           round(h.posts / hours, 2) as heat,
           round(coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0), 4) as controversy,
           tl.last_seq as length
    from (select w.thread, count(*) as posts from w group by w.thread) h
    join thread_list tl on tl.id = h.thread
    join boards b on b.id = tl.board
    left join split s on s.thread = h.thread
    order by h.posts desc, coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0) desc, tl.id
    limit threads_cap
  ),
  stand as (
    select row_number() over (order by cs.standing desc, cs.character) as rank, cs.character, cs.standing as amount
    from current_standings cs
    where exists (select 1 from settlements x where x.ends_at > since and x.ends_at <= until)
      and exists (select 1 from characters_public cp where cp.id = cs.character)
    order by cs.standing desc, cs.character
    limit short_cap
  ),
  quoted as (
    select w.character as q_from, tgt.character as q_to, count(*) as n
    from w join acts_public tgt on tgt.id = w.target_act_id
    where tgt.kind = 'post' and tgt.character is not null and tgt.character <> w.character
    group by w.character, tgt.character
    order by count(*) desc, w.character, tgt.character
    limit short_cap
  ),
  boss as (
    select cp.id from characters_public cp where cp.staff is not null and cp.staff = current_boss()
  ),
  boss_acts as (
    select a.id, a.thread
    from acts_public a
    where a.character in (select id from boss) and a.kind in ('post', 'spin', 'card')
      and a.created_at >= since - (until - since) and a.created_at < until
  ),
  boss_tally as (
    select ba.id as act, ba.thread, sum(t.count)::integer as total, jsonb_object_agg(t.kind, t.count order by t.kind) as tally
    from boss_acts ba join reaction_tallies t on t.act = ba.id
    group by ba.id, ba.thread
    order by sum(t.count) desc, ba.id
    limit short_cap
  ),
  excerpted as (
    select w.id as act, w.thread, w.character, coalesce(sum(t.count), 0)::integer as reactions, w.excerpt, w.created_at
    from w left join reaction_tallies t on t.act = w.id
    group by w.id, w.thread, w.character, w.excerpt, w.created_at
    order by coalesce(sum(t.count), 0) desc, w.created_at desc, w.id
    limit short_cap
  ),
  named as (
    select q_from as id from quoted union select q_to from quoted union select character from stand union select character from excerpted
  )
  select jsonb_build_object(
    'since', since,
    'until', until,
    'threads', coalesce((select jsonb_agg(jsonb_build_object('thread', h.thread, 'title', h.title, 'board', h.board, 'posts', h.posts,
                          'heat', h.heat, 'controversy', h.controversy, 'length', h.length)
                         order by h.posts desc, h.controversy desc, h.thread) from hot h), '[]'::jsonb),
    'standings', coalesce((select jsonb_agg(jsonb_build_object('rank', s.rank, 'character', s.character, 'amount', s.amount) order by s.rank) from stand s), '[]'::jsonb),
    -- Task 8 replaces this function to fill the landed moves and their demands' progress.
    'moves', '[]'::jsonb,
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('from', q.q_from, 'to', q.q_to, 'count', q.n) order by q.n desc, q.q_from, q.q_to) from quoted q), '[]'::jsonb),
    'bossReactions', coalesce((select jsonb_agg(jsonb_build_object('act', bt.act, 'thread', bt.thread, 'total', bt.total, 'tally', bt.tally) order by bt.total desc, bt.act) from boss_tally bt), '[]'::jsonb),
    'excerpts', coalesce((select jsonb_agg(jsonb_build_object('act', e.act, 'thread', e.thread, 'character', e.character, 'reactions', e.reactions, 'text', e.excerpt)
                          order by e.reactions desc, e.created_at desc, e.act) from excerpted e), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'name', cp.name, 'staff', cp.staff is not null) order by cp.id)
                            from characters_public cp where cp.id in (select id from named)), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- The function becomes the role's: it runs with that role's privileges and nothing else's. The owner change
-- needs the role to hold create on the schema while it happens (and the migrating role to be a member of it,
-- granted above); the grant is taken back at once.
grant create on schema public to kayfabb_digest;
alter function system_digest(timestamptz, timestamptz) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;

revoke execute on function system_digest(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function system_digest(timestamptz, timestamptz) to service_role;
