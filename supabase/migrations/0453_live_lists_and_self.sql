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

create function thread_row(in_thread uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return (select to_jsonb(l) from (
    select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.last_seq, t.replies, t.first_act, t.first_character, t.last_act, t.last_character,
           t.replies_this_week, t.origin_thread, t.origin_place
    from thread_list t where t.id = in_thread) l);
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

-- One statement, not one row: a statement that writes many Acts (a settlement's announcements, a backfill, a test that writes twenty thousand) sends each thread's row and each board's entry once, as the state after the statement,
-- and costs two projections for each thread and board it touched and not one for each Act. A row of one Act is the same row: the transition table holds that Act alone.
create function acts_live_lists() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  one record;
  listed jsonb;
  summary jsonb;
begin
  for one in select distinct n.thread from new_acts n where n.thread is not null and n.seq is not null loop
    listed := thread_row(one.thread);
    if listed is not null then perform broadcast_later('board:' || (listed ->> 'board'), 'row', listed); end if;
  end loop;
  for one in select distinct t.board from new_acts n join threads t on t.id = n.thread where n.thread is not null and n.seq is not null loop
    summary := board_summary(one.board);
    if summary is not null then perform broadcast_later('index', 'board', summary); end if;
  end loop;
  return null;
end $$;
revoke execute on function acts_live_lists() from public, anon, authenticated;

create trigger acts_live_lists after insert on acts referencing new table as new_acts for each statement execute function acts_live_lists();

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
--   wallet_events, card_ledger  a statement that writes rows pokes each account it wrote once, except for rows of kind settlement: a settlement moves every wallet in one transaction and the HUD reads again on `settled` instead.
--   self_kinds, quiet_kinds   the Act kinds that can change what my_characters shows, and the others. Both are written out in full on purpose: supabase/tests/0453-live-lists-and-self.sql holds them to acts_kind_check's own list, so a kind
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

-- A statement that wrote wallet rows or ledger rows pokes each account once. The rows' own kind decides for the wallet.
create function wallet_events_self() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare one record;
begin
  for one in select distinct n.account from new_rows n where n.kind <> 'settlement' loop perform poke_self(one.account); end loop;
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
-- Borderline, judged quiet: `card` (a play changes a character only through the rows and Acts beside it, which have their own pokes above, and a pierce or a cut that ends a lift or a lockout writes none: read on
-- the next refresh), `announce` (a loud Turn's words: the Turn's own request is the player's action and the landing is a settlement's), `reveal` (a season's reveal, written in a settlement, changes no class_reveals row),
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
