-- The thread's page draws a reply under its post, and a kept play's end (docs/plans/2026-11-11-card-notes-part-2-plan.md, Task 3; the design is
-- docs/plans/2026-11-11-card-notes-design.md, section 2). It follows 0410, which made `post_under` (a reply a play of a card that replies carried, drawn under its parent while the
-- play is in force) and `card_kinds.keeps` (a thread play of the kind still counts on the posts it was up over after its time). Two functions are written again whole, each as its
-- latest text left it (thread_page as 0340 wrote it, reverse_card as 0149 did), with the changes below and nothing else.
--
-- thread_page
--   page_acts   leaves out an Act that is the reply of a post_under row in force: it is drawn under its parent, not at its number. One probe of the unique index on `reply` for each
--               Act in the page's range (at most 100). `in_seq` is not redirected: a page is still the range its number falls in, so the gap read keeps working, and the screen follows `cut`.
--   nested      the replies drawn under the page's posts (post_under_parent), read through acts_public as the page's own Acts are, so the conduct layer's concealment holds for them.
--   posts       the page's posts (page_posts, the old `posts` with their dates) and the nested replies together, which the plays, visits, tallies, people and spun threads read for.
--   kept        the plays of a kind that keeps, at thread reach on this thread, that wore off by time and were not ended by an admin, whose window holds the date of one of `posts`
--               (play_reach_thread, from the page's earliest post date, at most 100, oldest first). Their ids and casters join `played`, so `ids` and `who`.
--   The document gains three keys, each a public projection, the same for every caller (nothing here reads who owns a character, a hand or a reaction):
--     'under'   [{ parent, play, act }]            the reply as `acts` holds an Act
--     'cut'     [{ seq, parent_seq }]              each number in the page's range whose Act is drawn under a post elsewhere
--     'kept'    [{ play, reach, target, ends_at, act }]   the shape of 'above'
-- reverse_card   does not raise "that card has already worn off" for a play whose kind keeps, so an admin can end a kept level after its week. effects_above and reach_effects are
--               not changed: an ended play prices, wards and blocks nothing.
--
-- Ways out: an admin's end of the play drops a reply back to its number and takes a kept level off every post. Cost at a busy instance's scale: a page's read gains the probes above
-- and no scan of a thread: at most twice a page of posts, and a kept read of a range of play_reach_thread that a thread with a Glam every week meets once a week of its age.
-- Masks: every new piece is read from public Acts, post_under and play_reach, so no caller can tell anything from it. Grants are as they were (create or replace keeps them).

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
  page_acts as materialized (
    select a.* from acts_public a, rng
    where a.thread = rng.id and a.seq between rng.first_seq and rng.end_seq and a.kind not in ('edit', 'card')
      -- A reply a play in force draws under its parent is read by `nested`, not at its number: one probe of the unique index on post_under's reply for each Act of the range.
      and not exists (select 1 from post_under u where u.reply = a.id and not card_ended(u.play))
  ),
  page_posts as materialized (select a.id, a.character, a.created_at from page_acts a where a.kind = 'post'),
  -- The replies drawn under the page's posts (post_under_parent), each read through acts_public as the page's own Acts are, so the conduct layer's concealment holds for a nested
  -- reply as for any post. A reply takes none under it, so one level, and at most one under each post (stack 1). `act` is the Act as `acts` holds one.
  nested as materialized (
    select u.play, u.parent, a.id, a.character, a.created_at, to_jsonb(a) as act
    from post_under u join acts_public a on a.id = u.reply
    where u.parent in (select p.id from page_posts p) and not card_ended(u.play)
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
  -- the page's posts: they still count on those posts, so the page carries them beside `above`, in its shape. play_reach_thread from the page's earliest post date, at most 100, oldest first.
  -- A later reach adds its own select to the union in `r`; the rest reads whatever rows it gives.
  kept as materialized (
    select k.play, k.reach, k.target, k.ends_at, k.act from (
      select r.play, r.reach, coalesce(r.character, r.thread, r.board) as target, r.ends_at, to_jsonb(a) as act, a.created_at as started
      from (
        select x.* from play_reach x
        where x.thread = (select rng.id from rng) and x.ends_at <= now() and x.ends_at > (select min(p.created_at) from posts p)
      ) r
      join acts_public a on a.id = r.play
      join card_kinds ck on ck.key = a.payload ->> 'card' and ck.keeps
      where not card_ended(r.play)
        and exists (select 1 from posts p where a.created_at <= p.created_at and p.created_at < r.ends_at)
    ) k
    order by k.started, k.play limit 100
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
    'cut', (select coalesce(jsonb_agg(jsonb_build_object('seq', c.seq, 'parent_seq', c.parent_seq) order by c.seq), '[]'::jsonb) from (
              select a.seq, pa.seq as parent_seq
              from acts_public a join post_under u on u.reply = a.id join acts_public pa on pa.id = u.parent, rng
              where a.thread = rng.id and a.seq between rng.first_seq and rng.end_seq and a.kind = 'post' and not card_ended(u.play)
            ) c),
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

create or replace function reverse_card(play uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p acts%rowtype;
  written uuid;
begin
  perform only_admins('ends a card');
  -- The play's row is locked, so two admins at once write one end between them and the second sees the first's.
  select * into p from acts a where a.id = play and a.kind = 'card' for no key update;
  if not found then raise exception 'that is not a card play' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.payload ? 'caught' then raise exception 'that card was caught by a trap, so it never landed' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  -- A play of a kind that keeps still counts on the posts it was up over after its time (thread_page's `kept`), so an admin may end it then.
  if ((p.payload ->> 'ends')::timestamptz <= now() or exists (select 1 from play_reach r where r.play = p.id and r.ends_at <= now()))
     and not coalesce((select ck.keeps from card_kinds ck where ck.key = p.payload ->> 'card'), false) then
    raise exception 'that card has already worn off' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = p.id) then
    raise exception 'an admin has already ended that card' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if exists (select 1 from card_write_refunds r where r.play = p.id) then
    raise exception 'That card didn''t take, so there is nothing of it on this post.' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (null, 'card_end', p.thread, p.id, jsonb_build_object('why', 'reversed', 'by', 'admin')) returning id into written;
  perform set_config('kayfabb.card_end_writer', '', true);
  -- The caster's alert (Task 4): one, in this transaction, for the caster's own player, about the card_end. write_alert writes none
  -- for a staff character (no owner), so a staff play's end tells nobody. `acting` is null: the admin is not told apart from the caster.
  perform write_alert(p.character, 'cardEnded', null, written, null);
  -- The answer carries the play, and for a play beyond a post its reach, so the act function can broadcast the end on `reach`.
  return act_projection(written) || jsonb_strip_nulls(jsonb_build_object('play', p.id,
    'reach', case when p.payload ->> 'reach' in ('character', 'thread', 'board') then p.payload ->> 'reach' end));
end $$;
