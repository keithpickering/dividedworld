-- Live updates carry only public projections (supabase/migrations/0008_realtime.sql): no table
-- in any publication has a private column, and only a signed-in player hears a private channel.
-- Plan Task 13; the screens' engine plan, Task 12, adds what the screens keep private (reading,
-- releases, preferences, admins).

-- What a publication carries that it must not, as one line per column; empty when nothing.
create function pg_temp.published_leaks() returns text language plpgsql as $$
declare
  bad text := '';
  r record;
begin
  for r in
    select p.pubname, t.schemaname, t.tablename, a.attname
    from pg_publication p
    join pg_publication_tables t on t.pubname = p.pubname
    join pg_attribute a on a.attrelid = format('%I.%I', t.schemaname, t.tablename)::regclass and a.attnum > 0 and not a.attisdropped
    where a.attname in ('owner', 'class_key', 'account', 'player', 'reactor_account', 'reactor_character', 'balance', 'who',
                        'first_character', 'released_at')
       or (t.tablename in ('reactions', 'wallets', 'wallet_events', 'ledger', 'card_ledger', 'class_history', 'characters', 'accounts', 'settlement_class_totals',
                           'reading', 'effect_releases', 'account_preferences', 'admins', 'invites', 'pending_turns'))
  loop
    bad := bad || format(E'\n  %s publishes %s.%s (%s)', r.pubname, r.schemaname, r.tablename, r.attname);
  end loop;
  return bad;
end $$;

do $$
declare bad text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'there is no supabase_realtime publication to read, which cannot be right here';
  end if;
  bad := pg_temp.published_leaks();
  if bad <> '' then raise exception 'a publication carries a private column to every listener:%', bad; end if;
  -- And every publication's tables, whatever they hold, are none of ours yet: live updates are broadcasts.
  if exists (select 1 from pg_publication_tables where schemaname = 'public') then
    raise exception 'a table of ours is published: %', (select string_agg(tablename, ', ') from pg_publication_tables where schemaname = 'public');
  end if;
end $$;

-- The check sees a private table planted in the publication: each of the screens' private tables,
-- published for a moment and taken out again, is named by it.
do $$
declare
  t text;
  bad text;
begin
  foreach t in array array['reading', 'effect_releases', 'account_preferences', 'admins'] loop
    execute format('alter publication supabase_realtime add table public.%I', t);
    bad := pg_temp.published_leaks();
    execute format('alter publication supabase_realtime drop table public.%I', t);
    if bad not like '%public.' || t || '%' then raise exception 'publishing % went unseen by the check', t; end if;
  end loop;
end $$;

-- A private channel's messages are heard by a signed-in player, and by nobody without a session.
do $$
declare n integer;
begin
  insert into realtime.messages (topic, payload, event) values ('thread:00000000-0000-4000-8000-000000000000', '{}', 'act');
  perform set_config('realtime.topic', 'thread:00000000-0000-4000-8000-000000000000', true);
  perform tests.become(tests.account('listener'));
  select count(*) into n from realtime.messages;
  perform tests.unbecome();
  if n <> 1 then raise exception 'a signed-in player should hear a thread''s channel'; end if;
  perform tests.become_anon();
  begin
    select count(*) into n from realtime.messages;
  exception when insufficient_privilege then n := 0;
  end;
  perform tests.unbecome();
  if n <> 0 then raise exception 'a visitor with no session heard a thread''s channel'; end if;
  perform set_config('realtime.topic', 'wallet:anything', true);
  perform tests.become(tests.account('listener-2'));
  select count(*) into n from realtime.messages;
  perform tests.unbecome();
  if n <> 0 then raise exception 'a channel that is not a thread''s or a board''s was heard'; end if;
  insert into realtime.messages (topic, payload, event) values ('board:00000000-0000-4000-8000-000000000000', '{}', 'thread');
  insert into realtime.messages (topic, payload, event, extension) values ('board:00000000-0000-4000-8000-000000000000', '{}', 'x', 'presence');
  perform set_config('realtime.topic', 'board:00000000-0000-4000-8000-000000000000', true);
  perform tests.become(tests.account('listener-3'));
  if not exists (select 1 from realtime.messages) then raise exception 'a signed-in player should hear a board''s channel'; end if;
  select count(*) into n from realtime.messages where extension <> 'broadcast';
  perform tests.unbecome();
  if n <> 0 then raise exception 'a player heard something on a channel that is not a broadcast'; end if;
end $$;
