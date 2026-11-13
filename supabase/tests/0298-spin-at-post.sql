-- A spin from a card on a character names the post it was pressed on (supabase/migrations/0351_spin_at_post.sql;
-- docs/plans/2026-11-12-spin-at-post-plan.md, Task 2; docs/plans/2026-11-12-spin-at-post-design.md). The cards are the engine's test set,
-- never an instance's: Glint reaches a character, Marquee a thread, Blot a post.

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('glint', 'Glint', 'pepperoni', 'uncommon', 'cast', null, '{character}', interval '7 days'),
    ('glimmer', 'Glimmer', 'pepperoni', 'uncommon', 'cast', null, '{character}', interval '7 days'),
    ('marquee', 'Marquee', 'sweet', 'rare', 'cast', null, '{thread}', interval '1 day')
  on conflict (key) do nothing;
  if not exists (select 1 from settings where key = 'systemAnnouncements') then
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(tests.thread('Spin-at Announcements')::text);
  end if;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- An admin's end of a play, as reverse_card writes it (0092): a card_end Act of no character, under the writer flag.
create function pg_temp.end_play(play uuid, in_thread uuid, at timestamptz default now()) returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (null, 'card_end', in_thread, play, '{"why": "reversed", "by": "admin"}', at) returning id into written;
  perform set_config('kayfabb.card_end_writer', '', true);
  return written;
end $$;

-- A spin as `who`, through `through`, from `origin`, at `at_post` (null for none); the Act's id.
create function pg_temp.spun_at(who uuid, through uuid, origin uuid, at_post uuid) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(who);
  made := spin(origin => origin, through => through, title => 'Spun ' || left(gen_random_uuid()::text, 6), body => 'Discuss.', at_post => at_post);
  perform tests.unbecome();
  return (made -> 'act' ->> 'id')::uuid;
end $$;

-- The words a refused spin says, or null if it was not refused. The role is set outside the block, so the refusal's rollback leaves it as it was.
create function pg_temp.spin_refusal(who uuid, through uuid, origin uuid, at_post uuid) returns text language plpgsql as $$
begin
  perform tests.become(who);
  begin
    perform spin(origin => origin, through => through, title => 'Refused', body => 'No.', at_post => at_post);
  exception when others then
    perform tests.unbecome();
    return sqlerrm || '|' || sqlstate;
  end;
  perform tests.unbecome();
  return null;
end $$;

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The origin place of the thread a spin Act opened, as thread_open and thread_list both give it.
create function pg_temp.place(spin_act uuid) returns jsonb language plpgsql as $$
declare a jsonb; b jsonb; th uuid := (select thread from acts where id = spin_act);
begin
  select origin_place into a from thread_open where id = th;
  select origin_place into b from thread_list where id = th;
  if a is distinct from b then raise exception 'thread_open and thread_list differ: % and %', a, b; end if;
  return a;
end $$;

