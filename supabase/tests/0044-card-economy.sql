-- The screens price cards as the server does (#86; supabase/migrations/0039_card_economy.sql; the glass cleanup's design,
-- section 4): screen_settings carries `cardEconomy`, the live economy row cut to the keys the cards read (each card's
-- price_setting and its `reads`), so an admin's tuning shows at once, and none of the classes' numbers.

do $$
declare
  held jsonb;
  card_keys text[];
begin
  -- An instance seeded before 0039: no card's `reads` is known yet, and every price is there all the same.
  perform tests.become_anon();
  held := (select settings -> 'cardEconomy' from screen_settings);
  perform tests.unbecome();
  if held is distinct from '{"sweetie.price": 100, "splat.price": 100, "blot.price": 100}'::jsonb then
    raise exception 'before a re-seed, cardEconomy holds each price: %', held;
  end if;

  -- The economy also holds a class's numbers; a re-seed records what each card reads.
  update settings set value = value || '{"alpha.weight": 7, "blot.perLength": 3, "blot.lengthStep": 400}' where key = 'economy';
  perform seed_instance(jsonb_build_object(
    'settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'boards', '[]'::jsonb,
    'cards', jsonb_build_array(jsonb_build_object('key', 'blot', 'name', 'Blot', 'alignment', 'salty', 'priceSetting', 'blot.price', 'stack', 3, 'seeded', true,
      'reads', jsonb_build_array('blot.perLength', 'blot.lengthStep')))));
  if (select reads from card_kinds where key = 'blot') is distinct from array['blot.perLength', 'blot.lengthStep'] then
    raise exception 'seed_instance did not record what the card reads: %', (select reads from card_kinds where key = 'blot');
  end if;

  perform tests.become(tests.account('econ-reader'));
  held := (select settings -> 'cardEconomy' from screen_settings);
  perform tests.unbecome();
  if held is distinct from '{"sweetie.price": 100, "splat.price": 100, "blot.price": 100, "blot.perLength": 3, "blot.lengthStep": 400}'::jsonb then
    raise exception 'cardEconomy is each card''s price and reads: %', held;
  end if;
  -- None of the classes' numbers, nor any key no card reads.
  card_keys := (select array_agg(k) from (select price_setting as k from card_kinds union select unnest(reads) from card_kinds) x);
  if exists (select 1 from jsonb_object_keys(held) j where j <> all (card_keys)) then
    raise exception 'cardEconomy holds a key no card reads: %', held;
  end if;
  if held ? 'alpha.weight' then raise exception 'cardEconomy holds a class''s number'; end if;

  -- An admin's tuning shows at once.
  update settings set value = jsonb_set(value, '{splat.price}', '250') where key = 'economy';
  perform tests.become_anon();
  held := (select settings -> 'cardEconomy' from screen_settings);
  perform tests.unbecome();
  if (held ->> 'splat.price')::integer is distinct from 250 then raise exception 'cardEconomy did not follow the economy row: %', held; end if;
end $$;
