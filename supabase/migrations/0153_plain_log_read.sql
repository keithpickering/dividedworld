-- What the log's read carries (docs/plans/2026-11-11-plain-words-plan.md, Task 7).
--
-- 1. An appeal's ruling says which office heard it. write_staff_act (0142) stamps `office` on an `appeal_ruling` as it does on a `move`, and acts_appeal_payload (0109) lets the
--    key through (an office is one of boss and mod). A ruling written before this carries none, and reads as none: no default stands in for it, and no Act is updated.
-- 2. my_group_moves (0134) gains `ruled_office`, the latest ruling's own stamp (null for a ruling without one, and for a move with no ruling). `office` stays the maker's.
-- 3. my_bans (0111) gains `ruling` (the verdict of the latest ruling on the ban's appeals, null with none) and `own_until` (the ban's own end), and its `until` reads the latest ruling that
--    carries one, newest first, as the other readers of a ruling do. Both read the same appeal and ruling rows `until` already reads, through the indexes on an appeal's target.
-- 4. my_caught (0054) loses `bought_price`: the log quotes what the cast cost, never the machine's price of the card. A view's column cannot be dropped in place, and log_page's
--    body depends on the view, so log_page is dropped, the view made again with its grants, and log_page made again, as 0149 wrote it with the three changes: no `bought_price`
--    in `caught`, and `ruling` and `own_until` in `bans`, `ruled_office` in `groupMoves`.
-- Masks: every new column is read from rows the player's own log already reads (their characters' bans and group moves, and the rulings on them, public Acts); none says who owns
-- another character or who reacted. Ways out: reads only.

