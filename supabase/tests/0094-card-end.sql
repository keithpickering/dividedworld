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
