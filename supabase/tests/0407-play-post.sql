-- play_post: a row for each play on a post, from one definition (supabase/migrations/0407_play_post.sql; docs/plans/2026-11-21-post-plays-plan.md, Task 1; design docs/plans/2026-11-21-post-plays-design.md, sections 1 and 2).
--   * Each way a play ends gives the row its `over_at` or `ends_at`, and play_post_drift() is empty after each: time; a caught cast; an instant; reverse_card; refund_card_write; a pierce play spent by its caster's next cast;
--     a set sprung (by a cast and by a quote); take_back; a back whose time passes; a drive a second play joins (both plays' ends_at move to the new close); a cut (Buzzkill), and the cutting play's reversal brings the cut play back.
--   * A character card's row is on the post it was played from, with its reach; a thread card's is on its first post; a back's row has `kind = ''` and holds no card.
--   * A raw `card` Act through write_staff_act gets a row.
--   * Up is up: the rows in force at post reach equal the plays place_cast's count calls up; red on a row edited to disagree.
--   * The backfill's statement rebuilds exactly the rows the triggers kept.
--   * The poison: an end written with the triggers off is named by play_post_drift().
-- The cards are this file's own (pp...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k, generate_series(1, 8)
$$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into settings (key, value) values ('oldVoice', 'true') on conflict (key) do update set value = excluded.value;
  update settings set value = value || '{"pp.g1": 10, "pp.over": 25}'::jsonb where key = 'economy';
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick, cuts, stack, writes, drive) values
    ('ppkick', 'Pp Kick', 'salty', 'common', 'use', null, '{post}', interval '3 days', '{"kind": "earn", "quadrants": ["excitedNegative", "boredNegative"], "flat": 1}', null, 3, false, null),
    ('ppcut', 'Pp Buzzkill', 'salty', 'rare', 'cast', null, '{post,character}', null, null, '{"upTo": "rare"}', 1, false, null),
    ('ppperc', 'Pp Pierce', 'pepperoni', 'uncommon', 'use', null, '{character}', interval '3 days', '{"kind": "pierce", "upTo": "uncommon"}', null, 1, false, null),
    ('ppmove', 'Pp Move', 'salty', 'common', 'cast', null, '{post}', null, null, null, 8, false, null),
    ('ppchar', 'Pp Character Gimmick', 'sweet', 'uncommon', 'use', null, '{character}', interval '3 days', '{"kind": "earn", "quadrants": ["excitedPositive"], "by": 1, "group": "publicity"}', null, 1, false, null),
    ('ppthr', 'Pp Thread Gimmick', 'sweet', 'uncommon', 'use', null, '{thread}', interval '3 days', '{"kind": "earn", "quadrants": ["excitedPositive"], "by": 1, "group": "publicity"}', null, 1, false, null),
    ('ppscribe', 'Pp Scribe', 'salty', 'uncommon', 'cast', null, '{post}', null, null, null, 3, true, null),
    ('ppdrive', 'Pp Drive', 'sweet', 'uncommon', 'cast', null, '{post}', null, null, null, 2, false, '{"lasts": {"unit": "hour", "count": 1}, "gifts": ["pp.g1"], "overhead": "pp.over"}')
  on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('ppback', 'Pp Back', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null)
  on conflict (key) do nothing;
  -- A Move: a cast card set face down springs on a quote and lands on the quoting post.
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values ('ppqmove', 'Pp Quote Move', 'salty', 'uncommon', 'cast', null, '{post}', null) on conflict (key) do nothing;
end $$;

-- A back written as it would be were its time already past: a set Act and its face_down row, with the played row set_card writes.
create function pg_temp.old_back(who uuid, ch uuid, th uuid, post uuid, card text, at timestamptz, ends timestamptz) returns uuid language plpgsql as $$
declare s uuid;
begin
  s := tests.act(ch, 'set', th, '{}', post, at);
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s, who, card, post, th, 1, ends);
  insert into card_ledger (account, card, kind, act, price, at) values (who, card, 'played', s, 0, at);
  return s;
