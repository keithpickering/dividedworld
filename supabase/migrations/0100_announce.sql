-- An announced debut or Turn is the character's own Act (docs/plans/2026-11-06-season-end-design.md, sections 4 and 5). Each writes one Act of a
-- new kind, `announce`, in the season's thread when the change takes effect (at the settlement, or at once for a drop). The tally Act, one
-- hundred names to the Act and The System's, goes: nothing writes it from here on, and the ones already written are left as they are.
--
--   payload  { what: 'debut' | 'turn', was?: <class key>, class?: <class key> }
--
-- `class` is the class the character holds from that moment, so the Act is that class's verified reveal and the guard asks for it as it asks
-- an unmask's; `was` is a Turn's old class. Neither is ever in a debut's `was`. No separate unmask is written. The Act is the character's own: its
-- reactions are scored for it and it counts in the halving as an unmask does, and it is no post. The thread is the Promos, listed on the staff's
-- board (0099).
--
--   - acts_kind_check (0092) and acts_check1 (0062) gain 'announce'. acts_character_null needs no change: an announce has a character.
--   - acts_well_formed (0092): an announce is a debut or a Turn, a debut has no `was`, and an announce naming a class names the one held.
--   - promos_thread, write_announce: the one thread opener and the one writer, so the settlement and a drop cannot drift.
--   - masks_change (0074), announce_drop (0028): they write announce Acts. post_tally (0024) is dropped; nothing calls it.
--   - class_reveals (0027) and turns_announced (0073) read the announce Acts beside the unmask and tally ones. acts_announce_character serves both.
--   - Season News (0063, 0099): one item per landing, a landing being the announce Acts of one thread at one instant; news_announce lands it.
--
-- Ways out: nothing here adds a state a player is in. A debut owed to a character that retired in a gap is not written (a retired character makes
-- no Act, and the log says it retired), nor is a staff character's; the thread opens only when there is an Act to put in it.
--
-- Order. One landing writes debuts first, then Turns, each by character name and id, as masks_change ordered the tally: never by account.
-- Same instant. A drop and a settlement can land in one thread at one created_at only if the drop's `at` equals the settlement's window end to the
-- microsecond. News groups by (thread, created_at), so they would be one item with the count of both, which says nothing that is private.

alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring', 'update', 'card_end', 'announce'));
alter table acts drop constraint acts_check1;
alter table acts add constraint acts_check1 check (kind in ('post', 'tally', 'reveal', 'unmask', 'move', 'update', 'announce') or target_act_id is not null
  or (kind = 'card' and payload ->> 'reach' = 'board'));

-- The read of an announce by its character, for class_reveals and turns_announced, and the read of a landing by its thread and instant, for
-- news_announce and season_news.
create index acts_announce_character on acts (character, created_at) where kind = 'announce';
create index acts_announce_landing on acts (thread, created_at, seq) where kind = 'announce';

