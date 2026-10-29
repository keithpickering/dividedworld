-- A new character drops now or debuts at the tally, each silent or announced
-- (supabase/migrations/0024_debuts.sql): a drop acts at once and is in every list; an announced
-- drop is one tally Act, at once, on The System's board; a silent debut is named in no tally; a
-- waiting character may be dropped or have its loudness changed by its player until it debuts;
-- the season's reveal names every character. The clues plan, Task 3.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The tallies naming a character.
create function pg_temp.named_in(who uuid) returns bigint language sql as $$
  select count(*) from acts a, jsonb_array_elements(a.payload -> 'debuts') d where a.kind = 'tally' and d ->> 'character' = who::text
$$;

-- ---- A drop racing the settlement that would debut it: debuted and named once. First in the
-- file, since a block after it holds the season's row, which both racers lock ----
do $$
declare
  ann uuid := gen_random_uuid(); w uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-drop@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, created_at, debut_loudness) values (%2$L, %1$L, 'Race Drop', now() - interval '1 hour', 'announced');
    insert into class_history (character, class_key, started_at) values (%2$L, 'alpha', now() - interval '1 hour');
    -- The settlement's own step, which only apply_settlement() calls, run by the racing service.
    create function tests.masks_change(window_end timestamptz) returns uuid language sql security definer set search_path = public, pg_temp as $f$ select masks_change(window_end) $f$;
    grant usage on schema tests to service_role;
    grant execute on function tests.masks_change(timestamptz) to service_role;
  $sql$, ann, w));
  said := tests.race_as(ann, format('select set_debut(%L, %L, %L)', w, 'now', 'announced'), null, format('select tests.masks_change(%L)', now() + interval '1 minute'));
  -- Whichever went first debuted it; the other refused (the drop: "it has debuted") or skipped it.
  if said[2] is not null then raise exception 'the settlement failed racing a drop: %', said; end if;
  if said[1] is not null and said[1] is distinct from 'it has debuted' then raise exception 'a drop racing the settlement failed otherwise: %', said; end if;
  if (select debuted_at from characters where id = w) is null then raise exception 'a character raced to debut never debuted'; end if;
  if pg_temp.named_in(w) is distinct from 1::bigint then raise exception 'a drop racing the settlement was named % times', pg_temp.named_in(w); end if;
end $$;

-- ---- Two drops at once into a season whose Turns thread is not open: one thread, both named in it ----
do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-drop-a@test.invalid'), (%2$L, 'race-drop-b@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    update seasons set turns_thread = null where ends_at is null;
  $sql$, ann, bob));
  said := tests.race(ann, 'select create_character(''Racing Drop A'', ''alpha'', ''now'', ''announced'')', bob, 'select create_character(''Racing Drop B'', ''alpha'', ''now'', ''announced'')');
  if said[1] is not null or said[2] is not null then raise exception 'two drops at once: %', said; end if;
  if (select count(distinct a.thread) from acts a, jsonb_array_elements(a.payload -> 'debuts') d where a.kind = 'tally' and d ->> 'name' in ('Racing Drop A', 'Racing Drop B')) is distinct from 1::bigint then
    raise exception 'two drops at once opened two Turns threads';
  end if;
  if (select turns_thread from seasons where ends_at is null) is distinct from (select a.thread from acts a, jsonb_array_elements(a.payload -> 'debuts') d where a.kind = 'tally' and d ->> 'name' = 'Racing Drop A') then
    raise exception 'the season holds the thread both were named in';
  end if;
end $$;

-- ---- The defaults are create_character(name, class) as it was: waiting, announced, no tally ----
do $$
declare
  ann uuid := tests.account('debut-default');
  made jsonb;
  tallies bigint := (select count(*) from acts where kind = 'tally');
