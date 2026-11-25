-- A Turn announced at once and committed (supabase/migrations/0427_turns_announced_at_once.sql;
-- docs/plans/2026-11-24-staff-board-threads-plan.md, Task 1): turn() takes the thread an announced Turn is posted in and writes the
-- character's own `announce` Act there then, with `ahead`; the Turn is committed, so it stands until it takes effect; a silent Turn
-- is announced later by announce_turn(); the settlement writes no Act for a committed Turn and links its class_history row to the
-- announcement; class_reveals and turns_announced read an ahead announcement only once its Turn has landed. Every block runs: the
-- harness stops a file at its first error, so each block names its own accounts.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- A pending Turn's whole row, as its player's own screens read it through my_characters (the table grants a player some columns only).
create function pg_temp.pending(c uuid) returns pending_turns language sql security definer as $$ select * from pending_turns where character = c $$;

-- The migration exists at all, so a missing one fails here on an assertion and not on a missing function below.
do $$
begin
  if to_regprocedure('turn(uuid,text,text,boolean,boolean,uuid)') is null then raise exception 'turn takes the thread an announced Turn is posted in'; end if;
  if to_regprocedure('turn(uuid,text,text,boolean,boolean)') is not null then raise exception 'the five-argument turn is gone'; end if;
  if to_regprocedure('turn(uuid,text,text)') is not null then raise exception 'the three-argument turn is gone'; end if;
  if to_regprocedure('announce_turn(uuid,uuid,boolean,boolean)') is null then raise exception 'announce_turn exists'; end if;
  if to_regprocedure('write_announce(uuid,uuid,text,text,text,timestamptz,boolean)') is null then raise exception 'write_announce takes ahead'; end if;
  if to_regprocedure('write_announce(uuid,uuid,text,text,text,timestamptz)') is not null then raise exception 'the six-argument write_announce is gone'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'pending_turns' and column_name = 'announce_act') then raise exception 'pending_turns.announce_act exists'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'class_history' and column_name = 'announce_act') then raise exception 'class_history.announce_act exists'; end if;
  if not has_column_privilege('authenticated', 'class_history', 'announce_act', 'select') then raise exception 'class_history.announce_act is granted beside its other columns'; end if;
  if not has_function_privilege('authenticated', 'turn(uuid,text,text,boolean,boolean,uuid)', 'execute') then raise exception 'turn is granted to authenticated'; end if;
  if has_function_privilege('anon', 'turn(uuid,text,text,boolean,boolean,uuid)', 'execute') then raise exception 'turn is not granted to anon'; end if;
  if not has_function_privilege('authenticated', 'announce_turn(uuid,uuid,boolean,boolean)', 'execute') then raise exception 'announce_turn is granted to authenticated'; end if;
  if has_function_privilege('authenticated', 'write_announce(uuid,uuid,text,text,text,timestamptz,boolean)', 'execute') then raise exception 'write_announce is nobody''s but the functions that call it'; end if;
end $$;

-- The fixtures hold two classes; a change of class needs a third.
insert into class_kinds (key, name) values ('gamma', 'Gamma');

