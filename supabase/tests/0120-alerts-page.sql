-- alerts_page(before) (supabase/migrations/0119_alerts_page.sql; the glass-load design, section 7; its plan, Task 7): /alerts in one read. A page of
-- alerts as my_alerts gives them, the Acts they name and (in at most three rounds) the Acts those quote, the authors, the opening Acts of the
-- alerts' threads and the caller's own reading of them, with the account's mark and opening date. Each piece equals the matching read made directly;
-- a quote chain stops at depth three; another player's alerts are absent; `before` pages; a visitor is refused.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('al-ann');
  bob uuid := tests.account('al-bob');
  nobody uuid := gen_random_uuid();
  a1 uuid := tests.character(ann, 'Al Ann', 'alpha', now() - interval '60 days');
  b1 uuid := tests.character(bob, 'Al Bob', 'alpha', now() - interval '60 days');
  base timestamptz := now() - interval '10 hours';
  t1 uuid := tests.thread('Al Ann started this');
  t2 uuid := tests.thread('Al Bob started this');
  o1 uuid; o2 uuid; q0 uuid; q1 uuid; q2 uuid; q3 uuid; r1 uuid;
  seen timestamptz := now() - interval '3 hours';
  doc jsonb;
  later jsonb;
  want jsonb;
  cut timestamptz;
  why text;
