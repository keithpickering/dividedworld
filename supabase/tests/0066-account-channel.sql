-- The private channels: an account hears its own `account:<id>` topic and no one else's, and every signed-in player hears
-- `reach`, where a play beyond a post is sent (supabase/migrations/0061_account_channel.sql). Realtime authorizes a listener
-- by reading realtime.messages under the policies, with the topic it joined set; the shim stands in for that table.

-- First in the file: the racers commit in sessions of their own, so nothing before this may hold a lock on the outbox.
-- Two drains at the same instant, in two sessions, take different rows: with one row each wanted, each gets its own and none
-- is taken twice or missed. (A claim without skip locked makes the second wait for the first and leave with nothing.)
do $$
declare
  said text[];
  claims jsonb;
begin
  perform tests.commit($sql$
    delete from broadcasts_due;
    insert into broadcasts_due (topic, event, payload) values ('reach', 'effect', '{"n": 1}'), ('reach', 'effect', '{"n": 2}');
    drop table if exists race_claims;
    create table race_claims (racer text, id bigint);
    grant all on race_claims to service_role;
  $sql$);
  begin
    said := tests.race_service(
      $s$insert into race_claims select 'a', (x ->> 'id')::bigint from jsonb_array_elements(due_broadcasts(1)) x$s$,
      $s$insert into race_claims select 'b', (x ->> 'id')::bigint from jsonb_array_elements(due_broadcasts(1)) x$s$);
    -- Read in a session of its own, so this transaction holds no lock on the table and it can be dropped.
    select jsonb_agg(jsonb_build_array(r.racer, r.id)) into claims
    from extensions.dblink(current_setting('kayfabb.scratch_url'), 'select racer, id from race_claims') as r(racer text, id bigint);
  exception when others then
    -- Nothing is left behind, whatever went wrong.
    perform tests.commit($sql$ drop table if exists race_claims; delete from broadcasts_due; $sql$);
    raise;
  end;
  perform tests.commit($sql$ drop table if exists race_claims; delete from broadcasts_due; $sql$);
  if said[1] is not null or said[2] is not null then raise exception 'a racing drain failed: %', said; end if;
  if (select count(*) from jsonb_array_elements(coalesce(claims, '[]')) c where c ->> 0 = 'a') is distinct from 1
     or (select count(*) from jsonb_array_elements(coalesce(claims, '[]')) c where c ->> 0 = 'b') is distinct from 1 then
    raise exception 'each of two drains at once takes its own row: %', claims;
  end if;
  if (select count(distinct c ->> 1) from jsonb_array_elements(coalesce(claims, '[]')) c) is distinct from 2 then raise exception 'two drains at once took one row twice'; end if;
end $$;

do $$
declare
  ann uuid := tests.account('ann');
  bob uuid := tests.account('bob');
  n integer;
begin
  insert into realtime.messages (topic, payload, event) values ('account:' || ann, '{}', 'alert'), ('reach', '{}', 'effect');

  -- Ann joins her own topic: allowed.
  perform set_config('realtime.topic', 'account:' || ann, true);
  perform tests.become(ann);
  select count(*) into n from realtime.messages where topic is not distinct from current_setting('realtime.topic');
  perform tests.unbecome();
  if n is distinct from 1 then raise exception 'an account should hear its own channel, heard % messages', n; end if;

  -- Bob joins Ann's: refused.
  perform tests.become(bob);
  select count(*) into n from realtime.messages where topic is not distinct from current_setting('realtime.topic');
  perform tests.unbecome();
  if n is distinct from 0 then raise exception 'an account heard another account''s channel (% messages)', n; end if;

  -- Not by a prefix or a look-alike either.
  perform set_config('realtime.topic', 'account:' || ann || 'x', true);
  perform tests.become(ann);
  select count(*) into n from realtime.messages where topic is not distinct from current_setting('realtime.topic');
  perform tests.unbecome();
  if n is distinct from 0 then raise exception 'a topic that only begins with an account''s own was heard'; end if;
  perform set_config('realtime.topic', 'account:%', true);
  perform tests.become(bob);
  select count(*) into n from realtime.messages where topic is not distinct from current_setting('realtime.topic');
  perform tests.unbecome();
  if n is distinct from 0 then raise exception 'a wildcard topic was heard'; end if;

  -- A visitor with no session hears no account's channel, as it hears nothing else live (0008).
  perform set_config('realtime.topic', 'account:' || ann, true);
  perform tests.become_anon();
  begin
    select count(*) into n from realtime.messages where topic is not distinct from current_setting('realtime.topic');
  exception when insufficient_privilege then n := 0;
  end;
  perform tests.unbecome();
  if n is distinct from 0 then raise exception 'a visitor heard an account''s channel'; end if;

  -- `reach`: every signed-in player, nobody without a session.
  perform set_config('realtime.topic', 'reach', true);
  perform tests.become(bob);
  select count(*) into n from realtime.messages where topic is not distinct from current_setting('realtime.topic');
  perform tests.unbecome();
  if n is distinct from 1 then raise exception 'a signed-in player should hear reach, heard % messages', n; end if;
  perform tests.become_anon();
  begin
    select count(*) into n from realtime.messages where topic is not distinct from current_setting('realtime.topic');
  exception when insufficient_privilege then n := 0;
  end;
  perform tests.unbecome();
  if n is distinct from 0 then raise exception 'a visitor heard reach'; end if;

  -- Only broadcasts are heard: presence on one's own channel is not.
  insert into realtime.messages (topic, payload, event, extension) values ('account:' || ann, '{}', 'x', 'presence');
  perform set_config('realtime.topic', 'account:' || ann, true);
  perform tests.become(ann);
  select count(*) into n from realtime.messages where extension is distinct from 'broadcast';
  perform tests.unbecome();
  if n is distinct from 0 then raise exception 'a player heard something on their channel that is not a broadcast'; end if;
