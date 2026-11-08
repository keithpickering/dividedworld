-- A reply passes each card back once (supabase/migrations/0078_reply_passes.sql): the first post in a thread by another character
-- spends every waiting back's reply moment, whatever the card, and springs at most the newest reply trap among them. The cost-at-scale
-- plan, Task 4; the cost-at-scale design, sections 4 and 5. The cards are the engine's test set, never an instance's.

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap) values
    ('hook', 'Hook', 'salty', 'uncommon', 'set', '{"trigger": {"on": "reply"}, "outcome": {"do": "strike", "card": "blot"}}'),
    ('quoter', 'Quoter', 'salty', 'uncommon', 'set', '{"trigger": {"on": "quote"}, "outcome": {"do": "strike", "card": "sweetie"}}'),
    ('bluffy', 'Bluffy', 'pepperoni', 'common', 'set', null)
  on conflict (key) do nothing;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- What this transaction has read and written so far in the given tables, one number after another: scans begun, tuples returned,
-- fetched, inserted, updated and deleted. (A row lock is a scan that returns the row, so the counters see what a lock reads.)
create function pg_temp.touched(tables text[]) returns bigint[] language sql as $$
  select array_agg(n order by r, i) from (
    select r, i, case i when 1 then pg_stat_get_xact_numscans(r::regclass) when 2 then pg_stat_get_xact_tuples_returned(r::regclass)
                        when 3 then pg_stat_get_xact_tuples_fetched(r::regclass) when 4 then pg_stat_get_xact_tuples_inserted(r::regclass)
                        when 5 then pg_stat_get_xact_tuples_updated(r::regclass) else pg_stat_get_xact_tuples_deleted(r::regclass) end as n
    from unnest(tables) r, generate_series(1, 6) i) s
$$;

create function pg_temp.minus(after bigint[], before bigint[]) returns bigint[] language sql as $$
  select array_agg(a - b order by i) from unnest(after, before) with ordinality u(a, b, i)
$$;

-- ---- Races, first, so the rows they commit wait on nothing this file has written and not committed ----

-- Two posts by different characters race over one waiting reply trap, twenty rounds: both land, exactly one spring a round (the trap
-- springs once), and the back is passed, none left waiting. Both lock the back in step 3, in the same order, so the second waits and
-- then finds it passed (it is read as locked) and the spring sprung.
do $$
declare
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); st uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); cs uuid := gen_random_uuid();
  t uuid; x uuid; said text[]; round integer;
begin
  perform tests.commit($sql$
    insert into card_kinds (key, name, alignment, rarity, play, trap) values
      ('rvhook', 'RV Hook', 'salty', 'uncommon', 'set', '{"trigger": {"on": "reply"}, "outcome": {"do": "strike", "card": "blot"}}'),
      ('rvcatch', 'RV Catch', 'salty', 'rare', 'set', '{"trigger": {"on": "cast"}, "outcome": {"do": "nullify"}}');
  $sql$);
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'rv1@test.invalid'), (%2$L, 'rv2@test.invalid'), (%3$L, 'rv3@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L), (%3$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'RV One', now(), now()), (%5$L, %2$L, 'RV Two', now(), now()), (%6$L, %3$L, 'RV Setter', now(), now());
    insert into class_history (character, class_key, started_at) values (%4$L, 'alpha', now()), (%5$L, 'alpha', now()), (%6$L, 'alpha', now());
    insert into card_ledger (account, card, kind, price) select %3$L, 'rvhook', 'bought', 0 from generate_series(1, 20);
  $sql$, p1, p2, st, c1, c2, cs));
  for round in 1 .. 20 loop
    t := gen_random_uuid(); x := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into threads (id, board, title) select %1$L, b.id, 'RV race' from boards b where b.slug = 'general';
      insert into acts (id, character, kind, thread, payload) values (%2$L, %3$L, 'post', %1$L, '{"body": "Hooked."}');
      do $d$ begin perform set_card(%4$L, 'rvhook', %3$L, %2$L, '{}', 0); end $d$;
    $sql$, t, x, cs, st));
    said := tests.race_as(p1, format('select post(%L, %L, %L)', t, c1, 'one'), p2, format('select post(%L, %L, %L)', t, c2, 'two'));
    if said[1] is not null or said[2] is not null then raise exception 'two posts over one waiting trap, round %: %', round, said; end if;
    if (select count(*) from acts where kind = 'spring' and thread = t) is distinct from 1::bigint then
      raise exception 'round %: % springs on one trap', round, (select count(*) from acts where kind = 'spring' and thread = t);
    end if;
    if (select count(*) from face_down_reply where thread = t and passed_by is null) is distinct from 0::bigint then
      raise exception 'round %: a back was left waiting', round;
    end if;
  end loop;