begin
  perform tests.become(ann);
  made := create_character('Default Debut', 'alpha');
  perform tests.unbecome();
  if not (made ->> 'waiting')::boolean or made ->> 'loudness' is distinct from 'announced' or made -> 'announcement' <> 'null'::jsonb then raise exception 'the defaults wait to be announced at the tally: %', made; end if;
  if (select (debuted_at, debut_loudness) from characters where id = (made ->> 'id')::uuid) is distinct from (null::timestamptz, 'announced'::text) then raise exception 'a default character waits'; end if;
  if (select count(*) from acts where kind = 'tally') is distinct from tallies then raise exception 'a default character was announced before the tally'; end if;
end $$;

-- ---- A drop acts at once and is in every list; announced, The System names it at once ----
do $$
declare
  ann uuid := tests.account('drop-ann');
  bob uuid := tests.account('drop-bob');
  made jsonb;
  loud uuid;
  quiet uuid;
  t uuid := tests.thread('Dropped into');
  tally acts%rowtype;
  tallies bigint;
begin
  -- The season's Turns thread not yet open (the race above may have opened it), so this drop opens it.
  update seasons set turns_thread = null where ends_at is null;
  perform tests.become(ann);
  made := create_character('Loud Drop', 'alpha', 'now', 'announced');
  loud := (made ->> 'id')::uuid;
  if (made ->> 'waiting')::boolean then raise exception 'a drop says it is not waiting: %', made; end if;
  -- It acts at once.
  if pg_temp.refusal(format('select post(%L, %L, %L)', t, loud, 'Here already.')) is not null then
    raise exception 'a dropped character acts at once: %', pg_temp.refusal(format('select post(%L, %L, %L)', t, loud, 'Here already.'));
  end if;
  perform tests.unbecome();
  if (select debuted_at from characters where id = loud) is distinct from (select created_at from characters where id = loud) then raise exception 'a dropped character acts at once, debuted from its creation'; end if;
  perform tests.become(bob);
  if not exists (select 1 from characters_public where id = loud) then raise exception 'a dropped character is in the public list'; end if;
  if not exists (select 1 from season_standings where character = loud) then raise exception 'a dropped character is in the season''s standings'; end if;
  perform tests.unbecome();
  -- One tally Act names it, at once, by The System, on The System's board, sent live by the answer.
  if pg_temp.named_in(loud) is distinct from 1::bigint then raise exception 'an announced drop is named in one tally: %', pg_temp.named_in(loud); end if;
  select a.* into tally from acts a, jsonb_array_elements(a.payload -> 'debuts') d where a.kind = 'tally' and d ->> 'character' = loud::text;
  if tally.character is not null or (select board from threads where id = tally.thread) is distinct from system_board() then raise exception 'the announcement is The System''s, on its board'; end if;
  if tally.thread is distinct from (select turns_thread from seasons where ends_at is null) then raise exception 'the announcement is in the season''s Turns thread'; end if;
  if tally.payload is distinct from jsonb_build_object('season', (select number from seasons where ends_at is null), 'part', 1, 'of', 1, 'debuts', jsonb_build_array(jsonb_build_object('character', loud, 'name', 'Loud Drop')), 'turns', '[]'::jsonb) then
    raise exception 'a drop''s announcement is a tally of one debut: %', tally.payload;
  end if;
  if (made -> 'announcement' -> 'act' ->> 'id')::uuid is distinct from tally.id or made -> 'announcement' -> 'act' ->> 'thread' is distinct from tally.thread::text then
    raise exception 'the answer carries the announcement to send live: %', made;
  end if;
  -- It opened the Turns thread, so the answer carries that too.
  if made -> 'announcement' -> 'thread' ->> 'id' is distinct from tally.thread::text then raise exception 'the answer carries the thread it opened: %', made; end if;

  -- A silent drop acts at once too, and is named nowhere.
  tallies := (select count(*) from acts where kind = 'tally');
  perform tests.become(ann);
  made := create_character('Quiet Drop', 'alpha', 'now', 'silent');
  quiet := (made ->> 'id')::uuid;
  perform post(t, quiet, 'Nobody said I was coming.');
  perform tests.unbecome();
  if (select count(*) from acts where kind = 'tally') is distinct from tallies or made -> 'announcement' <> 'null'::jsonb then raise exception 'a silent drop wrote a tally: %', made; end if;
  -- A second announced drop posts in the thread now open, opening nothing.
  perform tests.become(ann);
  made := create_character('Second Drop', 'alpha', 'now', 'announced');
  perform tests.unbecome();
  if made -> 'announcement' -> 'thread' <> 'null'::jsonb then raise exception 'a drop into an open Turns thread opened another: %', made; end if;

  -- Options outside the two are refused.
  perform tests.become(ann);
  if pg_temp.refusal('select create_character(''Odd Timing'', ''alpha'', ''later'', ''silent'')') is distinct from 'a character drops now or debuts at the tally' then raise exception 'a timing outside the two'; end if;
  if pg_temp.refusal('select create_character(''Odd Loudness'', ''alpha'', ''now'', ''revealed'')') is distinct from 'a debut is silent, announced, or announced with its class' then raise exception 'a loudness outside the three'; end if;
  perform tests.unbecome();
