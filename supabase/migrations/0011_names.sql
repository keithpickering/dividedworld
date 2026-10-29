-- Names that look different (the owner's answer 12, on #4): two characters' names are the same
-- name once case is folded and every letter that looks like another across scripts is folded
-- to the one prototype both look like (UTS #39's confusable skeleton). A name has two keys, each
-- held unique: folded (name_skeleton: case ignored, then every lookalike folded) and as written
-- (name_look: every lookalike folded, case as it is), since whether a letter looks like another
-- depends on its case: as written a capital I is the l it looks like, as a 1 is, but folding
-- case first makes it an i, which looks like neither. A Cyrillic а in
-- "Pipewrench" is refused; "Pipewrench II" and "The Real Pipewrench" are not. An imposter
-- nobody can see through can only be believed, not read.
--
-- The fix round's Task G. The data is 0010_name_folds.sql's, the client's copy
-- engine/rules/name-folds.data.ts, and engine/rules/names.ts gives the client the same key in
-- the same steps. Normalizing is Postgres's own (normalize, NFD), whose Unicode tables may be a
-- release behind the data's; a character new since then decomposes as the client's ICU says or
-- not at all, and the database's key is the one that decides.
--
-- A new release of the data comes in a migration of its own that reloads name_maps and
-- recomputes every name_key; a pair of existing names it makes the same is shown by that
-- migration's unique index failing, and an admin renames one before it applies.

-- Each character of s mapped through one of the folds, in order.
create function name_mapped(s text, through text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(string_agg(coalesce(m.target, c.ch), '' order by c.n), '')
  from string_to_table(s, null) with ordinality as c(ch, n)
  left join name_maps m on m.kind = through and m.source = c.ch
$$;

-- A name's key: decompose, fold case, decompose, fold lookalikes, decompose, fold case again (a
-- prototype may be a capital), decompose.
create function name_skeleton(name text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select normalize(name_mapped(normalize(name_mapped(normalize(name_mapped(normalize(name, NFD), 'fold'), NFD), 'confusable'), NFD), 'fold'), NFD)
$$;

-- A name's key as written: decompose, fold lookalikes, decompose.
create function name_look(name text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select normalize(name_mapped(normalize(name, NFD), 'confusable'), NFD)
$$;

-- Held by the table, so no writer can skip them: one name per instance, whatever its case or script.
alter table characters add column name_key text, add column name_look text;
update characters set name_key = name_skeleton(name), name_look = name_look(name);
alter table characters alter column name_key set not null, alter column name_look set not null;
create unique index characters_name_key on characters (name_key);
create unique index characters_name_look on characters (name_look);

create function characters_name_key() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.name_key := name_skeleton(new.name);
  new.name_look := name_look(new.name);
  return new;
end $$;
create trigger characters_name_key before insert or update of name on characters for each row execute function characters_name_key();

revoke execute on function name_mapped(text, text), name_skeleton(text), name_look(text), characters_name_key() from public, anon, authenticated;
