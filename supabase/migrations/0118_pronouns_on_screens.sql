-- Pronouns on the screens (docs/plans/2026-11-05-pronouns-design.md, as amended by docs/plans/2026-11-07-pronouns-design.md, section 5; docs/plans/2026-11-07-pronouns-plan.md, Task 4):
-- every read that hands a screen a character's profile hands its `pronouns` too, and where a read hands a screen a staff member by name alone, its pronouns go beside the name.
-- The column is public, as a title is: the API role may read it (0019 grants the profile columns one by one), and each read stays as it was, security invoker or definer.
--
-- Remade here, each at its latest definition (my_characters (0111) also says the pronouns of the character, last) and otherwise as written there: thread_page (0111; a visit's Mod is a character in `people`, so its profile carries its set), board_page
-- and index_page (0095), profile_page and record_page (0104), boot (0115, with the account's `mode`), beat_mod_name (0111, beside `mod`), admin_queue (0102: `bossPronouns` beside each `boss`, the roster's and
-- the to-dos' names), boss_roster_names (0082) and updates_read (0062, the persona that wrote an update). The grants of every function stay as they were.

grant select (pronouns) on character_profiles to authenticated;

-- my_characters (0111), also saying the character's pronouns (a public fact about it, last; null while it has no profile row, which a client reads as the engine's it/its). The grants are as before.
create or replace view my_characters as
  select c.id, c.name, h.class_key as class, h.started_at as class_since,
         case when t.at > now() then t.at end as turn_opens_at,
         c.debuted_at, c.debut_loudness, c.retired_at,
         p.class_key as pending_class, p.loudness as pending_loudness, p.show_from as pending_show_from, p.show_to as pending_show_to,
         case when p.character is not null then next_settlement_at(now()) end as takes_effect_at,
         exists (select 1 from presence_hidden x where x.character = c.id) as presence_hidden,
         h.due_at as class_due_at,
         banned_until(c.id) as banned_until,
         (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns
  from characters c
  cross join lateral (select x.class_key, x.started_at, x.due_at from class_history x where x.character = c.id order by x.started_at desc limit 1) h
  cross join lateral (
    select (select max(x.started_at) from class_history x
            where x.character = c.id and x.started_at > (select min(f.started_at) from class_history f where f.character = c.id))
           + span_interval((select s.value from settings s where s.key = 'turnCooldown')) as at
  ) t
  left join pending_turns p on p.character = c.id
  where c.owner = auth.uid();

-- ----------------------------------------------------------------------------------------------------- thread_page ----

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
          'warn_points', c.warn_points, 'banned_until', c.banned_until),
        'profile', (select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square,
                      'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns)
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

-- board_page

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
                       'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style, 'pronouns', f.pronouns) end)), '[]'::jsonb)
                   from characters_public c left join character_profiles f on f.character = c.id
                   where c.id in (select id from people where id is not null)),
    'presence', presence_box('board', p.board),
    'unread', my_alerts_unread())
  from b join p on p.board = b.id;
end;

-- index_page

create or replace function index_page() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with bs as materialized (
    select b.id, b.slug, b.name, b.description, b.is_system, b.move_act, b.created_at,
           coalesce(c.threads, 0) as thread_count, l.id as last_thread, l.last_at, l.last_character
    from boards_now b
    left join board_counts c on c.board = b.id
    left join lateral (
      select t.id, t.last_at, t.last_character from thread_list t where t.board = b.id order by t.last_at desc limit 1
    ) l on true
  )
  select jsonb_build_object(
    'boards', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act,
                 'thread_count', b.thread_count, 'last_at', b.last_at, 'last_character', b.last_character, 'last_thread', b.last_thread)
               order by b.created_at, b.id), '[]'::jsonb) from bs b),
    'characters', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
                     'profile', case when f.character is null then null else jsonb_build_object(
                       'title', f.title, 'signature', f.signature, 'avatar_square', f.avatar_square, 'avatar_portrait', f.avatar_portrait,
                       'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style, 'pronouns', f.pronouns) end)), '[]'::jsonb)
                   from characters_public c left join character_profiles f on f.character = c.id
                   where c.id in (select b.last_character from bs b where b.last_character is not null)),
    'presence', presence_box('index', null),
    'unread', my_alerts_unread());
end;

-- profile_page

