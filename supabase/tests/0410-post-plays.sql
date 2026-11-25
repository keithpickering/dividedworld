-- post_plays, kind_plays, and thread_page through them (supabase/migrations/0410_post_plays.sql; docs/plans/2026-11-21-post-plays-plan.md, Task 3; design docs/plans/2026-11-21-post-plays-design.md, sections 1, 2, 5 and 6).
--   * A cast with no end, played after 30 ended Uses, is on the thread page (the cap of eight plays is gone). Red against 0402's thread_page, which keeps the oldest eight.
--   * A post with several kinds: the plays in force exactly, each kind's two stand-ins (the newest play, and the most drawn, a tie to the newer), the counts; a heart and a character card; an ended one only as a stand-in.
--   * An admin-ended play is not in force, is the stand-in when newest, and its card_end rides.
--   * Backs: a live back is in force; of four sprung backs the newest and the most drawn come with their springs; a back taken back is absent. No row or count names a back's card.
--   * Two posts in one call: each post's rows and no cross-talk. 201 posts are refused.
--   * kind_plays: three pages of 20 over 45 ended plays, newest first and disjoint, then `next` null; plays in force never appear; size 0 and 500 are clamped; a second caller sees the same plays and only their own `mine`;
--     backs page with `card` null; `spun` and `cast` come with a page.
--   * thread_page's plays for a post equal post_plays's, and its origin's likewise; its `counts` and the origin's are the counts.
--   * A back that sprang into a lockout (`did: lockedOut`, the spring's `until`) stays on the page while that lockout is ahead (the owner's answer to #993, option a): `play_post.lock_until` holds the end, post_play_ids carries
--     the back, and it stays over for post_effects_up and the counts. Two such backs, a newer sprung back with no lockout and a most-drawn Use: the page holds all of them; with the lockouts' ends past, only the stand-ins; an admin's end of one lockout drops its back.
--   * The kept tables are no signed-in player's, and an anonymous visitor reaches none of the reads.
-- The cards are this file's own (ppl...). The row bounds of the reads are in 0410-post-plays-scale.sql.

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, stack) values
    ('pplcast', 'Ppl Cast', 'sweet', 'common', 'cast', null, '{post}', null, 8),
    ('pplone', 'Ppl One', 'sweet', 'common', 'cast', null, '{post}', null, 8),
    ('ppluse', 'Ppl Use', 'salty', 'common', 'use', null, '{post}', interval '3 days', 8),
    ('pplend', 'Ppl End', 'sweet', 'common', 'cast', null, '{post}', null, 8),
    ('pplheart', 'Ppl Heart', 'sweet', 'common', 'cast', null, '{post}', null, 8),
    ('pplchar', 'Ppl Character', 'sweet', 'uncommon', 'use', null, '{character}', interval '3 days', 1),
    ('pplk', 'Ppl K', 'sweet', 'common', 'cast', null, '{post}', null, 8),
    ('pplm', 'Ppl M', 'sweet', 'common', 'cast', null, '{post}', null, 8)
  on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('pplback', 'Ppl Back', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null)
  on conflict (key) do nothing;
end $$;

-- A play: a card Act on a post, with its end by time when it has one.
create function pg_temp.play(ch uuid, th uuid, post uuid, k text, at timestamptz, ends timestamptz default null, extra jsonb default '{}') returns uuid language sql as $$
  select tests.act(ch, 'card', th, jsonb_build_object('card', k) || case when ends is not null then jsonb_build_object('ends', ends) else '{}'::jsonb end || extra, post, at)
$$;

-- Reactions, as react writes the tally.
create function pg_temp.draw(play uuid, n integer) returns void language sql as $$
  insert into reaction_tallies (act, kind, count) values (play, 'up', n) on conflict (act, kind) do update set count = reaction_tallies.count + excluded.count
$$;

-- A back and its face_down row; `sprung` writes the spring a cast would. The round makes the back's own place on the post.
create function pg_temp.back(ch uuid, who uuid, th uuid, post uuid, rnd integer, at timestamptz, ends timestamptz, sprung boolean default false) returns uuid language plpgsql as $$
declare s uuid;
begin
  s := tests.act(ch, 'set', th, '{}', post, at);
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s, who, 'pplback', post, th, rnd, ends);
  if sprung then
    perform tests.act(ch, 'spring', th, jsonb_build_object('set', s::text, 'card', 'pplback', 'trigger', 'cast', 'did', 'returned'), post, at + interval '1 minute');
  end if;
  return s;
end $$;

-- The ids of the plays (card and set Acts) of a document's `plays` array, sorted.
create function pg_temp.play_ids(arr jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((x ->> 'id')::uuid order by (x ->> 'id')::uuid), '{}'::uuid[]) from jsonb_array_elements(arr) x where x ->> 'kind' in ('card', 'set')
$$;

-- The ids of every Act of a `plays` array, sorted.
create function pg_temp.all_ids(arr jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((x ->> 'id')::uuid order by (x ->> 'id')::uuid), '{}'::uuid[]) from jsonb_array_elements(arr) x
$$;

create function pg_temp.sorted(ids uuid[]) returns uuid[] language sql as $$ select coalesce(array_agg(i order by i), '{}'::uuid[]) from unnest(ids) i $$;

-- A `counts` array as sorted jsonb, to compare two of them.
create function pg_temp.counts_of(c jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(x order by x ->> 'post', x ->> 'card' nulls first), '[]'::jsonb) from jsonb_array_elements(c) x
$$;

