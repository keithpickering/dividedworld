-- The patrol reads whole posts (supabase/migrations/0433_digest_sees_the_board.sql, the patrol_sample section; docs/plans/2026-11-25-digest-sees-the-board-plan.md, Task 4).
-- patrol_sample returns, for each sampled post, its words whole (a 2,000-character post is not cut), its post_extras (poll, plays, reactions, rewoundTo, and the rewound body), and for a post that opens a spun thread its
-- origin as pool_read gives it. A secret ballot's voter, an unsprung set and an account never appear; the sample's draw is the same, and its door and owner are what 0362 left.
-- The rows are this file's own (pws...), on a board of its own that the sample reads alone: the suite runs every file on one database, so a sample drawn from General would see the posts other files committed (CI: 50 where this file wrote 9).

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if ok is not true then raise exception '%', what; end if; end $$;

insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, stack) values
  ('pwsplat', 'Pws Splat', 'salty', 'common', 'cast', null, '{post}', null, 8)
on conflict (key) do nothing;
insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
  ('pwback', 'Pws Back', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null)
on conflict (key) do nothing;
insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, rewind) values ('pwrewind', 'Pws Rewind', 'salty', 'rare', 'cast', '{post}', interval '1 day', 1, 'rare')
on conflict (key) do nothing;