end $$;

-- The outbox hands each waiting row to one claimant at a time (due_broadcasts claims; broadcasts_sent clears), so two
-- drains running at once never send a row twice, and a claim that was never cleared comes back after its lease.
do $$
declare
  first_claim jsonb;
  second_claim jsonb;
begin
  delete from broadcasts_due;
  perform broadcast_later('reach', 'effect', '{"n": 1}');
  perform broadcast_later('reach', 'effect', '{"n": 2}');
  first_claim := due_broadcasts(1);
  second_claim := due_broadcasts(10);
  if jsonb_array_length(first_claim) is distinct from 1 then raise exception 'the first claim took % rows, not 1', jsonb_array_length(first_claim); end if;
  if jsonb_array_length(second_claim) is distinct from 1 or (second_claim -> 0 -> 'id') is not distinct from (first_claim -> 0 -> 'id') then
    raise exception 'a second drain was handed a row the first holds: %', second_claim;
  end if;
  if jsonb_array_length(due_broadcasts(10)) is distinct from 0 then raise exception 'rows both drains hold were handed out again'; end if;
  -- Neither was cleared (their sends failed): after the lease both are due again, oldest first.
  update broadcasts_due set claimed_until = now() - interval '1 second';
  if (select jsonb_agg(b -> 'payload' ->> 'n' order by (b ->> 'id')::bigint) from jsonb_array_elements(due_broadcasts(10)) b) is distinct from '["1", "2"]'::jsonb then
    raise exception 'a lapsed claim was lost';
  end if;
  perform broadcasts_sent((select jsonb_agg(id) from broadcasts_due));
  if (select count(*) from broadcasts_due) is distinct from 0 then raise exception 'a sent broadcast is still waiting'; end if;
end $$;

-- A claim counts: each claim of a row is an attempt, a drain whose send failed releases its rows with a backoff that grows
-- with the attempts (so a row is not tried again at once, and not given the full lease), a drain mid-way through a long
-- fallback renews its lease, and a row given up is kept, dead, with its payload and why, and is never handed out again.
do $$
declare
  one jsonb;
  row_id bigint;
begin
  delete from broadcasts_due;
  perform broadcast_later('reach', 'effect', '{"n": 1}');
  one := due_broadcasts(10);
  row_id := (one -> 0 ->> 'id')::bigint;
  if (one -> 0 ->> 'attempts')::integer is distinct from 1 then raise exception 'a first claim is attempt 1: %', one; end if;
  -- Released: not due at once, due again after the backoff, and the next claim is attempt 2.
  perform broadcasts_release(jsonb_build_array(row_id));
  if (select claimed_until from broadcasts_due where id = row_id) is not distinct from null then raise exception 'a released row keeps a backoff'; end if;
  if (select claimed_until - clock_timestamp() from broadcasts_due where id = row_id) > interval '1 minute' then raise exception 'the first backoff is short, not the lease'; end if;
  if jsonb_array_length(due_broadcasts(10)) is distinct from 0 then raise exception 'a released row was due again inside its backoff'; end if;
  update broadcasts_due set claimed_until = clock_timestamp() - interval '1 second';
  if (due_broadcasts(10) -> 0 ->> 'attempts')::integer is distinct from 2 then raise exception 'the second claim is attempt 2'; end if;
  -- A later attempt backs off longer.
  perform broadcasts_release(jsonb_build_array(row_id));
  if (select claimed_until - clock_timestamp() from broadcasts_due where id = row_id) <= (interval '4 seconds') then raise exception 'a later attempt backs off longer'; end if;
  -- Renewed: the lease is the full lease again.
  update broadcasts_due set claimed_until = clock_timestamp() + interval '1 second';
  perform broadcasts_renew(jsonb_build_array(row_id));
  if (select claimed_until - clock_timestamp() from broadcasts_due where id = row_id) < interval '90 seconds' then raise exception 'a renewed claim holds the lease again'; end if;
  -- Isolated failures are counted apart from claims: a row claimed many times in an outage has failed alone none.
  update broadcasts_due set claimed_until = null;
  if (due_broadcasts(10) -> 0 ->> 'failures')::integer is distinct from 0 then raise exception 'claims are not failures'; end if;
  perform broadcasts_failed(jsonb_build_array(row_id));
  perform broadcasts_failed(jsonb_build_array(row_id));
  if (select failures from broadcasts_due where id = row_id) is distinct from 2 then raise exception 'a row that failed alone twice counts 2 failures, not %', (select failures from broadcasts_due where id = row_id); end if;
  -- Dead: kept in full, never handed out, and sending the others clears nothing of it.
  perform broadcasts_dead(jsonb_build_array(row_id), 'refused');
  update broadcasts_due set claimed_until = null;
  if jsonb_array_length(due_broadcasts(10)) is distinct from 0 then raise exception 'a dead row was handed out'; end if;
  if (select payload from broadcasts_due where id = row_id) is distinct from '{"n": 1}' or (select dead_why from broadcasts_due where id = row_id) is distinct from 'refused'
     or (select dead_at from broadcasts_due where id = row_id) is null then
    raise exception 'a dead row keeps its record';
  end if;
  delete from broadcasts_due;
  -- The claim does not walk dead rows: its predicate has an index of its own.
  if not exists (select 1 from pg_indexes where tablename = 'broadcasts_due' and indexdef ~* '\(id\) WHERE \(?dead_at IS NULL') then
    raise exception 'the claim has no partial index on live rows: %', (select string_agg(indexdef, '; ') from pg_indexes where tablename = 'broadcasts_due');
  end if;
end $$;

