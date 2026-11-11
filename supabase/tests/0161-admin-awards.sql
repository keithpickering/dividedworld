-- The trophies admin page's reads (supabase/migrations/0157_admin_awards.sql; the cosmetics plan, Task 11): an admin reads recent awards, newest first and paged, a reversed
-- one listed as taken back, with every trophy kind; finds a character by name; and a player is refused both, in the database's own words.

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

select tests.unbecome();
insert into trophy_kinds (key, name, belt) values ('aa-pet', 'Pet', false), ('aa-belt', 'The Belt', true);

do $$
declare
  adm uuid := tests.account('aa-adm'); ann uuid := tests.account('aa-ann');
  a uuid := tests.character(ann, 'Aa Ann');
  a1 uuid; a2 uuid; a3 uuid; r jsonb; p1 jsonb; p2 jsonb;
begin
  insert into admins (account) values (adm);
  insert into trophy_kinds (key, name, made_by) values ('made-aa', 'Contest', adm);
  insert into trophy_awards (trophy, character, by, at) values ('aa-pet', a, 'admin', now() - interval '3 hours') returning id into a1;
  insert into trophy_awards (trophy, character, by, at, line) values ('aa-belt', a, 'admin', now() - interval '2 hours', 'Best.') returning id into a2;
  insert into trophy_awards (trophy, character, by, at) values ('made-aa', a, 'admin', now() - interval '1 hour') returning id into a3;
  insert into trophy_reversals (award, by) values (a2, adm);

  perform tests.become(adm);
  r := admin_awards();
  if jsonb_array_length(r -> 'awards') is distinct from 3 or r ->> 'more' is distinct from 'false' then raise exception 'the awards: %', r; end if;
  if (select string_agg(x ->> 'trophy', ',' order by n) from jsonb_array_elements(r -> 'awards') with ordinality t(x, n)) is distinct from 'made-aa,aa-belt,aa-pet' then raise exception 'newest first: %', r -> 'awards'; end if;
  if (r #>> '{awards,1,reversed}') is distinct from 'true' or (r #>> '{awards,0,reversed}') is distinct from 'false' then raise exception 'a taken-back award is listed as taken back: %', r -> 'awards'; end if;
  if (r #>> '{awards,0,to}') is distinct from 'Aa Ann' or (r #>> '{awards,0,by}') is distinct from 'an admin' or (r #>> '{awards,1,line}') is distinct from 'Best.' then raise exception 'to, by and line: %', r -> 'awards'; end if;
  if r::text like '%' || adm::text || '%' or r::text like '%' || ann::text || '%' then raise exception 'an account id came back: %', r; end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'kinds') k where k ->> 'key' = 'aa-belt' and k ->> 'belt' = 'true' and k ->> 'made' = 'false')
     or not exists (select 1 from jsonb_array_elements(r -> 'kinds') k where k ->> 'key' = 'made-aa' and k ->> 'made' = 'true') then raise exception 'the kinds: %', r -> 'kinds'; end if;

  -- Paged: two to a page, then the rest after the cursor.
  p1 := admin_awards(null, 2);
  if jsonb_array_length(p1 -> 'awards') is distinct from 2 or p1 ->> 'more' is distinct from 'true' then raise exception 'a page of two: %', p1; end if;
  p2 := admin_awards((p1 #>> '{awards,1,at}')::timestamptz, 2, (p1 #>> '{awards,1,award}')::uuid);
  if jsonb_array_length(p2 -> 'awards') is distinct from 1 or p2 #>> '{awards,0,award}' is distinct from a1::text or p2 ->> 'more' is distinct from 'false' then raise exception 'the next page: %', p2; end if;

  -- A character by its name, case and lookalikes folded; none for no one; never a staff character.
  if (admin_character_named('aa ann') ->> 'id') is distinct from a::text or (admin_character_named('  Aa Ann ') ->> 'name') is distinct from 'Aa Ann' then raise exception 'found by name'; end if;
  if admin_character_named('Nobody Atall') is not null then raise exception 'no one is no one'; end if;

  -- The awards that could not be given (the paged read and the hand give): each failure's characters carry a `given` flag, a failure is open until each has had it, an
  -- award is given by hand once, and the unresolved come first.
  declare
    b uuid; s1 bigint; s2 bigint; s3 bigint; f1 uuid; f2 uuid; f3 uuid; f4 uuid; fl jsonb; q1 jsonb; q2 jsonb; made jsonb; cnt integer;
  begin
    perform tests.unbecome();
    b := tests.character(ann, 'Aa Bea');
    update trophy_kinds set season_place = null where season_place is not null;
    insert into trophy_kinds (key, name, season_place) values ('aa-first', 'First', 1), ('aa-second', 'Second', 2);
    insert into seasons (number, starts_at, ends_at) values (9001, '1990-01-01', '1990-01-02') returning id into s1;
    insert into seasons (number, starts_at, ends_at) values (9002, '1991-01-01', '1991-01-02') returning id into s2;
    insert into seasons (number, starts_at, ends_at) values (9003, '1992-01-01', '1992-01-02') returning id into s3;
    insert into season_results (season, character, name, place, standing) values (s1, a, 'Aa Ann', 1, 5), (s1, b, 'Aa Bea', 2, 4), (s2, a, 'Aa Ann', 1, 5), (s3, b, 'Aa Bea', 2, 4);
    insert into trophy_award_failures (season, error, at) values (s1, 'f-one', now() - interval '4 hours') returning id into f1;
    insert into trophy_award_failures (season, error, at) values (s2, 'f-two', now() - interval '3 hours') returning id into f2;
    insert into trophy_award_failures (season, error, at) values (s3, 'f-three', now() - interval '2 hours') returning id into f3;
    insert into trophy_award_failures (move_act, error, at) values (tests.act(a, 'post', tests.thread('aa failed')), 'f-four', now() - interval '1 hour') returning id into f4;
    perform tests.become(adm);

    fl := trophy_award_failures();
    if jsonb_array_length(fl -> 'failures') is distinct from 4 or fl ->> 'more' is distinct from 'false' then raise exception 'the failures: %', fl; end if;
    if exists (select 1 from jsonb_array_elements(fl -> 'failures') x where x ->> 'open' is distinct from 'true') then raise exception 'every failure starts open: %', fl; end if;
    if exists (select 1 from jsonb_array_elements(fl -> 'failures') x, jsonb_array_elements(case when jsonb_typeof(x -> 'characters') = 'array' then x -> 'characters' else '[]' end) c where c ->> 'given' is distinct from 'false') then raise exception 'nothing is given yet: %', fl; end if;
    if (fl #> '{failures,0,characters}') is distinct from 'null'::jsonb then raise exception 'an unreadable demand''s characters are null: %', fl -> 'failures' -> 0; end if;

    -- Giving by hand awards the place's own trophy and records it.
    made := give_failed_award(f1, a);
    perform tests.unbecome();
    if not exists (select 1 from trophy_awards w where w.id = (made ->> 'award')::uuid and w.trophy = 'aa-first' and w.character = a and w.by = 'admin') then raise exception 'the hand-given award: %', made; end if;
    if (select count(*) from trophy_failure_resolutions r where r.failure = f1 and r.character = a and r.award = (made ->> 'award')::uuid and r.by = adm) is distinct from 1::bigint then raise exception 'the resolution is recorded'; end if;
    perform tests.become(adm);
    fl := trophy_award_failures();
    if (select c ->> 'given' from jsonb_array_elements(fl -> 'failures') x, jsonb_array_elements(x -> 'characters') c where x ->> 'id' = f1::text and c ->> 'id' = a::text) is distinct from 'true'
       or (select c ->> 'given' from jsonb_array_elements(fl -> 'failures') x, jsonb_array_elements(x -> 'characters') c where x ->> 'id' = f1::text and c ->> 'id' = b::text) is distinct from 'false' then raise exception 'given is flagged per character: %', fl; end if;

    -- Once only: a second give is refused and nothing is awarded again. A character the failure was not for, and an unreadable failure, are refused.
    if pg_temp.refusal(format('select give_failed_award(%L, %L)', f1, a)) is distinct from 'that award was already given to that character' then raise exception 'a double give: %', pg_temp.refusal(format('select give_failed_award(%L, %L)', f1, a)); end if;
    perform tests.unbecome();
    select count(*) into cnt from trophy_awards w where w.character = a and w.trophy = 'aa-first';
    if cnt is distinct from 1 then raise exception 'a refused give awarded again: %', cnt; end if;
    perform tests.become(adm);
    if pg_temp.refusal(format('select give_failed_award(%L, %L)', f3, a)) is null then raise exception 'a character the failure was not for was given the award'; end if;
    if pg_temp.refusal(format('select give_failed_award(%L, %L)', f4, a)) is null then raise exception 'an unreadable failure was given by hand'; end if;
    if pg_temp.refusal(format('select give_failed_award(%L, %L)', gen_random_uuid(), a)) is null then raise exception 'no such failure'; end if;

    -- Unresolved first: f1 closes once b has it, and falls behind the three still open (each group newest first); an unreadable one stays open.
    perform give_failed_award(f1, b);
    fl := trophy_award_failures();
    if (select string_agg(x ->> 'error', ',' order by t.n) from jsonb_array_elements(fl -> 'failures') with ordinality t(x, n)) is distinct from 'f-four,f-three,f-two,f-one'
       or (fl #>> '{failures,3,open}') is distinct from 'false' or (fl #>> '{failures,2,open}') is distinct from 'true' then raise exception 'unresolved first, newest first: %', fl; end if;

    -- Paged: two to a page, the cursor carries whether the last row was open.
    q1 := trophy_award_failures(null, 2);
    if jsonb_array_length(q1 -> 'failures') is distinct from 2 or q1 ->> 'more' is distinct from 'true' then raise exception 'a page of two: %', q1; end if;
    q2 := trophy_award_failures((q1 #>> '{failures,1,at}')::timestamptz, 2, (q1 #>> '{failures,1,id}')::uuid, (q1 #>> '{failures,1,open}')::boolean);
    if (select string_agg(x ->> 'error', ',' order by t.n) from jsonb_array_elements(q2 -> 'failures') with ordinality t(x, n)) is distinct from 'f-two,f-one' or q2 ->> 'more' is distinct from 'false' then raise exception 'the next page: %', q2; end if;
    if q1::text like '%' || adm::text || '%' then raise exception 'an account id came back'; end if;

    -- A resolution is never changed.
    perform tests.unbecome();
    begin
      update trophy_failure_resolutions set at = now();
      raise exception 'a resolution was updated';
    exception when others then
      if sqlerrm = 'a resolution was updated' then raise; end if;
    end;

    perform tests.become(ann);
    if pg_temp.refusal(format('select give_failed_award(%L, %L)', f2, a)) is null then raise exception 'a player gave a failed award'; end if;
    if pg_temp.refusal('select trophy_award_failures()') is null then raise exception 'a player read the failures'; end if;
    perform tests.become(adm);
  end;

  -- A player is refused both.
  perform tests.become(ann);
  if pg_temp.refusal('select admin_awards()') is null then raise exception 'a player read the awards'; end if;
  if pg_temp.refusal($q$select admin_character_named('Aa Ann')$q$) is null then raise exception 'a player looked a character up by name'; end if;
  perform tests.unbecome();
end $$;
