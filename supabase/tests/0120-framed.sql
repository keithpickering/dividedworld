-- The framed alert (supabase/migrations/0117_bbcode_tags.sql, Task 8; docs/plans/2026-11-07-bbcode-tags-plan.md; design section 1, "The framed alert").
--
-- A post, a thread start or a spin that holds a counterfeit quote naming a character (`user=<id>`) and passes that id in `framing` writes one `framed` alert for the
-- character's owner, about the new Act. It writes none for an id that is not a debuted character, not named by the body, a staff character or the poster's own other mask,
-- and in each of those the function's answer is the same as the same call with no `framing`: nothing in it says whether an id is real, debuted or anyone's. At most five
-- distinct ids count. An edit writes none. No API role can run write_framed, and the new kind is one a toast choice and the toastDefaults setting may name.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- A projection with what differs by construction taken out.
create function pg_temp.shape(projection jsonb) returns jsonb language sql as $$
  select (projection - array['id', 'created_at', 'thread', 'seq', 'target_act_id'])
         || jsonb_build_object('payload', (projection -> 'payload') - array['character', 'thread', 'board'],
                               'current_payload', (projection -> 'current_payload') - array['character', 'thread', 'board'])
$$;

create function pg_temp.framed_for(act_id uuid) returns bigint language sql as $$
  select count(*) from alerts where kind = 'framed' and act = act_id
$$;

-- ---- The kind is there, and the function is no API role's ----
do $$
declare
  ann uuid := tests.account('fr-ann');
  c uuid := tests.character(ann, 'Fr Settings');
  said jsonb;
begin
  if to_regprocedure('write_framed(text,uuid[],uuid,uuid)') is null then raise exception 'framed: there is no write_framed'; end if;
  if exists (select 1 from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
             where p.oid = 'write_framed(text,uuid[],uuid,uuid)'::regprocedure and has_function_privilege(r, p.oid, 'execute')) then
    raise exception 'framed: an API role can run write_framed';
  end if;
  insert into alerts (account, kind, act, character)
    select ann, 'framed', a.id, c from (select tests.post(c, tests.thread('Fr kind'), 'x') as id) a;
  perform tests.become(ann);
  said := set_preferences(toasts => array['framed', 'quote']);
  if said -> 'toasts' is distinct from '["framed", "quote"]'::jsonb then raise exception 'framed is a kind of alert a toast may name: %', said; end if;
  perform tests.unbecome();
  insert into settings (key, value) values ('toastDefaults', '["framed"]') on conflict (key) do update set value = excluded.value;
end $$;

-- ---- post: who is written to, and what the answer says ----
do $$
declare
  ann uuid := tests.account('fr-ann2'); bob uuid := tests.account('fr-bob'); cat uuid := tests.account('fr-cat');
  a1 uuid := tests.character(ann, 'Fr Ann One'); a2 uuid := tests.character(ann, 'Fr Ann Two');
  b1 uuid := tests.character(bob, 'Fr Bob One'); c1 uuid := tests.character(cat, 'Fr Cat One');
  waiting uuid; staff uuid;
  t uuid := tests.thread('Fr thread');
  plain jsonb; framed jsonb; n bigint; who uuid;
  stranger uuid := gen_random_uuid();
  big uuid[]; rows_before bigint; made uuid;
