-- Cosmetics on the screens: every face a screen function hands the web (a postbit's, a profile's, a card's) carries the character's portrait tallness, its outfit
-- (pieces in layer order, gear_worn) and its shown trophies (trophy_shelf), as profile_projection (0153, 0154) carries them. The shape lives here once:
-- profile_cosmetics, one lookup by character (character_profiles by its key, gear_worn by its key (character, layer), the shelf by its indexes), called once per
-- character a screen names and never per post or per Act. A security definer, as profile_projection is: trophy_shelf is not the caller's to run, and the
-- screens are security invoker. It reads only what is public by character (a worn piece, a shown or held trophy) once the character has debuted, so no private fact moves with it.
-- An undebuted mask is not public (characters_public), so for it, and for an id that is no character, the answer is one constant shape: a caller holding a uuid
-- cannot confirm a mask exists. Only its own player is shown what an undebuted mask wears.
create function profile_cosmetics(of_character uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when exists (select 1 from characters_public c where c.id = of_character)
                or exists (select 1 from characters c where c.id = of_character and c.owner = auth.uid()) then
    jsonb_build_object(
      'portrait_tallness', (select p.portrait_tallness from character_profiles p where p.character = of_character),
      'outfit', coalesce((select jsonb_agg(jsonb_build_object('gear', w.gear, 'x', w.x, 'y', w.y, 'w', w.w, 'turn', w.turn, 'layer', w.layer) order by w.layer)
                          from gear_worn w where w.character = of_character), '[]'::jsonb),
      'trophies', trophy_shelf(of_character))
  else jsonb_build_object('portrait_tallness', null, 'outfit', '[]'::jsonb, 'trophies', '[]'::jsonb) end
$$;
revoke execute on function profile_cosmetics(uuid) from public, anon;
grant execute on function profile_cosmetics(uuid) to authenticated;

-- thread_page (0149), its faces also carrying the cosmetics. Everything else as 0149 wrote it.
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
  ),
  posts as materialized (select a.id, a.character from page_acts a where a.kind = 'post'),
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
  -- Every play the page draws, on a post or above: by id, with its caster.
  played as materialized (
    select o.id, o.kind, o.character, o.payload ->> 'card' as card from on_posts o
    union
    select (x.act ->> 'id')::uuid, x.act ->> 'kind', (x.act ->> 'character')::uuid, x.act -> 'payload' ->> 'card' from above x
  ),
  -- Each of the page's posts' latest visit (0105), by acts_visits_by_post: its Mod, when it ends, its charges (the start's and every join's, in order) and its
  -- challenge, whitelisted to the kind and the number, never an answer; and its end if it has one.
  vis as materialized (
    select distinct on (v.target_act_id) v.id, v.target_act_id as post, v.character, v.created_at, v.payload
    from acts_public v where v.kind = 'visit' and v.target_act_id in (select a.id from page_acts a where a.kind in ('post', 'spin'))
    order by v.target_act_id, v.created_at desc, v.id desc
  ),
  ids as materialized (select a.id from page_acts a union select p.id from played p),
  who as materialized (
    select c from (select a.character as c from page_acts a union select p.character from played p union select v.character from vis v) w where c is not null
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

-- profile_page (0149), its faces also carrying the cosmetics. Everything else as 0149 wrote it.
create or replace function profile_page(in_character uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with c as (
    select id, name, joined, staff, office, warn_points, banned_until, "group" from characters_public where id = in_character
  ), acts5 as (
    -- PROFILE_ROWS (engine/ui/profile/record.ts): the newest few of its own Acts, with no count.
    select a.* from acts_public a
    where a.character = in_character and a.kind in ('post', 'spin', 'card')
    order by a.created_at desc limit 5
  ), rv as (
    select r.act, r.character, r.class, r.at, r.via, r.thread from class_reveals r where r.character = in_character
  ), tn as (
    select t.act, t.character, t.at, t.was from turns_announced t where t.character = in_character
  )
  select case when not exists (select 1 from c) then null else jsonb_build_object(
    'character', (select to_jsonb(c) from c),
    'profile', (select to_jsonb(p) || profile_cosmetics(p.character) from (
      select character, title, signature, avatar_square, avatar_portrait, square_frame, portrait_frame, pip_style, pronouns
      from character_profiles where character = in_character) p),
    'counts', (select to_jsonb(n) from (select character, posts, spins, cards from character_post_counts where character = in_character) n),
    'standing', standing_place(in_character),
    'settled_at', (select s.ends_at from settlements s order by s.ends_at desc limit 1),
    'season', (select to_jsonb(s) from current_season s limit 1),
    'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from rv r), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from acts5 a), '[]'::jsonb),
    -- The card plays' target posts and the Turns' tallies, placed with one batched read (playLinks, turnLinks).
    'targets', coalesce((select jsonb_agg(to_jsonb(x)) from acts_public x
      where x.id in (select a.target_act_id from acts5 a where a.kind = 'card' and a.target_act_id is not null union select t.act from tn t)), '[]'::jsonb),
    'seasons', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc, a.season desc) from (
      select f.number as season, r.place, r.standing, f.results_at as at
      from season_results r join seasons_finished f on f.id = r.season
      where r.character = in_character
      order by f.results_at desc, f.number desc limit 50) a), '[]'::jsonb),
    'unread', my_alerts_unread()
  ) end;
