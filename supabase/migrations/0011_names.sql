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
-- engine/rules/name-folds.data.ts, and engine/rules/names.ts gives the client the same keys in
-- the same steps. Decomposing is the data's own (name_nfd), never Postgres's normalize(), whose
-- Unicode is a release behind the data's and differs from a browser's: the two copies would key
-- a name differently, and a lookalike Postgres did not yet decompose would pass.
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

-- A Hangul syllable's letters, by Unicode's algorithm (chapter 3.12); null for any other.
create function name_hangul(ch text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when s between 0 and 11171 then
    chr(4352 + s / 588) || chr(4449 + (s % 588) / 28) || case when s % 28 = 0 then '' else chr(4519 + s % 28) end end
  from (select ascii(ch) - 44032 as s) x
$$;

-- Canonical decomposition: each code point to its full decomposition, then each run of marks
-- after a starter (combining class 0) put in order of class, keeping the order of marks of one
-- class, as names.ts does: each mark is set in after the last code point of its run whose class
-- is not greater, a starter's 0 ending the run. A loop of keyed lookups, so a name costs its
-- length, not a pass over the tables.
create function name_nfd(s text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  chars text[] := '{}';
  classes integer[] := '{}';
  c text;
  d text;
  x text;
  k integer;
  i integer;
begin
  foreach c in array coalesce(string_to_array(s, null), '{}') loop
    select target into d from name_maps where kind = 'decompose' and source = c;
    foreach x in array string_to_array(coalesce(d, name_hangul(c), c), null) loop
      select class into k from name_classes where source = x;
      k := coalesce(k, 0);
      i := coalesce(array_length(chars, 1), 0);
      if k <> 0 then
        while i >= 1 and classes[i] > k loop i := i - 1; end loop;
      end if;
      chars := chars[1:i] || x || chars[i + 1:];
      classes := classes[1:i] || k || classes[i + 1:];
    end loop;
  end loop;
  return array_to_string(chars, '');
end $$;

-- A name's key: decompose, fold case, decompose, fold lookalikes, decompose, fold case again (a
-- prototype may be a capital), decompose.
create function name_skeleton(name text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select name_nfd(name_mapped(name_nfd(name_mapped(name_nfd(name_mapped(name_nfd(name), 'fold')), 'confusable')), 'fold'))
$$;

-- A name's key as written: decompose, fold lookalikes, decompose.
create function name_look(name text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select name_nfd(name_mapped(name_nfd(name), 'confusable'))
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

revoke execute on function name_mapped(text, text), name_hangul(text), name_nfd(text), name_skeleton(text), name_look(text), characters_name_key() from public, anon, authenticated;
