-- The poll reads (supabase/migrations/0382_poll_reads.sql; docs/plans/2026-11-20-polls-design.md; plan docs/plans/2026-11-20-polls-plan.md, Task 2; models 0371-thread-page-origin.sql and 0375-spun-thread-reads.sql).
--
-- What the screens read of a poll. Every claim is a `raise exception`. The rows are this file's own (pr...); a poll and its ballots are written as the writers leave them (the act helpers), at times of the test's choosing.
--
--  1. thread_page: the page's poll parts for a public poll, a secret poll, a poll closed by its time, one closed by an admin and a ballot cast after a close; the secret poll's parts are byte for byte the same for every reader but
--     `myBallots`, which holds the reader's own counted ballots (a secret one included) and no one else's; the voters of a public poll newest first, with their heads in `voterCast`; the spun thread's origin when it is a post, a
--     poll or a ballot.
--  2. poll_ballots: every ballot of a public poll (the changes and the withdrawal too) newest first, 50 at a time and paged by `before`; a secret poll, a poll that is not there and a caller with no session are refused.
--  3. thread_open's origin_place for a poll and for a ballot, and for a secret ballot (which no spin names).
--  4. log_page: the caller's own ballots (a secret one named, with its picks), an admin's close of the caller's poll, and no one else's.
--  5. system_digest: an excerpt carries its post's poll (the question, each option's count, whether it is closed) and names no voter.
-- The scale is in 0372-origin-scale.sql, which holds the other reads of thread_page's cost.

create function pg_temp.mkpoll(in_thread uuid, on_post uuid, by_character uuid, secret boolean default false, pick integer default 1, closes timestamptz default now() + interval '1 day', at timestamptz default now(),
                               options jsonb default '["Pipe Frame", "Badwagon", "Mach Bike"]') returns uuid language sql as $$
  select tests.act(by_character, 'poll', in_thread,
    jsonb_build_object('question', 'Best kart?', 'options', options, 'pick', pick, 'secret', secret, 'closes_at', closes), on_post, at)
$$;

create function pg_temp.vote(on_poll uuid, by_character uuid, picks jsonb, at timestamptz default now()) returns uuid language sql as $$
  select tests.act(by_character, 'ballot', (select p.thread from acts p where p.id = on_poll), jsonb_build_object('picks', picks), on_poll, at)
$$;

