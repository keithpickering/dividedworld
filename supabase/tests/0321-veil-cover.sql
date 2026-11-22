-- The veil's cover is stored (supabase/migrations/0371_veil_cover.sql; docs/plans/2026-11-14-veil-cover-design.md, sections 5 and 6; docs/plans/2026-11-14-veil-cover-plan.md, Task 1).
-- post_veil_cover (act, play) holds one row for each Act an author veil play covers, and acts_public reads it where 0357's derivation named fourteen subqueries. This file holds the stored cover to that derivation, Act by Act:
-- pg_temp.derived_character below is 0357's second select as it stood, copied, and is the record of what the cover must equal; it lives in this test and in no view. The cards and rows are this file's own (vc...).
--
--  0. The table exists, is insert-only (55000 on an update, a delete and a truncate), is read and written by no API role, and holds only author veils' plays.
--  1. Eight cases, each made twice, once with every Act written before the veil lands and once after, while it is up: after each step acts_public and the derivation agree on every Act.
--       1 the veiled post itself; 2 its author's edit, set, take-back, use card and spring on it; 3 its author's draw and wash on a wall whose card is on it, and another character's draw on the same wall (not covered);
--       4 the card a back of the author's laid on a quote (a post_veil_cards row); 5 the author's own quote of the post, a spin from it, and another character's card on it (none covered); 6 two author veils on one post
--       at once; 7 a veil whose time has passed and a veil an admin ended, each with an Act of the author's written after (shown under the true character); 8 a totals veil alone on a post (nothing covered).
--  2. The poisons: with the trigger on acts that writes the cover off, an author's edit on a veiled post is named by the disagreement; the same with the trigger on post_veils off and a veil cast on a post that has an edit,
--     and with the trigger on post_veil_cards off. Each is rolled back, and the file raises if any comes back empty (a check that has only ever passed proves that it runs, not that it detects).
--  3. The races (first in the file, as 0304's section 13 is, so the committed rows meet none of this file's locks): a veil's landing held open, and the author's edit of the post waits for it and is covered; the edit held
--     open, and the veil waits for it and covers it; a spring's card held open, and a second veil's landing waits for it and covers it; another character's Acts on the post while a veil's landing is held open do not wait
--     (and the author's own Act under the same timeout does, so that check is shown able to fail).
--  4. The cost of an insert: a reply, a quote and a card by a character who is not the post's author read post_veils not at all; the author's own Act on the post does (so the count measures something).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- The stand-in, as seed_instance makes it (0304 has the same).
create function pg_temp.stand() returns uuid language plpgsql as $$
declare made uuid;
begin
  select c.id into made from characters c where c.staff_kind = 'anonymous';
  if made is not null then return made; end if;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning characters.id into made;
  insert into character_profiles (character, title, signature) values (made, 'Could be anyone.', '');
  return made;
end $$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack, gimmick) values
    ('vcauthor', 'Vc Whodunnit', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1, null),
    ('vctotals', 'Vc Blind', 'salty', 'uncommon', 'cast', '{post}', interval '3 days', 'totals', 1, null),
    ('vcmove', 'Vc Plain', 'sweet', 'common', 'cast', '{post}', null, null, 1, null),
    ('vcuse', 'Vc Use', 'salty', 'uncommon', 'use', '{post}', interval '7 days', null, 1, '{"kind": "ward", "cards": ["vcnothing"]}')
  on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, stack, surface) values
    ('vcwall', 'Vc Wall', 'salty', 'rare', 'cast', '{post}', 1, true)
  on conflict (key) do nothing;
end $$;

-- 0357's derivation, as it stood: the character an Act is shown under, which is the stand-in where the second select of acts_public's `ok` held, else the Act's own. The two `ok` expressions are 0357's
-- (supabase/migrations/0357_post_veils.sql, the second select of acts_public), word for word; `edit` is written as its own clause there, so it is here.
create function pg_temp.derived_character(a acts) returns uuid language plpgsql stable as $$
declare stand uuid; hidden boolean;
begin
  select k.id into stand from characters k where k.staff_kind = 'anonymous';
  hidden := a.id = any (array(select v.post from post_veils_live v where v.veil = 'author'))
    or (a.kind not in ('post', 'spin', 'edit') and a.target_act_id = any (array(select v.post from post_veils_live v where v.veil = 'author')) and exists (select 1 from post_veils_live v where v.veil = 'author' and v.post = a.target_act_id and v.author = a."character"))
    or (a.kind = 'edit' and a.target_act_id = any (array(select v.post from post_veils_live v where v.veil = 'author')) and exists (select 1 from post_veils_live v where v.veil = 'author' and v.post = a.target_act_id and v.author = a."character"))
    or (a.kind in ('draw', 'wash') and a.target_act_id = any (array(select c.id from acts c where c.kind = 'card' and c.target_act_id = any (array(select v.post from post_veils_live v where v.veil = 'author'))))
        and exists (select 1 from acts c join post_veils_live v on v.veil = 'author' and v.post = c.target_act_id and v.author = a."character" where c.id = a.target_act_id))
    or (a.kind = 'card' and a.id = any (array(select c.card from post_veil_cards c join post_veils_live v on v.veil = 'author' and v.post = c.post and v.author = c.author)));
  return case when coalesce(hidden, false) then stand else a."character" end;
end $$;

-- The ids of every Act where acts_public's character is distinct from the derivation (or acts_public has no row for it, or more than one), read as the table's owner.
create function pg_temp.disagreeing() returns uuid[] language sql stable as $$
  select coalesce(array_agg(x.id order by x.id), '{}'::uuid[]) from (
    select a.id from acts a left join acts_public p on p.id = a.id
    where p.id is null or p."character" is distinct from pg_temp.derived_character(a)
    union
    select p.id from acts_public p group by p.id having count(*) > 1
  ) x
