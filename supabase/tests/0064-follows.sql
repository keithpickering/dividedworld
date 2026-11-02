-- Followed threads (supabase/migrations/0059_follows.sql): the threads one's characters started are followed
-- by default, a player unfollows or follows any thread by choice, and my_followed_threads counts the posts
-- past one's own place in the thread by characters one does not own. The alerts plan, Task 4; the design,
-- sections 4, 10 and 11.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The migration exists at all (so a missing one fails here, on an assertion, and not on a missing relation below).
do $$
begin
  if to_regclass('public.thread_follows') is null then raise exception 'thread_follows exists'; end if;
  if to_regclass('public.my_followed_threads') is null then raise exception 'my_followed_threads exists'; end if;
  if to_regprocedure('follow_thread(uuid,boolean)') is null then raise exception 'follow_thread(uuid, boolean) exists'; end if;
  if to_regprocedure('following_thread(uuid)') is null then raise exception 'following_thread(uuid) exists'; end if;
end $$;

do $$
declare
  ann uuid := tests.account('follow-ann');
  bob uuid := tests.account('follow-bob');
  cat uuid := tests.account('follow-cat');
  a1 uuid; a2 uuid; b1 uuid; c1 uuid;
  mine uuid; theirs uuid; got record; said jsonb;
begin
  a1 := tests.character(ann, 'Follow Ann One');
  a2 := tests.character(ann, 'Follow Ann Two');
  b1 := tests.character(bob, 'Follow Bob One');
  c1 := tests.character(cat, 'Follow Cat One');
  -- Ann's character started "mine"; Bob's started "theirs".
  mine := tests.thread('Ann started this');
  perform tests.post(a1, mine, 'opening', now() - interval '2 hours');
  theirs := tests.thread('Bob started this');
  perform tests.post(b1, theirs, 'opening', now() - interval '2 hours');

  -- ---- A thread one started is followed by default; one only read is not ----
  perform tests.become(ann);
  if following_thread(mine) is not true then raise exception 'a thread one started is followed by default'; end if;
  if following_thread(theirs) is not false then raise exception 'a thread one only reads is not followed'; end if;
  -- Nothing new yet: the opening is one's own, and a thread with no new post is not a row.
  if exists (select 1 from my_followed_threads) then raise exception 'a followed thread with no new post is no row'; end if;

  -- ---- Posts by others count; one's own other masks do not ----
  perform tests.unbecome();
  perform tests.post(b1, mine, 'bob 1', now() - interval '90 minutes');
  perform tests.post(c1, mine, 'cat 1', now() - interval '60 minutes');
  perform tests.post(a2, mine, 'my other mask', now() - interval '30 minutes');
  perform tests.post(a1, mine, 'my first mask again', now() - interval '20 minutes');
  perform tests.become(ann);
  select * into got from my_followed_threads where thread = mine;
  if got.thread is null then raise exception 'a started thread with new posts by others is a row'; end if;
  if got.new_posts is distinct from 2 then raise exception 'two posts by others, none by one''s own masks, are counted: %', got.new_posts; end if;
  if got.newest_at is distinct from (select created_at from acts where thread = mine and character = c1) then
    raise exception 'the newest such post''s time is the last by another player, not one''s own mask''s';
  end if;
  if (select count(*) from my_followed_threads) is distinct from 1 then raise exception 'one thread is followed with new posts'; end if;

  -- ---- Another account reads none of it ----
  perform tests.become(cat);
  if exists (select 1 from my_followed_threads) then raise exception 'another account reads another''s followed threads'; end if;
  if following_thread(mine) is not false then raise exception 'another account does not follow a thread it did not start'; end if;
  if exists (select 1 from thread_follows) then raise exception 'another account reads thread_follows rows'; end if;

  -- ---- Followed by choice ----
  perform tests.become(ann);
  if exists (select 1 from my_followed_threads where thread = theirs) then raise exception 'a thread not followed is no row'; end if;
  perform tests.unbecome();
  perform tests.post(c1, theirs, 'cat on theirs', now() - interval '10 minutes');
  perform tests.post(a1, theirs, 'ann on theirs', now() - interval '5 minutes');
  perform tests.become(ann);
  if exists (select 1 from my_followed_threads where thread = theirs) then raise exception 'a thread not followed is no row, whatever is posted in it'; end if;
  said := follow_thread(theirs, true);
  if said ->> 'following' is distinct from 'true' then raise exception 'follow_thread answers the state: %', said; end if;
  if following_thread(theirs) is not true then raise exception 'a thread followed by choice is followed'; end if;
  select * into got from my_followed_threads where thread = theirs;
  if got.new_posts is distinct from 2 then raise exception 'followed by choice: Bob''s opening and Cat''s post count, one''s own does not: %', got.new_posts; end if;
  -- Choosing again changes nothing.
  perform follow_thread(theirs, true);
  if (select count(*) from thread_follows) is distinct from 1 then raise exception 'one row per thread however often it is chosen'; end if;

  -- ---- Unfollowed ----
  said := follow_thread(mine, false);
  if said ->> 'following' is distinct from 'false' then raise exception 'unfollowing answers the state: %', said; end if;
  if following_thread(mine) is not false then raise exception 'a thread one started and unfollowed is not followed'; end if;
  if exists (select 1 from my_followed_threads where thread = mine) then raise exception 'an unfollowed thread is no row, though one started it'; end if;
  -- And followed again: the choice is the caller's, both ways.
  perform follow_thread(mine, true);
  if not exists (select 1 from my_followed_threads where thread = mine) then raise exception 'followed again, it is a row again'; end if;
  -- Followed by default and by choice at once is still one row.
  if (select count(*) from my_followed_threads where thread = mine) is distinct from 1 then raise exception 'a thread followed by default and by choice is one row'; end if;
  perform follow_thread(theirs, false);
  if exists (select 1 from my_followed_threads where thread = theirs) then raise exception 'a thread followed then unfollowed is no row'; end if;
  perform follow_thread(theirs, true);

  -- ---- Reading a thread clears what was read ----
  -- "mine" holds: 1 Ann One (opening), 2 Bob, 3 Cat, 4 Ann Two, 5 Ann One.
  perform mark_read(mine, 2, a1);
  select * into got from my_followed_threads where thread = mine;
  if got.new_posts is distinct from 1 then raise exception 'read through seq 2: only Cat''s post, seq 3, is past it: %', got.new_posts; end if;
  perform mark_read(mine, 5, a1);
  if exists (select 1 from my_followed_threads where thread = mine) then raise exception 'a thread read to its end leaves the list'; end if;
  -- "theirs" holds: 1 Bob, 2 Cat, 3 Ann One. Read through 3, its end, it leaves the list.
  perform mark_read(theirs, 3, a1);
  if exists (select 1 from my_followed_threads where thread = theirs) then raise exception 'a followed thread read to its end leaves the list'; end if;
  -- A later post by another is new again.
  perform tests.unbecome();
  perform tests.post(b1, mine, 'bob again', now());
  perform tests.become(ann);
  select * into got from my_followed_threads where thread = mine;
  if got.new_posts is distinct from 1 then raise exception 'a post after the place read is counted: %', got.new_posts; end if;

  -- ---- Visitors and the API's table grants ----
  perform tests.become_anon();
  if pg_temp.refusal('select * from my_followed_threads') is null then raise exception 'a visitor reads no followed threads'; end if;
  if pg_temp.refusal(format('select follow_thread(%L, true)', mine)) is null then raise exception 'a visitor follows nothing'; end if;
  if pg_temp.refusal(format('select following_thread(%L)', mine)) is null then raise exception 'a visitor asks nothing'; end if;
  perform tests.become(ann);
  if pg_temp.refusal(format('insert into thread_follows (account, thread, follow) values (%L, %L, true)', cat, mine)) is null then
    raise exception 'a player writes thread_follows only through follow_thread';
  end if;
  if pg_temp.refusal(format('select follow_thread(%L, true)', gen_random_uuid())) is distinct from 'there is no such thread' then
    raise exception 'a thread that does not exist is refused in plain words';
  end if;
  perform tests.unbecome();
