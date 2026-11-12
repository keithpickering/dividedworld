-- The words that name a moved thread (docs/plans/2026-11-06-fangame-split-plan.md, Task 3, the move sentences).
--
-- A moveThread Act holds ids. The sentence "The Boss moved <thread> from <board> to <board>." needs the thread's title now and the board it left. move_thread_names reads both for a
-- handful of moves at once: `items` is a jsonb array of {thread, act}. For a landed move (act given) the board it left is the one thread_departures (0326) wrote when the Act landed; for
-- a move still waiting (no act) it is the board the thread is on now, which is what it will leave. The answer is an array of {key, title, from}, `key` being the act when given, else the thread.
-- Every field is public: a thread's title, and the board it was on. Nothing is computed from who owns a character, a class or a reaction. At most 50 items are read.
create function move_thread_names(items jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', i.k, 'title', t.title, 'from', case when i.act is not null then d.from_board else t.board end)), '[]'::jsonb)
  from (
    select coalesce(x ->> 'act', x ->> 'thread') as k, safe_uuid(x ->> 'thread') as thread, safe_uuid(x ->> 'act') as act
    from jsonb_array_elements(case when jsonb_typeof(items) = 'array' then items else '[]'::jsonb end) with ordinality o(x, n) where n <= 50
  ) i
  join threads t on t.id = i.thread
  left join thread_departures d on d.act = i.act
$$;
revoke execute on function move_thread_names(jsonb) from public, anon;
grant execute on function move_thread_names(jsonb) to authenticated;
