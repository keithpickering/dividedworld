-- The glass's preferences (supabase/migrations/0033_glass_preferences.sql): how much smoke stands
-- behind the glass, its contrast, and the text's size, saved to the account beside the theme,
-- postbit and motion of 0019, each kept when a call leaves it out, read by that account alone.
-- The two-worlds plan, Task 1.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('glass-ann');
  bob uuid := tests.account('glass-bob');
  cy uuid := tests.account('glass-cy');
  said jsonb;
begin
  -- A first call naming only the smoke keeps the other five at their defaults.
  perform tests.become(ann);
  said := set_preferences(smoke => 'off');
  if said is distinct from '{"theme": "system", "postbit": "side", "motion": "system", "smoke": "off", "contrast": "standard", "text_size": 100}'::jsonb then
    raise exception 'a first call naming the smoke alone keeps the rest at their defaults: %', said;
  end if;
  if (select (smoke, contrast, text_size) from account_preferences) is distinct from ('off'::text, 'standard'::text, 100::smallint) then
    raise exception 'the smoke reads back as it was set';
  end if;
  -- A later call naming only the text size keeps the smoke.
  said := set_preferences(text_size => 200);
  if said ->> 'smoke' is distinct from 'off' or (said ->> 'text_size')::integer is distinct from 200 then raise exception 'a preference left out is kept: %', said; end if;
  -- Each of the three set away from its default, and the others kept.
  said := set_preferences(contrast => 'high');
  said := set_preferences(smoke => 'low', text_size => 125);
  if said is distinct from '{"theme": "system", "postbit": "side", "motion": "system", "smoke": "low", "contrast": "high", "text_size": 125}'::jsonb then
    raise exception 'each of the three is set and the rest kept: %', said;
  end if;
  -- Each refusal by its words.
  if pg_temp.refusal($q$select set_preferences(smoke => 'thick')$q$) is distinct from 'the smoke is full, low or off' then raise exception 'a smoke that is none of them'; end if;
  if pg_temp.refusal($q$select set_preferences(contrast => 'max')$q$) is distinct from 'contrast is standard or high' then raise exception 'a contrast that is neither'; end if;
  if pg_temp.refusal($q$select set_preferences(text_size => 175)$q$) is distinct from 'text size is 100, 125, 150 or 200 percent' then raise exception 'a text size that is none of them'; end if;
  perform tests.unbecome();

  -- The three-argument call of 0025-profiles.sql still sets the first three and leaves the new
  -- three at their defaults.
  perform tests.become(bob);
  said := set_preferences('dark', 'stacked', 'reduce');
  if said is distinct from '{"theme": "dark", "postbit": "stacked", "motion": "reduce", "smoke": "full", "contrast": "standard", "text_size": 100}'::jsonb then
    raise exception 'the three-argument call still works and leaves the glass at its defaults: %', said;
  end if;
  -- A second account reads no row of the first's.
  if exists (select 1 from account_preferences where account = ann) then raise exception 'another account read the glass preferences'; end if;
  if (select count(*) from account_preferences) is distinct from 1 then raise exception 'an account reads its own row alone'; end if;
  perform tests.unbecome();

  -- A first call naming all six writes each as named.
  perform tests.become(cy);
  said := set_preferences('dark', 'stacked', 'full', 'low', 'high', 150);
  if said is distinct from '{"theme": "dark", "postbit": "stacked", "motion": "full", "smoke": "low", "contrast": "high", "text_size": 150}'::jsonb then
    raise exception 'a first call naming all six writes each: %', said;
  end if;
  perform tests.unbecome();

  -- A visitor cannot call it: refused by the grant, before the function asks who is signed in.
  perform tests.become_anon();
  if pg_temp.refusal($q$select set_preferences(smoke => 'low')$q$) is distinct from 'permission denied for function set_preferences' then raise exception 'a visitor could call set_preferences'; end if;
  perform tests.unbecome();
end $$;
