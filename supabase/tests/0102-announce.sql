-- An announced debut or Turn is the character's own Act (supabase/migrations/0100_announce.sql; docs/plans/2026-11-06-season-end-design.md, sections 4 and 5):
-- one `announce` Act per announcement, written in the season's Promos thread when the change takes effect, with what the player chose to make public;
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
  if to_regprocedure('write_announce(uuid,uuid,text,text,text,timestamptz)') is null or to_regprocedure('promos_thread(bigint)') is null then
    raise exception 'write_announce and promos_thread exist';
  end if;
  if to_regprocedure('post_tally(bigint,jsonb,jsonb,timestamptz,integer,integer)') is not null then raise exception 'post_tally is gone'; end if;
end $$;

-- ---- A settlement with every announced kind writes one announce Act each, in name order, and a silent one writes none ----
do $$
declare
  -- The accounts are made in the opposite order to the names, so that an order by account, or by creation, would show.
  z uuid := tests.account('an-z');
  y uuid := tests.account('an-y');
  x uuid := tests.account('an-x');
  window_end timestamptz := now() + interval '1 minute';
  first_id uuid;
  debut_a uuid; debut_b uuid; debut_c uuid;
  t_plain uuid; t_from uuid; t_to uuid; t_both uuid; t_silent uuid;
  th uuid;
  rows jsonb;
