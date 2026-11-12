-- A surface card is cast face up and never set face down (supabase/migrations/0343_surface_face_up.sql; docs/plans/2026-11-12-graffiti-face-up-plan.md, Task 2; design section 1).
-- face_down_never_writes refuses a back for a card with a surface, in the words of the engine's decideSet; set_surface_card is gone; a back already set before 0343 (its face_down row and its
-- face_down_draws row) still springs through lay_sprung with its draft written in, and is still taken back with its draft deleted. The card is this file's own (`sfu`, with the surface flag).

insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, stack, surface)
values ('sfu', 'Sfu Wall', 'pepperoni', 'rare', 'cast', null, '{post}', 1, true);

create function pg_temp.cells(first integer, n integer) returns bit(10000) language sql as $$
  select (repeat('0', first) || repeat('1', n) || repeat('0', 10000 - first - n))::bit(10000)
$$;

-- ---- 1. a back for a surface card is refused, in the engine's words ----
do $$
declare
  ann uuid := tests.account('sfu-1-ann');
  a uuid := tests.character(ann, 'Sfu One Ann');
  t uuid := tests.thread('Sfu one'); p1 uuid := tests.post(a, t, 'Nothing set here.');
  written uuid; got text;
begin
  insert into acts (character, kind, thread, target_act_id, payload) values (a, 'set', t, p1, '{}') returning id into written;
  begin
    insert into face_down (play, account, card, config, post, thread, round, ends_at) values (written, ann, 'sfu', '{}', p1, t, 1, now() + interval '1 day');
    got := null;
  exception when others then
    got := sqlerrm;
  end;
  if got is distinct from 'Sfu Wall is cast face up and never set face down' then raise exception 'a back for a surface card is refused in decideSet''s words: %', got; end if;
  if exists (select 1 from face_down where play = written) then raise exception 'the refused back wrote nothing'; end if;
end $$;

-- ---- 2. set_surface_card no longer exists ----
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_surface_card') then
    raise exception 'set_surface_card is dropped';
  end if;
end $$;

-- ---- 3. a back set before 0343 still springs with its draft, and is still taken back with its draft ----
-- These rows stand for backs set before 0343: written directly, with the trigger disabled in this transaction.
alter table face_down disable trigger face_down_never_writes;
do $$
declare
  ann uuid := tests.account('sfu-3-ann'); bob uuid := tests.account('sfu-3-bob');
  a uuid := tests.character(ann, 'Sfu Three Ann'); b uuid := tests.character(bob, 'Sfu Three Bob');
  t uuid := tests.thread('Sfu three'); p1 uuid := tests.post(a, t, 'An old back under a wall.'); p2 uuid := tests.post(a, t, 'An old back to take back.');
  set1 uuid; set2 uuid; q1 uuid; spring jsonb; struck uuid; got text;
  draft jsonb := '{"strokes": [{"width": 0.01, "points": [[0.1, 0.1]]}]}';
begin
  insert into acts (character, kind, thread, target_act_id, payload) values (a, 'set', t, p1, '{}') returning id into set1;
  insert into face_down (play, account, card, config, post, thread, round, ends_at) values (set1, ann, 'sfu', '{}', p1, t, 1, now() + interval '1 day');
  insert into face_down_draws (play, payload, cells, most, most_live) values (set1, draft, pg_temp.cells(0, 500), 4000, 48);
  insert into acts (character, kind, thread, target_act_id, payload) values (a, 'set', t, p2, '{}') returning id into set2;
  insert into face_down (play, account, card, config, post, thread, round, ends_at) values (set2, ann, 'sfu', '{}', p2, t, 1, now() + interval '1 day');
  insert into face_down_draws (play, payload, cells, most, most_live) values (set2, draft, pg_temp.cells(0, 10), 4000, 48);
  -- Bob quotes the first post: the back springs, and the draft is written in as the first draw.
  perform tests.become(bob);
  spring := post(t, b, 'Quoting the old back.', p1);
  q1 := (spring ->> 'id')::uuid;
  spring := spring -> 'sprung';
  perform tests.unbecome();
  if spring is null then raise exception 'the quote springs the old back: %', spring; end if;
  if spring -> 'payload' ->> 'did' <> 'landed' or (spring -> 'payload' ->> 'drawn') is distinct from 'true' then raise exception 'the spring says the draft was drawn: %', spring; end if;
  struck := (select k.id from acts k where k.kind = 'card' and k.target_act_id = q1 and k.payload ->> 'card' = 'sfu');
  if struck is null then raise exception 'the wall landed on the quoting post'; end if;
  if (select bit_count(cover) from surfaces where play = struck) is distinct from 500 then raise exception 'the draft is the first draw, covering 500 cells'; end if;
  if not exists (select 1 from acts d where d.kind = 'draw' and d.target_act_id = struck and d.character = a) then raise exception 'the first draw is by the setter'; end if;
  if exists (select 1 from face_down_draws where play = set1) then raise exception 'the draft row is deleted once read'; end if;
  -- The second is taken back, and its draft goes with it.
  got := (select r::text from (select take_back(ann, a, set2)) x(r));
  if exists (select 1 from face_down_draws where play = set2) then raise exception 'a taken-back card takes its draft with it'; end if;
  if not exists (select 1 from acts k where k.kind = 'take_back' and (k.payload ->> 'set') = set2::text) then raise exception 'the back is taken back'; end if;
end $$;
