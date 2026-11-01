-- The digest and its role (supabase/migrations/0044_digest.sql; the system plan, Task 7): kayfabb_digest reads public
-- relations only, system_digest is owned by it, and the digest it returns is capped and ordered by heat. The poison:
-- a function given the role's ownership that reads a private fact is refused by the database, not by review.

do $$
declare
  t text;
  c text;
  a uuid; b uuid; boss uuid; acct_a uuid; acct_b uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid;
  pa uuid; pb uuid; pboss uuid; pquote uuid;
  d jsonb;
  titles text[];
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
  -- No my_* view: they read auth.uid(), and the role is nobody.
  select string_agg(relname, ', ') into bad from pg_class
  where relnamespace = 'public'::regnamespace and relkind in ('v', 'r') and relname like 'my\_%' and has_table_privilege('kayfabb_digest', oid, 'select');
  if bad is not null then raise exception 'the digest role reads % ', bad; end if;
  -- Select only, on everything it has.
  select string_agg(relname, ', ') into bad from pg_class
  where relnamespace = 'public'::regnamespace and relkind in ('v', 'r') and has_table_privilege('kayfabb_digest', oid, 'insert,update,delete,truncate,references,trigger');
  if bad is not null then raise exception 'the digest role writes %', bad; end if;
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
  drop function poison_reactor(), poison_owner(), poison_class();
  revoke create on schema public from kayfabb_digest;

  -- A later function given the role's ownership fails here, to be reviewed (Task 8 adds the demand evaluator).
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_roles r on r.oid = p.proowner
  where r.rolname = 'kayfabb_digest' and p.oid::regprocedure::text <> all (array['system_digest(timestamp with time zone,timestamp with time zone)']);
  if bad is not null then raise exception 'functions owned by the digest role that this file has not reviewed: %', bad; end if;
  if exists (select 1 from pg_class where relowner = 'kayfabb_digest'::regrole) or exists (select 1 from pg_type where typowner = 'kayfabb_digest'::regrole and typtype <> 'c') then
    raise exception 'the digest role owns an object that is not a function';
  end if;

  -- ------------------------------------------------------------------------------- the digest ----
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '2'), ('digestExcerptChars', '10')
  on conflict (key) do update set value = excluded.value;
  acct_a := tests.account('digest-a'); acct_b := tests.account('digest-b');
  a := tests.character(acct_a, 'Digest A'); b := tests.character(acct_b, 'Digest B');
  insert into characters (name, staff, staff_kind, debuted_at) values ('Digest Boss', 'digest-boss', 'boss', now()) returning id into boss;
  update seasons set boss = 'digest-boss' where ends_at is null;

  t1 := tests.thread('Most posts'); t2 := tests.thread('Split reactions'); t3 := tests.thread('One reaction'); t4 := tests.thread('Quiet');
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
  perform set_config('kayfabb.staff_writer', '', true);
  insert into reaction_tallies (act, kind, count) values (pboss, 'wow', 4), (pboss, 'meh', 1);
  insert into settlements (starts_at, ends_at, season) select base - interval '30 minutes', base - interval '10 minutes', id from seasons where ends_at is null;
  update standings set amount = 1000000 where character = a;
  update standings set amount = 2000000 where character = b;

  perform tests.become_service();
  d := system_digest(base - interval '1 hour', base + interval '1 hour');
  perform tests.unbecome();

  if jsonb_array_length(d -> 'threads') > 3 or jsonb_array_length(d -> 'threads') <> 3 then raise exception 'the thread list is not capped at digestThreads: %', d -> 'threads'; end if;
  select array_agg(e ->> 'title' order by o) into titles from jsonb_array_elements(d -> 'threads') with ordinality x(e, o);
  -- t1 has 5 posts (heat 2.5 an hour over the 2-hour window), t2 and t3 have 2 each, t4 one: t2 splits its reactions, so it outranks t3.
  if titles is distinct from array['Most posts', 'Split reactions', 'One reaction'] then raise exception 'threads are ordered %', titles; end if;
  if (d #>> '{threads,0,heat}')::numeric <> 2.5 then raise exception 'heat is posts an hour: %', d #> '{threads,0}'; end if;
  if (d #>> '{threads,0,length}')::integer <> 5 then raise exception 'length is the thread''s posts: %', d #> '{threads,0}'; end if;
  if (d #>> '{threads,1,controversy}')::numeric <> 0.5 or (d #>> '{threads,2,controversy}')::numeric <> 0 then raise exception 'controversy is %, %', d #>> '{threads,1,controversy}', d #>> '{threads,2,controversy}'; end if;
  if d -> 'moves' is distinct from '[]'::jsonb then raise exception 'moves are not empty: %', d -> 'moves'; end if;

  -- Excerpts: capped at digestExcerpts, each cut to digestExcerptChars, the most reacted first.
  if jsonb_array_length(d -> 'excerpts') <> 2 then raise exception 'excerpts are not capped at digestExcerpts: %', d -> 'excerpts'; end if;
  if exists (select 1 from jsonb_array_elements(d -> 'excerpts') e where char_length(e ->> 'text') > 10) then raise exception 'an excerpt is not cut: %', d -> 'excerpts'; end if;
  if (d #>> '{excerpts,0,act}')::uuid is distinct from pboss and (d #>> '{excerpts,0,act}')::uuid is distinct from (select x.id from acts x where x.thread = t3 and x.seq = 1) then
    raise exception 'the first excerpt is not the most reacted: %', d -> 'excerpts';
  end if;
  -- Quotes: b quotes a, once.
  if d -> 'quotes' is distinct from jsonb_build_array(jsonb_build_object('from', b, 'to', a, 'count', 1)) then raise exception 'quotes are %', d -> 'quotes'; end if;
  -- The Boss's own Act, and its public tally.
  if jsonb_array_length(d -> 'bossReactions') <> 1 or (d #>> '{bossReactions,0,total}')::integer <> 5 or (d #>> '{bossReactions,0,tally,wow}')::integer <> 4 then
    raise exception 'reactions to the Boss are %', d -> 'bossReactions';
  end if;
  -- Standings moved: a settlement fell in the window, so the public standings top, best first.
  if (d #>> '{standings,0,character}')::uuid <> b or (d #>> '{standings,0,amount}')::integer <> 2000000 or jsonb_array_length(d -> 'standings') <> 2 then raise exception 'standings are %', d -> 'standings'; end if;
  -- The characters named, public ones only.
  if not (select bool_and(e ->> 'name' is not null) from jsonb_array_elements(d -> 'characters') e)
     or not exists (select 1 from jsonb_array_elements(d -> 'characters') e where (e ->> 'id')::uuid = a)
     or not exists (select 1 from jsonb_array_elements(d -> 'characters') e where (e ->> 'id')::uuid = b) then
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
