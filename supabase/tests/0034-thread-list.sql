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
  card uuid;
  spun uuid;
  r record;
  ln record;
  plan text := '';
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

  -- Replies are the posts after the first, a counter kept with the sequence number: a card, a spin,
  -- an unmask, a tally and an edit never count, and a thread's own first post does not.
  select * into r from thread_list where id = older;
  if r.replies is distinct from 4 or r.last_seq is distinct from 5 then raise exception 'replies are the posts after the first: %', to_jsonb(r); end if;
  card := tests.act(b, 'card', older, '{"card": "splat", "config": {"color": "red"}}', op, now());
  perform tests.act(null, 'tally', older, '{"body": "x"}', null, now());
  perform tests.act(a, 'edit', older, '{"body": "thrice"}', op, now());
  select * into r from thread_list where id = older;
  if r.replies is distinct from 4 or r.last_seq is distinct from 7 then raise exception 'a card, a tally and an edit are no replies: %', to_jsonb(r); end if;
  if (select replies from thread_list where id = fresh) is distinct from 0 or (select replies from thread_list where id = newer) is distinct from 1 then
    raise exception 'a one-post thread has no replies, and the other thread''s count is its own';
  end if;
  -- A thread opened by a spin, in the list's one query: the origin Act's thread, that thread's title and the Act's seq.
  spun := tests.thread('Spun');
  update threads set origin_act_id = card where id = spun;
  select * into r from thread_list where id = spun;
  if (r.origin_thread, r.origin_title, r.origin_seq) is distinct from (older, 'Older', (select seq from acts where id = card)) then raise exception 'a spun thread names its origin: %', to_jsonb(r); end if;
  select * into r from thread_list where id = older;
  if r.origin_thread is not null or r.origin_title is not null or r.origin_seq is not null then raise exception 'a thread that was not spun has no origin: %', to_jsonb(r); end if;

  -- The list never scans: a board's page is read from the (board, last_at) index, and the week's
  -- replies from the partial index of recent posts. A table this small would be scanned whatever
  -- the indexes were, so the sequential scan is off for the plans being looked at.
  set local enable_seqscan = off;
  for ln in execute format('explain select * from thread_list where board = %L order by last_at desc limit 20', (select board from threads where id = older)) loop
    plan := plan || E'\n' || ln."QUERY PLAN";
  end loop;
  if plan not like '%threads_board_last_at%' then raise exception 'a board''s list is not read from threads_board_last_at: %', plan; end if;
  -- The week's replies: on a table this small the planner reads the week's posts through any index
  -- that mentions a thread or kind, usable or not. So every other index on acts is dropped here (this
  -- file is rolled back) and the question is whether acts_recent_posts can serve the subquery, that
  -- is, that its predicate still matches the view's.
  for ln in select indexname from pg_indexes where schemaname = 'public' and tablename = 'acts' and indexname not in ('acts_recent_posts', 'acts_pkey') and indexname not in (select conname from pg_constraint) loop
    execute format('drop index %I', ln.indexname);
  end loop;
  alter table acts drop constraint acts_thread_seq_key;
  plan := '';
  for ln in execute format('explain select * from thread_list where board = %L order by last_at desc limit 20', (select board from threads where id = older)) loop
    plan := plan || E'\n' || ln."QUERY PLAN";
  end loop;
  if plan not like '%acts_recent_posts%' then raise exception 'the week''s replies are not read from acts_recent_posts: %', plan; end if;
  set local enable_seqscan = on;

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
     is distinct from array['id', 'board', 'title', 'origin_act_id', 'created_at', 'last_at', 'last_seq', 'replies', 'first_act', 'first_character', 'last_act', 'last_character', 'replies_this_week', 'origin_thread', 'origin_title', 'origin_seq'] then
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
  update threads set last_at = null, replies = 0 where id = th;
  perform backfill_thread_counters();
  select last_at into filled from threads where id = th;
  if filled is distinct from stamp then raise exception 'the backfill takes the latest non-edit Act: %', filled; end if;
  if (select replies from threads where id = th) is distinct from 1 then raise exception 'the backfill counts the posts after the first: %', (select replies from threads where id = th); end if;
end $$;

-- ---- A character's posts, counted for a page of postbits without counting its Acts ----
-- character_post_counts is a counter kept by the trigger that follows an Act, so a page of postbits
-- reads one row per character and never counts a busy character's posts. A card, a spin, an unmask,
-- a tally and an edit are not posts. Public: an Act's author and kind already are.
do $$
declare
  ann uuid := tests.account('pc-ann');
  bob uuid := tests.account('pc-bob');
  a uuid := tests.character(ann, 'Pc Ann');
  b uuid := tests.character(bob, 'Pc Bob');
  idle uuid := tests.character(bob, 'Pc Idle');
  th uuid := tests.thread('Counted');
  op uuid;
begin
  op := tests.post(a, th, 'One');
  perform tests.post(a, th, 'Two');
  perform tests.post(b, th, 'Three');
  perform tests.act(a, 'edit', th, '{"body": "One, fixed"}', op);
  perform tests.act(b, 'card', th, '{"card": "splat", "config": {"color": "red"}}', op);
  perform tests.act(null, 'tally', th, '{"body": "x"}');
  if (select posts from character_post_counts where character = a) is distinct from 2 then raise exception 'posts counted: %', (select posts from character_post_counts where character = a); end if;
  if (select posts from character_post_counts where character = b) is distinct from 1 then raise exception 'a card is no post: %', (select posts from character_post_counts where character = b); end if;
  if exists (select 1 from character_post_counts where character = idle) then raise exception 'a character that never posted has no row (the read says 0)'; end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'character_post_counts') is distinct from array['character', 'posts'] then
    raise exception 'character_post_counts shows more than a character and its posts';
  end if;
  -- The backfill is the migration's own statement, kept in a function: counters lost are counted again from the Acts.
  delete from character_post_counts;
  perform backfill_character_post_counts();
  if (select posts from character_post_counts where character = a) is distinct from 2 or (select posts from character_post_counts where character = b) is distinct from 1 then
    raise exception 'the backfill counts the posts again';
  end if;
  -- A signed-in player reads it; a visitor does not, and nobody writes it.
  perform tests.become(bob);
  if (select posts from character_post_counts where character = a) is distinct from 2 then raise exception 'a player reads the counts'; end if;
  begin update character_post_counts set posts = 99; raise exception 'a player wrote a count';
  exception when insufficient_privilege then null; end;
  perform tests.unbecome();
  perform tests.become_anon();
  begin perform 1 from character_post_counts; raise exception 'a visitor read the counts';
  exception when insufficient_privilege then null; end;
  perform tests.unbecome();
end $$;
