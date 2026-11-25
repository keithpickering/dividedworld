-- An announced Turn is the character's own Act (supabase/migrations/0100_announce.sql; docs/plans/2026-11-06-season-end-design.md, sections 4 and 5):
-- one `announce` Act per announcement, written in the season's Promos thread when the change takes effect, with what the player chose to make public
-- (since 0427 a Turn is announced when it is asked, and the Turns queued before that are written this way; since 0428 there is no debut, so the settlement writes only Turns);
-- no tally and no separate unmask. Its class is a verified reveal (class_reveals), its Turn is read by turns_announced, and Season News keeps one item
-- per landing. Every block runs: the harness stops a file at its first error, so each block names its own accounts and its own window.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- The migration exists at all, so a missing one fails here on an assertion and not on a missing kind below.
do $$
begin
  if to_regprocedure('write_announce(uuid,uuid,text,text,text,timestamptz,boolean)') is null or to_regprocedure('promos_thread(bigint)') is null then
    raise exception 'write_announce and promos_thread exist';
  end if;
  if to_regprocedure('post_tally(bigint,jsonb,jsonb,timestamptz,integer,integer)') is not null then raise exception 'post_tally is gone'; end if;
end $$;

-- ---- A settlement with every kind of old announced Turn writes one announce Act each, in name order, and a silent one writes none ----
do $$
declare
  -- The accounts are made in the opposite order to the names, so that an order by account, or by creation, would show.
  z uuid := tests.account('an-z');
  y uuid := tests.account('an-y');
  x uuid := tests.account('an-x');
  window_end timestamptz := now() + interval '1 minute';
  first_id uuid;
  t_plain uuid; t_from uuid; t_to uuid; t_both uuid; t_silent uuid;
  th uuid;
  rows jsonb;
