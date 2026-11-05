-- An admin ends a card play (supabase/migrations/0092_card_end.sql; design docs/plans/2026-11-05-bot-card-options-design.md,
-- section 3; plan Task 1). `card_end` is an Act of no character, the play for its target, in the play's thread, taking no seq,
-- written only by reverse_card (the flag kayfabb.card_end_writer) and at most one per play.
-- Later tasks of the plan append their sections below Task 1's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm || ' [' || sqlstate || ']';
end $$;

-- ====================================================================================== Task 1: the Act and reverse_card ====

-- ---- Fixtures: an admin, a player, a caster, a post's author, and a play of each kind ----
do $$
declare
  admin_acc uuid := tests.account('ce-admin');
  player uuid := tests.account('ce-player');
  caster uuid := tests.character(player, 'Ce Caster');
  author uuid := tests.character(tests.account('ce-author'), 'Ce Author');
  t uuid := tests.thread('Card end');
  p uuid := tests.post(author, t, 'A post.');
begin
  insert into admins (account) values (admin_acc);
end $$;

-- ---- An admin ends a live Cast on a post: one card_end, no character, with the payload shown ----
do $$
declare
  admin_acc uuid := (select id from auth.users where email = 'ce-admin@test.invalid');
  caster uuid := (select id from characters where name = 'Ce Caster');
  p uuid := (select id from acts where kind = 'post' and payload ->> 'body' = 'A post.');
  t uuid := (select thread from acts where id = p);
  play uuid := tests.act(caster, 'card', t, '{"card": "splat"}', p);
  got jsonb;
  n integer;
begin
  perform tests.become(admin_acc);
  got := reverse_card(play);
  perform tests.unbecome();
  select count(*) into n from acts where kind = 'card_end' and target_act_id = play;
  if n <> 1 then raise exception 'one card_end per reversed play, got %', n; end if;
  if (select character from acts where id = (got ->> 'id')::uuid) is not null then raise exception 'a card_end belongs to no character'; end if;
  if got ->> 'kind' <> 'card_end' or (got ->> 'play')::uuid <> play or (got ->> 'target_act_id')::uuid <> play then
    raise exception 'the answer is the card_end''s projection and the play: %', got;
  end if;
  if got -> 'payload' <> '{"why": "reversed", "by": "admin"}'::jsonb then raise exception 'the payload says why and by whom: %', got -> 'payload'; end if;
  if (got ->> 'thread')::uuid <> t then raise exception 'the card_end sits in the play''s thread'; end if;
  if got ->> 'seq' is not null then raise exception 'a card_end takes no seq'; end if;
  if (select next_seq from threads where id = t) is distinct from 2 then raise exception 'a card_end leaves its thread''s counters alone'; end if;
  if not card_ended(play) then raise exception 'card_ended says the reversed play ended'; end if;
  if card_ended(p) then raise exception 'card_ended is false for a play nobody ended'; end if;
  if current_setting('kayfabb.card_end_writer', true) not in ('', 'off') then raise exception 'the writer flag was left set'; end if;
end $$;

-- ---- A second call refuses; a non-admin and a visitor are refused ----
do $$
declare
  admin_acc uuid := (select id from auth.users where email = 'ce-admin@test.invalid');
  player uuid := (select id from auth.users where email = 'ce-player@test.invalid');
  done uuid := (select target_act_id from acts where kind = 'card_end' limit 1);
  fresh uuid := tests.act((select id from characters where name = 'Ce Caster'), 'card', (select thread from acts where id = done), '{"card": "splat"}',
                          (select id from acts where kind = 'post' and payload ->> 'body' = 'A post.'));
  why text;
begin
  perform tests.become(admin_acc);
  why := pg_temp.refusal(format('select reverse_card(%L)', done));
  perform tests.unbecome();
  if why is null or why not like 'an admin has already ended that card%' then raise exception 'a second reversal refuses in plain words: %', why; end if;

  perform tests.become(player);
  why := pg_temp.refusal(format('select reverse_card(%L)', fresh));
  perform tests.unbecome();
  if why is null or why not like '%[42501]' then raise exception 'a player is refused with 42501: %', why; end if;
  if card_ended(fresh) then raise exception 'a refused call ended nothing'; end if;

  perform tests.become_anon();
  why := pg_temp.refusal(format('select reverse_card(%L)', fresh));
  perform tests.unbecome();
  if why is null or why not like '%[42501]' then raise exception 'a visitor cannot call reverse_card: %', why; end if;
end $$;

