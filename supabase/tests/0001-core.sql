-- The core schema (supabase/migrations/0001_core.sql): who can read a character's owner and
-- class, an Act that cannot be changed, the character cap, and Acts that point at the Acts they
-- came from. Plan Task 5.

-- ---- A character's owner and class are readable by its own player and nobody else ----
do $$
declare
  ann uuid := tests.account('ann');
  bob uuid := tests.account('bob');
  mask uuid := tests.character(ann, 'Pipewrench', 'beta');
  n integer;
  seen uuid;
begin
  perform tests.become(bob);
  perform auth.assert_impersonating();
  select count(*) into n from characters where id = mask;
  if n <> 0 then raise exception 'another player read a character''s row, owner included'; end if;
  select count(*) into n from class_history where character = mask;
  if n <> 0 then raise exception 'another player read a character''s class'; end if;
  select count(*) into n from accounts where id = ann;
  if n <> 0 then raise exception 'another player read an account'; end if;
  select count(*) into n from characters_public where id = mask and name = 'Pipewrench';
  if n <> 1 then raise exception 'the public projection should show the character by name'; end if;
  -- And nothing else: a creation time to the microsecond would show which masks were made in one
  -- sitting, which is to say whose.
  if (select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
      where table_schema = 'public' and table_name = 'characters_public') is distinct from 'id,name' then
    raise exception 'characters_public shows more than a character''s id and name: %',
      (select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'characters_public');
  end if;

  perform tests.unbecome();
  perform tests.become(ann);
  select owner into seen from characters where id = mask;
  if seen is distinct from ann then raise exception 'a player should read their own character''s owner'; end if;
  select count(*) into n from class_history where character = mask and class_key = 'beta';
  if n <> 1 then raise exception 'a player should read their own character''s class'; end if;
  -- But not the row's id: the gap between two of a player's own ids counts everyone else's
  -- class changes between them, silent Turns included.
  begin
    perform id from class_history where character = mask;
    raise exception 'a player read class_history ids, a count of other players'' Turns';
  exception when insufficient_privilege then null;
  end;
  perform tests.unbecome();
end $$;

-- ---- No view or table a caller can read carries a private column, unless row security limits it to its own rows ----
do $$
declare
  r record;
  leaks text := '';
begin
  for r in
    select c.relname, c.relkind, a.attname, c.relrowsecurity
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('r', 'v', 'm')
      and (has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('anon', c.oid, 'select'))
      and a.attname in ('owner', 'class_key', 'account', 'reactor_account', 'reactor_character', 'player')
  loop
    if r.relkind <> 'r' or not r.relrowsecurity then
      leaks := leaks || format(' %s.%s', r.relname, r.attname);
    end if;
  end loop;
  if leaks <> '' then raise exception 'a private column is readable outside row security:%', leaks; end if;
end $$;