end;

-- record_page (0149), its faces also carrying the cosmetics. Everything else as 0149 wrote it.
create or replace function record_page(in_character uuid, in_kind text, in_page integer) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with c as (
    select id, name, joined, staff, office, warn_points, banned_until, "group" from characters_public where id = in_character
  ), k as (
    select case when in_kind in ('all', 'post', 'spin', 'card', 'class', 'seasons') then in_kind else 'all' end as kind,
           least(greatest(coalesce(in_page, 1), 1), 10000) as page
  ), rv as (
    select r.act, r.character, r.class, r.at, r.via, r.thread from class_reveals r, k
    where r.character = in_character and k.kind in ('all', 'class')
  ), tn as (
    select t.act, t.character, t.at, t.was from turns_announced t, k
    where t.character = in_character and k.kind in ('all', 'class')
  ), seasons_read as (
    select f.number as season, r.place, r.standing, f.results_at as at
    from season_results r join seasons_finished f on f.id = r.season, k
    where k.kind in ('all', 'seasons') and r.character = in_character
    order by f.results_at desc, f.number desc limit 50
  ), w as (
    -- The window of the character's own Acts: for `all`, from `max(0, offset - extras)` for `offset + 20 - from` rows
    -- (the extras are merged in by the client, `mergeWindow`); for one kind, the page itself; for class and seasons, none.
    select case k.kind when 'all' then array['post', 'spin', 'card'] when 'post' then array['post'] when 'spin' then array['spin']
                       when 'card' then array['card'] else array[]::text[] end as kinds,
           case when k.kind = 'all' then greatest(0, (k.page - 1) * 20 - ((select count(*) from rv) + (select count(*) from tn) + (select count(*) from seasons_read)))
                else (k.page - 1) * 20 end as from_row,
           case when k.kind = 'all' then (k.page - 1) * 20 + 20 else 20 end as base
    from k
  ), acts_read as (
    -- The kinds as an init plan, so the planner keeps the ordered scan of the character's Acts with the limit pushed down.
    select a.* from acts_public a
    where a.character = in_character and a.kind = any (((select kinds from w)::text[]))
    order by a.created_at desc
    offset (select from_row from w)
    limit (select case when k.kind = 'all' then w.base - w.from_row else 20 end from w, k)
  )
  select case when not exists (select 1 from c) then null else jsonb_build_object(
    'kind', (select kind from k),
    'page', (select page from k),
    'character', (select to_jsonb(c) from c),
    'profile', (select to_jsonb(p) || profile_cosmetics(p.character) from (
      select character, title, signature, avatar_square, avatar_portrait, square_frame, portrait_frame, pip_style, pronouns
      from character_profiles where character = in_character) p),
    -- RecordScreen reads the counters for all, post, spin and card only.
    'counts', (select to_jsonb(n) from (select character, posts, spins, cards from character_post_counts where character = in_character and (select kind from k) in ('all', 'post', 'spin', 'card')) n),
    'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from rv r), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'seasons', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc, a.season desc) from seasons_read a), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from acts_read a), '[]'::jsonb),
    'targets', coalesce((select jsonb_agg(to_jsonb(x)) from acts_public x
      where x.id in (select a.target_act_id from acts_read a where a.kind = 'card' and a.target_act_id is not null union select t.act from tn t)), '[]'::jsonb),
    'unread', my_alerts_unread()
  ) end;
end;

