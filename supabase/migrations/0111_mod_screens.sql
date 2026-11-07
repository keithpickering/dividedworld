-- The reads behind the Mod Bots' screens (the Mod Bots design, section 9; its plan, Task 13).
--
--   my_infractions, my_bans, my_reports, my_appeals   the player's own log lines: the infractions filed against, the bans laid on, the reports made and the appeals made by the
--                          CALLER'S characters (characters.owner = auth.uid()), and nothing of anyone else's. Each row says which Act did what (the Act's id), to which character
--                          of the player's, when, and how it ended, in the facts the log's plain words are written from. A report or an appeal says what became of its price
--                          (refunded, and why). They are the caller's own rows, so reading them proves nothing about anyone else's characters; no row names an account, an
--                          owner, a class or who reacted. Each is a view that reads the caller's characters first and probes the Acts by the indexes the warn bar, the reports
--                          and the appeals already have (acts_infractions, acts_bans, acts_reports_by_character, acts_by_character), so its cost is the caller's own history
--                          and never the instance's.
--   my_characters          (0074) also carries `banned_until` as its last column: when the character's ban ends, null while it is not banned (a public fact; the composer says so).
--   my_reports_left        (character, left): how many reports each of the caller's own characters may still make today (UTC), by open_report's own rule (a failed refund frees a slot).
--   beat_mod_name(board)   the public name of the Mod on a board's beat and the board's name, for the report form's "who judges it".
--   thread_page            (0108) each visit carries `ruling`, the verdict of the appeal heard on its infraction.
--   presence_box(kind, place)   (0104) a Mod with an open visit in a thread is listed in that thread's box, with the number of the post it is visiting (`visit_post`, its
--                          lowest where it has several). A visit is a public Act and a Mod is public, so this is computed from nothing private; the Mod need not have posted. A name
--                          the box lists twice (it posted, and it visits) is one name. An index of the thread's visits (acts_visits_by_thread, 0108) keeps the read to the thread's own.
--   moves_log              (0051) a Mod's moderation log also lists its visits, the reports it judged and the appeals it heard, each with how it ended: a visit's outcome
--                          (null while it is open), a report's verdict, an appeal's ruling. `kind` is 'visit', 'report' or 'appeal'; `params` carries the post's number and what the
--                          screen's plain words need. Public Acts only, as every other row.
--
-- Ways out. Nothing here adds a state; a view is a read. The report quota's number is a read of the one rule open_report keeps.

-- ------------------------------------------------------------------------------------------------------ my_characters ----

-- my_characters (0074), also saying when a character's ban ends (`banned_until`, null while it is not banned) as its last column, so the composer can say so without a read of its own.
-- A ban is a public Act and this is the caller's own characters, so it says nothing that a thread's postbit does not. The grants are as 0030 left them.
create or replace view my_characters as
  select c.id, c.name, h.class_key as class, h.started_at as class_since,
         case when t.at > now() then t.at end as turn_opens_at,
         c.debuted_at, c.debut_loudness, c.retired_at,
         p.class_key as pending_class, p.loudness as pending_loudness, p.show_from as pending_show_from, p.show_to as pending_show_to,
         case when p.character is not null then next_settlement_at(now()) end as takes_effect_at,
         exists (select 1 from presence_hidden x where x.character = c.id) as presence_hidden,
         h.due_at as class_due_at,
         banned_until(c.id) as banned_until
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

-- An infraction is found by the visit it came from, for a page's visits to carry the appeal's ruling.
create index acts_infractions_by_visit on acts ((payload ->> 'visit_act')) where kind = 'infraction';

-- thread_page (0108), each visit also carrying `ruling`: the verdict of the appeal heard on the infraction it filed (overturned, upheld, reduced or increased), null where none. A
-- public read of public Acts, so the post's notice can say a finding was overturned on appeal. Everything else as 0108 wrote it.
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
                      'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style)
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

-- ------------------------------------------------------------------------------------------------ the beat Mod's name ----

