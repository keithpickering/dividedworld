-- Taking a face-down card back, and the hand that follows (supabase/migrations/0146_card_types.sql; docs/plans/2026-11-11-card-types-design.md, section 6; plan Task 4).
-- A back ends by its spring, a take-back naming it, or its time; a taken-back card is a `returned` row in the setter's ledger and a public take_back Act by the post's author; a back
-- whose time passes unsprung and not taken back is returned by card_held and my_card_ledger without a row of its own; card_held never counts a back twice. The cards are this file's own (tk...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('tkmatch', 'Tk Match', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null),
    ('tksalty', 'Tk Salty', 'salty', 'common', 'cast', null, '{post}', null)
  on conflict (key) do nothing;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- A back written as it would be were its time already past: a set Act and its face_down row, with the played row set_card writes. `at` is when it was set, `ends` when it ends.
create function pg_temp.old_back(who uuid, ch uuid, th uuid, post uuid, card text, at timestamptz, ends timestamptz) returns uuid language plpgsql as $$
declare s uuid;
begin
  s := tests.act(ch, 'set', th, '{}', post, at);
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s, who, card, post, th, 1, ends);
  insert into card_ledger (account, card, kind, act, price, at) values (who, card, 'played', s, 0, at);
  return s;
end $$;

-- ---- A take-back returns the card, ends the back, and writes what it should ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tk-ann'); bob uuid := tests.account('tk-bob');
  a uuid := tests.character(ann, 'Tk Ann'); a2 uuid := tests.character(ann, 'Tk Ann Two'); b uuid := tests.character(bob, 'Tk Bob');
  t uuid := tests.thread('Tk thread'); p uuid := tests.post(a, t, 'Backed.');
  back uuid; taken jsonb; act_id uuid; why text; nothing text; effect jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'tkmatch', 'tkmatch');
  perform pg_temp.hand(bob, 'tksalty', 'tksalty');
  perform tests.become_service();
  back := (set_card(ann, 'tkmatch', a, p, '{}', 0) ->> 'id')::uuid;
  if card_held(ann, 'tkmatch') is distinct from 1 then raise exception 'a set did not spend the card'; end if;

  -- Another account's take-back, one naming no back, one by the wrong character and one of an Act that is no set are refused in the same words, whichever it is.
  nothing := pg_temp.coded(format('select take_back(%L, %L, %L)', bob, b, gen_random_uuid()));
  if nothing is distinct from 'P0002 there is no face-down card to take back there' then raise exception 'no back: %', nothing; end if;
  why := pg_temp.coded(format('select take_back(%L, %L, %L)', bob, b, back));
  if why is distinct from nothing then raise exception 'another''s back and no back are told apart: % / %', why, nothing; end if;
  why := pg_temp.coded(format('select take_back(%L, %L, %L)', ann, a2, back));
  if why is distinct from nothing then raise exception 'another of the setter''s masks is told apart: % / %', why, nothing; end if;
  why := pg_temp.coded(format('select take_back(%L, %L, %L)', ann, a, p));
  if why is distinct from nothing then raise exception 'a post that is no set is told apart: % / %', why, nothing; end if;
  if card_held(ann, 'tkmatch') is distinct from 1 or exists (select 1 from acts where kind = 'take_back') then raise exception 'a refused take-back changed something'; end if;

  taken := take_back(ann, a, back);
  act_id := (taken ->> 'id')::uuid;
  if not exists (select 1 from acts where id = act_id and kind = 'take_back' and character = a and target_act_id = p and thread = t and payload = jsonb_build_object('set', back::text)) then
    raise exception 'the take-back Act is not the post author''s on the post with {set}: %', taken;
  end if;
  if card_held(ann, 'tkmatch') is distinct from 2 then raise exception 'the card did not come back to the hand: %', card_held(ann, 'tkmatch'); end if;
  if not exists (select 1 from card_ledger where account = ann and card = 'tkmatch' and kind = 'returned' and act = act_id and price = 0) then raise exception 'no returned row for the take-back'; end if;

  -- A second take-back is refused in the same words, and returns nothing more.
  why := pg_temp.coded(format('select take_back(%L, %L, %L)', ann, a, back));
  if why is distinct from nothing then raise exception 'a second take-back: % / %', why, nothing; end if;
  if card_held(ann, 'tkmatch') is distinct from 2 or (select count(*) from acts where kind = 'take_back') is distinct from 1::bigint then raise exception 'a second take-back changed something'; end if;

  -- The back is ended: a cast on the post springs nothing and lands, and the post can hold a new back at once.
  perform play_card(bob, 'tksalty', b, p, '{}', 0, '');
  if exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back::text) then raise exception 'a taken-back back sprang'; end if;
  if not exists (select 1 from acts where kind = 'card' and target_act_id = p and payload ->> 'card' = 'tksalty' and not (payload ? 'caught')) then raise exception 'the cast on a taken-back post did not land'; end if;
  perform set_card(ann, 'tkmatch', a, p, '{}', 0);
  if card_held(ann, 'tkmatch') is distinct from 1 then raise exception 'setting again did not spend the card'; end if;

  -- The back's own readers: the setter's log says it was taken back, and the post's face-down effect has ended where it was.
  perform tests.become(ann);
  if (select f.ended_by from my_face_down f where f.play = back) is distinct from 'taken back' or (select f.ended_at from my_face_down f where f.play = back) is null then raise exception 'my_face_down does not say it was taken back'; end if;
  perform tests.unbecome();
  effect := (select e from jsonb_array_elements(card_target(p) -> 'effects') e where e ->> 'act' = back::text);
  if (effect ->> 'ends')::timestamptz > now() then raise exception 'card_target still holds the taken-back back live: %', effect; end if;

  -- A take-back Act is not written by hand for a back that is not live: an Act naming a sprung or another post's set is refused by the table.
  why := pg_temp.coded(format($q$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'take_back', %L, %L, %L)$q$, a, t, p, jsonb_build_object('set', back::text)));
  if why is null then raise exception 'a second take_back Act for one back was written'; end if;
  why := pg_temp.coded(format($q$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'take_back', %L, %L, %L)$q$, a, t, p, jsonb_build_object('set', back::text, 'card', 'tkmatch')));
  if why is null then raise exception 'a take_back Act holding more than its set was written'; end if;
