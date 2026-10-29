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

create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'edit' then
    new.seq := null;
  else
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at) where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;

-- The column for threads that predate it: their latest Act that is no edit. Kept as a function so
-- a test can replay it (supabase/tests/0034-thread-list.sql); not callable by the API roles.
create function backfill_threads_last_at() returns void
language sql set search_path = public, pg_temp as $$
  update threads t set last_at = (select max(a.created_at) from acts a where a.thread = t.id and a.kind <> 'edit')
$$;
select backfill_threads_last_at();

create index threads_board_last_at on threads (board, last_at desc);
-- A thread's replies this week, read from the thread's own posts in time order, never from every Act.
create index acts_recent_posts on acts (thread, created_at) where kind = 'post' and seq > 1;

-- A board's list of threads, one row each, as a screen shows it. The first and last Acts are read by
-- the unique (thread, seq) index, the week's replies by acts_recent_posts. Replies this week are
-- posts (no spin, card or edit) made in the last 7 days, not counting the opening post. Public,
-- as threads and acts are: every column is a thread's or an Act's public one, a character's id as
-- an Act already carries it (null for The System's own Acts), and nothing in it depends on who
-- owns a character or who read a thread.
create view thread_list as
  select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.next_seq - 1 as last_seq,
         f.id as first_act, f.character as first_character,
         l.id as last_act, l.character as last_character,
         (select count(*) from acts r where r.thread = t.id and r.kind = 'post' and r.seq > 1 and r.created_at > now() - interval '7 days') as replies_this_week
  from threads t
  left join acts f on f.thread = t.id and f.seq = 1
  left join acts l on l.thread = t.id and l.seq = t.next_seq - 1;

-- --------------------------------------------------------------------------- grants ----

revoke all on my_characters, my_wallet, my_ledger, my_wallet_events, screen_settings, thread_list from anon, authenticated;
grant select on my_characters, my_wallet, my_ledger, my_wallet_events, thread_list to authenticated;
grant select on screen_settings to anon, authenticated;
revoke execute on function backfill_threads_last_at() from public, anon, authenticated;
