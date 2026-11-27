-- Surfaces count each tag's own paint (supabase/migrations/0456_surface_coats.sql; docs/plans/2026-11-27-graffiti-everywhere-plan.md, Task 4): each live draw has a grid of its own in tenths of a coat, a wall's `covered` is the sum
-- of its live draws' painted cells (2 tenths or more), and a wash takes tenths off the draws it names. The card is this file's own (`cwwall`, with the surface flag); every name is prefixed cw.
--
--  1. the coat functions: a coat string decodes, refuses what is not 10,000 characters of the alphabet; a take leaves 1 or less clean
--  2. a draw's row decodes its coats and `covered` is its painted count; the answer and the Lens carry no grid
--  3. a second draw over the same cells adds its own count (overlap paid); a draw that would pass the limit is refused with the figures and writes nothing; a wash is never refused
--  4. two washes of one pass each over a 2-coat draw leave it see-through and then clean; it leaves `live` and surface_coats, its washes with it, and surface_cuts holds the cells each wash cleared
--  5. a wash that names a draw not live leaves it out, one that changes nothing is not kept, a wash that names a draw twice is refused; a wash stays live while one draw it changed does
--  6. the 48-draw bound counts surface_coats rows
--  7. a legacy wall (cells, no coats) is laid at 20 tenths, its washes take every coat of the older draws, and rebuild_surface gives the stored row after the migration's rebuild; the poison for this guard is a legacy rule at 10
--  8. edit_post with places writes them against the edit's id, surface_acts gives the current version's places, surface_groups_on and surface_version_pair
--  9. every redefined reader still answers `covered`: card_target, thread_page, surface_acts, digest_plays, extras_ids
-- 10. the payload check, the writers' signatures (no stale overload), the grants, the log's marks

select tests.unbecome();

insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, stack, surface)
values ('cwwall', 'Cw Wall', 'pepperoni', 'rare', 'cast', null, '{post}', 1, true);

-- Run a statement as an account (null: the service role); its first column as text, or 'ERROR: ' and the refusal.
create function pg_temp.as_val(who uuid, stmt text) returns text language plpgsql as $$
declare
  r text;
begin
  if who is null then perform tests.become_service(); else perform tests.become(who); end if;
  begin
    execute stmt into r;
  exception when others then
    r := 'ERROR: ' || sqlerrm;
  end;
  perform tests.unbecome();
  return r;
end $$;

-- A coat string: `n` cells of the character `ch` from cell `first`, the rest clean. `k` is 20 tenths (2 coats), `a` is 10 (one coat), `E` is 40.
create function pg_temp.coats(first integer, n integer, ch text default 'k') returns text language sql as $$
  select repeat('0', first) || repeat(ch, n) || repeat('0', 10000 - first - n)
$$;
-- The cells string of a legacy draw or wash: `n` ones from cell `first`.
create function pg_temp.cells(first integer, n integer) returns text language sql as $$
  select repeat('0', first) || repeat('1', n) || repeat('0', 10000 - first - n)
$$;
-- A wall as place_cast leaves one: a post by `author`, a play of the wall card on it, and its open surface.
create function pg_temp.wall(author uuid, in_thread uuid, out post uuid, out play uuid) language plpgsql as $$
begin
  post := tests.post(author, in_thread, 'A wall of words.');
  play := tests.act(author, 'card', in_thread, jsonb_build_object('card', 'cwwall', 'message', '', 'config', '{}'::jsonb, 'layer', 1), post);
  perform open_surface(play);
end $$;
create function pg_temp.draw(who uuid, through uuid, play uuid, coats text, most integer default 4000, places jsonb default '[]') returns text language sql as $$
  select pg_temp.as_val(null, format('select draw_on_surface(%L, %L, %L, %L, %L, %L, %s)::text', who, through, play, '{"box": {"w": 60, "h": 40}, "groups": [{}, {}, {}]}'::jsonb, coats, places, most))
$$;
-- A wash by the service role: takes is [{draw, takes}].
create function pg_temp.wash(who uuid, through uuid, play uuid, takes jsonb) returns text language sql as $$
  select pg_temp.as_val(null, format('select wash_surface(%L, %L, %L, %L, %L)::text', who, through, play, '{"cuts": []}'::jsonb, takes))
$$;
create function pg_temp.take(draw uuid, takes text) returns jsonb language sql as $$ select jsonb_build_object('draw', draw, 'takes', takes) $$;
create function pg_temp.covered(play uuid) returns integer language sql as $$ select covered from surfaces where surfaces.play = covered.play $$;
create function pg_temp.live(play uuid) returns integer language sql as $$ select cardinality(live) from surfaces where surfaces.play = live.play $$;
-- A draw or a wash of the old shape, as 0317 wrote them: written straight to the Acts, for the walls the migration rebuilds.
create function pg_temp.legacy(by_character uuid, what text, in_thread uuid, wall uuid, cells text) returns uuid language plpgsql as $$
declare
  written uuid;
