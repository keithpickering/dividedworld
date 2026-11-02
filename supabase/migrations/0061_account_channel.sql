-- The private channel, the public one for plays beyond a post, and an outbox two drains can share.
--
-- Alerts (0058) are announced live on `account:<owner>`: a topic only that account may listen to, since the
-- announcement exists only for an owned target and so would tell whoever heard it that the target has an owner. A
-- play beyond a post (a character's, a thread's, a board's; 0055) is announced on `reach`, which every signed-in
-- player hears: it carries the same public projection the play's own thread already carried (an Act as acts_public
-- shows it, never an owner or a class), so a page that shows the character, or a board's banner, hears of it
-- without waiting for its next read (issue 140). `reach` is a topic of its own and not a `thread:`, because the
-- listener is on a page where the play's thread is not.
--
-- As in 0008, the channels are private: a listener needs a signed-in session (the policy is `to authenticated`), and
-- only broadcasts are heard, never presence. auth.uid() is the listener's own account, so the policy compares the
-- topic joined to the account joined as, in full: `account:%` and an account id with something after it match
-- nothing. A fail-closed check as in 0008: no row-level security on realtime.messages, no private channels.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'realtime')
     and exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
      raise exception 'realtime.messages has no row-level security, so private channels would be open to every listener';
    end if;
    execute $p$create policy "an account hears its own channel, and everyone hears reach" on realtime.messages for select to authenticated
      using (extension = 'broadcast' and (realtime.topic() = 'account:' || (select auth.uid())::text or realtime.topic() = 'reach'))$p$;
  end if;
end $$;

-- The outbox, shared by two kinds of drain. Until now one job drained it (settle, a run at a time); the act function now
-- drains it after every write, so two drains can run at once, and each must hand a row to one of them. due_broadcasts
-- therefore claims what it returns: a row is leased for two minutes (`claimed_until`), counted as an attempt (`attempts`),
-- and skipped by every other call until the lease lapses or broadcasts_sent clears it. `for update skip locked` makes two
-- claims in the same instant take different rows. A row is sent at least once and never lost, and sent twice only where a
-- drain dies between its send and its clearing, which a client absorbs by keeping an Act by its id (0007).
--
-- A drain whose send failed does not hold the lease: broadcasts_release lets the rows go after a backoff that doubles with
-- the attempts (5 seconds, then 10, up to the lease), so a row is tried again soon and not at once. A drain doing a long
-- one-at-a-time pass renews the lease it holds (broadcasts_renew). A row the drain gives up on is not deleted:
-- broadcasts_dead keeps it, with its payload and why, out of every claim, so nothing waits behind it and the record stays
-- (supabase/functions/_shared/outbox.ts says when a row is given up). Dead rows are an admin's to read and clear; there is
-- no screen for them yet, and a row there harms no player: its Act is on the board for the next load.
alter table broadcasts_due add column claimed_until timestamptz;
alter table broadcasts_due add column attempts integer not null default 0;
alter table broadcasts_due add column dead_at timestamptz;
alter table broadcasts_due add column dead_why text;

create or replace function due_broadcasts(most integer default 500) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  claimed jsonb;
begin
  with taken as (
    update broadcasts_due b set claimed_until = clock_timestamp() + interval '2 minutes', attempts = b.attempts + 1
    where b.id in (
      select w.id from broadcasts_due w
      where w.dead_at is null and (w.claimed_until is null or w.claimed_until < clock_timestamp())
      order by w.id limit greatest(most, 0) for update skip locked)
    returning b.id, b.topic, b.event, b.payload, b.attempts
  )
  select jsonb_agg(jsonb_build_object('id', t.id, 'topic', t.topic, 'event', t.event, 'payload', t.payload, 'attempts', t.attempts) order by t.id) into claimed from taken t;
  return coalesce(claimed, '[]');
end $$;

create function broadcasts_release(ids jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare changed integer;
begin
  update broadcasts_due set claimed_until = clock_timestamp() + least(interval '5 seconds' * power(2, greatest(attempts - 1, 0)), interval '2 minutes')
  where dead_at is null and id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(ids, '[]')) x);
  get diagnostics changed = row_count;
  return changed;
end $$;

create function broadcasts_renew(ids jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare changed integer;
begin
  update broadcasts_due set claimed_until = clock_timestamp() + interval '2 minutes'
  where dead_at is null and id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(ids, '[]')) x);
  get diagnostics changed = row_count;
  return changed;
end $$;

create function broadcasts_dead(ids jsonb, why text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare changed integer;
begin
  update broadcasts_due set dead_at = clock_timestamp(), dead_why = why, claimed_until = null
  where dead_at is null and id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(ids, '[]')) x);
  get diagnostics changed = row_count;
  return changed;
end $$;

revoke execute on function broadcasts_release(jsonb), broadcasts_renew(jsonb), broadcasts_dead(jsonb, text) from public, anon, authenticated;
grant execute on function broadcasts_release(jsonb), broadcasts_renew(jsonb), broadcasts_dead(jsonb, text) to service_role;

-- write_alert (0058), with the alert's own id in the account broadcast, so a client that hears an alert twice (a send is at least
-- once) or hears it and then reads the list can tell it is the same one, exactly. The id is a random uuid (0058), never a
-- sequence number, so it counts nothing. Everything else as 0058 wrote it.
create or replace function write_alert(of_character uuid, kind text, sub text, about uuid, acting uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owner_of uuid;
  made timestamptz;
  made_id uuid;
begin
  if of_character is null then return; end if;
  select c.owner into owner_of from characters c where c.id = of_character;
  if owner_of is null or owner_of is not distinct from acting then return; end if;
  insert into alerts (account, kind, sub, act, character) values (owner_of, kind, sub, about, of_character) returning at, id into made, made_id;
  perform broadcast_later('account:' || owner_of, 'alert',
    jsonb_build_object('id', made_id, 'kind', kind, 'sub', sub, 'act', about, 'character', of_character, 'at', made));
end $$;
revoke execute on function write_alert(uuid, text, text, uuid, uuid) from public, anon, authenticated, service_role;