-- ---- The four refusals, each in its own words; a face-down Set is not a card play ----
do $$
declare
  admin_acc uuid := (select id from auth.users where email = 'ce-admin@test.invalid');
  caster uuid := (select id from characters where name = 'Ce Caster');
  author uuid := (select id from characters where name = 'Ce Author');
  p uuid := (select id from acts where kind = 'post' and payload ->> 'body' = 'A post.');
  t uuid := (select thread from acts where id = p);
  caught uuid := tests.act(caster, 'card', t, jsonb_build_object('card', 'splat', 'caught', gen_random_uuid()), p);
  worn uuid := tests.act(caster, 'card', t, jsonb_build_object('card', 'selfie', 'ends', now() - interval '1 hour'), p);
  worn_reach uuid := tests.act(caster, 'card', t, '{"card": "selfie", "reach": "character"}', p);
  face_down uuid := tests.act(author, 'set', t, '{}', p);
  why text;
begin
  insert into play_reach (play, reach, character, ends_at) values (worn_reach, 'character', author, now() - interval '1 hour');
  perform tests.become(admin_acc);
  why := pg_temp.refusal(format('select reverse_card(%L)', p));
  if why is null or why not like 'that is not a card play%' then raise exception 'a post is not a card play: %', why; end if;
  why := pg_temp.refusal(format('select reverse_card(%L)', face_down));
  if why is null or why not like 'that is not a card play%' then raise exception 'a Set is not a card play, and the words say nothing of a back: %', why; end if;
  if why ~* 'face|set|back' then raise exception 'the refusal for a Set must not hint at a back: %', why; end if;
  why := pg_temp.refusal(format('select reverse_card(%L)', gen_random_uuid()));
  if why is null or why not like 'that is not a card play%' then raise exception 'no such Act reads as no card play: %', why; end if;
  why := pg_temp.refusal(format('select reverse_card(%L)', caught));
  if why is null or why not like 'that card was caught by a trap, so it never landed%' then raise exception 'a caught play: %', why; end if;
  why := pg_temp.refusal(format('select reverse_card(%L)', worn));
  if why is null or why not like 'that card has already worn off%' then raise exception 'an expired Use: %', why; end if;
  why := pg_temp.refusal(format('select reverse_card(%L)', worn_reach));
  if why is null or why not like 'that card has already worn off%' then raise exception 'a play whose play_reach end has passed: %', why; end if;
  perform tests.unbecome();
  if exists (select 1 from acts where kind = 'card_end' and target_act_id in (caught, worn, worn_reach, face_down)) then raise exception 'a refusal wrote a card_end'; end if;
end $$;

-- ---- A play on a character, on a thread and on a board each end the same way ----
do $$
declare
  admin_acc uuid := (select id from auth.users where email = 'ce-admin@test.invalid');
  caster uuid := (select id from characters where name = 'Ce Caster');
  author uuid := (select id from characters where name = 'Ce Author');
  p uuid := (select id from acts where kind = 'post' and payload ->> 'body' = 'A post.');
  t uuid := (select thread from acts where id = p);
  on_character uuid := tests.act(caster, 'card', t, '{"card": "selfie", "reach": "character"}', p);
  on_thread uuid := tests.act(caster, 'card', t, '{"card": "marquee", "reach": "thread"}', p);
  on_board uuid := tests.act(caster, 'card', t, '{"card": "quake", "reach": "board"}', null);
  on_use uuid := tests.act(caster, 'card', t, jsonb_build_object('card', 'selfie', 'ends', now() + interval '1 day'), p);
  one uuid;
  got jsonb;
begin
  insert into play_reach (play, reach, character, ends_at) values (on_character, 'character', author, now() + interval '1 day');
  insert into play_reach (play, reach, thread, ends_at) values (on_thread, 'thread', t, now() + interval '1 day');
  insert into play_reach (play, reach, board, ends_at) values (on_board, 'board', (select board from threads where id = t), now() + interval '1 day');
  perform tests.become(admin_acc);
  foreach one in array array[on_character, on_thread, on_board, on_use] loop
    got := reverse_card(one);
    if (got ->> 'play')::uuid <> one or got -> 'payload' <> '{"why": "reversed", "by": "admin"}'::jsonb or got ->> 'character' is not null then
      raise exception 'play % did not end the same way: %', one, got;
    end if;
    if not card_ended(one) then raise exception 'play % does not read as ended', one; end if;
  end loop;
  perform tests.unbecome();
end $$;

