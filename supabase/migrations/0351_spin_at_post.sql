-- A spin from a card on a character names the post it was pressed on. docs/plans/2026-11-12-spin-at-post-plan.md, Task 2;
-- docs/plans/2026-11-12-spin-at-post-design.md, sections 1, 2, 5 and 7.
--
-- A thread spun from a play on a character has that play's Act as its origin, and its place is the character (0079, 0152). The play does hold a post (its
-- target_act_id, the post whose postbit took the card, 0055), and the post the spinner pressed Spin thread on is recorded nowhere. This migration records it, and
-- the post as it stood, and gives the thread's place both posts:
--   spin, spin_written   take `at_post uuid default null`, last. A spin that names a post writes it on its own Act (`at` in the payload, with the title and the body), and
--                        is taken only where the origin is a play on a character that landed (not caught) and is up (its time not run out, no admin's end), and the post is
--                        a post by that character. Otherwise `that card is not on that post`, one sentence and one code whichever check failed. apologize is as 0130 wrote it:
--                        it calls spin_written without it, so `at_post` is null for it.
--   spin_moments         one row per spin that names a post: the post's latest edit then, or the post itself where it has none.
--   spin_moment_layers   one row per layer on that post then (acts_layers' own predicate), with a copy of the state it had saved and when.
--                        Both as play_moments and play_moment_layers are (0072): append-only, truncate guarded always, written by a trigger on the Act's insert (an
--                        ordinary one, so an import written as a replica writes the exported moments as they were and takes none of its own), read by a signed-in player.
--   spin_moment(spin)    the moment: play_moment's (0340) shape with the spin's time as `at`, the origin play first among `layers` and left out of `above`.
--   thread_open          the `play` object of origin_place gains `from` (the cast-from post) and `at` (the pressed post), each a post place or null.
-- No state is added to a player, a character or a post, so nothing is left to end ("No player is ever stuck"): a spin refused for its post can be made again with no
-- post, or from the mark on another post.
--
-- Every other place that computes origin_place: none in SQL. Migrations 0079 and 0152 are the view's two definitions (0152 is the one in force; this is its next), and
-- thread_list is `select ... from thread_open` less the unlisted threads, so it carries the same object. thread_page, the log's threads and the search read a thread's row from
-- one of the two views as JSON and so give the two new keys without a change. The TypeScript that reads the object (web/src/data/supabase.ts, toPlace) and the fake
-- that computes it (engine/ui/data/fake.ts, originPlace) are the data layer's, Task 4 of the plan; a row from before this migration has neither key and still reads there.
--
-- The masks (design, section 5). The check reads the play's reach row, the post's author and the play's end: all public facts of public Acts, and never characters.owner
-- or a class. It runs before anything that differs by who is asking, and its one sentence and code are the same for every failed predicate, so the refusal proves nothing
-- private and its timing does not differ with who owns the play's character, the post's character or the caster. spin_moment is the same bytes for every reader: it reads
-- the Acts and the two snapshot tables, never face_down and never who is asking, so a card back in a spin's moment shows no card (acts_public). The version it serves
-- is shown through public_payload(version_hidden(...)), as 0340 wrote play_moment, so words an admin hides after the spin leave the moment.
--
-- A second run: a spin sent twice writes two spins and two moments, each at its own time. A play an admin ends between the check and the insert leaves a moment of a
-- play that had just ended, which is a fact of that second and no more than the check's own race.
--
-- A busy instance (design, section 7). Writing: one row for each spin that names a post and one for each layer on that post then (a post carries a handful), through
-- acts_layers (0072); neither grows with the thread or the instance. Reading the moment: probes by primary key and by the snapshot's keys, and play_reach's three
-- indexes bounded to the plays live then as play_moment bounds them. The view: four joins by primary key (the cast-from post and its thread, the pressed post and its
-- thread), each met only by a thread spun from a play on a character and a null probe for every other row (the join's predicate is on the origin or the first Act,
-- and the pressed post's id is read only from a spin). On a board's deep page the rows an offset skips are computed too (0152's header), so each skipped row spun
-- this way pays the probes. Measured on 5,000 threads in one board, half spun from a play on a character with a post, on committed rows after a VACUUM ANALYZE,
-- offset 2000 (limit 20), thread_list by board newest first, EXPLAIN ANALYZE, five runs each on this machine:
--   before this migration   36.0 to 38.0 ms
--   after                   53.6 to 59.8 ms: about 10 microseconds more for each of the 2,020 rows computed, 20 ms in all. At this size the planner hashes the small tables
--                           whole, as it does for the view's existing joins.
--   after, at 450,000 Acts and 55,000 threads (the same 5,000 spun threads among them): 36 to 41 ms, the planner then probing acts_pkey and threads_pkey for the
--                           joined rows (an Index Scan on acts_pkey for the cast-from post and one on threads_pkey for its thread, and the pair for the pressed post, probed only
--                           by a row whose first Act is a spin that names one), so the page does not grow with the instance.
-- It grows with the offset, as the page already does, and not with players, Acts or boards. supabase/tests/0298-spin-at-post.sql keeps a ratio guard of the same page against a
-- board of plain spins, in one transaction (where the plan is slower than an instance's, so its absolute times are not the figures above).

-- ---------------------------------------------------------------------------------------------------- the tables ----

create table spin_moments (
  spin uuid primary key references acts (id),
  post_version uuid not null references acts (id)
);

create table spin_moment_layers (
  spin uuid not null references spin_moments (spin),
  layer uuid not null references acts (id),
  state jsonb,
  saved_at timestamptz,
  primary key (spin, layer)
);

create function spin_moments_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a spin''s moment is never edited; it is what was on the post when the spin was written' using errcode = '55000';
end $$;
create trigger spin_moments_no_update before update or delete on spin_moments for each row execute function spin_moments_append_only();
create trigger spin_moments_no_truncate before truncate on spin_moments for each statement execute function spin_moments_append_only();
create trigger spin_moment_layers_no_update before update or delete on spin_moment_layers for each row execute function spin_moments_append_only();
create trigger spin_moment_layers_no_truncate before truncate on spin_moment_layers for each statement execute function spin_moments_append_only();
-- The truncate guards fire on a restore too, as play_moments' do.
alter table spin_moments enable always trigger spin_moments_no_truncate;
alter table spin_moment_layers enable always trigger spin_moment_layers_no_truncate;

-- Read as play_moments is, by a signed-in player; written by the trigger alone.
alter table spin_moments enable row level security;
alter table spin_moment_layers enable row level security;
revoke all on spin_moments, spin_moment_layers from public, anon, authenticated;
grant select on spin_moments, spin_moment_layers to authenticated;
create policy read on spin_moments for select to authenticated using (true);
create policy read on spin_moment_layers for select to authenticated using (true);
revoke execute on function spin_moments_append_only() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ the snapshot ----

-- The moment of the spin just written: the post it names as it stands, and every layer on that post with what it had saved. take_play_moment's (0072) body for the post
-- `at`; the layers are acts_layers' predicate, word for word, so the planner uses that index.
create function take_spin_moment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  post uuid := (new.payload ->> 'at')::uuid;
begin
  insert into spin_moments (spin, post_version)
  values (new.id, coalesce((select e.id from acts e where e.kind = 'edit' and e.target_act_id = post order by e.created_at desc, e.id desc limit 1), post));
  insert into spin_moment_layers (spin, layer, state, saved_at)
  select new.id, k.id, s.state, s.saved_at
  from acts k left join effect_state s on s.play = k.id
  where k.target_act_id = post and k.kind in ('card', 'set', 'spring') and coalesce(k.payload ->> 'reach', 'post') = 'post';
  return null;
end $$;
revoke execute on function take_spin_moment() from public, anon, authenticated;

create trigger acts_take_spin_moment after insert on acts for each row
  when (new.kind = 'spin' and new.payload ? 'at')
  execute function take_spin_moment();

-- ---------------------------------------------------------------------------------------------------- the spin ----

-- spin_written (0130), with `at_post`: after the origin's board is found and before the thread is made, a spin that names a post is held to the check below. Everything else
-- is as 0130 wrote it. The new parameter is last and defaults to null, so apologize's call, which does not pass it, is unchanged.
drop function spin_written(uuid, uuid, text, text, boolean, uuid[]);
create function spin_written(origin uuid, through uuid, title text, body text, check_bar boolean, framing uuid[], at_post uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform within('title', title, 'titleMaxLength');
  perform within('body', coalesce(body, ''), 'postMaxLength', true);
  select case when b.is_system then players_board() else b.id end into on_board
  from acts a join threads t on t.id = a.thread join boards b on b.id = t.board where a.id = origin and a.kind <> 'edit';
  if on_board is null then raise exception 'there is no such Act to spin from' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The post a spin is pressed at: a post by the character a landed, live play was cast on. Public facts only; one sentence for every predicate that fails.
  if at_post is not null then
    if not exists (
      select 1 from acts k join play_reach r on r.play = k.id join acts p on p.id = at_post
      where k.id = origin and k.kind = 'card' and not (k.payload ? 'caught')
        and r.reach = 'character' and p.kind = 'post' and p.character = r.character
        and r.ends_at > now()
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = k.id)
    ) then raise exception 'that card is not on that post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  end if;
  if check_bar then perform not_barred(through, on_board); end if;
  insert into threads (board, title, origin_act_id) values (on_board, title, origin) returning id into made;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'spin', made, origin,
          jsonb_build_object('title', title, 'body', coalesce(body, '')) || case when at_post is not null then jsonb_build_object('at', at_post) else '{}'::jsonb end)
  returning id into written;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $$;
revoke execute on function spin_written(uuid, uuid, text, text, boolean, uuid[], uuid) from public, anon, authenticated;

-- spin (0130): acting, the ban's refusal, then the spin with the bar checked against the board its thread opens on; with the post it is pressed at, where it has one.
drop function spin(uuid, uuid, text, text, uuid[]);
CREATE FUNCTION public.spin(origin uuid, through uuid, title text, body text DEFAULT ''::text, framing uuid[] DEFAULT '{}'::uuid[], at_post uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform acting(through);
  perform not_banned(through);
  return spin_written(origin, through, title, body, true, framing, at_post);
end $function$;
revoke execute on function spin(uuid, uuid, text, text, uuid[], uuid) from public, anon;
grant execute on function spin(uuid, uuid, text, text, uuid[], uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------------ the read ----

-- A spin's moment, read by a signed-in player as the Acts and play_reach are: play_moment's (0340) answer for the post the spin names, as it was when the spin was written:
--   version   the post as acts_public shows it, with the version's payload (as public_payload shows it) as its current payload, edited_at and shown_edited_at as they were then
--   layers    the origin play first (no state), then each layer row's Act with the state it had saved then and when, then the ends of any of them at or before the spin
--   above     each play beyond a post live on the post's author, its thread or its board at the spin's time, the origin play left out (it is drawn, not named)
--   recorded  true: a spin's moment is taken with it
--   at        the spin's time
-- The same bytes to every caller: nothing here reads face_down or who is asking.
create function spin_moment(spin uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s acts%rowtype;
  k acts%rowtype;
  on_post acts%rowtype;
  v acts%rowtype;
  on_board uuid;
  grace interval := coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0');
  -- As play_moment bounds the plays above: a play beyond a post that began before the spin ends at most its reach's reachLasts after it began.
  bound record;
begin
  select * into s from acts a where a.id = spin_moment.spin and a.kind = 'spin' and a.payload ? 'at';
  if s.id is null or not exists (select 1 from spin_moments m where m.spin = s.id) then
    raise exception 'that spin names no post' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  select * into k from acts a where a.id = s.target_act_id;
  select * into on_post from acts a where a.id = (s.payload ->> 'at')::uuid;
  select * into v from acts a where a.id = (select m.post_version from spin_moments m where m.spin = s.id);
  select t.board into on_board from threads t where t.id = on_post.thread;
  select coalesce(span_interval(setting('reachLasts') -> 'character'), interval '1000 months') as character,
         coalesce(span_interval(setting('reachLasts') -> 'thread'), interval '1000 months') as thread,
         coalesce(span_interval(setting('reachLasts') -> 'board'), interval '1000 months') as board into bound;
  return jsonb_build_object(
    'version', act_projection(on_post.id) || jsonb_build_object(
      'current_payload', public_payload(v.payload, version_hidden(v.id), v.id),
      'edited_at', case when v.kind = 'edit' then v.created_at end,
      'shown_edited_at', case when v.kind = 'edit' and v.created_at > on_post.created_at + grace then v.created_at end),
    'layers', jsonb_build_array(jsonb_build_object('act', act_projection(k.id), 'state', null, 'savedAt', null))
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(a), 'state', l.state, 'savedAt', l.saved_at) order by a.created_at, a.id)
                   from spin_moment_layers l join acts_public a on a.id = l.layer where l.spin = s.id), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(e), 'state', null, 'savedAt', null) order by e.created_at, e.id)
                   from acts_public e
                   where e.kind = 'card_end' and e.created_at <= s.created_at
                     and e.target_act_id in (select k.id union all select l.layer from spin_moment_layers l where l.spin = s.id)), '[]'::jsonb),
    'above', coalesce((
      select jsonb_agg(jsonb_build_object('play', r.play, 'reach', r.reach, 'target', coalesce(r.character, r.thread, r.board), 'ends_at', r.ends_at, 'act', to_jsonb(a))
                       order by a.created_at, a.id)
      from (
        select x.* from play_reach x where x.character = on_post.character and x.ends_at > s.created_at and x.ends_at <= s.created_at + bound.character
        union all
        select x.* from play_reach x where x.thread = on_post.thread and x.ends_at > s.created_at and x.ends_at <= s.created_at + bound.thread
        union all
        select x.* from play_reach x where x.board = on_board and x.ends_at > s.created_at and x.ends_at <= s.created_at + bound.board
      ) r join acts_public a on a.id = r.play
      where a.created_at < s.created_at and r.play <> k.id
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = r.play and e.created_at <= s.created_at)), '[]'::jsonb),
    'recorded', true,
    'at', s.created_at);
end $$;
revoke execute on function spin_moment(uuid) from public, anon, authenticated;
grant execute on function spin_moment(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------ the thread's place ----

-- thread_open (0152), the columns unchanged: the `play` object gains `from`, the post a play on a character was cast from (its target_act_id), and `at`, the post a spin was
-- pressed at (the spin's own payload), each a post place or null. thread_list (0079) is a view over thread_open and carries the object as it comes. Everything else is as 0152 wrote it.
create or replace view thread_open as
  select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.next_seq - 1 as last_seq, t.replies,
         f.id as first_act, f.character as first_character,
         l.id as last_act, l.character as last_character,
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
           when o.seq is not null then jsonb_build_object('kind', 'post', 'thread', o.thread, 'title', ot.title, 'seq', o.seq)
           else null
         end as origin_place
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
  where t.id is distinct from (select (u.value #>> '{}')::uuid from settings u where u.key = 'updatesThread');
