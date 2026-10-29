-- What the screens read: a player's own state through views of its own, a public settings view, and
-- a thread list that does not scan. The screens' web plan, Task 2; the owner decided on 2026-10-29
-- that the web never reads the characters, class_history, wallets, ledger, wallet_events or
-- pending_turns tables, because their column grants and row policies are right for a client written
-- against them and wrong as a surface to build screens on.
--
-- Two new settings, postsPerPage (a thread's page) and hotReplies (a thread is HOT with at least
-- this many replies in the last 7 days), are rows of the settings table like any other and need no
-- SQL: seed_instance() writes whatever the instance's settings hold. An instance seeded before this
-- migration holds neither until it is seeded again, and screen_settings simply returns what the
-- table holds (as 0018 says of viewCountCron).
--
-- The my_* views run as their owner, filtered to the caller, as my_invites (0020) and my_reactions
-- (0018) do, so the tables stay unreadable by the API roles. A view calls a function with its
-- caller's privileges, not its owner's: setting() is not executable by a player, so these read the
-- settings table itself, and call only span_interval() and next_settlement_at(), which are.
-- Nothing here is computed from another player's rows; every my_* view answers from the caller's
-- own, so "a response never proves a private fact" holds by construction.
--
-- Counters, not counts. Every number a screen shows per view is a row a trigger keeps (a thread's
-- replies, a character's posts, a board's threads, the number of debuted characters) or a read of an
-- index range (a character's place), so a view costs the page and not an instance's history.

-- This file is one transaction, and it begins by locking the tables the counters below are backfilled
-- from. The backfills read a table in one statement and the triggers that keep each counter are created
-- after it, so a row written between the two (by an instance that is live while this is applied) would
-- be counted by neither: not in the backfill, which had already read, and not by the trigger, which
-- did not exist yet. SHARE ROW EXCLUSIVE lets readers carry on and makes every writer of these tables
-- wait for the commit, after which its row fires the triggers. Not the same lock as the ALTERs below
-- take (they are stronger, on threads and boards only), and it must come first so no writer is already
-- through.
begin;
lock table acts, threads, characters in share row exclusive mode;

-- ---------------------------------------------------------------- a player's characters ----

-- One row per character the caller plays. It never shows class_history's id (its gaps would count
-- other players' Turns), a pending Turn's asked_at, a character's name_key or name_look, its owner
-- or when it was made, nor anything of another player's characters.
--   class, class_since: the latest class_history row's class and its started_at.
--   turn_opens_at: when it may next Turn, by the rule turn() refuses with ("this character can Turn
--     again at ..."): the cooldown runs from the last Turn that took effect, a first class is not a
--     Turn; null when it may Turn now.
--   debuted_at: null while it waits to debut. retired_at: when an admin retired it.
--   pending_*: a Turn waiting for the settlement; takes_effect_at is that settlement's end
--     (next_settlement_at()), null with no Turn pending or no window known.
-- Its way out, for a waiting Turn: the settlement, or its player's withdraw_turn().
create view my_characters as
  select c.id, c.name, h.class_key as class, h.started_at as class_since,
         case when t.at > now() then t.at end as turn_opens_at,
         c.debuted_at, c.debut_loudness, c.retired_at,
         p.class_key as pending_class, p.loudness as pending_loudness, p.show_from as pending_show_from, p.show_to as pending_show_to,
         case when p.character is not null then next_settlement_at(now()) end as takes_effect_at
  from characters c
  cross join lateral (select x.class_key, x.started_at from class_history x where x.character = c.id order by x.started_at desc limit 1) h
  cross join lateral (
    select (select max(x.started_at) from class_history x
            where x.character = c.id and x.started_at > (select min(f.started_at) from class_history f where f.character = c.id))
           + span_interval((select s.value from settings s where s.key = 'turnCooldown')) as at
  ) t
  left join pending_turns p on p.character = c.id
  where c.owner = auth.uid();

-- ------------------------------------------------------------------------- the wallet ----

-- The caller's wallet: exactly one row for a signed-in caller, whose balance is 0 until a
-- settlement pays or a purchase spends (no wallets row exists before), and the cap it is held to.
-- Never the account, and nothing of anyone else's wallet.
create view my_wallet as
  select coalesce((select w.balance from wallets w where w.account = auth.uid()), 0) as balance,
         (select (s.value #>> '{}')::integer from settings s where s.key = 'walletCap') as cap
  where auth.uid() is not null;

-- The caller's settled ledger lines with the window each was settled in. Never the account or the
-- line's id.
create view my_ledger as
  select l.settlement, s.starts_at, s.ends_at, l.character, l.reason, l.amount
  from ledger l join settlements s on s.id = l.settlement
  where l.account = auth.uid();

-- The caller's wallet events, as the wallet's history adds up (0003). Never the account or the id.
create view my_wallet_events as
  select e.settlement, e.kind, e.change, e.overflow, e.floored, e.balance_after, e.ref, e.at
  from wallet_events e
  where e.account = auth.uid();

-- ----------------------------------------------------------------------- the settings ----

-- The settings a screen shows or checks against, as one object, for a visitor too: the sign-up
-- page is signed out and must know whether the instance asks for an invite. None of them is a
-- private fact. Not the economy, not a cron, not The System's copy: only the keys listed here,
-- and a key the instance does not hold is absent from the object, not null.
create view screen_settings as
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb) as settings
  from settings s
  where s.key in ('postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime',
                  'turnCooldown', 'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength');

-- --------------------------------------------------------------------------- the list ----

-- When a thread last had an Act shown in it, so a board's threads sort by their latest from an
-- index and a page of the list never computes every thread's last Act. An edit is a layer over a
-- post and bumps nothing. Kept by acts_take_seq(), in the same UPDATE that takes the sequence
-- number (so it is as race-free as the number is); the latest, not the last written, so an Act
-- written out of order never moves it back. A counter-like column, not an Act: nothing here
-- edits an Act's content.
alter table threads add column last_at timestamptz;

-- A thread's replies: its posts after the first. A counter and not a count, because a list of a
-- busy instance's threads must never count a long thread's posts to show one number per row; it is
-- kept by acts_take_seq() in the same UPDATE as the sequence number and last_at, so it is as
-- race-free as they are. A card, a spin, an unmask, a tally and an edit are Acts that are no reply.
alter table threads add column replies integer not null default 0;

create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'edit' then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;

-- The columns for threads that predate them: their latest Act that is no edit, and their posts
-- after the first. Kept as a function so a test can replay it (supabase/tests/0034-thread-list.sql);
-- not callable by the API roles.
create function backfill_thread_counters() returns void
language sql set search_path = public, pg_temp as $$
  update threads t set last_at = (select max(a.created_at) from acts a where a.thread = t.id and a.kind <> 'edit'),
                       replies = (select count(*) from acts a where a.thread = t.id and a.kind = 'post' and a.seq > 1)
$$;
select backfill_thread_counters();

-- The price of a list that never scans: last_at is in this index, so every non-edit Act's update of
-- its thread (acts_take_seq() above) changes an indexed column, which makes it a non-HOT update that
-- also writes an index entry. That is the cost of putting the sort in the index, paid on every post
-- of a busy instance, and chosen over scanning every thread's Acts for each page of a list.
create index threads_board_last_at on threads (board, last_at desc);
-- A thread's replies this week, read from the thread's own posts in time order, never from every Act.
create index acts_recent_posts on acts (thread, created_at) where kind = 'post' and seq > 1;

-- A board's list of threads, one row each, as a screen shows it. The first and last Acts are read by
-- the unique (thread, seq) index, the week's replies by acts_recent_posts. Replies this week are
-- posts (no spin, card or edit) made in the last 7 days, not counting the opening post; replies is
-- the thread's counter (threads.replies, above), never a count of its posts. replies_this_week is
-- capped at the hotReplies setting: a screen only compares it with that threshold (a thread is HOT
-- at that many), so counting a busy thread's every reply this week (hundreds, for each row of a
-- page) would be work for a number nobody reads; the subquery stops at the threshold. A column that
-- reads hotReplies when the setting is absent (an instance not yet seeded with it) is not capped, as
-- `limit null` is no limit. A spun thread's origin
-- (the origin Act's thread, that thread's title and the Act's seq) is read in the same query, so a
-- list never reads it row by row. Public,
-- as threads and acts are: every column is a thread's or an Act's public one, a character's id as
-- an Act already carries it (null for The System's own Acts), and nothing in it depends on who
-- owns a character or who read a thread.
create view thread_list as
  select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.next_seq - 1 as last_seq, t.replies,
         f.id as first_act, f.character as first_character,
         l.id as last_act, l.character as last_character,
         (select count(*) from (
            select 1 from acts r where r.thread = t.id and r.kind = 'post' and r.seq > 1 and r.created_at > now() - interval '7 days'
            limit (select (h.value #>> '{}')::integer from settings h where h.key = 'hotReplies')
          ) capped) as replies_this_week,
         o.thread as origin_thread, ot.title as origin_title, o.seq as origin_seq
  from threads t
  left join acts f on f.thread = t.id and f.seq = 1
  left join acts l on l.thread = t.id and l.seq = t.next_seq - 1
  left join acts o on o.id = t.origin_act_id
  left join threads ot on ot.id = o.thread;

-- ------------------------------------------------------------------ a board's thread count ----

-- How many threads a board holds, for the index and for a board's pager. A counter, kept by a trigger
-- on a thread's creation (a thread is never deleted or moved, by append-only), and not a count of
-- thread_list: a board's page must cost its page however many threads the board has had. Public, as
-- the threads are; nothing in it depends on who started one.
--
-- Sharded, because one row per board would make every thread started on a board wait for the one
-- before it to commit (and a settlement that debuts characters hold every other debut back, below):
-- a counter row is locked until its transaction ends. A shard is taken with FOR UPDATE SKIP LOCKED, so
-- a writer uses a shard no other open transaction holds, and a read is the sum of a board's four
-- rows, a constant. Only if every shard is held by other open transactions does a writer wait, on the first.
create table board_thread_counts (
  board uuid not null references boards (id),
  shard smallint not null check (shard >= 0),
  threads integer not null default 0,
  primary key (board, shard)
);
alter table board_thread_counts enable row level security;

create function boards_make_thread_counts() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into board_thread_counts (board, shard) select new.id, g from generate_series(0, 3) g;
  return new;
end $$;
create trigger boards_make_thread_counts after insert on boards for each row execute function boards_make_thread_counts();
insert into board_thread_counts (board, shard) select b.id, g from boards b, generate_series(0, 3) g;

create function threads_count_board() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update board_thread_counts set threads = threads + 1
   where board = new.board and shard = coalesce((select c.shard from board_thread_counts c where c.board = new.board order by c.shard for update skip locked limit 1), 0);
  return new;
end $$;
create trigger threads_count_board after insert on threads for each row execute function threads_count_board();

-- For boards that predate it; a function so a test can replay it, not callable by the API roles.
create function backfill_board_counts() returns void
language sql set search_path = public, pg_temp as $$
  update board_thread_counts c set threads = case when c.shard = 0 then (select count(*) from threads t where t.board = c.board) else 0 end
$$;
select backfill_board_counts();

-- A board's threads, one row each: the sum of its shards.
create view board_counts as
  select c.board, sum(c.threads)::integer as threads from board_thread_counts c group by c.board;

-- ------------------------------------------------------------------ the season's standings ----

-- season_standings (0021) ranks every debuted character with a window, and a filter on a character is
-- not pushed below a window, so reading one character's place through it ranks all of them. The screens
-- that show one place (a profile) or one standing per character (a page of postbits) read these instead.
-- The standings screen is the one place whose job is the whole ranking, a page of it at a time; it
-- keeps reading season_standings.

-- How many characters have debuted: the "of" in "Place 7 of 1,204", and the standings screen's pager.
-- A counter, kept by a trigger on a character's debut (a character created already debuted, a waiting
-- one that debuts), and not a count of characters; the same number season_standings lists. Sharded as
-- board_thread_counts is, so a settlement that debuts characters, which holds its counter until it
-- commits, does not make a character created at that moment wait for it.
create table debuted_count (
  shard smallint primary key check (shard >= 0),
  characters integer not null default 0
);
alter table debuted_count enable row level security;
insert into debuted_count (shard) select g from generate_series(0, 3) g;

create function characters_count_debuted() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  change integer := case when tg_op = 'DELETE' then 0 else (new.debuted_at is not null)::integer end
                  - case when tg_op = 'INSERT' then 0 else (old.debuted_at is not null)::integer end;
begin
  if change <> 0 then
    update debuted_count set characters = characters + change
     where shard = coalesce((select d.shard from debuted_count d order by d.shard for update skip locked limit 1), 0);
  end if;
  return null;
end $$;
create trigger characters_count_debuted after insert or update of debuted_at or delete on characters for each row execute function characters_count_debuted();

create function backfill_debuted_count() returns void
language sql set search_path = public, pg_temp as $$
  update debuted_count set characters = case when shard = 0 then (select count(*) from characters where debuted_at is not null) else 0 end
$$;
select backfill_debuted_count();

-- The count as a public view, for the standings screen's pager. A view runs as its owner, so the table
-- stays unreadable by the API roles; the number is the length of a public list.
create view season_size as select sum(d.characters)::integer as characters from debuted_count d;

-- A place is the number of characters standing higher, plus one; those counts are read from an index of
-- the standings by amount, so they cost the characters ahead and never rank anyone.
create index standings_season_amount on standings (season, amount desc);

-- One debuted character's standing, its place and the number of characters, as season_standings would
-- say them: {standing, place, of}, or null for a character that has not debuted or does not exist (one
-- answer for both, so it proves nothing about a waiting character). The season is the one season_standings
-- reads. A character with no standings row stands at 0, as there. Public: a standing and a place are what
-- the standings list shows, and nothing here is computed from who plays a character.
--   standing >= 0: the characters ahead are the rows above it (a character with no row stands at 0 and
--     is never above a standing of 0 or more); one range of the index.
--   standing < 0: every character with no row (standing 0) is ahead of it, and they are not rows, so the
--     characters ahead are all of them but the rows at or below its standing: one range of the index, of
--     the debts only, and the counter.
-- A standings row is a character's that has acted, and only a debuted character can act, so a row is
-- always a debuted character's. Ties share a place: "ahead" is strictly higher.
create function standing_place(of_character uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  open_season bigint := coalesce((select id from seasons where ends_at is null), (select id from seasons order by starts_at desc limit 1));
  size integer := (select sum(d.characters) from debuted_count d);
  mine integer;
  ahead bigint;
begin
  if not exists (select 1 from characters c where c.id = of_character and c.debuted_at is not null) then return null; end if;
  mine := coalesce((select s.amount from standings s where s.season = open_season and s.character = of_character), 0);
  if mine < 0 then
    ahead := size - (select count(*) from standings s where s.season = open_season and s.amount <= mine);
  else
    ahead := (select count(*) from standings s where s.season = open_season and s.amount > mine);
  end if;
  return jsonb_build_object('standing', mine, 'place', ahead + 1, 'of', size);
end $$;

-- ------------------------------------------------------------- a character's post count ----

-- How many posts, spins and cards a character has made, for a page of postbits ("Posts: 1,204" under
-- every avatar) and a profile's three counts. Counters in a row of their own, kept by a trigger after
-- each such Act, and not counts of the Acts: a page of twenty postbits must cost twenty primary-key
-- reads however many posts a busy character has made, and a profile one, where counting would read
-- all of a character's history on every view. The price is one more write per post, spin or card, to
-- the row of the character that acted (a player's own character, so no two players' Acts contend for
-- it), chosen over a read that grows with the Acts. An unmask, a tally, a reveal and an edit are
-- counted by none. A character that never acted has no row, and the read says 0. Public, as an Act's
-- author and kind already are; the table is not an Act and holds nothing an Act does not.
create table character_post_counts (
  character uuid primary key references characters (id),
  posts integer not null default 0 check (posts >= 0),
  spins integer not null default 0 check (spins >= 0),
  cards integer not null default 0 check (cards >= 0)
);
alter table character_post_counts enable row level security;

create function acts_count_character() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p integer := case when new.kind = 'post' then 1 else 0 end;
  s integer := case when new.kind = 'spin' then 1 else 0 end;
  k integer := case when new.kind = 'card' then 1 else 0 end;
begin
  insert into character_post_counts as c (character, posts, spins, cards) values (new.character, p, s, k)
  on conflict (character) do update set posts = c.posts + p, spins = c.spins + s, cards = c.cards + k;
  return new;
end $$;
create trigger acts_count_character after insert on acts for each row when (new.kind in ('post', 'spin', 'card') and new.character is not null) execute function acts_count_character();

-- For characters that predate it; kept as a function so a test can replay it, and not callable by the API roles.
create function backfill_character_post_counts() returns void
language sql set search_path = public, pg_temp as $$
  insert into character_post_counts (character, posts, spins, cards)
  select a.character, count(*) filter (where a.kind = 'post'), count(*) filter (where a.kind = 'spin'), count(*) filter (where a.kind = 'card')
  from acts a where a.kind in ('post', 'spin', 'card') and a.character is not null group by a.character
  on conflict (character) do update set posts = excluded.posts, spins = excluded.spins, cards = excluded.cards
$$;
select backfill_character_post_counts();

-- ----------------------------------------------------------------- a character's month ----

-- The month a character debuted, as a date on the first day of it, and never the time: two
-- characters made a minute apart is a way of reading who owns them (the screens' design, section
-- 4), and "Joined Oct 2026" is all a profile or a postbit says. Added last, so the view keeps the
-- columns and the order it had; the month is UTC's, whatever the session's time zone. A character waiting to debut is in no list, so has no month.
create or replace view characters_public as
  select c.id, c.name, date_trunc('month', c.debuted_at at time zone 'UTC')::date as joined from characters c where c.debuted_at is not null;

-- --------------------------------------------------------------------------- grants ----

revoke all on my_characters, my_wallet, my_ledger, my_wallet_events, screen_settings, thread_list, character_post_counts, board_thread_counts, board_counts, debuted_count, season_size from anon, authenticated;
grant select on my_characters, my_wallet, my_ledger, my_wallet_events, thread_list, character_post_counts, board_counts, season_size to authenticated;
create policy read_all on character_post_counts for select to authenticated using (true);
grant select on screen_settings to anon, authenticated;
revoke execute on function backfill_thread_counters(), backfill_character_post_counts(), acts_count_character(),
  backfill_board_counts(), threads_count_board(), boards_make_thread_counts(), backfill_debuted_count(), characters_count_debuted(), standing_place(uuid) from public, anon, authenticated;
grant execute on function standing_place(uuid) to authenticated;

commit;
