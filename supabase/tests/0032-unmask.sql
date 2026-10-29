-- A class revealed by its own player (supabase/migrations/0027_unmask.sql): an `unmask` Act, the
-- character's own, naming the class held at that moment and nothing else; `class_reveals` and
-- `turns_announced` read only Acts. The class reveal plan, Task 1.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---- A reveal names the class held at that moment, in a thread its player chose ----
do $$
declare
  ann uuid := tests.account('unmask-ann');
  a uuid := tests.character(ann, 'Unmasked', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Where masks come off');
  said jsonb;
  later jsonb;
begin
  perform tests.become(ann);
  said := unmask(a, t, 'You knew.');
  perform tests.unbecome();
  if said ->> 'kind' is distinct from 'unmask' or (said ->> 'character')::uuid is distinct from a or (said ->> 'thread')::uuid is distinct from t then
    raise exception 'a reveal is the character''s own Act in the thread chosen: %', said;
  end if;
  if said -> 'payload' is distinct from '{"class": "alpha", "message": "You knew.", "via": "act"}'::jsonb then raise exception 'a reveal names the class held, and its words: %', said -> 'payload'; end if;
  if said ->> 'target_act_id' is not null or said ->> 'seq' is null then raise exception 'a reveal takes its place in the thread and points at nothing: %', said; end if;
  -- A Turn takes effect; the next reveal names the class held then, and the first still says what it said.
  insert into class_history (character, class_key, started_at) values (a, 'beta', now() - interval '1 day');
  perform tests.become(ann);
  later := unmask(a, t, '');
  perform tests.unbecome();
  if later -> 'payload' ->> 'class' is distinct from 'beta' then raise exception 'a reveal names the class held at that moment: %', later; end if;
  if (select payload ->> 'class' from acts where id = (said ->> 'id')::uuid) is distinct from 'alpha' then raise exception 'an earlier reveal still says what it said'; end if;
  -- Read by any signed-in player, as every Act is.
  perform tests.become(tests.account('unmask-reader'));
  if (select count(*) from class_reveals where character = a) is distinct from 2::bigint then raise exception 'class_reveals holds both reveals'; end if;
  if (select (class, via, at, thread) from class_reveals where act = (said ->> 'id')::uuid) is distinct from ('alpha'::text, 'act'::text, now(), t) then
    raise exception 'class_reveals dates a reveal and names its class, how it was made, and its thread';
  end if;
  perform tests.unbecome();
end $$;

-- ---- What a reveal cannot be ----
do $$
declare
  ann uuid := tests.account('unmask-refused-ann');
  bob uuid := tests.account('unmask-refused-bob');
  a uuid := tests.character(ann, 'Refused Unmasker', 'alpha', now() - interval '60 days');
  b uuid := tests.character(bob, 'Not Yours', 'alpha', now() - interval '60 days');
  waiting uuid;
  t uuid := tests.thread('Refusals');
  on_system uuid;
begin
  insert into threads (board, title) values (system_board(), 'The System speaks') returning id into on_system;
  perform tests.become(ann);
  waiting := (create_character('Not Yet Here', 'alpha') ->> 'id')::uuid;
  if pg_temp.refusal(format('select unmask(%L, %L, %L)', b, t, '')) is distinct from 'you do not play that character' then raise exception 'another player''s character was unmasked'; end if;
  if pg_temp.refusal(format('select unmask(%L, %L, %L)', waiting, t, '')) is distinct from 'that character debuts at the next settlement' then raise exception 'a waiting character was unmasked'; end if;
  if pg_temp.refusal(format('select unmask(%L, %L, %L)', a, on_system, '')) is distinct from 'only The System posts here; spin a thread from what it said' then raise exception 'a reveal was made on The System''s board'; end if;
  if pg_temp.refusal(format('select unmask(%L, %L, %L)', a, gen_random_uuid(), '')) is distinct from 'there is no such thread' then raise exception 'a reveal in no thread'; end if;
  if pg_temp.refusal(format('select unmask(%L, %L, %L)', a, t, repeat('x', 201))) is distinct from 'the message is at most 200 characters' then raise exception 'a message of 201 characters was taken'; end if;
  if pg_temp.refusal(format('select unmask(%L, %L, %L)', a, t, repeat('🔥', 200))) is not null then raise exception 'a message of 200 characters, counted as characters, is taken'; end if;
  if pg_temp.refusal(format('select unmask(%L, %L, null)', a, t)) is not null then raise exception 'no message is an empty one'; end if;
  perform tests.unbecome();
  update characters set retired_at = now() where id = a;
  perform tests.become(ann);
  if pg_temp.refusal(format('select unmask(%L, %L, %L)', a, t, '')) is distinct from 'that character is retired; an admin can restore it' then raise exception 'a retired character was unmasked'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  if pg_temp.refusal(format('select unmask(%L, %L, %L)', b, t, '')) is distinct from 'permission denied for function unmask' then raise exception 'a visitor unmasked a character'; end if;
  perform tests.unbecome();
  -- The table holds a writer that forgets: an unmask names the class its character holds then, and points at nothing.
  if pg_temp.refusal(format('select tests.act(%L, %L, %L, %L)', b, 'unmask', t, '{"class": "beta", "message": "", "via": "act"}')) is distinct from 'an unmask names the class its character holds' then raise exception 'an unmask naming a class not held was written'; end if;
  if coalesce(pg_temp.refusal(format('select tests.act(%L, %L, %L, %L, %L)', b, 'unmask', t, '{"class": "alpha", "message": "", "via": "act"}', tests.post(b, t))), '') not like '%"acts_unmask_untargeted"' then raise exception 'an unmask pointing at an Act was written'; end if;
  if coalesce(pg_temp.refusal(format('select tests.act(%L, %L, %L, %L)', b, 'unmask', t, '{"class": "alpha", "message": "", "via": "rumor"}')), '') not like '%"acts_unmask_said"' then raise exception 'an unmask made no known way was written'; end if;
  if coalesce(pg_temp.refusal(format('select tests.act(%L, %L, %L, %L)', b, 'unmask', t, '{"class": "alpha", "message": ""}')), '') not like '%"acts_unmask_said"' then raise exception 'an unmask saying nothing of how it was made was written'; end if;
  if coalesce(pg_temp.refusal(format('select tests.act(%L, %L, %L, %L)', b, 'unmask', t, jsonb_build_object('class', 'alpha', 'message', repeat('x', 201), 'via', 'act'))), '') not like '%"acts_unmask_said"' then raise exception 'an unmask of 201 characters was written'; end if;
end $$;

-- ---- A reveal made while a Turn is pending names the class held, and keeps its date after the tally ----
do $$
declare
  ann uuid := tests.account('unmask-pending');
  a uuid := tests.character(ann, 'Pending Unmasker', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Mid-Turn');
  said jsonb;
begin
  perform tests.become(ann);
  perform turn(a, 'beta', 'silent');
  said := unmask(a, t, 'Still this.');
  perform tests.unbecome();
  if said -> 'payload' ->> 'class' is distinct from 'alpha' then raise exception 'a reveal while a Turn waits names the class held: %', said; end if;
  perform masks_change(now() + interval '1 minute');
  if (select class_key from class_now(a, 'infinity')) is distinct from 'beta' then raise exception 'the Turn took effect at the tally'; end if;
  if (select (class, at) from class_reveals where act = (said ->> 'id')::uuid) is distinct from ('alpha'::text, now()) then raise exception 'after the tally the reveal still says alpha, dated to its moment'; end if;
  -- And the silent Turn is in neither view.
  if exists (select 1 from turns_announced where character = a) then raise exception 'a silent Turn was announced'; end if;
  if (select count(*) from class_reveals where character = a) is distinct from 1::bigint then raise exception 'a silent Turn wrote a reveal'; end if;
end $$;

-- ---- Nothing in either view comes from class_history ----
do $$
declare
  ann uuid := tests.account('unmask-quiet');
  quiet uuid := tests.character(ann, 'Says Nothing', 'alpha', now() - interval '60 days');
  loud uuid := tests.character(ann, 'Says It Turned', 'alpha', now() - interval '60 days');
  told uuid := tests.character(ann, 'Says What It Was', 'alpha', now() - interval '60 days');
  tally uuid;
begin
  -- A class held and a silent Turn taken, and nothing made public.
  insert into class_history (character, class_key, started_at) values (quiet, 'beta', now() - interval '2 days');
  perform tests.become(ann);
  perform turn(loud, 'beta', 'announced');
  perform turn(told, 'beta', 'revealed');
  perform tests.unbecome();
  tally := masks_change(now() + interval '1 minute');
  perform tests.become(tests.account('unmask-quiet-reader'));
  if exists (select 1 from class_reveals where character = quiet) or exists (select 1 from turns_announced where character = quiet) then
    raise exception 'a character whose player made nothing public is in a view of what was made public';
  end if;
  if (select (act, at, was, since) from turns_announced where character = loud) is distinct from (tally, now() + interval '1 minute', null::text, null::timestamptz) then
    raise exception 'an announced Turn is dated at its tally and names no old class: %', (select to_jsonb(x) from turns_announced x where character = loud);
  end if;
  if (select (at, was) from turns_announced where character = told) is distinct from (now() + interval '1 minute', 'alpha'::text) then
    raise exception 'a Turn announced with its old class names it: %', (select to_jsonb(x) from turns_announced x where character = told);
  end if;
  perform tests.unbecome();
  -- Their columns are these and no others: no class_key, no started_at, no player.
  if (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'class_reveals') is distinct from 'act,character,class,at,via,thread' then
    raise exception 'class_reveals has the columns %', (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'class_reveals');
  end if;
  if (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'turns_announced') is distinct from 'act,character,at,was,since' then
    raise exception 'turns_announced has the columns %', (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'turns_announced');
  end if;
  -- A visitor reads neither, as a visitor reads no Act.
  perform tests.become_anon();
  if pg_temp.refusal('select 1 from class_reveals') is null or pg_temp.refusal('select 1 from turns_announced') is null then raise exception 'a visitor read a view of reveals'; end if;
  perform tests.unbecome();
end $$;

-- ---- A postbit's read is an index lookup by character, whatever the size of the board ----
create function pg_temp.plan_of(q text) returns text language plpgsql as $$
declare line text; out text := '';
begin
  for line in execute 'explain ' || q loop out := out || line || E'\n'; end loop;
  return out;
end $$;

-- At a busy instance's shape, thousands of tallies among many more posts, analyzed as the database
-- would be, and with a sequential scan priced out (standing in for an acts table far larger than a
-- test can fill): a page of postbits reads class_reveals by its characters, and turns_announced
-- probes the tallies' index for each, never reading every tally. Rolled back with the file.
do $$
declare
  in_thread uuid;
  poster uuid := tests.character(tests.account('busy-poster'), 'Busy Poster');
  posts_in uuid := tests.thread('A busy board');
  page text := format('(%L, %L)', gen_random_uuid(), gen_random_uuid());
  p text;
begin
  insert into threads (board, title) values (system_board(), 'A busy year of tallies') returning id into in_thread;
  insert into acts (character, kind, thread, payload)
  select null, 'tally', in_thread, jsonb_build_object('season', 1, 'part', 1, 'of', 1, 'debuts', '[]'::jsonb,
    'turns', (select jsonb_agg(jsonb_build_object('character', gen_random_uuid(), 'name', 'Mask ' || g || '.' || k, 'loudness', 'announced')) from generate_series(1, 20) k))
  from generate_series(1, 3000) g;
  insert into acts (character, kind, thread, payload) select poster, 'post', posts_in, '{"body": "Again."}' from generate_series(1, 20000);
  analyze acts;
  set local enable_seqscan = off;
  p := pg_temp.plan_of('select * from class_reveals where character in ' || page);
  if p !~ 'Index Cond: \("character" = ANY' then raise exception 'class_reveals for a page of characters is no probe by character:%', E'\n' || p; end if;
  p := pg_temp.plan_of('select * from turns_announced where character in ' || page);
  if p !~ 'Bitmap Index Scan on acts_tally_turns' then raise exception 'turns_announced for a page of characters is no probe of acts_tally_turns:%', E'\n' || p; end if;
end $$;

-- ---- The settlement and the estimate read a reveal as its character's Act ----
do $$
declare
  ann uuid := tests.account('unmask-settled');
  bob uuid := tests.account('unmask-settled-bob');
  a uuid := tests.character(ann, 'Settled Unmasker', 'alpha', now() - interval '60 days');
  b uuid := tests.character(bob, 'Cheers It', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Read by the settlement');
  u uuid;
  input jsonb;
  open_from timestamptz;
begin
  perform tests.become(ann);
  u := (unmask(a, t, '') ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(bob);
  perform react(u, b, 'up');
  perform tests.unbecome();
  input := settlement_input(now() - interval '1 hour', now() + interval '1 hour');
  if not exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'id' = u::text and x ->> 'kind' = 'unmask' and x ->> 'character' = a::text) then raise exception 'the settlement reads a reveal as its character''s Act: %', input -> 'acts'; end if;
  if not exists (select 1 from jsonb_array_elements(input -> 'reactions') x where x ->> 'act' = u::text) or input -> 'systemActs' @> to_jsonb(array[u]) then raise exception 'a reaction to a reveal is settled, and the reveal is no System Act'; end if;
  -- The estimate's window opens where the last settlement ended, which an earlier file's committed
  -- race may have put past now: a reveal written inside it.
  open_from := coalesce((select max(ends_at) from settlements), now());
  u := (write_unmask(a, t, 'act', open_from + interval '1 minute') ->> 'id')::uuid;
  input := estimate_input(ann, open_from + interval '1 hour');
  if not exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'id' = u::text and x ->> 'kind' = 'unmask') then raise exception 'the estimate reads a reveal as its character''s Act: %', input -> 'acts'; end if;
end $$;
