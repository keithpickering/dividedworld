-- Cursor bounds a generic plan can seek on (docs/plans/2026-11-14-cursor-bounds-design.md; its plan, Tasks 1 and 2).
-- A page cursor written `<arg> is null or <column> <= <arg>` is a catch-all: planned for a value it is a seek, but a plan built before the
-- value is known cannot drop the `is null` arm, so it reads every row behind the cursor and keeps 200. The bound is written
-- `<column> <= coalesce(<arg>, 'infinity')` instead, which a generic plan seeks on.
--   Task 1: a catalog guard over every sql and plpgsql function in public, driven red by planted functions, with controls it must leave alone.
--   Task 2: the cost on the real functions, a page 19,000 rows deep reading a page and not the depth.

-- ---- Task 1. No cursor bound is a catch-all ----
create function pg_temp.catch_all_bounds() returns table (fn text, arg text) language plpgsql as $f$
declare
  r record; a text; i int; d text; args text[]; refs text; other text; m text[];
begin
  for r in
    select p.oid, p.proname, p.proargnames, p.pronargs from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prolang in (select oid from pg_language where lanname in ('sql', 'plpgsql'))
  loop
    d := lower(regexp_replace(pg_get_functiondef(r.oid), '\s+', ' ', 'g'));
    -- A call is marked `ident#(`; every other parenthesis goes, since a `begin atomic` body comes back as ((in_before IS NULL) OR (l.ends_at <= in_before)).
    d := regexp_replace(d, '([a-z0-9_])\(', '\1#(', 'g');
    d := regexp_replace(regexp_replace(d, '[()]', ' ', 'g'), '\s+', ' ', 'g');
    -- Only the first pronargs names are inputs: `returns table` puts its output columns in proargnames too.
    args := coalesce(r.proargnames, '{}');
    for i in 1 .. r.pronargs loop
      a := coalesce(nullif(args[i], ''), '$' || i);
      refs := '(?:' || r.proname || '\.)?' || regexp_replace(a, '\$', '\\$') || '\M';
      for m in
        select regexp_matches(d, '(?<![a-z0-9_.])' || refs || ' is null or ([a-z_"][a-z0-9_."#]*) (?:<=|<|>=|>) ' || refs, 'g')
        union all
        select regexp_matches(d, '(?<![a-z0-9_.])' || refs || ' is null or ' || refs || ' (?:<=|<|>=|>) ([a-z_"][a-z0-9_."#]*)', 'g')
      loop
        other := regexp_replace(m[1], '^.*\.', '');
        -- The other side is a column only when it is no input argument, no literal and no call.
        if not (other = any (args[1:r.pronargs])) and other not in ('null', 'true', 'false') and other !~ '#' and other !~ '^[0-9]' then
          fn := r.proname; arg := a; return next; exit;
        end if;
      end loop;
    end loop;
  end loop;
end $f$;

-- The poisons: each must be returned.
create function public.planted_atomic(in_before timestamptz) returns bigint language sql stable
  begin atomic select count(*) from acts where in_before is null or created_at <= in_before; end;
create function public.planted_plpgsql(before timestamptz) returns bigint language plpgsql stable as $$
begin
  return (select count(*) from acts a where planted_plpgsql.before is null or a.created_at < before);
end $$;
create function public.planted_since(since timestamptz) returns bigint language sql stable as $$
  select count(*) from acts where since is null or since < created_at
$$;
create function public.planted_positional(timestamptz) returns bigint language sql stable as $$
  select count(*) from acts where $1 is null or created_at <= $1
$$;
-- The controls: none may be returned.
create function public.planted_bound(in_before timestamptz) returns bigint language sql stable as $$
  select count(*) from acts where created_at <= coalesce(in_before, 'infinity')
$$;
create function public.planted_equal(card text) returns bigint language sql stable as $$
  select count(*) from acts where card is null or payload ->> 'card' = card
$$;
create function public.planted_check(ends timestamptz) returns boolean language plpgsql stable as $$
begin
  if ends is null or ends <= now() then return true; end if;
  return false;
end $$;
create function public.planted_args(since timestamptz, until timestamptz) returns boolean language plpgsql stable as $$
begin
  if since is null or until <= since then return true; end if;
  return false;
end $$;
create function public.planted_table(in_before integer) returns table (at timestamptz) language sql stable as $$
  select created_at from acts where in_before is null or 1 <= in_before
$$;

do $$
declare
  found text[]; bad text;
begin
  select array_agg(fn || '.' || arg order by fn, arg) into found from pg_temp.catch_all_bounds();
  select string_agg(p, ', ') into bad from unnest(array['planted_atomic.in_before', 'planted_plpgsql.before', 'planted_since.since', 'planted_positional.$1']) p where p <> all (coalesce(found, '{}'));
  if bad is not null then raise exception 'the guard missed a planted catch-all: %', bad; end if;
  select string_agg(f, ', ') into bad from unnest(coalesce(found, '{}')) f where f like 'planted\_%' and f not in ('planted_atomic.in_before', 'planted_plpgsql.before', 'planted_since.since', 'planted_positional.$1');
  if bad is not null then raise exception 'the guard returned a control: %', bad; end if;
  select string_agg(f, ', ') into bad from unnest(coalesce(found, '{}')) f where f not like 'planted\_%';
  if bad is not null then raise exception 'cursor bounds written as a catch-all (use col <= coalesce(arg, ''infinity'')): %', bad; end if;
end $$;
