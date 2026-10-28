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