-- ---- A Turn announced in a thread writes one announce Act there at once, with `ahead`, and commits ----
do $$
declare
  ann uuid := tests.account('tao-ann');
  both_ uuid := tests.character(ann, 'Tao Names Both', 'alpha', now() - interval '60 days');
  from_ uuid := tests.character(ann, 'Tao Names Was', 'alpha', now() - interval '60 days');
  to_ uuid := tests.character(ann, 'Tao Names Is', 'alpha', now() - interval '60 days');
  plain uuid := tests.character(ann, 'Tao Names None', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Where the Turn is said');
  said jsonb;
  p jsonb;
begin
  perform tests.become(ann);
  said := turn(both_, 'beta', 'announced', true, true, t);
  perform tests.unbecome();
  if said ->> 'pending' is distinct from 'true' or said ->> 'class' is distinct from 'beta' or said ->> 'loudness' is distinct from 'announced' then raise exception 'the answer keeps today''s fields: %', said; end if;
  if said ->> 'takes_effect_at' is null and next_settlement_at() is not null then raise exception 'the answer still says when it takes effect: %', said; end if;
  p := said -> 'announcement';
  if p is null then raise exception 'the answer carries the announcement: %', said; end if;
  if p ->> 'kind' is distinct from 'announce' or (p ->> 'character')::uuid is distinct from both_ or (p ->> 'thread')::uuid is distinct from t then
    raise exception 'the announcement is the character''s own Act in the thread chosen: %', p;
  end if;
  if p -> 'payload' is distinct from '{"what": "turn", "was": "alpha", "class": "beta", "ahead": true}'::jsonb then raise exception 'a Turn naming both, ahead: %', p -> 'payload'; end if;
  if (select count(*) from acts where kind = 'announce' and character = both_) is distinct from 1::bigint then raise exception 'one announce Act at once'; end if;
  if (select a.created_at from acts a where a.id = (p ->> 'id')::uuid) > clock_timestamp() or (select a.created_at from acts a where a.id = (p ->> 'id')::uuid) < now() - interval '1 minute' then
    raise exception 'the announcement is dated when it was written';
  end if;
  if (pg_temp.pending(both_)).announce_act is distinct from (p ->> 'id')::uuid then raise exception 'the pending Turn holds its announcement''s id'; end if;
  if (select loudness from pending_turns where character = both_) is distinct from 'announced' then raise exception 'the pending Turn is announced'; end if;
  -- The other three shapes: only what the player chose to name.
  perform tests.become(ann);
  p := turn(from_, 'beta', 'announced', true, false, t) -> 'announcement' -> 'payload';
  if p is distinct from '{"what": "turn", "was": "alpha", "ahead": true}'::jsonb then raise exception 'a Turn naming what it was: %', p; end if;
  p := turn(to_, 'beta', 'announced', false, true, t) -> 'announcement' -> 'payload';
  if p is distinct from '{"what": "turn", "class": "beta", "ahead": true}'::jsonb then raise exception 'a Turn naming what it is: %', p; end if;
  p := turn(plain, 'beta', 'announced', false, false, t) -> 'announcement' -> 'payload';
  if p is distinct from '{"what": "turn", "ahead": true}'::jsonb then raise exception 'a plain "has Turned": %', p; end if;
  perform tests.unbecome();
  -- Nothing about it changes the character's class yet.
  if (select class_key from class_now(both_, 'infinity')) is distinct from 'alpha' then raise exception 'the Turn has not taken effect'; end if;
end $$;

-- ---- A committed Turn refuses any change and any withdrawal, in words that say when it ends ----
do $$
declare
  ann uuid := tests.account('tao-c-ann');
  a uuid := tests.character(ann, 'Tao Committed', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Committed here');
  said jsonb;
  why text;
  words text;
begin
  perform tests.become(ann);
  said := turn(a, 'beta', 'announced', false, true, t);
  perform tests.unbecome();
  words := 'that Turn was announced, so it stands until it takes effect at ' ||
           coalesce(refusal_time(next_settlement_at((select asked_at from pending_turns where character = a))), 'the next settlement');
  perform tests.become(ann);
  why := pg_temp.refusal(format('select turn(%L, %L, %L, false, true, %L)', a, 'gamma', 'announced', t));
  if why is distinct from '42501: ' || words then raise exception 'a changed class: %', why; end if;
  why := pg_temp.refusal(format('select turn(%L, %L, %L, false, false, null)', a, 'beta', 'silent'));
  if why is distinct from '42501: ' || words then raise exception 'a Turn made silent: %', why; end if;
  why := pg_temp.refusal(format('select turn(%L, %L, %L, true, true, %L)', a, 'beta', 'announced', t));
  if why is distinct from '42501: ' || words then raise exception 'the same Turn asked again: %', why; end if;
  why := pg_temp.refusal(format('select withdraw_turn(%L)', a));
  if why is distinct from '42501: ' || words then raise exception 'a withdrawal: %', why; end if;
  perform tests.unbecome();
  if (select class_key from pending_turns where character = a) is distinct from 'beta' then raise exception 'the committed Turn stands'; end if;
  if (select count(*) from acts where kind = 'announce' and character = a) is distinct from 1::bigint then raise exception 'a refusal wrote no Act'; end if;
  -- The refusal is said to its player, about a character it names; another player's call is refused as for any character.
  perform tests.become(tests.account('tao-c-bob'));
  why := pg_temp.refusal(format('select withdraw_turn(%L)', a));
  if why is null or why not like '%play that character%' then raise exception 'another player''s withdrawal is refused as any is: %', why; end if;
  perform tests.unbecome();
end $$;

-- ---- A silent Turn changes and withdraws as it did; announce_turn announces and commits it ----
do $$
declare
  ann uuid := tests.account('tao-s-ann');
  a uuid := tests.character(ann, 'Tao Silent', 'alpha', now() - interval '60 days');
  b uuid := tests.character(ann, 'Tao Silent Two', 'alpha', now() - interval '60 days');
  c uuid := tests.character(ann, 'Tao Silent Three', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Announced later');
  said jsonb;
  why text;
begin
  perform tests.become(ann);
  perform turn(a, 'beta', 'silent', false, false, null);
  if (select count(*) from acts_public where kind = 'announce' and character = a) is distinct from 0::bigint then raise exception 'a silent Turn writes no Act'; end if;
  perform turn(a, 'gamma', 'silent', false, false, null);
  if (select class_key from pending_turns where character = a) is distinct from 'gamma' then raise exception 'a silent Turn changes'; end if;
  perform withdraw_turn(a);
  if exists (select 1 from pending_turns where character = a) then raise exception 'a silent Turn withdraws'; end if;
  -- A silent Turn with no pending Turn: nothing to announce.
  why := pg_temp.refusal(format('select announce_turn(%L, %L, true, true)', a, t));
  if why is distinct from 'P0002: no Turn of that character is waiting' then raise exception 'announce with no Turn: %', why; end if;
  -- Announcing a waiting silent Turn.
  perform turn(a, 'beta', 'silent', false, false, null);
  said := announce_turn(a, t, true, false);
  if said -> 'announcement' -> 'payload' is distinct from '{"what": "turn", "was": "alpha", "ahead": true}'::jsonb then raise exception 'announce_turn names what the player chose: %', said; end if;
  if (said -> 'announcement' ->> 'thread')::uuid is distinct from t or (said -> 'announcement' ->> 'character')::uuid is distinct from a then raise exception 'announced in its thread, by its character: %', said; end if;
  if said ->> 'class' is distinct from 'beta' or said ->> 'pending' is distinct from 'true' then raise exception 'announce_turn answers as turn does: %', said; end if;
  if (pg_temp.pending(a)).announce_act is distinct from (said -> 'announcement' ->> 'id')::uuid then raise exception 'announce_turn commits the Turn'; end if;
  if (select (x.loudness, x.show_from, x.show_to) from (select (pg_temp.pending(a)).*) x) is distinct from ('announced'::text, true, false) then raise exception 'the pending Turn now says what it announced'; end if;
  why := pg_temp.refusal(format('select announce_turn(%L, %L, true, true)', a, t));
  if why is distinct from '55000: that Turn was announced already' then raise exception 'announced twice: %', why; end if;
  why := pg_temp.refusal(format('select withdraw_turn(%L)', a));
  if why not like '42501: that Turn was announced, so it stands until it takes effect at %' then raise exception 'an announced-later Turn is committed: %', why; end if;
  -- Both show flags false is allowed: a plain "has Turned".
  perform turn(b, 'beta', 'silent', false, false, null);
  said := announce_turn(b, t, false, false);
  if said -> 'announcement' -> 'payload' is distinct from '{"what": "turn", "ahead": true}'::jsonb then raise exception 'a plain announcement: %', said; end if;
  -- A Turn the player has not asked for is announced nowhere; a character that is not theirs is refused as any is.
  why := pg_temp.refusal(format('select announce_turn(%L, %L, true, true)', c, t));
  if why is distinct from 'P0002: no Turn of that character is waiting' then raise exception 'announce with no Turn: %', why;  end if;
  perform tests.unbecome();
  perform tests.become(tests.account('tao-s-bob'));
  why := pg_temp.refusal(format('select announce_turn(%L, %L, true, true)', a, t));
  if why is null or why not like '%play that character%' then raise exception 'announcing another player''s Turn: %', why; end if;
  perform tests.unbecome();
end $$;

-- ---- The shape of a request: announced needs a thread, silent takes none ----
do $$
declare
  ann uuid := tests.account('tao-r-ann');
  a uuid := tests.character(ann, 'Tao Shapes', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Shapes');
  why text;
begin
  perform tests.become(ann);
  why := pg_temp.refusal(format('select turn(%L, %L, %L, false, false, null)', a, 'beta', 'announced'));
  if why is null or why not like '22023:%' then raise exception 'an announced Turn with no thread: %', why; end if;
  why := pg_temp.refusal(format('select turn(%L, %L, %L, false, false, %L)', a, 'beta', 'silent', t));
  if why is distinct from '22023: a silent Turn is posted nowhere' then raise exception 'a silent Turn with a thread: %', why; end if;
  -- 0074's refusals stay: no class, bad loudness, a silent Turn naming a class.
  why := pg_temp.refusal(format('select turn(%L, %L, %L, false, false, %L)', a, 'ghost', 'announced', t));
  if why is distinct from '22023: there is no class "ghost"' then raise exception 'a Turn to no class: %', why; end if;
  why := pg_temp.refusal(format('select turn(%L, %L, %L, true, false, null)', a, 'beta', 'silent'));
  if why is distinct from '22023: a silent Turn names no class' then raise exception 'a silent Turn naming a class: %', why; end if;
  if exists (select 1 from pending_turns where character = a) then raise exception 'a refused Turn queued nothing'; end if;
  perform tests.unbecome();
end $$;

-- ---- The thread's checks are those of a post and a reveal: it exists, it is not The System's, the character is not locked out of it, its board is open, the character is not barred from it ----
do $$
declare
  ann uuid := tests.account('tao-t-ann');
  a uuid := tests.character(ann, 'Tao Threads', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Checked');
  on_system uuid;
  why text;
  p uuid;
  back uuid;
  ends timestamptz;
  free uuid := tests.character(ann, 'Tao Free', 'alpha', now() - interval '60 days');
begin
  insert into threads (board, title) values (system_board(), 'The System speaks') returning id into on_system;
  perform tests.become(ann);
  why := pg_temp.refusal(format('select turn(%L, %L, %L, false, false, %L)', a, 'beta', 'announced', gen_random_uuid()));
  if why is distinct from 'P0002: there is no such thread' then raise exception 'a thread that is not there: %', why; end if;
  why := pg_temp.refusal(format('select turn(%L, %L, %L, false, false, %L)', a, 'beta', 'announced', on_system));
  if why is null or why not like '%only the staff post here%' then raise exception 'a thread on The System''s board: %', why; end if;
  why := pg_temp.refusal(format('select announce_turn(%L, %L, false, false)', a, on_system));
  if why is distinct from 'P0002: no Turn of that character is waiting' then raise exception 'announce_turn finds its Turn before its thread: %', why; end if;
  perform turn(a, 'beta', 'silent', false, false, null);
  why := pg_temp.refusal(format('select announce_turn(%L, %L, false, false)', a, on_system));
  if why is null or why not like '%only the staff post here%' then raise exception 'announce_turn in a thread on The System''s board: %', why; end if;
  perform tests.unbecome();
  if exists (select 1 from acts where kind = 'announce' and character = a) then raise exception 'a refusal wrote an Act'; end if;
  if (pg_temp.pending(a)).announce_act is not null then raise exception 'a refused announce_turn committed the Turn'; end if;

  -- Locked out of the thread by a lockedOut spring: refused as a post is, and the Turn is not queued.
  p := tests.post(a, t, 'Held.');
  back := tests.act(a, 'set', t, '{}', p);
  perform tests.act(a, 'spring', t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', back::text, 'locks', a::text, 'until', (now() + interval '1 day')::text), p);
  ends := (select lockout_ends(s.id) from acts s where s.kind = 'spring' and s.payload ->> 'locks' = a::text);
  perform tests.become(ann);
  perform turn(free, 'beta', 'announced', false, false, t);
  if not exists (select 1 from pending_turns where character = free) then raise exception 'a lockout holds only the character it names'; end if;
  why := pg_temp.refusal(format('select announce_turn(%L, %L, false, false)', a, t));
  if why is distinct from '55000: Tao Threads is locked out of this thread until ' || to_char(date_trunc('minute', ends + interval '59.999999 seconds') at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
     || ' UTC; the lockout ends by itself then, and it holds only this character, not your other characters' then
    raise exception 'announce_turn in a thread the character is locked out of: %', why;
  end if;
  perform tests.unbecome();
end $$;

-- ---- class_reveals and turns_announced: an ahead announcement is a reveal, dated the settlement, only once its Turn has landed ----
do $$
declare
  ann uuid := tests.account('tao-v-ann');
  a uuid := tests.character(ann, 'Tao Reveals', 'alpha', now() - interval '60 days');
  b uuid := tests.character(ann, 'Tao Reveals Old Class', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Reveals');
  window_end timestamptz := now() + interval '1 minute';
  said jsonb;
  old_one jsonb;
  announced uuid;
begin
  perform tests.become(ann);
  said := turn(a, 'beta', 'announced', true, true, t);
  old_one := turn(b, 'beta', 'announced', true, false, t);
  perform tests.unbecome();
  announced := (said -> 'announcement' ->> 'id')::uuid;
  -- Before the settlement: the announcement is public as an Act and a reveal of nothing.
  if exists (select 1 from class_reveals where character = a) then raise exception 'an ahead announcement is no reveal before its Turn lands: %', (select jsonb_agg(r) from class_reveals r where character = a); end if;
  if exists (select 1 from turns_announced where character = a) then raise exception 'an ahead announcement is no Turn taken before it lands'; end if;
  -- The settlement lands the Turn and writes no Act for it.
  perform masks_change(window_end);
  if (select count(*) from acts where kind = 'announce' and character = a) is distinct from 1::bigint then raise exception 'the settlement wrote an Act for a committed Turn'; end if;
  if (select class_key from class_now(a, window_end)) is distinct from 'beta' then raise exception 'the committed Turn took effect'; end if;
  if exists (select 1 from pending_turns where character = a) then raise exception 'the committed Turn is no longer pending'; end if;
  if (select announce_act from class_history where character = a and started_at = window_end) is distinct from announced then raise exception 'the landing is linked to its announcement'; end if;
  if (select (class, at, via, thread, act) from class_reveals where character = a) is distinct from ('beta'::text, window_end, 'turn'::text, t, announced) then
    raise exception 'after the settlement the announcement is a reveal dated the settlement: %', (select jsonb_agg(r) from class_reveals r where character = a);
  end if;
  if (select count(*) from class_reveals where character = a) is distinct from 1::bigint then raise exception 'one reveal'; end if;
  if (select (at, was, act) from turns_announced where character = a) is distinct from (window_end, 'alpha'::text, announced) then
    raise exception 'turns_announced dates it at the landing: %', (select jsonb_agg(r) from turns_announced r where character = a);
  end if;
  -- A Turn announced naming only its old class is no reveal of the new one, and is still a Turn taken.
  if exists (select 1 from class_reveals where character = b and class = 'beta') then raise exception 'a Turn naming only its old class reveals no new class'; end if;
  if (select count(*) from turns_announced where character = b) is distinct from 1::bigint then raise exception 'a Turn naming only its old class is a Turn taken'; end if;
end $$;

-- ---- masks_change: an announced Turn queued before this migration (no announce_act) is written the old way, in the Promos thread ----
do $$
declare
  ann uuid := tests.account('tao-o-ann');
  a uuid := tests.character(ann, 'Tao Queued Before', 'alpha', now() - interval '60 days');
  window_end timestamptz := now() + interval '1 minute';
  th uuid;
  written record;
begin
  insert into pending_turns (character, class_key, loudness, show_from, show_to, asked_at) values (a, 'beta', 'announced', true, true, now() - interval '1 hour');
  update seasons set turns_thread = null where ends_at is null;
  perform masks_change(window_end);
  th := (select turns_thread from seasons where ends_at is null);
  if th is null then raise exception 'the old way opens the Promos thread'; end if;
  select * into written from acts where kind = 'announce' and character = a;
  if written.id is null or written.thread is distinct from th or written.created_at is distinct from window_end then raise exception 'the old way writes the Act in the Promos thread at the settlement: %', written; end if;
  if written.payload is distinct from '{"what": "turn", "was": "alpha", "class": "beta"}'::jsonb then raise exception 'the old Act is not ahead: %', written.payload; end if;
  if (select count(*) from class_reveals where character = a and at = window_end) is distinct from 1::bigint then raise exception 'an old announcement is read as today'; end if;
  if (select announce_act from class_history where character = a and started_at = window_end) is not null then raise exception 'an old Turn''s landing links to no announcement'; end if;
end $$;

-- ---- acts_well_formed: no new debut announcement; an ahead announcement names its Turn's class ----
do $$
declare
  ann uuid := tests.account('tao-w-ann');
  a uuid := tests.character(ann, 'Tao Forms', 'alpha', now() - interval '60 days');
  b uuid := tests.character(ann, 'Tao Forms Pending', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Well formed');
  why text;
begin
  why := pg_temp.refusal(format('select tests.act(%L, ''announce'', %L, ''{"what": "debut"}'')', a, t));
  if why is distinct from '23514: a debut is no longer announced' then raise exception 'a new debut announcement: %', why; end if;
  -- A Turn announcement not ahead names the class held, as today.
  why := pg_temp.refusal(format('select tests.act(%L, ''announce'', %L, ''{"what": "turn", "class": "alpha"}'')', a, t));
  if why is not null then raise exception 'an announcement naming the class held: %', why; end if;
  why := pg_temp.refusal(format('select tests.act(%L, ''announce'', %L, ''{"what": "turn", "class": "beta"}'')', a, t));
  if why is distinct from '23514: an announce names the class its character holds' then raise exception 'a not-ahead announcement naming another class: %', why; end if;
  -- An ahead one names the class of the pending Turn.
  why := pg_temp.refusal(format('select tests.act(%L, ''announce'', %L, ''{"what": "turn", "class": "beta", "ahead": true}'')', b, t));
  if why is null or why not like '23514:%' then raise exception 'an ahead announcement with no Turn waiting: %', why; end if;
  insert into pending_turns (character, class_key, loudness) values (b, 'beta', 'silent');
  why := pg_temp.refusal(format('select tests.act(%L, ''announce'', %L, ''{"what": "turn", "class": "gamma", "ahead": true}'')', b, t));
  if why is null or why not like '23514:%' then raise exception 'an ahead announcement naming a class other than the pending one: %', why; end if;
  why := pg_temp.refusal(format('select tests.act(%L, ''announce'', %L, ''{"what": "turn", "class": "beta", "ahead": true}'')', b, t));
  if why is not null then raise exception 'an ahead announcement naming the pending class: %', why; end if;
  why := pg_temp.refusal(format('select tests.act(%L, ''announce'', %L, ''{"what": "turn", "was": "alpha", "ahead": true}'')', a, t));
  if why is not null then raise exception 'an ahead announcement naming no class needs no Turn: %', why; end if;
  -- A debut announcement already written is untouched, and the settlement's own debut writer still writes one while the debut half stays (Task 2 removes it).
  if write_announce(a, t, 'debut', null, null, now()) is null then raise exception 'the debut writer still writes'; end if;
end $$;

-- ---- A retired character's committed Turn is deleted, its announcement stays, and it is never a reveal ----
do $$
declare
  ann uuid := tests.account('tao-x-ann');
  adm uuid := tests.account('tao-x-adm');
  a uuid := tests.character(ann, 'Tao Retired', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Retiring');
  window_end timestamptz := now() + interval '1 minute';
  said jsonb;
begin
  insert into admins (account) values (adm) on conflict do nothing;
  perform tests.become(ann);
  said := turn(a, 'beta', 'announced', true, true, t);
  perform tests.unbecome();
  perform tests.become(adm);
  perform retire_character(a);
  perform tests.unbecome();
  if exists (select 1 from pending_turns where character = a) then raise exception 'retiring deleted the committed Turn'; end if;
  if (select count(*) from acts where kind = 'announce' and character = a) is distinct from 1::bigint then raise exception 'the announcement stays as written'; end if;
  perform masks_change(window_end);
  if exists (select 1 from class_reveals where character = a) then raise exception 'a retired character''s announcement is never a reveal'; end if;
  if exists (select 1 from turns_announced where character = a) then raise exception 'a retired character''s committed Turn never counts'; end if;
end $$;

-- ---- A closed board's thread and a barred character refuse as they do for a post (last in the file: it replaces two functions for the rest of the transaction) ----
do $$
declare
  ann uuid := tests.account('tao-cb-ann');
  a uuid := tests.character(ann, 'Tao Closed', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Closed here');
  why text;
begin
  -- not_closed and not_barred are tested where they are made (0184, 0127); here only that a Turn asks them, in the order post asks them:
  -- the board's openness, then the bar. They are replaced for this transaction by ones that say which was asked.
  create or replace function not_closed(on_board uuid) returns void language plpgsql as $f$ begin raise exception 'asked: not_closed' using errcode = '55000'; end $f$;
  perform tests.become(ann);
  why := pg_temp.refusal(format('select turn(%L, %L, %L, false, false, %L)', a, 'beta', 'announced', t));
  if why is distinct from '55000: asked: not_closed' then raise exception 'announced Turn asks whether the board is open: %', why; end if;
  perform tests.unbecome();
  create or replace function not_closed(on_board uuid) returns void language plpgsql as $f$ begin return; end $f$;
  create or replace function not_barred(who uuid, on_board uuid) returns void language plpgsql as $f$ begin raise exception 'asked: not_barred' using errcode = '55000'; end $f$;
  perform tests.become(ann);
  why := pg_temp.refusal(format('select turn(%L, %L, %L, false, false, %L)', a, 'beta', 'announced', t));
  if why is distinct from '55000: asked: not_barred' then raise exception 'announced Turn asks whether the character is barred: %', why; end if;
  why := pg_temp.refusal(format('select turn(%L, %L, %L, false, false, null)', a, 'beta', 'silent'));
  if why is not null then raise exception 'a silent Turn asks nothing of a board: %', why; end if;
  perform tests.unbecome();
end $$;
