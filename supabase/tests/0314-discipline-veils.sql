-- The discipline cards beside an author's veil (supabase/migrations/0361_discipline_cards.sql beside 0357_post_veils.sql: a veil shows the one stand-in character in place of a post's author, to every reader).
-- Nothing a discipline card does may unmask a veiled post's author, or let anyone (the caster, the author, a third player, the model) prove who it is; every refusal reads the same whoever owns the caster or the target.
--
-- 1. Take the Fall on a veiled post is refused, for every caster alike (a third player, the author's own character, a second mask of the author's account), in one sentence and one code, before anything is
--    paid or written: the own-post refusal, which compares the caster with the true author, is never reached while the veil is up. Once the veil is over the fall lands as on any post.
-- 2. A fall cast before the veil does not put the author on the record (its Act names its caster and the post, never the author), so a veil lands on it. While the veil is up no Mod Bot visits the post, so
--    nothing files and the fall waits; card_target hands the engine the stand-in as the post's author and acts_public shows the fall under its caster. After the veil the filing lands on the taker.
-- 3. A visit opened before a veil keeps the veil off (0357's refusal), a fall on the post or none, and the filing lands on the taker.
-- 4. A heart and a Tattle-Tale at character reach from a veiled post, on its author or on the stand-in, are refused as any card at character reach is (0357): no card is played on a stand-in. A heart played from
--    a post before a veil puts the author on the record (a card played from the post names it), so no veil lands there.
-- 5. Tattle-Tale's weight never reaches a veiled post: patrol_sample reads posts through acts_public, where a veiled post is the stand-in's (staff), so it is no candidate however its true author is watched,
--    and the samples of every seed are the same whether that author is watched or not, but for its own unveiled posts.
-- The cards are this file's own (t-dv-...), never an instance's.

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- The world: the seed (a Mod on staff, the stand-in, the settings), and this file's cards.
do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 50, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'),
        'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.'),
        'appealUpheld', jsonb_build_array('{mod} turns {appellant} down.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'anonymous', jsonb_build_object('name', 'Anonymous', 'title', 'Could be anyone.', 'avatar', 'nobody'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'dv-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'dv-boss', 'name', 'Veil Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'dv-m1', 'name', 'Veil Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('dv-m1'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts')))));
  if stand_in() is null then raise exception 'the seed made the stand-in'; end if;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, discipline) values
    ('t-dv-veil', 'Test Veil', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', null),
    ('t-dv-fall', 'Test Fall', 'sweet', 'uncommon', 'cast', '{post}', null, null, '{"kind": "fall"}'),
    ('t-dv-heart', 'Test Heart', 'sweet', 'uncommon', 'cast', '{character}', null, null, '{"kind": "relief", "points": "lightestBand"}'),
    ('t-dv-tattle', 'Test Tattle', 'salty', 'rare', 'cast', '{character}', interval '7 days', null, '{"kind": "watch", "weight": 10}');
end $$;

create function pg_temp.owner(c uuid) returns uuid language sql as $$ select owner from characters where id = c $$;

create function pg_temp.player(label text) returns uuid language plpgsql as $$
declare a uuid := tests.account('dv-' || label);
begin
  insert into wallets (account, balance) values (a, 500) on conflict (account) do update set balance = excluded.balance;
  return tests.character(a, 'Dv ' || label);
end $$;

-- A second mask of the same player's account.
create function pg_temp.mask(c uuid, label text) returns uuid language sql as $$ select tests.character(pg_temp.owner(c), 'Dv ' || label) $$;

create function pg_temp.hand(c uuid, card text, n integer default 1) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select pg_temp.owner(c), card, 'bought', 0 from generate_series(1, n)
$$;

create function pg_temp.say(by_character uuid, in_thread uuid, body text) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(pg_temp.owner(by_character));
  made := post(in_thread, by_character, body);
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;

-- A play through the service, as the act function makes it: 'null' when it landed, else the refusal's code and words.
create function pg_temp.play(c uuid, card text, target uuid, price integer default 0, reach text default 'post', from_post uuid default null) returns text language plpgsql as $$
declare got text;
begin
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, %s, %L, %L, %L)', pg_temp.owner(c), card, c, target, '{}', price, '', reach, from_post));
  perform tests.unbecome();
  return coalesce(got, 'null');
end $$;

create function pg_temp.veil(c uuid, on_post uuid) returns uuid language plpgsql as $$
declare got text := pg_temp.play(c, 't-dv-veil', on_post);
begin
  if got <> 'null' then raise exception 'the veil did not land: %', got; end if;
  return (select v.play from post_veils v where v.post = on_post order by v.ends_at desc limit 1);
end $$;

create function pg_temp.visit(on_post uuid) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := start_visit(on_post, 'dv-m1', jsonb_build_object('rule_number', null, 'band', 'moderate', 'cause', 'patrol', 'rule', 'Rule ' || gen_random_uuid()));
  return (r ->> 'visit')::uuid;
end $$;

create function pg_temp.fall_of(on_post uuid) returns uuid language sql as $$
  select k.id from acts k where k.kind = 'card' and k.target_act_id = on_post and k.payload ->> 'card' = 't-dv-fall' order by k.created_at, k.id limit 1
$$;

-- ---- 1. Take the Fall on a veiled post: one refusal for every caster, nothing paid or written; after the veil it lands ----
do $$
declare
  t uuid := tests.thread('Dv fall veiled');
  author uuid := pg_temp.player('f1-author'); second uuid; third uuid := pg_temp.player('f1-third'); veiler uuid := pg_temp.player('f1-veiler');
  adm uuid := tests.account('dv-f1-admin');
  p uuid := pg_temp.say(author, t, 'Whose words are these?');
  veil uuid; words text; got text; who uuid; wallet0 integer; held0 integer; plays0 integer;
begin
  second := pg_temp.mask(author, 'f1-second');
  insert into admins (account) values (adm);
  perform pg_temp.hand(veiler, 't-dv-veil');
  foreach who in array array[author, second, third] loop perform pg_temp.hand(who, 't-dv-fall'); end loop;
  veil := pg_temp.veil(veiler, p);
  words := '42501 this post''s author is hidden until ' || refusal_time(now() + interval '3 days') || '; nobody takes the fall for it before then';
  plays0 := (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p);
  -- The author's own character (whose own-post refusal would tell it from the rest), a second mask of the author's account, and a third player: one answer, at a price, before anything is paid.
  foreach who in array array[author, second, third] loop
    wallet0 := (select balance from wallets where account = pg_temp.owner(who));
    held0 := card_held(pg_temp.owner(who), 't-dv-fall');
    got := pg_temp.play(who, 't-dv-fall', p, 50);
    if got is distinct from words then raise exception 'a fall on a veiled post by % reads %, not %', (select name from characters where id = who), got, words; end if;
    if (select balance from wallets where account = pg_temp.owner(who)) is distinct from wallet0 or card_held(pg_temp.owner(who), 't-dv-fall') is distinct from held0 then
      raise exception 'a refused fall on a veiled post spent something'; end if;
  end loop;
  if (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p) is distinct from plays0 then raise exception 'a refused fall on a veiled post wrote something'; end if;
  -- After an admin's end of the veil, the post is the author's again: the third player's fall lands, and the author's own is refused in the words any own post gets.
  perform tests.become(adm);
  perform reverse_card(veil);
  perform tests.unbecome();
  got := pg_temp.play(third, 't-dv-fall', p);
  if got <> 'null' then raise exception 'a fall after the veil ended: %', got; end if;
  got := pg_temp.play(author, 't-dv-fall', p);
  if got is distinct from '42501 Test Fall is played on another character''s post' then raise exception 'the author''s own fall after the veil: %', got; end if;
end $$;

-- ---- 2. A fall cast before the veil: the veil lands; nothing files while it is up; the engine is handed the stand-in; after the veil the filing lands on the taker ----
do $$
declare
  t uuid := tests.thread('Dv fall before');
  author uuid := pg_temp.player('f2-author'); taker uuid := pg_temp.player('f2-taker'); veiler uuid := pg_temp.player('f2-veiler');
  adm uuid := tests.account('dv-f2-admin');
  p uuid := pg_temp.say(author, t, 'A post that breaks a rule.');
  play uuid; veil uuid; v uuid; got text; inf acts; row jsonb; stand uuid := stand_in();
begin
  insert into admins (account) values (adm);
  perform pg_temp.hand(veiler, 't-dv-veil'); perform pg_temp.hand(taker, 't-dv-fall');
  got := pg_temp.play(taker, 't-dv-fall', p);
  if got <> 'null' then raise exception 'the fall before the veil: %', got; end if;
  play := pg_temp.fall_of(p);
  -- Its Act names its caster and the post, and nothing names the author: the post is not on the record, so the veil lands.
  if (select payload::text from acts where id = play) like '%' || author::text || '%' then raise exception 'a fall''s Act names the post''s author: %', (select payload from acts where id = play); end if;
  if land_refusal((select k from card_kinds k where k.key = 't-dv-veil'), p, '{}') is not null then raise exception 'a fall puts the author on the record: %', land_refusal((select k from card_kinds k where k.key = 't-dv-veil'), p, '{}'); end if;
  veil := pg_temp.veil(veiler, p);
  -- While it is up: the engine is handed the stand-in as the post's author (a non-owner and the author alike), and the fall is shown under its caster.
  foreach row in array array[to_jsonb(pg_temp.owner(taker)), to_jsonb(pg_temp.owner(author))] loop
    perform tests.become((row #>> '{}')::uuid);
    if (card_target(p) ->> 'author') is distinct from stand::text then raise exception 'card_target hands the engine % for a veiled post''s author, not the stand-in', card_target(p) ->> 'author'; end if;
    if (select a.character from acts_public a where a.id = play) is distinct from taker then raise exception 'the fall is not shown under its caster while the post is veiled'; end if;
    perform tests.unbecome();
  end loop;
  -- No Mod Bot visits the post while its author is hidden, so nothing files and the fall waits, unspent.
  perform tests.become_service();
  v := pg_temp.visit(p);
  perform tests.unbecome();
  if v is not null or exists (select 1 from acts x where x.kind = 'visit' and x.target_act_id = p) then raise exception 'a visit opened on a veiled post'; end if;
  if fall_spent(play) then raise exception 'a fall on a veiled post was spent'; end if;
  -- After the veil: a visit opens and its filing lands on the taker, naming the author as the one it was taken for (the veil is over).
  perform tests.become(adm);
  perform reverse_card(veil);
  perform tests.unbecome();
  v := pg_temp.visit(p);
  if v is null then raise exception 'no visit after the veil ended'; end if;
  perform file_visit(v, 'Filed.');
  select * into inf from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text;
  if inf.payload ->> 'character' is distinct from taker::text or inf.payload ->> 'fall_play' is distinct from play::text or inf.payload ->> 'fall_for' is distinct from author::text then
    raise exception 'the filing after the veil lands on the taker: %', inf.payload; end if;
  if warn_points(author) is distinct from 0 or warn_points(taker) is distinct from 4 then raise exception 'the bars after the veil: author %, taker %', warn_points(author), warn_points(taker); end if;
end $$;

-- ---- 3. A visit opened before a veil keeps the veil off, a fall on the post or none ----
do $$
declare
  t uuid := tests.thread('Dv visit before');
  author uuid := pg_temp.player('f3-author'); taker uuid := pg_temp.player('f3-taker'); veiler uuid := pg_temp.player('f3-veiler');
  p uuid := pg_temp.say(author, t, 'Visited, with a fall.'); q uuid := pg_temp.say(author, t, 'Visited, with none.');
  v uuid; vq uuid; got text;
begin
  perform pg_temp.hand(veiler, 't-dv-veil', 2); perform pg_temp.hand(taker, 't-dv-fall');
  if pg_temp.play(taker, 't-dv-fall', p) <> 'null' then raise exception 'the fall did not land'; end if;
  v := pg_temp.visit(p); vq := pg_temp.visit(q);
  if v is null or vq is null then raise exception 'the visits did not open'; end if;
  foreach got in array array[pg_temp.play(veiler, 't-dv-veil', p), pg_temp.play(veiler, 't-dv-veil', q)] loop
    if got is distinct from '42501 a Mod Bot has been to this post, so its author is on the record' then raise exception 'a veil on a visited post: %', got; end if;
  end loop;
  perform file_visit(v, 'Filed.');
  if warn_points(taker) is distinct from 4 or warn_points(author) is distinct from 0 then raise exception 'the filing lands on the taker: taker %, author %', warn_points(taker), warn_points(author); end if;
end $$;

-- ---- 4. A heart and a Tattle-Tale at character reach beside a veil ----
do $$
declare
  t uuid := tests.thread('Dv hearts');
  author uuid := pg_temp.player('h-author'); healer uuid := pg_temp.player('h-healer'); veiler uuid := pg_temp.player('h-veiler'); second uuid;
  p uuid := pg_temp.say(author, t, 'Veiled.'); q uuid := pg_temp.say(author, t, 'A heart is played from here first.');
  old uuid := pg_temp.say(author, t, 'Earlier, and filed.');
  stand uuid := stand_in(); words text := '22023 no card is played on a stand-in'; got text; who uuid; target uuid; card text; plays0 integer; held0 integer;
begin
  second := pg_temp.mask(author, 'h-second');
  perform infract(author, 'moderate', old, 'dv-m1');
  perform pg_temp.hand(veiler, 't-dv-veil', 2);
  foreach who in array array[author, second, healer] loop perform pg_temp.hand(who, 't-dv-heart', 3); perform pg_temp.hand(who, 't-dv-tattle', 3); end loop;
  perform pg_temp.veil(veiler, p);
  plays0 := (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p);
  -- From the veiled post, on its true author or on the stand-in, by anyone (the author's own character, a second mask, a third player): one refusal, nothing spent or written.
  foreach card in array array['t-dv-heart', 't-dv-tattle'] loop
    foreach who in array array[author, second, healer] loop
      foreach target in array array[author, stand] loop
        held0 := card_held(pg_temp.owner(who), card);
        got := pg_temp.play(who, card, target, 0, 'character', p);
        if got is distinct from words then raise exception '% from a veiled post by % on %: %', card, (select name from characters where id = who), (select name from characters where id = target), got; end if;
        if card_held(pg_temp.owner(who), card) is distinct from held0 then raise exception 'a refused % spent the card', card; end if;
      end loop;
    end loop;
  end loop;
  if (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p) is distinct from plays0 then raise exception 'a refused card from a veiled post wrote something'; end if;
  if warn_points(author) is distinct from 4 or exists (select 1 from play_reach r where r.character = author) then raise exception 'a refused heart or watch reached the author'; end if;
  -- A heart played from a post before a veil names the post's author (its Act is on the post, and says whose bar it eased), so the post takes no veil.
  got := pg_temp.play(healer, 't-dv-heart', author, 0, 'character', q);
  if got <> 'null' then raise exception 'a heart on the author from their unveiled post: %', got; end if;
  got := pg_temp.play(veiler, 't-dv-veil', q);
  if got is distinct from '42501 a card played from this post names its author, so the author is on the record' then raise exception 'a veil on a post a heart was played from: %', got; end if;
end $$;

-- ---- 5. Tattle-Tale's weight never reaches a veiled post ----
do $$
declare
  bd uuid := (select id from boards where slug = 'general');
  t uuid := tests.thread('Dv patrol');
  author uuid := pg_temp.player('w-author'); tattler uuid := pg_temp.player('w-tattler'); veiler uuid := pg_temp.player('w-veiler'); other uuid := pg_temp.player('w-other');
  hidden uuid; shown uuid; got text; seed bigint; s jsonb; before jsonb := '{}'::jsonb; after jsonb := '{}'::jsonb; n integer;
begin
  -- The author's two posts in one thread, and others' in threads of their own (a patrol reads each thread's newest `most` posts, so the two are not crowded out of their thread).
  hidden := pg_temp.say(author, t, 'Veiled while watched.');
  shown := pg_temp.say(author, t, 'Not veiled.');
  for n in 1..4 loop
    declare ft uuid := tests.thread('Dv patrol filler ' || n);
    begin perform pg_temp.say(other, ft, 'Filler ' || n || 'a'); perform pg_temp.say(other, ft, 'Filler ' || n || 'b'); end;
  end loop;
  perform pg_temp.hand(veiler, 't-dv-veil'); perform pg_temp.hand(tattler, 't-dv-tattle');
  perform pg_temp.veil(veiler, hidden);
  -- The samples of many seeds before the watch, a pool that holds every candidate and a sample smaller than it.
  perform tests.become_service();
  for seed in 1..40 loop before := before || jsonb_build_object(seed::text, patrol_sample(array[bd], 3, 100, seed)); end loop;
  perform tests.unbecome();
  -- The author is watched (a Tattle-Tale from their unveiled post), at weight 10.
  got := pg_temp.play(tattler, 't-dv-tattle', author, 0, 'character', shown);
  if got <> 'null' then raise exception 'the Tattle-Tale on the author: %', got; end if;
  perform tests.become_service();
  for seed in 1..40 loop after := after || jsonb_build_object(seed::text, patrol_sample(array[bd], 3, 100, seed)); end loop;
  perform tests.unbecome();
  -- The veiled post is in no sample, before or after, and no sample names it or its author's name beside it.
  for s in select value from jsonb_each(before) union all select value from jsonb_each(after) loop
    if exists (select 1 from jsonb_array_elements(s) x where x ->> 'act' = hidden::text) then raise exception 'patrol_sample reached a veiled post: %', s; end if;
  end loop;
  -- The watch moved the author's unveiled post up and nothing else: with that post taken out, what is left of each sample is drawn among the others alone, and the veiled one is never among them.
  if not exists (select 1 from jsonb_each(after) e where exists (select 1 from jsonb_array_elements(e.value) x where x ->> 'act' = shown::text)) then raise exception 'the watch never drew the author''s unveiled post: the test proves nothing'; end if;
  if (select count(*) from jsonb_each(after) e where exists (select 1 from jsonb_array_elements(e.value) x where x ->> 'act' = shown::text))
     <= (select count(*) from jsonb_each(before) e where exists (select 1 from jsonb_array_elements(e.value) x where x ->> 'act' = shown::text)) then
    raise exception 'the watch did not weigh the author''s unveiled post up'; end if;
end $$;
