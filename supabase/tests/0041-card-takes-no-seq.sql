-- A card play takes no place in its thread (supabase/migrations/0035_card_takes_no_seq.sql), as an
-- edit takes none: it is a tag on the post it lands on, so the posts keep their numbers and a
-- reader never meets a numbered line nobody can react to. The glass plan's section 3 and the
-- cards plan's amendment of 2026-10-30.

do $$
declare
  ann uuid := tests.account('cs-ann');
  bob uuid := tests.account('cs-bob');
  a uuid := tests.character(ann, 'Cs Ann');
  b uuid := tests.character(bob, 'Cs Bob');
  th uuid := tests.thread('Numbered');
  t0 timestamptz := date_trunc('second', now() - interval '3 days');
  p1 uuid;
  p2 uuid;
  p3 uuid;
  play uuid;
  old_play uuid;
  r record;
  refused boolean := false;
begin
  p1 := tests.post(a, th, 'One', t0);
  p2 := tests.post(b, th, 'Two', t0 + interval '1 hour');
  -- A card played between two posts, in time order, as the Cards board's thread has it.
  play := tests.act(b, 'card', th, '{"card": "whoops", "message": "oops"}', p1, t0 + interval '90 minutes');
  p3 := tests.post(a, th, 'Three', t0 + interval '2 hours');

  if (select seq from acts where id = play) is not null then raise exception 'a card took a thread number: %', (select seq from acts where id = play); end if;
  if (select array_agg(seq order by seq) from acts where thread = th and kind = 'post') is distinct from array[1, 2, 3] then
    raise exception 'a card played between posts renumbered them: %', (select array_agg(seq order by seq) from acts where thread = th and kind = 'post');
  end if;
  if (select next_seq from threads where id = th) is distinct from 4 then raise exception 'a card took a number from the thread''s counter: %', (select next_seq from threads where id = th); end if;

  -- The thread's list row is the numbered Acts': a card is no last Act and does not bump the thread.
  select * into r from thread_list where id = th;
  if r.last_seq is distinct from 3 or r.last_act is distinct from p3 or r.replies is distinct from 2 or r.last_at is distinct from t0 + interval '2 hours' then
    raise exception 'a card is no part of the thread list''s row: %', to_jsonb(r);
  end if;
  perform tests.act(b, 'card', th, '{"card": "stick-around"}', p2, t0 + interval '5 hours');
  if (select last_at from threads where id = th) is distinct from t0 + interval '2 hours' then raise exception 'a card bumped its thread: %', (select last_at from threads where id = th); end if;
  -- The backfill agrees with the trigger: a thread's last_at is its latest numbered Act.
  perform backfill_thread_counters();
  if (select last_at from threads where id = th) is distinct from t0 + interval '2 hours' then raise exception 'the backfill counted a card: %', (select last_at from threads where id = th); end if;

  -- What readers see: the card with no seq, found by the post it lands on and never by a page's range.
  if (select seq from acts_public where id = play) is not null then raise exception 'acts_public numbers a card'; end if;
  if act_projection(play) -> 'seq' is distinct from 'null'::jsonb then raise exception 'a card''s broadcast carries a seq: %', act_projection(play); end if;
  if (select count(*) from acts_public where thread = th and seq between 1 and 3 and kind = 'card') is distinct from 0 then raise exception 'a page of seqs holds a card'; end if;
  if (select count(*) from acts_public where kind = 'card' and target_act_id = p1) is distinct from 1 then raise exception 'a card is found by its target'; end if;

  -- Reading is through the numbered posts: a mark past the last post is held to it.
  perform tests.become(ann);
  perform mark_read(th, 99, a);
  perform tests.unbecome();
  if (select furthest_seq from reading where thread = th) is distinct from 3 then raise exception 'reading was marked past the last numbered Act: %', (select furthest_seq from reading where thread = th); end if;

  -- An Act that is not an edit or a card still has its number, and the table still holds it to that.
  begin
    alter table acts disable trigger acts_take_seq;
    insert into acts (character, kind, thread, payload) values (a, 'post', th, '{"body": "No number"}');
  exception when check_violation then refused := true;
  end;
  alter table acts enable trigger acts_take_seq;
  if not refused then raise exception 'a post with no number was written'; end if;

  -- A card numbered before this change (an instance already in play) stays valid and keeps its number:
  -- an Act is never rewritten, and its number is where it was linked to.
  alter table acts disable trigger acts_take_seq;
  insert into acts (character, kind, thread, target_act_id, payload, seq) values (b, 'card', th, p3, '{"card": "whoops"}', 4) returning id into old_play;
  alter table acts enable trigger acts_take_seq;
  update threads set next_seq = 5 where id = th;
  if (select seq from acts where id = old_play) is distinct from 4 then raise exception 'a card numbered before keeps its number'; end if;
  -- And the thread goes on from there.
  p3 := tests.post(b, th, 'Five', t0 + interval '3 hours');
  if (select seq from acts where id = p3) is distinct from 5 then raise exception 'numbering goes on past a numbered card: %', (select seq from acts where id = p3); end if;
end $$;