-- ---- The function is the admin's by grant and pins its search_path ----
do $$
begin
  if not has_function_privilege('authenticated', 'reverse_card(uuid)', 'execute') then raise exception 'reverse_card is granted to authenticated'; end if;
  if has_function_privilege('anon', 'reverse_card(uuid)', 'execute') then raise exception 'a visitor cannot execute reverse_card'; end if;
  if not exists (select 1 from pg_proc p where p.proname = 'reverse_card' and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp')) then
    raise exception 'reverse_card is security definer with a pinned search_path';
  end if;
end $$;

-- ---- The poisons: each way to write a card_end that is not reverse_card's, or is malformed, fails ----
do $$
declare
  caster uuid := (select id from characters where name = 'Ce Caster');
  author uuid := (select id from characters where name = 'Ce Author');
  p uuid := (select id from acts where kind = 'post' and payload ->> 'body' = 'A post.');
  t uuid := (select thread from acts where id = p);
  play uuid := tests.act(caster, 'card', t, '{"card": "splat"}', p);
  other_thread uuid := tests.thread('Another thread');
  why text;
begin
  -- Without the flag.
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', %L, %L, '{"why": "reversed", "by": "admin"}')$s$, t, play));
  if why is null or why not like 'a card ends only through reverse_card%' then raise exception 'a card_end without the flag must fail: %', why; end if;

  -- With the flag from here: each of the rest fails on its own defect, not on the missing flag.
  perform set_config('kayfabb.card_end_writer', 'on', true);
  -- Targeting a post.
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', %L, %L, '{"why": "reversed", "by": "admin"}')$s$, t, p));
  if why is null or why not like 'a card_end is of a card play, in its thread%' then raise exception 'a card_end targeting a post must fail: %', why; end if;
  -- Out of the play's thread.
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', %L, %L, '{"why": "reversed", "by": "admin"}')$s$, other_thread, play));
  if why is null or why not like 'a card_end is of a card play, in its thread%' then raise exception 'a card_end out of its play''s thread must fail: %', why; end if;
  -- With a character.
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'card_end', %L, %L, '{"why": "reversed", "by": "admin"}')$s$, author, t, play));
  if why is null or why not like '%acts_character_null%' then raise exception 'a card_end with a character must fail: %', why; end if;
  -- With the wrong payload.
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', %L, %L, '{"why": "reversed", "by": "boss"}')$s$, t, play));
  if why is null or why not like '%acts_card_end_payload%' then raise exception 'a card_end by boss must fail the payload check: %', why; end if;
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', %L, %L, '{"why": "reversed", "by": "admin", "extra": 1}')$s$, t, play));
  if why is null or why not like '%acts_card_end_payload%' then raise exception 'a card_end with an extra key must fail the payload check: %', why; end if;
  -- With no target.
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (null, 'card_end', %L, '{"why": "reversed", "by": "admin"}')$s$, t));
  if why is null or why not like '%acts_check1%' then raise exception 'a card_end with no target must fail: %', why; end if;
  -- A good one lands, and a second on the same play fails on the index.
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, play, '{"why": "reversed", "by": "admin"}');
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', %L, %L, '{"why": "reversed", "by": "admin"}')$s$, t, play));
  if why is null or why not like '%acts_one_card_end%' then raise exception 'a second card_end on one play must fail on the index: %', why; end if;
  perform set_config('kayfabb.card_end_writer', '', true);
end $$;

-- ============================================================================ Task 2: a reversed play stops counting ====
-- Every server reader of "this card is in force" leaves a play with a card_end out, and the layer still counts it. Each block sets a
-- reversed play beside an identical live one and asks the reader to tell them apart. Red before the Task 2 section of the migration:
-- every reader still counts the reversed play.

create function pg_temp.end_play(play uuid) returns void language plpgsql as $$
begin
  perform tests.become((select id from auth.users where email = 'ce-admin@test.invalid'));
  perform reverse_card(play);
  perform tests.unbecome();
end $$;

do $$
begin
  update settings set value = value || '{"cetwo.price": 100}' where key = 'economy';
  insert into card_kinds (key, name, alignment, price_setting, rarity, play, stack, ward, lasts, reaches, pins, trap) values
    ('ce-wh', 'Ce Whoops', 'salty', 'cetwo.price', 'common', 'cast', 3, false, null, '{post}', false, null),
    ('ce-wd', 'Ce Ward', 'sweet', 'cetwo.price', 'uncommon', 'use', 1, true, interval '7 days', '{post}', false, null),
    ('ce-ch', 'Ce Character', 'sweet', 'cetwo.price', 'common', 'cast', 1, false, interval '7 days', '{character}', false, null),
    ('ce-th', 'Ce Thread', 'sweet', 'cetwo.price', 'common', 'cast', 1, false, interval '1 day', '{thread}', false, null),
    ('ce-pin', 'Ce Pin', 'sweet', 'cetwo.price', 'common', 'cast', 1, false, interval '1 day', '{thread}', true, null),
    ('ce-bd', 'Ce Board', 'salty', 'cetwo.price', 'common', 'cast', 1, false, interval '1 day', '{board}', false, null),
    ('ce-bd2', 'Ce Board Two', 'salty', 'cetwo.price', 'common', 'cast', 1, false, interval '1 day', '{board}', false, null),
    ('ce-hook', 'Ce Hook', 'salty', 'cetwo.price', 'common', 'set', 1, false, null, '{post}', false,
      '{"trigger": {"on": "reply"}, "outcome": {"do": "strike", "card": "ce-wh"}}');
end $$;