begin
  perform set_config('kayfabb.surface_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (by_character, what, in_thread, wall, jsonb_build_object('strokes', '[]'::jsonb, 'cells', cells) || case when what = 'wash' then jsonb_build_object('uncovered', 0, 'cut', '[]'::jsonb) else '{}'::jsonb end, clock_timestamp())
  returning id into written;
  perform set_config('kayfabb.surface_writer', '', true);
  return written;
end $$;

-- ---- 1. The coat functions ----
do $$
declare
  c smallint[]; t smallint[];
begin
  c := coat_cells(repeat('0', 9990) || '019kzAE000');
  if cardinality(c) is distinct from 10000 or c[9991] is distinct from 0 or c[9992] is distinct from 1 or c[9993] is distinct from 9 or c[9994] is distinct from 20 or c[9995] is distinct from 35 or c[9996] is distinct from 36 or c[9997] is distinct from 40 then raise exception 'a coat string decodes by the index of its characters: %', c[9991:9997]; end if;
  if surface_painted(c) is distinct from 5 then raise exception 'painted counts 2 tenths and more, not 1: %', surface_painted(c); end if;
  -- (The helpers are no API role's, the service role's included: they are called here as the file's own role.)
  begin perform coat_cells(repeat('0', 9999)); raise exception 'a short string was allowed';
  exception when sqlstate '22023' then if sqlerrm is distinct from 'a coat string is 10,000 characters of the coat alphabet' then raise exception 'a short string is refused in the coat string''s words: %', sqlerrm; end if; end;
  begin perform coat_cells(repeat('0', 9999) || 'F'); raise exception 'a character outside the alphabet was allowed';
  exception when sqlstate '22023' then null; end;
  -- A take: 20 - 10 leaves 10 (painted); 20 - 19 leaves 1, which is clean and kept at 0; more than it holds floors at 0; 5 - 5 is clean.
  c := array_fill(0::smallint, array[10000]); c[1] := 20; c[2] := 20; c[3] := 20; c[4] := 5; c[5] := 3;
  t := array_fill(0::smallint, array[10000]); t[1] := 10; t[2] := 19; t[3] := 40; t[4] := 5; t[5] := 1;
  t := surface_take(c, t);
  if t[1] is distinct from 10 or t[2] is distinct from 0 or t[3] is distinct from 0 or t[4] is distinct from 0 or t[5] is distinct from 2 or surface_painted(t) is distinct from 2 then raise exception 'a take leaves 1 or less clean: %', t[1:5]; end if;
  if surface_legacy_coats(pg_temp.cells(3, 2)) is distinct from (select array_agg((case when i in (4, 5) then 20 else 0 end)::smallint order by i) from generate_series(1, 10000) i) then raise exception 'a legacy cell is laid at 20 tenths'; end if;
end $$;

-- ---- 2. A draw's row decodes its coats and covered is its painted count ----
do $$
declare
  ann uuid := tests.account('cw-2-ann'); bob uuid := tests.account('cw-2-bob');
  a uuid := tests.character(ann, 'Cw Two Ann'); b uuid := tests.character(bob, 'Cw Two Bob');
  t uuid := tests.thread('Cw two'); w record := pg_temp.wall(a, t);
  got text; d1 uuid; row_ surface_coats%rowtype; listed jsonb;
begin
  -- 300 cells at 2 coats and 100 cells at 1 tenth (clean at once: a tenth is not paint).
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(0, 300) );
  if got like 'ERROR:%' then raise exception 'the first draw was refused: %', got; end if;
  d1 := (got::jsonb ->> 'id')::uuid;
  if (got::jsonb ->> 'covered')::integer is distinct from 300 or got::jsonb -> 'live' is distinct from to_jsonb(array[d1]) or got::jsonb ->> 'kind' is distinct from 'draw' then raise exception 'a draw answers with its Act, covered and live: %', got; end if;
  if got like '%"coats"%' or got like '%"cells"%' then raise exception 'the answer carries no grid: %', left(got, 200); end if;
  select * into row_ from surface_coats where play = w.play and draw = d1;
  if row_.painted is distinct from 300 or cardinality(row_.coats) is distinct from 10000 or row_.coats[1] is distinct from 20 or row_.coats[300] is distinct from 20 or row_.coats[301] is distinct from 0 then raise exception 'the row decodes the draw''s coats: %', row_.painted; end if;
  if pg_temp.covered(w.play) is distinct from 300 then raise exception 'covered is its painted count: %', pg_temp.covered(w.play); end if;
  if (select payload ->> 'coats' from acts where id = d1) is distinct from pg_temp.coats(0, 300) then raise exception 'the Act keeps its coat string'; end if;
  if (select cells from surface_marks where act = d1) is distinct from 300 then raise exception 'the log''s mark says the painted cells'; end if;
  -- A draw of 1-tenth cells paints nothing: it is written, never live, and costs the wall nothing.
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(1000, 100, '1'));
  if got like 'ERROR:%' or pg_temp.covered(w.play) is distinct from 300 or pg_temp.live(w.play) is distinct from 1 or not exists (select 1 from acts where id = (got::jsonb ->> 'id')::uuid and kind = 'draw') then raise exception 'a draw that paints nothing is written and not live: %', got; end if;
  -- The Lens: no grid, a share for the draw, and its places.
  perform tests.become(bob);
  listed := surface_acts(w.play);
  perform tests.unbecome();
  if listed::text like '%"coats"%' or listed::text like '%"cells"%' then raise exception 'surface_acts carries no grid: %', left(listed::text, 200); end if;
  if (listed -> 'acts' -> 0 ->> 'share')::integer is distinct from 300 or listed -> 'acts' -> 0 -> 'places' is distinct from '[]'::jsonb or (listed ->> 'covered')::integer is distinct from 300 then raise exception 'the Lens gives the share, the places and covered: %', listed; end if;
end $$;

-- ---- 3. Overlap is paid, the limit refuses with the figures, a wash is never refused ----
do $$
declare
  ann uuid := tests.account('cw-3-ann'); bob uuid := tests.account('cw-3-bob');
  a uuid := tests.character(ann, 'Cw Three Ann'); b uuid := tests.character(bob, 'Cw Three Bob');
  t uuid := tests.thread('Cw three'); w record := pg_temp.wall(a, t);
  got text; d1 uuid; before_acts integer;
begin
  d1 := (pg_temp.draw(bob, b, w.play, pg_temp.coats(0, 3100))::jsonb ->> 'id')::uuid;
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(0, 100));
  if (got::jsonb ->> 'covered')::integer is distinct from 3200 then raise exception 'a draw over the same cells adds its own count: %', got; end if;
  -- Past the limit: 3,200 + 1,500 is 47%; the figures are the wall's own.
  before_acts := (select count(*) from acts where target_act_id = w.play and kind = 'draw');
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(3100, 1500));
  if got is distinct from 'ERROR: this wall is 32% covered, and its limit is 40%; this tag would take it to 47%' then raise exception 'the refusal carries the wall''s figures: %', got; end if;
  if (select count(*) from acts where target_act_id = w.play and kind = 'draw') is distinct from before_acts or pg_temp.covered(w.play) is distinct from 3200 or (select count(*) from surface_coats where play = w.play) is distinct from 2 then raise exception 'a refused draw writes nothing'; end if;
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(3100, 800));
  if (got::jsonb ->> 'covered')::integer is distinct from 4000 then raise exception 'a draw to the limit lands: %', got; end if;
  -- A limit that is not a whole percent reads rounded down, and the figure after is above it.
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(5000, 61), 4060);
  if got is distinct from 'ERROR: this wall is 40% covered, and its limit is 40%; this tag would take it to 41%' then raise exception 'a limit of 4,060 reads 40%%, and 4,061 reads 41%%: %', got; end if;
  -- A wash on a full wall lands.
  got := pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(d1, pg_temp.coats(0, 200, 'E'))));
  if got like 'ERROR:%' or (got::jsonb ->> 'covered')::integer is distinct from 3800 or pg_temp.covered(w.play) is distinct from 3800 then raise exception 'a wash is never refused for the limit: %', got; end if;
  -- And the limit is the argument's: with the wall at 3,800 a 200-cell tag fits under 4,000 and 201 does not.
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(6000, 201));
  if got is distinct from 'ERROR: this wall is 38% covered, and its limit is 40%; this tag would take it to 40%' and got not like 'ERROR: this wall is 38% covered%' then raise exception 'the wash freed 200 cells: %', got; end if;
end $$;

-- ---- 4. Two washes of one pass each: see-through, then clean; the draw leaves live and surface_coats, its washes with it ----
do $$
declare
  ann uuid := tests.account('cw-4-ann'); bob uuid := tests.account('cw-4-bob');
  a uuid := tests.character(ann, 'Cw Four Ann'); b uuid := tests.character(bob, 'Cw Four Bob');
  t uuid := tests.thread('Cw four'); w record := pg_temp.wall(a, t);
  d uuid; keep uuid; w1 uuid; w2 uuid; got text; s surfaces%rowtype;