-- ---- A spin that names its post: the Act, its moment, and the layers on the post then ----
do $$
declare
  ann uuid := tests.account('sp-ann'); bob uuid := tests.account('sp-bob'); cat uuid := tests.account('sp-cat'); dan uuid := tests.account('sp-dan');
  a uuid := tests.character(ann, 'Spin Ann'); b uuid := tests.character(bob, 'Spin Bob'); c uuid := tests.character(cat, 'Spin Cat'); d uuid := tests.character(dan, 'Spin Dan');
  t uuid := tests.thread('Spin at');
  p_old uuid := tests.post(b, t, 'The post the glint was cast from.', now() - interval '3 hours');
  p uuid := tests.post(b, t, 'The post pressed.', now() - interval '2 hours');
  q uuid := tests.post(d, t, 'Another character''s post.', now() - interval '2 hours');
  k uuid; blot_one uuid; blot_two uuid; ed uuid; s1 uuid; s2 uuid; s_none uuid; s_post uuid; late_blot uuid; end_one uuid;
  saved jsonb := '{"strokes": [], "washed": 0.4}';
  why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'glint', 'glimmer', 'blot', 'blot', 'blot', 'sweetie', 'marquee');
  k := (play_card(ann, 'glint', a, b, '{}', 0, '', 'character', p_old) ->> 'id')::uuid;
  ed := tests.act(b, 'edit', t, '{"body": "Edited before the spin."}', p, now() - interval '30 minutes');
  blot_one := (play_card(ann, 'blot', a, p, '{"color": "yellow"}', 0, '') ->> 'id')::uuid;
  blot_two := (play_card(ann, 'blot', a, p, '{"color": "green"}', 0, '') ->> 'id')::uuid;
  perform save_effect_state(bob, b, blot_one, saved);
  -- One layer ended before the spin; the other ends after it.
  end_one := pg_temp.end_play(blot_one, t, now() - interval '5 minutes');

  s1 := pg_temp.spun_at(cat, c, k, p);
  if (select payload from acts where id = s1) is distinct from jsonb_build_object('title', (select payload ->> 'title' from acts where id = s1), 'body', 'Discuss.', 'at', p) then
    raise exception 'the spin''s payload is title, body and at: %', (select payload from acts where id = s1);
  end if;
  if (select target_act_id from acts where id = s1) is distinct from k then raise exception 'the spin''s target is still the play'; end if;
  if (select count(*) from spin_moments where spin = s1) is distinct from 1::bigint then raise exception 'a spin that names a post writes one moment'; end if;
  if (select post_version from spin_moments where spin = s1) is distinct from ed then raise exception 'a post edited before the spin snapshots the edit: %', (select post_version from spin_moments where spin = s1); end if;
  if (select count(*) from spin_moment_layers where spin = s1) is distinct from 2::bigint
     or (select state from spin_moment_layers where spin = s1 and layer = blot_one) is distinct from saved
     or (select saved_at from spin_moment_layers where spin = s1 and layer = blot_one) is distinct from (select saved_at from effect_state where play = blot_one)
     or (select state from spin_moment_layers where spin = s1 and layer = blot_two) is not null then
    raise exception 'the layers on the post are in the moment with the state each had saved: %', (select jsonb_agg(to_jsonb(l)) from spin_moment_layers l where l.spin = s1);
  end if;
  if exists (select 1 from spin_moment_layers where spin = s1 and layer = k) then raise exception 'the origin play is no layer of the snapshot: it is on another post'; end if;

  -- A spin of the same play again, as the form's Spin again anyway sends it: two spins, two moments.
  s2 := pg_temp.spun_at(cat, c, k, p_old);
  if (select count(*) from spin_moments where spin in (s1, s2)) is distinct from 2::bigint then raise exception 'two spins write two moments'; end if;
  if (select post_version from spin_moments where spin = s2) is distinct from p_old then raise exception 'a spin at the cast-from post itself names that post'; end if;

  -- No post: nothing written, for a character play and for a post.
  s_none := pg_temp.spun_at(cat, c, k, null);
  s_post := pg_temp.spun_at(cat, c, p, null);
  if (select payload ? 'at' from acts where id = s_none) or (select payload ? 'at' from acts where id = s_post) then raise exception 'a spin with no at_post writes no at'; end if;
  if exists (select 1 from spin_moments where spin in (s_none, s_post)) or exists (select 1 from spin_moment_layers where spin in (s_none, s_post)) then
    raise exception 'a spin with no at_post writes no moment';
  end if;

  -- The refusals: one sentence, one code, whichever check failed.
  declare
    on_post uuid := (play_card(ann, 'blot', a, q, '{}', 0, '') ->> 'id')::uuid;
    on_thread uuid := (play_card(ann, 'marquee', a, t, '{}', 0, '', 'thread') ->> 'id')::uuid;
    caught uuid; spent uuid; ended uuid;
    refused text[];
    label text[] := array['a post by another character', 'an Act that is no post (an edit)', 'an Act that is no post (the play)', 'a post that does not exist', 'a play on a post',
                          'a thread''s play', 'a caught play', 'a play whose time ran out', 'a play an admin ended', 'a spin from a post'];
    i integer;
  begin
    insert into acts (character, kind, thread, target_act_id, payload, created_at)
    values (a, 'card', t, p_old, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', b, 'caught', true), now() - interval '1 hour') returning id into caught;
    insert into play_reach (play, reach, character, ends_at) values (caught, 'character', b, now() + interval '1 day');
    insert into acts (character, kind, thread, target_act_id, payload, created_at)
    values (a, 'card', t, p_old, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', b), now() - interval '2 days') returning id into spent;
    insert into play_reach (play, reach, character, ends_at) values (spent, 'character', b, now() - interval '1 second');
    ended := (play_card(ann, 'glimmer', a, b, '{}', 0, '', 'character', p_old) ->> 'id')::uuid;
    perform pg_temp.end_play(ended, t);
    refused := array[
      pg_temp.spin_refusal(cat, c, k, q), pg_temp.spin_refusal(cat, c, k, ed), pg_temp.spin_refusal(cat, c, k, k), pg_temp.spin_refusal(cat, c, k, gen_random_uuid()),
      pg_temp.spin_refusal(cat, c, on_post, p), pg_temp.spin_refusal(cat, c, on_thread, p), pg_temp.spin_refusal(cat, c, caught, p),
      pg_temp.spin_refusal(cat, c, spent, p), pg_temp.spin_refusal(cat, c, ended, p), pg_temp.spin_refusal(cat, c, p, p)];
    for i in 1..array_length(refused, 1) loop
      if refused[i] is distinct from 'that card is not on that post|P0002' then raise exception '%: refused with %', label[i], refused[i]; end if;
    end loop;
    -- A refusal wrote nothing.
    if (select count(*) from acts where kind = 'spin' and payload ->> 'title' = 'Refused') is distinct from 0::bigint then raise exception 'a refused spin wrote an Act'; end if;
    -- And the owner of neither character reads a different answer: the refusals above were made by a third player; Ann (the play's caster) and Bob (the posts' owner) get the same.
    if pg_temp.spin_refusal(ann, a, k, q) is distinct from refused[1] or pg_temp.spin_refusal(bob, b, k, q) is distinct from refused[1] then
      raise exception 'the refusal differs with who asks';
    end if;
  end;

  -- The moment: the edit's words as of the spin, frozen against a later edit; a later layer is not in it; a layer's end after the spin is not in it.
  late_blot := (play_card(ann, 'sweetie', a, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.act(b, 'edit', t, '{"body": "Edited after the spin."}', p, now() + interval '1 minute');
  perform pg_temp.end_play(blot_two, t, now() + interval '1 minute');
  perform tests.become(dan);
  declare got jsonb := spin_moment(s1);
  begin
    perform tests.unbecome();
    if got -> 'version' ->> 'id' is distinct from p::text or got -> 'version' -> 'current_payload' is distinct from '{"body": "Edited before the spin."}'::jsonb then
      raise exception 'the version is the edit as of the spin, and a later edit leaves it: %', got -> 'version';
    end if;
    if got -> 'version' -> 'payload' is distinct from '{"body": "The post pressed."}'::jsonb then raise exception 'the post''s own payload is kept: %', got -> 'version'; end if;
    if jsonb_path_query_array(got -> 'layers', '$[0].act.id') is distinct from jsonb_build_array(k) or got -> 'layers' -> 0 -> 'state' is distinct from 'null'::jsonb then
      raise exception 'the origin play is layers[0], with no state: %', got -> 'layers' -> 0;
    end if;
    if (select array_agg(x order by x) from jsonb_path_query(got -> 'layers', '$[1 to last].act.id') x)
       is distinct from (select array_agg(to_jsonb(y::text) order by to_jsonb(y::text)) from unnest(array[blot_one, blot_two, end_one]) y) then
      raise exception 'then the snapshot''s layers and the ends at or before the spin; a later layer and a later end are not: %', got -> 'layers';
    end if;
    if (select l -> 'state' from jsonb_array_elements(got -> 'layers') l where l -> 'act' ->> 'id' = blot_one::text) is distinct from saved
       or (select l -> 'state' from jsonb_array_elements(got -> 'layers') l where l -> 'act' ->> 'id' = blot_two::text) is distinct from 'null'::jsonb then
      raise exception 'a layer carries the state it had saved: %', got -> 'layers';
    end if;
    if got::text like '%' || late_blot::text || '%' then raise exception 'a layer made after the spin is in its moment'; end if;
    if (got ->> 'at')::timestamptz is distinct from (select created_at from acts where id = s1) then raise exception '''at'' is the spin''s time: %', got ->> 'at'; end if;
    if got -> 'recorded' is distinct from 'true'::jsonb then raise exception 'a spin''s moment is recorded: %', got; end if;
    -- The same bytes for the caster, the post's owner, the spinner and a stranger.
    perform tests.become(ann); if spin_moment(s1) is distinct from got then raise exception 'the moment differs for the caster'; end if; perform tests.unbecome();
    perform tests.become(bob); if spin_moment(s1) is distinct from got then raise exception 'the moment differs for the post''s owner'; end if; perform tests.unbecome();
    perform tests.become(cat); if spin_moment(s1) is distinct from got then raise exception 'the moment differs for the spinner'; end if; perform tests.unbecome();
  end;

  -- A spin that names no post, something that is no spin, and nothing at all are refused in the same words.
  perform tests.become(dan);
  foreach why in array array[pg_temp.refusal(format('select spin_moment(%L)', s_none)), pg_temp.refusal(format('select spin_moment(%L)', p)),
                             pg_temp.refusal(format('select spin_moment(%L)', gen_random_uuid()))] loop
    if why is distinct from 'that spin names no post' then raise exception 'a read of a spin with no post is refused in words: %', why; end if;
  end loop;
  perform tests.unbecome();
  perform tests.become_anon();
  if pg_temp.refusal(format('select spin_moment(%L)', s1)) is null then raise exception 'a visitor read a spin''s moment'; end if;
  perform tests.unbecome();
end $$;

-- ---- The plays above: the live ones on the post's author, thread or board then; never the origin ----
do $$
declare
  ann uuid := tests.account('spa-ann'); bob uuid := tests.account('spa-bob'); cat uuid := tests.account('spa-cat');
  a uuid := tests.character(ann, 'Above Ann'); b uuid := tests.character(bob, 'Above Bob'); c uuid := tests.character(cat, 'Above Cat');
  t uuid := tests.thread('Spin above');
  p_old uuid := tests.post(b, t, 'Cast from.', now() - interval '3 hours');
  p uuid := tests.post(b, t, 'Pressed.', now() - interval '2 hours');
  origin uuid; other_live uuid; other_ended uuid; s uuid; got jsonb;
begin
  perform pg_temp.cards();
  -- The origin is older than the spin and live on Bob, which is what puts it among the plays above a post unless it is left out.
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (a, 'card', t, p_old, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', b), now() - interval '3 hours') returning id into origin;
  insert into play_reach (play, reach, character, ends_at) values (origin, 'character', b, now() + interval '1 day');
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (a, 'card', t, p_old, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', b), now() - interval '2 hours') returning id into other_live;
  insert into play_reach (play, reach, character, ends_at) values (other_live, 'character', b, now() + interval '1 day');
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (a, 'card', t, p_old, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', b), now() - interval '2 hours') returning id into other_ended;
  insert into play_reach (play, reach, character, ends_at) values (other_ended, 'character', b, now() + interval '1 day');
  perform pg_temp.end_play(other_ended, t, now() - interval '1 hour');
  s := pg_temp.spun_at(cat, c, origin, p);
  perform tests.become(cat);
  got := spin_moment(s);
  perform tests.unbecome();
  if (select jsonb_agg(e ->> 'play') from jsonb_array_elements(got -> 'above') e) is distinct from jsonb_build_array(other_live::text) then
    raise exception 'above is the other play live then, never the origin and never one ended before: %', got -> 'above';
  end if;
  if (select e from jsonb_array_elements(got -> 'above') e) is distinct from
     jsonb_build_object('play', other_live, 'reach', 'character', 'target', b, 'ends_at', now() + interval '1 day', 'act', act_projection(other_live)) then
    raise exception 'each play above as play_moment gives it: %', got -> 'above';
  end if;
  if jsonb_path_query_array(got -> 'layers', '$[*].act.id') is distinct from jsonb_build_array(origin) then raise exception 'the origin play is layers[0] alone: %', got -> 'layers'; end if;
end $$;

-- ---- A version hidden after the spin reads as acts_public shows it ----
do $$
declare
  ann uuid := tests.account('sph-ann'); bob uuid := tests.account('sph-bob'); cat uuid := tests.account('sph-cat');
  a uuid := tests.character(ann, 'Hide Ann'); b uuid := tests.character(bob, 'Hide Bob'); c uuid := tests.character(cat, 'Hide Cat');
  t uuid := tests.thread('Spin hidden');
  p_old uuid := tests.post(b, t, 'Cast from.', now() - interval '3 hours');
  hide_original uuid := tests.post(b, t, 'Words to be hidden.', now() - interval '2 hours');
  hide_edit uuid := tests.post(b, t, 'Fine words.', now() - interval '2 hours');
  the_edit uuid; origin uuid; s_original uuid; s_edit uuid; got jsonb;
begin
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (a, 'card', t, p_old, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', b), now() - interval '3 hours') returning id into origin;
  insert into play_reach (play, reach, character, ends_at) values (origin, 'character', b, now() + interval '1 day');
  the_edit := tests.act(b, 'edit', t, '{"body": "Edited words to be hidden."}', hide_edit, now() - interval '1 hour');
  s_original := pg_temp.spun_at(cat, c, origin, hide_original);
  s_edit := pg_temp.spun_at(cat, c, origin, hide_edit);
  perform tests.become(cat);
  got := spin_moment(s_original);
  perform tests.unbecome();
  if got -> 'version' -> 'current_payload' is distinct from '{"body": "Words to be hidden."}'::jsonb then raise exception 'before it is hidden the words are served: %', got -> 'version'; end if;
  insert into admins (account) values (ann);
  insert into conduct_decisions (post, version_act, admin, outcome) values (hide_original, hide_original, ann, 'hide'), (hide_edit, the_edit, ann, 'hide');
  perform tests.become(cat);
  got := spin_moment(s_original);
  if got -> 'version' -> 'current_payload' is distinct from (select payload from acts_public where id = hide_original)
     or got -> 'version' -> 'current_payload' ->> 'body' = 'Words to be hidden.' then
    raise exception 'a hidden original leaves the moment, as acts_public shows it: %', got -> 'version' -> 'current_payload';
  end if;
  got := spin_moment(s_edit);
  perform tests.unbecome();
  if got -> 'version' -> 'current_payload' is distinct from (select payload from acts_public where id = the_edit)
     or got -> 'version' -> 'current_payload' ->> 'body' = 'Edited words to be hidden.' then
    raise exception 'a hidden edit leaves the moment, as acts_public shows it: %', got -> 'version' -> 'current_payload';
  end if;
end $$;

-- ---- thread_open.origin_place: the cast-from post and the pressed post ----
do $$
declare
  ann uuid := tests.account('spp-ann'); bob uuid := tests.account('spp-bob'); cat uuid := tests.account('spp-cat');
  a uuid := tests.character(ann, 'Place Ann'); b uuid := tests.character(bob, 'Place Bob'); c uuid := tests.character(cat, 'Place Cat');
  t_from uuid := tests.thread('Place cast from'); t_at uuid := tests.thread('Place pressed');
  general uuid := (select id from boards where slug = 'general');
  from_post uuid; at_post uuid; k uuid; blot uuid; marquee uuid; quake uuid; s_at uuid; s_from uuid; s_post uuid; s_thread uuid; s_board uuid;
  from_place jsonb; at_place jsonb; on_b jsonb;
begin
  perform pg_temp.cards();
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values ('quake', 'Quake', 'salty', 'legendary', 'cast', null, '{board}', interval '1 day') on conflict (key) do nothing;
  perform tests.post(b, t_from, 'First.');
  from_post := tests.post(b, t_from, 'Cast from here.');
  perform tests.post(b, t_at, 'First.');
  at_post := tests.post(b, t_at, 'Pressed here.');
  from_place := jsonb_build_object('kind', 'post', 'thread', t_from, 'title', 'Place cast from', 'seq', (select seq from acts where id = from_post));
  at_place := jsonb_build_object('kind', 'post', 'thread', t_at, 'title', 'Place pressed', 'seq', (select seq from acts where id = at_post));
  on_b := jsonb_build_object('kind', 'character', 'id', b, 'name', 'Place Bob');
  perform pg_temp.hand(ann, 'glint', 'blot', 'marquee', 'quake');
  k := (play_card(ann, 'glint', a, b, '{}', 0, '', 'character', from_post) ->> 'id')::uuid;
  s_at := pg_temp.spun_at(cat, c, k, at_post);
  s_from := pg_temp.spun_at(cat, c, k, null);
  if pg_temp.place(s_at) is distinct from jsonb_build_object('kind', 'play', 'card', 'glint', 'on', on_b, 'from', from_place, 'at', at_place) then
    raise exception 'a spin at a post: %', pg_temp.place(s_at);
  end if;
  if pg_temp.place(s_from) is distinct from jsonb_build_object('kind', 'play', 'card', 'glint', 'on', on_b, 'from', from_place, 'at', null) then
    raise exception 'a spin with no post has the cast-from post alone: %', pg_temp.place(s_from);
  end if;
  -- A play on a post, a thread's play and a board's play: neither key, and the rest as before.
  blot := (play_card(ann, 'blot', a, at_post, '{}', 0, '') ->> 'id')::uuid;
  marquee := (play_card(ann, 'marquee', a, t_at, '{}', 0, '', 'thread') ->> 'id')::uuid;
  quake := (play_card(ann, 'quake', a, general, '{}', 0, '', 'board') ->> 'id')::uuid;
  s_post := pg_temp.spun_at(cat, c, blot, null);
  s_thread := pg_temp.spun_at(cat, c, marquee, null);
  s_board := pg_temp.spun_at(cat, c, quake, null);
  if pg_temp.place(s_post) is distinct from jsonb_build_object('kind', 'play', 'card', 'blot', 'on', at_place, 'from', null, 'at', null) then raise exception 'a spin from a play on a post: %', pg_temp.place(s_post); end if;
  if pg_temp.place(s_thread) is distinct from jsonb_build_object('kind', 'play', 'card', 'marquee', 'on', jsonb_build_object('kind', 'thread', 'id', t_at, 'title', 'Place pressed'), 'from', null, 'at', null) then
    raise exception 'a spin from a thread''s play: %', pg_temp.place(s_thread);
  end if;
  if pg_temp.place(s_board) is distinct from jsonb_build_object('kind', 'play', 'card', 'quake', 'on', jsonb_build_object('kind', 'board', 'slug', 'general', 'name', 'General'), 'from', null, 'at', null) then
    raise exception 'a spin from a board''s play: %', pg_temp.place(s_board);
  end if;
end $$;

-- ---- Written once and never changed; read by a signed-in player; the trigger an ordinary one ----
do $$
declare
  ann uuid := tests.account('spw-ann'); bob uuid := tests.account('spw-bob'); cat uuid := tests.account('spw-cat');
  a uuid := tests.character(ann, 'Write Ann'); b uuid := tests.character(bob, 'Write Bob'); c uuid := tests.character(cat, 'Write Cat');
  t uuid := tests.thread('Spin written'); p uuid := tests.post(b, t, 'Me.'); k uuid; blot uuid; s uuid; why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'glint', 'blot');
  k := (play_card(ann, 'glint', a, b, '{}', 0, '', 'character', p) ->> 'id')::uuid;
  blot := (play_card(ann, 'blot', a, p, '{}', 0, '') ->> 'id')::uuid;
  s := pg_temp.spun_at(cat, c, k, p);
  foreach why in array array[
    pg_temp.refusal(format('update spin_moments set post_version = post_version where spin = %L', s)),
    pg_temp.refusal(format('delete from spin_moments where spin = %L', s)),
    pg_temp.refusal('truncate spin_moments, spin_moment_layers'),
    pg_temp.refusal(format('update spin_moment_layers set state = %L where spin = %L', '{}', s)),
    pg_temp.refusal(format('delete from spin_moment_layers where spin = %L', s)),
    pg_temp.refusal('truncate spin_moment_layers')] loop
    if why is null or why not like '%moment%never%' then raise exception 'a spin''s moment was changed, or refused for the wrong reason: %', why; end if;
  end loop;
  if (select string_agg(tgname || ':' || tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid in ('spin_moments'::regclass, 'spin_moment_layers'::regclass) and tgname like '%no_truncate')
     is distinct from 'spin_moment_layers_no_truncate:A,spin_moments_no_truncate:A' then
    raise exception 'the truncate guards fire always: %', (select string_agg(tgname || ':' || tgenabled::text, ',') from pg_trigger where tgrelid in ('spin_moments'::regclass, 'spin_moment_layers'::regclass));
  end if;
  if (select tgenabled from pg_trigger where tgname = 'acts_take_spin_moment') is distinct from 'O' then raise exception 'the moment''s trigger is an ordinary one'; end if;
  perform tests.become_anon();
  if pg_temp.refusal('select count(*) from spin_moments') is null or pg_temp.refusal('select count(*) from spin_moment_layers') is null then raise exception 'a visitor reads a spin''s moment'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if (select count(*) from spin_moments where spin = s) is distinct from 1::bigint or (select count(*) from spin_moment_layers where spin = s) is distinct from 1::bigint then
    raise exception 'a signed-in player reads the moments';
  end if;
  if pg_temp.refusal(format('insert into spin_moments (spin, post_version) values (%L, %L)', s, p)) is null then raise exception 'a player wrote a spin''s moment'; end if;
  perform tests.unbecome();
end $$;

-- ---- The cost: a deep board page whose skipped rows are half spun from a character play with a post ----
-- Two boards of 5,000 threads each: one spun from posts alone, one with every other thread spun from a play on a character at a post. The page is the one the board
-- reads (thread_list, by board, newest first), at offset 2000, as 0152's header measures it. The figures are written in the migration's header, measured on committed
-- rows after a VACUUM ANALYZE, which this transaction cannot be: its plan is slower than an instance's whatever the view says. So this guard is a ratio, between the two
-- boards in the same transaction under the same plan, and it fails a read of the new joins that grows past a small multiple of the plain page.
do $$
declare
  ann uuid := tests.account('spc-ann'); a uuid := tests.character(ann, 'Cost Ann'); b uuid := tests.character(ann, 'Cost Bob');
  t uuid := tests.thread('Cost'); plain uuid; spun uuid;
  p uuid := tests.post(b, t, 'Cost post.', now() - interval '2 days'); p_old uuid := tests.post(b, t, 'Cast from.', now() - interval '2 days');
  k uuid; plan jsonb; ms numeric; best_plain numeric := 1e9; best_spun numeric := 1e9;
begin
  insert into boards (slug, name) values ('spc-plain', 'Cost plain') returning id into plain;
  insert into boards (slug, name) values ('spc-spun', 'Cost spun') returning id into spun;
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (a, 'card', t, p_old, jsonb_build_object('card', 'sweetie', 'reach', 'character', 'character', b), now() - interval '2 days') returning id into k;
  insert into play_reach (play, reach, character, ends_at) values (k, 'character', b, now() + interval '1 day');
  set local session_replication_role = replica;
  with made as (
    insert into threads (board, title, origin_act_id, created_at, last_at, next_seq, origin_board)
    select bd, 'Cost ' || i, case when bd = spun and i % 2 = 0 then k else p end, now() - make_interval(secs => i), now() - make_interval(secs => i), 2, bd
    from generate_series(1, 5000) i cross join (values (plain), (spun)) v(bd)
    returning id, origin_act_id)
  insert into acts (character, kind, thread, target_act_id, payload, seq, created_at)
  select a, 'spin', m.id, m.origin_act_id, case when m.origin_act_id = k then jsonb_build_object('title', 'x', 'body', '', 'at', p) else jsonb_build_object('title', 'x', 'body', '') end, 1, now() from made m;
  set local session_replication_role = origin;
  analyze threads; analyze acts; analyze play_reach;
  for i in 1..3 loop
    execute format('explain (analyze, format json) select * from thread_list where board = %L order by last_at desc offset 2000 limit 20', plain) into plan;
    best_plain := least(best_plain, (plan -> 0 ->> 'Execution Time')::numeric);
    execute format('explain (analyze, format json) select * from thread_list where board = %L order by last_at desc offset 2000 limit 20', spun) into plan;
    best_spun := least(best_spun, (plan -> 0 ->> 'Execution Time')::numeric);
  end loop;
  raise notice 'the deep page (offset 2000 of 5,000 threads) ran in % ms with every thread spun from a post and % ms with half spun from a character play at a post (best of three, in a transaction)', best_plain, best_spun;
  if best_spun > 3 * best_plain + 250 then raise exception 'the deep page took % ms against % ms for a board of plain spins; thread_open''s joins grew past a probe per skipped row', best_spun, best_plain; end if;
  if (select count(*) from thread_list where board = spun and origin_place -> 'at' is not null and origin_place -> 'at' <> 'null'::jsonb) is distinct from 2500::bigint then
    raise exception 'half the threads name the post they were pressed at';
  end if;
end $$;