-- alerts_page (0149), its faces also carrying the cosmetics. Everything else as 0149 wrote it.
create or replace function alerts_page(in_before timestamptz) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with recursive al as (
    select to_jsonb(a) - 'ordinality' as j, a.ordinality as o
    from my_alerts(in_before, 30) with ordinality as a
  ), chain(id, depth, ended) as (
    select (al.j ->> 'act')::uuid, 1, al.j ->> 'kind' = 'cardEnded' from al where al.j ->> 'act' is not null
    union
    select x.target_act_id, c.depth + 1, c.ended
    from chain c join acts_public x on x.id = c.id
    where (c.depth < 2 or (c.depth < 3 and c.ended)) and x.target_act_id is not null
  ), ac as (
    select a.* from acts_public a where a.id in (select c.id from chain c)
  ), th as (
    select distinct (al.j ->> 'thread')::uuid as id from al where al.j ->> 'kind' = 'followed' and al.j ->> 'thread' is not null
  )
  select jsonb_build_object(
    'alerts', coalesce((select jsonb_agg(al.j order by al.o) from al), '[]'::jsonb),
    'seenAt', (select p.alerts_seen_at from account_preferences p limit 1),
    'openedAt', my_account_opened(),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id::text collate "C") from ac a), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(f.face order by f.name) from (
        select cp.name, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) || profile_cosmetics(p.character) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
            from character_profiles r where r.character = cp.id) p)) as face
        from (select c.id, c.name, c.joined, c.staff, c.office, c."group" from characters_public c
              where c.id in (select a.character from ac a where a.id in (select h.id from chain h where h.depth = 3))) cp) f), '[]'::jsonb),
    'openings', coalesce((select jsonb_agg(to_jsonb(a) order by a.thread::text collate "C") from acts_public a where a.thread in (select t.id from th t) and a.seq = 1), '[]'::jsonb),
    'reading', coalesce((select jsonb_agg(to_jsonb(r) order by r.thread::text collate "C") from (
      select g.thread, g.furthest_seq from reading g where g.thread in (select t.id from th t)) r), '[]'::jsonb)
  );
end;

