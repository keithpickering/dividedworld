-- The thread list's read (supabase/migrations/0030_screens_reads.sql): threads.last_at, kept by
-- the trigger that takes an Act's sequence number, so a board's threads sort by their latest Act
-- from an index and never by a scan of every thread's Acts; and the thread_list view, a public
-- projection of what a list row shows. An edit is a layer over a post and bumps nothing. The
-- screens' web plan, Task 2.

do $$
declare
  ann uuid := tests.account('tl-ann');
  bob uuid := tests.account('tl-bob');
  a uuid := tests.character(ann, 'Tl Ann');
  b uuid := tests.character(bob, 'Tl Bob');
  older uuid := tests.thread('Older');
  newer uuid := tests.thread('Newer');
  op uuid;
  op2 uuid;
  fresh uuid;
  reply uuid;
  r record;
  t0 timestamptz := date_trunc('second', now() - interval '20 days');
begin
  op := tests.post(a, older, 'Opening', t0);
  op2 := tests.post(b, newer, 'Opening too', t0 + interval '1 day');
  if (select last_at from threads where id = older) is distinct from t0 then raise exception 'a thread''s last_at is its latest Act: %', (select last_at from threads where id = older); end if;
  -- Bump order: a reply to the older thread puts it first.
  reply := tests.post(b, older, 'A reply', t0 + interval '5 days');
  if (select array_agg(title order by last_at desc) from thread_list where title in ('Older', 'Newer')) is distinct from array['Older', 'Newer'] then raise exception 'a reply bumps its thread to the top'; end if;
  -- An edit bumps nothing.
  perform tests.act(a, 'edit', older, '{"body": "Opening, fixed"}', op, t0 + interval '9 days');
  if (select last_at from threads where id = older) is distinct from t0 + interval '5 days' then raise exception 'an edit bumped a thread: %', (select last_at from threads where id = older); end if;
  -- An Act out of order never moves it back.
  perform tests.post(a, older, 'Backdated', t0 + interval '1 day');
  if (select last_at from threads where id = older) is distinct from t0 + interval '5 days' then raise exception 'last_at is the latest, not the last written'; end if;

  -- First and last, and the counts.
  select * into r from thread_list where id = newer;
  if (r.first_act, r.first_character, r.last_act, r.last_character, r.last_seq) is distinct from (op2, b, op2, b, 1) then raise exception 'a one-post thread: %', to_jsonb(r); end if;
  select * into r from thread_list where id = older;
  if r.first_act is distinct from op or r.first_character is distinct from a or r.last_seq is distinct from 3 or r.last_character is distinct from a
     or r.last_act is distinct from (select id from acts where thread = older and seq = 3) then raise exception 'a thread''s first and last: %', to_jsonb(r); end if;
  if r.board is distinct from (select board from threads where id = older) or r.title is distinct from 'Older' or r.created_at is null or r.last_at is distinct from t0 + interval '5 days' then raise exception 'the thread''s own columns: %', to_jsonb(r); end if;

  -- The week: only posts of the last 7 days, never the opening one, never an edit.
  if (select replies_this_week from thread_list where id = older) is distinct from 0 then raise exception 'no reply is from the last 7 days'; end if;
  perform tests.post(b, older, 'Recent 1', now() - interval '1 day');
  perform tests.post(a, older, 'Recent 2', now() - interval '6 days');
  perform tests.act(a, 'edit', older, '{"body": "again"}', op, now());
  if (select replies_this_week from thread_list where id = older) is distinct from 2 then raise exception 'replies this week: %', (select replies_this_week from thread_list where id = older); end if;
  -- A thread opened this week counts its opening post for nothing.
  perform tests.post(a, newer, 'Fresh opening', now() - interval '1 hour');
  if (select replies_this_week from thread_list where id = older) is distinct from 2 then raise exception 'the opening post counts'; end if;

  -- A thread that has only just begun: its opening post is no reply.
  fresh := tests.thread('Fresh');
  perform tests.post(a, fresh, 'Only', now());
  if (select replies_this_week from thread_list where id = fresh) is distinct from 0 then raise exception 'an opening post is not a reply'; end if;

  -- A signed-in player reads the list; a signed-out visitor does not.
  perform tests.become(bob);
  if (select count(*) from thread_list where id = older) is distinct from 1::bigint then raise exception 'a player reads the list'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  begin perform 1 from thread_list; raise exception 'a visitor read the list';
  exception when insufficient_privilege then null; end;
  perform tests.unbecome();
  -- Its columns are public ones only.
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'thread_list')
     is distinct from array['id', 'board', 'title', 'origin_act_id', 'created_at', 'last_at', 'last_seq', 'first_act', 'first_character', 'last_act', 'last_character', 'replies_this_week'] then
    raise exception 'thread_list shows more or less than it should';
  end if;
end $$;

-- ---- The backfill: a thread that predates last_at gets its latest non-edit Act's time ----
do $$
declare
  ann uuid := tests.account('tb-ann');
  a uuid := tests.character(ann, 'Tb Ann');
  th uuid := tests.thread('Backfilled');
  stamp timestamptz := date_trunc('second', now() - interval '3 days');
  filled timestamptz;
begin
  perform tests.post(a, th, 'One', stamp - interval '1 day');
  perform tests.post(a, th, 'Two', stamp);
  perform tests.act(a, 'edit', th, '{"body": "x"}', (select id from acts where thread = th and seq = 1), now());
  -- As it stood before the migration: no last_at. The backfill is the migration's own statement, kept in a function.
  update threads set last_at = null where id = th;
  perform backfill_threads_last_at();
  select last_at into filled from threads where id = th;
  if filled is distinct from stamp then raise exception 'the backfill takes the latest non-edit Act: %', filled; end if;
end $$;
