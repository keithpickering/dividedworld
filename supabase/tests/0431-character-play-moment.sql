-- A character play's moment (supabase/migrations/0431_character_play_moment.sql; docs/plans/2026-11-12-spin-at-post-plan.md, Task 3):
-- a play on a character takes a moment as a play on a post does (0072), of its cast-from post (its target_act_id), and play_moment answers it
-- with itself first, itself not above, and the play's time as `at`. A thread's play and a board's play are refused as before. The cards are the
-- engine's test set, never an instance's: Glint reaches a character, Marquee a thread, Blot a post.

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('glint', 'Glint', 'pepperoni', 'uncommon', 'cast', null, '{character}', interval '7 days'),
    ('glimmer', 'Glimmer', 'pepperoni', 'uncommon', 'cast', null, '{character}', interval '7 days'),
    ('marquee', 'Marquee', 'sweet', 'rare', 'cast', null, '{thread}', interval '1 day')
  on conflict (key) do nothing;
  if not exists (select 1 from settings where key = 'systemAnnouncements') then
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(tests.thread('Character-moment Announcements')::text);
  end if;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The moment of a play, or an assertion that it was refused (so a missing feature fails on its own words, not on the refusal's).
create function pg_temp.moment(play uuid) returns jsonb language plpgsql as $$
begin
  return play_moment(play);
exception when others then
  raise exception 'play_moment(%) was refused: %', play, sqlerrm;
end $$;

-- ---- The trigger: a play on a character takes a moment, naming the cast-from post; a play on a thread takes none ----
do $$
declare
  ann uuid := tests.account('cm-ann'); bob uuid := tests.account('cm-bob');
  a uuid := tests.character(ann, 'Moment Ann'); b uuid := tests.character(bob, 'Moment Bob');
  t uuid := tests.thread('Character moment');
  p uuid := tests.post(b, t, 'The post the glint was cast from.', now() - interval '3 hours');
  ed uuid; blot uuid; k uuid; on_thread uuid; later_edit uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'glint', 'marquee', 'blot');
  ed := tests.act(b, 'edit', t, '{"body": "Edited before the cast."}', p, now() - interval '1 hour');
  blot := (play_card(ann, 'blot', a, p, '{"color": "yellow"}', 0, '') ->> 'id')::uuid;
  k := (play_card(ann, 'glint', a, b, '{}', 0, '', 'character', p) ->> 'id')::uuid;
  if (select count(*) from play_moments where play = k) is distinct from 1::bigint then
    raise exception 'a play on a character takes a moment: %', (select jsonb_agg(to_jsonb(m)) from play_moments m where m.play = k);
  end if;
  if (select post_version from play_moments where play = k) is distinct from ed then
    raise exception 'its moment names the cast-from post''s latest edit: %', (select post_version from play_moments where play = k);
  end if;
  if (select array_agg(layer) from play_moment_layers where play = k) is distinct from array[blot] then
    raise exception 'its layers are the cast-from post''s own, never itself: %', (select array_agg(layer) from play_moment_layers where play = k);
  end if;
  -- A later edit leaves the moment as it was; the edit takes none.
  later_edit := tests.act(b, 'edit', t, '{"body": "Edited after."}', p, now() + interval '1 minute');
  if (select post_version from play_moments where play = k) is distinct from ed or exists (select 1 from play_moments where play = later_edit) then
    raise exception 'a later edit changed the moment, or took one';
  end if;
  -- A thread's play takes none.
  on_thread := (play_card(ann, 'marquee', a, t, '{}', 0, '', 'thread') ->> 'id')::uuid;
  if exists (select 1 from play_moments where play = on_thread) then raise exception 'a play on a thread takes no moment'; end if;
  -- The trigger is an ordinary one still, so an import written as a replica takes none of its own.
  if (select tgenabled from pg_trigger where tgname = 'acts_take_play_moment') is distinct from 'O' then raise exception 'the moment''s trigger is an ordinary one'; end if;
