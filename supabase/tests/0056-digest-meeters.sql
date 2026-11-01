-- The characters who met a move (supabase/migrations/0051_digest_meeters.sql; the system plan, Task 13): each move the digest lists as
-- ended `met` carries `metBy`, the public characters whose public Acts counted toward its demand, at most eight, never a staff
-- character, read from public relations only. The poison: a poster from before the move landed, a staff poster and a poster after
-- the end listed as having met it; a move that was not met listing anyone at all.

create function pg_temp.boss() returns uuid language plpgsql as $$
declare made uuid;
begin
  select id into made from characters where staff = 'dm-boss';
  if made is null then insert into characters (name, staff, staff_kind, debuted_at) values ('Dm Boss', 'dm-boss', 'boss', now()) returning id into made; end if;
  return made;
end $$;
create function pg_temp.announcements() returns uuid language plpgsql as $$
declare made uuid;
begin
  select t.id into made from threads t join boards b on b.id = t.board where b.is_system and t.title = 'Announcements';
  if made is null then insert into threads (board, title) select id, 'Announcements' from boards where is_system returning id into made; end if;
  return made;
end $$;
create function pg_temp.move(on_board uuid, new_name text, demand jsonb, at timestamptz) returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  written := tests.act(pg_temp.boss(), 'move', pg_temp.announcements(),
    jsonb_strip_nulls(jsonb_build_object('kind', 'renameBoard', 'body', 'The System has spoken.',
      'params', jsonb_build_object('board', on_board, 'name', new_name, 'premise', 'The subject of ' || new_name, 'description', 'About ' || new_name),
      'demand', demand, 'expires_at', at + interval '3 days')), null, at);
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;
create function pg_temp.end_at(move uuid, why text, at timestamptz, by text default 'tick') returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.move_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (null, 'move_end', pg_temp.announcements(), move, jsonb_build_object('why', why, 'by', by), at) returning id into written;
  perform set_config('kayfabb.move_end_writer', '', true);
  return written;
end $$;

do $$
declare
  base timestamptz := '2040-09-01T12:00:00Z';
  hall uuid;
  other uuid;
  dboard uuid;
  qboard uuid;
  th_dist uuid;
  th_quad uuid;
  th uuid;
  th_other uuid;
  boss uuid := pg_temp.boss();
  early uuid; late uuid; qa uuid; qb uuid; qc uuid;
  posters uuid[] := '{}';
  p uuid;
  i integer;
  posts uuid;
  m_posts uuid; m_distinct uuid; m_thread uuid; m_cross uuid; m_quad uuid; m_expired uuid; m_reversed uuid;
  d jsonb;
  e jsonb;