begin
  -- Turns: the four kinds of announced one, and a silent one, all of characters that debuted long ago. The accounts are in the reverse order of the names.
  t_plain := tests.character(x, 'An Turns Plainly', 'alpha', now() - interval '60 days');
  t_from := tests.character(y, 'An Names What It Was', 'alpha', now() - interval '60 days');
  t_to := tests.character(z, 'An Names What It Is', 'alpha', now() - interval '60 days');
  t_both := tests.character(x, 'An Names Both', 'alpha', now() - interval '60 days');
  t_silent := tests.character(y, 'An Silent Turn', 'alpha', now() - interval '60 days');
  -- The announced ones are queued as before turns were announced at once (0427): with no announcement written, so the settlement writes them the old way.
  perform tests.queue_old_turn(t_plain, 'beta'); perform tests.queue_old_turn(t_both, 'beta', true, true);
  perform tests.queue_old_turn(t_from, 'beta', true, false);
  perform tests.become(y); perform turn(t_silent, 'beta', 'silent', false, false); perform tests.unbecome();
  perform tests.queue_old_turn(t_to, 'beta', false, true);
  update seasons set turns_thread = null where ends_at is null;

  first_id := masks_change(window_end);
  th := (select turns_thread from seasons where ends_at is null);
  if th is null then raise exception 'the settlement opened no Promos thread'; end if;
  if (select title from threads where id = th) is distinct from 'Season 1: Promos' then raise exception 'the thread is titled by the instance''s word: %', (select title from threads where id = th); end if;
  if (select board from threads where id = th) is distinct from system_board() then raise exception 'the Promos are on The System''s board'; end if;

  select jsonb_agg(jsonb_build_object('name', c.name, 'character', a.character, 'payload', a.payload, 'at', a.created_at, 'thread', a.thread) order by a.seq) into rows
  from acts a join characters c on c.id = a.character where a.kind = 'announce' and a.thread = th;
  if jsonb_array_length(rows) is distinct from 4 then raise exception 'four announcements, not %: %', jsonb_array_length(rows), rows; end if;
  -- Each by name; never by account.
  if (select array_agg(r ->> 'name' order by o) from jsonb_array_elements(rows) with ordinality x(r, o))
     is distinct from array['An Names Both', 'An Names What It Is', 'An Names What It Was', 'An Turns Plainly'] then
    raise exception 'the Acts are not Turns by name: %', rows;
  end if;
  if rows -> 0 -> 'payload' is distinct from '{"what": "turn", "was": "alpha", "class": "beta"}'::jsonb then raise exception 'a Turn naming both: %', rows -> 0; end if;
  if rows -> 1 -> 'payload' is distinct from '{"what": "turn", "class": "beta"}'::jsonb then raise exception 'a Turn naming the class it Turns to: %', rows -> 1; end if;
  if rows -> 2 -> 'payload' is distinct from '{"what": "turn", "was": "alpha"}'::jsonb then raise exception 'a Turn naming the class it leaves: %', rows -> 2; end if;
  if rows -> 3 -> 'payload' is distinct from '{"what": "turn"}'::jsonb then raise exception 'a plain announced Turn: %', rows -> 3; end if;
  -- Each its own character's, dated at the window's end; the return is the first.
  if exists (select 1 from jsonb_array_elements(rows) r where (r ->> 'at')::timestamptz is distinct from window_end) then raise exception 'the Acts are dated at the window''s end: %', rows; end if;
  if (rows -> 0 ->> 'character')::uuid is distinct from t_both or (rows -> 3 ->> 'character')::uuid is distinct from t_plain then raise exception 'each Act is its character''s'; end if;
  if first_id is distinct from (select a.id from acts a where a.kind = 'announce' and a.thread = th order by a.seq limit 1) then raise exception 'masks_change returns the first announcement'; end if;
  -- A silent Turn writes nothing; no tally and no unmask is written.
  if exists (select 1 from acts where kind = 'announce' and character = t_silent) then raise exception 'a silent change was announced'; end if;
  if exists (select 1 from acts where kind in ('tally', 'unmask') and created_at = window_end) then raise exception 'an announcement wrote a tally or an unmask'; end if;
  if (select class_key from class_now(t_silent, 'infinity')) is distinct from 'beta' then raise exception 'the silent Turn still took effect'; end if;

  -- class_reveals: a Turn naming the class it Turns to, with `via` its `what`; the others, none.
  if (select count(*) from class_reveals where character in (t_plain, t_from)) is distinct from 0 then raise exception 'an announcement naming no class is a class reveal'; end if;
  if (select (class, via, at) from class_reveals where character = t_to) is distinct from ('beta'::text, 'turn'::text, window_end) then raise exception 'a Turn naming its new class is a reveal'; end if;
  if (select (class, via) from class_reveals where character = t_both) is distinct from ('beta'::text, 'turn'::text) then raise exception 'a Turn naming both is a reveal'; end if;
  -- turns_announced: the four Turns, with `was` where named, and not the silent one.
  if (select jsonb_object_agg(character::text, coalesce(was, '-')) from turns_announced where character in (t_plain, t_from, t_to, t_both, t_silent))
     is distinct from jsonb_build_object(t_plain::text, '-', t_from::text, 'alpha', t_to::text, '-', t_both::text, 'alpha') then
    raise exception 'turns_announced: %', (select jsonb_agg(to_jsonb(t)) from turns_announced t where character in (t_plain, t_from, t_to, t_both, t_silent));
  end if;
  if (select (at, act) from turns_announced where character = t_both) is distinct from (window_end, (select a.id from acts a where a.kind = 'announce' and a.character = t_both)) then raise exception 'a Turn is dated at its announcement and names its Act'; end if;

  -- A settlement run again finds nothing waiting: no Act is written twice (the pending rows it deleted are the guard, as they were the tally's).
  if masks_change(window_end) is not null then raise exception 'a settlement applied again announced again'; end if;
  if (select count(*) from acts where kind = 'announce' and thread = th) is distinct from 4::bigint then raise exception 'a settlement applied twice wrote an announcement twice'; end if;
end $$;

-- ---- An old tally's Turn is still read by turns_announced, beside the announce Acts ----
do $$
declare
  ann uuid := tests.account('an-old-ann');
  old uuid := tests.character(ann, 'An Old Turner', 'alpha', now() - interval '60 days');
  th uuid := tests.thread('An Old Turns');
begin
  perform tests.act(null, 'tally', th, jsonb_build_object('season', 1, 'part', 1, 'of', 1, 'debuts', '[]'::jsonb,
    'turns', jsonb_build_array(jsonb_build_object('character', old, 'name', 'An Old Turner', 'loudness', 'announced', 'was', 'alpha'))), null, now() - interval '3 days');
  if (select (was, at) from turns_announced where character = old) is distinct from ('alpha'::text, (select created_at from acts where kind = 'tally' and thread = th)) then
    raise exception 'an old tally''s Turn is still read: %', (select jsonb_agg(to_jsonb(t)) from turns_announced t where character = old);
  end if;
end $$;

-- ---- The guard: an announce names the class its character holds, and a debut has no `was` ----
do $$
declare
  ann uuid := tests.account('an-guard');
  c uuid := tests.character(ann, 'An Guarded', 'alpha', now() - interval '10 days');
  th uuid := (select turns_thread from seasons where ends_at is null);
  said text;
begin
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''announce'', %L, %L)', c, th, '{"what": "turn", "class": "beta"}'));
  if said is null or said not like '23514:%' then raise exception 'an announce naming a class the character does not hold was not refused: %', said; end if;
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''announce'', %L, %L)', c, th, '{"what": "debut", "was": "alpha"}'));
  if said is null or said not like '23514:%' then raise exception 'a debut with a `was` was not refused: %', said; end if;
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''announce'', %L, %L)', c, th, '{"what": "post"}'));
  if said is null or said not like '23514:%' then raise exception 'an announce of anything but a debut or a Turn was not refused: %', said; end if;
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (null, ''announce'', %L, %L)', th, '{"what": "debut"}'));
  if said is null then raise exception 'an announce with no character was not refused'; end if;
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''announce'', %L, %L)', c, th, '{"what": "turn", "class": "alpha"}'));
  if said is not null then raise exception 'an announce naming the class held was refused: %', said; end if;