begin
  d := (pg_temp.draw(bob, b, w.play, pg_temp.coats(0, 100))::jsonb ->> 'id')::uuid;
  keep := (pg_temp.draw(bob, b, w.play, pg_temp.coats(500, 50))::jsonb ->> 'id')::uuid;
  -- One pass takes 10 tenths of the 20: every cell is still painted (see-through), the wash is live, nothing is cleared and the log has no cut.
  got := pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(d, pg_temp.coats(0, 100, 'a'))));
  if got like 'ERROR:%' then raise exception 'the first pass was refused: %', got; end if;
  w1 := (got::jsonb ->> 'id')::uuid;
  if pg_temp.covered(w.play) is distinct from 150 or (select coats[1] from surface_coats where draw = d) is distinct from 10 or (select painted from surface_coats where draw = d) is distinct from 100 then raise exception 'one pass leaves the draw see-through: %', got; end if;
  if (select live from surfaces where play = w.play) is distinct from array[d, keep, w1] or (select washes from surfaces where play = w.play) is distinct from jsonb_build_object(w1::text, jsonb_build_array(d)) then raise exception 'the thinning wash is live, naming the draw it changed'; end if;
  if (got::jsonb -> 'uncovered') is not null or (select payload ->> 'uncovered' from acts where id = w1) is distinct from '0' or (select payload -> 'cut' from acts where id = w1) is distinct from '[]'::jsonb then raise exception 'a pass that clears nothing says so: %', (select payload from acts where id = w1); end if;
  if (select cells from surface_marks where act = w1) is distinct from 0 or exists (select 1 from surface_cuts where wash = w1) then raise exception 'the log''s rows say nothing was cleared'; end if;
  -- The second pass clears it: the draw and both washes leave, the other draw stays.
  got := pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(d, pg_temp.coats(0, 100, 'a'))));
  w2 := (got::jsonb ->> 'id')::uuid;
  select * into s from surfaces where play = w.play;
  if s.live is distinct from array[keep] or s.washes is distinct from '{}' or s.covered is distinct from 50 then raise exception 'the cleared draw leaves live with its washes: % %', s.live, s.covered; end if;
  if exists (select 1 from surface_coats where draw = d) or (select count(*) from surface_coats where play = w.play) is distinct from 1 then raise exception 'the cleared draw leaves surface_coats'; end if;
  if (select payload ->> 'uncovered' from acts where id = w2) is distinct from '100' or (select payload -> 'cut' from acts where id = w2) is distinct from jsonb_build_array(jsonb_build_object('draw', d, 'took', 100)) then raise exception 'the second wash cleared its 100 cells: %', (select payload from acts where id = w2); end if;
  if (select cells from surface_marks where act = w2) is distinct from 100 or (select took from surface_cuts where wash = w2 and draw = d) is distinct from 100 or (select count(*) from surface_cuts where draw = d) is distinct from 1 then raise exception 'surface_cuts holds the cells each wash cleared'; end if;
  -- The Acts all stay, and rebuilding gives the row.
  if (select count(*) from acts where target_act_id = w.play and kind in ('draw', 'wash')) is distinct from 4 then raise exception 'every Act stays'; end if;
  if (rebuild_surface(w.play)).live is distinct from s.live or (rebuild_surface(w.play)).covered is distinct from s.covered then raise exception 'rebuild_surface agrees'; end if;
  -- The takes the Act keeps are the ones that changed something.
  if jsonb_array_length((select payload -> 'takes' from acts where id = w2)) is distinct from 1 then raise exception 'the Act keeps its takes'; end if;
end $$;

-- ---- 5. Washes that name draws that are not live, change nothing, or name one draw twice ----
do $$
declare
  ann uuid := tests.account('cw-5-ann'); bob uuid := tests.account('cw-5-bob');
  a uuid := tests.character(ann, 'Cw Five Ann'); a2 uuid := tests.character(ann, 'Cw Five Ann Two'); b uuid := tests.character(bob, 'Cw Five Bob');
  t uuid := tests.thread('Cw five'); w record := pg_temp.wall(a, t); w_other record := pg_temp.wall(a, t);
  d1 uuid; d2 uuid; dead uuid; foreign_draw uuid; got text; live_before uuid[]; w1 uuid; acts_before integer;
begin
  d1 := (pg_temp.draw(bob, b, w.play, pg_temp.coats(0, 100))::jsonb ->> 'id')::uuid;
  d2 := (pg_temp.draw(bob, b, w.play, pg_temp.coats(200, 100))::jsonb ->> 'id')::uuid;
  foreign_draw := (pg_temp.draw(bob, b, w_other.play, pg_temp.coats(0, 100))::jsonb ->> 'id')::uuid;
  dead := (pg_temp.draw(bob, b, w.play, pg_temp.coats(400, 10))::jsonb ->> 'id')::uuid;
  perform pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(dead, pg_temp.coats(400, 10, 'E'))));
  live_before := (select live from surfaces where play = w.play);
  if dead = any (live_before) then raise exception 'the draw is cleared'; end if;
  -- A wash over a draw that is not live, a draw of another wall, a draw that does not exist, and cells nobody painted: written, changes nothing, not kept; the Act's takes are empty.
  got := pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(dead, pg_temp.coats(400, 10, 'E')), pg_temp.take(foreign_draw, pg_temp.coats(0, 100, 'E')), pg_temp.take(gen_random_uuid(), pg_temp.coats(0, 100, 'E')),
                                                          pg_temp.take(d1, pg_temp.coats(5000, 10, 'E'))));
  if got like 'ERROR:%' or (select live from surfaces where play = w.play) is distinct from live_before or got::jsonb -> 'live' is distinct from to_jsonb(live_before) then raise exception 'a wash that changes nothing is not kept: %', got; end if;
  if not exists (select 1 from acts where id = (got::jsonb ->> 'id')::uuid and kind = 'wash') or (select payload -> 'takes' from acts where id = (got::jsonb ->> 'id')::uuid) is distinct from '[]'::jsonb then raise exception 'but its Act is written, with no takes kept'; end if;
  if (select painted from surface_coats where draw = foreign_draw) is distinct from 100 then raise exception 'a draw of another wall is not touched'; end if;
  -- A wash that thins two draws names both; it stays live while either does.
  got := pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(d1, pg_temp.coats(0, 100, 'a')), pg_temp.take(d2, pg_temp.coats(200, 100, 'a'))));
  w1 := (got::jsonb ->> 'id')::uuid;
  if (select washes from surfaces where play = w.play) is distinct from jsonb_build_object(w1::text, jsonb_build_array(d1, d2)) then raise exception 'the wash names both draws it changed: %', (select washes from surfaces where play = w.play); end if;
  perform pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(d1, pg_temp.coats(0, 100, 'E'))));
  if not (select w1 = any (live) from surfaces where play = w.play) or (select washes from surfaces where play = w.play) is distinct from jsonb_build_object(w1::text, jsonb_build_array(d1, d2)) then raise exception 'a wash stays live while one of its draws does'; end if;
  perform pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(d2, pg_temp.coats(200, 100, 'E'))));
  if (select live from surfaces where play = w.play) is distinct from '{}' or (select washes from surfaces where play = w.play) is distinct from '{}' or pg_temp.covered(w.play) is distinct from 0 then raise exception 'the last draw cleared takes every wash with it: %', (select live from surfaces where play = w.play); end if;
  -- The refusals: a wash is the author's alone, the same words as before; a draw named twice, takes that are not coat strings.
  acts_before := (select count(*) from acts where target_act_id = w.play);
  got := pg_temp.wash(bob, b, w.play, '[]');
  if got is distinct from 'ERROR: only the post''s author washes what is on it' then raise exception 'only the author washes: %', got; end if;
  got := pg_temp.wash(ann, a2, w.play, '[]');
  if got is distinct from 'ERROR: only the post''s author washes what is on it' then raise exception 'the author''s other mask does not wash: %', got; end if;
  got := pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(d1, pg_temp.coats(0, 1, 'a')), pg_temp.take(d1, pg_temp.coats(0, 1, 'a'))));
  if got is distinct from 'ERROR: a wash cuts each draw once' then raise exception 'a draw is named once: %', got; end if;
  got := pg_temp.wash(ann, a, w.play, jsonb_build_array(jsonb_build_object('draw', d1, 'takes', 'short')));
  if got is distinct from 'ERROR: a wash''s takes are a list of draws and coat strings' then raise exception 'takes are coat strings: %', got; end if;
  if (select count(*) from acts where target_act_id = w.play) is distinct from acts_before then raise exception 'a refused wash writes nothing'; end if;
end $$;

-- ---- 6. The 48-draw bound counts surface_coats rows ----
do $$
declare
  ann uuid := tests.account('cw-6-ann'); bob uuid := tests.account('cw-6-bob');
  a uuid := tests.character(ann, 'Cw Six Ann'); b uuid := tests.character(bob, 'Cw Six Bob');
  t uuid := tests.thread('Cw six'); w record := pg_temp.wall(a, t);
  got text; first_draw uuid;