create function pg_temp.say(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.page(who uuid, t uuid) returns jsonb language plpgsql as $$
declare d jsonb;
begin
  perform tests.become(who);
  d := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  return d;
end $$;

-- The part of a page that is a caller's own or a clock's: what differs by reader and is none of the poll's.
create function pg_temp.same_for_all(d jsonb) returns jsonb language sql as $$
  select d - 'myBallots' - 'mine' - 'reading' - 'following' - 'presence' - 'unread'
$$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pr-ann'); bob uuid := tests.account('pr-bob'); cat uuid := tests.account('pr-cat'); dee uuid := tests.account('pr-dee');
  a1 uuid := tests.character(ann, 'Pr Ann'); b1 uuid := tests.character(bob, 'Pr Bob'); b2 uuid := tests.character(bob, 'Pr Bobby'); s1 uuid := tests.character(bob, 'Pr Secret Bob');
  c1 uuid := tests.character(cat, 'Pr Cat'); d1 uuid := tests.character(dee, 'Pr Dee');
  t uuid := tests.thread('Pr reads'); t2 uuid := tests.thread('Pr spun from a poll'); t3 uuid := tests.thread('Pr spun from a ballot'); t4 uuid := tests.thread('Pr spun from a secret ballot'); t5 uuid := tests.thread('Pr spun from a post');
  pp uuid := tests.post(a1, t, 'Public.', now() - interval '6 hours'); ps uuid := tests.post(a1, t, 'Secret.', now() - interval '6 hours' + interval '1 minute');
  pc uuid := tests.post(a1, t, 'Timed out.', now() - interval '6 hours' + interval '2 minutes'); pk uuid := tests.post(a1, t, 'Closed by an admin.', now() - interval '6 hours' + interval '3 minutes');
  pa uuid := tests.post(a1, t, 'Closed by its author.', now() - interval '6 hours' + interval '4 minutes'); pn uuid := tests.post(a1, t, 'No poll.', now() - interval '6 hours' + interval '5 minutes');
  pub uuid := pg_temp.mkpoll(t, pp, a1, secret => false, pick => 2, at => now() - interval '5 hours');
  sec uuid := pg_temp.mkpoll(t, ps, a1, secret => true, pick => 1, at => now() - interval '5 hours');
  tmo uuid := pg_temp.mkpoll(t, pc, a1, closes => now() - interval '1 hour', at => now() - interval '5 hours');
  adm uuid := pg_temp.mkpoll(t, pk, a1, at => now() - interval '5 hours');
  aut uuid := pg_temp.mkpoll(t, pa, a1, at => now() - interval '5 hours');
  pb1 uuid; pb2 uuid; sb1 uuid; sbs uuid; sbc uuid; adm_close uuid; aut_close uuid;
  da jsonb; db jsonb; dc jsonb; dd jsonb; e jsonb; v jsonb; place jsonb; who_i integer;
begin
  -- The public poll: five ballots by three characters; b1 changed hers and c1 withdrew, so the counted are b1's {2} and b2's {1}.
  pb1 := pg_temp.vote(pub, b1, '[0]', now() - interval '4 hours');
  perform pg_temp.vote(pub, b2, '[1]', now() - interval '3 hours 30 minutes');
  perform pg_temp.vote(pub, c1, '[0, 1]', now() - interval '3 hours');
  pb2 := pg_temp.vote(pub, b1, '[2]', now() - interval '2 hours');
  perform pg_temp.vote(pub, c1, '[]', now() - interval '1 hour');
  -- The secret poll: three characters, two of them one player's.
  sbs := pg_temp.vote(sec, s1, '[0]', now() - interval '3 hours');
  sbc := pg_temp.vote(sec, c1, '[1]', now() - interval '2 hours');
  sb1 := pg_temp.vote(sec, b1, '[1]', now() - interval '1 hour');
  -- A poll closed by its time, by an admin (a ballot before the close counts, one after it does not) and by its author.
  perform pg_temp.vote(tmo, b1, '[0]', now() - interval '3 hours');
  perform pg_temp.vote(adm, b1, '[0]', now() - interval '3 hours');
  adm_close := tests.act(null, 'poll_close', t, '{"by": "admin"}', adm, now() - interval '2 hours');
  perform pg_temp.vote(adm, b2, '[1]', now() - interval '30 minutes');
  aut_close := tests.act(a1, 'poll_close', t, '{"by": "author"}', aut, now() - interval '2 hours');

  da := pg_temp.page(ann, t); db := pg_temp.page(bob, t); dc := pg_temp.page(cat, t); dd := pg_temp.page(dee, t);

  -- ---- 1. thread_page ----
  if (select array_agg(k order by k) from jsonb_object_keys(dd) k where k in ('polls', 'voters', 'votersMore', 'voterCast', 'myBallots')) is distinct from array['myBallots', 'polls', 'voterCast', 'voters', 'votersMore'] then
    raise exception '1 the page carries no polls, voters, votersMore, voterCast and myBallots: %', (select array_agg(k) from jsonb_object_keys(dd) k);
  end if;
  -- One entry for each current poll (a post with no poll has none), each with its poll Act as acts_public shows it, its counts and its close.
  if jsonb_array_length(dd -> 'polls') is distinct from 5 then raise exception '1 the page holds % polls, not the five of its posts: %', jsonb_array_length(dd -> 'polls'), dd -> 'polls'; end if;
  select x into e from jsonb_array_elements(dd -> 'polls') x where (x ->> 'post')::uuid = pp;
  if (e -> 'act' ->> 'id')::uuid is distinct from pub or e -> 'act' ->> 'kind' is distinct from 'poll' or e -> 'act' -> 'payload' ->> 'question' is distinct from 'Best kart?' or (e -> 'act' -> 'payload' ->> 'secret')::boolean is distinct from false
     or e -> 'counts' is distinct from '[0, 1, 1]'::jsonb or (e ->> 'voters')::integer is distinct from 2 or e ->> 'closed' is distinct from 'false' or e -> 'close' is distinct from 'null'::jsonb
     or (e ->> 'ends_at')::timestamptz is distinct from (e -> 'act' -> 'payload' ->> 'closes_at')::timestamptz then
    raise exception '1 the public poll''s part is not its Act with its counts and no close: %', e;
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(e) k) is distinct from array['act', 'close', 'closed', 'counts', 'ends_at', 'post', 'voters'] then raise exception '1 a poll''s part carries other keys: %', e; end if;
  select x into e from jsonb_array_elements(dd -> 'polls') x where (x ->> 'post')::uuid = ps;
  if e -> 'counts' is distinct from '[1, 2, 0]'::jsonb or (e ->> 'voters')::integer is distinct from 3 then raise exception '1 the secret poll''s tally: %', e; end if;
  -- Closed by its time: closed, counted up to its end. Closed by an admin: the close Act is carried, and the ballot after it counts for no one.
  select x into e from jsonb_array_elements(dd -> 'polls') x where (x ->> 'post')::uuid = pc;
  if e ->> 'closed' is distinct from 'true' or e -> 'counts' is distinct from '[1, 0, 0]'::jsonb then raise exception '1 the poll closed by its time: %', e; end if;
  select x into e from jsonb_array_elements(dd -> 'polls') x where (x ->> 'post')::uuid = pk;
  if e ->> 'closed' is distinct from 'true' or e -> 'counts' is distinct from '[1, 0, 0]'::jsonb or (e -> 'close' ->> 'id')::uuid is distinct from adm_close or e -> 'close' -> 'payload' is distinct from '{"by": "admin"}'::jsonb or e -> 'close' ->> 'character' is not null then
    raise exception '1 the poll closed by an admin: %', e;
  end if;
  select x into e from jsonb_array_elements(dd -> 'polls') x where (x ->> 'post')::uuid = pa;
  if (e -> 'close' ->> 'id')::uuid is distinct from aut_close or (e -> 'close' ->> 'character')::uuid is distinct from a1 then raise exception '1 the poll closed by its author: %', e; end if;
  -- The voters of a public poll: the counted ballots with picks, newest first, as {poll, act, character, picks, at}; none for a secret poll or one with no ballot; nothing is more.
  select coalesce(jsonb_agg(x -> 'character' order by ord), '[]') into v from jsonb_array_elements(dd -> 'voters') with ordinality t(x, ord) where (x ->> 'poll')::uuid = pub;
  if v is distinct from to_jsonb(array[b1, b2]) then raise exception '1 the public poll''s voters are not b1 then b2: %', dd -> 'voters'; end if;
  select x into e from jsonb_array_elements(dd -> 'voters') x where (x ->> 'poll')::uuid = pub and (x ->> 'character')::uuid = b1;
  if (e ->> 'act')::uuid is distinct from pb2 or e -> 'picks' is distinct from '[2]'::jsonb or (select array_agg(k order by k) from jsonb_object_keys(e) k) is distinct from array['act', 'at', 'character', 'picks', 'poll'] then
    raise exception '1 a voter is not {poll, act, character, picks, at} of her latest ballot: %', e;
  end if;
  if exists (select 1 from jsonb_array_elements(dd -> 'voters') x where (x ->> 'poll')::uuid in (sec, aut) or (x ->> 'character')::uuid in (c1, s1)) then raise exception '1 a voter of a secret poll, or one who withdrew, is listed: %', dd -> 'voters'; end if;
  if dd -> 'votersMore' is distinct from '[]'::jsonb then raise exception '1 votersMore is not empty for polls of a few voters: %', dd -> 'votersMore'; end if;
  -- Each voter's character and profile are in `voterCast`, as the origin's cast has them, and the voters are not `people`.
  if (select array_agg((h -> 'character' ->> 'id')::uuid order by (h -> 'character' ->> 'id')::uuid) from jsonb_array_elements(dd -> 'voterCast') h) is distinct from (select array_agg(x order by x) from unnest(array[b1, b2]) x)
     or exists (select 1 from jsonb_array_elements(dd -> 'voterCast') h where h -> 'character' ->> 'name' is null or h -> 'profile' is null) then
    raise exception '1 voterCast is not the heads of b1 and b2 (the voters of the public poll alone): %', dd -> 'voterCast';
  end if;
  if exists (select 1 from jsonb_array_elements(dd -> 'people') p where (p -> 'character' ->> 'id')::uuid in (b1, b2, c1, s1)) then raise exception '1 a voter is among the people of the page: %', dd -> 'people'; end if;
  -- The secret poll's parts are the same for every reader (the owner of two of its voters, another voter, one who never voted, its author), and no part of the page names a voter of it alone.
  if pg_temp.same_for_all(da) is distinct from pg_temp.same_for_all(db) or pg_temp.same_for_all(db) is distinct from pg_temp.same_for_all(dc) or pg_temp.same_for_all(dc) is distinct from pg_temp.same_for_all(dd) then
    raise exception '1 the page reads differently by reader, outside the reader''s own parts';
  end if;
  if dc::text like '%' || s1::text || '%' or dd::text like '%' || s1::text || '%' or da::text like '%' || s1::text || '%' then raise exception '1 a page names the character that voted only on a secret poll'; end if;
  if (db - 'myBallots')::text like '%' || s1::text || '%' then raise exception '1 the owner''s page names her secret voter outside myBallots'; end if;
  -- myBallots: the reader's own counted ballots, with the character and the picks of a secret one, and no one else's.
  if (select jsonb_agg(jsonb_build_object('poll', x ->> 'poll', 'character', x ->> 'character', 'picks', x -> 'picks') order by x ->> 'poll', x ->> 'character') from jsonb_array_elements(db -> 'myBallots') x)
     is distinct from (select jsonb_agg(jsonb_build_object('poll', r.poll, 'character', r.ch, 'picks', r.picks) order by r.poll::text, r.ch::text) from (values
         (pub, b1, '[2]'::jsonb), (pub, b2, '[1]'), (sec, s1, '[0]'), (sec, b1, '[1]'), (tmo, b1, '[0]'), (adm, b1, '[0]')) r(poll, ch, picks)) then
    raise exception '1 bob''s myBallots are not his counted ballots: %', db -> 'myBallots';
  end if;
  if (select jsonb_agg(jsonb_build_object('poll', x ->> 'poll', 'picks', x -> 'picks') order by x ->> 'poll') from jsonb_array_elements(dc -> 'myBallots') x)
     is distinct from (select jsonb_agg(jsonb_build_object('poll', r.poll, 'picks', r.picks) order by r.poll::text) from (values (pub, '[]'::jsonb), (sec, '[1]')) r(poll, picks)) then
    raise exception '1 cat''s myBallots (a withdrawal counts, and is empty): %', dc -> 'myBallots';
  end if;
  if dd -> 'myBallots' is distinct from '[]'::jsonb or da -> 'myBallots' is distinct from '[]'::jsonb then raise exception '1 a reader with no ballot has some: %', dd -> 'myBallots'; end if;
  -- A page of a thread with no poll carries empty parts.
  select pg_temp.page(dee, tests.thread('Pr plain')) into e;
  if e is not null and (e -> 'polls' is distinct from '[]'::jsonb or e -> 'voters' is distinct from '[]'::jsonb) then raise exception '1 a thread with no poll carries polls'; end if;

  -- The origin of a spun thread: a post (its poll is the page's, and the origin holds none of its own), a poll and a ballot.
  perform tests.post(d1, t5, 'Spun from the post.', now()); perform tests.post(d1, t2, 'Spun from the poll.', now()); perform tests.post(d1, t3, 'Spun from the ballot.', now()); perform tests.post(d1, t4, 'Spun from a secret ballot.', now());
  update threads set origin_act_id = pp where id = t5;
  update threads set origin_act_id = pub where id = t2;
  update threads set origin_act_id = pb2 where id = t3;
  update threads set origin_act_id = sbs where id = t4;
  e := pg_temp.page(dee, t5);
  if (e -> 'origin' -> 'act' ->> 'id')::uuid is distinct from pp or e -> 'origin' ? 'polls' then raise exception '1 a post''s origin carries its own polls: %', e -> 'origin'; end if;
  if jsonb_array_length(e -> 'polls') is distinct from 1 or (e -> 'polls' -> 0 ->> 'post')::uuid is distinct from pp or jsonb_array_length(e -> 'voters') is distinct from 2 then
    raise exception '1 the page of a thread spun from a post does not hold the post''s poll: %', e;
  end if;
  e := pg_temp.page(bob, t2);
  if (e -> 'origin' -> 'act' ->> 'id')::uuid is distinct from pub or jsonb_array_length(e -> 'origin' -> 'polls') is distinct from 1 or (e -> 'origin' -> 'polls' -> 0 ->> 'post')::uuid is distinct from pp
     or e -> 'origin' -> 'polls' -> 0 -> 'counts' is distinct from '[0, 1, 1]'::jsonb or jsonb_array_length(e -> 'origin' -> 'voters') is distinct from 2 or e -> 'origin' -> 'votersMore' is distinct from '[]'::jsonb
     or jsonb_array_length(e -> 'origin' -> 'myBallots') is distinct from 2 then
    raise exception '1 a poll''s origin does not carry the poll, its voters and the reader''s ballots: %', e -> 'origin';
  end if;
  if e -> 'origin' -> 'at' is distinct from jsonb_build_object('thread', t, 'seq', 1) then raise exception '1 a poll''s origin is not at its post: %', e -> 'origin' -> 'at'; end if;
  if (select array_agg((h ->> 'id')::uuid order by (h ->> 'id')::uuid) from (select h -> 'character' as h from jsonb_array_elements(e -> 'origin' -> 'cast') h) z where (h ->> 'id')::uuid in (b1, b2)) is distinct from (select array_agg(x order by x) from unnest(array[b1, b2]) x) then
    raise exception '1 a poll''s origin cast does not hold its voters: %', e -> 'origin' -> 'cast';
  end if;
  e := pg_temp.page(dee, t3);
  if (e -> 'origin' -> 'act' ->> 'id')::uuid is distinct from pb2 or (e -> 'origin' -> 'act' ->> 'character')::uuid is distinct from b1 or (e -> 'origin' -> 'polls' -> 0 -> 'act' ->> 'id')::uuid is distinct from pub
     or e -> 'origin' -> 'at' is distinct from jsonb_build_object('thread', t, 'seq', 1) then
    raise exception '1 a ballot''s origin does not carry the ballot and its poll: %', e -> 'origin';
  end if;

  -- ---- 2. poll_ballots ----
  perform tests.become(dee);
  e := poll_ballots(pub);
  perform tests.unbecome();
  if jsonb_array_length(e -> 'ballots') is distinct from 5 or e -> 'more' is distinct from 'false'::jsonb then raise exception '2 poll_ballots does not give every ballot, the changes included: %', e; end if;
  if (select array_agg((x ->> 'at')::timestamptz order by ord) from jsonb_array_elements(e -> 'ballots') with ordinality t(x, ord)) is distinct from (select array_agg(b.created_at order by b.created_at desc, b.id desc) from acts b where b.kind = 'ballot' and b.target_act_id = pub) then
    raise exception '2 poll_ballots is not newest first: %', e;
  end if;
  v := e -> 'ballots' -> 0;
  if (v -> 'character' ->> 'id')::uuid is distinct from c1 or v -> 'character' ->> 'name' is distinct from 'Pr Cat' or v -> 'picks' is distinct from '[]'::jsonb or not (v -> 'character' ? 'avatar_square') or not (v -> 'character' ? 'avatar_portrait') then
    raise exception '2 a ballot does not carry its character''s name and avatar and its picks: %', v;
  end if;
  if (select count(*) from jsonb_array_elements(e -> 'ballots') x where (x -> 'character' ->> 'id')::uuid = b1) is distinct from 2 then raise exception '2 the change of a ballot is not listed'; end if;
  -- Paged by the `at` of the last ballot of a page: the rest come after.
  perform tests.become(dee);
  e := poll_ballots(pub, (e -> 'ballots' -> 2 ->> 'at')::timestamptz);
  perform tests.unbecome();
  if jsonb_array_length(e -> 'ballots') is distinct from 2 then raise exception '2 the page after the third ballot holds % ballots, not 2', jsonb_array_length(e -> 'ballots'); end if;
  -- A secret poll is refused whatever the caller, in one sentence; so is a poll that is not there.
  foreach who_i in array array[1, 2, 3, 4] loop
    perform tests.become(case who_i when 1 then bob when 2 then cat when 3 then ann else dee end);
    if pg_temp.say(format('select poll_ballots(%L)', sec)) is distinct from 'that poll''s ballots are secret' then raise exception '2 a secret poll''s ballots were not refused in its one sentence for %: %', who_i, pg_temp.say(format('select poll_ballots(%L)', sec)); end if;
    if pg_temp.say(format('select poll_ballots(%L)', gen_random_uuid())) is distinct from 'there is no such poll' then raise exception '2 a poll that is not there: %', pg_temp.say(format('select poll_ballots(%L)', gen_random_uuid())); end if;
    perform tests.unbecome();
  end loop;
  perform tests.become(dee);
  if pg_temp.say(format('select poll_ballots(%L)', pp)) is distinct from 'there is no such poll' then raise exception '2 a post is no poll: %', pg_temp.say(format('select poll_ballots(%L)', pp)); end if;
  perform tests.unbecome();
  perform tests.become_anon();
  if pg_temp.say(format('select poll_ballots(%L)', pub)) not like 'permission denied%' then raise exception '2 a caller with no session reads a poll''s ballots: %', pg_temp.say(format('select poll_ballots(%L)', pub)); end if;
  perform tests.unbecome();

  -- ---- 3. thread_open's origin_place ----
  perform tests.become(dee);
  select o.origin_place into place from thread_open o where o.id = t2;
  if place is distinct from jsonb_build_object('kind', 'poll', 'question', 'Best kart?', 'on', jsonb_build_object('kind', 'post', 'thread', t, 'title', 'Pr reads', 'seq', 1)) then raise exception '3 the origin place of a poll: %', place; end if;
  select o.origin_place into place from thread_open o where o.id = t3;
  if place is distinct from jsonb_build_object('kind', 'ballot', 'character', jsonb_build_object('id', b1, 'name', 'Pr Bob'), 'question', 'Best kart?', 'on', jsonb_build_object('kind', 'post', 'thread', t, 'title', 'Pr reads', 'seq', 1)) then raise exception '3 the origin place of a ballot: %', place; end if;
  select o.origin_place into place from thread_open o where o.id = t4;
  if place is not null then raise exception '3 a secret ballot is named as an origin: %', place; end if;
  select o.origin_place into place from thread_open o where o.id = t5;
  if place is distinct from jsonb_build_object('kind', 'post', 'thread', t, 'title', 'Pr reads', 'seq', 1) then raise exception '3 the origin place of a post is not as it was: %', place; end if;
  perform tests.unbecome();

  -- ---- 4. log_page ----
  perform tests.become(bob);
  e := log_page(null);
  perform tests.unbecome();
  if jsonb_array_length(e -> 'sources' -> 'ballots') is distinct from (select count(*)::integer from acts b where b.kind = 'ballot' and b."character" in (b1, b2, s1)) then raise exception '4 bob''s log does not hold each of his ballots: %', e -> 'sources' -> 'ballots'; end if;
  select x into v from jsonb_array_elements(e -> 'sources' -> 'ballots') x where (x ->> 'act')::uuid = sbs;
  if (v ->> 'character')::uuid is distinct from s1 or v -> 'picks' is distinct from '[0]'::jsonb or v ->> 'secret' is distinct from 'true' or v ->> 'question' is distinct from 'Best kart?' or (v ->> 'poll')::uuid is distinct from sec
     or v -> 'place' is distinct from jsonb_build_object('kind', 'post', 'thread', t, 'title', 'Pr reads', 'seq', 2) or (v ->> 'at')::timestamptz is distinct from (select b.created_at from acts b where b.id = sbs) then
    raise exception '4 the log does not name bob''s own secret ballot with its picks, its poll and its post: %', v;
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(v) k) is distinct from array['act', 'at', 'character', 'picks', 'place', 'poll', 'question', 'secret'] then raise exception '4 a log line of a ballot carries other keys: %', v; end if;
  if jsonb_array_length(e -> 'sources' -> 'pollCloses') is distinct from 0 then raise exception '4 bob''s log holds an admin''s close of a poll he did not write: %', e -> 'sources' -> 'pollCloses'; end if;
  if e::text like '%' || c1::text || '%' then raise exception '4 bob''s log names another player''s character'; end if;
  perform tests.become(cat);
  e := log_page(null);
  perform tests.unbecome();
  if jsonb_array_length(e -> 'sources' -> 'ballots') is distinct from 3 or exists (select 1 from jsonb_array_elements(e -> 'sources' -> 'ballots') x where (x ->> 'character')::uuid is distinct from c1) then raise exception '4 cat''s log is not her own three ballots: %', e -> 'sources' -> 'ballots'; end if;
  perform tests.become(ann);
  e := log_page(null);
  perform tests.unbecome();
  -- An admin's close of her poll, and not her own close of one (an author's close is her own act), and no ballot of hers.
  if jsonb_array_length(e -> 'sources' -> 'pollCloses') is distinct from 1 or (e -> 'sources' -> 'pollCloses' -> 0 ->> 'act')::uuid is distinct from adm_close or (e -> 'sources' -> 'pollCloses' -> 0 ->> 'poll')::uuid is distinct from adm
     or (e -> 'sources' -> 'pollCloses' -> 0 ->> 'character')::uuid is distinct from a1 or e -> 'sources' -> 'pollCloses' -> 0 ->> 'question' is distinct from 'Best kart?'
     or e -> 'sources' -> 'pollCloses' -> 0 -> 'place' is distinct from jsonb_build_object('kind', 'post', 'thread', t, 'title', 'Pr reads', 'seq', 4) or jsonb_array_length(e -> 'sources' -> 'ballots') is distinct from 0 then
    raise exception '4 ann''s log does not hold the admin''s close of her poll alone: %', e -> 'sources';
  end if;
  -- The window: before the close, there is none.
  perform tests.become(ann);
  e := log_page(now() - interval '3 hours');
  perform tests.unbecome();
  if jsonb_array_length(e -> 'sources' -> 'pollCloses') is distinct from 0 then raise exception '4 a close after the window is in the page'; end if;
