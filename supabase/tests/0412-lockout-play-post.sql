-- A back that sprang into a lockout is in force while the lockout is (supabase/migrations/0412_lockout_play_post.sql; docs/plans/2026-11-22-lockout-in-force-design.md, decision 6; plan Task 4).
--   * Three backs sprang into lockouts that are ahead, the oldest the least drawn and no stand-in: post_play_ids holds all three, kind_play_ids pages none of them; with the oldest's lockout past, the pager reads it and post_play_ids drops it.
--   * An admin's reverse_card of a lockout's spring ends the back at the card_end's time: it leaves post_play_ids unless it is a stand-in.
--   * A back that sprang with no lockout is as post plays wrote it (over at its spring, its own time).
--   * post_effects_up is the same for a post with a live lockout back as without it (a face-down back still counts, as a control).
--   * play_post_drift() is empty after each; a card_end of a lockout's spring written with the triggers off is named by it (the poison).
--   * The backfill rewrites a back kept the old way and changes no other row.
-- The cards are this file's own (plk...).

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('plkback', 'Plk Back', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null)
  on conflict (key) do nothing;
end $$;

-- A back and its face_down row; `did` writes the spring a cast would (`lockedOut` with an `until`, or anything else with none).
create function pg_temp.back(ch uuid, who uuid, th uuid, post uuid, rnd integer, at timestamptz, did text default null, until_at timestamptz default null) returns uuid language plpgsql as $$
declare s uuid;
begin
  s := tests.act(ch, 'set', th, '{}', post, at);
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s, who, 'plkback', post, th, rnd, now() + interval '30 days');
  if did is not null then
    perform tests.act(ch, 'spring', th, jsonb_build_object('set', s::text, 'card', 'plkback', 'trigger', 'cast', 'did', did) || case when until_at is not null then jsonb_build_object('locks', ch::text, 'until', until_at::text) else '{}'::jsonb end, post, at + interval '1 minute');
  end if;
  return s;
end $$;

create function pg_temp.spring_of(back uuid) returns uuid language sql as $$ select s.id from acts s where s.kind = 'spring' and s.payload ->> 'set' = back::text $$;
create function pg_temp.ids_of(post uuid) returns uuid[] language sql as $$ select coalesce(array_agg(x.play order by x.play), '{}'::uuid[]) from post_play_ids(array[post]) x $$;
create function pg_temp.paged(post uuid) returns uuid[] language sql as $$ select coalesce(array_agg(x.play order by x.play), '{}'::uuid[]) from kind_play_ids(post, null, null, null, 50) x $$;
create function pg_temp.sorted(ids uuid[]) returns uuid[] language sql as $$ select coalesce(array_agg(i order by i), '{}'::uuid[]) from unnest(ids) i $$;
create function pg_temp.nodrift(label text) returns void language plpgsql as $$
begin
  if exists (select 1 from play_post_drift()) then
    raise exception 'after %, play_post drifts: %', label, (select jsonb_agg(to_jsonb(d)) from play_post_drift() d);
  end if;
end $$;
create function pg_temp.draw(play uuid, n integer) returns void language sql as $$
  insert into reaction_tallies (act, kind, count) values (play, 'up', n) on conflict (act, kind) do update set count = reaction_tallies.count + excluded.count
$$;

create temp table plk_fix (label text primary key, id uuid not null);
create function pg_temp.fix(l text) returns uuid language sql as $$ select id from plk_fix where label = l $$;

-- ---- 1. Three live lockouts on a post: all in force, none paged as ended; with the oldest's past, the pager reads it ----
-- Backs b1 (oldest, undrawn), b2 (most drawn), b3 (newest): b2 and b3 are the two stand-ins of the kind, so b1 is on the page only through its lockout.
-- Post `q` is the same with b1's lockout already past.
select tests.unbecome();
do $$
declare
  aacct uuid := tests.account('plk-1-ann'); a uuid := tests.character(aacct, 'Plk One Ann'); caster uuid := tests.character(tests.account('plk-1-caster'), 'Plk One Caster');
  t uuid := tests.thread('Plk lockouts');
  p uuid := tests.post(a, t, 'Locked.'); q uuid := tests.post(a, t, 'Past.');
  bs uuid[] := '{}'; qs uuid[] := '{}'; s uuid; i integer; k integer; r play_post; sp record;
