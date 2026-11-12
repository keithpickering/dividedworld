-- Gear and the outfit (supabase/migrations/0205_gear.sql; the cosmetics plan, Task 2). The gear is this file's own (tg...); the engine's words for an outfit's
-- problems (engine/rules/cosmetics.ts outfitProblems) are held here by their SQL twins.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
declare hint text; msg text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics hint = pg_exception_hint;
  msg := sqlerrm;
  if hint is distinct from 'kayfabb.refusal' then return 'NOT A REFUSAL (' || coalesce(hint, 'no hint') || '): ' || msg; end if;
  return msg;
end $$;

-- Any error at all, for the guards that raise no refusal of a player's.
create function pg_temp.error(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then return sqlerrm;
end $$;

select tests.unbecome();
insert into settings (key, value) values ('cosmetics', '{"gear": {"wornMost": 3, "reach": 0.4}, "trophies": {"shownMost": 3}, "events": {"windowMinutes": 15, "dayMost": 4, "outcomes": {"line": 70, "gear": 20, "card": 10}, "gearRarity": {"common": 80}, "cardRarity": {"common": 80}}}')
  on conflict (key) do update set value = excluded.value;
insert into gear_kinds (key, rarity) values ('tg-mustache', 'common'), ('tg-hat', 'uncommon');

-- ---- A copy is worn on one mask at a time, by the account that holds it ----
do $$
declare
  ann uuid := tests.account('tg-ann'); bob uuid := tests.account('tg-bob');
  a1 uuid := tests.character(ann, 'Tg Ann One'); a2 uuid := tests.character(ann, 'Tg Ann Two'); b1 uuid := tests.character(bob, 'Tg Bob One');
  stache jsonb := '[{"gear": "tg-mustache", "x": 0.5, "y": 0.6, "w": 0.3, "turn": 10, "layer": 0}]';
  said text;
begin
  -- Bob holds a copy too: a count over every account would find two, and let Ann wear hers twice.
  insert into gear_ledger (account, gear, kind) values (ann, 'tg-mustache', 'granted'), (bob, 'tg-mustache', 'granted');
  perform tests.become_service();
  perform set_outfit(ann, a1, stache);
  said := pg_temp.refusal(format('select set_outfit(%L, %L, %L)', ann, a2, stache));
  if said is null or said not like '%"tg-mustache"%' then raise exception 'a second copy on a second mask was not refused, naming the gear: %', said; end if;
  if (select count(*) from gear_worn where character = a2) is distinct from 0 then raise exception 'a refused outfit left pieces on the second mask'; end if;
  -- The same mask may be saved again with its own piece: the copy it wears is free to it.
  perform set_outfit(ann, a1, '[{"gear": "tg-mustache", "x": 0.4, "y": 0.6, "w": 0.3, "turn": 0, "layer": 0}]');
  if (select x from gear_worn where character = a1 and layer = 0) is distinct from 0.4 then raise exception 'saving an outfit again replaces its pieces'; end if;
  -- With two held, both masks wear one.
  perform tests.unbecome();
  insert into gear_ledger (account, gear, kind) values (ann, 'tg-mustache', 'granted');
  perform tests.become_service();
  perform set_outfit(ann, a2, stache);
  if (select count(*) from gear_worn where gear = 'tg-mustache' and character in (a1, a2)) is distinct from 2 then raise exception 'with two held both masks wear one'; end if;
  -- Bob's copy never reached Ann's count, and Ann's masks never reached his.
  perform set_outfit(bob, b1, stache);
  -- An empty outfit takes everything off.
  perform set_outfit(ann, a2, '[]');
  if (select count(*) from gear_worn where character = a2) is distinct from 0 then raise exception 'an empty outfit takes every piece off'; end if;
  -- The words of outfitProblems: two pieces on a layer, too many pieces, a piece with no such gear and a bound past its edge.
  perform tests.unbecome();
  insert into gear_ledger (account, gear, kind) values (ann, 'tg-hat', 'granted'), (ann, 'tg-hat', 'granted'), (ann, 'tg-hat', 'granted'), (ann, 'tg-hat', 'granted');
  perform tests.become_service();
  said := pg_temp.refusal(format('select set_outfit(%L, %L, %L)', ann, a2, '[{"gear": "tg-hat", "x": 0.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 1}, {"gear": "tg-hat", "x": 0.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 1}]'));
  if said is distinct from '"tg-hat" shares layer 1 with "tg-hat"' then raise exception 'two pieces on a layer: %', said; end if;
  said := pg_temp.refusal(format('select set_outfit(%L, %L, %L)', ann, a2, '[{"gear": "tg-hat", "x": 0.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 0}, {"gear": "tg-hat", "x": 0.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 1}, {"gear": "tg-hat", "x": 0.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 2}, {"gear": "tg-hat", "x": 0.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 3}]'));
  if said not like '4 pieces are worn; at most 3%' then raise exception 'too many pieces: %', said; end if;
  said := pg_temp.refusal(format('select set_outfit(%L, %L, %L)', ann, a2, '[{"gear": "tg-hat", "x": 1.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 0}]'));
  if said is distinct from 'a piece''s x is outside the portrait' then raise exception 'a piece off the portrait: %', said; end if;
  -- Every bound of a piece: refused one step past it, accepted on it (wornMost is 3, so layers are 0 to 2).
  foreach said in array array[
    'layer=3', 'layer=-1', 'layer=1.5', 'layer="1"', 'layer=null',
    'w=0.04', 'w=1.51', 'turn=-180.5', 'turn=181', 'x=-0.01', 'x=1.01', 'y=-0.01', 'y=1.01'] loop
    if pg_temp.refusal(format('select set_outfit(%L, %L, %L)', ann, a2,
         jsonb_set('[{"gear": "tg-hat", "x": 0.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 0}]'::jsonb, array['0', split_part(said, '=', 1)], split_part(said, '=', 2)::jsonb)::text)) is null
      then raise exception 'a piece past a bound was accepted: %', said; end if;
  end loop;
  foreach said in array array[
    '[{"gear": "tg-hat", "x": 0, "y": 0, "w": 0.05, "turn": -180, "layer": 0}]',
    '[{"gear": "tg-hat", "x": 1, "y": 1, "w": 1.5, "turn": 180, "layer": 2}]'] loop
    if pg_temp.refusal(format('select set_outfit(%L, %L, %L)', ann, a2, said)) is not null then raise exception 'a piece on a bound was refused: %', said; end if;
  end loop;
  perform set_outfit(ann, a2, '[]');
  -- A mixed refusal reads layer collisions before copy shortfalls, as outfitProblems lists them (Ann holds two mustaches; her other mask wears one).
  said := pg_temp.refusal(format('select set_outfit(%L, %L, %L)', ann, a2, '[{"gear": "tg-mustache", "x": 0.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 0}, {"gear": "tg-mustache", "x": 0.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 0}]'));
  if said is distinct from '"tg-mustache" shares layer 0 with "tg-mustache"; "tg-mustache" is worn 2 times here, and 1 copy is free' then raise exception 'a mixed refusal''s order: %', said; end if;
  said := pg_temp.refusal(format('select set_outfit(%L, %L, %L)', ann, a2, '[{"gear": "tg-nothing", "x": 0.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 0}]'));
  if said is distinct from 'there is no gear "tg-nothing"' then raise exception 'gear that does not exist: %', said; end if;
  said := pg_temp.refusal(format('select set_outfit(%L, %L, %L)', ann, a2, '{"gear": "tg-hat"}'));
  if said is null then raise exception 'an outfit that is no list of pieces'; end if;
  -- Another account, through a mask it does not play, is refused as played_by refuses, and nothing changes.
  said := pg_temp.refusal(format('select set_outfit(%L, %L, %L)', bob, a1, '[]'));
  if said is distinct from 'you do not play that character' then raise exception 'another account''s set_outfit: %', said; end if;
  if (select count(*) from gear_worn where character = a1) is distinct from 1 then raise exception 'a refused set_outfit changed the mask''s pieces'; end if;
  -- A player cannot call it past the function that holds the account's identity: the service alone does.
  perform tests.become(ann);
  if pg_temp.refusal(format('select set_outfit(%L, %L, %L)', ann, a1, '[]')) is null then raise exception 'a player called set_outfit'; end if;
  perform tests.unbecome();
end $$;

-- ---- A retired mask is refused as played_by refuses; an instance with no gear settings refuses plainly ----
select tests.unbecome();
do $$
declare
  gwen uuid := tests.account('tg-gwen'); g1 uuid := tests.character(gwen, 'Tg Gwen One'); said text; was jsonb;
begin
  insert into gear_ledger (account, gear, kind) values (gwen, 'tg-hat', 'granted');
  perform tests.become_service();
  update characters set retired_at = now() where id = g1;
  said := pg_temp.refusal(format('select set_outfit(%L, %L, %L)', gwen, g1, '[{"gear": "tg-hat", "x": 0.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 0}]'));
  if said is distinct from 'that character is retired; an admin can restore it' then raise exception 'a retired mask was dressed or refused oddly: %', said; end if;
  update characters set retired_at = null where id = g1;
  perform tests.unbecome();
  select value into was from settings where key = 'cosmetics';
  delete from settings where key = 'cosmetics';
  perform tests.become_service();
  said := pg_temp.refusal(format('select set_outfit(%L, %L, %L)', gwen, g1, '[{"gear": "tg-hat", "x": 0.5, "y": 0.5, "w": 0.3, "turn": 0, "layer": 0}]'));
  if said is distinct from 'this instance has no gear settings' then raise exception 'no cosmetics setting: %', said; end if;
  perform tests.unbecome();
  insert into settings (key, value) values ('cosmetics', was);
end $$;

-- ---- A new portrait takes the outfit off; a square recrop keeps it ----
select tests.unbecome();
do $$
declare
  cat uuid := tests.account('tg-cat'); c1 uuid := tests.character(cat, 'Tg Cat One');
  p jsonb;
begin
  insert into gear_ledger (account, gear, kind) values (cat, 'tg-hat', 'granted');
  perform tests.become_service();
  perform set_avatar(cat, c1, 'sq-1.webp', 'pt-1.webp', '{"x": 0, "y": 0, "w": 1, "h": 0.5}', '{"x": 0, "y": 0, "w": 1, "h": 1}', 1.5);
  perform set_outfit(cat, c1, '[{"gear": "tg-hat", "x": 0.5, "y": 0.1, "w": 0.4, "turn": 0, "layer": 0}]');
  p := profile_projection(c1);
  if p -> 'portrait_tallness' is distinct from '1.5'::jsonb then raise exception 'the tallness is projected: %', p; end if;
  if p #>> '{outfit,0,gear}' is distinct from 'tg-hat' or jsonb_array_length(p -> 'outfit') <> 1 then raise exception 'the outfit is projected, in layer order: %', p -> 'outfit'; end if;
  perform set_avatar(cat, c1, 'sq-2.webp', null, '{"x": 0, "y": 0.2, "w": 1, "h": 0.5}', null);
  if (select count(*) from gear_worn where character = c1) is distinct from 1 then raise exception 'a square recrop keeps the outfit'; end if;
  if (select portrait_tallness from character_profiles where character = c1) is distinct from 1.5 then raise exception 'a square recrop keeps the portrait''s tallness'; end if;
  perform set_avatar(cat, c1, 'sq-3.webp', 'pt-3.webp', '{"x": 0, "y": 0, "w": 1, "h": 0.5}', '{"x": 0, "y": 0, "w": 1, "h": 1}', 2);
  if (select count(*) from gear_worn where character = c1) is distinct from 0 then raise exception 'a new portrait takes the outfit off'; end if;
  if profile_projection(c1) -> 'outfit' is distinct from '[]'::jsonb then raise exception 'a bare mask projects an empty outfit: %', profile_projection(c1); end if;
  if pg_temp.refusal(format('select set_avatar(%L, %L, %L, %L, %L, %L, %s)', cat, c1, 'x.webp', 'y.webp', '{"x": 0, "y": 0, "w": 1, "h": 0.5}', '{"x": 0, "y": 0, "w": 1, "h": 1}', 2.5)) is null then raise exception 'a tallness past 2 was accepted'; end if;
  -- A retired mask is bare.
  perform set_outfit(cat, c1, '[{"gear": "tg-hat", "x": 0.5, "y": 0.1, "w": 0.4, "turn": 0, "layer": 0}]');
  perform tests.unbecome();
  insert into admins (account) values (cat);
  perform tests.become(cat);
  perform retire_character(c1);
  perform tests.unbecome();
  if (select count(*) from gear_worn where character = c1) is distinct from 0 then raise exception 'retiring a character takes its outfit off'; end if;
end $$;

-- ---- The ledger is never edited ----
select tests.unbecome();
do $$
declare
  dee uuid := tests.account('tg-dee'); said text;
begin
  insert into gear_ledger (account, gear, kind) values (dee, 'tg-hat', 'granted');
  said := pg_temp.error('update gear_ledger set gear = ''tg-mustache''');
  if said is null or said not like 'a ledger row is never edited or removed%' then raise exception 'an update of the gear ledger: %', said; end if;
  said := pg_temp.error('delete from gear_ledger');
  if said is null or said not like 'a ledger row is never edited or removed%' then raise exception 'a delete from the gear ledger: %', said; end if;
  said := pg_temp.error('truncate gear_ledger');
  if said is null or said not like 'a ledger row is never edited or removed%' then raise exception 'a truncate of the gear ledger: %', said; end if;
  said := pg_temp.error('insert into gear_ledger (account, gear, kind) values (''' || dee || ''', ''tg-hat'', ''found'')');
  if said is null then raise exception 'a found row with no event'; end if;
  said := pg_temp.error('insert into gear_ledger (account, gear, kind, event) values (''' || dee || ''', ''tg-hat'', ''granted'', gen_random_uuid())');
  if said is null then raise exception 'a granted row naming an event'; end if;
end $$;

-- ---- The wardrobe and the ledger are the caller's own ----
select tests.unbecome();
do $$
declare
  eve uuid := tests.account('tg-eve'); fay uuid := tests.account('tg-fay');
  e1 uuid := tests.character(eve, 'Tg Eve One'); e2 uuid := tests.character(eve, 'Tg Eve Two'); f1 uuid := tests.character(fay, 'Tg Fay One');
  w jsonb;
begin
  insert into gear_ledger (account, gear, kind) values (eve, 'tg-hat', 'granted'), (eve, 'tg-hat', 'granted'), (eve, 'tg-mustache', 'granted'), (fay, 'tg-mustache', 'granted'), (fay, 'tg-mustache', 'granted'), (fay, 'tg-mustache', 'granted');
  perform tests.become_service();
  perform set_outfit(eve, e1, '[{"gear": "tg-hat", "x": 0.5, "y": 0.1, "w": 0.4, "turn": 0, "layer": 0}]');
  perform set_outfit(eve, e2, '[{"gear": "tg-hat", "x": 0.5, "y": 0.1, "w": 0.4, "turn": 0, "layer": 0}]');
  perform set_outfit(fay, f1, '[{"gear": "tg-mustache", "x": 0.5, "y": 0.6, "w": 0.3, "turn": 0, "layer": 0}]');
  perform tests.become(eve);
  w := my_wardrobe();
  if (select jsonb_agg(x ->> 'gear' order by x ->> 'gear') from jsonb_array_elements(w) x) is distinct from '["tg-hat", "tg-mustache"]'::jsonb then raise exception 'my_wardrobe lists the caller''s gear only: %', w; end if;
  if (select (x ->> 'held')::int from jsonb_array_elements(w) x where x ->> 'gear' = 'tg-mustache') is distinct from 1 then raise exception 'my_wardrobe counts the caller''s copies, not Fay''s three: %', w; end if;
  if (select jsonb_agg(c order by c) from jsonb_array_elements_text((select x -> 'worn_by' from jsonb_array_elements(w) x where x ->> 'gear' = 'tg-hat')) c) is distinct from (select jsonb_agg(c order by c) from unnest(array[e1::text, e2::text]) c) then raise exception 'my_wardrobe names the masks that wear a gear: %', w; end if;
  if (select count(*) from gear_ledger) is distinct from 3 then raise exception 'a player reads only their own gear ledger: %', (select count(*) from gear_ledger); end if;
  perform tests.become(fay);
  if (select count(*) from gear_ledger) is distinct from 3 or jsonb_array_length(my_wardrobe()) is distinct from 1 then raise exception 'Fay''s own rows and wardrobe'; end if;
  if (select count(*) from gear_worn) < 3 then raise exception 'gear_worn is public to signed-in players'; end if;
  perform tests.unbecome(); update characters set debuted_at = null where id = e2; perform tests.become(fay);
  if (select count(*) from gear_worn where character = e2) is distinct from 0 then raise exception 'gear_worn shows an undebuted mask''s pieces by its id'; end if;
  if (select count(*) from gear_worn where character = e1) is distinct from 1 then raise exception 'gear_worn shows a debuted mask''s pieces'; end if;
  perform tests.become_anon();
  if pg_temp.refusal('select my_wardrobe()') is null then raise exception 'a visitor opened a wardrobe'; end if;
  if pg_temp.refusal('select count(*) from gear_ledger') is null then raise exception 'a visitor read the gear ledger'; end if;
  perform tests.unbecome();
end $$;

-- ---- An admin grants gear, and the answer is the same whoever plays the mask ----
select tests.unbecome();
do $$
declare
  gus uuid := tests.account('tg-gus'); hal uuid := tests.account('tg-hal'); boss uuid := tests.account('tg-boss');
  g1 uuid := tests.character(gus, 'Tg Gus One'); h1 uuid := tests.character(hal, 'Tg Hal One');
  said text; before_g integer; before_h integer;
begin
  insert into admins (account) values (boss);
  perform tests.become(gus);
  said := pg_temp.refusal(format('select grant_gear(%L, %L, 1)', g1, 'tg-hat'));
  if said is distinct from 'only an admin grants gear' then raise exception 'a player granted gear: %', said; end if;
  perform tests.become(boss);
  if grant_gear(g1, 'tg-hat', 2) is distinct from '{"granted": 2}'::jsonb or grant_gear(h1, 'tg-hat', 2) is distinct from '{"granted": 2}'::jsonb then raise exception 'grant_gear answers the same for any two players'; end if;
  perform tests.unbecome();
  if gear_held(gus, 'tg-hat') <> 2 or gear_held(hal, 'tg-hat') <> 2 then raise exception 'the grant went to the account that plays the mask'; end if;
  if (select count(*) from gear_ledger where account in (gus, hal) and kind = 'granted' and event is null) is distinct from 4 then raise exception 'two granted rows each'; end if;
  perform tests.become(boss);
  for i in 1..1 loop
    foreach said in array array[
      format('select grant_gear(%L, %L, 0)', g1, 'tg-hat'), format('select grant_gear(%L, %L, 101)', g1, 'tg-hat'),
      format('select grant_gear(%L, %L, 1)', g1, 'tg-none'), format('select grant_gear(%L, %L, 1)', gen_random_uuid(), 'tg-hat')] loop
      if pg_temp.refusal(said) is null then raise exception 'a bad grant was accepted: %', said; end if;
    end loop;
  end loop;
  if grant_gear(g1, 'tg-hat', 100) is distinct from '{"granted": 100}'::jsonb then raise exception 'a hundred copies is the most, and allowed'; end if;
  perform tests.unbecome();
end $$;

-- ---- A seed adds the instance's gear and never removes one a ledger row names ----
select tests.unbecome();
do $$
declare
  ivy uuid := tests.account('tg-ivy');
  base jsonb := jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'cards', '[]'::jsonb, 'boards', '[]'::jsonb);
begin
  perform seed_instance(base || jsonb_build_object('gear', jsonb_build_array(jsonb_build_object('key', 'tg-seeded', 'rarity', 'rare'), jsonb_build_object('key', 'tg-named', 'rarity', 'common'), jsonb_build_object('key', 'tg-dropped', 'rarity', 'common'))));
  if (select rarity from gear_kinds where key = 'tg-seeded') is distinct from 'rare' then raise exception 'a seed adds its gear'; end if;
  insert into gear_ledger (account, gear, kind) values (ivy, 'tg-named', 'granted');
  perform seed_instance(base || jsonb_build_object('gear', jsonb_build_array(jsonb_build_object('key', 'tg-seeded', 'rarity', 'uncommon'))));
  if (select rarity from gear_kinds where key = 'tg-seeded') is distinct from 'uncommon' then raise exception 'a re-seed brings a rarity up to date'; end if;
  if not exists (select 1 from gear_kinds where key = 'tg-named') then raise exception 'a re-seed removed gear a ledger row names'; end if;
  if exists (select 1 from gear_kinds where key = 'tg-dropped') then raise exception 'a re-seed kept gear nothing names and the instance dropped'; end if;
  perform seed_instance(base);
  if not exists (select 1 from gear_kinds where key = 'tg-seeded') then raise exception 'a seed with no gear list touches no gear'; end if;
end $$;
