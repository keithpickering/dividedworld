-- Characters as the lists show them. The screens' engine plan, Tasks 9 and 10.
--
-- The season's standings: every character that has debuted, ranked by its settled standing in the
-- open season. A mask appears in a list only from the settlement that debuts it (PR #7's Task F:
-- masks change at the tally), so a new one never shows up live, and nobody's sitting can be read
-- from when it does; a debuted character with nothing settled yet stands at 0. Ties share a place.
-- Standings move only at a settlement (0003), so the list does too. Between seasons, which a gap
-- in the calendar can leave, it is the season that ended last, as it stood at its end. The view
-- runs as its owner and names only these four columns: never a player, never a class.

create view season_standings as
  select c.id as character, c.name, coalesce(s.amount, 0) as standing,
    rank() over (order by coalesce(s.amount, 0) desc) as place
  from characters c
  left join standings s on s.character = c.id
    and s.season = coalesce((select id from seasons where ends_at is null), (select id from seasons order by starts_at desc limit 1))
  where c.debuted_at is not null;

revoke all on season_standings from anon, authenticated;
grant select on season_standings to authenticated;
-- Retiring a character. A full roster (charactersPerPlayer) has no way to free a slot until the
-- Pound is designed, so for now an admin retires a character on its player's request (the
-- screens' design, section 8): it frees the slot, it can no longer act, and every Act it made stays
-- where it is, readable and known by its name. Its way out is an admin's restore, refused while
-- its player's roster is full again. To any other player a retired character is any character
-- they do not play: played_by says it is retired only to its own player.

alter table characters add column retired_at timestamptz;

-- characters_within_cap (0001): retired characters hold no slot.
create or replace function characters_within_cap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cap integer := (setting('charactersPerPlayer'))::integer;
declare held integer;
begin
  perform 1 from accounts where id = new.owner for no key update;
  select count(*) into held from characters where owner = new.owner and retired_at is null;
  if held >= cap then
    raise exception 'a player runs at most % characters', cap using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  return new;
end $$;

-- played_by (0001), which every action a character takes asks: a retired character's own player is
-- told it is retired, and how it comes back.
create or replace function played_by(through uuid, who uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  waiting boolean;
  retired boolean;
begin
  select c.debuted_at is null, c.retired_at is not null into waiting, retired from characters c where c.id = through and c.owner = who;
  if waiting is null then
    raise exception 'you do not play that character' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if waiting then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if retired then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
end $$;

-- acts_well_formed (0001), holding a writer that forgets to ask: no Act by a retired character.
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

create function only_admins(doing text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'only an admin %', doing using hint = 'kayfabb.refusal', errcode = '42501'; end if;
end $$;

-- An admin retires a character: its waiting Turn, which it could no longer withdraw, goes with it.
create function retire_character(of_character uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform only_admins('retires a character');
  perform 1 from characters where id = of_character for no key update;
  if not found then raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if exists (select 1 from characters where id = of_character and retired_at is not null) then
    raise exception 'that character is already retired' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- One waiting to debut would debut at the next settlement all the same, named in the tally as a
  -- mask nobody can play; it is retired once it has.
  if exists (select 1 from characters where id = of_character and debuted_at is null) then
    raise exception 'that character debuts at the next settlement; it can be retired once it has' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  update characters set retired_at = now() where id = of_character;
  delete from pending_turns where character = of_character;
  return jsonb_build_object('character', of_character, 'retired', true);
end $$;

-- An admin restores one, into a roster with a slot free.
create function restore_character(of_character uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  its_owner uuid;
  cap integer := (setting('charactersPerPlayer'))::integer;
begin
  perform only_admins('restores a character');
  select owner into its_owner from characters where id = of_character and retired_at is not null;
  if its_owner is null then
    if exists (select 1 from characters where id = of_character) then raise exception 'that character is not retired' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    raise exception 'there is no such character' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  -- The roster's lock, as a creation takes it (characters_within_cap): a restore and a creation at
  -- once count one after the other, so they never fill a roster past its cap together.
  perform 1 from accounts where id = its_owner for no key update;
  if (select count(*) from characters where owner = its_owner and retired_at is null) >= cap then
    raise exception 'its player already runs % characters; one retired frees a slot', cap using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  update characters set retired_at = null where id = of_character;
  return jsonb_build_object('character', of_character, 'retired', false);
end $$;

revoke execute on function only_admins(text) from public, anon, authenticated;
revoke execute on function retire_character(uuid), restore_character(uuid) from public, anon;
grant execute on function retire_character(uuid), restore_character(uuid) to authenticated;
