-- The digest and its role (supabase/migrations/0045_digest.sql; the system plan, Task 7): kayfabb_digest reads public
-- relations only, system_digest is owned by it, and the digest it returns is capped and ordered by heat. The poison:
-- a function given the role's ownership that reads a private fact is refused by the database, not by review.

do $$
declare
  t text;
  c text;
  a uuid; b uuid; cc uuid; boss uuid; acct_a uuid; acct_b uuid; acct_c uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid;
  pa uuid; pb uuid; pboss uuid; pquote uuid; pboss_prev uuid; pboss_old uuid; pedit uuid;
  fns text;
  d jsonb;
  denied boolean;
  bad text;
  -- The window is far from now: other files commit rows (the race tests) that a window around now would count.
  base timestamptz := '2040-06-01T12:00:00Z';
begin
  -- ---------------------------------------------------------------- what the role cannot reach ----
  if has_column_privilege('kayfabb_digest', 'characters', 'owner', 'select') then raise exception 'the digest role reads characters.owner'; end if;
  for c in select attname from pg_attribute where attrelid = 'characters'::regclass and attnum > 0 and not attisdropped loop
    if has_column_privilege('kayfabb_digest', 'characters', c, 'select') then raise exception 'the digest role reads characters.%', c; end if;
  end loop;
  for c in select attname from pg_attribute where attrelid = 'class_history'::regclass and attnum > 0 and not attisdropped loop
    if has_column_privilege('kayfabb_digest', 'class_history', c, 'select') then raise exception 'the digest role reads class_history.%', c; end if;
  end loop;
  for c in select attname from pg_attribute where attrelid = 'reactions'::regclass and attnum > 0 and not attisdropped loop
    if has_column_privilege('kayfabb_digest', 'reactions', c, 'select') then raise exception 'the digest role reads reactions.%', c; end if;
  end loop;
  foreach t in array array['accounts', 'ledger', 'staff_memory', 'meetings', 'move_bank', 'staff_profiles', 'acts', 'paid_votes', 'wallets'] loop
    if has_table_privilege('kayfabb_digest', t, 'select,insert,update,delete') then raise exception 'the digest role reaches %', t; end if;
  end loop;
  -- The queue (0049): the role reads these columns of queued_moves, one by one and no others. held_by (which admin held a move) and the
  -- meeting are not among them; a column added later is not readable until this list says so.
  select string_agg(attname, ', ' order by attname) into bad from pg_attribute
  where attrelid = 'queued_moves'::regclass and attnum > 0 and not attisdropped and has_column_privilege('kayfabb_digest', 'queued_moves', attname, 'select');
  if bad is distinct from 'demand, expires_at, go_live_at, held_at, id, kind, landed_act, params, staff, structural, why' then
    raise exception 'the digest role reads these columns of queued_moves: %', bad;
  end if;
  -- A handover (0088): the role reads its public columns, one by one, and not `note`, an error's words.
  select string_agg(attname, ', ' order by attname) into bad from pg_attribute
  where attrelid = 'season_handovers'::regclass and attnum > 0 and not attisdropped and has_column_privilege('kayfabb_digest', 'season_handovers', attname, 'select');
  if bad is distinct from 'arrival_act, boss, how, landed_at, outgoing, season' then
    raise exception 'the digest role reads these columns of season_handovers: %', bad;
  end if;
  if has_column_privilege('kayfabb_digest', 'queued_moves', 'held_by', 'select') then raise exception 'the digest role reads queued_moves.held_by'; end if;
  -- No my_* view: they read auth.uid(), and the role is nobody.
  select string_agg(relname, ', ') into bad from pg_class
  where relnamespace = 'public'::regnamespace and relkind in ('v', 'r') and relname like 'my\_%' and has_table_privilege('kayfabb_digest', oid, 'select');
  if bad is not null then raise exception 'the digest role reads % ', bad; end if;
  -- Select only, on everything it has.
  select string_agg(relname, ', ') into bad from pg_class
  where relnamespace = 'public'::regnamespace and relkind in ('v', 'r') and has_table_privilege('kayfabb_digest', oid, 'insert,update,delete,truncate,references,trigger');
  if bad is not null then raise exception 'the digest role writes %', bad; end if;
  -- The role's reach, whole: it cannot create in the schema (the owner change takes the grant and gives it back), no client
  -- role can become it, and the functions it may execute are exactly the twenty-one reviewed here: a new grant fails this.
  if has_schema_privilege('kayfabb_digest', 'public', 'create') then raise exception 'the digest role can create in public'; end if;
  foreach t in array array['anon', 'authenticated', 'service_role'] loop
    if pg_has_role(t, 'kayfabb_digest', 'member') then raise exception '% is a member of the digest role', t; end if;
  end loop;
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into fns from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('kayfabb_digest', p.oid, 'execute')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
  if fns is distinct from (select string_agg(x, ', ' order by x) from unnest(array[
      'setting(text)', 'span_interval(jsonb)', 'standings_season()', 'current_boss()', 'demand_progress(uuid)', 'demand_progress_or_error(uuid)',
      'system_digest(timestamp with time zone,timestamp with time zone)', 'staff_career(text)',
      -- The pool's signals (0088): the two functions it owns, and the folds it matches names with.
      'pool_signals(timestamp with time zone,timestamp with time zone)', 'pool_named(timestamp with time zone,timestamp with time zone)', 'name_skeleton(text)',
      -- The pool's thread read (0089) and the faces read that replaced its names read (0127): the two functions it owns.
      'pool_thread(uuid,integer,integer,uuid)', 'character_faces(jsonb)',
      -- A patrol's sample of the beat's recent posts (0110): the one function it owns, reading acts_public, characters_public and thread_list.
      'patrol_sample(uuid[],integer)',
      -- Pure predicates a CHECK calls, granted to PUBLIC by 0080 so a direct writer is not refused; each reads no table.
      'tip_keys_ok(text[])', 'update_payload_problem(jsonb)', 'reaches_hold(text[])', 'pronouns_hold(jsonb)',
      -- The same kind for a pack's pulls (0139): pure, reading no table.
      'pack_pulls_problem(jsonb)',
      -- What acts_public calls as its reader (0236): whether a version is hidden and what a payload shows of it, so a digest never reads a hidden version's words.
      'version_hidden(uuid,uuid)', 'quote_hidden(uuid)', 'public_payload(jsonb,boolean)']) x) then
    raise exception 'the functions the digest role may execute are not the reviewed twenty-one: %', fns;
  end if;
  if (select r.rolcanlogin or r.rolsuper or r.rolbypassrls from pg_roles r where r.rolname = 'kayfabb_digest') then raise exception 'the digest role logs in, is a superuser or bypasses row-level security'; end if;

  if (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'system_digest(timestamptz, timestamptz)'::regprocedure) is distinct from 'kayfabb_digest' then
    raise exception 'system_digest is not owned by kayfabb_digest';
  end if;
  if not (select prosecdef from pg_proc where oid = 'system_digest(timestamptz, timestamptz)'::regprocedure) then raise exception 'system_digest is not security definer'; end if;
  foreach t in array array['public', 'anon', 'authenticated'] loop
    if has_function_privilege(t, 'system_digest(timestamptz, timestamptz)', 'execute') then raise exception '% can execute system_digest', t; end if;
  end loop;
  if not has_function_privilege('service_role', 'system_digest(timestamptz, timestamptz)', 'execute') then raise exception 'service_role cannot execute system_digest'; end if;

  -- ------------------------------------------------------------------------------ the poison ----
  -- A function that came to be owned by the role and reads a private fact is refused by the database.
  -- (Granting create is what the owner change needs, and is undone with the transaction.)
  grant create on schema public to kayfabb_digest;
  create function poison_reactor() returns bigint language plpgsql security definer set search_path = public, pg_temp as
    $f$ begin return (select count(reactor_character) from reactions); end $f$;
  alter function poison_reactor() owner to kayfabb_digest;
  denied := false;
  begin perform poison_reactor(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a function owned by the digest role read reactions.reactor_character'; end if;
  create function poison_owner() returns bigint language plpgsql security definer set search_path = public, pg_temp as
    $f$ begin return (select count(owner) from characters); end $f$;
  alter function poison_owner() owner to kayfabb_digest;
  denied := false;
  begin perform poison_owner(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a function owned by the digest role read characters.owner'; end if;
  -- And one that reads the who-reacted account, and the class: the same.
  create function poison_class() returns bigint language plpgsql security definer set search_path = public, pg_temp as
    $f$ begin return (select count(class_key) from class_history); end $f$;
  alter function poison_class() owner to kayfabb_digest;
  denied := false;
  begin perform poison_class(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a function owned by the digest role read class_history'; end if;
  -- And one that reads what a patrol's sample must never need: the orders, the open visits, the patrols themselves (the sample reads public Acts only).
  create function poison_patrol() returns bigint language plpgsql security definer set search_path = public, pg_temp as
    $f$ begin return (select count(*) from patrols) + (select count(*) from visits_open) + (select count(*) from staff_orders); end $f$;
  alter function poison_patrol() owner to kayfabb_digest;
  denied := false;
  begin perform poison_patrol(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a function owned by the digest role read patrols, visits_open or staff_orders'; end if;
  drop function poison_reactor(), poison_owner(), poison_class(), poison_patrol();
  revoke create on schema public from kayfabb_digest;

  -- A later function given the role's ownership fails here, to be reviewed (0046 added the demand evaluator).
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_roles r on r.oid = p.proowner
  where r.rolname = 'kayfabb_digest' and p.oid::regprocedure::text <> all (array['system_digest(timestamp with time zone,timestamp with time zone)', 'demand_progress(uuid)', 'demand_progress_or_error(uuid)',
    'pool_signals(timestamp with time zone,timestamp with time zone)', 'pool_named(timestamp with time zone,timestamp with time zone)',
    'pool_thread(uuid,integer,integer,uuid)', 'character_faces(jsonb)', 'patrol_sample(uuid[],integer)']);
  if bad is not null then raise exception 'functions owned by the digest role that this file has not reviewed: %', bad; end if;
  if exists (select 1 from pg_class where relowner = 'kayfabb_digest'::regrole) or exists (select 1 from pg_type where typowner = 'kayfabb_digest'::regrole and typtype <> 'c') then
    raise exception 'the digest role owns an object that is not a function';
  end if;

  -- ------------------------------------------------------------------------------- the digest ----
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '2'), ('digestExcerptChars', '10')
  on conflict (key) do update set value = excluded.value;
  acct_a := tests.account('digest-a'); acct_b := tests.account('digest-b'); acct_c := tests.account('digest-c');
  a := tests.character(acct_a, 'Digest A'); b := tests.character(acct_b, 'Digest B'); cc := tests.character(acct_c, 'Digest C');
  insert into characters (name, staff, staff_kind, debuted_at) values ('Digest Boss', 'digest-boss', 'persona', now()) returning id into boss;
  update seasons set boss = 'digest-boss' where ends_at is null;

  t1 := tests.thread('Most posts'); t2 := tests.thread('Two threads alike'); t3 := tests.thread('Two threads alike'); t4 := tests.thread('Quiet');
  -- t2 and t3 tie on posts, so only controversy can rank them. The split reactions go to the one whose
  -- id sorts last, so that if controversy stopped counting, the id tie-break would put it last and fail.
  if t2 < t3 then t4 := t2; t2 := t3; t3 := t4; t4 := tests.thread('Quiet'); end if;
  perform tests.post(a, t1, 'abcdefghijklmnopqrstuvwxyz', base); perform tests.post(b, t1, 'Hello.', base); perform tests.post(a, t1, 'Hello.', base);
  pa := tests.post(a, t2, 'second thread first post', base); pb := tests.post(b, t2, 'Hello.', base);
  perform tests.post(a, t3, 'Hello.', base); perform tests.post(b, t3, 'Hello.', base);
  perform tests.post(a, t4, 'Hello.', base);
  -- t2 draws up and boo in equal number; t3 draws only up, the same number in all.
  insert into reaction_tallies (act, kind, count) values (pa, 'up', 3), (pa, 'boo', 3);
  insert into reaction_tallies (act, kind, count)
    select x.id, 'up', 6 from acts x where x.thread = t3 and x.kind = 'post' and x.seq = 1;
  -- A post that quotes another's, and the Boss's own Act with a tally.
  pquote := tests.act(b, 'post', t1, '{"body": "quoting"}', pa, base);
  perform set_config('kayfabb.staff_writer', 'on', true);
  pboss := tests.post(boss, t1, 'The Boss speaks.', base);
  -- The Boss's earlier Acts, in the quiet thread so t1's count stays put: one in the window before (it is read), one before that (it is not).
  pboss_prev := tests.post(boss, t4, 'Last window.', base - interval '2 hours');
  pboss_old := tests.post(boss, t4, 'Long ago.', base - interval '4 hours');
  perform set_config('kayfabb.staff_writer', '', true);
  insert into reaction_tallies (act, kind, count) values (pboss_prev, 'wow', 2), (pboss_old, 'wow', 9);
  -- Quotes, in t1: b quotes a three times in all (one above), a quotes the Boss twice, c quotes a and b once each, and a
  -- quotes itself three times, which would top the list if a self-quote counted. Four pairs are listed worth keeping; the cap is two.
  perform tests.act(b, 'post', t1, '{"body": "q"}', pa, base); perform tests.act(b, 'post', t1, '{"body": "q"}', pa, base);
  perform tests.act(a, 'post', t1, '{"body": "q"}', pboss, base); perform tests.act(a, 'post', t1, '{"body": "q"}', pboss, base);
  perform tests.act(cc, 'post', t1, '{"body": "q"}', pa, base); perform tests.act(cc, 'post', t1, '{"body": "q"}', pb, base);
  perform tests.act(a, 'post', t1, '{"body": "q"}', pa, base); perform tests.act(a, 'post', t1, '{"body": "q"}', pa, base); perform tests.act(a, 'post', t1, '{"body": "q"}', pa, base);
  -- A post edited after it was written: the excerpt shows the edit.
  pedit := tests.act(a, 'edit', t2, '{"body": "Edited!"}', pa, base + interval '1 minute');
  insert into reaction_tallies (act, kind, count) values (pboss, 'wow', 4), (pboss, 'meh', 1);
  insert into settlements (starts_at, ends_at, season) select base - interval '30 minutes', base - interval '10 minutes', id from seasons where ends_at is null;
  update standings set amount = 1000000 where character = a;
  update standings set amount = 2000000 where character = b;
  -- c stands at 0: three characters stand, the cap is two.

  perform tests.become_service();
  d := system_digest(base - interval '1 hour', base + interval '1 hour');
  perform tests.unbecome();

  if jsonb_array_length(d -> 'threads') > 3 or jsonb_array_length(d -> 'threads') <> 3 then raise exception 'the thread list is not capped at digestThreads: %', d -> 'threads'; end if;
  -- t1 has 14 posts (heat 7 an hour over the 2-hour window), t2 and t3 have 2 each, t4 one: t2 splits its reactions, so it outranks t3.
  if (select array_agg((e ->> 'thread')::uuid order by o) from jsonb_array_elements(d -> 'threads') with ordinality x(e, o)) is distinct from array[t1, t2, t3] then
    raise exception 'threads are ordered %', d -> 'threads';
  end if;
  if (d #>> '{threads,0,heat}')::numeric <> 7 then raise exception 'heat is posts an hour: %', d #> '{threads,0}'; end if;
  if (d #>> '{threads,0,length}')::integer <> 14 then raise exception 'length is the thread''s posts: %', d #> '{threads,0}'; end if;
  if (d #>> '{threads,1,controversy}')::numeric <> 0.5 or (d #>> '{threads,2,controversy}')::numeric <> 0 then raise exception 'controversy is %, %', d #>> '{threads,1,controversy}', d #>> '{threads,2,controversy}'; end if;
  if d -> 'moves' is distinct from '[]'::jsonb then raise exception 'moves are not empty: %', d -> 'moves'; end if;

  -- Excerpts: capped at digestExcerpts, each cut to digestExcerptChars, the most reacted first.
  if jsonb_array_length(d -> 'excerpts') <> 2 then raise exception 'excerpts are not capped at digestExcerpts: %', d -> 'excerpts'; end if;
  if exists (select 1 from jsonb_array_elements(d -> 'excerpts') e where char_length(e ->> 'text') > 10) then raise exception 'an excerpt is not cut: %', d -> 'excerpts'; end if;
  -- t3's first post and pa drew 6 each, the Boss's post 5: the two 6s fill the cap of 2, the 5 is left out.
  if (select array_agg((e ->> 'act')::uuid order by (e ->> 'act')) from jsonb_array_elements(d -> 'excerpts') e)
     is distinct from (select array_agg(x order by x) from unnest(array[pa, (select x.id from acts x where x.thread = t3 and x.seq = 1)]) x) then
    raise exception 'the first excerpt is not the most reacted: %', d -> 'excerpts';
  end if;
  -- The edited post's excerpt shows the edit, not the first text.
  if (select e ->> 'text' from jsonb_array_elements(d -> 'excerpts') e where (e ->> 'act')::uuid = pa) is distinct from 'Edited!' then raise exception 'an edited post''s excerpt is %', d -> 'excerpts'; end if;
  -- Quotes: capped at two, the most quoted first (b quotes a three times, a quotes the Boss twice); a's quotes of itself are not listed.
  if d -> 'quotes' is distinct from jsonb_build_array(jsonb_build_object('from', b, 'to', a, 'count', 3), jsonb_build_object('from', a, 'to', boss, 'count', 2)) then raise exception 'quotes are %', d -> 'quotes'; end if;
  -- The Boss's own Act, and its public tally.
  if jsonb_array_length(d -> 'bossReactions') <> 2 or (d #>> '{bossReactions,0,total}')::integer <> 5 or (d #>> '{bossReactions,0,tally,wow}')::integer <> 4 then
    raise exception 'reactions to the Boss are %', d -> 'bossReactions';
  end if;
  -- The window before is read too (the Boss's post two hours back, 2 reactions), and the one before that is not (9).
  if (d #>> '{bossReactions,1,act}')::uuid <> pboss_prev or (d #>> '{bossReactions,1,total}')::integer <> 2 or exists (select 1 from jsonb_array_elements(d -> 'bossReactions') e where (e ->> 'act')::uuid = pboss_old) then
    raise exception 'the Boss''s earlier reactions are %', d -> 'bossReactions';
  end if;
  -- Standings moved: a settlement fell in the window, so the public standings top, best first.
  if (d #>> '{standings,0,character}')::uuid <> b or (d #>> '{standings,0,amount}')::integer <> 2000000 or jsonb_array_length(d -> 'standings') <> 2 then raise exception 'standings are %', d -> 'standings'; end if;
  -- The standings are capped at two: c, standing at 0, is the third and is left out.
  if jsonb_array_length(d -> 'standings') <> 2 or exists (select 1 from jsonb_array_elements(d -> 'standings') e where (e ->> 'character')::uuid = cc) then raise exception 'the standings are not capped: %', d -> 'standings'; end if;
  -- The characters named are exactly those the lists name: a and b (standings, excerpts, quotes) and the Boss (quoted), flagged staff;
  -- c is named by no listed row, so it is not here.
  if (select array_agg((e ->> 'id')::uuid order by (e ->> 'id')::uuid) from jsonb_array_elements(d -> 'characters') e)
       is distinct from (select array_agg(x order by x) from unnest(array[a, b, boss]) x)
     or not (select bool_and(e ->> 'name' is not null) from jsonb_array_elements(d -> 'characters') e)
     or (select (e ->> 'staff')::boolean from jsonb_array_elements(d -> 'characters') e where (e ->> 'id')::uuid = boss) is distinct from true
     or exists (select 1 from jsonb_array_elements(d -> 'characters') e where (e ->> 'id')::uuid <> boss and (e ->> 'staff')::boolean) then
    raise exception 'characters are %', d -> 'characters';
  end if;
  -- No settlement in the window: no standings.
  perform tests.become_service();
  d := system_digest(base + interval '2 hours', base + interval '3 hours');
  perform tests.unbecome();
  if d -> 'standings' <> '[]'::jsonb or d -> 'threads' <> '[]'::jsonb then raise exception 'an empty window is not empty: %', d; end if;
  -- No one else may call it.
  foreach t in array array['anon', 'authenticated'] loop
    perform set_config('role', t, true);
    denied := false;
    begin perform system_digest(now() - interval '1 hour', now()); exception when insufficient_privilege then denied := true; end;
    perform tests.unbecome();
    if not denied then raise exception '% can call system_digest', t; end if;
  end loop;
end $$;
