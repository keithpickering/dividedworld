-- The queue, the texts and the refund of a card that writes (supabase/migrations/0146_card_writes.sql;
-- the plan for the card that writes, Task 4; its design sections 3, 4, 6, 12, 14 and 15).
--
-- A card whose kind `writes` has a text made for it by the server after it lands, once per version of the post. These files hold the
-- SQL half: a play queues a job (a trigger on acts), an edit queues one for each live writing play on the post, the worker claims jobs
-- in batches (a later play waits behind an earlier one on the same post) and finishes each with a text or a failure, a failure on a
-- paid play pays its wallet event back and returns the card, and a reader gets the tails of a page of posts. A race file beside this one
-- (0146-race-card-writes.sql) holds the concurrent cases.
--
-- Acts are written with explicit times where their order matters (plays on one post are ordered by (created_at, id), and a test's
-- transaction has one now()).

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The Edge Function's calls, as the service role makes them.
create function pg_temp.claim(most integer, only_post uuid default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.become_service();
  if only_post is null then r := claim_card_writes(most); else r := claim_card_writes(most, only_post); end if;
  perform tests.unbecome();
  return r;
end $$;
create function pg_temp.finish(p uuid, v uuid, t text, f text, c bigint default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.become_service();
  r := finish_card_write(p, v, t, f, c);
  perform tests.unbecome();
  return r;
end $$;
-- The jobs of one post's claim among a batch's answer.
create function pg_temp.of_post(got jsonb, p uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(got) e where e ->> 'post' = p::text
$$;
create function pg_temp.plan(q text) returns text language plpgsql as $$
declare l text; out text := '';
begin
  for l in execute 'explain ' || q loop out := out || l || E'\n'; end loop;
  return out;
end $$;

-- The vocabulary: a card that writes (three to a post) and one that does not, both uncommon so the pool's cap lets a Mod Bot play them.
do $$
begin
  insert into settings (key, value) values ('oldVoice', 'true') on conflict (key) do update set value = excluded.value;
  -- The settle wait is off for the cases below that edit and claim at once; its own block turns it on.
  insert into settings (key, value) values ('cardWriteSettleSeconds', '0') on conflict (key) do update set value = excluded.value;
  insert into settings (key, value) values ('pool', '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "uncommon", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 3, "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2}, "chatterCron": "37 17 * * *"}')
    on conflict (key) do update set value = excluded.value;
  insert into card_kinds (key, name, alignment, rarity, play, stack, writes) values ('cw-scribe', 'Scribe', 'salty', 'uncommon', 'cast', 3, true);
  insert into card_kinds (key, name, alignment, rarity, play) values ('cw-plain', 'Plain', 'sweet', 'uncommon', 'cast');
end $$;

-- ---------------------------------------------------------------------------------------- the queue, the chain, the claim ----
do $$
declare
  ann uuid := tests.account('cw-ann'); bob uuid := tests.account('cw-bob'); cat uuid := tests.account('cw-cat');
  a uuid := tests.character(ann, 'Cw Caster'); b uuid := tests.character(bob, 'Cw Author'); c uuid := tests.character(cat, 'Cw Reader');
  t uuid := tests.thread('Tail thread');
  base timestamptz := '2030-01-01T00:00:00Z';
  p0 uuid; p uuid; p2 uuid; p3 uuid;
  play1 uuid; play2 uuid; play3 uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid;
  got jsonb; seen jsonb; seen_b jsonb; seen_c jsonb; jobs jsonb;
begin
  p0 := tests.post(c, t, 'An earlier post, before the one that carries the card.', base - interval '1 minute');
  p := tests.post(b, t, 'The first words of a post', base);
  p2 := tests.post(b, t, 'A post that carries nothing', base + interval '1 minute');

  -- A play of a writing card queues one job, at the post's own version.
  play1 := tests.act(a, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p, base + interval '2 minutes');
  if (select count(*) from card_writes where post = p) is distinct from 1 or (select w.version from card_writes w where w.play = play1) is distinct from p then
    raise exception 'a play of a writing card queues one job at the post''s version: %', (select jsonb_agg(to_jsonb(w)) from card_writes w where w.post = p);
  end if;
  -- A play of a card that does not write queues nothing.
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'cw-plain', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p, base + interval '3 minutes');
  if (select count(*) from card_writes where post = p) is distinct from 1 then raise exception 'a play of a card that does not write queued a job'; end if;

  -- An edit makes the job again at the newer version; a second edit before the worker ran leaves one job, at the newest.
  e1 := tests.act(b, 'edit', t, jsonb_build_object('body', 'The first words, mended'), p, base + interval '4 minutes');
  if (select count(*) from card_writes where post = p) is distinct from 1 or (select w.version from card_writes w where w.play = play1) is distinct from e1 then
    raise exception 'an edit queues its play again at the edit';
  end if;
  e2 := tests.act(b, 'edit', t, jsonb_build_object('body', 'The first words, mended again'), p, base + interval '5 minutes');
  if (select count(*) from card_writes where post = p) is distinct from 1 or (select w.version from card_writes w where w.play = play1) is distinct from e2 then
    raise exception 'a second edit before the worker runs leaves one job at the newer version: %', (select jsonb_agg(to_jsonb(w)) from card_writes w where w.post = p);
  end if;

  -- An edit on a post with no writing play queues nothing, and its probe is an index's: the post's layers, never a scan of the Acts.
  perform tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended, and still nothing on it'), p2, base + interval '5 minutes');
  if (select count(*) from card_writes where post = p2) is distinct from 0 then raise exception 'an edit on a post with no writing play queued a job'; end if;
  set local enable_seqscan = off;
  if pg_temp.plan(format('select * from live_writing_plays(%L)', p2)) like '%Seq Scan on acts%' or pg_temp.plan(format('select * from live_writing_plays(%L)', p2)) not like '%acts_%' then
    raise exception 'the edit probe is not an index on acts: %', pg_temp.plan(format('select * from live_writing_plays(%L)', p2));
  end if;
  reset enable_seqscan;

  -- A second play on the post queues its job, at the post's current version.
  play2 := tests.act(a, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 2), p, base + interval '6 minutes');
  if (select count(*) from card_writes where post = p) is distinct from 2 or (select w.version from card_writes w where w.play = play2) is distinct from e2 then
    raise exception 'the second play queues its job at the current version: %', (select jsonb_agg(to_jsonb(w)) from card_writes w where w.post = p);
  end if;

  -- The chain: the claim holds the second play's job back while the first's waits.
  got := pg_temp.claim(10);
  jobs := pg_temp.of_post(got, p);
  if jsonb_array_length(jobs) is distinct from 1 or jobs -> 0 ->> 'play' is distinct from play1::text then
    raise exception 'the claim holds back the second play''s job while the first''s waits: %', jobs;
  end if;
  if jobs -> 0 ->> 'version' is distinct from e2::text or (jobs -> 0 ->> 'attempts')::integer is distinct from 1 or jobs -> 0 ->> 'card' is distinct from 'cw-scribe'
     or jobs -> 0 ->> 'author' is distinct from 'Cw Author' or jobs -> 0 ->> 'body' is distinct from 'The first words, mended again' or jobs -> 0 ->> 'title' is distinct from 'Tail thread'
     or jobs -> 0 -> 'earlier' is distinct from '[]'::jsonb or (jobs -> 0 ->> 'post') is distinct from p::text or (jobs -> 0 ->> 'thread') is distinct from t::text then
    raise exception 'the claim carries the frame''s inputs and the attempt: %', jobs;
  end if;
  if jobs -> 0 -> 'before' is distinct from jsonb_build_array(jsonb_build_object('name', 'Cw Reader', 'body', 'An earlier post, before the one that carries the card.')) then
    raise exception 'the claim carries the public posts before this one: %', jobs -> 0 -> 'before';
  end if;
  -- A claim lasts five minutes: a model call may take four, and the worker runs no more jobs at once than it claims.
  if (select w.claimed_until from card_writes w where w.play = play1) < clock_timestamp() + interval '290 seconds' then raise exception 'a claim holds a job for less than five minutes'; end if;
  -- A claimed job is not claimed again until its claim runs out.
  if jsonb_array_length(pg_temp.of_post(pg_temp.claim(10), p)) is distinct from 0 then raise exception 'a claimed job was claimed again before its claim ran out'; end if;

  -- A claim for one post takes only that post's jobs, and touches no other's.
  p3 := tests.post(b, t, 'Another post, with a play of its own', base + interval '7 minutes');
  play3 := tests.act(a, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p3, base + interval '8 minutes');
  jobs := pg_temp.claim(10, p3);
  if jsonb_array_length(jobs) is distinct from 1 or jobs -> 0 ->> 'play' is distinct from play3::text then raise exception 'a claim for one post takes that post''s job alone: %', jobs; end if;
  if (select w.attempts from card_writes w where w.play = play1) is distinct from 1 then raise exception 'a claim for another post counted an attempt on this one'; end if;
  if jsonb_array_length(pg_temp.claim(10, p3)) is distinct from 0 then raise exception 'a claimed job was claimed again by a claim for its post'; end if;

  -- A claim that ran out is taken again, and counted.
  update card_writes set claimed_until = clock_timestamp() - interval '1 second' where play = play1;
  jobs := pg_temp.of_post(pg_temp.claim(10, p), p);
  if jsonb_array_length(jobs) is distinct from 1 or (jobs -> 0 ->> 'attempts')::integer is distinct from 2 then raise exception 'a job whose claim ran out is claimed again with its attempts counted: %', jobs; end if;

  -- A finish writes the row, clears its job and tells the thread, in words that name only the play and the version.
  seen := pg_temp.finish(play1, e2, 'A tail for the first.', null);
  if (select count(*) from card_texts x where x.play = play1 and x.version = e2 and x.text = 'A tail for the first.' and x.failed is null) is distinct from 1 then raise exception 'a finish writes its row'; end if;
  if exists (select 1 from card_writes w where w.play = play1) then raise exception 'a finish for the queued version clears its job'; end if;
  if (select count(*) from broadcasts_due d where d.topic = 'thread:' || t and d.event = 'card_text' and d.payload = jsonb_build_object('play', play1, 'version', e2)) is distinct from 1 then
    raise exception 'a finish tells the thread of the play and the version and nothing else: %', (select jsonb_agg(to_jsonb(d)) from broadcasts_due d where d.event = 'card_text');
  end if;
  -- A finish of the same version again (a retry, a sweep and a kick landing together) writes nothing more and says nothing more.
  perform pg_temp.finish(play1, e2, 'A second tail for the same version.', null);
  if (select count(*) from card_texts x where x.play = play1 and x.version = e2) is distinct from 1 or (select x.text from card_texts x where x.play = play1 and x.version = e2) is distinct from 'A tail for the first.' then
    raise exception 'a second finish of one version changed the text';
  end if;
  if (select count(*) from broadcasts_due d where d.event = 'card_text' and d.payload = jsonb_build_object('play', play1, 'version', e2)) is distinct from 1 then raise exception 'a second finish told the thread again'; end if;

  -- The second play's job is now free, and carries the first's text for the same version.
  jobs := pg_temp.of_post(pg_temp.claim(10), p);
  if jsonb_array_length(jobs) is distinct from 1 or jobs -> 0 ->> 'play' is distinct from play2::text
     or jobs -> 0 -> 'earlier' is distinct from jsonb_build_array(jsonb_build_object('play', play1, 'text', 'A tail for the first.')) then
    raise exception 'the second play''s job follows the first''s finish and carries its text: %', jobs;
  end if;

  -- An edit while the second is claimed replaces its job; the late finish writes its row for the version it made and leaves the newer job.
  e3 := tests.act(b, 'edit', t, jsonb_build_object('body', 'The first words, mended a third time'), p, base + interval '9 minutes');
  if (select count(*) from card_writes where post = p) is distinct from 2 then raise exception 'the edit queues both plays again: %', (select jsonb_agg(to_jsonb(w)) from card_writes w where w.post = p); end if;
  perform pg_temp.finish(play2, e2, 'A tail that came late.', null);
  if (select count(*) from card_texts x where x.play = play2 and x.version = e2) is distinct from 1 then raise exception 'a finish for a replaced version writes its row'; end if;
  if (select w.version from card_writes w where w.play = play2) is distinct from e3 or (select w.attempts from card_writes w where w.play = play2) is distinct from 0 then
    raise exception 'a finish for a replaced version leaves the newer job as it was queued';
  end if;

  -- What a reader gets: every row of the page's posts, the waiting jobs marked, the same to everyone and never the predicate.
  perform tests.become(ann);
  seen := (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from post_tails(array[p, p2]) x);
  perform tests.become(bob);
  seen_b := (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from post_tails(array[p, p2]) x);
  perform tests.become(cat);
  seen_c := (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from post_tails(array[p, p2]) x);
  perform tests.unbecome();
  if seen is distinct from seen_b or seen is distinct from seen_c then raise exception 'post_tails varies with who reads it: % / % / %', seen, seen_b, seen_c; end if;
  if jsonb_array_length(seen) is distinct from 4 then raise exception 'post_tails answers each row and each waiting job: %', seen; end if;
  if seen -> 0 ->> 'play' is distinct from play1::text or seen -> 0 ->> 'version' is distinct from e2::text or seen -> 0 ->> 'text' is distinct from 'A tail for the first.'
     or (seen -> 0 ->> 'failed')::boolean is distinct from false or (seen -> 0 ->> 'waiting')::boolean is distinct from false or seen -> 0 ->> 'post' is distinct from p::text
     or seen -> 1 ->> 'play' is distinct from play2::text or seen -> 1 ->> 'version' is distinct from e2::text or seen -> 1 ->> 'text' is distinct from 'A tail that came late.' then
    raise exception 'post_tails orders by version then play, and carries the text: %', seen;
  end if;
  if (seen -> 2 ->> 'waiting')::boolean is distinct from true or seen -> 2 ->> 'version' is distinct from e3::text or seen -> 2 ->> 'text' is not null
     or (seen -> 3 ->> 'waiting')::boolean is distinct from true or seen -> 3 ->> 'play' is distinct from play2::text then
    raise exception 'post_tails marks a job still waiting for the current version: %', seen;
  end if;
  if exists (select 1 from jsonb_array_elements(seen) e where e ? 'predicate' or e ? 'call' or e ? 'attempts') then raise exception 'post_tails shows more than a reader may see: %', seen; end if;

  -- An ended play gets no new job, and the one it had is let go at the next claim.
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, play2, jsonb_build_object('why', 'reversed', 'by', 'admin'));
  perform set_config('kayfabb.card_end_writer', '', true);
  e4 := tests.act(b, 'edit', t, jsonb_build_object('body', 'The first words, mended a fourth time'), p, base + interval '10 minutes');
  if (select w.version from card_writes w where w.play = play1) is distinct from e4 then raise exception 'an edit still queues a play that is in force'; end if;
  jobs := pg_temp.of_post(pg_temp.claim(10, p), p);
  if jsonb_array_length(jobs) is distinct from 1 or jobs -> 0 ->> 'play' is distinct from play1::text or exists (select 1 from card_writes w where w.play = play2) then
    raise exception 'an ended play''s job is let go and its place in the chain is not held: %', jobs;
  end if;
