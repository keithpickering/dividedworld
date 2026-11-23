-- Hot triggers name their post: the database (docs/plans/2026-11-23-hot-triggers-name-their-post-plan.md, Tasks 1, 4 and 6; design sections 0 to 2, 4 and 5).
--
-- Task 1. pool_signals' `hot` part (0358_blind_totals.sql) named threads and their authors and no post, so a hot trigger could quote nothing. Each author of a hot thread now carries `top`: the author's most reacted post
-- in the thread inside the window (the totals the crowd sees, reaction_tallies_open, so a post under a live totals veil counts none; a tie to the newer post), read through acts_thread_posts (thread, character,
-- created_at) one probe for each author. Each hot thread carries `tops`: its two most reacted posts by two different characters, each {act, character}, by the same order. Everything else in pool_signals as 0358 wrote it
-- (owner and grants kept, as a replaced function keeps them).
-- Task 4. write_staff_spin: a persona's thread that is a spin of a post. Task 6. The pool reads that mean "a persona's own posts" count its `spin` Acts beside its `post` Acts (the Task 6 section below says which and how).
-- Ways out: no state is added; the signal and the reads are reads, and a spin is an ordinary Act in an ordinary thread.
-- Masks (Tasks 1 and 6): only the totals the crowd sees and the public Acts' characters are read, never who reacted, an owner or a class; the digest role's own list of what it may read is not widened (reaction_tallies_open it read already).
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
        left join acts_public a on a.character = c.id and a.kind in ('post', 'spin') and a.created_at >= until - days * interval '1 day' and a.created_at < until
        left join lateral (select sum(tt.count) as n from reaction_tallies_open tt where tt.act = a.id) r on true
        where c.staff is not null and c.office is distinct from 'developer' and c.office is distinct from 'anonymous'
        group by c.staff
      ) t)
  ) into result;
  return result;
end $$;


