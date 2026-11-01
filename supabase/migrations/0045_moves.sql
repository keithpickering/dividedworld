-- Moves, demands and the board's name from Acts. The system plan (docs/plans/2026-10-30-the-system-plan.md), Task 8;
-- the system design, sections 3, 7 and 9.
--
-- A move is a card the Boss plays against the userbase: an effect from a fixed list, a demand from a whitelist, and a hard
-- expiry. Every move is an Act signed by the Boss's staff character, so it is public, reactable and append-only like any other:
--
--   move        a staff character's Act, `{kind, params, demand, expires_at}` and a stock line in `body`, posted in a thread
--               on The System's board. It points at nothing. It lands when the tick writes it (Task 10) and not before.
--   move_end    The System's plain record that a move is over (as a tally is): a null character, the move for its target,
--               `{why: met | expired | reversed, by}`, one per move (a unique partial index), written only by end_move.
--
-- What a board is called now is COMPUTED from these Acts, as a post's text is from its edits: `boards_now` shows the board's
-- latest landed rename that has no move_end, else the board's own row, and nothing is ever written to `boards`. Ending a move
-- brings the old name back for free. A held move never lands, so it is never an Act and no player sees it.
--
-- The `why` the Boss gave for a move (queued_moves.why) is the Boss's own words for the admin queue only; it has no client
-- grant and is not in the move's Act. (The plan's payload listed `why`; Acts are public, so it stays in the queue.)
--
-- Two lists, one list: the catalogs `move_kinds` and `demand_kinds` are seeded by seed_instance from the engine's own
-- (engine/system/moves.ts, engine/system/demands.ts), a move Act names only kinds in them, and `demand_progress` has a case for
-- each demand kind and raises for one it has none for (supabase/tests/0050-moves.sql holds the pair together, and its poison
-- seeds a kind with no case).
--
-- Cost on a busy instance. Moves are few and short-lived, so every read of "what is in force" goes through `open_moves`, a small
-- table a trigger keeps (a row when a move Act is written, gone when its move_end is): boards_now, the digest and the tick read it
-- and cost the number of moves in force, however many moves an instance has made. It is derived state, not an Act, so rows come
-- and go ("Append-only" is about Acts); an import carries it with the rest and a restore fires no trigger. A demand's progress
-- reads the posts made since the landing, a window as long as the move's expiry (days), through the acts_created index.
--
-- Its way out: a move ends when its demand is met, at its expiry, or when an admin reverses it (Task 11); each is a move_end
-- Act, and the board's old name returns. A queued move lands at its time or is held by an admin, and a player never sees it.

-- ------------------------------------------------------------------------------ the catalogs ----

-- Which moves and which demands exist, seeded from the engine's catalogs. `structural` marks a move that reshapes a board and so
-- waits in the admin queue (design, section 7). No client reads them: the screens take their words from the engine.
create table move_kinds (
  key text primary key,
  structural boolean not null
);
create table demand_kinds (
  key text primary key
);
alter table move_kinds enable row level security;
alter table demand_kinds enable row level security;
revoke all on move_kinds, demand_kinds from public, anon, authenticated;

-- ------------------------------------------------------------------------- the two new Acts ----

alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end'));
-- A move points at nothing; every other kind that does not (a post, a tally, a reveal, an unmask) is named here as before.
alter table acts drop constraint acts_check1;
alter table acts add constraint acts_check1 check (kind in ('post', 'tally', 'reveal', 'unmask', 'move') or target_act_id is not null);
-- Null only for The System's own records: a tally, a reveal, and the end of a move. (The check 0001 wrote, under its generated name.)
alter table acts drop constraint acts_check2;
alter table acts add constraint acts_character_null check ((character is null) = (kind in ('tally', 'reveal', 'move_end')));
alter table acts add constraint acts_move_untargeted check (kind <> 'move' or target_act_id is null);
-- (`is true`: a missing key makes jsonb_typeof null, and a check that is null passes.)
alter table acts add constraint acts_move_payload check (kind <> 'move' or (
  jsonb_typeof(payload -> 'kind') = 'string'
  and jsonb_typeof(payload -> 'params') = 'object'
  and coalesce(jsonb_typeof(payload -> 'demand'), 'null') in ('object', 'null')
  and coalesce(jsonb_typeof(payload -> 'expires_at'), 'null') in ('string', 'null')) is true);