-- ---- card_target: the post's effects leave the reversed play out and keep the identical live one ----
do $$
declare
  caster uuid := (select id from characters where name = 'Ce Caster');
  author uuid := (select id from characters where name = 'Ce Author');
  t uuid := tests.thread('Card end readers');
  p uuid := tests.post(author, t, 'A post with two plays.');
  live uuid := tests.act(caster, 'card', t, '{"card": "ce-wh", "layer": 1}', p);
  gone uuid := tests.act(caster, 'card', t, '{"card": "ce-wh", "layer": 2}', p);
  got jsonb;
begin
  perform pg_temp.end_play(gone);
  got := card_target(p) -> 'effects';
  if jsonb_array_length(got) is distinct from 1 or got #>> '{0,act}' <> live::text then raise exception 'card_target keeps the live play and drops the reversed one: %', got; end if;
end $$;

-- ---- place_cast: the stack drops the reversed play but the layer goes on from it ----
do $$
declare
  admin_acc uuid := (select id from auth.users where email = 'ce-admin@test.invalid');
  player uuid := (select id from auth.users where email = 'ce-player@test.invalid');
  caster uuid := (select id from characters where name = 'Ce Caster');
  author uuid := (select id from characters where name = 'Ce Author');
  t uuid := tests.thread('Card end stack');
  p uuid := tests.post(author, t, 'Three Whoops.');
  p_ctl uuid := tests.post(author, t, 'Three Whoops, none reversed.');
  r jsonb; second uuid; why text;
begin
  for i in 1..3 loop
    r := place_cast(caster, 'ce-wh', p, '{}', '', 'post', null, player, 0);
    if i = 2 then second := (r ->> 'id')::uuid; end if;
    perform place_cast(caster, 'ce-wh', p_ctl, '{}', '', 'post', null, player, 0);
  end loop;
  why := pg_temp.refusal(format($s$select place_cast(%L, 'ce-wh', %L, '{}', '', 'post', null, %L, 0)$s$, caster, p, player));
  if why is null or why not like 'this post already carries 3 of that card%' then raise exception 'the full stack refuses the fourth: %', why; end if;
  perform pg_temp.end_play(second);
  r := place_cast(caster, 'ce-wh', p, '{}', '', 'post', null, player, 0);
  if (r -> 'payload' ->> 'layer')::integer is distinct from 4 then raise exception 'the fourth Whoops! takes layer 4, not a reused 3: %', r -> 'payload'; end if;
  why := pg_temp.refusal(format($s$select place_cast(%L, 'ce-wh', %L, '{}', '', 'post', null, %L, 0)$s$, caster, p, player));
  if why is null or why not like 'this post already carries 3 of that card%' then raise exception 'the stack is full again at three live plays: %', why; end if;
  why := pg_temp.refusal(format($s$select place_cast(%L, 'ce-wh', %L, '{}', '', 'post', null, %L, 0)$s$, caster, p_ctl, player));
  if why is null then raise exception 'an unreversed stack of three is still full'; end if;
end $$;

-- ---- place_cast: a reversed ward turns away nothing; a live one still does ----
do $$
declare
  player uuid := (select id from auth.users where email = 'ce-player@test.invalid');
  caster uuid := (select id from characters where name = 'Ce Caster');
  author uuid := (select id from characters where name = 'Ce Author');
  t uuid := tests.thread('Card end wards');
  warded uuid := tests.post(author, t, 'Reversed ward.');
  still uuid := tests.post(author, t, 'Live ward.');
  w uuid := tests.act(author, 'card', t, '{"card": "ce-wd", "layer": 1}', warded);
  why text;
begin
  perform tests.act(author, 'card', t, '{"card": "ce-wd", "layer": 1}', still);
  why := pg_temp.refusal(format($s$select place_cast(%L, 'ce-wh', %L, '{}', '', 'post', null, %L, 0)$s$, caster, warded, player));
  if why is null or why not like '%turns away cards%' then raise exception 'a live ward turns the cast away: %', why; end if;
  perform pg_temp.end_play(w);
  perform place_cast(caster, 'ce-wh', warded, '{}', '', 'post', null, player, 0);
  why := pg_temp.refusal(format($s$select place_cast(%L, 'ce-wh', %L, '{}', '', 'post', null, %L, 0)$s$, caster, still, player));
  if why is null or why not like '%turns away cards%' then raise exception 'the identical live ward still turns the cast away: %', why; end if;
end $$;

-- ---- spring_traps: a strike's stack leaves the reversed play out and keeps its layer ----
do $$
declare
  player uuid := (select id from auth.users where email = 'ce-player@test.invalid');
  caster uuid := (select id from characters where name = 'Ce Caster');
  author uuid := (select id from characters where name = 'Ce Author');
  t uuid := tests.thread('Card end traps');
  trapped uuid := tests.post(author, t, 'Trapped.');
  reply uuid := tests.post(caster, t, 'A reply carrying three.');
  trapped2 uuid := tests.post(author, t, 'Trapped, control.');
  reply2 uuid := tests.post(caster, t, 'A reply carrying three, none reversed.');
  mid uuid; got jsonb;
