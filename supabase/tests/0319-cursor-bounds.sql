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

-- ---- Task 2. A deep page reads a page, not the depth ----
-- One case for each function the bound is rewritten in. The caller's table is seeded with 20,000 rows a minute apart plus 50 other owners' rows at now(), analyzed, and a
-- page is read once 19,000 rows deep and once from the top (a null cursor), as the owning account. A read is a tuple the source table gave up: the change in
-- seq_tup_read + idx_tup_fetch from pg_stat_xact_user_tables around the call. Each call reads at most 400 (a page is 200, with room for a boundary probe and plan noise).
-- Postgres 16 already plans a `language sql` body with its argument unknown; the plpgsql functions are pinned to a generic plan and called once, uncounted, first.
-- Seeding goes straight into the tables as the file's superuser, as 0313-discipline-scale.sql does; a trophy kind, a staff persona and an Act for a note are written inline,
-- since the fixtures have none. A staff_notes_recent cursor is a lower bound (`since`), so "deep" is a cursor just behind the newest note: the catch-all reads all 20,000 to
-- find the 200 that are not there, and a seek reads none.
create function pg_temp.reads(tbl text, stmt text) returns bigint language plpgsql as $f$
declare before_n bigint; after_n bigint;
begin
  select seq_tup_read + idx_tup_fetch into before_n from pg_stat_xact_user_tables where relname = tbl;
  execute stmt;
  select seq_tup_read + idx_tup_fetch into after_n from pg_stat_xact_user_tables where relname = tbl;
  return after_n - before_n;
end $f$;

do $$
declare
  most_reads constant integer := 400;
  n constant integer := 20000;
  ann uuid := tests.account('cb-ann'); adm uuid := tests.account('cb-adm');
  a uuid := tests.character(ann, 'Cb Ann');
  others uuid[] := array(select tests.character(tests.account('cb-o' || g), 'Cb Other ' || g) from generate_series(1, 50) g);
  th uuid := tests.thread();
  post uuid := tests.post(a, th);
  deep text := 'now() - interval ''19000 minutes''';
  cases text[][];
  c text[]; d bigint; z bigint; bad text := ''; limit_deep integer;
begin
  insert into admins (account) values (adm);
  insert into trophy_kinds (key, name, belt) values ('cb-belt', 'Cb Belt', true);
  insert into characters (name, staff, staff_kind) values ('Cb Staff', 'cb-staff', 'persona'), ('Cb Staff Two', 'cb-staff2', 'persona');
  -- The caller's rows, a minute apart, and 50 other owners' at now().
  insert into wallet_events (account, kind, change, balance_after, at) select ann, 'grant', 1, g, now() - g * interval '1 minute' from generate_series(1, n) g;
  insert into wallet_events (account, kind, change, balance_after, at) select o, 'grant', 1, 1, now() from (select owner o from characters where id = any (others)) t;
  insert into random_events (account, character, at, outcome, line, line_text) select ann, a, now() - g * interval '1 minute', 'line', 'x', 'x' from generate_series(1, n) g;
  insert into random_events (account, character, at, outcome, line, line_text) select c.owner, c.id, now(), 'line', 'x', 'x' from characters c where c.id = any (others);
  insert into trophy_awards (trophy, character, by, at) select 'cb-belt', a, 'admin', now() - g * interval '1 minute' from generate_series(1, n) g;
  insert into trophy_awards (trophy, character, by, at) select 'cb-belt', o, 'admin', now() from unnest(others) o;
  insert into staff_notes (staff, act, body, at) select 'cb-staff', post, 'n', now() - g * interval '1 minute' from generate_series(1, n) g;
  insert into staff_notes (staff, act, body, at) select 'cb-staff2', post, 'n', now() from generate_series(1, 50);
  analyze wallet_events; analyze random_events; analyze trophy_awards; analyze staff_notes;
  perform set_config('plan_cache_mode', 'force_generic_plan', true);

  -- table, deep statement, null statement, the most a deep call may read, run as
  cases := array[
    ['wallet_events', format('select log_page(%s)', deep), 'select log_page(null)', most_reads::text, ann::text],
    ['random_events', format('select count(*) from cosmetic_log_rows(%s)', deep), 'select count(*) from cosmetic_log_rows(null)', most_reads::text, ann::text],
    ['trophy_awards', format('select trophies_of(%L, %s, 50)', a, deep), format('select trophies_of(%L, null, 50)', a), most_reads::text, ann::text],
    ['trophy_awards', format('select belt_lineage(''cb-belt'', %s, 50)', deep), 'select belt_lineage(''cb-belt'', null, 50)', most_reads::text, ann::text],
    -- admin_awards has no owner key in front: its deep call may read what a page reads and what the row comparison skips, most + 200.
    ['trophy_awards', format('select admin_awards(%s, 50)', deep), 'select admin_awards(null, 50)', (50 + 200)::text, adm::text],
    ['staff_notes', 'select staff_notes_recent(''cb-staff'', now() - interval ''30 seconds'', 200)', 'select staff_notes_recent(''cb-staff'', null, 200)', most_reads::text, 'service']];
  foreach c slice 1 in array cases loop
    -- staff_notes_recent is the service role's alone (0088).
    if c[5] = 'service' then perform tests.become_service(); else perform tests.become(c[5]::uuid); end if;
    -- A stat that was never counted would pass every bound: the call must have read something.
    execute c[2]; execute c[3];                      -- once each, uncounted, so the plan is built before the count
    d := pg_temp.reads(c[1], c[2]); z := pg_temp.reads(c[1], c[3]);
    perform tests.unbecome();
    raise notice '% %: deep % reads, null % reads', c[1], substr(c[2], 1, 40), d, z;
    if z < 1 then bad := bad || format(E'\n  %s: the null call read nothing, so reads were not counted (%s)', c[2], z); end if;
    if d > c[4]::integer then bad := bad || format(E'\n  %s read %s %s rows deep (at most %s)', substr(c[2], 1, 60), d, c[1], c[4]); end if;
  end loop;
  perform set_config('plan_cache_mode', 'auto', true);
  if bad <> '' then raise exception 'a deep page reads its depth:%', bad; end if;
end $$;