end $$;

-- ---- The guard reads the class held at the Act's instant: after a Turn, the old class is refused and the new one accepted ----
do $$
declare
  ann uuid := tests.account('an-guard-turn');
  c uuid := tests.character(ann, 'An Guard Turned', 'alpha', now() - interval '10 days');
  th uuid := (select turns_thread from seasons where ends_at is null);
  said text;
begin
  insert into class_history (character, class_key, started_at) values (c, 'beta', now() - interval '1 hour');
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''announce'', %L, %L)', c, th, '{"what": "turn", "class": "alpha"}'));
  if said is null or said not like '23514:%' then raise exception 'an announce naming the class a Turn left was not refused: %', said; end if;
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''announce'', %L, %L)', c, th, '{"what": "turn", "class": "beta"}'));
  if said is not null then raise exception 'an announce naming the class a Turn reached was refused: %', said; end if;
end $$;

-- ---- A settlement that crashes part way writes nothing, and the run after it writes everything ----
create function pg_temp.crash_on_turn() returns trigger language plpgsql as $$
begin
  if new.kind = 'announce' and new.character = current_setting('tests.crash_character')::uuid then raise exception 'planted crash'; end if;
  return new;
end $$;
do $$
declare
  ann uuid := tests.account('an-crash');
  window_end timestamptz := now() + interval '5 minutes';
  first_turner uuid; turner uuid;
  n bigint := (select count(*) from acts where kind = 'announce');
  crashed boolean := false;
begin
  first_turner := tests.character(ann, 'An Crash Turn A', 'alpha', now() - interval '60 days');
  turner := tests.character(ann, 'An Crash Turn B', 'alpha', now() - interval '60 days');
  perform tests.queue_old_turn(first_turner, 'beta');
  perform tests.queue_old_turn(turner, 'beta');
  -- The second Turn's Act is the second written (by name): the first is written, then the second fails.
  perform set_config('tests.crash_character', turner::text, true);
  create trigger tests_crash before insert on acts for each row execute function pg_temp.crash_on_turn();
  begin
    perform masks_change(window_end);
  exception when others then
    crashed := true;
  end;
  drop trigger tests_crash on acts;
  if not crashed then raise exception 'the planted crash did not reach masks_change'; end if;
  if (select count(*) from acts where kind = 'announce') is distinct from n then raise exception 'a crashed settlement left % announcements', (select count(*) from acts where kind = 'announce') - n; end if;
  if (select count(*) from pending_turns where character in (first_turner, turner)) is distinct from 2::bigint then raise exception 'a crashed settlement lost a pending Turn'; end if;
  if (select class_key from class_now(turner, 'infinity')) is distinct from 'alpha' then raise exception 'a crashed settlement still Turned'; end if;
  -- The run after it, with the cause gone, writes both.
  perform masks_change(window_end);
  if (select count(*) from acts where kind = 'announce') is distinct from n + 2 then raise exception 'the retried settlement wrote % announcements', (select count(*) from acts where kind = 'announce') - n; end if;
  if exists (select 1 from pending_turns where character in (first_turner, turner)) then raise exception 'the retried settlement left the Turn pending'; end if;