begin
  for i in 0..47 loop
    got := pg_temp.draw(bob, b, w.play, pg_temp.coats(i, 1));
    if got like 'ERROR:%' then raise exception 'draw % was refused: %', i + 1, got; end if;
    if i = 0 then first_draw := (got::jsonb ->> 'id')::uuid; end if;
  end loop;
  if (select count(*) from surface_coats where play = w.play) is distinct from 48 then raise exception '48 rows'; end if;
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(100, 1));
  if got is distinct from 'ERROR: this wall holds 48 tags; paint over one or wait for a wash' then raise exception 'the 49th is refused in the wall''s words: %', got; end if;
  -- A draw over a tag does not free it: overlap is paid, and the tag it covers is still live.
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(0, 1));
  if got not like 'ERROR: this wall holds 48 tags%' then raise exception 'painting over a tag frees nothing: %', got; end if;
  -- A draw that paints nothing is never refused for the count.
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(100, 1, '1'));
  if got like 'ERROR:%' then raise exception 'a draw that paints nothing is not refused for the count: %', got; end if;
  -- A wash frees a slot by clearing a draw, and is never refused for the count.
  got := pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(first_draw, pg_temp.coats(0, 1, 'E'))));
  if got like 'ERROR:%' or (select count(*) from surface_coats where play = w.play) is distinct from 47 or pg_temp.live(w.play) is distinct from 47 then raise exception 'a wash lands at 48 and frees a tag: %', got; end if;
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(100, 1));
  if got like 'ERROR:%' then raise exception 'room after a wash: %', got; end if;
end $$;

-- ---- 7. A legacy wall: laid at 20, washed by taking every coat, rebuilt to the stored row. The guard whose poison is a legacy rule that lays 10. ----
do $$
declare
  ann uuid := tests.account('cw-7-ann'); bob uuid := tests.account('cw-7-bob');
  a uuid := tests.character(ann, 'Cw Seven Ann'); b uuid := tests.character(bob, 'Cw Seven Bob');
  t uuid := tests.thread('Cw seven'); w record := pg_temp.wall(a, t);
  d1 uuid; d2 uuid; d3 uuid; w1 uuid; s surfaces%rowtype; r surfaces%rowtype; got text; coats1 smallint[]; coats2 smallint[];
begin
  d1 := pg_temp.legacy(b, 'draw', t, w.play, pg_temp.cells(0, 1000));
  d2 := pg_temp.legacy(b, 'draw', t, w.play, pg_temp.cells(500, 1000));
  w1 := pg_temp.legacy(a, 'wash', t, w.play, pg_temp.cells(0, 300));
  d3 := pg_temp.legacy(b, 'draw', t, w.play, pg_temp.cells(5000, 100));
  perform surface_store(w.play);
  select * into s from surfaces where play = w.play;
  select coats into coats1 from surface_coats where draw = d1;
  select coats into coats2 from surface_coats where draw = d2;
  -- Laid at 20 tenths on each set cell, and the wash took every coat of the older draws on its cells.
  if coats1[400] is distinct from 20 or coats1[1] is distinct from 0 or coats1[300] is distinct from 0 or coats1[301] is distinct from 20 or coats1[1000] is distinct from 20 or coats1[1001] is distinct from 0 then raise exception 'a legacy draw is laid at 20 tenths, less its wash: % % % %', coats1[1], coats1[301], coats1[1000], coats1[1001]; end if;
  if coats2[501] is distinct from 20 or coats2[1500] is distinct from 20 or coats2[1501] is distinct from 0 then raise exception 'a legacy draw is laid at 20 tenths on its own cells'; end if;
  if s.covered is distinct from 700 + 1000 + 100 then raise exception 'covered is the sum of the live draws'' painted cells, overlap counted: %', s.covered; end if;
  if s.live is distinct from array[d1, d2, w1, d3] then raise exception 'the legacy draws and the wash that cut one are live: %', s.live; end if;
  if s.washes is distinct from jsonb_build_object(w1::text, jsonb_build_array(d1)) then raise exception 'the legacy wash names the draw it changed: %', s.washes; end if;
  -- Rebuilt from the Acts alone, it is the stored row.
  r := rebuild_surface(w.play);
  if r.covered is distinct from s.covered or r.live is distinct from s.live or r.washes is distinct from s.washes then raise exception 'rebuild_surface gives the stored row: % against %', r.covered, s.covered; end if;
  if exists (select 1 from (select draw, coats, painted from rebuild_surface_coats(w.play) except select draw, coats, painted from surface_coats where play = w.play) x)
     or exists (select 1 from (select draw, coats, painted from surface_coats where play = w.play except select draw, coats, painted from rebuild_surface_coats(w.play)) x) then raise exception 'rebuild_surface_coats gives the stored grids'; end if;
  -- And what 20 tenths is: the first new pass takes 10 and leaves the legacy paint see-through (a rule that laid 10 would leave it clean here).
  got := pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(d2, pg_temp.coats(500, 1000, 'a')), pg_temp.take(d3, pg_temp.coats(5000, 100, 'a'))));
  if got like 'ERROR:%' or pg_temp.covered(w.play) is distinct from 1800 or (select coats[501] from surface_coats where draw = d2) is distinct from 10 or (select painted from surface_coats where draw = d3) is distinct from 100 then raise exception 'one new pass thins legacy paint, it does not clear it: %', got; end if;
  got := pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(d2, pg_temp.coats(500, 1000, 'a'))));
  if pg_temp.covered(w.play) is distinct from 800 or exists (select 1 from surface_coats where draw = d2) then raise exception 'a second pass clears it: %', got; end if;
  r := rebuild_surface(w.play);
  select * into s from surfaces where play = w.play;
  if r.covered is distinct from s.covered or r.live is distinct from s.live or r.washes is distinct from s.washes then raise exception 'after new Acts on a legacy wall, rebuild_surface still gives the stored row: % against %', r.covered, s.covered; end if;
end $$;

-- ---- 8. An edit writes its places against the edit's id; the Lens gives the current version's; the two reads for the server function ----
do $$
declare
  ann uuid := tests.account('cw-8-ann'); bob uuid := tests.account('cw-8-bob');
  a uuid := tests.character(ann, 'Cw Eight Ann'); b uuid := tests.character(bob, 'Cw Eight Bob');
  t uuid := tests.thread('Cw eight'); w record := pg_temp.wall(a, t); w2 record := pg_temp.wall(a, t);
  d1 uuid; d2 uuid; box_only uuid; e1 uuid; e2 uuid; got jsonb; listed jsonb; text_place jsonb := '{"kind": "text", "version": "x", "at": 4, "len": 5, "dx": 1, "dy": 2}'; moved jsonb;