-- Task 12b adds `superseded` to the reasons.
alter table acts add constraint acts_move_end_payload check (kind <> 'move_end' or (
  payload ->> 'why' in ('met', 'expired', 'reversed')
  and jsonb_typeof(payload -> 'by') = 'string' and char_length(payload ->> 'by') between 1 and 40) is true);

-- One end per move.
create unique index acts_one_move_end on acts (target_act_id) where kind = 'move_end';
-- A staff member's moves, newest first, for the moves log (moves_log): the keyset (created_at, id) a client pages by.
create index acts_moves on acts (character, created_at desc, id desc) where kind = 'move';

-- The moves in force: every landed move with no move_end, kept by the trigger below.
-- `checked_at` is when the tick last read this move's demand progress (null: never). Derived state, written in place by the tick (0047) so
-- the demand checks are paced and a busy instance's tick stays short; a rebuild leaves it null, which only means "check soon".
create table open_moves (
  move_act uuid primary key references acts (id),
  landed_at timestamptz not null,
  checked_at timestamptz
);
create index open_moves_landed on open_moves (landed_at desc, move_act);
-- The tick checks the demands least recently checked first (0047), a few a minute; this index hands them over in that order.
create index open_moves_checked on open_moves (checked_at nulls first, move_act);
alter table open_moves enable row level security;
revoke all on open_moves from public, anon, authenticated;

-- open_moves is derived state and a restore fires no trigger, so a partial restore can leave it short or stale. An admin runs this
-- after one (the tick and the meeting need not): in one statement it removes every row whose Act is no move or whose move has a
-- move_end, and adds a row for every move with no move_end. Returns how many rows it changed.
create function rebuild_open_moves() returns integer
language sql security definer set search_path = public, pg_temp as $$
  with gone as (
    delete from open_moves o
    where not exists (select 1 from acts a where a.id = o.move_act and a.kind = 'move')
       or exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = o.move_act)
    returning 1
  ), added as (
    insert into open_moves (move_act, landed_at)
    select a.id, a.created_at from acts a
    where a.kind = 'move' and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = a.id)
    on conflict (move_act) do nothing
    returning 1
  )
  select ((select count(*) from gone) + (select count(*) from added))::integer
$$;
revoke execute on function rebuild_open_moves() from public, anon, authenticated;
grant execute on function rebuild_open_moves() to service_role;

create function acts_track_moves() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'move' then
    insert into open_moves (move_act, landed_at) values (new.id, new.created_at);
  else
    delete from open_moves where move_act = new.target_act_id;
  end if;
  return null;
end $$;
revoke execute on function acts_track_moves() from public, anon, authenticated;
create trigger acts_track_moves after insert on acts for each row when (new.kind in ('move', 'move_end')) execute function acts_track_moves();