end $$;

-- ---- Landing an announce takes the lock on its landing, so two transactions landing one thread and instant cannot split it ----
-- (A second connection cannot see this file's uncommitted rows, so the race itself is not driven; what the serialization is made of is: the lock.)
do $$
declare
  ann uuid := tests.account('an-lock');
  c uuid := tests.character(ann, 'An Lock', 'alpha', now() - interval '10 days');
  th uuid := (select turns_thread from seasons where ends_at is null);
  at timestamptz := now() + interval '6 minutes';
  k bigint := hashtextextended(th::text || '|' || (extract(epoch from at) * 1000000)::bigint::text, 0);
begin
  -- The key is the same whatever the session's zone: a drop and a settlement may run under different ones.
  set local timezone = 'America/New_York';
  if exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and classid = ((k >> 32) & 4294967295)::oid and objid = (k & 4294967295)::oid) then
    raise exception 'the landing''s lock is held before any Act lands';
  end if;
  perform write_announce(c, th, 'turn', null, null, at);
  if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and classid = ((k >> 32) & 4294967295)::oid and objid = (k & 4294967295)::oid and objsubid = 1) then
    raise exception 'landing an announce took no lock on its thread and instant';
  end if;
  reset timezone;
end $$;

-- ---- A staff character waiting for an office is not debuted by a settlement (only an office debuts it), announced by no Act, and the settlement goes on ----
do $$
declare
  window_end timestamptz := now() + interval '2 minutes 30 seconds';
  staffer uuid;
begin
  insert into characters (name, staff, staff_kind, created_at) values ('An Staffer', 'an-staffer', 'persona', now() - interval '1 hour') returning id into staffer;
  perform masks_change(window_end);
  if (select debuted_at from characters where id = staffer) is not null then raise exception 'a settlement debuted a waiting staff character'; end if;
  if exists (select 1 from acts where kind = 'announce' and character = staffer) then raise exception 'a staff character was announced'; end if;
end $$;

-- ---- A landing of 156 Turns is 156 Acts, one News item with a count of 156 and 20 names ----
do $$
declare
  window_end timestamptz := now() + interval '3 minutes';
  viewer uuid := tests.account('an-big-viewer');
  owner uuid;
  p integer; q integer;
  th uuid;
  item record;
  first_act uuid;
  landed timestamptz;
begin
  -- A player runs at most six characters: twenty-six players make 156.
  for p in 1..26 loop
    owner := tests.account('an-big-' || p);
    for q in 1..6 loop
      perform tests.queue_old_turn(tests.character(owner, format('An Big %s-%s', lpad(p::text, 2, '0'), q), 'alpha', now() - interval '60 days'), 'beta');
    end loop;
  end loop;
  first_act := masks_change(window_end);
  th := (select thread from acts where id = first_act);
  if (select count(*) from acts where kind = 'announce' and thread = th and created_at = window_end and character in (select id from characters where name like 'An Big %-%')) is distinct from 156::bigint then
    raise exception '156 Turns wrote % Acts', (select count(*) from acts where kind = 'announce' and thread = th and created_at = window_end);
  end if;
  if (select count(*) from news_landed n join acts a on a.id = n.act where n.kind = 'announcements' and a.thread = th and a.created_at = window_end) is distinct from 1::bigint then
    raise exception 'a landing is one news_landed row, not %', (select count(*) from news_landed n join acts a on a.id = n.act where n.kind = 'announcements' and a.thread = th and a.created_at = window_end);
  end if;
  if (select n.act from news_landed n join acts a on a.id = n.act where n.kind = 'announcements' and a.thread = th and a.created_at = window_end) is distinct from first_act then raise exception 'the landing''s Act is the first'; end if;
  landed := (select landed_at from news_landed where act = first_act);
  perform tests.become(viewer);
  select * into item from season_news(null, 50) s where s.act = first_act;
  perform tests.unbecome();
  if item.kind is null then raise exception 'Season News has no item for the landing'; end if;
  if item.kind <> 'tally' or item.count is distinct from 156 or item.thread is distinct from th then raise exception 'the landing''s item: %', to_jsonb(item); end if;
  if jsonb_array_length(item.detail -> 'debuts') + jsonb_array_length(item.detail -> 'turns') is distinct from 20 then raise exception 'the item names 20: %', item.detail; end if;
  if item.detail #>> '{turns,0,name}' is distinct from 'An Big 01-1' or item.detail #>> '{turns,0,character}' is null then raise exception 'the names are the first by name, each with its character: %', item.detail -> 'turns' -> 0; end if;
  if item.at is distinct from landed then raise exception 'the item is dated at its landing'; end if;