-- log_page (0151, which added `scoredAs`), its faces also carrying the cosmetics. Everything else as 0151 wrote it.
create or replace function log_page(in_before timestamptz) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with recursive
  mine as (
    select m.id, m.class_since from my_characters m
  ), lg as materialized (
    select l.settlement, l.starts_at, l.ends_at, l.character, l.reason, l.amount, l.shares_kept, l.params
    from my_ledger l where in_before is null or l.ends_at <= in_before
    order by l.ends_at desc, l.settlement, l.character, l.reason limit 200
  ), wl as materialized (
    select e.settlement, e.kind, e.change, e.overflow, e.floored, e.balance_after, e.ref, e.at
    from my_wallet_events e where in_before is null or e.at <= in_before
    order by e.at desc, e.settlement, e.kind, e.ref, e.change, e.overflow, e.floored, e.balance_after limit 200
  ), cd as materialized (
    select c.card, c.kind, c.act, c.price, c.at, c.springs, c.pack, c.repriced
    from my_card_ledger c where in_before is null or c.at <= in_before
    order by c.at desc, c.card, c.kind, c.act, c.price, c.pack limit 200
  ), pk as materialized (
    select p.id, p.pack, p.price, p.repriced, p.contents, p.bought_at
    from my_packs p where in_before is null or p.bought_at <= in_before
    order by p.bought_at desc, p.id limit 200
  ), po as materialized (
    select p.play, p.post, p.at, p.reach, p.target_name, p.target_character
    from my_posts_played_on p where in_before is null or p.at <= in_before
    order by p.at desc, p.play limit 200
  ), wr as materialized (
    select w.play, w.post, w.version, w.failed, w.opening, w.over, w.at
    from my_posts_written_on w where in_before is null or w.at <= in_before
    order by w.at desc, w.play, w.version limit 200
  ), sv as materialized (
    select p.play, p.post, p.saved_at
    from my_posts_played_on p where p.saved_at is not null and (in_before is null or p.saved_at <= in_before)
    order by p.saved_at desc, p.play limit 200
  ), se as materialized (
    select f.play, f.card, f.post, f.spring, f.ended_at, f.ended_by
    from my_face_down f where f.ended_at is not null and (in_before is null or f.ended_at <= in_before)
    order by f.ended_at desc, f.play limit 200
  ), sp as materialized (
    select f.play, f.card, f.post, f.ends_at, f.passed_at
    from my_face_down f where f.passed_at is not null and f.spring is null and (in_before is null or f.passed_at <= in_before)
    order by f.passed_at desc, f.play limit 200
  ), ca as materialized (
    select c.play, c.card, c.post, c.trap, c.spring, c.price, c.bought_price, c.at
    from my_caught c where in_before is null or c.at <= in_before
    order by c.at desc, c.play limit 200
  ), en as materialized (
    select e.card_end, e.play, e.card, e.at, e.side, e.reach, e.target_name, e.post_author_name, e.caster_name, e.character
    from my_cards_ended e where in_before is null or e.at <= in_before
    order by e.at desc, e.card_end limit 200
  ), inf as materialized (
    select i.infraction, i.character, i.at, i.band, i.points, i.rule_number, i.rule, i.mod_name, i.post, i.post_seq, i.thread, i.expires_at, i.relief, i.emptied_at
    from my_infractions i where in_before is null or i.at <= in_before
    order by i.at desc, i.infraction limit 200
  ), bn as materialized (
    select b.ban, b.character, b.at, b.days, b.until, b.infraction, b.rule, b.thread
    from my_bans b where in_before is null or b.at <= in_before
    order by b.at desc, b.ban limit 200
  ), gm as materialized (
    select g.move, g.character, g.at, g.thread, g.seq, g."group", g.board, g.board_name, g.expires_at, g.landed_until, g.check_at, g.demand, g.office,
           g.ended_why, g.ended_by, g.ended_at, g.ruling, g.ruled_at, g.ruled_until
    from my_group_moves g where in_before is null or g.at <= in_before
    order by g.at desc, g.move limit 200
  ), rp as materialized (
    select r.report, r.character, r.at, r.post, r.post_seq, r.thread, r.verdict, r.verdict_at, r.mod_name, r.refund
    from my_reports r where in_before is null or r.at <= in_before
    order by r.at desc, r.report limit 200
  ), ap as materialized (
    select a.appeal, a.character, a.at, a.punishment, a.punishment_kind, a.post_seq, a.thread, a.verdict, a.ruled_at, a.points_delta, a.hearer_name, a.refund
    from my_appeals a where in_before is null or a.at <= in_before
    order by a.at desc, a.appeal limit 200
  ), sh as materialized (
    select s.settlement, s.character, s.reason, s.act, s.quadrant, s.amount
    from my_ledger_shares s where s.settlement in (select x.settlement from lg x)
  ), sa as materialized (
    select s.settlement, s.character, s.named_class, s.play, s.card, s.starts_at, s.ends_at
    from my_scored_as s where in_before is null or s.ends_at <= in_before
    order by s.ends_at desc, s.settlement, s.character limit 200
  ), tn as materialized (
    select t.act, t.character, t.at, t.was from turns_announced t where t.character in (select m.id from mine m)
  ), named(id) as (
    -- actsNamed (engine/ui/log/lines.ts) over every row read; the Turns are the latest one of each character, the one announced as its class began.
    select x.act from sh x where x.act is not null
    union select t.act from tn t where exists (select 1 from mine m where m.id = t.character and date_trunc('milliseconds', m.class_since) = date_trunc('milliseconds', t.at))
    union select x.act from cd x where x.act is not null
    union select x.play from po x union select x.post from po x where x.post is not null
    union select x.play from wr x union select x.post from wr x
    union select x.play from sv x union select x.post from sv x where x.post is not null
    union select x.post from se x where x.post is not null union select x.spring from se x where x.spring is not null
    union select x.post from sp x where x.post is not null
    union select x.play from ca x union select x.post from ca x where x.post is not null
    union select x.play from en x
    union select x.ref from wl x where x.kind = 'bribe' and x.ref is not null
  ), walk(id, depth) as (
    -- actsFollowed, twice: what the Acts read lead to. A loop costs the two rounds as a chain does.
    select n.id, 0 from named n
    union
    select f.id, w.depth + 1
    from walk w
    join acts_public a on a.id = w.id
    cross join lateral (values
      (case when a.kind in ('card', 'spring', 'set') then a.target_act_id end),
      (case when a.kind = 'intercept' and a.payload ->> 'visit_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'visit_act')::uuid end),
      (case when a.kind in ('spring', 'card') and a.payload ->> 'spring' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'spring')::uuid end),
      (case when a.kind = 'spring' and a.payload ->> 'caught' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'caught')::uuid end),
      (case when a.kind = 'spring' and a.payload ->> 'by' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'by')::uuid end)
    ) f(id)
    where w.depth < 2 and f.id is not null
  ), ac as materialized (
    select a.* from acts_public a where a.id in (select w.id from walk w)
  ), reach as materialized (
    -- A play beyond a post carries its target's name (play_card, 0056); one written without reads it as it stands, so its target is named here.
    select a.payload ->> 'reach' as kind,
           case when a.payload ->> (a.payload ->> 'reach') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> (a.payload ->> 'reach'))::uuid end as target
    from ac a
    where a.kind = 'card' and jsonb_typeof(a.payload -> 'targetName') is distinct from 'string' and a.payload ->> 'reach' in ('character', 'thread', 'board')
  ), pe(id) as (
    select a.character from ac a where a.character is not null and a.character not in (select m.id from mine m)
    union select r.target from reach r where r.kind = 'character' and r.target is not null and r.target not in (select m.id from mine m)
  ), th(id) as (
    select a.thread from ac a where a.id in (select t.act from tn t where exists (select 1 from mine m where m.id = t.character and date_trunc('milliseconds', m.class_since) = date_trunc('milliseconds', t.at)))
    union select r.target from reach r where r.kind = 'thread' and r.target is not null
  )
  select jsonb_build_object(
    'sources', jsonb_build_object(
      'ledger', coalesce((select jsonb_agg(to_jsonb(x) order by x.ends_at desc, x.settlement, x.character, x.reason) from lg x), '[]'::jsonb),
      'wallet', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.settlement, x.kind, x.ref, x.change, x.overflow, x.floored, x.balance_after) from wl x), '[]'::jsonb),
      'cards', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.card, x.kind, x.act, x.price, x.pack) from cd x), '[]'::jsonb),
      'packs', coalesce((select jsonb_agg(to_jsonb(x) order by x.bought_at desc, x.id) from pk x), '[]'::jsonb),
      'playsOnMine', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play) from po x), '[]'::jsonb),
      'writes', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play, x.version) from wr x), '[]'::jsonb),
      'saves', coalesce((select jsonb_agg(to_jsonb(x) order by x.saved_at desc, x.play) from sv x), '[]'::jsonb),
      'setEnds', coalesce((select jsonb_agg(to_jsonb(x) order by x.ended_at desc, x.play) from se x), '[]'::jsonb),
      'setPasses', coalesce((select jsonb_agg(to_jsonb(x) order by x.passed_at desc, x.play) from sp x), '[]'::jsonb),
      'caught', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play) from ca x), '[]'::jsonb),
      'ended', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.card_end) from en x), '[]'::jsonb),
      'infractions', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.infraction) from inf x), '[]'::jsonb),
      'bans', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.ban) from bn x), '[]'::jsonb),
      'groupMoves', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.move) from gm x), '[]'::jsonb),
      'reports', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.report) from rp x), '[]'::jsonb),
      'appeals', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.appeal) from ap x), '[]'::jsonb)),
    'shares', coalesce((select jsonb_agg(to_jsonb(x) order by x.settlement desc, x.character, x.reason, x.act, x.quadrant) from sh x), '[]'::jsonb),
    'scoredAs', coalesce((select jsonb_agg(to_jsonb(x) order by x.ends_at desc, x.settlement, x.character) from sa x), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id::text collate "C") from ac a), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(to_jsonb(e) order by e.play::text collate "C") from (
      select s.play, s.state, s.saved_at from effect_state s where s.play in (select v.play from sv v)) e), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(f.face order by f.name, f.id) from (
        select cp.name, cp.id, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) || profile_cosmetics(p.character) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
            from character_profiles r where r.character = cp.id) p)) as face
        from (select c.id, c.name, c.joined, c.staff, c.office, c."group" from characters_public c where c.id in (select p.id from pe p)) cp) f), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id::text collate "C") from thread_open t where t.id in (select h.id from th h)), '[]'::jsonb),
    'boards', coalesce((select jsonb_agg(to_jsonb(b) order by b.id::text collate "C") from (
      select n.id, n.slug, n.name, n.description, n.is_system, n.move_act from boards_now n
      where n.id in (select r.target from reach r where r.kind = 'board' and r.target is not null)) b), '[]'::jsonb),
    'standings', coalesce((select jsonb_agg(to_jsonb(s) order by s.character::text collate "C") from (
      select c.character, c.standing from current_standings c where c.character in (select m.id from mine m)) s), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'season', (select to_jsonb(s) from current_season s limit 1)
  );
