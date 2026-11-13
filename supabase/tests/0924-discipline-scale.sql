-- What the fall's reads cost at a busy instance's scale (supabase/migrations/0420_discipline_cards.sql, Task 4 of docs/plans/2026-11-11-card-notes-part-5-plan.md).
--
-- Two reads were found to be led by every fall infraction the instance holds: thread_page's `spent` (the plays an infraction names), which read the infractions through acts_public, whose concealing layer hides
-- `fall_play` from acts_fall_spent and so hashed them all whenever a page held a fall play; and my_falls_taken (the author's log row), which began from the infractions and filtered to the caller's posts afterward.
-- Each must cost what its caller's page or characters cost, never what the instance's falls cost. The rows of `acts` a call reads are counted from the transaction's own statistics (pg_stat_xact_user_tables: the
-- tuples a sequential scan read plus the tuples an index fetched), around the call.
--
-- Cases: 5,000 fall infractions about nobody's page, then a page with one fall play on it; 50,000 fall infractions, then a caller of five characters and 20,000 posts with three falls taken for them.
-- The fixture is written with the append-only and warn-guard triggers off for this transaction only (the runner rolls it back), as 0146-card-writes-at-scale.sql does, and analyzed before each read.

create function pg_temp.acts_read() returns bigint language sql as $$
  select coalesce(sum(seq_tup_read + idx_tup_fetch), 0)::bigint from pg_stat_xact_user_tables where schemaname = 'public' and relname = 'acts'
$$;

-- A fall infraction as infract writes it: about a post, naming the play (and, for the log, the post's author character).
create function pg_temp.fall_infraction(in_thread uuid, taker uuid, post uuid, play uuid, author uuid, visit uuid default null) returns void language sql as $$
  insert into acts (character, kind, thread, payload, seq)
  values (null, 'infraction', in_thread, jsonb_build_object('character', taker, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', (select board from threads where id = in_thread),
          'about_act', post, 'visit_act', visit, 'staff', 'sc-mod', 'expires_at', now() + interval '1 day', 'fall_play', play, 'fall_for', author), null)
$$;

-- ---- 1. thread_page: one probe of acts_fall_spent for each fall play on the page ----
do $$
declare
  t uuid := tests.thread('Scale page');
  author uuid := tests.character(tests.account('sc-author'), 'Sc Author');
  taker uuid := tests.character(tests.account('sc-taker'), 'Sc Taker');
  p uuid; v uuid; play uuid; before bigint; after bigint; page jsonb;
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, discipline) values ('t-fscale', 'Test Fall Scale', 'sweet', 'uncommon', 'cast', '{post}', '{"kind": "fall"}');
  p := tests.act(author, 'post', t, '{"body": "A post with a fall on it."}');
  play := tests.act(taker, 'card', t, '{"card": "t-fscale", "message": "", "config": {}, "layer": 1}', p);
  alter table acts disable trigger user;
  -- A visit of a Mod's on the post, which the page's own visits read finds, and the filing's infraction names it.
  insert into characters (name, staff, staff_kind, debuted_at) values ('Sc Mod', 'sc-mod', 'persona', now());
  v := tests.act((select id from characters where staff = 'sc-mod'), 'visit', t,
                 jsonb_build_object('charges', jsonb_build_array(jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'patrol', 'about_act', p::text)),
                                    'ends_at', now() - interval '1 hour', 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.'), p);
  insert into acts (character, kind, thread, payload, seq)
  select null, 'infraction', t, jsonb_build_object('character', gen_random_uuid(), 'band', 'minor', 'points', 2, 'rule_number', null, 'board', (select board from threads where id = t),
         'about_act', gen_random_uuid(), 'visit_act', null, 'staff', 'sc-mod', 'expires_at', now() + interval '1 day', 'fall_play', gen_random_uuid(), 'fall_for', gen_random_uuid()), null
  from generate_series(1, 5000);
  alter table acts enable trigger user;
  analyze acts;
  perform tests.become(tests.account('sc-reader'));
  before := pg_temp.acts_read();
  page := thread_page(t, 1, null, 50, array['t-fscale']);
  after := pg_temp.acts_read();
  perform tests.unbecome();
  if page -> 'spent' is distinct from '[]'::jsonb then raise exception 'no filing took this fall: spent is %', page -> 'spent'; end if;
  if after - before > 400 then
    raise exception 'thread_page read % rows of acts for a page of one post and one fall play, with 5,000 fall infractions on the instance: spent must be a probe for each fall play, not the instance''s falls', after - before;
  end if;
  raise notice 'thread_page read % rows of acts with 5,000 fall infractions about', after - before;
  -- And it still names the play once an infraction does.
  alter table acts disable trigger user;
  perform pg_temp.fall_infraction(t, taker, p, play, author, v);
  alter table acts enable trigger user;
  perform tests.become((select id from accounts a join auth.users u using (id) where u.email = 'sc-reader@test.invalid'));
  page := thread_page(t, 1, null, 50, array['t-fscale']);
  perform tests.unbecome();
  if page -> 'spent' is distinct from jsonb_build_array(play) then raise exception 'thread_page.spent names the spent play: %', page -> 'spent'; end if;
end $$;

-- ---- 2. my_falls_taken: bounded by the caller's own characters and the falls taken for them ----
do $$
declare
  t uuid := tests.thread('Scale log');
  me uuid := tests.account('sc-me');
  taker uuid := tests.character(tests.account('sc-taker2'), 'Sc Taker Two');
  mine uuid[]; k integer; posts uuid[]; before bigint; after bigint; n bigint;
begin
  for k in 1..5 loop mine := mine || tests.character(me, 'Sc Mine ' || k); end loop;
  alter table acts disable trigger user;
  -- 20,000 posts of the caller's, 4,000 for each of its five characters
  insert into acts (character, kind, thread, payload, seq)
  select mine[g % 5 + 1], 'post', t, jsonb_build_object('body', 'Post ' || g), g from generate_series(1, 20000) g;
  -- 50,000 fall infractions about other authors' posts
  insert into acts (character, kind, thread, payload, seq)
  select null, 'infraction', t, jsonb_build_object('character', taker, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', (select board from threads where id = t),
         'about_act', gen_random_uuid(), 'visit_act', null, 'staff', 'sc-mod', 'expires_at', now() + interval '1 day', 'fall_play', gen_random_uuid(), 'fall_for', gen_random_uuid()), null
  from generate_series(1, 50000);
  -- three taken for the caller's characters
  select array_agg(id) into posts from (select id from acts where kind = 'post' and thread = t order by seq limit 3) x;
  for k in 1..3 loop
    perform pg_temp.fall_infraction(t, taker, posts[k], gen_random_uuid(), (select character from acts where id = posts[k]));
  end loop;
  alter table acts enable trigger user;
  analyze acts;
  perform tests.become(me);
  before := pg_temp.acts_read();
  select count(*) into n from my_falls_taken;
  after := pg_temp.acts_read();
  perform tests.unbecome();
  raise notice 'my_falls_taken read % rows of acts with 50,000 fall infractions about', after - before;
  if n is distinct from 3 then raise exception 'the caller has three falls taken for it, the view shows %', n; end if;
  if after - before > 1500 then
    raise exception 'my_falls_taken read % rows of acts for a caller of five characters and three falls, with 50,000 fall infractions on the instance: it must start from the caller''s characters', after - before;
  end if;
end $$;
