-- Reactions (supabase/migrations/0002_reactions.sql): react()'s refusals, the public tally, and
-- the cap held per player across their characters. Plan Task 6.

-- A refusal's message, or null when the call went through.
create function pg_temp.refusal(target uuid, through uuid, reaction text) returns text language plpgsql as $$
begin
  perform react(target, through, reaction);
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('r-ann');
  bob uuid := tests.account('r-bob');
  cat uuid := tests.account('r-cat');
  a1 uuid := tests.character(ann, 'Anvil');
  a2 uuid := tests.character(ann, 'Awl');
  b1 uuid := tests.character(bob, 'Bellows');
  b2 uuid := tests.character(bob, 'Brad');
  c1 uuid := tests.character(cat, 'Caliper');
  t uuid := tests.thread();
  pa1 uuid := tests.post(a1, t, 'By Anvil.');
  pa2 uuid := tests.post(a2, t, 'By Awl.');
  pb uuid := tests.post(b1, t, 'By Bellows.');
  e uuid := tests.act(b1, 'edit', t, '{"body": "By Bellows, edited."}', pb);
  why text;
  own1 text;
  own2 text;
  tally jsonb;
  n integer;
  cap text := setting('reactionCap');
begin
  -- Nobody signed in.
  if pg_temp.refusal(pb, a1, 'up') is null then raise exception 'a reaction with no session went through'; end if;

  perform tests.become(ann);
  perform auth.assert_impersonating();

  -- Through a character the caller does not play: the same words for another's and for none.
  why := pg_temp.refusal(pb, b2, 'up');
  if why is distinct from 'you do not play that character' then raise exception 'reacting through another''s character: %', why; end if;
  if pg_temp.refusal(pb, gen_random_uuid(), 'up') is distinct from why then raise exception 'a missing character should read as another''s'; end if;

  -- To one's own character, through another of one's own: refused, and the same whichever wrote it.
  own1 := pg_temp.refusal(pa1, a2, 'up');
  own2 := pg_temp.refusal(pa2, a1, 'up');
  if own1 is null then raise exception 'a player''s characters reacted to each other'; end if;
  if own1 is distinct from own2 then raise exception 'the refusal for one''s own character differs by which wrote it: % / %', own1, own2; end if;
  if pg_temp.refusal(pa1, a1, 'up') is distinct from own1 then raise exception 'reacting to oneself should read the same'; end if;

  -- A kind the instance does not have, an edit, an Act that is not there.
  if pg_temp.refusal(pb, a1, 'shrug') is null then raise exception 'an unknown reaction went through'; end if;
  if pg_temp.refusal(e, a1, 'up') is null then raise exception 'a reaction to an edit went through'; end if;
  if pg_temp.refusal(gen_random_uuid(), a1, 'up') is null then raise exception 'a reaction to nothing went through'; end if;

  -- Three kinds from one player, between two characters; the same kind twice, and a fourth, refused.
  tally := react(pb, a1, 'up');
  if tally <> '{"up": 1}' then raise exception 'the tally after one reaction: %', tally; end if;
  perform react(pb, a2, 'boo');
  why := pg_temp.refusal(pb, a2, 'up');
  if why is null then raise exception 'one player left the same kind twice, through two characters'; end if;
  perform react(pb, a1, 'calm');
  why := pg_temp.refusal(pb, a2, 'meh');
  if why is null then raise exception 'a fourth kind from one player went through'; end if;
  if why not like format('%%%s reactions%%', cap) then raise exception 'the cap''s refusal should say the cap: %', why; end if;
  perform tests.unbecome();

  -- Nothing refused above wrote a row or moved a tally.
  if (select count(*) from reactions) <> 3 or (select sum(count) from reaction_tallies) <> 3 then
    raise exception 'a refused reaction left a row or a count behind';
  end if;

  -- Another player is held to their own three.
  perform tests.become(cat);
  tally := react(pb, c1, 'up');
  if tally <> '{"up": 2, "boo": 1, "calm": 1}' then raise exception 'the tally: %', tally; end if;
  perform tests.unbecome();

  -- The tally matches the rows, kind by kind; the rows name the characters reacted through.
  select count(*) into n from reaction_tallies t
  where t.act = pb and t.count <> (select count(*) from reactions r where r.act = pb and r.kind = t.kind);
  if n <> 0 then raise exception 'a tally does not match its rows'; end if;
  if (select array_agg(reactor_character order by slot) from reactions where act = pb and reactor_account = ann) <> array[a1, a2, a1] then
    raise exception 'each reaction is recorded against the character it was left through';
  end if;
end $$;

-- ---- Who reacted is never readable; the tally is ----
do $$
declare
  ann uuid := tests.account('s-ann');
  bob uuid := tests.account('s-bob');
  a uuid := tests.character(ann, 'Sander');
  b uuid := tests.character(bob, 'Solder');
  p uuid := tests.post(a, tests.thread());
  refused boolean := false;
  n integer;
begin
  perform tests.become(bob);
  perform react(p, b, 'up');
  begin perform 1 from reactions;
  exception when insufficient_privilege then refused := true; end;
  if not refused then raise exception 'a player read the reactions table'; end if;
  perform tests.unbecome();
  perform tests.become(ann);
  refused := false;
  begin perform 1 from reactions;
  exception when insufficient_privilege then refused := true; end;
  if not refused then raise exception 'the reacted-to player read who reacted'; end if;
  select count into n from reaction_tallies where act = p and kind = 'up';
  if n <> 1 then raise exception 'the tally should be public'; end if;
  perform tests.unbecome();
end $$;

-- ---- A visitor with no session can neither read who reacted nor react ----
do $$
declare
  p uuid := tests.post(tests.character(tests.account('anon-target'), 'Anvil Two'), tests.thread());
  refused boolean := false;
begin
  perform tests.become_anon();
  begin perform 1 from reactions; exception when insufficient_privilege then refused := true; end;
  if not refused then raise exception 'anon read the reactions table'; end if;
  refused := false;
  begin perform react(p, gen_random_uuid(), 'up'); exception when insufficient_privilege then refused := true; end;
  if not refused then raise exception 'anon called react()'; end if;
  perform tests.unbecome();
end $$;

-- ---- A slot given back is taken again ----
-- No action removes a reaction yet; when one does, the player's next reaction must not collide
-- with the slot after the last for ever. Removed here by hand, as that action will.
do $$
declare
  ann uuid := tests.account('slot-ann');
  a uuid := tests.character(ann, 'Slotter');
  b uuid := tests.character(tests.account('slot-bob'), 'Slotted');
  p uuid := tests.post(b, tests.thread());
begin
  perform tests.become(ann);
  perform react(p, a, 'up'); perform react(p, a, 'boo'); perform react(p, a, 'calm');
  perform tests.unbecome();
  delete from reactions where act = p and kind = 'up';
  perform tests.become(ann);
  perform react(p, a, 'meh');
  perform tests.unbecome();
  if (select slot from reactions where act = p and kind = 'meh') <> 1 then raise exception 'the freed slot was not taken again'; end if;
end $$;
