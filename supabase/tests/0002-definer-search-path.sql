-- Every security definer function pins its search_path, ending in pg_temp. A definer function
-- runs with its owner's rights, and one that resolves names through the caller's search_path
-- can be handed a caller's own table or function of the same name; pg_temp last stops a
-- temporary object from shadowing one. Read from the catalog, so a function added by any later
-- migration is held to it without being named here.
do $$
declare
  bad text := '';
  r record;
  path text;
begin
  for r in
    select p.oid::regprocedure::text as fn, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'extensions', 'tests')
  loop
    select substring(c from '^search_path=(.*)$') into path from unnest(coalesce(r.proconfig, '{}')) c where c like 'search_path=%';
    if path is null or btrim(split_part(path, ',', array_length(string_to_array(path, ','), 1))) <> 'pg_temp' then
      bad := bad || format(E'\n  %s (search_path %s)', r.fn, coalesce(path, 'not set'));
    end if;
  end loop;
  if bad <> '' then raise exception 'security definer functions without a search_path ending in pg_temp:%', bad; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef and n.nspname = 'public') = 0 then
    raise exception 'no security definer function was read, which cannot be right';
  end if;
end $$;
