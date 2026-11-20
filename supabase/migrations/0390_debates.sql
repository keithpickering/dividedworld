-- The debate a post sparked (docs/plans/2026-11-18-tweener-catalyst-design.md, sections 1 and 7; docs/plans/2026-11-18-tweener-catalyst-plan.md, Task 2).
-- A post's debate is every post that quotes it, transitively (quote_refs, 0340), and the spin and posts of each thread another player spun from it. The engine settles a spark from the Acts and the quote edges the input
-- holds (engine/rules/settle.ts, SparkedDebate), so the input has to hold, for each spark the window reached, the spark, every member made before the window's end, the edges among them, the votes standing on the spark and
-- the cushion plays that were ever up on it.
--
--   1. settings_held     is not here: it gains `debateDays` (a whole number of days from 1 to 365) in 0391_debates_crowd_settings.sql, over crowd pay's 0383 copy, so the one definition that replays last holds both.
--   2. settlement_input  copied whole from 0378_target_lean.sql. Two walks of recursive CTEs, each bounded by time at both ends and each a probe of an index at every step. `up` starts at every post or spin of the window
--                        and climbs quote_refs (act to quoted, its primary key) to ancestors made no earlier than `debateDays` before the window's start; the origin of a spun thread with an Act in the window joins them, and so
--                        does a post a reaction reached in the window that has a debate by then (a quote, or a spin of another player's, made before the window's end by an Act that is a node of the walks; a quote made after the window's end is no debate yet, so no spark; a nod that moves late still moves the refund, and the engine reads such a spark). Those are `sparks`. `down` starts at the sparks and
--                        descends quote_refs_quoted (quoted to act) to members made before the window's end; `spun_spins` and `spun_posts` add the spin and the posts of each thread another player spun from a spark (a thread
--                        spun by the spark's own player is not followed, as the engine does not). A staff Act, an Act of The System and one an admin ended are no node of either walk, so no quote chain runs through one, as the
--                        engine has none to follow. `ancestry` climbs again from every spark, by whatever branch reached it (one reached as a spun thread's origin or by a reaction has no ancestor in `up`), stopping at a node `up` holds, so the input
--                        holds the posts above a spark and the edges to them: engine/rules/settle.ts reads inOwnDebate from them. Sparks, ancestors, members and `cushion_plays` (each cushion play on a spark or on its character that ended after the spark was made, whether or not it is still up) join `touched`.
--                        `earlier_reactions` joins the sparks, and `paid` sends the paid votes of the sparks no reaction reached beside those `reacted` reaches, so a spark's standing votes are in the input in a window no reaction
--                        reached it (payVotes pays only a vote with a reaction in the window, so nothing is paid twice). The result gains `quotes`: each quote_refs row with both ends among the input's Acts.
--   3. estimate_input    copied whole from 0378_target_lean.sql, with the same walks led only by the caller's own posts: `my_posts` (acts_character) walks down to find which have a member in the window, a walk up from those
--                        members (by the same node filters as the settlement's walks) names the sparks, as does a post of the caller's a reaction reached in the window that has a member made before the window's end, and a second walk down from the sparks alone names the members. The caller's own window post that quotes an earlier post of the caller's makes it a spark, as in the settlement (the members are the caller's own posts, so nothing is
--                        leaked). `ancestry` climbs from every spark as the settlement's does (another player's post a spark quotes is a public Act, keyed under the salt like any other, and is in the input only for a caller whose spark quotes it). The sparks join `voted` (their reactions are the
--                        caller's own posts', which the caller's log already shows); the members and the cushion plays join `touched` and never `voted`, so no reaction on a member is read. Every other member's author is keyed
--                        under the per-request salt as any other player is, and `quotes` holds only the edges among the sparks and members, so a bystander's input holds none and is otherwise what it was.
-- Scale: a window post that quotes nothing and sits in no spun thread costs one probe of quote_refs; the work for a spark is its debate's size (a visited node is held once, however many sparks reach it, so a chain of
-- 2,000 posts is 2,000 steps of each walk and not 2,000 times 2,000), and the input grows by the Acts of the debates a window reached, never by a count of players. The cushion plays on a character are found by creation
-- time through acts_card_created over the longest cushion `lasts` and the debate window, and those on a post through acts_layers.
-- Ways out: no state is added. Masks: the settlement counts a debate's voices by player inside The System's scoring (a settled sum is all that shows); the estimate reads only the caller's own sparks, keys every other author
-- by character under the per-request salt, and sends the Acts of the caller's debates, which are public. Nothing here is computed from a private fact that a response shows, and no response, event or timing is added.

-- ---- 2. settlement_input ----

create or replace function settlement_input(window_start timestamptz, window_end timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive
  -- The plays an admin ended before the window's end (Task 3): out of this window, with the votes on them. `<` as every other bound
  -- here is, so a card_end written at the instant window_end is after the window, as a vote written then is.
  ended as (select e.target_act_id as id from acts e where e.kind = 'card_end' and e.created_at < window_end),
  -- Every live Earn Gimmick play still up when the window opens, played before it (a play inside it is a window Act already): settle.ts boosts only with the play in the input, and an Earn play of an earlier window
  -- is still up in this one. Live is not ended by an admin, not caught, and ending after the window's start; found by creation time, a window of the longest Earn `lasts` before the window, and each comes with its post.
  earn_up as (
    select k.id, case when coalesce(k.payload ->> 'reach', 'post') = 'post' then k.target_act_id end as post
    from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.gimmick ->> 'kind' in ('earn', 'cushion')
      and k.created_at < window_start and k.created_at >= window_start - (select max(e.lasts) from card_kinds e where e.gimmick ->> 'kind' in ('earn', 'cushion'))
      and coalesce(k.payload ->> 'reach', 'post') in ('post', 'character') and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)),
  -- The System's own Acts (the reveal) are no character's, and nobody's to settle; a staff character's
  -- are The System's too (0043): staff earn nothing, and a card on a staff Act is nobody's to score.
  -- A gift (a donation) is no one's to settle (design, section 5): it earns nothing, is never counted as posting or in the halving, and is no one's reaction to count. It is left out here, of the window's Acts and of
  -- the reactions to one; `all_acts` leaves it out once more, since an Act a reaction touched is read whatever its kind.
  win_acts as (select * from acts a where a.created_at >= window_start and a.created_at < window_end and a.character is not null and a.kind <> 'donation'
               and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)),
  win_reactions as (select * from reactions r where r.created_at >= window_start and r.created_at < window_end and r.act not in (select id from ended)
                    and not exists (select 1 from acts d where d.id = r.act and d.kind = 'donation')),
  reacted as (select distinct act from win_reactions),
  -- ---- The debates the window reached (0390; docs/plans/2026-11-18-tweener-catalyst-design.md, section 1) ----
  -- The earliest a spark may be made for its debate to be followed: `debateDays` before the window opens, as engine/rules/settle.ts reads it.
  cutoff as (select window_start - make_interval(days => (setting('debateDays') #>> '{}')::integer) as at),
  -- Walk up: from each window post or spin, through quote_refs (`act` to `quoted`, its primary key), to the posts it quotes and the posts those quote, none made before the cutoff, each earlier than the one that
  -- quotes it. `anc` is false for the window's own Acts and true for one reached by a quote. A node is a post or a spin that is in the input's terms (no staff, no System, no donation, not ended by an admin).
  -- Time-bounded below by the cutoff and above by the window's end (a window Act is made before it), and each step is a probe of quote_refs by `act` then of acts by its key: no step scans acts. The key probe is a lateral with `offset 0`, which fences it: left as a join, the planner read acts by time (acts_created) and filtered by key, 500 rows a step at 1,000 posts, a cost that grew as the square of a quote chain (the walks below do the same).
  up as (
    select a.id, a.created_at as at, a.kind, false as anc from win_acts a where a.kind in ('post', 'spin')
    union
    select b.id, b.created_at, b.kind, true
    from up u cross join lateral (
      select b.id, b.created_at, b.kind from quote_refs r cross join lateral (select * from acts where id = r.quoted offset 0) b
      where r.act = u.id and b.kind in ('post', 'spin') and b.created_at >= (select at from cutoff) and b.created_at < window_end and (b.created_at, b.id) < (u.at, u.id)
        and b.character is not null and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)
      offset 0) b),
  -- The sparks: a post made no earlier than the cutoff that a window Act quotes or sits under (a quote chain's ancestor; the origin of a spun thread with an Act in the window), or that a reaction reached in the window while it
  -- has a debate by the window's end (a quote or another player's spin made before it; one made after is no debate yet), so that a nod that moves after the debate has gone quiet still moves the refund: engine/rules/settle.ts reads a spark whose vote moved. The origin is read through the thread's own row (threads_origin's key).
  sparks as (
    select b.id, b.created_at as at, b.character, c.owner
    from (
      select u.id from up u where u.anc and u.kind = 'post'
      union select t.origin_act_id from win_acts a join threads t on t.id = a.thread where a.kind in ('post', 'spin') and t.origin_act_id is not null
      union select x.act from reacted x join acts sa on sa.id = x.act join characters sc on sc.id = sa.character
        where exists (select 1 from quote_refs q cross join lateral (select * from acts where id = q.act offset 0) a where q.quoted = x.act and a.kind in ('post', 'spin') and a.created_at < window_end and (a.created_at, a.id) > (sa.created_at, sa.id)
                        and a.character is not null and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended))
           or exists (select 1 from acts sp join characters pc on pc.id = sp.character where sp.target_act_id = x.act and sp.kind = 'spin' and sp.created_at < window_end and sp.created_at >= sa.created_at
                        and pc.owner <> sc.owner and pc.staff is null and sp.id not in (select id from ended))
    ) k cross join lateral (select b.* from acts b where b.id = k.id offset 0) b
    cross join lateral (select c.owner from characters c where c.id = b.character offset 0) c
    where b.kind = 'post' and b.created_at >= (select at from cutoff) and b.created_at < window_end
      and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)),
  -- Walk up again from every spark, by whatever branch reached it (a spark reached as the origin of a spun thread or by a reaction has no ancestor in `up`): the engine reads whether a spark is in an earlier post's debate by its own
  -- player (inOwnDebate) from the edges above it, so each ancestor made no earlier than the cutoff, and the edges to it, are in the input. The same step and bounds as `up`, and it stops at a node `up` holds (its ancestors are in `up` already, so a chain of 2,000 posts is climbed once); a node reached from two sparks is held once.
  ancestry as (
    select s.id, s.at from sparks s
    union
    select b.id, b.created_at
    from ancestry u cross join lateral (
      select b.id, b.created_at from quote_refs r cross join lateral (select * from acts where id = r.quoted offset 0) b
      where r.act = u.id and u.id not in (select id from up) and b.kind in ('post', 'spin') and b.created_at >= (select at from cutoff) and b.created_at < window_end and (b.created_at, b.id) < (u.at, u.id)
        and b.character is not null and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)
      offset 0) b),
  -- Walk down: from each spark, through quote_refs_quoted (`quoted` to `act`), to every post or spin that quotes a member, made before the window's end and after what it quotes.
  down as (
    select s.id, s.at from sparks s
    union
    select a.id, a.created_at
    from down d cross join lateral (
      select a.id, a.created_at from quote_refs r cross join lateral (select * from acts where id = r.act offset 0) a
      where r.quoted = d.id and a.kind in ('post', 'spin') and a.created_at < window_end and (a.created_at, a.id) > (d.at, d.id)
        and a.character is not null and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)
      offset 0) a),
  -- And the spin and the posts of each thread another player spun from a spark: the spin through acts_target (the spark), the posts through the thread's own index.
  spun_spins as (
    select sp.id, sp.created_at as at, sp.thread
    from sparks s cross join lateral (
      select sp.id, sp.created_at, sp.thread from acts sp join characters c on c.id = sp.character
      where sp.target_act_id = s.id and sp.kind = 'spin' and sp.created_at < window_end and sp.created_at >= s.at and c.owner <> s.owner and c.staff is null and sp.id not in (select id from ended)
      offset 0) sp),
  spun_posts as (
    select p.id from spun_spins sp cross join lateral (
      select p.id from acts p where p.thread = sp.thread and p.kind = 'post' and p.created_at < window_end and p.created_at >= sp.at
        and p.character is not null and not is_staff_side(p.character, p.kind, p.target_act_id) and p.id not in (select id from ended)
      offset 0) p),
  members as (select id from down union select id from spun_spins union select id from spun_posts),
  -- Each cushion play (Thick Skin) on a spark or on its character that ended after the spark was made, whether or not it is still up: the engine cuts the refund by the largest share that was ever up on the spark.
  -- A play on the post is found by its key (acts_layers); one on the character by creation time through acts_card_created, a window of the longest cushion `lasts` before the earliest spark. A caught play is never in effect.
  cushion_plays as (
    select k.id from sparks s cross join lateral (
      select k.id from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.gimmick ->> 'kind' = 'cushion'
      where k.target_act_id = s.id and k.kind = 'card' and coalesce(k.payload ->> 'reach', 'post') = 'post'
        and k.created_at < window_end and not (k.payload ? 'caught') and (k.payload ->> 'ends')::timestamptz > s.at and k.id not in (select id from ended)
      offset 0) k
    union
    select k.id from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.gimmick ->> 'kind' = 'cushion'
    join sparks s on s.character::text = k.payload ->> 'character'
    where k.kind = 'card' and k.payload ->> 'reach' = 'character'
      and k.created_at < window_end and k.created_at >= (select at from cutoff) - (select max(c.lasts) from card_kinds c where c.gimmick ->> 'kind' = 'cushion')
      and not (k.payload ? 'caught') and (k.payload ->> 'ends')::timestamptz > s.at and k.id not in (select id from ended)),
  -- What each play of the window is scored against (0378): the Act a card or a spring lies on, and the cast a spring caught (`by`). A class's rule reads how the room took that Act (engine/rules/settle.ts, targetLean), and a
  -- reaction before the window counts as much as one inside it, so the Act's earlier reactions are sent whether or not a reaction reached it today. One probe by Act for each play of the window, never a scan of reactions.
  scored as (
    select a.target_act_id as id from win_acts a where a.kind in ('card', 'spring') and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post'
    union
    select (a.payload ->> 'by')::uuid from win_acts a where a.kind = 'spring' and a.payload ->> 'by' is not null),
  -- Only what a reaction reached is paid for a scored Act (`paid`, below, still joins `reacted`): an earlier reaction on a scored Act is read for the lean and pays nothing. A spark's (0390) are read and its paid rows sent, so
  -- its standing votes are in the input in a window no reaction reached it; the vote math pays only a vote with a reaction in the window, so nothing is paid twice.
  earlier_reactions as (select r.* from (select act from reacted union select id from scored where id not in (select id from ended) union select id from sparks) x cross join lateral (select r.* from reactions r where r.act = x.act and r.created_at < window_start offset 0) r),
  -- Every skim play made before the window and still up in it (a play inside it is a window Act already), as earn_up carries Earn plays: live is not ended by an admin, not caught, and ending after the window's start;
  -- found by creation time through acts_card_created, a window of the longest skim `lasts` before the window, and each comes with its post.
  skim_up as (
    select k.id, k.target_act_id as post
    from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.skim is not null and k.target_act_id is not null
      and k.created_at < window_start and k.created_at >= window_start - (select max(s.lasts) from card_kinds s where s.skim is not null)
      and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)),
  -- The cards on a post among the Acts reacted to in the window, and what pays on them: the ride springs that rode (acts_spring_by, one probe each), and the ride gimmick plays on the post that were up when the cast was made
  -- (acts_layers, the plays on the post), each with the post. A cast that drew no reaction in the window brings none of them, however many have sprung.
  rc as (select a.id, a.target_act_id as post, a.created_at from acts a join reacted x on x.act = a.id
         where a.kind = 'card' and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post' and a.id not in (select id from ended)),
  ride_springs as (select s.id from rc join acts s on s.kind = 'spring' and (s.payload ->> 'by') = rc.id::text where s.payload ->> 'did' = 'rode'),
  ride_gimmicks as (
    select g.id from rc
    join acts g on g.target_act_id = rc.post and g.kind = 'card' and coalesce(g.payload ->> 'reach', 'post') = 'post' and g.id <> rc.id
    join card_kinds ck on ck.key = g.payload ->> 'card' and ck.gimmick ->> 'kind' = 'ride'
    where not (g.payload ? 'caught') and g.created_at <= rc.created_at and (g.payload ->> 'ends')::timestamptz > rc.created_at and g.id not in (select id from ended)),
  active_spun as (select distinct t.id from threads t join win_acts a on a.thread = t.id where t.origin_act_id is not null),
  spins as (select a.* from acts a join active_spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    -- Each character's first post in the thread, read through acts_thread_posts, one per
    -- character rather than a sort of the whole thread.
    select f.* from active_spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.* from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  touched as (
    select id from win_acts union select act from reacted
    union select id from earn_up union select post from earn_up where post is not null
    union select target_act_id from win_acts where kind in ('card', 'spin', 'spring') and target_act_id is not null and coalesce(payload ->> 'reach', 'post') = 'post'
    union select id from spins union select target_act_id from spins where target_act_id is not null
    -- Every card on an Act a reaction touches, an earlier window's too: a vote counts once per
    -- player and alignment, for the earliest card (engine/rules/settle.ts).
    union select a.id from acts a join reacted x on x.act = a.target_act_id where a.kind in ('card', 'spring') and coalesce(a.payload ->> 'reach', 'post') = 'post'
    union select id from first_posts
    union select id from skim_up union select post from skim_up
    union select id from ride_springs union select id from ride_gimmicks union select post from rc
    union select id from scored
    union select id from ancestry union select id from members union select id from cushion_plays
  ),
  all_acts as (select a.* from touched t cross join lateral (select a.* from acts a where a.id = t.id offset 0) a where a.created_at < window_end and a.character is not null and a.kind <> 'donation'
               and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)),
  -- A staff post a window's card landed on (0054): named with its reactions, so the card is judged against it, and paid nobody. And, since 0378, a staff cast a window spring caught, which `scored` names, so the spring is
  -- judged against it as a card on a post is.
  unscored as (select a.* from acts a join characters c on c.id = a.character
               where c.staff is not null and (a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start and coalesce(k.payload ->> 'reach', 'post') = 'post')
                                              or a.id in (select id from scored))),
  -- Named, never settled: settle.ts drops a reaction to one, and reads a spin from one as from another.
  system_acts as (select a.id from touched t cross join lateral (select a.* from acts a where a.id = t.id offset 0) a
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  all_reactions as (select * from win_reactions union all select * from earlier_reactions),
  named as (select character as id from all_acts union select reactor_character from all_reactions),
  ms as (select 1)
  select jsonb_build_object(
    'window', jsonb_build_object('id', to_jsonb(window_start) #>> '{}',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'player', c.owner, 'classes', coalesce((
        select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
        from class_history h where h.character = c.id and h.started_at < window_end), '[]')) order by c.id)
      from characters c join named n on n.id = c.id), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread,
        'target', case when coalesce(a.payload ->> 'reach', 'post') = 'post' then a.target_act_id end,
        'reach', case when a.kind = 'card' then nullif(coalesce(a.payload ->> 'reach', 'post'), 'post') end,
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end,
        'by', case when a.kind = 'spring' then a.payload ->> 'by' end,
        -- A caught play is never in effect (0370): its `ends`, where a row written before 0370 holds one, is not sent, so it boosts and skims nothing.
        'ends', case when a.kind = 'card' and not (a.payload ? 'caught') and (select ck.gimmick is not null or ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card')
                     then (extract(epoch from (a.payload ->> 'ends')::timestamptz) * 1000)::bigint end,
        'quadrant', case when a.kind = 'card' and (select ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card') then a.payload #>> '{config,quadrant}'
                         when a.kind = 'spring' then a.payload ->> 'quadrant' end,
        'on', case when a.kind = 'card' and a.payload ->> 'reach' = 'character' then a.payload ->> 'character' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    -- A staff Act that is a card's play carries its `card` (0378), so a class's rule can tell a cast of a Salty card from any other Act the room reacted to.
    'unscoredTargets', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'kind', a.kind, 'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'staff', true,
        'card', case when a.kind = 'card' then a.payload ->> 'card' end)) order by a.created_at, a.id)
      from unscored a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'at', (extract(epoch from r.created_at) * 1000)::bigint,
        'player', r.reactor_account, 'character', r.reactor_character)
        || case when r.kind like 'x-%' then jsonb_build_object('quadrant', reaction_quadrant(r.act, r.kind)) else '{}'::jsonb end order by r.created_at, r.id)
      from all_reactions r), '[]'),
    -- The System's Acts an input Act points at (a spin from the reveal): named, never settled.
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'),
    -- The plays that name a class for this window (scored_as_plays), each with its character, its class and the play.
    'scoredAs', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'class', s.class_key, 'play', s.play) order by s.character) from scored_as_plays(window_start, window_end) s), '[]'),
    -- Each quote with both ends among the input's Acts: `act` quotes `quoted`. The engine reads a post's debate from them (0390).
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'quoted', r.quoted) order by r.act, r.quoted)
      from all_acts a cross join lateral (select r.act, r.quoted from quote_refs r where r.act = a.id offset 0) r join all_acts q on q.id = r.quoted), '[]'),
    -- What earlier windows paid for every player's vote on each Act this window's reactions touch (section 9), and, since 0390, on each spark.
    'paid', coalesce((
      select jsonb_agg(jsonb_build_object('player', q.account, 'act', q.act, 'weight', q.weight, 'shares', q.shares) order by q.account, q.act)
      from (select p.* from paid_votes p join reacted r on r.act = p.act
            union all select p.* from (select s.id from sparks s where s.id not in (select act from reacted)) s cross join lateral (select p.* from paid_votes p where p.act = s.id offset 0) p) q), '[]'))