begin
  -- Waiting debuts: announced, announced with its class, and silent. Their owners are in reverse alphabetical order of the names.
  insert into characters (owner, name, created_at, debut_loudness) values (z, 'An Debut A', now() - interval '2 hours', 'announced') returning id into debut_a;
  insert into characters (owner, name, created_at, debut_loudness) values (y, 'An Debut B', now() - interval '2 hours', 'with_class') returning id into debut_b;
  insert into characters (owner, name, created_at, debut_loudness) values (x, 'An Debut C', now() - interval '2 hours', 'silent') returning id into debut_c;
  insert into class_history (character, class_key, started_at) values (debut_a, 'alpha', now() - interval '2 hours'), (debut_b, 'alpha', now() - interval '2 hours'), (debut_c, 'alpha', now() - interval '2 hours');
  -- Turns: the four kinds of announced one, and a silent one, all of characters that debuted long ago.
  t_plain := tests.character(x, 'An Turns Plainly', 'alpha', now() - interval '60 days');
  t_from := tests.character(y, 'An Names What It Was', 'alpha', now() - interval '60 days');
  t_to := tests.character(z, 'An Names What It Is', 'alpha', now() - interval '60 days');
  t_both := tests.character(x, 'An Names Both', 'alpha', now() - interval '60 days');
  t_silent := tests.character(y, 'An Silent Turn', 'alpha', now() - interval '60 days');
  perform tests.become(x); perform turn(t_plain, 'beta', 'announced', false, false); perform turn(t_both, 'beta', 'announced', true, true); perform tests.unbecome();
  perform tests.become(y); perform turn(t_from, 'beta', 'announced', true, false); perform turn(t_silent, 'beta', 'silent', false, false); perform tests.unbecome();
  perform tests.become(z); perform turn(t_to, 'beta', 'announced', false, true); perform tests.unbecome();
  update seasons set turns_thread = null where ends_at is null;

  first_id := masks_change(window_end);
  th := (select turns_thread from seasons where ends_at is null);
  if th is null then raise exception 'the settlement opened no Promos thread'; end if;
  if (select title from threads where id = th) is distinct from 'Season 1: Promos' then raise exception 'the thread is titled by the instance''s word: %', (select title from threads where id = th); end if;
  if (select board from threads where id = th) is distinct from system_board() then raise exception 'the Promos are on The System''s board'; end if;

  select jsonb_agg(jsonb_build_object('name', c.name, 'character', a.character, 'payload', a.payload, 'at', a.created_at, 'thread', a.thread) order by a.seq) into rows
  from acts a join characters c on c.id = a.character where a.kind = 'announce' and a.thread = th;
  if jsonb_array_length(rows) is distinct from 6 then raise exception 'six announcements, not %: %', jsonb_array_length(rows), rows; end if;
  -- Debuts first, then Turns, each by name; never by account.
  if (select array_agg(r ->> 'name' order by o) from jsonb_array_elements(rows) with ordinality x(r, o))
     is distinct from array['An Debut A', 'An Debut B', 'An Names Both', 'An Names What It Is', 'An Names What It Was', 'An Turns Plainly'] then
    raise exception 'the Acts are not debuts then Turns by name: %', rows;
  end if;
  if rows -> 0 -> 'payload' is distinct from '{"what": "debut"}'::jsonb then raise exception 'an announced debut: %', rows -> 0; end if;
  if rows -> 1 -> 'payload' is distinct from '{"what": "debut", "class": "alpha"}'::jsonb then raise exception 'a debut with its class: %', rows -> 1; end if;
  if rows -> 2 -> 'payload' is distinct from '{"what": "turn", "was": "alpha", "class": "beta"}'::jsonb then raise exception 'a Turn naming both: %', rows -> 2; end if;
  if rows -> 3 -> 'payload' is distinct from '{"what": "turn", "class": "beta"}'::jsonb then raise exception 'a Turn naming the class it Turns to: %', rows -> 3; end if;
  if rows -> 4 -> 'payload' is distinct from '{"what": "turn", "was": "alpha"}'::jsonb then raise exception 'a Turn naming the class it leaves: %', rows -> 4; end if;
  if rows -> 5 -> 'payload' is distinct from '{"what": "turn"}'::jsonb then raise exception 'a plain announced Turn: %', rows -> 5; end if;
  -- Each its own character's, dated at the window's end; the return is the first.
  if exists (select 1 from jsonb_array_elements(rows) r where (r ->> 'at')::timestamptz is distinct from window_end) then raise exception 'the Acts are dated at the window''s end: %', rows; end if;
  if (rows -> 0 ->> 'character')::uuid is distinct from debut_a or (rows -> 5 ->> 'character')::uuid is distinct from t_plain then raise exception 'each Act is its character''s'; end if;
  if first_id is distinct from (select a.id from acts a where a.kind = 'announce' and a.thread = th order by a.seq limit 1) then raise exception 'masks_change returns the first announcement'; end if;
  -- A silent debut and a silent Turn write nothing; no tally and no unmask is written.
  if exists (select 1 from acts where kind = 'announce' and character in (debut_c, t_silent)) then raise exception 'a silent change was announced'; end if;
  if exists (select 1 from acts where kind in ('tally', 'unmask') and created_at = window_end) then raise exception 'an announcement wrote a tally or an unmask'; end if;
  if (select debuted_at from characters where id = debut_c) is distinct from window_end then raise exception 'the silent debut still debuted'; end if;
  if (select class_key from class_now(t_silent, 'infinity')) is distinct from 'beta' then raise exception 'the silent Turn still took effect'; end if;

  -- class_reveals: a debut with its class and a Turn naming the class it Turns to, with `via` their `what`; the others, none.
  if (select count(*) from class_reveals where character in (debut_a, t_plain, t_from)) is distinct from 0 then raise exception 'an announcement naming no class is a class reveal'; end if;
  if (select (class, via, at) from class_reveals where character = debut_b) is distinct from ('alpha'::text, 'debut'::text, window_end) then
    raise exception 'a debut with its class is a reveal: %', (select to_jsonb(r) from class_reveals r where character = debut_b);
  end if;
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
  if (select count(*) from acts where kind = 'announce' and thread = th) is distinct from 6::bigint then raise exception 'a settlement applied twice wrote an announcement twice'; end if;
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
  debut uuid; turner uuid;
  n bigint := (select count(*) from acts where kind = 'announce');
  crashed boolean := false;
begin
  insert into characters (owner, name, created_at, debut_loudness) values (ann, 'An Crash Debut', now() - interval '1 hour', 'announced') returning id into debut;
  insert into class_history (character, class_key, started_at) values (debut, 'alpha', now() - interval '1 hour');
  turner := tests.character(ann, 'An Crash Turn', 'alpha', now() - interval '60 days');
  perform tests.become(ann); perform turn(turner, 'beta', 'announced', false, false); perform tests.unbecome();
  -- The Turn's Act is the second written (debuts first): the first is written, then the second fails.
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
  if (select debuted_at from characters where id = debut) is not null then raise exception 'a crashed settlement still debuted'; end if;
  if not exists (select 1 from pending_turns where character = turner) then raise exception 'a crashed settlement lost the pending Turn'; end if;
  if (select class_key from class_now(turner, 'infinity')) is distinct from 'alpha' then raise exception 'a crashed settlement still Turned'; end if;
  -- The run after it, with the cause gone, writes both.
  perform masks_change(window_end);
  if (select count(*) from acts where kind = 'announce') is distinct from n + 2 then raise exception 'the retried settlement wrote % announcements', (select count(*) from acts where kind = 'announce') - n; end if;
  if (select debuted_at from characters where id = debut) is distinct from window_end then raise exception 'the retried settlement debuted'; end if;
  if exists (select 1 from pending_turns where character = turner) then raise exception 'the retried settlement left the Turn pending'; end if;