end;

-- board_page (0125), its faces also carrying the cosmetics. Everything else as 0125 wrote it.
create or replace function board_page(in_slug text, in_page integer, effect_cards text[]) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with b as (
    select x.id, x.slug, x.name, x.description, x.is_system, x.move_act from boards_now x where x.slug = in_slug or x.id::text = in_slug order by (x.slug = in_slug) desc limit 1
  ),
  p as (
    select b.id as board, c.total,
           least(greatest(coalesce(in_page, 1), 1), greatest(1, ceil(c.total / 20.0)::integer)) as page
    from b cross join lateral (select coalesce((select n.threads from board_counts n where n.board = b.id), 0) as total) c
  ),
  listed as materialized (
    select l.* from thread_list l
    where l.board = (select board from p)
    order by l.last_at desc
    offset (select (page - 1) * 20 from p) limit 20
  ),
  pins as materialized (
    select x.thread, x.play, x.ends_at, x.act from p cross join lateral pinned_threads(p.board) x where p.page = 1
  ),
  banner as materialized (
    select x.play, x.reach, x.target, x.ends_at, x.act from p cross join lateral effects_above('{}'::uuid[], null::uuid, p.board) x
  ),
  marked as materialized (
    select (m.act ->> 'id')::uuid as id, m.act ->> 'character' as character, m.act #>> '{payload,card}' as card
    from (select act from pins union all select act from banner) m
  ),
  wanted as (select m.id from marked m where m.card = any (coalesce(effect_cards, '{}'))),
  threads as materialized (
    select l.id, l.first_character, l.last_character from listed l
    union
    select (x.thread ->> 'id')::uuid, (x.thread ->> 'first_character')::uuid, (x.thread ->> 'last_character')::uuid from pins x
  ),
  people as (
    select t.first_character as id from threads t union select t.last_character from threads t union select m.character::uuid from marked m
  )
  select jsonb_build_object(
    'board', to_jsonb(b),
    'total', p.total,
    'page', p.page,
    'threads', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from listed l),
    'pins', (select coalesce(jsonb_agg(to_jsonb(x) order by (x.act ->> 'created_at')::timestamptz desc, x.play desc), '[]'::jsonb) from pins x),
    'banner', (select coalesce(jsonb_agg(to_jsonb(x) order by (x.act ->> 'created_at')::timestamptz, x.play), '[]'::jsonb) from banner x),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('play', s.play, 'state', s.state, 'saved_at', s.saved_at)), '[]'::jsonb)
               from effect_state s where s.play in (select id from wanted)),
    'releases', (select coalesce(jsonb_agg(jsonb_build_object('play', r.play)), '[]'::jsonb)
                 from effect_releases r where r.play in (select id from wanted)),
    'tallies', (select coalesce(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb)
                from reaction_tallies t where t.act in (select id from marked)),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'character', r.character)), '[]'::jsonb)
             from my_reactions r where r.act in (select id from marked)),
    'reading', (select coalesce(jsonb_agg(jsonb_build_object('thread', r.thread, 'furthest_seq', r.furthest_seq)), '[]'::jsonb)
                from reading r where r.thread in (select id from threads)),
    'views', (select coalesce(jsonb_agg(jsonb_build_object('thread', v.thread, 'views', v.views)), '[]'::jsonb)
              from thread_view_counts v where v.thread in (select id from threads)),
    'characters', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
                     'profile', case when f.character is null then null else jsonb_build_object(
                       'title', f.title, 'signature', f.signature, 'avatar_square', f.avatar_square, 'avatar_portrait', f.avatar_portrait,
                       'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style, 'pronouns', f.pronouns) || profile_cosmetics(f.character) end)), '[]'::jsonb)
                   from characters_public c left join character_profiles f on f.character = c.id
                   where c.id in (select id from people where id is not null)),
    'presence', presence_box('board', p.board),
    'unread', my_alerts_unread())
  from b join p on p.board = b.id;
