-- A CHECK, a column default and a generated column run their functions as the writer, not as the table's owner, and 0001's default
-- privileges revoke EXECUTE on every new function from PUBLIC. A function a constraint calls must therefore be executable by PUBLIC, or
-- every writer without that right is refused with "permission denied for function" (0068's tip_keys_ok was, for a role that writes
-- account_preferences directly). Read from the catalog, so a function added by any later migration is held to it without being named here.
-- First, every public function a CHECK (a table's or a domain's), a default or a generated column calls is executable by PUBLIC; then, the behavior itself.
do $$
declare
  bad text := '';
  r record;
  seen integer := 0;
begin
  for r in
    select distinct p.oid, p.oid::regprocedure::text as fn
    from pg_depend d
    join pg_proc p on p.oid = d.refobjid and d.refclassid = 'pg_proc'::regclass
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where not (p.proname = 'invite_lifetime' and p.pronargs = 0) -- security definer and reads settings, so not granted to PUBLIC; only definer functions write invites (0020)
      and ((d.classid = 'pg_constraint'::regclass and exists (select 1 from pg_constraint c where c.oid = d.objid and c.contype = 'c'))
       or d.classid = 'pg_attrdef'::regclass)
    order by 2
  loop
    seen := seen + 1;
    if not has_function_privilege('public', r.oid, 'execute') then bad := bad || format(E'\n  %s', r.fn); end if;
  end loop;
  if bad <> '' then raise exception 'functions a CHECK, default or generated column calls, not executable by PUBLIC:%', bad; end if;
  if seen = 0 then raise exception 'no function called by a constraint was read, which cannot be right'; end if;
end $$;

-- The writer: a role with INSERT and UPDATE on account_preferences and nothing else. No SELECT, and no USAGE beyond schema public's, which is
-- PUBLIC's by default; bypassrls, so that row policies, which are not what is asked here, do not answer in place of the function's grant.
-- Made inside this file's transaction, which is rolled back. The account is made first, as the superuser; its id travels in a setting.
create role constraint_writer nologin bypassrls;
grant insert, update on account_preferences to constraint_writer;
select set_config('tests.writer', tests.account('constraint-writer')::text, true);
set local role constraint_writer;
insert into account_preferences (account, tips_seen) values (current_setting('tests.writer')::uuid, array['tour-plate', 'tour-orbs']);
-- No WHERE and no read of the old value: either would need SELECT, which the writer is not given.
update account_preferences set tips_seen = array['tour-plate', 'tour-orbs', 'tour-hand'];
reset role;
do $$ begin
  if (select cardinality(tips_seen) from account_preferences where account = current_setting('tests.writer')::uuid) is distinct from 3 then
    raise exception 'the writer''s row did not hold its three tips';
  end if;
end $$;
