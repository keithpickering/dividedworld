-- The repeat-charge lookup starts from the post's visits whatever the statistics say.
--
-- visit_charge_matches (0105, then 0154) joined visits to their joins and ends in one flat query, so the planner chose the order from the statistics. With statistics gathered while an instance had few joins (or none), it expected one join in the instance, read every `visit_join` Act first and probed the visits once per join: 35,202 Acts read for one post on 60,000 posts, 22,000 visits and 13,200 joins, where the post owns seven. Fresh statistics hid it.
--
-- The order is now written into the query, so no statistic chooses it. The post's visits come first, by acts_visits_by_post, behind `offset 0` (a subquery with an OFFSET is never flattened into the join) and in the order only that index keeps, `created_at desc, id desc`. `kind = 'visit'` also implies acts_visits_by_thread (0108), which has the same predicate and no use for the post: with statistics gathered before any visit was written both indexes were estimated at one row and cost alike, and the planner read acts_visits_by_thread whole, 22,000 Acts for a post that owns 3. A scan of that index is in thread order, so it needs a Sort that starts only when the scan is done and costs more than the scan; acts_visits_by_post is no dearer than it, for the key's columns are the same types and its qual only narrows, and hands the rows already in order. So the Sort can only make the wrong index dearer. For each of those visits a lateral subquery reads its own charges and its joins' charges, the joins by acts_visit_joins, and can only be read per visit. Its end is read by acts_one_visit_end in a `not exists` that `offset 0` keeps a per-visit subplan, never an anti join over every end. Same rows as 0154: a charge on one of the post's visits, open or ended, or on a join to one, leaving out a visit that ended `reversed` or `dropped`. Signature, volatility, security and search_path are unchanged, and so are the grants (the revoke in 0105 stays on the function).
create or replace function visit_charge_matches(post uuid, ch jsonb) returns setof integer
language sql stable set search_path = public, pg_temp as $$
    select 1
    from (select v.id, v.payload from public.acts v where v.kind = 'visit' and v.target_act_id = post order by v.created_at desc, v.id desc offset 0) v
    cross join lateral (
      select c.value as charge from jsonb_array_elements(v.payload -> 'charges') c
      union all
      select j.payload -> 'charge' from public.acts j where j.kind = 'visit_join' and j.target_act_id = v.id
      offset 0) c
    where not exists (select 1 from public.acts e where e.kind = 'visit_end' and e.target_act_id = v.id and e.payload ->> 'outcome' in ('reversed', 'dropped') offset 0)
      and c.charge ->> 'cause' = ch ->> 'cause' and c.charge ->> 'rule_number' is not distinct from ch ->> 'rule_number' and c.charge ->> 'board' = ch ->> 'board'
      and (c.charge ->> 'rule_number' is not null or c.charge ->> 'rule' is not distinct from ch ->> 'rule')
$$;
