-- Tuned settings rows (docs/plans/2026-11-12-release-backend-plan.md, Task 1; its design is docs/plans/2026-11-12-release-backend-design.md, D2, D3 and D4).
-- An admin's write to a settings row marks it tuned (`tuned_at`), and the seed keeps a tuned row's values while filling in any key the row lacks, at any
-- depth; an untuned row is written as the seed always wrote it. The seed's own writes never mark a row. The fixtures' own settings are written after the
-- migrations, so the trigger marks them tuned: each test that needs an untuned row clears the mark first, as an admin does to hand a row back to the code.

-- The payload a seed takes, with only the settings it is about.
create function pg_temp.seed(settings jsonb) returns jsonb language sql as $$
  select seed_instance(jsonb_build_object('settings', settings, 'classes', '[]'::jsonb, 'cards', '[]'::jsonb, 'boards', '[]'::jsonb))
$$;

-- ---- 1. A write marks the row tuned, and a seed keeps the tuned value ----
do $$
begin
  update settings set tuned_at = null where key = 'registrationMode';
  update settings set value = '"closed"' where key = 'registrationMode';
  if (select tuned_at from settings where key = 'registrationMode') is null then raise exception 'an admin''s write to a settings row did not mark it tuned'; end if;
  perform pg_temp.seed('{"registrationMode": "open"}');
  if (select value from settings where key = 'registrationMode') is distinct from '"closed"'::jsonb then raise exception 'a seed overwrote a tuned value: %', (select value from settings where key = 'registrationMode'); end if;
  if (select tuned_at from settings where key = 'registrationMode') is null then raise exception 'a seed took the tuned mark off a row it kept'; end if;
end $$;

-- ---- 2. Clearing the mark hands the row back to the code ----
do $$
begin
  update settings set tuned_at = null where key = 'registrationMode';
  if (select tuned_at from settings where key = 'registrationMode') is not null then raise exception 'setting tuned_at to null did not clear the mark'; end if;
  perform pg_temp.seed('{"registrationMode": "open"}');
  if (select value from settings where key = 'registrationMode') is distinct from '"open"'::jsonb then raise exception 'a seed did not write the code''s value over an untuned row'; end if;
  if (select tuned_at from settings where key = 'registrationMode') is not null then raise exception 'a seed marked the row it wrote as tuned'; end if;
end $$;

-- ---- 3. A tuned economy keeps a retuned price and gains a key the code added ----
do $$
begin
  update settings set tuned_at = null where key = 'economy';
  update settings set value = value || '{"sweetie.price": 250}' where key = 'economy';
  if (select tuned_at from settings where key = 'economy') is null then raise exception 'retuning a price did not mark the economy tuned'; end if;
  perform pg_temp.seed('{"economy": {"sweetie.price": 100, "splat.price": 100, "blot.price": 100, "newcard.price": 40}}');
  if (select value ->> 'sweetie.price' from settings where key = 'economy') is distinct from '250' then raise exception 'a seed took a retuned price away: %', (select value from settings where key = 'economy'); end if;
  if (select value ->> 'newcard.price' from settings where key = 'economy') is distinct from '40' then raise exception 'a seed did not add the new card''s number to a tuned economy: %', (select value from settings where key = 'economy'); end if;
  if (select tuned_at from settings where key = 'economy') is null then raise exception 'a seed took the mark off the economy it kept'; end if;
end $$;

-- ---- 4. An untuned economy takes the code's numbers and keeps a key the code dropped ----
do $$
begin
  update settings set tuned_at = null, value = value || '{"retired.price": 7}' where key = 'economy';
  update settings set tuned_at = null where key = 'economy';
  perform pg_temp.seed('{"economy": {"sweetie.price": 111}}');
  if (select value ->> 'sweetie.price' from settings where key = 'economy') is distinct from '111' then raise exception 'a seed did not write the code''s number over an untuned economy: %', (select value from settings where key = 'economy'); end if;
  if (select value ->> 'retired.price' from settings where key = 'economy') is distinct from '7' then raise exception 'a seed removed a key the code dropped from an untuned economy'; end if;
  if (select tuned_at from settings where key = 'economy') is not null then raise exception 'a seed marked the economy it wrote as tuned'; end if;