begin
  -- Two draws with two groups each on the post's own words, and a box-only draw (no places).
  d1 := (pg_temp.draw(bob, b, w.play, pg_temp.coats(0, 100), 4000, jsonb_build_array(jsonb_build_object('grp', 0, 'version', w.post, 'place', text_place), jsonb_build_object('grp', 1, 'version', w.post, 'place', null)))::jsonb ->> 'id')::uuid;
  d2 := (pg_temp.draw(bob, b, w.play, pg_temp.coats(200, 100), 4000, jsonb_build_array(jsonb_build_object('grp', 0, 'version', w.post, 'place', '{"kind": "image", "version": "x", "n": 0, "src": "a.png", "nth": 0, "x": 0.5, "y": 0.5}'::jsonb)))::jsonb ->> 'id')::uuid;
  box_only := (pg_temp.draw(bob, b, w.play, pg_temp.coats(400, 100))::jsonb ->> 'id')::uuid;
  -- A place of a version the post never had is refused.
  got := to_jsonb(pg_temp.draw(bob, b, w.play, pg_temp.coats(900, 10), 4000, jsonb_build_array(jsonb_build_object('grp', 0, 'version', gen_random_uuid(), 'place', null))));
  if got #>> '{}' not like 'ERROR: a place is of the post''s own words or one of its edits' then raise exception 'a place of a version the post never had is refused: %', got; end if;
  -- groups_on for the post's own version: both draws' groups, none for the box-only draw.
  perform tests.become_service();
  got := surface_groups_on(w.post);
  perform tests.unbecome();
  if got ->> 'version' is distinct from w.post::text or got ->> 'body' is distinct from 'A wall of words.' or got -> 'forged' is distinct from '[]'::jsonb or jsonb_array_length(got -> 'groups') is distinct from 3 then raise exception 'surface_groups_on gives the version, its words and each live group: %', got; end if;
  if got -> 'groups' -> 1 ->> 'grp' is distinct from '1' or got -> 'groups' -> 1 -> 'place' is distinct from 'null'::jsonb or got -> 'groups' -> 0 -> 'place' ->> 'at' is distinct from '4' or got -> 'groups' -> 2 ->> 'draw' is distinct from d2::text then raise exception 'the groups are in draw order, a fallen group is JSON null: %', got -> 'groups'; end if;
  -- An edit writes places against its own id: one group moved, one still fallen, and an entry for a draw that is not on this post is left out.
  moved := text_place || '{"at": 9}';
  perform tests.become(ann);
  got := edit_post(w.post, a, 'A new wall of words, much longer.', null, jsonb_build_array(jsonb_build_object('draw', d1, 'grp', 0, 'place', moved), jsonb_build_object('draw', d1, 'grp', 1, 'place', null),
                   jsonb_build_object('draw', d2, 'grp', 0, 'place', null), jsonb_build_object('draw', gen_random_uuid(), 'grp', 0, 'place', null)));
  perform tests.unbecome();
  e1 := (select id from acts where kind = 'edit' and target_act_id = w.post order by created_at desc, id desc limit 1);
  if (select count(*) from surface_places where version = e1) is distinct from 3 or (select place from surface_places where version = e1 and draw = d1 and grp = 0) is distinct from moved or (select place from surface_places where version = e1 and draw = d2 and grp = 0) is distinct from 'null'::jsonb then
    raise exception 'the edit wrote its places against the edit''s id: %', (select jsonb_agg(p) from surface_places p where version = e1);
  end if;
  if (select count(*) from surface_places where version = w.post) is distinct from 3 then raise exception 'the earlier version''s places stay'; end if;
  -- The Lens now gives the edit's places; the draw with no row for the edit is at its box spot (an empty list).
  perform tests.become(bob);
  listed := surface_acts(w.play);
  perform tests.unbecome();
  if (select x -> 'places' from jsonb_array_elements(listed -> 'acts') x where x ->> 'id' = d1::text) is distinct from jsonb_build_array(jsonb_build_object('grp', 0, 'place', moved), jsonb_build_object('grp', 1, 'place', null)) then raise exception 'the Lens gives the current version''s places: %', listed -> 'acts'; end if;
  if (select x -> 'places' from jsonb_array_elements(listed -> 'acts') x where x ->> 'id' = box_only::text) is distinct from '[]'::jsonb then raise exception 'a box-only draw has no places'; end if;
  perform tests.become_service();
  got := surface_groups_on(w.post);
  perform tests.unbecome();
  if got ->> 'version' is distinct from e1::text or got ->> 'body' is distinct from 'A new wall of words, much longer.' or jsonb_array_length(got -> 'groups') is distinct from 3 then raise exception 'surface_groups_on gives the edit''s version and groups: %', got; end if;
  -- A second edit with no places: no group has a place for it, so they are at their box spots; the first edit's rows are never read as its places.
  -- (Written as an Act a minute later: one transaction's edits share a timestamp, and the current version is the latest by created_at, id.)
  e2 := tests.act(a, 'edit', t, '{"body": "A third wall of words."}', w.post, now() + interval '1 minute');
  perform tests.become(bob);
  listed := surface_acts(w.play);
  perform tests.unbecome();
  if e2 = e1 or exists (select 1 from jsonb_array_elements(listed -> 'acts') x where x ->> 'kind' = 'draw' and x -> 'places' is distinct from '[]'::jsonb) then raise exception 'a version nothing was placed for has no places: %', listed -> 'acts'; end if;
  perform tests.become_service();
  got := surface_groups_on(w.post);
  perform tests.unbecome();
  if got ->> 'version' is distinct from e2::text or got -> 'groups' is distinct from '[]'::jsonb then raise exception 'no groups for a version with no places: %', got; end if;
  -- version_pair: current beside the drawn-on version; null for a version the post never had.
  perform tests.become_service();
  got := surface_version_pair(w.post, w.post);
  perform tests.unbecome();
  if got -> 'current' ->> 'version' is distinct from e2::text or got -> 'current' ->> 'body' is distinct from 'A third wall of words.' or got -> 'drawn' ->> 'version' is distinct from w.post::text or got -> 'drawn' ->> 'body' is distinct from 'A wall of words.' then raise exception 'surface_version_pair gives both: %', got; end if;
  perform tests.become_service();
  got := surface_version_pair(w.post, e1);
  if got -> 'drawn' ->> 'body' is distinct from 'A new wall of words, much longer.' then raise exception 'an edit is a version of the post: %', got; end if;
  got := surface_version_pair(w.post, gen_random_uuid());
  if got -> 'drawn' is distinct from 'null'::jsonb or got -> 'current' ->> 'version' is distinct from e2::text then raise exception 'a version the post never had is null: %', got; end if;
  got := surface_version_pair(w.post, w2.post);
  if got -> 'drawn' is distinct from 'null'::jsonb then raise exception 'another post''s version is not this post''s: %', got; end if;
  perform tests.unbecome();
  perform tests.become_service();
  if surface_post_of(w.play) is distinct from w.post or surface_post_of(gen_random_uuid()) is not null then raise exception 'surface_post_of names the post a wall is on, and nothing for a play that is no wall'; end if;
  perform tests.unbecome();
  if pg_temp.as_val(bob, format('select surface_post_of(%L)::text', w.play)) not like 'ERROR: permission denied%' then raise exception 'a player does not call surface_post_of'; end if;
  -- The two reads are the service role's alone.
  if pg_temp.as_val(bob, format('select surface_groups_on(%L)::text', w.post)) not like 'ERROR: permission denied%' or pg_temp.as_val(bob, format('select surface_version_pair(%L, %L)::text', w.post, w.post)) not like 'ERROR: permission denied%' then
    raise exception 'a player calls neither read';
  end if;
  if pg_temp.as_val(null, format('select surface_groups_on(%L)::text', gen_random_uuid())) is not null then raise exception 'a post that is not one gives nothing'; end if;
end $$;

-- ---- 9. Every redefined reader still answers covered ----
do $$
declare
  ann uuid := tests.account('cw-9-ann'); bob uuid := tests.account('cw-9-bob');
  a uuid := tests.character(ann, 'Cw Nine Ann'); b uuid := tests.character(bob, 'Cw Nine Bob');
  t uuid := tests.thread('Cw nine'); w record := pg_temp.wall(a, t);
  page jsonb; target jsonb; listed jsonb; want integer; got double precision; names text[];
begin
  perform pg_temp.draw(bob, b, w.play, pg_temp.coats(0, 250));
  perform pg_temp.draw(bob, b, w.play, pg_temp.coats(100, 250));
  want := 500;
  if pg_temp.covered(w.play) is distinct from want then raise exception 'the fixture covers 500 cells'; end if;
  -- thread_page
  perform tests.become(ann);
  page := thread_page(t, 1, null, 20, array[]::text[]);
  perform tests.unbecome();
  if (page -> 'surfaces' -> w.play::text ->> 'covered')::integer is distinct from want or page -> 'surfaces' -> w.play::text -> 'live' is distinct from (select to_jsonb(live) from surfaces where play = w.play) then raise exception 'thread_page carries covered and the live ids: %', page -> 'surfaces'; end if;
  if page::text like '%"coats"%' or page::text like '%"strokes"%' or page::text like '%"cells"%' then raise exception 'the page carries no grid or strokes'; end if;
  -- card_target
  perform tests.become(bob);
  target := card_target(w.post);
  perform tests.unbecome();
  if (target -> 'effects' -> 0 ->> 'covered')::integer is distinct from want then raise exception 'card_target shows covered: %', target -> 'effects'; end if;
  -- surface_acts
  perform tests.become(bob);
  listed := surface_acts(w.play);
  perform tests.unbecome();
  if (listed ->> 'covered')::integer is distinct from want or (select sum((x ->> 'share')::integer) from jsonb_array_elements(listed -> 'acts') x where x ->> 'kind' = 'draw') is distinct from want then raise exception 'surface_acts gives covered and shares that sum to it: %', listed; end if;
  -- digest_plays and extras_ids: the share of the wall (the staff read's own definer functions).
  got := (select d.covered from digest_plays(now() - interval '1 day', now() + interval '1 day', 50) d where d.play = w.play);
  if got is distinct from want / 10000.0 then raise exception 'digest_plays says the share covered: %', got; end if;
  got := (select e.covered from extras_ids(array[w.post]) e where e.act = w.play and e.part = 'play');
  if got is distinct from want / 10000.0 then raise exception 'extras_ids says the share covered: %', got; end if;
  -- No reader of the migration still reads the cover or the owners.
  select array_agg(p.proname order by p.proname) into names from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ '(cover|owners)\M' and p.prosrc ~* '(from|join) +(public\.)?surfaces';
  if names is not null then raise exception 'a function still reads surfaces.cover or .owners: %', names; end if;
  if exists (select 1 from information_schema.columns where table_name = 'surfaces' and column_name in ('cover', 'owners')) then raise exception 'cover and owners are dropped'; end if;
end $$;

-- ---- 10. The payload check, the signatures, the grants, the marks ----
do $$
declare
  ann uuid := tests.account('cw-10-ann'); bob uuid := tests.account('cw-10-bob');
  a uuid := tests.character(ann, 'Cw Ten Ann'); b uuid := tests.character(bob, 'Cw Ten Bob');
  t uuid := tests.thread('Cw ten'); w record := pg_temp.wall(a, t);
  got text; d uuid; names text[];
begin
  -- The writers take the new arguments, and no stale overload stays callable.
  select array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by p.proname) into names from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('draw_on_surface', 'wash_surface', 'staff_draw_on_surface', 'play_surface_card', 'staff_play_surface_card', 'surface_apply', 'edit_post', 'surface_check_payload', 'rebuild_surface');
  if names is distinct from array['draw_on_surface(who uuid, through uuid, play uuid, payload jsonb, coats text, places jsonb, most integer)',
                    'edit_post(target uuid, through uuid, body text, poll jsonb, surface_places jsonb)',
                    'play_surface_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text, reach text, from_post uuid, version uuid, tokens integer, first jsonb, first_coats text, first_places jsonb, most integer, most_live integer)',
                    'rebuild_surface(play uuid)',
                    'staff_draw_on_surface(staff_key text, play uuid, payload jsonb, coats text, places jsonb, most integer)',
                    'staff_play_surface_card(staff_key text, card text, target uuid, config jsonb, message text, pool_day date, tokens integer, first jsonb, first_coats text, first_places jsonb, most integer, most_live integer)',
                    'surface_apply(on_play uuid, by_character uuid, in_kind text, in_payload jsonb, in_coats text, in_takes jsonb, in_places jsonb, most integer)',
                    'surface_check_payload(in_payload jsonb, in_kind text)',
                    'wash_surface(who uuid, through uuid, play uuid, payload jsonb, takes jsonb)'] then
    raise exception 'the writers are the new signatures alone: %', names;
  end if;
  if exists (select 1 from pg_type where typname = 'surface_state') or exists (select 1 from pg_proc where proname = 'surface_step') then raise exception 'the old step is gone'; end if;
  -- The writers' payload checks: the drawing's groups and the wash's cuts are lists, and a draw is at most 64 KiB less the server's keys.
  got := pg_temp.as_val(null, format('select draw_on_surface(%L, %L, %L, %L, %L, %L, 4000)::text', bob, b, w.play, '{"strokes": []}'::jsonb, pg_temp.coats(0, 1), '[]'));
  if got is distinct from 'ERROR: a drawing holds its groups as a list' then raise exception 'the old shape is not accepted by a writer: %', got; end if;
  got := pg_temp.as_val(null, format('select draw_on_surface(%L, %L, %L, %L, %L, %L, 4000)::text', bob, b, w.play, jsonb_build_object('groups', '[]'::jsonb, 'pad', repeat('x', 66000)), pg_temp.coats(0, 1), '[]'));
  if got is distinct from 'ERROR: a drawing is at most 64 KiB' then raise exception 'a draw is at most 64 KiB: %', got; end if;
  got := pg_temp.as_val(null, format('select draw_on_surface(%L, %L, %L, %L, %L, %L, 4000)::text', bob, b, w.play, '{"groups": []}'::jsonb, repeat('0', 9999), '[]'));
  if got not like 'ERROR: a coat string is 10,000%' then raise exception 'a short coat string is refused: %', got; end if;
  -- Under 64 KiB without the server's keys: a payload carrying the keys loses them, and the coat strings are not counted (a wash of 48 draws' takes is far over 64 KiB).
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(0, 10));
  d := (got::jsonb ->> 'id')::uuid;
  got := pg_temp.as_val(null, format('select draw_on_surface(%L, %L, %L, %L, %L, %L, 4000)::text', bob, b, w.play,
    jsonb_build_object('groups', '[]'::jsonb, 'coats', pg_temp.coats(0, 10000), 'cells', 'x', 'takes', '[1]'::jsonb, 'uncovered', 5000, 'cut', '[1]'::jsonb), pg_temp.coats(20, 10), '[]'));
  if got like 'ERROR:%' or (select payload ->> 'coats' from acts where id = (got::jsonb ->> 'id')::uuid) is distinct from pg_temp.coats(20, 10) or (select payload ? 'cells' or payload ? 'takes' or payload ? 'uncovered' or payload ? 'cut' from acts where id = (got::jsonb ->> 'id')::uuid) then
    raise exception 'a payload that carries the server''s keys loses them: %', got;
  end if;
  -- The constraint on the Acts: an Act of the new shape without its coats, or a wash with takes that are no coat strings, is refused whoever writes it.
  begin
    perform set_config('kayfabb.surface_writer', 'on', true);
    insert into acts (character, kind, thread, target_act_id, payload) values (b, 'draw', t, w.play, '{"groups": []}');
    raise exception 'a draw with no coats was allowed';
  exception when check_violation then null; end;
  begin
    perform set_config('kayfabb.surface_writer', 'on', true);
    insert into acts (character, kind, thread, target_act_id, payload) values (a, 'wash', t, w.play, jsonb_build_object('cuts', '[]'::jsonb, 'takes', jsonb_build_array(jsonb_build_object('draw', d, 'takes', 'ab'))));
    raise exception 'a wash with a bad takes string was allowed';
  exception when check_violation then null; end;
  -- The grants: surface_coats is nobody's, surface_places is read by a signed-in player, the two reads and the step are no API role's.
  if pg_temp.as_val(bob, 'select count(*) from surface_coats') not like 'ERROR: permission denied%' then raise exception 'a player reads no grid'; end if;
  if pg_temp.as_val(bob, 'select count(*)::text from surface_places') like 'ERROR:%' then raise exception 'a player reads the places'; end if;
  if pg_temp.as_val(bob, 'select count(*)::text from surfaces') like 'ERROR:%' then raise exception 'a player reads the surface row'; end if;
  if pg_temp.as_val(bob, format('select surface_apply(%L, %L, ''draw'', ''{}'', null, null, null, 1)', w.play, b)) not like 'ERROR: permission denied%' then raise exception 'a player does not call surface_apply'; end if;
  if pg_temp.as_val(bob, format('select draw_on_surface(%L, %L, %L, ''{}'', null, null, 1)', bob, b, w.play)) not like 'ERROR: permission denied%' then raise exception 'a player does not call draw_on_surface'; end if;
  -- The log's rows are what the Acts say, in both directions.
  if exists (select 1 from (select * from surface_marks where play = w.play except select * from surface_marks_of(w.play)) x) or exists (select 1 from (select * from surface_marks_of(w.play) except select * from surface_marks where play = w.play) x) then raise exception 'surface_marks_of gives the stored marks'; end if;
