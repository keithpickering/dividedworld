-- The Roster Report (supabase/migrations/0432_roster_report.sql; docs/plans/2026-11-24-staff-board-threads-plan.md, Task 7; the design, section 5).
--
-- Each settlement with something to report gets one entry in the season's thread (seasons.turns_thread), written by the Boss. The list is built from what the public reads: roster_facts(window_end) reads acts_public,
-- characters_public and class_history, never `acts` or `reactions`; write_roster_entry writes the Boss's posts, the characters it listed (roster_seen) and the entry (roster_entries); roster_due() names the applied
-- windows of the open season with no entry yet.
--
--  0. The tables exist, are insert-only (55000 on an update, a delete and a truncate), and no API role reads or writes them; the three functions are the service role's alone; roster_facts names no `acts` or `reactions`.
--  1. Newcomers: a character is listed with its first public Act; a character that only reacted is not; one that never acted is not; a staff character is not.
--  2. A post under a live author veil is no appearance: its author is not listed while the veil holds, and is at the first window after it ends.
--  3. Turns: an announced (ahead) Turn is listed as announced in its window, with what the announcement names and no more, and as taking effect in the window of its settlement; a Turn announced naming no class
--     shows no class there; a silent Turn is listed nowhere. Reveals are the unmask Acts of the window.
--  4. write_roster_entry: the Boss posts each body in the season's thread, the newcomers are marked seen (listed once in their life), and the entry holds its record; a second call writes nothing again.
--  5. A character listed in one window is not listed in the next.
--  6. roster_due names the windows with no entry, oldest first.
--  7. No Boss, or the System off: the entry is written with no posts and its record says why; the newcomers are not marked seen.
--  8. Season News: an entry that names Turns taking effect lands one `roster` item (first 20 and a count, linked to the entry's first post); an ahead announcement lands no `announcements` item of its own.
--  9. The season's last window: due after reveal_season closes its season, reported in the closed season's thread and Season News; the closed season's older windows and earlier seasons are not due.
-- 10. The changeover (the migration's own statements, copied): a settlement and a character from before the migration are neither due nor listed as new; no function of it is left in the schema.
-- 11. A planted deadlock (40P01) in the Boss's post propagates and leaves the window due; a post past postMaxLength is a skip, not an error.
-- 12. Newcomers follow the window's activity: a character whose only Act is from before the last entry is not listed, a veil that ends in a later window lists its author there, a list stops at 25 and counts the rest
--     (and all of them are written down as seen).
-- (Poison: roster_facts reading the class_history row's class for a landed Turn, instead of what the announcement names, is red on section 3's "a landed Turn that named no class shows none".)

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;
create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
-- The characters of one list of the facts, by id.
create function pg_temp.ids(facts jsonb, which text) returns uuid[] language sql as $$
  select coalesce(array_agg((e ->> 'character')::uuid), '{}'::uuid[]) from jsonb_array_elements(facts -> which) e
$$;
create function pg_temp.item(facts jsonb, which text, who uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(facts -> which) e where (e ->> 'character')::uuid = who
$$;

-- The tables and functions exist at all, so a missing migration fails here on an assertion and not on a missing function below.
do $$
declare bad text := '';
  r record;
begin
  perform pg_temp.expect(to_regclass('roster_entries') is not null and to_regclass('roster_seen') is not null, 'roster_entries and roster_seen exist');
  perform pg_temp.expect((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('roster_facts', 'write_roster_entry', 'roster_due')) = 3, 'roster_facts, write_roster_entry and roster_due exist');
  -- No API role reads or writes the tables; the service role reaches them through the functions only.
  for r in select a.rolname, c.relname from pg_roles a cross join pg_class c
    where a.rolname in ('anon', 'authenticated', 'service_role') and c.relname in ('roster_entries', 'roster_seen') and c.relnamespace = 'public'::regnamespace
      and has_table_privilege(a.rolname, c.oid, 'select, insert, update, delete') loop
    bad := bad || E'\n  ' || r.rolname || ' reaches ' || r.relname;
  end loop;
  for r in select p.proname, a.rolname from pg_proc p cross join pg_roles a
    where p.pronamespace = 'public'::regnamespace and p.proname in ('roster_facts', 'write_roster_entry', 'roster_due') and a.rolname in ('anon', 'authenticated')
      and has_function_privilege(a.rolname, p.oid, 'execute') loop
    bad := bad || E'\n  ' || r.rolname || ' executes ' || r.proname;
  end loop;
  for r in select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('roster_facts', 'write_roster_entry', 'roster_due') and not has_function_privilege('service_role', p.oid, 'execute') loop
    bad := bad || E'\n  service_role cannot execute ' || r.proname;
  end loop;
  if bad <> '' then raise exception 'the roster is the service role''s alone:%', bad; end if;
  -- The facts are read from what the public reads: neither `acts` nor `reactions` is named in the function.
  perform pg_temp.expect((select p.prosrc !~* '(from|join)\s+(public\.)?(acts|reactions)\M' from pg_proc p where p.proname = 'roster_facts' and p.pronamespace = 'public'::regnamespace), 'roster_facts reads acts_public and characters_public, never acts or reactions');
  perform pg_temp.expect((select p.prosrc ~* 'acts_public' from pg_proc p where p.proname = 'roster_facts' and p.pronamespace = 'public'::regnamespace), 'roster_facts reads acts_public');
  -- Insert-only, guards firing always.
  perform pg_temp.expect((select count(*) from pg_trigger t where t.tgrelid in ('public.roster_entries'::regclass, 'public.roster_seen'::regclass) and t.tgname in ('roster_entries_no_update', 'roster_entries_no_delete', 'roster_entries_no_truncate', 'roster_seen_no_update', 'roster_seen_no_delete', 'roster_seen_no_truncate') and t.tgenabled = 'A') = 6, 'six guards, each firing always');
end $$;

-- ---- The fixture: a Boss, a season's thread, three windows, characters ----
create temp table rr (k text primary key, v text);
grant all on rr to public;

do $$
declare
  sid bigint;
  base timestamptz := now();
  boss_before text;
  enabled_before jsonb;
  ann uuid := tests.account('rr-ann');
  bob uuid := tests.account('rr-bob');
  t uuid := tests.thread('Roster fixture');
  n1 uuid; n2 uuid; n3 uuid; n4 uuid; n5 uuid;
  p1 uuid; p4 uuid; veil_play uuid;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Rr Boss', 'rr-boss', 'persona', now());
  select boss into boss_before from seasons where ends_at is null;
  select value into enabled_before from settings where key = 'systemEnabled';
  insert into rr values ('boss_before', coalesce(boss_before, '')), ('enabled_before', coalesce(enabled_before::text, 'null'));
  update seasons set boss = 'rr-boss' where ends_at is null;
  insert into settings (key, value) values ('systemEnabled', 'true') on conflict (key) do update set value = 'true';
  update settings set value = value || jsonb_build_object('rosterThreadTitle', 'Season {season}: Roster Report') where key = 'copy';
  select id into sid from seasons where ends_at is null;
  insert into settlements (starts_at, ends_at, season) values (base - interval '3 days', base - interval '2 days', sid), (base - interval '2 days', base - interval '1 day', sid), (base - interval '1 day', base + interval '1 minute', sid);
  insert into rr values ('w1', (base - interval '2 days')::text), ('w2', (base - interval '1 day')::text), ('w3', (base + interval '1 minute')::text), ('base', base::text), ('t', t::text), ('sid', sid::text);

  -- Newcomers: n1 posts in the first window; n2 only reacts; n3 never acts; n4's only post is under a live Whodunnit? veil; n5 posts in the second window.
  n1 := tests.character(ann, 'Rr Newcomer One', 'alpha', base - interval '60 days');
  n2 := tests.character(ann, 'Rr Only Reacts', 'alpha', base - interval '60 days');
  n3 := tests.character(ann, 'Rr Never Acts', 'alpha', base - interval '60 days');
  n4 := tests.character(bob, 'Rr Veiled', 'alpha', base - interval '60 days');
  n5 := tests.character(bob, 'Rr Newcomer Two', 'alpha', base - interval '60 days');
  p1 := tests.post(n1, t, 'First words of the first.', base - interval '2 days 12 hours');
  p4 := tests.post(n4, t, 'Who wrote this?', base - interval '2 days 11 hours');
  perform tests.post(n5, t, 'First words of the second.', base - interval '1 day 12 hours');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (p1, n2, ann, 'up', 1, base - interval '2 days 10 hours');
  -- n4's post carries a live author veil, as 0371's helper lays one.
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack, gimmick) values ('rrveil', 'Rr Whodunnit', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1, null) on conflict (key) do nothing;
  veil_play := tests.act(n5, 'card', t, jsonb_build_object('card', 'rrveil', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', base + interval '3 days'), p4, base);
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (veil_play, p4, 'author', n4, null, base + interval '3 days');
  insert into rr values ('n1', n1::text), ('n2', n2::text), ('n3', n3::text), ('n4', n4::text), ('n5', n5::text), ('p1', p1::text), ('p4', p4::text), ('veil', veil_play::text), ('ann', ann::text), ('bob', bob::text);
end $$;

-- ---- 1. Newcomers ----
do $$
declare
  f jsonb;
  n1 uuid := (select v::uuid from rr where k = 'n1');
  i jsonb;
begin
  f := roster_facts((select v::timestamptz from rr where k = 'w1'));
  perform pg_temp.expect(f ? 'newcomers' and f ? 'announced' and f ? 'landed' and f ? 'reveals', 'the facts carry the four lists: ' || f::text);
  perform pg_temp.expect(pg_temp.ids(f, 'newcomers') @> array[n1], 'a character with a public Act in the window is a newcomer');
  i := pg_temp.item(f, 'newcomers', n1);
  perform pg_temp.expect(i ->> 'name' = 'Rr Newcomer One', 'the item names the character: ' || i::text);
  perform pg_temp.expect((i ->> 'act')::uuid = (select v::uuid from rr where k = 'p1'), 'the item links its first Act: ' || i::text);
  perform pg_temp.expect((i ->> 'thread')::uuid = (select v::uuid from rr where k = 't') and (i ->> 'seq')::integer = (select a.seq from acts a where a.id = (select v::uuid from rr where k = 'p1')), 'the item carries the thread and the number: ' || i::text);
  -- A reaction is not an Act, and who reacted is private: it never makes a newcomer.
  perform pg_temp.expect(not (pg_temp.ids(f, 'newcomers') @> array[(select v::uuid from rr where k = 'n2')]), 'a character whose only activity is reactions is never listed');
  perform pg_temp.expect(not (pg_temp.ids(f, 'newcomers') @> array[(select v::uuid from rr where k = 'n3')]), 'a character that never acted is not listed');
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(f -> 'newcomers') e where (e ->> 'character')::uuid in (select id from characters where staff is not null)), 'a staff character is never listed');
  -- A post under a live author veil shows the stand-in: its author is not seen, and the stand-in is no newcomer.
  perform pg_temp.expect(not (pg_temp.ids(f, 'newcomers') @> array[(select v::uuid from rr where k = 'n4')]), 'a post under a live veil makes no newcomer of its author');
  -- The window does not bound the first appearance: the character is listed at the first report after it is seen, not only in the window of its Act.
  f := roster_facts((select v::timestamptz from rr where k = 'w2'));
  perform pg_temp.expect(pg_temp.ids(f, 'newcomers') @> array[n1, (select v::uuid from rr where k = 'n5')], 'until it is written down as seen, a character is a newcomer at each later window too');
end $$;

-- ---- 2. The veil ends: the author is listed at the first entry after ----
do $$
declare
  f jsonb;
  n4 uuid := (select v::uuid from rr where k = 'n4');
  veil uuid := (select v::uuid from rr where k = 'veil');
  t uuid := (select v::uuid from rr where k = 't');
begin
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, veil, '{"why": "reversed", "by": "admin"}');
  perform set_config('kayfabb.card_end_writer', '', true);
  f := roster_facts((select v::timestamptz from rr where k = 'w3'));
  perform pg_temp.expect(pg_temp.ids(f, 'newcomers') @> array[n4], 'once the veil is over its author is listed at the next report');
  perform pg_temp.expect((pg_temp.item(f, 'newcomers', n4) ->> 'act')::uuid = (select v::uuid from rr where k = 'p4'), 'with the post it wrote');
end $$;

-- ---- 3. Turns and reveals ----
do $$
declare
  ann uuid := tests.account('rr-cat');
  t uuid := (select v::uuid from rr where k = 't');
  w3 timestamptz := (select v::timestamptz from rr where k = 'w3');
  a uuid := tests.character(ann, 'Rr Turns Out', 'alpha', now() - interval '60 days');
  b uuid := tests.character(ann, 'Rr Turns Quietly', 'alpha', now() - interval '60 days');
  c uuid := tests.character(ann, 'Rr Turns Silent', 'alpha', now() - interval '60 days');
  d uuid := tests.character(ann, 'Rr Reveals', 'alpha', now() - interval '60 days');
  said jsonb; f jsonb; i jsonb; landings_before bigint;
  ann_a uuid; ann_b uuid;
begin
  insert into rr values ('a', a::text), ('b', b::text), ('c', c::text), ('d', d::text);
  select count(*) into landings_before from news_landed where kind = 'announcements';
  perform tests.become(ann);
  said := turn(a, 'beta', 'announced', true, true, t);
  perform turn(b, 'beta', 'announced', true, false, t);
  perform turn(c, 'beta', 'silent', false, false, null);
  perform tests.unbecome();
  ann_a := (said -> 'announcement' ->> 'id')::uuid;
  ann_b := (select id from acts where kind = 'announce' and character = b);
  insert into rr values ('ann_a', ann_a::text), ('ann_b', ann_b::text);
  -- A reveal, as unmask writes it: an Act of the character's own in the window.
  perform tests.act(d, 'unmask', t, '{"class": "alpha", "via": "act"}', null, now());

  -- An ahead announcement lands no Season News item of its own (the Roster Report's entry does that, for the Turns that take effect).
  perform pg_temp.expect((select count(*) from news_landed where kind = 'announcements') = landings_before, 'an ahead announcement makes no announcements item');

  -- Announced, in the window it was written, with what it names and no more.
  f := roster_facts(w3);
  i := pg_temp.item(f, 'announced', a);
  perform pg_temp.expect(i is not null and i ->> 'was' = 'alpha' and i ->> 'class' = 'beta' and (i ->> 'act')::uuid = ann_a and (i ->> 'thread')::uuid = t, 'an announced Turn is listed as announced, with its was and class: ' || coalesce(i::text, 'nothing'));
  i := pg_temp.item(f, 'announced', b);
  perform pg_temp.expect(i is not null and i ->> 'was' = 'alpha' and not (i ? 'class'), 'a Turn announced naming no class lists none: ' || coalesce(i::text, 'nothing'));
  -- A silent Turn is listed nowhere.
  perform pg_temp.expect(not exists (select 1 from jsonb_each(f) l, jsonb_array_elements(case when jsonb_typeof(l.value) = 'array' then l.value else '[]'::jsonb end) e where e ->> 'character' = c::text), 'a silent Turn appears nowhere');
  -- Nothing is taking effect before the settlement lands it.
  perform pg_temp.expect(not (pg_temp.ids(f, 'landed') @> array[a]), 'a Turn that has not landed is not taking effect');
  -- Reveals: the unmask Acts of the window.
  i := pg_temp.item(f, 'reveals', d);
  perform pg_temp.expect(i is not null and i ->> 'class' = 'alpha', 'an unmask of the window is a reveal: ' || coalesce(i::text, 'nothing'));

  -- The settlement lands the Turns; the announced ones are listed as taking effect, with the announcement's class where it named one and none where it did not.
  perform masks_change(w3);
  f := roster_facts(w3);
  i := pg_temp.item(f, 'landed', a);
  perform pg_temp.expect(i is not null and i ->> 'class' = 'beta' and (i ->> 'act')::uuid = ann_a, 'an announced Turn is listed as taking effect: ' || coalesce(i::text, 'nothing'));
  i := pg_temp.item(f, 'landed', b);
  perform pg_temp.expect(i is not null and not (i ? 'class') and (i ->> 'act')::uuid = ann_b, 'a landed Turn that named no class shows none: ' || coalesce(i::text, 'nothing'));
  perform pg_temp.expect(not exists (select 1 from jsonb_each(f) l, jsonb_array_elements(case when jsonb_typeof(l.value) = 'array' then l.value else '[]'::jsonb end) e where e ->> 'character' = c::text), 'a silent Turn that landed appears nowhere');
  perform pg_temp.expect(position('"beta"' in coalesce(pg_temp.item(f, 'landed', b)::text, '')) = 0, 'the class of a Turn that named none is not in its item');
end $$;

-- ---- 4. write_roster_entry ----
do $$
declare
  w1 timestamptz := (select v::timestamptz from rr where k = 'w1');
  n1 uuid := (select v::uuid from rr where k = 'n1');
  n2 uuid := (select v::uuid from rr where k = 'n2');
  sid bigint := (select v::bigint from rr where k = 'sid');
  r jsonb;
  th uuid;
  posts integer;
begin
  r := write_roster_entry(w1, array[n1], array['First body', 'Second body'], '{"commentary": "Ahem."}'::jsonb);
  perform pg_temp.expect(coalesce((r ->> 'written')::boolean, false), 'the entry is written: ' || r::text);
  th := (select turns_thread from seasons where id = sid);
  perform pg_temp.expect(th is not null, 'the season''s thread is opened');
  perform pg_temp.expect((select count(*) from acts a where a.thread = th and a.kind = 'post' and a.character = (select id from characters where staff = 'rr-boss')) = 2, 'the Boss posted each body in the season''s thread');
  perform pg_temp.expect((select array_agg(a.payload ->> 'body' order by a.seq) from acts a where a.thread = th and a.character = (select id from characters where staff = 'rr-boss')) = array['First body', 'Second body'], 'in order, as written');
  perform pg_temp.expect((select cardinality(e.acts) = 2 and e.season = sid and e.record ->> 'commentary' = 'Ahem.' from roster_entries e where e.window_end = w1), 'the entry holds its two posts, its season and its record');
  perform pg_temp.expect((select (s.act is not null and s.window_end = w1) from roster_seen s where s.character = n1), 'the newcomer is written down as seen, with its first Act');
  perform pg_temp.expect(not exists (select 1 from roster_seen s where s.character = n2), 'only the newcomers named are written down');
  -- Twice writes once.
  select count(*) into posts from acts a where a.thread = th and a.kind = 'post';
  r := write_roster_entry(w1, array[n1], array['First body', 'Second body'], '{}'::jsonb);
  perform pg_temp.expect(not coalesce((r ->> 'written')::boolean, true), 'a second call says it wrote nothing: ' || r::text);
  perform pg_temp.expect((select count(*) from acts a where a.thread = th and a.kind = 'post') = posts, 'a second call posts nothing');
  perform pg_temp.expect((select count(*) from roster_entries where window_end = w1) = 1, 'one entry for the window');
  -- Insert-only.
  perform pg_temp.expect(pg_temp.refusal('update roster_entries set season = season') like '55000%', 'an entry is never changed');
  perform pg_temp.expect(pg_temp.refusal('delete from roster_seen') like '55000%', 'what was listed is never taken back');
  -- 5. Listed once in its life.
  perform pg_temp.expect(not (pg_temp.ids(roster_facts((select v::timestamptz from rr where k = 'w2')), 'newcomers') @> array[n1]), 'a character listed in one window is not listed in the next');
  perform pg_temp.expect(pg_temp.ids(roster_facts((select v::timestamptz from rr where k = 'w2')), 'newcomers') @> array[(select v::uuid from rr where k = 'n5')], 'one not yet listed still is');
end $$;

-- ---- 6. roster_due ----
do $$
declare
  w1 timestamptz := (select v::timestamptz from rr where k = 'w1');
  w2 timestamptz := (select v::timestamptz from rr where k = 'w2');
  w3 timestamptz := (select v::timestamptz from rr where k = 'w3');
  due timestamptz[];
begin
  select coalesce(array_agg(d order by d), '{}') into due from roster_due() d where d in (w1, w2, w3);
  perform pg_temp.expect(due = array[w2, w3], 'the windows with no entry, oldest first: ' || due::text);
  perform pg_temp.expect((select array_agg(d) from roster_due() d where d in (w2, w3)) = array[w2, w3], 'roster_due answers oldest first');
end $$;

-- ---- 7. No Boss, the System off ----
do $$
declare
  w2 timestamptz := (select v::timestamptz from rr where k = 'w2');
  w5 timestamptz := (select v::timestamptz from rr where k = 'base') + interval '2 minutes';
  w6 timestamptz := (select v::timestamptz from rr where k = 'base') + interval '3 minutes';
  n5 uuid := (select v::uuid from rr where k = 'n5');
  sid bigint := (select v::bigint from rr where k = 'sid');
  th uuid := (select turns_thread from seasons where id = (select v::bigint from rr where k = 'sid'));
  posts integer;
  r jsonb;
begin
  insert into settlements (starts_at, ends_at, season) values ((select v::timestamptz from rr where k = 'w3'), w5, sid), (w5, w6, sid);
  select count(*) into posts from acts a where a.thread = th and a.kind = 'post';
  update settings set value = 'false'::jsonb where key = 'systemEnabled';
  r := write_roster_entry(w2, array[n5], array['Would be posted'], '{}'::jsonb);
  perform pg_temp.expect((r ->> 'written')::boolean and (r ->> 'posts')::integer = 0, 'the System off: an entry with no posts: ' || r::text);
  perform pg_temp.expect((select e.record ->> 'skipped' is not null and cardinality(e.acts) = 0 from roster_entries e where e.window_end = w2), 'the record says why');
  perform pg_temp.expect((select count(*) from acts a where a.thread = th and a.kind = 'post') = posts, 'nothing was posted');
  perform pg_temp.expect(not exists (select 1 from roster_seen where character = n5), 'a newcomer that was not reported is not written down as seen');
  update settings set value = 'true'::jsonb where key = 'systemEnabled';
  update seasons set boss = null where id = sid;
  r := write_roster_entry(w6, array[]::uuid[], array['Nobody to post it'], '{}'::jsonb);
  perform pg_temp.expect((r ->> 'written')::boolean and (r ->> 'posts')::integer = 0 and (select e.record ->> 'skipped' is not null from roster_entries e where e.window_end = w6), 'no Boss: an entry with no posts and the reason: ' || r::text);
  update seasons set boss = 'rr-boss' where id = sid;
end $$;

-- ---- 8. Season News: the entry that names Turns taking effect ----
do $$
declare
  w4 timestamptz := (select v::timestamptz from rr where k = 'w3');
  sid bigint := (select v::bigint from rr where k = 'sid');
  a uuid := (select v::uuid from rr where k = 'a');
  r jsonb;
  items record;
  first_post uuid;
begin
  -- The window the Turns landed in (section 3's masks_change): its facts name the two announced Turns.
  r := write_roster_entry(w4, array[]::uuid[], array['The Turns are in.', 'More of them.'], '{}'::jsonb);
  perform pg_temp.expect((r ->> 'written')::boolean and (r ->> 'posts')::integer = 2, 'written: ' || r::text);
  first_post := (select e.acts[1] from roster_entries e where e.window_end = w4);
  perform pg_temp.expect(exists (select 1 from news_landed n where n.act = first_post and n.kind = 'roster'), 'the entry lands a roster news item on its first post');
  select * into items from season_news(null, 50) x where x.kind = 'roster' and x.act = first_post;
  perform pg_temp.expect(items.act is not null, 'season_news lists it as a roster item');
  perform pg_temp.expect(items.count = 2 and jsonb_array_length(items.detail -> 'turns') = 2, 'one item listing the Turns and a count: ' || to_jsonb(items)::text);
  perform pg_temp.expect(items.thread = (select turns_thread from seasons where id = sid) and items.seq = (select seq from acts where id = first_post), 'linking to the entry''s first post');
  perform pg_temp.expect(items.season = (select number from seasons where id = sid), 'in its season');
  perform pg_temp.expect((select (e ->> 'character')::uuid from jsonb_array_elements(items.detail -> 'turns') e where e ->> 'name' = 'Rr Turns Out') = a, 'a Turn names its character');
  perform pg_temp.expect((select e ->> 'class' from jsonb_array_elements(items.detail -> 'turns') e where e ->> 'name' = 'Rr Turns Out') = 'beta', 'and the class the announcement named');
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(items.detail -> 'turns') e where e ->> 'name' = 'Rr Turns Quietly' and e ? 'class'), 'and none where it named none');
  -- An entry with nothing taking effect lands no item.
  perform pg_temp.expect((select count(*) from news_landed n where n.kind = 'roster') = 1, 'only the entry that names Turns taking effect is news');
end $$;

-- ---- 9. The season's last window: reported in the season it closed ----
-- apply_settlement records the season's last window under the closing season, and reveal_season closes that season and opens the next in the same transaction: the window is no longer the open season's, and still gets its entry,
-- in the closed season's thread, under the closed season's number. The closed season's older windows and the seasons before it are not due.
do $$
declare
  ann uuid := tests.account('rr-last');
  t uuid := (select v::uuid from rr where k = 't');
  base timestamptz := (select v::timestamptz from rr where k = 'base');
  sid bigint := (select v::bigint from rr where k = 'sid');
  w5 timestamptz := base + interval '2 minutes';
  w6 timestamptz := base + interval '3 minutes';
  w7 timestamptz := base + interval '4 minutes';
  last_ch uuid := tests.character(ann, 'Rr Turns At The End', 'alpha', now() - interval '60 days');
  old_sid bigint;
  old_end timestamptz := base + interval '4 minutes' - interval '2 months';
  revealed jsonb;
  due timestamptz[];
  r jsonb;
  th uuid;
  items record;
  first_post uuid;
begin
  -- A season before it, closed, with a window that has no entry.
  update seasons set starts_at = old_end where id = sid;
  insert into seasons (number, starts_at, ends_at) values (900, '2000-01-01', old_end) returning id into old_sid;
  insert into settlements (starts_at, ends_at, season) values (old_end - interval '1 day', old_end, old_sid);
  -- The season's last window lands an announced Turn, and the season closes at it, as apply_settlement writes both.
  perform tests.become(ann);
  perform turn(last_ch, 'beta', 'announced', true, false, t);
  perform tests.unbecome();
  insert into settlements (starts_at, ends_at, season) values (w6, w7, sid);
  perform masks_change(w7);
  update settings set value = '{"unit": "month", "count": 1}' where key = 'seasonLength';
  revealed := reveal_season(w7);
  perform pg_temp.expect(revealed is not null and (select ends_at from seasons where id = sid) = w7, 'the season closed at its last window: ' || coalesce(revealed::text, 'nothing'));
  update seasons set boss = 'rr-boss' where ends_at is null;
  insert into rr values ('w7', w7::text), ('last', last_ch::text), ('old_end', old_end::text);

  select coalesce(array_agg(d order by d), '{}') into due from roster_due() d where d in (w5, w6, w7, old_end);
  perform pg_temp.expect(w7 = any(due), 'the closed season''s last window is due: ' || due::text);
  perform pg_temp.expect(not (w5 = any(due)) and not (old_end = any(due)), 'the closed season''s older windows and the seasons before it are not due: ' || due::text);
  perform pg_temp.expect(not exists (select 1 from roster_due() d where d <= w6), 'no older window of any closed season is due');

  r := write_roster_entry(w7, array[]::uuid[], array['The season''s last Turns.'], '{}'::jsonb);
  perform pg_temp.expect((r ->> 'written')::boolean and (r ->> 'posts')::integer = 1 and r ->> 'skipped' is null, 'the last window is written: ' || r::text);
  th := (select turns_thread from seasons where id = sid);
  perform pg_temp.expect((r ->> 'thread')::uuid = th, 'in the closed season''s thread: ' || r::text);
  first_post := (select e.acts[1] from roster_entries e where e.window_end = w7);
  perform pg_temp.expect((select a.thread = th from acts a where a.id = first_post), 'the post is in the closed season''s thread');
  perform pg_temp.expect((select e.season = sid and (e.record ->> 'landedCount')::integer = 1 from roster_entries e where e.window_end = w7), 'the entry holds the Turn that took effect');
  select * into items from season_news(null, 50) x where x.kind = 'roster' and x.act = first_post;
  perform pg_temp.expect(items.act is not null and items.season = (select number from seasons where id = sid), 'Season News shows it under the closed season: ' || coalesce(to_jsonb(items)::text, 'nothing'));
  perform pg_temp.expect((select e ->> 'name' from jsonb_array_elements(items.detail -> 'turns') e) = 'Rr Turns At The End', 'naming the Turn');
  perform pg_temp.expect(not exists (select 1 from roster_due() d where d = w7), 'and it is due no more');
end $$;

-- ---- 10. The changeover: what existed before the migration is not reported ----
-- The migration ran its statements once, on the instance as it was; here an instance as it was is laid out (a window settled, a character that acted, and no entry or seen row for either) and its two statements are
-- copied and run again, as 0428's changeover test does. No function of it is left in the schema.
do $$
declare
  ann uuid := tests.account('rr-old');
  w7 timestamptz := (select v::timestamptz from rr where k = 'w7');
  pre_end timestamptz := w7 + interval '2 minutes';
  post_end timestamptz := w7 + interval '4 minutes';
  osid bigint := (select id from seasons where ends_at is null);
  oldie uuid := tests.character(ann, 'Rr Acted Before', 'alpha', now() - interval '60 days');
  silent uuid := tests.character(ann, 'Rr Silent Before', 'alpha', now() - interval '60 days');
  fresh uuid := tests.character(ann, 'Rr Acts After', 'alpha', now() - interval '60 days');
  t uuid := (select v::uuid from rr where k = 't');
  f jsonb;
begin
  perform pg_temp.expect(to_regproc('roster_changeover') is null, 'the changeover is statements of the migration: no function of it is left in the schema');
  insert into settlements (starts_at, ends_at, season) values (w7, pre_end, osid);
  perform tests.post(oldie, t, 'Before the report existed.', w7 + interval '30 seconds');
  -- The state the migration found: the old window is due, and the old character would be listed as new.
  perform pg_temp.expect(pre_end in (select d from roster_due() d), 'before the changeover the old window is due');
  perform pg_temp.expect(pg_temp.ids(roster_facts(pre_end), 'newcomers') @> array[oldie], 'before the changeover the character that acted is a newcomer');
  insert into roster_seen (character, window_end, act)
  select p.id, coalesce((select max(s.ends_at) from settlements s), now()), f.id
  from characters_public p
  cross join lateral (select a.id from acts_public a where a."character" = p.id order by a.created_at, a.id limit 1) f
  where p.staff is null
  on conflict (character) do nothing;
  insert into roster_entries (window_end, season, record)
  select s.ends_at, s.season, jsonb_build_object('skipped', 'before the Roster Report')
  from settlements s
  on conflict (window_end) do nothing;
  perform pg_temp.expect(pre_end not in (select d from roster_due() d), 'a settlement from before the migration is not due');
  perform pg_temp.expect((select e.record ->> 'skipped' = 'before the Roster Report' and cardinality(e.acts) = 0 from roster_entries e where e.window_end = pre_end), 'its entry says it was before the Roster Report');
  perform pg_temp.expect(exists (select 1 from roster_seen s where s.character = oldie and s.act is not null), 'a character with a public Act is written down as seen');
  perform pg_temp.expect(not exists (select 1 from roster_seen s where s.character = silent), 'one that never acted is not');
  -- Only what comes after is reported: a later window is due, and lists the new face and not the old one.
  insert into settlements (starts_at, ends_at, season) values (pre_end, post_end, osid);
  perform tests.post(fresh, t, 'After the report existed.', pre_end + interval '30 seconds');
  perform pg_temp.expect(post_end in (select d from roster_due() d) and pre_end not in (select d from roster_due() d), 'a window settled after the changeover is due, and the old one still is not');
  f := roster_facts(post_end);
  perform pg_temp.expect(pg_temp.ids(f, 'newcomers') @> array[fresh] and not (pg_temp.ids(f, 'newcomers') @> array[oldie]), 'the first entry lists the new face and not the character that acted before');
  -- Run twice, it changes nothing more.
  insert into roster_seen (character, window_end, act)
  select p.id, coalesce((select max(s.ends_at) from settlements s), now()), f.id
  from characters_public p
  cross join lateral (select a.id from acts_public a where a."character" = p.id order by a.created_at, a.id limit 1) f
  where p.staff is null
  on conflict (character) do nothing;
  insert into roster_entries (window_end, season, record)
  select s.ends_at, s.season, jsonb_build_object('skipped', 'before the Roster Report')
  from settlements s
  on conflict (window_end) do nothing;
  perform pg_temp.expect((select count(*) from roster_entries e where e.window_end = pre_end) = 1, 'the changeover is run twice without harm');
end $$;

-- ---- 11. Only the game's own refusals are skips ----
do $$
declare
  ann uuid := tests.account('rr-err');
  post_end timestamptz := (select v::timestamptz from rr where k = 'w7') + interval '4 minutes';
  c_end timestamptz := post_end + interval '10 hours';
  d_end timestamptz := post_end + interval '11 hours';
  osid bigint := (select id from seasons where ends_at is null);
  t uuid := (select v::uuid from rr where k = 't');
  most integer := (select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength');
  err text;
  r jsonb;
  posts bigint;
begin
  insert into settlements (starts_at, ends_at, season) values (post_end, c_end, osid), (c_end, d_end, osid);
  -- A deadlock in the post is a fact about this attempt and not about the window: it reaches the caller, nothing is written, and the window stays due.
  create function public.rr_plant() returns trigger language plpgsql as $f$ begin raise exception 'planted deadlock' using errcode = '40P01'; end $f$;
  create trigger rr_plant before insert on acts for each row when (new.kind = 'post' and new.payload ->> 'body' = 'plant 40P01') execute function public.rr_plant();
  err := pg_temp.refusal(format('select write_roster_entry(%L, %L, array[''plant 40P01''], ''{}''::jsonb)', c_end, '{}'::uuid[]));
  drop trigger rr_plant on acts;
  drop function public.rr_plant();
  perform pg_temp.expect(err like '40P01%', 'a deadlock in the post propagates: ' || coalesce(err, 'nothing was raised'));
  perform pg_temp.expect(not exists (select 1 from roster_entries e where e.window_end = c_end), 'and writes no entry');
  perform pg_temp.expect(c_end in (select x from roster_due() x), 'so the window stays due');
  -- The same window, written once the fault is gone.
  r := write_roster_entry(c_end, '{}'::uuid[], array['Back again'], '{}'::jsonb);
  perform pg_temp.expect((r ->> 'written')::boolean and (r ->> 'posts')::integer = 1 and r -> 'skipped' is null, 'it is written with its post at the next run: ' || r::text);
  -- A post past the limit is found before the insert and is a skip, with the reason on the entry, never an error.
  select count(*) into posts from acts a where a.kind = 'post' and a.thread = (select turns_thread from seasons where id = osid);
  r := write_roster_entry(d_end, '{}'::uuid[], array[repeat('x', most + 1)], '{}'::jsonb);
  perform pg_temp.expect((r ->> 'written')::boolean and (r ->> 'posts')::integer = 0 and r ->> 'skipped' like '%postMaxLength%', 'a post past postMaxLength is skipped with its reason: ' || r::text);
  perform pg_temp.expect((select count(*) from acts a where a.kind = 'post' and a.thread = (select turns_thread from seasons where id = osid)) = posts, 'and nothing is posted');
end $$;

-- ---- 12. Newcomers follow the window's activity ----
do $$
declare
  ann uuid := tests.account('rr-act');
  w7 timestamptz := (select v::timestamptz from rr where k = 'w7');
  post_end timestamptz := w7 + interval '4 minutes';
  d_end timestamptz := post_end + interval '11 hours';
  osid bigint := (select id from seasons where ends_at is null);
  t uuid := (select v::uuid from rr where k = 't');
  stale uuid := tests.character(ann, 'Rr Stale Act', 'alpha', now() - interval '60 days');
  dormant uuid := tests.character(ann, 'Rr Dormant', 'alpha', now() - interval '60 days');
  vch uuid := tests.character(ann, 'Rr Veiled Later', 'alpha', now() - interval '60 days');
  caster uuid := tests.character(ann, 'Rr Caster', 'alpha', now() - interval '60 days');
  pv uuid;
  play uuid;
  f jsonb;
  made uuid[] := '{}';
  crowd uuid[] := '{}';
  c uuid;
begin
  -- The first entries of the instance looked at everything before them (section 10's changeover wrote its windows); a character whose only Act is from before is not a candidate any more, and one that never acts never is.
  perform tests.post(stale, t, 'An old Act, never listed.', w7 + interval '10 seconds');
  -- Window A: thirty new faces and one posting under a veil (its author is no newcomer while the veil holds).
  insert into settlements (starts_at, ends_at, season) values (d_end, d_end + interval '2 hours', osid);
  for i in 0..5 loop crowd := crowd || tests.account('rr-crowd-' || i::text); end loop;
  for i in 1..30 loop
    c := tests.character(crowd[1 + (i - 1) / 5], 'Rr Crowd ' || lpad(i::text, 2, '0'), 'alpha', now() - interval '60 days');
    made := made || c;
    perform tests.post(c, t, 'Crowd words ' || i, d_end + interval '1 hour 1 minute' + i * interval '1 second');
  end loop;
  pv := tests.post(vch, t, 'Under a veil.', d_end + interval '1 hour 10 minutes');
  play := tests.act(caster, 'card', t, jsonb_build_object('card', 'rrveil', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() + interval '3 days'), pv, d_end + interval '1 hour 11 minutes');
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (play, pv, 'author', vch, null, now() + interval '3 days');
  f := roster_facts(d_end + interval '2 hours');
  perform pg_temp.expect(not (pg_temp.ids(f, 'newcomers') @> array[stale]), 'a character whose only Act is from before the last entry is not a newcomer of this window');
  perform pg_temp.expect(not (pg_temp.ids(f, 'newcomers') @> array[dormant]), 'a character that never acts is never one');
  perform pg_temp.expect(not (pg_temp.ids(f, 'newcomers') @> array[vch]), 'a post under a live veil makes no newcomer of its author');
  perform pg_temp.expect(jsonb_array_length(f -> 'newcomers') = 25, 'a list holds at most 25: ' || jsonb_array_length(f -> 'newcomers'));
  perform pg_temp.expect((f -> 'more' ->> 'newcomers')::integer = 6, 'and counts the rest (the thirty and the caster of the card, less the 25 shown): ' || (f -> 'more')::text);
  perform pg_temp.expect((f -> 'more' ->> 'announced')::integer = 0 and (f -> 'more' ->> 'landed')::integer = 0 and (f -> 'more' ->> 'reveals')::integer = 0, 'where there is no more, none is said');
  -- The entry lists 25 and writes all thirty down as seen.
  perform write_roster_entry(d_end + interval '2 hours', (select array_agg((e ->> 'character')::uuid) from jsonb_array_elements(f -> 'newcomers') e), array['Thirty-one faces'], '{}'::jsonb);
  perform pg_temp.expect((select count(*) from roster_seen s where s.character = any(made)) = 30, 'the 25 listed and those counted are all written down as seen');
  -- The veil ends in a later window: its author is listed there, with the post it wrote, though the post is older than the last entry.
  insert into settlements (starts_at, ends_at, season) values (d_end + interval '2 hours', d_end + interval '3 hours', osid);
  perform pg_temp.expect(not (pg_temp.ids(roster_facts(d_end + interval '3 hours'), 'newcomers') @> array[vch]), 'while the veil holds the author is still not listed');
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (null, 'card_end', t, play, '{"why": "reversed", "by": "admin"}', d_end + interval '2 hours 30 minutes');
  perform set_config('kayfabb.card_end_writer', '', true);
  f := roster_facts(d_end + interval '3 hours');
  perform pg_temp.expect(pg_temp.ids(f, 'newcomers') = array[vch], 'the author of a post whose veil ended in the window is listed in it, and only it: ' || f::text);
  perform pg_temp.expect((pg_temp.item(f, 'newcomers', vch) ->> 'act')::uuid = pv, 'with the post it wrote');
  perform pg_temp.expect((select p.prosrc !~* 'from\s+characters_public\s+p\s+cross join lateral' from pg_proc p where p.proname = 'roster_facts' and p.pronamespace = 'public'::regnamespace), 'roster_facts no longer probes each character');
end $$;

-- ---- Put the instance back ----
do $$
declare
  was text := (select v from rr where k = 'boss_before');
  was_enabled text := (select v from rr where k = 'enabled_before');
begin
  update seasons set boss = nullif(was, '') where ends_at is null;
  if was_enabled = 'null' then delete from settings where key = 'systemEnabled'; else update settings set value = was_enabled::jsonb where key = 'systemEnabled'; end if;
end $$;

-- ---- The season's copy word is rosterThreadTitle (Task 8): the check asks for it and refuses the old key alone; promos_thread titles the season's thread with it; the migration's
-- data step moves an instance's old key to it. The step below is 0432's own statement, run here on a copy that still has the old key: at replay the copy row is not there yet, so the step
-- is a no-op and this copy is what proves it.
do $$
declare why text; sid bigint; open_no integer; p record;
begin
  why := pg_temp.refusal($q$update settings set value = (value - 'rosterThreadTitle') || '{"announcementsThreadTitle": "Season {season}: Promos"}' where key = 'copy'$q$);
  if why is null or why not like '%rosterThreadTitle%' then raise exception 'a copy with only the old key is refused, naming the new one: %', why; end if;
  update settings set value = value || '{"announcementsThreadTitle": "Old {season}", "rosterThreadTitle": "Roster {season}"}'::jsonb where key = 'copy';
  select id, number into sid, open_no from seasons where ends_at is null;
  update seasons set turns_thread = null where id = sid;
  select * into p from promos_thread(sid);
  if (select title from threads where id = p.in_thread) is distinct from 'Roster ' || open_no::text then
    raise exception 'the season thread is titled by rosterThreadTitle: %', (select title from threads where id = p.in_thread);
  end if;
  alter table settings disable trigger settings_copy_complete;
  update settings set value = (value - 'rosterThreadTitle') || '{"announcementsThreadTitle": "Season {season}: Promos"}' where key = 'copy';
  update settings set value = (value - 'announcementsThreadTitle') || jsonb_build_object('rosterThreadTitle', value -> 'announcementsThreadTitle')
  where key = 'copy' and value ? 'announcementsThreadTitle' and not (value ? 'rosterThreadTitle');
  alter table settings enable trigger settings_copy_complete;
  if (select value ->> 'rosterThreadTitle' from settings where key = 'copy') is distinct from 'Season {season}: Promos' or (select value ? 'announcementsThreadTitle' from settings where key = 'copy') then
    raise exception 'the data step moves an instance''s old key to rosterThreadTitle: %', (select value from settings where key = 'copy');
  end if;
end $$;
