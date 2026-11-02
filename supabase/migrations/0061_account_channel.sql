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
-- therefore claims what it returns: a row is leased for two minutes (`claimed_until`) and skipped by every other call
-- until the lease lapses or broadcasts_sent clears it. A drain whose send failed leaves its rows claimed, and they come
-- back after the lease, oldest first; so a row is sent at least once, never lost, and sent twice only where a drain dies
-- between its send and its clearing, which a client absorbs by keeping an Act by its id (0007). `for update skip locked`
-- makes two claims in the same instant take different rows. The shape of the answer is as before.
alter table broadcasts_due add column claimed_until timestamptz;

create or replace function due_broadcasts(most integer default 500) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  claimed jsonb;
begin
  with taken as (
    update broadcasts_due b set claimed_until = clock_timestamp() + interval '2 minutes'
    where b.id in (
      select w.id from broadcasts_due w
      where w.claimed_until is null or w.claimed_until < clock_timestamp()
      order by w.id limit greatest(most, 0) for update skip locked)
    returning b.id, b.topic, b.event, b.payload
  )
  select jsonb_agg(jsonb_build_object('id', t.id, 'topic', t.topic, 'event', t.event, 'payload', t.payload) order by t.id) into claimed from taken t;
  return coalesce(claimed, '[]');
end $$;
