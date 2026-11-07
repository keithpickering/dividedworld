-- Pronouns stored, created, edited and seeded (supabase/migrations/0118_pronouns.sql; docs/plans/2026-11-07-pronouns-plan.md, Task 2).
--
-- 1. pronouns_hold holds what engine/rules/pronouns.ts's pronounProblems holds. The two lists below, one row per line, are read by engine/rules/pronouns-held.test.ts
--    too, which asserts every poison fails pronounProblems and every good passes it, so the two sides cannot drift. Non-ASCII is written as JSON escapes so a combining
--    mark or an invisible character can be seen.
-- 2. The instance's `pronouns` setting is held where it is written (settings_held), beside the 0079 rows.
-- 3. A character made with no set takes the setting's, else the it-set; one made with she/her reads she/her from profile_projection; a bad set is refused.
-- 4. set_profile stores a custom set, keeps the stored one when given null, refuses a bad one with the hint, and profile_projection never carries updated_at.
-- 5. A character with no profile row (made before the migration) gets one, with the it-set, from the migration's backfill.
-- 6. A reseed that changes a persona's or the developer's pronouns changes its profile's; a reseed naming none leaves it; its title is not rewritten.

create temp table pronoun_poisons (value text);
insert into pronoun_poisons (value) values
  ('{"subject": "", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "abcdefghijklm", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a b", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": " a", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a ", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "-a", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a-", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "''a", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a''", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "\u2019a", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a\u2019", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a--b", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a''-b", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a-''b", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a''''b", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a1", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "1", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a_b", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a.b", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a/b", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "\u0301a", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a-\u0301b", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a''\u0301b", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a\u200bb", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a\tb", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a\nb", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "\ud83d\ude00", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a\ud83d\ude00", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "\u00f1and\u00faxxxxxxxx", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "abcdefghijklm", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "a b", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "a-", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": 5, "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": null, "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": ["it"], "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "abcdefghijklm", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "a b", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "a-", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": 5, "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": null, "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": ["it"], "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "abcdefghijklm", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "a b", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "a-", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": 5, "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": null, "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": ["it"], "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "abcdefghijklm", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "a b", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "a-", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": 5, "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": null, "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": ["it"], "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself"}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": "yes"}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": "true"}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": 1}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": 0}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": null}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": []}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": {}}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false, "extra": "x"}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false, "Subject": "it"}'),
  ('{}'),
  ('[]'),
  ('"it"'),
  ('null'),
  ('5'),
  ('true'),
  ('{"subject": "it"}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false, "more": 1}');

create temp table pronoun_goods (value text);
insert into pronoun_goods (value) values
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "he", "object": "him", "determiner": "his", "possessive": "his", "reflexive": "himself", "plural": false}'),
  ('{"subject": "she", "object": "her", "determiner": "her", "possessive": "hers", "reflexive": "herself", "plural": false}'),
  ('{"subject": "they", "object": "them", "determiner": "their", "possessive": "theirs", "reflexive": "themself", "plural": true}'),
  ('{"subject": "xe", "object": "xem", "determiner": "xyr", "possessive": "xyrs", "reflexive": "xemself", "plural": false}'),
  ('{"subject": "ze", "object": "hir", "determiner": "hir", "possessive": "hirs", "reflexive": "hirself", "plural": false}'),
  ('{"subject": "y''all", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "y\u2019all", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "mary-jo", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "o''er-the-top", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "abcdefghijkl", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "a", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6\ud835\udcb6", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "They", "object": "Them", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "\u00e9lan", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "cafe\u0301", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "e\u0301''a", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "\u0436\u0438", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "\u4ed6", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "ma\u0301-ri\u0301a", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": true}'),
  ('{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself-too", "plural": false}');

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

do $$
declare r record;
begin
  for r in select value from pronoun_poisons loop
    if pronouns_hold(r.value::jsonb) then raise exception 'pronouns_hold accepted the poison %', r.value; end if;
  end loop;
  for r in select value from pronoun_goods loop
    if not pronouns_hold(r.value::jsonb) then raise exception 'pronouns_hold refused the good %', r.value; end if;
  end loop;
  if pronouns_hold(null) then raise exception 'pronouns_hold accepted null'; end if;
end $$;

-- ---- 2. The setting is held where it is written ----
do $$
declare r record; why text;
begin
  delete from settings where key = 'pronouns';
  for r in select value from pronoun_poisons loop
    why := pg_temp.refusal(format($q$insert into settings (key, value) values ('pronouns', %L::jsonb)$q$, r.value));
    if why is null or why not like '23514: pronouns is %' then raise exception 'the setting accepted or misnamed the poison %: %', r.value, why; end if;
  end loop;
  for r in select value from pronoun_goods loop
    insert into settings (key, value) values ('pronouns', r.value::jsonb) on conflict (key) do update set value = excluded.value;
  end loop;
  delete from settings where key = 'pronouns';
end $$;

-- ---- 3. A character is made with a set ----
-- The calls are made as the player; the rows are read back as the harness, since a player reads profiles through the screens' functions.
do $$
declare
  ann uuid := tests.account('pn-ann');
  she jsonb := '{"subject": "she", "object": "her", "determiner": "her", "possessive": "hers", "reflexive": "herself", "plural": false}';
  they jsonb := '{"subject": "they", "object": "them", "determiner": "their", "possessive": "theirs", "reflexive": "themself", "plural": true}';
  it jsonb := '{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}';
  none uuid; setting uuid; hers uuid; loud uuid;
  why text;
begin
  delete from settings where key = 'pronouns';
  perform tests.become(ann);
  none := (create_character('Pn None', 'alpha') ->> 'id')::uuid;
  perform tests.unbecome();
  if (select pronouns from character_profiles where character = none) is distinct from it then raise exception 'with no setting a character is made with the it-set: %', (select pronouns from character_profiles where character = none); end if;

  insert into settings (key, value) values ('pronouns', they);
  perform tests.become(ann);
  setting := (create_character('Pn Setting', 'alpha') ->> 'id')::uuid;
  hers := (create_character('Pn Hers', 'alpha', 'now', 'announced', she) ->> 'id')::uuid;
  loud := (create_character('Pn Loud', 'alpha', 'now', 'announced', jsonb_set(she, '{subject}', '"SHE"')) ->> 'id')::uuid;
  why := pg_temp.refusal($q$select create_character('Pn Bad', 'alpha', 'now', 'announced', '{"subject": "abcdefghijklm", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}')$q$);
  perform tests.unbecome();
  if (select pronouns from character_profiles where character = setting) is distinct from they then raise exception 'with a setting a character is made with the setting''s set'; end if;
  if profile_projection(hers) -> 'pronouns' is distinct from she then raise exception 'a character made with she/her reads she/her from profile_projection: %', profile_projection(hers); end if;
  if (select pronouns ->> 'subject' from character_profiles where character = loud) is distinct from 'she' then raise exception 'a set is stored lowercase'; end if;
  if why is distinct from '22023: pronouns are five words of 1 to 12 letters' then raise exception 'a bad set is refused at creation: %', why; end if;
  if exists (select 1 from characters where name = 'Pn Bad') then raise exception 'a refused creation made nothing'; end if;
  -- A setting written with capitals is stored lowercase on the character it gives its set to.
  update settings set value = jsonb_set(they, '{subject}', '"They"') where key = 'pronouns';
  perform tests.become(ann);
  setting := (create_character('Pn Setting Caps', 'alpha') ->> 'id')::uuid;
  perform tests.unbecome();
  if (select pronouns from character_profiles where character = setting) is distinct from they then raise exception 'a capitalized setting is stored lowercase: %', (select pronouns from character_profiles where character = setting); end if;
  delete from settings where key = 'pronouns';
end $$;

-- ---- 4. set_profile ----
do $$
declare
  bob uuid := tests.account('pn-bob');
  cy uuid := tests.account('pn-cy');
  b uuid;
  c uuid := tests.character(cy, 'Pn Cy');
  custom jsonb := '{"subject": "xe", "object": "xem", "determiner": "xyr", "possessive": "xyrs", "reflexive": "xemself", "plural": false}';
  bad text := '{"subject": "abcdefghijklm", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}';
  said1 jsonb; said2 jsonb; said3 jsonb; first_ jsonb;
  why text;
  hint text;
  held jsonb;
begin
  perform tests.become(bob);
  b := (create_character('Pn Bob', 'alpha') ->> 'id')::uuid;
  said1 := set_profile(b, 'A title', 'Signed.', 'default', custom);
  said2 := set_profile(b, 'Another title', 'Signed.', 'stars');
  said3 := set_profile(b, 'Another title', 'Signed.', 'stars', null);
  why := pg_temp.refusal(format($q$select set_profile(%L, '', '', 'default', %L::jsonb)$q$, b, bad));
  begin
    perform set_profile(b, '', '', 'default', bad::jsonb);
  exception when others then get stacked diagnostics hint = pg_exception_hint;
  end;
  perform tests.unbecome();
  if said1 -> 'pronouns' is distinct from custom then raise exception 'set_profile stores a custom set: %', said1; end if;
  if said2 -> 'pronouns' is distinct from custom or said2 ->> 'title' is distinct from 'Another title' then raise exception 'set_profile with no set keeps the stored set: %', said2; end if;
  if said3 -> 'pronouns' is distinct from custom then raise exception 'a null set keeps the stored set'; end if;
  if said1 ? 'updated_at' or said3 ? 'updated_at' or profile_projection(b) ? 'updated_at' then raise exception 'profile_projection never carries updated_at: %', said3; end if;
  if why is distinct from '22023: pronouns are five words of 1 to 12 letters' then raise exception 'a 13-letter subject is refused: %', why; end if;
  if hint is distinct from 'kayfabb.refusal' then raise exception 'the refusal carries the hint: %', hint; end if;
  if (select pronouns from character_profiles where character = b) is distinct from custom then raise exception 'a refused set_profile changes nothing'; end if;

  -- A character with no profile row yet (made by the fixtures' insert) gets one by set_profile, with the it-set when none is given.
  perform tests.become(cy);
  first_ := set_profile(c, 'T', '', 'default');
  perform tests.unbecome();
  if first_ -> 'pronouns' ->> 'subject' is distinct from 'it' then raise exception 'a first profile takes the it-set when none is given: %', first_; end if;
end $$;

-- ---- 5. The backfill: a character that has no profile row gets the it-set ----
do $$
declare made uuid := tests.character(tests.account('pn-dee'), 'Pn Before');
begin
  if exists (select 1 from character_profiles where character = made) then raise exception 'the fixture makes a character with no profile row'; end if;
  -- The migration's statement, copied as it wrote it: migrations replay into an empty database, so no character exists when the migration's own backfill runs, and
  -- breaking that statement in 0118 is not seen here. This holds the statement's shape only.
  insert into character_profiles (character) select c.id from characters c
  where exists (select 1 from pip_styles where key = 'default') and not exists (select 1 from character_profiles p where p.character = c.id);
  if (select pronouns from character_profiles where character = made) is distinct from
     '{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}'::jsonb then raise exception 'a character made before the migration has the it-set'; end if;
  if not (select bool_and(exists (select 1 from character_profiles p where p.character = c.id)) from characters c) then raise exception 'every character has a profile row'; end if;
end $$;

-- ---- 6. The seed ----
do $$
declare
  seed jsonb;
  she jsonb := '{"subject": "she", "object": "her", "determiner": "her", "possessive": "hers", "reflexive": "herself", "plural": false}';
  he jsonb := '{"subject": "he", "object": "him", "determiner": "his", "possessive": "his", "reflexive": "himself", "plural": false}';
  they jsonb := '{"subject": "they", "object": "them", "determiner": "their", "possessive": "theirs", "reflexive": "themself", "plural": true}';
  it jsonb := '{"subject": "it", "object": "it", "determiner": "its", "possessive": "its", "reflexive": "itself", "plural": false}';
  why text;
begin
  delete from settings where key = 'pronouns';
  seed := jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Pn Dev', 'title', 'Developer', 'pronouns', he),
    'system', jsonb_build_object('firstBoss', 'pn-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'pn-boss', 'name', 'Pn Boss', 'title', 'Boss', 'signature', 'Hi', 'pronouns', she),
        jsonb_build_object('key', 'pn-plain', 'name', 'Pn Plain', 'title', 'Member', 'signature', 'Hi'))));
  perform seed_instance(seed);
  if (select pronouns from character_profiles p join characters c on c.id = p.character where c.staff = 'pn-boss') is distinct from she then raise exception 'a new persona is made with its set'; end if;
  if (select pronouns from character_profiles p join characters c on c.id = p.character where c.staff = 'pn-plain') is distinct from it then raise exception 'a new persona that names none gets the it-set'; end if;
  if (select pronouns from character_profiles p join characters c on c.id = p.character where c.staff = 'developer') is distinct from he then raise exception 'the developer is made with its set'; end if;

  -- With a setting, a new persona that names none takes the setting's set.
  insert into settings (key, value) values ('pronouns', they);
  perform seed_instance(jsonb_set(seed, '{system,staff}', (seed #> '{system,staff}') || jsonb_build_array(jsonb_build_object('key', 'pn-late', 'name', 'Pn Late', 'title', 'Member', 'signature', 'Hi'))));
  if (select pronouns from character_profiles p join characters c on c.id = p.character where c.staff = 'pn-late') is distinct from they then raise exception 'a new persona that names none takes the setting''s set'; end if;
  delete from settings where key = 'pronouns';

  -- A reseed that changes a persona's and the developer's set changes their profiles'; the title and the signature are not rewritten.
  update character_profiles p set title = 'Written by an admin', signature = 'Mine' from characters c where c.id = p.character and c.staff in ('pn-boss', 'developer');
  perform seed_instance(jsonb_set(jsonb_set(seed, '{system,staff,0,pronouns}', they), '{developer,pronouns}', they));
  if (select pronouns from character_profiles p join characters c on c.id = p.character where c.staff = 'pn-boss') is distinct from they then raise exception 'a reseed rewrites a persona''s set'; end if;
  if (select pronouns from character_profiles p join characters c on c.id = p.character where c.staff = 'developer') is distinct from they then raise exception 'a reseed rewrites the developer''s set'; end if;
  if (select title from character_profiles p join characters c on c.id = p.character where c.staff = 'pn-boss') is distinct from 'Written by an admin' then raise exception 'a reseed does not rewrite a title'; end if;
  if (select title from character_profiles p join characters c on c.id = p.character where c.staff = 'developer') is distinct from 'Written by an admin' then raise exception 'a reseed does not rewrite the developer''s title'; end if;

  -- A reseed naming none leaves the set as it is.
  perform seed_instance(jsonb_set(seed #- '{system,staff,0,pronouns}', '{developer}', (seed -> 'developer') - 'pronouns'));
  if (select pronouns from character_profiles p join characters c on c.id = p.character where c.staff = 'pn-boss') is distinct from they then raise exception 'a reseed naming none leaves a persona''s set'; end if;
  if (select pronouns from character_profiles p join characters c on c.id = p.character where c.staff = 'developer') is distinct from they then raise exception 'a reseed naming none leaves the developer''s set'; end if;

  -- A bad set is refused, naming the persona (and the developer), and nothing is written.
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(seed, '{system,staff,0,pronouns,subject}', '"abcdefghijklm"')));
  if why is null or why not like '22023: persona pn-boss has pronouns%' then raise exception 'a bad persona set is refused by name: %', why; end if;
  why := pg_temp.refusal(format('select seed_instance(%L::jsonb)', jsonb_set(seed, '{developer,pronouns}', '"it"')));
  if why is null or why not like '22023: the developer has pronouns%' then raise exception 'a bad developer set is refused: %', why; end if;
  if (select pronouns from character_profiles p join characters c on c.id = p.character where c.staff = 'pn-boss') is distinct from they then raise exception 'a refused seed wrote nothing'; end if;
end $$;