create or replace function profile_page(in_character uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with c as (
    select id, name, joined, staff, office, warn_points, banned_until from characters_public where id = in_character
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
    'profile', (select to_jsonb(p) from (
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

-- record_page

create or replace function record_page(in_character uuid, in_kind text, in_page integer) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with c as (
    select id, name, joined, staff, office, warn_points, banned_until from characters_public where id = in_character
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
    'profile', (select to_jsonb(p) from (
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

-- boot (0115's, which carries the account's `mode`), also handing each of the player's own faces its pronouns.

create or replace function boot() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select jsonb_build_object(
    'settings', (select s.settings from screen_settings s limit 1),
    'account', (select to_jsonb(whoami())),
    'preferences', (select to_jsonb(p) from (
      select a.theme, a.postbit, a.motion, a.smoke, a.contrast, a.text_size, a.tilt, a.mode, a.cards_met, a.alerts_seen_at, a.settlement_seen, a.toasts, a.welcomed_at, a.tips, a.tips_seen
      from account_preferences a limit 1) p),
    'characters', coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from my_characters c), '[]'::jsonb),
    'faces', coalesce((
      select jsonb_agg(f.face order by f.name) from (
        select cp.name, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
            from character_profiles r where r.character = cp.id) p)) as face
        from characters_public cp where cp.id in (select m.id from my_characters m)) f), '[]'::jsonb),
    'wallet', (select to_jsonb(w) from (select mw.balance, mw.cap from my_wallet mw limit 1) w),
    'cards', coalesce((select jsonb_agg(to_jsonb(k) order by k.card) from (select mc.card, mc.held from my_cards mc) k), '[]'::jsonb),
    'boards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act,
        'thread_count', coalesce(bc.threads, 0), 'last_at', l.last_at, 'last_character', l.last_character, 'last_thread', l.id) order by b.created_at, b.id)
      from boards_now b
      left join board_counts bc on bc.board = b.id
      left join lateral (select t.id, t.last_at, t.last_character from thread_list t where t.board = b.id order by t.last_at desc limit 1) l on true), '[]'::jsonb),
    'admin', coalesce(is_admin(), false),
    'unread', case when whoami() is null then 0 else my_alerts_unread() end,
    'nextSettlementAt', next_settlement_at(),
    'lastSettledAt', (select s.ends_at from settlements s order by s.ends_at desc limit 1),
    'newestSettlement', (select s.ends_at from settlements s where s.id = (select max(l.settlement) from my_ledger l))
  );
end;