end $$;

-- ---- A silent scheduled debut is in no tally; an announced one is; both debut at the settlement ----
do $$
declare
  ann uuid := tests.account('sched-ann');
  shy uuid;
  loud uuid;
  first_tally uuid;
begin
  perform tests.become(ann);
  shy := (create_character('Shy Debut', 'alpha', 'tally', 'silent') ->> 'id')::uuid;
  loud := (create_character('Loud Debut', 'alpha') ->> 'id')::uuid;
  perform tests.unbecome();
  first_tally := masks_change(now() + interval '1 minute');
  if (select count(*) from characters where id in (shy, loud) and debuted_at = now() + interval '1 minute') is distinct from 2::bigint then raise exception 'both debut at the settlement'; end if;
  if pg_temp.named_in(shy) is distinct from 0::bigint then raise exception 'a silent scheduled debut was named in a tally'; end if;
  if pg_temp.named_in(loud) is distinct from 1::bigint or first_tally is null then raise exception 'an announced scheduled debut is named in the tally'; end if;
  if not exists (select 1 from broadcasts_due where event = 'act' and payload ->> 'id' = first_tally::text) then raise exception 'the settlement''s tally waits in the outbox, as before'; end if;
end $$;

-- ---- A waiting character, as its player: its loudness changed, or dropped now ----
do $$
declare
  ann uuid := tests.account('set-ann');
  bob uuid := tests.account('set-bob');
  w uuid;
  v uuid;
  said jsonb;
  t uuid := tests.thread('Set and dropped');
begin
  perform tests.become(ann);
  w := (create_character('Waiting Then Dropped', 'alpha', 'tally', 'silent') ->> 'id')::uuid;
  v := (create_character('Waiting Then Loud', 'alpha', 'tally', 'silent') ->> 'id')::uuid;
  perform tests.unbecome();
  -- Another player's set_debut is refused in the words a character that is not theirs always gets.
  perform tests.become(bob);
  if pg_temp.refusal(format('select set_debut(%L, %L, %L)', w, 'now', 'announced')) is distinct from 'you do not play that character' then raise exception 'another player set a debut'; end if;
  perform tests.unbecome();
  -- Its loudness changed, it still waits; then named in the tally.
  perform tests.become(ann);
  said := set_debut(v, 'tally', 'announced');
  perform tests.unbecome();
  if not (said ->> 'waiting')::boolean or (select (debuted_at, debut_loudness) from characters where id = v) is distinct from (null::timestamptz, 'announced'::text) then raise exception 'a loudness changed while it waits: %', said; end if;
  -- Dropped now, it acts at once.
  perform tests.become(ann);
  said := set_debut(w, 'now', 'announced');
  perform post(t, w, 'Dropped.');
  perform tests.unbecome();
  if (said ->> 'waiting')::boolean or (select debuted_at from characters where id = w) is distinct from now() then raise exception 'a waiting character dropped now acts at once: %', said; end if;
  if pg_temp.named_in(w) is distinct from 1::bigint or (said -> 'announcement' -> 'act' ->> 'id') is null then raise exception 'a waiting character dropped loud is announced at once: %', said; end if;
  -- A retired one is refused, with its way back.
  perform tests.unbecome();
  update characters set retired_at = now() where id = v;
  perform tests.become(ann);
  if pg_temp.refusal(format('select set_debut(%L, %L, %L)', v, 'now', 'silent')) is distinct from 'that character is retired; an admin can restore it' then raise exception 'a retired character was dropped'; end if;
  perform tests.unbecome();
  update characters set retired_at = null where id = v;
  perform tests.become(ann);
  -- Once debuted, it is refused.
  perform tests.become(ann);
  if pg_temp.refusal(format('select set_debut(%L, %L, %L)', w, 'tally', 'silent')) is distinct from 'it has debuted' then raise exception 'a debuted character''s debut was set'; end if;
  perform tests.unbecome();
  -- The settlement debuts the other, named; the dropped one is not named again.
  perform masks_change(now() + interval '1 minute');
  if pg_temp.named_in(v) is distinct from 1::bigint then raise exception 'a loudness changed to announced is named at the tally'; end if;
  if pg_temp.named_in(w) is distinct from 1::bigint then raise exception 'a drop was named again at the tally'; end if;