end $$;

create function pg_temp.pr(p uuid) returns play_post language sql as $$ select * from play_post where play = p $$;

-- Nothing drifts: the kept rows are what play_row says, every play has one, and every row has a play.
create function pg_temp.nodrift(label text) returns void language plpgsql as $$
begin
  if exists (select 1 from play_post_drift()) then
    raise exception 'after %, play_post drifts: %', label, (select jsonb_agg(to_jsonb(d)) from play_post_drift() d);
  end if;
end $$;

-- The plays place_cast's count calls up on a post for a card, as it counts them (0405_cut.sql): not caught, at post reach, not instant, ends ahead or unset, not over (card_ended); for a drive card, those of the post's open drive alone.
create function pg_temp.up_now(p uuid, k text) returns setof uuid language sql as $$
  select x.id from acts x
  where x.kind = 'card' and x.target_act_id = p and x.payload ->> 'card' = k and not (x.payload ? 'caught') and coalesce(x.payload ->> 'reach', 'post') = 'post'
    and not (x.payload ? 'instant') and (x.payload ->> 'ends' is null or (x.payload ->> 'ends')::timestamptz > now()) and not card_ended(x.id)
    and (not exists (select 1 from card_kinds ck where ck.key = k and ck.drive is not null)
         or x.id in (select m.id from drive_plays(p, k) m where m.drive = (
              select d.drive from drive_plays(p, k) d group by d.drive
              having max(d.created_at) + span_interval((select ck.drive -> 'lasts' from card_kinds ck where ck.key = k)) > now()
              order by max(d.created_at) desc limit 1)))
$$;

-- How many plays the kept rows and place_cast's count disagree on, over every card and post the test wrote.
create function pg_temp.up_disagree() returns bigint language sql as $$
  select (select count(*) from (
    select pk.p, pk.k, pg_temp.up_now(pk.p, pk.k) as id from (select distinct a.target_act_id as p, a.payload ->> 'card' as k from acts a where a.kind = 'card' and a.target_act_id is not null) pk
    except
    select r.post, r.kind, r.play from play_post r where r.reach = 'post' and r.over_at is null and (r.ends_at is null or r.ends_at > now())
  ) a)
  + (select count(*) from (
    select r.post, r.kind, r.play from play_post r where r.reach = 'post' and r.over_at is null and (r.ends_at is null or r.ends_at > now()) and r.kind <> ''
    except
    select pk.p, pk.k, pg_temp.up_now(pk.p, pk.k) from (select distinct a.target_act_id as p, a.payload ->> 'card' as k from acts a where a.kind = 'card' and a.target_act_id is not null) pk
  ) b)
$$;

-- The one table of this file's fixture, built in the first block and read by the rest.
create temp table pp_fix (label text primary key, id uuid not null, extra jsonb);
create function pg_temp.fix(l text) returns uuid language sql as $$ select id from pp_fix where label = l $$;

-- ---- The table: no client reaches it, and the drift check is the service's alone ----
select tests.unbecome();
do $$
begin
  if not exists (select 1 from pg_class c where c.relname = 'play_post' and c.relnamespace = 'public'::regnamespace and c.relrowsecurity) then raise exception 'play_post is missing or has no row-level security'; end if;
  if has_table_privilege('anon', 'play_post', 'select') or has_table_privilege('authenticated', 'play_post', 'select') or has_table_privilege('service_role', 'play_post', 'select')
     or has_table_privilege('anon', 'play_post', 'insert,update,delete') or has_table_privilege('authenticated', 'play_post', 'insert,update,delete') or has_table_privilege('service_role', 'play_post', 'insert,update,delete') then
    raise exception 'play_post is granted to an API role';
  end if;
  if has_function_privilege('anon', 'play_post_drift()', 'execute') or has_function_privilege('authenticated', 'play_post_drift()', 'execute') or not has_function_privilege('service_role', 'play_post_drift()', 'execute') then
    raise exception 'play_post_drift is not the service role''s alone';
  end if;
  if has_function_privilege('anon', 'play_row(uuid)', 'execute') or has_function_privilege('authenticated', 'play_row(uuid)', 'execute')
     or has_function_privilege('anon', 'refresh_play_post(uuid,boolean)', 'execute') or has_function_privilege('authenticated', 'refresh_play_post(uuid,boolean)', 'execute') then
    raise exception 'play_row or refresh_play_post is granted to a client role';
  end if;
