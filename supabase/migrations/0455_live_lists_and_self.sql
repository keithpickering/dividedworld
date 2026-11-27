-- Live lists: a board's thread list and the index hear every post (docs/plans/2026-11-25-live-lists-and-self-design.md, sections 2, 3 and 5; plan Task 1).
--
--   thread_row     the row of one thread exactly as board_page lists it (to_jsonb over thread_list's columns, 0448), or null for a thread thread_list does not list.
--   board_summary  the entry of one board exactly as index_page builds it (0368), or null for a closed board.
--   acts_live_lists  after a statement that wrote an Act with a thread and a place number (a post, a spin, an unmask, an announcement: what bumps a thread in thread_list), queues `row` on `board:<board>`
--                    and `board` on `index`, each skipped when its projection is null. An edit, a card, a poll and a reaction have no place number and send nothing.
--                    The row carries no view count (views stay hourly batches), no reading position, and nothing about an owner, an account or a reactor: it is what any signed-in player reads in the list.
--   masks_change   (0436) without its `thread` broadcast to the board: the thread it opens is a thread whose first Act fires the trigger above, so the one row is sent from there. Nothing else changes.
--   the policy     "signed-in players hear the board" (0008) also lets a signed-in role hear `index`.
--
-- The projections are plpgsql, not SQL: a SQL function's plan is not re-made after an index under it is dropped in the same transaction (supabase/tests/0034-thread-list.sql does that, and 'could not open relation' was the answer).
-- They are volatile on purpose: a trigger reads the Act it fires on, which a stable function's older snapshot would not show.
-- A way out: nothing here holds a player in a state; a missed event is read again by the page's own reload.

-- The one bulk limit (board_stubs' page size): a board that more threads than this change in one statement hears one `changed` {}, not a `row` for each. acts_live_lists and rebuild_thread_places (step 6) both read it here.
create function live_bulk_threads() returns integer language sql immutable as $$ select 50 $$;
revoke execute on function live_bulk_threads() from public, anon, authenticated;

create function thread_rows(in_threads uuid[]) returns setof jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- The keys of the select lists below are pinned in supabase/tests/0455-live-lists-and-self.sql; editing a list means editing that pin, and the other.
  -- Three statements, each with its own plan: none (a statement that placed no Act, which would otherwise plan and run the whole view for nothing), one (the equality the view's plan is pushed down by, which is what an Act costs in
  -- supabase/tests/0321-veil-cover.sql), and many (one pass, `= any`, whose plan is made for several rows and reads more of each).
  if coalesce(cardinality(in_threads), 0) = 0 then return; end if;
  if cardinality(in_threads) = 1 then
    return query select to_jsonb(l) from (
      select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.last_seq, t.replies, t.first_act, t.first_character, t.last_act, t.last_character,
             t.replies_this_week, t.origin_thread, t.origin_place
      from thread_list t where t.id = in_threads[1]) l;
    return;
  end if;
  return query select to_jsonb(l) from (
    select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.last_seq, t.replies, t.first_act, t.first_character, t.last_act, t.last_character,
           t.replies_this_week, t.origin_thread, t.origin_place
    from thread_list t where t.id = any (in_threads)) l;
end $$;
revoke execute on function thread_rows(uuid[]) from public, anon, authenticated;

create function thread_row(in_thread uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return (select r from thread_rows(array[in_thread]) r);
end $$;
revoke execute on function thread_row(uuid) from public, anon, authenticated;

create function board_summary(in_board uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return (select jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act,
      'thread_count', coalesce(c.threads, 0), 'last_at', l.last_at, 'last_character', l.last_character, 'last_thread', l.id, 'last_title', l.title)
    from boards_now b
    left join board_counts c on c.board = b.id
    left join lateral (select t.id, t.title, t.last_at, t.last_character from thread_list t where t.board = b.id order by t.last_at desc limit 1) l on true
    where b.id = in_board and not b.closed);
end $$;
revoke execute on function board_summary(uuid) from public, anon, authenticated;

-- The rows are built at commit, not at the end of the statement that wrote the Act. post() writes the post and only then springs its quote traps, and a face-down author veil lands on the quoting post later in the same
-- transaction (0357): a row built at the statement's end would name the quoter's real character where acts_public, board_page and post()'s own answer name the stand-in ("A response never proves a private fact").
-- start_thread and the spin writers likewise do work after their insert. So the statement trigger only records what it touched in live_list_queue, and a DEFERRABLE INITIALLY DEFERRED constraint trigger on the queue
-- (live_lists_flush) builds each thread's row and each board's entry from the state the transaction will commit, and queues them with broadcast_later, still inside the transaction. The first firing drains the whole
-- queue; the firings after it find nothing. A rolled-back transaction takes its queue with it and sends nothing. The queue is empty between transactions (a drained row is deleted before commit), so an export carries it empty.
-- A test, which never commits, reads the rows after `set constraints all immediate` (supabase/tests/0455-live-lists-and-self.sql, pg_temp.flush).
create table live_list_queue (
  id bigint generated always as identity primary key,
  threads uuid[] not null default '{}',   -- threads whose placed Acts, or move, changed their row
  boards uuid[] not null default '{}'     -- boards whose index entry changed without a row to name them (a move's old board)
);
alter table live_list_queue enable row level security;
revoke all on live_list_queue from anon, authenticated;

-- One statement, one row of the queue: a statement that writes many Acts (a settlement's announcements, a backfill, a test that writes twenty thousand) costs one queue row, and the transaction two projections for each
-- thread and board it touched and not one for each Act. A row of one Act is the same row: the transition table holds that Act alone.
create function acts_live_lists() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into live_list_queue (threads)
    select array_agg(distinct n.thread) from new_acts n where n.thread is not null and n.seq is not null having count(*) > 0;
  return null;
end $$;
revoke execute on function acts_live_lists() from public, anon, authenticated;

create trigger acts_live_lists after insert on acts referencing new table as new_acts for each statement execute function acts_live_lists();

create function live_lists_flush() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q record;
  ts uuid[] := '{}';
  extra uuid[] := '{}';
  listed jsonb;
  summary jsonb;
  boards uuid[] := '{}';
  bulk uuid[];
  b uuid;
begin
  for q in delete from live_list_queue d returning d.threads, d.boards loop
    ts := ts || q.threads;
    extra := extra || q.boards;
  end loop;
  if cardinality(ts) = 0 and cardinality(extra) = 0 then return null; end if;
  -- A board that more than live_bulk_threads() of its threads got a placed Act in, in this transaction, hears one `changed` and no per-thread `row` (5,000 rows to every reader, and 15 ms each to project).
  select coalesce(array_agg(x.board), array[]::uuid[]) into bulk from (
    select t.board from threads t where t.id in (select u from unnest(ts) u)
    group by t.board having count(*) > live_bulk_threads()) x;
  foreach b in array bulk loop
    perform broadcast_later('board:' || b, 'changed', '{}'::jsonb);
  end loop;
  -- A board is sent only when a thread thread_list lists produced a row on it: an unlisted thread (the Updates thread) changes neither the list nor the board's entry.
  for listed in select r from thread_rows((select coalesce(array_agg(distinct t.id), array[]::uuid[]) from threads t where t.id in (select u from unnest(ts) u) and t.board <> all (bulk))) r loop
    perform broadcast_later('board:' || (listed ->> 'board'), 'row', listed);
    boards := boards || (listed ->> 'board')::uuid;
  end loop;
  for b in select distinct x from unnest(boards || bulk || extra) x order by 1 loop
    summary := board_summary(b);
    if summary is not null then perform broadcast_later('index', 'board', summary); end if;
  end loop;
  return null;
end $$;
revoke execute on function live_lists_flush() from public, anon, authenticated;

create constraint trigger live_lists_flush after insert on live_list_queue deferrable initially deferred for each row execute function live_lists_flush();

-- masks_change (0436), without the `thread` broadcast: the first Act of the thread it opens sends the board its row. Everything else as 0436 wrote it.
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
    create temp table masks_turns (character uuid, class_key text, loudness text, show_from boolean, show_to boolean, name text, was text, due_at timestamptz, announce_act uuid) on commit drop;
  end if;
  truncate masks_named, masks_turns;
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
  -- after this statement, so a Turn's own at this window's end holds back no Turn here; the backstop stays on `unmask`, a player's
  -- reveal being always an unmask.
  insert into masks_turns
    select p.character, p.class_key, p.loudness, p.show_from, p.show_to, c.name, n.class_key, p.due_at, p.announce_act
    from pending_turns p join characters c on c.id = p.character cross join lateral class_now(p.character, window_end) n
    where p.asked_at < window_end
      and not exists (select 1 from acts a where a.kind = 'unmask' and a.character = p.character and a.created_at >= window_end);
  -- A Turn passed over is due at the first window it was passed over at; its record, never an Act, since a Turn is private.
  update pending_turns set due_at = coalesce(due_at, window_end) where asked_at < window_end and character not in (select character from masks_turns);
  insert into class_history (character, class_key, started_at, due_at, announce_act) select character, class_key, window_end, due_at, announce_act from masks_turns;
  delete from pending_turns p using masks_turns t where p.character = t.character;
  insert into masks_named (n, kind, entry)
    select (select count(*) from masks_named) + row_number() over (order by name, character), 'turn',
      jsonb_build_object('character', character, 'name', name, 'loudness', loudness)
      || case when show_from then jsonb_build_object('was', was) else '{}'::jsonb end
      || case when show_to then jsonb_build_object('class', class_key) else '{}'::jsonb end
    from masks_turns where loudness <> 'silent' and announce_act is null;
  if not exists (select 1 from masks_named m join characters c on c.id = (m.entry ->> 'character')::uuid where c.retired_at is null and c.staff is null) then return null; end if;

  select id into in_season from seasons where starts_at < window_end and (ends_at is null or ends_at >= window_end) order by starts_at desc limit 1;
  select p.in_thread, p.opened into in_thread, opened from promos_thread(in_season) p;
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

-- The policy of 0008, made again with `index`. Fail closed, as 0008 and 0061 are: without row-level security the policy would hold nobody back.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'realtime')
     and exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
      raise exception 'realtime.messages has no row-level security, so private channels would be open to every listener';
    end if;
    drop policy if exists "signed-in players hear the board" on realtime.messages;
    execute $p$create policy "signed-in players hear the board" on realtime.messages for select to authenticated
      using (extension = 'broadcast' and (realtime.topic() like 'thread:%' or realtime.topic() like 'board:%' or realtime.topic() = 'index'))$p$;
  end if;
end $$;

-- ---- Task 2: the poke ----
--
-- The player's own channel `account:<id>` (0061) carries a bare `self` event, an empty payload, whenever something outside the player's own screen changes what the HUD shows of them: the wallet, the hand, and what
-- my_characters shows of their characters (0436). The HUD answers it with the read it runs after the player's own actions. It names no amount, card or character, and goes only to the account that owns what changed:
-- the way an alert goes (write_alert, 0061), through the owner of a character, a private fact the poke reads and never says.
--
--   poke_self                 the one place a `self` is queued.
--   wallet_events, card_ledger  a statement that writes rows pokes each account it wrote once, except for rows that carry a settlement (its own moves and its crowd pay): a settlement moves every wallet in one transaction and the HUD reads again on `settled` instead.
--   self_kinds, quiet_kinds   the Act kinds that can change what my_characters shows, and the others. Both are written out in full on purpose: supabase/tests/0455-live-lists-and-self.sql holds them to acts_kind_check's own list, so a kind
--                             added later is classified or the build fails, and a list that read the constraint would hold nothing.
--   acts_self                 after a statement that wrote Acts of the kinds in self_kinds(), pokes the owner of each character such an Act changes.
--   act_self_characters       the characters one Act changes: the one it names (payload `character`, `params.character`, or `locks`, a lockout's), the one it acts as where that is its subject (an unmask), and,
--                             for an Act that ends or rules on another, the ones that Act changes, as far as an appeal's ruling on a ban (two Acts away). A play that lifted a ban (ban_lifts) changes the banned character.
--   ban_lifts, warn_reliefs   rows written beside a play, not Acts, that change a character's ban and warn points: an unban or a relief lands with no Act that names the character.
--
-- What my_characters (0436) reads, and what changes each part (the list the kinds below come from):
--   class, class_since, turn_opens_at, class_due_at        class_history: a row on creating a character (the player's own action) and in masks_change, in a settlement (no poke, as above). No other writer.
--   pending_*, takes_effect_at                            pending_turns: written by turn() and the player's own cancel, and removed by masks_change in a settlement. The player's own actions, which the HUD reads again itself.
--   debuted_at, retired_at, name, presence_hidden, pronouns the player's own screens.
--   banned_until (banned_until, ban_ends)                  `ban`; `appeal_ruling` (a ruling's `until`); ban_lifts (an unban); a `card_end` of that unban (card_ended). Not poked: a time passing, which writes nothing.
--   bars (bars_of, move_expires_at, open_moves)            `move` (conferGroup naming params.character); `move_end`; `appeal_ruling` (a ruling's `until`).
--   group (group_now)                                      the same moves, and the ladder: posts, seasons, staff. A post count crossing a rung is not poked (a post is not a kind that changes the player's own state: it would be one poke per post); it reads on the next refresh.
--   class_shown_at (class_reveals)                         `unmask`, and `announce` (a loud Turn, written in a settlement).
--   lockouts (lockout_ends)                                `spring` (did lockedOut, locks the character); `card_end` of that spring.
--   Also the warn points on a character's face (characters_public): `infraction` and `ban` (a ban clears them), and warn_reliefs.
-- A way out: nothing here holds a player in a state; a missed poke is read again by the next refresh.

create function poke_self(in_account uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  select broadcast_later('account:' || in_account, 'self', '{}'::jsonb)
$$;
revoke execute on function poke_self(uuid) from public, anon, authenticated, service_role;

-- A statement that wrote wallet rows or ledger rows pokes each account once. Whether the row carries a settlement decides for the wallet: a settlement's own moves and its crowd pay (kind crowd, `settlement` set) poke nobody.
create function wallet_events_self() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare one record;
begin
  for one in select distinct n.account from new_rows n where n.settlement is null loop perform poke_self(one.account); end loop;
  return null;
end $$;
revoke execute on function wallet_events_self() from public, anon, authenticated, service_role;
create trigger wallet_events_self after insert on wallet_events referencing new table as new_rows for each statement execute function wallet_events_self();

create function card_ledger_self() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare one record;
begin
  for one in select distinct n.account from new_rows n loop perform poke_self(one.account); end loop;
  return null;
end $$;
revoke execute on function card_ledger_self() from public, anon, authenticated, service_role;
create trigger card_ledger_self after insert on card_ledger referencing new table as new_rows for each statement execute function card_ledger_self();

-- The Act kinds that can change what my_characters shows (and the warn points on a character's face), and those that cannot. Each kind is here for its reason, in the header above:
--   appeal_ruling  a ruling's `until` ends or shortens a ban or a bar; its points_delta changes an infraction's points.
--   ban            banned_until; a ban clears the warn points.
--   card_end       an admin's end of a play: the unban that lifted a ban (the ban is back), a lockout's spring (the lockout is over), a card laid on a character.
--   infraction     the warn points on the character's face.
--   move           a conferGroup naming params.character: the group and the bar. (A move that names no character changes nobody and pokes no one.)
--   move_end       the same move's end: the group and the bar go.
--   spring         a lockout (did lockedOut, `locks` the character).
--   unmask         class_shown_at: the character's own reveal, shown on every device.
-- Borderline, judged quiet: `card` (a card changes another player's character only through the rows and Acts beside it (spring, ban_lifts, warn_reliefs, card_end), all of which poke, and a pierce or a cut cannot end a lift or a lockout: cut_refusal offers only 'use' plays, unban and relief are 'cast', and lockout_ends ignores card_ended), `announce` (a loud Turn's words: the Turn's own request is the player's action and the landing is a settlement's), `reveal` (a season's reveal, written in a settlement, changes no class_reveals row),
-- `appeal` (the appellant's own action; nothing changes until the ruling), `move_keep` (a keep leaves expires_at and the group alone), `report_verdict` (a verdict punishes only through infractions and bans, which poke),
-- `take_back`, `donation`, `draw` (the wallet and the hand: wallet_events and card_ledger), `post`/`spin`/`edit`/`tally` (a post count crossing a group's rung is read on the next refresh: a poke for each post would be the whole board's traffic).
create function self_kinds() returns text[] language sql immutable as $$
  select array['appeal_ruling', 'ban', 'card_end', 'infraction', 'move', 'move_end', 'spring', 'unmask']
$$;
create function quiet_kinds() returns text[] language sql immutable as $$
  select array['announce', 'appeal', 'ballot', 'card', 'describe', 'donation', 'draw', 'edit', 'intercept', 'move_keep', 'poll', 'poll_close', 'post', 'report', 'report_verdict', 'reveal',
               'set', 'spin', 'take_back', 'tally', 'update', 'visit', 'visit_end', 'visit_join', 'wash']
$$;
revoke execute on function self_kinds(), quiet_kinds() from public, anon, authenticated, service_role;

-- A text that is a uuid, as that uuid, and null for anything else: an Act's payload is JSON, and a character in it is only as good as its writer's check.
create function self_uuid(v text) returns uuid language sql immutable set search_path = public, pg_temp as $$
  select case when v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid end
$$;
revoke execute on function self_uuid(text) from public, anon, authenticated, service_role;

-- The characters one Act changes. The Act itself (hop 0) and, for an Act that ends or rules on another, the Act it points at and that Act's own target (an appeal's ruling points at the appeal, which points at the ban or
-- the infraction). What names a character: payload `character` (an infraction, a ban, a card laid on a character), `params.character` (a move), `locks` (a lockout's spring); an unmask's own character; and the character
-- a play lifted a ban from (ban_lifts).
create function act_self_characters(in_act uuid) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive chain (id, hop) as (
    select a.id, 0 from acts a where a.id = in_act
    union all
    select t.id, c.hop + 1
    from chain c join acts a on a.id = c.id and a.kind in ('move_end', 'card_end', 'appeal_ruling', 'appeal')
    join acts t on t.id = a.target_act_id
    where c.hop < 2
  )
  select distinct w.character from (
    select self_uuid(a.payload ->> 'character') as character from chain c join acts a on a.id = c.id
    union all select self_uuid(a.payload #>> '{params,character}') from chain c join acts a on a.id = c.id
    union all select self_uuid(a.payload ->> 'locks') from chain c join acts a on a.id = c.id
    union all select a.character from chain c join acts a on a.id = c.id where c.hop = 0 and a.kind = 'unmask'
    union all select self_uuid(b.payload ->> 'character') from chain c join ban_lifts l on l.play = c.id join acts b on b.id = l.ban
  ) w where w.character is not null
$$;
revoke execute on function act_self_characters(uuid) from public, anon, authenticated, service_role;

-- One statement, one poke for each owner it reaches. A character that is not there, or has no owner (a staff persona), pokes no one.
create function acts_self() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare one record;
begin
  if not exists (select 1 from new_acts n where n.kind = any (self_kinds())) then return null; end if;
  for one in
    select distinct c.owner from new_acts n
    cross join lateral act_self_characters(n.id) as w(character)
    join characters c on c.id = w.character
    where n.kind = any (self_kinds()) and c.owner is not null
  loop
    perform poke_self(one.owner);
  end loop;
  return null;
end $$;
revoke execute on function acts_self() from public, anon, authenticated, service_role;
create trigger acts_self after insert on acts referencing new table as new_acts for each statement execute function acts_self();

-- The rows an unban and a relief write beside their play (0361): a lift changes the banned character's ban, a relief the infracted character's points, with no Act that names the character.
create function ban_lifts_self() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare one record;
begin
  for one in select distinct c.owner from new_rows n join acts b on b.id = n.ban join characters c on c.id = self_uuid(b.payload ->> 'character') where c.owner is not null loop perform poke_self(one.owner); end loop;
  return null;
end $$;
revoke execute on function ban_lifts_self() from public, anon, authenticated, service_role;
create trigger ban_lifts_self after insert on ban_lifts referencing new table as new_rows for each statement execute function ban_lifts_self();

create function warn_reliefs_self() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare one record;
begin
  for one in select distinct c.owner from new_rows n join acts i on i.id = n.infraction join characters c on c.id = self_uuid(i.payload ->> 'character') where c.owner is not null loop perform poke_self(one.owner); end loop;
  return null;
end $$;
revoke execute on function warn_reliefs_self() from public, anon, authenticated, service_role;
create trigger warn_reliefs_self after insert on warn_reliefs referencing new table as new_rows for each statement execute function warn_reliefs_self();

-- write_roster_entry, copied whole from 0440_roster_report.sql (its latest) without its `thread` broadcast to the board: the season's Roster thread opens with the Boss's first post, a seq Act, and the trigger above sends
-- the one `row` from there. Nothing else changes.
create or replace function write_roster_entry(window_end timestamptz, newcomers uuid[], bodies text[], record jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w settlements%rowtype;
  boss text := current_boss();
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  most integer := (select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength');
  texts text[] := array(select btrim(b, E' \t\n\r\f\v') from unnest(coalesce(write_roster_entry.bodies, '{}')) b where btrim(coalesce(b, ''), E' \t\n\r\f\v') <> '');
  made uuid[] := '{}';
  skipped text;
  th uuid;
  opened boolean;
  body text;
  said jsonb;
  landed jsonb;
  rec jsonb := coalesce(write_roster_entry.record, '{}'::jsonb);
begin
  if jsonb_typeof(rec) is distinct from 'object' then raise exception 'a roster record is an object' using errcode = '22023'; end if;
  select * into w from settlements s where s.ends_at = write_roster_entry.window_end;
  if w.id is null then raise exception 'there is no settlement ending at %', write_roster_entry.window_end using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.roster.' || extract(epoch from write_roster_entry.window_end)::text, 0));
  if exists (select 1 from roster_entries e where e.window_end = write_roster_entry.window_end) then return jsonb_build_object('written', false); end if;

  if cardinality(texts) > 0 then
    -- What is known before posting is checked before it: each of these is a state the Boss or the instance is in, and the entry says so. A post past the limit would be refused by the insert's own check, so it is found here.
    if not enabled then skipped := 'the System is off';
    elsif boss is null then skipped := 'the season has no Boss';
    elsif (select o.office from staff_office_now o where o.staff = boss) in ('waiting', 'benched') then skipped := 'the Boss is ' || (select o.office from staff_office_now o where o.staff = boss) || ' and writes nothing';
    elsif most is not null and exists (select 1 from unnest(texts) b where char_length(b) > most) then skipped := format('a roster post is longer than postMaxLength %s', most);
    elsif (select s.turns_thread from seasons s where s.id = w.season) is null and coalesce(btrim((select s.value ->> 'rosterThreadTitle' from settings s where s.key = 'copy')), '') = '' then
      skipped := 'the instance gives no words for copy.rosterThreadTitle';
    else
      begin
        select p.in_thread, p.opened into th, opened from promos_thread(w.season) p;
        foreach body in array texts loop
          said := write_staff_act(boss, 'post', th, null, jsonb_build_object('body', body));
          made := made || (said ->> 'id')::uuid;
          perform broadcast_later('thread:' || th::text, 'act', said);
        end loop;
      exception when sqlstate '55000' or sqlstate 'P0002' then
        -- Only a refusal of the game's own is a skip (55000: the persona writes nothing, or is locked out of the thread; P0002: there is no staff member, or no words for the title): the block's own writes are rolled back,
        -- nothing of a half-posted entry stays, and the entry says why. Anything else (a deadlock 40P01, a lock timeout 55P03, a serialization failure 40001, a full disk) is not caught: it reaches the caller, the
        -- entry is not written, and the window stays due.
        made := '{}';
        skipped := left(sqlerrm, 300);
      end;
    end if;
  end if;

  landed := roster_landed(w.ends_at);
  rec := rec || jsonb_build_object('landedCount', jsonb_array_length(landed), 'landed', coalesce((select jsonb_agg(x.e order by x.i) from jsonb_array_elements(landed) with ordinality x(e, i) where x.i <= 20), '[]'::jsonb));
  if skipped is not null then rec := rec || jsonb_build_object('skipped', skipped); end if;
  insert into roster_entries (window_end, season, acts, record) values (w.ends_at, w.season, made, rec);
  if cardinality(made) = 0 then
    -- Nothing was posted (the System off, no Boss, a limit too small, nothing to report): this window's newcomers are held for the next report that posts, since the next window's scan starts at this entry. A character
    -- already held keeps its row; each is held once, so the table follows distinct characters, never Acts.
    insert into roster_pending (character, window_end)
    select x.who, w.ends_at from roster_newcomers(w.ends_at) x
    on conflict (character) do nothing;
  else
    -- Every newcomer of the window is written down as seen, the 25 it listed and those it only counted ("and N more"): each is listed once in its life, and a backlog that is never listed would widen every later window.
    insert into roster_seen (character, window_end, act)
    select p.id, w.ends_at, (select a.id from acts_public a where a."character" = p.id order by a.created_at, a.id limit 1)
    from (select n from unnest(coalesce(write_roster_entry.newcomers, '{}')) n union select x.who from roster_newcomers(w.ends_at) x) l(n)
    join characters_public p on p.id = l.n and p.staff is null
    on conflict (character) do nothing;
    if jsonb_array_length(landed) > 0 then
      insert into news_landed (act, kind) values (made[1], 'roster');
      perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'tally', 'act', made[1], 'at', now()));
    end if;
  end if;
  return jsonb_build_object('written', true, 'posts', cardinality(made), 'thread', th) || case when skipped is not null then jsonb_build_object('skipped', skipped) else '{}'::jsonb end;
end $$;
revoke execute on function write_roster_entry(timestamptz, uuid[], text[], jsonb) from public, anon, authenticated;
grant execute on function write_roster_entry(timestamptz, uuid[], text[], jsonb) to service_role;

-- ---- A board move tells both boards (issue #1241; the design, section 2) ----
--
--   thread_stub(thread, board)  the stub board_stubs (0326) lists for one thread on one board, key for key: id, title, moved_to, moved_to_slug, moved_to_name, moved_at. Null where that board lists none (the thread
--                               never left it by a moveThread, the move was reversed or overturned, it is past movedStubDays, or it is back). It joins boards_now, closed boards included, so a closed board lists the stub as board_stubs does.
--                               It has no 50-row cap: it answers for one thread, and board_stubs' limit bounds a page, which rebuild_thread_places keeps by sending a board of more than 50 moved threads one `changed`.
--   rebuild_thread_places       (0339) the one writer of threads.board (the guard trigger of 0339 refuses any other, and the import runs in replica role, which sends nothing), so the one place that hears a move. After its step 5 it queues,
--                               for the threads it moved: `row` (thread_row) on `board:<new>`; `moved` (thread_stub) on `board:<old>`, where that board lists a stub of it, else `gone` {id}; one `changed` {} instead of all of that on a board more than 50 moved threads leave or join; and `board` (board_summary) on `index` once for each board that
--                               gained or lost a thread. It is a statement of its own, after the move, so the projections read the state the page's next read would. It is no trigger on threads: a transition-table trigger cannot be limited to
--                               a column (0339 measured what firing on every reply cost), and a row trigger would ask board_summary once for each thread of a merge of ten thousand.
--   Nothing private: a thread, its boards, its title and the time it moved are what the page lists to every signed-in player. No owner, account, reader, class or view count is read.
-- A way out: nothing here holds a player in a state; a missed event is read again by the page's own reload.

create function thread_stub(in_thread uuid, in_board uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- The keys are pinned in supabase/tests/0455-live-lists-and-self.sql, and are board_stubs' own.
  return (select jsonb_build_object('id', s.thread, 'title', s.title, 'moved_to', s.board, 'moved_to_slug', n.slug, 'moved_to_name', n.name, 'moved_at', s.left_at)
    from (
      select distinct on (d.thread) d.thread, d.left_at, t.title, t.board
      from thread_departures d
      join threads t on t.id = d.thread
      where d.thread = in_thread and d.from_board = in_board and d.left_at >= now() - moved_stub_days() * interval '1 day' and t.board <> in_board
        and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = d.act and e.payload ->> 'why' in ('reversed', 'overturned'))
      order by d.thread, d.left_at desc
    ) s
    join boards_now n on n.id = s.board);
end $$;
revoke execute on function thread_stub(uuid, uuid) from public, anon, authenticated;

create or replace function rebuild_thread_places(which uuid[] default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ids uuid[];
  olds uuid[];
  news uuid[];
  d record;
  changed integer;
  stub jsonb;
  b uuid;
  bulk uuid[];
begin
  -- 0. The one global key, before anything is read: what another writer committed is what this call computes from.
  perform lock_thread_places();
  -- 1. The moves, computed once. Three reads: every thread, a long list (one pass over every thread is cheaper than a probe per thread; REBUILD_SET_BASED_FROM), a short list.
  if which is null then
    select array_agg(t.id), array_agg(t.board), array_agg(c.place) into ids, olds, news
    from threads t join thread_places_computed() c on c.thread = t.id where c.place is not null and t.board is distinct from c.place;
  elsif cardinality(which) > 100 then
    select array_agg(t.id), array_agg(t.board), array_agg(c.place) into ids, olds, news
    from threads t join thread_places_computed() c on c.thread = t.id
    where t.id in (select u from unnest(which) u) and c.place is not null and t.board is distinct from c.place;
  else
    select array_agg(p.id), array_agg(p.board), array_agg(p.place) into ids, olds, news
    from (select x.id, x.board, thread_place(x.id) as place from threads x where x.id = any (which)) p where p.place is not null and p.board is distinct from p.place;
  end if;
  if ids is null then return 0; end if;

  -- 2. The search copy, before threads is touched: a reply to a moved thread does not wait on these rows.
  update post_search p set board = m.place from unnest(ids, news) as m(id, place) where p.thread = m.id and p.board is distinct from m.place;

  -- 3. The counts, once per board by the net change, on the shard a row trigger would have taken; the system board's threads are never counted.
  for d in
    select x.board, sum(x.delta)::integer as delta from (
      select o as board, -1 as delta from unnest(olds) o
      union all
      select n, 1 from unnest(news) n
    ) x where not exists (select 1 from boards b where b.id = x.board and b.is_system) group by x.board having sum(x.delta) <> 0 order by x.board
  loop
    update board_thread_counts set threads = threads + d.delta
     where board = d.board and shard = coalesce((select c.shard from board_thread_counts c where c.board = d.board order by c.shard for update skip locked limit 1), 0);
  end loop;

  -- 4. threads.board, last and in one statement, past the guard. A thread whose board is no longer the one this call read (another rebuild between the read and here) fails the call, which rolls the
  -- counts and the search copy back with it, rather than leaving them counted for a move that was not made.
  perform set_config('kayfabb.rebuilding_places', 'on', true);
  update threads t set board = m.place from unnest(ids, olds, news) as m(id, old_board, place) where t.id = m.id and t.board = m.old_board;
  get diagnostics changed = row_count;
  perform set_config('kayfabb.rebuilding_places', 'off', true);
  if changed <> cardinality(ids) then
    raise exception 'rebuild_thread_places found % of % threads moved by another writer; nothing was written', cardinality(ids) - changed, cardinality(ids);
  end if;

  -- 5. The search rows a reply wrote in the meantime. It took its thread's row after step 2 and before step 4 and read the board the thread was leaving; step 4 waited for it, so it is visible now. Only stale rows.
  update post_search p set board = m.place from unnest(ids, news) as m(id, place) where p.thread = m.id and p.board is distinct from m.place;

  -- 6. Tell the boards, after the move (live lists). A board that more than 50 threads (board_stubs' limit) leave or join in this call hears one `changed` and no per-thread event: a merge of five thousand threads and its
  -- reversal would otherwise send two events per thread to every reader and cost 0189 minutes. For every other board: the new board hears the thread's `row`; the old board hears the stub its next read would draw
  -- (`moved`) or, where it lists none (a merge, a reversal), `gone` with the thread's id, so its page drops the row; the index hears each board's entry once.
  -- One read of the moved threads' rows (of the threads headed for a small board), and a stub probe only for a thread that has a departure from the board it left (a merge's threads have none).
  select coalesce(array_agg(x.board), array[]::uuid[]) into bulk
  from (select u.board from (select unnest(olds) as board union all select unnest(news)) u group by u.board having count(*) > live_bulk_threads()) x;
  foreach b in array bulk loop
    perform broadcast_later('board:' || b, 'changed', '{}'::jsonb);
  end loop;
  -- The new boards' rows and every touched board's entry are built at commit (live_lists_flush), from the state the transaction ends in: work after this call (a veil, a later Act) can change them.
  insert into live_list_queue (threads, boards)
    select coalesce(array_agg(m.id) filter (where m.place <> all (bulk)), '{}'), (select coalesce(array_agg(distinct x), '{}') from (select unnest(olds) union all select unnest(news)) u(x))
    from unnest(ids, news) as m(id, place);
  for d in select m.id, m.old_board,
                  exists (select 1 from thread_departures x where x.thread = m.id and x.from_board = m.old_board) as departed
           from unnest(ids, olds) as m(id, old_board) where m.old_board <> all (bulk) loop
    stub := case when d.departed then thread_stub(d.id, d.old_board) end;
    if stub is not null then
      perform broadcast_later('board:' || d.old_board, 'moved', stub);
    else
      perform broadcast_later('board:' || d.old_board, 'gone', jsonb_build_object('id', d.id));
    end if;
  end loop;
  return changed;
end $$;