end $$;

-- ---- A drop between seasons debuts at once; its announcement waits for the next tally ----
do $$
declare
  ann uuid := tests.account('gap-ann');
  gap uuid;
  made jsonb;
  t uuid := tests.thread('In the gap');
begin
  update seasons set ends_at = now() - interval '1 day' where ends_at is null;
  insert into seasons (number, starts_at) values ((select max(number) + 1 from seasons), now() + interval '1 day');
  perform tests.become(ann);
  made := create_character('Gap Drop', 'alpha', 'now', 'announced');
  gap := (made ->> 'id')::uuid;
  -- No season holds the gap, and acting there is what it always was: allowed.
  perform post(t, gap, 'Between seasons.');
  perform tests.unbecome();
  if made -> 'announcement' <> 'null'::jsonb or pg_temp.named_in(gap) is distinct from 0::bigint then raise exception 'a drop between seasons was announced in no season: %', made; end if;
  if not (select debut_announcement_due from characters where id = gap) then raise exception 'a drop between seasons owes its announcement'; end if;
  -- The next season's first tally names it, once.
  perform masks_change(now() + interval '2 days');
  if pg_temp.named_in(gap) is distinct from 1::bigint then raise exception 'the next tally names a drop made between seasons'; end if;
  if (select (a.thread, s.number) from acts a, jsonb_array_elements(a.payload -> 'debuts') d, seasons s where a.kind = 'tally' and d ->> 'character' = gap::text and s.turns_thread = a.thread)
     is distinct from (select (turns_thread, number) from seasons where ends_at is null) then
    raise exception 'it is named in the next season''s Turns thread';
  end if;
  perform masks_change(now() + interval '3 days');
  if pg_temp.named_in(gap) is distinct from 1::bigint then raise exception 'a drop owed its announcement was named twice'; end if;
end $$;

-- ---- A drop with its class between seasons: its unmask waits with its announcement for the next tally ----
do $$
declare
  ann uuid := tests.account('gap-with-class');
  gap uuid;
  made jsonb;
  window_end timestamptz;
begin
  -- A gap between seasons: the one the block above opened, or one opened here.
  if (select starts_at from seasons where ends_at is null) <= now() then
    update seasons set ends_at = now() - interval '1 day' where ends_at is null;
    insert into seasons (number, starts_at) values ((select max(number) + 1 from seasons), now() + interval '1 day');
  end if;
  perform tests.become(ann);
  made := create_character('Gap Unmasked', 'beta', 'now', 'with_class');
  perform tests.unbecome();
  gap := (made ->> 'id')::uuid;
  if made -> 'announcement' <> 'null'::jsonb or exists (select 1 from acts where kind = 'unmask' and character = gap) then raise exception 'a drop between seasons was unmasked in no season: %', made; end if;
  window_end := now() + interval '2 days';
  perform masks_change(window_end);
  if (select (a.thread, a.created_at, a.payload ->> 'class') from acts a where a.kind = 'unmask' and a.character = gap)
     is distinct from ((select turns_thread from seasons where ends_at is null), window_end, 'beta'::text) then
    raise exception 'the next season''s tally unmasks it, in its Turns thread, dated at the tally';
  end if;
  if (select d ->> 'class' from acts a, jsonb_array_elements(a.payload -> 'debuts') d where a.kind = 'tally' and d ->> 'character' = gap::text) is distinct from 'beta' then raise exception 'the owed announcement names its class'; end if;
  perform masks_change(now() + interval '3 days');
  if (select count(*) from acts where kind = 'unmask' and character = gap) is distinct from 1::bigint then raise exception 'an owed unmask was written twice'; end if;
