-- A profile's reveals are read through an index.
--
-- The profile reads a character's reveals with `acts_public where kind = 'reveal' and
-- payload->>'character' = <id> order by created_at desc` (web/src/data/supabase.ts, characterReveals).
-- Nothing indexed that expression, so every profile view scanned every Act of an instance; at a busy
-- instance that is the whole history for a few rows. The partial index holds only the reveals, which
-- are one per character per season, and serves the filter through acts_public: the view's left join
-- is on its edit column, and the filter lands on the base `acts` before the join, so the planner can
-- use it (supabase/tests/0035-reveal-index.sql looks at the plan).
create index acts_reveal_character on acts ((payload ->> 'character'), created_at desc) where kind = 'reveal';
