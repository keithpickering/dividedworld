-- Chattier staff follow-ups (supabase/migrations/0418_chattier_follow_ups.sql; docs/plans/2026-11-23-chattier-staff-follow-ups-plan.md, Task 1; the final review of PR #1000).
-- F1: pool_conversation shows a reply under a live author veil as the stand-in's, never as its author (it reads acts_public; a read of raw acts would name the author in a persona's prompt).
-- F2: pool_record holds only the moves that landed or ended since the latest meeting's slot, on both of its branches.
-- 3. pool_thread takes a list of replies beside the newest posts and its four-argument form reads as before.

create function pg_temp.staff_post(k text, in_thread uuid, body text, target uuid default null) returns uuid language sql as $$
  select (write_staff_act(k, 'post', in_thread, target, jsonb_build_object('body', body)) ->> 'id')::uuid
$$;
create function pg_temp.move(at timestamptz) returns uuid language plpgsql as $$
declare written uuid; ann uuid;
begin
  select t.id into ann from threads t join boards b on b.id = t.board where b.is_system and t.title = 'Announcements';
  if ann is null then insert into threads (board, title) select id, 'Announcements' from boards where is_system returning id into ann; end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  written := tests.act((select id from characters where staff = 'fu-boss'), 'move', ann,
    jsonb_build_object('kind', 'renameBoard', 'body', 'The System has spoken.', 'params', jsonb_build_object('name', 'N'), 'expires_at', at + interval '3 days'), null, at);
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;
create function pg_temp.end_at(move uuid, at timestamptz) returns void language plpgsql as $$
begin
  perform set_config('kayfabb.move_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (null, 'move_end', (select thread from acts where id = move), move, jsonb_build_object('why', 'met', 'by', 'tick'), at);
  perform set_config('kayfabb.move_end_writer', '', true);
end $$;

insert into characters (name, staff, staff_kind, debuted_at) values ('Fu Boss', 'fu-boss', 'persona', now());
insert into characters (name, staff, staff_kind, debuted_at) values ('Fu Anonymous', 'fu-anonymous', 'anonymous', now()) on conflict do nothing;
insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do nothing;

-- ---- F1: a veiled reply is the stand-in's in the persona's conversation ----
do $$
declare
  t uuid := tests.thread('Fu Veil');
  bob uuid := tests.account('fu-bob'); b uuid := tests.character(bob, 'Fu Bob');
  ann uuid := tests.account('fu-ann'); a uuid := tests.character(ann, 'Fu Ann');
  p uuid; plain uuid; veiled uuid; vplay uuid; r jsonb; rep jsonb; stand uuid := (select id from characters where staff_kind = 'anonymous');
begin
  p := pg_temp.staff_post('fu-boss', t, 'The boss speaks.');
  plain := tests.act(a, 'post', t, '{"body": "Ann, in the open."}', p, now() - interval '2 hours');
  veiled := tests.act(b, 'post', t, '{"body": "Bob, veiled."}', p, now() - interval '1 hour');
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack) values ('fuveil', 'Fu Veil', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1) on conflict (key) do nothing;
  vplay := tests.act(a, 'card', t, '{"card": "fuveil", "reach": "post"}', veiled);
  insert into post_veils (play, post, veil, author, caster_account, ends_at, post_kind) values (vplay, veiled, 'author', b, bob, now() + interval '1 day', 'post');
  perform tests.become_service();
  r := pool_conversation('fu-boss', t, 5, 5, 100);
  rep := (select e from jsonb_array_elements(r -> 'posts' -> 0 -> 'replies') e where e ->> 'act' = plain::text);
  if rep ->> 'name' is distinct from 'Fu Ann' then raise exception 'an open reply names its author: %', r; end if;
  rep := (select e from jsonb_array_elements(r -> 'posts' -> 0 -> 'replies') e where e ->> 'act' = veiled::text);
  if rep is null or rep ->> 'author' is distinct from stand::text or rep ->> 'name' is distinct from 'Fu Anonymous' then raise exception 'a veiled reply is the stand-in''s: %', r; end if;
  if r::text like '%' || b::text || '%' or r::text like '%Fu Bob%' then raise exception 'a veiled reply names its author: %', r; end if;
  perform tests.unbecome();
end $$;

