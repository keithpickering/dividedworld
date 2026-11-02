-- The private channels: an account hears its own `account:<id>` topic and no one else's, and every signed-in player hears
-- `reach`, where a play beyond a post is sent (supabase/migrations/0061_account_channel.sql). Realtime authorizes a listener
-- by reading realtime.messages under the policies, with the topic it joined set; the shim stands in for that table.

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
