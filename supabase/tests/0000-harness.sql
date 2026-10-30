-- The harness itself: impersonation inside the transaction wrap works, and the shim left
-- pgcrypto in place. This file exists so the first assertion in the repository is about the
-- thing every later one relies on, and so a harness that stopped wrapping files in a
-- transaction (where `set local` is a silent no-op) fails here, by name.
--
-- The impersonation is set in statements of its own and read in a later one, on purpose:
-- inside one `do` block a `set local` holds until the block ends whether or not the harness
-- wrapped the file, so only a setting made in one statement and read in the next can tell.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
do $$
begin
  perform auth.assert_impersonating();
  if auth.uid() is distinct from '11111111-1111-4111-8111-111111111111'::uuid then
    raise exception 'auth.uid() should read the sub claim set two statements ago, got %', auth.uid();
  end if;
  if auth.role() is not null then
    raise exception 'auth.role() should be null with no role claim, got %', auth.role();
  end if;
  if length(extensions.digest('kayfabb', 'sha256')) <> 32 then
    raise exception 'pgcrypto digest() is not in place after the shim';
  end if;
end $$;

-- Every connection to the scratch database starts bounded (tools/test-sql.mjs, SESSION_BOUNDS), this
-- file's and a dblink session's alike, so a lock regression whose two sides are this connection and a
-- session it waits on fails at lock_timeout, naming its file, instead of hanging the suite. The bounds are
-- read where each side reads them; a harness that set them on one connection only, or not at all, fails here.
reset role;
do $$
declare
  remote record;
begin
  if current_setting('lock_timeout') in ('0', '') or current_setting('statement_timeout') in ('0', '') then
    raise exception 'this file''s connection is unbounded: lock_timeout %, statement_timeout %', current_setting('lock_timeout'), current_setting('statement_timeout');
  end if;
  select * into remote from extensions.dblink(current_setting('kayfabb.scratch_url'),
    $sql$select current_setting('lock_timeout'), current_setting('statement_timeout')$sql$) as x(lock_timeout text, statement_timeout text);
  if remote.lock_timeout in ('0', '') or remote.statement_timeout in ('0', '') then
    raise exception 'a dblink session is unbounded: lock_timeout %, statement_timeout %', remote.lock_timeout, remote.statement_timeout;
  end if;
  if remote.lock_timeout is distinct from current_setting('lock_timeout') or remote.statement_timeout is distinct from current_setting('statement_timeout') then
    raise exception 'a dblink session''s bounds (%, %) are not this connection''s (%, %)', remote.lock_timeout, remote.statement_timeout, current_setting('lock_timeout'), current_setting('statement_timeout');
  end if;
end $$;
