-- Hot triggers name their post: the database (docs/plans/2026-11-23-hot-triggers-name-their-post-plan.md, Task 1; design sections 0 to 2).
--
-- Task 1. pool_signals' `hot` part (0358_blind_totals.sql) named threads and their authors and no post, so a hot trigger could quote nothing. Each author of a hot thread now carries `top`: the author's most reacted post
-- in the thread inside the window (the totals the crowd sees, reaction_tallies_open, so a post under a live totals veil counts none; a tie to the newer post), read through acts_thread_posts (thread, character,
-- created_at) one probe for each author. Each hot thread carries `tops`: its two most reacted posts by two different characters, each {act, character}, by the same order. Everything else in pool_signals as 0358 wrote it
-- (owner and grants kept, as a replaced function keeps them).
-- Ways out: no state is added; the signal is a read.
-- Masks: only the totals the crowd sees and the public Acts' characters are read, never who reacted, an owner or a class; the digest role's own list of what it may read is not widened (reaction_tallies_open it read already).
--
-- The test that drives it red is supabase/tests/0420-hot-posts.sql.

create or replace function pool_signals(since timestamptz, until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  threads_cap integer := (setting('digestThreads'))::integer;
  days integer := coalesce(((setting('pool') ->> 'priorityDays'))::integer, 28);
  boss text := current_boss();
  hours numeric;
  result jsonb;
begin
  if since is null or until is null or until <= since then
    raise exception 'signals cover a window that ends after it starts' using errcode = '22023';
  end if;
  hours := greatest(extract(epoch from (until - since)) / 3600.0, 1.0 / 60);
  with
  -- The window's move_end and move_keep Acts, each with the move's owner when it fell: move_owner (0051) for an end, the latest keep
  -- else the writer; for a keep, the owner before it (the latest earlier keep, else the writer). Read from the public views, as the
  -- role may; supabase/tests/0090-pool-signals.sql checks an end's owner against move_owner itself.
  ev as (
    select e.id as act, e.thread, e.created_at, e.target_act_id as move,
           case when e.kind = 'move_keep' then 'kept' else e.payload ->> 'why' end as how,
           e.payload ->> 'by' as by_whom,
           coalesce(
             (select kc.staff from acts_public k join characters_public kc on kc.id = k.character
               where k.kind = 'move_keep' and k.target_act_id = e.target_act_id
                 and (e.kind = 'move_end' or (k.created_at, k.id) < (e.created_at, e.id))
               order by k.created_at desc, k.id desc limit 1),
             (select mc.staff from acts_public mv join characters_public mc on mc.id = mv.character where mv.id = e.target_act_id and mv.kind = 'move')) as owner,
           (select mc.staff from acts_public mv join characters_public mc on mc.id = mv.character where mv.id = e.target_act_id and mv.kind = 'move') as maker
    from acts_public e
    where e.kind in ('move_end', 'move_keep') and e.created_at >= since and e.created_at < until
  )
  select jsonb_build_object(
    'named', pool_named(since, until),
    'quoted', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', q.staff, 'act', q.act, 'thread', q.thread, 'n', q.n) order by q.staff, q.created_at desc, q.act desc), '[]'::jsonb)
      from (
        select tc.staff, w.id as act, w.thread, w.created_at,
               row_number() over (partition by tc.staff order by w.created_at desc, w.id desc) as rn,
               count(*) over (partition by tc.staff) as n
        from acts_public w
        join acts_public tgt on tgt.id = w.target_act_id
        join characters_public tc on tc.id = tgt.character
        where w.kind = 'post' and w.created_at >= since and w.created_at < until and w.character is not null
          and tgt.kind = 'post' and tc.staff is not null and tc.office is distinct from 'developer' and tc.office is distinct from 'anonymous' and w.character <> tgt.character
      ) q where q.rn <= 5),
    'legacy', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', l.owner, 'maker', l.maker, 'move', l.move, 'act', l.act, 'thread', l.thread, 'how', l.how, 'n', l.n) order by l.maker, l.created_at desc, l.act desc), '[]'::jsonb)
      from (
        select v.*, row_number() over (partition by v.maker order by v.created_at desc, v.act desc) as rn, count(*) over (partition by v.maker) as n
        from ev v where v.owner is not null and v.maker is not null and (v.owner is distinct from boss or v.maker is distinct from boss)
      ) l where l.rn <= 5),
    'reversals', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', v.owner, 'move', v.move, 'act', v.act, 'thread', v.thread) order by v.created_at desc, v.act desc), '[]'::jsonb)
      from ev v where v.owner is not distinct from boss and v.owner is not null and v.how = 'reversed' and v.by_whom = 'admin'),
    'handovers', (
      select coalesce(jsonb_agg(jsonb_build_object('season', h.season, 'outgoing', h.outgoing, 'boss', h.boss, 'how', h.how, 'at', h.landed_at,
                                                   'act', arr.id, 'thread', arr.thread) order by h.landed_at, h.season), '[]'::jsonb)
      from season_handovers h left join acts_public arr on arr.id = h.arrival_act where h.landed_at >= since and h.landed_at < until),
    'hot', (
      select coalesce(jsonb_agg(jsonb_build_object('thread', x.thread, 'board', x.board, 'heat', x.heat, 'starter', x.starter,
                                                   'starterStaff', x.starter_staff, 'staffStarted', x.starter_staff is not null,
                                                   'authors', x.authors, 'tops', x.tops, 'boardMaker', null) order by x.posts desc, x.thread), '[]'::jsonb)
      from (
        select tl.id as thread, tl.board, h.posts, round(h.posts / hours, 2) as heat, tl.first_character as starter, sc.staff as starter_staff,
               -- Each of the ten most frequent authors, with `top`: that author's most reacted post in the thread inside the window, the totals the crowd sees (reaction_tallies_open, a post under a live totals veil counts none),
               -- a tie to the newer (created_at, id). The ten are cut first and each top read after, so a hot thread costs ten probes of acts_thread_posts (thread, character, created_at) and the tallies of that author's window posts.
               (select coalesce(jsonb_agg(jsonb_build_object('character', a.character, 'posts', a.n,
                         'top', (select tp.id from acts_public tp left join lateral (select sum(tt.count) as n from reaction_tallies_open tt where tt.act = tp.id) rt on true where tp.thread = tl.id and tp.character = a.character and tp.kind = 'post' and tp.created_at >= since and tp.created_at < until order by coalesce(rt.n, 0) desc, tp.created_at desc, tp.id desc limit 1))
                       order by a.n desc, a.character), '[]'::jsonb)
                from (select p.character, count(*) as n from acts_public p
                      where p.thread = tl.id and p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
                      group by p.character order by n desc, p.character limit 10) a) as authors,
               -- `tops`: the thread's two most reacted posts in the window by two different characters (each character's best, then the two best of those), by the same order.
               -- Cost, accepted: one pass over each hot thread's window posts (at most digestThreads threads) with one tally probe per post, the same order of work as the window scan `hot` already does to count posts, so it grows
               -- with the window's posts and never with the instance's history. It is the full pass, not the ten authors' tops, because the thread's best posts may be any author's.
               (select coalesce(jsonb_agg(jsonb_build_object('act', b.id, 'character', b.character) order by coalesce(b.n, 0) desc, b.created_at desc, b.id desc), '[]'::jsonb)
                from (select * from (select distinct on (tp.character) tp.id, tp.character, tp.created_at, rt.n
                                     from acts_public tp left join lateral (select sum(tt.count) as n from reaction_tallies_open tt where tt.act = tp.id) rt on true
                                     where tp.thread = tl.id and tp.kind = 'post' and tp.character is not null and tp.created_at >= since and tp.created_at < until
                                     order by tp.character, coalesce(rt.n, 0) desc, tp.created_at desc, tp.id desc) best
                      order by coalesce(best.n, 0) desc, best.created_at desc, best.id desc limit 2) b) as tops
        from (
          select p.thread, count(*) as posts from acts_public p
          where p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
          group by p.thread
        ) h
        join thread_list tl on tl.id = h.thread
        left join characters_public sc on sc.id = tl.first_character and sc.office is distinct from 'developer' and sc.office is distinct from 'anonymous'
        order by h.posts desc, tl.id
        limit threads_cap
      ) x),
    'tallies', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', t.staff, 'posts', t.posts, 'reactions', t.reactions) order by t.staff), '[]'::jsonb)
      from (
        select c.staff, count(a.id) as posts, coalesce(sum(r.n), 0)::bigint as reactions
        from characters_public c
        left join acts_public a on a.character = c.id and a.kind = 'post' and a.created_at >= until - days * interval '1 day' and a.created_at < until
        left join lateral (select sum(tt.count) as n from reaction_tallies_open tt where tt.act = a.id) r on true
        where c.staff is not null and c.office is distinct from 'developer' and c.office is distinct from 'anonymous'
        group by c.staff
      ) t)
  ) into result;
  return result;
end $$;
