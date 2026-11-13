-- A play on a character takes a moment too, and play_moment answers it. docs/plans/2026-11-12-spin-at-post-plan.md, Task 3;
-- docs/plans/2026-11-12-spin-at-post-design.md, section 3.
--
-- A play on a character (reach `character`, 0055) is cast from a post, the post whose postbit took the card, and holds it as its target_act_id. Until now only a play
-- on a post took a moment (0072) and play_moment refused any other, so a box that shows a character play as it landed had nothing to read. This migration:
--   acts_take_play_moment   dropped and made again for a play whose reach is `post` or `character` (an Act with no reach is a post's). take_play_moment is not changed:
--                           for a character play `new.target_act_id` is the cast-from post, and its layers query reads only layers whose reach is a post's (0072's
--                           acts_layers predicate), so the play is no layer of its own moment and a character play on the post is no layer of anyone's.
--   play_moment             written again whole from 0340 with two changes: a play whose reach is `character` is read, its post being its target_act_id, and the answer
--                           gains `at`, the play's `created_at` (spin_moment, 0351, answers the same key for a spin's time). The play is first among `layers` as before and
--                           is not among `above`: a play listed above is one that began before this one (`a.created_at < k.created_at`), and a play does not begin before
--                           itself. A thread's play and a board's play are refused as before, in the same words.
-- A character play made before this migration has no snapshot, so it is answered as a post's play from before 0072 is: the version current at its time from the post's
-- edits, itself alone, `recorded` false. Nothing is backfilled: a moment is what was on the post when the play landed, which nothing now can write truthfully.
-- No state is added to a player, a character or a post, so nothing is left to end ("No player is ever stuck").
--
-- The masks. The trigger and the read use only Acts and effect_state, as 0072 and 0340 do, never face_down, characters.owner or a class, and the same bytes go to every
-- caller. The refusal for a play that is no play on a post is the one sentence it was. Nothing that was refused before is told differently by who asks. The trigger is an ordinary one
-- (not `enable always`), so an import written as a replica writes the exported moments as they were and takes none of its own, as for a play on a post.
--
-- Cost. Writing: a character play now pays what a play on a post pays, one moment row and a row for each layer on the cast-from post (a handful, through acts_layers).
-- Reading: as 0340's, probes by primary key and the snapshot's keys, and play_reach's three indexes bounded to the plays live then; it grows with no count of players, Acts or
-- threads. Neither function's search_path or grants changed: play_moment keeps its pinned search_path and its grant to authenticated alone.
--
-- Every other place that reads a play's reach for a moment: none in SQL. play_moment's callers in SQL are the tests; the TypeScript that offers it is the data layer's.

drop trigger acts_take_play_moment on acts;
create trigger acts_take_play_moment after insert on acts for each row
  when (new.kind in ('card', 'set', 'spring') and new.target_act_id is not null and coalesce(new.payload ->> 'reach', 'post') in ('post', 'character'))
  execute function take_play_moment();

create or replace function public.play_moment(play uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  k acts%rowtype;
  on_post acts%rowtype;
  v acts%rowtype;
  recorded boolean;
  on_board uuid;
  grace interval := coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0');
  -- A play beyond a post that began before this one ends at most its reach's reachLasts after it began (play_card), so before this
  -- play's time plus that bound: each probe of play_reach reads the plays live then and none begun since, however old the play is.
  -- (An instance that lowers reachLasts later bounds an older moment by the lower span; a play that outlived it is left off that
  -- moment's list of plays above, which is words on the frame.)
  bound record;
begin
  select * into k from acts a where a.id = play_moment.play;
  -- A play on a post, or on a character (cast from the post that is its target_act_id). A thread's and a board's play are no play on a post.
  if k.id is not null and k.kind in ('card', 'set', 'spring') and k.target_act_id is not null and coalesce(k.payload ->> 'reach', 'post') in ('post', 'character') then
    select * into on_post from acts a where a.id = k.target_act_id;
  end if;
  if on_post.kind is distinct from 'post' then raise exception 'that is no play on a post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  select * into v from acts a where a.id = (select m.post_version from play_moments m where m.play = k.id);
  recorded := v.id is not null;
  if not recorded then
    select * into v from acts e where e.kind = 'edit' and e.target_act_id = on_post.id and e.created_at <= k.created_at
    order by e.created_at desc, e.id desc limit 1;
    if v.id is null then v := on_post; end if;
  end if;
  select t.board into on_board from threads t where t.id = on_post.thread;
  -- An instance seeded without reachLasts (settings_reach_hold makes it whole once written) bounds nothing, rather than reading none.
  select coalesce(span_interval(setting('reachLasts') -> 'character'), interval '1000 months') as character,
         coalesce(span_interval(setting('reachLasts') -> 'thread'), interval '1000 months') as thread,
         coalesce(span_interval(setting('reachLasts') -> 'board'), interval '1000 months') as board into bound;
  return jsonb_build_object(
    'version', act_projection(on_post.id) || jsonb_build_object(
      'current_payload', public_payload(v.payload, version_hidden(v.id), v.id),
      'edited_at', case when v.kind = 'edit' then v.created_at end,
      'shown_edited_at', case when v.kind = 'edit' and v.created_at > on_post.created_at + grace then v.created_at end),
    -- The rows' order is for a stable answer only: a caught play and its spring share a transaction's time, so readers order the layers
    -- themselves (inPlayOrder) and find a caught play's spring by its set, never by this order.
    'layers', jsonb_build_array(jsonb_build_object('act', act_projection(k.id), 'state', null, 'savedAt', null))
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(a), 'state', l.state, 'savedAt', l.saved_at) order by a.created_at, a.id)
                   from play_moment_layers l join acts_public a on a.id = l.layer where l.play = k.id), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(e), 'state', null, 'savedAt', null) order by e.created_at, e.id)
                   from acts_public e
                   where e.kind = 'card_end' and e.created_at <= k.created_at
                     and e.target_act_id in (select k.id union all select l.layer from play_moment_layers l where l.play = k.id)), '[]'::jsonb),
    'above', coalesce((
      select jsonb_agg(jsonb_build_object('play', r.play, 'reach', r.reach, 'target', coalesce(r.character, r.thread, r.board), 'ends_at', r.ends_at, 'act', to_jsonb(a))
                       order by a.created_at, a.id)
      from (
        select x.* from play_reach x where x.character = on_post.character and x.ends_at > k.created_at and x.ends_at <= k.created_at + bound.character
        union all
        select x.* from play_reach x where x.thread = on_post.thread and x.ends_at > k.created_at and x.ends_at <= k.created_at + bound.thread
        union all
        select x.* from play_reach x where x.board = on_board and x.ends_at > k.created_at and x.ends_at <= k.created_at + bound.board
      ) r join acts_public a on a.id = r.play
      where a.created_at < k.created_at
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = r.play and e.created_at <= k.created_at)), '[]'::jsonb),
    'recorded', recorded,
    'at', k.created_at);
end $function$;