end $$;

-- ---- An announcement landing at the very instant of a settlement, in the same thread, merges into the landing: one item, the count of both ----
do $$
declare
  ann uuid := tests.account('an-same');
  window_end timestamptz := now() + interval '4 minutes';
  dropped uuid; turner uuid;
  th uuid := (select turns_thread from seasons where ends_at is null);
  item record;
  landing uuid;
  viewer uuid := tests.account('an-same-viewer');
begin
  dropped := tests.character(ann, 'An Same Drop', 'alpha', now() - interval '1 hour');
  turner := tests.character(ann, 'An Same Turn', 'alpha', now() - interval '60 days');
  perform tests.queue_old_turn(turner, 'beta');
  -- An announcement another writer lands at the same instant (a Turn announced when it was asked lands its own at the landing; here one is written by hand).
  perform write_announce(dropped, th, 'turn', null, null, window_end);
  perform masks_change(window_end);
  if (select count(*) from news_landed n join acts a on a.id = n.act where n.kind = 'announcements' and a.thread = th and a.created_at = window_end) is distinct from 1::bigint then raise exception 'the same instant is one landing'; end if;
  landing := (select n.act from news_landed n join acts a on a.id = n.act where a.thread = th and a.created_at = window_end);
  perform tests.become(viewer);
  select * into item from season_news(null, 50) s where s.act = landing;
  perform tests.unbecome();
  if item.count is distinct from 2 then raise exception 'the merged landing counts both announcements: %', to_jsonb(item); end if;
  if landing is distinct from (select a.id from acts a where a.thread = th and a.created_at = window_end and a.kind = 'announce' order by a.seq limit 1) then raise exception 'the item links the first Act'; end if;
end $$;

-- ---- The Promos thread is listed on The System's board; an old season's reveal thread is not ----
do $$
declare
  th uuid := (select turns_thread from seasons where ends_at is null);
  reveal_thread uuid; old_season bigint; hdr uuid;
begin
  if not exists (select 1 from thread_list where id = th) then raise exception 'the Promos thread is in thread_list'; end if;
  -- An earlier season's end wrote its reveal thread and pointed the season at its header; seasons_net_threads (0099) unlists it.
  insert into seasons (number, starts_at, ends_at) values (80, '1985-05-01', '1985-06-01') returning id into old_season;
  reveal_thread := tests.thread('Season 80: The Reveal');
  hdr := tests.act(null, 'reveal', reveal_thread, jsonb_build_object('season', 80, 'from', '1985-05-01'::timestamptz, 'to', '1985-06-01'::timestamptz, 'body', 'Every mask.', 'characters', 0), null, '1985-06-01'::timestamptz);
  if not exists (select 1 from thread_list where id = reveal_thread) then raise exception 'the reveal thread is listed until its season points at it'; end if;
  update seasons set reveal_act = hdr where id = old_season;
  if exists (select 1 from thread_list where id = reveal_thread) then raise exception 'an old season''s reveal thread is in thread_list'; end if;
  if exists (select 1 from unlisted_threads where thread = th) then raise exception 'the Promos thread is unlisted'; end if;
end $$;