-- Who judges a board's reports: the public name of the Mod on its beat (and the board's name), or null where no Mod is on staff. A Mod's beat is public game knowledge, the same for
-- everyone, and nothing here reads an owner.
create function beat_mod_name(in_board uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('mod', c.name, 'board', b.name)
  from boards_now b
  join characters c on c.staff = beat_of(b.id) and c.debuted_at is not null and c.retired_at is null
  where b.id = beat_mod_name.in_board
$$;
revoke execute on function beat_mod_name(uuid) from public, anon;
grant execute on function beat_mod_name(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------ reports left today ----

-- How many reports each of the caller's own characters may still make today (UTC): the instance's `reportsPerDay` less the day's report Acts of that character, none counted for a
-- report refunded for a failed judgment (open_report's own rule). The caller's own characters only, so it says nothing about anyone else's quota.
create view my_reports_left as
  select c.id as character,
         greatest(0, coalesce((select (s.value ->> 'reportsPerDay')::integer from settings s where s.key = 'modBots'), 3) - (
           select count(*) from acts r
           where r.kind = 'report' and r.character = c.id and r.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
             and not exists (select 1 from report_refunds f where f.report_act = r.id and f.why = 'failed')))::integer as "left"
  from characters c
  where c.owner = auth.uid();
revoke all on my_reports_left from public, anon, authenticated;
grant select on my_reports_left to authenticated;

-- ------------------------------------------------------------------------------------------------------- the log views ----

-- A function a view calls is executed with the privileges of whoever reads the view (0104's note on warn_points), so the two the log's views read are granted to signed-in players.
-- Each answers a public fact about any id, the same for everyone: an infraction is a public Act, its rule is the rule's own words, and a relief is what a public ruling took off.
grant execute on function punishment_words(uuid) to authenticated;
grant execute on function infraction_relief(uuid) to authenticated;

-- The infractions filed against the caller's characters: the Act, the character, when, the band and the points frozen on it, the rule in the glass's words, the Mod that filed it,
-- the post it is about (and its number), when the points drop off, how many an appeal took off, and when a ban emptied the bar (null: none has since).
create view my_infractions as
  select i.id as infraction, c.id as character, i.created_at as at, i.payload ->> 'band' as band, (i.payload ->> 'points')::integer as points,
         (i.payload ->> 'rule_number')::integer as rule_number, punishment_words(i.id) as rule,
         (select m.name from characters m where m.staff = i.payload ->> 'staff') as mod_name,
         (i.payload ->> 'about_act')::uuid as post, (select p.seq from acts p where p.id = (i.payload ->> 'about_act')::uuid) as post_seq, i.thread,
         (i.payload ->> 'expires_at')::timestamptz as expires_at, infraction_relief(i.id) as relief,
         (select min(b.created_at) from acts b where b.kind = 'ban' and b.payload ->> 'character' = c.id::text and b.created_at > i.created_at) as emptied_at
  from characters c
  join acts i on i.kind = 'infraction' and i.payload ->> 'character' = c.id::text
  where c.owner = auth.uid();

-- The bans laid on the caller's characters: the Act, the character, when, how many days, when it ends now (an appeal's ruling read in place of the ban's own end), the infraction that
-- filled the bar and its rule.
create view my_bans as
  select b.id as ban, c.id as character, b.created_at as at, (b.payload ->> 'days')::integer as days,
         coalesce((select (r.payload ->> 'until')::timestamptz from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
                   where a.kind = 'appeal' and a.target_act_id = b.id and r.payload ? 'until' limit 1),
                  (b.payload ->> 'until')::timestamptz) as until,
         (b.payload ->> 'infraction_act')::uuid as infraction, punishment_words((b.payload ->> 'infraction_act')::uuid) as rule, b.thread
  from characters c
  join acts b on b.kind = 'ban' and b.payload ->> 'character' = c.id::text
  where c.owner = auth.uid();

-- The reports the caller's characters made: the Act, the character, when, the post and its number, the verdict and when it came (null: none yet), the Mod that gave it and what became
-- of the price (`refund`: 'failed' or 'stale' when it went back, else null).
create view my_reports as
  select r.id as report, c.id as character, r.created_at as at, r.target_act_id as post, (select p.seq from acts p where p.id = r.target_act_id) as post_seq, r.thread,
         v.payload ->> 'verdict' as verdict, v.created_at as verdict_at, (select m.name from characters m where m.id = v.character) as mod_name,
         (select f.why from report_refunds f where f.report_act = r.id) as refund
  from characters c
  join acts r on r.kind = 'report' and r.character = c.id
  left join acts v on v.kind = 'report_verdict' and v.target_act_id = r.id
  where c.owner = auth.uid();

-- The appeals the caller's characters made: the Act, the character, when, the punishment (an infraction or a ban) and its post's number, the ruling and when it came (null: none
-- yet), the points it moved, the staff member who heard it and what became of the price.
create view my_appeals as
  select a.id as appeal, c.id as character, a.created_at as at, a.target_act_id as punishment, p.kind as punishment_kind,
         (select x.seq from acts x where x.id = case when p.kind = 'infraction' then (p.payload ->> 'about_act')::uuid else (select (i.payload ->> 'about_act')::uuid from acts i where i.id = (p.payload ->> 'infraction_act')::uuid) end) as post_seq,
         a.thread, r.payload ->> 'verdict' as verdict, r.created_at as ruled_at, (r.payload ->> 'points_delta')::integer as points_delta,
         (select m.name from characters m where m.id = r.character) as hearer_name,
         (select f.why from appeal_refunds f where f.appeal_act = a.id) as refund
  from characters c
  join acts a on a.kind = 'appeal' and a.character = c.id
  join acts p on p.id = a.target_act_id
  left join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
  where c.owner = auth.uid();

revoke all on my_infractions, my_bans, my_reports, my_appeals from public, anon, authenticated;
grant select on my_infractions, my_bans, my_reports, my_appeals to authenticated;

-- ------------------------------------------------------------------------------------------------------------ presence ----

-- presence_box (0104), a thread's box also listing a Mod with an open visit there, with the number of the post it visits. Everything else as 0104 wrote it.
create or replace function presence_box(in_kind text, in_place uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  win interval := span_interval(setting('presenceWindow'));
  cap integer := (setting('presenceNames') #>> '{}')::integer;
  at_board uuid;
  shown jsonb;
  total integer;
begin
  if in_kind = 'thread' then
    select t.board into at_board from threads t where t.id = in_place;
    if at_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  elsif in_kind = 'board' then
    select b.id into at_board from boards b where b.id = in_place;
    if at_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  elsif in_kind is distinct from 'index' then
    raise exception 'there is no such place to browse' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;

  -- The box, read by one statement per kind of place (0041). A board's box reads a staff character's rows (one per thread it posted in)
  -- as one name; the index never lists a staff character. A thread's box also lists a Mod on an open visit in it, once.
  if in_kind = 'thread' then
    with seen as (
      select l.id, l.name, l.staff, l.place_since, null::integer as visit_post from presence_listed l
      where l.place = in_place and l.seen_at >= now() - win
      union all
      select m.id, m.name, true, v.created_at, p.seq
      from acts v
      join visits_open o on o.visit_act = v.id
      join acts p on p.id = o.post
      join characters m on m.id = v.character
      where v.kind = 'visit' and v.thread = in_place and m.staff is not null and m.staff_kind is distinct from 'developer' and m.debuted_at is not null and m.retired_at is null),
    one as (
      select s.id, s.name, bool_or(s.staff) as staff, min(s.place_since) as place_since, min(s.visit_post) as visit_post from seen s group by s.id, s.name),
    f as (select * from one order by one.place_since, one.id limit cap)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff, 'banned_until', banned_until(f.id))
                                      || case when f.visit_post is not null then jsonb_build_object('visit_post', f.visit_post) else '{}'::jsonb end
                                      order by f.place_since, f.id), '[]'::jsonb) from f),
           (select count(*) from one)
      into shown, total;
  elsif in_kind = 'board' then
    with b as (
      select l.id, l.name, l.staff, min(l.place_since) as place_since from presence_listed l
      where l.board = in_place and l.seen_at >= now() - win group by l.id, l.name, l.staff),
    f as (select * from b order by b.place_since, b.id limit cap)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff, 'banned_until', banned_until(f.id)) order by f.place_since, f.id), '[]'::jsonb) from f),
           (select count(*) from b)
      into shown, total;
  else
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', false, 'banned_until', banned_until(f.id)) order by f.online_since, f.id), '[]'::jsonb)
            from (select l.id, l.name, l.online_since from presence_listed l
                  where not l.staff and l.seen_at >= now() - win order by l.online_since, l.id limit cap) f),
           (select count(*) from presence_listed l where not l.staff and l.seen_at >= now() - win)
      into shown, total;
  end if;
  return jsonb_build_object('names', shown, 'others', greatest(0, total - jsonb_array_length(shown)));
