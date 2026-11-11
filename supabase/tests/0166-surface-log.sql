-- What a player's log says of a surface (supabase/migrations/0195_surfaces.sql, the log's views; docs/plans/2026-11-11-graffiti-plan.md, Task 6; the design's sections 3 and 11): a drawer's own draws and the
-- washes that cut them (`my_draws`), and the draws and washes on the walls of the player's own posts (`my_walls_drawn_on`), each read by the reader's own characters alone, and `log_page` carrying both.
-- The card is this file's own (`slwall`, with the surface flag); every name is prefixed sl.
--
--  1. wash_effect: the draws a wash cut, with the cells each owned when it landed, read from the Acts alone (a later draw's paint-over, an earlier wash's bare cells)
--  2. my_draws: the drawer's own draw, with its cells, and a cut row for each wash that cut it; none for a wash that cut nothing of theirs
--  3. my_walls_drawn_on: the author's view: another character's draws on their post, and their own washes with the cells each uncovered; not their own masks' draws (my_draws has those)
--  4. a third player's two views are empty, and so is a visitor's
--  5. log_page carries both sources for each reader, newest first, never past the cursor, and names the plays and posts and the characters (people) its rows name; a third player's page carries none
--  6. nothing in a row says who owns a character or a class

select tests.unbecome();

insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, stack, surface)
values ('slwall', 'Sl Wall', 'pepperoni', 'rare', 'cast', null, '{post}', 1, true);

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

-- A run of cells: `n` ones from cell `first`.
create function pg_temp.cells(first integer, n integer) returns bit(10000) language sql as $$
  select (repeat('0', first) || repeat('1', n) || repeat('0', 10000 - first - n))::bit(10000)
$$;

-- A wall as place_cast leaves one: a post by `author`, a play of the wall card on it, and its open surface.
create function pg_temp.wall(author uuid, in_thread uuid, out post uuid, out play uuid) language plpgsql as $$
begin
  post := tests.post(author, in_thread, 'A wall.');
  play := tests.act(author, 'card', in_thread, jsonb_build_object('card', 'slwall', 'message', '', 'config', '{}'::jsonb, 'layer', 1), post);
  perform open_surface(play);
end $$;

create function pg_temp.draw(who uuid, through uuid, play uuid, cells bit(10000)) returns uuid language plpgsql as $$
declare got text;
begin
  got := pg_temp.as_val(null, format('select draw_on_surface(%L, %L, %L, %L, %L, 4000)::text', who, through, play, '{"strokes": [{"width": 0.01, "points": [[0.1, 0.1]]}]}'::jsonb, cells::text));
  if got like 'ERROR:%' then raise exception 'a draw was refused: %', got; end if;
  return (got::jsonb ->> 'id')::uuid;
end $$;
create function pg_temp.wash(who uuid, through uuid, play uuid, cells bit(10000)) returns uuid language plpgsql as $$
declare got text;
begin
  got := pg_temp.as_val(null, format('select wash_surface(%L, %L, %L, %L, %L)::text', who, through, play, '{"strokes": [{"width": 0.02, "points": [[0.1, 0.1]]}]}'::jsonb, cells::text));
  if got like 'ERROR:%' then raise exception 'a wash was refused: %', got; end if;
  return (got::jsonb ->> 'id')::uuid;
end $$;

-- A view's rows as one document, read as an account.
create function pg_temp.read(who uuid, view text) returns jsonb language plpgsql as $$
declare
  got text := pg_temp.as_val(who, format('select coalesce(jsonb_agg(to_jsonb(r) order by r.at, r.act, r.mine), ''[]''::jsonb)::text from %I r', view));
begin
  if got like 'ERROR:%' then raise exception 'reading %: %', view, got; end if;
  return got::jsonb;
end $$;

-- The world: Ann owns the post's character `a` and a second mask `a2`; Bob's `b` and Cal's `c` draw; Dan owns `d` and plays no part.
create function pg_temp.world(out ann uuid, out bob uuid, out cal uuid, out dan uuid, out a uuid, out a2 uuid, out b uuid, out c uuid, out d uuid, out t uuid, out post uuid, out play uuid,
                              out d1 uuid, out d2 uuid, out d3 uuid, out d4 uuid, out w1 uuid, out w2 uuid, out w3 uuid, out w4 uuid) language plpgsql as $$