-- ---- Task 4. The staff's spin (design section 4) ----
-- write_staff_spin: a persona's thread that is a spin of a post. It is write_staff_thread (0089) with a spin's origin: the thread carries origin_act_id and its first Act is a `spin` aimed at the origin (target_act_id), as spin_written
-- (0357_post_veils.sql, the latest) writes it for a player; the Act's payload is the marker merged under {title, body}, as a player's spin's is {title, body}.
-- From write_staff_thread, the checks of the persona: it exists (P0002), it is a persona and not the developer (42501), its office is not waiting or benched (55000); title and body within titleMaxLength and postMaxLength, the body not
-- empty (a spin by a player may have none; a persona's thread has words), the staff flag open for the inserts and put back after.
-- From spin_written, the checks of the origin (spin, the latest, takes the account and the character first: acting, not_banned, not_barred, write_framed and draw_visits are all about the player's account and words, and a persona
-- has none of them, as write_staff_thread has none):
--   1. the origin is an Act that is not an edit (an edit is not a thing spun from), else the same refusal, P0002 "there is no such Act to spin from";
--   2. an origin on The System's board lands the thread on players_board(), the first open board, never on a system board (a thread there is the System's own);
--   3. the board is not closed: threads_on_open_board (0339), a trigger on every insert into threads, holds it for this insert as for any other.
-- Bars and bans are not asked of the staff, as write_staff_thread does not ask them (write_staff_act asks only a thread lockout, of a post in that thread; a spin writes a new thread).
-- Not carried, because they are about a post a spin is pressed AT (`at_post`, the card-on-a-post spin), which this spin never has: the card is on that post, the post's shown author (shown_author), the live play (play_reach). A veil on
-- the origin is no check of spin's: a spin of a veiled post lands as it does for a player, and a veil's own readers (the shown author, public_payload) cover what is hidden.
-- The Act triggers an insert of a spin meets are the ones a staff post meets: acts_well_formed (the staff flag), the counts trigger (a spin counts as a spin), the at-post moment's trigger (only for a payload with `at`, so none).
-- Ways out: no state is added; the thread is an ordinary thread, and the spin an ordinary spin.
-- Masks: no private fact is read or written; a persona's thread names its persona and its origin, both public.
-- The test that drives it red is supabase/tests/0420-hot-posts.sql.
create function write_staff_spin(staff_key text, origin uuid, title text, body text, marker jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  held text;
  on_board uuid;
  made uuid;
  written uuid;
  flag text;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  if whose is distinct from 'persona' then raise exception 'only a persona spins a thread' using errcode = '42501'; end if;
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then raise exception 'a % persona writes nothing', held using errcode = '55000'; end if;
  perform within('title', title, 'titleMaxLength');
  perform within('body', body, 'postMaxLength');
  select case when b.is_system then players_board() else b.id end into on_board
  from acts a join threads t on t.id = a.thread join boards b on b.id = t.board where a.id = write_staff_spin.origin and a.kind <> 'edit';
  if on_board is null then raise exception 'there is no such Act to spin from' using errcode = 'P0002'; end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into threads (board, title, origin_act_id) values (on_board, title, write_staff_spin.origin) returning id into made;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (who, 'spin', made, write_staff_spin.origin, coalesce(marker, '{}'::jsonb) || jsonb_build_object('title', title, 'body', body)) returning id into written;
  perform set_config('kayfabb.staff_writer', flag, true);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $$;
revoke execute on function write_staff_spin(text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function write_staff_spin(text, uuid, text, text, jsonb) to service_role;


-- ---- Task 6. A persona's spin is its writing (design section 5) ----
-- Every pool read that means "a persona's own posts" read `kind = 'post'` only, so a staff spin (write_staff_spin, above) was invisible to them: its replies waited on no one, the conversation held no opener, presence did not show the
-- persona in the thread it spun, an orphaned spin was posted again, its reactions earned no priority, and a persona replying in a spun thread was shown neither the opener nor what it was spun from. Each now counts a `spin` Act beside a
-- `post` Act. Each is the latest definition of its function (0419 for the three waiting reads and pool_orphans, 0415 for pool_conversation and the two presence functions, 0418 for pool_thread's list form, this migration's own copy of
-- pool_signals above), changed as said and no more; owners and grants are kept, as a replaced function keeps them.
-- The own-posts scans of the waiting reads: acts_thread_posts is a partial index on `kind = 'post'`, so widening the predicate to `kind in ('post', 'spin')` would lose it. Each read adds a `union all` branch for the persona's spins (at most one
-- a thread, its opener) beside the posts branch, which is unchanged and keeps its index. A reply targets one Act, a post or a spin, so a reply is found by one branch only and counted once. The presence functions test a spin as a second
-- `exists`, and not by widening the predicate, for the same reason. The three waiting reads change together, as their comment in 0415 says, and stay plain inlinable SQL functions with a constant-keyed own-posts scan; pool_waiting,
-- presence_box and write_staff_turn read them and follow unchanged.
-- Each spin branch is keyed on `seq = 1`, because a spin is always its thread's opener (spin_written and write_staff_spin insert it as the first Act of the thread they make). A branch keyed on a thread (pool_waiting_in_thread's,
-- pool_conversation's, presence_staff_in_thread's, and pool_thread's spin row) is one probe of acts_thread_seq_key (thread, seq) or of acts_thread_openers (character, thread) where seq = 1, whichever the planner takes with both keys given,
-- and does not grow with the thread; without `seq = 1` the planner took acts_character with a bitmap on the thread's whole (thread, seq) range, or acts_patrol_posts over the thread's window, and presence runs per page view. A branch
-- keyed on the persona alone (pool_waiting_rows', pool_waiting_in_board's and presence_staff_in_board's) is bounded by the persona's own openers through acts_thread_openers (character, thread), joined to threads for the board.
-- pool_thread reads the thread's `spin` Act as its first post (its body is the spin's, read through acts_public as a post's is: veils and hidden versions as for any Act), always, beside the newest `most` posts, so the opener is shown to a
-- persona replying in a thread whatever `most` is; `also` and `more` still name posts.
-- Ways out: no state is added; a spin is an ordinary Act, and a reply waiting on it ages out of the wait window and is answered, refused or given up on as any reply is.
-- Masks: only public Acts and public characters are read, as before; the spin's author is public.
-- The test that drives it red is supabase/tests/0420-hot-posts.sql.

create or replace function pool_waiting_rows(staff_keys text[], since timestamptz) returns table (staff text, thread uuid, act uuid, author uuid, at timestamptz)
language sql stable as $$
  select c.staff, r.thread, r.id, r.character, r.created_at
  from characters c
  cross join lateral (
    select p.id from acts p
    where p.character = c.id and p.kind = 'post'
      and p.created_at >= pool_waiting_rows.since - coalesce(((select g.value from settings g where g.key = 'pool') ->> 'priorityDays')::integer, 28) * interval '1 day'
    union all
    select p.id from acts p
    where p.character = c.id and p.kind = 'spin' and p.seq = 1
      and p.created_at >= pool_waiting_rows.since - coalesce(((select g.value from settings g where g.key = 'pool') ->> 'priorityDays')::integer, 28) * interval '1 day'
  ) mine
  cross join lateral (
    -- Every filter that makes a reply waiting is inside, before the cap, so the cap is the newest 200 waiting replies to a post.
    select x.id, x.thread, x.character, x.created_at from acts x
    join characters w on w.id = x.character and w.staff is null
    where x.target_act_id = mine.id and x.kind = 'post' and x.created_at >= pool_waiting_rows.since
      and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = x.id)
      and not exists (select 1 from pool_answered a where a.reply = x.id)
      -- A reply a failed turn gave up on: refused once by the provider, or rejected twice (record_turn_attempt, 0419). A failed (transport or database) attempt leaves it waiting.
      and not exists (select 1 from pool_attempt_replies ar join pool_attempts pa on pa.id = ar.attempt where ar.reply = x.id and pa.outcome in ('refused', 'rejected')
                      group by ar.reply having bool_or(pa.outcome = 'refused') or count(*) >= 2)
      and locked_out_until(c.id, x.thread) is null
    order by x.created_at desc, x.id desc limit 200
  ) r
  where c.staff = any (pool_waiting_rows.staff_keys) and c.staff_kind = 'persona'
    -- Public: the persona's post is not under a live author veil (a veiled reply was left out above, and is named nowhere).
    and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = mine.id)
