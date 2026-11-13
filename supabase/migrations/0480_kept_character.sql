-- A worn-off play of a kind that keeps, at character reach, still counts on the posts its target wrote while it was up (docs/plans/2026-11-12-glitter-keeps-plan.md, Task 2; the design is
-- docs/plans/2026-11-12-glitter-keeps-design.md). Part 2 (0349) made `thread_page`'s `kept` key carry the thread plays of a kind that keeps once they wore off; this makes it carry the
-- character plays too. `thread_page` is written again whole, as 0349 left it, with one change and nothing else; `reverse_card` is not changed (0349's acceptance of an ended play whose kind
-- keeps takes no reach), and the test proves an admin ends a worn-off character play of a kind that keeps.
--
-- thread_page
--   kept_reach   gains a second select beside the thread's: for each distinct author among the page's `posts` (at most one scan for each, at most the page size), the plays in play_reach with
--                that character, ended by time (`ends_at <= now()`) and after the page's earliest post, a lateral range of play_reach_character (character, ends_at). Thread and character rows
--                share kept_window, kept and the rest: the Act through acts_public, then the kind (`keeps`), `not card_ended` (the one rule for an admin's end), at most 100, oldest first.
--   kept_window  holds a character row only by a post of its target: `p.character = r.target` beside the window test. A thread row is held by any post of the page, as before. A character play
--                therefore falls only on posts by that character, never on another author's post in the same window on the same page.
--   The document keeps its keys and shapes ('kept' is { play, reach, target, ends_at, act }, the shape of 'above'); the casters of the character rows join `who` and their ids join `ids`
--   through `played` as the thread rows' do.
--
-- seed_instance is not written again: SQL mirrors none of instance.ts's `keeps` checks (0348 says so), so there is nothing of the check to widen here.
--
-- Ways out: an admin's end of the play (reverse_card, after its week as before it) takes it off every post; otherwise a kept play is a layer over words that stay readable, and it falls on no post
-- written after its week. Nothing is written for a post, at the week's end or ever.
-- Cost: one range scan of play_reach_character for each distinct author on the page (at most the page size, at most 100), lower-bounded by the page's earliest post, so a page read years later
-- reads old windows only; a character carries one play of a kind at a time, so each scan meets about one row for each week the page's posts span. The read returns at most 100.
-- Masks: every piece is read from play_reach, public Acts and the posts' public dates and authors (the author a row is matched on is the post's character, which every reader sees); nothing
-- reads who owns a character, a hand or a reaction, so the document is the same for every caller. Grants are as they were (create or replace keeps them).