begin
  ann := tests.account('sl-ann'); bob := tests.account('sl-bob'); cal := tests.account('sl-cal'); dan := tests.account('sl-dan');
  a := tests.character(ann, 'Sl Ann'); a2 := tests.character(ann, 'Sl Ann Two'); b := tests.character(bob, 'Sl Bob'); c := tests.character(cal, 'Sl Cal'); d := tests.character(dan, 'Sl Dan');
  t := tests.thread('Sl wall');
  select w.post, w.play into post, play from pg_temp.wall(a, t) w;
  -- Bob's tag covers 600 cells; Cal's paints over its upper half and runs on (300..900); Ann's other mask tags her own post.
  d1 := pg_temp.draw(bob, b, play, pg_temp.cells(0, 600));
  d2 := pg_temp.draw(cal, c, play, pg_temp.cells(300, 600));
  d3 := pg_temp.draw(ann, a2, play, pg_temp.cells(2000, 100));
  d4 := pg_temp.draw(ann, a2, play, pg_temp.cells(5000, 50));
  -- Ann washes 0..450: it uncovers 450 cells, 300 of them Bob's (0..300) and 150 Cal's (300..450), whatever the draws first covered.
  w1 := pg_temp.wash(ann, a, play, pg_temp.cells(0, 450));
  -- The same cells again: they are bare now, so it uncovers nothing and cuts no one.
  w2 := pg_temp.wash(ann, a, play, pg_temp.cells(0, 450));
  -- 600..700 is Cal's alone (Bob's tag ended at 600): 100 cells, Cal's.
  w3 := pg_temp.wash(ann, a, play, pg_temp.cells(600, 100));
  -- Ann washes her own second mask's tag: Ann's own wash line says so, and it is no cut row for her drawing mask.
  w4 := pg_temp.wash(ann, a, play, pg_temp.cells(5000, 50));
end $$;

create temp table sl as select * from pg_temp.world();

-- ---- 1. wash_effect ----
do $$
declare
  w record;
  got jsonb;
begin
  select * into w from sl;
  select coalesce(jsonb_agg(jsonb_build_object('draw', e.draw, 'cells', e.cells) order by e.cells desc), '[]'::jsonb) into got from wash_effect(w.w1) e;
  if got is distinct from jsonb_build_array(jsonb_build_object('draw', w.d1, 'cells', 300), jsonb_build_object('draw', w.d2, 'cells', 150)) then
    raise exception 'the first wash cut 300 of Bob''s cells and 150 of Cal''s: %', got;
  end if;
  if exists (select 1 from wash_effect(w.w2)) then raise exception 'a wash over cells already bare cuts nothing'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('draw', e.draw, 'cells', e.cells)), '[]'::jsonb) into got from wash_effect(w.w3) e;
  if got is distinct from jsonb_build_array(jsonb_build_object('draw', w.d2, 'cells', 100)) then raise exception 'the third wash cut 100 of Cal''s cells: %', got; end if;
  if exists (select 1 from wash_effect(w.d1)) then raise exception 'a draw is no wash: it cuts nothing'; end if;
  if has_function_privilege('anon', 'wash_effect(uuid)', 'execute') or not has_function_privilege('authenticated', 'wash_effect(uuid)', 'execute') then
    raise exception 'wash_effect is for the views'' signed-in reader: a visitor has no right to it';
  end if;
end $$;

-- ---- 2. my_draws: the drawer's own ----
do $$
declare
  w record;
  bobs jsonb; cals jsonb; anns jsonb;
