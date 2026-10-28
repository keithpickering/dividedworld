-- Reactions: who reacted is private; how many of each kind an Act drew is public.
--
-- Task 6 of docs/plans/2026-10-28-core-loop-engine-plan.md; the rules are the design's section
-- 5 (docs/plans/2026-10-28-core-loop-design.md). Counted per player, recorded per character: a
-- reaction row names the character the player reacted through and the account behind it, and
-- every rule below is held per account, so switching characters is a choice of voice and never
-- a way round the cap.
--
-- `reactions` is never readable by the API roles and never in a Realtime publication (0007);
-- `reaction_tallies` is the public projection. react() is the only way in, and it holds:
--   - the caller plays the character it reacts through;
--   - none of the caller's characters wrote the Act (the refusal reaches only the player who
--     owns both, and reads the same whichever of their characters wrote it);
--   - one player leaves each kind at most once on an Act, across all their characters;
--   - one player leaves at most reactionCap distinct kinds on an Act.
-- The last two are constraints, not only checks: each reaction takes a numbered slot of its
-- player's on the Act, and the slot is unique, so two reactions made at the same instant
-- cannot both take the last one, whatever the function's check read.

create table reactions (
  id bigint generated always as identity primary key,
  act uuid not null references acts (id),
  reactor_character uuid not null references characters (id),
  reactor_account uuid not null references accounts (id),
  kind text not null references reaction_kinds (key),
  slot integer not null check (slot >= 1),
  created_at timestamptz not null default now(),
  unique (act, reactor_account, kind),
  unique (act, reactor_account, slot)
);
create index reactions_created on reactions (created_at);
create index reactions_reactor on reactions (reactor_account, created_at);

create table reaction_tallies (
  act uuid not null references acts (id),
  kind text not null references reaction_kinds (key),
  count integer not null check (count >= 0),
  primary key (act, kind)
);

alter table reactions enable row level security;
alter table reaction_tallies enable row level security;
revoke all on reactions, reaction_tallies from anon, authenticated;
grant select on reaction_tallies to authenticated;
create policy read on reaction_tallies for select to authenticated using (true);

-- React to an Act through one of the caller's characters. Returns the Act's public tally.
create function react(target uuid, through uuid, reaction text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := auth.uid();
  cap integer := (setting('reactionCap'))::integer;
  target_kind text;
  author_owner uuid;
  held text[];
  free_slot integer;
begin
  if caller is null then raise exception 'sign in to react' using hint = 'kayfabb.refusal', errcode = '28000'; end if;
  if not exists (select 1 from characters c where c.id = through and c.owner = caller) then
    -- The same words whether the character is another player's or does not exist.
    raise exception 'you do not play that character' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if not exists (select 1 from reaction_kinds k where k.key = reaction) then
    raise exception 'there is no reaction "%"', reaction using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  select a.kind, c.owner into target_kind, author_owner
  from acts a join characters c on c.id = a.character where a.id = target;
  if target_kind is null then raise exception 'there is no such Act' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if target_kind = 'edit' then raise exception 'an edit is not reacted to; react to the post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The author's owner now: a character changing hands is not in this slice, and the session
  -- that adds it decides what becomes of reactions between its old and new owner's characters.
  if author_owner = caller then
    raise exception 'your characters cannot react to each other' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;

  select coalesce(array_agg(r.kind order by r.slot), '{}') into held
  from reactions r where r.act = target and r.reactor_account = caller;
  -- The lowest free slot, so a slot given back (a reaction removed, later) is taken again rather
  -- than colliding for ever. The slot only makes two reactions at once collide; the cap is held
  -- by the count above, so lowering reactionCap later leaves existing reactions as they are.
  select min(g) into free_slot from generate_series(1, cardinality(held) + 1) g
  where not exists (select 1 from reactions r where r.act = target and r.reactor_account = caller and r.slot = g);
  if reaction = any (held) then
    raise exception 'you have already left that reaction here' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  if cardinality(held) >= cap then
    raise exception 'you have left % reactions here, the most there are', cap using hint = 'kayfabb.refusal', errcode = '23514';
  end if;

  begin
    insert into reactions (act, reactor_character, reactor_account, kind, slot)
    values (target, through, caller, reaction, free_slot);
  exception when unique_violation then
    -- Another reaction of this player's landed between the read above and this write.
    raise exception 'you reacted here twice at once; try again' using hint = 'kayfabb.refusal', errcode = '40001';
  end;
  insert into reaction_tallies (act, kind, count) values (target, reaction, 1)
  on conflict (act, kind) do update set count = reaction_tallies.count + 1;

  return (select coalesce(jsonb_object_agg(t.kind, t.count order by t.kind), '{}') from reaction_tallies t where t.act = target);
end $$;

revoke execute on function react(uuid, uuid, text) from public, anon;
grant execute on function react(uuid, uuid, text) to authenticated;