-- ---- 1. A cast with no end, played after 30 ended Uses, is on the page ----
-- 0402's thread_page keeps the oldest eight plays of a post; the cast is the 31st, in force with no end, and the page must carry it.
select tests.unbecome();
do $$
declare
  reader uuid := tests.account('ppl-1-reader'); rc uuid := tests.character(reader, 'Ppl One Reader');
  author uuid := tests.character(tests.account('ppl-1-author'), 'Ppl One Author');
  caster uuid := tests.character(tests.account('ppl-1-caster'), 'Ppl One Caster');
  t uuid := tests.thread('Ppl cast with no end');
  p uuid := tests.post(author, t, 'A post.', now() - interval '60 days');
  cast_play uuid; i integer; r jsonb;
begin
  perform pg_temp.cards();
  for i in 1..30 loop
    perform pg_temp.play(caster, t, p, 'ppluse', now() - interval '40 days' + i * interval '1 hour', now() - interval '40 days' + i * interval '1 hour' + interval '30 minutes');
  end loop;
  cast_play := pg_temp.play(caster, t, p, 'pplcast', now() - interval '20 days');
  perform tests.become(reader);
  r := thread_page(t, 1, null, 20, array['pplcast']);
  perform tests.unbecome();
  if not (cast_play = any (pg_temp.play_ids(r -> 'plays'))) then
    raise exception '1 the cast with no end, the 31st play, is not on the page: % plays came', jsonb_array_length(r -> 'plays');
  end if;
end $$;

-- ---- 2. One post, several kinds: in force, stand-ins, counts ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('ppl-2-ann'); a uuid := tests.character(ann, 'Ppl Two Ann');
  cacc uuid := tests.account('ppl-2-caster'); caster uuid := tests.character(cacc, 'Ppl Two Caster');
  third uuid := tests.character(tests.account('ppl-2-third'), 'Ppl Two Third');
  reader uuid := tests.account('ppl-2-reader'); rc uuid := tests.character(reader, 'Ppl Two Reader');
  t uuid := tests.thread('Ppl kinds'); p uuid := tests.post(a, t, 'A famous post.', now() - interval '40 days');
  pa uuid[] := '{}'; pb uuid[] := '{}'; e uuid[] := '{}'; s uuid[] := '{}'; sl uuid; stk uuid; heart uuid; ch_old uuid; ch_live uuid;
  i integer; r jsonb; want uuid[]; got uuid[]; c jsonb;