end $$;

-- ---- A play that is no card or set, and a card with no target, has no row ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pp-n-ann'); a uuid := tests.character(ann, 'Pp N Ann');
  t uuid := tests.thread('Pp none'); p uuid := tests.post(a, t, 'A post.');
begin
  if play_row(p) is not null or (play_row(gen_random_uuid())).play is not null then raise exception 'play_row answers a row for an Act that is no play'; end if;
  if exists (select 1 from play_post where play = p) then raise exception 'a post has a play_post row'; end if;
  perform pg_temp.nodrift('a post');
end $$;

-- ---- The fixture: a play of each reach, on its post, with its time ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pp-f-ann'); bob uuid := tests.account('pp-f-bob');
  a uuid := tests.character(ann, 'Pp F Ann'); b uuid := tests.character(bob, 'Pp F Bob');
  t uuid := tests.thread('Pp fixture'); pb uuid := tests.post(b, t, 'Bob''s post.');
  t2 uuid := tests.thread('Pp fixture thread'); first_post uuid := tests.post(b, t2, 'The first post.'); later uuid := tests.post(a, t2, 'A later post.', now() + interval '1 second');
  kick uuid; chr uuid; thr uuid; r play_post; act acts%rowtype; pc jsonb; gone uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'ppkick', 'ppchar', 'ppthr', 'ppperc');
  perform tests.become_service();
  kick := (play_card(bob, 'ppkick', b, pb, '{}', 0, '') ->> 'id')::uuid;
  chr := (play_card(bob, 'ppchar', b, b, '{}', 0, '', 'character', pb) ->> 'id')::uuid;
  thr := (play_card(bob, 'ppthr', b, t2, '{}', 0, '', 'thread', later) ->> 'id')::uuid;
  perform tests.unbecome();
  insert into pp_fix values ('t', t, null), ('pb', pb, null), ('t2', t2, null), ('first', first_post, null), ('kick', kick, null), ('chr', chr, null), ('thr', thr, null), ('a', a, null), ('b', b, null), ('ann', ann, null), ('bob', bob, null);

  -- A Use card on a post: the card's key, its reach, its time, in force.
  r := pg_temp.pr(kick);
  select * into act from acts x where x.id = kick;
  if r.post is distinct from pb or r.kind is distinct from 'ppkick' or r.reach is distinct from 'post' or r.played_at is distinct from act.created_at
     or r.ends_at is distinct from (act.payload ->> 'ends')::timestamptz or r.ends_at is null or r.over_at is not null or r.took is distinct from true or r.sprung is distinct from false or r.drawn is distinct from 0 then
    raise exception 'a Use card''s row is wrong: %', to_jsonb(r);
  end if;

  -- A character card's row is on the post it was played from, with its reach and the end play_reach holds.
  r := pg_temp.pr(chr);
  select * into act from acts x where x.id = chr;
  if r.post is distinct from pb or r.kind is distinct from 'ppchar' or r.reach is distinct from 'character' or r.ends_at is distinct from (select p.ends_at from play_reach p where p.play = chr) or r.ends_at is null or r.over_at is not null then
    raise exception 'a character card''s row is wrong: % (the Act targets %)', to_jsonb(r), act.target_act_id;
  end if;

  -- A thread card's row is on its thread's first post.
  r := pg_temp.pr(thr);
  select * into act from acts x where x.id = thr;
  if r.post is distinct from first_post or r.reach is distinct from 'thread' or r.kind is distinct from 'ppthr' or r.ends_at is distinct from (select p.ends_at from play_reach p where p.play = thr) or r.ends_at is null then
    raise exception 'a thread card''s row is not on the thread''s first post: % (the Act targets %, the first post is %)', to_jsonb(r), act.target_act_id, first_post;
  end if;
  perform pg_temp.nodrift('plays of each reach');

  -- Time: a play whose `ends` has passed holds its end, is not over by an event, and is out of force.
  gone := tests.act(b, 'card', t, jsonb_build_object('card', 'ppkick', 'layer', 7, 'ends', now() - interval '1 day'), pb, now() - interval '4 days');
  r := pg_temp.pr(gone);
  if r.ends_at is distinct from now() - interval '1 day' or r.over_at is not null or r.played_at is distinct from now() - interval '4 days' then raise exception 'a play whose time passed has the wrong row: %', to_jsonb(r); end if;
  perform pg_temp.nodrift('a play whose time passed');