end $$;

-- ------------------------------------------------------------------------------------------------------------ the refund ----
do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'),
        'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb,
    'cards', jsonb_build_array(jsonb_build_object('key', 'cw-seeded', 'name', 'Seeded', 'alignment', 'salty', 'rarity', 'uncommon', 'play', 'cast', 'writes', true),
                               jsonb_build_object('key', 'cw-seeded-plain', 'name', 'Seeded plain', 'alignment', 'sweet', 'rarity', 'uncommon', 'play', 'cast')),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'cw-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'cw-boss', 'name', 'Cw Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'cw-mod', 'name', 'Cw Mod', 'title', 'Mod', 'signature', 'b')),
      'firstStaff', jsonb_build_array('cw-mod'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
end $$;

do $$
declare
  ann uuid := tests.account('cw2-ann'); bob uuid := tests.account('cw2-bob');
  a uuid := tests.character(ann, 'Cw Payer'); b uuid := tests.character(bob, 'Cw Writer');
  t uuid := tests.thread('Refund thread');
  base timestamptz := '2030-02-01T00:00:00Z';
  p4 uuid; p5 uuid; p6 uuid; p7 uuid;
  pl uuid; played jsonb; e uuid; said jsonb;
  made bigint; wallets_before bigint;
begin
  insert into wallets (account, balance) values (ann, 600), (bob, 600);
  insert into card_ledger (account, card, kind, price) values (ann, 'cw-scribe', 'bought', 0), (ann, 'cw-scribe', 'bought', 0), (ann, 'cw-scribe', 'bought', 0);

  -- The seed carries whether a card writes into the catalog.
  if (select k.writes from card_kinds k where k.key = 'cw-seeded') is distinct from true or (select k.writes from card_kinds k where k.key = 'cw-seeded-plain') is distinct from false
     or (select k.writes from card_kinds k where k.key = 'sweetie') is distinct from false then
    raise exception 'seed_instance sets card_kinds.writes from the card';
  end if;

  -- A paid play, played through the door the Edge Function uses.
  p4 := tests.post(b, t, 'A post that will be played on.', base);
  perform tests.become_service();
  played := play_card(ann, 'cw-scribe', a, p4, '{}', 50, '', tokens => 100);
  perform tests.unbecome();
  pl := (played ->> 'id')::uuid;
  if (select count(*) from card_writes where play = (played ->> 'id')::uuid) is distinct from 1 then raise exception 'play_card of a writing card queues one job'; end if;
  if (select balance from wallets where account = ann) is distinct from 550 or card_held(ann, 'cw-scribe') is distinct from 2 then raise exception 'the play cost its price and took a card'; end if;

  -- A failure on it pays exactly the play's wallet event back, returns the card, and says why once.
  said := pg_temp.finish(pl, p4, null, 'unreachable');
  if (select count(*) from wallet_events w where w.kind = 'refund' and w.ref = pl and w.account = ann and w.change = 50) is distinct from 1 or (select balance from wallets where account = ann) is distinct from 600 then
    raise exception 'a failed finish on a paid play refunds exactly the play''s wallet event: %', said;
  end if;
  if (select count(*) from card_write_refunds r where r.play = pl and r.amount = 50) is distinct from 1 then raise exception 'the refund is recorded once'; end if;
  if (select count(*) from card_ledger l where l.kind = 'returned' and l.act = pl and l.account = ann and l.card = 'cw-scribe' and l.price = 50) is distinct from 1 or card_held(ann, 'cw-scribe') is distinct from 3 then
    raise exception 'a failed finish returns the card to the hand, and card_held counts it';
  end if;
  if exists (select 1 from card_writes w where w.play = pl) or (select count(*) from card_texts x where x.play = pl and x.text is null and x.failed = 'unreachable') is distinct from 1 then raise exception 'a failed finish writes its row and clears its job'; end if;
  -- A second finish of it, and a second call of the refund, pay nothing more.
  perform pg_temp.finish(pl, p4, null, 'unreachable');
  said := pg_temp.finish(pl, p4, null, 'scrub:word');
  perform tests.become_service();
  said := refund_card_write(pl);
  perform tests.unbecome();
  if (select count(*) from wallet_events w where w.kind = 'refund' and w.ref = pl) is distinct from 1 or (select count(*) from card_ledger l where l.kind = 'returned' and l.act = pl) is distinct from 1
     or (select count(*) from card_write_refunds r where r.play = pl) is distinct from 1 or (said ->> 'refunded')::boolean is distinct from false or (select balance from wallets where account = ann) is distinct from 600 then
    raise exception 'a second call refunds nothing: %', said;
  end if;

  -- A failure on a play that already has a text pays nothing: the tail it had stays, and so does the price.
  p5 := tests.post(b, t, 'A post whose tail comes, and then fails once mended.', base + interval '1 minute');
  perform tests.become_service();
  pl := (play_card(ann, 'cw-scribe', a, p5, '{}', 30, '', tokens => 100) ->> 'id')::uuid;
  perform tests.unbecome();
  made := record_model_call(jsonb_build_object('duty', 'cardText', 'provider', 'local', 'model', 'old', 'cost_microdollars', 0, 'outcome', 'ok', 'play', pl, 'gpu_seconds', 1.5));
  if (select m.play from model_calls m where m.id = made) is distinct from pl then raise exception 'record_model_call writes the play a call was made for'; end if;
  perform pg_temp.finish(pl, p5, 'It came.', null, made);
  if (select x.call from card_texts x where x.play = pl and x.version = p5) is distinct from made then raise exception 'a finish names its model call'; end if;
  e := tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended.'), p5, base + interval '2 minutes');
  perform pg_temp.finish(pl, e, null, 'unreachable');
  if exists (select 1 from wallet_events w where w.kind = 'refund' and w.ref = pl) or exists (select 1 from card_ledger l where l.kind = 'returned' and l.act = pl) or exists (select 1 from card_write_refunds r where r.play = pl) then
    raise exception 'a failed finish on a play that already has a text refunded';
  end if;
  if (select count(*) from card_texts x where x.play = pl) is distinct from 2 then raise exception 'the failure is a row beside the text it kept'; end if;

  -- A failure of a version that a newer job replaced decides nothing: the newer one may yet make the tail, and a failure of it refunds.
  p6 := tests.post(b, t, 'A post mended before its first tail came.', base + interval '3 minutes');
  perform tests.become_service();
  pl := (play_card(ann, 'cw-scribe', a, p6, '{}', 20, '', tokens => 100) ->> 'id')::uuid;
  perform tests.unbecome();
  e := tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended before the tail.'), p6, base + interval '4 minutes');
  perform pg_temp.finish(pl, p6, null, 'unreachable');
  if exists (select 1 from wallet_events w where w.kind = 'refund' and w.ref = pl) or (select w.version from card_writes w where w.play = pl) is distinct from e then
    raise exception 'a failure of a replaced version refunded, or took the newer job with it';
  end if;
  perform pg_temp.finish(pl, e, null, 'nonEmpty');
  if (select count(*) from wallet_events w where w.kind = 'refund' and w.ref = pl and w.change = 20) is distinct from 1 or (select count(*) from card_ledger l where l.kind = 'returned' and l.act = pl) is distinct from 1 then
    raise exception 'a failure of the newest version refunds';
  end if;

  -- A Mod Bot's play pays nothing and holds no hand, so its failure moves no wallet and returns nothing.
  p7 := tests.post(b, t, 'A post a Mod Bot played on.', base + interval '5 minutes');
  perform tests.become_service();
  pl := (staff_play_card('cw-mod', 'cw-scribe', p7, '{}', '', tokens => 100) ->> 'id')::uuid;
  perform tests.unbecome();
  if (select count(*) from card_writes where play = (select a2.id from acts a2 where a2.target_act_id = p7 and a2.kind = 'card')) is distinct from 1 then raise exception 'a Mod Bot''s play of a writing card queues one job'; end if;
  select coalesce(sum(w.balance), 0) into wallets_before from wallets w;
  perform pg_temp.finish(pl, p7, null, 'scrub:word');
  if (select coalesce(sum(w.balance), 0) from wallets w) is distinct from wallets_before or exists (select 1 from wallet_events w where w.ref = pl) or exists (select 1 from card_ledger l where l.act = pl)
     or exists (select 1 from card_write_refunds r where r.play = pl and r.amount is not null) or exists (select 1 from card_writes w where w.play = pl) then
    raise exception 'a Mod Bot''s play''s failure moved a wallet or a hand';
  end if;
  if (select count(*) from card_texts x where x.play = pl and x.failed = 'scrub:word') is distinct from 1 then raise exception 'a Mod Bot''s failure is still a row'; end if;
end $$;

-- ------------------------------------------------------------------------------------------------------- the settle wait ----
do $$
declare
  ann uuid := tests.account('cws-ann'); bob uuid := tests.account('cws-bob');
  a uuid := tests.character(ann, 'Cws Caster'); b uuid := tests.character(bob, 'Cws Author');
  t uuid := tests.thread('Settle thread');
  base timestamptz := '2030-04-01T00:00:00Z';
  p uuid; pl1 uuid; pl2 uuid; e1 uuid; e2 uuid; e3 uuid; first_wait timestamptz; got jsonb;
begin
  update settings set value = '30' where key = 'cardWriteSettleSeconds';
  p := tests.post(b, t, 'Words that will be mended.', base);
  pl1 := tests.act(a, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p, base + interval '1 minute');
  -- The first generation after a cast is claimable at once.
  got := pg_temp.claim(10, p);
  if jsonb_array_length(got) is distinct from 1 then raise exception 'a cast''s job was not claimable at once: %', got; end if;
  perform pg_temp.finish(pl1, p, 'First tail.', null);
  -- An edit's job waits the setting's seconds from the edit, and is not claimable before.
  e1 := tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended once'), p, base + interval '2 minutes');
  first_wait := (select w.not_before from card_writes w where w.play = pl1);
  if first_wait < clock_timestamp() + interval '25 seconds' or first_wait > clock_timestamp() + interval '35 seconds' then raise exception 'an edit''s job waits about 30 seconds: %', first_wait - clock_timestamp(); end if;
  if jsonb_array_length(pg_temp.claim(10, p)) is distinct from 0 then raise exception 'an edit''s job was claimed before its wait was over'; end if;
  -- A second edit leaves one job at the newer version and pushes the wait out again.
  e2 := tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended twice'), p, base + interval '3 minutes');
  if (select count(*) from card_writes w where w.post = p) is distinct from 1 or (select w.version from card_writes w where w.play = pl1) is distinct from e2
     or (select w.not_before from card_writes w where w.play = pl1) <= first_wait then
    raise exception 'two edits leave one job at the newer version with the later wait: %', (select jsonb_agg(to_jsonb(w)) from card_writes w where w.post = p);
  end if;
  -- The cursor shows meanwhile: post_tails reports the job as waiting.
  if not exists (select 1 from post_tails(array[p]) x where x.waiting and x.play = pl1 and x.version = e2) then raise exception 'a settling job is not reported as waiting'; end if;
  -- After the wait (the row's clock moved) it is claimable.
  update card_writes set not_before = clock_timestamp() - interval '1 second' where play = pl1;
  if jsonb_array_length(pg_temp.claim(10, p)) is distinct from 1 then raise exception 'an edit''s job was not claimable after its wait'; end if;
  perform pg_temp.finish(pl1, e2, 'Second tail.', null);
  -- The setting is read at the edit: 0 is no wait.
  update settings set value = '0' where key = 'cardWriteSettleSeconds';
  e3 := tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended thrice'), p, base + interval '4 minutes');
  if jsonb_array_length(pg_temp.claim(10, p)) is distinct from 1 then raise exception 'with a wait of 0 an edit''s job was not claimable at once'; end if;
  perform pg_temp.finish(pl1, e3, 'Third tail.', null);
  update settings set value = '30' where key = 'cardWriteSettleSeconds';

  -- The chain holds while an earlier play's job is settling: the later play's job waits behind it, even once its own wait is over.
  pl2 := tests.act(a, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 2), p, base + interval '5 minutes');
  perform tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended again'), p, base + interval '6 minutes');
  if jsonb_array_length(pg_temp.claim(10, p)) is distinct from 0 then raise exception 'jobs claimed while both settle'; end if;
  update card_writes set not_before = clock_timestamp() - interval '1 second' where play = pl2;
  if jsonb_array_length(pg_temp.claim(10, p)) is distinct from 0 then raise exception 'a later play''s job was claimed while an earlier play''s job was still settling'; end if;
  update card_writes set not_before = clock_timestamp() - interval '1 second' where play = pl1;
  got := pg_temp.claim(10, p);
  if jsonb_array_length(got) is distinct from 1 or got -> 0 ->> 'play' is distinct from pl1::text then raise exception 'the earlier play''s job is the one claimed once it has settled: %', got; end if;
end $$;

-- ----------------------------------------------------------------------------------------------- a refunded play is over ----
do $$
declare
  ann uuid := tests.account('cwo-ann'); bob uuid := tests.account('cwo-bob');
  a uuid := tests.character(ann, 'Cwo Caster'); b uuid := tests.character(bob, 'Cwo Author');
  t uuid := tests.thread('Over thread');
  base timestamptz := '2030-05-01T00:00:00Z';
  p uuid; p2 uuid; p3 uuid; p4 uuid; pl uuid; pl2 uuid; pl3 uuid; pl4 uuid; got jsonb; said jsonb; before_sum bigint; n integer;
begin
  update settings set value = '0' where key = 'cardWriteSettleSeconds';
  insert into wallets (account, balance) values (ann, 600);
  insert into card_ledger (account, card, kind, price) select ann, 'cw-scribe', 'bought', 0 from generate_series(1, 6);

  -- Fail, refund: an edit queues nothing for the play, and a claim returns nothing.
  p := tests.post(b, t, 'A post whose play failed.', base);
  perform tests.become_service();
  pl := (play_card(ann, 'cw-scribe', a, p, '{}', 50, '', tokens => 100) ->> 'id')::uuid;
  perform tests.unbecome();
  perform pg_temp.finish(pl, p, null, 'unreachable');
  if not exists (select 1 from card_write_refunds r where r.play = pl) or not card_ended(pl) then raise exception 'a refunded play is not over'; end if;
  perform tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended after the refund'), p, base + interval '1 minute');
  if exists (select 1 from card_writes w where w.play = pl) or exists (select 1 from live_writing_plays(p) x where x = pl) then raise exception 'an edit queued a job for a refunded play'; end if;
  if jsonb_array_length(pg_temp.claim(10, p)) is distinct from 0 then raise exception 'a claim returned a refunded play'; end if;
  -- Its failed row is still there for post_tails, and no cursor is drawn for it.
  if (select count(*) from post_tails(array[p]) x where x.play = pl and x.failed) is distinct from 1 or exists (select 1 from post_tails(array[p]) x where x.waiting) then raise exception 'post_tails does not keep the refunded play''s failed row alone'; end if;
  -- A late text for it (a second worker after a reclaim) writes nothing: the play is over and the card is back in the hand.
  said := pg_temp.finish(pl, p, 'Too late.', null);
  if exists (select 1 from card_texts x where x.play = pl and x.text is not null) or (said ->> 'written')::boolean is distinct from false then raise exception 'a text was written for a refunded play: %', said; end if;

  -- A job that exists for the play when the refund lands is deleted by the refund itself; a job inserted behind it is dropped by the claim.
  p2 := tests.post(b, t, 'A post refunded with a job racing in.', base + interval '2 minutes');
  perform tests.become_service();
  pl2 := (play_card(ann, 'cw-scribe', a, p2, '{}', 20, '', tokens => 100) ->> 'id')::uuid;
  perform refund_card_write(pl2);
  perform tests.unbecome();
  if exists (select 1 from card_writes w where w.play = pl2) then raise exception 'the refund left the play''s job'; end if;
  insert into card_writes (play, post, version) values (pl2, p2, p2);
  got := pg_temp.claim(10, p2);
  if jsonb_array_length(got) is distinct from 0 or exists (select 1 from card_writes w where w.play = pl2) then raise exception 'the claim did not drop a job for a refunded play: % %', got, (select jsonb_agg(to_jsonb(w)) from card_writes w where w.play = pl2); end if;

  -- A refunded play is no earlier play in the chain: a later play on the post is claimable, and its frame does not carry the refunded tail.
  p3 := tests.post(b, t, 'A post with two plays, the first refunded.', base + interval '3 minutes');
  perform tests.become_service();
  pl3 := (play_card(ann, 'cw-scribe', a, p3, '{}', 0, '', tokens => 100) ->> 'id')::uuid;
  perform tests.unbecome();
  pl4 := tests.act(a, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 2), p3, clock_timestamp() + interval '1 second');
  if jsonb_array_length(pg_temp.claim(10, p3)) is distinct from 1 then raise exception 'before the refund the later play waits behind the earlier'; end if;
  update card_writes set claimed_until = null where play = pl3;
  -- A base-length paid play (price 0): its failure returns the card, moves no wallet, and is over.
  select coalesce(sum(w.balance), 0) into before_sum from wallets w;
  perform pg_temp.finish(pl3, p3, null, 'unreachable');
  if (select coalesce(sum(w.balance), 0) from wallets w) is distinct from before_sum or exists (select 1 from wallet_events w where w.kind = 'refund' and w.ref = pl3)
     or (select count(*) from card_ledger l where l.kind = 'returned' and l.act = pl3) is distinct from 1 or (select r.amount from card_write_refunds r where r.play = pl3) is distinct from 0 or not card_ended(pl3) then
    raise exception 'a base-length play''s failure returns the card, moves no wallet and is over';
  end if;
  got := pg_temp.claim(10, p3);
  if jsonb_array_length(got) is distinct from 1 or got -> 0 ->> 'play' is distinct from pl4::text or got -> 0 -> 'earlier' is distinct from '[]'::jsonb then raise exception 'the later play is claimable behind a refunded one: %', got; end if;

  -- A Mod Bot's play: its first failure is over too, recorded without pretending a refund was paid (a row with no amount), and moves nothing.
  p4 := tests.post(b, t, 'A post a Mod Bot played on.', base + interval '5 minutes');
  perform tests.become_service();
  pl := (staff_play_card('cw-mod', 'cw-scribe', p4, '{}', '', tokens => 100) ->> 'id')::uuid;
  perform tests.unbecome();
  select coalesce(sum(w.balance), 0) into before_sum from wallets w;
  perform pg_temp.finish(pl, p4, null, 'scrub:word');
  if (select count(*) from card_write_refunds r where r.play = pl and r.amount is null) is distinct from 1 or not card_ended(pl) or exists (select 1 from card_writes w where w.play = pl)
     or (select coalesce(sum(w.balance), 0) from wallets w) is distinct from before_sum or exists (select 1 from wallet_events w where w.ref = pl) or exists (select 1 from card_ledger l where l.act = pl) then
    raise exception 'a Mod Bot''s failed play is not over, or moved something';
  end if;
  perform tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended after the Mod Bot''s failure'), p4, base + interval '6 minutes');
  if exists (select 1 from card_writes w where w.play = pl) then raise exception 'an edit queued a job for a Mod Bot''s failed play'; end if;

  -- The stack counts plays still up: two live plays and a refunded one leave room for a fourth, and a fifth is refused.
  p := tests.post(b, t, 'A post for the stack.', base + interval '7 minutes');
  perform tests.become_service();
  pl := (play_card(ann, 'cw-scribe', a, p, '{}', 0, '', tokens => 100) ->> 'id')::uuid;
  perform play_card(ann, 'cw-scribe', a, p, '{}', 0, '', tokens => 100);
  pl2 := (play_card(ann, 'cw-scribe', a, p, '{}', 0, '', tokens => 100) ->> 'id')::uuid;
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, tokens => 100)', ann, 'cw-scribe', a, p, '{}', '')) is null then raise exception 'a fourth cast was allowed with three live plays'; end if;
  perform tests.unbecome();
  perform pg_temp.finish(pl2, p, null, 'unreachable');
  perform tests.become_service();
  perform play_card(ann, 'cw-scribe', a, p, '{}', 0, '', tokens => 100);
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, tokens => 100)', ann, 'cw-scribe', a, p, '{}', '')) is null then raise exception 'a fifth cast was allowed'; end if;
  perform tests.unbecome();
  select count(*) into n from acts k where k.kind = 'card' and k.target_act_id = p and not card_ended(k.id);
  if n is distinct from 3 then raise exception 'three plays are live on the post, not %', n; end if;

  -- A refund the wallet's cap clamps is recorded as what moved, not as what was paid.
  p2 := tests.post(b, t, 'A post paid for with a wallet near its cap.', base + interval '8 minutes');
  perform tests.become_service();
  pl := (play_card(ann, 'cw-scribe', a, p2, '{}', 50, '', tokens => 100) ->> 'id')::uuid;
  perform tests.unbecome();
  update wallets set balance = (setting('walletCap'))::integer - 10 where account = ann;
  perform pg_temp.finish(pl, p2, null, 'unreachable');
  if (select r.amount from card_write_refunds r where r.play = pl) is distinct from 10 or (select w.change from wallet_events w where w.kind = 'refund' and w.ref = pl) is distinct from 10
     or (select l.price from card_ledger l where l.kind = 'returned' and l.act = pl) is distinct from 10 then
    raise exception 'a clamped refund is recorded as paid, not as moved: %', (select jsonb_agg(to_jsonb(r)) from card_write_refunds r where r.play = pl);
  end if;