begin
  insert into auth.users (id, email) values (nobody, 'al-nobody@test.invalid');
  o1 := tests.post(a1, t1, 'Ann opens.', base - interval '5 hours');
  o2 := tests.post(b1, t2, 'Bob opens.', base - interval '5 hours');
  -- A chain of quotes: q3 quotes q2 quotes q1 quotes q0. Depth one is the alert's own Act, so q3, q2 and q1 are read and q0 is not.
  q0 := tests.post(b1, t1, 'q0', base);
  q1 := tests.act(b1, 'post', t1, '{"body": "q1"}', q0, base + interval '1 minute');
  q2 := tests.act(b1, 'post', t1, '{"body": "q2"}', q1, base + interval '2 minutes');
  q3 := tests.act(b1, 'post', t1, '{"body": "q3"}', q2, base + interval '3 minutes');
  r1 := tests.post(b1, t2, 'r1 quotes nothing', base + interval '4 minutes');
  insert into alerts (account, kind, act, character, at) values (ann, 'quote', q3, a1, base + interval '1 hour'), (ann, 'quote', r1, a1, base + interval '2 hours');
  -- Bob has an alert of his own that Ann must never see.
  insert into alerts (account, kind, act, character, at) values (bob, 'quote', o1, b1, base + interval '90 minutes');
  -- Ann has read her thread to its opening; Bob has posted since (a followed-thread alert), and she has read the other thread through.
  insert into reading (account, thread, furthest_seq) values (ann, t1, 1), (ann, t2, 2), (bob, t1, 5);
  insert into account_preferences (account, alerts_seen_at) values (ann, seen);

  perform tests.become(ann);
  doc := alerts_page(null);
  if doc -> 'alerts' is distinct from (select jsonb_agg(to_jsonb(a)) from my_alerts(null, 30) a) then raise exception 'alerts: %', doc -> 'alerts'; end if;
  if not exists (select 1 from jsonb_array_elements(doc -> 'alerts') x where x ->> 'kind' = 'followed') or jsonb_array_length(doc -> 'alerts') < 3 then
    raise exception 'two written alerts and a followed thread: %', doc -> 'alerts';
  end if;
  if (doc ->> 'seenAt')::timestamptz is distinct from seen then raise exception 'seenAt is the caller''s: %', doc -> 'seenAt'; end if;
  if (doc ->> 'openedAt')::timestamptz is distinct from my_account_opened() then raise exception 'openedAt: %', doc -> 'openedAt'; end if;
  -- The Acts: the alerts' own, and the quoted ones to depth three. (A shared suite may hold news alerts, which name Acts too, so the expected set
  -- is built from the page's own alerts in three plain steps, and the chain of this file's alert is checked by name.)
  want := (
    with d1 as (select (x ->> 'act')::uuid as id from jsonb_array_elements(doc -> 'alerts') x where x ->> 'act' is not null),
         d2 as (select a.target_act_id as id from acts_public a where a.id in (select id from d1) and a.target_act_id is not null),
         d3 as (select a.target_act_id as id from acts_public a where a.id in (select id from d2) and a.target_act_id is not null)
    select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at, a.id::text collate "C"), '[]'::jsonb)
    from acts_public a where a.id in (select id from d1 union select id from d2 union select id from d3));
  if doc -> 'acts' is distinct from want then raise exception 'acts: %', (select array_agg(x ->> 'id') from jsonb_array_elements(doc -> 'acts') x); end if;
  if not (select bool_and(exists (select 1 from jsonb_array_elements(doc -> 'acts') x where x ->> 'id' = i::text)) from unnest(array[q3, q2, q1, r1]) i) then raise exception 'the chain q3, q2, q1 and r1 are read'; end if;
  if exists (select 1 from jsonb_array_elements(doc -> 'acts') x where x ->> 'id' = q0::text) then raise exception 'a fourth-level quote is absent'; end if;
  -- Their authors, as the faces carry them.
  if doc -> 'people' is distinct from (
      select coalesce(jsonb_agg(to_jsonb(cp) || jsonb_build_object('profile', (
        select to_jsonb(p) from (
          select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style
          from character_profiles r where r.character = cp.id) p)) order by cp.name), '[]'::jsonb)
      from characters_public cp where cp.id in (select (x ->> 'character')::uuid from jsonb_array_elements(doc -> 'acts') x where x ->> 'character' is not null)) then
    raise exception 'people: %', doc -> 'people';
  end if;
  if not exists (select 1 from jsonb_array_elements(doc -> 'people') x where x ->> 'id' = b1::text) then raise exception 'Bob wrote the quoted posts'; end if;
  -- The opening Acts of the alerts' threads, and the caller's reading of them.
  if doc -> 'openings' is distinct from (select coalesce(jsonb_agg(to_jsonb(a) order by a.thread::text collate "C"), '[]'::jsonb) from acts_public a
       where a.seq = 1 and a.thread in (select (x ->> 'thread')::uuid from jsonb_array_elements(doc -> 'alerts') x where x ->> 'thread' is not null)) then
    raise exception 'openings: %', doc -> 'openings';
  end if;
  if not exists (select 1 from jsonb_array_elements(doc -> 'openings') x where x ->> 'id' = o1::text) then raise exception 'Ann''s thread''s opening is read: %', doc -> 'openings'; end if;
  if doc -> 'reading' is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by r.thread::text collate "C"), '[]'::jsonb) from (
       select thread, furthest_seq from reading where thread in (select (x ->> 'thread')::uuid from jsonb_array_elements(doc -> 'alerts') x where x ->> 'thread' is not null)) r)
     or not exists (select 1 from jsonb_array_elements(doc -> 'reading') x where x ->> 'thread' = t1::text and x ->> 'furthest_seq' = '1') then
    raise exception 'reading: %', doc -> 'reading';
  end if;
  if doc::text like '%"furthest_seq": 5%' then raise exception 'another player''s reading is in the page: %', doc -> 'reading'; end if;
  -- `before` pages: the same cut as my_alerts.
  cut := (select min(at) from my_alerts(null, 30) a where a.kind = 'quote');
  later := alerts_page(cut);
  if later -> 'alerts' is distinct from (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from my_alerts(cut, 30) a) then raise exception 'before pages: %', later -> 'alerts'; end if;
  if jsonb_array_length(later -> 'alerts') >= jsonb_array_length(doc -> 'alerts') then raise exception 'an older page is shorter: %', later -> 'alerts'; end if;
  perform tests.unbecome();

  -- Bob sees his alert and none of Ann's; he has no mark.
  perform tests.become(bob);
  doc := alerts_page(null);
  if doc -> 'alerts' is distinct from (select jsonb_agg(to_jsonb(a)) from my_alerts(null, 30) a) or doc -> 'seenAt' is distinct from 'null'::jsonb then raise exception 'Bob''s page: %', doc; end if;
  if exists (select 1 from jsonb_array_elements(doc -> 'alerts') x where x ->> 'act' in (q3::text, r1::text)) then raise exception 'another player''s alert is in the page: %', doc -> 'alerts'; end if;
  perform tests.unbecome();

  -- A player with no account yet is refused by my_account_opened(), as the screen's own read would be.
  perform tests.become(nobody);
  why := pg_temp.refusal('select alerts_page(null)');
  perform tests.unbecome();
  if why is null then raise exception 'a caller with no account is refused, as my_account_opened refuses it'; end if;

  -- A visitor is refused.
  perform tests.become_anon();
  why := pg_temp.refusal('select alerts_page(null)');
  perform tests.unbecome();
  if why is null or why not like '42501%' then raise exception 'anon must be refused alerts_page(), got %', why; end if;
end $$;