begin
  perform pg_temp.cards();
  insert into admins (account) values (ann);
  -- pplone: twelve plays a day apart; the last two still up; the third-oldest the most drawn (5), the 8th and 9th tie at 2.
  for i in 1..12 loop
    pa := pa || pg_temp.play(caster, t, p, 'pplone', now() - (13 - i) * interval '1 day', case when i >= 11 then now() + interval '1 day' else now() - (13 - i) * interval '1 day' + interval '1 hour' end);
  end loop;
  perform pg_temp.draw(pa[3], 5); perform pg_temp.draw(pa[8], 2); perform pg_temp.draw(pa[9], 2);
  -- pplcast: wholly over, four plays; the 2nd and 3rd tie at draw 2 (the newer, the 3rd, is the most drawn), the 1st drew 1, the 4th (newest) none.
  for i in 1..4 loop
    pb := pb || pg_temp.play(caster, t, p, 'pplcast', now() - (30 - i) * interval '1 day', now() - (30 - i) * interval '1 day' + interval '1 hour');
  end loop;
  perform pg_temp.draw(pb[1], 1); perform pg_temp.draw(pb[2], 2); perform pg_temp.draw(pb[3], 2);
  -- A heart: an instant, over as it lands; a character card, one ended and one up; an admin-ended play that is the newest of its kind, and an older one of its kind still up.
  heart := pg_temp.play(caster, t, p, 'pplheart', now() - interval '5 days', null, '{"instant": true}');
  ch_old := pg_temp.play(caster, t, p, 'pplchar', now() - interval '9 days', now() - interval '8 days', jsonb_build_object('reach', 'character', 'character', third));
  ch_live := pg_temp.play(caster, t, p, 'pplchar', now() - interval '1 day', now() + interval '2 days', jsonb_build_object('reach', 'character', 'character', third));
  e := e || pg_temp.play(caster, t, p, 'pplend', now() - interval '3 days') || pg_temp.play(caster, t, p, 'pplend', now() - interval '2 days');
  perform tests.become(ann); perform reverse_card(e[2]); perform tests.unbecome();
  -- Backs: four sprung (the 2nd the most drawn, the 4th newest), one live, one taken back.
  for i in 1..4 loop s := s || pg_temp.back(a, ann, t, p, i, now() - (20 - i) * interval '1 day', now() + interval '5 days', true); end loop;
  perform pg_temp.draw(s[2], 3); perform pg_temp.draw(s[1], 1);
  sl := pg_temp.back(a, ann, t, p, 5, now() - interval '1 hour', now() + interval '5 days', false);
  stk := pg_temp.back(a, ann, t, p, 6, now() - interval '2 hours', now() + interval '5 days', false);
  perform tests.act(a, 'take_back', t, jsonb_build_object('set', stk::text), p);
  if exists (select 1 from play_post_drift()) then raise exception '2 the fixture drifts: %', (select jsonb_agg(to_jsonb(d)) from play_post_drift() d); end if;

  perform tests.become(reader);
  r := post_plays(array[p]);
  perform tests.unbecome();
  -- The plays: in force (two of pplone, the live character card, the older admin-less pplend, the live back) plus each kind's newest and most drawn.
  want := array[pa[11], pa[12], pa[3],            -- pplone: in force, and the most drawn (the third-oldest)
                pb[3], pb[4],                      -- pplcast: the most drawn of the tie (the newer), and the newest
                heart,                             -- pplheart: the one play, an instant, as the stand-in
                ch_live,                           -- pplchar: the one in force is also the newest; the ended one is neither
                e[2], e[1],                        -- pplend: the admin-ended newest, and the older one still in force
                sl, s[4], s[2]];                   -- backs: the live one, the newest sprung and the most drawn sprung
  got := pg_temp.play_ids(r -> 'plays');
  if got is distinct from pg_temp.sorted(want) then
    raise exception '2 the plays on the page are not the plays in force and the stand-ins: got % want %', got, pg_temp.sorted(want);
  end if;
  if ch_old = any (got) or stk = any (got) or pa[8] = any (got) or pa[9] = any (got) or pb[1] = any (got) or pb[2] = any (got) or s[1] = any (got) or s[3] = any (got) then
    raise exception '2 a play that is neither in force nor a stand-in is on the page';
  end if;
  -- The riders: the admin's end of e[2], and the springs of the two sprung backs on the page; nothing else.
  if (select array_agg((x ->> 'id')::uuid order by (x ->> 'id')::uuid) from jsonb_array_elements(r -> 'plays') x where x ->> 'kind' = 'card_end')
     is distinct from (select array_agg(c2.id order by c2.id) from acts c2 where c2.kind = 'card_end' and c2.target_act_id = e[2]) then
    raise exception '2 the end of the admin-ended play does not ride: %', r -> 'plays';
  end if;
  if (select array_agg(x -> 'payload' ->> 'set' order by x -> 'payload' ->> 'set') from jsonb_array_elements(r -> 'plays') x where x ->> 'kind' = 'spring')
     is distinct from (select array_agg(v order by v) from unnest(array[s[4]::text, s[2]::text]) v) then
    raise exception '2 the springs of the two sprung backs on the page do not ride: %', r -> 'plays';
  end if;
  if exists (select 1 from jsonb_array_elements(r -> 'plays') x where x ->> 'kind' = 'take_back') then raise exception '2 a take-back rides with a back that is not on the page'; end if;
  -- Ordered by created_at, id; each once.
  if (select array_agg(x ->> 'id' order by (x ->> 'created_at')::timestamptz, (x ->> 'id')::uuid) from jsonb_array_elements(r -> 'plays') x) is distinct from (select array_agg(x ->> 'id') from jsonb_array_elements(r -> 'plays') x)
     or (select count(distinct x ->> 'id') from jsonb_array_elements(r -> 'plays') x) is distinct from jsonb_array_length(r -> 'plays')::bigint then
    raise exception '2 the plays are not in order of creation, each once';
  end if;
  -- A play is shown as acts_public shows it.
  if (select x from jsonb_array_elements(r -> 'plays') x where x ->> 'id' = pa[3]::text) is distinct from (select to_jsonb(ap) from acts_public ap where ap.id = pa[3]) then
    raise exception '2 a play is not shown as acts_public shows it';
  end if;
  -- The counts: the kind's key, every play it has had, those that took; a back is counted under null once it sprang, and no count names its card.
  c := r -> 'counts';
  if pg_temp.counts_of(c) is distinct from pg_temp.counts_of((select jsonb_agg(jsonb_build_object('post', p::text, 'card', to_jsonb(v.card), 'all', v.n, 'took', v.n)) from (values (null::text, 4), ('pplcast', 4), ('pplchar', 2), ('pplend', 2), ('pplheart', 1), ('pplone', 12)) v(card, n))) then
    raise exception '2 the counts: %', c;
  end if;
  if c::text like '%pplback%' or exists (select 1 from jsonb_array_elements(r -> 'plays') x where x ->> 'kind' = 'set' and x::text like '%pplback%') then raise exception '2 a back''s row or count names its card: %', r; end if;
  -- A refund of one of the twelve: took is one less.
  insert into card_write_refunds (play, amount) values (pa[1], 0);
  perform tests.become(reader);
  c := post_plays(array[p]) -> 'counts';
  perform tests.unbecome();
  if (select x ->> 'took' from jsonb_array_elements(c) x where x ->> 'card' = 'pplone') is distinct from '11' or (select x ->> 'all' from jsonb_array_elements(c) x where x ->> 'card' = 'pplone') is distinct from '12' then
    raise exception '2 a refunded play of twelve: %', c;
  end if;
end $$;

-- ---- 3. Two posts in one call, and 201 posts refused ----
select tests.unbecome();
do $$
declare
  a uuid := tests.character(tests.account('ppl-3-ann'), 'Ppl Three Ann'); caster uuid := tests.character(tests.account('ppl-3-caster'), 'Ppl Three Caster');
  reader uuid := tests.account('ppl-3-reader'); rc uuid := tests.character(reader, 'Ppl Three Reader');
  t uuid := tests.thread('Ppl two posts'); p1 uuid := tests.post(a, t, 'One.'); p2 uuid := tests.post(a, t, 'Two.');
  x1 uuid[] := '{}'; x2 uuid[] := '{}'; i integer; r jsonb; r1 jsonb; r2 jsonb;
begin
  perform pg_temp.cards();
  for i in 1..3 loop x1 := x1 || pg_temp.play(caster, t, p1, 'pplone', now() - i * interval '1 hour'); end loop;
  for i in 1..2 loop x2 := x2 || pg_temp.play(caster, t, p2, 'pplcast', now() - i * interval '1 hour'); end loop;
  perform tests.become(reader);
  r := post_plays(array[p1, p2]); r1 := post_plays(array[p1]); r2 := post_plays(array[p2]);
  perform tests.unbecome();
  if pg_temp.play_ids(r -> 'plays') is distinct from pg_temp.sorted(x1 || x2) then raise exception '3 the two posts'' plays: %', pg_temp.play_ids(r -> 'plays'); end if;
  if pg_temp.play_ids(r1 -> 'plays') is distinct from pg_temp.sorted(x1) or pg_temp.play_ids(r2 -> 'plays') is distinct from pg_temp.sorted(x2) then raise exception '3 cross-talk between the posts'; end if;
  if pg_temp.counts_of(r -> 'counts') is distinct from pg_temp.counts_of((r1 -> 'counts') || (r2 -> 'counts')) then raise exception '3 the counts of two posts are not each post''s: %', r -> 'counts'; end if;
  if jsonb_array_length(r1 -> 'counts') is distinct from 1 or r1 -> 'counts' -> 0 ->> 'post' is distinct from p1::text or r1 -> 'counts' -> 0 ->> 'all' is distinct from '3' then raise exception '3 one post''s counts: %', r1 -> 'counts'; end if;
  -- An empty list answers empty.
  perform tests.become(reader);
  r := post_plays('{}'::uuid[]);
  if r is distinct from '{"plays": [], "counts": []}'::jsonb then raise exception '3 an empty list: %', r; end if;
  -- 200 are allowed, 201 are refused plainly.
  perform post_plays(array(select gen_random_uuid() from generate_series(1, 200)));
  if pg_temp.coded('select post_plays(array(select gen_random_uuid() from generate_series(1, 201)))') is distinct from '22023 ask for at most 200 posts at a time' then
    raise exception '3 201 posts: %', pg_temp.coded('select post_plays(array(select gen_random_uuid() from generate_series(1, 201)))');
  end if;
  perform tests.unbecome();