end $$;

-- ------------------------------------------------------------------------------------------- append-only, bounds, access ----
do $$
declare
  ann uuid := tests.account('cw3-ann'); bob uuid := tests.account('cw3-bob');
  a uuid := tests.character(ann, 'Cw Third Caster'); b uuid := tests.character(bob, 'Cw Third Author');
  t uuid := tests.thread('Bounds thread');
  base timestamptz := '2030-03-01T00:00:00Z';
  p uuid; pl uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; slot uuid; said text; rolled text[]; scribes integer := 0; plains integer := 0; n integer;
begin
  p := tests.post(b, t, 'A post for the bounds.', base);
  pl := tests.act(a, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p, base + interval '1 minute');
  e1 := tests.act(b, 'edit', t, jsonb_build_object('body', 'one'), p, base + interval '2 minutes');
  e2 := tests.act(b, 'edit', t, jsonb_build_object('body', 'two'), p, base + interval '3 minutes');
  e3 := tests.act(b, 'edit', t, jsonb_build_object('body', 'three'), p, base + interval '4 minutes');
  e4 := tests.act(b, 'edit', t, jsonb_build_object('body', 'four'), p, base + interval '5 minutes');
  insert into card_texts (play, version, text) values (pl, e1, 'one text');

  -- A text is kept as it was made: no update, no delete, no truncate; and a row says a text or a failure, never both or neither.
  said := pg_temp.refusal(format('update card_texts set text = %L where play = %L', 'changed', pl));
  if said is null or said not like '%never edited%' then raise exception 'card_texts took an update: %', said; end if;
  said := pg_temp.refusal(format('delete from card_texts where play = %L', pl));
  if said is null or said not like '%never edited%' then raise exception 'card_texts took a delete: %', said; end if;
  said := pg_temp.refusal('truncate card_texts');
  if said is null or said not like '%never edited%' then raise exception 'card_texts took a truncate: %', said; end if;
  if pg_temp.refusal(format('insert into card_texts (play, version) values (%L, %L)', pl, e2)) is null then raise exception 'a row of neither a text nor a failure was accepted'; end if;
  if pg_temp.refusal(format('insert into card_texts (play, version, text, failed) values (%L, %L, %L, %L)', pl, e2, 'both', 'unreachable')) is null then raise exception 'a row of a text and a failure was accepted'; end if;
  if pg_temp.refusal(format('insert into card_texts (play, version, text) values (%L, %L, %L)', pl, e2, '')) is null then raise exception 'an empty text was accepted'; end if;
  if pg_temp.refusal(format('insert into card_texts (play, version, text) values (%L, %L, %L)', pl, e2, repeat('x', 4001))) is null then raise exception 'a text of 4,001 characters was accepted'; end if;
  if pg_temp.refusal(format('insert into card_texts (play, version, text) values (%L, %L, %L)', pl, e2, repeat('x', 4000))) is not null then raise exception 'a text of 4,000 characters was refused'; end if;
  if pg_temp.refusal(format('insert into card_texts (play, version, text) values (%L, %L, %L)', pl, e1, 'again')) is null then raise exception 'a second text for one version was accepted'; end if;

  -- The tables are the server's alone: no signed-in player reads the queue, the texts or the refunds, and no one calls the worker's doors.
  perform tests.become(ann);
  foreach said in array array['card_writes', 'card_texts', 'card_write_refunds'] loop
    if pg_temp.refusal(format('select * from %I', said)) is null then raise exception '% is readable by a signed-in player', said; end if;
  end loop;
  if pg_temp.refusal('select claim_card_writes(1)') is null or pg_temp.refusal(format('select finish_card_write(%L, %L, %L, null, null)', pl, e1, 'x')) is null
     or pg_temp.refusal(format('select refund_card_write(%L)', pl)) is null then
    raise exception 'a signed-in player calls the worker''s doors';
  end if;
  if pg_temp.refusal(format('select * from post_tails(array[%L]::uuid[])', p)) is not null then raise exception 'a signed-in player cannot read tails'; end if;
  perform tests.become_anon();
  if pg_temp.refusal(format('select * from post_tails(array[%L]::uuid[])', p)) is null then raise exception 'post_tails is readable by anon'; end if;
  perform tests.unbecome();

  -- Without the old voice nothing writing is sold, played or pulled, in the words the engine's decidePlay says.
  update settings set value = 'false' where key = 'oldVoice';
  insert into machine_slots (position, card, availability, price) values (9101, 'cw-scribe', 'onSale', 100) returning id into slot;
  insert into wallets (account, balance) values (ann, 600);
  insert into card_ledger (account, card, kind, price) values (ann, 'cw-scribe', 'bought', 0);
  perform tests.become_service();
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'cw-scribe', a, p, '{}', ''));
  if said is distinct from 'The old voice isn''t running on this forum, so this card can''t be played.' then raise exception 'play_card with oldVoice off: %', said; end if;
  said := pg_temp.refusal(format('select buy_card(%L, %L, 100)', ann, slot));
  if said is distinct from 'The old voice isn''t running on this forum, so this card can''t be played.' then raise exception 'buy_card with oldVoice off: %', said; end if;
  said := pg_temp.refusal(format('select staff_play_card(%L, %L, %L)', 'cw-mod', 'cw-scribe', p));
  if said is distinct from 'The old voice isn''t running on this forum, so this card can''t be played.' then raise exception 'staff_play_card with oldVoice off: %', said; end if;
  perform tests.unbecome();
  if (select balance from wallets where account = ann) is distinct from 600 or card_held(ann, 'cw-scribe') is distinct from 1 then raise exception 'a refused purchase or play took something'; end if;
  perform setseed(0.5);
  for n in 1..60 loop
    rolled := roll_pack('[{"weights": {"uncommon": 100}}]', '{}');
    if rolled[1] = 'cw-scribe' or rolled[1] = 'cw-seeded' then scribes := scribes + 1; end if;
  end loop;
  if scribes is distinct from 0 then raise exception 'a pack pulled a writing card with oldVoice off (% times)', scribes; end if;
  -- And with it on they are sold, played and pulled as any card is.
  update settings set value = 'true' where key = 'oldVoice';
  perform setseed(0.5);
  for n in 1..60 loop
    rolled := roll_pack('[{"weights": {"uncommon": 100}}]', '{}');
    if rolled[1] = 'cw-scribe' then scribes := scribes + 1; end if;
  end loop;
  if scribes < 1 then raise exception 'a pack never pulled a writing card with oldVoice on'; end if;
  perform tests.become_service();
  if (buy_card(ann, slot, 100) ->> 'card') is distinct from 'cw-scribe' then raise exception 'buy_card with oldVoice on'; end if;
  perform play_card(ann, 'cw-scribe', a, p, '{}', 0, '', tokens => 100);
  perform tests.unbecome();

  -- The worker is woken every minute, by the schedule the other jobs use.
  if not exists (select 1 from cron.job j where j.jobname = 'kayfabb-write' and j.schedule = '* * * * *' and j.command like '%/functions/v1/write%' and j.command like '%kayfabb_jobs_key%') then
    raise exception 'the sweep is not scheduled: %', (select jsonb_agg(to_jsonb(j)) from cron.job j);
  end if;