end $$;

-- ---- Landing an announce takes the lock on its landing, so two transactions landing one thread and instant cannot split it ----
-- (A second connection cannot see this file's uncommitted rows, so the race itself is not driven; what the serialization is made of is: the lock.)
do $$
declare
  ann uuid := tests.account('an-lock');
  c uuid := tests.character(ann, 'An Lock', 'alpha', now() - interval '10 days');
  th uuid := (select turns_thread from seasons where ends_at is null);
  at timestamptz := now() + interval '6 minutes';
  k bigint := hashtextextended(th::text || '|' || at::text, 0);
begin
  if exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and classid = ((k >> 32) & 4294967295)::oid and objid = (k & 4294967295)::oid) then
    raise exception 'the landing''s lock is held before any Act lands';
  end if;
  perform write_announce(c, th, 'debut', null, null, at);
  if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and classid = ((k >> 32) & 4294967295)::oid and objid = (k & 4294967295)::oid and objsubid = 1) then
    raise exception 'landing an announce took no lock on its thread and instant';
  end if;
end $$;

-- ---- A drop announced with its class writes one announce at once, and opens the thread when it is the season's first ----
do $$
declare
  ann uuid := tests.account('an-drop');
  made jsonb;
  th uuid;
  n bigint := (select count(*) from acts where kind = 'announce');
begin
  update seasons set turns_thread = null where ends_at is null;
  perform tests.become(ann);
  made := create_character('An Dropper', 'alpha', 'now', 'with_class');
  perform tests.unbecome();
  th := (select turns_thread from seasons where ends_at is null);
  if th is null then raise exception 'the first drop of the season opened no thread'; end if;
  if (select count(*) from acts where kind = 'announce') is distinct from n + 1 then raise exception 'a drop wrote % announcements', (select count(*) from acts where kind = 'announce') - n; end if;
  if (select (a.kind, a.thread, a.payload, a.created_at, a.character) from acts a where a.kind = 'announce' and a.character = (made ->> 'id')::uuid)
     is distinct from ('announce'::text, th, '{"what": "debut", "class": "alpha"}'::jsonb, (select created_at from characters where id = (made ->> 'id')::uuid), (made ->> 'id')::uuid) then
    raise exception 'the drop''s Act: %', (select to_jsonb(a) from acts a where a.kind = 'announce' and a.character = (made ->> 'id')::uuid);
  end if;
  if made -> 'announcement' -> 'act' ->> 'id' is distinct from (select a.id::text from acts a where a.kind = 'announce' and a.character = (made ->> 'id')::uuid) then raise exception 'the drop answers with its Act: %', made -> 'announcement'; end if;
  if made -> 'announcement' -> 'thread' ->> 'id' is distinct from th::text then raise exception 'the drop answers with the thread it opened: %', made -> 'announcement'; end if;
  if made -> 'announcement' ? 'unmask' then raise exception 'a drop writes no unmask: %', made -> 'announcement'; end if;
  if (select via from class_reveals where character = (made ->> 'id')::uuid) is distinct from 'debut' then raise exception 'a drop with its class is a class reveal'; end if;
  -- A second drop joins the thread and answers with no thread.
  perform tests.become(ann);
  made := create_character('An Dropper Two', 'alpha', 'now', 'announced');
  perform tests.unbecome();
  if jsonb_typeof(made -> 'announcement' -> 'thread') is distinct from 'null' then raise exception 'a drop into an open thread opened one: %', made -> 'announcement'; end if;
  if (select thread from acts where kind = 'announce' and character = (made ->> 'id')::uuid) is distinct from th then raise exception 'the second drop is in the same thread'; end if;
end $$;

-- ---- A retired character owed an announcement across a gap gets none, and the settlement still runs ----
do $$
declare
  ann uuid := tests.account('an-retired');
  window_end timestamptz := now() + interval '2 minutes';
  gone uuid; stays uuid;
  first_id uuid;
