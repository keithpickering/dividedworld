-- A character's post count is readable as the character is: only once it is in characters_public.
--
-- 0030 let any signed-in player read every row of character_post_counts. A character waiting to
-- debut is in no public list, so its row (if it ever had one) was readable by anyone who guessed
-- its id, though nothing else about it is. A waiting character cannot post anyway (acting() refuses
-- it, and the counter is kept by a trigger on an Act it cannot write), so in practice it has no row;
-- the policy now says so too, and matches the in-memory backend, which counts debuted characters
-- only. The count is still public for every character that is.
drop policy read_all on character_post_counts;
create policy read_public on character_post_counts for select to authenticated
  using (exists (select 1 from characters_public p where p.id = character));