end $$;

-- ---- A card beyond a post writes no `ends` and its play_reach row after its Act: the row's end follows the play_reach row's insert, on its own ----
select tests.unbecome();
do $$
declare
  b uuid := pg_temp.fix('b'); t uuid := pg_temp.fix('t'); p uuid := pg_temp.fix('pb');
  c uuid; r play_post; stale timestamptz;
begin
  c := tests.act(b, 'card', t, jsonb_build_object('card', 'ppchar', 'reach', 'character', 'layer', 1), p);
  stale := (pg_temp.pr(c)).ends_at;
  if stale is not null then raise exception 'a card with no end has an end before its play_reach row'; end if;
  insert into play_reach (play, reach, character, ends_at) values (c, 'character', b, now() + interval '2 days');
  r := pg_temp.pr(c);
  if r.ends_at is distinct from now() + interval '2 days' then raise exception 'the play_reach row did not give the play its end: %', to_jsonb(r); end if;
  perform pg_temp.nodrift('a play_reach row written after its Act');
end $$;

-- ---- A play over the moment it lands: caught, and instant ----
select tests.unbecome();
do $$
declare
  p uuid := pg_temp.fix('pb'); b uuid := pg_temp.fix('b'); t uuid := pg_temp.fix('t');
  c uuid; i uuid; r play_post; at timestamptz;
begin
  c := tests.act(b, 'card', t, jsonb_build_object('card', 'ppmove', 'caught', gen_random_uuid()::text), p, now() - interval '2 hours');
  r := pg_temp.pr(c);
  if r.over_at is distinct from now() - interval '2 hours' or r.over_at is distinct from r.played_at then raise exception 'a caught play is not over when it landed: %', to_jsonb(r); end if;
  i := tests.act(b, 'card', t, jsonb_build_object('card', 'ppkick', 'instant', true), p, now() - interval '1 hour');
  r := pg_temp.pr(i);
  if r.over_at is distinct from now() - interval '1 hour' or r.over_at is distinct from r.played_at then raise exception 'an instant play is not over when it landed: %', to_jsonb(r); end if;
  perform pg_temp.nodrift('a caught and an instant play');
end $$;

-- ---- An admin's end, and its raw staff cousin ----
select tests.unbecome();
do $$
declare
  boss uuid := tests.account('pp-e-admin');
  bob uuid := pg_temp.fix('bob'); b uuid := pg_temp.fix('b'); t uuid := tests.thread('Pp end'); p uuid := tests.post(b, t, 'Ended on.');
  k uuid; ended jsonb; r play_post; at timestamptz;