begin
  insert into characters (owner, name, created_at, debuted_at, debut_loudness, debut_announcement_due, retired_at)
    values (ann, 'An Retiree', now() - interval '3 days', now() - interval '2 days', 'with_class', true, now() - interval '1 day') returning id into gone;
  insert into characters (owner, name, created_at, debuted_at, debut_loudness, debut_announcement_due)
    values (ann, 'An Stayer', now() - interval '3 days', now() - interval '2 days', 'announced', true) returning id into stays;
  insert into class_history (character, class_key, started_at) values (gone, 'alpha', now() - interval '3 days'), (stays, 'alpha', now() - interval '3 days');
  first_id := masks_change(window_end);
  if exists (select 1 from acts where kind = 'announce' and character = gone) then raise exception 'a retired character was announced'; end if;
  if not exists (select 1 from acts where kind = 'announce' and character = stays and id = first_id and created_at = window_end) then raise exception 'its fellow owed an announcement was not announced'; end if;
  if (select debut_announcement_due from characters where id = gone) then raise exception 'the retired character is still owed an announcement'; end if;
end $$;

-- ---- A staff character waiting to debut is debuted and announced by no Act, and the settlement goes on ----
do $$
declare
  window_end timestamptz := now() + interval '2 minutes 30 seconds';
  staffer uuid;
begin
  insert into characters (name, staff, staff_kind, created_at) values ('An Staffer', 'an-staffer', 'persona', now() - interval '1 hour') returning id into staffer;
  perform masks_change(window_end);
  if (select debuted_at from characters where id = staffer) is distinct from window_end then raise exception 'a waiting staff character still debuts'; end if;
  if exists (select 1 from acts where kind = 'announce' and character = staffer) then raise exception 'a staff character was announced'; end if;
end $$;

-- ---- A landing of 156 debuts is 156 Acts, one News item with a count of 156 and 20 names ----
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
      insert into characters (owner, name, created_at, debut_loudness) values (owner, format('An Big %s-%s', lpad(p::text, 2, '0'), q), now() - interval '2 hours', 'announced');
    end loop;
  end loop;
  insert into class_history (character, class_key, started_at) select id, 'alpha', created_at from characters where name like 'An Big %-%';
  first_act := masks_change(window_end);
  th := (select thread from acts where id = first_act);
  if (select count(*) from acts where kind = 'announce' and thread = th and created_at = window_end and character in (select id from characters where name like 'An Big %-%')) is distinct from 156::bigint then
    raise exception '156 debuts wrote % Acts', (select count(*) from acts where kind = 'announce' and thread = th and created_at = window_end);
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
  if item.detail #>> '{debuts,0,name}' is distinct from 'An Big 01-1' or item.detail #>> '{debuts,0,character}' is null then raise exception 'the names are the first by name, each with its character: %', item.detail -> 'debuts' -> 0; end if;
  if item.at is distinct from landed then raise exception 'the item is dated at its landing'; end if;
end $$;

-- ---- A drop landing at the very instant of a settlement, in the same thread, merges into the landing: one item, the count of both ----
do $$
declare
  ann uuid := tests.account('an-same');
  window_end timestamptz := now() + interval '4 minutes';
  waiting uuid; dropped uuid; turner uuid;
  th uuid := (select turns_thread from seasons where ends_at is null);
  item record;
  landing uuid;
  viewer uuid := tests.account('an-same-viewer');
begin
  insert into characters (owner, name, created_at, debut_loudness) values (ann, 'An Same Debut', now() - interval '1 hour', 'announced') returning id into waiting;
  dropped := tests.character(ann, 'An Same Drop', 'alpha', now() - interval '1 hour');
  turner := tests.character(ann, 'An Same Turn', 'alpha', now() - interval '60 days');
  insert into class_history (character, class_key, started_at) values (waiting, 'alpha', now() - interval '1 hour');
  perform tests.become(ann); perform turn(turner, 'beta', 'announced', false, false); perform tests.unbecome();
  perform announce_drop(dropped, window_end);
  perform masks_change(window_end);
  if (select count(*) from news_landed n join acts a on a.id = n.act where n.kind = 'announcements' and a.thread = th and a.created_at = window_end) is distinct from 1::bigint then raise exception 'the same instant is one landing'; end if;
  landing := (select n.act from news_landed n join acts a on a.id = n.act where a.thread = th and a.created_at = window_end);
  perform tests.become(viewer);
  select * into item from season_news(null, 50) s where s.act = landing;
  perform tests.unbecome();
  if item.count is distinct from 3 then raise exception 'the merged landing counts a debut, a drop and a Turn: %', to_jsonb(item); end if;
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
