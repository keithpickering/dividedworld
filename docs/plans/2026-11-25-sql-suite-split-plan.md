Record, written 2026-11-25.

# The SQL suite, one clone a file and spread over runners: plan

The design is `docs/plans/2026-11-25-sql-suite-split-design.md`; read it first, all of it. Issues #587 and #579. Built
in one PR from `main`, rebased on whatever SQL builds have landed by then (#1086, #1088 and a read-bounds fix on 0434
were in flight on 2026-11-25). Any file those builds add is one more file on a clone; one that leans on another's rows
fails alone, and is fixed as Task 2 fixes the others.

No test is loosened, skipped or deleted, and no assertion's meaning changes. No migration, unless Task 2 finds a
product read whose plan turns on an estimate. No deployed database,
bucket or connector is touched: every run is against Postgres on localhost. CLAUDE.md is not changed, and neither is
`tools/build.mjs`'s `STEPS`. Every task is test first, with its red run recorded in the PR.

The words used below: the **template** (the database the runner builds once a run: shim, every migration,
`setup/fixtures.sql`, then `vacuum (analyze)`), a **clone** (`create database <clone> template <template>`, one for each
file), a **snapshot** (a database the runner keeps from part-way through the replay, for the end-to-end files that need
an older schema), a **shard** (the files at positions i, i+n, i+2n… of the one sorted list, counting from 1).

## Task 1. The runner: a template and a clone per file

Model: sonnet

Files: `tools/test-sql.mjs`, `tools/test-sql-refusal.mjs`, `tools/test-sql-coverage.mjs`, `tools/test-sql-drift.mjs`.

**Tests first** (`tools/test-sql-refusal.mjs`, with the recording psql it already uses; each red before the runner
changes):
- The template is built once: the shim, every migration and the fixtures go to one database, and a `vacuum (analyze)`
  follows the fixtures, once.
- Each assertion file and each end-to-end file goes to a database of its own, made by `create database … template
  <template>` before the file and dropped (`with (force)`) after it, pass or fail. A planted failure still drops its
  clone.
- Each clone is given, before anything connects to it, `lock_timeout`, `statement_timeout`, `track_functions`,
  `kayfabb.client_rpcs`, and `kayfabb.scratch_url` naming the clone itself. These replace today's checks that the
  scratch database is bounded before the shim. The poison: a runner that sets them on the template only (what
  `alter database` does not carry over, design §1) must fail these checks.
- No `vacuum (analyze)` is sent before any file; `VACUUM_STATEMENT`'s checks are removed with it.
- After each file, one psql call on its clone reads drift and the function counts, before the drop.
  `tools/test-sql-refusal.mjs`'s drift cases move from "after the last end-to-end file" to "after each file":
  a planted drift row on one file's clone fails that file's line and names the row.
- A hung file is still killed at `FILE_TIMEOUT_MS`, names its file, and the files after it still run; its clone is
  dropped.
- `KAYFABB_SQL_KEEP=failed`: a failing file's clone is kept and its URL printed; a passing file's is dropped.
- A pattern argument (`node tools/test-sql.mjs 0420`) runs only the matching files; with no match, the runner fails
  rather than passing on nothing.

`tools/test-sql-coverage.mjs`: its wiring checks read the new shape. `track_functions` is set on each clone, the counts
are read from each clone before its drop, and `uncalledReads` runs once, on the sum, after every file. The red run is
today's runner against the new checks.

`tools/test-sql-drift.mjs` drives `driftCheck` red against a real database whose trigger was disabled; it keeps doing so
on a clone of a template it builds as the runner does.

**The runner** (`tools/test-sql.mjs`). `main()` becomes: refuse the URL; build the template; for each file, clone, run,
read drift and counts, drop; sum and compare coverage; print the summary; drop the template. Functions to add, each
exported and pure where it can be: `cloneSql(template, clone, url)` (the `create database` and every `alter database …
set` for one clone, using `boundsSql`, `trackSql`, `clientRpcsSql` and the scratch URL), `afterFileSql` (drift rows and
the function counts in one call, read with `psqlRows` or a sibling that parses two result sets), `sumCalls(rows…)`. The
header's paragraphs on the shared scratch database, on the vacuum before each file and on drift and coverage at the end
are rewritten to say what is now true and why (design §1, §2, §4). `VACUUM_STATEMENT` goes, and so does every mention of
it. Each file's line gains its seconds (`PASS  0058-progress-scale.sql  102.2s`), and the summary lists the ten slowest.

**The red run** is the suite on a clone a file: the files of design §2's list fail. Task 2 is what makes it green, so
Tasks 1 and 2 land in the same PR.

## Task 2. The files that lean on another's rows

Model: sonnet

Files: the assertion files in design §2's list, any other the workflow's Postgres 17 fails alone, and any file a rebase adds that fails alone. `setup/fixtures.sql` only
where a helper is missing that several files need; never a row one file needs, which belongs in that file.