end $$;

-- ------------------------------------------------------------------------------------------------- the author's log read ----
-- my_posts_written_on and log_page's `writes`: the texts and failures on posts one of the caller's characters wrote, for the author's log.
do $$
declare
  ann uuid := tests.account('cwl-ann'); bob uuid := tests.account('cwl-bob'); cas uuid := tests.account('cwl-cas');
  a uuid := tests.character(ann, 'Cwl Ann'); b uuid := tests.character(bob, 'Cwl Bob'); c uuid := tests.character(cas, 'Cwl Caster');
  t uuid := tests.thread('Author log thread');
  base timestamptz := '2030-07-01T00:00:00Z';
  pa uuid; pb uuid; e1 uuid; e2 uuid; own uuid;
  play_a uuid; play_fail uuid; play_kept uuid; play_b uuid; play_own uuid; many uuid;
  rows jsonb; doc jsonb; plan text; n integer; i integer; v uuid;
begin
  pa := tests.post(a, t, 'Ann wrote this.', base);
  pb := tests.post(b, t, 'Bob wrote this.', base + interval '1 minute');
  own := tests.post(a, t, 'Ann wrote this too.', base + interval '2 minutes');
  e1 := tests.act(a, 'edit', t, jsonb_build_object('body', 'Ann mended this'), pa, base + interval '10 minutes');
  e2 := tests.act(a, 'edit', t, jsonb_build_object('body', 'Ann mended this again'), pa, base + interval '20 minutes');
  play_a := tests.act(c, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), pa, base + interval '3 minutes');
  play_fail := tests.act(c, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 2), pa, base + interval '4 minutes');
  play_kept := tests.act(c, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 3), pa, base + interval '5 minutes');
  play_b := tests.act(c, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), pb, base + interval '6 minutes');
  -- Ann casts it on her own post too: the tail is hers to read whoever cast it.
  play_own := tests.act(a, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), own, base + interval '7 minutes');
  -- play_a: a first text, then a text for each edit. play_fail: its first generation failed. play_kept: a text, then a failure for a later version. play_b: Bob's post.
  insert into card_texts (play, version, text, created_at) values (play_a, pa, 'first tail', base + interval '30 minutes');
  insert into card_texts (play, version, text, created_at) values (play_a, e1, 'second tail', base + interval '31 minutes');
  insert into card_texts (play, version, text, created_at) values (play_a, e2, 'third tail', base + interval '32 minutes');
  insert into card_texts (play, version, failed, created_at) values (play_fail, pa, 'unreachable', base + interval '33 minutes');
  insert into card_texts (play, version, text, created_at) values (play_kept, pa, 'kept tail', base + interval '34 minutes');
  insert into card_texts (play, version, failed, created_at) values (play_kept, e1, 'scrub:word', base + interval '35 minutes');
  insert into card_texts (play, version, text, created_at) values (play_b, pb, 'Bob''s tail', base + interval '36 minutes');
  insert into card_texts (play, version, text, created_at) values (play_own, own, 'own tail', base + interval '37 minutes');

  -- The author reads rows for plays on her own posts, and none for another's.
  perform tests.become(ann);
  select jsonb_agg(jsonb_build_object('play', w.play, 'post', w.post, 'version', w.version, 'failed', w.failed, 'opening', w.opening, 'at', w.at) order by w.at) into rows from my_posts_written_on w;
  perform tests.unbecome();
  if jsonb_array_length(rows) is distinct from 7 or exists (select 1 from jsonb_array_elements(rows) r where r ->> 'post' = pb::text or r ->> 'play' = play_b::text) then raise exception 'the author does not read exactly the rows on her own posts: %', rows; end if;
  -- A first text, a regeneration for a later version, a first failure, and a failure after a text, each told apart.
  if (select count(*) from jsonb_array_elements(rows) r where r ->> 'play' = play_a::text and (r ->> 'opening')::boolean and not (r ->> 'failed')::boolean and r ->> 'version' = pa::text) is distinct from 1
     or (select count(*) from jsonb_array_elements(rows) r where r ->> 'play' = play_a::text and not (r ->> 'opening')::boolean and not (r ->> 'failed')::boolean and r ->> 'version' in (e1::text, e2::text)) is distinct from 2
     or (select count(*) from jsonb_array_elements(rows) r where r ->> 'play' = play_fail::text and (r ->> 'opening')::boolean and (r ->> 'failed')::boolean) is distinct from 1
     or (select count(*) from jsonb_array_elements(rows) r where r ->> 'play' = play_kept::text and not (r ->> 'opening')::boolean and (r ->> 'failed')::boolean and r ->> 'version' = e1::text) is distinct from 1
     or (select count(*) from jsonb_array_elements(rows) r where r ->> 'play' = play_kept::text and (r ->> 'opening')::boolean and not (r ->> 'failed')::boolean) is distinct from 1 then
    raise exception 'a first text, a regeneration, a first failure and a later failure are not told apart: %', rows;
  end if;
  -- Her own cast on her own post is a row too (the tail is hers), and the row's time is the text's own.
  if not exists (select 1 from jsonb_array_elements(rows) r where r ->> 'play' = play_own::text and (r ->> 'opening')::boolean)
     or (select (r ->> 'at')::timestamptz from jsonb_array_elements(rows) r where r ->> 'play' = play_a::text and r ->> 'version' = e1::text) is distinct from (base + interval '31 minutes') then
    raise exception 'her own cast on her own post is missing, or a row''s time is not the text''s: %', rows;
  end if;

  -- Bob reads his own; the caster, who wrote no post, reads none; a visitor is refused.
  perform tests.become(bob);
  select count(*) into n from my_posts_written_on w where w.play = play_b and w.post = pb and w.opening and not w.failed;
  if n is distinct from 1 or (select count(*) from my_posts_written_on) is distinct from 1 then raise exception 'Bob does not read exactly his own row'; end if;
  perform tests.become(cas);
  if (select count(*) from my_posts_written_on) is distinct from 0 then raise exception 'a caster reads rows on other players'' posts'; end if;
  perform tests.become_anon();
  if pg_temp.refusal('select * from my_posts_written_on') is null then raise exception 'my_posts_written_on is readable by anon'; end if;
  perform tests.unbecome();

  -- Its columns are the post's public facts and nothing about whose it is: no owner, no caster, no wallet.
  if (select array_agg(a.attname::text order by a.attnum) from pg_attribute a where a.attrelid = 'my_posts_written_on'::regclass and a.attnum > 0 and not a.attisdropped) is distinct from array['play', 'post', 'version', 'failed', 'opening', 'over', 'at'] then
    raise exception 'my_posts_written_on has columns beyond the public ones';
  end if;

  -- It starts from the caller's characters, posts and plays through indexes, never a scan of acts, texts or characters.
  perform tests.become(ann);
  set local enable_seqscan = off;
  plan := pg_temp.plan('select * from my_posts_written_on');
  reset enable_seqscan;
  perform tests.unbecome();
  if plan ~ 'Seq Scan on (acts|card_texts|characters)' or plan not like '%characters_owner%' or plan not like '%card_texts_play_version_key%' then raise exception 'the read is not index-led: %', plan; end if;

  -- log_page's `writes` is the view's rows newest first, bounded by the cursor; the plays and posts they name are among its Acts.
  perform tests.become(ann);
  doc := log_page(null);
  if (doc -> 'sources' -> 'writes') is distinct from (select jsonb_agg(to_jsonb(w) order by w.at desc, w.play, w.version) from my_posts_written_on w) then
    raise exception 'log_page writes are not the view''s rows: %', doc -> 'sources' -> 'writes';
  end if;
  if jsonb_array_length(doc -> 'sources' -> 'writes') is distinct from 7 then raise exception 'log_page does not answer all seven rows: %', doc -> 'sources' -> 'writes'; end if;
  if exists (select 1 from jsonb_array_elements(doc -> 'sources' -> 'writes') r where not exists (select 1 from jsonb_array_elements(doc -> 'acts') x where x ->> 'id' = r ->> 'play') or not exists (select 1 from jsonb_array_elements(doc -> 'acts') x where x ->> 'id' = r ->> 'post')) then
    raise exception 'log_page does not name the plays and posts its writes name';
  end if;
  doc := log_page(base + interval '33 minutes');
  if jsonb_array_length(doc -> 'sources' -> 'writes') is distinct from 4 or exists (select 1 from jsonb_array_elements(doc -> 'sources' -> 'writes') r where (r ->> 'at')::timestamptz > base + interval '33 minutes') then
    raise exception 'log_page does not cut its writes at the cursor: %', doc -> 'sources' -> 'writes';
  end if;
  perform tests.unbecome();

  -- Bounded: a play with 210 versions reads at most 200 rows in a page, newest first, and the cursor reaches the rest.
  many := tests.act(c, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 2), own, base + interval '8 minutes');
  for i in 1..210 loop
    v := tests.act(a, 'edit', t, jsonb_build_object('body', 'edit ' || i), own, base + interval '1 hour' + i * interval '1 second');
    insert into card_texts (play, version, text, created_at) values (many, v, 'tail ' || i, base + interval '2 hours' + i * interval '1 second');
  end loop;
  perform tests.become(ann);
  doc := log_page(null);
  if jsonb_array_length(doc -> 'sources' -> 'writes') is distinct from 200 or (doc -> 'sources' -> 'writes' -> 0 ->> 'at')::timestamptz is distinct from base + interval '2 hours' + interval '210 seconds' then
    raise exception 'log_page reads % writes, not the newest 200', jsonb_array_length(doc -> 'sources' -> 'writes');
  end if;
  perform tests.unbecome();
