-- move_thread_names (0300) answers the board a thread left as `left`, not `from`: the web guard (tools/check-web-reads.mjs) reads any `.from` as a table read it cannot name, so a result key
-- of that name could not be read in the adapter. Only the key changes; everything else is as 0300 wrote it.
create or replace function move_thread_names(items jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', i.k, 'title', t.title, 'left', case when i.act is not null then d.from_board else t.board end)), '[]'::jsonb)
  from (
    select coalesce(x ->> 'act', x ->> 'thread') as k, safe_uuid(x ->> 'thread') as thread, safe_uuid(x ->> 'act') as act
    from jsonb_array_elements(case when jsonb_typeof(items) = 'array' then items else '[]'::jsonb end) with ordinality o(x, n) where n <= 50
  ) i
  join threads t on t.id = i.thread
  left join thread_departures d on d.act = i.act
$$;
