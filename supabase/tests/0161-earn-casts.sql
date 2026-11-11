-- An Earn a cast card carries (supabase/migrations/0152_card_notes_part_4.sql; docs/plans/2026-11-11-card-notes-part-4-plan.md, Task 3, sections 1, 5, 6 and 8). A cast card that reaches a character alone may
-- carry an earn Gimmick: it lands on any character, anyone's, by the stack count; a use card with an earn is still used on one's own character alone; a staff character casts none (the settlement leaves a
-- staff character's Acts out, so it would never be paid); set face down it lands on the quoting post's character as a cast does. settlement_input carries its play with its end and the character it is on,
-- in its own window and, through earn_up, in the next, and estimate_input for the target's player carries another's play made inside the open window and for a third player does not.
-- The catalog holds the same three refusals card_kinds_problem says in the engine's words (engine/rules/instance.ts, playProblems and gimmickProblems). The cards are this file's own (ec...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('ecboost', 'Ec Boost', 'sweet', 'uncommon', 'cast', interval '36 hours', '{character}',
      '{"kind": "earn", "quadrants": ["excitedPositive", "calmPositive"], "by": 0.1, "group": "publicity"}'),
    ('ecuse', 'Ec Tour', 'sweet', 'uncommon', 'use', interval '36 hours', '{character}',
      '{"kind": "earn", "quadrants": ["excitedPositive", "calmPositive"], "by": 0.1, "group": "publicity"}')
  on conflict (key) do nothing;
end $$;

create function pg_temp.entry(input jsonb, id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = id::text
$$;
create function pg_temp.ms(t timestamptz) returns bigint language sql as $$ select (extract(epoch from t) * 1000)::bigint $$;

-- ---- The catalog: a cast earn on a character seeds; the other pairings are refused by the table's checks and by card_kinds_problem, in the engine's words ----
select tests.unbecome();
do $$
declare
  earn constant text := '{"kind": "earn", "quadrants": ["calmPositive"], "by": 0.1}';
  why text;
begin
  perform pg_temp.cards();
  if not exists (select 1 from card_kinds where key = 'ecboost' and play = 'cast' and gimmick ->> 'kind' = 'earn') then raise exception 'a cast card with an earn did not seed'; end if;

  -- The table: a cast card holds a gimmick only when it is an earn on a character alone.
  why := pg_temp.coded(format($f$insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values ('ecpoison', 'Poison', 'sweet', 'common', 'cast', interval '1 day', '{character}', %L)$f$,
    '{"kind": "ward", "upTo": "common"}'));
  if why is null or why not like '23514 %card_kinds_gimmick_use%' then raise exception 'a cast card with a ward went into the catalog: %', why; end if;
  why := pg_temp.coded(format($f$insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values ('ecpoison', 'Poison', 'sweet', 'common', 'cast', interval '1 day', '{post,character}', %L)$f$, earn));
  if why is null or why not like '23514 %card_kinds_gimmick_use%' then raise exception 'a cast card with an earn on a post as well went into the catalog: %', why; end if;
  why := pg_temp.coded(format($f$insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values ('ecpoison', 'Poison', 'sweet', 'common', 'cast', interval '1 day', '{post}', %L)$f$, earn));
  if why is null or why not like '23514 %card_kinds_gimmick_use%' then raise exception 'a cast card with an earn on a post went into the catalog: %', why; end if;
  why := pg_temp.coded(format($f$insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values ('ecpoison', 'Poison', 'sweet', 'common', 'use', interval '1 day', '{post}', %L)$f$,
    '{"kind": "hex"}'));
  if why is null or why not like '23514 %card_kinds_gimmick_kind%' then raise exception 'a gimmick of a kind that is none went into the catalog: %', why; end if;
  why := pg_temp.coded($f$insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values ('ecpoison', 'Poison', 'sweet', 'common', 'use', interval '1 day', '{character}', '{"kind": "noQuote"}')$f$);
  if why is null or why not like '23514 %card_kinds_no_quote_post%' then raise exception 'a no-quote card that reaches a character went into the catalog: %', why; end if;
  why := pg_temp.coded($f$insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values ('ecquiet', 'Quiet', 'sweet', 'common', 'use', interval '1 day', '{post}', '{"kind": "noQuote"}')$f$);
  if why is not null then raise exception 'a no-quote card on a post was refused: %', why; end if;

  -- card_kinds_problem: clean, then each poison alone.
  why := card_kinds_problem(('[{"key": "ok", "rarity": "common", "reaches": ["character"], "lasts": {"unit": "hour", "count": 36}, "gimmick": ' || earn || '},'
    || '{"key": "oq", "rarity": "common", "play": "use", "lasts": {"unit": "day", "count": 7}, "gimmick": {"kind": "noQuote"}},'
    || '{"key": "oq2", "rarity": "common", "play": "use", "reaches": ["post"], "lasts": {"unit": "day", "count": 7}, "gimmick": {"kind": "noQuote"}}]')::jsonb);
  if why is not null then raise exception 'clean cards were refused: %', why; end if;

  why := card_kinds_problem(('[{"key": "poison", "rarity": "common", "reaches": ["post"], "gimmick": ' || earn || '}]')::jsonb);
  if why is distinct from 'card "poison" has a gimmick, and only a use card has one, or a cast card on a character an earn' then raise exception 'a cast card on a post with an earn: %', why; end if;
  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "reaches": ["character"], "lasts": {"unit": "day", "count": 1}, "gimmick": {"kind": "ward", "upTo": "common"}}]');
  if why is distinct from 'card "poison" has a gimmick, and only a use card has one, or a cast card on a character an earn' then raise exception 'a cast card on a character with a ward: %', why; end if;
  why := card_kinds_problem(('[{"key": "poison", "rarity": "common", "reaches": ["character", "post"], "lasts": {"unit": "day", "count": 1}, "gimmick": ' || earn || '}]')::jsonb);
  if why is distinct from 'card "poison" has a gimmick, and only a use card has one, or a cast card on a character an earn' then raise exception 'a cast card reaching a character and a post with an earn: %', why; end if;
  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "cast"}}, "reaches": ["character"], "gimmick": {"kind": "earn", "quadrants": ["calmPositive"], "by": 0.1}}]');
  if why is distinct from 'card "poison" has a gimmick, and only a use card has one, or a cast card on a character an earn' then raise exception 'a set card with an earn: %', why; end if;
  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "use", "lasts": {"unit": "day", "count": 7}, "gimmick": {"kind": "hex"}}]');
  if why is distinct from 'card "poison" has a gimmick of kind "hex"; a gimmick is ward, earn, price, ride or noQuote' then raise exception 'the kinds a gimmick may be: %', why; end if;
  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "use", "reaches": ["character"], "lasts": {"unit": "day", "count": 7}, "gimmick": {"kind": "noQuote"}}]');
  if why is distinct from 'card "poison" stops quotes, and a card that stops quotes reaches a post alone' then raise exception 'a no-quote card that reaches a character: %', why; end if;
  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "use", "reaches": ["post", "thread"], "lasts": {"unit": "day", "count": 7}, "gimmick": {"kind": "noQuote"}}]');
  if why is distinct from 'card "poison" stops quotes, and a card that stops quotes reaches a post alone' then raise exception 'a no-quote card that reaches a post and a thread: %', why;
  end if;
