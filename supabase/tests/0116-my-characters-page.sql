-- my_characters_page() (supabase/migrations/0122_my_characters_page.sql; the glass-load design, section 7; its plan, Task 5): /characters and
-- /characters/edit in one read. Each piece equals the matching view read made directly, by id: the caller's own characters and no one else's, each
-- with its public face and profile, its counters, its standing, its class reveals and its announced Turns. A caller with no account gets an empty
-- list, and a visitor is refused.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('mc-ann');
  bob uuid := tests.account('mc-bob');
  nobody uuid := gen_random_uuid();
  a1 uuid := tests.character(ann, 'Mc Zed', 'alpha', now() - interval '60 days');
  a2 uuid := tests.character(ann, 'Mc Abe', 'beta', now() - interval '60 days');
  a3 uuid;
  b1 uuid := tests.character(bob, 'Mc Bobs', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Mc thread');
  doc jsonb;
  c jsonb;
  why text;
begin
  insert into auth.users (id, email) values (nobody, 'mc-nobody@test.invalid');
  -- A third character of Ann's that has not debuted: the public views show nothing of it, and its row says so.
  insert into characters (owner, name, created_at) values (ann, 'Mc Waiting', now()) returning id into a3;
  insert into class_history (character, class_key, started_at) values (a3, 'alpha', now());
  insert into character_profiles (character, title, signature) values (a1, 'The Zed', 'zed sig') on conflict (character) do update set title = excluded.title;
  perform tests.post(a1, t, 'One.');
  perform tests.post(a1, t, 'Two.');
  perform tests.post(a2, t, 'Three.');
  perform tests.post(b1, t, 'Four.');
  -- Zed revealed its class and announced a Turn.
  perform tests.become(ann);
  perform unmask(a1, t, 'Zed says.');
  perform tests.unbecome();
  perform write_announce(a1, tests.thread('Mc turns'), 'turn', 'alpha', null, now() - interval '10 days');
  update standings set amount = 42 where character = a1 and season = (select id from current_season);

  perform tests.become(ann);
  doc := my_characters_page();
  if jsonb_typeof(doc -> 'characters') is distinct from 'array' then raise exception 'characters is a list: %', doc; end if;
  if jsonb_array_length(doc -> 'characters') is distinct from 3 then raise exception 'three characters of Ann''s: %', doc -> 'characters'; end if;
  -- By name, as myCharacters orders them.
  if (select jsonb_agg(x ->> 'name') from jsonb_array_elements(doc -> 'characters') x) is distinct from '["Mc Abe", "Mc Waiting", "Mc Zed"]'::jsonb then
    raise exception 'by name: %', doc -> 'characters';
  end if;
  if doc::text like '%Mc Bobs%' or doc::text like '%' || b1::text || '%' then raise exception 'another player''s character is in the page: %', doc; end if;
  if (doc ->> 'nextSettlementAt')::timestamptz is distinct from next_settlement_at() then raise exception 'nextSettlementAt: %', doc -> 'nextSettlementAt'; end if;
  -- Every piece of every character equals the view read made directly for that id.
  for c in select x from jsonb_array_elements(doc -> 'characters') x loop
    if c - 'face' - 'counts' - 'standing' - 'reveals' - 'turns' is distinct from (select to_jsonb(m) from my_characters m where m.id = (c ->> 'id')::uuid) then
      raise exception 'the own row differs from my_characters: %', c;
    end if;
    if c -> 'face' is distinct from coalesce((
        select to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) || profile_cosmetics(p.character) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
            from character_profiles r where r.character = cp.id) p))
        from characters_public cp where cp.id = (c ->> 'id')::uuid), 'null'::jsonb) then
      raise exception 'face: %', c -> 'face';
    end if;
    if c -> 'counts' is distinct from coalesce((select to_jsonb(n) from (select character, posts, spins, cards from character_post_counts where character = (c ->> 'id')::uuid) n), 'null'::jsonb) then
      raise exception 'counts: %', c -> 'counts';
    end if;
    if c -> 'standing' is distinct from coalesce((select to_jsonb(s.standing) from current_standings s where s.character = (c ->> 'id')::uuid), 'null'::jsonb) then
      raise exception 'standing: %', c -> 'standing';
    end if;
    if c -> 'reveals' is distinct from coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from (
         select act, character, class, at, via, thread from class_reveals where character = (c ->> 'id')::uuid) r), '[]'::jsonb) then
      raise exception 'reveals: %', c -> 'reveals';
    end if;
    if c -> 'turns' is distinct from coalesce((select jsonb_agg(to_jsonb(t2) order by t2.at, t2.act::text collate "C") from (
         select act, character, at, was from turns_announced where character = (c ->> 'id')::uuid) t2), '[]'::jsonb) then
      raise exception 'turns: %', c -> 'turns';
    end if;
  end loop;
  -- The specifics, so the loop above is not comparing two empty things.
  c := (select x from jsonb_array_elements(doc -> 'characters') x where x ->> 'id' = a1::text);
  if c #>> '{face,profile,title}' is distinct from 'The Zed' then raise exception 'Zed''s profile: %', c -> 'face'; end if;
  if (c #>> '{counts,posts}')::integer is null or (c #>> '{counts,posts}')::integer < 2 then raise exception 'Zed''s posts: %', c -> 'counts'; end if;
  if (c ->> 'standing')::integer is distinct from 42 then raise exception 'Zed''s standing: %', c -> 'standing'; end if;
  if jsonb_array_length(c -> 'reveals') is distinct from 1 then raise exception 'Zed has one reveal: %', c -> 'reveals'; end if;
  if jsonb_array_length(c -> 'turns') is distinct from 1 then raise exception 'Zed has one announced Turn: %', c -> 'turns'; end if;
  c := (select x from jsonb_array_elements(doc -> 'characters') x where x ->> 'id' = a3::text);
  if c -> 'face' is distinct from 'null'::jsonb or c -> 'standing' is distinct from 'null'::jsonb or jsonb_array_length(c -> 'reveals') is distinct from 0 then
    raise exception 'a character waiting to debut shows nothing public: %', c;
  end if;
  perform tests.unbecome();

  -- Bob sees his own character and none of Ann's.
  perform tests.become(bob);
  doc := my_characters_page();
  if jsonb_array_length(doc -> 'characters') is distinct from 1 or doc #>> '{characters,0,name}' is distinct from 'Mc Bobs' or doc::text like '%Mc Zed%' then
    raise exception 'Bob''s page holds Bob''s character alone: %', doc;
  end if;
  perform tests.unbecome();

  -- Signed in with no account yet: an empty list.
  perform tests.become(nobody);
  doc := my_characters_page();
  if jsonb_array_length(doc -> 'characters') is distinct from 0 then raise exception 'no account, no characters: %', doc; end if;
  perform tests.unbecome();

  -- A visitor is refused.
  perform tests.become_anon();
  why := pg_temp.refusal('select my_characters_page()');
  perform tests.unbecome();
  if why is null or why not like '42501%' then raise exception 'anon must be refused my_characters_page(), got %', why; end if;
end $$;