$$;

create function pg_temp.agree(step text) returns void language plpgsql as $$
declare bad uuid[];
begin
  bad := pg_temp.disagreeing();
  if cardinality(bad) > 0 then
    raise exception 'acts_public and the derivation disagree after %: % Act(s) (kinds %), the first %', step, cardinality(bad), (select string_agg(x.kind, ',') from acts x where x.id = any (bad)), bad[1];
  end if;
end $$;

-- The cover rows an Act has (plpgsql, so the file can be read and its fixtures built before the table is looked up).
create function pg_temp.rows_of(act_id uuid) returns integer language plpgsql as $$
begin
  return (select count(*)::integer from post_veil_cover c where c.act = rows_of.act_id);
end $$;

-- A veil on a post, as land_rows writes it beside its play: the play is a card of the caster's on the post, and the row names the post's author. Its time is its `ends`.
create function pg_temp.veil(on_post uuid, in_thread uuid, author uuid, caster uuid, caster_acct uuid, ends timestamptz default now() + interval '3 days', kind text default 'author') returns uuid language plpgsql as $$
declare play uuid;
begin
  play := tests.act(caster, 'card', in_thread,
    jsonb_build_object('card', 'vcauthor', 'message', '', 'config', '{}'::jsonb, 'layer', (select count(*) + 1 from acts x where x.kind = 'card' and x.target_act_id = on_post and x.payload ->> 'card' = 'vcauthor'), 'ends', ends),
    on_post, case when ends < now() then now() - interval '4 days' else now() end);
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (play, on_post, kind, author, caster_acct, ends);
  return play;
end $$;

-- An admin's end of a veil's play, as reverse_card writes it (0092).
create function pg_temp.end_veil(play uuid, in_thread uuid) returns void language plpgsql as $$
begin
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', in_thread, play, '{"why": "reversed", "by": "admin"}');
  perform set_config('kayfabb.card_end_writer', '', true);
end $$;

-- A draw or a wash, which is written only through the surface functions (0317); the rows here are the Acts, which is all the cover reads.
create function pg_temp.surface_act(by_character uuid, what text, in_thread uuid, wall uuid) returns uuid language plpgsql as $$
declare made uuid;
begin
  perform set_config('kayfabb.surface_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (by_character, what, in_thread, wall, jsonb_build_object('strokes', '[]'::jsonb, 'cells', repeat('0', 10000))) returning id into made;
  perform set_config('kayfabb.surface_writer', '', true);
  return made;
end $$;

-- The name of the trigger on a table that runs a function (the poison turns it off by what it is, not by a name a migration might spell differently).
create function pg_temp.trigger_of(tbl regclass, fn text) returns text language sql as $$
  select t.tgname::text from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = tbl and p.proname = fn and not t.tgisinternal limit 1
$$;

-- As 0304's parked: waiting, finished or neither, for the racer whose statement carries /* tag */.
create function pg_temp.parked(tag text, conn text) returns text language plpgsql as $$
declare tries integer := 0;
begin
  loop
    -- A transaction reads one snapshot of pg_stat_activity until it is cleared, so a session that has begun to wait since the last look is not seen.
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity a where a.query like '%/* ' || tag || ' */%' and a.pid <> pg_backend_pid() and a.wait_event_type = 'Lock') then return 'waiting'; end if;
    if extensions.dblink_is_busy(conn) = 0 then return 'finished'; end if;
    tries := tries + 1;
    if tries > 400 then return 'neither'; end if;
    perform pg_sleep(0.025);
  end loop;
end $$;

-- ---- 0. The table exists, is insert-only, and no API role has anything to do with it (first, so a missing migration fails here on an assertion, and not on a missing table below) ----
select tests.unbecome();
do $$
declare r text; got text;
begin
  if to_regclass('post_veil_cover') is null then raise exception 'post_veil_cover exists'; end if;
  if to_regclass('post_veils') is null or to_regclass('acts_public') is null or to_regclass('post_veils_live') is null then raise exception 'the veil of 0357 exists'; end if;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(r, 'post_veil_cover', 'select, insert, update, delete, truncate, references, trigger') or has_any_column_privilege(r, 'post_veil_cover', 'select, insert, update, references') then
      raise exception '% has a privilege on post_veil_cover', r;
    end if;
  end loop;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'post_veil_cover'::regclass) then raise exception 'post_veil_cover has no row level security'; end if;
  if (select count(*) from pg_attribute a where a.attrelid = 'post_veil_cover'::regclass and a.attnum > 0 and not a.attisdropped and a.attname in ('act', 'play')) is distinct from 2 then raise exception 'post_veil_cover is (act, play)'; end if;
  -- Insert-only: the pair of triggers post_veils has, and they hold on a restore too (enable always).
  if (select count(*) from pg_trigger t where t.tgrelid = 'post_veil_cover'::regclass and not t.tgisinternal and t.tgenabled = 'A') is distinct from 2 then
    raise exception 'post_veil_cover has not the two append-only triggers, enabled always: %', (select jsonb_agg(jsonb_build_object('name', t.tgname, 'enabled', t.tgenabled)) from pg_trigger t where t.tgrelid = 'post_veil_cover'::regclass and not t.tgisinternal);
  end if;
end $$;