end $$;

-- ---- 4. kind_plays: pages, clamps, callers, backs, spun and cast ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('ppl-4-ann'); a uuid := tests.character(ann, 'Ppl Four Ann');
  bob uuid := tests.account('ppl-4-bob'); b uuid := tests.character(bob, 'Ppl Four Bob');
  cacc uuid := tests.account('ppl-4-caster'); caster uuid := tests.character(cacc, 'Ppl Four Caster'); caster2 uuid := tests.character(tests.account('ppl-4-caster2'), 'Ppl Four Caster Two');
  t uuid := tests.thread('Ppl pages'); p uuid := tests.post(a, t, 'A post.', now() - interval '90 days');
  ended uuid[] := '{}'; up uuid[] := '{}'; backs uuid[] := '{}'; live_back uuid; i integer; r jsonb; r1 jsonb; r2 jsonb; r3 jsonb; ids uuid[]; ids2 uuid[]; ids3 uuid[]; spun uuid;
begin
  perform pg_temp.cards();
  -- pplk: 45 plays over, three up.
  for i in 1..45 loop
    ended := ended || pg_temp.play(case when i % 2 = 0 then caster else caster2 end, t, p, 'pplk', now() - interval '80 days' + i * interval '1 hour', now() - interval '80 days' + i * interval '1 hour' + interval '10 minutes');
  end loop;
  for i in 1..3 loop up := up || pg_temp.play(caster, t, p, 'pplk', now() - interval '1 hour' + i * interval '1 minute', now() + interval '1 day'); end loop;
  -- pplm: 60 over, for the size clamp.
  for i in 1..60 loop perform pg_temp.play(caster, t, p, 'pplm', now() - interval '70 days' + i * interval '1 hour', now() - interval '70 days' + i * interval '1 hour' + interval '10 minutes'); end loop;
  -- Reactions: Ann's on the 10th ended play, Bob's on the 12th, both in the public tally.
  perform tests.become(ann); perform react(ended[10], a, 'up'); perform tests.unbecome();
  perform tests.become(bob); perform react(ended[12], b, 'up'); perform tests.unbecome();
  -- A thread spun from the 40th.
  spun := tests.thread('Ppl spun from a play'); update threads set origin_act_id = ended[40] where id = spun;
  -- Backs: five sprung, one live.
  for i in 1..5 loop backs := backs || pg_temp.back(a, ann, t, p, i, now() - (30 - i) * interval '1 day', now() + interval '9 days', true); end loop;
  live_back := pg_temp.back(a, ann, t, p, 6, now() - interval '1 hour', now() + interval '9 days', false);

  -- Three pages of 20 over 45 ended plays, newest first, disjoint, in force never.
  perform tests.become(ann);
  r1 := kind_plays(p, 'pplk', null, null, 20);
  r2 := kind_plays(p, 'pplk', (r1 -> 'next' ->> 'at')::timestamptz, (r1 -> 'next' ->> 'id')::uuid, 20);
  r3 := kind_plays(p, 'pplk', (r2 -> 'next' ->> 'at')::timestamptz, (r2 -> 'next' ->> 'id')::uuid, 20);
  perform tests.unbecome();
  if jsonb_array_length(r1 -> 'plays') is distinct from 20 or jsonb_array_length(r2 -> 'plays') is distinct from 20 or jsonb_array_length(r3 -> 'plays') is distinct from 5 then
    raise exception '4 pages of 20, 20 and 5 expected: % % %', jsonb_array_length(r1 -> 'plays'), jsonb_array_length(r2 -> 'plays'), jsonb_array_length(r3 -> 'plays');
  end if;
  if r1 -> 'next' is null or r1 -> 'next' = 'null'::jsonb or r2 -> 'next' = 'null'::jsonb or r3 -> 'next' is distinct from 'null'::jsonb then raise exception '4 next: % % %', r1 -> 'next', r2 -> 'next', r3 -> 'next'; end if;
  ids := (select array_agg((x ->> 'id')::uuid order by ord) from jsonb_array_elements(r1 -> 'plays') with ordinality z(x, ord));
  if ids is distinct from array(select e from unnest(ended) with ordinality u(e, o) order by o desc limit 20) then raise exception '4 the first page is not the newest 20, newest first: %', ids; end if;
  ids2 := pg_temp.play_ids(r2 -> 'plays'); ids3 := pg_temp.play_ids(r3 -> 'plays');
  if pg_temp.sorted(pg_temp.play_ids(r1 -> 'plays') || ids2 || ids3) is distinct from pg_temp.sorted(ended) then raise exception '4 the three pages are not the 45 ended plays, each once'; end if;
  if (r1 -> 'next' ->> 'id')::uuid is distinct from ids[20] or (r1 -> 'next' ->> 'at')::timestamptz is distinct from (select created_at from acts where id = ids[20]) then raise exception '4 next is not the last play of the page: %', r1 -> 'next'; end if;
  if up && (pg_temp.play_ids(r1 -> 'plays') || ids2 || ids3) then raise exception '4 a play in force is on a page of the ended'; end if;
  -- A page that holds every ended play has no next.
  perform tests.become(ann); r := kind_plays(p, 'pplk', null, null, 50); perform tests.unbecome();
  if jsonb_array_length(r -> 'plays') is distinct from 45 or r -> 'next' is distinct from 'null'::jsonb then raise exception '4 a page that holds every ended play has a next: %', r -> 'next'; end if;
  -- size 0 is 1, size 500 is 50, null is a page of 20.
  perform tests.become(ann);
  if jsonb_array_length(kind_plays(p, 'pplm', null, null, 0) -> 'plays') is distinct from 1 then raise exception '4 size 0 is not clamped to 1'; end if;
  r := kind_plays(p, 'pplm', null, null, 500);
  if jsonb_array_length(r -> 'plays') is distinct from 50 or r -> 'next' is null or r -> 'next' = 'null'::jsonb then raise exception '4 size 500 is not clamped to 50: %', jsonb_array_length(r -> 'plays'); end if;
  if jsonb_array_length(kind_plays(p, 'pplm', null, null, null) -> 'plays') is distinct from 20 then raise exception '4 a null size is not 20'; end if;
  -- A kind the post never had is an empty page.
  r := kind_plays(p, 'pplnone', null, null, 20);
  if r -> 'plays' is distinct from '[]'::jsonb or r -> 'next' is distinct from 'null'::jsonb then raise exception '4 a kind with no plays: %', r; end if;
  perform tests.unbecome();
  -- Two callers: the same plays, the same tallies, and each caller's own `mine`.
  perform tests.become(ann); r1 := kind_plays(p, 'pplk', null, null, 50); perform tests.unbecome();
  perform tests.become(bob); r2 := kind_plays(p, 'pplk', null, null, 50); perform tests.unbecome();
  if pg_temp.all_ids(r1 -> 'plays') is distinct from pg_temp.all_ids(r2 -> 'plays') or r1 -> 'next' is distinct from r2 -> 'next' or r1 -> 'cast' is distinct from r2 -> 'cast' or r1 -> 'spun' is distinct from r2 -> 'spun' then raise exception '4 two callers see different pages'; end if;
  if (select jsonb_agg(x order by x ->> 'act', x ->> 'kind') from jsonb_array_elements(r1 -> 'tallies') x) is distinct from (select jsonb_agg(x order by x ->> 'act', x ->> 'kind') from jsonb_array_elements(r2 -> 'tallies') x) then raise exception '4 two callers see different tallies'; end if;
  if (select jsonb_agg(x order by x ->> 'act', x ->> 'kind') from jsonb_array_elements(r1 -> 'tallies') x) is distinct from (select jsonb_agg(jsonb_build_object('act', t2.act, 'kind', t2.kind, 'count', t2.count) order by t2.act::text, t2.kind) from reaction_tallies t2 where t2.act = any (ended)) then raise exception '4 tallies: %', r1 -> 'tallies'; end if;
  if (select array_agg(x ->> 'act') from jsonb_array_elements(r1 -> 'mine') x) is distinct from array[ended[10]::text] or (select array_agg(x ->> 'act') from jsonb_array_elements(r2 -> 'mine') x) is distinct from array[ended[12]::text] then
    raise exception '4 mine is not each caller''s own: % %', r1 -> 'mine', r2 -> 'mine';
  end if;
  -- spun: the thread spun from the 40th; cast: the heads of the casters of the plays on the page.
  if (select array_agg(x ->> 'id') from jsonb_array_elements(r1 -> 'spun') x) is distinct from array[spun::text] then raise exception '4 spun: %', r1 -> 'spun'; end if;
  if (select array_agg(x -> 'character' ->> 'id' order by x -> 'character' ->> 'id') from jsonb_array_elements(r1 -> 'cast') x) is distinct from (select array_agg(c::text order by c::text) from unnest(array[caster, caster2]) c) then raise exception '4 cast: %', r1 -> 'cast'; end if;
  -- Backs page with a null card: the sprung ones, newest first, with their springs; the live back never.
  perform tests.become(ann); r := kind_plays(p, null, null, null, 3); perform tests.unbecome();
  if (select array_agg((x ->> 'id')::uuid order by ord) from jsonb_array_elements(r -> 'plays') with ordinality z(x, ord) where x ->> 'kind' = 'set') is distinct from array[backs[5], backs[4], backs[3]] then raise exception '4 the newest three sprung backs: %', r -> 'plays'; end if;
  if (select array_agg(x ->> 'kind' order by x ->> 'kind') from jsonb_array_elements(r -> 'plays') x) is distinct from array['set', 'set', 'set', 'spring', 'spring', 'spring'] then raise exception '4 the springs of the three backs ride: %', r -> 'plays'; end if;
  if r -> 'next' is null or r -> 'next' = 'null'::jsonb or exists (select 1 from jsonb_array_elements(r -> 'plays') x where x ->> 'kind' = 'set' and x::text like '%pplback%') then raise exception '4 backs: next %', r -> 'next'; end if;
  perform tests.become(ann); r := kind_plays(p, null, (r -> 'next' ->> 'at')::timestamptz, (r -> 'next' ->> 'id')::uuid, 3); perform tests.unbecome();
  if (select array_agg((x ->> 'id')::uuid order by ord) from jsonb_array_elements(r -> 'plays') with ordinality z(x, ord) where x ->> 'kind' = 'set') is distinct from array[backs[2], backs[1]] or r -> 'next' is distinct from 'null'::jsonb then raise exception '4 the older sprung backs: %', r -> 'plays'; end if;
  if live_back = any (pg_temp.play_ids(r -> 'plays')) then raise exception '4 a live back is on a page of the over'; end if;
  -- The kept tables are no signed-in player's, and an anonymous visitor reaches none of the reads.
  perform tests.become(ann);
  if pg_temp.coded('select * from play_post') not like '42501%' or pg_temp.coded('select * from post_kinds') not like '42501%' then raise exception '4 a signed-in player reads a kept table'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  if pg_temp.coded(format('select post_plays(array[%L::uuid])', p)) not like '42501%' or pg_temp.coded(format('select kind_plays(%L, null, null, null, 20)', p)) not like '42501%' then raise exception '4 a visitor reads the plays'; end if;
  perform tests.unbecome();