-- beat_mod_name (0111), also handing the Mod's pronouns beside its name. The signature and the return type are as they were, so the function is replaced and its grant stands; both
-- are stated again.
create or replace function beat_mod_name(in_board uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('mod', c.name, 'pronouns', (select p.pronouns from character_profiles p where p.character = c.id), 'board', b.name)
  from boards_now b
  join characters c on c.staff = beat_of(b.id) and c.debuted_at is not null and c.retired_at is null
  where b.id = beat_mod_name.in_board
$$;
revoke execute on function beat_mod_name(uuid) from public, anon;
grant execute on function beat_mod_name(uuid) to authenticated;

-- boss_roster_names (0082), also handing each persona's pronouns.
create or replace function boss_roster_names() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform only_admins('reads the Boss list');
  return (select coalesce(jsonb_agg(jsonb_build_object('staff', c.staff, 'name', c.name, 'pronouns', (select p.pronouns from character_profiles p where p.character = c.id), 'office', o.office) order by r.ord), '[]'::jsonb)
          from unnest(boss_roster()) with ordinality r(staff, ord)
          join characters c on c.staff = r.staff join staff_office_now o on o.staff = r.staff);
end $$;

-- admin_queue (0102), also handing the Boss's pronouns beside every `boss` name (`bossPronouns`), the roster's and the to-dos' (`bossPronouns`, `outgoingPronouns`). A name with no
-- character behind it (a nomination's Boss who is gone) has none. Everything else as 0102 wrote it.
create or replace function admin_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cap constant integer := 100;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  win constant timestamptz := now() - interval '30 days';
  waiting jsonb; waiting_more boolean;
  in_force jsonb; in_force_more boolean;
  staff_cards jsonb; staff_cards_more boolean;
  ended jsonb; ended_more boolean;
  roster jsonb;
  todos jsonb;
  latest_update timestamptz;
begin
  perform only_admins('reads the queue');

  -- The Bosses that can take a nomination's seat, by the roster's own rule and order (boss_roster): not retired, debuted.
  select coalesce(jsonb_agg(jsonb_build_object('staff', c.staff, 'name', c.name, 'pronouns', (select p.pronouns from character_profiles p where p.character = c.id)) order by r.ord), '[]'::jsonb) into roster
  from unnest(boss_roster()) with ordinality r(staff, ord) join characters c on c.staff = r.staff;

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into waiting, waiting_more from (
    select row_number() over (order by q.go_live_at, q.id) as n,
           jsonb_build_object('id', q.id, 'staff', q.staff, 'boss', (select c.name from characters c where c.staff = q.staff),
             'bossPronouns', (select p.pronouns from characters c join character_profiles p on p.character = c.id where c.staff = q.staff), 'kind', q.kind,
             'params', q.params, 'demand', q.demand, 'why', q.why, 'goLiveAt', q.go_live_at, 'expiresAt', q.expires_at, 'structural', q.structural,
             'failedAt', q.failed_at, 'failure', q.failure, 'replacedAt', q.replaced_at,
             'adminDescription', q.admin_description,
             'boardName', case when q.kind = 'renameBoard' and lower(q.params ->> 'board') ~ uuid_re
                               then (select b.name from boards_now b where b.id = (q.params ->> 'board')::uuid) end) as j
    from queued_moves q where q.landed_act is null and q.held_at is null and q.refused_at is null
    order by q.go_live_at, q.id limit cap + 1
  ) x;

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into in_force, in_force_more from (
    select row_number() over (order by a.created_at desc, a.id) as n,
           jsonb_build_object('act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name, 'bossPronouns', (select p.pronouns from character_profiles p where p.character = c.id), 'kind', a.payload ->> 'kind', 'params', a.payload -> 'params',
             'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at, 'expiresAt', a.payload -> 'expires_at',
             'progress', case when o.progress is null then jsonb_build_object('checkedAt', null)
                              else o.progress || jsonb_build_object('checkedAt', o.checked_at) end) as j
    from open_moves o
    join acts a on a.id = o.move_act
    left join characters c on c.id = a.character
    left join queued_moves q on q.landed_act = a.id
    order by a.created_at desc, a.id limit cap + 1
  ) x;

  -- The Mod Bots' cards (Task 7): the face-up plays of staff characters in the last 30 days that are still in force: not caught, not worn
  -- off (by the play's own end or its reach's), not ended by an admin. A Set is a `set` Act, never a `card`, so a face-down card is not
  -- here until it springs; its strike is a `card` Act and is. Per staff character a probe of acts_card_plays (character, created_at desc)
  -- reads only that character's plays in the window, newest first and cut at cap + 1 inside the probe, so the cost is the staff roster
  -- times cap and never the history of Acts or the players' plays. The names are public ones (the card's, the persona's, the post
  -- author's or the target the play named); nothing private is read.
  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into staff_cards, staff_cards_more from (
    select row_number() over (order by k.created_at desc, k.id) as n,
           jsonb_build_object('play', k.id, 'card', k.payload ->> 'card', 'cardName', (select ck.name from card_kinds ck where ck.key = k.payload ->> 'card'),
             'staff', c.staff, 'persona', c.name,
             'targetName', coalesce(k.payload ->> 'targetName', (select tc.name from acts pa join characters tc on tc.id = pa.character where pa.id = k.target_act_id)),
             'thread', k.thread, 'threadTitle', (select th.title from threads th where th.id = k.thread), 'at', k.created_at) as j
    from characters c
    cross join lateral (
      select p.* from acts p
      where p.character = c.id and p.kind = 'card' and p.created_at >= win
        and not (p.payload ? 'caught')
        and (p.payload ->> 'ends' is null or (p.payload ->> 'ends')::timestamptz > now())
        and not exists (select 1 from play_reach r where r.play = p.id and r.ends_at <= now())
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = p.id)
      order by p.created_at desc, p.id desc limit cap + 1
    ) k
    where c.staff is not null
    order by k.created_at desc, k.id limit cap + 1
  ) x;

  -- Ended and held, merged: each side cut at cap + 1 first, so the merge never reads more than 2 * (cap + 1) rows.
  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into ended, ended_more from (
    select row_number() over (order by u.at desc, u.tie) as n, u.j from (
      (select e.created_at as at, e.id::text as tie,
              jsonb_build_object('how', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at, 'act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name, 'bossPronouns', (select p.pronouns from character_profiles p where p.character = c.id),
                'kind', a.payload ->> 'kind', 'params', a.payload -> 'params', 'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at) as j
       from acts e
       join acts a on a.id = e.target_act_id
       left join characters c on c.id = a.character
       left join queued_moves q on q.landed_act = a.id
       where e.kind = 'move_end' and e.created_at >= win
       order by e.created_at desc, e.id desc limit cap + 1)
      union all
      (select e.created_at, e.id::text,
              jsonb_build_object('how', 'reversed', 'by', 'admin', 'at', e.created_at, 'act', p.id, 'id', null, 'staff', c.staff, 'boss', c.name, 'bossPronouns', (select p.pronouns from character_profiles p where p.character = c.id),
                'kind', 'card', 'params', '{}'::jsonb, 'demand', null, 'why', null, 'landedAt', p.created_at,
                'card', coalesce((select ck.name from card_kinds ck where ck.key = p.payload ->> 'card'), p.payload ->> 'card'))
       from acts e
       join acts p on p.id = e.target_act_id
       left join characters c on c.id = p.character
       where e.kind = 'card_end' and e.created_at >= win
       order by e.created_at desc, e.id desc limit cap + 1)
      union all
      (select h.held_at, 'q' || h.id::text,
              jsonb_build_object('how', 'held', 'by', 'admin', 'at', h.held_at, 'act', null, 'id', h.id, 'staff', h.staff, 'boss', c.name, 'bossPronouns', (select p.pronouns from character_profiles p where p.character = c.id),
                'kind', h.kind, 'params', h.params, 'demand', h.demand, 'why', h.why, 'landedAt', null)
       from queued_moves h
       left join characters c on c.staff = h.staff
       where h.held_at is not null and h.held_at >= win
       order by h.held_at desc, h.id desc limit cap + 1)
      union all
      (select h.refused_at, 'r' || h.id::text,
              jsonb_build_object('how', 'refused', 'by', 'tick', 'at', h.refused_at, 'act', null, 'id', h.id, 'staff', h.staff, 'boss', c.name, 'bossPronouns', (select p.pronouns from character_profiles p where p.character = c.id),
                'kind', h.kind, 'params', h.params, 'demand', h.demand, 'why', h.why, 'landedAt', null, 'reason', h.failure)
       from queued_moves h
       left join characters c on c.staff = h.staff
       where h.refused_at is not null and h.held_at is null and h.refused_at >= win
       order by h.refused_at desc, h.id desc limit cap + 1)
    ) u order by u.at desc, u.tie limit cap + 1
  ) x;

  -- The to-dos (the staff roster design, section 11): each handover that changed the Boss, until an update is posted after it landed or an
  -- admin dismisses it. "An update after it" is one read of the newest update (the acts_updates index, 0062) against each handover's instant.
  latest_update := (select a.created_at from acts a where a.kind = 'update' order by a.created_at desc, a.id desc limit 1);
  select coalesce(jsonb_agg(jsonb_build_object(
           'season', t.number, 'boss', t.boss, 'bossName', bc.name, 'bossPronouns', (select p.pronouns from character_profiles p where p.character = bc.id),
           'bossWas', (select o.office from staff_offices o where o.staff = t.boss and o.at <= t.landed_at order by o.id desc limit 1),
           'outgoing', t.outgoing, 'outgoingName', oc.name, 'outgoingPronouns', (select p.pronouns from character_profiles p where p.character = oc.id), 'outgoingOffice', (select n.office from staff_office_now n where n.staff = t.outgoing),
           'how', h.how, 'landedAt', t.landed_at) order by t.landed_at desc, t.number desc), '[]'::jsonb) into todos
  from season_boss_changes t
  join season_handovers h on h.season = t.season
  join characters bc on bc.staff = t.boss
  left join characters oc on oc.staff = t.outgoing
  where (latest_update is null or latest_update <= t.landed_at)
    and not exists (select 1 from handover_dismissals d where d.season = t.season);

  return jsonb_build_object('cap', cap, 'waiting', waiting, 'inForce', in_force, 'staffCards', staff_cards, 'ended', ended, 'roster', roster, 'todos', todos,
    'more', jsonb_build_object('waiting', waiting_more, 'inForce', in_force_more, 'staffCards', staff_cards_more, 'ended', ended_more));
end $$;

-- updates_read (0062), also carrying the pronouns of the persona that wrote the update, last. `updates` and post_update read it and hand the column on.
create or replace view updates_read as
  select a.id as act, a.thread, a.character, c.name, coalesce(p.title, '') as tagline,
         (select s.value #>> '{}' from settings s where s.key = 'developerAvatar') as avatar,
         a.payload ->> 'title' as title, a.payload ->> 'body' as body, a.payload -> 'changes' as changes, a.created_at as at, a.seq,
         p.pronouns
  from acts a join characters c on c.id = a.character left join character_profiles p on p.character = c.id
  where a.kind = 'update';

-- ------------------------------------------------------------------------------------------------ screen_settings ----

-- screen_settings (0116's, which shows the two search settings), also holding the instance's default pronouns (the setting `pronouns`, 0117): the New character screen starts its picker on them, and boot carries the view whole.
-- A setting, public. The view is as written there otherwise; its grants stay as they were.
create or replace view screen_settings as
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
         || jsonb_build_object('cardEconomy', (
              select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
              from settings x cross join lateral jsonb_each(x.value) e
              where x.key = 'economy' and jsonb_typeof(x.value) = 'object'
                and e.key in (select k.price_setting from card_kinds k union select unnest(k.reads) from card_kinds k))) as settings
  from settings s
  where s.key in ('postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime',
                  'turnCooldown', 'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength', 'cardSettings',
                  'presencePollSeconds', 'presenceWindow', 'toastDefaults', 'economy', 'staffGroup', 'searchLanguage', 'searchRankPool', 'pronouns');