begin
  select * into w from sl;
  bobs := pg_temp.read(w.bob, 'my_draws');
  if jsonb_array_length(bobs) <> 2 then raise exception 'Bob reads his draw and the one wash that cut it: %', bobs; end if;
  if bobs -> 0 is distinct from jsonb_build_object('act', w.d1, 'kind', 'draw', 'play', w.play, 'post', w.post, 'character', w.b, 'mine', w.b, 'at', bobs -> 0 -> 'at', 'cells', 600) then
    raise exception 'Bob''s draw row: its Act, the play and post, the character, its 600 cells: %', bobs -> 0;
  end if;
  if bobs -> 1 is distinct from jsonb_build_object('act', w.w1, 'kind', 'cut', 'play', w.play, 'post', w.post, 'character', w.a, 'mine', w.b, 'at', bobs -> 1 -> 'at', 'cells', 300) then
    raise exception 'Bob''s cut row: the wash, its character, the 300 of his cells it took: %', bobs -> 1;
  end if;
  if (bobs -> 0 ->> 'at')::timestamptz >= (bobs -> 1 ->> 'at')::timestamptz then raise exception 'the cut row is the wash''s own time, after the draw'; end if;
  cals := pg_temp.read(w.cal, 'my_draws');
  if (select array_agg(r ->> 'kind' || ':' || (r ->> 'cells')) from jsonb_array_elements(cals) r) is distinct from array['draw:600', 'cut:150', 'cut:100'] then
    raise exception 'Cal reads his draw and the two washes that cut it, each with his cells: %', cals;
  end if;
  if (cals -> 1 ->> 'act')::uuid is distinct from w.w1 or (cals -> 2 ->> 'act')::uuid is distinct from w.w3 then raise exception 'Cal''s cuts are the first and third washes (the second cut nothing): %', cals; end if;
  -- Ann's own mask drew on her own post: the draw is hers to read, and no cut of it is (the washer is her own mask: her own wash line says it).
  anns := pg_temp.read(w.ann, 'my_draws');
  if (select array_agg(r ->> 'kind' || ':' || (r ->> 'mine')::uuid || ':' || (r ->> 'cells')) from jsonb_array_elements(anns) r) is distinct from array['draw:' || w.a2 || ':100', 'draw:' || w.a2 || ':50'] then
    raise exception 'Ann reads her second mask''s two draws alone, and no cut of them: %', anns;
  end if;
end $$;

-- ---- 3. my_walls_drawn_on: the post's author ----
do $$
declare
  w record;
  anns jsonb;
begin
  select * into w from sl;
  anns := pg_temp.read(w.ann, 'my_walls_drawn_on');
  if (select array_agg(r ->> 'kind' || ':' || (r ->> 'character')::uuid || ':' || (r ->> 'cells')) from jsonb_array_elements(anns) r)
     is distinct from array['draw:' || w.b || ':600', 'draw:' || w.c || ':600', 'wash:' || w.a || ':450', 'wash:' || w.a || ':0', 'wash:' || w.a || ':100', 'wash:' || w.a || ':50'] then
    raise exception 'Ann reads the others'' draws and her own washes, each wash with the cells it uncovered (the second, none), and not her own mask''s draw: %', anns;
  end if;
  if exists (select 1 from jsonb_array_elements(anns) r where (r ->> 'mine')::uuid <> w.a or (r ->> 'post')::uuid <> w.post or (r ->> 'play')::uuid <> w.play) then raise exception 'each row is for her post''s character: %', anns; end if;
  if (anns -> 0 ->> 'act')::uuid is distinct from w.d1 or (anns -> 4 ->> 'act')::uuid is distinct from w.w3 or (anns -> 5 ->> 'act')::uuid is distinct from w.w4 then raise exception 'oldest first by when each landed: %', anns; end if;
  -- Bob drew, he did not write the post: none of this is his.
  if pg_temp.read(w.bob, 'my_walls_drawn_on') <> '[]'::jsonb or pg_temp.read(w.cal, 'my_walls_drawn_on') <> '[]'::jsonb then raise exception 'a drawer reads nothing of the wall''s author''s log'; end if;
end $$;

-- ---- 4. A third player, and a visitor ----
do $$
declare
  w record;
begin
  select * into w from sl;
  if pg_temp.read(w.dan, 'my_draws') <> '[]'::jsonb or pg_temp.read(w.dan, 'my_walls_drawn_on') <> '[]'::jsonb then raise exception 'a third player reads none of it'; end if;
  if (select count(*) from pg_class where relname in ('my_draws', 'my_walls_drawn_on')) <> 2 then raise exception 'both views exist'; end if;
  if has_table_privilege('anon', 'my_draws', 'select') or has_table_privilege('anon', 'my_walls_drawn_on', 'select')
     or not has_table_privilege('authenticated', 'my_draws', 'select') or not has_table_privilege('authenticated', 'my_walls_drawn_on', 'select') then
    raise exception 'the views are the signed-in player''s alone';
  end if;
end $$;

-- ---- 5. log_page ----
do $$
declare
  w record;
  bobs jsonb; anns jsonb; dans jsonb; cut text;