do $$
declare
  aa uuid := tests.account('pws-ann'); ab uuid := tests.account('pws-bob'); ac uuid := tests.account('pws-cat'); ad uuid := tests.account('pws-dee'); ae uuid := tests.account('pws-eve');
  a uuid := tests.character(aa, 'Pws Ann'); b uuid := tests.character(ab, 'Pws Bob'); c uuid := tests.character(ac, 'Pws Cat'); d uuid := tests.character(ad, 'Pws Dee'); e5 uuid := tests.character(ae, 'Pws Eve');
  board uuid; t uuid;
  base timestamptz := now() - interval '3 days';
  long text := repeat('Whole words that go on. ', 84) || 'THE END.';
  p_long uuid; p_poll uuid; p_sec uuid; p_play uuid; p_rw uuid; p_plain uuid; pl uuid; spl uuid; secret_ballot uuid; w uuid; us uuid; made jsonb; sth uuid; opener uuid; mth uuid; mopener uuid; p_eve uuid; p_eve2 uuid; mod_c uuid;
  r jsonb; x jsonb; o jsonb; txt text; n integer;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into boards (slug, name) values ('pws-board', 'Pws Board') returning id into board;
  insert into threads (board, title) values (board, 'Pws Main') returning id into t;
  p_long := tests.post(a, t, long, base);
  p_plain := tests.post(a, t, 'Plain.', base + interval '1 minute');
  -- a public poll with votes
  p_poll := tests.post(a, t, 'A poll is under this.', base + interval '2 minutes');
  pl := tests.act(a, 'poll', t, jsonb_build_object('question', 'Best kart?', 'options', '["Pipe Frame", "Badwagon"]'::jsonb, 'pick', 1, 'secret', false, 'closes_at', now() + interval '1 day'), p_poll, now() - interval '1 day');
  perform tests.act(b, 'ballot', t, '{"picks": [0]}', pl, now() - interval '5 hours');
  perform tests.act(c, 'ballot', t, '{"picks": [1]}', pl, now() - interval '4 hours');
  -- a secret poll
  p_sec := tests.post(a, t, 'A secret poll is under this.', base + interval '3 minutes');
  pl := tests.act(a, 'poll', t, jsonb_build_object('question', 'Who did it?', 'options', '["One", "Two"]'::jsonb, 'pick', 1, 'secret', true, 'closes_at', now() + interval '1 day'), p_sec, now() - interval '1 day');
  secret_ballot := tests.act(b, 'ballot', t, '{"picks": [1]}', pl, now() - interval '3 hours');
  perform tests.act(c, 'ballot', t, '{"picks": [1]}', pl, now() - interval '2 hours');
  -- a play with a state, and an unsprung back
  p_play := tests.post(b, t, 'Played on.', base + interval '4 minutes');
  w := tests.act(a, 'card', t, jsonb_build_object('card', 'pwsplat', 'config', jsonb_build_object('color', 'teal')), p_play, now() - interval '2 days');
  insert into effect_state (play, state, saved_by, saved_at) values (w, '{"strokes": [[1, 2]], "washed": 0.25}', a, now() - interval '1 day');
  -- Eve has a post under a visit (never sampled) and a second, sampled post carrying her unsprung face-down set
  p_eve := tests.post(e5, t, 'Eve is under a visit.', base + interval '6 minutes');
  insert into characters (owner, name, staff, staff_kind, created_at, debuted_at) values (null, 'Pws Mod', 'pws-mod', 'persona', base, base) returning id into mod_c;
  perform tests.act(mod_c, 'visit', t, jsonb_build_object('charges', jsonb_build_array(jsonb_build_object('rule_number', null, 'board', board, 'band', 'minor', 'cause', 'patrol', 'about_act', p_eve::text, 'rule', 'the premise')), 'ends_at', now() + interval '1 day', 'challenge', '{"kind": "quiz"}'::jsonb, 'line', 'Hi.'), p_eve, now() - interval '30 hours');
  p_eve2 := tests.post(e5, t, 'Eve is in the sample.', base + interval '7 minutes');
  us := tests.act(e5, 'set', t, '{}', p_eve2, now() - interval '20 hours');
  insert into face_down (play, account, card, post, thread, round, ends_at) values (us, ae, 'pwback', p_eve2, t, 1, now() + interval '1 day');
  -- a rewound post
  p_rw := tests.post(a, t, 'First words.', base + interval '5 minutes');
  perform tests.act(a, 'edit', t, '{"body": "Second words."}', p_rw, now() - interval '2 days');
  perform tests.act(a, 'edit', t, '{"body": "Third words."}', p_rw, now() - interval '1 day');
  perform tests.act(b, 'card', t, jsonb_build_object('card', 'pwrewind', 'reach', 'post', 'ends', now() + interval '1 day', 'rewind_at', now() - interval '36 hours'), p_rw, now() - interval '1 hour');
  -- a thread spun from the polled post, opened by Dee
  made := spin_written(p_poll, d, 'Pws Spun', 'Discuss the poll.', false, array[]::uuid[], null);
  sth := (made -> 'thread' ->> 'id')::uuid;

  -- a thread spun from the play on that post: a moment, the plays as they stood
  made := spin_written(w, d, 'Pws Moment', 'Discuss the splat.', false, array[]::uuid[], null);
  mth := (made -> 'thread' ->> 'id')::uuid;

  r := patrol_sample(array[board], 50, 50, 1);
  n := jsonb_array_length(r);
  perform pg_temp.expect(n = 9, 'the sample holds the 7 posts and the two spun openers: ' || n);
  -- whole words
  x := (select e from jsonb_array_elements(r) e where e ->> 'act' = p_long::text);
  perform pg_temp.expect(x ->> 'body' = long and length(x ->> 'body') > 2000 and x ->> 'body' like '%THE END.', 'a long post is not whole: ' || length(x ->> 'body'));
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys(x) k) = array['act', 'board', 'body', 'name', 'origin', 'plays', 'poll', 'pronouns', 'reactions', 'rewoundTo', 'thread', 'title'], 'the keys of a sampled post: ' || left(x::text, 300));
  perform pg_temp.expect(x -> 'origin' = 'null'::jsonb and x -> 'poll' = 'null'::jsonb and x -> 'plays' = '[]'::jsonb, 'a plain post has nothing more: ' || x::text);
  -- the poll
  x := (select e from jsonb_array_elements(r) e where e ->> 'act' = p_poll::text);
  perform pg_temp.expect(x -> 'poll' ->> 'question' = 'Best kart?' and x -> 'poll' -> 'counts' = '[1, 1]'::jsonb and x -> 'poll' -> 'voters' = '2'::jsonb and x -> 'poll' -> 'secret' = 'false'::jsonb, 'the poll: ' || x::text);
  -- the secret poll: counts, and no voter, no ballot, no account
  x := (select e from jsonb_array_elements(r) e where e ->> 'act' = p_sec::text);
  perform pg_temp.expect(x -> 'poll' -> 'secret' = 'true'::jsonb and x -> 'poll' -> 'counts' = '[0, 2]'::jsonb, 'the secret poll: ' || x::text);
  perform pg_temp.expect(r::text !~ secret_ballot::text and r::text !~ 'picks' and r::text !~ ac::text and r::text !~ ab::text and r::text !~ aa::text and r::text !~ 'Pws Cat', 'the sample names a ballot, a picker or an account: ' || left(r::text, 1500));

  -- the play, and no unsprung back
  x := (select e from jsonb_array_elements(r) e where e ->> 'act' = p_play::text);
  perform pg_temp.expect(jsonb_array_length(x -> 'plays') = 1 and x -> 'plays' -> 0 ->> 'card' = 'pwsplat' and x -> 'plays' -> 0 ->> 'by' = 'Pws Ann' and x -> 'plays' -> 0 -> 'state' = '{"strokes": [[1, 2]], "washed": 0.25}'::jsonb, 'the play: ' || x::text);
  perform pg_temp.expect(r::text !~ 'pwback' and r::text !~ us::text and r::text !~ ae::text, 'an unsprung back is in the sample: ' || left(r::text, 1500));
  x := (select e from jsonb_array_elements(r) e where e ->> 'act' = p_eve2::text);
  perform pg_temp.expect(x is not null and x ->> 'name' = 'Pws Eve', 'the post carrying the unsprung set is sampled: ' || coalesce(x::text, 'none'));
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(x -> 'plays') pp where pp ->> 'play' = us::text or pp::text ~ 'pwback') and x::text !~ us::text and x::text !~ 'pwback', 'the sampled post shows its unsprung set: ' || x::text);
  -- the rewound body
  x := (select e from jsonb_array_elements(r) e where e ->> 'act' = p_rw::text);
  perform pg_temp.expect(x ->> 'body' = 'Second words.' and x -> 'rewoundTo' <> 'null'::jsonb, 'the rewound post: ' || x::text);
  -- the origin of the spun opener, as pool_read gives it, and null for the rest
  opener := (select first_act from thread_list where id = sth);
  x := (select e from jsonb_array_elements(r) e where e ->> 'act' = opener::text);
  perform pg_temp.expect(x is not null and x ->> 'body' = 'Discuss the poll.', 'the opener is in the sample: ' || coalesce(x::text, 'none'));
  o := x -> 'origin';
  perform pg_temp.expect(o ->> 'kind' = 'post' and o -> 'moment' = 'false'::jsonb, 'the origin is a post: ' || coalesce(o::text, 'null'));
  perform pg_temp.expect(o = (pool_read(sth, 'pws-none', null, 5) -> 'origin'), 'the origin is pool_read''s: ' || o::text || ' vs ' || coalesce((pool_read(sth, 'pws-none', null, 5) -> 'origin')::text, 'null'));
  perform pg_temp.expect(o -> 'post' ->> 'act' = p_poll::text and o -> 'post' -> 'poll' ->> 'voters' = '2', 'the origin post carries its poll: ' || o::text);
  perform pg_temp.expect((select count(*) from jsonb_array_elements(r) e where e -> 'origin' <> 'null'::jsonb) = 2, 'only the two openers have an origin');
  -- the moment's origin: the play's kind, the plays as they stood, no rewind, the origin post's own words, and pool_read's
  mopener := (select first_act from thread_list where id = mth);
  x := (select e from jsonb_array_elements(r) e where e ->> 'act' = mopener::text);
  o := x -> 'origin';
  perform pg_temp.expect(x ->> 'body' = 'Discuss the splat.' and o ->> 'kind' = 'card' and o -> 'moment' = 'true'::jsonb and o -> 'post' ->> 'act' = p_play::text, 'the moment origin: ' || coalesce(o::text, 'null'));
  perform pg_temp.expect(o -> 'post' ->> 'body' = 'Played on.' and o -> 'post' -> 'rewoundTo' = 'null'::jsonb and jsonb_array_length(o -> 'post' -> 'plays') = 1 and o -> 'post' -> 'plays' -> 0 ->> 'play' = w::text, 'the moment origin post: ' || o::text);
  perform pg_temp.expect(o = (pool_read(mth, 'pws-none', null, 5) -> 'origin'), 'the moment origin is pool_read''s: ' || o::text);
  perform pg_temp.expect(o::text !~ 'pwback' and o::text !~ us::text, 'the moment origin names the unsprung set');
  -- a post under a visit is never sampled; a hidden (veiled) post is 0304-post-veils.sql's probe of patrol_sample, which this change leaves as it was
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(r) e where e ->> 'act' = p_eve::text), 'a post under a visit is in the sample');
  -- the door and the owner
  perform pg_temp.expect((select pg_get_userbyid(proowner) from pg_proc where proname = 'patrol_sample') = 'kayfabb_digest', 'the owner');
  perform pg_temp.expect(has_function_privilege('service_role', 'patrol_sample(uuid[], integer, integer, bigint)', 'execute') and not has_function_privilege('anon', 'patrol_sample(uuid[], integer, integer, bigint)', 'execute')
    and not has_function_privilege('authenticated', 'patrol_sample(uuid[], integer, integer, bigint)', 'execute'), 'the door');
  -- the draw: a smaller sample is the newest-weighted same posts as before (this seed, the same call twice)
  perform pg_temp.expect(patrol_sample(array[board], 3, 50, 7) = patrol_sample(array[board], 3, 50, 7) and jsonb_array_length(patrol_sample(array[board], 3, 50, 7)) = 3, 'the same seed draws the same sample');
  -- patrol_sample is patrol_draw plus the extras: the same acts, in the same order, for the same arguments (0310 measures the draw's weights through patrol_draw alone, so this holds the two together)
  for n in 1..5 loop
    perform pg_temp.expect((select coalesce(jsonb_agg(e -> 'act' order by ord), '[]'::jsonb) from jsonb_array_elements(patrol_sample(array[board], 3, 50, n)) with ordinality t(e, ord))
      = (select coalesce(jsonb_agg(e -> 'act' order by ord), '[]'::jsonb) from jsonb_array_elements(patrol_draw(array[board], 3, 50, n)) with ordinality t(e, ord)), 'patrol_sample drew other acts than patrol_draw for seed ' || n);
  end loop;
  perform pg_temp.expect(jsonb_array_length(patrol_draw(array[board], 3, 50, 7)) = 3, 'the draw is a sample of three');
  -- red: a copy of patrol_sample whose draw reads the seed plus one fails the same comparison for some seed (the copy lives in pg_temp, and the comparison is the one above)
  execute replace(replace(pg_get_functiondef('patrol_sample(uuid[], integer, integer, bigint)'::regprocedure), 'public.patrol_sample', 'pg_temp.patrol_sample_mut'), 'patrol_draw(boards, most, pool, seed)', 'patrol_draw(boards, most, pool, seed + 1)');
  perform pg_temp.expect(exists (
    select 1 from generate_series(1, 5) g(n)
    where (select coalesce(jsonb_agg(e -> 'act' order by ord), '[]'::jsonb) from jsonb_array_elements(pg_temp.patrol_sample_mut(array[board], 3, 50, g.n)) with ordinality t(e, ord))
      is distinct from (select coalesce(jsonb_agg(e -> 'act' order by ord), '[]'::jsonb) from jsonb_array_elements(patrol_draw(array[board], 3, 50, g.n)) with ordinality t(e, ord))), 'the equality cannot tell a different draw apart');
end $$;