-- Whether a demand's params carry what its kind needs, of the right types: ids that are uuids, counts that are positive whole
-- numbers, a quadrant that is one of the four, and a crossQuote between two different characters. Returns the first thing
-- wrong, or null. A kind with no case here (the poison of supabase/tests/0050-moves.sql) is demand_progress's to refuse, not this
-- check's. The engine holds the same (engine/system/demands.ts); this is the door for a move written any other way.
create function demand_params_problem(demand jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  p jsonb := demand -> 'params';
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  k text;
begin
  if demand ->> 'kind' not in ('postsOnBoard', 'distinctCharactersOnBoard', 'quadrantOnBoard', 'characterPostsInThread', 'crossQuote') then return null; end if;
  if jsonb_typeof(p) is distinct from 'object' then return 'params'; end if;
  for k in select unnest(case demand ->> 'kind'
      when 'characterPostsInThread' then array['character', 'thread']
      when 'crossQuote' then array['a', 'b']
      else array['board'] end) loop
    if jsonb_typeof(p -> k) is distinct from 'string' or lower(p ->> k) !~ uuid_re then return k; end if;
  end loop;
  for k in select unnest(case demand ->> 'kind'
      when 'characterPostsInThread' then array[]::text[]
      when 'crossQuote' then array['reactions']
      else array['count'] end) loop
    if jsonb_typeof(p -> k) is distinct from 'number' or (p ->> k) !~ '^[1-9][0-9]{0,8}$' then return k; end if;
  end loop;
  if demand ->> 'kind' = 'quadrantOnBoard' and not coalesce((p ->> 'quadrant') = any (array['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative']), false) then return 'quadrant'; end if;
  if demand ->> 'kind' = 'crossQuote' and lower(p ->> 'a') = lower(p ->> 'b') then return 'b (distinctCharacters)'; end if;
  return null;
end $$;
revoke execute on function demand_params_problem(jsonb) from public, anon, authenticated;

-- acts_well_formed (0042), with three rules added; everything else as 0042 wrote it:
--   a move is a staff character's Act, of a kind and with a demand the catalogs hold whose params are well formed
--   (demand_params_problem), and an expiry that is a time;
--   a move_end is written only inside end_move (it sets `kayfabb.move_end_writer` for the one insert), targets a move, and
--   is in the move's own thread.
create or replace function acts_well_formed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t acts%rowtype;
begin
  if new.character is not null and coalesce(current_setting('kayfabb.staff_writer', true), '') <> 'on'
     and exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a staff character acts only through The System' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'move' and new.character is not null and not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a move is a staff character''s Act' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'move' then
    if not exists (select 1 from move_kinds k where k.key = new.payload ->> 'kind') then
      raise exception 'there is no move kind "%"', coalesce(new.payload ->> 'kind', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and not exists (select 1 from demand_kinds d where d.key = new.payload #>> '{demand,kind}') then
      raise exception 'there is no demand kind "%"', coalesce(new.payload #>> '{demand,kind}', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and demand_params_problem(new.payload -> 'demand') is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.payload -> 'demand') using errcode = '23514';
    end if;
    -- Cast once here, so an expiry that is no time is refused at the door and the readers of it never meet one.
    if jsonb_typeof(new.payload -> 'expires_at') = 'string' then perform (new.payload ->> 'expires_at')::timestamptz; end if;
  end if;
  if new.kind = 'move_end' and coalesce(current_setting('kayfabb.move_end_writer', true), '') <> 'on' then
    raise exception 'a move ends only through end_move' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.debuted_at is null) then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.retired_at is not null) then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.kind = 'unmask' and (new.payload ->> 'class') is distinct from (select class_key from class_now(new.character, new.created_at)) then
    raise exception 'an unmask names the class its character holds' using errcode = '23514';
  end if;
  if new.target_act_id is null then return new; end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'move_end' and (t.kind <> 'move' or t.thread <> new.thread) then
    raise exception 'a move_end is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'edit' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'an edit is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card' and t.kind <> 'post' then
    raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind <> 'edit' and t.kind = 'edit' then
    raise exception 'an edit is not answered; answer the post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $$;

-- write_staff_act (0042), allowing a move beside a post, a spin, a card and an edit. Everything else as 0042 wrote it.
create or replace function write_staff_act(staff_key text, kind text, thread uuid, target uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  written uuid;
begin
  if kind is null or kind not in ('post', 'spin', 'card', 'edit', 'move') then
    raise exception 'a staff character posts, spins, plays a card, edits or moves, not %', coalesce(kind, 'nothing') using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'an Act''s payload is an object' using errcode = '22023'; end if;
  select c.id into who from characters c where c.staff = staff_key;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (who, kind, thread, target, payload) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return act_projection(written);
end $$;

-- The one writer of a move_end. Idempotent: a move already ended is answered with its end and nothing is written, so the tick
-- running twice, or the tick and an admin at once, write one end between them (an advisory lock on the move serializes them).
-- Returns {act, ended}: the move_end's id, and whether this call wrote it. Task 10's tick and Task 11's reversal call it.
create function end_move(move_act uuid, why text, by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m acts%rowtype;
  existing uuid;
  written uuid;
begin
  if why is null or why not in ('met', 'expired', 'reversed') then raise exception 'a move ends as met, expired or reversed, not %', coalesce(why, 'nothing') using errcode = '22023'; end if;
  if by is null or char_length(by) not between 1 and 40 then raise exception 'a move''s end says who ended it' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('kayfabb.end_move'), hashtext(move_act::text));
  select * into m from acts where id = move_act and kind = 'move';
  if not found then raise exception 'there is no such move' using errcode = 'P0002'; end if;
  select e.id into existing from acts e where e.kind = 'move_end' and e.target_act_id = move_act;
  if existing is not null then return jsonb_build_object('act', existing, 'ended', false); end if;
  perform set_config('kayfabb.move_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (null, 'move_end', m.thread, move_act, jsonb_build_object('why', why, 'by', by)) returning id into written;
  perform set_config('kayfabb.move_end_writer', '', true);
  return jsonb_build_object('act', written, 'ended', true);
end $$;
revoke execute on function end_move(uuid, text, text) from public, anon, authenticated;
grant execute on function end_move(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------- the queue ----

-- A move the meeting chose, waiting to land. This is a queue entry, not an Act: `held_at`, `held_by` and `landed_act` are
-- written in place, once each, and nothing else about the row changes, but for `failed_at` and `failure`: when the tick last
-- could not land the row and why, in the error's own words, overwritten by a later failure (the latest is the useful one) and left
-- as it was when the row lands. The admin queue (Task 11, admin_queue) should show a waiting row's failed_at and failure, so an
-- admin can see a row that cannot land and hold it; a failing row stays due and the tick tries it again every minute. A held move never lands and a player never sees it.
-- `staff` is whose move it is (the tick posts it as that Boss; the plan's column list omitted it). `why` is the Boss's own
-- one-line reason, its words, for the admin queue only (Task 11's RPC): no client grant.
create table queued_moves (
  id bigint generated always as identity primary key,
  meeting bigint not null references meetings (id),
  staff text not null references characters (staff),
  kind text not null references move_kinds (key),
  params jsonb not null check (jsonb_typeof(params) = 'object'),
  demand jsonb check (demand is null or jsonb_typeof(demand) = 'object'),
  why text not null check (char_length(why) between 1 and 200),
  go_live_at timestamptz not null,
  expires_at timestamptz,
  structural boolean not null,
  held_at timestamptz,
  held_by uuid references accounts (id),
  landed_act uuid references acts (id),
  failed_at timestamptz,
  failure text check (failure is null or char_length(failure) <= 500),
  check ((failed_at is null) = (failure is null)),
  check (expires_at is null or expires_at > go_live_at),
  check ((held_at is null) = (held_by is null)),
  check (held_at is null or landed_act is null)
);
-- The tick finds what is due by this alone: the rows still waiting, however many moves an instance has queued.
create index queued_moves_due on queued_moves (go_live_at) where landed_act is null and held_at is null;
create unique index queued_moves_landed on queued_moves (landed_act) where landed_act is not null;
alter table queued_moves enable row level security;
revoke all on queued_moves from public, anon, authenticated;

-- A queued move names a demand the catalog holds and says whether it is structural as the catalog does, so a row the tick can
-- never land (and would meet every minute) is refused at the meeting. Once written it moves only to held or to landed (and records the tick's failure to land it).
create function queued_moves_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a queued move is held or landed, never removed' using errcode = '23514';
  elsif tg_op = 'INSERT' then
    if new.demand is not null and not exists (select 1 from demand_kinds d where d.key = new.demand ->> 'kind') then
      raise exception 'there is no demand kind "%"', coalesce(new.demand ->> 'kind', '') using errcode = '23514';
    end if;
    if new.demand is not null and demand_params_problem(new.demand) is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.demand) using errcode = '23514';
    end if;
    if not exists (select 1 from move_kinds k where k.key = new.kind) then
      raise exception 'there is no move kind "%"', new.kind using errcode = '23514';
    end if;
    if new.structural is distinct from (select k.structural from move_kinds k where k.key = new.kind) then
      raise exception 'a % move is not queued as structural = %', new.kind, new.structural using errcode = '23514';
    end if;
  else
    if (new.id, new.meeting, new.staff, new.kind, new.params, new.demand, new.why, new.go_live_at, new.expires_at, new.structural)
       is distinct from (old.id, old.meeting, old.staff, old.kind, old.params, old.demand, old.why, old.go_live_at, old.expires_at, old.structural) then
      raise exception 'a queued move is only ever held or landed' using errcode = '23514';
    end if;
    if (old.held_at is not null and (new.held_at, new.held_by) is distinct from (old.held_at, old.held_by))
       or (old.landed_act is not null and new.landed_act is distinct from old.landed_act) then
      raise exception 'a queued move that is held or landed stays so' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function queued_moves_guard() from public, anon, authenticated;
create trigger queued_moves_guard before insert or update or delete on queued_moves for each row execute function queued_moves_guard();

-- ---------------------------------------------------------------------- demand progress ----

-- How far a move's demand has come: {done, of, met}, counting only Acts after the move landed, of characters, posts and public
-- tallies, never players. OWNED BY kayfabb_digest (0044) and security definer, so it runs with that role's privileges and
-- nothing else's: it reads acts_public, thread_list, characters_public, reaction_tallies and reaction_kinds, and the database
-- refuses it who reacted, who owns a mask and a class. Staff characters' own posts count for nothing: a demand is on the
-- players. A reaction threshold is a sum of the public tallies; the engine holds every one above the reaction cap, so meeting it
-- takes a player outside any pair named ("A response never proves a private fact"; engine/system/demands.ts).
-- A move with no demand has nothing to meet: {0, 0, false}. An Act that is no move, or a demand kind with no case, raises (so do
-- params that are missing or mistyped); readers that must go on read demand_progress_or_error below.
-- What each case reads, all of it Acts since the landing (the acts_created index) and so bounded by the move's expiry:
--   postsOnBoard, characterPostsInThread   stop at `of` matching posts (a limit), so a met demand stops reading;
--   distinctCharactersOnBoard              the board's posts since the landing, deduplicated by character and cut at `of` characters
--                                          (the deduplication reads the posts, the limit only stops what it returns);
--   quadrantOnBoard                        sums the tallies of the board's posts since the landing, every one of them;
--   crossQuote                             the two characters' own replies since the landing.
create function demand_progress(move_act uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  landed timestamptz;
  demand jsonb;
  p jsonb;
  total integer;
  have integer;
begin
  select a.created_at, a.payload -> 'demand' into landed, demand from acts_public a where a.id = move_act and a.kind = 'move';
  if not found then raise exception 'there is no such move' using errcode = 'P0002'; end if;
  if demand is null or jsonb_typeof(demand) <> 'object' then return jsonb_build_object('done', 0, 'of', 0, 'met', false); end if;
  p := demand -> 'params';
  case demand ->> 'kind'
    when 'postsOnBoard' then
      total := (p ->> 'count')::integer;
      if total is null or total < 1 then raise exception 'a demand counts at least one' using errcode = '22023'; end if;
      select count(*) into have from (
        select 1 from acts_public a
        join thread_list tl on tl.id = a.thread
        join characters_public c on c.id = a.character
        where a.kind = 'post' and a.created_at > landed and tl.board = (p ->> 'board')::uuid and c.staff is null
        limit total) s;
    when 'distinctCharactersOnBoard' then
      total := (p ->> 'count')::integer;
      if total is null or total < 1 then raise exception 'a demand counts at least one' using errcode = '22023'; end if;
      select count(*) into have from (
        select distinct a.character from acts_public a
        join thread_list tl on tl.id = a.thread
        join characters_public c on c.id = a.character
        where a.kind = 'post' and a.created_at > landed and tl.board = (p ->> 'board')::uuid and c.staff is null
        limit total) s;
    when 'quadrantOnBoard' then
      total := (p ->> 'count')::integer;
      if total is null or total < 1 then raise exception 'a demand counts at least one' using errcode = '22023'; end if;
      select coalesce(sum(t.count), 0)::integer into have
      from acts_public a
      join thread_list tl on tl.id = a.thread
      join characters_public c on c.id = a.character
      join reaction_tallies t on t.act = a.id
      join reaction_kinds k on k.key = t.kind
      where a.kind = 'post' and a.created_at > landed and tl.board = (p ->> 'board')::uuid and c.staff is null and k.quadrant = p ->> 'quadrant';
    when 'characterPostsInThread' then
      total := 1;
      select count(*) into have from (
        select 1 from acts_public a
        where a.kind = 'post' and a.thread = (p ->> 'thread')::uuid and a.character = (p ->> 'character')::uuid and a.created_at > landed
        limit 1) s;
    when 'crossQuote' then
      -- Each of the two quotes the other in a reply made since the landing, and the reply draws `reactions` on its public tally.
      total := 2;
      if (p ->> 'reactions')::integer is null or (p ->> 'reactions')::integer < 1 then raise exception 'a demand counts at least one' using errcode = '22023'; end if;
      select count(*) into have
      from (values ((p ->> 'a')::uuid, (p ->> 'b')::uuid), ((p ->> 'b')::uuid, (p ->> 'a')::uuid)) d (quoter, quoted)
      where exists (
        select 1 from acts_public r
        join acts_public q on q.id = r.target_act_id
        where r.kind = 'post' and r.created_at > landed and r.character = d.quoter and q.kind = 'post' and q.character = d.quoted
          and (select coalesce(sum(t.count), 0) from reaction_tallies t where t.act = r.id) >= (p ->> 'reactions')::integer);
    else
      raise exception 'there is no demand kind "%"', coalesce(demand ->> 'kind', '') using errcode = '22023';
  end case;
  return jsonb_build_object('done', least(have, total), 'of', total, 'met', have >= total);
end $$;

grant create on schema public to kayfabb_digest;
alter function demand_progress(uuid) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;
revoke execute on function demand_progress(uuid) from public, anon, authenticated;
grant execute on function demand_progress(uuid) to service_role;

-- demand_progress, or the SQLSTATE it raised: one malformed landed move must not stop the whole digest (nor, in Task 10, the tick,
-- which must read progress through this form too and not demand_progress). {"done": 0, "of": 0, "met": false, "error": "22023"}.
-- Same owner, so the same reach, and the same grants.
create function demand_progress_or_error(move_act uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return demand_progress(move_act);
exception when others then
  return jsonb_build_object('done', 0, 'of', 0, 'met', false, 'error', sqlstate);
end $$;
grant create on schema public to kayfabb_digest;
alter function demand_progress_or_error(uuid) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;
revoke execute on function demand_progress_or_error(uuid) from public, anon, authenticated;
grant execute on function demand_progress_or_error(uuid) to service_role;

-- ---------------------------------------------------------------------------- the views ----

-- A board as it is called now: its latest landed rename that is still in force, else its own row (its description standing as its
-- first premise). `move_act` is that move's Act, null when the board has none. Nothing is written to `boards`.
-- The moves in force are read once, in a materialized step that starts from open_moves (a handful of rows) and probes the Acts'
-- primary key for each (a lateral subquery the planner may not turn around), so the plan cannot become a walk of the acts: a board index costs its boards plus the moves in force.
create view boards_now as
  with live as materialized (
    select a.id as move_act, a.created_at, a.payload #>> '{params,board}' as board, a.payload #>> '{params,name}' as name,
           a.payload #>> '{params,premise}' as premise, a.payload #>> '{params,description}' as description
    from open_moves o
    cross join lateral (select x.id, x.created_at, x.payload from acts x where x.id = o.move_act offset 0) a
    where a.payload ->> 'kind' = 'renameBoard'
  )
  select b.id, b.slug, coalesce(m.name, b.name) as name, coalesce(m.premise, b.description) as premise,
         coalesce(m.description, b.description) as description, b.is_system, b.created_at, m.move_act
  from boards b
  left join lateral (
    select l.move_act, l.name, l.premise, l.description from live l
    where lower(l.board) = b.id::text
    order by l.created_at desc, l.move_act desc
    limit 1
  ) m on true;
revoke all on boards_now from public, anon, authenticated;
grant select on boards_now to anon, authenticated, kayfabb_digest;

-- Every landed move, newest first, with how it ended: for a Boss's profile (Task 12). Paged by keyset on (at, id), served by
-- acts_moves for one staff member. Everything in it is in the move's public Act or its end's.
create view moves_log as
  select a.id, c.staff, a.payload ->> 'kind' as kind, a.payload -> 'params' as params, a.payload -> 'demand' as demand,
         (a.payload ->> 'expires_at')::timestamptz as expires_at, a.thread, a.created_at as at,
         e.payload ->> 'why' as ended_why, e.payload ->> 'by' as ended_by, e.created_at as ended_at
  from characters c
  cross join lateral (select x.* from acts x where x.character = c.id and x.kind = 'move') a
  left join acts e on e.kind = 'move_end' and e.target_act_id = a.id
  where c.staff is not null;
revoke all on moves_log from public, anon, authenticated;
grant select on moves_log to anon, authenticated;

-- The digest role reads the moves in force, as the digest lists them. (Its policy: a role that is neither a client nor the owner has none.)
create policy digest_reads on open_moves for select to kayfabb_digest using (true);
grant select on open_moves to kayfabb_digest;

-- ------------------------------------------------------------------------------ the digest ----

-- system_digest (0044), with the board names as boards_now has them and the moves filled. Everything else as 0044 wrote it.
--   moves   the moves in force (at most digestExcerpts, newest landed first) and then those that ended in the window, the whole list
--           capped at digestExcerpts: each {act, kind, params, demand, expiresAt, landedAt, progress, ended}. `progress` is
--           demand_progress (counted to now, for an ended move too); `ended` is null while in force and {why, by, at} after, so the
--           Boss reads that a move was met, ran out or was reversed by an admin. The rename's name, premise and description are in
--           `params`: they are in the move's public Act.
-- The function is replaced in place and stays the digest role's: the owner, the privileges and the grants of 0044 are kept.
create or replace function system_digest(since timestamptz, until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  threads_cap integer := (setting('digestThreads'))::integer;
  short_cap integer := (setting('digestExcerpts'))::integer;
  chars integer := (setting('digestExcerptChars'))::integer;
  hours numeric;
  result jsonb;
begin
  if since is null or until is null or until <= since then
    raise exception 'a digest covers a window that ends after it starts' using errcode = '22023';
  end if;
  hours := greatest(extract(epoch from (until - since)) / 3600.0, 1.0 / 60);
  with
  w as (
    select p.id, p.thread, p.character, p.target_act_id, p.created_at, left(p.current_payload ->> 'body', chars) as excerpt
    from acts_public p
    where p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
  ),
  react as (
    select w.thread, k.quadrant, sum(t.count)::integer as n
    from w join reaction_tallies t on t.act = w.id join reaction_kinds k on k.key = t.kind
    group by w.thread, k.quadrant
  ),
  split as (
    select r.thread, sum(r.n) as total, max(r.n) as biggest from react r group by r.thread
  ),
  hot as (
    select tl.id as thread, left(tl.title, 120) as title, tl.board as board_id, h.posts,
           round(h.posts / hours, 2) as heat,
           round(coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0), 4) as controversy,
           tl.last_seq as length
    from (select w.thread, count(*) as posts from w group by w.thread) h
    join thread_list tl on tl.id = h.thread
    left join split s on s.thread = h.thread
    order by h.posts desc, coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0) desc, tl.id
    limit threads_cap
  ),
  -- Order and cut first, number after. The order is the standings screen's, amount then name (then the character, for
  -- a tie of both), so the top rows come off standings_season_amount (season, amount desc, name; 0030) already in order
  -- and stop at the cap: the season's rows are never sorted, only the few of a tie are. The rank is numbered over the cut.
  -- A row that is not a public character is skipped inside the cut, so the cap is still full.
  stand as (
    select row_number() over (order by top.amount desc, top.name, top.character) as rank, top.character, top.amount
    from (
      select s.character, s.amount, s.name
      from standings s
      where s.season = standings_season()
        and exists (select 1 from settlements x where x.ends_at > since and x.ends_at <= until)
        and exists (select 1 from characters_public cp where cp.id = s.character)
      order by s.amount desc, s.name, s.character
      limit short_cap
    ) top
  ),
  quoted as (
    select w.character as q_from, tgt.character as q_to, count(*) as n
    from w join acts_public tgt on tgt.id = w.target_act_id
    where tgt.kind = 'post' and tgt.character is not null and tgt.character <> w.character
    group by w.character, tgt.character
    order by count(*) desc, w.character, tgt.character
    limit short_cap
  ),
  boss as (
    select cp.id from characters_public cp where cp.staff is not null and cp.staff = current_boss()
  ),
  boss_acts as (
    select a.id, a.thread
    from acts_public a
    where a.character in (select id from boss) and a.kind in ('post', 'spin', 'card')
      and a.created_at >= since - (until - since) and a.created_at < until
  ),
  boss_tally as (
    select ba.id as act, ba.thread, sum(t.count)::integer as total, jsonb_object_agg(t.kind, t.count order by t.kind) as tally
    from boss_acts ba join reaction_tallies t on t.act = ba.id
    group by ba.id, ba.thread
    order by sum(t.count) desc, ba.id
    limit short_cap
  ),
  excerpted as (
    select w.id as act, w.thread, w.character, coalesce(sum(t.count), 0)::integer as reactions, w.excerpt, w.created_at
    from w left join reaction_tallies t on t.act = w.id
    group by w.id, w.thread, w.character, w.excerpt, w.created_at
    order by coalesce(sum(t.count), 0) desc, w.created_at desc, w.id
    limit short_cap
  ),
  -- The moves in force (open_moves: a handful of rows, whatever the instance's history) and those whose end fell in the window,
  -- each capped; in force first, then by landing, newest first. An end after the window is not the digest's yet.
  open_m as (
    select a.id as act, a.created_at as landed_at, a.payload, null::jsonb as ended, 0 as grp
    from open_moves o join acts_public a on a.id = o.move_act
    where a.created_at < until
    order by a.created_at desc, a.id
    limit short_cap
  ),
  ended_m as (
    select a.id as act, a.created_at as landed_at, a.payload,
           jsonb_build_object('why', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at) as ended, 1 as grp
    from acts_public e join acts_public a on a.id = e.target_act_id
    where e.kind = 'move_end' and e.created_at >= since and e.created_at < until
    order by e.created_at desc, e.id
    limit short_cap
  ),
  moved as (
    select * from (select * from open_m union all select * from ended_m) u order by u.grp, u.landed_at desc, u.act limit short_cap
  ),
  named as (
    select q_from as id from quoted union select q_to from quoted union select character from stand union select character from excerpted
  )
  select jsonb_build_object(
    'since', since,
    'until', until,
    'threads', coalesce((select jsonb_agg(jsonb_build_object('thread', h.thread, 'title', h.title, 'board', (select bn.name from boards_now bn where bn.id = h.board_id), 'posts', h.posts,
                          'heat', h.heat, 'controversy', h.controversy, 'length', h.length)
                         order by h.posts desc, h.controversy desc, h.thread) from hot h), '[]'::jsonb),
    'standings', coalesce((select jsonb_agg(jsonb_build_object('rank', s.rank, 'character', s.character, 'amount', s.amount) order by s.rank) from stand s), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.payload ->> 'kind', 'params', m.payload -> 'params',
                          'demand', m.payload -> 'demand', 'expiresAt', m.payload -> 'expires_at', 'landedAt', m.landed_at,
                          'progress', demand_progress_or_error(m.act), 'ended', m.ended) order by m.grp, m.landed_at desc, m.act) from moved m), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('from', q.q_from, 'to', q.q_to, 'count', q.n) order by q.n desc, q.q_from, q.q_to) from quoted q), '[]'::jsonb),
    'bossReactions', coalesce((select jsonb_agg(jsonb_build_object('act', bt.act, 'thread', bt.thread, 'total', bt.total, 'tally', bt.tally) order by bt.total desc, bt.act) from boss_tally bt), '[]'::jsonb),
    'excerpts', coalesce((select jsonb_agg(jsonb_build_object('act', e.act, 'thread', e.thread, 'character', e.character, 'reactions', e.reactions, 'text', e.excerpt)
                          order by e.reactions desc, e.created_at desc, e.act) from excerpted e), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'name', cp.name, 'staff', cp.staff is not null) order by cp.id)
                            from characters_public cp where cp.id in (select id from named)), '[]'::jsonb)
  ) into result;
  return result;