end $$;

-- ---- A cast earn lands on another account's character and on the caster's own; a second on the same character is refused; a use earn stays on one's own character ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('ec-ann'); bob uuid := tests.account('ec-bob');
  a uuid := tests.character(ann, 'Ec Ann'); a2 uuid := tests.character(ann, 'Ec Ann Two'); b uuid := tests.character(bob, 'Ec Bob');
  t uuid := tests.thread('Ec thread');
  pa2 uuid := tests.post(a2, t, 'Ann''s other mask.'); pb uuid := tests.post(b, t, 'Bob''s post.'); pa uuid := tests.post(a, t, 'Ann''s post.');
  boss uuid;
  made jsonb; why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'ecboost', 'ecboost', 'ecboost', 'ecuse');
  perform pg_temp.hand(bob, 'ecboost');
  perform tests.become_service();

  -- On another account's character: the play carries its reach, the character and its end, and a reach row holds it.
  made := play_card(ann, 'ecboost', a, b, '{}', 0, '', 'character', pb);
  if (select (k.payload ->> 'reach', k.payload ->> 'character', (k.payload ->> 'ends')::timestamptz > now() + interval '35 hours', (k.payload ->> 'ends')::timestamptz < now() + interval '37 hours')
      from acts k where k.id = (made ->> 'id')::uuid) is distinct from ('character'::text, b::text, true, true) then
    raise exception 'a cast earn on another''s character: %', (select to_jsonb(k) from acts k where k.id = (made ->> 'id')::uuid);
  end if;
  if not exists (select 1 from play_reach r where r.play = (made ->> 'id')::uuid and r.character = b) then raise exception 'a cast earn has no reach row'; end if;

  -- A second on the same character is refused, whoever casts it; the caster's own other mask takes one.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'ecboost', a, b, '{}', '', 'character', pb));
  if why is distinct from '23505 this character already carries that card' then raise exception 'a second cast earn on one character: %', why; end if;
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'ecboost', b, b, '{}', '', 'character', pb));
  if why is distinct from '23505 this character already carries that card' then raise exception 'a second cast earn on one character, by its own player: %', why; end if;
  made := play_card(ann, 'ecboost', a, a2, '{}', 0, '', 'character', pa2);
  if (select k.payload ->> 'character' from acts k where k.id = (made ->> 'id')::uuid) is distinct from a2::text then raise exception 'a cast earn on one''s own other mask: %', made; end if;

  -- A use card with an earn is still used on one's own character alone.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ann, 'ecuse', a, b, '{}', '', 'character', pb));
  if why is distinct from '42501 Ec Tour is used on your own character' then raise exception 'a use earn on another''s character: %', why; end if;
  perform tests.unbecome();

  -- A staff character casts none: nothing is written, whoever it casts on.
  insert into characters (name, staff, staff_kind, debuted_at) values ('Ec Boss', 'ec-boss', 'persona', now()) returning id into boss;
  -- The staff writer's flag is on, as it is in the game's own staff moves, so the refusal met is place_cast's own.
  perform set_config('kayfabb.staff_writer', 'on', true);
  why := pg_temp.coded(format('select place_cast(%L, %L, %L, %L, %L, %L, %L, null, 0)', boss, 'ecboost', a, '{}', '', 'character', pa));
  perform set_config('kayfabb.staff_writer', '', true);
  if why is distinct from '22023 a staff character casts no card that carries an earn' then raise exception 'a staff cast of a cast earn: %', why; end if;
  if exists (select 1 from acts where character = boss and kind = 'card') then raise exception 'a refused staff cast wrote an Act'; end if;
