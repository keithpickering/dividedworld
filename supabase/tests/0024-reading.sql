-- Reading (supabase/migrations/0018_reading.sql): one private row per player per thread, the
-- furthest post read, never lowered, with the HUD's character at the player's first read; public
-- view counts, distinct players per thread, moved only when the job recounts them; and a player's
-- own reactions, readable by that player alone. The screens' engine plan, Task 6.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('read-ann');
  bob uuid := tests.account('read-bob');
  a1 uuid := tests.character(ann, 'Reader One');
  a2 uuid := tests.character(ann, 'Reader Two');
  a3 uuid := tests.character(ann, 'Reader Three');
  b uuid := tests.character(bob, 'Read Writer');
  t uuid := tests.thread('Read me');
  quiet uuid := tests.thread('Read before');
  bare uuid := tests.thread('Read bare');
  said jsonb;
  counted timestamptz;
begin
  perform tests.post(b, t, 'One.'); perform tests.post(b, t, 'Two.'); perform tests.post(b, t, 'Three.');
  perform tests.post(b, quiet, 'Here.');

  perform tests.become(ann);
  said := mark_read(t, 2, a1);
  if (said ->> 'furthest_seq')::integer is distinct from 2 then raise exception 'a read is kept: %', said; end if;
  -- Never lowered; and the first read's character stays, whichever mask reads after.
  said := mark_read(t, 1, a2);
  if (said ->> 'furthest_seq')::integer is distinct from 2 then raise exception 'a read of an earlier post lowered the furthest: %', said; end if;
  perform mark_read(t, 3, a3);
  if (select (furthest_seq, first_character) from reading where thread = t) is distinct from (3, a1) then
    raise exception 'the furthest rises and the first character is the first read''s: %', (select to_jsonb(r) from reading r where thread = t);
  end if;
  -- A post past the thread's last is read as its last.
  if (mark_read(t, 99, a1) ->> 'furthest_seq')::integer is distinct from 3 then raise exception 'a read past the last post'; end if;
  -- Read through a mask of another's, or of nobody's: refused alike.
  if pg_temp.refusal(format('select mark_read(%L, 1, %L)', t, b)) is distinct from 'you do not play that character' then raise exception 'a read through another''s mask'; end if;
  if pg_temp.refusal(format('select mark_read(%L, 1, %L)', gen_random_uuid(), a1)) is distinct from 'there is no such thread' then raise exception 'a read of no thread'; end if;
  perform mark_read(quiet, 1, a1);
  -- A first read with no character on the HUD: the first read through one is recorded.
  perform mark_read(bare, 0, null);
  perform mark_read(bare, 0, a2);
  if (select first_character from reading where thread = bare) is distinct from a2 then raise exception 'the first read through a character is recorded after one with none'; end if;
  perform mark_read(bare, 0, a3);
  if (select first_character from reading where thread = bare) is distinct from a2 then raise exception 'a later character replaced the first'; end if;
  perform tests.unbecome();

  -- Nobody else reads it.
  perform tests.become(bob);
  perform auth.assert_impersonating();
  if exists (select 1 from reading) then raise exception 'another account read a reading row'; end if;
  perform mark_read(t, 1, b);
  perform tests.unbecome();

  -- The count moves only when the job runs: three of Ann's masks and Bob are two players.
  if exists (select 1 from thread_view_counts where thread = t) then raise exception 'a view count moved before the job ran'; end if;
  perform count_thread_views();
  if (select players from thread_view_counts where thread = t) is distinct from 2 then raise exception 'one player through three masks counts once: %', (select players from thread_view_counts where thread = t); end if;
  counted := (select counted_at from thread_view_counts where thread = quiet);
  -- A read since moves its own thread's count at the next run, and no other's.
  perform tests.become(bob);
  perform mark_read(t, 3, b);
  perform tests.unbecome();
  -- Both threads' readers first came before the last run.
  update reading set first_read_at = first_read_at - interval '2 hours' where thread in (quiet, t);
  update view_count_runs set ran_at = ran_at - interval '1 hour';
  perform count_thread_views();
  if (select counted_at from thread_view_counts where thread = quiet) is distinct from counted then raise exception 'a thread no new reader came to was recounted'; end if;
  -- Bob's re-read of t is no new reader: t is not recounted either.
  if (select counted_at from thread_view_counts where thread = t) is distinct from counted then raise exception 'a re-read recounted its thread'; end if;
  -- A read whose transaction began just before the last run, and committed after it, is counted
  -- at the next: its read_at is its transaction's start, a moment before the run it missed.
  perform tests.become(bob);
  perform mark_read(quiet, 1, b);
  perform tests.unbecome();
  update reading set first_read_at = (select ran_at from view_count_runs) - interval '5 minutes' where thread = quiet and account = bob;
  perform count_thread_views();
  if (select players from thread_view_counts where thread = quiet) is distinct from 2 then raise exception 'a read committed just after a run was never counted'; end if;
  -- Everyone signed in reads the counts.
  perform tests.become(bob);
  if (select players from thread_view_counts where thread = t) is distinct from 2 then raise exception 'the counts are public'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  if pg_temp.refusal('select count(*) from reading') is null then raise exception 'a visitor read reading rows'; end if;
  perform tests.unbecome();

  -- The job is scheduled at the instance's setting, and moves with it.
  if (select schedule from cron.job where jobname = 'kayfabb-view-counts') is distinct from '41 * * * *' then raise exception 'the view counts are scheduled at viewCountCron: %', (select schedule from cron.job where jobname = 'kayfabb-view-counts'); end if;
  update settings set value = '"3 * * * *"' where key = 'viewCountCron';
  if (select schedule from cron.job where jobname = 'kayfabb-view-counts') is distinct from '3 * * * *' then raise exception 'changing viewCountCron reschedules the count'; end if;