end $$;

-- ---- 4b. A page boundary between plays played at the same moment ----
-- The cursor is the pair (time, id): a cursor on the time alone drops the plays of the same moment that sort after the boundary one. 22 ended plays of one kind at one created_at, pages of 10.
select tests.unbecome();
do $$
declare
  a uuid := tests.character(tests.account('ppl-4b-ann'), 'Ppl Four B Ann'); caster uuid := tests.character(tests.account('ppl-4b-caster'), 'Ppl Four B Caster');
  t uuid := tests.thread('Ppl ties'); p uuid := tests.post(a, t, 'A post.', now() - interval '10 days');
  tied uuid[] := '{}'; i integer; r jsonb; got uuid[] := '{}'; b_at timestamptz; b_id uuid; pages integer := 0;
begin
  perform pg_temp.cards();
  for i in 1..22 loop tied := tied || pg_temp.play(caster, t, p, 'pplk', now() - interval '5 days', now() - interval '4 days'); end loop;
  perform tests.become(a);
  loop
    r := kind_plays(p, 'pplk', b_at, b_id, 10);
    got := got || pg_temp.play_ids(r -> 'plays'); pages := pages + 1;
    exit when r -> 'next' = 'null'::jsonb or pages > 5;
    b_at := (r -> 'next' ->> 'at')::timestamptz; b_id := (r -> 'next' ->> 'id')::uuid;
  end loop;
  perform tests.unbecome();
  if pages is distinct from 3 or cardinality(got) is distinct from 22 or pg_temp.sorted(got) is distinct from pg_temp.sorted(tied) then
    raise exception '4b the pages of 10 over 22 plays of one moment are not disjoint and whole: % pages, % plays, % distinct', pages, cardinality(got), (select count(distinct g) from unnest(got) g);
  end if;