For each file, run it alone on a clone (Task 1's `node tools/test-sql.mjs <name>`), record the failure as its red run,
find which row it expected and why, and make the file build it.
- `0009-schedule.sql`, `0010-season-gap.sql`: they read `max(ends_at) from settlements`, and passed after
  `0007-aura-race.sql` committed a settlement (#579 traced it). The file writes the settlement it reads.
- `0012-cards.sql`, `0023-cards-screens.sql`, `0024-reading.sql`, `0025-profiles.sql`, `0036-bounded-reads.sql` hit
  the lock timeout inserting into `debuted_count`. The likely cause, not yet traced: on a fresh clone the window's row
  does not exist yet, so the file's open transaction and a dblink session both insert the same key, and the dblink
  session waits on a transaction that never ends. If so, the file commits that row first through the fixtures' committing helper
  (`setup/fixtures.sql`, the dblink-based setup at line 154 onward), as a race test commits its prerequisites.
- `0013-seasons.sql`, `0017-masks.sql`, `0033-screens-reads.sql`, `0099-boot.sql`, `0165-conduct-model-reads.sql`,
  `0400-pierce.sql`, and every other file on the list: each builds its own character, class history, window or player.
- `0321-veil-cover.sql`, `0304-post-veils.sql` and `0038-standings-season.sql` are read-cost guards that passed only on
  statistics an earlier file left. Each assertion stands on its own fixture at the scale it is about, analyzed in the file. If the product's read is what turns on the
  estimate, the product's SQL is rewritten so the plan does not depend on it, in a migration of its own, as #575 did for
  0344 and 0345; that is a product change and the PR says so.

A file that cannot be made to pass alone without changing what it asserts is a question for the owner, filed as an
issue the day it is found. It is not changed.

**The green run**: every assertion file passes alone on a clone, and the whole suite passes on clones.

## Task 3. The end-to-end files

Model: sonnet

Files: `tools/test-sql.mjs`, `tools/test-sql-refusal.mjs`, `supabase/tests/e2e/psql-db.ts`, the eleven end-to-end files
that create databases (`0003`, `0007`, `0008`, `0009`, `0010`, `0014`, `0018`, `0019`, `0026`, `0027`, `0029`; renaming
`0007-avatar-sweep.ts` to `0007-avatar-sweep-across-0025.ts`), `e2e/0028-cold-read-budget.ts`, and any end-to-end file
that fails alone.

**Tests first** (`tools/test-sql-refusal.mjs`):
- `snapshotPoints(e2eNames)`, pure: the migrations named by `-across-MMMM` in the end-to-end files' names, sorted, with
  no repeats. Red on a name with no point, on two files naming the same point, and on a point no migration has (the last
  fails the run before any file runs).
- While the template is replayed, before migration MMMM for each point, the runner makes a snapshot by `create database
  … template` of the database being built, and one migrated snapshot after the last migration and before the fixtures.
  The recording psql shows each `create database` between the right two migrations.
- The runner refuses an end-to-end file whose text (comments stripped) reads `supabase/migrations` or
  `migrationFiles`, as it refuses an assertion file that ends its own transaction. Poison: a file that replays the
  migrations itself.
- An end-to-end file is told where its snapshots are: `KAYFABB_SCRATCH_URL` names its clone, and
  `KAYFABB_SNAPSHOTS` names each snapshot (a JSON object of point to database name, and `migrated`).

**`psql-db.ts`**: `databaseBefore(migration: string): { url: string, drop: () => void }` and
`migratedDatabase(): { url, drop }`. Each clones the snapshot to a database named after the file's clone
(`<clone>_<suffix>`), refuses a point the runner did not snapshot, and drops it in `drop()`. The runner drops anything
named after a clone when it drops the clone, so a file that dies before its `finally` leaves nothing.

**The eleven files**: each takes its database from a helper instead of replaying migrations, and keeps everything it writes
and asserts. The upgrade tests replay only the migrations from their point on, which the helper's database does not
hold: `databaseBefore` answers the URL and the list of migrations still to apply, read from `migrationFiles()` by the
helper (the one place that reads the directory), so the file never reads it.

**Each end-to-end file alone.** Run each alone on a clone (design §2 names the seven that failed alone on Postgres 16); a file that leaned on an earlier file's commits is fixed to
write them itself, as in Task 2. `scratchSeed`'s merging of held reaction kinds and personas stays; on a clone it finds
only the fixtures' own.

**`e2e/0028-cold-read-budget.ts`**: its budgets are re-recorded from the workflow's own run on the clean state, by its
own rule (the workflow's figure, rounded up to one decimal, plus 0.3 MB). The first CI run on clones fails each budget
that is now far over or under and prints the table; the budgets are set from that table, and the run after is green.
Its header's account of the state it measures ("after the files before this one", "this is the last end-to-end file")
is rewritten to say it measures the template and its own fixture.

**The red run**: the eleven files replaying migrations, refused by the runner's new check. **The green run**: every
end-to-end file passes alone on a clone, and the suite's end-to-end time falls by about the eleven files' replays.

## Task 4. The pool and the shards

Model: sonnet

Files: `tools/test-sql.mjs`, `tools/test-sql-refusal.mjs`.

**Tests first**:
- `shardOf(files, i, n)`, pure: the files at positions i, i+n, i+2n… (1-based) of the list. Over `i = 1..n` the shards
  are disjoint, and their union is the list. Poisons, each of which must be red: an off-by-one that drops the last file,
  a split that repeats a file, and `i > n` or `n < 1` or a non-integer (the run fails before any file).
- `--shard=i/n` on the command line; with none, the run is 1/1.
- The pool: with `KAYFABB_SQL_WORKERS=3` and a recording psql that sleeps, three files are in flight at once and never a
  fourth; each file's output is printed as one block; a failing file does not stop the others; the failed count is the
  number of failed files.
- The report: `--report=<path>` writes JSON with `shard: {i, n}`, `files: [{ name, outcome, seconds }]`, and `calls` (the
  summed function counts). `gatherFailures(reports, allFiles)`, pure, answers every way the reports fail to cover the
  files: a file in no report, a file in two, a file not passed, a report's shard total that differs from another's, a
  missing shard number. Then `uncalledReads` runs on the calls summed over every report. Each is red on a planted report.
- `node tools/test-sql.mjs --gather=<dir>` reads every report in the directory, lists the files on disk, and fails on
  `gatherFailures` or on uncovered reads. It needs no database and refuses none.

**The runner**: the worker pool runs files with `child_process.spawn` (not `execFileSync`, which blocks the loop), at most
`KAYFABB_SQL_WORKERS` or `os.availableParallelism()` at once. Each file's clone name is unique to that file
(`<template>_<n>`). `FILE_TIMEOUT_MS` still kills one file's process and names it. A local run with no `--shard` builds
the template, runs every file in the pool, and runs the gather comparison in-process, so `npm run test:sql` is one
command that runs everything, as today.

**The green run**: locally, `npm run test:sql` with the pool, the time and the ten slowest files recorded in the PR
against today's serial run.

## Task 5. The workflow

Model: sonnet

Files: `.github/workflows/sql.yml`, `tools/check-release-workflows.mjs`, `tools/test-release-workflows.mjs`.

**Tests first** (`tools/test-release-workflows.mjs`, red before the rule exists): a new rule after the last one main
holds. In `sql.yml`, the job that runs the suite has a matrix whose only key is `shard`, its list is 1 to n with no gap
or repeat, and its command is exactly `npm run test:sql -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}
--report=<path>`. A job named `sql-total` `needs` it, runs even when a shard failed (`if: always()` with the shards'
outcome read), downloads every shard's report, and runs `node tools/test-sql.mjs --gather=<dir>`. Poisons: a gap in the
list, a second matrix key, a literal total, no gathering job, a gathering job that does not need the shards, and one
that is skipped when a shard fails.

**`sql.yml`**: `shard: [1, 2, 3, 4]`. Each shard uploads its report as an artifact named by its shard number, with a
prefix no other workflow in the release uses (`sql-report-`). `sql-total` checks out the candidate (R5 holds every
checkout to `ref`), sets up Node, downloads the reports, and gathers. `timeout-minutes: 30` on both jobs, replacing the
stopgap's 75, with the comment above it rewritten: what the limit is for, what was measured (design §1, §7), why 30 and
why four shards. `tools/test-sql-drift.mjs` runs in one shard only (the first), since it builds its own database and
needs no split. Release (`release.yml`) calls `sql.yml` as today; `needs.sql.result` covers every job in it.

**The red run** is the fault: today's 41-minute release run (45610008489) and PR #1088's run cancelled at 44 minutes.
**The green run** is this PR's own `sql` jobs: four shards and a gather, each shard's length recorded in the PR, the
four reports' files adding up to every file on disk.

## Task 6. The issues

Model: inline

Two issues, filed by the design session on 2026-11-25: #1091, `0420`
being more than twenty times slower after the files before it than alone, and #1092, a baseline for the migrations as a design
of its own. The build session links them in its PR and closes neither.

## Review focus

- What each file now starts from: a file that passed in order because of a row or a statistic an earlier file left, and
  now passes alone because Task 2 gave it the same row, still asserts what it asserted. Its red run alone is in the PR.
- A read-cost guard on a clone measures the same thing it measured in order: `0321`, `0425`, `0426`, `0058`, `e2e/0028`.
  None reads a time, and none reads another file's database.
- The split cannot lose a file: `shardOf`, the matrix list, and `sql-total`'s count of files against the files on disk.
  The gather fails when a shard is cancelled or never uploads.
- The clone's settings: every connection to a clone, each dblink session included, starts bounded, and `scratch_url`
  names the clone and not the template (`0000-harness.sql` is the guard; a race test that dblinks to the template would
  commit into every later clone).
- Nothing is left on the server: each clone, each end-to-end file's database and each snapshot is dropped on pass, fail,
  kill and Ctrl-C, and a run's leftovers cannot be confused with another run's (names carry the pid and time).
- The pool on a slow runner: four files at once on a runner that does two CPUs' work can stretch the longest statement
  (`e2e/0004-names.ts`); the PR records the longest statement and file under the pool against `SESSION_BOUNDS` and
  `FILE_TIMEOUT_MS`.
- The limit: 30 minutes is about three times the slowest shard the PR's own runs record. If it is not, the number of
  shards changes, not the limit.