end $$;

-- ---- A player's own reactions: theirs to read, nobody else's ----
do $$
declare
  ann uuid := tests.account('mine-ann');
  bob uuid := tests.account('mine-bob');
  cat uuid := tests.account('mine-cat');
  a1 uuid := tests.character(ann, 'Mine One');
  a2 uuid := tests.character(ann, 'Mine Two');
  b uuid := tests.character(bob, 'Mine Bob');
  c uuid := tests.character(cat, 'Mine Cat');
  t uuid := tests.thread();
  p uuid := tests.post(c, t, 'React.');
begin
  perform tests.become(ann);
  perform react(p, a1, 'up');
  perform react(p, a2, 'calm');
  perform tests.unbecome();
  perform tests.become(bob);
  perform react(p, b, 'boo');
  perform tests.unbecome();

  perform tests.become(ann);
  perform auth.assert_impersonating();
  if (select jsonb_agg(jsonb_build_array(kind, character) order by kind) from my_reactions where act = p) is distinct from jsonb_build_array(jsonb_build_array('calm', a2), jsonb_build_array('up', a1)) then
    raise exception 'a player reads their own reactions, through each mask: %', (select jsonb_agg(to_jsonb(m)) from my_reactions m);
  end if;
  if exists (select 1 from my_reactions where kind = 'boo') then raise exception 'a player read another''s reaction'; end if;
  if pg_temp.refusal('select count(*) from reactions') is null then raise exception 'the reactions table itself was read'; end if;
  perform tests.unbecome();
  perform tests.become(cat);
  if exists (select 1 from my_reactions where act = p) then raise exception 'the post''s author read who reacted to it'; end if;
  perform tests.unbecome();
end $$;

-- ---- Two first reads of one thread by one player at once: one row, and neither refused ----
do $$
declare
  ann uuid := gen_random_uuid(); a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); t uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-read@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, debuted_at) values (%2$L, %1$L, 'Race Reader One', now()), (%3$L, %1$L, 'Race Reader Two', now());
    insert into class_history (character, class_key) values (%2$L, 'alpha'), (%3$L, 'alpha');
    insert into threads (id, board, title, next_seq) select %4$L, id, 'Race read', 4 from boards where slug = 'general';
  $sql$, ann, a1, a2, t));
  said := tests.race(ann, format('select mark_read(%L, 2, %L)', t, a1), ann, format('select mark_read(%L, 3, %L)', t, a2));
  if said[1] is not null or said[2] is not null then raise exception 'a first read raced and was refused: %', said; end if;
  if (select count(*) from reading where thread = t) is distinct from 1::bigint then raise exception 'two first reads made two rows'; end if;
  if (select furthest_seq from reading where thread = t) is distinct from 3 then raise exception 'the furthest of two reads at once is kept'; end if;
end $$;