end $$;

-- ---- Set face down, it lands on the quoting post's character as a cast does ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('ec-set-ann'); bob uuid := tests.account('ec-set-bob');
  a uuid := tests.character(ann, 'Ec Set Ann'); b uuid := tests.character(bob, 'Ec Set Bob');
  t uuid := tests.thread('Ec set thread');
  pa uuid := tests.post(a, t, 'A back under this.');
  back uuid; made jsonb; laid uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'ecboost');
  perform tests.become_service();
  back := (set_card(ann, 'ecboost', a, pa, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(bob);
  made := post(t, b, 'Quoting Ann.', pa);
  perform tests.unbecome();
  select k.id into laid from acts k where k.kind = 'card' and k.payload ->> 'spring' = (made -> 'sprung' ->> 'id');
  if laid is null then raise exception 'the quote landed no card: %', made; end if;
  if (select (k.character, k.payload ->> 'reach', k.payload ->> 'character', (k.payload ->> 'ends')::timestamptz > now() + interval '35 hours') from acts k where k.id = laid) is distinct from (a, 'character'::text, b::text, true) then
    raise exception 'the sprung cast earn landed %', (select to_jsonb(k) from acts k where k.id = laid);
  end if;
  if not exists (select 1 from play_reach r where r.play = laid and r.character = b) then raise exception 'the sprung cast earn has no reach row'; end if;
end $$;

-- ---- The settlement reads the cast play with its end and its character, in its own window and, through earn_up, in the next; the estimate reads another's play made inside the open window for the target alone ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('ec-st-ann'); bob uuid := tests.account('ec-st-bob'); cat uuid := tests.account('ec-st-cat');
  a uuid := tests.character(ann, 'Ec St Ann'); b uuid := tests.character(bob, 'Ec St Bob'); c uuid := tests.character(cat, 'Ec St Cat');
  s1 constant timestamptz := (select min(starts_at) from seasons);
  w0 timestamptz; w1 timestamptz;
  t uuid := tests.thread('Ec settlement thread');
  pb uuid; pc uuid;
  play uuid; early uuid; ended_play uuid; before uuid;
  input jsonb; next_input jsonb; est jsonb; got jsonb;
begin
  perform pg_temp.cards();
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  w0 := (select max(ends_at) from settlements); w1 := w0 + interval '1 day';
  pb := tests.post(b, t, 'Bob''s post.', w0 - interval '20 hours');
  pc := tests.post(c, t, 'Cat''s post.', w0 - interval '19 hours');
  -- Ann casts a cast earn on Bob's character two hours into the window; it lasts 36 hours, so it is still up in the next window.
  play := tests.act(a, 'card', t, jsonb_build_object('card', 'ecboost', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', b, 'ends', w0 + interval '38 hours', 'targetName', 'Ec St Bob'), pb, w0 + interval '2 hours');
  insert into play_reach (play, reach, character, ends_at) values (play, 'character', b, w0 + interval '38 hours');
  -- One that ended before the next window and one an admin ended, which the next window does not carry.
  early := tests.act(a, 'card', t, jsonb_build_object('card', 'ecboost', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', c, 'ends', w0 + interval '5 hours', 'targetName', 'Ec St Cat'), pc, w0 + interval '1 hour');
  ended_play := tests.act(a, 'card', t, jsonb_build_object('card', 'ecboost', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', w0 + interval '30 hours', 'targetName', 'Ec St Ann'), pb, w0 + interval '3 hours');
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (null, 'card_end', t, ended_play, '{"why": "reversed", "by": "admin"}', w0 + interval '4 hours');
  perform set_config('kayfabb.card_end_writer', '', true);

  -- Its own window: the play carries its end and the character it is on, as a use card's does.
  input := settlement_input(w0, w1);
  got := pg_temp.entry(input, play);
  if got is null or (got ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '38 hours') or got ->> 'on' is distinct from b::text or got ->> 'reach' is distinct from 'character' or got ->> 'card' is distinct from 'ecboost' then
    raise exception 'a cast earn made in the window is not carried with its end and its character: %', got;
  end if;

  -- The next window: earn_up finds it, made before the window and still up in it, with its end and character; the ones over or ended are not there.
  next_input := settlement_input(w1, w1 + interval '1 day');
  got := pg_temp.entry(next_input, play);
  if got is null or (got ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '38 hours') or got ->> 'on' is distinct from b::text then
    raise exception 'a cast earn made in an earlier window and still up is not carried with its end and its character: %', got;
  end if;
  if pg_temp.entry(next_input, early) is not null then raise exception 'a cast earn that ended before the window was carried'; end if;
  if pg_temp.entry(next_input, ended_play) is not null then raise exception 'a cast earn an admin ended was carried'; end if;

  -- The estimate, over the open window up to six hours in: Bob's carries Ann's play on his character, made inside it; Cat's, a third player's, does not; Ann's carries her own.
  est := estimate_input(bob, w0 + interval '6 hours');
  got := pg_temp.entry(est, play);
  if got is null or (got ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '38 hours') or got ->> 'on' is distinct from b::text then
    raise exception 'the target''s estimate does not carry another''s cast earn made inside the open window: %', got;
  end if;
  est := estimate_input(cat, w0 + interval '6 hours');
  if pg_temp.entry(est, play) is not null then raise exception 'a third player''s estimate carries a cast earn on another''s character'; end if;
  est := estimate_input(ann, w0 + interval '6 hours');
  if pg_temp.entry(est, play) is null then raise exception 'the caster''s estimate does not carry her own cast earn'; end if;
  -- And one made before the window, still up in it, is carried for the target as before, once.
  before := tests.act(a, 'card', t, jsonb_build_object('card', 'ecboost', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', b, 'ends', w0 + interval '30 hours', 'targetName', 'Ec St Bob'), pb, w0 - interval '1 hour');
  est := estimate_input(bob, w0 + interval '6 hours');
  if pg_temp.entry(est, before) is null then raise exception 'the target''s estimate does not carry a cast earn made before the window'; end if;
  if (select count(*) from jsonb_array_elements(est -> 'acts') e where e ->> 'id' = before::text) is distinct from 1::bigint
     or (select count(*) from jsonb_array_elements(est -> 'acts') e where e ->> 'id' = play::text) is distinct from 1::bigint then
    raise exception 'the target''s estimate counts a cast earn twice';
  end if;
end $$;