end $$;

-- ---- 5. An admin's end of the newest play: not in force, the stand-in, its card_end rides, kind_plays pages it ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('ppl-5-ann'); a uuid := tests.character(ann, 'Ppl Five Ann'); caster uuid := tests.character(tests.account('ppl-5-caster'), 'Ppl Five Caster');
  t uuid := tests.thread('Ppl admin end'); p uuid := tests.post(a, t, 'A post.');
  x1 uuid; x2 uuid; r jsonb; ce uuid;
begin
  perform pg_temp.cards();
  insert into admins (account) values (ann);
  x1 := pg_temp.play(caster, t, p, 'pplend', now() - interval '2 hours');
  x2 := pg_temp.play(caster, t, p, 'pplend', now() - interval '1 hour');
  perform tests.become(ann); perform reverse_card(x2); r := post_plays(array[p]); perform tests.unbecome();
  ce := (select id from acts where kind = 'card_end' and target_act_id = x2);
  if pg_temp.play_ids(r -> 'plays') is distinct from pg_temp.sorted(array[x1, x2]) then raise exception '5 the ended newest and the one in force are the page: %', pg_temp.play_ids(r -> 'plays'); end if;
  if not (ce = any (pg_temp.all_ids(r -> 'plays'))) then raise exception '5 the card_end of the ended play does not ride'; end if;
  -- It is not in force: kind_plays pages it, with its end.
  perform tests.become(ann); r := kind_plays(p, 'pplend', null, null, 20); perform tests.unbecome();
  if pg_temp.play_ids(r -> 'plays') is distinct from array[x2] or not (ce = any (pg_temp.all_ids(r -> 'plays'))) then raise exception '5 kind_plays does not page the admin-ended play with its end: %', r -> 'plays'; end if;
end $$;

-- ---- 6. thread_page's plays and counts are post_plays's, and the origin's likewise ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('ppl-6-ann'); a uuid := tests.character(ann, 'Ppl Six Ann'); sp uuid := tests.account('ppl-6-spinner'); spc uuid := tests.character(sp, 'Ppl Six Spinner');
  cacc uuid := tests.account('ppl-6-caster'); caster uuid := tests.character(cacc, 'Ppl Six Caster'); reader uuid := tests.account('ppl-6-reader'); rc uuid := tests.character(reader, 'Ppl Six Reader');
  t uuid := tests.thread('Ppl page parity'); p uuid := tests.post(a, t, 'A post that is spun from.', now() - interval '30 days'); p2 uuid := tests.post(a, t, 'A second post.', now() - interval '29 days');
  i integer; r jsonb; pr jsonb; spun_t uuid; made jsonb; o jsonb;
