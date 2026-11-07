-- The bar and the apology (docs/plans/2026-11-06-member-groups-plan.md, Task 6; the design is docs/plans/2026-11-06-member-groups-design.md, section 5).
--
--   barred(character, board)  whether a conferGroup move in force bars that character from that board (bars_now, 0120); a move past its expiry that the tick has not yet ended
--                           bars nobody. not_barred(character, board) is its refusal, as not_banned (0104) is the ban's: "<name> is barred from posting on <board> until <time>",
--                           plain and true, the time in UTC rounded up to the minute so it is never before the real end.
--   post, start_thread, spin, edit_post   each refuse a barred character after the ban's refusal (a banned and barred character is told of its ban) and after the board is found,
--                           beside not_the_systems. A spin's board is the board its thread opens on. post, start_thread and spin are 0118's (with `framing` and its alerts),
--                           edit_post is 0104's, otherwise unchanged. spin's body moved whole into spin_written (below), so that an apology writes exactly what a spin writes;
--                           spin is acting, the ban's refusal, then spin_written.
--   spin_written(origin, through, title, body, check_bar, framing)   the spin of 0118, with the bar as its one switch: apologize writes the same thread, Act and framed alerts,
--                           skipping only the bar.
--   setting_apology / settings_held   the `apology` setting (apologyEveryHours, apologyJudgeBatch, apologyRulingMaxWords), each a whole number, at least 1; engine/rules/instance.ts mirrors it.
--   apologize(move, through, title, body, framing)   a barred character's way out: the spin of the move Act (onto the board it bars, if that is where the spin opens), and a `pending` row in
--                           apologies (0120). One waiting at a time per move (a unique index and a lock), and one per character and move per apologyEveryHours unless the last was `returned`.
--   rule_apology(apology, verdict, ruling)   service role. accepted and rejected post the ruling as the move's staff character in the apology's thread, payload {ruling, apology};
--                           returned (the judgment failed) sets the row only. An accepted row is what the apologyAccepted demand reads, so the tick ends the move `met` within about
--                           demandCheckMinutes. A row not pending is never ruled on again.
--   pending_apologies()   service role. The waiting apologies, oldest first, at most apologyJudgeBatch, each with the character, the staff key, the move's params and stock line, and the words.
--
-- Masks. A bar is per character and public (the move's Act names it); an apology is a public spin by the barred character. The refusal names only the character's own name, the board
-- and the move's expiry, all of which the move's Act already shows. Nothing here reads an owner, a class or a reactor.
-- Ways out. A bar ends by itself at its expiry, by an accepted apology, by an admin's reversal, or on appeal. A waiting apology cannot stall the way: a judgment that fails returns the
-- row (`returned`), which opens the next apology at once, and a rejection waits apologyEveryHours before the next. A staff persona benched or not yet debuted writes no ruling post, but the
-- row is still set, so a ruling is never lost to the persona's office.
-- Append-only. The state of an apology lives in the apologies row, never in an Act; the ruling is an Act of its own.

-- ------------------------------------------------------------------------------------------------------- the bar ----

create function barred(in_character uuid, in_board uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from bars_now b where b.character = in_character and b.board = in_board and coalesce(b.expires_at > now(), true))
$$;
revoke execute on function barred(uuid, uuid) from public, anon;
grant execute on function barred(uuid, uuid) to authenticated, service_role;

-- The refusal every posting action of a barred character meets, called right after the board is found. Plain and out of character.
create function not_barred(who uuid, on_board uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  until timestamptz;
begin
  select max(b.expires_at) into until from bars_now b where b.character = who and b.board = on_board and coalesce(b.expires_at > now(), true);
  if exists (select 1 from bars_now b where b.character = who and b.board = on_board and coalesce(b.expires_at > now(), true)) then
    raise exception '% is barred from posting on % until %',
      (select c.name from characters c where c.id = who), coalesce((select n.name from boards_now n where n.id = on_board), 'this board'),
      coalesce(to_char(date_trunc('minute', until + interval '59.999999 seconds') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', 'a time not yet set')
      using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
end $$;
revoke execute on function not_barred(uuid, uuid) from public, anon, authenticated;
grant execute on function not_barred(uuid, uuid) to service_role;

-- post (0118), refusing a barred character after the board is found. Everything else as 0118 wrote it.
CREATE OR REPLACE FUNCTION public.post(in_thread uuid, through uuid, body text, quoting uuid DEFAULT NULL::uuid, framing uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  written uuid;
  sprung jsonb;
  candidate uuid;
  maybe uuid[];
  parked uuid[];
  locked uuid[];
  passes uuid[];
  setters uuid[];
begin
  perform acting(through);
  perform not_banned(through);
  perform within('body', body, 'postMaxLength');
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  perform not_barred(through, on_board);
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- What this post may pass: the thread's waiting backs on others' posts (the partial index), those that have sprung apart, since a
  -- sprung back is neither locked nor probed for a lock (a spring is public, and acts_one_spring finds it by index).
  select coalesce(array_agg(w.play) filter (where not w.sprung), '{}'), coalesce(array_agg(w.play) filter (where w.sprung), '{}') into maybe, parked
  from (select r.play, exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = r.play::text) as sprung
        from face_down_reply r join face_down f on f.play = r.play join acts p on p.id = f.post
        where r.thread = in_thread and r.passed_by is null and p.character is distinct from through) w;
  -- Plus the quoted post's live, unsprung back, passed or not.
  maybe := maybe || array(select f.play from face_down f
                          where f.post = quoting and f.ends_at > now() and f.play <> all (maybe)
                            and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text));
  -- Step 3: those backs with their reply rows, in `play` order, in one statement. A reply row is read as locked: a post that passed a
  -- back while this waited has stamped it, and it is not this post's to pass. spring_traps then finds each row already held.
  select coalesce(array_agg(b.play), '{}'), coalesce(array_agg(b.play) filter (where b.waits and b.poster is distinct from through), '{}'),
         coalesce(array_agg(b.setter), '{}')
    into locked, passes, setters
  from (select f.play, s.character as setter, p.character as poster, (r.passed_by is null and r.thread = in_thread) as waits
        from face_down f join face_down_reply r on r.play = f.play join acts s on s.id = f.play join acts p on p.id = f.post
        where f.play = any (maybe)
        order by f.play for update of f, r) b;
  -- Step 4: the thread whose seq the insert takes.
  perform 1 from threads where id = in_thread for no key update;
  -- Step 5: the poster's count row and every setter's, by character, each made first where it is missing.
  insert into character_post_counts (character)
  select distinct c from unnest(setters || through) c order by c on conflict do nothing;
  perform 1 from character_post_counts where character = any (setters || through) order by character for update;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  -- Only a back this post locked springs (the header's note on `held`).
  if quoting is not null then sprung := spring_traps('quote', quoting, written, held => locked); end if;
  -- Locked and read as waiting in step 3, so no other post can have stamped them.
  update face_down_reply set passed_by = written, passed_at = now() where play = any (passes);
  -- The sprung ones are stamped without waiting: a post that locked one in step 3 (it read the back unsprung) may hold the row and
  -- wait on this post's thread or count row, so a wait here could cross. A row held by another is skipped and stays waiting; the next
  -- post by another character stamps it.
  if cardinality(parked) > 0 then
    update face_down_reply set passed_by = written, passed_at = now()
    where play in (select r.play from face_down_reply r where r.play = any (parked) and r.passed_by is null order by r.play for update skip locked);
  end if;
  if sprung is null then
    for candidate in
      select f.post from face_down f join acts p on p.id = f.post
      where f.play = any (passes)
      group by f.post, p.seq order by p.seq desc
    loop
      sprung := spring_traps('reply', candidate, written, held => locked);
      exit when sprung is not null;
    end loop;
  end if;
  if quoting is not null then perform write_alert((select a.character from acts a where a.id = quoting), 'quote', null, written, auth.uid()); end if;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $function$;

-- start_thread (0118), refusing a barred character the same way. Everything else as 0118 wrote it.
CREATE OR REPLACE FUNCTION public.start_thread(board_slug text, through uuid, title text, body text, framing uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform acting(through);
  perform not_banned(through);
  perform within('title', title, 'titleMaxLength');
  perform within('body', body, 'postMaxLength');
  select id into on_board from boards where slug = board_slug;
  if on_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  perform not_barred(through, on_board);
  insert into threads (board, title) values (on_board, title) returning id into made;
  insert into acts (character, kind, thread, payload) values (through, 'post', made, jsonb_build_object('body', body)) returning id into written;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $function$;

-- spin_written: what a spin writes (0118's body, its framed alerts included), the bar its one switch. Called by spin with the bar on and by apologize with it off; the caller has
-- run acting and not_banned.
create function spin_written(origin uuid, through uuid, title text, body text, check_bar boolean, framing uuid[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform within('title', title, 'titleMaxLength');
  perform within('body', coalesce(body, ''), 'postMaxLength', true);
  select case when b.is_system then players_board() else b.id end into on_board
  from acts a join threads t on t.id = a.thread join boards b on b.id = t.board where a.id = origin and a.kind <> 'edit';
  if on_board is null then raise exception 'there is no such Act to spin from' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if check_bar then perform not_barred(through, on_board); end if;
  insert into threads (board, title, origin_act_id) values (on_board, title, origin) returning id into made;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'spin', made, origin, jsonb_build_object('title', title, 'body', coalesce(body, ''))) returning id into written;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $$;
revoke execute on function spin_written(uuid, uuid, text, text, boolean, uuid[]) from public, anon, authenticated;

-- spin (0118): acting, the ban's refusal, then the spin (its framed alerts included) with the bar checked against the board its thread opens on.
CREATE OR REPLACE FUNCTION public.spin(origin uuid, through uuid, title text, body text DEFAULT ''::text, framing uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform acting(through);
  perform not_banned(through);
  return spin_written(origin, through, title, body, true, framing);
end $function$;

-- edit_post (0104), refusing a barred character from the board of the post it edits. Everything else as 0104 wrote it.
CREATE OR REPLACE FUNCTION public.edit_post(target uuid, through uuid, body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  in_thread uuid;
  on_board uuid;
begin
  perform acting(through);
  perform not_banned(through);
  perform within('body', body, 'postMaxLength');
  select a.thread, t.board into in_thread, on_board from acts a join threads t on t.id = a.thread where a.id = target and a.kind = 'post' and a.character = through;
  if in_thread is null then raise exception 'that is not a post of this character''s' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  perform not_barred(through, on_board);
  insert into acts (character, kind, thread, target_act_id, payload) values (through, 'edit', in_thread, target, jsonb_build_object('body', body));
  return act_projection(target);
end $function$;

-- ----------------------------------------------------------------------------------------------------- settings ----

-- The `apology` setting: exactly the fields of ApologySettings (engine/rules/types.ts), each a whole number, at least 1 (`apologyRule` in engine/rules/instance.ts).
-- supabase/tests/0079-settings-held.sql lists its poisons and goods.
create function setting_apology(v jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  shape constant text := 'an object giving apologyEveryHours (the hours between a character''s apologies to one move), apologyJudgeBatch (the most apologies one run of the judge hears) and apologyRulingMaxWords (the most words of a ruling), each a whole number, at least 1';
  k text;
begin
  if jsonb_typeof(v) is distinct from 'object' then return shape; end if;
  select e into k from jsonb_object_keys(v) e where e <> all (array['apologyEveryHours', 'apologyJudgeBatch', 'apologyRulingMaxWords']) limit 1;
  if k is not null then return format('%s; "%s" is not one of its fields', shape, k); end if;
  foreach k in array array['apologyEveryHours', 'apologyJudgeBatch', 'apologyRulingMaxWords'] loop
    if not setting_whole(v -> k, 1) then return format('%s; "%s" is not', shape, k); end if;
  end loop;
  return null;
end $$;
revoke execute on function setting_apology(jsonb) from public, anon, authenticated;

-- settings_held (0118), also holding `apology`. Everything else as 0118 wrote it (its `framed` toast kind and the two search settings included).
create or replace function settings_held() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed'];
begin
  why := case new.key
    when 'walletCap' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'vote' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'halving' then case when not coalesce(jsonb_typeof(v) = 'number' and setting_positive(v) and (v #>> '{}')::numeric <= 1, false)
      then 'a fraction above 0 and at most 1' end
    when 'reactionCap' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'charactersPerPlayer' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'settlementCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'viewCountCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'meetingCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    -- The spans the earlier triggers hold, but let through with a field missing.
    when 'settlementLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'seasonLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'turnCooldown' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'inviteLifetime' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'setLasts' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'editGrace' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'presenceWindow' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'registrationMode' then case when v not in ('"open"', '"invite"', '"closed"') then '"open", "invite" or "closed"' end
    when 'postMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'titleMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'postsPerPage' then case when not setting_whole(v, 1) then 'a whole number of posts, at least 1' end
    when 'hotReplies' then case when not setting_whole(v, 1) then 'a whole number of replies, at least 1' end
    when 'presenceNames' then case when not setting_whole(v, 1) then 'a whole number of names, at least 1' end
    when 'presencePollSeconds' then case when not setting_whole(v, 10, 300) then 'a whole number of seconds from 10 to 300' end
    when 'cardSettings' then case when not setting_named_numbers(v) then 'an object of named numbers' end
    when 'systemEnabled' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'hints' then case when not coalesce(jsonb_typeof(v) = 'object'
        and setting_whole(v -> 'least', 1)
        and jsonb_typeof(v -> 'share') = 'number' and (v ->> 'share')::numeric > 0.5 and (v ->> 'share')::numeric <= 1
        and jsonb_typeof(v -> 'split') = 'number' and setting_positive(v -> 'split') and (v ->> 'split')::numeric <= 0.5
        and setting_span(v -> 'window', array['minute', 'day', 'week', 'month']), false)
      then 'an object giving least (a whole number of reactions, at least 1), share (above 0.5, at most 1), split (above 0, at most 0.5) and window (a span: a unit of minute, day, week or month and a whole count from 1 to 1000)' end
    when 'toastDefaults' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all (kinds))
        and (select count(*) = count(distinct e) from jsonb_array_elements(v) e), false)
      then 'a list of the kinds of alert that toast (' || array_to_string(kinds, ', ') || '), each named once' end
    when 'phases' then null  -- below: it needs a loop
    when 'inheritanceGraceDays' then case when not setting_whole(v, 0) then 'a whole number of days, at least 0' end
    when 'rosterRecentExcluded' then case when not setting_whole(v, 0) then 'a whole number of Bosses, at least 0' end
    when 'structuralHoldHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'microEventDailyCalls' then case when not setting_whole(v, 0) then 'a whole number of calls, at least 0' end
    when 'digestThreads' then case when not setting_whole(v, 1, 25) then 'a whole number of threads, at least 1 and at most 25' end
    when 'digestExcerpts' then case when not setting_whole(v, 1, 20) then 'a whole number of posts, at least 1 and at most 20' end
    when 'digestExcerptChars' then case when not setting_whole(v, 1, 1000) then 'a whole number of characters, at least 1 and at most 1000' end
    when 'memoryOpinions' then case when not setting_whole(v, 1) then 'a whole number of opinions, at least 1' end
    when 'memoryGrudges' then case when not setting_whole(v, 1) then 'a whole number of grudges, at least 1' end
    when 'memoryWheelhouse' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'memoryRealWorld' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'boardNameMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'moveExpiryMostDays' then case when not setting_whole(v, 1) then 'a whole number of days, at least 1' end
    when 'moveExpiryLeastHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'demandCheckMinutes' then case when not setting_whole(v, 1, 1440) then 'a whole number of minutes, at least 1 and at most 1440' end
    when 'demandChecksPerTick' then case when not setting_whole(v, 1, 1000) then 'a whole number of moves, at least 1 and at most 1000' end
    when 'searchLanguage' then case when not coalesce(jsonb_typeof(v) = 'string' and exists (select 1 from pg_ts_config c where c.cfgname = v #>> '{}'), false)
      then 'the name of a text search configuration this database holds (english or simple, for example)' end
    when 'searchRankPool' then case when not setting_whole(v, 100, 100000) then 'a whole number of matches from 100 to 100,000' end
    when 'pool' then setting_pool(v)
    when 'modBots' then setting_modbots(v)
    when 'warnBar' then setting_warnbar(v)
    when 'apology' then setting_apology(v)
    when 'modelTiers' then case when not coalesce(jsonb_typeof(v) = 'object'
        and jsonb_typeof(v -> 'strong') = 'string' and btrim(v ->> 'strong', E' \t\n\r\f\v') <> ''
        and jsonb_typeof(v -> 'light') = 'string' and btrim(v ->> 'light', E' \t\n\r\f\v') <> '', false)
      then 'an object naming a model id for "strong" and for "light"' end
    else null
  end;
  if new.key = 'phases' then
    shape := 'an object of honeymoon, reign and meltdown, each holding its numbers (honeymoon and meltdown also their days) as whole numbers, at least 1';
    if jsonb_typeof(v) <> 'object' then raise exception 'phases is %', shape using errcode = '23514'; end if;
    foreach phase in array array['honeymoon', 'reign', 'meltdown'] loop
      if jsonb_typeof(v -> phase) is distinct from 'object' then raise exception 'phases is %; "%" is missing', shape, phase using errcode = '23514'; end if;
      foreach pkey in array case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                                 else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end loop
        if not setting_whole(v -> phase -> pkey, 1) then raise exception 'phases is %; "%.%" is not', shape, phase, pkey using errcode = '23514'; end if;
      end loop;
      select k into pkey from jsonb_object_keys(v -> phase) k
        where k <> all (case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                             else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end) limit 1;
      if pkey is not null then raise exception 'phases is %; "%.%" is not a number a phase holds', shape, phase, pkey using errcode = '23514'; end if;
    end loop;
  end if;
  if why is not null then raise exception '% is %', new.key, why using errcode = '23514'; end if;
  return new;
end $$;

-- A number of the `apology` setting, the engine's default where the row is not there (a database seeded before this migration).
create function apology_setting(name text) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (s.value ->> name)::integer from settings s where s.key = 'apology'),
                  case name when 'apologyEveryHours' then 24 when 'apologyJudgeBatch' then 10 when 'apologyRulingMaxWords' then 80 end)
$$;
revoke execute on function apology_setting(text) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------- the apologies ----

-- One apology waiting per move, however two sessions race.
create unique index apologies_one_pending on apologies (move_act) where state = 'pending';

-- A barred character's apology to the move that bars it: the spin of the move's Act (the bar is the one thing skipped, since the apology is the way out of it), and a pending row
-- for the judge. The move is an open conferGroup move of this character's whose demand is apologyAccepted.
create function apologize(in_move uuid, through uuid, title text, body text, framing uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  every integer := apology_setting('apologyEveryHours');
  next_at timestamptz;
  made jsonb;
begin
  perform acting(through);
  perform not_banned(through);
  if not exists (
    select 1 from acts a join open_moves o on o.move_act = a.id
    where a.id = in_move and a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,character}' = through::text
      and a.payload #>> '{demand,kind}' = 'apologyAccepted' and coalesce(move_expires_at(a.id) > now(), true)
  ) then
    raise exception 'there is no move of this character''s that an apology can answer' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  -- Two apologies at once for one move would each find no row of the other's.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.apology.' || in_move::text, 0));
  if exists (select 1 from apologies x where x.move_act = in_move and x.state = 'pending') then
    raise exception 'an apology to that move is still waiting for a ruling' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  select max(x.created_at) + make_interval(hours => every) into next_at from apologies x
  where x.move_act = in_move and x.character = through and x.state in ('pending', 'accepted', 'rejected') and x.created_at > now() - make_interval(hours => every);
  if next_at is not null then
    raise exception 'this character has already apologized to that move in the last % hours; the next apology opens at % UTC', every,
      to_char(date_trunc('minute', next_at + interval '59.999999 seconds') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  made := spin_written(in_move, through, title, body, false, framing);
  insert into apologies (move_act, apology_act, character, state) values (in_move, (made -> 'act' ->> 'id')::uuid, through, 'pending');
  return made;
end $$;
revoke execute on function apologize(uuid, uuid, text, text, uuid[]) from public, anon;
grant execute on function apologize(uuid, uuid, text, text, uuid[]) to authenticated;

-- The judge's ruling, or the return of a judgment that failed. For accepted and rejected the ruling is a post by the move's staff character in the apology's thread, payload
-- {ruling, apology}; for returned the row only is set, so the character may apologize again at once. A row not pending is never ruled on twice.
create function rule_apology(in_apology bigint, verdict text, ruling text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ap apologies%rowtype;
  mv acts%rowtype;
  staff_key text;
  held text;
  said text := left(btrim(coalesce(ruling, '')), coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength'), 20000));
  written uuid;
begin
  if verdict is null or verdict not in ('accepted', 'rejected', 'returned') then
    raise exception 'a ruling is accepted, rejected or returned, not %', coalesce(verdict, 'nothing') using errcode = '22023';
  end if;
  select * into ap from apologies where id = in_apology for update;
  if not found then raise exception 'there is no apology %', in_apology using errcode = 'P0002'; end if;
  if ap.state <> 'pending' then raise exception 'that apology has already been ruled on' using errcode = '55000'; end if;
  if verdict <> 'returned' then
    if said = '' then raise exception 'a ruling on an apology has words' using errcode = '22023'; end if;
    select * into mv from acts where id = ap.move_act;
    select c.staff into staff_key from characters c where c.id = mv.character;
    select o.office into held from staff_office_now o where o.staff = staff_key;
    -- A persona benched or not yet debuted writes nothing (write_staff_act): the row is set all the same, so a ruling is never lost to its office.
    if held is null or held not in ('waiting', 'benched') then
      written := (write_staff_act(staff_key, 'post', (select a.thread from acts a where a.id = ap.apology_act), null,
        jsonb_build_object('body', said, 'ruling', verdict, 'apology', ap.apology_act)) ->> 'id')::uuid;
    end if;
  end if;
  update apologies set state = verdict, ruling_act = written where id = in_apology;
  return jsonb_build_object('apology', in_apology, 'state', verdict, 'ruling_act', written);
end $$;
revoke execute on function rule_apology(bigint, text, text) from public, anon, authenticated;
grant execute on function rule_apology(bigint, text, text) to service_role;

-- The apologies waiting for the judge: oldest first, one batch. What the judge needs to word a ruling in the move's staff member's voice, and no owner and no class.
create function pending_apologies() returns table (
  apology bigint, move_act uuid, apology_act uuid, "character" uuid, character_name text, staff text, kind text, params jsonb, line text, title text, body text, created_at timestamptz
) language sql stable security definer set search_path = public, pg_temp as $$
  select x.id, x.move_act, x.apology_act, x.character, c.name, s.staff, m.payload ->> 'kind', m.payload -> 'params',
         system_line('moveLanded', m.payload ->> 'kind', m.payload -> 'params', s.staff), a.payload ->> 'title', a.payload ->> 'body', x.created_at
  from apologies x
  join acts m on m.id = x.move_act join characters s on s.id = m.character
  join acts a on a.id = x.apology_act join characters c on c.id = x.character
  where x.state = 'pending'
  order by x.created_at, x.id
  limit apology_setting('apologyJudgeBatch')
$$;
revoke execute on function pending_apologies() from public, anon, authenticated;
grant execute on function pending_apologies() to service_role;