create or replace function thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[]) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  -- The refusal, before anything is read.
  select case when coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) is null
                or coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) not between 1 and 100
              then screen_refusal('a page holds 1 to 100 posts') end;

  with pp as materialized (
    select coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) as n
  ),
  s as materialized (
    select o.*, greatest(1, ceil(o.last_seq::numeric / (select pp.n from pp)))::integer as last_page
    from thread_open o where o.id = thread_page.in_thread
  ),
  pg as materialized (
    select s.*,
           least(s.last_page, greatest(1, coalesce(case when thread_page.in_seq is not null then greatest(1, ceil(thread_page.in_seq::numeric / (select pp.n from pp)))::integer end,
                                                   thread_page.in_page, 1))) as page
    from s
  ),
  rng as materialized (
    select pg.*, (pg.page - 1) * (select pp.n from pp) + 1 as first_seq, pg.page * (select pp.n from pp) as end_seq from pg
  ),
  -- The range's numbers, read through acts_public once: the page's Acts and the numbers drawn elsewhere both come from this one pass (a screen function may read no relation below the
  -- public projections, tools/check-web-reads.mjs).
  range_acts as materialized (
    select a.* from acts_public a, rng
    where a.thread = rng.id and a.seq between rng.first_seq and rng.end_seq and a.kind not in ('edit', 'card')
  ),
  -- A range number whose Act is the reply of a post_under row in force: drawn under its parent, not at its number. A lateral probe of the unique index on `reply`, one for each
  -- number of the range and so no more than 100: the planner cannot turn it into a hash over the whole table. `not card_ended` is the one in-force rule, here and in `nested`.
  drawn as materialized (
    select r.id, r.seq, r.kind, u.play, u.parent
    from range_acts r cross join lateral (select x.play, x.parent from post_under x where x.reply = r.id) u
    where not card_ended(u.play)
  ),
  page_acts as materialized (
    select r.* from range_acts r
    where not exists (select 1 from drawn d where d.id = r.id)
  ),
  page_posts as materialized (select a.id, a.character, a.created_at from page_acts a where a.kind = 'post'),
  -- The replies drawn under the page's posts (post_under_parent), each read through acts_public as the page's own Acts are, so the conduct layer's concealment holds for a nested
  -- reply as for any post. A reply takes none under it, so one level, and at most one under each post (stack 1). `act` is the Act as `acts` holds one.
  nested as materialized (
    select u.play, p.id as parent, a.id, a.character, a.created_at, to_jsonb(a) as act
    from page_posts p
    cross join lateral (select x.play, x.reply from post_under x where x.parent = p.id and not card_ended(x.play)) u
    join acts_public a on a.id = u.reply
  ),
  -- What the plays, visits, tallies, people and spun threads are read for: the page's posts and the replies drawn under them.
  posts as materialized (
    select p.id, p.character, p.created_at from page_posts p
    union all
    select n.id, n.character, n.created_at from nested n
  ),
  -- At most PLAYS_PER_POST layers a post, oldest first.
  on_posts as materialized (
    select l.* from (
      select a.*, row_number() over (partition by a.target_act_id order by a.created_at, a.id) as n
      from acts_public a where a.kind in ('card', 'set', 'spring') and a.target_act_id in (select p.id from posts p)
    ) l where l.n <= 8
  ),
  -- An admin's end of each of those plays (0092), as cardsOnMany answers it beside them: the client marks a play reversed only from
  -- its card_end (engine/ui/cards/plays.ts), so a page without it would draw an ended effect over its post. One per play at most.
  ends_on_posts as materialized (
    select a.* from acts_public a where a.kind = 'card_end' and a.target_act_id in (select o.id from on_posts o)
  ),
  above as materialized (
    select x.play, x.reach, x.target, x.ends_at, x.act
    from effects_above(array(select distinct p.character from posts p where p.character is not null), (select rng.id from rng), (select rng.board from rng)) x
  ),
  -- The plays of a kind that keeps, at thread reach on this thread, that wore off by time (not one an admin ended), whose window (the play's date to its end) holds the date of one of
  -- the page's posts: they still count on those posts, so the page carries them beside `above`, in its shape. The range of play_reach_thread (ended, and ended after the
  -- page's earliest post), the Act by primary key through acts_public (dated no later than the page's latest post, then the window), and only for what survives that the kind (`keeps`). At most 100, oldest first.
  kept_span as materialized (select min(p.created_at) as lo, max(p.created_at) as hi from posts p),
  -- The reach-specific part: the thread's rows (play_reach_thread) and, for each distinct author among the page's posts, the plays at that character's reach (play_reach_character,
  -- (character, ends_at)): one range scan for each author, ended by time and ended after the page's earliest post, so an old page reads old windows only. A character carries one play
  -- of a kind at a time, so a scan meets about one row for each week the page's posts span. Whether the author's own post falls in the window is kept_window's.
  kept_reach as materialized (
    select x.play, x.reach, coalesce(x.character, x.thread, x.board) as target, x.ends_at
    from play_reach x, kept_span s
    where x.thread = (select rng.id from rng) and x.ends_at <= now() and x.ends_at > s.lo
    union all
    select x.play, x.reach, x.character as target, x.ends_at
    from (select distinct p.character from posts p where p.character is not null) au cross join kept_span s
    cross join lateral (select r.play, r.reach, r.character, r.ends_at from play_reach r where r.character = au.character and r.ends_at <= now() and r.ends_at > s.lo) x
  ),
  -- A thread row is held by any post of the page inside its window; a character row only by a post of its own target (`p.character = r.target`), never another author's post in the same
  -- window on the same page.
  kept_window as materialized (
    select r.play, r.reach, r.target, r.ends_at, a.created_at as started, to_jsonb(a) as act, a.payload ->> 'card' as card
    from kept_reach r join acts_public a on a.id = r.play, kept_span s
    where a.created_at <= s.hi
      and exists (select 1 from posts p where a.created_at <= p.created_at and p.created_at < r.ends_at and (r.reach <> 'character' or p.character = r.target))
  ),
  kept as materialized (
    select w.play, w.reach, w.target, w.ends_at, w.act
    from kept_window w
    join card_kinds ck on ck.key = w.card and ck.keeps
    where not card_ended(w.play)
    order by w.started, w.play limit 100
  ),
  -- Every play the page draws, on a post or above: by id, with its caster.
  played as materialized (
    select o.id, o.kind, o.character, o.payload ->> 'card' as card from on_posts o
    union
    select (x.act ->> 'id')::uuid, x.act ->> 'kind', (x.act ->> 'character')::uuid, x.act -> 'payload' ->> 'card' from above x
    union
    select (x.act ->> 'id')::uuid, x.act ->> 'kind', (x.act ->> 'character')::uuid, x.act -> 'payload' ->> 'card' from kept x
  ),
  -- Each of the page's posts' latest visit (0105), by acts_visits_by_post: its Mod, when it ends, its charges (the start's and every join's, in order) and its
  -- challenge, whitelisted to the kind and the number, never an answer; and its end if it has one.
  vis as materialized (
    select distinct on (v.target_act_id) v.id, v.target_act_id as post, v.character, v.created_at, v.payload
    from acts_public v where v.kind = 'visit' and v.target_act_id in (select a.id from page_acts a where a.kind in ('post', 'spin') union all select n.id from nested n)
    order by v.target_act_id, v.created_at desc, v.id desc
  ),
  ids as materialized (select a.id from page_acts a union select n.id from nested n union select p.id from played p),
  who as materialized (
    select c from (select a.character as c from page_acts a union select n.character from nested n union select p.character from played p union select v.character from vis v) w where c is not null
  ),
  wanted_plays as materialized (select p.id from played p where p.card = any (coalesce(thread_page.effect_cards, '{}'))),
  spun as materialized (
    select l.* from (
      select t.*, row_number() over (partition by t.origin_act_id order by t.created_at, t.id) as n
      from thread_list t where t.origin_act_id in (select i.id from ids i)
    ) l where l.n <= 200
  )
  select case when not exists (select 1 from rng) then null else jsonb_build_object(
    'summary', (select to_jsonb(s) - 'last_page' from s),
    'page', (select rng.page from rng),
    'acts', (select coalesce(jsonb_agg(to_jsonb(a) order by a.seq), '[]'::jsonb) from page_acts a),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
        'character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
          'warn_points', c.warn_points, 'banned_until', c.banned_until, 'group', c."group"),
        'profile', (select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square,
                      'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns) || profile_cosmetics(p.character)
                    from character_profiles p where p.character = c.id),
        'posts', coalesce((select n.posts from character_post_counts n where n.character = c.id), 0),
        'standing', coalesce((select st.standing from current_standings st where st.character = c.id), 0),
        'reveals', (select coalesce(jsonb_agg(jsonb_build_object('act', r.act, 'character', r.character, 'class', r.class, 'at', r.at, 'via', r.via, 'thread', r.thread)
                      order by r.at, r.act), '[]'::jsonb) from class_reveals r where r.character = c.id),
        'turns', (select coalesce(jsonb_agg(jsonb_build_object('act', u.act, 'character', u.character, 'at', u.at, 'was', u.was) order by u.at, u.act), '[]'::jsonb)
                  from turns_announced u where u.character = c.id)
      ) order by c.id), '[]'::jsonb)
      from characters_public c where c.id in (select w.c from who w)),
    'plays', (select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb) from (
                select to_jsonb(o) - 'n' as j, o.created_at, o.id from on_posts o
                union all
                select to_jsonb(e), e.created_at, e.id from ends_on_posts e
              ) x),
    'above', (select coalesce(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act)
                order by (x.act ->> 'created_at')::timestamptz, x.play), '[]'::jsonb) from above x),
    'kept', (select coalesce(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act)
                order by (x.act ->> 'created_at')::timestamptz, x.play), '[]'::jsonb) from kept x),
    -- The replies drawn under the page's posts, and the numbers of this page's range whose Act is drawn under a post elsewhere. Public projections: the same for every caller.
    'under', (select coalesce(jsonb_agg(jsonb_build_object('parent', n.parent, 'play', n.play, 'act', n.act) order by (n.act ->> 'seq')::integer, n.id), '[]'::jsonb) from nested n),
    'cut', (select coalesce(jsonb_agg(jsonb_build_object('seq', d.seq, 'parent_seq', (select pa.seq from acts_public pa where pa.id = d.parent)) order by d.seq), '[]'::jsonb) from drawn d where d.kind = 'post'),
    'visits', (select coalesce(jsonb_agg(jsonb_build_object(
        'visit', v.id, 'post', v.post, 'mod', v.character, 'at', v.created_at, 'ends_at', v.payload -> 'ends_at', 'line', v.payload -> 'line',
        'charges', (v.payload -> 'charges') || coalesce((select jsonb_agg(j.payload -> 'charge' order by j.created_at, j.id) from acts_public j where j.kind = 'visit_join' and j.target_act_id = v.id), '[]'::jsonb),
        'challenge', jsonb_strip_nulls(jsonb_build_object('kind', v.payload #>> '{challenge,kind}', 'question_index', v.payload #> '{challenge,question_index}', 'price', v.payload #> '{challenge,price}'))
          || coalesce(visit_quiz(v.id), '{}'::jsonb),
        'end', (select jsonb_build_object('act', e.id, 'at', e.created_at, 'outcome', e.payload ->> 'outcome', 'by_act', e.payload -> 'by_act', 'line', e.payload -> 'line')
                from acts_public e where e.kind = 'visit_end' and e.target_act_id = v.id limit 1),
        -- Read through acts_public as the rest of the page is (e2e/0016 holds a screen to the public projections).
        'ruling', (select r.payload ->> 'verdict' from acts_public i
                   join acts_public ap on ap.kind = 'appeal' and ap.target_act_id = i.id
                   join acts_public r on r.kind = 'appeal_ruling' and r.target_act_id = ap.id
                   where i.kind = 'infraction' and i.payload ->> 'visit_act' = v.id::text limit 1)
      ) order by v.created_at, v.id), '[]'::jsonb) from vis v),
    'faces', (select coalesce(jsonb_agg(jsonb_build_object('play', f.play, 'card', f.card)), '[]'::jsonb)
              from my_face_down f where f.play in (select p.id from played p where p.kind = 'set')),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb)
               from effect_state e where e.play in (select w.id from wanted_plays w)),
    'releases', (select coalesce(jsonb_agg(r.play), '[]'::jsonb) from effect_releases r where r.play in (select w.id from wanted_plays w)),
    'surfaces', (select coalesce(jsonb_object_agg(sf.play::text, jsonb_build_object('covered', bit_count(sf.cover), 'live', to_jsonb(sf.live))), '{}'::jsonb)
                 from surfaces sf where sf.play in (select o.id from on_posts o where o.kind = 'card')),
    'tallies', (select coalesce(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb)
                from reaction_tallies t where t.act in (select i.id from ids i)),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m.character)), '[]'::jsonb)
             from my_reactions m where m.act in (select i.id from ids i)),
    'spun', (select coalesce(jsonb_agg(to_jsonb(l) - 'n' order by l.created_at, l.id), '[]'::jsonb) from spun l),
    'reading', (select r.furthest_seq from reading r where r.thread = thread_page.in_thread limit 1),
    'board', (select jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act)
              from boards_now b where b.id = (select rng.board from rng)),
    'following', following_thread(thread_page.in_thread),
    'presence', presence_box('thread', thread_page.in_thread),
    'unread', my_alerts_unread()
  ) end;
end;