begin
  perform place_set(author, 'ce-hook', trapped, '{}', player, 0);
  perform place_set(author, 'ce-hook', trapped2, '{}', player, 0);
  perform tests.act(caster, 'card', t, '{"card": "ce-wh", "layer": 1}', reply);
  mid := tests.act(caster, 'card', t, '{"card": "ce-wh", "layer": 2}', reply);
  perform tests.act(caster, 'card', t, '{"card": "ce-wh", "layer": 3}', reply);
  perform tests.act(caster, 'card', t, '{"card": "ce-wh", "layer": 1}', reply2);
  perform tests.act(caster, 'card', t, '{"card": "ce-wh", "layer": 2}', reply2);
  perform tests.act(caster, 'card', t, '{"card": "ce-wh", "layer": 3}', reply2);
  if spring_traps('reply', trapped2, reply2) is not null then raise exception 'a full live stack leaves the trap set'; end if;
  if spring_traps('reply', trapped, reply) is not null then raise exception 'three live plays leave the trap set'; end if;
  perform pg_temp.end_play(mid);
  got := spring_traps('reply', trapped, reply);
  if got is null or got -> 'struck' is null then raise exception 'two live plays and one reversed take the strike: %', got; end if;
  if (got -> 'struck' -> 'payload' ->> 'layer')::integer is distinct from 4 then raise exception 'the strike takes layer 4: %', got -> 'struck' -> 'payload'; end if;
end $$;

-- ---- The plays beyond a post: reach_effects, effects_above and pinned_threads leave a reversed play out ----
do $$
declare
  player uuid := (select id from auth.users where email = 'ce-player@test.invalid');
  caster uuid := (select id from characters where name = 'Ce Caster');
  author uuid := (select id from characters where name = 'Ce Author');
  brd uuid; t_live uuid; t_gone uuid; p_live uuid; p_gone uuid; live uuid; gone uuid; got jsonb;
  c_live uuid := tests.character(player, 'Ce Mask Live'); c_gone uuid := tests.character(player, 'Ce Mask Gone');
  ch_live uuid; ch_gone uuid;
begin
  insert into boards (slug, name) values ('ce-board', 'Ce Board') returning id into brd;
  insert into threads (board, title) values (brd, 'Ce live pin') returning id into t_live;
  insert into threads (board, title) values (brd, 'Ce reversed pin') returning id into t_gone;
  p_live := tests.post(author, t_live, 'Pinned.'); p_gone := tests.post(author, t_gone, 'Pinned, then not.');
  live := tests.act(caster, 'card', t_live, jsonb_build_object('card', 'ce-pin', 'reach', 'thread', 'thread', t_live, 'ends', now() + interval '1 day'), p_live);
  gone := tests.act(caster, 'card', t_gone, jsonb_build_object('card', 'ce-pin', 'reach', 'thread', 'thread', t_gone, 'ends', now() + interval '1 day'), p_gone);
  insert into play_reach (play, reach, thread, pins_board, ends_at) values (live, 'thread', t_live, brd, now() + interval '1 day'), (gone, 'thread', t_gone, brd, now() + interval '1 day');
  ch_live := tests.act(caster, 'card', t_live, jsonb_build_object('card', 'ce-ch', 'reach', 'character', 'character', c_live, 'ends', now() + interval '1 day'), p_live);
  ch_gone := tests.act(caster, 'card', t_live, jsonb_build_object('card', 'ce-ch', 'reach', 'character', 'character', c_gone, 'ends', now() + interval '1 day'), p_live);
  insert into play_reach (play, reach, character, ends_at) values (ch_live, 'character', c_live, now() + interval '1 day'), (ch_gone, 'character', c_gone, now() + interval '1 day');

  perform tests.become(player);
  got := (select jsonb_agg(to_jsonb(x)) from pinned_threads(brd) x);
  perform tests.unbecome();
  if jsonb_array_length(got) is distinct from 2 then raise exception 'both pins are up before a reversal: %', got; end if;
  perform pg_temp.end_play(gone); perform pg_temp.end_play(ch_gone);
  perform tests.become(player);
  got := (select jsonb_agg(to_jsonb(x)) from pinned_threads(brd) x);
  perform tests.unbecome();
  if jsonb_array_length(got) is distinct from 1 or got #>> '{0,play}' <> live::text then raise exception 'a reversed pin unpins, the live one stays: %', got; end if;

  if jsonb_array_length(reach_effects('thread', t_gone)) <> 0 then raise exception 'reach_effects leaves a reversed thread play out'; end if;
  if jsonb_array_length(reach_effects('thread', t_live)) <> 1 then raise exception 'reach_effects keeps the identical live thread play'; end if;
  if jsonb_array_length(reach_effects('character', c_gone)) <> 0 or jsonb_array_length(reach_effects('character', c_live)) <> 1 then
    raise exception 'reach_effects tells a reversed character play from a live one';
  end if;

  perform tests.become(player);
  got := (select jsonb_agg(to_jsonb(x)) from effects_above(array[c_live, c_gone], t_gone, null) x);
  if jsonb_array_length(got) is distinct from 1 or got #>> '{0,play}' <> ch_live::text then raise exception 'effects_above leaves reversed character and thread plays out: %', got; end if;
  got := (select jsonb_agg(to_jsonb(x)) from effects_above('{}', t_live, null) x);
  perform tests.unbecome();
  if jsonb_array_length(got) is distinct from 1 or got #>> '{0,play}' <> live::text then raise exception 'effects_above keeps the identical live thread play: %', got; end if;