$$;

create or replace function pool_waiting_in_thread(in_thread uuid, staff_keys text[], since timestamptz) returns table (staff text, thread uuid, act uuid, author uuid, at timestamptz)
language sql stable as $$
  select c.staff, r.thread, r.id, r.character, r.created_at
  from characters c
  cross join lateral (
    select p.id from acts p
    where p.character = c.id and p.kind = 'post'
      and p.thread = pool_waiting_in_thread.in_thread
      and p.created_at >= pool_waiting_in_thread.since - coalesce(((select g.value from settings g where g.key = 'pool') ->> 'priorityDays')::integer, 28) * interval '1 day'
    union all
    select p.id from acts p
    where p.character = c.id and p.kind = 'spin' and p.seq = 1
      and p.thread = pool_waiting_in_thread.in_thread
      and p.created_at >= pool_waiting_in_thread.since - coalesce(((select g.value from settings g where g.key = 'pool') ->> 'priorityDays')::integer, 28) * interval '1 day'
  ) mine
  cross join lateral (
    -- Every filter that makes a reply waiting is inside, before the cap, so the cap is the newest 200 waiting replies to a post.
    select x.id, x.thread, x.character, x.created_at from acts x
    join characters w on w.id = x.character and w.staff is null
    where x.target_act_id = mine.id and x.kind = 'post' and x.created_at >= pool_waiting_in_thread.since
      and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = x.id)
      and not exists (select 1 from pool_answered a where a.reply = x.id)
      -- A reply a failed turn gave up on: refused once by the provider, or rejected twice (record_turn_attempt, 0419). A failed (transport or database) attempt leaves it waiting.
      and not exists (select 1 from pool_attempt_replies ar join pool_attempts pa on pa.id = ar.attempt where ar.reply = x.id and pa.outcome in ('refused', 'rejected')
                      group by ar.reply having bool_or(pa.outcome = 'refused') or count(*) >= 2)
      and locked_out_until(c.id, x.thread) is null
    order by x.created_at desc, x.id desc limit 200
  ) r
  where c.staff = any (pool_waiting_in_thread.staff_keys) and c.staff_kind = 'persona'
    -- Public: the persona's post is not under a live author veil (a veiled reply was left out above, and is named nowhere).
    and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = mine.id)
$$;

