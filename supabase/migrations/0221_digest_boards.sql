-- The digest's board lines (docs/plans/2026-11-06-fangame-split-plan.md, Task 7; design section 4, "Noticing").
--
-- A Boss that can make and merge boards (0216) should see a forum with five posts in it. system_digest (0127) gains `boards`: each open board that is not The System's as
-- {id, name, premise, posts}, its posts counted over `digestBoardDays` days before the window's end on the board each thread is on now, and at most `digestBoards` lines,
-- the busiest half and the quietest half when there are more, busiest first; and `boardDays`, the days the counts cover, so the prompt can say so. Every field is a board's own
-- public fact or a count of public posts: nothing here is computed from who owns a character, a class or a reaction.
--
--   system_digest (0127)   copied whole; only the boards CTE, its two settings and the two keys are new. An instance seeded before the settings read 30 and 21.
--   acts_posts_by_time     a partial index of posts by time, carrying the thread: the count is a range of it. No index led with time for posts alone (acts_created covers every kind;
--                          acts_recent_posts leads with the thread), so 21 days of posts would have been a scan of the Acts.
--   threads (id, board)    the digest role may read them, for the count (see below).
--   settings_held (0149)   copied whole; digestBoards is a whole number from 1 to 30 (the ceiling the digest's prompt is bounded by) and digestBoardDays from 1 to 365.
--
-- Costs. Write: acts_posts_by_time adds one btree entry to each post insert (and none to any other kind of Act). acts_created would not serve: it holds every kind of Act, so a
-- 21-day range of it reads the cards, visits, moves and the rest as well and filters them out in the heap; the partial index holds posts alone (EXPLAIN on 400k Acts, 60% not
-- posts: 139 ms with it). Read: the count goes through acts_public, which runs a latest-edit probe (acts_edits) for each post. It cannot read `acts` directly: system_digest is
-- owned by kayfabb_digest, which is granted no column of `acts` and is held to that by 0050, so the view is the only door; the probe is an index-only lookup per post.
--
-- Weighed at a busy instance: the count reads the posts of `digestBoardDays` days, as the digest's own window already reads its hours of them, once a meeting; the lines
-- are bounded by `digestBoards`, whatever the number of boards.

-- The board a thread is on is a public fact (a thread's page and its board's list show it), and it is all the count needs of a thread. thread_list answers it too, but only through
-- joins that read every Act, which a 21-day count must not pay for. The role reads the thread's id and its board, and nothing else of the row.
--
-- Ported onto main (merge of #449 Cosmetics, migrations 0205-0213): settings_held: rebuilt on 0213's body (main's three alert kinds, trophy, beltLost and beltBack, and its 'cosmetics' check kept beside this migration's own).
grant select (id, board) on threads to kayfabb_digest;
create policy digest_reads on threads for select to kayfabb_digest using (true);

create index acts_posts_by_time on acts (created_at) include (thread) where kind = 'post';

-- system_digest (0127), with the board lines.
create or replace function system_digest(since timestamptz, until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  threads_cap integer := (setting('digestThreads'))::integer;
  short_cap integer := (setting('digestExcerpts'))::integer;
  chars integer := (setting('digestExcerptChars'))::integer;
  board_cap integer;
  board_days integer;
  hours numeric;
  result jsonb;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  met_by_most constant integer := 8;
begin
  if since is null or until is null or until <= since then
    raise exception 'a digest covers a window that ends after it starts' using errcode = '22023';
  end if;
  -- The board lines' two settings: an instance that has not set them (seeded before them) reads the defaults, as inheritance_due reads inheritanceGraceDays.
  begin board_cap := (setting('digestBoards'))::integer; exception when no_data_found then board_cap := 30; end;
  begin board_days := (setting('digestBoardDays'))::integer; exception when no_data_found then board_days := 21; end;
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
    select tl.id as thread, left(tl.title, 120) as title, tl.board as board_id, h.posts,
           round(h.posts / hours, 2) as heat,
           round(coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0), 4) as controversy,
           tl.last_seq as length
    from (select w.thread, count(*) as posts from w group by w.thread) h
    join thread_list tl on tl.id = h.thread
    left join split s on s.thread = h.thread
    order by h.posts desc, coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0) desc, tl.id
    limit threads_cap
  ),
  -- Order and cut first, number after. The order is the standings screen's, amount then name (then the character, for
  -- a tie of both), so the top rows come off standings_season_amount (season, amount desc, name; 0030) already in order
  -- and stop at the cap: the season's rows are never sorted, only the few of a tie are. The rank is numbered over the cut.
  -- A row that is not a public character is skipped inside the cut, so the cap is still full.
  stand as (
    select row_number() over (order by top.amount desc, top.name, top.character) as rank, top.character, top.amount
    from (
      select s.character, s.amount, s.name
      from standings s
      where s.season = standings_season()
        and exists (select 1 from settlements x where x.ends_at > since and x.ends_at <= until)
        and exists (select 1 from characters_public cp where cp.id = s.character)
      order by s.amount desc, s.name, s.character
      limit short_cap
    ) top
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
  -- The moves in force (open_moves: a handful of rows, whatever the instance's history) and those whose end fell in the window,
  -- each capped (the reversals first, so a met move's end cannot crowd one out); the merge below orders and caps them again. An end after the window is not the digest's yet.
  open_m as (
    select a.id as act, a.created_at as landed_at, a.payload, null::jsonb as ended, 1 as grp, 'inForce'::text as state, a.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from open_moves o join acts_public a on a.id = o.move_act
    where a.created_at < until
    order by a.created_at desc, a.id
    limit short_cap
  ),
  ended_m as (
    select a.id as act, a.created_at as landed_at, a.payload,
           jsonb_build_object('why', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at) as ended,
           case when e.payload ->> 'by' = 'admin' then 0 else 2 end as grp, 'ended'::text as state, e.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from acts_public e join acts_public a on a.id = e.target_act_id
    where e.kind = 'move_end' and e.created_at >= since and e.created_at < until
    order by (e.payload ->> 'by' = 'admin') desc, e.created_at desc, e.id
    limit short_cap
  ),
  -- A move an admin held in the window never landed, so it has no Act: its row in the queue (the columns the digest role may read).
  held_m as (
    select null::uuid as act, null::timestamptz as landed_at,
           jsonb_build_object('kind', q.kind, 'params', q.params, 'demand', q.demand, 'expires_at', q.expires_at) as payload,
           null::jsonb as ended, 0 as grp, 'held'::text as state, q.held_at as sort_at, q.held_at, q.why
    from queued_moves q
    where q.held_at >= since and q.held_at < until
    order by q.held_at desc, q.id
    limit short_cap
  ),
  moved as (
    select * from (select * from open_m union all select * from ended_m union all select * from held_m) u order by u.grp, u.sort_at desc, u.act limit short_cap
  ),
  -- The moves in the list that ended `met`, with the params of their demand read as the demand evaluator reads them. A param that is
  -- not what its kind needs reads null, so one malformed move cannot stop the digest.
  met_m as (
    select m.act, m.landed_at, (m.ended ->> 'at')::timestamptz as end_at, m.payload #>> '{demand,kind}' as dkind,
           case when m.payload #>> '{demand,params,board}' ~ uuid_re then (m.payload #>> '{demand,params,board}')::uuid end as board,
           case when m.payload #>> '{demand,params,thread}' ~ uuid_re then (m.payload #>> '{demand,params,thread}')::uuid end as thread,
           case when m.payload #>> '{demand,params,character}' ~ uuid_re then (m.payload #>> '{demand,params,character}')::uuid end as character,
           case when m.payload #>> '{demand,params,a}' ~ uuid_re then (m.payload #>> '{demand,params,a}')::uuid end as a,
           case when m.payload #>> '{demand,params,b}' ~ uuid_re then (m.payload #>> '{demand,params,b}')::uuid end as b,
           m.payload #>> '{demand,params,quadrant}' as quadrant,
           case when m.payload #>> '{demand,params,count}' ~ '^[0-9]{1,9}$' then (m.payload #>> '{demand,params,count}')::integer end as cnt
    from moved m
    where m.state = 'ended' and m.ended ->> 'why' = 'met' and jsonb_typeof(m.payload -> 'demand') = 'object'
  ),
  -- Who met a move: the public, non-staff characters whose public Acts counted toward its demand, from the landing to the end. For the
  -- two board counts, whoever posted on the board in between, in the order they first did; for a quadrant, the authors of the posts whose
  -- public tallies counted, the most reacted first; for a post in a thread, the character named; for a crossQuote, the two. A staff
  -- character's Acts never count (the evaluator skips them) and are never listed. Only public relations, and never a reactor.
  met_credit as (
    select p.act, p.character, min(p.created_at) as first_at, 0::bigint as weight
    from (
      -- postsOnBoard: the posts demand_progress counted, the first `count` after the landing (oldest first, staff skipped), read as it
      -- reads them: the Acts in time order from the landing, limited to `count` matches (the header says what that does and doesn't
      -- bound). A post after the count was reached, before the tick noticed, is not the move's.
      select mm.act, x.character, x.created_at
      from met_m mm
      cross join lateral (
        select a.character, a.created_at
        from acts_public a
        join characters_public c on c.id = a.character
        where a.thread in (select tl.id from thread_list tl where tl.board = mm.board)
          and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
        order by a.created_at, a.id
        limit mm.cnt
      ) x
      where mm.dkind = 'postsOnBoard' and mm.cnt >= 1
    ) p
    group by p.act, p.character
    union all
    -- distinctCharactersOnBoard: the first `count` distinct characters to post after the landing, in the order they first did. Each step
    -- finds the next post, in time order from the previous step's, by a character not yet found; every post skipped on the way is by one
    -- already found (or a staff character), so the steps are the characters' first posts in order, and the walk reads the Acts up to the
    -- `count`th new character's first post and no further.
    select w.act, w.character, w.created_at, 0::bigint
    from (
      with recursive walk(act, board, end_at, cnt, n, character, created_at, id, found) as (
        select mm.act, mm.board, mm.end_at, mm.cnt, 0, null::uuid, mm.landed_at, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '{}'::uuid[]
        from met_m mm
        where mm.dkind = 'distinctCharactersOnBoard' and mm.cnt >= 1
        union all
        select w.act, w.board, w.end_at, w.cnt, w.n + 1, x.character, x.created_at, x.id, w.found || x.character
        from walk w
        cross join lateral (
          select a.character, a.created_at, a.id
          from acts_public a
          join characters_public c on c.id = a.character
          where a.thread in (select tl.id from thread_list tl where tl.board = w.board)
            and a.kind = 'post' and a.created_at >= w.created_at and a.created_at <= w.end_at and (a.created_at, a.id) > (w.created_at, w.id)
            and a.character <> all (w.found) and c.staff is null
          order by a.created_at, a.id
          limit 1
        ) x
        where w.n < w.cnt
      )
      select * from walk where n >= 1
    ) w
    union all
    -- quadrantOnBoard: the public tally as it stands when the digest is built, not as of the move's end. A reaction after the end can raise
    -- it, and a public tally keeps no time per reaction (a reaction's time is private, and is never read here), so this credit may include
    -- an author a later reaction put in the quadrant.
    select mm.act, a.character, min(a.created_at), -sum(t.count)::bigint
    from met_m mm
    join thread_list tl on tl.board = mm.board
    join acts_public a on a.thread = tl.id
    join characters_public c on c.id = a.character
    join reaction_tallies t on t.act = a.id
    join reaction_kinds k on k.key = t.kind
    where mm.dkind = 'quadrantOnBoard' and k.quadrant = mm.quadrant
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    having sum(t.count) > 0
    union all
    select mm.act, a.character, min(a.created_at), 0::bigint
    from met_m mm
    join acts_public a on a.thread = mm.thread and a.character = mm.character
    join characters_public c on c.id = a.character
    where mm.dkind = 'characterPostsInThread'
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    union all
    select mm.act, c.id, mm.landed_at, (case when c.id = mm.a then 0 else 1 end)::bigint
    from met_m mm
    join characters_public c on c.id in (mm.a, mm.b)
    where mm.dkind = 'crossQuote' and c.staff is null
  ),
  met_top as (
    select r.act, r.character, r.rank
    from (select x.act, x.character, row_number() over (partition by x.act order by x.weight, x.first_at, x.character) as rank from met_credit x) r
    where r.rank <= met_by_most
  ),
  -- The board lines: each open board that is not The System's, with the posts on it over the `board_days` days before the window's end, on the board each thread is on now
  -- (threads.board, which a move that landed has already changed). Public posts of public characters only, counted per board and read from nothing else: no owner,
  -- account, class or reaction. The count is one range of the partial index acts_posts_by_time and one primary-key read per thread's post, grouped by board; the lines are the
  -- number of boards, which a busy instance keeps small. When there are more than `board_cap`, the busiest half (the odd one too) and the quietest half; the numbering is over
  -- the ordered whole, so the two halves cannot overlap, and a cap the boards do not reach keeps them all.
  board_posts as (
    select tl.board, count(*)::integer as n
    from acts_public p join threads tl on tl.id = p.thread
    where p.kind = 'post' and p.character is not null and p.created_at >= until - make_interval(days => board_days) and p.created_at < until
    group by tl.board
  ),
  board_all as (
    select bn.id, left(bn.name, 120) as name, left(bn.premise, 200) as premise, coalesce(bp.n, 0) as n,
           row_number() over (order by coalesce(bp.n, 0) desc, bn.id) as rn, count(*) over () as total
    from boards_now bn left join board_posts bp on bp.board = bn.id
    where not bn.is_system and not bn.closed
  ),
  board_lines as (
    select x.id, x.name, x.premise, x.n, x.rn from board_all x
    where x.rn <= (board_cap + 1) / 2 or x.rn > x.total - board_cap / 2
  ),
  named as (
    select q_from as id from quoted union select q_to from quoted union select character from stand union select character from excerpted
    union select character from met_top
  )
  select jsonb_build_object(
    'since', since,
    'until', until,
    'threads', coalesce((select jsonb_agg(jsonb_build_object('thread', h.thread, 'title', h.title, 'board', (select bn.name from boards_now bn where bn.id = h.board_id), 'posts', h.posts,
                          'heat', h.heat, 'controversy', h.controversy, 'length', h.length)
                         order by h.posts desc, h.controversy desc, h.thread) from hot h), '[]'::jsonb),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'premise', l.premise, 'posts', l.n) order by l.rn) from board_lines l), '[]'::jsonb),
    'boardDays', board_days,
    'standings', coalesce((select jsonb_agg(jsonb_build_object('rank', s.rank, 'character', s.character, 'amount', s.amount) order by s.rank) from stand s), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.payload ->> 'kind', 'params', m.payload -> 'params',
                          'demand', m.payload -> 'demand', 'expiresAt', m.payload -> 'expires_at', 'landedAt', m.landed_at,
                          'progress', case when m.state = 'held' then null else demand_progress_or_error(m.act) end, 'ended', m.ended, 'state', m.state)
                          || case when m.state = 'held' then jsonb_build_object('heldAt', m.held_at, 'why', m.why) else '{}'::jsonb end
                          || case when m.state = 'ended' and m.ended ->> 'why' = 'met'
                                  then jsonb_build_object('metBy', coalesce((select jsonb_agg(t.character order by t.rank) from met_top t where t.act = m.act), '[]'::jsonb))
                                  else '{}'::jsonb end
                          order by m.grp, m.sort_at desc, m.act) from moved m), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('from', q.q_from, 'to', q.q_to, 'count', q.n) order by q.n desc, q.q_from, q.q_to) from quoted q), '[]'::jsonb),
    'bossReactions', coalesce((select jsonb_agg(jsonb_build_object('act', bt.act, 'thread', bt.thread, 'total', bt.total, 'tally', bt.tally) order by bt.total desc, bt.act) from boss_tally bt), '[]'::jsonb),
    'excerpts', coalesce((select jsonb_agg(jsonb_build_object('act', e.act, 'thread', e.thread, 'character', e.character, 'reactions', e.reactions, 'text', e.excerpt)
                          order by e.reactions desc, e.created_at desc, e.act) from excerpted e), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'name', cp.name, 'staff', cp.staff is not null,
                                                                'pronouns', (select p.pronouns from character_profiles p where p.character = cp.id)) order by cp.id)
                            from characters_public cp where cp.id in (select id from named)), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- settings_held (0149), also holding digestBoards (a whole number from 1 to 30) and digestBoardDays (from 1 to 365). Everything else as 0149 wrote it.