end $$;

-- ---- place_cast beyond a post: the stack of a thread and the one board card leave a reversed play out ----
do $$
declare
  player uuid := (select id from auth.users where email = 'ce-player@test.invalid');
  caster uuid := (select id from characters where name = 'Ce Caster');
  author uuid := (select id from characters where name = 'Ce Author');
  brd uuid; t uuid; ann uuid; p uuid; first_play uuid; board_play uuid; why text;
begin
  insert into boards (slug, name) values ('ce-board-two', 'Ce Board Two') returning id into brd;
  insert into threads (board, title) values (brd, 'Ce stacked') returning id into t;
  p := tests.post(author, t, 'Stacked.');
  insert into threads (board, title) values (brd, 'Ce Announcements') returning id into ann;
  insert into settings (key, value) values ('systemAnnouncements', to_jsonb(ann::text)) on conflict (key) do update set value = excluded.value;
  perform tests.post(author, ann, 'Announced.');

  first_play := (place_cast(caster, 'ce-th', t, '{}', '', 'thread', null, player, 0) ->> 'id')::uuid;
  why := pg_temp.refusal(format($s$select place_cast(%L, 'ce-th', %L, '{}', '', 'thread', null, %L, 0)$s$, caster, t, player));
  if why is null or why not like 'this thread already carries that card%' then raise exception 'a live thread play fills the stack: %', why; end if;
  perform pg_temp.end_play(first_play);
  perform place_cast(caster, 'ce-th', t, '{}', '', 'thread', null, player, 0);

  board_play := (place_cast(caster, 'ce-bd', brd, '{}', '', 'board', null, player, 0) ->> 'id')::uuid;
  why := pg_temp.refusal(format($s$select place_cast(%L, 'ce-bd2', %L, '{}', '', 'board', null, %L, 0)$s$, caster, brd, player));
  if why is null or why not like 'this board already carries a board card until%' then raise exception 'a live board card holds the board: %', why; end if;
  perform pg_temp.end_play(board_play);
  perform place_cast(caster, 'ce-bd2', brd, '{}', '', 'board', null, player, 0);
  why := pg_temp.refusal(format($s$select place_cast(%L, 'ce-bd', %L, '{}', '', 'board', null, %L, 0)$s$, caster, brd, player));
  if why is null or why not like 'this board already carries a board card until%' then raise exception 'the second board card holds it again: %', why; end if;
end $$;

-- ---- save_effect_state and release_effect refuse a reversed play, and serve a live one ----
do $$
declare
  player uuid := (select id from auth.users where email = 'ce-player@test.invalid');
  author_acc uuid := (select owner from characters where name = 'Ce Author');
  caster uuid := (select id from characters where name = 'Ce Caster');
  author uuid := (select id from characters where name = 'Ce Author');
  t uuid := tests.thread('Card end state');
  p uuid := tests.post(author, t, 'State.');
  live uuid := tests.act(caster, 'card', t, '{"card": "ce-wh", "layer": 1}', p);
  gone uuid := tests.act(caster, 'card', t, '{"card": "ce-wh", "layer": 2}', p);
  why text;
begin
  perform save_effect_state(author_acc, author, live, '{"n": 1}');
  perform save_effect_state(author_acc, author, gone, '{"n": 1}');
  perform pg_temp.end_play(gone);
  why := pg_temp.refusal(format($s$select save_effect_state(%L, %L, %L, '{"n": 2}')$s$, author_acc, author, gone));
  if why is null or why not like 'an admin ended that card%' then raise exception 'save_effect_state refuses a reversed play: %', why; end if;
  perform save_effect_state(author_acc, author, live, '{"n": 2}');
  if (select state ->> 'n' from effect_state where play = gone) is distinct from '1' then raise exception 'a refused save wrote nothing'; end if;

  perform tests.become(player);
  why := pg_temp.refusal(format('select release_effect(%L)', gone));
  if why is null or why not like 'an admin ended that card%' then raise exception 'release_effect refuses a reversed play: %', why; end if;
  perform release_effect(live);
  perform tests.unbecome();
  if not exists (select 1 from effect_releases where play = live) or exists (select 1 from effect_releases where play = gone) then
    raise exception 'release_effect releases the live play alone';
  end if;
end $$;

-- ====================================================================================== Task 3 follow-up: the chatter run's grant ====