end $$;

-- ---- 11. The bounds of a place, and the current version ----
do $$
declare
  ann uuid := tests.account('cw-11-ann'); bob uuid := tests.account('cw-11-bob');
  a uuid := tests.character(ann, 'Cw Eleven Ann'); b uuid := tests.character(bob, 'Cw Eleven Bob');
  t uuid := tests.thread('Cw eleven'); w record := pg_temp.wall(a, t);
  d uuid; got text; ok jsonb := '{"kind": "text", "version": "x", "at": 4, "len": 5, "dx": 1, "dy": 2}'; e1 uuid;
  many jsonb; big jsonb;
begin
  d := (pg_temp.draw(bob, b, w.play, pg_temp.coats(0, 100))::jsonb ->> 'id')::uuid;
  -- A draw's places: a group the drawing has (it has three), the kinds the engine knows, at most 2 KiB, at most 5,760 entries.
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(200, 10), 4000, jsonb_build_array(jsonb_build_object('grp', 3, 'version', w.post, 'place', ok)));
  if got is distinct from 'ERROR: a place names a group the drawing does not have' then raise exception 'a draw''s place for a group it lacks is refused: %', got; end if;
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(200, 10), 4000, jsonb_build_array(jsonb_build_object('grp', 0, 'version', w.post, 'place', '{"kind": "sticker"}'::jsonb)));
  if got is distinct from 'ERROR: a place is a text, an image or a box attachment of at most 2 KiB' then raise exception 'a place of an unknown kind is refused: %', got; end if;
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(200, 10), 4000, jsonb_build_array(jsonb_build_object('grp', 0, 'version', w.post, 'place', jsonb_build_object('kind', 'text', 'pad', repeat('x', 2100)))));
  if got is distinct from 'ERROR: a place is a text, an image or a box attachment of at most 2 KiB' then raise exception 'a place over 2 KiB is refused: %', got; end if;
  select jsonb_agg(jsonb_build_object('grp', 0, 'version', w.post, 'place', null)) into many from generate_series(1, 5761);
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(200, 10), 4000, many);
  if got is distinct from 'ERROR: a drawing places at most 5,760 groups' then raise exception 'a draw''s places are capped: %', got; end if;
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(200, 10), 4000, jsonb_build_array(jsonb_build_object('grp', 2, 'version', w.post, 'place', '{"kind": "box"}'::jsonb)));
  if got like 'ERROR:%' then raise exception 'a place within the bounds is kept: %', got; end if;
  -- An edit's places, from any caller: the same bounds, and nothing is written by a refused one (the edit is undone with it).
  perform tests.become(ann);
  begin
    perform edit_post(w.post, a, 'Words one.', null, jsonb_build_array(jsonb_build_object('draw', d, 'grp', 3, 'place', ok)));
    raise exception 'an edit placing a group the draw lacks was allowed';
  exception when others then
    if sqlerrm is distinct from 'a place names a group the drawing does not have' then raise exception 'an edit''s place for a group the draw lacks: %', sqlerrm; end if;
  end;
  begin
    perform edit_post(w.post, a, 'Words one.', null, jsonb_build_array(jsonb_build_object('draw', d, 'grp', 0, 'place', '{"kind": "sticker"}'::jsonb)));
    raise exception 'an edit with an unknown kind was allowed';
  exception when others then
    if sqlerrm is distinct from 'a place is a text, an image or a box attachment of at most 2 KiB' then raise exception 'an edit''s place of an unknown kind: %', sqlerrm; end if;
  end;
  begin
    perform edit_post(w.post, a, 'Words one.', null, jsonb_build_array(jsonb_build_object('draw', d, 'grp', 0, 'place', jsonb_build_object('kind', 'text', 'pad', repeat('x', 2100)))));
    raise exception 'an edit with a large place was allowed';
  exception when others then
    if sqlerrm is distinct from 'a place is a text, an image or a box attachment of at most 2 KiB' then raise exception 'an edit''s place over 2 KiB: %', sqlerrm; end if;
  end;
  select jsonb_agg(jsonb_build_object('draw', d, 'grp', 0, 'place', null)) into many from generate_series(1, 5761);
  begin
    perform edit_post(w.post, a, 'Words one.', null, many);
    raise exception 'an edit with too many places was allowed';
  exception when others then
    if sqlerrm is distinct from 'an edit places at most 5,760 groups' then raise exception 'an edit''s places are capped: %', sqlerrm; end if;
  end;
  perform tests.unbecome();
  if exists (select 1 from acts where kind = 'edit' and target_act_id = w.post) then raise exception 'a refused edit wrote no Act'; end if;
  -- Within the bounds the edit lands, and an entry for a draw that is not live on this post is still left out.
  perform tests.become(ann);
  perform edit_post(w.post, a, 'Words one.', null, jsonb_build_array(jsonb_build_object('draw', d, 'grp', 2, 'place', '{"kind": "box"}'::jsonb), jsonb_build_object('draw', gen_random_uuid(), 'grp', 99, 'place', null)));
  perform tests.unbecome();
  e1 := (select id from acts where kind = 'edit' and target_act_id = w.post);
  if (select count(*) from surface_places where version = e1) is distinct from 1 then raise exception 'the edit wrote the one place within the bounds: %', (select count(*) from surface_places where version = e1); end if;
  -- The post's words have changed since the drawer read them: a draw whose places are for the first version is refused, one for the edit's version lands; no places at all is never stale.
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(300, 10), 4000, jsonb_build_array(jsonb_build_object('grp', 0, 'version', w.post, 'place', ok)));
  if got is distinct from 'ERROR: That post''s words aren''t the ones you drew on. Reload it and tag again.' then raise exception 'a draw placed for an old version is refused: %', got; end if;
  if (select count(*) from surface_coats where play = w.play) is distinct from 2 then raise exception 'a refused draw wrote nothing'; end if;
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(300, 10), 4000, jsonb_build_array(jsonb_build_object('grp', 0, 'version', e1, 'place', ok)));
  if got like 'ERROR:%' then raise exception 'a draw placed for the current version lands: %', got; end if;
  got := pg_temp.draw(bob, b, w.play, pg_temp.coats(400, 10));
  if got like 'ERROR:%' then raise exception 'a draw with no places lands: %', got; end if;
  -- The check is in surface_apply, which every draw writer (a player's, a persona's, a play's first draw) calls: called here as its owner.
  got := '';
  begin
    perform surface_apply(w.play, b, 'draw', '{"groups": [{}]}'::jsonb, pg_temp.coats(500, 10), null, jsonb_build_array(jsonb_build_object('grp', 0, 'version', w.post, 'place', ok)), 4000);
  exception when others then got := sqlerrm; end;
  if got is distinct from 'That post''s words aren''t the ones you drew on. Reload it and tag again.' then raise exception 'surface_apply, which every draw writer calls, refuses the old version: %', got; end if;
end $$;

-- ---- 12. A draw's grid is laid at 1 tenth as 0; the constraint is validated ----
do $$
declare
  ann uuid := tests.account('cw-12-ann'); bob uuid := tests.account('cw-12-bob');
  a uuid := tests.character(ann, 'Cw Twelve Ann'); b uuid := tests.character(bob, 'Cw Twelve Bob');
  t uuid := tests.thread('Cw twelve'); w record := pg_temp.wall(a, t);
  d uuid; w1 uuid; got text; s surfaces%rowtype; r surfaces%rowtype;
begin
  -- 100 cells at 2 coats, then 50 cells at 1 tenth: those are clean and are stored as 0.
  d := (pg_temp.draw(bob, b, w.play, pg_temp.coats(0, 100) || '')::jsonb ->> 'id')::uuid;
  got := pg_temp.draw(bob, b, w.play, repeat('0', 200) || repeat('k', 10) || repeat('1', 50) || repeat('0', 9740));
  d := (got::jsonb ->> 'id')::uuid;
  if (select painted from surface_coats where draw = d) is distinct from 10 or (select coats[211] from surface_coats where draw = d) is distinct from 0 or (select count(*) from surface_coats c, unnest(c.coats) x where c.draw = d and x = 1) is distinct from 0 then
    raise exception 'cells held at 1 tenth are stored as 0';
  end if;
  if (select payload ->> 'coats' from acts where id = d) is distinct from repeat('0', 200) || repeat('k', 10) || repeat('1', 50) || repeat('0', 9740) then raise exception 'the Act keeps the coat string as it was sent'; end if;
  -- A wash that takes only those cells changes nothing: it is written and not live, as one over a cell that was always clean.
  got := pg_temp.wash(ann, a, w.play, jsonb_build_array(pg_temp.take(d, repeat('0', 210) || repeat('a', 50) || repeat('0', 9740))));
  if got like 'ERROR:%' then raise exception 'the wash was refused: %', got; end if;
  w1 := (got::jsonb ->> 'id')::uuid;
  if (select w1 = any (live) from surfaces where play = w.play) or (select washes from surfaces where play = w.play) is distinct from '{}'::jsonb then raise exception 'a wash of clean cells is not live: %', (select live from surfaces where play = w.play); end if;
  -- The rebuild agrees, since it lays the grid the same way.
  select * into s from surfaces where play = w.play;
  r := rebuild_surface(w.play);
  if r.covered is distinct from s.covered or r.live is distinct from s.live or r.washes is distinct from s.washes then raise exception 'the rebuilt row is the stored one'; end if;
  if exists (select 1 from rebuild_surface_coats(w.play) x join surface_coats c on c.play = x.play and c.draw = x.draw where x.coats is distinct from c.coats) then raise exception 'the rebuilt grids are the stored ones'; end if;
  -- The constraint was added not valid and validated.
  if not (select convalidated from pg_constraint where conname = 'acts_surface_payload' and conrelid = 'acts'::regclass) then raise exception 'acts_surface_payload is validated'; end if;
end $$;

-- ---- 13. thread_page gives each post its current version: its own id, then its latest edit's ----
do $$
declare
  ann uuid := tests.account('cw-13-ann'); a uuid := tests.character(ann, 'Cw Thirteen Ann');
  t uuid := tests.thread('Cw thirteen'); w record := pg_temp.wall(a, t); other uuid := tests.post(a, t, 'Another post.');
  page jsonb; e1 uuid; e2 uuid;
begin
  perform tests.become(ann);
  page := thread_page(t, 1, null, 20, array[]::text[]);
  perform tests.unbecome();
  if (select x ->> 'version' from jsonb_array_elements(page -> 'acts') x where x ->> 'id' = w.post::text) is distinct from w.post::text then raise exception 'an unedited post is its own version: %', page -> 'acts'; end if;
  perform tests.become(ann);
  perform edit_post(w.post, a, 'Words one.', null, '[]'::jsonb);
  perform tests.unbecome();
  e1 := (select id from acts where kind = 'edit' and target_act_id = w.post order by created_at desc, id desc limit 1);
  perform tests.become(ann);
  page := thread_page(t, 1, null, 20, array[]::text[]);
  perform tests.unbecome();
  if (select x ->> 'version' from jsonb_array_elements(page -> 'acts') x where x ->> 'id' = w.post::text) is distinct from e1::text then raise exception 'an edited post is at its edit: %', page -> 'acts'; end if;
  perform tests.become(ann);
  perform edit_post(w.post, a, 'Words two.', null, '[]'::jsonb);
  perform tests.unbecome();
  e2 := (select id from acts where kind = 'edit' and target_act_id = w.post order by created_at desc, id desc limit 1);
  perform tests.become(ann);
  page := thread_page(t, 1, null, 20, array[]::text[]);
  perform tests.unbecome();
  -- Two edits made in one transaction share created_at, so which is current is decided by the id (the rule acts_public's current_payload and post_version both hold: created_at desc, id desc), not by which was made later.
  -- So the assertion is not that the second edit is the version, but that the version is the edit whose words the page shows, whichever of the two wins the tie.
  if (select count(*) from acts where kind = 'edit' and target_act_id = w.post) is distinct from 2 or (select count(distinct created_at) from acts where kind = 'edit' and target_act_id = w.post) is distinct from 1 then raise exception 'the two edits share a timestamp: %', (select jsonb_agg(created_at) from acts where kind = 'edit' and target_act_id = w.post); end if;
  if (select x ->> 'version' from jsonb_array_elements(page -> 'acts') x where x ->> 'id' = w.post::text) is distinct from post_version(w.post)::text then raise exception 'the page names the post''s current version: %', page -> 'acts'; end if;
  if (select e.payload ->> 'body' from acts e where e.id = (select (x ->> 'version')::uuid from jsonb_array_elements(page -> 'acts') x where x ->> 'id' = w.post::text))
       is distinct from (select x -> 'current_payload' ->> 'body' from jsonb_array_elements(page -> 'acts') x where x ->> 'id' = w.post::text) then raise exception 'the version names the edit whose words the page shows: %', page -> 'acts'; end if;
  if (select x ->> 'version' from jsonb_array_elements(page -> 'acts') x where x ->> 'id' = other::text) is distinct from other::text then raise exception 'another post is untouched by the edit: %', page -> 'acts'; end if;
  -- The field is what surface_version_pair names as current, which is what a draw is checked against.
  if (select (surface_version_pair(w.post, w.post) -> 'current' ->> 'version') from (select tests.become_service()) z) is distinct from post_version(w.post)::text then raise exception 'the page and the draw agree on the current version'; end if;
  perform tests.unbecome();
end $$;