begin
  perform pg_temp.cards();
  for k in 1..2 loop
    for i in 1..3 loop
      s := pg_temp.back(a, aacct, t, case when k = 1 then p else q end, i, now() - (10 - i) * interval '1 hour', 'lockedOut',
                        case when k = 2 and i = 1 then now() - interval '1 minute' else now() + i * interval '1 hour' end);
      if k = 1 then bs := bs || s; else qs := qs || s; end if;
    end loop;
  end loop;
  perform pg_temp.draw(bs[2], 5); perform pg_temp.draw(qs[2], 5);
  -- The row: ends_at is the spring's until, over_at is null, sprung stays true, the kind is '' (a back names no card).
  for i in 1..3 loop
    r := (select x from play_post x where x.play = bs[i]);
    if r.over_at is not null then raise exception '1 back % sprung into a lockout is over at %', i, r.over_at; end if;
    if r.ends_at is distinct from (select (x.payload ->> 'until')::timestamptz from acts x where x.id = pg_temp.spring_of(bs[i])) then raise exception '1 back % ends_at is not the spring''s until: %', i, to_jsonb(r); end if;
    if not r.sprung or r.kind <> '' then raise exception '1 back % is not a sprung back of kind empty: %', i, to_jsonb(r); end if;
  end loop;
  if pg_temp.ids_of(p) is distinct from pg_temp.sorted(bs) then raise exception '1 post_play_ids holds % and should hold the three live lockout backs %', pg_temp.ids_of(p), pg_temp.sorted(bs); end if;
  if pg_temp.paged(p) <> '{}'::uuid[] then raise exception '1 kind_play_ids pages a live lockout as ended: %', pg_temp.paged(p); end if;
  -- The lockout of q's oldest is past: it is out of force, the pager reads it, and post_play_ids drops it (it is no stand-in).
  if pg_temp.paged(q) is distinct from array[qs[1]] then raise exception '1 the pager should read the back whose lockout ran out (%), it reads %', qs[1], pg_temp.paged(q); end if;
  if pg_temp.ids_of(q) is distinct from pg_temp.sorted(array[qs[2], qs[3]]) then raise exception '1 post_play_ids after the oldest lockout ran out holds % and should hold %', pg_temp.ids_of(q), pg_temp.sorted(array[qs[2], qs[3]]); end if;
  perform pg_temp.nodrift('three lockouts');
  insert into plk_fix values ('t', t), ('a', a), ('aacct', aacct), ('p', p), ('q', q), ('b1', bs[1]), ('b2', bs[2]), ('b3', bs[3]);
end $$;

-- ---- 2. An admin's reverse_card of a lockout's spring ends the back at the card_end's time ----
select tests.unbecome();
do $$
declare
  aacct uuid := pg_temp.fix('aacct'); p uuid := pg_temp.fix('p');
  b1 uuid := pg_temp.fix('b1'); b2 uuid := pg_temp.fix('b2'); b3 uuid := pg_temp.fix('b3');
  at timestamptz; r play_post; sp1 uuid := pg_temp.spring_of(pg_temp.fix('b1')); sp3 uuid := pg_temp.spring_of(pg_temp.fix('b3'));
begin
  insert into admins (account) values (aacct);
  -- b1 is no stand-in: ending its lockout takes it off the page, and the pager now reads it.
  perform tests.become(aacct);
  perform reverse_card(sp1);
  perform tests.unbecome();
  at := (select e.created_at from acts e where e.kind = 'card_end' and e.target_act_id = pg_temp.spring_of(b1));
  r := (select x from play_post x where x.play = b1);
  if at is null or r.over_at is distinct from at then raise exception '2 the ended lockout back is not over at the card_end''s time: %, %', to_jsonb(r), at; end if;
  if not r.sprung then raise exception '2 an ended lockout back lost sprung'; end if;
  if b1 = any (pg_temp.ids_of(p)) then raise exception '2 post_play_ids still holds a back whose lockout an admin ended: %', pg_temp.ids_of(p); end if;
  if pg_temp.paged(p) is distinct from array[b1] then raise exception '2 the pager should read the ended back: %', pg_temp.paged(p); end if;
  if pg_temp.ids_of(p) is distinct from pg_temp.sorted(array[b2, b3]) then raise exception '2 post_play_ids holds % and should hold the two other lockouts %', pg_temp.ids_of(p), pg_temp.sorted(array[b2, b3]); end if;
  perform pg_temp.nodrift('reverse_card of a lockout spring');
  -- A stand-in stays on the page when its lockout is ended: b3 is the newest sprung back.
  perform tests.become(aacct);
  perform reverse_card(sp3);
  perform tests.unbecome();
  if (select x.over_at from play_post x where x.play = b3) is null then raise exception '2 b3 is not over after its lockout was ended'; end if;
  if not (b3 = any (pg_temp.ids_of(p))) then raise exception '2 the newest sprung back is a stand-in and should stay on the page: %', pg_temp.ids_of(p); end if;
  perform pg_temp.nodrift('reverse_card of a stand-in lockout spring');
end $$;

