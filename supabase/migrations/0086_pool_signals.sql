-- The pool's signals (the staff roster design, sections 4, 6 and "A busy instance"; its plan, Task 8). pool_signals(since, until) is
-- everything the daily pick reads about play, as jsonb, in one call:
--
--   named       [{staff, act, thread, n}]  posts in the window whose words contain a debuted persona's name; `n` is that persona's total
--                                       before the cap of five newest rows.
--   quoted      [{staff, act, thread, n}]  posts in the window that quote or reply to a staff post, read as system_digest's `quoted` reads
--                                       them (0052): through the target Act, never a character quoting itself.
--   legacy      [{staff, maker, move, act, thread, how, n}]  move_end and move_keep Acts in the window on a move that is not the current Boss's
--                                       own making: its owner at the Act is not the current Boss, or its maker (the staff key that wrote
--                                       the move) is not. `staff` is the owner at the Act, `maker` the writer, `move` the move, `act` the
--                                       end or the keep (`thread` its thread: the move's own, 0051), `how` the end's reason (met, expired, reversed, superseded, spent) or `kept`, and
--                                       `n` the maker's total rows before the cap of five newest. An admin's reversal of such a move is a move_end with
--                                       why `reversed`, so it is here.
--   reversals   [{staff, move, act, thread}]    admin reversals (a move_end, why `reversed`, by `admin`) in the window of the current Boss's moves.
--   handovers   [{season, outgoing, boss, how, at, act, thread}]  season_handovers landed in the window. `act` is the new Boss's arrival post (season_handovers.arrival_act,
--                                       set by hand_over in its transaction) and `thread` its thread; both null where the arrival was not said. Not `note`: that is an error's words.
--   hot         [{thread, board, heat, starter, starterStaff, staffStarted, authors, boardMaker}]  the top `digestThreads` threads by posts in the window,
--                                       heat as the digest counts it (posts an hour). `starter` is the character whose post opened the
--                                       thread; `starterStaff` its staff key where it is a persona's, and `staffStarted` says so.
--                                       `authors` is [{character, posts}], the distinct characters who posted in it in the window, ten
--                                       busiest first (character ids, as memory opinions name them). `boardMaker` is the staff key of
--                                       whoever made the board, from the Act that recorded it: no Act records a board's creation (a
--                                       move can only rename one; boards are made by seed and by admins), so it is null until one does.
--   tallies     [{staff, posts, reactions}]  each debuted persona's posts in the last `pool.priorityDays` before `until`, and the public
--                                       tallies on them, every kind of reaction counted alike. A persona with no posts is listed with 0.
--
-- OWNED BY kayfabb_digest (0045), security definer: it runs with that role's privileges and nothing else's, so the database refuses it
-- who owns a character, a class and who reacted ("A response never proves a private fact"). It reads acts_public, characters_public,
-- thread_list and reaction_tallies, season_handovers' public columns (granted below) and name_skeleton
-- (the folds, 0011). Every signal is a fact of public play. Staff characters have no owner, so a persona's name, office
-- and posts are public to begin with; the developer is staff of a third kind and is no persona, so it is named and listed by no one.
--
-- A name is matched as the folds see it, so a mention in another case, with accents or with lookalike letters from another script
-- still names the persona (name_skeleton on both the name and the words), and as a whole name: a name inside a longer word is not a
-- mention ("the Clerkenwell" does not name "The Clerk"). The folds say when two names are the same name and know nothing of word
-- edges; the edge is this function's, and supabase/tests/0088-pool-signals.sql records it. A persona is never triggered by its own
-- words: its own posts are left out of `named`, and a reply to its own post out of `quoted`.
--
-- Cost, at a busy instance. The window is a day; its posts are read ONCE, by pool_named, in one statement: each post's words are folded
-- once, and one regular expression holding every persona's folded name finds them all in that one scan (not a scan, or a pattern run,
-- per persona), so the cost follows the day's posts and their length and not the roster. supabase/tests/0088-pool-signals.sql shows the
-- plan's shape does not change with the number of personas. The folding is a lookup per character of a post (name_skeleton), the heaviest
-- part; a post is bounded by postMaxLength. Each persona's named, quoted and legacy rows are its five newest, so the answer follows the
-- roster, not the traffic. The moves and handovers are the window's handful of Acts (acts_move_ends, and acts_move_keeps below); the
-- tallies are one index range on acts_character per persona over the trailing days, with a tally lookup per post, the roster's posts
-- being a pool's few a week. The hot threads are system_digest's own read.

-- --------------------------------------------------------------------------------------------- what the role may read ----

-- A handover's public columns: the season, who left, who came, how, and when it landed. Not `note` (an error's words, for admins). Its
-- policy is the digest role's own, as the other tables it reads (0045).
create policy digest_reads on season_handovers for select to kayfabb_digest using (true);
grant select (season, outgoing, boss, how, landed_at, arrival_act) on season_handovers to kayfabb_digest;

-- The folds, so a name and the words around it are compared as the database compares names (0011). They read name_maps, which the role
-- cannot; the function is security definer and says nothing about anyone.
grant execute on function name_skeleton(text) to kayfabb_digest;

-- A keep is the Boss's rare Act, and the window's keeps are read by time.
create index acts_move_keeps on acts (created_at desc, id desc) where kind = 'move_keep';

-- --------------------------------------------------------------------------------------------------------- the setting ----

-- `pool.priorityDays`: how many days back a persona's priority reads (a whole number, at least 1), held with the pool's other settings by
-- settings_held (0077). The TypeScript rule is `poolRule` in engine/rules/instance.ts, and supabase/tests/0079-settings-held.sql lists its
-- poisons and goods.