begin
  select * into w from sl;
  bobs := pg_temp.as_val(w.bob, 'select log_page(null)::text')::jsonb;
  if jsonb_array_length(bobs -> 'sources' -> 'draws') <> 2 or jsonb_array_length(bobs -> 'sources' -> 'wallsDrawn') <> 0 then raise exception 'Bob''s page carries his two rows and none of an author''s: %', bobs -> 'sources'; end if;
  if (bobs -> 'sources' -> 'draws' -> 0 ->> 'act')::uuid is distinct from w.w1 or (bobs -> 'sources' -> 'draws' -> 1 ->> 'act')::uuid is distinct from w.d1 then raise exception 'newest first: %', bobs -> 'sources' -> 'draws'; end if;
  if not exists (select 1 from jsonb_array_elements(bobs -> 'acts') x where (x ->> 'id')::uuid = w.post) or not exists (select 1 from jsonb_array_elements(bobs -> 'acts') x where (x ->> 'id')::uuid = w.play) then
    raise exception 'both the play and its post are among the Acts named: %', (select jsonb_agg(x ->> 'id') from jsonb_array_elements(bobs -> 'acts') x);
  end if;
  if exists (select 1 from jsonb_array_elements(bobs -> 'acts') x where x ->> 'kind' in ('draw', 'wash')) then raise exception 'a draw''s strokes do not ride in the page''s Acts'; end if;
  if not exists (select 1 from jsonb_array_elements(bobs -> 'people') x where (x ->> 'id')::uuid = w.a) then raise exception 'the washer is named among the people: %', bobs -> 'people'; end if;
  anns := pg_temp.as_val(w.ann, 'select log_page(null)::text')::jsonb;
  if jsonb_array_length(anns -> 'sources' -> 'wallsDrawn') <> 6 or jsonb_array_length(anns -> 'sources' -> 'draws') <> 2 then raise exception 'Ann''s page carries the wall''s six rows and her mask''s two draws: %', anns -> 'sources'; end if;
  if not exists (select 1 from jsonb_array_elements(anns -> 'people') x where (x ->> 'id')::uuid = w.b) or not exists (select 1 from jsonb_array_elements(anns -> 'people') x where (x ->> 'id')::uuid = w.c) then
    raise exception 'the drawers are named among the people: %', anns -> 'people';
  end if;
  dans := pg_temp.as_val(w.dan, 'select log_page(null)::text')::jsonb;
  if jsonb_array_length(dans -> 'sources' -> 'draws') <> 0 or jsonb_array_length(dans -> 'sources' -> 'wallsDrawn') <> 0 then raise exception 'a third player''s page carries none: %', dans -> 'sources'; end if;
  if jsonb_array_length(dans -> 'acts') <> 0 or jsonb_array_length(dans -> 'people') <> 0 then raise exception 'and names nothing of the wall: %', dans; end if;
  -- The cursor: rows at or before it only.
  cut := bobs -> 'sources' -> 'draws' -> 1 ->> 'at';
  bobs := pg_temp.as_val(w.bob, format('select log_page(%L)::text', cut))::jsonb;
  if jsonb_array_length(bobs -> 'sources' -> 'draws') <> 1 or (bobs -> 'sources' -> 'draws' -> 0 ->> 'act')::uuid is distinct from w.d1 then raise exception 'a page before the cut washes holds the draw alone: %', bobs -> 'sources' -> 'draws'; end if;
end $$;

-- ---- 6. Nothing names an owner or a class ----
do $$
declare
  w record;
  cols text[];
begin
  select * into w from sl;
  select array_agg(a.attname order by a.attnum) into cols from pg_attribute a where a.attrelid = 'my_draws'::regclass and a.attnum > 0 and not a.attisdropped;
  if cols is distinct from array['act', 'kind', 'play', 'post', 'character', 'mine', 'at', 'cells'] then raise exception 'my_draws holds public facts and the reader''s own character: %', cols; end if;
  select array_agg(a.attname order by a.attnum) into cols from pg_attribute a where a.attrelid = 'my_walls_drawn_on'::regclass and a.attnum > 0 and not a.attisdropped;
  if cols is distinct from array['act', 'kind', 'play', 'post', 'character', 'mine', 'at', 'cells'] then raise exception 'my_walls_drawn_on holds the same: %', cols; end if;
  -- Ann's second mask and Ann's first are hers: a stranger's page never says either's player, and no row says a class.
  if pg_temp.as_val(w.bob, 'select log_page(null)::text') ~* '(owner|class_key|"class")' and pg_temp.as_val(w.bob, 'select (log_page(null) -> ''sources'' -> ''draws'')::text') ~* '(owner|class)' then
    raise exception 'a draw row says nothing of an owner or a class';
  end if;
end $$;