begin
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  insert into demand_kinds (key) values ('postsOnBoard'), ('distinctCharactersOnBoard'), ('quadrantOnBoard'), ('characterPostsInThread'), ('crossQuote') on conflict do nothing;
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '10'), ('digestExcerptChars', '50') on conflict (key) do update set value = excluded.value;
  insert into boards (slug, name, description) values ('dm-hall', 'Dm Hall', 'x') returning id into hall;
  insert into boards (slug, name, description) values ('dm-other', 'Dm Other', 'x') returning id into other;
  insert into threads (board, title) values (hall, 'Dm thread') returning id into th;
  insert into threads (board, title) values (other, 'Dm elsewhere') returning id into th_other;
  insert into boards (slug, name, description) values ('dm-distinct', 'Dm Distinct', 'x') returning id into dboard;
  insert into boards (slug, name, description) values ('dm-quad', 'Dm Quad', 'x') returning id into qboard;
  insert into threads (board, title) values (dboard, 'Dm distinct thread') returning id into th_dist;
  insert into threads (board, title) values (qboard, 'Dm quad thread') returning id into th_quad;

  early := tests.character(tests.account('dm-early'), 'Dm Early');
  late := tests.character(tests.account('dm-late'), 'Dm Late');
  for i in 1..10 loop posters := posters || tests.character(tests.account('dm-poster-' || i), 'Dm Poster ' || lpad(i::text, 2, '0')); end loop;

  -- ---- A met postsOnBoard: eight of ten posters are listed, in the order they first posted, with nobody else ----
  m_posts := pg_temp.move(hall, 'Dm Palace', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', hall, 'count', 12)), base - interval '5 hours');
  perform tests.post(early, th, 'Before the landing.', base - interval '6 hours');
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform tests.post(boss, th, 'The Boss posts on the board.', base - interval '4 hours 30 minutes');
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.post(posters[1], th_other, 'On another board.', base - interval '4 hours 40 minutes');
  for i in 1..10 loop
    perform tests.post(posters[i], th, 'Post ' || i, base - interval '4 hours' + i * interval '1 minute');
  end loop;
  -- The first poster again, later: still one name.
  perform tests.post(posters[1], th, 'Post again', base - interval '3 hours');
  perform tests.post(late, th, 'After the end.', base - interval '30 minutes');
  perform pg_temp.end_at(m_posts, 'met', base - interval '1 hour');

  -- ---- Met distinctCharactersOnBoard on the other board: the same rule, a different board ----
  m_distinct := pg_temp.move(dboard, 'Dm Distinct Palace', jsonb_build_object('kind', 'distinctCharactersOnBoard', 'params', jsonb_build_object('board', dboard, 'count', 2)), base - interval '5 hours');
  perform tests.post(posters[3], th_dist, 'Three.', base - interval '4 hours');
  perform tests.post(posters[2], th_dist, 'Two.', base - interval '3 hours 50 minutes');
  perform pg_temp.end_at(m_distinct, 'met', base - interval '2 hours');

  -- ---- Met characterPostsInThread: the named character; crossQuote: the two; quadrantOnBoard: the authors whose tallies counted ----
  m_thread := pg_temp.move(hall, 'Dm Thread Palace', jsonb_build_object('kind', 'characterPostsInThread', 'params', jsonb_build_object('thread', th, 'character', posters[4])), base - interval '5 hours');
  perform pg_temp.end_at(m_thread, 'met', base - interval '90 minutes');
  m_cross := pg_temp.move(hall, 'Dm Cross Palace', jsonb_build_object('kind', 'crossQuote', 'params', jsonb_build_object('a', posters[5], 'b', posters[6], 'reactions', 1)), base - interval '5 hours');
  perform pg_temp.end_at(m_cross, 'met', base - interval '80 minutes');
  m_quad := pg_temp.move(qboard, 'Dm Quad Palace', jsonb_build_object('kind', 'quadrantOnBoard', 'params', jsonb_build_object('board', qboard, 'quadrant', 'excitedPositive', 'count', 3)), base - interval '5 hours');
  qa := tests.post(posters[7], th_quad, 'Liked.', base - interval '3 hours');
  qb := tests.post(posters[8], th_quad, 'Not liked.', base - interval '3 hours');
  qc := tests.post(posters[9], th_quad, 'Liked more.', base - interval '3 hours' + interval '1 minute');
  insert into reaction_tallies (act, kind, count) values (qa, 'up', 1), (qb, 'boo', 4), (qc, 'up', 2);
  perform pg_temp.end_at(m_quad, 'met', base - interval '70 minutes');

  -- ---- A move that expired, and one an admin reversed: nobody is credited ----
  m_expired := pg_temp.move(hall, 'Dm Expired Palace', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', hall, 'count', 99)), base - interval '5 hours');
  perform pg_temp.end_at(m_expired, 'expired', base - interval '60 minutes');
  m_reversed := pg_temp.move(hall, 'Dm Reversed Palace', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', hall, 'count', 99)), base - interval '5 hours');
  perform pg_temp.end_at(m_reversed, 'reversed', base - interval '50 minutes', 'admin');

  perform tests.become_service();
  d := system_digest(base - interval '3 hours', base);
  perform tests.unbecome();

  -- the posters list, in order, capped at eight
  e := (select m from jsonb_array_elements(d -> 'moves') m where (m ->> 'act')::uuid = m_posts);
  if e is null or e ->> 'state' is distinct from 'ended' then raise exception 'the met move is not listed ended: %', d -> 'moves'; end if;
  if e -> 'metBy' is distinct from (select jsonb_agg(x order by o) from unnest(posters[1:8]) with ordinality t(x, o)) then
    raise exception 'a met postsOnBoard lists % (the first eight posters in order are wanted; Early, the Boss, the other board and the poster after the end are not)', e -> 'metBy';
  end if;
  if jsonb_array_length(e -> 'metBy') <> 8 then raise exception 'metBy is not capped at eight: %', e -> 'metBy'; end if;
  if e -> 'metBy' @> to_jsonb(early::text) or e -> 'metBy' @> to_jsonb(late::text) or e -> 'metBy' @> to_jsonb(boss::text) then raise exception 'metBy credits one who did not meet it: %', e -> 'metBy'; end if;

  -- distinct characters on another board: its own posters, in order
  e := (select m from jsonb_array_elements(d -> 'moves') m where (m ->> 'act')::uuid = m_distinct);
  if e -> 'metBy' is distinct from jsonb_build_array(posters[3]::text, posters[2]::text) then raise exception 'distinctCharactersOnBoard lists %', e -> 'metBy'; end if;

  e := (select m from jsonb_array_elements(d -> 'moves') m where (m ->> 'act')::uuid = m_thread);
  if e -> 'metBy' is distinct from jsonb_build_array(posters[4]::text) then raise exception 'characterPostsInThread lists %', e -> 'metBy'; end if;
  e := (select m from jsonb_array_elements(d -> 'moves') m where (m ->> 'act')::uuid = m_cross);
  if e -> 'metBy' is distinct from jsonb_build_array(posters[5]::text, posters[6]::text) then raise exception 'crossQuote lists %', e -> 'metBy'; end if;
  e := (select m from jsonb_array_elements(d -> 'moves') m where (m ->> 'act')::uuid = m_quad);
  if e -> 'metBy' is distinct from jsonb_build_array(posters[9]::text, posters[7]::text) then raise exception 'quadrantOnBoard lists % (the authors of the posts with tallies in the quadrant, the biggest first)', e -> 'metBy'; end if;

  -- not met: nobody
  e := (select m from jsonb_array_elements(d -> 'moves') m where (m ->> 'act')::uuid = m_expired);
  if e ? 'metBy' then raise exception 'an expired move lists who met it: %', e; end if;
  e := (select m from jsonb_array_elements(d -> 'moves') m where (m ->> 'act')::uuid = m_reversed);
  if e ? 'metBy' then raise exception 'a reversed move lists who met it: %', e; end if;

  -- the digest names every one of them, and no one it was not told of is a staff member
  if exists (select 1 from jsonb_array_elements(d #> '{moves}') m, jsonb_array_elements_text(m -> 'metBy') x
             where not exists (select 1 from jsonb_array_elements(d -> 'characters') c where c ->> 'id' = x)) then
    raise exception 'a character in metBy is not among the digest''s characters: %', d -> 'characters';
  end if;
  if exists (select 1 from jsonb_array_elements(d #> '{moves}') m, jsonb_array_elements_text(m -> 'metBy') x
             join characters c on c.id = x::uuid where c.staff is not null) then
    raise exception 'a staff character is credited';
  end if;
end $$;