-- ---- 3. A spring that is not a lockout: the row is as post plays wrote it ----
select tests.unbecome();
do $$
declare
  aacct uuid := pg_temp.fix('aacct'); a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t');
  p3 uuid := tests.post(a, t, 'No lockout.'); s uuid; r play_post; sp timestamptz;
begin
  s := pg_temp.back(a, aacct, t, p3, 1, now() - interval '3 hours', 'returned');
  sp := (select x.created_at from acts x where x.id = pg_temp.spring_of(s));
  r := (select x from play_post x where x.play = s);
  if r.over_at is distinct from sp or r.ends_at is distinct from (select f.ends_at from face_down f where f.play = s) or not r.sprung or r.lock_until is not null then
    raise exception '3 a back that sprang with no lockout has the wrong row: %', to_jsonb(r);
  end if;
  perform pg_temp.nodrift('a spring that is no lockout');
end $$;

-- ---- 4. post_effects_up is the same with a live lockout back as without it ----
select tests.unbecome();
do $$
declare
  aacct uuid := pg_temp.fix('aacct'); a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t');
  clean uuid := tests.post(a, t, 'No backs.'); locked uuid := tests.post(a, t, 'A live lockout back.'); face uuid := tests.post(a, t, 'A back still face down.');
  s uuid;
begin
  s := pg_temp.back(a, aacct, t, locked, 1, now() - interval '1 hour', 'lockedOut', now() + interval '1 day');
  if (select x.over_at from play_post x where x.play = s) is not null or (select x.ends_at from play_post x where x.play = s) <= now() then raise exception '4 the lockout back is not in force'; end if;
  if post_effects_up(locked) is distinct from post_effects_up(clean) or post_effects_up(locked) <> 0 then
    raise exception '4 a live lockout back counts toward the limit on effects: %, without it %', post_effects_up(locked), post_effects_up(clean);
  end if;
  -- The control: a back still face down holds a slot.
  s := pg_temp.back(a, aacct, t, face, 1, now() - interval '1 hour');
  if post_effects_up(face) <> 1 then raise exception '4 a face-down back should hold a slot: %', post_effects_up(face); end if;
  perform pg_temp.nodrift('post_effects_up');
end $$;

-- ---- 5. The backfill rewrites a back kept the old way and changes no other row ----
-- The old play_row kept a lockout back over at its spring with its own time; write that row by hand, see the drift check name it, run the migration's backfill statement, and see the rows as they were.
select tests.unbecome();
do $$
declare
  b1 uuid := pg_temp.fix('b1'); b2 uuid := pg_temp.fix('b2'); before jsonb; after jsonb; named text;
begin
  select jsonb_agg(to_jsonb(x) order by x.play) into before from play_post x;
  update play_post set over_at = (select s.created_at from acts s where s.id = pg_temp.spring_of(b2)), ends_at = (select f.ends_at from face_down f where f.play = b2) where play = b2;
  select string_agg(d.why, '; ') into named from play_post_drift() d where d.play = b2;
  if named is null then raise exception '5 the drift check does not name a lockout back kept the old way'; end if;
  perform refresh_play_post(b.id) from (select distinct (s.payload ->> 'set')::uuid as id from acts s where s.kind = 'spring' and s.payload ->> 'did' = 'lockedOut') b where exists (select 1 from acts x where x.id = b.id);
  select jsonb_agg(to_jsonb(x) order by x.play) into after from play_post x;
  if after is distinct from before then raise exception '5 the backfill did not restore the rows: % vs %', after, before; end if;
  perform pg_temp.nodrift('the backfill');
  -- Idempotent.
  perform refresh_play_post(b1);
  if (select jsonb_agg(to_jsonb(x) order by x.play) from play_post x) is distinct from before then raise exception '5 a second refresh changed a row'; end if;
end $$;

-- ---- Poison: a card_end of a lockout's spring written with the triggers off is named by play_post_drift(), or the check is worth nothing ----
select tests.unbecome();
do $$
declare
  b2 uuid := pg_temp.fix('b2'); t uuid := pg_temp.fix('t'); named text;
begin
  perform pg_temp.nodrift('before the poison');
  if (select x.over_at from play_post x where x.play = b2) is not null then raise exception 'the poison back is already over'; end if;
  alter table acts disable trigger user;
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, pg_temp.spring_of(b2), '{"why": "reversed", "by": "admin"}');
  if (select x.over_at from play_post x where x.play = b2) is not null then raise exception 'a trigger ran with the triggers disabled'; end if;
  select d.why into named from play_post_drift() d where d.play = b2;
  alter table acts enable trigger user;
  if named is null then raise exception 'play_post_drift did not name a lockout back whose spring was ended with the triggers off'; end if;
end $$;