-- acts_well_formed (0092), with an announce held to its shape and to the class its character holds; everything else as 0092 wrote it.
create or replace function acts_well_formed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t acts%rowtype;
begin
  if new.character is not null and coalesce(current_setting('kayfabb.staff_writer', true), '') <> 'on'
     and exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a staff character acts only through The System' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind in ('move', 'move_keep') and new.character is not null and not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a % is a staff character''s Act', new.kind using hint = 'kayfabb.refusal', errcode = '42501';
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
  if new.kind = 'card_end' and coalesce(current_setting('kayfabb.card_end_writer', true), '') <> 'on' then
    raise exception 'a card ends only through reverse_card' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.debuted_at is null) then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.retired_at is not null) then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.kind = 'announce' then
    if new.payload ->> 'what' is distinct from 'debut' and new.payload ->> 'what' is distinct from 'turn' then
      raise exception 'an announcement is a debut or a Turn' using errcode = '23514';
    end if;
    if new.payload ->> 'what' = 'debut' and new.payload ? 'was' then
      raise exception 'a debut has no class it was' using errcode = '23514';
    end if;
  end if;
  if (new.kind = 'unmask' or (new.kind = 'announce' and new.payload ? 'class'))
     and (new.payload ->> 'class') is distinct from (select class_key from class_now(new.character, new.created_at)) then
    raise exception 'an % names the class its character holds', new.kind using errcode = '23514';
  end if;
  if new.target_act_id is null then return new; end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'move_end' and (t.kind <> 'move' or t.thread <> new.thread) then
    raise exception 'a move_end is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card_end' and (t.kind <> 'card' or t.thread <> new.thread) then
    raise exception 'a card_end is of a card play, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'move_keep' then
    if t.kind <> 'move' or t.thread <> new.thread then
      raise exception 'a move_keep is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    if not exists (select 1 from open_moves o where o.move_act = t.id) then
      raise exception 'only a move in force can be kept' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if (select c.staff from characters c where c.id = new.character) is distinct from current_boss() then
      raise exception 'only the season''s Boss keeps a move' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if move_owner(t.id) is not distinct from current_boss() then
      raise exception 'that move is already the Boss''s own' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  if new.kind = 'edit' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'an edit is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card' and t.kind <> 'post' then
    raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A card set face down is its post's own author's, in the post's thread; a spring is its set's author's, on the set's post.
  if new.kind = 'set' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'a card is set face down on a post of its own author''s, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'spring' and (t.kind <> 'post' or t.thread <> new.thread or not exists (
       select 1 from acts s where s.id::text = new.payload ->> 'set' and s.kind = 'set' and s.target_act_id = t.id and s.character = new.character)) then
    raise exception 'a spring is of a card set face down on its post, by the one who set it' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind <> 'edit' and t.kind = 'edit' then
    raise exception 'an edit is not answered; answer the post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------------------- the writers ----

