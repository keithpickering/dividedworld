-- A spin picks its board (docs/plans/2026-11-25-spin-board-plan.md, Task 1; docs/plans/2026-11-25-spin-board-design.md, sections 1 to 5).
--
-- What was wrong: a spin landed on the board its origin was on (the first open board for an Act on The System's), and the player had no say. The way a bar fell on a spin made it worse: a character barred
-- from a board could not spin from a post there at all, though a spin onto another board was a way out.
--
--   spin_board(origin)               today's board for an origin, written once: its thread's board, or players_board() where that board is The System's; null for no Act and for an edit. spin_written and
--                                    write_staff_spin each carried this `case`; both now call it, and the form's read (spin_places) does too.
--   spin_written(..., board_slug)    a last parameter, null by default (today's board). A named board is checked as start_thread checks one: it exists ("there is no such board", P0002), it is not The System's
--                                    (42501), it is open (lock_board_start, then not_closed), and, for a spin (check_bar), the character is not barred from it. The origin is told of first, so a bad origin is
--                                    refused before a bad board; the bar is now asked of the board the thread lands on, whichever way it was chosen. Everything else as 0395 wrote it.
--   spin(..., board_slug)            passes it on. Grants as 0357 gave them.
--   apologize(..., board_slug)       the apology lands on the board the player picks, today's board if none, the bar not checked (was: "onto the board it bars, if that is where the spin opens"). Grants as 0130.
--   write_staff_spin(..., board_slug) the same default and the same two refusals as a player's spin; no bar is asked of a persona. Chatter names its arguments and names no board. Grants as 0420.
--   spin_places(origin, through)     what the form reads: {default: today's board's slug or null, boards: [{slug, name, barred, until}]}, the open boards that are not The System's in the index's order
--                                    (created_at, id), a barred one kept and marked, with the latest end of its bars (null where a bar has no end). bars_of is read once, not once for each board.
--   thread_open                      origin_place gains a key, `board`: the origin's thread's board, from the join the view already makes (`ot`), for every origin but an Update's. No column and no join is added.
--
-- Masks. A board is public and so are bars (a move's Act names the character and the board), as the refusals already said; spin_places answers for a character the caller plays (acting) and reads only public facts of
-- it. No class, owner or reactor is read. Ways out. No state is added: a bar still ends at its time, by an accepted apology, by an admin or on appeal, and a barred board in the list says so and until when; a spin
-- from the barred board now has a way through (another board). Append-only: nothing is updated. Scale: spin_board is three primary-key probes; spin_places reads boards_now once and bars_of once, and the list is
-- the instance's open boards (a handful, never a function of players or Acts); thread_open's plan memory is untouched (no join), which supabase/tests/e2e/0028-cold-read-budget.ts watches.
-- The tests that drive it red are supabase/tests/0442-spin-board.sql.

-- ===================================================================================== 1. spin_board ====
create function public.spin_board(origin uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case when b.is_system then players_board() else b.id end
  from acts a join threads t on t.id = a.thread join boards b on b.id = t.board where a.id = spin_board.origin and a.kind <> 'edit'
$$;
revoke execute on function public.spin_board(uuid) from public, anon;
grant execute on function public.spin_board(uuid) to authenticated, service_role;

-- ===================================================================================== 2. spin_written ====
-- spin_written (0395), taking the board. Everything else as 0395 wrote it.
drop function public.spin_written(uuid, uuid, text, text, boolean, uuid[], uuid);
create function public.spin_written(origin uuid, through uuid, title text, body text, check_bar boolean, framing uuid[], at_post uuid DEFAULT NULL::uuid, board_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  made uuid;
  written uuid;
  o record;
begin
  perform within('title', title, 'titleMaxLength');
  perform within('body', coalesce(body, ''), 'postMaxLength', true);
  on_board := spin_board(origin);
  if on_board is null then raise exception 'there is no such Act to spin from' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  select a.id, a.kind, a.payload, a.target_act_id into o from acts a where a.id = origin;
  if o.kind = 'poll_close' then raise exception 'spin the poll' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if o.kind = 'poll' and (o.payload ? 'removed' or latest_poll(o.target_act_id) is distinct from o.id) then
    raise exception 'that poll was replaced' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if o.kind = 'ballot' and ballot_secret(o.target_act_id) then raise exception 'a secret ballot cannot be spun' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- A named board, as start_thread checks one (the origin was told of first). No board is today's board, spin_board's answer above.
  if board_slug is not null then
    select b.id into on_board from boards b where b.slug = board_slug;
    if on_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
    -- Named by the board's own name (a rename in force shows), never The System's: engine/ui/voice.ts holds that a player's string names no one.
    if exists (select 1 from boards b where b.id = on_board and b.is_system) then
      raise exception '% is the staff''s own board; pick another board', coalesce((select n.name from boards_now n where n.id = on_board), 'this board') using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
  end if;
  -- The post a spin is pressed at: a post by the character a landed, live play was cast on. Public facts only; one sentence for every predicate that fails.
  if at_post is not null then
    if not exists (
      select 1 from acts k join play_reach r on r.play = k.id join acts p on p.id = at_post
      where k.id = origin and k.kind = 'card' and not (k.payload ? 'caught')
        and r.reach = 'character' and post_kind(p.kind) and shown_author(p.id, p.character) = r.character
        and r.ends_at > now()
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = k.id)
    ) then raise exception 'that card is not on that post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  end if;
  -- In start_thread's order: shared, in a statement before the check, so the check's snapshot is made once a closing move on this board has committed (or none is open).
  perform lock_board_start(on_board);
  perform not_closed(on_board);
  if check_bar then perform not_barred(through, on_board); end if;
  insert into threads (board, title, origin_act_id) values (on_board, title, origin) returning id into made;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'spin', made, origin,
          jsonb_build_object('title', title, 'body', coalesce(body, '')) || case when at_post is not null then jsonb_build_object('at', at_post) else '{}'::jsonb end)
  returning id into written;
  perform write_framed(body, framing, written, auth.uid());
  perform write_forged_framed(written, auth.uid(), framing);
  perform draw_visits(written);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $function$;
revoke execute on function spin_written(uuid, uuid, text, text, boolean, uuid[], uuid, text) from public, anon, authenticated;
grant execute on function spin_written(uuid, uuid, text, text, boolean, uuid[], uuid, text) to service_role;

-- ===================================================================================== 3. spin ====
-- spin (0357), taking the board and passing it on. Everything else as 0357 wrote it.
drop function public.spin(uuid, uuid, text, text, uuid[], uuid);
CREATE FUNCTION public.spin(origin uuid, through uuid, title text, body text DEFAULT ''::text, framing uuid[] DEFAULT '{}'::uuid[], at_post uuid DEFAULT NULL::uuid, board_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform acting(through);
  -- The post pressed is held `for share` before anything else is taken (the lock order is post, then visits_open, then character): not_banned takes the character's row, and a veil cast on the post takes the post's
  -- row `for no key update` and then checks for a spin pressed at it, as spin_written checks the post for a veil after this. So the two are laid one at a time, and whichever is first, the second is refused.
  if at_post is not null then perform 1 from acts a where a.id = at_post for share; end if;
  perform not_banned(through);
  return spin_written(origin, through, title, body, true, framing, at_post, board_slug);
end $function$;
revoke execute on function spin(uuid, uuid, text, text, uuid[], uuid, text) from public, anon;
grant execute on function spin(uuid, uuid, text, text, uuid[], uuid, text) to authenticated;

-- ===================================================================================== 4. apologize ====
-- apologize (0130), taking the board: the apology lands on the board the player picks, today's board if none, the bar not checked (spin_written's check_bar is false). Everything else as 0130 wrote it.
drop function public.apologize(uuid, uuid, text, text, uuid[]);
create function apologize(in_move uuid, through uuid, title text, body text, framing uuid[] default '{}', board_slug text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  every integer := apology_setting('apologyEveryHours');
  next_at timestamptz;
  made jsonb;
begin
  perform acting(through);
  perform not_banned(through);
  if not exists (
    select 1 from acts a join open_moves o on o.move_act = a.id
    where a.id = in_move and a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,character}' = through::text
      and a.payload #>> '{demand,kind}' = 'apologyAccepted' and coalesce(move_expires_at(a.id) > now(), true)
  ) then
    raise exception 'there is no move of this character''s that an apology can answer' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  -- Two apologies at once for one move would each find no row of the other's.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.apology.' || in_move::text, 0));
  if exists (select 1 from apologies x where x.move_act = in_move and x.state = 'pending') then
    raise exception 'an apology to that move is still waiting for a ruling' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  select max(x.created_at) + make_interval(hours => every) into next_at from apologies x
  where x.move_act = in_move and x.character = through and x.state in ('pending', 'accepted', 'rejected') and x.created_at > now() - make_interval(hours => every);
  if next_at is not null then
    raise exception 'this character has already apologized to that move in the last % hours; the next apology opens at % UTC', every,
      to_char(date_trunc('minute', next_at + interval '59.999999 seconds') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  made := spin_written(in_move, through, title, body, false, framing, null, board_slug);
  insert into apologies (move_act, apology_act, character, state) values (in_move, (made -> 'act' ->> 'id')::uuid, through, 'pending');
  return made;
end $$;
revoke execute on function apologize(uuid, uuid, text, text, uuid[], text) from public, anon;
grant execute on function apologize(uuid, uuid, text, text, uuid[], text) to authenticated;

-- ===================================================================================== 5. write_staff_spin ====
-- write_staff_spin (0420), taking the board: spin_board's answer when none is named, else the named board with a player's spin's two refusals (its own errcodes, no refusal hint, as its other refusals have none).
-- No bar is asked of a persona. The board is checked after the origin, as spin_written's is. Everything else as 0420 wrote it.
drop function public.write_staff_spin(text, uuid, text, text, jsonb);
create function write_staff_spin(staff_key text, origin uuid, title text, body text, marker jsonb default '{}', board_slug text default null)
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
  on_board := spin_board(write_staff_spin.origin);
  if on_board is null then raise exception 'there is no such Act to spin from' using errcode = 'P0002'; end if;
  if board_slug is not null then
    select b.id into on_board from boards b where b.slug = board_slug;
    if on_board is null then raise exception 'there is no such board' using errcode = 'P0002'; end if;
    if exists (select 1 from boards b where b.id = on_board and b.is_system) then raise exception '% is the staff''s own board; pick another board', coalesce((select n.name from boards_now n where n.id = on_board), 'this board') using errcode = '42501'; end if;
  end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into threads (board, title, origin_act_id) values (on_board, title, write_staff_spin.origin) returning id into made;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (who, 'spin', made, write_staff_spin.origin, coalesce(marker, '{}'::jsonb) || jsonb_build_object('title', title, 'body', body)) returning id into written;
  perform set_config('kayfabb.staff_writer', flag, true);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $$;
revoke execute on function write_staff_spin(text, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function write_staff_spin(text, uuid, text, text, jsonb, text) to service_role;

-- ===================================================================================== 6. spin_places ====
-- What the form reads for a character spinning from an origin: today's board (null for no Act) and every open board that is not The System's, with the character's bars. The caller must play `through` (acting), as spin does.
create function public.spin_places(origin uuid, through uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform acting(through);
  return jsonb_build_object(
    'default', (select n.slug from boards_now n where n.id = spin_board(spin_places.origin)),
    'boards', coalesce((
      with bars as (select x.board, max(x.expires_at) as until from bars_of(spin_places.through) x group by x.board)
      select jsonb_agg(jsonb_build_object('slug', n.slug, 'name', n.name, 'barred', bs.board is not null,
                                          'until', bs.until) order by n.created_at, n.id)
      from boards_now n left join bars bs on bs.board = n.id
      where not n.is_system and not n.closed), '[]'::jsonb));
end $$;
revoke execute on function public.spin_places(uuid, uuid) from public, anon;
grant execute on function public.spin_places(uuid, uuid) to authenticated;

-- ===================================================================================== 7. thread_open ====
-- thread_open (0422), its origin_place also carrying the board of the origin's thread (an Update's none). Everything else as 0422 wrote it.

create or replace view thread_open as
  select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.next_seq - 1 as last_seq, t.replies,
         f.id as first_act, case when exists (select 1 from post_veils_live sv where sv.post = f.id and sv.veil = 'author') then (select sk.id from characters sk where sk.staff_kind = 'anonymous') else f.character end as first_character,
         l.id as last_act, case when exists (select 1 from post_veils_live sv where sv.post = l.id and sv.veil = 'author') then (select sk.id from characters sk where sk.staff_kind = 'anonymous') else l.character end as last_character,
         (select count(*) from (
            select 1 from acts r where r.thread = t.id and r.kind = 'post' and r.seq > 1 and r.created_at > now() - interval '7 days'
            limit (select (h.value #>> '{}')::integer from settings h where h.key = 'hotReplies')
          ) capped) as replies_this_week,
         o.thread as origin_thread,
         case
           when o.id is null then null
           when o.kind = 'update' then jsonb_build_object('kind', 'update', 'act', o.id, 'title', o.payload ->> 'title')
           when o.kind in ('card', 'set', 'spring') then jsonb_build_object(
             'kind', 'play',
             'card', case when o.kind = 'set' then null else o.payload ->> 'card' end,
             'on', case
               when r.play is not null then case r.reach
                 when 'character' then jsonb_build_object('kind', 'character', 'id', r.character, 'name', rc.name)
                 when 'thread' then jsonb_build_object('kind', 'thread', 'id', r.thread, 'title', rt.title)
                 when 'board' then (select jsonb_build_object('kind', 'board', 'slug', n.slug, 'name', n.name) from boards_now n where n.id = r.board)
               end
               when p.kind = 'update' then jsonb_build_object('kind', 'update', 'act', p.id, 'title', p.payload ->> 'title')
               when p.seq is not null then jsonb_build_object('kind', 'post', 'thread', p.thread, 'title', pt.title, 'seq', p.seq)
               else null
             end,
             'from', case when cf.seq is not null then jsonb_build_object('kind', 'post', 'thread', cf.thread, 'title', cft.title, 'seq', cf.seq) else null end,
             'at', case when sp.seq is not null then jsonb_build_object('kind', 'post', 'thread', sp.thread, 'title', spt.title, 'seq', sp.seq) else null end)
           when o.kind = 'poll' and pp.seq is not null then jsonb_build_object('kind', 'poll', 'question', o.payload ->> 'question',
             'on', jsonb_build_object('kind', 'post', 'thread', pp.thread, 'title', ppt.title, 'seq', pp.seq))
           when o.kind = 'ballot' and pp.seq is not null and bc.id is not null then jsonb_build_object('kind', 'ballot', 'character', jsonb_build_object('id', bc.id, 'name', bc.name), 'question', bp.payload ->> 'question',
             'on', jsonb_build_object('kind', 'post', 'thread', pp.thread, 'title', ppt.title, 'seq', pp.seq))
           when o.kind in ('report', 'report_verdict', 'appeal', 'appeal_ruling') then spin_answer_place(o.id)
           when o.seq is not null then jsonb_build_object('kind', 'post', 'thread', o.thread, 'title', ot.title, 'seq', o.seq)
           else null
         end
         -- The board of the origin's thread, where there is a place and it is not an Update's (an Update's link leads to the Updates page, not into a board): a null place stays null, since `||` is strict.
         || case when o.kind <> 'update' and ot.board is not null then jsonb_build_object('board', ot.board) else '{}'::jsonb end as origin_place
  from threads t
  left join acts f on f.thread = t.id and f.seq = 1
  left join acts l on l.thread = t.id and l.seq = t.next_seq - 1
  left join acts o on o.id = t.origin_act_id
  left join threads ot on ot.id = o.thread
  left join acts p on p.id = o.target_act_id and o.kind in ('card', 'set', 'spring') and coalesce(o.payload ->> 'reach', 'post') = 'post'
  left join threads pt on pt.id = p.thread
  left join play_reach r on r.play = o.id
  left join characters_public rc on rc.id = r.character
  left join threads rt on rt.id = r.thread
  -- The cast-from post of a play on a character, and the post a spin was pressed at: each a probe by primary key that finds nothing for any other thread.
  left join acts cf on cf.id = o.target_act_id and o.kind = 'card' and o.payload ->> 'reach' = 'character'
  left join threads cft on cft.id = cf.thread
  left join acts sp on sp.id = case when f.kind = 'spin' then (f.payload ->> 'at')::uuid end
  left join threads spt on spt.id = sp.thread
  -- A poll's post, and a ballot's poll and its character as acts_public shows it (a secret ballot has none, and is no origin): each a probe by primary key that finds nothing for any other thread.
  left join acts bp on bp.id = o.target_act_id and o.kind = 'ballot'
  left join acts pp on pp.id = case when o.kind = 'poll' then o.target_act_id when o.kind = 'ballot' then bp.target_act_id end
  left join threads ppt on ppt.id = pp.thread
  left join acts_public ab on ab.id = o.id and o.kind = 'ballot'
  left join characters_public bc on bc.id = ab."character"
  where t.id is distinct from (select (u.value #>> '{}')::uuid from settings u where u.key = 'updatesThread');
