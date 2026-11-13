-- my_posts_written_on (0149) reads from the caller's characters, not from every play in the instance.
--
-- What: the same view, the same columns in the same order and the same `opening` and `over` expressions, with the join order written into the query. It
-- starts from the caller's characters (characters_owner), then takes each character's posts (acts_character), the plays on each post (acts_layers, the
-- same predicate as before) and the texts of each play (card_texts_play_version_key). Each step is a lateral subquery behind `offset 0`, which the
-- planner does not flatten, so the join cannot be reordered.
--
-- Why: 0149 wrote a flat join. The plays' index, acts_layers, has `coalesce(payload ->> 'reach', 'post')` in its predicate, an expression with no
-- statistics, so the planner prices the whole index at a few rows and starts the join from it. At 10,000 plays that read every play in the instance for
-- a caller whose five characters hold 100 posts, with fresh statistics and with stale ones alike. An estimate cannot be made to move the read off the
-- caller's rows; the written order can. 0146-card-writes-at-scale.sql holds the read to the caller's own rows in both states, with the statistics of an instance that has no plays yet.
--
-- The kind filter is written twice on purpose. Inside the plays' lateral it is acts_layers' own predicate (`kind in ('card', 'set', 'spring')`), and the
-- outer where keeps only 'card'. A plain `kind = 'card'` inside the lateral would match the predicate of another partial index, acts_card_created, which
-- a planner that has seen no plays (statistics gathered before the instance held any) prices below a probe of acts_layers, and then scans every play in
-- the instance for each of the caller's posts. With the wider list no other partial index matches, and a qual in the outer where is not pushed below
-- `offset 0`, so the rows are the same: the plays on the caller's posts that are cards.
-- What this leaves: the posts' lateral, `kind = 'post'`, also matches partial indexes not keyed by character (acts_posts_by_time, acts_thread_posts,
-- acts_patrol_posts). A reviewer could make the planner scan one whole only by forging pg_class (statistics deleted and reltuples = 1 with the real
-- relpages), a state an append-only acts does not reach by itself; no statistics state reachable by analyze, stale or fresh, or by an empty or
-- never-analyzed table did.
--
-- The masks: unchanged. The rows are the caller's by the post's author, the one fact of ownership read, and the columns are the same; nothing here names
-- the caster, the play's price or any wallet. create or replace keeps the view's grants (authenticated reads it; anon and public do not).
--
-- A busy instance: the cost of the read grows with the caller's own posts, the plays on them and the texts of those plays, and never with the
-- instance's plays or texts.
create or replace view my_posts_written_on as
  select x.play, k.post, x.version, (x.failed is not null) as failed,
         not exists (select 1 from card_texts y where y.play = x.play and y.id < x.id and y.text is not null) as opening,
         (x.failed is not null and exists (select 1 from card_write_refunds r where r.play = x.play)
            and not exists (select 1 from card_texts y where y.play = x.play and y.id > x.id)) as over,
         x.created_at as at
  from characters c
  cross join lateral (select p.id from acts p where p.character = c.id and p.kind = 'post' offset 0) p
  cross join lateral (select k.id, k.kind, k.target_act_id as post from acts k where k.target_act_id = p.id and k.kind in ('card', 'set', 'spring') and coalesce(k.payload ->> 'reach', 'post') = 'post' offset 0) k
  cross join lateral (select x.* from card_texts x where x.play = k.id offset 0) x
  where c.owner = auth.uid() and k.kind = 'card';