-- ------------------------------------------------------------------------------------------------------------- named ----

-- The posts in [$1, $2) that name a persona, up to five newest per persona, as [{staff, act, thread}]. One statement, written with
-- positional parameters so a test can prepare and explain exactly this text. The pattern is one alternation of every persona's folded
-- name, longest first, escaped (every character that is not a letter, digit or space gets a backslash), with a whole-name edge on each
-- side; regexp_matches runs it once per post and the rows join back to the personas by the folded name that matched. A post's words
-- are its current words, an edit being the words (acts_public.current_payload), with every run of whitespace (a line break, a tab) one
-- space, so a name split across a line is still the name. Each persona's rows say their total in `n`, before the five-row cap.
create function pool_named(timestamptz, timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with
  names as (
    select cp.staff, regexp_replace(name_skeleton(cp.name), '\s+', ' ', 'g') as folded
    from characters_public cp
    where cp.staff is not null and cp.office is distinct from 'developer'
  ),
  pat as (
    select '(?<![[:alnum:]])(' || string_agg(regexp_replace(n.folded, '([^[:alnum:][:space:]])', '\\\1', 'g'), '|' order by length(n.folded) desc, n.folded)
           || ')(?![[:alnum:]])' as re
    from names n where n.folded <> ''
  ),
  posts as (
    select p.id, p.thread, p.created_at, c.staff as author_staff, regexp_replace(coalesce(p.current_payload ->> 'body', ''), '\s+', ' ', 'g') as body
    from acts_public p join characters_public c on c.id = p.character
    where p.kind = 'post' and p.created_at >= $1 and p.created_at < $2
  ),
  -- The folds work a character at a time and never reach across a space, so a post's folded words are its words' folds put back with the
  -- spaces between: each distinct word of the day is folded once, not each occurrence. The test file holds this to the folds themselves.
  folded as materialized (
    select w.word, name_skeleton(w.word) as folded
    from (select x.word from posts p cross join lateral unnest(string_to_array(p.body, ' ')) x(word) group by x.word) w
  ),
  words as (
    select p.id, p.thread, p.created_at, p.author_staff,
           (select string_agg(f.folded, ' ' order by x.n) from unnest(string_to_array(p.body, ' ')) with ordinality x(word, n) join folded f on f.word = x.word) as folded
    from posts p
  ),
  hits as (
    select distinct p.id, p.thread, p.created_at, n.staff
    from words p
    cross join pat
    cross join lateral regexp_matches(p.folded, pat.re, 'g') m
    join names n on n.folded = m[1]
    where n.staff is distinct from p.author_staff
  ),
  ranked as (
    select h.*, row_number() over (partition by h.staff order by h.created_at desc, h.id desc) as rn, count(*) over (partition by h.staff) as n from hits h
  )
  select coalesce(jsonb_agg(jsonb_build_object('staff', r.staff, 'act', r.id, 'thread', r.thread, 'n', r.n) order by r.staff, r.created_at desc, r.id desc), '[]'::jsonb)
  from ranked r where r.rn <= 5
$$;

-- --------------------------------------------------------------------------------------------------------- the signals ----

create function pool_signals(since timestamptz, until timestamptz) returns jsonb
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
  -- role may; supabase/tests/0088-pool-signals.sql checks an end's owner against move_owner itself.
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
          and tgt.kind = 'post' and tc.staff is not null and tc.office is distinct from 'developer' and w.character <> tgt.character
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
                                                   'authors', x.authors, 'boardMaker', null) order by x.posts desc, x.thread), '[]'::jsonb)
      from (
        select tl.id as thread, tl.board, h.posts, round(h.posts / hours, 2) as heat, tl.first_character as starter, sc.staff as starter_staff,
               (select coalesce(jsonb_agg(jsonb_build_object('character', a.character, 'posts', a.n) order by a.n desc, a.character), '[]'::jsonb)
                from (select p.character, count(*) as n from acts_public p
                      where p.thread = tl.id and p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
                      group by p.character order by n desc, p.character limit 10) a) as authors
        from (
          select p.thread, count(*) as posts from acts_public p
          where p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
          group by p.thread
        ) h
        join thread_list tl on tl.id = h.thread
        left join characters_public sc on sc.id = tl.first_character and sc.office is distinct from 'developer'
        order by h.posts desc, tl.id
        limit threads_cap
      ) x),
    'tallies', (
      select coalesce(jsonb_agg(jsonb_build_object('staff', t.staff, 'posts', t.posts, 'reactions', t.reactions) order by t.staff), '[]'::jsonb)
      from (
        select c.staff, count(a.id) as posts, coalesce(sum(r.n), 0)::bigint as reactions
        from characters_public c
        left join acts_public a on a.character = c.id and a.kind = 'post' and a.created_at >= until - days * interval '1 day' and a.created_at < until
        left join lateral (select sum(tt.count) as n from reaction_tallies tt where tt.act = a.id) r on true
        where c.staff is not null and c.office is distinct from 'developer'
        group by c.staff
      ) t)
  ) into result;
  return result;
end $$;

-- The two functions become the role's, as system_digest did (0045): the owner change needs the role to hold create on the schema while it
-- happens, and the grant is taken back at once. pool_named is called only by pool_signals, which owns it too, so no one else is granted it.
grant create on schema public to kayfabb_digest;
alter function pool_named(timestamptz, timestamptz) owner to kayfabb_digest;
alter function pool_signals(timestamptz, timestamptz) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;

revoke execute on function pool_named(timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke execute on function pool_signals(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function pool_signals(timestamptz, timestamptz) to service_role;