end $$;

-- A sprung back that still waits is stamped without waiting. Another session holds its reply row, as a post that locked it in step 3
-- would, and will want the thread row; a reply here takes the thread row first and must not queue behind the reply row (the two would
-- cross: 40P01). The reply lands, the held row is skipped and stays waiting, and once released the next post passes it.
do $$
declare
  setter uuid := gen_random_uuid(); caster uuid := gen_random_uuid(); replier uuid := gen_random_uuid();
  s uuid := gen_random_uuid(); c uuid := gen_random_uuid(); r uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); sprung_post uuid := gen_random_uuid();
  why text; setplay uuid; landed uuid;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'rp-setter@test.invalid'), (%2$L, 'rp-caster@test.invalid'), (%3$L, 'rp-replier@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L), (%3$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'RP Setter', now(), now()), (%5$L, %2$L, 'RP Caster', now(), now()), (%6$L, %3$L, 'RP Replier', now(), now());
    insert into class_history (character, class_key, started_at) values (%4$L, 'alpha', now()), (%5$L, 'alpha', now()), (%6$L, 'alpha', now());
    insert into threads (id, board, title) select %7$L, b.id, 'Parked' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%8$L, %4$L, 'post', %7$L, '{"body": "Sprung."}');
    insert into card_ledger (account, card, kind, price) values (%1$L, 'rvcatch', 'bought', 0), (%2$L, 'sweetie', 'bought', 0);
    do $d$ begin
      perform set_card(%1$L, 'rvcatch', %4$L, %8$L, '{}', 0);
      perform play_card(%2$L, 'sweetie', %5$L, %8$L, '{}', 0, '');
    end $d$;
  $sql$, setter, caster, replier, s, c, r, t, sprung_post));
  if not exists (select 1 from acts where kind = 'spring' and target_act_id = sprung_post) then raise exception 'the parked setup did not spring'; end if;
  select play into setplay from face_down where post = sprung_post;
  if (select passed_by from face_down_reply where play = setplay) is not null then raise exception 'the sprung back was passed by its own cast'; end if;
  perform extensions.dblink_connect('rp_holder', current_setting('kayfabb.scratch_url'));
  begin
    perform extensions.dblink_exec('rp_holder', 'begin');
    perform extensions.dblink_exec('rp_holder', format('do $h$ begin perform 1 from face_down_reply where play = %L for update; end $h$', setplay));
    -- After the reply below has taken the thread row, the holder wants it.
    perform extensions.dblink_send_query('rp_holder', format('do $h$ begin perform pg_sleep(0.6); perform 1 from threads where id = %L for no key update; end $h$', t));
    perform set_config('lock_timeout', '5s', true);
    perform set_config('deadlock_timeout', '100ms', true);
    perform tests.become(replier);
    begin
      landed := (post(t, r, 'Replying past a held parked back.') ->> 'id')::uuid;
      why := null;
    exception when others then
      why := sqlstate || ' ' || sqlerrm;
    end;
    perform tests.unbecome();
    perform set_config('lock_timeout', '0', true);
    -- The holder is still waiting for the thread row this reply holds. Had the reply queued behind the reply row, Postgres would have
    -- refused one of the two (40P01); the reply survives that and lands late, so the holder having ended is the sign of the cycle.
    if extensions.dblink_is_busy('rp_holder') = 0 then
      why := coalesce(why, 'the reply and the holder crossed: the holder was refused');
    end if;
    -- Cancelling the holder's wait for the thread row aborts its transaction, which releases the reply row.
    perform extensions.dblink_cancel_query('rp_holder');
    perform pg_sleep(0.3);
  exception when others then
    perform extensions.dblink_disconnect('rp_holder');
    raise;
  end;
  perform extensions.dblink_disconnect('rp_holder');
  if why is not null then raise exception 'a reply waited on a sprung back''s reply row: %', why; end if;
  if (select passed_by from face_down_reply where play = setplay) is not null then raise exception 'a row another session held was stamped'; end if;
  -- Released, the next post by another character passes it.
  perform tests.become(replier);
  landed := (post(t, r, 'And again.') ->> 'id')::uuid;
  perform tests.unbecome();
  if (select passed_by from face_down_reply where play = setplay) is distinct from landed then
    raise exception 'the next post did not pass the sprung back that was left waiting';
  end if;
end $$;

