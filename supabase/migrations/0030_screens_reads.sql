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

revoke all on my_characters, my_wallet, my_ledger, my_wallet_events, screen_settings, thread_list, character_post_counts from anon, authenticated;
grant select on my_characters, my_wallet, my_ledger, my_wallet_events, thread_list, character_post_counts to authenticated;
create policy read_all on character_post_counts for select to authenticated using (true);
grant select on screen_settings to anon, authenticated;
revoke execute on function backfill_thread_counters(), backfill_character_post_counts(), acts_count_character() from public, anon, authenticated;
