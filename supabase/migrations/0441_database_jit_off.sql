-- The database plans without JIT: `jit = off` is stored for the database this runs on, so every new connection reads it (docs/plans/2026-11-25-database-jit-off-design.md).
--
-- Why: KayfaBB's reads are bounded reads by key, but `acts_public` (a union of two selects with their own subqueries, 0357) makes the planner estimate them far above their
-- real cost, over jit_above_cost and jit_optimize_above_cost. On a busy-instance fixture (40,000 posts, 4,000 edits) pool_signals over an hour took 6.9 s a call with JIT on and
-- 1.1 s with it off: about 5.8 s of every call was JIT compiling a read that runs in under a second. 0368_client_reads_plan_once.sql found the same for the client reads and put
-- `set jit = off` on each of them; that per-function setting stays, as a second guard. A setting on the database reaches what 0368 did not: the System's reads, the actions,
-- triggers, and PostgREST's own selects, and new code needs nothing. Rows returned are the same with JIT on or off; only the time differs.
-- The database is named by current_database(), so this names no database and no instance. It changes no function, view or table, and rewrites no Act.
-- It needs the role that applies it to own the database; where that is refused, this statement fails and the apply stops here, so it cannot pass unnoticed.
-- Ways out: no state is added. Masks: the setting is the same for every connection and caller; no private fact is read.
-- Test: supabase/tests/0441-database-jit-off.sql, red before this file (the session read jit as on).

do $$ begin execute format('alter database %I set jit = off', current_database()); end $$;