-- The season's Promos thread, opened on The System's board where the season holds none, titled by the instance's word. The season's row is
-- locked, so two writers at once open one thread between them; `opened` is read under that lock, so it is true for exactly one of them, and that
-- one tells the board (post_tally's lines 37 to 42, which this replaces). A caller never reads `turns_thread` itself beforehand: that read
-- would come before the lock, and a drop and a settlement racing could both find it null and both broadcast the thread.
create function promos_thread(in_season bigint, out in_thread uuid, out opened boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
begin
  select * into s from seasons where id = in_season for no key update;
  in_thread := s.turns_thread;
  opened := in_thread is null;
  if opened then
    insert into threads (board, title) values (system_board(), copy_of('announcementsThreadTitle', s.number)) returning id into in_thread;
    update seasons set turns_thread = in_thread where id = s.id;
  end if;
end $$;

-- The one writer of an announce Act, whoever asks for it: the settlement's debuts and Turns, and a drop. The guard checks the shape and the class.
-- `was` and `cls` are null where the player named nothing. Returns the Act's public projection, for its caller to send live.
create function write_announce(of_character uuid, in_thread uuid, what text, was text, cls text, at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare written uuid;
begin
  insert into acts (character, kind, thread, payload, created_at)
  values (of_character, 'announce', in_thread,
    jsonb_build_object('what', what) || case when was is not null then jsonb_build_object('was', was) else '{}'::jsonb end
                                     || case when cls is not null then jsonb_build_object('class', cls) else '{}'::jsonb end, at)
  returning id into written;
  return act_projection(written);
end $$;

revoke execute on function promos_thread(bigint), write_announce(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;

-- A drop's announcement, at `at`: one announce Act in the season open then, at once, or, between seasons, at the next settlement. The character's
-- row is held by the caller. The answer is { act, thread }: the Act's projection, and the thread's where this opened it, for the caller to send live.
create or replace function announce_drop(dropped uuid, at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  in_season bigint := (select id from seasons where starts_at <= at and (ends_at is null or ends_at > at));
  c characters%rowtype;
  in_thread uuid;
  opened boolean;
  posted jsonb;
begin
  if in_season is null then
    update characters set debut_announcement_due = true where id = dropped;
    return null;
  end if;
  select * into c from characters where id = dropped;
  select p.in_thread, p.opened into in_thread, opened from promos_thread(in_season) p;
  posted := write_announce(c.id, in_thread, 'debut', null, case when c.debut_loudness = 'with_class' then (select class_key from class_now(c.id, at)) end, at);
  return jsonb_build_object('act', posted, 'thread', case when opened then thread_projection(in_thread) end);
end $$;

-- masks_change (0074), writing an announce Act for each name where it wrote a tally of names and an unmask after it. Everything up to the rows it
-- names is as 0074 wrote it, except that `masks_named` loses `unmasks` and keeps the loudness of a debut, so the class a debut names is read once the
-- window's Turns have taken effect, as before. The Acts follow in `n` order (debuts, then Turns, each by name and id), each its character's, dated at
-- the window's end. A retired character is skipped: it makes no Act, and its player retired it. So is a staff character, which acts only
-- through The System and has no hidden class to announce (staff are made debuted; one waiting is debuted here and named nowhere). Returns the first
-- announce's id, or null.
create or replace function masks_change(window_end timestamptz) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  in_season bigint;
  in_thread uuid;
  opened boolean;
  first_id uuid;
  written jsonb;
  r record;
begin
  if to_regclass('pg_temp.masks_named') is null then
    create temp table masks_named (n bigint, kind text, entry jsonb) on commit drop;
    create temp table masks_turns (character uuid, class_key text, loudness text, show_from boolean, show_to boolean, name text, was text, due_at timestamptz) on commit drop;
  end if;
  truncate masks_named, masks_turns;
  -- The characters made before the window's end, and still waiting, debut at it; the announced
  -- ones are named. One made in a transaction this one could not see yet waits for the next
  -- settlement. A drop locks its character's row first, so one dropped while this runs is either
  -- debuted here (and its drop refused, "it has debuted") or by its drop (and not here).
  -- A retired character makes no Act: one owed its announcement across a gap and retired since is
  -- named, as it was due to be, and skipped where the Acts are written, so no settlement is held back by it.
  with d as (
    update characters set debuted_at = window_end where debuted_at is null and created_at < window_end returning id, name, debut_loudness
  ), owed as (
    update characters set debut_announcement_due = false where debut_announcement_due and debuted_at < window_end returning id, name, debut_loudness
  ) insert into masks_named (n, kind, entry)
    select row_number() over (order by name, id), 'debut', jsonb_build_object('character', id, 'name', name, 'loudness', debut_loudness)
    from (select id, name, debut_loudness from d where debut_loudness <> 'silent' union all select id, name, debut_loudness from owed) named;
  -- The Turns asked before the window's end take effect at it; their characters' rows are locked
  -- first, in one order, so a turn() racing this one waits and then reads what took effect. What
  -- a loud Turn says is read before the Turn is written.
  perform 1 from characters c where c.id in (select character from pending_turns where asked_at < window_end) order by c.id for no key update;
  -- The backstop (the design's section 3): a Turn whose character revealed at or after the window's end does not take effect behind
  -- that reveal, which would make it false on its own date (#22). The claim (unmask) refuses such a reveal from the moment the run
  -- claims its window, but the run claims it only after it has asked for it: pg_cron's call, the function's start and
  -- next_settlement_window fall between the window's end and the claim. The Turn waits for the next window instead, by itself, and
  -- its player can change or withdraw it meanwhile. unmask() locks the character's row before it checks and writes, and the lock
  -- above is taken first, so a reveal goes wholly before this statement, which then sees it (a statement's snapshot is taken after
  -- the lock it waited on, under read committed), or wholly after it, naming the new class. The announcements this function writes come
  -- after this statement, so a debut's or a Turn's own at this window's end holds back no Turn here; the backstop stays on `unmask`, a player's
  -- reveal being always an unmask.
  insert into masks_turns
    select p.character, p.class_key, p.loudness, p.show_from, p.show_to, c.name, n.class_key, p.due_at
    from pending_turns p join characters c on c.id = p.character cross join lateral class_now(p.character, window_end) n
    where p.asked_at < window_end
      and not exists (select 1 from acts a where a.kind = 'unmask' and a.character = p.character and a.created_at >= window_end);
  -- A Turn passed over is due at the first window it was passed over at; its record, never an Act, since a Turn is private.
  update pending_turns set due_at = coalesce(due_at, window_end) where asked_at < window_end and character not in (select character from masks_turns);
  insert into class_history (character, class_key, started_at, due_at) select character, class_key, window_end, due_at from masks_turns;
  delete from pending_turns p using masks_turns t where p.character = t.character;
  insert into masks_named (n, kind, entry)
    select (select count(*) from masks_named) + row_number() over (order by name, character), 'turn',
      jsonb_build_object('character', character, 'name', name, 'loudness', loudness)
      || case when show_from then jsonb_build_object('was', was) else '{}'::jsonb end
      || case when show_to then jsonb_build_object('class', class_key) else '{}'::jsonb end
    from masks_turns where loudness <> 'silent';
  -- A debut announced with its class names the class held once the window's Turns have taken effect.
  update masks_named m set entry = m.entry || jsonb_build_object('class', (select class_key from class_now((m.entry ->> 'character')::uuid, window_end)))
  where m.kind = 'debut' and m.entry ->> 'loudness' = 'with_class';
  if not exists (select 1 from masks_named m join characters c on c.id = (m.entry ->> 'character')::uuid where c.retired_at is null and c.staff is null) then return null; end if;

  select id into in_season from seasons where starts_at < window_end and (ends_at is null or ends_at >= window_end) order by starts_at desc limit 1;
  select p.in_thread, p.opened into in_thread, opened from promos_thread(in_season) p;
  if opened then
    perform broadcast_later('board:' || (select board::text from threads where id = in_thread), 'thread', thread_projection(in_thread));
  end if;
  for r in
    select m.kind, m.entry from masks_named m join characters c on c.id = (m.entry ->> 'character')::uuid
    where c.retired_at is null and c.staff is null order by m.n
  loop
    written := write_announce((r.entry ->> 'character')::uuid, in_thread, r.kind, r.entry ->> 'was', r.entry ->> 'class', window_end);
    first_id := coalesce(first_id, (written ->> 'id')::uuid);
    perform broadcast_later('thread:' || (written ->> 'thread'), 'act', written);
  end loop;
  return first_id;
end $$;

-- post_tally (0024, 0099) is dropped: nothing writes a tally any more, and nothing calls it.
drop function post_tally(bigint, jsonb, jsonb, timestamptz, integer, integer);

-- ------------------------------------------------------------------------------------- the readers ----

-- class_reveals (0027), the announce Acts that name a class beside the unmask Acts: a debut with its class, or a Turn naming the class it Turns to,
-- is that class's verified reveal, and its `via` is its `what`. Same columns.
create or replace view class_reveals as
  select a.id as act, a.character, a.payload ->> 'class' as class, a.created_at as at, a.payload ->> 'via' as via, a.thread
  from acts a where a.kind = 'unmask'
  union all
  select a.id, a.character, a.payload ->> 'class', a.created_at, a.payload ->> 'what', a.thread
  from acts a where a.kind = 'announce' and a.payload ? 'class';

-- turns_announced (0073), the announce Acts that are Turns beside the old tallies' rows, which are never edited. Same columns; `was` where the Turn
-- named it. Read by character first: a filter on one is a probe of acts_tally_turns (the tallies) and of acts_announce_character (the announce Acts).
create or replace view turns_announced as
  select a.id as act, c.id as character, a.created_at as at, e.entry ->> 'was' as was
  from characters c
  cross join lateral (
    select x.id, x.created_at, x.payload from acts x
    where x.kind = 'tally' and x.payload -> 'turns' @> jsonb_build_array(jsonb_build_object('character', c.id))
  ) a
  cross join lateral jsonb_array_elements(a.payload -> 'turns') e(entry)
  where e.entry ->> 'character' = c.id::text
  union all
  select x.id, x.character, x.created_at, x.payload ->> 'was'
  from acts x where x.kind = 'announce' and x.payload ->> 'what' = 'turn';

-- ----------------------------------------------------------------------------------------- the news ----

-- backfill_news_landed (0099), the announce Acts' landings beside the tallies': the first Act of each thread and instant.
create or replace function backfill_news_landed() returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into news_landed (act, kind, landed_at)
  select a.id, 'tally', a.created_at from acts a
  where a.kind = 'tally' and tally_names(a.payload) > 0
  on conflict (act) do nothing;
  insert into news_landed (act, kind, landed_at)
  select distinct on (a.thread, a.created_at) a.id, 'announcements', a.created_at from acts a
  where a.kind = 'announce'
  order by a.thread, a.created_at, a.seq
  on conflict (act) do nothing
$$;
revoke execute on function backfill_news_landed() from public, anon, authenticated;

-- news_announce (0099), landing a landing: on an announce insert, if no landing of kind `announcements` holds an Act of the same thread at the same
-- instant, this Act is it. The first of a settlement's Acts lands it and the rest find it; the item's count is read from the Acts. It broadcasts as a
-- tally did. Everything else as 0099 wrote it.
create or replace function news_announce() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'season_handovers' then
    if new.boss is not null and new.boss is distinct from new.outgoing and new.how in ('nomination', 'rotation') then
      -- The words the news reads are bossLeft (the one who goes, where there was one) and bossArrived (the one who comes), as season_news says them.
      if new.outgoing is not null then
        perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'bossLeft', 'act', null, 'at', new.landed_at));
      end if;
      perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'bossArrived', 'act', null, 'at', new.landed_at));
    end if;
  elsif new.kind = 'update' then
    perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'update', 'sub', null, 'act', new.id, 'at', new.created_at));
  elsif new.kind = 'tally' then
    if tally_names(new.payload) > 0 then
      insert into news_landed (act, kind) values (new.id, 'tally');
      perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'tally', 'act', new.id, 'at', now()));
    end if;
  elsif new.kind = 'announce' then
    -- news_landed carries no thread and no instant of the Acts (landed_at is its own), so no unique index can say "one landing per thread and
    -- instant". Two transactions landing Acts of one thread at one instant could each find none under read committed and each insert a row,
    -- splitting one landing into two News items. So the check is serialized: the lock is on the landing's (thread, instant), held to commit, and
    -- the second transaction's `exists` runs after the first has committed and sees its row. The instant is keyed as epoch microseconds, never
    -- as text, which would follow each session's TimeZone and give two sessions two locks for one landing.
    perform pg_advisory_xact_lock(hashtextextended(new.thread::text || '|' || (extract(epoch from new.created_at) * 1000000)::bigint::text, 0));
    if not exists (select 1 from acts x join news_landed n on n.act = x.id
                   where x.kind = 'announce' and x.thread = new.thread and x.created_at = new.created_at and n.kind = 'announcements') then
      insert into news_landed (act, kind) values (new.id, 'announcements');
      perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'tally', 'act', new.id, 'at', now()));
    end if;
  end if;
  return new;