end $$;

-- ---- The read: the cast-from post as it was, the layers as saved then, itself first, itself not above, recorded, with its time ----
do $$
declare
  ann uuid := tests.account('cmr-ann'); bob uuid := tests.account('cmr-bob');
  a uuid := tests.character(ann, 'Read Ann'); b uuid := tests.character(bob, 'Read Bob');
  t uuid := tests.thread('Character moment read');
  p uuid := tests.post(b, t, 'Cast from here.', now() - interval '3 hours');
  ed uuid; blot uuid; later_blot uuid; k uuid; other uuid; got jsonb; why text; on_thread uuid;
  saved jsonb := '{"strokes": [], "washed": 0.4}';
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'glint', 'blot', 'blot', 'marquee');
  ed := tests.act(b, 'edit', t, '{"body": "Edited before the cast."}', p, now() - interval '1 hour');
  blot := (play_card(ann, 'blot', a, p, '{"color": "yellow"}', 0, '') ->> 'id')::uuid;
  perform save_effect_state(bob, b, blot, saved);
  -- Another play on the post's author, live before k began: it is above k. (As 0075 makes its plays above: by hand, at an earlier time.)
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values
    (a, 'card', t, p, jsonb_build_object('card', 'glimmer', 'reach', 'character', 'character', b), now() - interval '2 hours') returning id into other;
  insert into play_reach (play, reach, character, ends_at) values (other, 'character', b, now() + interval '1 day');
  k := (play_card(ann, 'glint', a, b, '{}', 0, '', 'character', p) ->> 'id')::uuid;
  -- What happens after: a later layer on the post, a later save of the first layer, a later edit, and a play begun after.
  later_blot := (play_card(ann, 'blot', a, p, '{"color": "green"}', 0, '') ->> 'id')::uuid;
  perform save_effect_state(bob, b, blot, '{"washed": 1}');
  perform tests.act(b, 'edit', t, '{"body": "Edited after."}', p, now() + interval '1 minute');

  got := pg_temp.moment(k);
  if got -> 'version' ->> 'id' is distinct from p::text or got -> 'version' -> 'current_payload' is distinct from '{"body": "Edited before the cast."}'::jsonb
     or (got -> 'version' ->> 'edited_at')::timestamptz is distinct from now() - interval '1 hour' then
    raise exception 'the version is the cast-from post with the edit''s words as of the cast: %', got -> 'version';
  end if;
  if got -> 'version' -> 'payload' is distinct from '{"body": "Cast from here."}'::jsonb then raise exception 'the post''s own payload is kept: %', got -> 'version'; end if;
  if jsonb_path_query_array(got -> 'layers', '$[*].act.id') is distinct from jsonb_build_array(k, blot) then
    raise exception 'itself first, then the layers on the post then, and not a later one: %', got -> 'layers';
  end if;
  if got -> 'layers' -> 0 -> 'state' is distinct from 'null'::jsonb or got -> 'layers' -> 1 -> 'state' is distinct from saved
     or (got -> 'layers' -> 1 ->> 'savedAt')::timestamptz is distinct from (select saved_at from play_moment_layers where play = k and layer = blot) then
    raise exception 'a layer is drawn as it was saved then, not now: %', got -> 'layers';
  end if;
  if jsonb_path_query_array(got -> 'above', '$[*].play') is distinct from jsonb_build_array(other) then
    raise exception 'another play live then is above, and the play itself is not: %', got -> 'above';
  end if;
  if got -> 'recorded' is distinct from 'true'::jsonb then raise exception 'a play taken with its moment is recorded: %', got; end if;
  if (got ->> 'at')::timestamptz is distinct from (select created_at from acts where id = k) then raise exception 'at is the play''s time: %', got -> 'at'; end if;

  -- A play on a post answers as before, with its time.
  got := pg_temp.moment(blot);
  if got -> 'version' ->> 'id' is distinct from p::text or got -> 'recorded' is distinct from 'true'::jsonb
     or jsonb_path_query_array(got -> 'layers', '$[*].act.id') is distinct from jsonb_build_array(blot) then
    raise exception 'a play on a post answers as before: %', got;
  end if;
  if (got ->> 'at')::timestamptz is distinct from (select created_at from acts where id = blot) then raise exception 'a play on a post carries its time too: %', got -> 'at'; end if;

  -- A thread's play, a post, an edit and an Act that is not there are refused, in the same words.
  on_thread := (play_card(ann, 'marquee', a, t, '{}', 0, '', 'thread') ->> 'id')::uuid;
  foreach why in array array[pg_temp.refusal(format('select play_moment(%L)', on_thread)), pg_temp.refusal(format('select play_moment(%L)', p)),
                             pg_temp.refusal(format('select play_moment(%L)', ed)), pg_temp.refusal(format('select play_moment(%L)', gen_random_uuid()))] loop
    if why is distinct from 'that is no play on a post' then raise exception 'a read of something else is refused in words: %', why; end if;
  end loop;