end;

-- my_characters_page (0125), its faces also carrying the cosmetics. Everything else as 0125 wrote it.
create or replace function my_characters_page() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select jsonb_build_object(
    'characters', coalesce((
      select jsonb_agg(
        to_jsonb(c) || jsonb_build_object(
          'face', (
            select to_jsonb(cp) || jsonb_build_object('profile', (
              select to_jsonb(p) || profile_cosmetics(p.character) from (
                select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
                from character_profiles r where r.character = cp.id) p))
            from characters_public cp where cp.id = c.id),
          'counts', (select to_jsonb(n) from (select k.character, k.posts, k.spins, k.cards from character_post_counts k where k.character = c.id) n),
          'standing', (select s.standing from current_standings s where s.character = c.id),
          'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from (
            select v.act, v.character, v.class, v.at, v.via, v.thread from class_reveals v where v.character = c.id) r), '[]'::jsonb),
          'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from (
            select u.act, u.character, u.at, u.was from turns_announced u where u.character = c.id) t), '[]'::jsonb))
        order by c.name)
      from my_characters c), '[]'::jsonb),
    'nextSettlementAt', next_settlement_at()
  );
end;

-- index_page (0143), its faces also carrying the cosmetics. Everything else as 0143 wrote it.
create or replace function index_page() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with bs as materialized (
    select b.id, b.slug, b.name, b.description, b.is_system, b.move_act, b.created_at,
           coalesce(c.threads, 0) as thread_count, l.id as last_thread, l.title as last_title, l.last_at, l.last_character
    from boards_now b
    left join board_counts c on c.board = b.id
    left join lateral (
      select t.id, t.title, t.last_at, t.last_character from thread_list t where t.board = b.id order by t.last_at desc limit 1
    ) l on true
  )
  select jsonb_build_object(
    'boards', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act,
                 'thread_count', b.thread_count, 'last_at', b.last_at, 'last_character', b.last_character, 'last_thread', b.last_thread, 'last_title', b.last_title)
               order by b.created_at, b.id), '[]'::jsonb) from bs b),
    'characters', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
                     'profile', case when f.character is null then null else jsonb_build_object(
                       'title', f.title, 'signature', f.signature, 'avatar_square', f.avatar_square, 'avatar_portrait', f.avatar_portrait,
                       'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style, 'pronouns', f.pronouns) || profile_cosmetics(f.character) end)), '[]'::jsonb)
                   from characters_public c left join character_profiles f on f.character = c.id
                   where c.id in (select b.last_character from bs b where b.last_character is not null)),
    'presence', presence_box('index', null),
    'unread', my_alerts_unread());