begin
  insert into characters (owner, name) values (bob, 'Fr Bob Waiting') returning id into waiting;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Fr Bot', 'fr-bot', 'persona', now()) returning id into staff;
  perform tests.become(ann);

  -- One debuted character of another player, named in the body: one alert, for its owner, about the new Act.
  framed := post(t, a1, 'He said [quote="Geno" user=' || b1 || ']things[/quote]', null, array[b1]);
  perform tests.unbecome();
  select count(*), min(account::text)::uuid into n, who from alerts where kind = 'framed' and act = (framed ->> 'id')::uuid;
  if n is distinct from 1 or who is distinct from bob then raise exception 'framed: a counterfeit naming a debuted character wrote % alerts for %', n, who; end if;
  if (select character from alerts where kind = 'framed' and act = (framed ->> 'id')::uuid) is distinct from b1 then raise exception 'framed: the alert is not about the named character'; end if;
  if (select sub from alerts where kind = 'framed' and act = (framed ->> 'id')::uuid) is not null then raise exception 'framed: the alert has a sub'; end if;

  -- The upper-case id in the body counts, and so does the keyword.
  perform tests.become(ann);
  framed := post(t, a1, '[quote=Geno USER=' || upper(b1::text) || ']x[/quote]', null, array[b1]);
  perform tests.unbecome();
  if pg_temp.framed_for((framed ->> 'id')::uuid) is distinct from 1 then raise exception 'framed: an id in capitals in the body was not matched'; end if;

  -- The cases that write none, each answering as the same post with no framing does.
  perform tests.become(ann);
  plain := post(t, a1, 'Say [quote=Geno user=' || waiting || ']x[/quote]');
  framed := post(t, a1, 'Say [quote=Geno user=' || waiting || ']x[/quote]', null, array[waiting]);
  if pg_temp.shape(plain) is distinct from pg_temp.shape(framed) then raise exception 'framed: an undebuted id changed the answer: % vs %', plain, framed; end if;
  perform tests.unbecome();
  if pg_temp.framed_for((framed ->> 'id')::uuid) is distinct from 0 then raise exception 'framed: an undebuted character was told'; end if;

  perform tests.become(ann);
  plain := post(t, a1, 'Say [quote=Geno user=' || stranger || ']x[/quote]');
  framed := post(t, a1, 'Say [quote=Geno user=' || stranger || ']x[/quote]', null, array[stranger]);
  if pg_temp.shape(plain) is distinct from pg_temp.shape(framed) then raise exception 'framed: an unknown id changed the answer'; end if;
  perform tests.unbecome();
  if pg_temp.framed_for((framed ->> 'id')::uuid) is distinct from 0 then raise exception 'framed: an unknown id wrote an alert'; end if;

  perform tests.become(ann);
  plain := post(t, a1, 'Say nothing of them');
  framed := post(t, a1, 'Say nothing of them', null, array[b1]);
  if pg_temp.shape(plain) is distinct from pg_temp.shape(framed) then raise exception 'framed: an id the body does not name changed the answer'; end if;
  perform tests.unbecome();
  if pg_temp.framed_for((framed ->> 'id')::uuid) is distinct from 0 then raise exception 'framed: an id the body does not name wrote an alert'; end if;

  perform tests.become(ann);
  plain := post(t, a1, 'Say [quote=Geno user=' || staff || ']x[/quote]');
  framed := post(t, a1, 'Say [quote=Geno user=' || staff || ']x[/quote]', null, array[staff]);
  if pg_temp.shape(plain) is distinct from pg_temp.shape(framed) then raise exception 'framed: a staff character changed the answer'; end if;
  perform tests.unbecome();
  if pg_temp.framed_for((framed ->> 'id')::uuid) is distinct from 0 or exists (select 1 from alerts where character = staff) then raise exception 'framed: a staff character was told'; end if;

  perform tests.become(ann);
  plain := post(t, a1, 'Say [quote=Geno user=' || a2 || ']x[/quote]');
  framed := post(t, a1, 'Say [quote=Geno user=' || a2 || ']x[/quote]', null, array[a2]);
  if pg_temp.shape(plain) is distinct from pg_temp.shape(framed) then raise exception 'framed: the poster''s own other mask changed the answer'; end if;
  perform tests.unbecome();
  if pg_temp.framed_for((framed ->> 'id')::uuid) is distinct from 0 then raise exception 'framed: the poster''s own other mask was told'; end if;

  -- A debuted character's answer is the same as an unframed one's too, whoever owns it.
  perform tests.become(ann);
  plain := post(t, a1, 'Say [quote=Geno user=' || c1 || ']x[/quote]');
  framed := post(t, a1, 'Say [quote=Geno user=' || c1 || ']x[/quote]', null, array[c1]);
  if pg_temp.shape(plain) is distinct from pg_temp.shape(framed) then raise exception 'framed: a written alert changed the answer'; end if;
  perform tests.unbecome();
  if pg_temp.framed_for((framed ->> 'id')::uuid) is distinct from 1 then raise exception 'framed: another player''s character was not told'; end if;

  -- A repeated id writes one.
  perform tests.become(ann);
  framed := post(t, a1, '[quote=G user=' || b1 || ']x[/quote]', null, array[b1, b1, b1]);
  perform tests.unbecome();
  if pg_temp.framed_for((framed ->> 'id')::uuid) is distinct from 1 then raise exception 'framed: a repeated id wrote % alerts', pg_temp.framed_for((framed ->> 'id')::uuid); end if;

  -- Six distinct ids write five (the first five); only the first five count, repeats among them included.
  big := array(select tests.character(tests.account('fr-many' || g), 'Fr Many ' || g) from generate_series(1, 6) g);
  perform tests.become(ann);
  framed := post(t, a1, (select string_agg('[quote=G user=' || u || ']x[/quote]', ' ') from unnest(big) u), null, big);
  perform tests.unbecome();
  if pg_temp.framed_for((framed ->> 'id')::uuid) is distinct from 5 then raise exception 'framed: six ids wrote % alerts', pg_temp.framed_for((framed ->> 'id')::uuid); end if;
  if exists (select 1 from alerts where kind = 'framed' and act = (framed ->> 'id')::uuid and character = big[6]) then raise exception 'framed: the sixth id was written'; end if;
  perform tests.become(ann);
  framed := post(t, a1, (select string_agg('[quote=G user=' || u || ']x[/quote]', ' ') from unnest(big) u),
                 null, array[big[1], big[1], big[1], big[1], big[1], big[2]]);
  perform tests.unbecome();
  if pg_temp.framed_for((framed ->> 'id')::uuid) is distinct from 1 then raise exception 'framed: the first five ids, one repeated five times, wrote % alerts', pg_temp.framed_for((framed ->> 'id')::uuid); end if;

  -- Null framing, an empty one and the default write none.
  perform tests.become(ann);
  framed := post(t, a1, '[quote=G user=' || b1 || ']x[/quote]', null, null);
  made := (framed ->> 'id')::uuid;
  framed := post(t, a1, '[quote=G user=' || b1 || ']x[/quote]', null, '{}');
  perform tests.unbecome();
  if pg_temp.framed_for(made) is distinct from 0 or pg_temp.framed_for((framed ->> 'id')::uuid) is distinct from 0 then raise exception 'framed: no framing wrote an alert'; end if;

  -- An edit writes none: it has no framing to pass, and the alerts stay as they were.
  perform tests.become(ann);
  framed := post(t, a1, 'Before an edit [quote=G user=' || b1 || ']x[/quote]', null, array[b1]);
  perform tests.unbecome();
  select count(*) into rows_before from alerts where kind = 'framed';
  perform tests.become(ann);
  perform edit_post((framed ->> 'id')::uuid, a1, 'After an edit [quote=G user=' || c1 || ']x[/quote]');
  perform tests.unbecome();
  if (select count(*) from alerts where kind = 'framed') is distinct from rows_before then raise exception 'framed: an edit wrote a framed alert'; end if;