-- ---- 3. Races (first, with the rows committed): a veil's landing and its author's Act on the post are two transactions, and neither can see the other's uncommitted row ----
-- The trigger on post_veils and the trigger on acts (for the post's own character) take one advisory lock keyed on the post and read after they hold it, so the two are laid one at a time whichever arrives first. The
-- veil is landed by place_cast, as 0304's section 13 does; the edit is edit_post's, which takes no lock on the post. Another character's Act on the post never waits on that lock.
select tests.unbecome();
do $$
declare
  u uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); c uuid := gen_random_uuid(); o uuid := gen_random_uuid(); t uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid(); q4 uuid := gen_random_uuid(); k4 uuid := gen_random_uuid();
  url text := current_setting('kayfabb.scratch_url');
  seen text; got text; ctl text; vplay uuid; edit uuid; n integer;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'vc-author@test.invalid'), (%2$L, 'vc-caster@test.invalid'), (%3$L, 'vc-other@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L), (%3$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'Vc Race Author', now(), now()), (%5$L, %2$L, 'Vc Race Caster', now(), now()), (%6$L, %3$L, 'Vc Race Other', now(), now());
    insert into class_history (character, class_key, started_at) values (%4$L, 'alpha', now()), (%5$L, 'alpha', now()), (%6$L, 'alpha', now());
    insert into threads (id, board, title) select %7$L, b.id, 'Vc race' from boards b where b.slug = 'general';
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack) values ('vcrace', 'Vc Race Veil', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1);
    -- Race (c)'s other character plays a card of its own kind: plays of one kind on one post share their count's row (post_kinds, 0408), which place_cast's lock on the post already serializes; the race is about the veil's lock, not that row.
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack) values ('vcother', 'Vc Race Other Card', 'salty', 'common', 'cast', '{post}', interval '3 days', 3);
    insert into acts (id, character, kind, thread, payload) values (%8$L, %4$L, 'post', %7$L, '{"body": "A post a veil lands on first."}'), (%9$L, %4$L, 'post', %7$L, '{"body": "A post an edit lands on first."}'),
      (%10$L, %4$L, 'post', %7$L, '{"body": "A post another character acts on."}'), (%11$L, %4$L, 'post', %7$L, '{"body": "A post a back springs on while a veil lands."}');
    insert into acts (id, character, kind, thread, target_act_id, payload) values (%12$L, %6$L, 'post', %7$L, %11$L, '{"body": "A quote of it."}'),
      (%13$L, %4$L, 'card', %7$L, %12$L, '{"card": "vcrace", "message": "", "config": {}, "layer": 43}');
    -- A veil that is not refused needs the stand-in (removed again below, with the veils these races land ended first).
    insert into characters (name, staff, staff_kind, debuted_at) select 'Anonymous', 'anonymous', 'anonymous', now() where not exists (select 1 from characters k where k.staff_kind = 'anonymous');
    insert into character_profiles (character, title, signature) select k.id, 'Could be anyone.', '' from characters k where k.staff_kind = 'anonymous' and not exists (select 1 from character_profiles x where x.character = k.id);
  $sql$, u, u2, u3, a, c, o, t, p1, p2, p3, p4, q4, k4));
  perform extensions.dblink_connect('vc_h', url);
  perform extensions.dblink_connect('vc_v', url);

  -- (a) The veil's landing is held open (its trigger holds the post's lock); the author's edit of the post waits for it, and once the veil commits the edit is covered by it.
  perform extensions.dblink_exec('vc_h', 'begin');
  perform * from extensions.dblink('vc_h', format('select place_cast(%L, ''vcrace'', %L, ''{}'', '''', ''post'', null, %L, 0)', c, p1, u2)) as x(r jsonb);
  perform extensions.dblink_exec('vc_v', 'begin');
  perform * from extensions.dblink('vc_v', format('select tests.become(%L)', u)) as x(r text);
  perform extensions.dblink_send_query('vc_v', format('select /* vc_a */ edit_post(%L, %L, ''Edited while a veil is landing.'')', p1, a));
  seen := pg_temp.parked('vc_a', 'vc_v');
  perform extensions.dblink_exec('vc_h', 'commit');
  begin perform * from extensions.dblink_get_result('vc_v') as x(r jsonb); got := null; exception when others then got := sqlstate || ' ' || sqlerrm; end;
  perform * from extensions.dblink_get_result('vc_v') as x(r jsonb);
  perform extensions.dblink_exec('vc_v', 'commit');
  if seen is distinct from 'waiting' then raise exception 'the author''s edit did not wait for a veil landing on the post (it %)', seen; end if;
  if got is not null then raise exception 'the edit that waited for the veil failed: %', got; end if;
  select v.play into vplay from post_veils v where v.post = p1;
  select e.id into edit from acts e where e.kind = 'edit' and e.target_act_id = p1;
  if vplay is null or edit is null then raise exception 'race (a) landed the veil % and the edit %', vplay, edit; end if;
  if not exists (select 1 from post_veil_cover x where x.act = edit and x.play = vplay) then raise exception 'the edit that waited for the veil has no cover row'; end if;
  if not exists (select 1 from post_veil_cover x where x.act = p1 and x.play = vplay) then raise exception 'the veiled post has no cover row'; end if;
  perform pg_temp.agree('race (a), the veil first');

  -- (b) The edit is held open (its trigger holds the post's lock, having read no veil); the veil's landing waits for it, and once the edit commits the veil's trigger reads it and covers it.
  perform extensions.dblink_exec('vc_h', 'begin');
  perform * from extensions.dblink('vc_h', format('select tests.become(%L)', u)) as x(r text);
  perform * from extensions.dblink('vc_h', format('select edit_post(%L, %L, ''Edited before a veil lands.'')', p2, a)) as x(r jsonb);
  perform extensions.dblink_send_query('vc_v', format('select /* vc_b */ place_cast(%L, ''vcrace'', %L, ''{}'', '''', ''post'', null, %L, 0)', c, p2, u2));
  seen := pg_temp.parked('vc_b', 'vc_v');
  perform extensions.dblink_exec('vc_h', 'commit');
  begin perform * from extensions.dblink_get_result('vc_v') as x(r jsonb); got := null; exception when others then got := sqlstate || ' ' || sqlerrm; end;
  perform * from extensions.dblink_get_result('vc_v') as x(r jsonb);
  if seen is distinct from 'waiting' then raise exception 'a veil landing on the post did not wait for its author''s edit (it %)', seen; end if;
  if got is not null then raise exception 'the veil that waited for the edit failed: %', got; end if;
  select v.play into vplay from post_veils v where v.post = p2;
  select e.id into edit from acts e where e.kind = 'edit' and e.target_act_id = p2;
  if vplay is null or edit is null then raise exception 'race (b) landed the veil % and the edit %', vplay, edit; end if;
  if not exists (select 1 from post_veil_cover x where x.act = edit and x.play = vplay) then raise exception 'the edit the veil waited for has no cover row'; end if;
  perform pg_temp.agree('race (b), the edit first');

  -- (c) Another character's Acts on the post, while a veil's landing is held open, do not wait for it (the lock is the post's author's own and the veil's): two of them under a lock_timeout a wait would trip.
  perform extensions.dblink_exec('vc_h', 'begin');
  perform * from extensions.dblink('vc_h', format('select place_cast(%L, ''vcrace'', %L, ''{}'', '''', ''post'', null, %L, 0)', c, p3, u2)) as x(r jsonb);
  perform extensions.dblink_exec('vc_v', 'begin');
  perform extensions.dblink_exec('vc_v', 'set local lock_timeout = ''1500ms''');
  begin
    perform extensions.dblink_exec('vc_v', format($x$ insert into acts (character, kind, thread, target_act_id, payload) values
      (%1$L, 'card', %2$L, %3$L, '{"card": "vcother", "message": "", "config": {}, "layer": 41}'), (%1$L, 'card', %2$L, %3$L, '{"card": "vcother", "message": "", "config": {}, "layer": 42}') $x$, o, t, p3));
    got := null;
  exception when others then got := sqlstate || ' ' || sqlerrm; end;
  perform extensions.dblink_exec('vc_v', 'commit');
  -- The positive control: the post's own character's Act, under the same timeout while the same landing is still held, must wait for it and trip the timeout (55P03), or the check above could not have failed.
  perform extensions.dblink_exec('vc_v', 'begin');
  perform extensions.dblink_exec('vc_v', 'set local lock_timeout = ''1500ms''');
  begin
    perform extensions.dblink_exec('vc_v', format($x$ insert into acts (character, kind, thread, target_act_id, payload) values (%1$L, 'edit', %2$L, %3$L, '{"body": "The author acts while the landing is held."}') $x$, a, t, p3));
    ctl := null;
  exception when others then ctl := sqlstate || ' ' || sqlerrm; end;
  perform extensions.dblink_exec('vc_v', 'rollback');
  perform extensions.dblink_exec('vc_h', 'commit');
  if ctl is null or ctl not like '55P03%' then raise exception 'race (c) positive control: the author''s own Act under a veil landing did not trip the lock_timeout with 55P03 (%)', ctl; end if;
  if got is not null then raise exception 'another character''s Acts on a post waited for a veil landing on it: %', got; end if;
  select count(*) into n from acts x where x.target_act_id = p3 and x.character = o;
  if n is distinct from 2 then raise exception 'the two other-character Acts were not written (%)', n; end if;
  perform pg_temp.agree('race (c), another character''s Acts');

  -- (d) A spring's card on a quote is held open (its post_veil_cards row is written, its trigger holds the post's lock, having read no veil); a second author veil landing on the post waits for it, and once the card commits the veil
  -- covers it. Without the lock the landing reads the table while the row is uncommitted, and the card is left uncovered.
  perform extensions.dblink_exec('vc_h', 'begin');
  perform * from extensions.dblink('vc_h', format('insert into post_veil_cards (card, post, author) values (%L, %L, %L) returning 1', k4, p4, a)) as x(r integer);
  perform extensions.dblink_send_query('vc_v', format('select /* vc_d */ place_cast(%L, ''vcrace'', %L, ''{}'', '''', ''post'', null, %L, 0)', c, p4, u2));
  seen := pg_temp.parked('vc_d', 'vc_v');
  perform extensions.dblink_exec('vc_h', 'commit');
  begin perform * from extensions.dblink_get_result('vc_v') as x(r jsonb); got := null; exception when others then got := sqlstate || ' ' || sqlerrm; end;
  perform * from extensions.dblink_get_result('vc_v') as x(r jsonb);
  if seen is distinct from 'waiting' then raise exception 'a veil landing on the post did not wait for a spring writing its card (it %)', seen; end if;
  if got is not null then raise exception 'the veil that waited for the spring failed: %', got; end if;
  select v.play into vplay from post_veils v where v.post = p4;
  if vplay is null then raise exception 'race (d) landed no veil'; end if;
  if not exists (select 1 from post_veil_cover x where x.act = k4 and x.play = vplay) then raise exception 'the card the veil waited for has no cover row'; end if;
  perform pg_temp.agree('race (d), the spring first');

  perform extensions.dblink_disconnect('vc_h');
  perform extensions.dblink_disconnect('vc_v');
  -- The veils these races landed are ended as an admin's end writes it (0092), and the stand-in goes, so the files after this one meet a forum as it was.
  perform tests.commit($sql$
    select set_config('kayfabb.card_end_writer', 'on', true);
    insert into acts (character, kind, thread, target_act_id, payload)
    select null, 'card_end', k.thread, v.play, '{"why": "reversed", "by": "admin"}' from post_veils v join acts k on k.id = v.play where k.payload ->> 'card' = 'vcrace';
    select set_config('kayfabb.card_end_writer', '', true);
    delete from character_profiles where character in (select k.id from characters k where k.staff_kind = 'anonymous');
    delete from characters where staff_kind = 'anonymous';
  $sql$);
  perform tests.commit($sql$ delete from card_kinds where key in ('vcrace', 'vcother') $sql$);
end $$;

-- ---- 1. The eight cases, each made twice: every Act before the veil lands, and every Act after it (while it is up) ----
-- One author's posts, one veil on each (two on one), and what the author did on them. The veil is a row beside a card of the caster's, as land_rows writes it; the author's own Acts are written by the functions that write them
-- (an edit, a set, a take-back, a use card, a spring) where the function can be called, and as rows where it cannot (a draw or a wash, a card a back laid on a quote). `covered` are the Acts the cover must hold and acts_public must show under
-- the stand-in, `open` the Acts that must have no cover row and show the true character, `ended` the Acts written under a veil whose time has passed or an admin has ended, which show the true character whatever rows they have.
create function pg_temp.scene(order_ text, tag text) returns jsonb language plpgsql as $$
declare
  ann uuid := tests.account(tag || '-ann'); bob uuid := tests.account(tag || '-bob'); cy uuid := tests.account(tag || '-cy');
  a uuid := tests.character(ann, tag || ' Ann'); b uuid := tests.character(bob, tag || ' Bob'); c uuid := tests.character(cy, tag || ' Cy');
  t uuid := tests.thread(tag || ' thread'); t2 uuid := tests.thread(tag || ' spun');
  stand uuid := pg_temp.stand();
  p1 uuid := tests.post(a, t, tag || ' case 1: veiled, edited, used'); ptb uuid := tests.post(a, t, tag || ' case 2: a back taken back'); psp uuid := tests.post(a, t, tag || ' case 2: a back that springs');
  pw uuid := tests.post(a, t, tag || ' case 3: a wall'); pk uuid := tests.post(a, t, tag || ' case 4: a card on a quote'); pq uuid := tests.post(a, t, tag || ' case 5: quoted and spun');
  p6 uuid := tests.post(a, t, tag || ' case 6: two veils'); p7e uuid := tests.post(a, t, tag || ' case 7: a veil past its time'); p7a uuid := tests.post(a, t, tag || ' case 7: a veil an admin ended');
  p8 uuid := tests.post(a, t, tag || ' case 8: totals');
  v1 uuid; vtb uuid; vsp uuid; vw uuid; vk uuid; vq uuid; v6a uuid; v6b uuid; v7e uuid; v7a uuid; v8 uuid;
  e1 uuid; u1 uuid; s_tb uuid; tb uuid; s_sp uuid; spring uuid; qsp uuid; laid uuid; wall uuid; d_a uuid; w_a uuid; d_c uuid; q4 uuid; k4 uuid; qq uuid; spun uuid; card_c uuid; e6 uuid; e7e_in uuid; e7a_in uuid; e7e_late uuid; e7a_late uuid; e8 uuid;
  made jsonb; cov uuid[] := '{}'; opn uuid[] := '{}'; ended uuid[] := '{}';
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'vcmove', 'vcmove', 'vcuse');

  if order_ = 'after' then
    v1 := pg_temp.veil(p1, t, a, b, bob); vtb := pg_temp.veil(ptb, t, a, b, bob); vsp := pg_temp.veil(psp, t, a, b, bob); vw := pg_temp.veil(pw, t, a, b, bob); vk := pg_temp.veil(pk, t, a, b, bob);
    vq := pg_temp.veil(pq, t, a, b, bob); v6a := pg_temp.veil(p6, t, a, b, bob); v6b := pg_temp.veil(p6, t, a, b, bob, now() + interval '2 days');
    v7e := pg_temp.veil(p7e, t, a, b, bob, now() - interval '1 hour'); v7a := pg_temp.veil(p7a, t, a, b, bob); perform pg_temp.end_veil(v7a, t); v8 := pg_temp.veil(p8, t, a, b, bob, now() + interval '3 days', 'totals');
    perform pg_temp.agree(order_ || ': the veils landed');
  end if;

  -- Case 2, 1: the author's edit and use card on the veiled post.
  e1 := tests.act(a, 'edit', t, jsonb_build_object('body', 'Reworded.'), p1);
  perform tests.become_service();
  u1 := (play_card(ann, 'vcuse', a, p1, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  perform pg_temp.agree(order_ || ': an edit and a use card');
  -- Case 2: a set and its take-back; a set and its spring (a quote by another character springs it and the back lays a card on the quote).
  perform tests.become_service();
  s_tb := (set_card(ann, 'vcmove', a, ptb, '{}', 0) ->> 'id')::uuid;
  perform take_back(ann, a, s_tb);
  s_sp := (set_card(ann, 'vcmove', a, psp, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(cy);
  made := post(t, c, 'Quoting a post with a back.', psp);
  perform tests.unbecome();
  qsp := (made ->> 'id')::uuid;
  select x.id into tb from acts x where x.kind = 'take_back' and (x.payload ->> 'set') = s_tb::text;
  select s.id into spring from acts s where s.kind = 'spring' and (s.payload ->> 'set') = s_sp::text;
  select k.id into laid from acts k where k.kind = 'card' and (k.payload ->> 'spring') = spring::text;
  if spring is null or laid is null then raise exception 'the back did not spring a card onto the quote: % %', spring, laid; end if;
  perform pg_temp.agree(order_ || ': a set, a take-back and a spring');
  -- Case 3: a wall whose card is on the post, the author's draw and wash on it, and another character's draw on the same wall.
  wall := tests.act(b, 'card', t, jsonb_build_object('card', 'vcwall', 'message', '', 'config', '{}'::jsonb, 'layer', 1), pw);
  perform open_surface(wall);
  d_a := pg_temp.surface_act(a, 'draw', t, wall); w_a := pg_temp.surface_act(a, 'wash', t, wall); d_c := pg_temp.surface_act(c, 'draw', t, wall);
  perform pg_temp.agree(order_ || ': a wall, a draw, a wash');
  -- Case 4: the card a back of the author's laid on a quote, its post_veil_cards row beside it.
  q4 := tests.act(c, 'post', t, jsonb_build_object('body', 'Quoting a post a back sprang on.'), pk);
  k4 := tests.act(a, 'card', t, jsonb_build_object('card', 'vcmove', 'message', '', 'config', '{}'::jsonb, 'layer', 1), q4);
  insert into post_veil_cards (card, post, author) values (k4, pk, a);
  perform pg_temp.agree(order_ || ': a card on a quote');
  -- Case 5: the author's own quote of the post and a spin from it, and another character's card on it.
  qq := tests.act(a, 'post', t, jsonb_build_object('body', 'Quoting my own post.'), pq);
  spun := tests.act(a, 'spin', t2, jsonb_build_object('title', 'Spun', 'body', 'From my own post.'), pq);
  card_c := tests.act(c, 'card', t, jsonb_build_object('card', 'vcmove', 'message', '', 'config', '{}'::jsonb, 'layer', 7), pq);
  perform pg_temp.agree(order_ || ': a quote, a spin and another''s card');
  -- Cases 6, 7, 8: an edit on each (the third of case 7 after its veil is over).
  e6 := tests.act(a, 'edit', t, jsonb_build_object('body', 'Two veils.'), p6);
  e7e_in := tests.act(a, 'edit', t, jsonb_build_object('body', 'Before the time passed.'), p7e);
  e7a_in := tests.act(a, 'edit', t, jsonb_build_object('body', 'Before an admin ended it.'), p7a);
  e8 := tests.act(a, 'edit', t, jsonb_build_object('body', 'Totals only.'), p8);
  perform pg_temp.agree(order_ || ': edits on cases 6, 7 and 8');

  if order_ = 'before' then
    v1 := pg_temp.veil(p1, t, a, b, bob); vtb := pg_temp.veil(ptb, t, a, b, bob); vsp := pg_temp.veil(psp, t, a, b, bob); vw := pg_temp.veil(pw, t, a, b, bob); vk := pg_temp.veil(pk, t, a, b, bob);
    vq := pg_temp.veil(pq, t, a, b, bob); v6a := pg_temp.veil(p6, t, a, b, bob); v6b := pg_temp.veil(p6, t, a, b, bob, now() + interval '2 days');
    v7e := pg_temp.veil(p7e, t, a, b, bob, now() - interval '1 hour'); v7a := pg_temp.veil(p7a, t, a, b, bob); perform pg_temp.end_veil(v7a, t); v8 := pg_temp.veil(p8, t, a, b, bob, now() + interval '3 days', 'totals');
    perform pg_temp.agree(order_ || ': the veils landed');
  end if;

  -- Case 7: an Act of the author's after the veil's time has passed, and after an admin has ended the veil.
  e7e_late := tests.act(a, 'edit', t, jsonb_build_object('body', 'After the time passed.'), p7e);
  e7a_late := tests.act(a, 'edit', t, jsonb_build_object('body', 'After an admin ended it.'), p7a);
  perform pg_temp.agree(order_ || ': Acts after a veil is over');

  cov := array[p1, e1, u1, ptb, s_tb, tb, psp, s_sp, spring, pw, d_a, w_a, pk, k4, pq, p6, e6];
  opn := array[wall, d_c, q4, qq, spun, card_c, e8, p8, v1, vtb, vsp, vw, vk, vq, v6a, v6b, v7e, v7a, v8, qsp];
  ended := array[p7e, p7a, e7e_in, e7a_in, e7e_late, e7a_late];
  -- The back's card on the quote is the veil's only when the veil was up as the back sprang (lay_sprung writes post_veil_cards then); written first and the veil after, the Act is the author's own.
  if order_ = 'after' then cov := cov || laid; else opn := opn || laid; end if;
  return jsonb_build_object('covered', to_jsonb(cov), 'open', to_jsonb(opn), 'ended', to_jsonb(ended), 'stand', stand, 'author', a, 'p6', p6, 'e6', e6, 'p8', p8, 'e8', e8, 'p7e', p7e, 'e7e_late', e7e_late,
    'plays', to_jsonb(array[v1, vtb, vsp, vw, vk, vq, v6a, v6b, v7e, v7a, v8]), 'totals', v8);
end $$;

select tests.unbecome();
do $$
declare
  stand uuid := pg_temp.stand(); s jsonb; act_id text; ord text; n integer; shown uuid; own uuid;
begin
  foreach ord in array array['before', 'after'] loop
    perform pg_temp.agree('the fixtures, before the first scene');
    s := pg_temp.scene(ord, 'vc' || ord);
    perform tests.unbecome();
    -- The veils are on the Acts the fixtures meant them to be: the Acts that must be covered are shown under the stand-in with a cover row, the rest are the author's own and carry none, and the ended ones are the author's.
    for act_id in select jsonb_array_elements_text(s -> 'covered') loop
      if pg_temp.rows_of(act_id::uuid) < 1 then raise exception '% (covered): % has no cover row (%)', ord, (select a.kind from acts a where a.id = act_id::uuid), act_id; end if;
      if (select x."character" from acts_public x where x.id = act_id::uuid) is distinct from stand then raise exception '% (covered): % is not shown under the stand-in', ord, (select a.kind from acts a where a.id = act_id::uuid); end if;
    end loop;
    for act_id in select jsonb_array_elements_text(s -> 'open') loop
      if pg_temp.rows_of(act_id::uuid) > 0 then raise exception '% (open): % has a cover row (%)', ord, (select a.kind from acts a where a.id = act_id::uuid), act_id; end if;
      select a."character" into own from acts a where a.id = act_id::uuid;
      select x."character" into shown from acts_public x where x.id = act_id::uuid;
      if shown is distinct from own then raise exception '% (open): % is not shown under its own character', ord, (select a.kind from acts a where a.id = act_id::uuid); end if;
    end loop;
    for act_id in select jsonb_array_elements_text(s -> 'ended') loop
      if (select x."character" from acts_public x where x.id = act_id::uuid) is distinct from (select a."character" from acts a where a.id = act_id::uuid) then
        raise exception '% (ended): % is not shown under its own character', ord, (select a.kind from acts a where a.id = act_id::uuid);
      end if;
    end loop;
    -- Case 6: two author veils on one post at once, a row for each play on the post and on its edit.
    if pg_temp.rows_of((s ->> 'p6')::uuid) is distinct from 2 or pg_temp.rows_of((s ->> 'e6')::uuid) is distinct from 2 then
      raise exception '% (two veils): the post has % rows and its edit %', ord, pg_temp.rows_of((s ->> 'p6')::uuid), pg_temp.rows_of((s ->> 'e6')::uuid);
    end if;
    -- Case 8: a totals veil alone covers nothing.
    if pg_temp.rows_of((s ->> 'p8')::uuid) is distinct from 0 or pg_temp.rows_of((s ->> 'e8')::uuid) is distinct from 0 then raise exception '% (totals): a totals veil covered an Act', ord; end if;
    -- Case 7: the veil past its time and the veil an admin ended are not live, whatever rows they have.
    if (select count(*) from post_veils_live v where v.post in ((s ->> 'p7e')::uuid)) is distinct from 0 then raise exception '% (a veil past its time) is live', ord; end if;
  end loop;
  perform pg_temp.agree('both scenes');

  -- Every row is an author veil's.
  if exists (select 1 from post_veil_cover c where not exists (select 1 from post_veils v where v.play = c.play and v.veil = 'author')) then raise exception 'a cover row names a play that is not an author veil'; end if;
  if exists (select 1 from post_veil_cover c join post_veils v on v.play = c.play where v.veil = 'totals') then raise exception 'a totals veil has cover rows'; end if;
  select count(*) into n from post_veil_cover;
  if n < 30 then raise exception 'the scenes wrote only % cover rows', n; end if;

  -- Insert-only: an update, a delete and a truncate are refused, with 55000.
  if left(coalesce(pg_temp.coded('update post_veil_cover set play = play'), ''), 5) is distinct from '55000' then raise exception 'an update of post_veil_cover: %', pg_temp.coded('update post_veil_cover set play = play'); end if;
  if left(coalesce(pg_temp.coded('delete from post_veil_cover'), ''), 5) is distinct from '55000' then raise exception 'a delete from post_veil_cover: %', pg_temp.coded('delete from post_veil_cover'); end if;
  if left(coalesce(pg_temp.coded('truncate post_veil_cover'), ''), 5) is distinct from '55000' then raise exception 'a truncate of post_veil_cover: %', pg_temp.coded('truncate post_veil_cover'); end if;
  if (select count(*) from post_veil_cover) is distinct from n then raise exception 'a refused write changed post_veil_cover'; end if;
end $$;

-- ---- 2. The poisons: with a trigger that writes the cover off, the disagreement names the Act it should have covered ----
-- Each runs in a block that is rolled back, with the trigger found by the table it is on and the function it runs. The file raises if the check comes back empty: a check that has only passed proves that it runs.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vp-ann'); bob uuid := tests.account('vp-bob'); cy uuid := tests.account('vp-cy');
  a uuid := tests.character(ann, 'Vp Ann'); b uuid := tests.character(bob, 'Vp Bob'); c uuid := tests.character(cy, 'Vp Cy');
  t uuid := tests.thread('Vp poison'); stand uuid := pg_temp.stand();
  p uuid := tests.post(a, t, 'Veiled before the poison.'); p2 uuid := tests.post(a, t, 'A post with an edit already.'); p3 uuid := tests.post(a, t, 'A post a card is laid for.'); q3 uuid := tests.act(c, 'post', t, jsonb_build_object('body', 'Its quote.'), p3);
  e2 uuid := tests.act(a, 'edit', t, jsonb_build_object('body', 'Already edited.'), p2);
  v uuid; e uuid; k uuid; got uuid[]; trig text;
begin
  perform pg_temp.cards();
  v := pg_temp.veil(p, t, a, b, bob);
  perform pg_temp.veil(p3, t, a, b, bob);
  perform pg_temp.agree('the poison fixture');

  -- 1. The trigger on acts that writes the cover is off, and the author edits a post under a live veil: the edit is shown under the stand-in by the derivation and not by the cover.
  trig := pg_temp.trigger_of('acts'::regclass, 'acts_veil_cover');
  if trig is null then raise exception 'no trigger on acts runs acts_veil_cover'; end if;
  begin
    execute format('alter table acts disable trigger %I', trig);
    e := tests.act(a, 'edit', t, jsonb_build_object('body', 'Edited with the trigger off.'), p);
    got := pg_temp.disagreeing();
    raise exception 'poison 1 done' using errcode = 'P0777';
  exception when sqlstate 'P0777' then null;
  end;
  if e is null or not (e = any (got)) then raise exception 'poison 1: the disagreement did not name an author''s edit on a veiled post written with the trigger on acts off: %', got; end if;
  perform pg_temp.agree('poison 1 rolled back');

  -- 2. The trigger on post_veils is off, and a veil is cast on a post that already has an edit: the edit and the post are covered by the derivation and by no row.
  got := '{}';
  trig := pg_temp.trigger_of('post_veils'::regclass, 'post_veils_cover');
  if trig is null then raise exception 'no trigger on post_veils runs post_veils_cover'; end if;
  begin
    execute format('alter table post_veils disable trigger %I', trig);
    perform pg_temp.veil(p2, t, a, b, bob);
    got := pg_temp.disagreeing();
    raise exception 'poison 2 done' using errcode = 'P0777';
  exception when sqlstate 'P0777' then null;
  end;
  if not (e2 = any (got)) or not (p2 = any (got)) then raise exception 'poison 2: the disagreement did not name the post and its edit when a veil landed with the trigger on post_veils off: %', got; end if;
  perform pg_temp.agree('poison 2 rolled back');

  -- 3. The trigger on post_veil_cards is off, and a back's card is laid on a quote under a live veil: the card is shown under the stand-in by the derivation and by no row.
  got := '{}';
  trig := pg_temp.trigger_of('post_veil_cards'::regclass, 'post_veil_cards_cover');
  if trig is null then raise exception 'no trigger on post_veil_cards runs post_veil_cards_cover'; end if;
  begin
    execute format('alter table post_veil_cards disable trigger %I', trig);
    k := tests.act(a, 'card', t, jsonb_build_object('card', 'vcmove', 'message', '', 'config', '{}'::jsonb, 'layer', 1), q3);
    insert into post_veil_cards (card, post, author) values (k, p3, a);
    got := pg_temp.disagreeing();
    raise exception 'poison 3 done' using errcode = 'P0777';
  exception when sqlstate 'P0777' then null;
  end;
  if k is null or not (k = any (got)) then raise exception 'poison 3: the disagreement did not name a back''s card written with the trigger on post_veil_cards off: %', got; end if;
  perform pg_temp.agree('poison 3 rolled back');
end $$;

-- ---- 4. The cost of an insert: another character's Act reads post_veils not at all, and the author's own does ----
-- Counted across the inserts by the transaction's own table statistics (pg_stat_xact_user_tables, scans of either kind). The thread holds some hundreds of Acts, analyzed, so a plan that read all of them would be seen.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('vk-ann'); bob uuid := tests.account('vk-bob');
  a uuid := tests.character(ann, 'Vk Ann'); b uuid := tests.character(bob, 'Vk Bob');
  t uuid := tests.thread('Vk cost'); stand uuid := pg_temp.stand();
  p uuid := tests.post(a, t, 'A veiled post in a long thread.');
  v uuid; scans_before bigint; scans_after bigint;
  p2 uuid; q uuid; fetched_before bigint; fetched_after bigint;
begin
  insert into acts (character, kind, thread, payload) select a, 'post', t, jsonb_build_object('body', 'Filler ' || g) from generate_series(1, 400) g;
  insert into acts (character, kind, thread, payload) select b, 'post', t, jsonb_build_object('body', 'Reply ' || g) from generate_series(1, 200) g;
  v := pg_temp.veil(p, t, a, b, bob);
  analyze acts; analyze post_veils; analyze post_veil_cover;
  scans_before := (select coalesce(sum(x.seq_scan + coalesce(x.idx_scan, 0)), 0) from pg_stat_xact_user_tables x where x.relname = 'post_veils');
  perform tests.post(b, t, 'A reply by a character who is not the post''s author.');
  perform tests.act(b, 'post', t, jsonb_build_object('body', 'A quote of the veiled post.'), p);
  perform tests.act(b, 'card', t, jsonb_build_object('card', 'vcmove', 'message', '', 'config', '{}'::jsonb, 'layer', 9), p);
  scans_after := (select coalesce(sum(x.seq_scan + coalesce(x.idx_scan, 0)), 0) from pg_stat_xact_user_tables x where x.relname = 'post_veils');
  if scans_after is distinct from scans_before then raise exception 'a reply, a quote and a card by a character who is not the post''s author read post_veils % time(s)', scans_after - scans_before; end if;
  -- The author's own edit does read it (the probe of post_veils_post), so the count above measures something.
  perform tests.act(a, 'edit', t, jsonb_build_object('body', 'Edited.'), p);
  scans_after := (select coalesce(sum(x.seq_scan + coalesce(x.idx_scan, 0)), 0) from pg_stat_xact_user_tables x where x.relname = 'post_veils');
  if not (scans_after > scans_before) then raise exception 'the author''s own edit of a veiled post read post_veils not at all, so the count measures nothing'; end if;
  -- A veil landing reads the Acts on its post, never the author's other Acts: an author with three thousand Acts elsewhere (quotes of another post) has a veil land on a second post of theirs, and the rows fetched from acts
  -- stay near the post's own Acts. A scan of the author's Acts by character (the arm that cannot use acts_target or acts_edits, which are partial) fetches all of them.
  q := tests.post(b, t, 'Another post, quoted many times.');
  p2 := tests.post(a, t, 'A second veiled post.');
  insert into acts (character, kind, thread, payload, target_act_id) select a, 'post', t, jsonb_build_object('body', 'Quote ' || g), q from generate_series(1, 3000) g;
  perform tests.act(a, 'edit', t, jsonb_build_object('body', 'Edited before the veil.'), p2);
  analyze acts;
  fetched_before := (select coalesce(sum(x.idx_tup_fetch + x.seq_tup_read), 0) from pg_stat_xact_user_tables x where x.relname = 'acts');
  perform pg_temp.veil(p2, t, a, b, bob);
  fetched_after := (select coalesce(sum(x.idx_tup_fetch + x.seq_tup_read), 0) from pg_stat_xact_user_tables x where x.relname = 'acts');
  raise notice 'acts rows fetched by an author veil landing: %', fetched_after - fetched_before;
  if fetched_after - fetched_before > 100 then raise exception 'an author veil landing fetched % rows of acts, with the author holding three thousand Acts elsewhere', fetched_after - fetched_before; end if;
  perform pg_temp.agree('the cost thread');
end $$;
