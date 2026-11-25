-- What the staff read sees of the board: reactions, polls, plays, a rewound body and a spun thread's origin (docs/plans/2026-11-25-reads-see-the-board-plan.md, Task 2; design docs/plans/2026-11-25-reads-see-the-board-design.md, sections 1, 2, 3, 3a, 3b and 5).
-- The plan numbered this 0423; 0423 and 0424 are taken by PRs in flight, and 0425 (pool_read_bounded) is the pool_read this one extends.
--
-- What was missing: pool_read (0425) returns each post's words alone. A post that is only a poll reads as empty, a splatted post as clean, a post under a Time Machine as the words every player no longer sees, and a thread spun from a short or empty
-- opener gives a model nothing to go on. This migration gives each post the extras the board shows with it, read once, for the reader, the digest and the patrol alike (design, section 3b):
--   post_extras(posts uuid[])  jsonb, one entry for each post given (at most 200, refused plainly above that as post_plays refuses), in the order given, each once:
--       { post, poll, plays, reactions, rewoundTo, body? }
--       poll       null, or { question, options, pick, secret, endsAt, closed, closedAt, closedBy, counts, voters }: the post's latest poll Act unless that is a removal (latest_poll's rule); `counts` and `voters` are poll_counts' (characters, never owners);
--                  `closedBy` is 'author' | 'admin' from the poll's poll_close, null where its time ran out or it is open; `closedAt` is the close Act's time when closed early, the poll's end when its time ran out, null while open (endsAt is the least of the two).
--                  There is no `names` key (design, section 1 keeps the path).
--       plays      [{ play, card, at, by, config, state, text, covered }], oldest first: the card and set Acts of post_play_ids that are in force or are sprung backs whose lockout is live (not its stand-ins, which are plays that ended), as post_plays reads them through acts_public, but
--                  leaving out what the board shows no play of: a back that has not sprung (its card is hidden and, while it is down, so is the fact), a caught play (it never landed) and a play whose write was refunded (it never took). `card` is null for a
--                  back that sprang (it names none), `by` is the caster's public name where acts_public gives the play a character, `config` the play's payload configuration, `state` its saved effect_state or null (exactly that row's state), `text` the words a writing card made as the page's tails show them to any reader (card_texts: the text of the post's current version, else its latest; null for
--                  any other play), `covered` the share of a surface the play covers, in [0, 1] (bit_count of surfaces.cover over the grid's 10,000 cells, as the page's `covered`; null for a play with no surface). Both are read by key per play.
--       reactions  { <kind>: count }, the public counts as reaction_tallies_open gives them (a post under a live totals veil has none, for every reader alike), `{}` for none. Never who reacted.
--       rewoundTo  null, or the time of the version the post shows under a live rewind card (post_rewind_plays' newest played); then `body` is that version's body as acts_public shows it, and only then is there a `body` key.
--   pool_read                  its signature and every key it returned, and through post_extras each post gains poll, plays, reactions and rewoundTo (and a rewound body); and a top-level `origin`: null for a thread that was not spun, else
--       { kind, place, at, spunAt, moment, post }: `kind` the origin Act's kind, `place` thread_open.origin_place, `at` the origin Act's time, `spunAt` the thread's, `moment` true where the origin is a play (card, set, spring), `post` the post the origin
--       stands on, shaped as a pool_read post plus `thread` and `title` (for an Updates post the update's own headline), with its poll, plays, reactions and rewoundTo; null where the board shows none (hidden, no public name, a play beyond a post, an appeal of a move).
--       For a moment the post's `plays` are the plays as they stood then and not today's, read as the page's ORIGIN box reads them (origin_moment, 0372): a play on a post is play_moment's (the other layers recorded when it landed, with their saved states, and the play
--       itself), a play on a character spun at a post is spin_moment's (the layers recorded at the spin); a play with no recorded moment gives none; their `text` is the latest words the play made and their `covered` is null (a surface's cover as it stood then is not kept). A back is never one of them, and the body is the post's own words, not a rewound version.
--       The plan said spin_moment of the opener for every play; spin_moment refuses a spin that names no post, which is every spin of a play on a post, so the page's own choice (origin_moment) is followed.
--   Four helpers: extras_ids and extras_layers (owned by the migration's role: the digest role reads no column of `acts` and none of play_post, effect_state or the moment tables, so they return ids, times and states and nothing else) and pool_read_origin,
--   and the chunking of pool_read over post_extras (pool_read can name more than 200 posts; it asks 200 at a time).
-- Grants to the digest role, all execute and each named: extras_ids(uuid[]) and extras_layers(text, uuid) (the two helpers above), spin_answer_place(uuid) (0422: thread_list's origin_place calls it, as its reader, for a thread spun from a report, verdict, appeal
-- or ruling; it reads public Acts and names no owner, and without the grant a read of such a thread's row is refused), nothing on post_plays, latest_poll, spin_moment, post_rewind_plays or any other page function: extras_ids calls
-- post_play_ids and post_rewind_plays as its owner. The role already reads poll_counts, reaction_tallies_open, acts_public, characters_public, character_profiles and thread_list, which is everything else it reads here. post_extras and pool_read_origin
-- are owned by the digest role; post_extras and pool_read are the service role's alone, the rest nobody's.
--
-- The guarantee about reads (0425's, kept): no read of `acts` is larger than its key says, on any plan the planner might take. A post's latest poll is one ordered probe of acts_polls (target, created_at, id) limited to one row and its close one probe of the unique
-- acts_one_poll_close, each a lateral subquery run once per post given, under the settings 0425's helpers run under (no sequential scan, no bitmap scan, no sort); every Act is read by its id through acts_public in one statement (`id = any (array)`: a probe of
-- the primary key for each element); poll_counts and the reaction tallies are read for one poll or post at a time (a lateral probe by key), poll_counts reading poll_latest_ballots, so its cost is a poll's voters and never its ballots; the rewound version is
-- one probe of acts_edits; the origin is the thread's row (thread_list by id), the origin Act by id, and the post by id or by (thread, seq) through 0425's own helpers. The plays are read from play_post and post_kinds (never `acts`) and joined to effect_state by key.
-- supabase/tests/0426-reads-see-the-board.sql counts the rows of `acts` a read of threads with a poll and eight plays on every post reads, under empty statistics, generic plans and true statistics, for 100 and 400 posts and for 6 and 60 ballots on each poll.
-- Ways out: no state is added. Masks: everything is read through acts_public and the public views, so a secret ballot, a face-down set and a hidden caster stay hidden: no ballot's character or picks are read (poll_counts counts characters and names none), a back is never named, a
-- caster is named where acts_public gives the play a character, reactions are the public sums, and nothing is computed from who owns a character or who reacted.

grant create on schema public to kayfabb_digest;

-- ---------------------------------------------------------------------------------------------------- extras_ids ----
-- For each of `posts`: its latest poll Act ('poll', act), that poll's close Act ('close'), its plays ('play': act, at the play's time, state its saved state) and the version its live rewind shows ('rewind': act the rewind play, at the point, ver the version's
-- Act, an edit or the post itself). Ids, times and states only. At most 200 posts.
create function extras_ids(posts uuid[]) returns table (post uuid, part text, act uuid, at timestamptz, state jsonb, ver uuid, text text, covered double precision)
language plpgsql stable security definer set search_path = public, pg_temp set jit = off
  set enable_seqscan = off set enable_bitmapscan = off set enable_sort = off set enable_incremental_sort = off as $$
begin
  if cardinality(extras_ids.posts) > 200 then raise exception 'ask for at most 200 posts at a time' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  return query
  with polls as materialized (
    select p.id as post, l.id as poll, l.created_at
    from unnest(extras_ids.posts) p(id)
    cross join lateral (select a.id, a.created_at from acts a where a.kind = 'poll' and a.target_act_id = p.id order by a.created_at desc, a.id desc limit 1) l
  ), closes as materialized (
    select pl.post, c.id
    from polls pl cross join lateral (select x.id from acts x where x.kind = 'poll_close' and x.target_act_id = pl.poll limit 1) c
  ), rw as materialized (
    select distinct on (r.post) r.post, r.play from post_rewind_plays(extras_ids.posts) r order by r.post, r.played_at desc, r.play desc
  )
  select pl.post, 'poll'::text, pl.poll, pl.created_at, null::jsonb, null::uuid, null::text, null::double precision from polls pl
  union all
  select c.post, 'close', c.id, null::timestamptz, null::jsonb, null::uuid, null::text, null::double precision from closes c
  union all
  select x.post, 'play', x.play, p.played_at, e.state, null::uuid, t.text, s.covered
  from post_play_ids(extras_ids.posts) x
  join play_post p on p.play = x.play
  left join effect_state e on e.play = x.play
  -- the words a writing play made, as the page's tails (post_tails) show them to any reader: the text for the post's current version, else the latest text it has; a play that writes has a row for each version of its post, any other none
  left join lateral (select ct.text from card_texts ct where ct.play = x.play and ct.text is not null order by (ct.version = post_version(x.post)) desc, ct.created_at desc, ct.id desc limit 1) t on true
  -- the share of a surface a play covers: the page's `covered` (bit_count of the cover) over the grid's 100 x 100 cells (0317), a row for a surface card alone
  left join lateral (select bit_count(sf.cover)::double precision / 10000 as covered from surfaces sf where sf.play = x.play) s on true
  -- the plays the board draws as live layers (post_play_ids' first three arms: in force, or a sprung back whose lockout is live), not the stand-ins it also returns for the Lens; and never a back that has not sprung
  where ((p.over_at is null and (p.ends_at is null or p.ends_at > now())) or p.lock_until > now()) and (p.kind <> '' or p.sprung)
  union all
  select rw.post, 'rewind', rw.play, pt.point, null::jsonb, v.id, null::text, null::double precision
  from rw
  cross join lateral (select (k.payload ->> 'rewind_at')::timestamptz as point from acts k where k.id = rw.play) pt
  cross join lateral (select coalesce((select e.id from acts e where e.kind = 'edit' and e.target_act_id = rw.post and e.created_at <= pt.point order by e.created_at desc, e.id desc limit 1), rw.post) as id) v
  where pt.point is not null and exists (select 1 from acts o where o.id = rw.post and o.kind in ('post', 'spin'));
end $$;
revoke execute on function extras_ids(uuid[]) from public, anon, authenticated, service_role;
grant execute on function extras_ids(uuid[]) to kayfabb_digest;

-- The layers recorded for a play's moment (`via` = 'play', the play's id: 0072) or a spin's (`via` = 'spin', the spin's id: 0351), with the state each had saved then. Ids and states; the primary keys lead.
-- For a play's moment the play itself comes first (its own moment lists it apart from the others, with no state). `text` is the latest words a writing layer has made.
create function extras_layers(via text, id uuid) returns table (layer uuid, state jsonb, text text)
language sql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off as $$
  select l.layer, l.state, (select ct.text from card_texts ct where ct.play = l.layer and ct.text is not null order by ct.created_at desc, ct.id desc limit 1)
  from (
    select extras_layers.id as layer, null::jsonb as state where extras_layers.via = 'play'
    union all
    select l.layer, l.state from play_moment_layers l where extras_layers.via = 'play' and l.play = extras_layers.id
    union all
    select l.layer, l.state from spin_moment_layers l where extras_layers.via = 'spin' and l.spin = extras_layers.id
  ) l
$$;
revoke execute on function extras_layers(text, uuid) from public, anon, authenticated, service_role;
grant execute on function extras_layers(text, uuid) to kayfabb_digest;
grant execute on function spin_answer_place(uuid) to kayfabb_digest;

-- ---------------------------------------------------------------------------------------------------- post_extras ----
create function post_extras(posts uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off as $$
declare
  ids uuid[];
begin
  if cardinality(post_extras.posts) > 200 then raise exception 'ask for at most 200 posts at a time' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  ids := coalesce(array(select u.p from (select g.p, min(g.n) as n from unnest(post_extras.posts) with ordinality g(p, n) where g.p is not null group by g.p) u order by u.n), '{}'::uuid[]);
  return coalesce((
    with given as materialized (select u.p as post, u.n from unnest(ids) with ordinality u(p, n)),
    x as materialized (select * from extras_ids(ids)),
    a as materialized (
      select v.id, v.kind, v."character", v.created_at, v.payload, v.untaken
      from acts_public v where v.id = any (array(select z.act from x z union select z.ver from x z where z.ver is not null))
    ),
    pl as materialized (
      select z.post, p.payload as pay, k.counts, k.voters, k.ends_at, k.closed, cl.by
      from x z join a p on p.id = z.act and z.part = 'poll'
      cross join lateral (select c.counts, c.voters, c.ends_at, c.closed from poll_counts c where c.poll = p.id) k
      left join lateral (select ac.payload ->> 'by' as by from x zc join a ac on ac.id = zc.act where zc.part = 'close' and zc.post = z.post) cl on true
      where not (p.payload ? 'removed')
    ),
    pp as materialized (
      select z.post, a.id, a.created_at,
             jsonb_build_object('play', a.id, 'card', case when a.kind = 'card' then a.payload ->> 'card' end, 'at', a.created_at, 'by', c.name, 'config', a.payload -> 'config', 'state', z.state, 'text', z.text, 'covered', z.covered) as j
      from x z join a on a.id = z.act and a.kind in ('card', 'set') and not (a.payload ? 'caught') and a.untaken is not true
      left join lateral (select cp.name from characters_public cp where cp.id = a."character") c on true
      where z.part = 'play'
    ),
    rw as materialized (
      select z.post, z.at as point, coalesce(v.payload ->> 'body', '') as body from x z join a v on v.id = z.ver where z.part = 'rewind'
    ),
    rt as materialized (
      select g.post, t.j from given g
      cross join lateral (select jsonb_object_agg(r.kind, r.count) as j from reaction_tallies_open r where r.act = g.post and r.count > 0) t
      where t.j is not null
    )
    select jsonb_agg(
      jsonb_build_object(
        'post', g.post,
        'poll', (select jsonb_build_object('question', q.pay -> 'question', 'options', q.pay -> 'options', 'pick', q.pay -> 'pick', 'secret', coalesce((q.pay ->> 'secret')::boolean, false),
                                           'endsAt', q.ends_at, 'closed', q.closed, 'closedAt', case when q.closed then q.ends_at end, 'closedBy', q.by, 'counts', to_jsonb(q.counts), 'voters', q.voters)
                 from pl q where q.post = g.post),
        'plays', coalesce((select jsonb_agg(s.j order by s.created_at, s.id) from pp s where s.post = g.post), '[]'::jsonb),
        'reactions', coalesce((select r.j from rt r where r.post = g.post), '{}'::jsonb),
        'rewoundTo', (select w.point from rw w where w.post = g.post))
      || coalesce((select jsonb_build_object('body', w.body) from rw w where w.post = g.post), '{}'::jsonb)
      order by g.n)
    from given g), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------------- pool_read_origin ----
-- The thread's origin without its extras: { kind, place, at, spunAt, moment, post, momentPlays }, null for a thread that was not spun. `post` has the pool_read post's keys plus `thread` and `title`; pool_read adds the extras and takes `momentPlays` out.
create function pool_read_origin(in_thread uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off as $$
declare
  t record; o record; pp record; who record;
  place jsonb; on_kind text; pid uuid; via text; via_id uuid;
  cand jsonb; moment boolean; mplays jsonb; ttl text; qs uuid[]; lthr uuid; lseq integer;
begin
  select l.origin_act_id, l.origin_place, l.created_at, l.first_act into t from thread_list l where l.id = in_thread;
  if t.origin_act_id is null then return null; end if;
  select a.id, a.kind, a.thread, a.target_act_id, a.created_at, a.payload into o from acts_public a where a.id = t.origin_act_id;
  if o.id is null then return null; end if;
  place := t.origin_place;
  on_kind := place #>> '{on,kind}';
  moment := o.kind in ('card', 'set', 'spring');
  if place is not null then
    pid := case
      when o.kind in ('post', 'spin', 'update') then o.id
      when o.kind = 'poll' then o.target_act_id
      when o.kind = 'ballot' then (select b.target_act_id from acts_public b where b.id = o.target_act_id)
      when o.kind in ('card', 'set', 'spring') then case when on_kind in ('post', 'update') then o.target_act_id end
    end;
    if o.kind in ('report', 'report_verdict', 'appeal', 'appeal_ruling') then
      lthr := (place #>> '{on,thread}')::uuid; lseq := (place #>> '{on,seq}')::integer;
      if lthr is not null and lseq is not null then pid := (pool_seq_ids(lthr, lseq, lseq))[1]; end if;
    end if;
  end if;
  if pid is not null then
    select * into pp from pool_probe(pid);
    if pp.ok and pp.hidden is not true and pp.kind in ('post', 'spin', 'update') then
      who := null;
      if pp.author is not null then
        select c.name as name, cp.pronouns as pronouns into who from characters_public c left join character_profiles cp on cp.character = c.id where c.id = pp.author;
      end if;
      if pp.author is null or who.name is not null then
        if pp.kind = 'update' then select a.payload ->> 'title' into ttl from acts_public a where a.id = pid;
        else select l.title into ttl from thread_list l where l.id = pp.thread; end if;
        qs := pool_quoted(pp.thread, pp.ref);
        cand := jsonb_build_object('act', pid, 'seq', pp.seq, 'at', pp.created_at, 'author', pp.author, 'name', who.name, 'pronouns', who.pronouns, 'body', pp.body, 'replyTo', pp.target,
                                   'quotes', coalesce((select jsonb_agg(to_jsonb(q.id) order by q.n) from unnest(qs) with ordinality q(id, n)), '[]'::jsonb),
                                   'thread', pp.thread, 'title', coalesce(ttl, ''));
      end if;
    end if;
  end if;
  if moment and cand is not null then
    if o.kind = 'card' and on_kind = 'post' then via := 'play'; via_id := o.id;
    elsif on_kind = 'character' and jsonb_typeof(place -> 'at') = 'object' and t.first_act is not null then via := 'spin'; via_id := t.first_act; end if;
    mplays := '[]'::jsonb;
    if via is not null then
      mplays := coalesce((
        select jsonb_agg(m.j order by m.created_at, m.id) from (
          select a.id, a.created_at,
                 jsonb_build_object('play', a.id, 'card', a.payload ->> 'card', 'at', a.created_at, 'by', c.name, 'config', a.payload -> 'config', 'state', l.state, 'text', l.text, 'covered', null::double precision) as j
          from extras_layers(via, via_id) l
          join acts_public a on a.id = l.layer and a.kind = 'card' and not (a.payload ? 'caught') and a.untaken is not true
          left join lateral (select cp.name from characters_public cp where cp.id = a."character") c on true
        ) m), '[]'::jsonb);
    end if;
  end if;
  return jsonb_build_object('kind', o.kind, 'place', place, 'at', o.created_at, 'spunAt', t.created_at, 'moment', moment, 'post', cand, 'momentPlays', mplays);
end $$;

-- ---------------------------------------------------------------------------------------------------- pool_read ----
-- 0425's pool_read (same signature, same keys), each post and the origin's post given their extras. post_extras is asked 200 posts at a time.
drop function pool_read(uuid, text, uuid[], integer);
create function pool_read(in_thread uuid, staff_key text, named uuid[], "window" integer) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off as $$
declare
  rows jsonb; ids uuid[]; org jsonb; oid uuid; ex jsonb := '[]'::jsonb; i integer; ex_by jsonb; merged jsonb; opost jsonb; mp jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('act', p.act, 'seq', p.seq, 'at', p.at, 'author', p.author, 'name', p.name, 'pronouns', p.pronouns,
                                               'body', p.body, 'replyTo', p.reply_to, 'quotes', p.quotes) order by p.at, p.act), '[]'::jsonb),
         coalesce(array_agg(p.act order by p.at, p.act), '{}'::uuid[])
    into rows, ids
  from pool_read_rows(in_thread, staff_key, named, "window") p;
  org := pool_read_origin(in_thread);
  oid := (org #>> '{post,act}')::uuid;
  if oid is not null and not (oid = any (ids)) then ids := ids || oid; end if;
  i := 1;
  while i <= cardinality(ids) loop
    ex := ex || post_extras(ids[i : i + 199]);
    i := i + 200;
  end loop;
  select coalesce(jsonb_object_agg(e.x ->> 'post', e.x - 'post'), '{}'::jsonb) into ex_by from jsonb_array_elements(ex) e(x);
  select coalesce(jsonb_agg(r.v || coalesce(ex_by -> (r.v ->> 'act'), '{}'::jsonb) order by r.n), '[]'::jsonb) into merged from jsonb_array_elements(rows) with ordinality r(v, n);
  if org is not null then
    opost := org -> 'post';
    mp := org -> 'momentPlays';
    if jsonb_typeof(opost) = 'object' then
      opost := opost || coalesce(ex_by -> (opost ->> 'act'), '{}'::jsonb);
      -- a moment: the plays as they stood then, the post's own words, no rewind
      if (org -> 'moment') = 'true'::jsonb then opost := opost || jsonb_build_object('body', org -> 'post' -> 'body', 'plays', coalesce(mp, '[]'::jsonb), 'rewoundTo', null); end if;
    end if;
    org := (org - 'momentPlays') || jsonb_build_object('post', opost);
  end if;
  return jsonb_build_object(
    'title', coalesce((select t.title from thread_list t where t.id = in_thread), ''),
    'self', (select c.id from characters_public c where c.staff = pool_read.staff_key),
    'posts', merged,
    'origin', org);
end $$;

alter function post_extras(uuid[]) owner to kayfabb_digest;
alter function pool_read_origin(uuid) owner to kayfabb_digest;
alter function pool_read(uuid, text, uuid[], integer) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;
revoke execute on function post_extras(uuid[]), pool_read_origin(uuid), pool_read(uuid, text, uuid[], integer) from public, anon, authenticated, service_role;
grant execute on function post_extras(uuid[]) to service_role;
grant execute on function pool_read(uuid, text, uuid[], integer) to service_role;