end $$;

-- ---- start_thread and spin write it too ----
do $$
declare
  ann uuid := tests.account('fr-ann3'); bob uuid := tests.account('fr-bob3');
  a1 uuid := tests.character(ann, 'Fr Ann Three'); b1 uuid := tests.character(bob, 'Fr Bob Three');
  waiting uuid;
  t uuid := tests.thread('Fr origin'); origin uuid := tests.post(a1, t, 'An origin.');
  made jsonb; plain jsonb;
begin
  insert into characters (owner, name) values (bob, 'Fr Bob Three Waiting') returning id into waiting;
  perform tests.become(ann);
  made := start_thread('general', a1, 'Framing start', 'Said [quote=G user=' || b1 || ']x[/quote]', array[b1]);
  perform tests.unbecome();
  if pg_temp.framed_for((made -> 'act' ->> 'id')::uuid) is distinct from 1
     or not exists (select 1 from alerts where kind = 'framed' and act = (made -> 'act' ->> 'id')::uuid and account = bob) then
    raise exception 'framed: start_thread did not write the alert';
  end if;
  perform tests.become(ann);
  plain := start_thread('general', a1, 'Not framing start', 'Said [quote=G user=' || waiting || ']x[/quote]');
  made := start_thread('general', a1, 'Not framing start', 'Said [quote=G user=' || waiting || ']x[/quote]', array[waiting]);
  perform tests.unbecome();
  if pg_temp.shape(plain -> 'act') is distinct from pg_temp.shape(made -> 'act') or pg_temp.framed_for((made -> 'act' ->> 'id')::uuid) is distinct from 0 then
    raise exception 'framed: start_thread with an undebuted id answered differently or wrote';
  end if;

  perform tests.become(ann);
  made := spin(origin, a1, 'Framing spin', 'Said [quote=G user=' || b1 || ']x[/quote]', array[b1]);
  perform tests.unbecome();
  if pg_temp.framed_for((made -> 'act' ->> 'id')::uuid) is distinct from 1
     or not exists (select 1 from alerts where kind = 'framed' and act = (made -> 'act' ->> 'id')::uuid and account = bob) then
    raise exception 'framed: spin did not write the alert';
  end if;
  perform tests.become(ann);
  plain := spin(origin, a1, 'Not framing spin', 'Said [quote=G user=' || waiting || ']x[/quote]');
  made := spin(origin, a1, 'Not framing spin', 'Said [quote=G user=' || waiting || ']x[/quote]', array[waiting]);
  perform tests.unbecome();
  if pg_temp.shape(plain -> 'act') is distinct from pg_temp.shape(made -> 'act') or pg_temp.framed_for((made -> 'act' ->> 'id')::uuid) is distinct from 0 then
    raise exception 'framed: spin with an undebuted id answered differently or wrote';
  end if;
end $$;
