-- The cushion, a new kind of use card's gimmick (supabase/migrations/0376_cushion_kind.sql; docs/plans/2026-11-16-settlement-engine-plan.md, Task 4; models: 0161-earn-casts.sql and the test 0369-post-earn-casts.sql).
-- The catalog takes a use card with a cushion and refuses a gimmick of an unknown kind in the new sentence (card_kinds_problem, in the engine's words: engine/rules/instance.ts, gimmickProblems). settlement_input carries a
-- cushion play made before the window and still up in it, with its `ends` and `on`, through earn_up, and leaves out one an admin ended and one that ended before the window; estimate_input carries the caller's cushion
-- and not another player's. The cards are this file's own (cu...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.entry(input jsonb, id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = id::text
$$;
create function pg_temp.ms(t timestamptz) returns bigint language sql as $$ select (extract(epoch from t) * 1000)::bigint $$;

-- ---- The catalog: a use card with a cushion seeds; a gimmick of a kind that is none is refused by the table and by card_kinds_problem, in the engine's words ----
select tests.unbecome();
do $$
declare
  cushion constant text := '{"kind": "cushion", "share": 0.5}';
  why text;
begin
  why := pg_temp.coded(format($f$insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values ('cuthick', 'Cu Thick', 'sweet', 'uncommon', 'use', interval '3 days', '{character}', %L)$f$, cushion));
  if why is not null then raise exception 'a use card with a cushion was refused by the catalog: %', why; end if;
  why := pg_temp.coded($f$insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values ('cuhex', 'Cu Hex', 'sweet', 'common', 'use', interval '1 day', '{character}', '{"kind": "hex"}')$f$);
  if why is null or why not like '23514 %card_kinds_gimmick_kind%' then raise exception 'a gimmick of a kind that is none went into the catalog: %', why; end if;

  why := card_kinds_problem(('[{"key": "ok", "rarity": "uncommon", "play": "use", "reaches": ["character"], "lasts": {"unit": "day", "count": 3}, "gimmick": ' || cushion || '}]')::jsonb);
  if why is not null then raise exception 'a use card with a cushion was refused: %', why; end if;
  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "use", "lasts": {"unit": "day", "count": 7}, "gimmick": {"kind": "hex"}}]');
  if why is distinct from 'card "poison" has a gimmick of kind "hex"; a gimmick is ward, earn, price, ride, noQuote, cushion or pierce' then raise exception 'the kinds a gimmick may be: %', why; end if;
  -- The widened kind list is for a use card alone: a cast card holds an earn and nothing else, a cushion included.
  why := card_kinds_problem(('[{"key": "castcu", "rarity": "uncommon", "play": "cast", "reaches": ["character"], "lasts": {"unit": "day", "count": 3}, "gimmick": ' || cushion || '}]')::jsonb);
  if why is distinct from 'card "castcu" has a gimmick, and only a use card has one, or a cast card on a character alone or a post alone an earn' then raise exception 'a cast card holding a cushion was not refused in the sentence: %', why; end if;
end $$;

-- ---- The settlement reads a cushion play made before the window and still up in it, with its end and its character; the estimate reads the caller's alone ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('cu-ann'); bob uuid := tests.account('cu-bob');
  a uuid := tests.character(ann, 'Cu Ann'); b uuid := tests.character(bob, 'Cu Bob');
  s1 constant timestamptz := (select min(starts_at) from seasons);
  w0 timestamptz; w1 timestamptz;
  t uuid := tests.thread('Cu settlement thread');
  pa uuid; pb uuid;
  up uuid; bobs uuid; ended_play uuid; over uuid; longago uuid;
  input jsonb; est jsonb; got jsonb;
begin
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('cuthick2', 'Cu Thick Two', 'sweet', 'uncommon', 'use', interval '3 days', '{character}', '{"kind": "cushion", "share": 0.5}')
  on conflict (key) do nothing;
  -- An earn card with a SHORT time up (12 hours): the longest `lasts` earn_up looks back by is read from earn or cushion cards, so with the cushion in it the look-back is the cushion's three days, and with earn alone it would be these
  -- 12 hours, which every cushion play below (24 hours or more before the window) is older than. No other card of this file or the fixtures is an earn, and the check below says so.
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('cuearn', 'Cu Earn', 'sweet', 'common', 'use', interval '12 hours', '{post,character}', '{"kind": "earn", "by": 0.5, "quadrants": ["fire"]}')
  on conflict (key) do nothing;
  if (select max(lasts) from card_kinds where gimmick ->> 'kind' = 'earn') is distinct from interval '12 hours' then
    raise exception 'the fixtures hold an earn card whose time up is not 12 hours, so the longest-lasts check below cannot tell earn from earn-or-cushion';
  end if;
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  w0 := (select max(ends_at) from settlements); w1 := w0 + interval '1 day';
  pa := tests.post(a, t, 'Ann''s post.', w0 - interval '20 hours');
  pb := tests.post(b, t, 'Bob''s post.', w0 - interval '19 hours');
  -- Ann's cushion on her own character, played a day before the window and up until two days into it; Bob's the same on his; one an admin ended; one that ended an hour before the window.
  up := tests.act(a, 'card', t, jsonb_build_object('card', 'cuthick2', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', w0 + interval '48 hours', 'targetName', 'Cu Ann'), pa, w0 - interval '24 hours');
  insert into play_reach (play, reach, character, ends_at) values (up, 'character', a, w0 + interval '48 hours');
  bobs := tests.act(b, 'card', t, jsonb_build_object('card', 'cuthick2', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', b, 'ends', w0 + interval '48 hours', 'targetName', 'Cu Bob'), pb, w0 - interval '23 hours');
  insert into play_reach (play, reach, character, ends_at) values (bobs, 'character', b, w0 + interval '48 hours');
  ended_play := tests.act(a, 'card', t, jsonb_build_object('card', 'cuthick2', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', w0 + interval '47 hours', 'targetName', 'Cu Ann'), pa, w0 - interval '22 hours');
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (null, 'card_end', t, ended_play, '{"why": "reversed", "by": "admin"}', w0 - interval '21 hours');
  perform set_config('kayfabb.card_end_writer', '', true);
  -- Made 30 hours before the window, older than the 12 hours the one earn card lasts and inside the cushion card's three days, and up until the window's second day: carried only where the look-back reads cushion cards too.
  longago := tests.act(a, 'card', t, jsonb_build_object('card', 'cuthick2', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', w0 + interval '36 hours', 'targetName', 'Cu Ann'), pa, w0 - interval '30 hours');
  over := tests.act(a, 'card', t, jsonb_build_object('card', 'cuthick2', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', w0 - interval '1 hour', 'targetName', 'Cu Ann'), pa, w0 - interval '60 hours');

  -- The settlement: earn_up finds the play made before the window and still up in it, with its end and the character it is on; the one an admin ended and the one that is over are not there.
  input := settlement_input(w0, w1);
  got := pg_temp.entry(input, longago);
  if got is null or (got ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '36 hours') then
    raise exception 'a cushion made longer ago than the longest earn lasts, and still up, is not carried by the settlement (the look-back must read cushion cards too): %', got;
  end if;
  got := pg_temp.entry(input, up);
  if got is null or (got ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '48 hours') or got ->> 'on' is distinct from a::text or got ->> 'card' is distinct from 'cuthick2' then
    raise exception 'a cushion made before the window and still up is not carried with its end and its character: %', got;
  end if;
  if pg_temp.entry(input, ended_play) is not null then raise exception 'a cushion an admin ended was carried'; end if;
  if pg_temp.entry(input, over) is not null then raise exception 'a cushion that ended before the window was carried'; end if;

  -- The estimate, over the open window up to six hours in: Ann's carries her own cushion and not Bob's; Bob's carries his and not Ann's.
  est := estimate_input(ann, w0 + interval '6 hours');
  got := pg_temp.entry(est, up);
  if got is null or (got ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '48 hours') or got ->> 'on' is distinct from a::text then
    raise exception 'the caller''s estimate does not carry the caller''s cushion: %', got;
  end if;
  if pg_temp.entry(est, longago) is null then raise exception 'a cushion made longer ago than the longest earn lasts, and still up, is not carried by the caller''s estimate (the look-back must read cushion cards too)'; end if;
  if pg_temp.entry(est, bobs) is not null then raise exception 'a player''s estimate carries another player''s cushion'; end if;
  if pg_temp.entry(est, ended_play) is not null or pg_temp.entry(est, over) is not null then raise exception 'an estimate carries a cushion that was ended or is over'; end if;
  est := estimate_input(bob, w0 + interval '6 hours');
  if pg_temp.entry(est, bobs) is null then raise exception 'the other player''s estimate does not carry that player''s cushion'; end if;
  if pg_temp.entry(est, up) is not null then raise exception 'a player''s estimate carries another player''s cushion (the second)'; end if;
end $$;
