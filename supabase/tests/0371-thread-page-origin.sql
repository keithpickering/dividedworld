-- A spun thread's page carries its origin (supabase/migrations/0372_origin_in_page.sql; docs/plans/2026-11-14-origin-in-page-plan.md, Task 1; design docs/plans/2026-11-14-origin-in-page-design.md, sections 3, 4 and 6).
-- thread_page gains an `origin` key on the page that holds a spun thread's first Act: the origin Act as acts_public shows it, its first 20 plays and their ends, whether a 21st exists, the moment of a play on a post
-- or a character, where its post is, and the characters the box names (`cast`, in the shape `people` gives them). origin_moment answers the moment, or null where there is none, where play_moment and spin_moment raise.
-- The origin's ids join the page's tallies, mine, spun, states and releases. The cards are this file's own (or...), never an instance's: Orfx is the card an instance draws an effect for (it saves a state),
-- Orplain is not, Orglint reaches a character, Ormarq a thread, Orquake a board, Orveil is an author veil.
--
--  1. A thread spun from a post with 3 plays (one ended by an admin, one a card with a saved state and a release of the caller's), a reaction of the caller's and of another character's on the post and on a play,
--     and a thread spun from a play: the origin's act, plays, counts, moment, at, cast, and the document's tallies, mine, spun, states and releases; `people` holds no caster who wrote nothing on the page.
--  2. An origin with 21 plays: the plays in force, and the newest one that an admin ended with its end; the counts say 21 (0409: the cap of 20 and `more` are gone, #871).
--  3. Page 2 of the spun thread, a thread with no origin: no `origin` key.
--  4. An origin that is not there: act null, no plays, the page answered.
--  5. A play on a post: moment is play_moment's, at is the post's thread and seq.
--  6. A play on a character, spun at a post (spin_moment's moment, at the pressed post) and spun with no post (play_moment's, at the cast-from post).
--  7. A thread's play and a board's play: answered, with no moment and no place (the poison for a raise inside the page).
--  8. A veiled origin: the stand-in is the author in the act and the cast, and the author's character is nowhere in `origin`.
--  9. The same for every caller: origin is byte-equal for the author's player and two others; only `mine` and `releases` differ.

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('orfx', 'Or Effect', 'sweet', 'rare', 'cast', null, '{post}', null),
    ('orplain', 'Or Plain', 'sweet', 'common', 'cast', null, '{post}', null),
    ('orglint', 'Or Glint', 'pepperoni', 'uncommon', 'cast', null, '{character}', interval '7 days'),
    ('ormarq', 'Or Marquee', 'sweet', 'rare', 'cast', null, '{thread}', interval '1 day'),
    ('orquake', 'Or Quake', 'salty', 'legendary', 'cast', null, '{board}', interval '1 day')
  on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack, gimmick) values
    ('orveil', 'Or Whodunnit', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1, null)
  on conflict (key) do nothing;
  if not exists (select 1 from settings where key = 'systemAnnouncements') then
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(tests.thread('Origin Announcements')::text);
  end if;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- An admin's end of a play, as reverse_card writes it (0092): a card_end Act of no character, under the writer flag.
create function pg_temp.end_play(play uuid, in_thread uuid, at timestamptz default now()) returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (null, 'card_end', in_thread, play, '{"why": "reversed", "by": "admin"}', at) returning id into written;
  perform set_config('kayfabb.card_end_writer', '', true);
  return written;
end $$;

-- A spin as `who`, through `through`, from `origin`, at `at_post` (null for none); the spin Act's id.
create function pg_temp.spun_at(who uuid, through uuid, origin uuid, at_post uuid) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(who);
  made := spin(origin => origin, through => through, title => 'Or spun ' || left(gen_random_uuid()::text, 6), body => 'Discuss.', at_post => at_post);
  perform tests.unbecome();
  return (made -> 'act' ->> 'id')::uuid;
end $$;

-- The thread_page document as `acct` reads it, with Orfx the card an instance draws an effect for.
create function pg_temp.page(acct uuid, t uuid, pg integer default 1, per integer default 20) returns jsonb language plpgsql as $$
declare d jsonb;
begin
  perform tests.become(acct);
  d := thread_page(t, pg, null, per, array['orfx']);
  perform tests.unbecome();
  return d;
end $$;

-- A moment as `acct` reads it by the functions themselves.
create function pg_temp.play_moment_as(acct uuid, play uuid) returns jsonb language plpgsql as $$
declare d jsonb;
begin
  perform tests.become(acct);
  d := play_moment(play);
  perform tests.unbecome();
  return d;
end $$;

create function pg_temp.spin_moment_as(acct uuid, spin_act uuid) returns jsonb language plpgsql as $$
declare d jsonb;
begin
  perform tests.become(acct);
  d := spin_moment(spin_act);
  perform tests.unbecome();
  return d;
end $$;

-- The ids of a jsonb array of Acts, in the order they are in.
create function pg_temp.ids_of(arr jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((x.v ->> 'id')::uuid order by x.n), '{}'::uuid[]) from jsonb_array_elements(arr) with ordinality x(v, n)
$$;

-- The `character` or `profile` object `people` gives a character on a page.
create function pg_temp.person(doc jsonb, c uuid, part text) returns jsonb language sql as $$
  select p -> part from jsonb_array_elements(doc -> 'people') p where p -> 'character' ->> 'id' = c::text
$$;

create function pg_temp.cast_of(o jsonb, c uuid, part text) returns jsonb language sql as $$
  select p -> part from jsonb_array_elements(o -> 'cast') p where p -> 'character' ->> 'id' = c::text
$$;

create function pg_temp.cast_ids(o jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((p -> 'character' ->> 'id')::uuid order by (p -> 'character' ->> 'id')), '{}'::uuid[]) from jsonb_array_elements(o -> 'cast') p
$$;

create function pg_temp.ids(variadic xs uuid[]) returns uuid[] language sql as $$
  select coalesce(array_agg(x order by x::text), '{}'::uuid[]) from unnest(xs) x
$$;

-- The stand-in, as seed_instance makes it (0321 has the same).
create function pg_temp.stand() returns uuid language plpgsql as $$
declare made uuid;
begin
  select c.id into made from characters c where c.staff_kind = 'anonymous';
  if made is not null then return made; end if;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning characters.id into made;
  insert into character_profiles (character, title, signature) values (made, 'Could be anyone.', '');
  return made;
end $$;

-- ---- 1, 3, 5, 9: a thread spun from a post with 3 plays, and a thread spun from one of them ----
do $$
declare
  ann uuid := tests.account('or-ann'); bob uuid := tests.account('or-bob'); cat uuid := tests.account('or-cat');
  rdr uuid := tests.account('or-rdr'); oth uuid := tests.account('or-oth'); spn uuid := tests.account('or-spn');
  oa uuid := tests.character(ann, 'Or Author'); ca uuid := tests.character(bob, 'Or CasterA'); cb uuid := tests.character(cat, 'Or CasterB');
  rd uuid := tests.character(rdr, 'Or Reader'); ro uuid := tests.character(oth, 'Or Other'); sp uuid := tests.character(spn, 'Or Spinner');
  t0 uuid := tests.thread('Or origin thread'); t_cb uuid := tests.thread('Or the caster elsewhere'); plain uuid := tests.thread('Or plain');
  p uuid; pl1 uuid; pl2 uuid; pl3 uuid; end2 uuid; saved jsonb := '{"strokes": [], "washed": 0.5}';
  s_post uuid; s_play uuid; spun_t uuid; play_t uuid; doc jsonb; o jsonb; doc_cb jsonb; doc_ann jsonb; doc_oth jsonb; doc_p2 jsonb; mine_ids uuid[];
begin
  perform pg_temp.cards();
  p := tests.post(oa, t0, 'The origin post.', now() - interval '1 day');
  pl1 := tests.act(ca, 'card', t0, '{"card": "orfx", "message": "", "config": {}, "layer": 1}', p, now() - interval '5 hours');
  -- The play an admin ends is the newer of the two Orplains (and the older, in force, is the most drawn): since 0409 the box carries a post's plays in force and each kind's newest and most drawn, so an ended play is
  -- there as its kind's newest, with its end, as before it was there as one of the first twenty.
  pl2 := tests.act(cb, 'card', t0, '{"card": "orplain", "message": "", "config": {}, "layer": 1}', p, now() - interval '3 hours');
  pl3 := tests.act(ca, 'card', t0, '{"card": "orplain", "message": "", "config": {}, "layer": 2}', p, now() - interval '4 hours');
  end2 := pg_temp.end_play(pl2, t0, now() - interval '2 hours');
  perform save_effect_state(ann, oa, pl1, saved);
  perform tests.post(cb, t_cb, 'The second caster, writing elsewhere.');

  s_post := pg_temp.spun_at(spn, sp, p, null);
  s_play := pg_temp.spun_at(spn, sp, pl1, null);
  spun_t := (select thread from acts where id = s_post);
  play_t := (select thread from acts where id = s_play);
  -- The spun thread's own posts: the author and one caster write there; the other caster does not.
  perform tests.post(oa, spun_t, 'The author answers.');
  perform tests.post(ca, spun_t, 'The first caster answers.');
  perform tests.post(ca, spun_t, 'And again, for a second page.');

  perform tests.become(rdr); perform react(p, rd, 'up'); perform react(pl3, rd, 'up'); perform release_effect(pl1); perform tests.unbecome();
  perform tests.become(oth); perform react(p, ro, 'up'); perform react(pl3, ro, 'up'); perform tests.unbecome();

  doc := pg_temp.page(rdr, spun_t);
  if not (doc ? 'origin') then raise exception '1 the page that holds the first Act carries an origin: %', (select array_agg(k) from jsonb_object_keys(doc) k); end if;
  o := doc -> 'origin';
  if (select array_agg(k order by k) from jsonb_object_keys(o) k) is distinct from array['act', 'at', 'cast', 'counts', 'moment', 'plays'] then raise exception '1 origin''s keys: %', (select array_agg(k) from jsonb_object_keys(o) k); end if;
  if o -> 'act' is distinct from (select to_jsonb(a) from acts_public a where a.id = p) then raise exception '1 origin.act is the acts_public row: %', o -> 'act'; end if;
  if pg_temp.ids_of(o -> 'plays') is distinct from array[pl1, pl3, pl2, end2] then raise exception '1 origin.plays are the 3 plays oldest first, then the card_end: %', pg_temp.ids_of(o -> 'plays'); end if;
  -- The counts replace `more`: each kind of the post, every play it has had and those that took.
  if o ? 'more' then raise exception '1 origin.more is gone with the cap'; end if;
  if o -> 'counts' is distinct from jsonb_build_array(jsonb_build_object('post', p, 'card', 'orfx', 'all', 1, 'took', 1), jsonb_build_object('post', p, 'card', 'orplain', 'all', 2, 'took', 2)) then raise exception '1 origin.counts: %', o -> 'counts'; end if;
  if jsonb_typeof(o -> 'moment') is distinct from 'null' or jsonb_typeof(o -> 'at') is distinct from 'null' then raise exception '1 a post has no moment and no place: % %', o -> 'moment', o -> 'at'; end if;
  if pg_temp.cast_ids(o) is distinct from pg_temp.ids(oa, ca, cb) then raise exception '1 cast is the author and each caster: %', pg_temp.cast_ids(o); end if;
  if (select array_agg(k order by k) from jsonb_object_keys(o -> 'cast' -> 0) k) is distinct from array['character', 'profile'] then raise exception '1 a cast entry is a character and a profile: %', o -> 'cast' -> 0; end if;
  -- The shape people gives the same character, for those who wrote on the page, and for the caster who wrote elsewhere (people on the page that has her).
  doc_cb := pg_temp.page(rdr, t_cb);
  if pg_temp.cast_of(o, oa, 'character') is distinct from pg_temp.person(doc, oa, 'character') or pg_temp.cast_of(o, oa, 'profile') is distinct from pg_temp.person(doc, oa, 'profile')
     or pg_temp.cast_of(o, ca, 'character') is distinct from pg_temp.person(doc, ca, 'character') or pg_temp.cast_of(o, ca, 'profile') is distinct from pg_temp.person(doc, ca, 'profile')
     or pg_temp.cast_of(o, cb, 'character') is distinct from pg_temp.person(doc_cb, cb, 'character') or pg_temp.cast_of(o, cb, 'profile') is distinct from pg_temp.person(doc_cb, cb, 'profile')
     or pg_temp.cast_of(o, oa, 'character') is null or pg_temp.cast_of(o, cb, 'profile') is null then
    raise exception '1 cast''s character and profile are people''s: %', o -> 'cast';
  end if;
  if pg_temp.person(doc, cb, 'character') is not null then raise exception '1 people holds no caster who wrote nothing on the page: %', doc -> 'people'; end if;
  if pg_temp.person(doc, oa, 'character') is null or pg_temp.person(doc, ca, 'character') is null then raise exception '1 people still holds those who wrote on the page'; end if;
  -- The document's own lists hold the origin's and its plays' rows.
  if (select count(*) from jsonb_array_elements(doc -> 'tallies') x where x ->> 'act' = p::text and x ->> 'kind' = 'up' and (x ->> 'count')::integer = 2) is distinct from 1::bigint
     or (select count(*) from jsonb_array_elements(doc -> 'tallies') x where x ->> 'act' = pl3::text and x ->> 'kind' = 'up' and (x ->> 'count')::integer = 2) is distinct from 1::bigint then
    raise exception '1 tallies hold the origin''s and a play''s: %', doc -> 'tallies'; end if;
  select coalesce(array_agg((x ->> 'act')::uuid order by (x ->> 'act')), '{}') into mine_ids from jsonb_array_elements(doc -> 'mine') x where x ->> 'character' = rd::text;
  if mine_ids is distinct from pg_temp.ids(p, pl3) or jsonb_array_length(doc -> 'mine') is distinct from 2 then raise exception '1 mine holds the caller''s own reactions on the origin and a play, and not the other character''s: %', doc -> 'mine'; end if;
  if not exists (select 1 from jsonb_array_elements(doc -> 'spun') x where x ->> 'id' = spun_t::text) or not exists (select 1 from jsonb_array_elements(doc -> 'spun') x where x ->> 'id' = play_t::text) then
    raise exception '1 spun holds the threads spun from the origin and from a play: %', (select array_agg(x ->> 'id') from jsonb_array_elements(doc -> 'spun') x); end if;
  if (select array_agg(x ->> 'play') from jsonb_array_elements(doc -> 'states') x) is distinct from array[pl1::text] or doc -> 'states' -> 0 -> 'state' is distinct from saved then raise exception '1 states hold the saved state of the play drawn for an effect: %', doc -> 'states'; end if;
  if doc -> 'releases' is distinct from jsonb_build_array(pl1) then raise exception '1 releases hold the caller''s release of that play: %', doc -> 'releases'; end if;

  -- 3: another page of the thread, a thread with no origin: no key at all.
  doc_p2 := pg_temp.page(rdr, spun_t, 2, 1);
  if doc_p2 ? 'origin' then raise exception '3 page 2 of the spun thread has no origin key'; end if;
  if not (pg_temp.page(rdr, spun_t, 1, 1) ? 'origin') then raise exception '3 page 1 at one a page still holds the first Act and carries the origin'; end if;
  if pg_temp.page(rdr, plain) ? 'origin' or pg_temp.page(rdr, t0) ? 'origin' then raise exception '3 a thread with no origin has no origin key'; end if;

  -- 5: a thread spun from a play on a post: the play's moment, and the post it is on.
  doc := pg_temp.page(rdr, play_t);
  o := doc -> 'origin';
  if o -> 'moment' is distinct from pg_temp.play_moment_as(rdr, pl1) or o -> 'moment' is null then raise exception '5 moment is play_moment(play): %', o -> 'moment'; end if;
  if o -> 'at' is distinct from jsonb_build_object('thread', t0, 'seq', (select seq from acts where id = p)) then raise exception '5 at is the post''s thread and seq: %', o -> 'at'; end if;
  if o -> 'act' is distinct from (select to_jsonb(a) from acts_public a where a.id = pl1) then raise exception '5 origin.act is the play'; end if;
  if pg_temp.ids_of(o -> 'plays') is distinct from '{}'::uuid[] or pg_temp.cast_ids(o) is distinct from pg_temp.ids(ca) then raise exception '5 the play has no plays of its own, and its caster is the cast: % %', o -> 'plays', pg_temp.cast_ids(o); end if;

  -- 9: the same for every caller; only mine and releases are the caller's own.
  doc := pg_temp.page(rdr, spun_t);
  doc_ann := pg_temp.page(ann, spun_t);
  doc_oth := pg_temp.page(oth, spun_t);
  if (doc -> 'origin')::text is distinct from (doc_ann -> 'origin')::text or (doc -> 'origin')::text is distinct from (doc_oth -> 'origin')::text then
    raise exception '9 origin is the same bytes for the reader, the origin author''s player and another player'; end if;
  if doc_ann -> 'mine' is not distinct from doc -> 'mine' or doc_ann -> 'releases' is not distinct from doc -> 'releases' then raise exception '9 mine and releases are the caller''s own: % %', doc_ann -> 'mine', doc_ann -> 'releases'; end if;
  if doc_ann -> 'mine' is distinct from '[]'::jsonb or doc_ann -> 'releases' is distinct from '[]'::jsonb then raise exception '9 the author''s player reacted to nothing and released nothing: % %', doc_ann -> 'mine', doc_ann -> 'releases'; end if;
  if doc_ann -> 'tallies' is distinct from doc -> 'tallies' or doc_ann -> 'spun' is distinct from doc -> 'spun' or doc_ann -> 'states' is distinct from doc -> 'states' then raise exception '9 tallies, spun and states are the same for every caller'; end if;
end $$;

-- ---- 2: an origin with 21 plays holds those in force, the newest ended one with its end, and counts 21 ----
do $$
declare
  ann uuid := tests.account('or2-ann'); spn uuid := tests.account('or2-spn'); rdr uuid := tests.account('or2-rdr');
  oa uuid := tests.character(ann, 'Or2 Author'); sp uuid := tests.character(spn, 'Or2 Spinner');
  t0 uuid := tests.thread('Or2 origin'); p uuid; plays uuid[] := '{}'; made uuid; end2 uuid; end21 uuid; s uuid; doc jsonb; o jsonb;
begin
  perform pg_temp.cards();
  p := tests.post(oa, t0, 'Twenty-one plays on me.', now() - interval '2 days');
  for i in 1..21 loop
    made := tests.act(oa, 'card', t0, jsonb_build_object('card', 'orplain', 'message', '', 'config', '{}'::jsonb, 'layer', i), p, now() - interval '1 day' + i * interval '1 minute');
    plays := plays || made;
  end loop;
  end2 := pg_temp.end_play(plays[2], t0, now() - interval '1 hour');
  end21 := pg_temp.end_play(plays[21], t0, now() - interval '50 minutes');
  s := pg_temp.spun_at(spn, sp, p, null);
  doc := pg_temp.page(rdr, (select thread from acts where id = s));
  o := doc -> 'origin';
  -- Until 0409 the box held the first 20 plays and said there were more. Now it holds every play in force (the 2nd, ended by an admin, is neither in force nor the newest, so it is not there, and nor is its end),
  -- and the 21st, ended and the newest of its kind, with its end; the counts say 21 (and 21 took).
  if pg_temp.ids_of(o -> 'plays') is distinct from plays[1:1] || plays[3:21] || end21 then raise exception '2 the box lists the plays in force oldest first, the newest with its end (21 entries): % entries', jsonb_array_length(o -> 'plays'); end if;
  if o ? 'more' or o -> 'counts' is distinct from jsonb_build_array(jsonb_build_object('post', p, 'card', 'orplain', 'all', 21, 'took', 21)) then raise exception '2 the counts say 21 plays of the card: %', o -> 'counts'; end if;
end $$;

-- ---- 4: an origin that is not there ----
do $$
declare
  ann uuid := tests.account('or4-ann'); rdr uuid := tests.account('or4-rdr'); oa uuid := tests.character(ann, 'Or4 Author');
  t4 uuid := tests.thread('Or4 spun from nothing'); doc jsonb; o jsonb;
begin
  perform tests.post(oa, t4, 'A first Act whose origin is gone.');
  -- Written as an import written as a replica would leave it: the Act is not there (the foreign key is a trigger that a replica skips).
  perform set_config('session_replication_role', 'replica', true);
  update threads set origin_act_id = gen_random_uuid() where id = t4;
  perform set_config('session_replication_role', 'origin', true);
  doc := pg_temp.page(rdr, t4);
  if doc is null or jsonb_array_length(doc -> 'acts') is distinct from 1 then raise exception '4 the page is answered: %', doc; end if;
  o := doc -> 'origin';
  if o is null or jsonb_typeof(o -> 'act') is distinct from 'null' then raise exception '4 origin.act is null where the Act is not there: %', o; end if;
  if o -> 'plays' is distinct from '[]'::jsonb or o -> 'counts' is distinct from '[]'::jsonb or jsonb_typeof(o -> 'moment') is distinct from 'null' or o -> 'cast' is distinct from '[]'::jsonb then
    raise exception '4 nothing else of it: %', o; end if;
end $$;

-- ---- 6, 7: a play on a character, spun at a post and with no post; a thread's play and a board's play ----
do $$
declare
  ann uuid := tests.account('or6-ann'); bob uuid := tests.account('or6-bob'); spn uuid := tests.account('or6-spn'); rdr uuid := tests.account('or6-rdr');
  oa uuid := tests.character(ann, 'Or6 Author'); ca uuid := tests.character(bob, 'Or6 Caster'); sp uuid := tests.character(spn, 'Or6 Spinner');
  t_from uuid := tests.thread('Or6 cast from'); t_at uuid := tests.thread('Or6 pressed');
  general uuid := (select id from boards where slug = 'general');
  from_post uuid; at_post uuid; k uuid; marq uuid; quake uuid; s_at uuid; s_from uuid; s_thread uuid; s_board uuid; want uuid; doc jsonb; o jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'orglint', 'ormarq', 'orquake');
  perform tests.post(oa, t_from, 'First.');
  from_post := tests.post(oa, t_from, 'Cast from here.');
  perform tests.post(oa, t_at, 'First.');
  at_post := tests.post(oa, t_at, 'Pressed here.');
  k := (play_card(bob, 'orglint', ca, oa, '{}', 0, '', 'character', from_post) ->> 'id')::uuid;
  s_at := pg_temp.spun_at(spn, sp, k, at_post);
  s_from := pg_temp.spun_at(spn, sp, k, null);

  -- 6: spun at a post, the spin's own moment and the pressed post.
  doc := pg_temp.page(rdr, (select thread from acts where id = s_at));
  o := doc -> 'origin';
  if o -> 'moment' is distinct from pg_temp.spin_moment_as(rdr, s_at) or o -> 'moment' is null then raise exception '6 spun at a post, moment is spin_moment(first Act): %', o -> 'moment'; end if;
  if o -> 'at' is distinct from jsonb_build_object('thread', t_at, 'seq', (select seq from acts where id = at_post)) then raise exception '6 at names the pressed post: %', o -> 'at'; end if;
  if pg_temp.cast_ids(o) is distinct from pg_temp.ids(ca, oa) then raise exception '6 the cast holds the caster and the character the play is on: %', pg_temp.cast_ids(o); end if;
  -- And with no post named: the play's own moment, at the cast-from post.
  doc := pg_temp.page(rdr, (select thread from acts where id = s_from));
  o := doc -> 'origin';
  if o -> 'moment' is distinct from pg_temp.play_moment_as(rdr, k) or o -> 'moment' is null then raise exception '6 spun with no post, moment is play_moment(play): %', o -> 'moment'; end if;
  if o -> 'moment' is not distinct from pg_temp.spin_moment_as(rdr, s_at) then raise exception '6 the two moments differ'; end if;
  if o -> 'at' is distinct from jsonb_build_object('thread', t_from, 'seq', (select seq from acts where id = from_post)) then raise exception '6 at names the cast-from post: %', o -> 'at'; end if;

  -- 7: a thread's play and a board's play have no moment; the page is answered all the same.
  marq := (play_card(bob, 'ormarq', ca, t_at, '{}', 0, '', 'thread') ->> 'id')::uuid;
  quake := (play_card(bob, 'orquake', ca, general, '{}', 0, '', 'board') ->> 'id')::uuid;
  s_thread := pg_temp.spun_at(spn, sp, marq, null);
  s_board := pg_temp.spun_at(spn, sp, quake, null);
  for i in 1..2 loop
    doc := pg_temp.page(rdr, (select thread from acts where id = case i when 1 then s_thread else s_board end));
    o := doc -> 'origin';
    if doc is null or o is null then raise exception '7 % play: the page is answered with an origin', case i when 1 then 'thread''s' else 'board''s' end; end if;
    if jsonb_typeof(o -> 'moment') is distinct from 'null' or jsonb_typeof(o -> 'at') is distinct from 'null' then raise exception '7 % play has no moment and no place: % %', case i when 1 then 'a thread''s' else 'a board''s' end, o -> 'moment', o -> 'at'; end if;
    want := case when i = 1 then marq else quake end;
    if (o -> 'act' ->> 'id')::uuid is distinct from want then raise exception '7 the play is the origin Act'; end if;
  end loop;
