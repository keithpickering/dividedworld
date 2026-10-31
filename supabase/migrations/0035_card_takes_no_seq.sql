-- A card play takes no place in its thread, as an edit takes none.
--
-- The owner's answer on where a card play shows (PR #39; the cards plan's amendment of
-- 2026-10-30 and the glass plan's section 3): a play is shown as a tag on the post it lands on,
-- never as a line of its own. It used to take the next number of its thread like a post, so in
-- time order its number fell between the posts and renumbered them, and the thread drew a
-- numbered line nobody could react to. A post's number is its place on the board; a play is a
-- layer on a post, as an edit is, and is found through the post it targets (acts_target) and
-- never through a page's range of numbers. The play stays a public Act, dated and in the log.
--
-- What changes:
--   - acts_take_seq() gives a card no number, and leaves its thread's counters alone: a card is
--     no latest Act of a thread, so it neither moves thread_list's last_seq and last_act nor
--     bumps last_at (an edit bumps nothing either), and it was never a reply. The rest is as
--     0030 wrote it.
--   - backfill_thread_counters() reads last_at the same way: the latest Act that holds a number.
--   - The check on acts.seq holds a post, a spin, an unmask, a tally and a reveal to a number
--     and an edit to none, as before, and lets a card have either (below).
--
-- Cards already numbered. Acts are append-only ("Append-only"): none is updated here, and a
-- number is where the play was linked to, so a card numbered before this change keeps its
-- number. The check therefore does not refuse a numbered card; the trigger is what gives every
-- new one none, and a trigger runs on every insert whoever writes it (an INSERT that names a
-- seq has it replaced). A thread that holds such a card keeps its gap: the posts around it
-- keep their numbers, the card's own number is simply one no page shows (the pages read the
-- Acts that are no card, and say so: web/src/data/supabase.ts), and thread_list's counters stay
-- as they were, so next_seq goes on from the highest number ever taken. Nothing renumbers.
--
-- Read through seq and unchanged: mark_read holds a position to next_seq - 1, the last number
-- taken; the realtime catch-up of 0029 sends a thread's Acts in seq order, a card (null) last;
-- acts_public and act_projection carry the column as it is, null for a new card; the estimate,
-- the settlement and the export read no seq (the export copies the column, null and all).

alter table acts drop constraint acts_check;
alter table acts add constraint acts_seq_check check ((kind = 'edit') = (seq is null) or kind = 'card');

create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind in ('edit', 'card') then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;

create or replace function backfill_thread_counters() returns void
language sql set search_path = public, pg_temp as $$
  update threads t set last_at = (select max(a.created_at) from acts a where a.thread = t.id and a.seq is not null),
                       replies = (select count(*) from acts a where a.thread = t.id and a.kind = 'post' and a.seq > 1)
$$;
