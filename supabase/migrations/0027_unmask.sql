-- A class revealed by its own player: an `unmask` Act, the character's own, made in a thread its
-- player chooses, naming the class The System checked when it was made and, if the player likes, a
-- line of the character's words. The class reveal design, sections 2 and 3; its plan, Task 1.
--
-- A player may make their own character's class public (CLAUDE.md, "A response never proves a
-- private fact"): unmask() reads the class only at its own player's request, and states only the
-- class held at that moment, which stays true as a statement about that date whatever the
-- character does after. What is public from then is read from Acts alone: `class_reveals` from the
-- unmask Acts, `turns_announced` from the tallies. Neither reads class_history.
--
-- A reveal is an Act like a post or a card: reacted to, spun, scored for its character by its
-- class (engine/rules/settle.ts), and no post toward the Lurker's limit. The season's reveal Acts
-- are kind `reveal`; a character's is `unmask`, so the two never share a name in code.
--
-- Its way out: a revealed class holds nobody. A player who wants the secret back Turns (silently,
-- if they like), and the reveal stays a dated fact; or starts a new character.

alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask'));
alter table acts drop constraint acts_check1;
alter table acts add constraint acts_check1 check (kind in ('post', 'tally', 'reveal', 'unmask') or target_act_id is not null);
-- An unmask points at nothing: it is the character's own statement, not an answer.
alter table acts add constraint acts_unmask_untargeted check (kind <> 'unmask' or target_act_id is null);

-- A character's reveals, newest first, for the postbit: one index probe per character on a page.
create index acts_unmask on acts (character, created_at desc) where kind = 'unmask';
-- The tallies naming a character's Turn, for the same postbit, by containment: a GIN probe per
-- character, never a pass over every tally the instance has posted.
create index acts_tally_turns on acts using gin ((payload -> 'turns') jsonb_path_ops) where kind = 'tally';

-- acts_well_formed (0021), holding a writer that forgets: an unmask names the class its character
-- holds at the Act's own moment, read where it is written, so no caller's word for the class can
-- reach the table. Everything else as 0021 wrote it.
create or replace function acts_well_formed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t acts%rowtype;
begin
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.debuted_at is null) then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.retired_at is not null) then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.kind = 'unmask' and (new.payload ->> 'class') is distinct from (select class_key from class_now(new.character, new.created_at)) then
    raise exception 'an unmask names the class its character holds' using errcode = '23514';
  end if;
  if new.target_act_id is null then return new; end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'edit' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'an edit is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card' and t.kind <> 'post' then
    raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind <> 'edit' and t.kind = 'edit' then
    raise exception 'an edit is not answered; answer the post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $$;

-- The one writer of an unmask Act, whoever asks for it: a player's reveal here (`via` 'act'), and
-- the reveal a debut or a Turn announced with its class writes when it takes effect (0028), so the
-- three cannot drift. The class is the one held at `at`, read here and nowhere else. Returns the
-- Act's public projection, for its caller to send live.
create function write_unmask(of_character uuid, in_thread uuid, via text, at timestamptz, message text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare written uuid;
begin
  insert into acts (character, kind, thread, payload, created_at)
  select of_character, 'unmask', in_thread, jsonb_build_object('class', n.class_key, 'message', coalesce(message, ''), 'via', via), at
  from class_now(of_character, at) n
  returning id into written;
  if written is null then raise exception 'character % held no class at %', of_character, at using errcode = 'P0002'; end if;
  return act_projection(written);
end $$;

-- A reveal, as the character's player, at once, in a thread of a player's board. Its message is
-- plain text of at most 200 characters, as a card's caster's (0016), and may be empty. The
-- character's row is locked first, as turn() and masks_change() lock it, so a settlement making a
-- Turn take effect goes wholly before it or after it: the class named is the one that had taken
-- effect when the reveal was made, true on its date. A refusal is said only to the player who
-- asked, about a character they named.
create function unmask(through uuid, in_thread uuid, message text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  said text := coalesce(message, '');
  on_board uuid;
begin
  perform acting(through);
  if char_length(said) > 200 then raise exception 'the message is at most 200 characters' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  perform 1 from characters where id = through for no key update;
  return write_unmask(through, in_thread, 'act', now(), said);
end $$;

-- Every reveal of a class, however it was made (`via`: 'act', 'debut' or 'turn'): its Act, its
-- character, the class it named, its date and its thread. Read from the unmask Acts alone.
create view class_reveals as
  select a.id as act, a.character, a.payload ->> 'class' as class, a.created_at as at, a.payload ->> 'via' as via, a.thread
  from acts a where a.kind = 'unmask';

-- Every announced Turn, from the tallies that named it: the tally, the character, the date it took
-- effect and, where the Turn named it, the class it Turned from and since when (0007's `was` and
-- `since`). A silent Turn is in no tally, so it is in no row. Read from the tally Acts alone, by
-- character first, so a filter on one character is a probe of acts_tally_turns.
create view turns_announced as
  select a.id as act, c.id as character, a.created_at as at, e.entry ->> 'was' as was, (e.entry ->> 'since')::timestamptz as since
  from characters c
  cross join lateral (
    select x.id, x.created_at, x.payload from acts x
    where x.kind = 'tally' and x.payload -> 'turns' @> jsonb_build_array(jsonb_build_object('character', c.id))
  ) a
  cross join lateral jsonb_array_elements(a.payload -> 'turns') e(entry)
  where e.entry ->> 'character' = c.id::text;

revoke all on class_reveals, turns_announced from anon, authenticated;
grant select on class_reveals, turns_announced to authenticated;
revoke execute on function write_unmask(uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
revoke execute on function unmask(uuid, uuid, text) from public, anon;
grant execute on function unmask(uuid, uuid, text) to authenticated;