create or replace function settings_held() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed', 'trophy', 'beltLost', 'beltBack'];
begin
  why := case new.key
    when 'walletCap' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'vote' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'halving' then case when not coalesce(jsonb_typeof(v) = 'number' and setting_positive(v) and (v #>> '{}')::numeric <= 1, false)
      then 'a fraction above 0 and at most 1' end
    when 'reactionCap' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'charactersPerPlayer' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'settlementCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'viewCountCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'meetingCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    -- The spans the earlier triggers hold, but let through with a field missing.
    when 'settlementLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'seasonLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'turnCooldown' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'inviteLifetime' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'setLasts' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'editGrace' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'presenceWindow' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'registrationMode' then case when v not in ('"open"', '"invite"', '"closed"') then '"open", "invite" or "closed"' end
    when 'postMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'titleMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'postsPerPage' then case when not setting_whole(v, 1) then 'a whole number of posts, at least 1' end
    when 'hotReplies' then case when not setting_whole(v, 1) then 'a whole number of replies, at least 1' end
    when 'presenceNames' then case when not setting_whole(v, 1) then 'a whole number of names, at least 1' end
    when 'presencePollSeconds' then case when not setting_whole(v, 10, 300) then 'a whole number of seconds from 10 to 300' end
    when 'cardSettings' then case when not setting_named_numbers(v) then 'an object of named numbers' end
    when 'systemEnabled' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'oldVoice' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'cardWriteSettleSeconds' then case when not setting_whole(v, 0, 600) then 'a whole number of seconds, at least 0 and at most 600' end
    when 'hints' then case when not coalesce(jsonb_typeof(v) = 'object'
        and setting_whole(v -> 'least', 1)
        and jsonb_typeof(v -> 'share') = 'number' and (v ->> 'share')::numeric > 0.5 and (v ->> 'share')::numeric <= 1
        and jsonb_typeof(v -> 'split') = 'number' and setting_positive(v -> 'split') and (v ->> 'split')::numeric <= 0.5
        and setting_span(v -> 'window', array['minute', 'day', 'week', 'month']), false)
      then 'an object giving least (a whole number of reactions, at least 1), share (above 0.5, at most 1), split (above 0, at most 0.5) and window (a span: a unit of minute, day, week or month and a whole count from 1 to 1000)' end
    when 'toastDefaults' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all (kinds))
        and (select count(*) = count(distinct e) from jsonb_array_elements(v) e), false)
      then 'a list of the kinds of alert that toast (' || array_to_string(kinds, ', ') || '), each named once' end
    when 'phases' then null  -- below: it needs a loop
    when 'inheritanceGraceDays' then case when not setting_whole(v, 0) then 'a whole number of days, at least 0' end
    when 'rosterRecentExcluded' then case when not setting_whole(v, 0) then 'a whole number of Bosses, at least 0' end
    when 'structuralHoldHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'microEventDailyCalls' then case when not setting_whole(v, 0) then 'a whole number of calls, at least 0' end
    when 'digestThreads' then case when not setting_whole(v, 1, 25) then 'a whole number of threads, at least 1 and at most 25' end
    when 'digestExcerpts' then case when not setting_whole(v, 1, 20) then 'a whole number of posts, at least 1 and at most 20' end
    when 'digestBoards' then case when not setting_whole(v, 1, 30) then 'a whole number of boards, at least 1 and at most 30' end
    when 'digestBoardDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'digestExcerptChars' then case when not setting_whole(v, 1, 1000) then 'a whole number of characters, at least 1 and at most 1000' end
    when 'memoryOpinions' then case when not setting_whole(v, 1) then 'a whole number of opinions, at least 1' end
    when 'memoryGrudges' then case when not setting_whole(v, 1) then 'a whole number of grudges, at least 1' end
    when 'memoryWheelhouse' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'memoryRealWorld' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'boardNameMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'moveExpiryMostDays' then case when not setting_whole(v, 1) then 'a whole number of days, at least 1' end
    when 'moveExpiryLeastHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'demandCheckMinutes' then case when not setting_whole(v, 1, 1440) then 'a whole number of minutes, at least 1 and at most 1440' end
    when 'demandChecksPerTick' then case when not setting_whole(v, 1, 1000) then 'a whole number of moves, at least 1 and at most 1000' end
    when 'searchLanguage' then case when not coalesce(jsonb_typeof(v) = 'string' and exists (select 1 from pg_ts_config c where c.cfgname = v #>> '{}'), false)
      then 'the name of a text search configuration this database holds (english or simple, for example)' end
    when 'searchRankPool' then case when not setting_whole(v, 100, 100000) then 'a whole number of matches from 100 to 100,000' end
    when 'pool' then setting_pool(v)
    when 'modBots' then setting_modbots(v)
    when 'warnBar' then setting_warnbar(v)
    when 'pronouns' then case when not pronouns_hold(pronouns_lowered(v)) then 'an object of five words of 1 to 12 letters each (an apostrophe or a hyphen between two letters is allowed) and a plural, true or false' end
    when 'apology' then setting_apology(v)
    when 'cosmetics' then setting_cosmetics(v)
    when 'modelTiers' then case when not coalesce(jsonb_typeof(v) = 'object'
        and jsonb_typeof(v -> 'strong') = 'string' and btrim(v ->> 'strong', E' \t\n\r\f\v') <> ''
        and jsonb_typeof(v -> 'light') = 'string' and btrim(v ->> 'light', E' \t\n\r\f\v') <> '', false)
      then 'an object naming a model id for "strong" and for "light"' end
    else null
  end;
  if new.key = 'phases' then
    shape := 'an object of honeymoon, reign and meltdown, each holding its numbers (honeymoon and meltdown also their days) as whole numbers, at least 1';
    if jsonb_typeof(v) <> 'object' then raise exception 'phases is %', shape using errcode = '23514'; end if;
    foreach phase in array array['honeymoon', 'reign', 'meltdown'] loop
      if jsonb_typeof(v -> phase) is distinct from 'object' then raise exception 'phases is %; "%" is missing', shape, phase using errcode = '23514'; end if;
      foreach pkey in array case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                                 else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end loop
        if not setting_whole(v -> phase -> pkey, 1) then raise exception 'phases is %; "%.%" is not', shape, phase, pkey using errcode = '23514'; end if;
      end loop;
      select k into pkey from jsonb_object_keys(v -> phase) k
        where k <> all (case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                             else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end) limit 1;
      if pkey is not null then raise exception 'phases is %; "%.%" is not a number a phase holds', shape, phase, pkey using errcode = '23514'; end if;
    end loop;
  end if;
  if why is not null then raise exception '% is %', new.key, why using errcode = '23514'; end if;
  return new;
end $$;