begin
  perform pg_temp.cards();
  for i in 1..12 loop perform pg_temp.play(caster, t, p, 'pplone', now() - (13 - i) * interval '1 day', case when i >= 11 then now() + interval '1 day' else now() - (13 - i) * interval '1 day' + interval '1 hour' end); end loop;
  for i in 1..9 loop perform pg_temp.play(caster, t, p, 'pplcast', now() - (30 - i) * interval '1 hour'); end loop;
  for i in 1..3 loop perform pg_temp.back(a, ann, t, p, i, now() - (20 - i) * interval '1 day', now() + interval '5 days', true); end loop;
  perform pg_temp.back(a, ann, t, p, 4, now() - interval '1 hour', now() + interval '5 days', false);
  perform pg_temp.play(caster, t, p2, 'pplone', now() - interval '1 day');
  perform pg_temp.draw((select id from acts where target_act_id = p and kind = 'card' and payload ->> 'card' = 'pplone' order by created_at limit 1), 4);

  perform tests.become(reader);
  r := thread_page(t, 1, null, 20, array['pplone']);
  pr := post_plays(array[p, p2]);
  perform tests.unbecome();
  if (select jsonb_agg(x order by x ->> 'created_at', x ->> 'id') from jsonb_array_elements(r -> 'plays') x) is distinct from (select jsonb_agg(x order by x ->> 'created_at', x ->> 'id') from jsonb_array_elements(pr -> 'plays') x) then
    raise exception '6 thread_page''s plays are not post_plays''s: % vs %', jsonb_array_length(r -> 'plays'), jsonb_array_length(pr -> 'plays');
  end if;
  if pg_temp.counts_of(r -> 'counts') is distinct from pg_temp.counts_of(pr -> 'counts') or jsonb_array_length(r -> 'counts') < 4 then
    raise exception '6 thread_page''s counts are not post_plays''s: % vs %', r -> 'counts', pr -> 'counts';
  end if;
  -- More than the eight a post's plays used to be capped at.
  if jsonb_array_length(r -> 'plays') < 12 then raise exception '6 the page holds %, no more than the old cap allows', jsonb_array_length(r -> 'plays'); end if;
  -- The origin: a thread spun from the post carries the same plays and counts as post_plays gives for it, and no `more`.
  perform tests.become(sp);
  made := spin(origin => p, through => spc, title => 'Ppl spun from the post', body => 'Discuss.', at_post => null);
  perform tests.unbecome();
  spun_t := (select thread from acts where id = (made -> 'act' ->> 'id')::uuid);
  perform tests.become(reader);
  r := thread_page(spun_t, 1, null, 20, array['pplone']);
  pr := post_plays(array[p]);
  perform tests.unbecome();
  o := r -> 'origin';
  if (select jsonb_agg(x order by x ->> 'created_at', x ->> 'id') from jsonb_array_elements(o -> 'plays') x) is distinct from (select jsonb_agg(x order by x ->> 'created_at', x ->> 'id') from jsonb_array_elements(pr -> 'plays') x) then
    raise exception '6 the origin''s plays are not post_plays''s: % vs %', jsonb_array_length(o -> 'plays'), jsonb_array_length(pr -> 'plays');
  end if;
  if pg_temp.counts_of(o -> 'counts') is distinct from pg_temp.counts_of(pr -> 'counts') or jsonb_array_length(o -> 'counts') is distinct from 3 then
    raise exception '6 the origin''s counts are not post_plays''s: % vs %', o -> 'counts', pr -> 'counts';
  end if;
  if o ? 'more' then raise exception '6 the origin still says whether more plays exist'; end if;
  if jsonb_array_length(o -> 'plays') < 12 then raise exception '6 the origin holds %', jsonb_array_length(o -> 'plays'); end if;
end $$;