-- ---- No view a caller can read draws on a private column, under any name ----
-- A view can rename a column, so the names above are not enough: the catalog says which table
-- columns each view reads. A view that must read one (to filter to the caller's own rows, say)
-- is named here with its reason.
do $$
declare
  leaks text := '';
  r record;
begin
  for r in
    select u.view_name, u.table_name, u.column_name
    from information_schema.view_column_usage u
    where u.view_schema = 'public'
      and (has_table_privilege('authenticated', format('public.%I', u.view_name), 'select') or has_table_privilege('anon', format('public.%I', u.view_name), 'select'))
      and (u.table_name, u.column_name) in (('characters', 'owner'), ('class_history', 'class_key'), ('accounts', 'id'),
                                            ('reactions', 'reactor_account'), ('reactions', 'reactor_character'))
      -- my_reactions (0018) reads who reacted only to keep each caller to their own reactions,
      -- through their own masks; 0024-reading.sql holds that it shows nobody else's.
      and not (u.view_name = 'my_reactions' and u.table_name = 'reactions')
      -- my_characters (0030) reads the owner to keep each caller to their own characters, and the class to say what it is now;
      -- 0033-screens-reads.sql holds that it shows nobody else's.
      and not (u.view_name = 'my_characters' and (u.table_name, u.column_name) in (('characters', 'owner'), ('class_history', 'class_key')))
  loop
    leaks := leaks || format(' %s reads %s.%s;', r.view_name, r.table_name, r.column_name);
  end loop;
  if leaks <> '' then raise exception 'a view callers can read draws on a private column:%', leaks; end if;
end $$;

-- ---- An edit is its own author's, of their own post, in its thread ----
do $$
declare
  ann uuid := tests.account('ida');
  bob uuid := tests.account('jon');
  a uuid := tests.character(ann, 'Wrench');
  b uuid := tests.character(bob, 'Bolt');
  t uuid := tests.thread();
  p uuid := tests.post(a, t, 'Mine.');
  refused boolean;
begin
  refused := false;
  begin perform tests.act(b, 'edit', t, '{"body": "Yours now."}', p);
  exception when check_violation then refused := true; end;
  if not refused then raise exception 'another character''s edit of a post was written'; end if;
  refused := false;
  begin perform tests.act(a, 'edit', tests.thread(), '{"body": "Elsewhere."}', p);
  exception when check_violation then refused := true; end;
  if not refused then raise exception 'an edit in another thread was written'; end if;
  refused := false;
  begin perform tests.act(a, 'edit', t, '{"body": "Again."}', tests.act(a, 'edit', t, '{"body": "Once."}', p));
  exception when check_violation then refused := true; end;
  if not refused then raise exception 'an edit of an edit was written'; end if;
  refused := false;
  begin perform tests.act(a, 'card', t, '{}', tests.act(a, 'edit', t, '{"body": "x"}', p));
  exception when check_violation then refused := true; end;
  if not refused then raise exception 'a card was played on an edit'; end if;
end $$;

-- ---- A visitor with no session reads nothing ----
do $$
declare ok boolean := false;
begin
  perform tests.become_anon();
  begin
    perform 1 from characters_public;
  exception when insufficient_privilege then ok := true;
  end;
  perform tests.unbecome();
  if not ok then raise exception 'anon read characters_public'; end if;
end $$;

-- ---- An Act cannot be changed or removed, by anyone ----
do $$
declare
  ann uuid := tests.account('cal');
  mask uuid := tests.character(ann, 'Quillfeather');
  t uuid := tests.thread();
  p uuid := tests.post(mask, t, 'First.');
  refused boolean;
begin
  refused := false;
  begin update acts set payload = '{"body": "Changed."}' where id = p;
  exception when raise_exception then refused := true; end;
  if not refused then raise exception 'an UPDATE of an Act''s payload went through, as the superuser'; end if;
  refused := false;
  begin delete from acts where id = p;
  exception when raise_exception then refused := true; end;
  if not refused then raise exception 'a DELETE of an Act went through'; end if;
  if (select payload ->> 'body' from acts where id = p) is distinct from 'First.' then raise exception 'the Act changed'; end if;
end $$;

do $$
declare refused boolean := false;
begin
  begin truncate acts cascade;
  exception when raise_exception then refused := true; end;
  if not refused then raise exception 'a TRUNCATE of acts went through'; end if;
end $$;

-- ---- An edit is a new Act; the post's current text is the latest edit's ----
do $$
declare
  ann uuid := tests.account('dee');
  mask uuid := tests.character(ann, 'Rivet');
  t uuid := tests.thread();
  p uuid := tests.post(mask, t, 'Frist.', now() - interval '2 minutes');
  e1 uuid := tests.act(mask, 'edit', t, '{"body": "First?"}', p, now() - interval '1 minute');
  e2 uuid := tests.act(mask, 'edit', t, '{"body": "First."}', p, now());
  cur text;
  orig text;
  s integer;
begin
  select current_payload ->> 'body', payload ->> 'body' into cur, orig from acts_public where id = p;
  if cur <> 'First.' then raise exception 'the current text should be the latest edit''s, got %', cur; end if;
  if orig <> 'Frist.' then raise exception 'the original survives beside it, got %', orig; end if;
  select seq into s from acts where id = e2;
  if s is not null then raise exception 'an edit takes no place in the thread'; end if;
  if (select count(*) from acts where target_act_id = p and kind = 'edit') is distinct from 2 then raise exception 'both edits are kept'; end if;
  perform e1;
end $$;

-- ---- Places in a thread are numbered in order ----
do $$
declare
  ann uuid := tests.account('eve');
  mask uuid := tests.character(ann, 'Sprocket');
  t uuid := tests.thread();
  a uuid := tests.post(mask, t);
  b uuid := tests.post(mask, t);
  other uuid := tests.post(mask, tests.thread());
begin
  if (select seq from acts where id = a) is distinct from 1 or (select seq from acts where id = b) is distinct from 2 then
    raise exception 'posts in a thread should be numbered 1, 2';
  end if;
  if (select seq from acts where id = other) is distinct from 1 then raise exception 'each thread numbers its own posts from 1'; end if;
end $$;

-- ---- A seventh character is refused; a name is one per instance, whatever its case ----
do $$
declare
  ann uuid := tests.account('fay');
  refused boolean := false;
begin
  for i in 1..6 loop perform tests.character(ann, 'Mask ' || i); end loop;
  begin perform tests.character(ann, 'Mask 7');
  exception when raise_exception then refused := true; end;
  if not refused then raise exception 'a seventh character was made'; end if;
  refused := false;
  begin perform tests.character(tests.account('gus'), 'MASK 1');
  exception when unique_violation then refused := true; end;
  if not refused then raise exception 'a name was taken twice, in another case'; end if;
end $$;

-- ---- A quote and a spun thread point at the Act they came from ----
do $$
declare
  ann uuid := tests.account('hal');
  mask uuid := tests.character(ann, 'Gadget');
  t uuid := tests.thread();
  p uuid := tests.post(mask, t, 'Quotable.');
  q uuid := tests.act(mask, 'post', t, '{"body": "Indeed."}', p);
  spun uuid;
  s uuid;
begin
  if (select target_act_id from acts_public where id = q) is distinct from p then raise exception 'a quote should point at the Act it quotes'; end if;
  insert into threads (board, title, origin_act_id) select board, 'Spun', p from threads where id = t returning id into spun;
  s := tests.act(mask, 'spin', spun, '{"title": "Spun"}', p);
  if (select origin_act_id from threads where id = spun) is distinct from p then raise exception 'a spun thread should point at its origin'; end if;
  if (select target_act_id from acts where id = s) is distinct from p then raise exception 'the spin Act should point at its origin'; end if;
  if (select seq from acts where id = s) is distinct from 1 then raise exception 'the spin opens its thread'; end if;
end $$;
