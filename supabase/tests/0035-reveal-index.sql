-- A profile's reveals are read without scanning every Act (the screens' web plan, review of Task 12):
-- the adapter's characterReveals asks acts_public for kind = 'reveal' and payload->>'character' = the
-- character, newest first. acts_reveal_character (supabase/migrations/0032_reveal_index.sql) serves that
-- exact filter through the view, so a profile view costs the character's reveals and not the board's
-- history. The plan is EXPLAINed with the sequential scan off, as in 0034: on a table this small it would
-- be scanned whatever the indexes were, so the question is whether the index can be used at all.
do $$
declare
  ann uuid := tests.account('ri-ann');
  a uuid := tests.character(ann, 'Ri Ann');
  th uuid := tests.thread('Reveals');
  ln record;
  plan text := '';
  got integer;
begin
  perform tests.post(a, th, 'One');
  perform tests.act(null, 'reveal', th, jsonb_build_object('season', 1, 'character', a, 'name', 'Ri Ann'));
  perform tests.act(null, 'reveal', th, jsonb_build_object('season', 2, 'character', a, 'name', 'Ri Ann'));
  perform tests.act(null, 'reveal', th, jsonb_build_object('season', 2, 'character', gen_random_uuid(), 'name', 'Someone else'));
  -- The adapter's query, as PostgREST writes it: .eq('kind', 'reveal').eq('payload->>character', id).order('created_at', desc).limit(50).
  set local enable_seqscan = off;
  for ln in execute format('explain select * from acts_public where kind = %L and (payload ->> %L) = %L order by created_at desc limit 50', 'reveal', 'character', a::text) loop
    plan := plan || E'\n' || ln."QUERY PLAN";
  end loop;
  if plan not like '%acts_reveal_character%' then raise exception 'a character''s reveals are not read from acts_reveal_character: %', plan; end if;
  set local enable_seqscan = on;
  select count(*) into got from acts_public where kind = 'reveal' and (payload ->> 'character') = a::text;
  if got is distinct from 2 then raise exception 'the character''s reveals: %', got; end if;
end $$;