end $$;
drop trigger acts_announce_news on acts;
create trigger acts_announce_news after insert on acts for each row when (new.kind in ('update', 'tally', 'announce')) execute function news_announce();

-- season_news (0099), the landings of announce Acts beside the old tallies in the same item kind: the item's Act is the landing's first, its count the
-- landing's Acts and its detail the first 20 of them in order, debuts then Turns, each { character, name, class?, was? }. Everything else as 0099 wrote it.
create or replace function season_news(before timestamptz default null, most integer default 20) returns setof season_news_row
language sql stable security definer set search_path = public, pg_temp as $$
  with
  lim as (select coalesce($1, 'infinity'::timestamptz) as b, greatest(1, least(coalesce($2, 20), 50)) as k),
  ann as (select (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements') as thread),
  r_floor as (
    select coalesce((select s.results_at from seasons s where s.results_at is not null and s.results_at < (select b from lim)
                     order by s.results_at desc, s.number desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  results as (
    select 'results'::text as kind, null::uuid as act, null::uuid as thread, null::integer as seq, s.results_at as at, s.number as season,
           null::text as name, null::text as quote, coalesce(s.results_count, 0) as count,
           jsonb_build_object('top', (
             select coalesce(jsonb_agg(jsonb_build_object('character', t.character, 'name', t.name, 'place', t.place, 'standing', t.standing, 'shown', t.shown)
                                       order by t.place, t.name, t.character), '[]'::jsonb)
             from (select r.* from season_results r where r.season = s.id order by r.place, r.name, r.character limit 3) t)) as detail
    from seasons s
    where s.results_at is not null and s.results_at < (select b from lim) and s.results_at >= (select at from r_floor)
  ),
  t_floor as (
    select coalesce((select n.landed_at from news_landed n where n.kind in ('tally', 'announcements') and n.landed_at < (select b from lim)
                     order by n.landed_at desc, n.act desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  tallies as (
    select 'tally'::text as kind, a.id as act, a.thread, a.seq, n.landed_at as at,
           case when n.kind = 'tally' then (a.payload ->> 'season')::integer else (select s.number from seasons s where s.turns_thread = a.thread) end as season,
           null::text as name, null::text as quote,
           case when n.kind = 'tally' then tally_names(a.payload)
                else (select count(*) from acts x where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at)::integer end as count,
           case when n.kind = 'tally' then
             jsonb_build_object('debuts', case when jsonb_typeof(a.payload -> 'debuts') = 'array' then a.payload -> 'debuts' else '[]'::jsonb end,
                                'turns', case when jsonb_typeof(a.payload -> 'turns') = 'array' then a.payload -> 'turns' else '[]'::jsonb end)
           else (
             select jsonb_build_object(
               'debuts', coalesce(jsonb_agg(f.entry order by f.seq) filter (where f.what = 'debut'), '[]'::jsonb),
               'turns', coalesce(jsonb_agg(f.entry order by f.seq) filter (where f.what = 'turn'), '[]'::jsonb))
             from (
               select x.seq, x.payload ->> 'what' as what,
                      jsonb_build_object('character', x.character, 'name', c.name)
                        || case when x.payload ? 'class' then jsonb_build_object('class', x.payload -> 'class') else '{}'::jsonb end
                        || case when x.payload ? 'was' then jsonb_build_object('was', x.payload -> 'was') else '{}'::jsonb end as entry
               from acts x join characters c on c.id = x.character
               where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at
               order by x.seq limit 20
             ) f) end as detail
    from news_landed n join acts a on a.id = n.act
    where n.kind in ('tally', 'announcements') and n.landed_at < (select b from lim) and n.landed_at >= (select at from t_floor)
  ),
  boss_all as materialized (
    select 'bossArrived'::text as kind, h.boss as who, h.landed_at as at, h.number as season, 'bossArrival'::text as line from season_boss_changes h
    where h.landed_at < (select b from lim)
    union all
    select 'bossLeft', h.outgoing, h.landed_at, h.number - 1, 'bossFarewell' from season_boss_changes h
    where h.outgoing is not null and h.landed_at < (select b from lim)
  ),
  boss_page as (
    select * from boss_all c
    where c.at >= coalesce((select c2.at from boss_all c2 order by c2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  ),
  bosses as (
    select c.kind, p.id as act, p.thread, p.seq, c.at, c.season, (select ch.name from characters ch where ch.staff = c.who) as name,
           left(p.body, 600) as quote, null::integer as count, null::jsonb as detail
    from boss_page c
    left join lateral (
      select a.id, a.thread, a.seq, a.payload ->> 'body' as body
      from characters ch join acts a on a.character = ch.id
      where ch.staff = c.who and a.created_at = c.at and a.kind = 'post' and a.thread = (select thread from ann)
        and exists (select 1 from settings s where s.key = 'systemLines' and jsonb_typeof(s.value -> c.line) = 'array' and jsonb_array_length(s.value -> c.line) > 0)
      order by a.seq limit 1
    ) p on true
  ),
  merged as (
    select * from results union all select * from tallies union all select * from bosses
  )
  select m.kind, m.act, m.thread, m.seq, m.at, m.season, m.name, m.quote, m.count, m.detail
  from merged m
  where m.at >= coalesce((select m2.at from merged m2 order by m2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  order by m.at desc, m.kind, m.act nulls first
$$;
revoke execute on function season_news(timestamptz, integer) from public, anon;
grant execute on function season_news(timestamptz, integer) to authenticated;