end $$;

-- ---- 8: a veiled origin shows the stand-in and never the author ----
do $$
declare
  ann uuid := tests.account('or8-ann'); vcr uuid := tests.account('or8-vcr'); spn uuid := tests.account('or8-spn'); rdr uuid := tests.account('or8-rdr'); oth uuid := tests.account('or8-oth');
  av uuid := tests.character(ann, 'Or8 Veiled'); cv uuid := tests.character(vcr, 'Or8 Veiler'); sp uuid := tests.character(spn, 'Or8 Spinner');
  t8 uuid := tests.thread('Or8 veiled'); p uuid; play uuid; s uuid; stand uuid; doc jsonb; o jsonb;
begin
  perform pg_temp.cards();
  stand := pg_temp.stand();
  p := tests.post(av, t8, 'Who wrote this?', now() - interval '1 hour');
  play := tests.act(cv, 'card', t8, jsonb_build_object('card', 'orveil', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() + interval '3 days'), p, now() - interval '30 minutes');
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (play, p, 'author', av, vcr, now() + interval '3 days');
  if (select a.character from acts_public a where a.id = p) is distinct from stand then raise exception '8 the post is shown under the stand-in (the fixture)'; end if;
  s := pg_temp.spun_at(spn, sp, p, null);
  doc := pg_temp.page(oth, (select thread from acts where id = s));
  o := doc -> 'origin';
  if o -> 'act' is distinct from (select to_jsonb(a) from acts_public a where a.id = p) or (o -> 'act' ->> 'character')::uuid is distinct from stand then raise exception '8 origin.act shows the stand-in: %', o -> 'act'; end if;
  if pg_temp.cast_ids(o) is distinct from pg_temp.ids(stand, cv) then raise exception '8 the cast names the stand-in and the veil''s caster: %', pg_temp.cast_ids(o); end if;
  if o::text like '%' || av::text || '%' then raise exception '8 the veiled author''s character is nowhere in origin: %', o; end if;
  if (doc -> 'origin')::text is distinct from (pg_temp.page(rdr, (select thread from acts where id = s)) -> 'origin')::text then raise exception '8 the same for another caller'; end if;