end;

-- boot (0145), its faces also carrying the cosmetics. Everything else as 0145 wrote it.
create or replace function boot() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select jsonb_build_object(
    'settings', (select s.settings from screen_settings s limit 1),
    'account', (select to_jsonb(whoami())),
    'preferences', (select to_jsonb(p) from (
      select a.theme, a.postbit, a.motion, a.smoke, a.contrast, a.text_size, a.tilt, a.effects, a.mode, a.cards_met, a.alerts_seen_at, a.settlement_seen, a.toasts, a.welcomed_at, a.tips, a.tips_seen
      from account_preferences a limit 1) p),
    'characters', coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from my_characters c), '[]'::jsonb),
    'faces', coalesce((
      select jsonb_agg(f.face order by f.name) from (
        select cp.name, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) || profile_cosmetics(p.character) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
            from character_profiles r where r.character = cp.id) p)) as face
        from characters_public cp where cp.id in (select m.id from my_characters m)) f), '[]'::jsonb),
    'wallet', (select to_jsonb(w) from (select mw.balance, mw.cap from my_wallet mw limit 1) w),
    'cards', coalesce((select jsonb_agg(to_jsonb(k) order by k.card) from (select mc.card, mc.held from my_cards mc) k), '[]'::jsonb),
    'boards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act,
        'thread_count', coalesce(bc.threads, 0), 'last_at', l.last_at, 'last_character', l.last_character, 'last_thread', l.id, 'last_title', l.title) order by b.created_at, b.id)
      from boards_now b
      left join board_counts bc on bc.board = b.id
      left join lateral (select t.id, t.title, t.last_at, t.last_character from thread_list t where t.board = b.id order by t.last_at desc limit 1) l on true), '[]'::jsonb),
    'admin', coalesce(is_admin(), false),
    'unread', case when whoami() is null then 0 else my_alerts_unread() end,
    'nextSettlementAt', next_settlement_at(),
    'lastSettledAt', (select s.ends_at from settlements s order by s.ends_at desc limit 1),
    'newestSettlement', (select s.ends_at from settlements s where s.id = (select max(l.settlement) from my_ledger l))
  );
end;
