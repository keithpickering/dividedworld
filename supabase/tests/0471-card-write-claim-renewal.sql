-- A claim on a card write is renewed by the worker that holds it, and by no other
-- (supabase/migrations/0471_card_write_claim_renewal.sql; docs/plans/2026-11-12-old-voice-window-design.md section 5; issue #584).
-- Every name is this file's, and the file's work is rolled back.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.claim(most integer, only_post uuid default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.become_service();
  r := claim_card_writes(most, only_post);
  perform tests.unbecome();
  return r;
end $$;
create function pg_temp.renew(p uuid, v uuid, n integer) returns boolean language plpgsql as $$
declare r boolean;
begin
  perform tests.become_service();
  r := renew_card_write(p, v, n);
  perform tests.unbecome();
  return r;
end $$;

do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); p uuid := gen_random_uuid(); wp uuid := gen_random_uuid();
  p2 uuid := gen_random_uuid(); wp2 uuid := gen_random_uuid();
  got jsonb; until1 timestamptz; rw card_writes%rowtype; said text;
begin
  insert into auth.users (id, email) values (ann, 'crn-ann@test.invalid'), (bob, 'crn-bob@test.invalid');
  insert into accounts (id) values (ann), (bob);
  insert into characters (id, owner, name, debuted_at) values (a, ann, 'Crn Caster', now()), (b, bob, 'Crn Author', now());
  insert into class_history (character, class_key) values (a, 'alpha'), (b, 'alpha');
  insert into card_kinds (key, name, alignment, rarity, play, stack, writes) values ('crn-scribe', 'Renewal Scribe', 'salty', 'uncommon', 'cast', 3, true);
  insert into threads (id, board, title) select t, bo.id, 'Renewal thread' from boards bo where bo.slug = 'general';
  insert into acts (id, character, kind, thread, payload) values (p, b, 'post', t, '{"body": "a"}'), (p2, b, 'post', t, '{"body": "b"}');
  insert into acts (id, character, kind, thread, payload, target_act_id) values
    (wp, a, 'card', t, '{"card": "crn-scribe", "message": "", "config": {}, "layer": 1, "tokens": 50}', p),
    (wp2, a, 'card', t, '{"card": "crn-scribe", "message": "", "config": {}, "layer": 1, "tokens": 50}', p2);
  -- Only this file's two jobs wait (the rest of the database's queue is cleared inside this file's transaction).
  delete from card_writes w where w.play not in (wp, wp2);

  -- A job that was never claimed has no claim to renew.
  if pg_temp.renew(wp, p, 0) is distinct from false then raise exception 'an unclaimed job was renewed'; end if;

  -- Claimed: attempts 1, held until about five minutes from now. Moved back to two minutes from now so a renewal's move is seen.
  got := pg_temp.claim(10, p);
  if jsonb_array_length(got) <> 1 or (got -> 0 ->> 'attempts')::integer <> 1 then raise exception 'the claim did not hand out the job once: %', got; end if;
  update card_writes w set claimed_until = clock_timestamp() + interval '2 minutes' where w.play = wp;

  if pg_temp.renew(wp, p, 1) is distinct from true then raise exception 'the holder of the claim was not renewed'; end if;
  select * into rw from card_writes w where w.play = wp;
  if rw.claimed_until < clock_timestamp() + interval '4 minutes 50 seconds' or rw.claimed_until > clock_timestamp() + interval '5 minutes 5 seconds' then
    raise exception 'a renewal did not hold the job for five minutes from now: %', rw.claimed_until;
  end if;
  if rw.attempts is distinct from 1 then raise exception 'a renewal changed attempts to %', rw.attempts; end if;
  -- And while it is held no claim takes it.
  if jsonb_array_length(pg_temp.claim(10, p)) <> 0 then raise exception 'a renewed job was handed out again'; end if;
  if (select w.attempts from card_writes w where w.play = wp) is distinct from 1 then raise exception 'a claim that took nothing counted an attempt'; end if;

  -- A claim that lapsed and was taken by another: the first worker (attempts 1) is refused, the rw is the second claim's, untouched.
  update card_writes w set claimed_until = clock_timestamp() - interval '1 second' where w.play = wp;
  got := pg_temp.claim(10, p);
  if jsonb_array_length(got) <> 1 or (got -> 0 ->> 'attempts')::integer <> 2 then raise exception 'the lapsed job was not claimed again: %', got; end if;
  select * into rw from card_writes w where w.play = wp;
  until1 := rw.claimed_until;
  if pg_temp.renew(wp, p, 1) is distinct from false then raise exception 'a worker whose claim was taken renewed it'; end if;
  if (select w.claimed_until from card_writes w where w.play = wp) is distinct from until1 or (select w.attempts from card_writes w where w.play = wp) is distinct from 2 then
    raise exception 'a refused renewal changed the rw';
  end if;
  if pg_temp.renew(wp, p, 2) is distinct from true then raise exception 'the second claim was not renewed'; end if;

  -- A claim that lapsed and was not taken is gone too (it would be taken at the next sweep, and the first worker must stop).
  update card_writes w set claimed_until = clock_timestamp() - interval '1 second' where w.play = wp;
  if pg_temp.renew(wp, p, 2) is distinct from false then raise exception 'a lapsed claim was renewed'; end if;

  -- An edit queues the job afresh (attempts 0, a new version): the claim before it is no longer anyone's.
  update card_writes w set claimed_until = clock_timestamp() + interval '2 minutes' where w.play = wp;
  insert into acts (character, kind, thread, payload, target_act_id) values (b, 'edit', t, '{"body": "a, edited"}', p);
  select * into rw from card_writes w where w.play = wp;
  if rw.attempts <> 0 or rw.claimed_until is not null then raise exception 'an edit did not queue the job afresh'; end if;
  if pg_temp.renew(wp, p, 2) is distinct from false or pg_temp.renew(wp, rw.version, 2) is distinct from false then raise exception 'a claim from before an edit was renewed'; end if;

  -- A worker whose claim came before an edit is refused by the version alone, even when the attempts match: A claimed at version v1 (attempts 1), the
  -- edit queued the job afresh (v2, attempts 0), and B claimed it (attempts 1, v2). A's renewal names (v1, 1): the same attempts as B's claim, a live claim.
  update card_writes w set not_before = clock_timestamp() where w.play = wp;
  got := pg_temp.claim(10, p);
  if jsonb_array_length(got) <> 1 or (got -> 0 ->> 'attempts')::integer <> 1 then raise exception 'the edited job was not claimed afresh: %', got; end if;
  select * into rw from card_writes w where w.play = wp;
  if rw.version is not distinct from p or rw.attempts <> 1 or rw.claimed_until is null or rw.claimed_until < clock_timestamp() then
    raise exception 'the claim after an edit is not at a new version with attempts 1: %', rw;
  end if;
  until1 := rw.claimed_until;
  if pg_temp.renew(wp, p, 1) is distinct from false then raise exception 'a claim from an older version renewed a newer claim with the same attempts'; end if;
  if (select w.claimed_until from card_writes w where w.play = wp) is distinct from until1 then raise exception 'a refused renewal by an older version moved claimed_until'; end if;
  if pg_temp.renew(wp, rw.version, 1) is distinct from true then raise exception 'the claim after the edit was not renewed by its own version'; end if;

  -- A finished job is not renewed: its rw is gone.
  got := pg_temp.claim(10, p2);
  if jsonb_array_length(got) <> 1 then raise exception 'the second post''s job was not claimed: %', got; end if;
  perform tests.become_service();
  perform finish_card_write(wp2, p2, 'A tail.', null, null);
  perform tests.unbecome();
  if pg_temp.renew(wp2, p2, 1) is distinct from false then raise exception 'a finished job was renewed'; end if;

  -- Service role only.
  perform tests.become_anon();
  said := pg_temp.refusal(format('select renew_card_write(%L, %L, 1)', wp, p));
  perform tests.unbecome();
  if said is null then raise exception 'anon renewed a claim'; end if;
  perform tests.become(ann);
  said := pg_temp.refusal(format('select renew_card_write(%L, %L, 1)', wp, p));
  perform tests.unbecome();
  if said is null then raise exception 'a signed-in player renewed a claim'; end if;
end $$;