end $$;

-- ---- The hand after a back's time: counted once, whichever way the back ended ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tk-h-ann'); a uuid := tests.character(ann, 'Tk H Ann');
  t uuid := tests.thread('Tk hand');
  ended timestamptz := now() - interval '1 day';
  p1 uuid := tests.post(a, t, 'Time.'); p2 uuid := tests.post(a, t, 'Taken before.'); p3 uuid := tests.post(a, t, 'Sprang at the end.'); p4 uuid := tests.post(a, t, 'Taken after.');
  s uuid; sp uuid; why text; nothing constant text := 'P0002 there is no face-down card to take back there';
  timed bigint; ledgered bigint;
begin
  perform pg_temp.cards();
  -- One bought card per back, so the hand reads 0 for a spent back and 1 for one that came back.
  perform pg_temp.hand(ann, 'tkmatch', 'tkmatch', 'tkmatch', 'tkmatch');
  perform tests.unbecome();

  -- p1: its time passed, unsprung, never taken back: the card is back.
  s := pg_temp.old_back(ann, a, t, p1, 'tkmatch', now() - interval '3 days', ended);
  if card_held(ann, 'tkmatch') is distinct from 4 then raise exception 'a back past its time did not return its card: %', card_held(ann, 'tkmatch'); end if;
  -- p2: taken back at two days ago, before its time: the one return is the ledger's, and the time term does not count it again.
  s := pg_temp.old_back(ann, a, t, p2, 'tkmatch', now() - interval '3 days', ended);
  sp := tests.act(a, 'take_back', t, jsonb_build_object('set', s::text), p2, now() - interval '2 days');
  insert into card_ledger (account, card, kind, act, price, at) values (ann, 'tkmatch', 'returned', sp, 0, now() - interval '2 days');
  if card_held(ann, 'tkmatch') is distinct from 4 + 0 then raise exception 'a back taken back before its time was counted twice or not at all: %', card_held(ann, 'tkmatch'); end if;
  -- p3: sprung at the very instant its time ends: the spring spent it (a caught card is the setter's by its own row, not here), and its time returns nothing.
  s := pg_temp.old_back(ann, a, t, p3, 'tkmatch', now() - interval '3 days', ended);
  sp := tests.act(a, 'spring', t, jsonb_build_object('card', 'tkmatch', 'trigger', 'cast', 'did', 'caught', 'set', s::text, 'by', gen_random_uuid()::text), p3, ended);
  if card_held(ann, 'tkmatch') is distinct from 3 then raise exception 'a back that sprang as its time ended was counted: %', card_held(ann, 'tkmatch'); end if;
  -- p4: its time passed and then someone asks to take it back: refused as any ended back is, and the hand still counts it once.
  s := pg_temp.old_back(ann, a, t, p4, 'tkmatch', now() - interval '3 days', ended);
  perform tests.become_service();
  why := pg_temp.coded(format('select take_back(%L, %L, %L)', ann, a, s));
  if why is distinct from nothing then raise exception 'a take-back after the time passed: %', why; end if;
  perform tests.unbecome();
  if card_held(ann, 'tkmatch') is distinct from 3 then raise exception 'a refused take-back after the time changed the hand: %', card_held(ann, 'tkmatch'); end if;

  -- A take_back Act written after its back's time is refused by the table, not only by the function.
  why := pg_temp.coded(format($q$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'take_back', %L, %L, %L)$q$, a, t, p4, jsonb_build_object('set', s::text)));
  if why is null then raise exception 'a take_back Act past the back''s time was written'; end if;

  -- The setter's own readers: how each ended, and one `returned` line for the time-ended back and none for the others the ledger already holds or the spring spent.
  perform tests.become(ann);
  if (select array_agg(f.ended_by order by f.post) from my_face_down f where f.post in (p1, p2, p3, p4)) is distinct from
     (select array_agg(case post when p1 then 'time' when p2 then 'taken back' when p3 then 'sprung' else 'time' end order by post) from (values (p1), (p2), (p3), (p4)) v(post)) then
    raise exception 'my_face_down ended_by: %', (select array_agg(f.post || ' ' || coalesce(f.ended_by, '-')) from my_face_down f where f.post in (p1, p2, p3, p4));
  end if;
  select count(*) filter (where kind = 'returned' and act is null and at = ended), count(*) filter (where kind = 'returned' and act is not null) into timed, ledgered from my_card_ledger where card = 'tkmatch';
  if timed is distinct from 2::bigint or ledgered is distinct from 1::bigint then raise exception 'my_card_ledger returned lines: time-ended % ledger %', timed, ledgered; end if;
  -- Another account sees none of it, and card_held answers a signed-in caller for their own hand alone, as it did.
  perform tests.unbecome();
  perform tests.become(tests.account('tk-h-other'));
  if card_held(ann, 'tkmatch') is distinct from 0 then raise exception 'card_held showed another account''s hand'; end if;
  if exists (select 1 from my_face_down) or exists (select 1 from my_card_ledger) then raise exception 'another account reads a back or a ledger line'; end if;
  perform tests.unbecome();