end $$;

-- ---- 5. A seed's own writes leave no row marked, new rows included ----
do $$
begin
  update settings set tuned_at = null;
  perform pg_temp.seed('{"registrationMode": "invite", "postsPerPage": 25, "brandNewKey": {"a": 1}, "economy": {"sweetie.price": 100}}');
  if exists (select 1 from settings where tuned_at is not null) then
    raise exception 'a seed marked rows tuned: %', (select string_agg(key, ', ') from settings where tuned_at is not null);
  end if;
  if (select value from settings where key = 'brandNewKey') is distinct from '{"a": 1}'::jsonb then raise exception 'a seed did not insert a missing row'; end if;
  -- A tuned row still takes a key it lacks and stays tuned (the second seed's write is the seed's, not an admin's).
  update settings set value = '{"a": 2}' where key = 'brandNewKey';
  perform pg_temp.seed('{"brandNewKey": {"a": 9, "b": {"c": 3}}}');
  if (select value from settings where key = 'brandNewKey') is distinct from '{"a": 2, "b": {"c": 3}}'::jsonb then raise exception 'a tuned row did not keep its value and gain a nested key: %', (select value from settings where key = 'brandNewKey'); end if;
end $$;

-- ---- 6. set_admin_contact is an admin's write, so it marks adminContact tuned ----
do $$
declare
  adm uuid := tests.account('st-admin');
begin
  insert into admins (account) values (adm);
  delete from settings where key = 'adminContact';
  perform tests.become(adm);
  perform set_admin_contact('[{"label": "Mail", "href": "a@b.example"}]');
  perform tests.unbecome();
  if (select tuned_at from settings where key = 'adminContact') is null then raise exception 'set_admin_contact did not mark adminContact tuned'; end if;
end $$;

-- ---- 7. An import writes a row's tuned_at as given: the trigger is an ordinary one, skipped under replica ----
do $$
declare
  given timestamptz := '2001-02-03T04:05:06Z';
begin
  set local session_replication_role = replica;
  insert into settings (key, value, tuned_at) values ('importedKey', '1', given);
  insert into settings (key, value) values ('importedUntuned', '1');
  set local session_replication_role = origin;
  if (select tuned_at from settings where key = 'importedKey') is distinct from given then raise exception 'an import did not keep the tuned_at it wrote: %', (select tuned_at from settings where key = 'importedKey'); end if;
  if (select tuned_at from settings where key = 'importedUntuned') is not null then raise exception 'an import marked a row that was written untuned'; end if;
end $$;

-- ---- 8. jsonb_fill: the base's values win, missing keys are added at any depth, nothing is removed ----
do $$
begin
  if jsonb_fill('1', '{"a": 1}') is distinct from '1'::jsonb then raise exception 'a scalar base did not win over an object fill'; end if;
  if jsonb_fill('{"a": 1}', '{"a": 2, "b": {"c": 3}}') is distinct from '{"a": 1, "b": {"c": 3}}'::jsonb then raise exception 'an object base did not gain a missing key: %', jsonb_fill('{"a": 1}', '{"a": 2, "b": {"c": 3}}'); end if;
  if jsonb_fill('{"a": {"x": 1}, "k": true}', '{"a": {"x": 2, "y": {"z": 4}}}') is distinct from '{"a": {"x": 1, "y": {"z": 4}}, "k": true}'::jsonb
    then raise exception 'an object base did not gain a missing nested path or lost a key: %', jsonb_fill('{"a": {"x": 1}, "k": true}', '{"a": {"x": 2, "y": {"z": 4}}}'); end if;
  if jsonb_fill('[1, 2]', '[3, 4, 5]') is distinct from '[1, 2]'::jsonb then raise exception 'an array base was not returned as it was'; end if;
  if jsonb_fill('{"a": [1]}', '{"a": [2, 3]}') is distinct from '{"a": [1]}'::jsonb then raise exception 'an array inside an object was merged'; end if;
  if has_function_privilege('authenticated', 'jsonb_fill(jsonb, jsonb)', 'execute') or has_function_privilege('anon', 'seed_setting(text, jsonb)', 'execute') then raise exception 'an API role may run the seed''s helpers'; end if;
end $$;