end $$;

-- What the author's log may say of a play is told by the row's own facts (the log's lines, engine/ui/log/lines.ts): `opening` is a text with no
-- earlier text (a play's first), and `over` is the failure that ended the play (it was refunded and no row came after). A failure the play survived
-- (a newer job was waiting, or a text was already there) is neither, so no line says it did not take.
do $$
declare
  ann uuid := tests.account('cwx-ann'); cas uuid := tests.account('cwx-cas');
  a uuid := tests.character(ann, 'Cwx Ann'); c uuid := tests.character(cas, 'Cwx Caster');
  t uuid := tests.thread('Author line thread');
  base timestamptz := '2030-08-01T00:00:00Z';
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; e uuid; e1 uuid;
  k1 uuid; k2 uuid; k3 uuid; k4 uuid; k5 uuid;
  rows jsonb;
begin
  p1 := tests.post(a, t, 'One.', base); p2 := tests.post(a, t, 'Two.', base + interval '1 minute'); p3 := tests.post(a, t, 'Three.', base + interval '2 minutes');
  p4 := tests.post(a, t, 'Four.', base + interval '3 minutes'); p5 := tests.post(a, t, 'Five.', base + interval '4 minutes');
  k1 := tests.act(c, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p1, base + interval '10 minutes');
  k2 := tests.act(c, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p2, base + interval '10 minutes');
  k3 := tests.act(c, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p3, base + interval '10 minutes');
  k4 := tests.act(c, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p4, base + interval '10 minutes');
  k5 := tests.act(c, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p5, base + interval '10 minutes');

  -- 1. A first failure while a newer job waits is not the end: the play lives and its next text is its first.
  e := tests.act(a, 'edit', t, jsonb_build_object('body', 'One, mended'), p1, base + interval '11 minutes');
  perform pg_temp.finish(k1, p1, null, 'unreachable');
  perform pg_temp.finish(k1, e, 'a first text', null);
  -- 2. A first failure with nothing waiting is the end.
  perform pg_temp.finish(k2, p2, null, 'unreachable');
  -- 3. A text, then a failure for a later version: the tail stays and the play is not over.
  perform pg_temp.finish(k3, p3, 'kept', null);
  e1 := tests.act(a, 'edit', t, jsonb_build_object('body', 'Three, mended'), p3, base + interval '12 minutes');
  perform pg_temp.finish(k3, e1, null, 'scrub:word');
  -- 4. A text, then another text.
  perform pg_temp.finish(k4, p4, 'first', null);
  e1 := tests.act(a, 'edit', t, jsonb_build_object('body', 'Four, mended'), p4, base + interval '12 minutes');
  perform pg_temp.finish(k4, e1, 'second', null);
  -- 5. A failure while a newer job waits, then another failure with nothing waiting, which ends it.
  e := tests.act(a, 'edit', t, jsonb_build_object('body', 'Five, mended'), p5, base + interval '11 minutes');
  perform pg_temp.finish(k5, p5, null, 'unreachable');
  perform pg_temp.finish(k5, e, null, 'unreachable');

  perform tests.become(ann);
  select jsonb_agg(jsonb_build_object('play', w.play, 'failed', w.failed, 'opening', w.opening, 'over', w.over) order by w.at, w.version) into rows from my_posts_written_on w;
  perform tests.unbecome();
  if rows is distinct from (select jsonb_agg(x) from (values
       (k1, true, true, false), (k1, false, true, false),
       (k2, true, true, true),
       (k3, false, true, false), (k3, true, false, false),
       (k4, false, true, false), (k4, false, false, false),
       (k5, true, true, false), (k5, true, true, true)) v(play, failed, opening, over),
       lateral (select jsonb_build_object('play', v.play, 'failed', v.failed, 'opening', v.opening, 'over', v.over) as x) q) then
    raise exception 'the rows do not tell what the author''s log may say: %', rows;
  end if;
end $$;

-- ---------------------------------------------------------------------------------- a play that did not take, said plainly ----
-- The client learns a play is over from a flag it reads, never from an inference: acts_public says `untaken` of a play whose first generation
-- failed and was refunded, the same to every reader, and nothing of the refund table (its amount) rides with it.
do $$
declare
  ann uuid := tests.account('cwu-ann'); bob uuid := tests.account('cwu-bob'); cat uuid := tests.account('cwu-cat'); boss uuid := tests.account('cwu-admin');
  a uuid := tests.character(ann, 'Cwu Caster'); b uuid := tests.character(bob, 'Cwu Author'); c uuid := tests.character(cat, 'Cwu Reader');
  t uuid := tests.thread('Untaken thread');
  base timestamptz := '2030-06-01T00:00:00Z';
  p uuid; p2 uuid; pl_bad uuid; pl_good uuid; pl_bot uuid; pl_ended uuid; who uuid; page jsonb;
begin
  update settings set value = '0' where key = 'cardWriteSettleSeconds';
  insert into admins (account) values (boss);
  insert into wallets (account, balance) values (ann, 600);
  insert into card_ledger (account, card, kind, price) select ann, 'cw-scribe', 'bought', 0 from generate_series(1, 4);
  p := tests.post(b, t, 'A post with plays that took and did not.', base);
  p2 := tests.post(b, t, 'A post a Mod Bot played on.', base + interval '1 minute');
  perform tests.become_service();
  pl_bad := (play_card(ann, 'cw-scribe', a, p, '{}', 50, '', tokens => 100) ->> 'id')::uuid;
  pl_good := (play_card(ann, 'cw-scribe', a, p, '{}', 0, '', tokens => 100) ->> 'id')::uuid;
  pl_ended := (play_card(ann, 'cw-scribe', a, p, '{}', 0, '', tokens => 100) ->> 'id')::uuid;
  pl_bot := (staff_play_card('cw-mod', 'cw-scribe', p2, '{}', '', tokens => 100) ->> 'id')::uuid;
  perform tests.unbecome();
  perform pg_temp.finish(pl_good, p, 'A tail.', null);
  perform pg_temp.finish(pl_bad, p, null, 'unreachable');
  perform pg_temp.finish(pl_bot, p2, null, 'scrub:word');
  perform tests.become(boss);
  perform reverse_card(pl_ended);
  perform tests.unbecome();

  -- The flag, the same to the caster, the author, a reader and the admin; and it carries nothing but the fact.
  foreach who in array array[ann, bob, cat, boss] loop
    perform tests.become(who);
    if (select array_agg(x.id order by x.id) from acts_public x where x.kind = 'card' and x.target_act_id in (p, p2) and x.untaken) is distinct from (select array_agg(i order by i) from unnest(array[pl_bad, pl_bot]) i) then
      raise exception 'untaken is not the refunded plays alone, or differs by reader: %', (select jsonb_agg(jsonb_build_object('id', x.id, 'untaken', x.untaken)) from acts_public x where x.kind = 'card' and x.target_act_id in (p, p2));
    end if;
    if exists (select 1 from acts_public x where x.id in (pl_good, pl_ended, p) and x.untaken) then raise exception 'a play that took, or one an admin ended, or a post, reads as untaken'; end if;
    perform tests.unbecome();
  end loop;
  -- The thread page's plays carry it.
  perform tests.become(cat);
  page := thread_page(t, 1, null, 20, '{}');
  if (select count(*) from jsonb_array_elements(page -> 'plays') r where r ->> 'kind' = 'card' and (r ->> 'untaken')::boolean) is distinct from 2
     or exists (select 1 from jsonb_array_elements(page -> 'plays') r where r ->> 'id' in (pl_good::text, pl_ended::text) and (r ->> 'untaken')::boolean) then
    raise exception 'the thread page does not carry the flag: %', page -> 'plays';
  end if;
  perform tests.unbecome();
end $$;

-- A refusal about a play that did not take says so, and an admin's name is said only of an end an admin made.
do $$
declare
  ann uuid := tests.account('cwr-ann'); bob uuid := tests.account('cwr-bob'); cat uuid := tests.account('cwr-cat'); boss uuid := tests.account('cwr-admin');
  a uuid := tests.character(ann, 'Cwr Caster'); b uuid := tests.character(bob, 'Cwr Author');
  t uuid := tests.thread('Refusal thread');
  base timestamptz := '2030-06-02T00:00:00Z';
  p uuid; pl_bad uuid; pl_ended uuid; plain text := 'That card didn''t take, so there is nothing of it on this post.'; who uuid;
begin
  update settings set value = '0' where key = 'cardWriteSettleSeconds';
  insert into admins (account) values (boss);
  insert into wallets (account, balance) values (ann, 600);
  insert into card_ledger (account, card, kind, price) select ann, 'cw-scribe', 'bought', 0 from generate_series(1, 3);
  p := tests.post(b, t, 'A post.', base);
  perform tests.become_service();
  pl_bad := (play_card(ann, 'cw-scribe', a, p, '{}', 10, '', tokens => 100) ->> 'id')::uuid;
  pl_ended := (play_card(ann, 'cw-scribe', a, p, '{}', 0, '', tokens => 100) ->> 'id')::uuid;
  perform tests.unbecome();
  perform pg_temp.finish(pl_bad, p, null, 'unreachable');
  perform tests.become(boss);
  perform reverse_card(pl_ended);
  -- An admin cannot end what is over already, and is told the truth.
  if pg_temp.refusal(format('select reverse_card(%L)', pl_bad)) is distinct from plain then
    raise exception 'ending a play that did not take says: %', pg_temp.refusal(format('select reverse_card(%L)', pl_bad));
  end if;
  if pg_temp.refusal(format('select reverse_card(%L)', pl_ended)) is distinct from 'an admin has already ended that card' then
    raise exception 'ending a play an admin ended says: %', pg_temp.refusal(format('select reverse_card(%L)', pl_ended));
  end if;
  perform tests.unbecome();
  -- release_effect, to any signed-in reader alike.
  foreach who in array array[ann, bob, cat] loop
    perform tests.become(who);
    if pg_temp.refusal(format('select release_effect(%L)', pl_bad)) is distinct from plain then
      raise exception 'releasing from a play that did not take says: %', pg_temp.refusal(format('select release_effect(%L)', pl_bad));
    end if;
    if pg_temp.refusal(format('select release_effect(%L)', pl_ended)) is distinct from 'an admin ended that card' then
      raise exception 'releasing from a play an admin ended says: %', pg_temp.refusal(format('select release_effect(%L)', pl_ended));
    end if;
    perform tests.unbecome();
  end loop;
  -- save_effect_state, said to the post's author alone (the author's checks come first, as before).
  perform tests.become_service();
  if pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', bob, b, pl_bad, '{}')) is distinct from plain then
    raise exception 'saving onto a play that did not take says: %', pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', bob, b, pl_bad, '{}'));
  end if;
  if pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', bob, b, pl_ended, '{}')) is distinct from 'an admin ended that card' then
    raise exception 'saving onto a play an admin ended says: %', pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', bob, b, pl_ended, '{}'));
  end if;
  perform tests.unbecome();
end $$;

-- An admin ends a play while the worker holds its claim: the worker's failure refunds nothing, and the play is not returned to the hand.
do $$
declare
  ann uuid := tests.account('cwe-ann'); bob uuid := tests.account('cwe-bob'); boss uuid := tests.account('cwe-admin');
  a uuid := tests.character(ann, 'Cwe Caster'); b uuid := tests.character(bob, 'Cwe Author');
  t uuid := tests.thread('Ended mid-claim thread');
  base timestamptz := '2030-06-03T00:00:00Z';
  p uuid; pl uuid; got jsonb; said jsonb; before_sum bigint; held_before integer;
begin
  update settings set value = '0' where key = 'cardWriteSettleSeconds';
  insert into admins (account) values (boss);
  insert into wallets (account, balance) values (ann, 600);
  insert into card_ledger (account, card, kind, price) select ann, 'cw-scribe', 'bought', 0 from generate_series(1, 2);
  p := tests.post(b, t, 'A post.', base);
  perform tests.become_service();
  pl := (play_card(ann, 'cw-scribe', a, p, '{}', 40, '', tokens => 100) ->> 'id')::uuid;
  perform tests.unbecome();
  if jsonb_array_length(pg_temp.claim(10, p)) is distinct from 1 then raise exception 'the play was not claimed'; end if;
  perform tests.become(boss);
  perform reverse_card(pl);
  perform tests.unbecome();
  select coalesce(sum(w.balance), 0) into before_sum from wallets w;
  held_before := card_held(ann, 'cw-scribe');
  said := pg_temp.finish(pl, p, null, 'unreachable');
  if (said ->> 'over')::boolean is distinct from true or (said ->> 'written')::boolean is distinct from false then raise exception 'a finish of an ended play does not say it is over: %', said; end if;
  if exists (select 1 from card_write_refunds r where r.play = pl) or exists (select 1 from wallet_events w where w.kind = 'refund' and w.ref = pl) or exists (select 1 from card_ledger l where l.kind = 'returned' and l.act = pl)
     or (select coalesce(sum(w.balance), 0) from wallets w) is distinct from before_sum or card_held(ann, 'cw-scribe') is distinct from held_before or exists (select 1 from card_texts x where x.play = pl) then
    raise exception 'a failed finish of a play an admin ended moved something';
  end if;
  perform tests.become_service();
  said := refund_card_write(pl);
  perform tests.unbecome();
  if (said ->> 'over')::boolean is distinct from true or (said ->> 'refunded')::boolean is distinct from false
     or exists (select 1 from card_write_refunds r where r.play = pl) or (select coalesce(sum(w.balance), 0) from wallets w) is distinct from before_sum or card_held(ann, 'cw-scribe') is distinct from held_before then
    raise exception 'refund_card_write of a play an admin ended moved something or does not say it is over: %', said;
  end if;
end $$;

-- A run of edits waits only so long: the wait is pushed out by each edit, to five times the settle wait from where the settling began.
do $$
declare
  ann uuid := tests.account('cwc-ann'); bob uuid := tests.account('cwc-bob');
  a uuid := tests.character(ann, 'Cwc Caster'); b uuid := tests.character(bob, 'Cwc Author');
  t uuid := tests.thread('Cap thread');
  base timestamptz := '2030-06-04T00:00:00Z';
  p uuid; pl uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; got jsonb; since timestamptz; nb timestamptz;
begin
  update settings set value = '30' where key = 'cardWriteSettleSeconds';
  p := tests.post(b, t, 'Words an author keeps mending.', base);
  pl := tests.act(a, 'card', t, jsonb_build_object('card', 'cw-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p, base + interval '1 minute');
  perform pg_temp.claim(10, p);
  perform pg_temp.finish(pl, p, 'First tail.', null);
  -- The first edit begins the settling: the wait is the settle wait from it.
  e1 := tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended 1'), p, base + interval '2 minutes');
  select w.settling_since, w.not_before into since, nb from card_writes w where w.play = pl;
  if since is null or since < clock_timestamp() - interval '5 seconds' or nb < clock_timestamp() + interval '25 seconds' or nb > clock_timestamp() + interval '35 seconds' then
    raise exception 'the first edit begins the settling and waits the settle wait: % %', since, nb - clock_timestamp();
  end if;
  -- Later edits push the wait out, but the settling began long ago: 140 seconds in, the wait is cut at 150 from the start (10 seconds on).
  update card_writes set settling_since = clock_timestamp() - interval '140 seconds' where play = pl;
  e2 := tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended 2'), p, base + interval '3 minutes');
  select w.settling_since, w.not_before into since, nb from card_writes w where w.play = pl;
  if nb < clock_timestamp() + interval '5 seconds' or nb > clock_timestamp() + interval '15 seconds' or since > clock_timestamp() - interval '135 seconds' then
    raise exception 'an edit pushes the wait out only to five times the settle wait from the first edit: % since %', nb - clock_timestamp(), clock_timestamp() - since;
  end if;
  -- Early in the settling an edit pushes the full settle wait out, as before.
  update card_writes set settling_since = clock_timestamp() - interval '10 seconds' where play = pl;
  e3 := tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended 3'), p, base + interval '4 minutes');
  select w.not_before into nb from card_writes w where w.play = pl;
  if nb < clock_timestamp() + interval '25 seconds' or nb > clock_timestamp() + interval '35 seconds' then raise exception 'an early edit pushes the full wait: %', nb - clock_timestamp(); end if;
  -- Past the cap an edit leaves the job claimable, and the claim takes the newest version.
  update card_writes set settling_since = clock_timestamp() - interval '200 seconds' where play = pl;
  e4 := tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended 4'), p, base + interval '5 minutes');
  if (select w.not_before from card_writes w where w.play = pl) > clock_timestamp() then raise exception 'an edit past the cap kept the job unclaimable'; end if;
  got := pg_temp.claim(10, p);
  if jsonb_array_length(got) is distinct from 1 or got -> 0 ->> 'version' is distinct from e4::text then raise exception 'a claim past the cap does not take the newest version: %', got; end if;
  perform pg_temp.finish(pl, e4, 'Second tail.', null);
  -- Once claimed and finished, the next edit begins a new settling.
  e5 := tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended 5'), p, base + interval '6 minutes');
  select w.settling_since, w.not_before into since, nb from card_writes w where w.play = pl;
  if since < clock_timestamp() - interval '5 seconds' or nb < clock_timestamp() + interval '25 seconds' then raise exception 'the edit after a finish does not begin a new settling: % %', since, nb - clock_timestamp(); end if;
  -- An edit that arrives while a job is claimed (not yet finished) begins a new settling too, rather than inheriting the old one.
  update card_writes set settling_since = clock_timestamp() - interval '400 seconds', not_before = clock_timestamp() - interval '1 second' where play = pl;
  perform pg_temp.claim(10, p);
  perform tests.act(b, 'edit', t, jsonb_build_object('body', 'Mended 6'), p, base + interval '7 minutes');
  select w.settling_since, w.not_before into since, nb from card_writes w where w.play = pl;
  if since < clock_timestamp() - interval '5 seconds' or nb < clock_timestamp() + interval '25 seconds' then raise exception 'an edit after a claim does not begin a new settling: % %', since, nb - clock_timestamp(); end if;
end $$;


-- ------------------------------------------------------------------------------------------- the tokens a play bought ----
-- The tokens are a fact of the play (design, section 2): decided by the server, written into the play's own Act at insert (payload `tokens`), bounded
-- and required here for a card that writes and refused for any other, returned by the claim, and never moved by a later change of the economy.
do $$
declare
  ann uuid := tests.account('cwt-ann'); bob uuid := tests.account('cwt-bob');
  a uuid := tests.character(ann, 'Cwt Payer'); b uuid := tests.character(bob, 'Cwt Writer');
  t uuid := tests.thread('Tokens thread');
  base timestamptz := '2030-09-01T00:00:00Z';
  p uuid; p2 uuid; p3 uuid; pl uuid; pl2 uuid; got jsonb; said text; acts_before bigint;
begin
  insert into wallets (account, balance) values (ann, 600);
  insert into card_ledger (account, card, kind, price) select ann, c, 'bought', 0 from unnest(array['cw-scribe', 'cw-scribe', 'cw-scribe', 'cw-plain']) c;
  p := tests.post(b, t, 'A post to be played on.', base);
  p2 := tests.post(b, t, 'Another post.', base + interval '1 minute');
  p3 := tests.post(b, t, 'A third post.', base + interval '2 minutes');
  perform tests.become_service();
  -- A writing play without its tokens, and with too few or too many, is refused, and nothing is written.
  select count(*) into acts_before from acts;
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'cw-scribe', a, p, '{}', ''));
  if said is distinct from 'a card that writes buys between 1 and 2,000 tokens' then raise exception 'a writing play without tokens: %', said; end if;
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, tokens => 0)', ann, 'cw-scribe', a, p, '{}', '')) is null
     or pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, tokens => 2001)', ann, 'cw-scribe', a, p, '{}', '')) is null then
    raise exception 'tokens outside 1 to 2,000 were accepted';
  end if;
  -- A play of any other card with tokens is refused.
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, tokens => 50)', ann, 'cw-plain', a, p, '{}', ''));
  if said is distinct from 'only a card that writes buys tokens' then raise exception 'a non-writing play with tokens: %', said; end if;
  if pg_temp.refusal(format('select staff_play_card(%L, %L, %L)', 'cw-mod', 'cw-scribe', p)) is null
     or pg_temp.refusal(format('select staff_play_card(%L, %L, %L, tokens => 50)', 'cw-mod', 'cw-plain', p)) is null then
    raise exception 'a Mod Bot''s play was not held to the tokens';
  end if;
  if (select count(*) from acts) is distinct from acts_before then raise exception 'a refused play wrote an Act'; end if;
  perform tests.unbecome();

  -- A play with its tokens stores them in its own Act, a player's through play_card and a Mod Bot's through staff_play_card, and a plain play stores none.
  perform tests.become_service();
  pl := (play_card(ann, 'cw-scribe', a, p, '{}', 20, '', tokens => 80) ->> 'id')::uuid;
  pl2 := (staff_play_card('cw-mod', 'cw-scribe', p2, '{}', '', tokens => 120) ->> 'id')::uuid;
  perform play_card(ann, 'cw-plain', a, p3, '{}', 0, '');
  perform tests.unbecome();
  if (select x.payload -> 'tokens' from acts x where x.id = pl) is distinct from '80'::jsonb or (select x.payload -> 'tokens' from acts x where x.id = pl2) is distinct from '120'::jsonb
     or exists (select 1 from acts x where x.target_act_id = p3 and x.kind = 'card' and x.payload ? 'tokens') then
    raise exception 'the tokens are not in the play''s own Act, or a plain play carries some';
  end if;

  -- The signed-in player cannot call play_card to choose their own tokens, whatever they pass.
  perform tests.become(ann);
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, tokens => 5)', ann, 'cw-scribe', a, p, '{}', '')) is null then raise exception 'a player called play_card with their own tokens'; end if;
  perform tests.unbecome();

  -- The claim returns what each play bought, and a later change of the economy moves nothing.
  insert into settings (key, value) values ('economy', '{"cw.baseTokens": 25}') on conflict (key) do update set value = settings.value || '{"cw.baseTokens": 25}';
  update settings set value = settings.value || '{"cw.baseTokens": 999, "cw.stepPrice": 77}' where key = 'economy';
  got := pg_temp.claim(10, p);
  if jsonb_array_length(got) is distinct from 1 or got -> 0 ->> 'tokens' is distinct from '80' then raise exception 'the claim does not return the play''s tokens: %', got; end if;
  got := pg_temp.claim(10, p2);
  if jsonb_array_length(got) is distinct from 1 or got -> 0 ->> 'tokens' is distinct from '120' then raise exception 'the claim does not return a Mod Bot play''s tokens: %', got; end if;
end $$;