end $$;

-- ---- An account with many ended backs: the count stays exact (the plan's scale case) ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tk-m-ann'); a uuid := tests.character(ann, 'Tk M Ann');
  t uuid := tests.thread('Tk many');
  i integer; p uuid; s uuid; sp uuid;
begin
  perform pg_temp.cards();
  perform tests.unbecome();
  for i in 1 .. 100 loop
    p := tests.post(a, t, 'Many ' || i);
    s := pg_temp.old_back(ann, a, t, p, 'tkmatch', now() - interval '5 days', now() - interval '2 days');
    if i <= 40 then
      sp := tests.act(a, 'take_back', t, jsonb_build_object('set', s::text), p, now() - interval '4 days');
      insert into card_ledger (account, card, kind, act, price, at) values (ann, 'tkmatch', 'returned', sp, 0, now() - interval '4 days');
    elsif i <= 70 then
      sp := tests.act(a, 'spring', t, jsonb_build_object('card', 'tkmatch', 'trigger', 'cast', 'did', 'caught', 'set', s::text, 'by', gen_random_uuid()::text), p, now() - interval '3 days');
    end if;
  end loop;
  -- 100 played rows, 40 returned by a take-back, 30 sprung (spent), 30 whose time passed: 40 + 30 come back.
  if card_held(ann, 'tkmatch') is distinct from -100 + 40 + 30 then raise exception 'many ended backs: %', card_held(ann, 'tkmatch'); end if;
end $$;
