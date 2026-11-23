-- The digest's conversations (supabase/migrations/0415_chattier_staff.sql, section on system_digest; docs/plans/2026-11-22-chattier-staff-plan.md, Task 6; the design's section 5).
-- system_digest lists the window's conversations: a persona's turns in one thread, ranked by the public reaction total on the turns then by their number, at most `digestConversations`, none whose turns fall
-- outside the window. Each names its thread, persona, the characters whose replies the turns answered (at most 8), the turns, the reactions, and the hottest turn with the reply it quoted, cut to
-- `digestExcerptChars`. The characters it names join the digest's `characters`. The digest's role reads the two tables and nothing private.

create function pg_temp.root(k text, th uuid, at timestamptz) returns uuid language plpgsql as $$
declare p uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  p := tests.post((select id from characters where staff = k), th, 'An opening from the persona.', at);
  perform set_config('kayfabb.staff_writer', '', true);
  return p;
end $$;

-- A turn answering `replies` (the first is quoted): the persona's post, its pool_turns row at `at`, the answers, and `n` reactions on the post.
create function pg_temp.turn(k text, th uuid, body text, replies uuid[], at timestamptz, n integer) returns uuid language plpgsql as $$
declare sid bigint; p uuid; tid bigint; r uuid;
begin
  insert into staff_sessions (day, staff, starts_at, ends_at) values ((at at time zone 'UTC')::date, k, at - interval '30 minutes', at + interval '30 minutes') returning id into sid;
  perform set_config('kayfabb.staff_writer', 'on', true);
  p := tests.post((select id from characters where staff = k), th, body, at);
  perform set_config('kayfabb.staff_writer', '', true);
  insert into pool_turns (day, staff, session, thread, post_act, quoting, at) values ((at at time zone 'UTC')::date, k, sid, th, p, replies[1], at) returning id into tid;
  foreach r in array replies loop insert into pool_answered (reply, turn) values (r, tid); end loop;
  if n > 0 then insert into reaction_tallies (act, kind, count) values (p, 'up', n); end if;
  return p;
end $$;

