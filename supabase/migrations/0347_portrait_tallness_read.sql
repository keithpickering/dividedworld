-- A signed-in player reads how tall a portrait is. 0205 added `character_profiles.portrait_tallness` and put it in the client's own read of a profile
-- (web/src/data/supabase.ts, `characters`), beside the columns 0019 and 0125 grant one by one, and never granted it: Postgres refuses a read that names one
-- ungranted column whole, so every read of a profile from a browser was refused ("permission denied for table character_profiles"), and each screen that
-- draws a postbit from that read had none. The one-read pages were untouched: they hand the column over through profile_projection, a definer's read.
--
-- The column is public, as the crops and their frames are: it is the shape of the box a character's portrait is drawn in, the same for every viewer, and it
-- says nothing of who plays the character. The row policy (0019's `read`: a debuted character's profile) stands as it was.
-- supabase/tests/0025-profiles.sql reads the client's own column list as a signed-in player.

grant select (portrait_tallness) on character_profiles to authenticated;