-- ---- 1. the ruling's stamp ----
alter table acts drop constraint acts_appeal_payload;
alter table acts add constraint acts_appeal_payload check (
  case kind
    when 'appeal' then payload - 'plea' = '{}'::jsonb
      and jsonb_typeof(payload -> 'plea') = 'string' and char_length(payload ->> 'plea') between 1 and 1000
    when 'appeal_ruling' then payload - 'appeal_act' - 'verdict' - 'points_delta' - 'line' - 'until' - 'infraction_act' - 'office' = '{}'::jsonb
      and jsonb_typeof(payload -> 'appeal_act') = 'string' and payload ->> 'appeal_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and payload ->> 'verdict' in ('overturned', 'upheld', 'reduced', 'increased')
      and jsonb_typeof(payload -> 'points_delta') = 'number' and payload ->> 'points_delta' ~ '^-?[0-9]{1,9}$'
      and jsonb_typeof(payload -> 'line') = 'string' and char_length(payload ->> 'line') <= 280
      and (not payload ? 'until' or jsonb_typeof(payload -> 'until') = 'string')
      and (not payload ? 'infraction_act' or (jsonb_typeof(payload -> 'infraction_act') = 'string' and payload ->> 'infraction_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
      and (not payload ? 'office' or payload ->> 'office' in ('boss', 'mod'))
    else true
  end is true);

-- ---- write_staff_act ----
-- write_staff_act (0142), also stamping an appeal's ruling with the office that heard it. Everything else as 0142 wrote it.
create or replace function write_staff_act(staff_key text, kind text, thread uuid, target uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  written uuid;
  held text;
  stamped jsonb := payload;
  quoting boolean := kind = 'post' and target is not null;
  locked uuid[];
  sprung jsonb;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if whose = 'developer' then
    raise exception 'the developer speaks only through post_update, by an admin' using errcode = '42501';
  end if;
  if kind is null or kind not in ('post', 'spin', 'card', 'edit', 'move', 'move_keep', 'visit', 'visit_join', 'report_verdict', 'appeal_ruling') then
    raise exception 'a staff character posts, spins, plays a card, edits, moves, keeps a move, visits or gives a verdict or a ruling, not %', coalesce(kind, 'nothing') using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'an Act''s payload is an object' using errcode = '22023'; end if;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  -- A persona that has not debuted writes nothing, and a benched one is silent (0082).
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then
    raise exception 'a % persona writes nothing', held using errcode = '55000';
  end if;
  -- A move says which office made it, and an appeal's ruling which office heard it, as the office stood when it landed.
  if kind in ('move', 'appeal_ruling') and held in ('boss', 'mod') and not (payload ? 'office') then
    stamped := payload || jsonb_build_object('office', held);
  end if;
  -- A pool post that quotes: the quoted post's back, the thread and the count rows, in the lock order, before the insert.
  if quoting then locked := lock_for_quote(who, write_staff_act.thread, target); end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (who, kind, write_staff_act.thread, target, stamped) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  if quoting then sprung := spring_traps('quote', target, written, held => locked); end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

-- ---- my_group_moves ----
-- my_group_moves (0134), also answering `ruled_office`: the latest ruling's own stamp, null for one written without. Its columns are as 0134 wrote them, the new one last.
create or replace view my_group_moves with (security_invoker = true) as
  select m.id as move, c.id as character, m.created_at as at, m.thread, m.seq, m.payload #>> '{params,group}' as "group",
         case when jsonb_typeof(m.payload #> '{params,board}') = 'string' then (m.payload #>> '{params,board}')::uuid end as board,
         (select b.name from boards_now b where b.id = case when jsonb_typeof(m.payload #> '{params,board}') = 'string' then (m.payload #>> '{params,board}')::uuid end) as board_name,
         move_expires_at(m.id) as expires_at, case when jsonb_typeof(m.payload -> 'expires_at') = 'string' then (m.payload ->> 'expires_at')::timestamptz end as landed_until,
         case when jsonb_typeof(m.payload #> '{params,checkAt}') = 'string' then (m.payload #>> '{params,checkAt}')::timestamptz end as check_at,
         m.payload #>> '{demand,kind}' as demand,
         coalesce(nullif(m.payload ->> 'office', ''), 'boss') as office,
         e.payload ->> 'why' as ended_why, e.payload ->> 'by' as ended_by, e.created_at as ended_at,
         r.payload ->> 'verdict' as ruling, r.created_at as ruled_at,
         case when jsonb_typeof(r.payload -> 'until') = 'string' then (r.payload ->> 'until')::timestamptz end as ruled_until,
         nullif(r.payload ->> 'office', '') as ruled_office
  from characters c
  join acts m on m.kind = 'move' and m.payload ->> 'kind' = 'conferGroup' and m.payload #>> '{params,character}' = c.id::text
  left join acts e on e.kind = 'move_end' and e.target_act_id = m.id
  left join lateral (
    select ru.* from acts ap join acts ru on ru.kind = 'appeal_ruling' and ru.target_act_id = ap.id
    where ap.kind = 'appeal' and ap.target_act_id = m.id order by ru.created_at desc, ru.id desc limit 1
  ) r on true
  where c.owner = auth.uid();

-- ---- my_bans ----
-- my_bans (0111), also answering the verdict of the latest ruling on the ban's appeals (`ruling`) and the ban's own end (`own_until`); the end it reads now (`until`) is the latest
-- ruling's, newest first. Its columns are as 0111 wrote them, the two new ones last.
create or replace view my_bans as
  select b.id as ban, c.id as character, b.created_at as at, (b.payload ->> 'days')::integer as days,
         coalesce((select (r.payload ->> 'until')::timestamptz from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
                   where a.kind = 'appeal' and a.target_act_id = b.id and r.payload ? 'until' order by r.created_at desc, r.id desc limit 1),
                  (b.payload ->> 'until')::timestamptz) as until,
         (b.payload ->> 'infraction_act')::uuid as infraction, punishment_words((b.payload ->> 'infraction_act')::uuid) as rule, b.thread,
         (select r.payload ->> 'verdict' from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
          where a.kind = 'appeal' and a.target_act_id = b.id order by r.created_at desc, r.id desc limit 1) as ruling,
         (b.payload ->> 'until')::timestamptz as own_until
  from characters c
  join acts b on b.kind = 'ban' and b.payload ->> 'character' = c.id::text
  where c.owner = auth.uid();

-- ---- my_caught and log_page ----
drop function log_page(timestamptz);
drop view my_caught;
-- my_caught (0054) without `bought_price`; everything else as 0054 wrote it.
create view my_caught as
  select k.id as play, l.card, k.target_act_id as post, l.at, s.payload ->> 'card' as trap, s.id as spring, l.price
  from card_ledger l
  join acts k on k.id = l.act and k.kind = 'card' and k.payload ? 'caught'
  join acts s on s.kind = 'spring' and (s.payload ->> 'set') = k.payload ->> 'caught'
  where l.account = auth.uid() and l.kind = 'played';
revoke all on my_caught from public, anon, authenticated;
grant select on my_caught to authenticated;

-- log_page (0149) as described above. The function is made again, so its grants are stated again.
create function log_page(in_before timestamptz) returns jsonb
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
    select c.play, c.card, c.post, c.trap, c.spring, c.price, c.at
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
    select b.ban, b.character, b.at, b.days, b.until, b.infraction, b.rule, b.thread, b.ruling, b.own_until
    from my_bans b where in_before is null or b.at <= in_before
    order by b.at desc, b.ban limit 200
  ), gm as materialized (
    select g.move, g.character, g.at, g.thread, g.seq, g."group", g.board, g.board_name, g.expires_at, g.landed_until, g.check_at, g.demand, g.office,
           g.ended_why, g.ended_by, g.ended_at, g.ruling, g.ruled_at, g.ruled_until, g.ruled_office
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
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id::text collate "C") from ac a), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(to_jsonb(e) order by e.play::text collate "C") from (
      select s.play, s.state, s.saved_at from effect_state s where s.play in (select v.play from sv v)) e), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(f.face order by f.name, f.id) from (
        select cp.name, cp.id, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) from (
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

revoke all on function log_page(timestamptz) from public, anon, authenticated;
grant execute on function log_page(timestamptz) to authenticated;