end $$;

-- ---- 5. system_digest ----
select tests.unbecome();
do $$
declare
  base timestamptz := '2040-06-01T12:00:00Z';
  ann uuid := tests.account('prd-ann'); bob uuid := tests.account('prd-bob');
  a1 uuid := tests.character(ann, 'Prd Author'); v1 uuid := tests.character(bob, 'Prd Voter One'); v2 uuid := tests.character(bob, 'Prd Voter Two'); v3 uuid := tests.character(bob, 'Prd Voter Three');
  t uuid := tests.thread('Prd digest');
  p1 uuid := tests.post(a1, t, 'A post with a public poll.', base); p2 uuid := tests.post(a1, t, 'A post with a secret poll.', base); p3 uuid := tests.post(a1, t, 'No poll here.', base);
  q1 uuid; q2 uuid; d jsonb; x jsonb; bad text;
begin
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '5'), ('digestExcerptChars', '40') on conflict (key) do update set value = excluded.value;
  q1 := tests.act(a1, 'poll', t, jsonb_build_object('question', 'Best kart?', 'options', '["Pipe Frame", "Badwagon"]'::jsonb, 'pick', 1, 'secret', false, 'closes_at', base + interval '30 days'), p1, base);
  q2 := tests.act(a1, 'poll', t, jsonb_build_object('question', 'Whose idea?', 'options', '["Mine", "Yours", "Theirs"]'::jsonb, 'pick', 1, 'secret', true, 'closes_at', '2026-01-01T00:00:00Z'::timestamptz), p2, base);
  perform tests.act(v1, 'ballot', t, '{"picks": [0]}', q1, base + interval '1 minute'); perform tests.act(v2, 'ballot', t, '{"picks": [1]}', q1, base + interval '2 minutes'); perform tests.act(v1, 'ballot', t, '{"picks": [1]}', q1, base + interval '3 minutes');
  perform tests.act(v3, 'ballot', t, '{"picks": [2]}', q2, '2025-12-31T10:00:00Z'); perform tests.act(v2, 'ballot', t, '{"picks": [2]}', q2, '2025-12-31T09:00:00Z');
  perform tests.become_service();
  d := system_digest(base - interval '1 hour', base + interval '1 hour');
  perform tests.unbecome();
  select e into x from jsonb_array_elements(d -> 'excerpts') e where (e ->> 'act')::uuid = p1;
  if x -> 'poll' is distinct from '{"question": "Best kart?", "options": [{"text": "Pipe Frame", "count": 0}, {"text": "Badwagon", "count": 2}], "closed": false}'::jsonb then raise exception '5 the digest''s excerpt of a public poll: %', x; end if;
  select e into x from jsonb_array_elements(d -> 'excerpts') e where (e ->> 'act')::uuid = p2;
  if x -> 'poll' is distinct from '{"question": "Whose idea?", "options": [{"text": "Mine", "count": 0}, {"text": "Yours", "count": 0}, {"text": "Theirs", "count": 2}], "closed": true}'::jsonb then raise exception '5 the digest''s excerpt of a secret poll: %', x; end if;
  select e into x from jsonb_array_elements(d -> 'excerpts') e where (e ->> 'act')::uuid = p3;
  if x is null or x ? 'poll' then raise exception '5 an excerpt of a post with no poll carries one: %', x; end if;
  -- It names no voter, public or secret: no id and no name of any of the three, anywhere in the digest.
  if d::text like '%' || v1::text || '%' or d::text like '%' || v2::text || '%' or d::text like '%' || v3::text || '%' or d::text like '%Prd Voter%' then raise exception '5 the digest names a voter: %', d; end if;
  -- The digest's role reads the counts (a public view of characters counted) and no one's own ballots.
  if not has_table_privilege('kayfabb_digest', 'poll_counts', 'select') or has_table_privilege('kayfabb_digest', 'my_ballots', 'select') or has_table_privilege('kayfabb_digest', 'my_poll_closes', 'select') then raise exception '5 the digest role''s reach of the poll views'; end if;
end $$;