begin
  insert into admins (account) values (boss);
  perform tests.become_service();
  k := (play_card(bob, 'ppkick', b, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  if (pg_temp.pr(k)).over_at is not null then raise exception 'a fresh play is over'; end if;
  perform tests.become(boss);
  ended := reverse_card(k);
  perform tests.unbecome();
  at := (select e.created_at from acts e where e.kind = 'card_end' and e.target_act_id = k);
  r := pg_temp.pr(k);
  if at is null or r.over_at is distinct from at then raise exception 'an admin''s end did not make the play over at its time: %, %', to_jsonb(r), at; end if;
  perform pg_temp.nodrift('reverse_card');
  insert into pp_fix values ('ended', k, null);
end $$;

-- ---- A raw `card` Act through write_staff_act gets a row ----
select tests.unbecome();
do $$
declare
  b uuid := pg_temp.fix('b'); t uuid := tests.thread('Pp staff'); p uuid := tests.post(b, t, 'The bot plays on this.');
  written jsonb; r play_post;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Pp Bot', 'pp-bot', 'persona', now());
  perform tests.become_service();
  written := write_staff_act('pp-bot', 'card', t, p, '{"card": "ppkick"}');
  perform tests.unbecome();
  r := pg_temp.pr((written ->> 'id')::uuid);
  if r.play is null or r.post is distinct from p or r.kind is distinct from 'ppkick' or r.reach is distinct from 'post' or r.over_at is not null then raise exception 'a staff card has no row or the wrong one: %', to_jsonb(r); end if;
  perform pg_temp.nodrift('a staff card');
end $$;

-- ---- A write refunded ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pp-w-ann'); bob uuid := pg_temp.fix('bob'); b uuid := pg_temp.fix('b'); a uuid := tests.character(ann, 'Pp W Ann');
  t uuid := tests.thread('Pp write'); p uuid := tests.post(b, t, 'Written on.');
  pl uuid; played jsonb; said jsonb; r play_post; at timestamptz;
begin
  insert into wallets (account, balance) values (ann, 600);
  perform pg_temp.hand(ann, 'ppscribe');
  perform tests.become_service();
  played := play_card(ann, 'ppscribe', a, p, '{}', 50, '', tokens => 100);
  perform tests.unbecome();
  pl := (played ->> 'id')::uuid;
  r := pg_temp.pr(pl);
  if r.took is distinct from true or r.over_at is not null then raise exception 'a play that has not failed did not take: %', to_jsonb(r); end if;
  perform tests.become_service();
  said := refund_card_write(pl);
  perform tests.unbecome();
  at := (select w.at from card_write_refunds w where w.play = pl);
  r := pg_temp.pr(pl);
  if at is null or r.over_at is distinct from at or r.took is distinct from false then raise exception 'a refunded play is not over at its refund, or still took: %, %', to_jsonb(r), said; end if;
  perform pg_temp.nodrift('refund_card_write');
end $$;

-- ---- A pierce spent by its caster's next cast ----
select tests.unbecome();
do $$
declare
  bob uuid := pg_temp.fix('bob'); b uuid := pg_temp.fix('b'); t uuid := tests.thread('Pp pierce'); pb uuid := tests.post(b, t, 'Bob''s own post.');
  ann uuid := tests.account('pp-p-ann'); a uuid := tests.character(ann, 'Pp P Ann'); pa uuid := tests.post(a, t, 'Ann''s post.');
  shot uuid; moved jsonb; cast_at timestamptz; r play_post;
begin
  perform pg_temp.hand(bob, 'ppperc', 'ppmove');
  perform tests.become_service();
  shot := (play_card(bob, 'ppperc', b, b, '{}', 0, '', 'character', pb) ->> 'id')::uuid;
  perform tests.unbecome();
  if (pg_temp.pr(shot)).over_at is not null or (pg_temp.pr(shot)).reach is distinct from 'character' then raise exception 'a fresh pierce is over or has no reach: %', to_jsonb(pg_temp.pr(shot)); end if;
  perform tests.become_service();
  moved := play_card(bob, 'ppmove', b, pa, '{}', 0, '');
  perform tests.unbecome();
  if moved is null or (select x.payload #>> '{pierce,by}' from acts x where x.id = (moved ->> 'id')::uuid) is distinct from shot::text then raise exception 'the cast did not spend the pierce: %', moved; end if;
  cast_at := (select x.created_at from acts x where x.id = (moved ->> 'id')::uuid);
  r := pg_temp.pr(shot);
  if r.over_at is distinct from cast_at then raise exception 'a spent pierce is not over at the cast that spent it: %, %', to_jsonb(r), cast_at; end if;
  perform pg_temp.nodrift('a pierce spent');
end $$;

-- ---- Backs: sprung by a cast, sprung by a quote, taken back, run out ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); bob uuid := pg_temp.fix('bob'); b uuid := pg_temp.fix('b');
  t uuid := tests.thread('Pp backs');
  p1 uuid := tests.post(a, t, 'Backed once.'); p2 uuid := tests.post(a, t, 'Backed twice.'); p3 uuid := tests.post(a, t, 'Backed and taken.'); p4 uuid := tests.post(a, t, 'Backed and left.');
  reply uuid := tests.post(b, t, 'A reply that quotes.');
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; caught jsonb; sp timestamptz; r play_post; tk jsonb; said jsonb;
begin
  perform pg_temp.hand(ann, 'ppback', 'ppback', 'ppqmove', 'ppqmove');
  perform pg_temp.hand(bob, 'ppmove');
  perform tests.become_service();
  s1 := (set_card(ann, 'ppback', a, p1, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  r := pg_temp.pr(s1);
  if r.play is null or r.kind is distinct from '' or r.reach is distinct from 'post' or r.post is distinct from p1 or r.took is distinct from true or r.sprung or r.over_at is not null
     or r.ends_at is distinct from (select f.ends_at from face_down f where f.play = s1) or r.ends_at is null then
    raise exception 'a live back''s row is wrong: %', to_jsonb(r);
  end if;
  -- No column of a back's row holds its card.
  if to_jsonb(r)::text like '%ppback%' then raise exception 'a back''s row names its card: %', to_jsonb(r); end if;
  perform pg_temp.nodrift('a live back');

  -- Sprung by a cast that meets it: the back is sprung, the cast is caught.
  perform tests.become_service();
  caught := play_card(bob, 'ppmove', b, p1, '{}', 0, '');
  perform tests.unbecome();
  sp := (select x.created_at from acts x where x.kind = 'spring' and x.target_act_id = p1);
  if sp is null then raise exception 'the back did not spring: %', caught; end if;
  r := pg_temp.pr(s1);
  if r.sprung is not true or r.over_at is distinct from sp then raise exception 'a back sprung by a cast has the wrong row: %, %', to_jsonb(r), sp; end if;
  r := pg_temp.pr((caught ->> 'id')::uuid);
  if r.over_at is distinct from r.played_at then raise exception 'the caught cast is not over as it landed: %', to_jsonb(r); end if;
  perform pg_temp.nodrift('a back sprung by a cast');

  -- Sprung by a quote.
  perform tests.become_service();
  s2 := (set_card(ann, 'ppqmove', a, p2, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  said := spring_traps('quote', p2, reply);
  sp := (select x.created_at from acts x where x.kind = 'spring' and x.target_act_id = p2);
  r := pg_temp.pr(s2);
  if sp is null or r.sprung is not true or r.over_at is distinct from sp then raise exception 'a back sprung by a quote has the wrong row: %, %, %', to_jsonb(r), sp, said; end if;
  perform pg_temp.nodrift('a back sprung by a quote');

  -- Taken back: over, not sprung.
  perform tests.become_service();
  s3 := (set_card(ann, 'ppback', a, p3, '{}', 0) ->> 'id')::uuid;
  tk := take_back(ann, a, s3);
  perform tests.unbecome();
  sp := (select x.created_at from acts x where x.id = (tk ->> 'id')::uuid and x.kind = 'take_back');
  r := pg_temp.pr(s3);
  if sp is null or r.over_at is distinct from sp or r.sprung then raise exception 'a taken-back back has the wrong row: %, %', to_jsonb(r), sp; end if;
  perform pg_temp.nodrift('take_back');

  -- A back whose time passes: its end is behind it, nothing ended it.
  s4 := pg_temp.old_back(ann, a, t, p4, 'ppback', now() - interval '9 days', now() - interval '2 days');
  r := pg_temp.pr(s4);
  if r.ends_at is distinct from now() - interval '2 days' or r.over_at is not null or r.sprung or r.played_at is distinct from now() - interval '9 days' then raise exception 'a back that ran out has the wrong row: %', to_jsonb(r); end if;
  perform pg_temp.nodrift('a back whose time passed');
  insert into pp_fix values ('sprung', s1, null), ('taken', s3, null), ('ranout', s4, null);
end $$;

-- ---- A drive a second play joins: both plays' ends_at move to the new close ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); bob uuid := pg_temp.fix('bob'); b uuid := pg_temp.fix('b');
  t uuid := tests.thread('Pp drive'); p uuid := tests.post(a, t, 'A post that needs a drive.');
  first_id uuid := gen_random_uuid(); second uuid; before_end timestamptz; r1 play_post; r2 play_post;
begin
  perform pg_temp.hand(bob, 'ppdrive');
  -- The opening play, forty minutes ago: its drive closes in twenty.
  insert into acts (id, character, kind, thread, payload, target_act_id, created_at)
  values (first_id, a, 'card', t, jsonb_build_object('card', 'ppdrive', 'layer', 1, 'drive', first_id), p, now() - interval '40 minutes');
  r1 := pg_temp.pr(first_id);
  before_end := now() - interval '40 minutes' + interval '1 hour';
  if r1.ends_at is distinct from before_end or r1.over_at is not null then raise exception 'a drive play''s end is not its drive''s close: %', to_jsonb(r1); end if;
  perform pg_temp.nodrift('an opening drive play');
  perform tests.become_service();
  second := (play_card(bob, 'ppdrive', b, p, '{}', 0, 'one') ->> 'id')::uuid;
  perform tests.unbecome();
  if (select x.payload ->> 'drive' from acts x where x.id = second) is distinct from first_id::text then raise exception 'the second play did not join the drive'; end if;
  r1 := pg_temp.pr(first_id); r2 := pg_temp.pr(second);
  if r1.ends_at is distinct from now() + interval '1 hour' or r2.ends_at is distinct from now() + interval '1 hour' or r1.ends_at is not distinct from before_end then
    raise exception 'a drive''s plays did not both move to the new close: %, %', to_jsonb(r1), to_jsonb(r2);
  end if;
  perform pg_temp.nodrift('a drive a second play joined');
end $$;

-- ---- A cut: the cut play is over at the cut, and the cutting play's reversal brings it back ----
select tests.unbecome();
do $$
declare
  boss uuid := tests.account('pp-c-admin'); ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); bob uuid := pg_temp.fix('bob'); b uuid := pg_temp.fix('b');
  t uuid := tests.thread('Pp cut'); p uuid := tests.post(b, t, 'Bob''s cut post.');
  kick uuid; c jsonb; cut_id uuid; at_cut timestamptz; r play_post; end_at timestamptz;
begin
  insert into admins (account) values (boss);
  perform pg_temp.hand(ann, 'ppcut');
  perform pg_temp.hand(bob, 'ppkick');
  perform tests.become_service();
  kick := (play_card(bob, 'ppkick', b, p, '{}', 0, '') ->> 'id')::uuid;
  c := play_card(ann, 'ppcut', a, p, jsonb_build_object('play', kick), 0, '', 'post', null);
  perform tests.unbecome();
  cut_id := (c ->> 'id')::uuid;
  at_cut := (select x.created_at from acts x where x.id = cut_id);
  if (select x.payload #>> '{cut,play}' from acts x where x.id = cut_id) is distinct from kick::text then raise exception 'the cut did not name the play: %', c; end if;
  r := pg_temp.pr(kick);
  if r.over_at is distinct from at_cut or card_cut_at(kick) is distinct from at_cut then raise exception 'a cut play is not over at the cut: %, %', to_jsonb(r), at_cut; end if;
  r := pg_temp.pr(cut_id);
  if r.over_at is distinct from r.played_at then raise exception 'the cutting play is not over as it landed: %', to_jsonb(r); end if;
  perform pg_temp.nodrift('a cut');

  -- An admin's end of the cutting play brings the cut play back, with no drift.
  perform tests.become(boss);
  perform reverse_card(cut_id);
  perform tests.unbecome();
  if card_ended(kick) then raise exception 'reversing the cut did not bring the play back (card_ended)'; end if;
  r := pg_temp.pr(kick);
  if r.over_at is not null then raise exception 'reversing the cut did not bring the play back in play_post: %', to_jsonb(r); end if;
  perform pg_temp.nodrift('the cutting play reversed');
end $$;

-- ---- Up is up: the rows in force at post reach are the plays place_cast's count calls up ----
select tests.unbecome();
do $$
declare
  n bigint; victim play_post;
begin
  if (select count(*) from play_post) < 15 then raise exception 'the fixture is too small to hold the comparison'; end if;
  n := pg_temp.up_disagree();
  if n <> 0 then raise exception 'the rows in force and place_cast''s count disagree on % plays', n; end if;
  -- Red on a row edited to disagree: a play in force made over, and a play over made in force.
  select * into victim from play_post where reach = 'post' and over_at is null and kind <> '' and (ends_at is null or ends_at > now()) order by play limit 1;
  if victim.play is null then raise exception 'the fixture has no play in force'; end if;
  update play_post set over_at = played_at where play = victim.play;
  if pg_temp.up_disagree() = 0 then raise exception 'the comparison did not see a play in force made over'; end if;
  update play_post set over_at = null where play = victim.play;
  if pg_temp.up_disagree() <> 0 then raise exception 'the comparison did not return to agreement'; end if;
  select * into victim from play_post where reach = 'post' and over_at is not null and kind <> '' order by play limit 1;
  update play_post set over_at = null, ends_at = null where play = victim.play;
  if pg_temp.up_disagree() = 0 then raise exception 'the comparison did not see a play over made in force'; end if;
  update play_post set over_at = victim.over_at, ends_at = victim.ends_at where play = victim.play;
  perform pg_temp.nodrift('the comparison''s edits, undone');
end $$;

-- ---- The backfill: its statement rebuilds exactly the rows the triggers kept ----
select tests.unbecome();
do $$
declare
  kept bigint; again bigint; diff bigint;
begin
  create temp table pp_before on commit drop as select * from play_post;
  select count(*) into kept from pp_before;
  truncate play_post;
  insert into play_post select r.* from acts a cross join lateral play_row(a.id) r where a.kind in ('card', 'set') and a.target_act_id is not null;
  select count(*) into again from play_post;
  select count(*) into diff from ((select * from pp_before except select * from play_post) union all (select * from play_post except select * from pp_before)) d;
  if kept is distinct from again or diff <> 0 then raise exception 'the backfill rebuilt % rows differing in % from the % the triggers kept', again, diff, kept; end if;
  perform pg_temp.nodrift('the backfill');
end $$;

-- ---- Poison: an end written with the triggers off is named by play_post_drift(), or the check is worth nothing ----
select tests.unbecome();
do $$
declare
  b uuid := pg_temp.fix('b'); t uuid := pg_temp.fix('t'); p uuid := pg_temp.fix('pb');
  victim uuid; named text;
begin
  perform pg_temp.nodrift('before the poison');
  select r.play into victim from play_post r where r.over_at is null and r.kind = 'ppkick' and r.post = p order by r.play limit 1;
  if victim is null then raise exception 'no play in force to end'; end if;
  alter table acts disable trigger user;
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, victim, '{"why": "reversed", "by": "admin"}');
  if exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = victim) is not true then raise exception 'the poisoned end was not written'; end if;
  if (select r.over_at from play_post r where r.play = victim) is not null then raise exception 'a trigger ran with the triggers disabled'; end if;
  select d.why into named from play_post_drift() d where d.play = victim;
  if named is null then raise exception 'play_post_drift did not name a play whose end was written with the triggers off'; end if;
end $$;
