-- Live updates: what reaches a reader without a refresh.
--
-- Task 13 of docs/plans/2026-10-28-core-loop-engine-plan.md. Every live update is a broadcast the
-- act Edge Function sends after its write, carrying the public projection the SQL function
-- returned: a new Act or thread, a reaction tally, a saved effect (supabase/functions/
-- _shared/broadcast.ts). So no table is published for Postgres changes at all: a row that
-- reached a client through the publication would carry every column it has, the private ones
-- with it. supabase/tests/0014-realtime.sql fails on any table in a publication that has an
-- owner, class, reactor, player or wallet column.
--
-- The channels are private: a client listening needs a signed-in session, so a visitor with no
-- account reads nothing live, as it reads nothing else. On a project, Realtime authorizes a
-- private channel's listeners against realtime.messages' row-level security, which Supabase
-- enables on that table and owns; this adds only the policy, which is what its own guide does.

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'realtime')
     and exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    -- Fail closed: without row-level security the policy would hold nobody back.
    if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
      raise exception 'realtime.messages has no row-level security, so private channels would be open to every listener';
    end if;
    execute $p$create policy "signed-in players hear the board" on realtime.messages for select to authenticated
      using (extension = 'broadcast' and (realtime.topic() like 'thread:%' or realtime.topic() like 'board:%'))$p$;
  end if;
end $$;