create or replace function pool_waiting_in_board(in_board uuid, staff_keys text[], since timestamptz) returns table (staff text, thread uuid, act uuid, author uuid, at timestamptz)
language sql stable as $$
  select c.staff, r.thread, r.id, r.character, r.created_at
  from characters c
  cross join lateral (
    select p.id from acts p
    join threads pt on pt.id = p.thread and pt.board = pool_waiting_in_board.in_board
    where p.character = c.id and p.kind = 'post'
      and p.created_at >= pool_waiting_in_board.since - coalesce(((select g.value from settings g where g.key = 'pool') ->> 'priorityDays')::integer, 28) * interval '1 day'
    union all
    select p.id from acts p
    join threads pt on pt.id = p.thread and pt.board = pool_waiting_in_board.in_board
    where p.character = c.id and p.kind = 'spin' and p.seq = 1
      and p.created_at >= pool_waiting_in_board.since - coalesce(((select g.value from settings g where g.key = 'pool') ->> 'priorityDays')::integer, 28) * interval '1 day'
  ) mine
  cross join lateral (
    -- Every filter that makes a reply waiting is inside, before the cap, so the cap is the newest 200 waiting replies to a post.
    select x.id, x.thread, x.character, x.created_at from acts x
    join characters w on w.id = x.character and w.staff is null
    where x.target_act_id = mine.id and x.kind = 'post' and x.created_at >= pool_waiting_in_board.since
      and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = x.id)
      and not exists (select 1 from pool_answered a where a.reply = x.id)
      -- A reply a failed turn gave up on: refused once by the provider, or rejected twice (record_turn_attempt, 0419). A failed (transport or database) attempt leaves it waiting.
      and not exists (select 1 from pool_attempt_replies ar join pool_attempts pa on pa.id = ar.attempt where ar.reply = x.id and pa.outcome in ('refused', 'rejected')
                      group by ar.reply having bool_or(pa.outcome = 'refused') or count(*) >= 2)
      and locked_out_until(c.id, x.thread) is null
    order by x.created_at desc, x.id desc limit 200
  ) r
  where c.staff = any (pool_waiting_in_board.staff_keys) and c.staff_kind = 'persona'
    -- Public: the persona's post is not under a live author veil (a veiled reply was left out above, and is named nowhere).
    and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = mine.id)
$$;

