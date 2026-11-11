-- What settlement_input and estimate_input send for the three card types (supabase/migrations/0146_card_types.sql; docs/plans/2026-11-11-card-types-design.md, sections 3 and 5; plan Task 4):
-- `by` on a spring (the Act that sprang it), `ends` on a use card's play and `on` on a character-reach play, and every live Earn Gimmick play that reaches into the window even when it
-- was played before it (settle.ts boosts only with the play present in the input). A play an admin ended, one that ended before the window and one that is no Earn card are not carried over.
-- Dates are in the fixtures' first season (2000), so the windows are this file's own. The cards are this file's own (se...).

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick) values
    ('seearn', 'Se Earn', 'sweet', 'common', 'use', null, '{post,character}', interval '3 days', '{"kind": "earn", "by": 0.5, "quadrants": ["fire"]}'),
    ('sewardx', 'Se Ward', 'sweet', 'common', 'use', null, '{post,character}', interval '3 days', '{"kind": "ward", "upTo": "common"}')
  on conflict (key) do nothing;
end $$;

-- The acts of an input by id, as the engine reads them.
create function pg_temp.entry(input jsonb, id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = id::text
$$;

create function pg_temp.ms(t timestamptz) returns bigint language sql as $$ select (extract(epoch from t) * 1000)::bigint $$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('se-ann'); bob uuid := tests.account('se-bob');
  a uuid := tests.character(ann, 'Se Ann'); b uuid := tests.character(bob, 'Se Bob');
  s1 constant timestamptz := (select min(starts_at) from seasons);
  w0 timestamptz; w1 timestamptz;
  t uuid := tests.thread('Se thread');
  p_old uuid; p_new uuid; p_other uuid;
  live_post uuid; live_char uuid; by_bob uuid; expired uuid; ward uuid; ended_play uuid; late uuid;
  sset uuid; spr uuid; cast_act uuid;
  input jsonb; est jsonb; e jsonb;
begin
  perform pg_temp.cards();
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  w0 := (select max(ends_at) from settlements); w1 := w0 + interval '1 day';
  p_old := tests.post(a, t, 'Old post.', w0 - interval '20 hours');
  p_new := tests.post(a, t, 'New post.', w0 + interval '2 hours');
  p_other := tests.post(b, t, 'Bob post.', w0 - interval '20 hours');

  -- Played before the window, still up into it: an Earn on Ann's old post, one by Bob on it, and one on her character.
  live_post := tests.act(a, 'card', t, jsonb_build_object('card', 'seearn', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', w0 + interval '2 days'), p_old, w0 - interval '10 hours');
  by_bob := tests.act(b, 'card', t, jsonb_build_object('card', 'seearn', 'message', '', 'config', '{}'::jsonb, 'layer', 2, 'ends', w0 + interval '5 hours'), p_old, w0 - interval '9 hours');
  live_char := tests.act(a, 'card', t, jsonb_build_object('card', 'seearn', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', w0 + interval '1 day', 'targetName', 'Se Ann'), p_old, w0 - interval '8 hours');
  -- Not carried: one that ended before the window opened, one that is no Earn card, one an admin ended, and one played after the window closed.
  expired := tests.act(a, 'card', t, jsonb_build_object('card', 'seearn', 'message', '', 'config', '{}'::jsonb, 'layer', 3, 'ends', w0 - interval '1 hour'), p_old, w0 - interval '15 hours');
  ward := tests.act(a, 'card', t, jsonb_build_object('card', 'sewardx', 'message', '', 'config', '{}'::jsonb, 'layer', 4, 'ends', w0 + interval '2 days'), p_old, w0 - interval '7 hours');
  ended_play := tests.act(a, 'card', t, jsonb_build_object('card', 'seearn', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', w0 + interval '2 days', 'targetName', 'Se Ann'), p_old, w0 - interval '6 hours');
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (null, 'card_end', t, ended_play, '{"why": "reversed", "by": "admin"}', w0 - interval '5 hours');
  perform set_config('kayfabb.card_end_writer', '', true);
  late := tests.act(a, 'card', t, jsonb_build_object('card', 'seearn', 'message', '', 'config', '{}'::jsonb, 'layer', 5, 'ends', w1 + interval '2 days'), p_new, w1 + interval '1 hour');

  -- A spring in the window, which says what sprang it.
  sset := tests.act(a, 'set', t, '{}', p_new, w0 + interval '3 hours');
  cast_act := tests.act(b, 'card', t, jsonb_build_object('card', 'sewardx', 'message', '', 'config', '{}'::jsonb, 'caught', sset::text), p_new, w0 + interval '4 hours');
  spr := tests.act(a, 'spring', t, jsonb_build_object('card', 'seearn', 'trigger', 'cast', 'did', 'caught', 'set', sset::text, 'by', cast_act::text, 'caught', cast_act::text), p_new, w0 + interval '4 hours');

  input := settlement_input(w0, w1);
  e := pg_temp.entry(input, spr);
  if e is null or e ->> 'by' is distinct from cast_act::text then raise exception 'a spring does not say what sprang it: %', e; end if;
  e := pg_temp.entry(input, live_post);
  if e is null or (e ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '2 days') or e ->> 'on' is not null or e ->> 'target' is distinct from p_old::text then
    raise exception 'an Earn play before the window is not carried, or is carried wrong: %', e;
  end if;
  if pg_temp.entry(input, by_bob) is null then raise exception 'another character''s Earn play on the post is not carried'; end if;
  e := pg_temp.entry(input, live_char);
  if e is null or e ->> 'on' is distinct from a::text or e ->> 'reach' is distinct from 'character' or (e ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '1 day') then
    raise exception 'a character-reach Earn play does not carry its character and its end: %', e;
  end if;
  if pg_temp.entry(input, expired) is not null then raise exception 'an Earn play that ended before the window was carried'; end if;
  if pg_temp.entry(input, ward) is not null then raise exception 'a play of a card that is no Earn was carried over'; end if;
  if pg_temp.entry(input, ended_play) is not null then raise exception 'an Earn play an admin ended was carried'; end if;
  if pg_temp.entry(input, late) is not null then raise exception 'a play after the window closed was in the input'; end if;
  -- The post an Earn play is on comes with it, so the engine finds what it boosts.
  if pg_temp.entry(input, p_old) is null then raise exception 'the post a carried play is on is not in the input'; end if;
  -- A play made inside the window carries its end too, and a cast (no `ends`) none.
  if pg_temp.entry(input, cast_act) is not null and pg_temp.entry(input, cast_act) ? 'ends' then raise exception 'a play with no end carries one'; end if;

  -- The live estimate reads the same plays for the caller: her own, and Bob's on her post, before the window and still up.
  est := estimate_input(ann, w1);
  e := pg_temp.entry(est, live_post);
  if e is null or (e ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '2 days') then raise exception 'the estimate does not carry an Earn play from before the window: %', e; end if;
  if pg_temp.entry(est, by_bob) is null then raise exception 'the estimate does not carry another''s Earn play on the caller''s post'; end if;
  e := pg_temp.entry(est, live_char);
  if e is null or e ->> 'on' is distinct from a::text then raise exception 'the estimate''s character-reach play does not say what it is on: %', e; end if;
  if pg_temp.entry(est, expired) is not null or pg_temp.entry(est, ward) is not null or pg_temp.entry(est, ended_play) is not null then raise exception 'the estimate carried a play that is not live Earn'; end if;
  e := pg_temp.entry(est, spr);
  if e is null or e ->> 'by' is null then raise exception 'the estimate''s spring does not say what sprang it: %', e; end if;
end $$;