-- ---- The chatter Edge Function reads a target's effects as service_role, so card_target_reach is granted to it by name ----
do $$
begin
  if not has_function_privilege('service_role', 'card_target_reach(text, uuid, uuid)', 'execute') then
    raise exception 'service_role may execute card_target_reach, which the chatter run calls';
  end if;
end $$;

-- ====================================================================================== Task 4: the alert and the log's view ====

-- ---- Fixtures: a caster with two masks, a target's author who started a thread, a third player, a staff persona, an admin ----
do $$
declare
  admin_acc uuid := tests.account('ce4-admin');
  cast_acc uuid := tests.account('ce4-cast');
  tgt_acc uuid := tests.account('ce4-tgt');
  third_acc uuid := tests.account('ce4-third');
  c1 uuid := tests.character(cast_acc, 'Ce4 Caster');
  c2 uuid := tests.character(cast_acc, 'Ce4 Caster Two');
  tgt uuid := tests.character(tgt_acc, 'Ce4 Target');
  third uuid := tests.character(third_acc, 'Ce4 Third');
  t uuid := tests.thread('Ce4 thread');
  p uuid := tests.post(tgt, t, 'Ce4 opening.');
  own_t uuid := tests.thread('Ce4 own thread');
  own_p uuid := tests.post(c1, own_t, 'Ce4 own post.');
  staff uuid;
begin
  insert into admins (account) values (admin_acc);
  insert into characters (name, staff, staff_kind, debuted_at) values ('Ce4 Bot', 'ce4-bot', 'persona', now()) returning id into staff;
end $$;

-- ---- The reversals ----
do $$
declare
  admin_acc uuid := (select id from auth.users where email = 'ce4-admin@test.invalid');
  c1 uuid := (select id from characters where name = 'Ce4 Caster');
  c2 uuid := (select id from characters where name = 'Ce4 Caster Two');
  tgt uuid := (select id from characters where name = 'Ce4 Target');
  staff uuid := (select id from characters where name = 'Ce4 Bot');
  p uuid := (select id from acts where kind = 'post' and payload ->> 'body' = 'Ce4 opening.');
  t uuid := (select thread from acts where id = p);
  own_p uuid := (select id from acts where kind = 'post' and payload ->> 'body' = 'Ce4 own post.');
  own_t uuid := (select thread from acts where id = own_p);
  on_post uuid := tests.act(c1, 'card', t, '{"card": "splat"}', p);
  on_char uuid := tests.act(c2, 'card', t, '{"card": "selfie", "reach": "character"}', p);
  on_thread uuid := tests.act(c1, 'card', t, '{"card": "marquee", "reach": "thread"}', p);
  on_own uuid := tests.act(c2, 'card', own_t, '{"card": "splat"}', own_p);
  by_staff uuid;
  got jsonb;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  by_staff := tests.act(staff, 'card', t, '{"card": "splat", "layer": 2}', p);
  perform set_config('kayfabb.staff_writer', '', true);
  insert into play_reach (play, reach, character, ends_at) values (on_char, 'character', tgt, now() + interval '1 day');
  insert into play_reach (play, reach, thread, ends_at) values (on_thread, 'thread', t, now() + interval '1 day');
  perform tests.become(admin_acc);
  got := reverse_card(on_post);
  if got ? 'reach' then raise exception 'a play on a post has no reach in the answer: %', got; end if;
  got := reverse_card(on_thread);
  if got ->> 'reach' is distinct from 'thread' then raise exception 'a thread play answers its reach: %', got; end if;
  got := reverse_card(on_char);
  if got ->> 'reach' is distinct from 'character' then raise exception 'a character play answers its reach: %', got; end if;
  perform reverse_card(on_own);
  perform reverse_card(by_staff);
  perform tests.unbecome();
end $$;

-- ---- The caster's alert: one per player-cast reversal, about the card_end; none for a staff caster ----
do $$
declare
  cast_acc uuid := (select id from auth.users where email = 'ce4-cast@test.invalid');
  tgt_acc uuid := (select id from auth.users where email = 'ce4-tgt@test.invalid');
  third_acc uuid := (select id from auth.users where email = 'ce4-third@test.invalid');
  c1 uuid := (select id from characters where name = 'Ce4 Caster');
  staff uuid := (select id from characters where name = 'Ce4 Bot');
  p uuid := (select id from acts where kind = 'post' and payload ->> 'body' = 'Ce4 opening.');
  on_post uuid := (select id from acts where kind = 'card' and character = c1 and target_act_id = p and payload ->> 'card' = 'splat');
  end_id uuid := (select id from acts where kind = 'card_end' and target_act_id = on_post);
  n integer;
  r alerts%rowtype;