end $$;

-- ---- 10: an origin whose moment the functions refuse, and an origin on the Updates thread: the page is answered and the moment is null ----
-- origin_moment catches the one refusal that can still arrive (P0002), so a raise in play_moment or spin_moment never fails the page.
do $$
declare
  ann uuid := tests.account('or10-ann'); bob uuid := tests.account('or10-bob'); spn uuid := tests.account('or10-spn'); rdr uuid := tests.account('or10-rdr');
  oa uuid := tests.character(ann, 'Or10 Author'); ca uuid := tests.character(bob, 'Or10 Caster'); sp uuid := tests.character(spn, 'Or10 Spinner');
  t_from uuid := tests.thread('Or10 cast from'); t_at uuid := tests.thread('Or10 pressed');
  from_post uuid; at_post uuid; k uuid; bare uuid; s_old uuid; s_bare uuid; s_upd uuid; s_onupd uuid; dev uuid; upd uuid; on_upd uuid; doc jsonb; o jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'orglint');
  perform tests.post(oa, t_from, 'First.');
  from_post := tests.post(oa, t_from, 'Cast from here.');
  perform tests.post(oa, t_at, 'First.');
  at_post := tests.post(oa, t_at, 'Pressed here.');
  k := (play_card(bob, 'orglint', ca, oa, '{}', 0, '', 'character', from_post) ->> 'id')::uuid;

  -- A spin that names a post but has no moment row (one written before 0351 took moments, or an import that left them): spin_moment refuses.
  s_old := pg_temp.spun_at(spn, sp, k, at_post);
  perform set_config('session_replication_role', 'replica', true);
  delete from spin_moment_layers where spin = s_old;
  delete from spin_moments where spin = s_old;
  perform set_config('session_replication_role', 'origin', true);
  if exists (select 1 from spin_moments where spin = s_old) then raise exception '10 the fixture did not remove the spin''s moment'; end if;
  doc := pg_temp.page(rdr, (select thread from acts where id = s_old));
  o := doc -> 'origin';
  if doc is null or o is null then raise exception '10 a spin with no moment row: the page is answered with an origin'; end if;
  if jsonb_typeof(o -> 'moment') is distinct from 'null' then raise exception '10 a spin with no moment row has no moment: %', o -> 'moment'; end if;
  if o -> 'at' is distinct from jsonb_build_object('thread', t_at, 'seq', (select seq from acts where id = at_post)) then raise exception '10 at still names the pressed post: %', o -> 'at'; end if;

  -- A play on a character whose target is no post (another play): play_moment refuses.
  alter table acts disable trigger acts_well_formed;
  bare := tests.act(ca, 'card', t_from, jsonb_build_object('card', 'orglint', 'reach', 'character', 'character', oa), k);
  alter table acts enable trigger acts_well_formed;
  insert into play_reach (play, reach, character, ends_at) values (bare, 'character', oa, now() + interval '1 day');
  s_bare := pg_temp.spun_at(spn, sp, bare, null);
  doc := pg_temp.page(rdr, (select thread from acts where id = s_bare));
  o := doc -> 'origin';
  if doc is null or o is null then raise exception '10 a play on a character whose target is no post: the page is answered with an origin'; end if;
  if jsonb_typeof(o -> 'moment') is distinct from 'null' or jsonb_typeof(o -> 'at') is distinct from 'null' then raise exception '10 a play on a character whose target is no post has no moment and no place: % %', o -> 'moment', o -> 'at'; end if;

  -- An origin on the Updates thread, and a play on one: no moment, no place.
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Or10 Gabe', 'title', 'Made this.', 'avatar', 'gabe')));
  select id into dev from characters where staff_kind = 'developer';
  perform set_config('kayfabb.update_writer', 'on', true);
  perform set_config('kayfabb.staff_writer', 'on', true);
  upd := tests.act(dev, 'update', (select (value #>> '{}')::uuid from settings where key = 'updatesThread'), '{"title": "Or10 Headline", "body": "Body.", "changes": []}');
  perform set_config('kayfabb.update_writer', 'off', true);
  perform set_config('kayfabb.staff_writer', 'off', true);
  alter table acts disable trigger acts_well_formed;
  on_upd := tests.act(ca, 'card', (select thread from acts where id = upd), '{"card": "orplain"}', upd);
  alter table acts enable trigger acts_well_formed;
  s_upd := pg_temp.spun_at(spn, sp, upd, null);
  s_onupd := pg_temp.spun_at(spn, sp, on_upd, null);
  for i in 1..2 loop
    doc := pg_temp.page(rdr, (select thread from acts where id = case when i = 1 then s_upd else s_onupd end));
    o := doc -> 'origin';
    if doc is null or o is null then raise exception '10 % : the page is answered with an origin', case when i = 1 then 'an update' else 'a play on an update' end; end if;
    if jsonb_typeof(o -> 'moment') is distinct from 'null' or jsonb_typeof(o -> 'at') is distinct from 'null' then raise exception '10 % has no moment and no place: % %', case when i = 1 then 'an update' else 'a play on an update' end, o -> 'moment', o -> 'at'; end if;
  end loop;
  if (select o2 -> 'act' ->> 'kind' from (select pg_temp.page(rdr, (select thread from acts where id = s_upd)) -> 'origin' as o2) z) is distinct from 'update' then raise exception '10 the update is the origin Act'; end if;
end $$;