end $$;

-- ------------------------------------------------------------------------------------------------------- moves_log ----

-- moves_log (0051), also listing a staff member's visits, the reports it judged and the appeals it heard (columns as 0051 wrote them; only rows are added). For these `ended_why` says
-- how it ended: a visit's outcome (null while it is open), a report's verdict, an appeal's ruling; `ended_at` is when; `params` has the post's number and the plain facts the screen says.
create or replace view moves_log as
  select a.id, c.staff, a.payload ->> 'kind' as kind, a.payload -> 'params' as params, a.payload -> 'demand' as demand,
         (a.payload ->> 'expires_at')::timestamptz as expires_at, a.thread, a.created_at as at,
         e.payload ->> 'why' as ended_why, e.payload ->> 'by' as ended_by, e.created_at as ended_at,
         k.staff as kept_by, k.at as kept_at
  from characters c
  cross join lateral (select x.* from acts x where x.character = c.id and x.kind = 'move') a
  left join acts e on e.kind = 'move_end' and e.target_act_id = a.id
  left join lateral (
    select kc.staff, ka.created_at as at from acts ka join characters kc on kc.id = ka.character
    where ka.kind = 'move_keep' and ka.target_act_id = a.id order by ka.created_at desc, ka.id desc limit 1
  ) k on true
  where c.staff is not null
  union all
  select v.id, c.staff, 'visit'::text, jsonb_build_object('post', p.seq, 'rule', v.payload #>> '{charges,0,rule}', 'rule_number', v.payload #> '{charges,0,rule_number}', 'band', v.payload #>> '{charges,0,band}', 'cause', v.payload #>> '{charges,0,cause}'),
         null::jsonb, (v.payload ->> 'ends_at')::timestamptz, v.thread, v.created_at,
         e.payload ->> 'outcome', null::text, e.created_at, null::text, null::timestamptz
  from characters c
  join acts v on v.character = c.id and v.kind = 'visit'
  join acts p on p.id = v.target_act_id
  left join acts e on e.kind = 'visit_end' and e.target_act_id = v.id
  where c.staff is not null
  union all
  select d.id, c.staff, 'report'::text, jsonb_build_object('post', p.seq, 'verdict', d.payload ->> 'verdict'),
         null::jsonb, null::timestamptz, d.thread, d.created_at,
         d.payload ->> 'verdict', null::text, d.created_at, null::text, null::timestamptz
  from characters c
  join acts d on d.character = c.id and d.kind = 'report_verdict'
  join acts r on r.id = d.target_act_id
  join acts p on p.id = r.target_act_id
  where c.staff is not null
  union all
  select u.id, c.staff, 'appeal'::text,
         jsonb_build_object('post', (select x.seq from acts x where x.id = case when pu.kind = 'infraction' then (pu.payload ->> 'about_act')::uuid else (select (i.payload ->> 'about_act')::uuid from acts i where i.id = (pu.payload ->> 'infraction_act')::uuid) end),
                            'punishment', pu.kind, 'verdict', u.payload ->> 'verdict', 'points_delta', u.payload -> 'points_delta'),
         null::jsonb, null::timestamptz, u.thread, u.created_at,
         u.payload ->> 'verdict', null::text, u.created_at, null::text, null::timestamptz
  from characters c
  join acts u on u.character = c.id and u.kind = 'appeal_ruling'
  join acts ap on ap.id = u.target_act_id
  join acts pu on pu.id = ap.target_act_id
  where c.staff is not null;
grant select on moves_log to anon, authenticated;