-- ---- Two reply traps: the newest springs, both are passed, and the next post springs nothing ----
do $$
declare
  ann uuid := tests.account('pass-ann');
  bob uuid := tests.account('pass-bob');
  a uuid := tests.character(ann, 'Passed Setter');
  b uuid := tests.character(bob, 'Passer');
  t uuid := tests.thread('Two traps');
  posts uuid[] := '{}';
  nine jsonb;
  ten jsonb;
  hook_5 uuid; hook_8 uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'hook', 'hook');
  for i in 1..8 loop posts := posts || tests.post(case when i in (5, 8) then a else b end, t, 'Post ' || i); end loop;
  perform tests.become_service();
  hook_5 := (set_card(ann, 'hook', a, posts[5], '{}', 0) ->> 'id')::uuid;
  hook_8 := (set_card(ann, 'hook', a, posts[8], '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(bob);
  nine := post(t, b, 'Post 9', null);
  if (nine -> 'sprung' ->> 'target_act_id')::uuid is distinct from posts[8] then
    raise exception 'the newest reply trap springs on the first post after it: %', nine -> 'sprung';
  end if;
  ten := post(t, b, 'Post 10', null);
  if ten ? 'sprung' then raise exception 'a reply trap an earlier post passed sprang on a later one: %', ten -> 'sprung'; end if;
  perform tests.unbecome();
  if (select count(*) from acts where kind = 'spring' and target_act_id = posts[5]) is distinct from 0::bigint then raise exception 'the older trap sprang'; end if;
  if (select count(*) from face_down_reply where passed_by = (nine ->> 'id')::uuid and play in (hook_5, hook_8)) is distinct from 2::bigint then
    raise exception 'post 9 passed both backs: %', (select jsonb_agg(to_jsonb(r)) from face_down_reply r where play in (hook_5, hook_8));
  end if;
  if (select count(*) from face_down_reply where passed_by is null and play in (hook_5, hook_8)) is distinct from 0::bigint then raise exception 'a back was left waiting'; end if;
end $$;

-- ---- A Bluff, a quote trap and a reply trap are each passed by the first post by another character, alike ----
do $$
declare
  ann uuid := tests.account('alike-ann');
  bob uuid := tests.account('alike-bob');
  a uuid := tests.character(ann, 'Alike Setter');
  b uuid := tests.character(bob, 'Alike Passer');
  cards text[] := array['bluffy', 'quoter', 'hook'];
  k text;
  t uuid; p uuid; set_act uuid; answer jsonb;
  before bigint[]; narrow_before bigint[]; seen bigint[]; narrow_seen bigint[]; first_seen bigint[]; first_narrow bigint[];
  -- Every table a post touches, for the two backs that do not spring; the backs' own two for the reply trap, which does.
  wide text[] := array['face_down', 'face_down_reply', 'character_post_counts', 'acts', 'card_kinds'];
  narrow text[] := array['face_down', 'face_down_reply'];
begin
  -- At a busy instance's size the planner reads by index; the committed races above leave a table so small and so recently written
  -- that it may choose a scan of every Act instead, which would read a different number of rows each time.
  perform set_config('enable_seqscan', 'off', true);
  perform set_config('enable_bitmapscan', 'off', true);
  -- Those settings reach only a plan made from here on. post() runs in this session many times by now (the races above), and plpgsql
  -- keeps the plan of each statement: after five runs it may keep one generic plan, made when the table was a few rows with no
  -- statistics, which reads both Acts a join names by a scan of the whole table (a hash join over 10 guessed rows) where a busy
  -- instance's statistics make it an index probe. Whether a session keeps such a plan depends on its costs, which move with when
  -- autovacuum last analyzed the table, hence the one failure in five. Dropping the kept plans makes the next post plan afresh, here.
  execute 'discard plans';
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'bluffy', 'quoter', 'hook');
  -- The passer's count row exists before the first measurement, or the first post alone would insert it.
  perform tests.post(b, tests.thread('Alike warm-up'), 'Warm-up.');
  foreach k in array cards loop
    t := tests.thread('Alike ' || k);
    p := tests.post(a, t, 'Backed by ' || k);
    perform tests.become_service();
    set_act := (set_card(ann, k, a, p, '{}', 0) ->> 'id')::uuid;
    perform tests.unbecome();
    perform tests.become(bob);
    before := pg_temp.touched(wide);
    narrow_before := pg_temp.touched(narrow);
    answer := post(t, b, 'The first post by another.', null);
    seen := pg_temp.minus(pg_temp.touched(wide), before);
    narrow_seen := pg_temp.minus(pg_temp.touched(narrow), narrow_before);
    perform tests.unbecome();
    if (select passed_by from face_down_reply where play = set_act) is distinct from (answer ->> 'id')::uuid then raise exception '% was not passed by the first post by another character', k; end if;
    if (select passed_at from face_down_reply where play = set_act) is null then raise exception '% was passed without a time', k; end if;
    if k = 'hook' then
      if not answer ? 'sprung' then raise exception 'the reply trap did not spring on the pass'; end if;
    elsif answer ? 'sprung' then raise exception '% sprang on a pass', k;
    end if;
    -- The same rows read, written and locked for every card, the spring itself aside. A Bluff and a quote trap spring nothing on this
    -- post, so everything it touched (the backs, the count rows, the Acts and the card kinds) must match. The reply trap springs, and
    -- the spring is public, so only the backs' own tables are compared for it.
    if k <> 'hook' then
      if first_seen is null then first_seen := seen; end if;
      if seen is distinct from first_seen then raise exception 'a post read or wrote other rows for %: % against %', k, seen, first_seen; end if;
    end if;
    if first_narrow is null then first_narrow := narrow_seen; end if;
    if narrow_seen is distinct from first_narrow then raise exception 'a post read or wrote other backs for %: % against %', k, narrow_seen, first_narrow; end if;
  end loop;
end $$;

-- ---- A post by the back's own author passes nothing; a quote trap that was passed still springs on a quote ----
do $$
declare
  ann uuid := tests.account('own-ann');
  bob uuid := tests.account('own-bob');
  a uuid := tests.character(ann, 'Own Setter');
  a2 uuid := tests.character(ann, 'Own Other Mask');
  b uuid := tests.character(bob, 'Own Passer');
  t uuid := tests.thread('Own post');
  p uuid := tests.post(a, t, 'Quote me later.');
  q uuid := tests.post(a, t, 'And me.');
  quoter_set uuid; bluff_set uuid; answer jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'quoter', 'bluffy');
  perform tests.become_service();
  quoter_set := (set_card(ann, 'quoter', a, p, '{}', 0) ->> 'id')::uuid;
  bluff_set := (set_card(ann, 'bluffy', a, q, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(ann);
  perform post(t, a, 'The author again.', null);
  perform tests.unbecome();
  if (select count(*) from face_down_reply where passed_by is not null and play in (quoter_set, bluff_set)) is distinct from 0::bigint then
    raise exception 'a post by the back''s own author passed a back';
  end if;
  -- Another of the same player's masks is another character: it passes.
  perform tests.become(ann);
  perform post(t, a2, 'The same player, another mask.', null);
  perform tests.unbecome();
  if (select count(*) from face_down_reply where passed_by is not null and play in (quoter_set, bluff_set)) is distinct from 2::bigint then
    raise exception 'another mask of the setter passed nothing';
  end if;
  -- A passed quote trap still springs on a quote.
  perform tests.become(bob);
  answer := post(t, b, 'As you said.', p);
  perform tests.unbecome();
  if answer -> 'sprung' -> 'payload' ->> 'trigger' is distinct from 'quote' then raise exception 'a passed quote trap did not spring on a quote: %', answer; end if;
end $$;

-- ---- A thread with 200 live backs passed long ago: a post reads only what still waits ----
do $$
declare
  ann uuid := tests.account('scale-ann');
  bob uuid := tests.account('scale-bob');
  a uuid := tests.character(ann, 'Scale Setter');
  b uuid := tests.character(bob, 'Scale Passer');
  t uuid := tests.thread('Two hundred backs');
  opener uuid := tests.post(b, t, 'Opener.');
  passing uuid := tests.post(b, t, 'Passed them all.');
  posted uuid; set_act uuid;
  before bigint[]; seen bigint[]; reads bigint;
begin
  perform set_config('enable_seqscan', 'off', true);
  perform set_config('enable_bitmapscan', 'off', true);
  execute 'discard plans';  -- as the alike block: a plan cached earlier in the session ignores the settings above
  perform pg_temp.cards();
  for i in 1..200 loop
    posted := tests.post(a, t, 'Post ' || i);
    set_act := tests.act(a, 'set', t, '{}', posted);
    insert into face_down (play, account, card, post, thread, round, ends_at) values (set_act, ann, 'bluffy', posted, t, 1, now() + interval '5 days');
    insert into face_down_reply (play, thread, passed_by, passed_at) values (set_act, t, passing, now() - interval '1 day');
  end loop;
  perform tests.become(bob);
  before := pg_temp.touched(array['face_down', 'face_down_reply']);
  perform post(t, b, 'A new post.', null);
  seen := pg_temp.minus(pg_temp.touched(array['face_down', 'face_down_reply']), before);
  perform tests.unbecome();
  -- face_down returned and fetched (numbers 2 and 3 of its six), then face_down_reply's (8 and 9).
  reads := seen[2] + seen[3] + seen[8] + seen[9];
  if reads > 20 then raise exception 'a post in a thread of 200 passed backs read % rows of the backs; it reads only what waits: %', reads, seen; end if;
end $$;

-- ---- A back sprung by a cast still waits for its reply, and the next post by another character passes it ----
do $$
declare
  ann uuid := tests.account('parked-ann');
  bob uuid := tests.account('parked-bob');
  a uuid := tests.character(ann, 'Parked Setter');
  b uuid := tests.character(bob, 'Parked Passer');
  t uuid := tests.thread('Parked and passed');
  p uuid := tests.post(a, t, 'Caught a cast.');
  set_act uuid; answer jsonb;
begin
  perform pg_temp.hand(ann, 'rvcatch');
  perform pg_temp.hand(bob, 'sweetie');
  perform tests.become_service();
  set_act := (set_card(ann, 'rvcatch', a, p, '{}', 0) ->> 'id')::uuid;
  perform play_card(bob, 'sweetie', b, p, '{}', 0, '');
  perform tests.unbecome();
  if not exists (select 1 from acts where kind = 'spring' and target_act_id = p) then raise exception 'the cast did not spring the trap'; end if;
  if (select passed_by from face_down_reply where play = set_act) is not null then raise exception 'a cast passed the back'; end if;
  perform tests.become(bob);
  answer := post(t, b, 'The first post by another character.', null);
  perform tests.unbecome();
  if (select passed_by from face_down_reply where play = set_act) is distinct from (answer ->> 'id')::uuid then
    raise exception 'a sprung back left waiting was not passed by the next post by another character';
  end if;
end $$;

-- ---- The backfill: a back set before the migration is passed by the first later post by another character, else waits ----
do $$
declare
  ann uuid := tests.account('fill-ann');
  bob uuid := tests.account('fill-bob');
  a uuid := tests.character(ann, 'Fill Setter');
  b uuid := tests.character(bob, 'Fill Passer');
  t_other uuid := tests.thread('Fill passed by another');
  t_own uuid := tests.thread('Fill own post only');
  t_none uuid := tests.thread('Fill nothing after');
  p_other uuid; p_own uuid; p_none uuid;
  set_other uuid; set_own uuid; set_none uuid;
  by_other uuid; at_other timestamptz;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'bluffy', 'bluffy', 'bluffy');
  p_other := tests.post(a, t_other, 'Backed, then answered.');
  p_own := tests.post(a, t_own, 'Backed, then the author again.');
  p_none := tests.post(a, t_none, 'Backed, then silence.');
  perform tests.become_service();
  set_other := (set_card(ann, 'bluffy', a, p_other, '{}', 0) ->> 'id')::uuid;
  set_own := (set_card(ann, 'bluffy', a, p_own, '{}', 0) ->> 'id')::uuid;
  set_none := (set_card(ann, 'bluffy', a, p_none, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  -- A later post by the back's own author does not count; one by another character does. (Later by the clock, since a transaction's
  -- now() is one instant.)
  perform tests.post(a, t_own, 'The author again.', now() + interval '1 hour');
  by_other := tests.post(b, t_other, 'Another character.', now() + interval '2 hours');
  select created_at into at_other from acts where id = by_other;
  -- Back to before the migration: no reply rows. (The once-only trigger is off for this transaction's own cleanup, which rolls back.)
  alter table face_down_reply disable trigger face_down_reply_once;
  delete from face_down_reply where play in (set_other, set_own, set_none);
  alter table face_down_reply enable trigger face_down_reply_once;
  perform face_down_reply_backfill();
  if (select count(*) from face_down_reply where play in (set_other, set_own, set_none)) is distinct from 3::bigint then raise exception 'the backfill wrote no row for a back'; end if;
  if (select passed_by from face_down_reply where play = set_other) is distinct from by_other or (select passed_at from face_down_reply where play = set_other) is distinct from at_other then
    raise exception 'a back with a later post by another character was not passed by it';
  end if;
  if (select passed_by from face_down_reply where play = set_own) is not null then raise exception 'a later post by the back''s own author passed it'; end if;
  if (select passed_by from face_down_reply where play = set_none) is not null then raise exception 'a back with no later post was passed'; end if;
end $$;