end $$;

-- ---- The cap, and a staff character's post ----
do $$
declare
  dee uuid := tests.account('follow-dee');
  eli uuid := tests.account('follow-eli');
  d1 uuid; d2 uuid; e1 uuid; boss uuid; t uuid; s uuid; r uuid; i integer; got record;
begin
  d1 := tests.character(dee, 'Follow Dee');
  e1 := tests.character(eli, 'Follow Eli');
  t := tests.thread('Capped');
  perform tests.post(d1, t, 'opening');
  for i in 1..101 loop perform tests.post(e1, t, 'reply ' || i); end loop;
  perform tests.become(dee);
  select * into got from my_followed_threads where thread = t;
  if got.new_posts is distinct from 100 then raise exception '101 posts by others are counted to the cap of 100: %', got.new_posts; end if;
  perform tests.unbecome();

  -- A thread started by a character the player has since retired is still followed: the player still owns that history, and
  -- Unfollow (on the thread and on the Alerts row) is its way out, so it is not silently dropped.
  d2 := tests.character(dee, 'Follow Dee Retired');
  r := tests.thread('Started by a retired mask');
  perform tests.post(d2, r, 'opening');
  perform tests.post(e1, r, 'a reply');
  update characters set retired_at = now() where id = d2;
  perform tests.become(dee);
  select * into got from my_followed_threads where thread = r;
  if got.new_posts is distinct from 1 then raise exception 'a thread a retired character started is still followed: %', got.new_posts; end if;
  perform follow_thread(r, false);
  if exists (select 1 from my_followed_threads where thread = r) then raise exception 'and Unfollow ends it'; end if;
  perform tests.unbecome();

  -- A staff character has no owner, so its post in a followed thread is another's and is counted.
  s := tests.thread('Staff speaks');
  perform tests.post(d1, s, 'opening');
  insert into characters (name, staff, staff_kind, debuted_at) values ('Follow Boss', 'follow-boss', 'boss', now()) returning id into boss;
  perform tests.become_service();
  perform write_staff_act('follow-boss', 'post', s, null, '{"body": "It is decided."}');
  perform tests.unbecome();
  perform tests.become(dee);
  select * into got from my_followed_threads where thread = s;
  if got.new_posts is distinct from 1 then raise exception 'a staff character''s post in a followed thread is counted: %', got.new_posts; end if;
  perform tests.unbecome();
