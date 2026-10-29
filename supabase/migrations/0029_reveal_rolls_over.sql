-- The season's reveal keeps the secrets: each character, in order of final standing, with its place
-- and standing and only what its player made public in the season (its reveals, and its announced
-- Turns, an old class where the Turn named it), never its classes. Unrevealed classes and silent
-- Turns roll over into the next season. The class reveal design, section 5; its plan, Task 3.
--
-- Nothing here reads class_history. A season revealed before this migration keeps its Acts as they
-- were written, every class in them ("Append-only"): only the seasons revealed after it change.

-- reveal_season (0007), its characters' Acts carrying `place`, `standing` and `shown` in place of
-- `classes`. Everything else as 0007 wrote it.
create or replace function reveal_season(ended timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  in_thread uuid;
  written uuid;
begin
  select * into s from seasons where ends_at is null for no key update;
  if s.id is null or s.starts_at + span_interval(setting('seasonLength')) > ended then return null; end if;

  update seasons set ends_at = ended where id = s.id;
  insert into seasons (number, starts_at) values (s.number + 1, ended);
  insert into threads (board, title) values (system_board(), copy_of('revealTitle', s.number)) returning id into in_thread;
  perform broadcast_later('board:' || (select board from threads where id = in_thread), 'thread', thread_projection(in_thread));
  -- The reveal's own Act says what the season was; each character follows it as an Act of its
  -- own, so the reveal is many small rows at any size of cast, never one payload holding all of
  -- them. Characters by name; who plays them, never. A character that debuts at this very
  -- settlement played no part in the season, and is the next one's.
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'reveal', in_thread, jsonb_build_object('season', s.number, 'from', s.starts_at, 'to', ended,
    'body', copy_of('revealBody', s.number), 'characters', (select count(*) from characters where debuted_at < ended)), ended) returning id into written;
  perform broadcast_later('thread:' || in_thread, 'act', act_projection(written));
  -- Each character in order of final standing, with its place and its standing, and only what its
  -- player made public in the season (`shown`): its reveals, and its announced Turns with the class
  -- each left where the Turn named it, in order. Read from class_reveals and turns_announced (0027),
  -- which read Acts alone, so no unrevealed class and no silent Turn is in it: they roll over into
  -- the next season, a clue rather than a stated fact (the class reveal design, section 5). A Turn
  -- that took effect at this very end is the next season's, as before. At one instant a Turn comes
  -- before the reveal it wrote (0028), as its tally stands before it in the thread.
  insert into acts (character, kind, thread, payload, created_at)
    select null, 'reveal', in_thread, jsonb_build_object('season', s.number, 'character', c.id, 'name', c.name,
        'place', rank() over (order by coalesce(st.amount, 0) desc), 'standing', coalesce(st.amount, 0),
        'shown', coalesce((
          select jsonb_agg(x.entry order by x.at, x.after, x.act) from (
            select r.at, 1 as after, r.act, jsonb_build_object('kind', 'reveal', 'act', r.act, 'at', r.at, 'class', r.class, 'via', r.via) as entry
            from class_reveals r where r.character = c.id and r.at >= s.starts_at and r.at < ended
            union all
            select t.at, 0, t.act, jsonb_build_object('kind', 'turn', 'act', t.act, 'at', t.at)
              || case when t.was is null then '{}'::jsonb else jsonb_build_object('was', t.was, 'since', t.since) end
            from turns_announced t where t.character = c.id and t.at >= s.starts_at and t.at < ended
          ) x), '[]'::jsonb)), ended
    from characters c left join standings st on st.character = c.id and st.season = s.id
    where c.debuted_at < ended
    order by coalesce(st.amount, 0) desc, c.name, c.id;
  -- Each in the thread's order, in a statement of its own, which sees the rows the one above wrote.
  insert into broadcasts_due (topic, event, payload)
  select 'thread:' || in_thread, 'act', act_projection(a.id) from acts a where a.thread = in_thread and a.id <> written order by a.seq;
  update seasons set reveal_act = written where id = s.id;
  return jsonb_build_object('season', s.number, 'thread', thread_projection(in_thread), 'act', act_projection(written));
end $$;