begin
  select count(*) into n from alerts where kind = 'cardEnded' and account = cast_acc;
  if n <> 4 then raise exception 'the caster has one cardEnded alert per reversed play (4), got %', n; end if;
  select * into r from alerts where kind = 'cardEnded' and act = end_id;
  if r.account is distinct from cast_acc or r.character is distinct from c1 or r.sub is not null then raise exception 'the alert is the caster''s, about the card_end: %', to_jsonb(r); end if;
  if exists (select 1 from alerts where kind = 'cardEnded' and account in (tgt_acc, third_acc)) then raise exception 'neither the target''s author nor a third player is alerted'; end if;
  if exists (select 1 from alerts a join acts e on e.id = a.act where a.kind = 'cardEnded' and e.target_act_id in (select id from acts where character = staff)) then
    raise exception 'a staff caster''s reversed play writes no alert';
  end if;
  perform tests.become(cast_acc);
  if (select count(*) from my_alerts() where kind = 'cardEnded') is distinct from 4::bigint then raise exception 'my_alerts lists the caster''s cardEnded alerts'; end if;
  perform tests.unbecome();
end $$;

-- ---- my_cards_ended: the caster's player sees 'cast' rows, the target's author 'onMine', a third player nothing ----
do $$
declare
  cast_acc uuid := (select id from auth.users where email = 'ce4-cast@test.invalid');
  tgt_acc uuid := (select id from auth.users where email = 'ce4-tgt@test.invalid');
  third_acc uuid := (select id from auth.users where email = 'ce4-third@test.invalid');
  admin_acc uuid := (select id from auth.users where email = 'ce4-admin@test.invalid');
  staff uuid := (select id from characters where name = 'Ce4 Bot');
  p uuid := (select id from acts where kind = 'post' and payload ->> 'body' = 'Ce4 opening.');
  own_p uuid := (select id from acts where kind = 'post' and payload ->> 'body' = 'Ce4 own post.');
  on_post uuid := (select id from acts where kind = 'card' and target_act_id = p and payload ->> 'card' = 'splat' and character <> staff);
  on_own uuid := (select id from acts where kind = 'card' and target_act_id = own_p);
  by_staff uuid := (select id from acts where kind = 'card' and character = staff);
  on_char uuid := (select id from acts where kind = 'card' and payload ->> 'card' = 'selfie' and character = (select id from characters where name = 'Ce4 Caster Two'));
  on_thread uuid := (select id from acts where kind = 'card' and payload ->> 'card' = 'marquee' and character = (select id from characters where name = 'Ce4 Caster'));
  r record;
begin
  perform tests.become(cast_acc);
  if (select count(*) from my_cards_ended) is distinct from 4::bigint or exists (select 1 from my_cards_ended where side <> 'cast') then
    raise exception 'the caster''s player sees four plays, all cast: %', (select jsonb_agg(to_jsonb(x)) from my_cards_ended x);
  end if;
  select * into r from my_cards_ended where play = on_post;
  if r.side <> 'cast' or r.card <> 'splat' or r.card_end is distinct from (select id from acts where kind = 'card_end' and target_act_id = on_post) or r.at is null then
    raise exception 'the cast row: %', to_jsonb(r);
  end if;
  if (select count(*) from my_cards_ended where play = on_own) is distinct from 1::bigint then raise exception 'a play cast on one''s own post is one row, cast'; end if;
  if exists (select 1 from my_cards_ended where play = by_staff) then raise exception 'a staff play is not the player''s'; end if;
  perform tests.unbecome();

  perform tests.become(tgt_acc);
  if (select count(*) from my_cards_ended) is distinct from 4::bigint or exists (select 1 from my_cards_ended where side <> 'onMine') then
    raise exception 'the target''s author sees four plays, all onMine: %', (select jsonb_agg(to_jsonb(x)) from my_cards_ended x);
  end if;
  if not exists (select 1 from my_cards_ended where play = by_staff and side = 'onMine') then raise exception 'a staff caster''s reversed play appears on the target''s side'; end if;
  if (select target_name from my_cards_ended where play = on_char) is distinct from 'Ce4 Target' then raise exception 'a character play names the character'; end if;
  if (select target_name from my_cards_ended where play = on_thread) is distinct from 'Ce4 thread' then raise exception 'a thread play names the thread'; end if;
  if (select target_name from my_cards_ended where play = on_post) is not null then raise exception 'a post play names no target'; end if;
  if exists (select 1 from my_cards_ended where play = on_own) then raise exception 'a play on someone else''s post is not the author''s'; end if;
  perform tests.unbecome();

  perform tests.become(third_acc);
  if exists (select 1 from my_cards_ended) then raise exception 'a third player sees neither row'; end if;
  perform tests.unbecome();
  perform tests.become(admin_acc);
  if exists (select 1 from my_cards_ended) then raise exception 'an admin as such sees nothing in a player''s log'; end if;
  perform tests.unbecome();
  if has_table_privilege('anon', 'my_cards_ended', 'select') or not has_table_privilege('authenticated', 'my_cards_ended', 'select') then raise exception 'my_cards_ended is a signed-in read'; end if;
end $$;