do $$
declare
  base timestamptz := '2041-03-01T12:00:00Z';
  a uuid; b uuid; c uuid; many uuid[] := '{}'; x uuid; i integer;
  tf uuid; rf uuid; sid bigint; plan text; ln record;
  ta uuid; tb uuid; tc uuid; td uuid; te uuid;
  ra uuid; rb uuid; rc uuid; rd uuid; re uuid; ra2 uuid; rr uuid[];
  rootp uuid;
  d jsonb; convs jsonb; denied boolean; leaked text;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values
    ('Dg Mod One', 'dg-mod1', 'persona', now()), ('Dg Mod Two', 'dg-mod2', 'persona', now()), ('Dg Mod Three', 'dg-mod3', 'persona', now());
  a := tests.character(tests.account('dg-a'), 'Dg Ann'); b := tests.character(tests.account('dg-b'), 'Dg Bo'); c := tests.character(tests.account('dg-c'), 'Dg Cy');
  insert into settings (key, value) values ('digestExcerptChars', '12'), ('digestExcerpts', '2'), ('digestThreads', '3'), ('digestConversations', '2')
  on conflict (key) do update set value = excluded.value;
  ta := tests.thread('Pie quarrel'); tb := tests.thread('Hat debate'); tc := tests.thread('Long haul'); td := tests.thread('Too late'); te := tests.thread('Crowded');

  -- A: persona 1, two turns, 3 reactions in all (2 on the hotter turn), answering Ann and Bo.
  rootp := pg_temp.root('dg-mod1', ta, base - interval '1 day');
  ra := tests.act(a, 'post', ta, '{"body": "Ann says the pie is stale and she is furious"}', rootp, base - interval '50 minutes');
  rb := tests.act(b, 'post', ta, '{"body": "Bo says it was never fresh"}', rootp, base - interval '40 minutes');
  perform pg_temp.turn('dg-mod1', ta, 'Quiet turn, one reaction.', array[rb], base - interval '30 minutes', 1);
  ra2 := tests.act(a, 'post', ta, '{"body": "Ann again, louder"}', rootp, base - interval '20 minutes');
  perform pg_temp.turn('dg-mod1', ta, 'The hot turn answers Ann at some length', array[ra, ra2], base - interval '10 minutes', 2);
  -- B: persona 2, one turn, 5 reactions.
  rootp := pg_temp.root('dg-mod2', tb, base - interval '1 day');
  rc := tests.act(c, 'post', tb, '{"body": "Cy on hats"}', rootp, base - interval '25 minutes');
  perform pg_temp.turn('dg-mod2', tb, 'Hats are fine.', array[rc], base - interval '5 minutes', 5);
  -- C: persona 3, three turns, 3 reactions: ties A on reactions and wins on turns.
  rootp := pg_temp.root('dg-mod3', tc, base - interval '1 day');
  for i in 1..3 loop
    rd := tests.act(a, 'post', tc, jsonb_build_object('body', 'Ann long haul ' || i), rootp, base - interval '3 hours' + i * interval '1 minute');
    perform pg_temp.turn('dg-mod3', tc, 'Haul turn ' || i, array[rd], base + i * interval '1 minute', case i when 1 then 3 else 0 end);
  end loop;
  -- D: a turn after the window, with the most reactions of all.
  rootp := pg_temp.root('dg-mod1', td, base - interval '1 day');
  re := tests.act(b, 'post', td, '{"body": "Too late"}', rootp, base + interval '2 hours');
  perform pg_temp.turn('dg-mod1', td, 'After the window.', array[re], base + interval '3 hours', 99);
  -- E: persona 2, one turn answering ten different characters' replies, 1 reaction.
  rootp := pg_temp.root('dg-mod2', te, base - interval '1 day');
  for i in 1..10 loop
    x := tests.character(tests.account('dg-many-' || i), 'Dg Many ' || i);
    many := many || x;
    rr := rr || tests.act(x, 'post', te, jsonb_build_object('body', 'Crowd ' || i), rootp, base - interval '15 minutes');
  end loop;
  perform pg_temp.turn('dg-mod2', te, 'A turn for the crowd.', rr, base + interval '10 minutes', 1);

  perform tests.become_service();
  d := system_digest(base - interval '1 hour', base + interval '1 hour');
  perform tests.unbecome();
  convs := d -> 'conversations';
  if jsonb_typeof(convs) is distinct from 'array' then raise exception 'the digest has no conversations list: %', d::text; end if;
  -- At most the setting (2), in rank order: B (5 reactions), then C (3 reactions, 3 turns) before A (3 reactions, 2 turns); D is outside the window.
  if jsonb_array_length(convs) is distinct from 2 then raise exception 'the setting is 2, the digest lists %', jsonb_array_length(convs); end if;
  if (convs -> 0 ->> 'thread')::uuid is distinct from tb or (convs -> 1 ->> 'thread')::uuid is distinct from tc then raise exception 'the rank is wrong: %', convs::text; end if;
  if convs -> 0 -> 'persona' ->> 'staff' is distinct from 'dg-mod2' or (convs -> 0 -> 'persona' ->> 'character')::uuid is distinct from (select id from characters where staff = 'dg-mod2') then
    raise exception 'the persona is wrong: %', convs -> 0;
  end if;
  if convs -> 0 ->> 'title' is distinct from 'Hat debate' then raise exception 'the title is wrong: %', convs -> 0; end if;
  if (convs -> 0 ->> 'turns')::integer is distinct from 1 or (convs -> 0 ->> 'reactions')::integer is distinct from 5 then raise exception 'turns or reactions wrong: %', convs -> 0; end if;
  if (convs -> 1 ->> 'turns')::integer is distinct from 3 or (convs -> 1 ->> 'reactions')::integer is distinct from 3 then raise exception 'turns or reactions wrong: %', convs -> 1; end if;
  if convs -> 0 -> 'with' is distinct from jsonb_build_array(jsonb_build_object('id', c, 'name', 'Dg Cy')) then raise exception 'who it answered is wrong: %', convs -> 0 -> 'with'; end if;
  -- A larger setting adds A, and keeps the order; D never appears.
  update settings set value = '5' where key = 'digestConversations';
  perform tests.become_service(); d := system_digest(base - interval '1 hour', base + interval '1 hour'); perform tests.unbecome();
  convs := d -> 'conversations';
  if (select jsonb_agg((cv ->> 'thread')::uuid) from jsonb_array_elements(convs) cv) is distinct from jsonb_build_array(tb, tc, ta, te) then
    raise exception 'with the setting at 5 the conversations are % (B, C, A, E expected, D outside the window)', convs::text;
  end if;
  -- A: its hottest turn and the reply it quoted, each cut to 12 characters, the reply's author named; who it answered, Ann and Bo.
  if convs -> 2 -> 'exchange' ->> 'text' is distinct from 'The hot turn' or (convs -> 2 -> 'exchange' ->> 'cut')::boolean is distinct from true then raise exception 'the hot turn is wrong: %', convs -> 2 -> 'exchange'; end if;
  if convs -> 2 -> 'exchange' -> 'reply' ->> 'text' is distinct from 'Ann says the' or (convs -> 2 -> 'exchange' -> 'reply' ->> 'character')::uuid is distinct from a then
    raise exception 'the quoted reply is wrong: %', convs -> 2 -> 'exchange';
  end if;
  if (select array_agg((w ->> 'id')::uuid order by w ->> 'name') from jsonb_array_elements(convs -> 2 -> 'with') w) is distinct from array[a, b] then raise exception 'A answered Ann and Bo, got %', convs -> 2 -> 'with'; end if;
  if (convs -> 2 ->> 'reactions')::integer is distinct from 3 or (convs -> 2 ->> 'turns')::integer is distinct from 2 then raise exception 'A counts are wrong: %', convs -> 2; end if;
  -- E: ten characters answered, eight listed.
  if jsonb_array_length(convs -> 3 -> 'with') is distinct from 8 then raise exception 'at most 8 characters, got %', jsonb_array_length(convs -> 3 -> 'with'); end if;
  -- The characters it names are in the digest's list: each persona, each answered and each reply's author.
  for leaked in
    select n from (select (cv -> 'persona' ->> 'character') as n from jsonb_array_elements(convs) cv
                   union select w ->> 'id' from jsonb_array_elements(convs) cv, jsonb_array_elements(cv -> 'with') w
                   union select cv -> 'exchange' -> 'reply' ->> 'character' from jsonb_array_elements(convs) cv) u
    where n is not null and n not in (select ch ->> 'id' from jsonb_array_elements(d -> 'characters') ch)
  loop raise exception 'the conversations name % who is not in the characters list', leaked; end loop;
  -- A window with no turn in it lists none.
  perform tests.become_service(); d := system_digest(base + interval '5 hours', base + interval '6 hours'); perform tests.unbecome();
  if d -> 'conversations' is distinct from '[]'::jsonb then raise exception 'a window with no turn has conversations: %', d -> 'conversations'; end if;
  -- A setting of 0 lists none; a missing one reads the default (6), and the digest still builds.
  update settings set value = '0' where key = 'digestConversations';
  perform tests.become_service(); d := system_digest(base - interval '1 hour', base + interval '1 hour'); perform tests.unbecome();
  if d -> 'conversations' is distinct from '[]'::jsonb then raise exception 'a setting of 0 lists conversations'; end if;
  delete from settings where key = 'digestConversations';
  -- Five more in-window conversations make nine in all, so the default cap of 6 is what shows.
  for i in 1..5 loop
    tf := tests.thread('Filler ' || i);
    rootp := pg_temp.root('dg-mod1', tf, base - interval '1 day');
    rf := tests.act(a, 'post', tf, '{"body": "Filler reply"}', rootp, base - interval '20 minutes');
    perform pg_temp.turn('dg-mod1', tf, 'Filler turn ' || i, array[rf], base - (i * 7 + 1) * interval '1 minute', 0);
  end loop;
  perform tests.become_service(); d := system_digest(base - interval '1 hour', base + interval '1 hour'); perform tests.unbecome();
  if jsonb_array_length(d -> 'conversations') is distinct from 6 then raise exception 'a missing setting reads the default of 6 (of 9 in the window): %', jsonb_array_length(d -> 'conversations'); end if;
  -- The window read is served by an index, not a scan of every turn ever written: 3000 turns on other days, each with a post of its own, then an explain of the digest's turn read and a look at the function's text.
  insert into staff_sessions (day, staff, starts_at, ends_at) values ((base - interval '400 days')::date, 'dg-mod1', base - interval '400 days', base - interval '400 days' + interval '1 hour') returning id into sid;
  set local session_replication_role = replica;
  insert into acts (character, kind, thread, payload, seq, created_at)
  select (select id from characters where staff = 'dg-mod1'), 'post', ta, jsonb_build_object('body', 'Old turn ' || g), 900000 + g, base - interval '400 days' + g * interval '1 minute' from generate_series(1, 3000) g;
  insert into pool_turns (day, staff, session, thread, post_act, quoting, at)
  select (base - interval '400 days' + o.seq * interval '1 minute')::date, 'dg-mod1', sid, ta, o.id, o.id, base - interval '400 days' + (o.seq - 900000) * interval '1 minute'
  from acts o where o.seq > 900000 and o.thread = ta;
  set local session_replication_role = origin;
  analyze pool_turns;
  plan := '';
  for ln in execute format('explain select t.id from pool_turns t where t.at >= %L and t.at < %L and t.day >= ((%L::timestamptz) at time zone ''UTC'')::date - 1 and t.day <= ((%L::timestamptz) at time zone ''UTC'')::date', base - interval '1 hour', base + interval '1 hour', base - interval '1 hour', base + interval '1 hour') loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan ~ 'Seq Scan on pool_turns' or plan not like '%pool_turns_day%' then raise exception 'the window read of the turns scans every turn: %', plan; end if;
  if pg_get_functiondef('system_digest(timestamptz, timestamptz)'::regprocedure) !~ 't\.day\s*>=' then raise exception 'system_digest does not bound the turns by day, so the day index cannot serve its read'; end if;
  -- The role reads the two tables, selecting only, and the function stays the service role's.
  if not has_table_privilege('kayfabb_digest', 'pool_turns', 'select') or not has_table_privilege('kayfabb_digest', 'pool_answered', 'select') then raise exception 'the digest role cannot read the turns'; end if;
  if has_table_privilege('kayfabb_digest', 'pool_turns', 'insert,update,delete') or has_table_privilege('kayfabb_digest', 'pool_answered', 'insert,update,delete') then raise exception 'the digest role writes the turns'; end if;
  if (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'system_digest(timestamptz, timestamptz)'::regprocedure) is distinct from 'kayfabb_digest' then raise exception 'system_digest lost its owner'; end if;
  foreach leaked in array array['anon', 'authenticated', 'public'] loop
    if has_function_privilege(case leaked when 'public' then 'anon' else leaked end, 'system_digest(timestamptz, timestamptz)', 'execute') then raise exception '% can execute system_digest', leaked; end if;
  end loop;
  if not has_function_privilege('service_role', 'system_digest(timestamptz, timestamptz)', 'execute') then raise exception 'service_role cannot execute system_digest'; end if;
end $$;