end $$;

-- ---- A character play from before: no snapshot, so the version current at its time, itself alone, not recorded ----
do $$
declare
  ann uuid := tests.account('cmo-ann'); a uuid := tests.character(ann, 'Old Ann');
  bob uuid := tests.account('cmo-bob'); b uuid := tests.character(bob, 'Old Bob');
  t uuid := tests.thread('Character moment old');
  p uuid := tests.post(b, t, 'Old words.', now() - interval '5 hours');
  q uuid := tests.post(b, t, 'Never edited.', now() - interval '5 hours');
  k uuid := gen_random_uuid(); k_plain uuid := gen_random_uuid(); ed uuid; got jsonb;
begin
  perform pg_temp.cards();
  ed := tests.act(b, 'edit', t, '{"body": "Before the play."}', p, now() - interval '3 hours');
  -- Written as an import writes a row, so the trigger takes no moment, as a play made before this migration has none.
  set local session_replication_role = replica;
  insert into acts (id, character, kind, thread, target_act_id, payload, created_at) values
    (k, a, 'card', t, p, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', b), now() - interval '2 hours'),
    (k_plain, a, 'card', t, q, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', b), now() - interval '2 hours');
  insert into play_reach (play, reach, character, ends_at) values (k, 'character', b, now() + interval '1 day'), (k_plain, 'character', b, now() + interval '1 day');
  set local session_replication_role = origin;
  perform tests.act(b, 'edit', t, '{"body": "After the play."}', p, now() - interval '1 hour');
  if exists (select 1 from play_moments where play in (k, k_plain)) then raise exception 'the old plays have no snapshot'; end if;

  got := pg_temp.moment(k);
  if got -> 'recorded' is distinct from 'false'::jsonb then raise exception 'a play from before snapshots is not recorded: %', got; end if;
  if got -> 'version' -> 'current_payload' is distinct from '{"body": "Before the play."}'::jsonb then raise exception 'its version is found by time: %', got -> 'version'; end if;
  if got -> 'layers' is distinct from jsonb_build_array(jsonb_build_object('act', act_projection(k), 'state', null, 'savedAt', null)) then
    raise exception 'it holds itself alone: %', got -> 'layers';
  end if;
  if got -> 'above' is distinct from '[]'::jsonb then raise exception 'its plays above are those live then; the play itself is not one: %', got -> 'above'; end if;
  if (got ->> 'at')::timestamptz is distinct from now() - interval '2 hours' then raise exception 'at is its time: %', got -> 'at'; end if;
  -- A post never edited is its own version.
  got := pg_temp.moment(k_plain);
  if got -> 'version' is distinct from act_projection(q) or got -> 'recorded' is distinct from 'false'::jsonb then
    raise exception 'an unedited cast-from post is its own version, unrecorded: %', got;
  end if;
end $$;
