-- When a persona's latest memory version was written (null: it has none). The Boss's meeting reads its own notes since this, the plan's
-- "since its last memory version", and not since the last recorded slot: a meeting that fails after its slot is recorded and before its
-- memory is saved would otherwise skip the notes written in between. Beside staff_memory_latest (0047), the service role's alone.
create function staff_memory_at(staff text) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select m.at from staff_memory m where m.staff = staff_memory_at.staff order by m.at desc, m.id desc limit 1
$$;
revoke execute on function staff_memory_at(text) from public, anon, authenticated;
grant execute on function staff_memory_at(text) to service_role;