$$;

-- ---- 3. estimate_input ----

create or replace function estimate_input(account uuid, until timestamptz default now()) returns jsonb
-- jit = off as every client read has it (0368): this plan costs above jit_above_cost, and a client read that compiled 878 functions spent about 6 s on a chain of two posts.
-- No plan_cache_mode = force_generic_plan (0368's other half): that is for a client read a page calls many times, and this is called once per request, not in ALLOWED_RPCS, where a generic plan would forget the window's and the cutoff's values.
language plpgsql stable security definer set search_path = public, pg_temp set jit = off as $$
declare
  salt text := gen_random_uuid()::text;
  window_start timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  season_end timestamptz;
  window_end timestamptz;
  you text := md5(salt || 'you');
begin
  -- The window the next settlement reads begins where next_settlement_window (0004) begins it: at
  -- the last settled end, or, where no season holds that instant (a gap between seasons), at the
  -- next season's start; and it never runs past its season's end.
  if window_start is not null and not exists (select 1 from seasons where starts_at <= window_start and (ends_at is null or ends_at > window_start)) then
    window_start := (select min(starts_at) from seasons where starts_at > window_start);
  end if;
  if window_start is null then return null; end if;
  select coalesce(s.ends_at, nullif(greatest(s.starts_at + span_interval(setting('seasonLength')), window_start), window_start)) into season_end
  from seasons s where s.starts_at <= window_start and (s.ends_at is null or s.ends_at > window_start);
  window_end := least(until, coalesce(season_end, 'infinity'));
  if window_start >= window_end then return null; end if;
  return (
  with recursive
  -- The plays an admin ended before the window's end (Task 3): out of this window, with the votes on them. `<` as every other bound
  -- here is, so a card_end written at the instant window_end is after the window, as a vote written then is.
  ended as (select e.target_act_id as id from acts e where e.kind = 'card_end' and e.created_at < window_end),
  mine as (select id from characters where owner = account),
  -- The live Earn plays on the caller's characters and posts, played before the window and still up in it (settlement_input's earn_up, for what the caller's earnings can carry): another player's play on
  -- the caller's post is a public Act and counts as one of the caller's own.
  earn_up as (
    select k.id, case when coalesce(k.payload ->> 'reach', 'post') = 'post' then k.target_act_id end as post
    from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.gimmick ->> 'kind' in ('earn', 'cushion')
      and k.created_at < window_end and k.created_at >= window_start - (select max(e.lasts) from card_kinds e where e.gimmick ->> 'kind' in ('earn', 'cushion'))
      and coalesce(k.payload ->> 'reach', 'post') in ('post', 'character') and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)
      and case when coalesce(k.payload ->> 'reach', 'post') = 'character' then (k.payload ->> 'character')::uuid in (select id from mine)
               else exists (select 1 from acts p join mine m on m.id = p.character where p.id = k.target_act_id) end),
  win_acts as (select a.* from acts a join mine m on m.id = a.character where a.created_at >= window_start and a.created_at < window_end and a.kind <> 'donation'
               and a.id not in (select id from ended)),
  -- (Task 5) The caller's skim plays made before the window and still up in it, by acts_card_plays (the caller's own plays), with their posts: the posts' reactions are read, as settlement_input reads them.
  skim_up as (
    select k.id, k.target_act_id as post
    from acts k join mine m on m.id = k.character join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.skim is not null and k.target_act_id is not null
      and k.created_at < window_start and k.created_at >= window_start - (select max(s.lasts) from card_kinds s where s.skim is not null)
      and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)),
  -- The caller's live ride gimmick plays (a Toll on a post of the caller's player's), and the casts one covers on its post that a reaction reached in the window (reactions_window, one probe each); and the caller's ride springs
  -- whose cast a reaction reached in the window (one probe each). Only the caller's own plays lead: a bystander has none, so none of this is in a bystander's input.
  my_gimmicks as (
    select g.id, g.target_act_id as post, g.created_at, (g.payload ->> 'ends')::timestamptz as ends
    from acts g join mine m on m.id = g.character join card_kinds ck on ck.key = g.payload ->> 'card' and ck.gimmick ->> 'kind' = 'ride'
    where g.kind = 'card' and g.target_act_id is not null and coalesce(g.payload ->> 'reach', 'post') = 'post' and not (g.payload ? 'caught')
      and g.created_at < window_end and g.created_at >= window_start - (select max(r.lasts) from card_kinds r where r.gimmick ->> 'kind' = 'ride')
      and (g.payload ->> 'ends')::timestamptz > window_start and g.id not in (select id from ended)),
  rode as (
    select s.id as spring, (s.payload ->> 'by')::uuid as by_cast
    from acts s join mine m on m.id = s.character
    where s.kind = 'spring' and s.payload ->> 'did' = 'rode' and s.id not in (select id from ended)
      and exists (select 1 from reactions r where r.act = (s.payload ->> 'by')::uuid and r.created_at >= window_start and r.created_at < window_end)),
  ride_casts as (
    select c.id from my_gimmicks g join acts c on c.target_act_id = g.post and c.kind = 'card' and coalesce(c.payload ->> 'reach', 'post') = 'post'
    where c.id <> g.id and c.created_at >= g.created_at and c.created_at < g.ends and c.created_at < window_end and c.id not in (select id from ended)
      and exists (select 1 from reactions r where r.act = c.id and r.created_at >= window_start and r.created_at < window_end)
    union select by_cast from rode),
  -- The caller's Acts reacted to in the window, whenever written: each of the caller's Acts, then
  -- its reactions through the index that leads with the Act, never the whole window's reactions.
  mine_reacted as (select distinct a.id as act from acts a join mine m on m.id = a.character
                   where exists (select 1 from reactions r where r.act = a.id and r.created_at >= window_start and r.created_at < window_end)),
  -- The Acts the caller reacted to in the window, through reactions_reactor.
  reacted_by_me as (select distinct r.act from reactions r where r.reactor_account = account and r.created_at >= window_start and r.created_at < window_end),
  -- ---- The caller's debates (0390) ----
  cutoff as (select window_start - make_interval(days => (setting('debateDays') #>> '{}')::integer) as at),
  -- The caller's own posts made no earlier than the cutoff, through acts_character: the only Acts a walk starts from. A bystander's posts lead nothing about anyone else's debate.
  my_posts as (select a.id, a.created_at as at, a.character, a.kind from acts a join mine m on m.id = a.character
               where a.kind = 'post' and a.created_at >= (select at from cutoff) and a.created_at < window_end and a.id not in (select id from ended)),
  -- Walk down from the caller's posts (settlement_input's `down`) to find which have a member in the window. Another player's Acts, and the caller's own spun threads' (the same player), only; a staff Act is no member.
  down1 as (
    select p.id, p.at from my_posts p
    union
    select a.id, a.created_at from down1 d cross join lateral (
      select a.id, a.created_at from quote_refs r cross join lateral (select * from acts where id = r.act offset 0) a
      where r.quoted = d.id and a.kind in ('post', 'spin') and a.created_at < window_end and (a.created_at, a.id) > (d.at, d.id)
        and a.character is not null and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)
      offset 0) a),
  spun1 as (
    select sp.id, sp.created_at as at, sp.thread, s.id as spark
    from my_posts s cross join lateral (
      select sp.id, sp.created_at, sp.thread from acts sp
      where sp.target_act_id = s.id and sp.kind = 'spin' and sp.created_at < window_end and sp.created_at >= s.at and sp.character not in (select id from mine)
        and not is_staff_side(sp.character, sp.kind, sp.target_act_id) and sp.id not in (select id from ended)
      offset 0) sp),
  spun_in1 as (
    select p.id, p.created_at as at, sp.spark from spun1 sp cross join lateral (
      select p.id, p.created_at from acts p where p.thread = sp.thread and p.kind = 'post' and p.created_at < window_end and p.created_at >= sp.at
        and p.character is not null and not is_staff_side(p.character, p.kind, p.target_act_id) and p.id not in (select id from ended)
      offset 0) p),
  -- Walk up from each member in the window, through quote_refs, to ancestors made no earlier than the cutoff (and earlier than what quotes them): the caller's posts among them have a member in the window.
  up1 as (
    select d.id, d.at from down1 d where d.at >= window_start
    union
    select b.id, b.created_at from up1 u cross join lateral (
      select b.id, b.created_at from quote_refs r cross join lateral (select * from acts where id = r.quoted offset 0) b
      where r.act = u.id and b.kind in ('post', 'spin') and b.created_at >= (select at from cutoff) and (b.created_at, b.id) < (u.at, u.id)
        and b.character is not null and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)
      offset 0) b),
  -- Each is a join, so none is a subplan read once for every post of the caller's: a post with a member in the window by a quote (up1) or by a spun thread, and a post of the caller's a reaction reached in the window while it has
  -- a debate by the window's end (a quote or another player's spin made before it), as settlement_input reads a spark whose vote moved.
  sparks as (
    select p.id, p.at, p.character from my_posts p join (
      select id from up1
      union select spark from spun_in1 where at >= window_start
      union select spark from spun1 where at >= window_start
      union select p.id from my_posts p join mine_reacted r on r.act = p.id
        where exists (select 1 from quote_refs q cross join lateral (select * from acts where id = q.act offset 0) a where q.quoted = p.id and a.kind in ('post', 'spin') and a.created_at < window_end and (a.created_at, a.id) > (p.at, p.id)
                        and a.character is not null and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended))
           or exists (select 1 from acts sp where sp.target_act_id = p.id and sp.kind = 'spin' and sp.created_at < window_end and sp.created_at >= p.at and sp.character not in (select id from mine)
                        and not is_staff_side(sp.character, sp.kind, sp.target_act_id) and sp.id not in (select id from ended))
    ) k on k.id = p.id),
  -- Walk up from every spark of the caller's (as settlement_input's `ancestry`), by whatever branch reached it: a spark reached through a spun thread or a reaction has no ancestor in `up1`, and the engine reads inOwnDebate from
  -- the edges above a spark. Another player's post it quotes is a public Act, keyed under the salt like any other; a bystander has no spark, so none of this is in a bystander's input.
  ancestry as (
    select s.id, s.at from sparks s
    union
    select b.id, b.created_at from ancestry u cross join lateral (
      select b.id, b.created_at from quote_refs r cross join lateral (select * from acts where id = r.quoted offset 0) b
      where r.act = u.id and b.kind in ('post', 'spin') and b.created_at >= (select at from cutoff) and b.created_at < window_end and (b.created_at, b.id) < (u.at, u.id)
        and b.character is not null and not is_staff_side(b.character, b.kind, b.target_act_id) and b.id not in (select id from ended)
      offset 0) b),
  -- The members of the sparks alone: walk down again from them, so the input holds nothing of the caller's posts that have no member in the window.
  down as (
    select s.id, s.at from sparks s
    union
    select a.id, a.created_at from down d cross join lateral (
      select a.id, a.created_at from quote_refs r cross join lateral (select * from acts where id = r.act offset 0) a
      where r.quoted = d.id and a.kind in ('post', 'spin') and a.created_at < window_end and (a.created_at, a.id) > (d.at, d.id)
        and a.character is not null and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)
      offset 0) a),
  spun_spins as (
    select sp.id, sp.created_at as at, sp.thread
    from sparks s cross join lateral (
      select sp.id, sp.created_at, sp.thread from acts sp
      where sp.target_act_id = s.id and sp.kind = 'spin' and sp.created_at < window_end and sp.created_at >= s.at and sp.character not in (select id from mine)
        and not is_staff_side(sp.character, sp.kind, sp.target_act_id) and sp.id not in (select id from ended)
      offset 0) sp),
  spun_posts as (
    select p.id from spun_spins sp cross join lateral (
      select p.id from acts p where p.thread = sp.thread and p.kind = 'post' and p.created_at < window_end and p.created_at >= sp.at
        and p.character is not null and not is_staff_side(p.character, p.kind, p.target_act_id) and p.id not in (select id from ended)
      offset 0) p),
  members as (select id from down union select id from spun_spins union select id from spun_posts),
  -- Each cushion play on a spark of the caller's, or on its character, that ended after the spark was made (settlement_input's `cushion_plays`); another player's play on the caller's post is public, as an earn's is.
  cushion_plays as (
    select k.id from sparks s cross join lateral (
      select k.id from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.gimmick ->> 'kind' = 'cushion'
      where k.target_act_id = s.id and k.kind = 'card' and coalesce(k.payload ->> 'reach', 'post') = 'post'
        and k.created_at < window_end and not (k.payload ? 'caught') and (k.payload ->> 'ends')::timestamptz > s.at and k.id not in (select id from ended)
      offset 0) k
    union
    select k.id from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.gimmick ->> 'kind' = 'cushion'
    join sparks s on s.character::text = k.payload ->> 'character'
    where k.kind = 'card' and k.payload ->> 'reach' = 'character'
      and k.created_at < window_end and k.created_at >= (select at from cutoff) - (select max(c.lasts) from card_kinds c where c.gimmick ->> 'kind' = 'cushion')
      and not (k.payload ? 'caught') and (k.payload ->> 'ends')::timestamptz > s.at and k.id not in (select id from ended)),
  targets as (select target_act_id as id from win_acts where kind in ('card', 'spin', 'spring') and target_act_id is not null and coalesce(payload ->> 'reach', 'post') = 'post'),
  -- The casts the caller's window springs caught (settlement_input's `scored`, 0378): a spring is scored against the cast it caught, so the cast's reactions are read. They go through `all_reactions`, `keyed` and
  -- `totals_withheld` as every other does, and nothing here is keyed by who owns the cast or its reactors.
  spring_by as (select (payload ->> 'by')::uuid as id from win_acts where kind = 'spring' and payload ->> 'by' is not null),
  -- Every card of the caller's on a post the caller's window cards point at: a vote counts for the earliest.
  my_cards_there as (select a.id from acts a join mine m on m.id = a.character join targets t on t.id = a.target_act_id where a.kind in ('card', 'spring') and a.created_at < window_end and coalesce(a.payload ->> 'reach', 'post') = 'post'),
  -- Cards others played on the caller's posts in the window.
  landed as (select a.id from acts p join mine m on m.id = p.character join acts a on a.target_act_id = p.id
             where a.kind = 'card' and a.created_at >= window_start and a.created_at < window_end and coalesce(a.payload ->> 'reach', 'post') = 'post'),
  -- The caller's spun threads active in the window: the spin, and each character's first post.
  spun as (select distinct s.thread as id from acts s join mine m on m.id = s.character
           where s.kind = 'spin' and exists (select 1 from acts x where x.thread = s.thread and x.created_at >= window_start and x.created_at < window_end)),
  spins as (select a.id from acts a join spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    select f.id from spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.id from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  -- The Acts whose reactions are read.
  voted as (select id from win_acts union select act from mine_reacted union select act from reacted_by_me union select id from targets
            union select post from skim_up union select id from ride_casts union select id from spring_by
            -- The caller's own sparks (0390): their posts, whose reactions the caller's log already shows. Their members are never voted, so no reaction on one is read.
            union select id from sparks),
  touched as (
    select id from voted union select id from my_cards_there union select id from landed union select id from spins
    union select id from earn_up union select post from earn_up where post is not null
    union select target_act_id from acts a join spins s on s.id = a.id where a.target_act_id is not null
    union select id from first_posts
    union select id from skim_up union select id from my_gimmicks union select spring from rode
    union select id from ancestry union select id from members union select id from cushion_plays
    -- The post each card, spin or spring among the voted Acts points at (Task 1, #137): a card the caller only reacted to is
    -- judged against its post, and a spin the caller only reacted to is read with its origin (settle.ts reads every spin's), as
    -- settlement_input reads every window play's target.
    union select a.target_act_id from acts a join voted v on v.id = a.id
          where a.kind in ('card', 'spin', 'spring') and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post'
  ),
  -- As settlement_input (0004, as 0043 changed it): a staff character's Acts, and a card on one, are named and pay nobody.
  all_acts as (select a.* from touched t cross join lateral (select a.* from acts a where a.id = t.id offset 0) a where a.created_at < window_end and a.character is not null and a.kind <> 'donation'
               and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)),
  -- A staff post a window's card of the caller's landed on, as settlement_input names it (0054).
  unscored as (select a.* from touched t cross join lateral (select a.* from acts a where a.id = t.id offset 0) a join characters c on c.id = a.character
               where c.staff is not null and a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start and coalesce(k.payload ->> 'reach', 'post') = 'post')),
  system_acts as (select a.id from touched t cross join lateral (select a.* from acts a where a.id = t.id offset 0) a
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  -- Every reaction on an Act voted on, up to now, but the caller's own to the caller's own characters,
  -- and none on The System's own Acts: the tally every player reacts to would hand each caller who
  -- reacted to it every other player's reaction.
  --
  -- The settlement never pays a player's reactions to their own characters, and until 0073 this read
  -- left them out too, which made a live line computed from who reacted: a fire landing on Bob's post
  -- under Ann's card with no lift line told Ann it came from one of Bob's masks. The live estimate is not
  -- The System's scoring (CLAUDE.md, "A response never proves a private fact": "The live estimate is not
  -- that exception: it leaves out only the caller's own reactions, counts every other as anyone's, and
  -- the settlement is exact"). So ownership is read here only to tell the caller's own from the rest:
  -- the caller knows their own, and every other reaction, the author's own player's included, is
  -- counted under `keyed`'s per-mask keys, which the engine cannot tie to an author. The estimate can then
  -- say more than the settlement pays, as it says "up to"; the settled log is exact.
  all_reactions as (
    select r.* from voted v cross join lateral (select r.* from reactions r where r.act = v.id and r.created_at < window_end offset 0) r
    join acts a on a.id = r.act join characters c on c.id = a.character
    where r.created_at < window_end and not (r.reactor_account = account and c.owner = account) and r.act not in (select id from ended) and a.kind <> 'donation'
      and not (r.reactor_account <> account and totals_withheld(r.act, account))
      and (not is_staff_side(a.character, a.kind, a.target_act_id) or a.id in (select id from unscored))
  ),
  -- Each reaction's voter and mask as the engine reads them: the caller's own, as the caller's;
  -- any other's, under keys made up for this request.
  keyed as (
    select r.id, r.act, r.kind, r.created_at,
      case when r.reactor_account = account then you else md5(salt || 'reactor' || r.reactor_character) end as player,
      case when r.reactor_account = account then r.reactor_character::text else md5(salt || 'mask' || r.reactor_character) end as character
    from all_reactions r
  ),
  others as (
    select distinct a.character::text as id, md5(salt || 'author' || a.character) as player from all_acts a where a.character not in (select id from mine)
    union select distinct k.character, k.player from keyed k where k.player <> you
  )
  select jsonb_build_object(
    'player', you,
    -- The window's start exactly, as the settlement that opened it ended: `from` is whole
    -- milliseconds, which can fall short of it. The estimate keeps its answer with this one.
    'windowStart', window_start,
    -- The classes the caller's own characters are scored as for this window (scored_as_plays), beside the window's start: the estimate can say it.
    'scoredAs', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'class', s.class_key, 'play', s.play) order by s.character)
                          from scored_as_plays(window_start, window_end) s join mine m on m.id = s.character), '[]'),
    'window', jsonb_build_object('id', 'estimate',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(x order by x ->> 'id') from (
        select jsonb_build_object('id', c.id, 'player', you, 'classes', coalesce((
          select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
          from class_history h where h.character = c.id and h.started_at < window_end), '[]')) as x
        from characters c join mine m on m.id = c.id
        union all
        select jsonb_build_object('id', o.id, 'player', o.player, 'classes', '[]'::jsonb) from others o
      ) cs), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread,
        'target', case when coalesce(a.payload ->> 'reach', 'post') = 'post' then a.target_act_id end,
        'reach', case when a.kind = 'card' then nullif(coalesce(a.payload ->> 'reach', 'post'), 'post') end,
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end,
        'by', case when a.kind = 'spring' then a.payload ->> 'by' end,
        -- A caught play is never in effect (0370): its `ends`, where a row written before 0370 holds one, is not sent, so it boosts and skims nothing.
        'ends', case when a.kind = 'card' and not (a.payload ? 'caught') and (select ck.gimmick is not null or ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card')
                     then (extract(epoch from (a.payload ->> 'ends')::timestamptz) * 1000)::bigint end,
        'quadrant', case when a.kind = 'card' and (select ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card') then a.payload #>> '{config,quadrant}'
                         when a.kind = 'spring' then a.payload ->> 'quadrant' end,
        'on', case when a.kind = 'card' and a.payload ->> 'reach' = 'character' then a.payload ->> 'character' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    'unscoredTargets', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'staff', true) order by a.created_at, a.id)
      from unscored a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', k.act, 'kind', k.kind, 'at', (extract(epoch from k.created_at) * 1000)::bigint,
        'player', k.player, 'character', k.character)
        || case when k.kind like 'x-%' then jsonb_build_object('quadrant', reaction_quadrant(k.act, k.kind)) else '{}'::jsonb end order by k.created_at, k.id)
      from keyed k), '[]'),
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'),
    -- Each quote with both ends among the caller's sparks and their members, so a bystander's input holds none (0390).
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'quoted', r.quoted) order by r.act, r.quoted)
      from all_acts a cross join lateral (select r.act, r.quoted from quote_refs r where r.act = a.id offset 0) r join all_acts q on q.id = r.quoted
      where a.id in (select id from ancestry union select id from members) and q.id in (select id from ancestry union select id from members)), '[]'))
  );
end $$;
