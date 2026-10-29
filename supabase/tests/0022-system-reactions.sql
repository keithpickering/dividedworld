-- Reactions on The System's own Acts (supabase/migrations/0015_system_reactions.sql): a tally and
-- the reveal are reacted to like any Act, held to the same cap and the same one-of-each rule, and
-- tallied in public; the settlement is told they are The System's, so they move nobody's Aura
-- (engine/rules/settle.ts, settle.test.ts). The screens' engine plan, Task 3; issue #5's
-- "Reacting to a reveal Act".

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('sysr-ann');
  bob uuid := tests.account('sysr-bob');
  a1 uuid := tests.character(ann, 'Sysr Ann One', 'alpha', now() - interval '10 days');
  a2 uuid := tests.character(ann, 'Sysr Ann Two', 'alpha', now() - interval '10 days');
  b uuid := tests.character(bob, 'Sysr Bob', 'alpha', now() - interval '10 days');
  t uuid;
  reveal uuid;
  tally uuid;
  said jsonb;
  input jsonb;
begin
  insert into threads (board, title) values (system_board(), 'Said') returning id into t;
  insert into acts (character, kind, thread, payload) values (null, 'reveal', t, '{}') returning id into reveal;
  insert into acts (character, kind, thread, payload) values (null, 'tally', t, '{}') returning id into tally;

  perform tests.become(ann);
  said := react(reveal, a1, 'up');
  if (said -> 'tally' ->> 'up')::integer is distinct from 1 then raise exception 'a reaction to the reveal is tallied: %', said; end if;
  if (said ->> 'thread')::uuid is distinct from t then raise exception 'the answer names its thread for the live update: %', said; end if;
  said := react(tally, a1, 'calm');
  if (said -> 'tally' ->> 'calm')::integer is distinct from 1 then raise exception 'a reaction to the tally is tallied: %', said; end if;
  if pg_temp.refusal(format('select react(%L, %L, %L)', tally, a2, 'calm')) is distinct from 'you have already left that reaction here' then raise exception 'a second mask left the same reaction on the tally'; end if;
  -- One player, across their characters: each kind once, and at most the cap.
  if pg_temp.refusal(format('select react(%L, %L, %L)', reveal, a2, 'up')) is distinct from 'you have already left that reaction here' then raise exception 'a second mask left the same reaction on the reveal'; end if;
  perform react(reveal, a2, 'boo');
  perform react(reveal, a1, 'calm');
  if pg_temp.refusal(format('select react(%L, %L, %L)', reveal, a2, 'meh')) is distinct from 'you have left 3 reactions here, the most there are' then raise exception 'the cap did not hold on the reveal'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  said := react(reveal, b, 'up');
  if (said -> 'tally' ->> 'up')::integer is distinct from 2 then raise exception 'two players'' reactions on the reveal: %', said; end if;
  perform tests.unbecome();

  -- The settlement reads them as The System's: named, so nobody is paid for them.
  input := settlement_input(now() - interval '1 hour', now() + interval '1 hour');
  if not (input -> 'systemActs') @> jsonb_build_array(reveal, tally) then raise exception 'the settlement is not told the reveal and tally are The System''s: %', input -> 'systemActs'; end if;
  if exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'id' in (reveal::text, tally::text)) then raise exception 'The System''s Acts reached the settlement as a character''s'; end if;
  -- An edit is still never reacted to, and nothing that does not exist is.
  perform tests.become(ann);
  if pg_temp.refusal(format('select react(%L, %L, %L)', gen_random_uuid(), a1, 'up')) is distinct from 'there is no such Act' then raise exception 'reacting to nothing'; end if;
  perform tests.unbecome();
end $$;
