-- No debuts: a character is made active (supabase/migrations/0428_no_debuts.sql;
-- docs/plans/2026-11-24-staff-board-threads-plan.md, Task 2): create_character(name, class, pronouns) makes a character that has debuted,
-- at its creation, and writes no Act; set_debut, debut_options and announce_drop are gone, with the two columns only they read
-- (characters.debut_loudness, characters.debut_announcement_due); a settlement debuts and names no one; nothing writes a debut announcement,
-- while the ones already written stay as they were. Every block runs: the harness stops a file at its first error, so each names its own accounts.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- The migration exists at all, so a missing one fails here on an assertion and not on a missing function below.
do $$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('set_debut', 'debut_options', 'announce_drop')) then
    raise exception 'set_debut, debut_options and announce_drop are dropped';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'characters' and column_name in ('debut_loudness', 'debut_announcement_due')) then
    raise exception 'the debut columns of characters are dropped';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'my_characters' and column_name = 'debut_loudness') then
    raise exception 'my_characters no longer says how a debut was announced';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_character') is distinct from 1::bigint then
    raise exception 'one create_character';
  end if;
  if (select pg_get_function_identity_arguments(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_character')
     is distinct from 'name text, class text, pronouns jsonb' then
    raise exception 'create_character takes a name, a class and pronouns: %', (select pg_get_function_identity_arguments(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_character');
  end if;
end $$;

-- ---- A new character is active at once, and writes no Act ----
do $$
declare
  ann uuid := tests.account('nd-ann');
  made jsonb;
  said jsonb;
  c characters%rowtype;
  t uuid := tests.thread('Born Active here');
begin
  perform tests.become(ann);
  made := create_character('Born Active', 'alpha');
  perform tests.unbecome();
  if (select array_agg(k order by k) from jsonb_object_keys(made) k) is distinct from array['class', 'id', 'name'] then raise exception 'the answer is the id, the name and the class: %', made; end if;
  select * into c from characters where id = (made ->> 'id')::uuid;
  if c.debuted_at is null then raise exception 'a new character has debuted: %', made; end if;
  if c.debuted_at is distinct from c.created_at then raise exception 'it debuted at its creation: % vs %', c.debuted_at, c.created_at; end if;
  if (select count(*) from acts where character = c.id) is distinct from 0::bigint then raise exception 'making a character writes no Act'; end if;
  if (select class_key from class_now(c.id, now())) is distinct from 'alpha' then raise exception 'it holds the class it was made with'; end if;
  -- With pronouns, which are the third argument.
  perform tests.become(ann);
  said := create_character('Born With Words', 'beta', '{"subject": "she", "object": "her", "determiner": "her", "possessive": "hers", "reflexive": "herself", "plural": false}'::jsonb);
  perform tests.unbecome();
  if (select debuted_at from characters where id = (said ->> 'id')::uuid) is null then raise exception 'a character made with pronouns has debuted'; end if;
  if (select pronouns ->> 'subject' from character_profiles where character = (said ->> 'id')::uuid) is distinct from 'she' then raise exception 'the pronouns are kept'; end if;
  -- It acts at once.
  perform tests.become(ann);
  perform post(t, (made ->> 'id')::uuid, 'Here at once.');
  perform tests.unbecome();
end $$;

-- ---- A settlement debuts no one and names no one ----
do $$
declare
  ann uuid := tests.account('nd-settle');
  w uuid;
  r uuid;
begin
  -- A character that was left waiting (one a settlement would have debuted); the staff persona that waits for an office is the kind that remains.
  insert into characters (owner, name, created_at) values (ann, 'Left Waiting', now() - interval '1 day') returning id into w;
  insert into class_history (character, class_key, started_at) values (w, 'alpha', now() - interval '1 day');
  r := masks_change(now() + interval '1 minute');
  if r is not null then raise exception 'a settlement with no Turns names no one: %', r; end if;
  if (select debuted_at from characters where id = w) is not null then raise exception 'a settlement debuts no one'; end if;
  if exists (select 1 from acts where kind = 'announce' and payload ->> 'what' = 'debut') then raise exception 'a settlement writes no debut'; end if;
end $$;

-- ---- A debut announcement is written by no one ----
do $$
declare
  ann uuid := tests.account('nd-refuse');
  a uuid := tests.character(ann, 'Refuse Debut', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Not debuts');
  why text;
begin
  why := pg_temp.refusal(format('select write_announce(%L, %L, %L, null, null, now())', a, t, 'debut'));
  if why is distinct from '23514: a debut is no longer announced' then raise exception 'a debut announcement is refused: %', why; end if;
  why := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''announce'', %L, ''{"what": "debut"}'')', a, t));
  if why is distinct from '23514: a debut is no longer announced' then raise exception 'a debut announcement is refused whoever writes it: %', why; end if;
  -- A Turn's announcement is still written.
  perform write_announce(a, t, 'turn', null, null, now());
end $$;