end $$;

-- ---- Scale: an account that follows 500 threads reads them by index ----
-- 500 threads one of Ann's characters started, each with a handful of posts by others, and Ann has read some of them.
do $$
declare
  hog uuid := tests.account('follow-hog');
  other uuid := tests.account('follow-other');
  h1 uuid; o1 uuid; t uuid; i integer; plan text := ''; ln record; n integer;
begin
  h1 := tests.character(hog, 'Follow Hog');
  o1 := tests.character(other, 'Follow Other');
  for i in 1..500 loop
    t := tests.thread('Scale ' || i);
    perform tests.post(h1, t, 'opening');
    perform tests.post(o1, t, 'reply');
    perform tests.post(o1, t, 'reply again');
  end loop;
  -- The hog also wrote a great many replies elsewhere, as a busy player does: the threads they started are found without them.
  t := tests.thread('Scale elsewhere');
  perform tests.post(o1, t, 'opening');
  for i in 1..2000 loop perform tests.post(h1, t, 'reply ' || i); end loop;
  -- A thread the hog started, with a long run of their own posts past their place: the backward read steps over them by the same index.
  t := tests.thread('Own run');
  perform tests.post(h1, t, 'opening');
  perform tests.post(o1, t, 'one reply');
  for i in 1..2000 loop perform tests.post(h1, t, 'my own ' || i); end loop;
  insert into thread_follows (account, thread, follow)
    select hog, t.id, true from threads t where t.title like 'Scale %' and t.id in (select thread from acts where character = o1 and seq = 2 limit 100);
  analyze acts; analyze threads; analyze reading; analyze thread_follows; analyze characters;
  perform tests.become(hog);
  select count(*) into n from my_followed_threads;
  if n is distinct from 50 then raise exception 'at most 50 followed threads are shown, newest first, of 500: got %', n; end if;
  perform tests.unbecome();
  -- The view's own statement, as the API role reads it, planned with scans off so a missing index shows as a scan.
  set local enable_seqscan = off;
  perform tests.become(hog);
  for ln in explain select * from my_followed_threads loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  perform tests.unbecome();
  set local enable_seqscan = on;
  if plan ~ 'Seq Scan' then raise exception 'my_followed_threads never scans a table: %', plan; end if;
  if plan !~ 'acts_thread_openers' then raise exception 'the threads one started are found by the openers index: %', plan; end if;
  if plan !~ '(Index (Only )?Scan( Backward)? using|Bitmap Index Scan on) acts_thread_seq_key' then raise exception 'new posts are read by the (thread, seq) index: %', plan; end if;
end $$;
