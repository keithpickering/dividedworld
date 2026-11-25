Record, written 2026-11-25.

# JIT off for the whole database: plan

The design is `docs/plans/2026-11-25-database-jit-off-design.md`; read it first, all of it. It starts after the
suite-split PR (#1096, `docs/plans/2026-11-25-sql-suite-split-plan.md`) has merged, because Task 1 changes the
`cloneSql` that #1096 adds to `tools/test-sql.mjs`. Built in one PR from `main` once #1096 is on it.

No deployed database, bucket or connector is touched: every run is against Postgres on localhost. Applying the migration
to an instance is the owner's go-ahead. CLAUDE.md is not changed, and neither is `tools/build.mjs`'s `STEPS`. Every task
is test first, with its red run recorded in the PR.

`NNNN` below is the next free migration number when the build starts (0428 on 2026-11-25). The migration is
`supabase/migrations/NNNN_database_jit_off.sql` and its assertion file `supabase/tests/NNNN-database-jit-off.sql`, as
`tools/check-migration-versions.mjs` and the suite's numbering expect.

## Task 1. A clone carries what its source database stored

Model: sonnet

Files: `tools/test-sql.mjs` (`cloneSql`, its header paragraph on settings), `tools/test-sql-refusal.mjs`.

**Tests first** (`tools/test-sql-refusal.mjs`, with the recording psql it already uses; red against #1096's `cloneSql`):
- The SQL that makes a clone copies, before the clone's own settings, every setting stored for the source database with
  no role: a statement that reads `pg_db_role_setting` where `setdatabase` is the source's oid and `setrole = 0`, and
  runs one `alter database <clone> set <name> to <value>` for each (`\gexec`). The test asserts that the copy comes
  first and the runner's own `alter database` lines (`settingsSql(clone, url)`) come after it, so the clone's
  `scratch_url` names the clone.
- The poison: #1096's `cloneSql` as it stands (no copy) fails the check. So does one that puts the copy after the
  runner's own settings, because the copied `scratch_url` would then name the template.
- The copy holds no list of setting names: a check that the SQL does not name `jit` (or any setting the migrations
  store) and reads the names from the catalog.

**The change.** `cloneSql(template, clone, url)` becomes `create database <clone> template <source>;`, then the copy,
then `settingsSql(clone, url)`. The copy, measured in the design session on Postgres 16 (values with commas, such as
`kayfabb.client_rpcs`, survive):
```sql
select format('alter database %I set %s to %L', '<clone>', split_part(c, '=', 1), substr(c, strpos(c, '=') + 1))
from pg_db_role_setting s, unnest(s.setconfig) c
where s.setdatabase = (select oid from pg_database where datname = '<source>') and s.setrole = 0 \gexec
```
The header paragraph that says "Settings do not travel with a clone" is rewritten to say what is now true: the runner
copies what the source stored, then gives the clone its own, and why (design §3). `supabase/tests/e2e/psql-db.ts` calls
the same `cloneSql` for the end-to-end files' databases, so it needs no change; the task confirms that by reading it and
says so in the PR.

**Done when** `node tools/test-sql-refusal.mjs` passes, its red run against the old `cloneSql` is in the PR, and the
whole suite (`npm run test:sql`) passes on localhost.

## Task 2. The migration and the file that proves it

Model: inline

Files: `supabase/migrations/NNNN_database_jit_off.sql`, `supabase/tests/NNNN-database-jit-off.sql`.

**Test first** (`supabase/tests/NNNN-database-jit-off.sql`), red before the migration exists:
1. `current_setting('jit') = 'off'`, else raise naming the value.
2. `pg_db_role_setting` holds `jit=off` for `current_database()` with `setrole = 0`, else raise "the database does not
   store jit = off". This is what separates the migration's setting from one a session set for itself.
3. In the file's transaction, `set local jit_above_cost = 0`. An `explain (analyze, format json)` of
   `select sum(g) from generate_series(1, 1000) g`, taken through a `pg_temp` function that returns the JSON, has no
   `JIT` key on its top object. Then `set local jit = on`: if `pg_jit_available()`, the same explain has a `JIT` key, else
   raise "the probe cannot see JIT" (the check is blind); if not available, `raise notice` that the JIT part was not
   exercised on this server, and the file still passes on 1 and 2. Measured in the design session on Postgres 16: off
   gives no key, and on gives a key.

**Poisons, each run and recorded in the PR:**
- The file on today's main (no migration): red on 1.
- The migration with its statement removed: red on 1 and 2.
- The file on a clone made without Task 1's copy: red on 1 (Task 1's self-test drives the same defect in the runner).

**The migration.** Its header follows the repository's form: what it does and why (the design's §1 figures in a
sentence, and that 0368's per-function setting stays); "Ways out: no state is added"; "Masks: the setting is the same
for every connection and caller; no private fact is read"; the test that drives it red. The body is one statement:
```sql
do $$ begin execute format('alter database %I set jit = off', current_database()); end $$;
```
It changes no function, view or table. It names no database and no instance.

**Done when** the file passes in `npm run test:sql`, `npm run build:ci` passes, and the poisons' red runs are in the PR.

## Task 3. Issues

Model: inline

The PR says `Refs #1091` (the investigation that found this; #1096 closes #1091). If the owner wants `pool_named`'s
folding weighed (design §5), it is filed as an issue with the design's figure; otherwise nothing more is filed.

## Review focus

- What the setting does to Acts an instance already holds: nothing is rewritten. Check that the migration is one
  `alter database` and that no function or view is touched.
- The first apply on the hosted instance: does its migration role own the database, and if `alter database` is refused,
  does the deploy stop there rather than pass on? (Design §5; the reviewer reads how migrations are applied, and touches
  no deployed database.)
- A setting copied by Task 1 that a test did not expect: any `alter database` a later migration makes now reaches every
  clone. Check the template's stored settings at the PR's head, and that none of them changes a file's meaning.
- The runner's own settings must win: a clone whose `scratch_url` named the template would send a race test's dblink
  sessions to the template. Check the order on the template's clones and on the end-to-end files' databases.
- The suite's timings with JIT off: a scale test whose bound was tuned with JIT's compile inside it now runs faster. No
  bound should need loosening; any that is tightened is out of scope.
