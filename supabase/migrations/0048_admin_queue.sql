-- The admin queue and reversal (the system plan, Task 11; the system design, section 7). The Boss's moves are not signed by a person, so
-- what bounds The System in play is that an admin can see a structural move coming, hold it before it lands, and reverse any move
-- after it lands:
--
--   admin_queue()         what the admin screen shows: the moves waiting to land (with the Boss's own `why`), the moves in force
--                         (with their demands' progress), and the moves that ended or were held in the last 30 days.
--   hold_move(id)         holds a queued move that has not landed: it never lands, so it is never an Act and no player sees it.
--   reverse_move(act)     ends a landed move through end_move with `{why: reversed, by: admin}`; the old name returns at once.
--                         The Boss says so in the move's thread, in the stock line for it, as the tick says its other ends.
--
-- All three are for an admin alone (only_admins, 42501 for anyone else), security definer, and callable by the web client.
--
-- What an admin's hold records. queued_moves.held_by is the admin's account (auth.uid()). It is read by nobody the database
-- serves: queued_moves has no client grant, admin_queue() does not return it, and the digest role below is granted the queue's
-- columns one by one, without held_by. A player learns that an admin held a move only as the game tells it: not at all, for a held
-- move never happens.
--
-- Cost on a busy instance. Each group is capped (admin_queue says so: `cap`, and `more` per group). Waiting reads queued_moves_due
-- (the rows still waiting); in force reads open_moves (a handful of rows) and their demands' progress, each bounded by the move's
-- expiry; ended reads two new partial indexes, one on the move_end Acts by time and one on the held rows by time, so a 30-day window
-- costs the moves ended and held in it, never the history of Acts or of queued moves.
--
-- Its way out: a held move is over, and a move that landed is reversed or ends itself. An admin whose hold is wrong cannot take it
-- back (the queue row stays held, "a queued move that is held or landed stays so"): the Boss's next meeting chooses a move again.

-- ------------------------------------------------------------------------------- indexes ----

create index acts_move_ends on acts (created_at desc, id desc) where kind = 'move_end';
create index queued_moves_held on queued_moves (held_at desc, id desc) where held_at is not null;

-- say_move_end, which reverse_move below calls as the tick does, is 0047's (the tick and the reversal say an end the same way).

-- ------------------------------------------------------------------------ hold and reverse ----

create function hold_move(id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q queued_moves%rowtype;
  at timestamptz := now();
begin
  perform only_admins('holds a move');
  -- The row is locked, so the tick landing it at this moment and an admin holding it are one after the other: whichever is second finds the first's result.
  select * into q from queued_moves where queued_moves.id = hold_move.id for update;
  if not found then raise exception 'there is no such queued move' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if q.landed_act is not null then raise exception 'that move has already landed; reverse it instead' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if q.held_at is not null then raise exception 'that move is already held' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  update queued_moves set held_at = at, held_by = auth.uid() where queued_moves.id = hold_move.id;
  return jsonb_build_object('id', q.id, 'heldAt', at);
end $$;
revoke execute on function hold_move(bigint) from public, anon;
grant execute on function hold_move(bigint) to authenticated;

create function reverse_move(move_act uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ended jsonb;
begin
  perform only_admins('reverses a move');
  if not exists (select 1 from acts a where a.id = move_act and a.kind = 'move') then
    raise exception 'that is not a move' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  ended := end_move(move_act, 'reversed', 'admin');
  if not (ended ->> 'ended')::boolean then raise exception 'that move has already ended' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  -- The fiction learns of it; the plain record is the move_end.
  perform say_move_end(move_act, 'reversed');
  return jsonb_build_object('act', move_act, 'endedBy', ended ->> 'act');
end $$;
revoke execute on function reverse_move(uuid) from public, anon;
grant execute on function reverse_move(uuid) to authenticated;

-- ----------------------------------------------------------------------------- the queue ----

-- This function's owner reads demand_progress_or_error, which is the digest role's and granted to the service role alone (0045).
do $$ begin execute format('grant execute on function demand_progress_or_error(uuid) to %I', current_user); end $$;

-- What the admin screen shows, as {cap, waiting, inForce, ended, more: {waiting, inForce, ended}}. Each group holds at most `cap` rows
-- (`more` says a group was cut). The Boss's `why` is its own words and an admin may read it; held_by is not returned.
--   waiting   queued, not landed, not held, soonest first: {id, staff, boss, kind, params, demand, why, goLiveAt, expiresAt, structural,
--             boardName, failedAt, failure} where boardName is a renameBoard's board as it is called now (else null), and failedAt and
--             failure say the tick could not land the row and why (else null; the row stays due, so an admin who sees them holds it).
--   inForce   landed with no move_end, newest first: {act, id, staff, boss, kind, params, demand, why, landedAt, expiresAt, progress}.
--   ended     the last 30 days, newest first: ended moves {how: met | expired | reversed, by, at, act, ...} and held moves {how: held, at,
--             act: null, ...}, with the move's kind, params, demand and why.
create function admin_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cap constant integer := 100;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  win constant timestamptz := now() - interval '30 days';
  waiting jsonb; waiting_more boolean;
  in_force jsonb; in_force_more boolean;
  ended jsonb; ended_more boolean;
begin
  perform only_admins('reads the queue');

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into waiting, waiting_more from (
    select row_number() over (order by q.go_live_at, q.id) as n,
           jsonb_build_object('id', q.id, 'staff', q.staff, 'boss', (select c.name from characters c where c.staff = q.staff), 'kind', q.kind,
             'params', q.params, 'demand', q.demand, 'why', q.why, 'goLiveAt', q.go_live_at, 'expiresAt', q.expires_at, 'structural', q.structural,
             'failedAt', q.failed_at, 'failure', q.failure,
             'boardName', case when q.kind = 'renameBoard' and lower(q.params ->> 'board') ~ uuid_re
                               then (select b.name from boards_now b where b.id = (q.params ->> 'board')::uuid) end) as j
    from queued_moves q where q.landed_act is null and q.held_at is null
    order by q.go_live_at, q.id limit cap + 1
  ) x;

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into in_force, in_force_more from (
    select row_number() over (order by a.created_at desc, a.id) as n,
           jsonb_build_object('act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name, 'kind', a.payload ->> 'kind', 'params', a.payload -> 'params',
             'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at, 'expiresAt', a.payload -> 'expires_at',
             'progress', demand_progress_or_error(a.id)) as j
    from open_moves o
    join acts a on a.id = o.move_act
    left join characters c on c.id = a.character
    left join queued_moves q on q.landed_act = a.id
    order by a.created_at desc, a.id limit cap + 1
  ) x;

  -- Ended and held, merged: each side cut at cap + 1 first, so the merge never reads more than 2 * (cap + 1) rows.
  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into ended, ended_more from (
    select row_number() over (order by u.at desc, u.tie) as n, u.j from (
      (select e.created_at as at, e.id::text as tie,
              jsonb_build_object('how', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at, 'act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name,
                'kind', a.payload ->> 'kind', 'params', a.payload -> 'params', 'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at) as j
       from acts e
       join acts a on a.id = e.target_act_id
       left join characters c on c.id = a.character
       left join queued_moves q on q.landed_act = a.id
       where e.kind = 'move_end' and e.created_at >= win
       order by e.created_at desc, e.id desc limit cap + 1)
      union all
      (select h.held_at, 'q' || h.id::text,
              jsonb_build_object('how', 'held', 'by', 'admin', 'at', h.held_at, 'act', null, 'id', h.id, 'staff', h.staff, 'boss', c.name,
                'kind', h.kind, 'params', h.params, 'demand', h.demand, 'why', h.why, 'landedAt', null)
       from queued_moves h
       left join characters c on c.staff = h.staff
       where h.held_at is not null and h.held_at >= win
       order by h.held_at desc, h.id desc limit cap + 1)
    ) u order by u.at desc, u.tie limit cap + 1
  ) x;

  return jsonb_build_object('cap', cap, 'waiting', waiting, 'inForce', in_force, 'ended', ended,
    'more', jsonb_build_object('waiting', waiting_more, 'inForce', in_force_more, 'ended', ended_more));
end $$;
revoke execute on function admin_queue() from public, anon;
grant execute on function admin_queue() to authenticated;

-- ----------------------------------------------------------------------------- the digest ----

-- The Director learns of what the admins did at its next meeting, in memory only. The digest role reads the queue's columns, one by
-- one: not held_by (which admin held a move is nobody's to learn here), and not the meeting. The Boss's own `why` is its own words.
create policy digest_reads on queued_moves for select to kayfabb_digest using (true);
grant select (id, staff, kind, params, demand, why, go_live_at, expires_at, structural, held_at, landed_act) on queued_moves to kayfabb_digest;

-- system_digest (0045), the moves list also carrying the moves admins held in the window (the system plan, Task 11). Everything else as
-- 0045 wrote it. Each move in the list now says `state`: inForce, ended or held. An ended move that an admin reversed shows
-- `ended.why = reversed` (by admin); a held move was never an Act, so it is `{act: null, kind, params, demand, expiresAt, landedAt: null,
-- progress: null, ended: null, state: held, heldAt, why}`, `why` the Boss's own words for it. The list is capped at digestExcerpts, and
-- what the admins did comes first so that the cap cannot cut it: the holds and the reversals, then the moves in force, then the moves
-- that were met or expired, each newest first. An admin's act is rare and the Director's only word of it is this list, while the moves
-- in force are in every digest until they end; so in a window where more moves are in force than the cap, the in force ones are
-- what is cut, and a hold or a reversal is never lost to a later window. The function stays the digest role's: the owner, the privileges and the grants are kept.
create or replace function system_digest(since timestamptz, until timestamptz) returns jsonb
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
  named as (
    select q_from as id from quoted union select q_to from quoted union select character from stand union select character from excerpted
  )
  select jsonb_build_object(
    'since', since,
    'until', until,
    'threads', coalesce((select jsonb_agg(jsonb_build_object('thread', h.thread, 'title', h.title, 'board', (select bn.name from boards_now bn where bn.id = h.board_id), 'posts', h.posts,
                          'heat', h.heat, 'controversy', h.controversy, 'length', h.length)
                         order by h.posts desc, h.controversy desc, h.thread) from hot h), '[]'::jsonb),
    'standings', coalesce((select jsonb_agg(jsonb_build_object('rank', s.rank, 'character', s.character, 'amount', s.amount) order by s.rank) from stand s), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.payload ->> 'kind', 'params', m.payload -> 'params',
                          'demand', m.payload -> 'demand', 'expiresAt', m.payload -> 'expires_at', 'landedAt', m.landed_at,
                          'progress', case when m.state = 'held' then null else demand_progress_or_error(m.act) end, 'ended', m.ended, 'state', m.state)
                          || case when m.state = 'held' then jsonb_build_object('heldAt', m.held_at, 'why', m.why) else '{}'::jsonb end
                          order by m.grp, m.sort_at desc, m.act) from moved m), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('from', q.q_from, 'to', q.q_to, 'count', q.n) order by q.n desc, q.q_from, q.q_to) from quoted q), '[]'::jsonb),
    'bossReactions', coalesce((select jsonb_agg(jsonb_build_object('act', bt.act, 'thread', bt.thread, 'total', bt.total, 'tally', bt.tally) order by bt.total desc, bt.act) from boss_tally bt), '[]'::jsonb),
    'excerpts', coalesce((select jsonb_agg(jsonb_build_object('act', e.act, 'thread', e.thread, 'character', e.character, 'reactions', e.reactions, 'text', e.excerpt)
                          order by e.reactions desc, e.created_at desc, e.act) from excerpted e), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'name', cp.name, 'staff', cp.staff is not null) order by cp.id)
                            from characters_public cp where cp.id in (select id from named)), '[]'::jsonb)
  ) into result;
  return result;
end $$;