end $$;

-- ---- The season's reveal names every character, a silent drop among them ----
do $$
declare
  ann uuid := tests.account('reveal-drop');
  quiet uuid;
  ended timestamptz;
begin
  update seasons set starts_at = now() - interval '1 day' where ends_at is null;
  perform tests.become(ann);
  quiet := (create_character('Revealed Quiet Drop', 'alpha', 'now', 'silent') ->> 'id')::uuid;
  perform tests.unbecome();
  ended := (select starts_at from seasons where ends_at is null) + span_interval(setting('seasonLength'));
  perform reveal_season(ended);
  if not exists (select 1 from acts where kind = 'reveal' and payload ->> 'character' = quiet::text) then raise exception 'the season''s reveal names a silently dropped character'; end if;
end $$;

-- ---- A debut announced with its class names it in the tally, and writes the character's own
-- unmask Act right after, in the Turns thread: a drop's at once, a scheduled one's at the tally
-- (the class reveal plan, Task 2) ----
do $$
declare
  ann uuid := tests.account('with-class-ann');
  bob uuid := tests.account('with-class-bob');
  b uuid := tests.character(bob, 'Watches Debuts', 'alpha', now() - interval '60 days');
  made jsonb;
  dropped uuid;
  sched uuid;
  plain uuid;
  quiet uuid;
  tally acts%rowtype;
  u acts%rowtype;
  first_tally uuid;
  window_end timestamptz := now() + interval '1 minute';
  spun jsonb;
