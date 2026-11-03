-- Cost at scale: docs/plans/2026-11-03-cost-at-scale-plan.md, built from docs/plans/2026-11-03-cost-at-scale-design.md.
-- Task 1 puts `my_settlement_moved` here. Task 2 adds the `my_followed_threads` view (ranked before it is counted) to this same file.

-- my_settlement_moved(settlement): whether one settlement moved the caller's characters, and how many, and when it was applied. A
-- client that heard a settlement announced on `reach` asks this once, at a random moment within REACH_SPREAD_MS, in place of reading
-- its whole head of my_alerts (a union of every source) to find one row.
--
-- It counts distinct characters, as my_alerts's settlement source does (0060: `count(distinct l.character)`), so the toast and the
-- Alerts row say the same number. It returns no row when the caller has no ledger line in the settlement, so "moved none" and "no
-- such settlement" are the same empty answer.
--
-- Cost, at a busy instance: one `ledger_account` (account, settlement) range for the caller's lines in that one settlement, and one
-- `settlements` primary-key read. Both are bounded by the caller's own lines in one settlement, whatever the instance holds.
--
-- The masks (design, section 5): it reads only the caller's own ledger lines, which My log already shows them. The answer has the
-- same shape for any id, and an id that does not exist answers as "moved none" does, so nothing is computed from anyone else's
-- ownership or class, and nothing differs with who owns what.
--
-- Its way out: it is a read, and holds no state.
create function my_settlement_moved(settlement bigint) returns table (count integer, applied_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select count(distinct l.character)::integer, s.applied_at
  from ledger l join settlements s on s.id = l.settlement
  where l.account = signed_in_account() and l.settlement = $1
  group by s.applied_at
$$;

revoke execute on function my_settlement_moved(bigint) from public, anon;
grant execute on function my_settlement_moved(bigint) to authenticated;
