-- The model is told (supabase/migrations/0116_pronouns_for_the_model.sql; docs/plans/2026-11-07-pronouns-plan.md, Task 8; the first design's section 5, the amendment's 2 and 6).
--
-- 1. system_digest: each of its `characters` carries `pronouns` (null for a character with no profile row).
-- 2. pool_thread: each post carries its author's `pronouns`.
-- 3. patrol_sample: each sampled post carries its author's `pronouns`.
-- 4. character_faces replaces pool_names: {id: {name, pronouns}} for the public characters among the ids, nothing for an id that is not a character or not an id.
-- 5. The digest role reads character_profiles (character, pronouns) and no other column of it.

create function pg_temp.expect(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception '%: got "%", wanted "%"', label, got, want; end if;
end $$;

do $$
declare
  she jsonb := '{"subject": "she", "object": "her", "determiner": "her", "possessive": "hers", "reflexive": "herself", "plural": false}';
  they jsonb := '{"subject": "they", "object": "them", "determiner": "their", "possessive": "theirs", "reflexive": "themself", "plural": true}';
  base timestamptz := now() - interval '5 hours';
  acct_a uuid; acct_b uuid; a uuid; b uuid; t uuid; pa uuid; pb uuid; general uuid;
  d jsonb; th jsonb; got jsonb; faces jsonb; c text;
begin
  acct_a := tests.account('pm-a'); acct_b := tests.account('pm-b');
  a := tests.character(acct_a, 'Pm Ann'); b := tests.character(acct_b, 'Pm Bo');
  -- Ann is she/her; Bo has no profile row at all.
  insert into character_profiles (character, pronouns) values (a, she) on conflict (character) do update set pronouns = excluded.pronouns;
  delete from character_profiles where character = b;
  insert into boards (slug, name) values ('pm-board', 'Pm Board') returning id into general;
  insert into threads (board, title) values (general, 'Pronouns for the model') returning id into t;
  pa := tests.post(a, t, 'Ann speaks.', base);
  pb := tests.post(b, t, 'Bo speaks.', base + interval '1 minute');

  -- 5. The role's reach into profiles: the two columns, no more.
  if not has_column_privilege('kayfabb_digest', 'character_profiles', 'pronouns', 'select') or not has_column_privilege('kayfabb_digest', 'character_profiles', 'character', 'select') then
    raise exception 'the digest role cannot read the pronouns';
  end if;
  for c in select attname from pg_attribute where attrelid = 'character_profiles'::regclass and attnum > 0 and not attisdropped and attname not in ('character', 'pronouns') loop
    if has_column_privilege('kayfabb_digest', 'character_profiles', c, 'select') then raise exception 'the digest role reads character_profiles.%', c; end if;
  end loop;

  perform tests.become_service();

  -- 1. The digest.
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '5'), ('digestExcerptChars', '20') on conflict (key) do update set value = excluded.value;
  d := system_digest(base - interval '1 minute', base + interval '5 minutes');
  if (select count(*) from jsonb_array_elements(d -> 'characters') e where (e ->> 'id')::uuid in (a, b)) is distinct from 2::bigint then raise exception 'the digest does not name both: %', d -> 'characters'; end if;
  got := (select e -> 'pronouns' from jsonb_array_elements(d -> 'characters') e where (e ->> 'id')::uuid = a);
  perform pg_temp.expect('the digest, Ann', got ->> 'subject', 'she');
  if (select e -> 'pronouns' from jsonb_array_elements(d -> 'characters') e where (e ->> 'id')::uuid = b) is distinct from 'null'::jsonb then
    raise exception 'a character with no profile row has pronouns in the digest: %', d -> 'characters';
  end if;

  -- 2. The thread.
  th := pool_thread(t, 5, 40);
  perform pg_temp.expect('the thread, Ann', th #>> '{posts,0,pronouns,subject}', 'she');
  if th #> '{posts,1,pronouns}' is distinct from 'null'::jsonb then raise exception 'Bo has pronouns in the thread: %', th; end if;
  perform pg_temp.expect('the thread keeps the name', th #>> '{posts,0,name}', 'Pm Ann');

  -- 3. The patrol's sample.
  got := patrol_sample(array[general], 10);
  perform pg_temp.expect('the sample, newest first is Bo', got #>> '{0,name}', 'Pm Bo');
  if got #> '{0,pronouns}' is distinct from 'null'::jsonb then raise exception 'Bo has pronouns in the sample: %', got -> 0; end if;
  perform pg_temp.expect('the sample, Ann', got #>> '{1,pronouns,object}', 'her');

  -- 4. The faces.
  faces := character_faces(jsonb_build_array(a, b, gen_random_uuid(), 'not an id', 7));
  perform pg_temp.expect('a face, Ann', faces -> a::text ->> 'name', 'Pm Ann');
  perform pg_temp.expect('a face, Ann pronouns', faces #>> array[a::text, 'pronouns', 'subject'], 'she');
  perform pg_temp.expect('a face, Bo', faces -> b::text ->> 'name', 'Pm Bo');
  if faces -> b::text -> 'pronouns' is distinct from 'null'::jsonb then raise exception 'Bo has pronouns in the faces: %', faces; end if;
  if (select count(*) from jsonb_object_keys(faces)) is distinct from 2::bigint then raise exception 'the faces: %', faces; end if;
  if character_faces('"x"') is distinct from '{}'::jsonb then raise exception 'a non-array gave faces'; end if;
  if to_regprocedure('pool_names(jsonb)') is not null then raise exception 'pool_names is still there'; end if;
  perform tests.unbecome();

  -- Not a client's.
  foreach c in array array['anon', 'authenticated'] loop
    perform set_config('role', c, true);
    begin perform character_faces('[]'); raise exception 'faces: % could call it', c; exception when insufficient_privilege then null; end;
  end loop;
  perform set_config('role', 'postgres', true);
end $$;