begin
  -- A drop, with its class: the tally of one names it, and its unmask follows at once.
  perform tests.become(ann);
  made := create_character('Drops Unmasked', 'beta', 'now', 'with_class');
  perform tests.unbecome();
  dropped := (made ->> 'id')::uuid;
  if made ->> 'loudness' is distinct from 'with_class' or (made ->> 'waiting')::boolean then raise exception 'a drop with its class acts at once: %', made; end if;
  select a.* into tally from acts a, jsonb_array_elements(a.payload -> 'debuts') d where a.kind = 'tally' and d ->> 'character' = dropped::text;
  if tally.payload -> 'debuts' is distinct from jsonb_build_array(jsonb_build_object('character', dropped, 'name', 'Drops Unmasked', 'class', 'beta')) then
    raise exception 'a drop announced with its class is named with it: %', tally.payload;
  end if;
  select * into u from acts where kind = 'unmask' and character = dropped;
  if u.id is null or u.thread is distinct from tally.thread or u.seq is distinct from tally.seq + 1 then raise exception 'its unmask Act follows the tally in the Turns thread: %', to_jsonb(u); end if;
  if u.payload is distinct from '{"class": "beta", "message": "", "via": "debut"}'::jsonb or u.created_at is distinct from (select created_at from characters where id = dropped) then
    raise exception 'a drop''s unmask names its class, dated at the drop: %', to_jsonb(u);
  end if;
  if (made -> 'announcement' -> 'unmask' ->> 'id')::uuid is distinct from u.id then raise exception 'the answer carries the unmask Act to send live: %', made; end if;
  -- It is the character's Act, on The System's board: reacted to, spun, and its reactions are the character's.
  perform tests.become(bob);
  perform react(u.id, b, 'up');
  spun := spin(u.id, b, 'About that debut', '');
  perform tests.unbecome();
  if (select board from threads where id = (spun -> 'thread' ->> 'id')::uuid) is distinct from players_board() then raise exception 'a thread spun from a debut''s unmask opens on the players'' board'; end if;
  if not exists (select 1 from jsonb_array_elements(settlement_input(now() - interval '1 hour', now() + interval '1 hour') -> 'acts') x where x ->> 'id' = u.id::text and x ->> 'character' = dropped::text)
     or settlement_input(now() - interval '1 hour', now() + interval '1 hour') -> 'systemActs' @> to_jsonb(array[u.id]) then
    raise exception 'a debut''s unmask is settled as its character''s Act, never The System''s';
  end if;
  -- Bob's reaction reaches the settlement on it, which settles a reaction to a character's Act for
  -- that character's class (engine/rules/settle.test.ts reads an unmask's).
  if not exists (select 1 from jsonb_array_elements(settlement_input(now() - interval '1 hour', now() + interval '1 hour') -> 'reactions') x
                 where x ->> 'act' = u.id::text and x ->> 'character' = b::text) then
    raise exception 'a reaction to a debut''s unmask reaches the settlement';
  end if;
  -- Players still post nothing on The System's board, a reveal included.
  perform tests.become(ann);
  if pg_temp.refusal(format('select unmask(%L, %L, %L)', dropped, u.thread, '')) is distinct from 'only The System posts here; spin a thread from what it said' then raise exception 'a player unmasked on The System''s board'; end if;
  -- Scheduled: with its class; announced plainly; silent.
  sched := (create_character('Debuts Unmasked', 'alpha', 'tally', 'with_class') ->> 'id')::uuid;
  plain := (create_character('Debuts Plainly', 'alpha', 'tally', 'announced') ->> 'id')::uuid;
  quiet := (create_character('Debuts Quietly', 'alpha', 'tally', 'silent') ->> 'id')::uuid;
  perform tests.unbecome();
  if exists (select 1 from acts where kind = 'unmask' and character = sched) then raise exception 'a waiting character was unmasked before its debut'; end if;
  first_tally := masks_change(window_end);
  select * into tally from acts where id = first_tally;
  if (select d from jsonb_array_elements(tally.payload -> 'debuts') d where d ->> 'character' = sched::text) is distinct from jsonb_build_object('character', sched, 'name', 'Debuts Unmasked', 'class', 'alpha') then
    raise exception 'a scheduled debut with its class is named with it: %', tally.payload;
  end if;
  if (select d from jsonb_array_elements(tally.payload -> 'debuts') d where d ->> 'character' = plain::text) ? 'class' then raise exception 'a plain announced debut names no class: %', tally.payload; end if;
  select * into u from acts where kind = 'unmask' and character = sched;
  if u.id is null or u.thread is distinct from tally.thread or u.seq <= tally.seq or u.created_at is distinct from window_end or u.payload ->> 'via' is distinct from 'debut' then
    raise exception 'a scheduled debut''s unmask follows its tally, dated at the tally: %', to_jsonb(u);
  end if;
  if exists (select 1 from acts where kind = 'unmask' and character in (plain, quiet)) then raise exception 'a debut not announced with its class wrote an unmask'; end if;
  if not exists (select 1 from broadcasts_due where event = 'act' and payload ->> 'id' = u.id::text) then raise exception 'the settlement sends a debut''s unmask live, through its outbox'; end if;
  -- A waiting character's loudness may become "with its class", and back.
  perform tests.become(ann);
  quiet := (create_character('Changes Its Mind', 'alpha') ->> 'id')::uuid;
  if (set_debut(quiet, 'tally', 'with_class') ->> 'loudness') is distinct from 'with_class' then raise exception 'a waiting character may be set to debut with its class'; end if;
  if pg_temp.refusal('select create_character(''Odd Loudness Again'', ''alpha'', ''now'', ''shouted'')') is distinct from 'a debut is silent, announced, or announced with its class' then raise exception 'a loudness outside the three'; end if;
  perform tests.unbecome();
end $$;