end $$;


-- ---------------------------------------------------------------------------------- the seed ----

-- seed_instance (0042), also seeding the catalogs: `system.moves` (each {key, structural}) and `system.demands` (each {key}),
-- from the engine's own lists. Everything else as 0042 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
begin
  -- Two seeds at once would each find no hire row and both write one into append-only staff_changes. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the price of one
  -- the code no longer sells stays in the row with it (settings_economy_whole, 0006).
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name and price are.
  insert into card_kinds (key, name, alignment, price_setting, stack, seeded, reads)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', e ->> 'priceSetting', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}')
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment, price_setting = excluded.price_setting,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads;
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  -- A seed naming one slug twice is refused by the upsert ("cannot affect row a second time"),
  -- where 0004 took its first; an instance never holds one (instanceProblems).
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false) from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  -- A pip style is added or renamed, never removed: a profile may name it.
  insert into pip_styles (key, name, full_image, empty_image)
  select e ->> 'key', e ->> 'name', e ->> 'full', e ->> 'empty' from jsonb_array_elements(coalesce(payload -> 'pipStyles', '[]')) e
  on conflict (key) do update set name = excluded.name, full_image = excluded.full_image, empty_image = excluded.empty_image;
  -- The instance's staff (0042), once each: a Boss or a Mod Bot is made when its key has no character yet, debuted at
  -- seed time, with the profile its seed gives (its title and its signature, cut to what a profile holds). What an admin
  -- wrote is never written over: a reseed finds the key and does nothing. A bot in firstStaff with no staff_changes row
  -- is hired; one with a row, a fired bot's included, is left as that row says.
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, e ->> 'kind' as kind, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at) select s.name, s.staff, s.kind, now() from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature)
  select m.id, left(s.title, 40), left(s.signature, 500) from made m join seeded s on s.staff = m.staff;
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'bot');
  if unknown is not null then raise exception 'firstStaff names %, which no bot in the seed''s staff is', unknown using errcode = '22023'; end if;
  insert into staff_changes (staff, on_staff)
  select k, true from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_changes x where x.staff = k);
  -- The catalogs (0045): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural) select e ->> 'key', (e ->> 'structural')::boolean from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;
