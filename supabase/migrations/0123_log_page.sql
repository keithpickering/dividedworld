-- log_page(before): /log and /log/settlement in one read (the glass-load design, sections 7 and 9; its plan, Task 9).
-- The Log reads a page of the player's own log (the adapter's log(), through readLogPage in engine/ui/data/log-page.ts), then what its lines name
-- (useLog's `around`, engine/ui/log/useLog.ts). This answers both as one document, from the same views with the same columns and filters.
--
--   sources   the thirteen reads log() makes, one array each, named as readLogPage's LogRead names them: ledger (my_ledger), wallet
--             (my_wallet_events), cards (my_card_ledger), playsOnMine and saves (my_posts_played_on, the saves where saved_at is set),
--             setEnds and setPasses (my_face_down, ended and passed without springing), caught (my_caught), ended (my_cards_ended),
--             infractions, bans, reports and appeals (my_infractions, my_bans, my_reports, my_appeals). Each is its view's rows newest first
--             by its own time, at or before `in_before` (all of them where it is null), at most 200 (LOG_ROWS), with the adapter's columns.
--             Rows that share an instant come in a fixed order (the order log() reads "at instant" in), so a page cut at 200 is the same page
--             every time. The client cuts the page (readLogPage) where the first full source ends; a page that would not move its cursor
--             is read again "at instant", a second request on that rare page (the design, section 9).
--   shares    my_ledger_shares for the settlements the ledger rows read name, whole.
--   acts      the acts_public rows the lines name: every share's, every card line's, the plays on the player's posts and their posts, the saves',
--             the face-down cards' posts and springs, the caught plays and their posts, the ended plays, the bribes' targets and the Acts of the
--             caller's characters' latest announced Turns; then the two rounds those lead to (actsNamed and actsFollowed in
--             engine/ui/log/lines.ts: the post a card, spring or set landed on, the spring a card came from, what a spring caught or was
--             sprung by, the visit an intercept answered). Computed over every row read, not only the rows the client's page keeps.
--   states    effect_state (play, state, saved_at) of the saved plays.
--   people    the characters those Acts name, and the targets of plays that carry no name, other than the caller's own, as boot's faces are but with
--             only the columns the adapter's characters() reads (id, name, joined, staff, office; character_profiles nested).
--   threads   thread_open rows of the Turns' threads and of plays reaching a thread; boards: boards_now rows (id, slug, name, description,
--             is_system, move_act) of plays reaching a board.
--   standings current_standings of the caller's characters; turns: their turns_announced rows, oldest first; season: current_season.
-- The estimate is an edge function and is not in it. `mine` and the time of the next settlement come from boot.
--
-- Bounded: 13 sources of at most 200 rows, the shares of the settlements those ledger rows name (a few dozen lines a settlement), and the Acts,
-- names, threads and boards they lead to (two rounds). Every piece is the caller's own row or a public projection, read as the caller (security
-- invoker): every my_* view answers from the caller's own rows alone. It writes nothing, reads only what a screen may read
-- (tools/check-web-reads.mjs) and is stable, which supabase/tests/e2e/0016-screen-reads.ts holds. A visitor is refused.

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
    select c.card, c.kind, c.act, c.price, c.at, c.springs
    from my_card_ledger c where in_before is null or c.at <= in_before
    order by c.at desc, c.card, c.kind, c.act, c.price limit 200
  ), po as materialized (
    select p.play, p.post, p.at, p.reach, p.target_name, p.target_character
    from my_posts_played_on p where in_before is null or p.at <= in_before
    order by p.at desc, p.play limit 200
  ), sv as materialized (
    select p.play, p.post, p.saved_at
    from my_posts_played_on p where p.saved_at is not null and (in_before is null or p.saved_at <= in_before)
    order by p.saved_at desc, p.play limit 200
  ), se as materialized (
    select f.play, f.card, f.post, f.spring, f.ended_at
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
      'cards', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.card, x.kind, x.act, x.price) from cd x), '[]'::jsonb),
      'playsOnMine', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play) from po x), '[]'::jsonb),
      'saves', coalesce((select jsonb_agg(to_jsonb(x) order by x.saved_at desc, x.play) from sv x), '[]'::jsonb),
      'setEnds', coalesce((select jsonb_agg(to_jsonb(x) order by x.ended_at desc, x.play) from se x), '[]'::jsonb),
      'setPasses', coalesce((select jsonb_agg(to_jsonb(x) order by x.passed_at desc, x.play) from sp x), '[]'::jsonb),
      'caught', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play) from ca x), '[]'::jsonb),
      'ended', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.card_end) from en x), '[]'::jsonb),
      'infractions', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.infraction) from inf x), '[]'::jsonb),
      'bans', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.ban) from bn x), '[]'::jsonb),
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
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style
            from character_profiles r where r.character = cp.id) p)) as face
        from (select c.id, c.name, c.joined, c.staff, c.office from characters_public c where c.id in (select p.id from pe p)) cp) f), '[]'::jsonb),
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