-- ---- 7. A back that sprang into a lockout stays on the page while the lockout is ahead (#993, option a) ----
-- Post `l` has two backs sprung into lockouts that end in an hour, a newer back sprung with no lockout and a Use that is over and the most drawn of its kind; post `g` has the same, with the lockouts' ends past. Each back is a stand-in only
-- if it is the newest or the most drawn sprung back (the newest alone here), so the two locked-out backs are on the page only through their lockouts.
select tests.unbecome();
do $$
declare
  aacct uuid := tests.account('ppl-7-ann'); a uuid := tests.character(aacct, 'Ppl Seven Ann'); caster uuid := tests.character(tests.account('ppl-7-caster'), 'Ppl Seven Caster');
  reader uuid := tests.account('ppl-7-reader'); rc uuid := tests.character(reader, 'Ppl Seven Reader');
  t uuid := tests.thread('Ppl lockouts');
  l uuid := tests.post(a, t, 'Locked.'); g uuid := tests.post(a, t, 'Gone.');
  lb uuid[] := '{}'; gb uuid[] := '{}'; ln uuid; gn uuid; lu uuid; gu uuid; sp uuid; r jsonb; got uuid[]; i integer; k integer;
  drift text;
begin
  perform pg_temp.cards();
  for k in 1..2 loop
    -- k = 1 is post l (lockouts ahead), k = 2 is post g (lockouts past).
    for i in 1..2 loop
      declare po uuid := case when k = 1 then l else g end; s uuid; ends timestamptz := case when k = 1 then now() + interval '1 hour' else now() - interval '1 hour' end;
      begin
        s := tests.act(a, 'set', t, '{}', po, now() - (10 - i) * interval '1 hour');
        insert into face_down (play, account, card, post, thread, round, ends_at) values (s, aacct, 'pplback', po, t, i, now() + interval '1 day');
        perform tests.act(a, 'spring', t, jsonb_build_object('set', s::text, 'card', 'pplback', 'trigger', 'cast', 'did', 'lockedOut', 'locks', caster::text, 'until', ends::text), po, now() - (10 - i) * interval '1 hour' + interval '1 minute');
        if k = 1 then lb := lb || s; else gb := gb || s; end if;
      end;
    end loop;
  end loop;
  -- A newer back that sprang with no lockout, and a Use that is over (its end past) and the most drawn of its kind, on each post.
  ln := pg_temp.back(a, aacct, t, l, 3, now() - interval '2 hours', now() + interval '1 day', true);
  gn := pg_temp.back(a, aacct, t, g, 3, now() - interval '2 hours', now() + interval '1 day', true);
  lu := pg_temp.play(caster, t, l, 'ppluse', now() - interval '5 days', now() - interval '4 days'); perform pg_temp.draw(lu, 9);
  gu := pg_temp.play(caster, t, g, 'ppluse', now() - interval '5 days', now() - interval '4 days'); perform pg_temp.draw(gu, 9);
  -- The kept rows: the lockout's end on the two backs that sprang into one, null on the others, and nothing drifts.
  if (select array_agg(p.lock_until is not null order by p.play) from play_post p where p.play = any (lb)) is distinct from (select array_agg(true order by x) from unnest(lb) x) then raise exception '7 a back sprung into a lockout holds no lock_until'; end if;
  if exists (select 1 from play_post p where p.play = any (array[ln, gn, lu, gu]) and p.lock_until is not null) then raise exception '7 a play that is no lockout holds a lock_until'; end if;
  if (select p.lock_until from play_post p where p.play = lb[1]) is distinct from (select (s.payload ->> 'until')::timestamptz from acts s where s.kind = 'spring' and s.payload ->> 'set' = lb[1]::text) then raise exception '7 lock_until is not the spring''s until'; end if;
  select string_agg(d.why, '; ') into drift from play_post_drift() d where d.play = any (lb || gb || array[ln, gn, lu, gu, l, g]);
  if drift is not null then raise exception '7 the kept rows drift: %', drift; end if;
  -- Changed by 0412_lockout_play_post.sql: a back sprung into a lockout is in force while the lockout is, so its ends_at is the spring's until and its over_at is null (no admin has ended it); post_effects_up still counts it for no slot.
  if exists (select 1 from play_post p where p.play = any (lb || gb) and p.over_at is not null) then raise exception '7 a back sprung into a lockout is over before an admin ends it'; end if;
  if exists (select 1 from play_post p where p.play = any (lb || gb) and p.ends_at is distinct from (select (s.payload ->> 'until')::timestamptz from acts s where s.kind = 'spring' and s.payload ->> 'set' = p.play::text)) then raise exception '7 a back sprung into a lockout does not end at the spring''s until'; end if;
  if post_effects_up(l) <> 0 or post_effects_up(g) <> 0 then raise exception '7 a back sprung into a lockout holds a slot of the post: %, %', post_effects_up(l), post_effects_up(g); end if;
  if (select plays from post_kinds where post = l and kind = '') is distinct from 3 or (select plays from post_kinds where post = g and kind = '') is distinct from 3 then raise exception '7 the count of backs that sprang is not 3 on each post'; end if;
  -- The page: the lockouts ahead keep their backs up, with the newest sprung back and the Use; the lockouts past leave the stand-ins alone.
  perform tests.become(reader);
  r := post_plays(array[l]);
  got := pg_temp.play_ids(r -> 'plays');
  if got is distinct from pg_temp.sorted(lb || array[ln, lu]) then raise exception '7 the post with lockouts ahead: the page holds % and should hold the two locked-out backs, the newest sprung back and the Use: %', got, pg_temp.sorted(lb || array[ln, lu]); end if;
  if (select array_agg(x -> 'payload' ->> 'set' order by x -> 'payload' ->> 'set') from jsonb_array_elements(r -> 'plays') x where x ->> 'kind' = 'spring') is distinct from (select array_agg(v order by v) from unnest((lb || array[ln])::text[]) v)
    then raise exception '7 the springs of the backs do not ride: %', r -> 'plays'; end if;
  r := post_plays(array[g]);
  got := pg_temp.play_ids(r -> 'plays');
  if got is distinct from pg_temp.sorted(array[gn, gu]) then raise exception '7 the post with lockouts past: the page holds % and should hold only the stand-ins %', got, pg_temp.sorted(array[gn, gu]); end if;
  r := post_plays(array[l, g]);
  if pg_temp.play_ids(r -> 'plays') is distinct from pg_temp.sorted(lb || array[ln, lu, gn, gu]) then raise exception '7 two posts in one call: %', pg_temp.play_ids(r -> 'plays'); end if;
  perform tests.unbecome();
  -- An admin ends the first lockout early (reverse_card writes a card_end on its spring, as lockout_ends reads): its back leaves the page (it is no stand-in), its lock_until is null, the other stays, and nothing drifts.
  insert into admins (account) values (aacct);
  sp := (select s.id from acts s where s.kind = 'spring' and s.payload ->> 'set' = lb[1]::text);
  perform tests.become(aacct);
  perform reverse_card(sp);
  perform tests.become(reader);
  r := post_plays(array[l]);
  perform tests.unbecome();
  if (select p.lock_until from play_post p where p.play = lb[1]) is not null then raise exception '7 an ended lockout still holds a lock_until'; end if;
  -- Changed by 0412: the admin's end is the back's over_at (the card_end's time), and its ends_at stays the spring's until.
  if (select p.over_at from play_post p where p.play = lb[1]) is distinct from (select e.created_at from acts e where e.kind = 'card_end' and e.target_act_id = sp) then raise exception '7 an admin''s end of the lockout is not the back''s over_at'; end if;
  if (select p.over_at from play_post p where p.play = lb[2]) is not null then raise exception '7 the lockout that was not ended is over'; end if;
  if (select p.lock_until from play_post p where p.play = lb[2]) is null then raise exception '7 the lockout that was not ended lost its lock_until'; end if;
  got := pg_temp.play_ids(r -> 'plays');
  if got is distinct from pg_temp.sorted(array[lb[2], ln, lu]) then raise exception '7 after an admin ended one lockout the page holds % and should hold %', got, pg_temp.sorted(array[lb[2], ln, lu]); end if;
  select string_agg(d.why, '; ') into drift from play_post_drift() d where d.play = any (lb || gb || array[ln, gn, lu, gu, l, g]);
  if drift is not null then raise exception '7 the kept rows drift after an admin ended a lockout: %', drift; end if;
end $$;