create or replace function pool_conversation(staff_key text, in_thread uuid, most integer, replies integer, chars integer) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('posts', coalesce((
    select jsonb_agg(jsonb_build_object('act', m.id, 'at', m.created_at, 'body', m.body, 'cut', m.cut,
        'replies', coalesce((
          select jsonb_agg(jsonb_build_object('act', r.id, 'author', r.character, 'name', r.name, 'pronouns', r.pronouns, 'at', r.created_at, 'body', r.body, 'cut', r.cut) order by r.created_at, r.id)
          from (select x.id, x.character, x.created_at, c.name, (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
                       left(coalesce(x.current_payload ->> 'body', ''), least(greatest(chars, 1), 2000)) as body,
                       length(coalesce(x.current_payload ->> 'body', '')) > least(greatest(chars, 1), 2000) as cut
                from acts_public x join characters_public c on c.id = x.character
                where x.target_act_id = m.id and x.kind = 'post'
                order by x.created_at desc, x.id desc limit least(greatest(replies, 0), 10)) r), '[]'::jsonb))
      order by m.created_at, m.id)
    from (select o.id, o.created_at, left(coalesce(o.current_payload ->> 'body', ''), least(greatest(chars, 1), 2000)) as body,
                 length(coalesce(o.current_payload ->> 'body', '')) > least(greatest(chars, 1), 2000) as cut
          from (select a.id, a.created_at, a.current_payload from acts_public a
                where a.thread = in_thread and a.kind = 'post' and a.character = (select c.id from characters c where c.staff = staff_key)
                union all
                select a.id, a.created_at, a.current_payload from acts_public a
                where a.thread = in_thread and a.seq = 1 and a.kind = 'spin' and a.character = (select c.id from characters c where c.staff = staff_key)) o
          order by o.created_at desc, o.id desc limit least(greatest(most, 0), 20)) m), '[]'::jsonb))
$$;

create or replace function presence_staff_in_thread(in_place uuid, in_character uuid, in_staff text, in_since timestamptz, in_wait interval) returns boolean
language plpgsql stable set search_path = public, pg_temp set plan_cache_mode = force_generic_plan set jit = off as $$
begin
  return exists (select 1 from acts_public x where x.thread = in_place and x.character = in_character and x.kind = 'post' and x.created_at >= in_since)
      or exists (select 1 from acts_public x where x.thread = in_place and x.character = in_character and x.kind = 'spin' and x.seq = 1 and x.created_at >= in_since)
      or exists (select 1 from pool_waiting_in_thread(in_place, array[in_staff], now() - in_wait) w);
end $$;
create or replace function presence_staff_in_board(in_place uuid, in_character uuid, in_staff text, in_since timestamptz, in_wait interval) returns boolean
language plpgsql stable set search_path = public, pg_temp set plan_cache_mode = force_generic_plan set jit = off as $$
begin
  return exists (select 1 from acts_public x join threads xt on xt.id = x.thread where xt.board = in_place and x.character = in_character and x.kind = 'post' and x.created_at >= in_since)
      or exists (select 1 from acts_public x join threads xt on xt.id = x.thread where xt.board = in_place and x.character = in_character and x.kind = 'spin' and x.seq = 1 and x.created_at >= in_since)
      or exists (select 1 from pool_waiting_in_board(in_place, array[in_staff], now() - in_wait) w);
end $$;

create or replace function pool_orphans(through date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('staff', o.staff, 'day', o.day, 'act', o.id, 'startedThread', o.seq = 1,
    'card', (select k.id from acts k
             where k.character = o.character
               and ((k.kind = 'set' and k.target_act_id = o.id)
                    or (k.kind = 'card' and k.payload ->> 'pool' = o.day and o.target_act_id is not null and k.target_act_id = o.target_act_id)
                    or (k.kind = 'draw' and k.payload ->> 'pool' = o.day))
               and not exists (select 1 from pool_spends s where s.card_act = k.id)
             order by k.created_at, k.id limit 1)) order by o.day, o.staff), '[]'::jsonb)
  from (select distinct on (c.staff, a.payload ->> 'pool') c.staff, a.payload ->> 'pool' as day, a.id, a.seq, a.character, a.target_act_id
        from acts a join characters c on c.id = a.character
        where c.staff is not null and a.kind in ('post', 'spin') and a.payload ->> 'pool' ~ '^\d{4}-\d{2}-\d{2}$'
          and (a.payload ->> 'pool')::date between least(date_trunc('week', through::timestamp)::date, through - 1) and through
          and not exists (select 1 from pool_spends s where s.post_act = a.id)
        order by c.staff, a.payload ->> 'pool', a.created_at, a.id) o
$$;

create or replace function pool_thread(in_thread uuid, most integer, chars integer, also uuid, more uuid[]) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with page as (
    select a.id, a.seq, a.created_at, c.name, (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
           left(coalesce(a.current_payload ->> 'body', ''), greatest(chars, 1)) as body,
           length(coalesce(a.current_payload ->> 'body', '')) > greatest(chars, 1) as cut
    from acts_public a join characters_public c on c.id = a.character
    where a.thread = in_thread
      and ((a.kind = 'post'
            and (a.id = also or a.id = any (coalesce(more[1:50], '{}'::uuid[]))
                 or a.id in (select n.id from acts_public n where n.thread = in_thread and n.kind = 'post'
                             order by n.created_at desc, n.id desc limit greatest(most, 0))))
           -- The thread's spin Act is its first post, always shown (the opener a reply is to), whatever `most` is; a thread nobody spun has none.
           or (a.seq = 1 and a.kind = 'spin'))
  )
  select jsonb_build_object(
    'title', coalesce((select t.title from thread_list t where t.id = in_thread), ''),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('act', p.id, 'name', p.name, 'pronouns', p.pronouns, 'body', p.body, 'cut', p.cut) order by p.created_at, p.id) from page p), '[]'::jsonb),
    'walls', coalesce((select jsonb_agg(jsonb_build_object('play', k.id, 'card', k.payload ->> 'card',
                                                           'about', 'a post by ' || p.name || coalesce(' (#' || p.seq || ')', '')) order by p.created_at, p.id, k.id)
                       from page p join surfaces s on s.post = p.id join acts_public k on k.id = s.play
                       where not exists (select 1 from acts_public e where e.kind = 'card_end' and e.target_act_id = k.id)
                         and not exists (select 1 from card_write_refunds r where r.play = k.id)), '[]'::jsonb))
$$;