-- ---- F2: pool_record leaves out a move that landed or ended before the latest meeting's slot ----
do $$
declare
  t uuid := tests.thread('Fu Record');
  slot timestamptz := now() - interval '2 hours';
  old_open uuid; new_open uuid; old_ended uuid; ended_after uuid; r jsonb; ids text[];
begin
  insert into meetings (started_at, finished_at, outcome, slot) values (slot, slot, 'ok', slot);
  old_open := pg_temp.move(now() - interval '5 hours');
  new_open := pg_temp.move(now() - interval '30 minutes');
  old_ended := pg_temp.move(now() - interval '6 hours');
  perform pg_temp.end_at(old_ended, now() - interval '4 hours');
  ended_after := pg_temp.move(now() - interval '7 hours');
  perform pg_temp.end_at(ended_after, now() - interval '20 minutes');
  perform tests.become_service();
  r := pool_record(t, 'fu-boss');
  ids := (select coalesce(array_agg(e ->> 'act' order by e ->> 'act'), '{}') from jsonb_array_elements(r -> 'moves') e);
  if old_open::text = any (ids) then raise exception 'a move that landed before the meeting is in today''s record: %', r; end if;
  if old_ended::text = any (ids) then raise exception 'a move that ended before the meeting is in today''s record: %', r; end if;
  if not (new_open::text = any (ids)) or not (ended_after::text = any (ids)) then raise exception 'a move landed or ended since the meeting is missing: %', r; end if;
  perform tests.unbecome();
end $$;

-- ---- pool_thread reads a list of replies beside the newest posts; the four-argument form is as it was ----
do $$
declare
  t uuid := tests.thread('Fu Thread');
  ann uuid := tests.account('fu-t-ann'); a uuid := tests.character(ann, 'Fu T Ann');
  p uuid; r1 uuid; r2 uuid; r3 uuid; r4 uuid; other uuid; th jsonb;
begin
  p := pg_temp.staff_post('fu-boss', t, 'The boss speaks.');
  r1 := tests.act(a, 'post', t, '{"body": "One."}', p, now() - interval '4 hours');
  r2 := tests.act(a, 'post', t, '{"body": "Two."}', p, now() - interval '3 hours');
  r3 := tests.act(a, 'post', t, '{"body": "Three."}', p, now() - interval '2 hours');
  r4 := tests.act(a, 'post', t, '{"body": "Four."}', p, now() - interval '1 hour');
  other := tests.act(a, 'post', tests.thread('Fu Elsewhere'), '{"body": "Elsewhere."}');
  perform tests.become_service();
  -- the list names posts in the thread, beside the newest one; a post of another thread is not read
  th := pool_thread(t, 1, 100, null, array[r1, r3, other]);
  if (select array_agg(x.v ->> 'act' order by x.n) from jsonb_array_elements(th -> 'posts') with ordinality x(v, n)) is distinct from array[r1::text, r3::text, p::text] then raise exception 'the list and the newest post, oldest first: %', th; end if;
  th := pool_thread(t, 0, 100, r2, array[r1, r3]);
  if (select array_agg(x.v ->> 'act' order by x.n) from jsonb_array_elements(th -> 'posts') with ordinality x(v, n)) is distinct from array[r1::text, r2::text, r3::text] then raise exception 'also and the list together: %', th; end if;
  -- the list is bounded: only its first 50 count
  th := pool_thread(t, 0, 100, null, array_fill(gen_random_uuid(), array[60]) || r1);
  if jsonb_array_length(th -> 'posts') <> 0 then raise exception 'a name past the 50th is read: %', th; end if;
  -- the four-argument form, with and without its fourth
  th := pool_thread(t, 2, 100, r1);
  if (select array_agg(x.v ->> 'act' order by x.n) from jsonb_array_elements(th -> 'posts') with ordinality x(v, n)) is distinct from array[r1::text, r4::text, p::text] then raise exception 'the four-argument form: %', th; end if;
  th := pool_thread(t, 1, 100);
  if jsonb_array_length(th -> 'posts') <> 1 or th -> 'posts' -> 0 ->> 'act' is distinct from p::text then raise exception 'the three-argument form: %', th; end if;
  th := pool_thread(t, 1, 100, null);
  if jsonb_array_length(th -> 'posts') <> 1 then raise exception 'a null fourth argument: %', th; end if;
  perform tests.unbecome();
end $$;
