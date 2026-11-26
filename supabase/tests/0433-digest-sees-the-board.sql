-- What the digest sees of the board (supabase/migrations/0433_digest_sees_the_board.sql; docs/plans/2026-11-25-digest-sees-the-board-plan.md, Task 2; design sections 1 to 4 and 6).
-- 1. extras on each shown post (an excerpt's poll and plays, a conversation's reply, the Boss's reacted posts), an origin on a spun opener, the Boss's reactions with their text.
-- 2. polls: the window's polls by voters then newest, no removed or replaced poll, no voter's name or id, a secret ballot only in the counts; each row carries its post's number.
-- 3. spins, plays (no unsprung face-down set, one once it springs) and standouts (a secret ballot and an unsprung set never count, a staff character never stands out, only a character's public Acts).
-- 4. the window's days: a two-day window doubles the top posts' cap and leaves moves', quotes' and the Boss's reactions' caps alone; each list is held to its ceiling.
-- 5. the security: the helpers' owners, grants and search paths.
-- 6. what the spec review found: a hidden post's poll and play never use up a list's cap; the plays are those played in the window whatever has become of them since; a set's origin is shown once the set has sprung; the standouts' own reading of
--    `acts` agrees with acts_public's.
-- The rows are this file's own (dx...), in two years no other file uses.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if ok is not true then raise exception '%', what; end if; end $$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, stack) values
    ('exsplat', 'Ex Splat', 'salty', 'common', 'cast', null, '{post}', null, 8),
    ('exsweet', 'Ex Sweet', 'sweet', 'common', 'cast', null, '{post}', null, 8),
    ('exblot', 'Ex Blot', 'salty', 'common', 'cast', null, '{post}', null, 8),
    ('exwink', 'Ex Wink', 'sweet', 'common', 'cast', null, '{post}', null, 8)
  on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('exback', 'Ex Back', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null)
  on conflict (key) do nothing;
end $$;
select pg_temp.cards();

create function pg_temp.mkpoll(in_thread uuid, on_post uuid, by_character uuid, secret boolean, closes timestamptz, at timestamptz) returns uuid language sql as $$
  select tests.act(by_character, 'poll', in_thread, jsonb_build_object('question', 'Best kart?', 'options', '["Pipe Frame", "Badwagon"]'::jsonb, 'pick', 1, 'secret', secret, 'closes_at', closes), on_post, at)
$$;
create function pg_temp.vote(on_poll uuid, by_character uuid, at timestamptz) returns uuid language sql as $$
  select tests.act(by_character, 'ballot', (select p.thread from acts p where p.id = on_poll), '{"picks": [0]}', on_poll, at)
$$;

-- A back and its face_down row; `sprung` writes the spring a cast would, naming the card.
create function pg_temp.back(ch uuid, who uuid, th uuid, post uuid, rnd integer, at timestamptz) returns uuid language plpgsql as $$
declare s uuid;
begin
  s := tests.act(ch, 'set', th, '{}', post, at);
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s, who, 'exback', post, th, rnd, now() + interval '1 day');
  return s;
end $$;
create function pg_temp.spring(ch uuid, s uuid, th uuid, post uuid, at timestamptz) returns uuid language sql as $$
  select tests.act(ch, 'spring', th, jsonb_build_object('set', s::text, 'card', 'exback', 'trigger', 'cast', 'did', 'lockedOut', 'locks', ch::text, 'until', (now() + interval '1 day')::text), post, at)
$$;

-- A thread spun from `origin` by `through`, without spin_written (which stamps now() on the thread): the thread row, its spin Act, and `n` replies.
create function pg_temp.spin(through uuid, origin uuid, title text, at timestamptz, n integer default 0) returns uuid language plpgsql as $$
declare th uuid; i integer;
begin
  insert into threads (board, title, origin_act_id, created_at) select b.id, title, origin, at from boards b where b.slug = 'general' returning id into th;
  perform tests.act(through, 'spin', th, jsonb_build_object('title', title, 'body', 'Discuss.'), origin, at);
  for i in 1..n loop perform tests.post(through, th, 'Reply ' || i, at + i * interval '1 minute'); end loop;
  return th;
end $$;

create function pg_temp.root(k text, th uuid, at timestamptz) returns uuid language plpgsql as $$
declare p uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  p := tests.post((select id from characters where staff = k), th, 'An opening from the persona.', at);
  perform set_config('kayfabb.staff_writer', '', true);
  return p;
end $$;
-- A persona's turn answering `replies` (the first is quoted), written at `at`.
create function pg_temp.turn(k text, th uuid, body text, replies uuid[], at timestamptz) returns uuid language plpgsql as $$
declare sid bigint; p uuid; tid bigint; r uuid;
begin
  insert into staff_sessions (day, staff, starts_at, ends_at) values ((at at time zone 'UTC')::date, k, at - interval '30 minutes', at + interval '30 minutes') returning id into sid;
  perform set_config('kayfabb.staff_writer', 'on', true);
  p := tests.post((select id from characters where staff = k), th, body, at);
  perform set_config('kayfabb.staff_writer', '', true);
  insert into pool_turns (day, staff, session, thread, post_act, quoting, at) values ((at at time zone 'UTC')::date, k, sid, th, p, replies[1], at) returning id into tid;
  foreach r in array replies loop insert into pool_answered (reply, turn) values (r, tid); end loop;
  return p;
end $$;

create function pg_temp.digest(since timestamptz, until timestamptz) returns jsonb language plpgsql as $$
declare d jsonb;
begin
  perform tests.become_service();
  d := system_digest(since, until);
  perform tests.unbecome();
  return d;
end $$;

-- the standouts of one category as 'name:count' in order
create function pg_temp.top(d jsonb, cat text) returns text language sql as $$
  select coalesce(string_agg((e ->> 'name') || ':' || (e ->> 'count'), ',' order by o), '') from jsonb_array_elements(d -> 'standouts' -> cat) with ordinality x(e, o)
$$;

-- The standouts as acts_public gives the Acts (the masks are the view's, not re-implemented): 'name:count' of the top three of one category over [from_at, to_at), most first then by name. digest_standouts reads `acts` itself for cost and must agree.
create function pg_temp.plain_top(cat text, from_at timestamptz, to_at timestamptz) returns text language sql as $$
  with pl as (
    select a.id, a."character" as ch, a.target_act_id as tgt from acts_public a
    where a.kind in ('card', 'spring') and (a.kind = 'spring' or not (a.payload ? 'caught')) and a.untaken is not true and a.created_at >= from_at and a.created_at < to_at and a."character" is not null
  ), counts as (
    select 'cards'::text as category, p.ch, count(*) as n from pl p group by p.ch
    union all
    select 'received', x."character", count(*) from pl p join acts_public x on x.id = p.tgt and x.kind in ('post', 'spin') and x."character" is not null group by x."character"
    union all
    select 'polls', a."character", count(*) from acts_public a where a.kind = 'poll' and not (a.payload ? 'removed') and a.created_at >= from_at and a.created_at < to_at and a."character" is not null group by a."character"
    union all
    select 'ballots', b.ch, count(*) from (select distinct a.target_act_id, a."character" as ch from acts_public a where a.kind = 'ballot' and a.created_at >= from_at and a.created_at < to_at and a."character" is not null) b group by b.ch
    union all
    select 'spun', o."character", count(*) from threads t join acts_public o on o.id = t.origin_act_id and o."character" is not null and (o.kind <> 'set' or exists (select 1 from play_post pp where pp.play = o.id and pp.sprung))
    where t.created_at >= from_at and t.created_at < to_at group by o."character"
  ), named as (
    select k.category, c.name, k.ch, k.n from counts k join characters_public c on c.id = k.ch and c.staff is null where k.category = cat
  )
  select coalesce(string_agg(r.name || ':' || r.n, ',' order by r.rn), '') from (select n.name, n.n, row_number() over (order by n.n desc, n.name, n.ch) as rn from named n) r where r.rn <= 3
$$;

create temp table fx (k text primary key, v uuid);
grant all on fx to public;
create function pg_temp.f(k text) returns uuid language sql as $$ select v from fx where fx.k = f.k $$;

insert into characters (name, staff, staff_kind, debuted_at) values ('Dx Boss', 'dx-boss', 'persona', now()), ('Dx Mod', 'dx-mod', 'persona', now());

-- ---- 1 to 3. one day of play ----
do $$
declare
  base timestamptz := '2047-03-10T12:00:00Z';
  aa uuid := tests.account('dx-ann'); ab uuid := tests.account('dx-bob'); ac uuid := tests.account('dx-cat'); ad uuid := tests.account('dx-dee');
  a uuid := tests.character(aa, 'Dx Ann'); b uuid := tests.character(ab, 'Dx Bob'); c uuid := tests.character(ac, 'Dx Cat'); dd uuid := tests.character(ad, 'Dx Dee');
  boss uuid := (select id from characters where staff = 'dx-boss'); modc uuid := (select id from characters where staff = 'dx-mod');
  t uuid := tests.thread('Dx Main'); tmod uuid := tests.thread('Dx Mod Thread');
  pa uuid; pb uuid; pc uuid; pd uuid; pq uuid; pr uuid; pmod uuid; pbs uuid; pbo uuid; pbp uuid;
  p1 uuid; p1b uuid; p2 uuid; p3 uuid; p4old uuid; p4 uuid; pearly uuid; pold uuid; prm uuid;
  w1 uuid; w2 uuid; w3 uuid; w4 uuid; s1 uuid; s2 uuid; sec_ballots uuid[] := '{}'; bl uuid; i integer; ck text;
  ts1 uuid; ts2 uuid; ts3 uuid; bspin uuid; rboss uuid; root1 uuid; rb1 uuid; ra1 uuid; rb2 uuid; troot uuid; tt uuid; tpost uuid;
  d jsonb; e jsonb; x jsonb; txt text;
begin
  insert into settings (key, value) values ('digestExcerptChars', '12'), ('digestExcerpts', '2'), ('digestThreads', '3'), ('digestConversations', '2'),
    ('digestPolls', '3'), ('digestSpins', '2'), ('digestPlays', '2'), ('digestStandoutDays', '7')
  on conflict (key) do update set value = excluded.value;
  update seasons set boss = 'dx-boss' where ends_at is null;
  insert into fx values ('a', a), ('b', b), ('c', c), ('d', dd), ('t', t), ('boss', boss), ('mod', modc);
  perform set_config('kayfabb.staff_writer', 'on', true);

  -- the posts, with reactions that rank them: the Boss's post and Ann's draw 5, Bob's 4, Cat's 3, Dee's 2
  pa := tests.post(a, t, 'Ann opens the main post with a poll', base - interval '20 hours');
  pb := tests.post(b, t, 'Bob has a secret poll', base - interval '19 hours');
  pc := tests.post(c, t, 'Cat has another secret poll', base - interval '18 hours');
  pd := tests.post(dd, t, 'Dee has a replaced poll', base - interval '17 hours');
  pq := tests.post(a, t, 'Ann again, a second public poll', base - interval '15 hours');
  pr := tests.post(a, t, 'Ann removes a poll', base - interval '14 hours');
  pmod := tests.post(modc, tmod, 'The mod speaks.', base - interval '10 hours');
  pbs := tests.post(boss, tmod, 'The Boss speaks at length about it', base - interval '6 hours');
  pbo := tests.post(boss, tmod, 'The Boss, a day and a half ago', base - interval '30 hours');
  insert into reaction_tallies (act, kind, count) values (pa, 'up', 5), (pb, 'up', 4), (pc, 'up', 3), (pd, 'up', 2), (pbs, 'up', 5), (pbo, 'wow', 2);
  insert into fx values ('pa', pa), ('pb', pb), ('pc', pc), ('pd', pd), ('pq', pq), ('pbs', pbs);

  -- polls: P1 public (Ann, Bob, Cat), P1b public (Bob), P2 secret (Cat, Dee, Ann), P3 secret (Dee, Cat), P4old replaced by P4 secret (Dee), Pearly secret from five days back (Ann, Bob), Pold closed before the window, Pr removed
  p1 := pg_temp.mkpoll(t, pa, a, false, base + interval '2 days', base - interval '20 hours');
  p2 := pg_temp.mkpoll(t, pb, b, true, base + interval '2 days', base - interval '19 hours');
  p3 := pg_temp.mkpoll(t, pc, c, true, base + interval '2 days', base - interval '18 hours');
  p4old := pg_temp.mkpoll(t, pd, dd, true, base + interval '2 days', base - interval '17 hours');
  p4 := pg_temp.mkpoll(t, pd, dd, true, base + interval '2 days', base - interval '16 hours');
  p1b := pg_temp.mkpoll(t, pq, a, false, base + interval '2 days', base - interval '15 hours');
  prm := pg_temp.mkpoll(t, pr, a, false, base + interval '2 days', base - interval '14 hours');
  perform tests.act(a, 'poll', t, '{"removed": true}', pr, base - interval '13 hours');
  -- Pearly and Pold each have a post of their own
  declare pe uuid; po uuid; begin
    pe := tests.post(c, t, 'Cat, five days back', base - interval '5 days');
    pearly := pg_temp.mkpoll(t, pe, c, true, base + interval '1 day', base - interval '5 days' + interval '1 minute');
    po := tests.post(b, t, 'Bob, a poll that closed', base - interval '6 days');
    pold := pg_temp.mkpoll(t, po, b, false, base - interval '2 days', base - interval '6 days' + interval '1 minute');
    perform pg_temp.vote(pearly, a, base - interval '4 days'); perform pg_temp.vote(pearly, b, base - interval '4 days' + interval '1 minute');
    insert into fx values ('pearly', pearly), ('pold', pold);
  end;
  perform pg_temp.vote(p1, a, base - interval '10 hours'); perform pg_temp.vote(p1, b, base - interval '10 hours' + interval '1 minute'); perform pg_temp.vote(p1, c, base - interval '10 hours' + interval '2 minutes');
  perform pg_temp.vote(p1b, b, base - interval '9 hours');
  sec_ballots := sec_ballots || pg_temp.vote(p2, c, base - interval '8 hours') || pg_temp.vote(p2, dd, base - interval '8 hours' + interval '1 minute') || pg_temp.vote(p2, a, base - interval '8 hours' + interval '2 minutes');
  sec_ballots := sec_ballots || pg_temp.vote(p3, dd, base - interval '7 hours') || pg_temp.vote(p3, c, base - interval '7 hours' + interval '1 minute');
  sec_ballots := sec_ballots || pg_temp.vote(p4, dd, base - interval '5 hours');
  insert into fx values ('p1', p1), ('p1b', p1b), ('p2', p2), ('p3', p3), ('p4', p4);

  -- cards: Ann's splat on Bob's post (drawn 5), Bob's sweet on Ann's (drawn 3), Cat's caught wink (never landed), Cat's wink on Dee's, an unsprung back of Ann's on her own post, a back of Bob's on his own that sprang into a lockout
  w1 := tests.act(a, 'card', t, '{"card": "exsplat", "reach": "post"}', pb, base - interval '12 hours');
  w2 := tests.act(b, 'card', t, '{"card": "exsweet", "reach": "post"}', pa, base - interval '11 hours');
  w3 := tests.act(c, 'card', t, '{"card": "exwink", "reach": "post", "caught": "x"}', pa, base - interval '10 hours');
  w4 := tests.act(c, 'card', t, '{"card": "exwink", "reach": "post"}', pd, base - interval '9 hours 30 minutes');
  s1 := pg_temp.back(a, aa, t, pq, 1, base - interval '9 hours');
  s2 := pg_temp.back(b, ab, t, pb, 1, base - interval '8 hours 30 minutes');
  perform pg_temp.spring(b, s2, t, pb, base - interval '8 hours');
  update play_post set drawn = 5 where play = w1; update play_post set drawn = 3 where play = w2;
  -- staff play cards too: the mod on Ann's and Bob's posts, the Boss on the mod's post
  perform tests.act(modc, 'card', t, '{"card": "exsplat", "reach": "post"}', pa, base - interval '7 hours');
  perform tests.act(modc, 'card', t, '{"card": "exsweet", "reach": "post"}', pa, base - interval '7 hours' + interval '1 minute');
  perform tests.act(modc, 'card', t, '{"card": "exblot", "reach": "post"}', pa, base - interval '7 hours' + interval '2 minutes');
  perform tests.act(modc, 'card', t, '{"card": "exwink", "reach": "post"}', pa, base - interval '7 hours' + interval '3 minutes');
  perform tests.act(modc, 'card', t, '{"card": "exsweet", "reach": "post"}', pb, base - interval '7 hours' + interval '4 minutes');
  perform tests.act(modc, 'card', t, '{"card": "exblot", "reach": "post"}', pb, base - interval '7 hours' + interval '5 minutes');
  perform tests.act(modc, 'card', t, '{"card": "exwink", "reach": "post"}', pb, base - interval '7 hours' + interval '6 minutes');
  perform tests.act(modc, 'card', t, '{"card": "exsplat", "reach": "post"}', pb, base - interval '7 hours' + interval '7 minutes');
  for ck in select unnest(array['exsplat', 'exsweet', 'exblot', 'exwink']) loop
    perform tests.act(boss, 'card', tmod, jsonb_build_object('card', ck, 'reach', 'post'), pmod, base - interval '7 hours');
  end loop;
  insert into fx values ('s1', s1), ('s2', s2), ('w1', w1);

  -- spins: Bob spins from Ann's post (3 replies), Cat spins from Ann's splat on Bob's post, the Boss spins from Bob's post (its opener draws reactions)
  ts1 := pg_temp.spin(b, pa, 'Spun from a post', base - interval '8 hours', 3);
  ts2 := pg_temp.spin(c, w1, 'Spun from a card', base - interval '7 hours 30 minutes', 0);
  ts3 := pg_temp.spin(boss, pb, 'The Boss spins', base - interval '7 hours', 0);
  bspin := (select id from acts where thread = ts3 and kind = 'spin');
  insert into reaction_tallies (act, kind, count) values (bspin, 'wow', 3);
  insert into fx values ('ts1', ts1), ('ts2', ts2), ('ts3', ts3), ('bspin', bspin);
  -- the Boss's post carries a poll of its own with no voter
  pbp := pg_temp.mkpoll(tmod, pbs, boss, false, base + interval '1 day', base - interval '6 hours');

  -- conversations: the mod's turn in the window answers Bob's reply (which carries a poll) and Ann's; an earlier turn (three days back) answers Bob's again; a far one (ten days back) Ann's twice
  troot := pg_temp.root('dx-mod', tmod, base - interval '12 days');
  rb1 := tests.act(b, 'post', tmod, '{"body": "Bob replies to the mod"}', troot, base - interval '4 hours');
  ra1 := tests.act(a, 'post', tmod, '{"body": "Ann replies to the mod"}', troot, base - interval '3 hours 50 minutes');
  insert into fx values ('rb1', rb1);
  perform pg_temp.mkpoll(tmod, rb1, b, false, base + interval '1 day', base - interval '3 hours 55 minutes');
  perform pg_temp.turn('dx-mod', tmod, 'The mod answers Bob and Ann at length', array[rb1, ra1], base - interval '3 hours');
  rb2 := tests.act(b, 'post', tmod, '{"body": "Bob, three days back"}', troot, base - interval '3 days 1 hour');
  perform pg_temp.turn('dx-mod', tmod, 'The mod, three days back', array[rb2], base - interval '3 days');
  perform pg_temp.turn('dx-mod', tmod, 'The mod, ten days back', array[tests.act(a, 'post', tmod, '{"body": "Ann, long ago"}', troot, base - interval '10 days 1 hour'), tests.act(a, 'post', tmod, '{"body": "Ann, longer ago"}', troot, base - interval '10 days 2 hours')], base - interval '10 days');
  -- a staff reply the mod answered is no one's exchange
  perform set_config('kayfabb.staff_writer', 'on', true);
  rboss := tests.act(boss, 'post', tmod, '{"body": "The Boss asks"}', troot, base - interval '5 hours 30 minutes');
  perform pg_temp.turn('dx-mod', tmod, 'The mod answers the Boss', array[rboss], base - interval '5 hours');
  -- five more conversations, a day and a half back (inside two days, outside one), each answering Dee
  for i in 1..5 loop
    tt := tests.thread('Dx Conv ' || i);
    troot := pg_temp.root('dx-mod', tt, base - interval '12 days');
    perform pg_temp.turn('dx-mod', tt, 'A turn ' || i, array[tests.act(dd, 'post', tt, '{"body": "Dee asks"}', troot, base - interval '36 hours')], base - interval '35 hours' + i * interval '1 minute');
  end loop;
  -- quote pairs in the window: Bob quotes Ann twice, Cat once, Dee once; Ann quotes Bob once
  perform tests.act(b, 'post', t, '{"body": "q"}', pa, base - interval '1 hour'); perform tests.act(b, 'post', t, '{"body": "q"}', pa, base - interval '1 hour');
  perform tests.act(c, 'post', t, '{"body": "q"}', pa, base - interval '1 hour'); perform tests.act(dd, 'post', t, '{"body": "q"}', pa, base - interval '1 hour');
  perform tests.act(a, 'post', t, '{"body": "q"}', pb, base - interval '1 hour');
  perform set_config('kayfabb.staff_writer', '', true);

  d := pg_temp.digest(base - interval '1 day', base);

  -- ---- the Boss's reactions carry their post's words (cut as the excerpts are), its extras and its origin
  perform pg_temp.expect(jsonb_array_length(d -> 'bossReactions') = 2, 'the Boss reactions are not capped at digestExcerpts: ' || (d -> 'bossReactions')::text);
  e := d -> 'bossReactions' -> 0;
  perform pg_temp.expect((e ->> 'act')::uuid = pbs and e ->> 'text' = 'The Boss spe' and e -> 'cut' = 'true'::jsonb, 'the Boss reaction has no cut text: ' || e::text);
  perform pg_temp.expect(e #>> '{extras,poll,question}' = 'Best kart?' and e #>> '{extras,poll,voters}' = '0', 'the Boss reaction has no extras: ' || e::text);
  e := d -> 'bossReactions' -> 1;
  perform pg_temp.expect((e ->> 'act')::uuid = bspin and e ->> 'text' = 'Discuss.' and e -> 'cut' = 'false'::jsonb, 'the Boss spin reaction has no text: ' || e::text);
  perform pg_temp.expect(e #>> '{origin,kind}' = 'post' and e #>> '{origin,place,kind}' = 'post' and e #>> '{origin,place,title}' = 'Dx Main' and e -> 'origin' -> 'post' = 'null'::jsonb and e #>> '{origin,moment}' = 'false'
    and (e #>> '{origin,at}')::timestamptz = base - interval '19 hours' and (e #>> '{origin,spunAt}')::timestamptz = base - interval '7 hours', 'the spun opener has no origin: ' || e::text);
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys(e -> 'origin') k) = array['at', 'kind', 'moment', 'place', 'post', 'spunAt'], 'the origin keys: ' || (e -> 'origin')::text);

  -- ---- excerpts: the Boss's post and Ann's (5 reactions each, the newer first); Ann's carries her poll and the plays on it, an origin of null
  perform pg_temp.expect(jsonb_array_length(d -> 'excerpts') = 2 and (d #>> '{excerpts,0,act}')::uuid = pbs and (d #>> '{excerpts,1,act}')::uuid = pa, 'the excerpts are ' || (d -> 'excerpts')::text);
  e := d #> '{excerpts,1}';
  perform pg_temp.expect(e #>> '{extras,poll,voters}' = '3' and e #>> '{extras,poll,secret}' = 'false' and e #>> '{extras,poll,counts}' = '[3, 0]' and e -> 'origin' = 'null'::jsonb, 'the excerpt has no poll: ' || e::text);
  perform pg_temp.expect(jsonb_array_length(e #> '{extras,plays}') = 5 and exists (select 1 from jsonb_array_elements(e #> '{extras,plays}') p where p ->> 'play' = w2::text and p ->> 'by' = 'Dx Bob' and p ->> 'card' = 'exsweet'), 'the excerpt has no plays: ' || (e #> '{extras,plays}')::text);
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys(e -> 'extras') k) = array['plays', 'poll', 'reactions', 'rewoundTo'] and e #>> '{extras,reactions,up}' = '5', 'the extras keys: ' || (e -> 'extras')::text);

  -- ---- conversations: the exchange's reply carries its poll
  perform pg_temp.expect(jsonb_array_length(d -> 'conversations') = 1, 'the conversations are ' || (d -> 'conversations')::text);
  e := d #> '{conversations,0,exchange}';
  perform pg_temp.expect(e #>> '{reply,extras,poll,question}' = 'Best kart?' and e -> 'extras' is not null and e -> 'origin' = 'null'::jsonb and e #> '{reply,origin}' = 'null'::jsonb, 'the exchange has no extras: ' || e::text);

  -- ---- polls: the cap is digestPolls (3); P2 and P1 tie on voters (the newer P2 first), then P3
  x := d -> 'polls';
  perform pg_temp.expect(jsonb_typeof(x) = 'array', 'the digest has no polls list: ' || d::text);
  perform pg_temp.expect(jsonb_array_length(x) = 3 and (select array_agg((el ->> 'poll')::uuid order by o) from jsonb_array_elements(x) with ordinality z(el, o)) = array[p2, p1, p3], 'the polls are ' || x::text);
  e := x -> 0;
  perform pg_temp.expect(e ->> 'post' = pb::text and e ->> 'thread' = t::text and e ->> 'title' = 'Dx Main' and e ->> 'board' = 'General' and e #>> '{extras,poll,voters}' = '3' and e #>> '{extras,poll,secret}' = 'true'
    and (e ->> 'seq')::integer = (select seq from acts where id = pb), 'a poll row is ' || e::text);
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys(e) k) = array['board', 'extras', 'poll', 'post', 'seq', 'thread', 'title'], 'the poll row keys: ' || e::text);
  -- no voter's id or name, no secret ballot's id, anywhere in the polls; no secret ballot's id anywhere in the digest
  -- (a play on the post names its caster, as the board does; that is the plays' part, not the poll's)
  txt := (select jsonb_agg(el #- '{extras,plays}') from jsonb_array_elements(x) el)::text;
  perform pg_temp.expect(x::text !~ a::text and x::text !~ b::text and x::text !~ c::text and x::text !~ dd::text and txt !~ 'Dx (Ann|Bob|Cat|Dee)' and x::text !~ '"picks"', 'a poll names a voter: ' || x::text);
  foreach bl in array sec_ballots loop perform pg_temp.expect(d::text !~ bl::text, 'a secret ballot''s id is in the digest: ' || bl::text); end loop;
  -- a wider cap lists every poll open at any time in the window: P3 (2), Pearly (2, from five days back, still open), then the ones of one voter, the newest first (P1b, P4), then the two nobody voted on; not P4old (replaced), Pr (removed) or Pold (closed before the window)
  update settings set value = '10' where key = 'digestPolls';
  d := pg_temp.digest(base - interval '1 day', base);
  perform pg_temp.expect((select array_agg((el ->> 'poll')::uuid order by o) from jsonb_array_elements(d -> 'polls') with ordinality z(el, o) where o <= 6) = array[p2, p1, p3, pearly, p1b, p4]
    and jsonb_array_length(d -> 'polls') = 8 and (d #>> '{polls,6,extras,poll,voters}') = '0' and (d #>> '{polls,7,extras,poll,voters}') = '0', 'the wider polls are ' || (select string_agg(coalesce((select k from fx where v = (el ->> 'poll')::uuid), '?') || ':' || (el #>> '{extras,poll,voters}'), ',' order by o) from jsonb_array_elements(d -> 'polls') with ordinality z(el, o)));
  update settings set value = '3' where key = 'digestPolls';

  -- ---- spins: by replies then newest, the cap is digestSpins (2): the thread with replies, then the newer of the others
  x := d -> 'spins';
  perform pg_temp.expect(jsonb_typeof(x) = 'array', 'the digest has no spins list');
  perform pg_temp.expect(jsonb_array_length(x) = 2 and (x -> 0 ->> 'thread')::uuid = ts1 and (x -> 1 ->> 'thread')::uuid = ts3, 'the spins are ' || x::text);
  e := x -> 0;
  perform pg_temp.expect(e ->> 'title' = 'Spun from a post' and e #>> '{origin,kind}' = 'post' and e #>> '{origin,moment}' = 'false' and e -> 'origin' -> 'post' = 'null'::jsonb and (e #>> '{origin,at}')::timestamptz = base - interval '20 hours', 'a spin row is ' || e::text);
  update settings set value = '1' where key = 'digestSpins';
  perform pg_temp.expect(jsonb_array_length(pg_temp.digest(base - interval '1 day', base) -> 'spins') = 1, 'digestSpins does not cap the spins');
  update settings set value = '3' where key = 'digestSpins';
  x := pg_temp.digest(base - interval '1 day', base) -> 'spins';
  perform pg_temp.expect(jsonb_array_length(x) = 3 and (x -> 2 ->> 'thread')::uuid = ts2 and x #>> '{2,origin,kind}' = 'card' and x #>> '{2,origin,moment}' = 'true', 'the card spin is ' || x::text);
  update settings set value = '2' where key = 'digestSpins';

  -- ---- plays: an unsprung back is in no list; the cap is digestPlays (2): the most drawn first
  x := d -> 'plays';
  perform pg_temp.expect(jsonb_typeof(x) = 'array', 'the digest has no plays list');
  perform pg_temp.expect(jsonb_array_length(x) = 2 and (x -> 0 ->> 'play')::uuid = w1 and (x -> 1 ->> 'play')::uuid = w2, 'the plays are ' || x::text);
  e := x -> 0;
  perform pg_temp.expect(e ->> 'card' = 'exsplat' and e ->> 'by' = 'Dx Ann' and e ->> 'post' = pb::text and e ->> 'thread' = t::text and e ->> 'title' = 'Dx Main' and (e ->> 'seq')::integer = (select seq from acts where id = pb)
    and (e ->> 'at')::timestamptz = base - interval '12 hours', 'a play row is ' || e::text);
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys(e) k) = array['at', 'by', 'card', 'config', 'covered', 'play', 'post', 'seq', 'state', 'text', 'thread', 'title'], 'the play row keys: ' || e::text);
  update settings set value = '20' where key = 'digestPlays';
  d := pg_temp.digest(base - interval '1 day', base);
  x := d -> 'plays';
  -- the mod's and the Boss's plays are plays too: sixteen in force on the posts of the window, the ones the board draws; the unsprung back and the caught play are not among them
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(x) p where p ->> 'play' in (s1::text, w3::text)), 'an unsprung back or a caught play is a play: ' || x::text);
  perform pg_temp.expect(exists (select 1 from jsonb_array_elements(x) p where p ->> 'play' = s2::text and p ->> 'card' = 'exback' and p ->> 'by' = 'Dx Bob'), 'the sprung back is not a play naming its card: ' || x::text);
  perform pg_temp.expect(exists (select 1 from jsonb_array_elements(x) p where p ->> 'play' = w4::text), 'a landed play is missing: ' || x::text);
  perform pg_temp.expect(d::text !~ s1::text, 'an unsprung back''s id is in the digest');
  -- cards played: Bob's splat... Bob 2 (a sweet and the back that sprang), Ann 1 (the unsprung back is no play), Cat 1 (the caught one is none); the mod and the Boss never stand out
  perform pg_temp.expect(pg_temp.top(d, 'cards') = 'Dx Bob:2,Dx Ann:1,Dx Cat:1', 'cards played: ' || pg_temp.top(d, 'cards'));
  -- received: Bob 6 (Ann's splat, the mod's four and the back that sprang), Ann 5 (Bob's sweet and the mod's four), Dee 1; the mod's post, played on by the Boss, is not listed
  perform pg_temp.expect(pg_temp.top(d, 'received') = 'Dx Bob:6,Dx Ann:5,Dx Dee:1', 'received: ' || pg_temp.top(d, 'received'));
  update settings set value = '2' where key = 'digestPlays';

  -- ---- standouts
  perform pg_temp.expect((d #>> '{standouts,days}')::integer = 7, 'the standouts span: ' || (d -> 'standouts')::text);
  -- polls started: Ann 3 (P1, P1b, the removed one's first Act), Bob 3 (P2, Pold, the poll on his reply), then Cat (P3, Pearly) and Dee (P4old, P4) with 2: the cut keeps Cat by name; the Boss's poll is no one's
  perform pg_temp.expect(pg_temp.top(d, 'polls') = 'Dx Ann:3,Dx Bob:3,Dx Cat:2', 'polls started: ' || pg_temp.top(d, 'polls'));
  -- ballots: a secret ballot never counts: Dee voted only secretly and is not listed; Cat counts one (the public one), not three
  perform pg_temp.expect(pg_temp.top(d, 'ballots') = 'Dx Bob:2,Dx Ann:1,Dx Cat:1', 'ballots: ' || pg_temp.top(d, 'ballots'));
  perform pg_temp.expect(d #>> '{standouts,ballots}' !~ dd::text, 'a secret voter stands out: ' || (d #> '{standouts,ballots}')::text);
  -- spun: Ann 2 (her post and her card were spun from), Bob 1 (the Boss spun from his post)
  perform pg_temp.expect(pg_temp.top(d, 'spun') = 'Dx Ann:2,Dx Bob:1', 'spun: ' || pg_temp.top(d, 'spun'));
  -- exchanges: Dee 5 (the five conversations), Bob 2 (this window's turn and three days back), Ann 1 (not the ten-day-old ones, outside the span); the Boss's reply the mod answered is not counted
  perform pg_temp.expect(pg_temp.top(d, 'exchanges') = 'Dx Dee:5,Dx Bob:2,Dx Ann:1', 'exchanges: ' || pg_temp.top(d, 'exchanges'));
  perform pg_temp.expect(not exists (select 1 from jsonb_each(d -> 'standouts') s(k, v) where jsonb_typeof(v) = 'array' and exists (select 1 from jsonb_array_elements(v) el where (el ->> 'character')::uuid in (boss, modc))),
    'a staff character stands out: ' || (d -> 'standouts')::text);
  perform pg_temp.expect((select max(jsonb_array_length(v)) from jsonb_each(d -> 'standouts') s(k, v) where jsonb_typeof(v) = 'array') <= 3, 'a standouts list is longer than three');
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys(d -> 'standouts' -> 'cards' -> 0) k) = array['character', 'count', 'name'], 'the standout keys');

  -- ---- an unsprung back that springs is a play, counts once, and joins the lists
  perform pg_temp.spring(a, s1, t, pq, base - interval '1 hour 30 minutes');
  d := pg_temp.digest(base - interval '1 day', base);
  perform pg_temp.expect(pg_temp.top(d, 'cards') = 'Dx Ann:2,Dx Bob:2,Dx Cat:1', 'cards played after the spring: ' || pg_temp.top(d, 'cards'));
  update settings set value = '20' where key = 'digestPlays';
  d := pg_temp.digest(base - interval '1 day', base);
  perform pg_temp.expect(exists (select 1 from jsonb_array_elements(d -> 'plays') p where p ->> 'play' = s1::text and p ->> 'card' = 'exback' and p ->> 'by' = 'Dx Ann'), 'the back that sprang is not a play: ' || (d -> 'plays')::text);
  update settings set value = '2' where key = 'digestPlays';

  -- ---- digest_standouts reads `acts` directly (for cost) and re-implements acts_public's masks: on this fixture every category's top three is what a plain read through acts_public gives
  foreach ck in array array['cards', 'received', 'polls', 'ballots', 'spun'] loop
    perform pg_temp.expect(pg_temp.top(d, ck) = pg_temp.plain_top(ck, base - interval '7 days', base) and pg_temp.top(d, ck) <> '',
      'the standouts drifted from acts_public in ' || ck || ': digest ' || pg_temp.top(d, ck) || ', acts_public ' || pg_temp.plain_top(ck, base - interval '7 days', base));
  end loop;

  -- ---- a two-day window: the top posts' cap doubles (4), the conversations' (4 of 6) and threads' scale; moves', quotes' and the Boss's reactions' caps stay at the setting (2)
  d := pg_temp.digest(base - interval '2 days', base);
  perform pg_temp.expect(jsonb_array_length(d -> 'excerpts') = 4, 'a two-day window does not double the top posts: ' || jsonb_array_length(d -> 'excerpts'));
  perform pg_temp.expect(jsonb_array_length(d -> 'conversations') = 4, 'a two-day window does not double the conversations: ' || jsonb_array_length(d -> 'conversations'));
  perform pg_temp.expect(jsonb_array_length(d -> 'quotes') = 2, 'a two-day window grew the quotes: ' || (d -> 'quotes')::text);
  perform pg_temp.expect(jsonb_array_length(d -> 'bossReactions') = 2, 'a two-day window grew the Boss''s reactions: ' || (d -> 'bossReactions')::text);
  perform pg_temp.expect(jsonb_array_length(d -> 'threads') = 6, 'a two-day window does not double the threads: ' || jsonb_array_length(d -> 'threads'));
  perform pg_temp.expect(jsonb_array_length(pg_temp.digest(base - interval '1 day', base) -> 'threads') = 3, 'a day''s window is not capped at digestThreads');
  -- a window of a day and an hour is two days (rounded up); one of an hour is one
  perform pg_temp.expect(jsonb_array_length(pg_temp.digest(base - interval '25 hours', base) -> 'excerpts') = 4, 'a window of 25 hours is not two days');
  perform pg_temp.expect(jsonb_array_length(pg_temp.digest(base - interval '1 hour', base) -> 'excerpts') = 2, 'a window of an hour is not one day');
end $$;

-- ---- 4. the ceilings: a window of two days with the settings at their most
do $$
declare
  base timestamptz := '2048-03-10T12:00:00Z';
  chars uuid[]; th uuid; p uuid; i integer; j integer; d jsonb; ts uuid; troot uuid; tt uuid; w uuid; po uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into settings (key, value) values ('digestExcerptChars', '30'), ('digestExcerpts', '20'), ('digestThreads', '20'), ('digestConversations', '12'),
    ('digestPolls', '20'), ('digestSpins', '20'), ('digestPlays', '20'), ('digestStandoutDays', '7')
  on conflict (key) do update set value = excluded.value;
  for i in 1..5 loop chars := chars || tests.character(tests.account('dxc-' || i), 'Dxc ' || i); end loop;
  -- 26 threads with one reacted post each; the first 13 are answered by the mod; 22 of the posts carry a poll with i voters, a play and a spin
  for i in 1..26 loop
    th := tests.thread('Dxc thread ' || i);
    p := tests.post(chars[1 + i % 5], th, 'Ceiling post ' || i, base - interval '30 hours' + i * interval '1 minute');
    insert into reaction_tallies (act, kind, count) values (p, 'up', i);
    if i <= 22 then
      po := tests.act(chars[1 + i % 5], 'poll', th, jsonb_build_object('question', 'Q ' || i, 'options', '["a", "b"]'::jsonb, 'pick', 1, 'secret', false, 'closes_at', base + interval '1 day'), p, base - interval '29 hours' + i * interval '1 minute');
      for j in 1..(i % 5) loop perform tests.act(chars[1 + (i + j) % 5], 'ballot', th, '{"picks": [0]}', po, base - interval '28 hours' + i * interval '1 minute' + j * interval '1 second'); end loop;
      w := tests.act(chars[1 + (i + 1) % 5], 'card', th, '{"card": "exsplat", "reach": "post"}', p, base - interval '27 hours' + i * interval '1 minute');
      update play_post set drawn = i where play = w;
      perform pg_temp.spin(chars[1 + (i + 2) % 5], p, 'Dxc spin ' || i, base - interval '26 hours' + i * interval '1 minute', i % 3);
    end if;
    if i <= 13 then
      troot := pg_temp.root('dx-mod', th, base - interval '12 days');
      perform pg_temp.turn('dx-mod', th, 'Ceiling turn ' || i, array[tests.act(chars[1 + (i + 3) % 5], 'post', th, '{"body": "reply"}', troot, base - interval '29 hours' + i * interval '1 minute')], base - interval '28 hours' + i * interval '1 minute');
    end if;
  end loop;
  d := pg_temp.digest(base - interval '2 days', base);
  perform pg_temp.expect(jsonb_array_length(d -> 'threads') = 25, 'the threads are held to 25: ' || jsonb_array_length(d -> 'threads'));
  perform pg_temp.expect(jsonb_array_length(d -> 'excerpts') = 20, 'the top posts are held to 20: ' || jsonb_array_length(d -> 'excerpts'));
  perform pg_temp.expect(jsonb_array_length(d -> 'conversations') = 12, 'the conversations are held to 12: ' || jsonb_array_length(d -> 'conversations'));
  perform pg_temp.expect(jsonb_array_length(d -> 'polls') = 20, 'the polls are held to 20: ' || jsonb_array_length(d -> 'polls'));
  perform pg_temp.expect(jsonb_array_length(d -> 'spins') = 20, 'the spins are held to 20: ' || jsonb_array_length(d -> 'spins'));
  perform pg_temp.expect(jsonb_array_length(d -> 'plays') = 20, 'the plays are held to 20: ' || jsonb_array_length(d -> 'plays'));
  perform pg_temp.expect((select max(jsonb_array_length(v)) from jsonb_each(d -> 'standouts') s(k, v) where jsonb_typeof(v) = 'array') = 3, 'the standouts are held to 3: ' || (d -> 'standouts')::text);
  -- the polls' order: the most voters, then the newest
  perform pg_temp.expect((select bool_and((d -> 'polls' -> (n - 1) #>> '{extras,poll,voters}')::integer >= (d -> 'polls' -> n #>> '{extras,poll,voters}')::integer) from generate_series(1, 19) n), 'the polls are not in the order of their voters');
  perform pg_temp.expect((select max((el #>> '{extras,poll,voters}')::integer) from jsonb_array_elements(d -> 'polls') el) = 4, 'the polls with the most voters are not kept');
end $$;

-- ---- 6. what the spec review found
do $$
declare
  base timestamptz := '2049-03-10T12:00:00Z';
  aa uuid := tests.account('dx6-ann'); ab uuid := tests.account('dx6-bob'); ac uuid := tests.account('dx6-cat'); ad uuid := tests.account('dx6-dee'); adm uuid := tests.account('dx6-admin');
  a uuid := tests.character(aa, 'Dx6 Ann'); b uuid := tests.character(ab, 'Dx6 Bob'); c uuid := tests.character(ac, 'Dx6 Cat'); dd uuid := tests.character(ad, 'Dx6 Dee');
  t uuid := tests.thread('Dx6 Main');
  hp uuid; p1 uuid; p2 uuid; p3 uuid; hq uuid; q1 uuid; q2 uuid; hw uuid; w1 uuid; w2 uuid; wend uuid; wcaught uuid; wfirst uuid;
  ub uuid; sprung uuid; sloose uuid; ts uuid; tfrom uuid; d jsonb; x jsonb; e jsonb;
begin
  insert into settings (key, value) values ('digestExcerptChars', '30'), ('digestExcerpts', '20'), ('digestThreads', '20'), ('digestConversations', '4'),
    ('digestPolls', '2'), ('digestSpins', '20'), ('digestPlays', '2'), ('digestStandoutDays', '7')
  on conflict (key) do update set value = excluded.value;
  perform set_config('kayfabb.staff_writer', 'on', true);
  hp := tests.post(a, t, 'A post an admin hides.', base - interval '10 hours');
  p1 := tests.post(b, t, 'A post the board shows.', base - interval '9 hours');
  p2 := tests.post(c, t, 'Another post the board shows.', base - interval '8 hours');
  p3 := tests.post(a, t, 'Ann''s own post for a back.', base - interval '11 hours');
  insert into admins (account) values (adm);
  insert into conduct_decisions (version_act, post, admin, outcome) values (hp, hp, adm, 'hide');

  -- ---- 1. a hidden post's poll and play use up none of a list's cap (digestPolls 2, digestPlays 2): the hidden post's poll has the most voters and its play the most drawn, so each would come first
  hq := pg_temp.mkpoll(t, hp, a, false, base + interval '1 day', base - interval '10 hours' + interval '1 minute');
  q1 := pg_temp.mkpoll(t, p1, b, false, base + interval '1 day', base - interval '9 hours' + interval '1 minute');
  q2 := pg_temp.mkpoll(t, p2, c, false, base + interval '1 day', base - interval '8 hours' + interval '1 minute');
  perform pg_temp.vote(hq, b, base - interval '7 hours'); perform pg_temp.vote(hq, c, base - interval '7 hours' + interval '1 minute'); perform pg_temp.vote(hq, dd, base - interval '7 hours' + interval '2 minutes');
  perform pg_temp.vote(q1, a, base - interval '7 hours');
  hw := tests.act(b, 'card', t, '{"card": "exsplat", "reach": "post"}', hp, base - interval '6 hours');
  w1 := tests.act(c, 'card', t, '{"card": "exsweet", "reach": "post"}', p1, base - interval '5 hours');
  w2 := tests.act(dd, 'card', t, '{"card": "exblot", "reach": "post"}', p2, base - interval '4 hours');
  update play_post set drawn = 9 where play = hw; update play_post set drawn = 2 where play = w1; update play_post set drawn = 1 where play = w2;
  d := pg_temp.digest(base - interval '1 day', base);
  perform pg_temp.expect((select array_agg((el ->> 'poll')::uuid order by o) from jsonb_array_elements(d -> 'polls') with ordinality z(el, o)) = array[q1, q2], '1 a hidden post''s poll is listed or used up the cap: ' || (d -> 'polls')::text);
  perform pg_temp.expect((select array_agg((el ->> 'play')::uuid order by o) from jsonb_array_elements(d -> 'plays') with ordinality z(el, o)) = array[w1, w2], '1 a hidden post''s play is listed or used up the cap: ' || (d -> 'plays')::text);

  -- ---- 2. the plays are those played in the window, whatever became of them since (digestPlays 20): one that ended before the window's end, a back that sprang with no lockout, a back that sprang into one; not an unsprung back, a caught play, or the hidden post's
  update settings set value = '20' where key = 'digestPlays';
  wend := tests.act(c, 'card', t, '{"card": "exwink", "reach": "post", "config": {"k": 1}}', p2, base - interval '3 hours');
  update play_post set over_at = base - interval '2 hours', ends_at = base - interval '2 hours', drawn = 4 where play = wend;
  wcaught := tests.act(c, 'card', t, '{"card": "exwink", "reach": "post", "caught": "x"}', p2, base - interval '3 hours' + interval '1 minute');
  ub := pg_temp.back(b, ab, t, p1, 11, base - interval '3 hours');
  sloose := pg_temp.back(c, ac, t, p2, 12, base - interval '2 hours 30 minutes');
  perform tests.act(c, 'spring', t, jsonb_build_object('set', sloose::text, 'card', 'exback', 'trigger', 'quote', 'did', 'landed'), p2, base - interval '2 hours');
  sprung := pg_temp.back(a, aa, t, p3, 13, base - interval '2 hours');
  perform pg_temp.spring(a, sprung, t, p3, base - interval '1 hour 30 minutes');
  d := pg_temp.digest(base - interval '1 day', base);
  x := d -> 'plays';
  perform pg_temp.expect(exists (select 1 from jsonb_array_elements(x) p where p ->> 'play' = wend::text and p ->> 'card' = 'exwink' and p ->> 'by' = 'Dx6 Cat' and p -> 'config' = '{"k": 1}'::jsonb), '2 a play that ended before the end of the window is not listed: ' || x::text);
  perform pg_temp.expect(exists (select 1 from jsonb_array_elements(x) p where p ->> 'play' = sloose::text and p ->> 'card' = 'exback' and p ->> 'by' = 'Dx6 Cat'), '2 a back that sprang with no lockout is not listed: ' || x::text);
  perform pg_temp.expect(exists (select 1 from jsonb_array_elements(x) p where p ->> 'play' = sprung::text and p ->> 'card' = 'exback'), '2 a back that sprang into a lockout is not listed: ' || x::text);
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(x) p where p ->> 'play' in (ub::text, wcaught::text, hw::text)), '2 an unsprung back, a caught play or a hidden post''s play is listed: ' || x::text);
  perform pg_temp.expect(d::text !~ ub::text and d::text !~ wcaught::text, '2 an unsprung back''s or a caught play''s id is in the digest');
  -- the order: the most drawn (the ended play drew 4, w1 2, w2 1, the rest 0), then newest
  perform pg_temp.expect((x #>> '{0,play}')::uuid = wend and (x #>> '{1,play}')::uuid = w1 and (x #>> '{2,play}')::uuid = w2, '2 the plays are not most drawn first: ' || x::text);
  e := x -> 0;
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys(e) k) = array['at', 'by', 'card', 'config', 'covered', 'play', 'post', 'seq', 'state', 'text', 'thread', 'title'] and e ->> 'post' = p2::text and e ->> 'title' = 'Dx6 Main'
    and (e ->> 'seq')::integer = (select seq from acts where id = p2) and (e ->> 'at')::timestamptz = base - interval '3 hours', '2 the play row is ' || e::text);
  -- it reads nothing against now(): the same window's plays are the same whenever it is read (these are in 2049, this transaction's now() is before them)
  perform pg_temp.expect(jsonb_array_length(x) = 5, '2 the plays are not the five played in the window: ' || jsonb_array_length(x));
  update settings set value = '2' where key = 'digestPlays';

  -- ---- 4. a thread spun from a face-down set: not listed (nor counted) while the set has not sprung, listed with its origin and counted once it has (the spring is the set's reveal)
  tfrom := pg_temp.spin(dd, p2, 'Dx6 from a post', base - interval '7 hours', 1);
  ts := pg_temp.spin(c, ub, 'Dx6 from a set', base - interval '5 hours', 2);
  d := pg_temp.digest(base - interval '1 day', base);
  perform pg_temp.expect((select array_agg((el ->> 'thread')::uuid order by o) from jsonb_array_elements(d -> 'spins') with ordinality z(el, o)) = array[tfrom], '4 a thread spun from an unsprung set is listed: ' || (d -> 'spins')::text);
  perform pg_temp.expect(pg_temp.top(d, 'spun') = 'Dx6 Cat:1', '4 an unsprung set''s spin is counted: ' || pg_temp.top(d, 'spun'));
  perform pg_temp.spring(b, ub, t, p1, base - interval '1 hour');
  d := pg_temp.digest(base - interval '1 day', base);
  x := d -> 'spins';
  perform pg_temp.expect((select array_agg((el ->> 'thread')::uuid order by o) from jsonb_array_elements(x) with ordinality z(el, o)) = array[ts, tfrom], '4 a thread spun from a set that sprang is not listed: ' || x::text);
  perform pg_temp.expect(x #>> '{0,origin,kind}' = 'set' and x #>> '{0,origin,moment}' = 'true' and x #> '{0,origin,post}' = 'null'::jsonb and (x #>> '{0,origin,at}')::timestamptz = base - interval '3 hours', '4 the sprung set''s origin is ' || (x -> 0)::text);
  perform pg_temp.expect(pg_temp.top(d, 'spun') = 'Dx6 Bob:1,Dx6 Cat:1', '4 a sprung set''s spin is not counted: ' || pg_temp.top(d, 'spun'));
end $$;

-- ---- 7. what the quality review found: the standouts' own reading of `acts` agrees with acts_public's under an author veil, with a refunded write and with a spring that carries `caught`
-- A veil (post_veils; the cover rows its triggers write) hides the author V of a post PV: every Act of V's on it, the post itself and the spins from it are the stand-in's, a staff character that never stands out. The ballots are covered by a cover
-- row written by hand (no trigger covers a ballot: the live ones reach it only by a veil on the poll's own id), so the helper's clause for them is driven too.
do $$
declare
  base timestamptz := '2050-03-10T12:00:00Z';
  av uuid := tests.account('dx7-vee'); axa uuid := tests.account('dx7-xa'); axb uuid := tests.account('dx7-xb'); axc uuid := tests.account('dx7-xc'); ar uuid := tests.account('dx7-aa');
  v uuid := tests.character(av, 'Dx7 Vee'); xa uuid := tests.character(axa, 'Dx7 Xa'); xb uuid := tests.character(axb, 'Dx7 Xb'); xc uuid := tests.character(axc, 'Dx7 Xc'); r uuid := tests.character(ar, 'Dx7 Aa');
  t uuid := tests.thread('Dx7 Main');
  px1 uuid; px2 uuid; px3 uuid; pv uuid; vplay uuid; po1 uuid; po2 uuid; po3 uuid; vb1 uuid; vb2 uuid;
  wr uuid; sc uuid; sp uuid; cast_ uuid; stand uuid; d jsonb; x jsonb; ck text;
begin
  insert into settings (key, value) values ('digestExcerptChars', '30'), ('digestExcerpts', '20'), ('digestThreads', '20'), ('digestConversations', '4'),
    ('digestPolls', '20'), ('digestSpins', '20'), ('digestPlays', '20'), ('digestStandoutDays', '7')
  on conflict (key) do update set value = excluded.value;
  perform set_config('kayfabb.staff_writer', 'on', true);
  -- the stand-in, as seed_instance makes it
  select c.id into stand from characters c where c.staff_kind = 'anonymous';
  if stand is null then
    insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning characters.id into stand;
    insert into character_profiles (character, title, signature) values (stand, 'Could be anyone.', '');
  end if;
  px1 := tests.post(xa, t, 'Xa''s post', base - interval '20 hours');
  px2 := tests.post(xb, t, 'Xb''s post', base - interval '19 hours');
  px3 := tests.post(xc, t, 'Xc''s post', base - interval '18 hours');
  pv := tests.post(v, t, 'Vee''s post, which will be veiled', base - interval '17 hours');
  -- the veil: Xa's cast on PV, an author veil live for a month
  vplay := tests.act(xa, 'card', t, '{"card": "exsplat", "reach": "post"}', pv, base - interval '16 hours');
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (vplay, pv, 'author', v, axa, now() + interval '30 days');
  -- what Vee does on the veiled post (covered), what others do to it, and what is spun from it
  perform tests.act(v, 'card', t, '{"card": "exsweet", "reach": "post"}', pv, base - interval '15 hours');
  perform tests.act(v, 'card', t, '{"card": "exblot", "reach": "post"}', pv, base - interval '15 hours' + interval '1 minute');
  perform tests.act(xa, 'card', t, '{"card": "exwink", "reach": "post"}', pv, base - interval '14 hours');
  perform tests.act(xa, 'card', t, '{"card": "exwink", "reach": "post"}', pv, base - interval '14 hours' + interval '1 minute');
  perform pg_temp.mkpoll(t, pv, v, false, base + interval '2 days', base - interval '13 hours');
  perform pg_temp.mkpoll(t, pv, v, false, base + interval '2 days', base - interval '13 hours' + interval '1 minute');
  perform pg_temp.spin(xb, pv, 'Dx7 spun from the veiled post', base - interval '12 hours');
  perform pg_temp.spin(xc, pv, 'Dx7 spun again from it', base - interval '12 hours' + interval '1 minute');
  -- the others' plain play: a card each, a poll each, a ballot each, a thread spun from their own post each
  perform tests.act(xa, 'card', t, '{"card": "exsplat", "reach": "post"}', px2, base - interval '11 hours');
  perform tests.act(xb, 'card', t, '{"card": "exsweet", "reach": "post"}', px3, base - interval '11 hours' + interval '1 minute');
  perform tests.act(xc, 'card', t, '{"card": "exblot", "reach": "post"}', px1, base - interval '11 hours' + interval '2 minutes');
  po1 := pg_temp.mkpoll(t, px1, xa, false, base + interval '2 days', base - interval '10 hours');
  po2 := pg_temp.mkpoll(t, px2, xb, false, base + interval '2 days', base - interval '10 hours' + interval '1 minute');
  po3 := pg_temp.mkpoll(t, px3, xc, false, base + interval '2 days', base - interval '10 hours' + interval '2 minutes');
  perform pg_temp.vote(po2, xa, base - interval '9 hours'); perform pg_temp.vote(po3, xb, base - interval '9 hours' + interval '1 minute'); perform pg_temp.vote(po1, xc, base - interval '9 hours' + interval '2 minutes');
  vb1 := pg_temp.vote(po1, v, base - interval '8 hours'); vb2 := pg_temp.vote(po2, v, base - interval '8 hours' + interval '1 minute');
  insert into post_veil_cover (act, play) values (vb1, vplay), (vb2, vplay);
  perform pg_temp.spin(xa, px1, 'Dx7 Xa spins', base - interval '7 hours');
  perform pg_temp.spin(xb, px2, 'Dx7 Xb spins', base - interval '7 hours' + interval '1 minute');
  perform pg_temp.spin(xc, px3, 'Dx7 Xc spins', base - interval '7 hours' + interval '2 minutes');
  -- a writing card whose write was refunded (0149: the row in card_write_refunds is what acts_public calls `untaken`): no play, never counted
  wr := tests.act(r, 'card', t, '{"card": "exsplat", "reach": "post"}', px1, base - interval '6 hours');
  insert into card_write_refunds (play, amount) values (wr, 0);
  -- a back that caught a cast: its spring carries `caught` and is a real spring, so Xc's set on her own post is a play and the spring counts once as a card and once received
  sc := pg_temp.back(xc, axc, t, px3, 21, base - interval '5 hours');
  -- as place_cast writes it (0054:352, 0148:287): the cast that was caught is a card Act carrying `caught` = its set, and the spring's `caught` (and `by`) is that cast Act's id
  cast_ := tests.act(xb, 'card', t, jsonb_build_object('card', 'exwink', 'reach', 'post', 'caught', sc::text), px3, base - interval '4 hours 30 minutes');
  sp := tests.act(xc, 'spring', t, jsonb_build_object('set', sc::text, 'card', 'exback', 'trigger', 'cast', 'did', 'caught', 'by', cast_::text, 'caught', cast_::text), px3, base - interval '4 hours');

  d := pg_temp.digest(base - interval '1 day', base);
  x := d -> 'plays';
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(x) p where p ->> 'play' = wr::text), '7 a play whose write was refunded is listed: ' || x::text);
  perform pg_temp.expect(exists (select 1 from jsonb_array_elements(x) p where p ->> 'play' = sc::text and p ->> 'card' = 'exback' and p ->> 'by' = 'Dx7 Xc'), '7 a back that caught a cast is not a play naming its card: ' || x::text);
  perform pg_temp.expect(d::text !~ wr::text, '7 a refunded play''s id is in the digest');
  perform pg_temp.expect(pg_temp.top(d, 'cards') = 'Dx7 Xa:4,Dx7 Xc:2,Dx7 Xb:1', '7 cards played: ' || pg_temp.top(d, 'cards'));
  perform pg_temp.expect(pg_temp.top(d, 'received') = 'Dx7 Xc:2,Dx7 Xa:1,Dx7 Xb:1', '7 received: ' || pg_temp.top(d, 'received'));
  perform pg_temp.expect(pg_temp.top(d, 'polls') = 'Dx7 Xa:1,Dx7 Xb:1,Dx7 Xc:1', '7 polls: ' || pg_temp.top(d, 'polls'));
  perform pg_temp.expect(pg_temp.top(d, 'ballots') = 'Dx7 Xa:1,Dx7 Xb:1,Dx7 Xc:1', '7 ballots: ' || pg_temp.top(d, 'ballots'));
  perform pg_temp.expect(pg_temp.top(d, 'spun') = 'Dx7 Xa:1,Dx7 Xb:1,Dx7 Xc:1', '7 spun: ' || pg_temp.top(d, 'spun'));
  perform pg_temp.expect((d #>> '{standouts}') !~ v::text and (d #>> '{standouts}') !~ stand::text, '7 the veiled author or the stand-in stands out: ' || (d -> 'standouts')::text);
  -- digest_origin, the one predicate of whether the board shows an origin: a post, always; a set, once a spring Act names it (the spring's `caught` changes nothing); a set nobody has sprung, never
  perform pg_temp.expect((select count(*) from digest_origin(px1)) = 1 and (select o.kind from digest_origin(px1) o) = 'post' and (select o.made_at from digest_origin(px1) o) = base - interval '20 hours', '7 digest_origin of a post');
  perform pg_temp.expect((select o.kind from digest_origin(sc) o) = 'set', '7 digest_origin of a set that sprang');
  perform pg_temp.expect(not exists (select 1 from digest_origin(pg_temp.back(xb, axb, t, px2, 22, base - interval '3 hours'))), '7 digest_origin of a set that has not sprung');
  foreach ck in array array['cards', 'received', 'polls', 'ballots', 'spun'] loop
    perform pg_temp.expect(pg_temp.top(d, ck) = pg_temp.plain_top(ck, base - interval '7 days', base) and pg_temp.top(d, ck) <> '',
      '7 the standouts drifted from acts_public in ' || ck || ' under a veil: digest ' || pg_temp.top(d, ck) || ', acts_public ' || pg_temp.plain_top(ck, base - interval '7 days', base));
  end loop;
end $$;

-- ---- 8. digest_origin of a set whose spring names it but targets another post
-- A spring Act is written on the post of the set it springs (0054:350: target = face_down.post), so a spring that names a set and targets a different post is not that set's spring: the board shows no origin for the set, and
-- digest_origin answers nothing (its branch `sp.target_act_id = o.target_act_id`). A set with a spring on its own post is shown, whatever else names it. The standouts' `spun` and the spins read the same predicate, never play_post.sprung
-- (which is true for any spring naming the set): a thread spun from the mis-sprung set is neither a spin nor a standout.
do $$
declare
  base timestamptz := '2052-03-12T12:00:00Z';
  a1 uuid := tests.account('dx8-xa'); c1 uuid := tests.character(a1, 'Dx8 Xa');
  t uuid := tests.thread('Dx8 Main');
  pa uuid; pb uuid; s_ok uuid; s_bad uuid; th uuid; d jsonb;
begin
  insert into settings (key, value) values ('digestSpins', '20'), ('digestStandoutDays', '7') on conflict (key) do update set value = excluded.value;
  pa := tests.post(c1, t, 'Dx8 A', base - interval '10 hours');
  pb := tests.post(c1, t, 'Dx8 B', base - interval '10 hours' + interval '1 minute');
  s_ok := pg_temp.back(c1, a1, t, pa, 31, base - interval '9 hours');
  perform pg_temp.spring(c1, s_ok, t, pa, base - interval '8 hours');
  s_bad := pg_temp.back(c1, a1, t, pa, 32, base - interval '9 hours' + interval '1 minute');
  -- acts_well_formed refuses such a spring, so the row is forced past its trigger (this transaction's own role setting), and play_post is refreshed as the app's trigger would for a spring naming the set: sprung there, where the board shows nothing
  set local session_replication_role = replica;
  perform pg_temp.spring(c1, s_bad, t, pb, base - interval '8 hours' + interval '1 minute');
  set local session_replication_role = origin;
  perform refresh_play_post(s_bad);
  perform pg_temp.expect((select p.sprung from play_post p where p.play = s_bad), '8 the fixture: play_post.sprung is true for the mis-targeted spring');
  perform pg_temp.expect((select o.kind from digest_origin(s_ok) o) = 'set', '8 digest_origin of a set sprung on its own post');
  perform pg_temp.expect(not exists (select 1 from digest_origin(s_bad)), '8 digest_origin of a set whose spring names it but targets another post');
  th := pg_temp.spin(c1, s_bad, 'Dx8 spun from the mis-sprung set', base - interval '7 hours');
  perform pg_temp.expect(not exists (select 1 from digest_spins(base - interval '1 day', base, 20) x where x.thread = th), '8 digest_spins lists a thread whose origin the board does not show');
  perform pg_temp.expect(not exists (select 1 from digest_standouts(base - interval '1 day', base) x where x.category = 'spun' and x."character" = c1), '8 a thread spun from a set whose spring the board does not show is counted as spun');
  perform pg_temp.spin(c1, s_ok, 'Dx8 spun from the sprung set', base - interval '6 hours');
  perform pg_temp.expect((select x.n from digest_standouts(base - interval '1 day', base) x where x.category = 'spun' and x."character" = c1) = 1, '8 the thread spun from the sprung set is not counted as the character''s one spin');
end $$;

-- ---- 5. the security
do $$
declare f text; r text;
begin
  foreach f in array array['digest_standouts(timestamptz,timestamptz)', 'digest_polls(timestamptz,timestamptz)', 'digest_origin(uuid)', 'digest_spins(timestamptz,timestamptz,integer)', 'digest_plays(timestamptz,timestamptz,integer)'] loop
    perform pg_temp.expect(has_function_privilege('kayfabb_digest', f, 'execute'), f || ' is not the digest role''s to run');
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      perform pg_temp.expect(not has_function_privilege(r, f, 'execute'), r || ' can run ' || f);
    end loop;
    perform pg_temp.expect((select o.rolname from pg_proc p join pg_roles o on o.oid = p.proowner where p.oid = f::regprocedure) <> 'kayfabb_digest', f || ' is owned by the digest role');
    perform pg_temp.expect((select p.prosecdef and p.proconfig @> array['search_path=public, pg_temp'] from pg_proc p where p.oid = f::regprocedure), f || ' is not a definer with a fixed search path');
  end loop;
  perform pg_temp.expect((select o.rolname from pg_proc p join pg_roles o on o.oid = p.proowner where p.oid = 'system_digest(timestamptz, timestamptz)'::regprocedure) = 'kayfabb_digest', 'system_digest is not owned by the digest role');
  perform pg_temp.expect(has_function_privilege('service_role', 'system_digest(timestamptz, timestamptz)', 'execute') and not has_function_privilege('authenticated', 'system_digest(timestamptz, timestamptz)', 'execute'), 'system_digest grants');
end $$;
