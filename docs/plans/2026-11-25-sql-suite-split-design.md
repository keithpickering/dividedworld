Record, written 2026-11-25.

# The SQL suite, one clone a file and spread over runners: design

A design session for issues #587 and #579, with the owner. Its plan is `docs/plans/2026-11-25-sql-suite-split-plan.md`.
The owner's answer to #587's question (2026-11-25) was "both": make the suite shorter, and spread it over runners, which
first needs #579 fixed. A stopgap PR raises the `sql` job's limit to 75 minutes while this is built; this design says
how it comes back down.

## 1. What was measured

**Today's main** (release run 45610008489, job 139201766873, head 7d8a2559): 271 migrations, 299 assertion files and 41
end-to-end files, in 41 minutes. From the log's stamps, each file's time includes the `vacuum (analyze)` before it:

| Part | Seconds |
|---|---|
| Set-up before the suite | about 32 |
| Migrations and fixtures | 17 |
| 299 assertion files | 1,742 |
| 41 end-to-end files | 716 |

The time is concentrated: the 10 slowest files are 37% of it, the 40 slowest 72%. 213 files take under 2 seconds and
230 seconds between them. `0420-hot-posts.sql` alone is 218 seconds.

**Order is part of the cost.** The same files were run on this container's Postgres (4 cores) two ways: in name order
on one database as `tools/test-sql.mjs` runs them, and each alone on a fresh clone of a database built once (shim,
migrations, fixtures). Local seconds:

| File | Alone on a clone | In order | CI, in order |
|---|---|---|---|
| `0420-hot-posts.sql` | 6.3 | 142.0 | 217.8 |
| `0058-progress-scale.sql` | 102.2 | 81.7 | 107.5 |
| `0168-conduct-concealing.sql` | 79.3 | not measured | 110.1 |
| `0032-unmask.sql` | 61.4 | 46.5 | 46.1 |
| `0310-patrol-weights.sql` | 51.5 | 21.6 | 36.8 |
| `0372-origin-scale.sql` | 46.8 | 45.9 | 70.5 |
| `0064-follows.sql` | 37.7 | 53.9 | 52.6 |
| `0116-search.sql` | 30.5 | 37.8 | 51.0 |
| `0321-veil-cover.sql` | fails | 26.4 | 38.9 |

`0420` spends more than 95% of its suite time on the state the files before it left, not on its own test. Others run
about as fast either way, or faster in order: their cost is their own fixture.

**Where a scale file's time goes.** An Act inserted through `acts`' 30 triggers and 64 indexes costs about 1 ms
(5,000 posts in 5.3 s). `0032` spends 40 of its 46 seconds writing 23,000 Acts; the plan assertions after that are
milliseconds.

**A clone costs what the vacuum it replaces costs.** The template is 26 MB. `create database … template` takes about
0.11 s (the default `wal_log` strategy; `file_copy` is 0.17 s), a drop about 0.2 s, and the `vacuum (analyze)` that now
runs before every file about 0.2 s on a clone-sized database. Four clones of one template made at once all succeed.
`play_post_drift()` and a read of the function statistics on a clone take 35 ms together.

**Settings do not travel with a clone.** `alter database … set` is stored for the database it names, so a clone made
from the template has none of the template's settings: no `lock_timeout`, no `statement_timeout`, no `track_functions`,
no `kayfabb.client_rpcs`, and no `kayfabb.scratch_url`. `0000-harness.sql` goes red on such a clone ("this file's
connection is unbounded"), which is the guard this design leans on.

**The migrations' replay is not the cost.** Replaying all 271 is 17 seconds. The eleven end-to-end files that replay
migrations into databases of their own add about 170 seconds between them.

## 2. One clone a file (decided)

The runner builds a **template** once a run: the shim, every migration, `setup/fixtures.sql`, then `vacuum (analyze)`
once. Every assertion file and every end-to-end file then runs on a **clone** of its own, made just before it and
dropped just after it, pass or fail.

- Order stops mattering, and a file cannot reach another's rows. A race test that commits through dblink commits into
  its own clone, which is dropped. That ends #579's leaks for good, not only the ones known today.
- The `vacuum (analyze)` before each file (`VACUUM_STATEMENT`, PR #575) is no longer needed and goes: every clone starts
  from the template's one analyzed state, a fresh session's plan cache is empty, and the cumulative statistics that
  decide autovacuum start at zero for a new database. #575's second layer, that a plan assertion stands on its own
  fixture and analyzes it, is what every file still has to do.
- Each clone is given the settings the scratch database has today, before anything connects to it: the session bounds,
  `track_functions = all`, `kayfabb.client_rpcs`, and `kayfabb.scratch_url` naming the clone itself, so a race test's
  dblink sessions open on its own clone.
- A file can be run alone. `npm run test:sql -- <pattern>` builds the template and runs the files whose names match, and
  `KAYFABB_SQL_KEEP=failed` keeps a failed file's clone and prints its URL instead of dropping it, so a failure can be
  read where it happened.

Alternatives weighed. **Self-sufficient files on one shared database**, with a check that each passes alone, is cheaper
to run, but a leak can come back with any new file, and files run in parallel on one database would see each other's
commits. **A clone for each worker or shard**, with files in order inside it, is less isolation and leaves order
mattering inside the shard.

### The files that lean on another's rows

Run alone on a fresh clone (with the scratch database's settings applied), these 16 assertion files fail on today's main.
#579 named the first twelve on 2026-11-12; four are new.

| File | Fails alone with |
|---|---|
| `0009-schedule.sql`, `0010-season-gap.sql` | `seasons_check` at `update seasons set ends_at = …` |
| `0012-cards.sql`, `0023-cards-screens.sql`, `0024-reading.sql`, `0025-profiles.sql`, `0036-bounded-reads.sql` | the lock timeout, a dblink session inserting into `debuted_count` |
| `0013-seasons.sql` | `write_unmask`: the character held no class at the date |
| `0017-masks.sql` | `it debuts at the end of the window it was made in` |
| `0033-screens-reads.sql` | `a waiting character has not debuted` |
| `0038-standings-season.sql` | a plan check: the page's amounts read by a filter |
| `0099-boot.sql` | `another player's character is in the boot` |
| `0165-conduct-model-reads.sql` | a JSON read of a row it expected |
| `0304-post-veils.sql` | a plan check on `acts_origin_plays` |
| `0321-veil-cover.sql` | `an author veil landing fetched 11247 rows of acts` |
| `0400-pierce.sql` | an assertion at line 33 of a `do` block |

This container runs Postgres 16 and the workflow runs 17, and plan checks differ by version (#596), so the list is
confirmed in the workflow's own run. Each is fixed to build what it needs, so it passes alone; none is loosened or
skipped.

Seven end-to-end files failed alone on this container: `0001-settlement`, `0003-export`, `0007-avatar-sweep`,
`0013-handover`, `0015-a-day-of-the-staff`, `0028-cold-read-budget` and `0029-cards-on-a-spun-thread`. `0028` refuses any
Postgres but the workflow's 17 (this container runs 16), so it says nothing here; the others are traced in the build.

Two more facts from the same runs. `0424-staff-requests.sql` fails both alone and in order, as it did in today's release
run; that is main's own failure, being fixed elsewhere, not order. `0425-pool-read-bounded.sql` fails in order and passes
alone, here and in today's release run, so one of that run's three failures was the order.

`0321-veil-cover.sql`, `0304-post-veils.sql` and `0038-standings-season.sql` are read-cost guards that fail on a fresh
clone and pass in order: their plans were right only on statistics an earlier file left. Each is fixed as #575 fixed the others:
its assertion stands on its own fixture, at the scale it is about, analyzed in the file.

## 3. The end-to-end files (decided)

Every end-to-end file runs on its own clone too, which ends their reliance on each other's commits (the reason
`e2e/0037` was just given a session of its own) and on what the assertion files left.

**Databases of their own come from the runner.** Eleven end-to-end files replay migrations into a database they create.
Seven are upgrade tests: they replay the migrations before one migration, write rows as the old schema wrote them, then
replay the rest. Four (`0003`, `0009`, `0027`, `0029`) replay every migration into a fresh database. Instead:

- While the runner replays the migrations for the template, it also keeps, for each upgrade test, a database of the
  migrations before the one it crosses, and one **migrated** database (shim and every migration, no fixtures). Each is
  made from the database being built, at that point in the replay, by `create database … template`, which is possible
  because each migration runs in a psql of its own that has ended.
- The point is the file's own name: an upgrade test is named `NNNN-<name>-across-MMMM.ts` and crosses migration
  `MMMM`. Six already are; `0007-avatar-sweep.ts`, which stops before 0025, becomes `0007-avatar-sweep-across-0025.ts`.
  The name is the one list: no table in the runner says which file needs which point.
- A file asks `supabase/tests/e2e/psql-db.ts` for a database (`databaseBefore(migration)` or `migratedDatabase()`) and
  gets a clone of that snapshot, named after its own clone so it is unique, and dropped with it.
- The runner refuses an end-to-end file that reads `supabase/migrations` itself, as it refuses an assertion file that
  ends its own transaction, so a file cannot go back to replaying on its own.

**`e2e/0028-cold-read-budget.ts`** holds each screen function's memory to a budget measured "after the files before
this one". On a clone, the state it measures is the template and its own fixture. Its budgets are measured again in
the workflow on that state, by the rule the file already states (a budget is the workflow's own figure plus 0.3 MB),
and its header's account of where the budget comes from is rewritten. Its far-under check, which fails a budget more
than a tenth or 0.6 MB above what is measured, is what makes the first run name every budget to lower.

## 4. Coverage and drift on a clone (decided)

Two steps read the whole run's database at the end today, and a dropped clone takes its rows and its statistics with
it. So after each file, before its clone is dropped, one psql call reads both:

- **Drift**: `play_post_drift()` on that clone. A drift is then named with the file that made it, which today's single
  check at the end cannot do. It runs after every file, assertion files included, since a race test's dblink commits
  stay in its clone until the drop.
- **Coverage**: the calls `pg_stat_user_functions` holds for the client reads. The counts are summed over every file,
  and the comparison (`uncalledReads`) runs on the sum once every file has run. Every connection a file opened has
  ended by then, and a backend flushes its counts when it exits.

## 5. Parallel, on one runner and over several (decided)

**A worker pool on each runner.** The runner runs as many files at once as the machine has CPUs
(`os.availableParallelism()`, or `KAYFABB_SQL_WORKERS`), each on its own clone of the one template. Files are taken in
name order. Each file's output is printed as one block when it ends, so lines from different files never interleave.

**Shards over runners, split by position.** `tools/test-sql.mjs --shard=i/n` runs the files at positions i, i+n, i+2n
and so on, counting from 1, of the one sorted list (assertion files, then end-to-end files). Every file is in exactly one
shard, and no list but the files on disk says which. `sql.yml` runs a matrix whose only key is `shard`, with the total
taken from `strategy.job-total`, as `web.yml`'s e2e shards do (R9). A split by recorded times would balance better, but
needs a timing record kept up to date; a split by position needs nothing, and clones flatten the worst file (§1).

**A gathering job proves the split.** Each shard writes a report: the files it ran with each one's outcome and seconds,
and its coverage counts. A `sql-total` job after the matrix reads every shard's report and fails unless every file on
disk ran exactly once and passed, then runs the coverage comparison on the counts summed over every shard. A shard that
silently ran nothing, a split that dropped a file, or a file run twice is red here. A local run is shard 1/1 and does
the same in one process.

**"Two lists that must agree are one list."** The SQL suite is outside the build's `STEPS` (it needs a database, and
`tools/build.mjs` lists it under `OUTSIDE_THE_BUILD`). Its one list is the files on disk, split by a pure function, and
the matrix's list of shards is the one list of shards. A rule in `tools/check-release-workflows.mjs` holds `sql.yml`'s
shape as R9 holds `web.yml`'s, and the gathering job holds the split itself.

**Every guard runs on every PR.** Nothing is skipped or run less often: every file runs once in every run, in one shard
or another.

**The read-cost guards keep their meaning.** Each reads a figure that belongs to its own backend or its own database,
never a time: rows read (`pg_stat_xact_all_tables`, counted by transaction), buffers touched (hit and read summed, so
another database's pages in the shared buffers change the split but not the sum), plans (read on its own clone's
statistics), and a backend's memory. `0425` and `0426` forge empty statistics on `acts` inside their own transaction,
which a clone does not change. What parallel files on one server change is how long a statement takes, which no guard
reads.

## 6. The scale files keep their own fixtures (decided)

Each scale file builds the shape its guard is about: `0058` one board at 2,000 and then 20,000 posts, `0032` 3,000
tallies of 20 turns, `0372` 400 plays on one origin. They are there on purpose ("Weigh a design at the scale of a busy
instance") and stay as they are, each on its own clone. Weighed and not taken: one busy instance built once a run and
cloned by every scale file. It saves runner time, but 31 guards would then rest on one shared fixture, and a change to it
would move every one of them, which is #579's coupling made explicit. With clones and the pool, the shortest a shard can
be is its longest file, not the sum of its files.

So that a slow file shows rather than creeps in, every file's line says its seconds, and the run's summary lists the ten
slowest.

## 7. The limits (decided)

**The job's limit comes down to 30 minutes** in the PR that turns on the matrix, the figure the build and the e2e shards
use. From §1: about 2,450 seconds of files on today's main, less what clones take off (`0420`'s state, and a vacuum per
file), spread over four shards of a pool each. A shard is then expected in about 6 to 10 minutes on a slow runner, set-up
and template included, and no less than its slowest file. Thirty minutes is three times that. Four shards to start; a
fifth is one more entry in the matrix's list.

**The bounds inside the suite stay.** A lock wait ends at 30 s and a statement at 300 s (`SESSION_BOUNDS`), a file at 10
minutes (`FILE_TIMEOUT_MS`). The longest statement is `e2e/0004-names.ts`'s query over every folded code point, 30 to 50
s here; four files at once on four CPUs can stretch it, and 300 s is still six times its usual length. The longest file
alone is about 110 s on CI, a sixth of the file limit. Separate clones share no rows, so no lock wait crosses files.

## 8. Not in this design, filed

- **`0420-hot-posts.sql` is more than twenty times slower after the files before it than alone** (#1091). A read whose cost
  grows with what else the database holds may be a product cost and not a test's, so it is filed for a look of its own
  before clones hide it.
- **A baseline for the migrations** (#1092). The owner asked whether the long chain must be kept. Squashing it changes deployed
  history (`supabase_migrations`, `tools/check-deployed-migrations.mjs`, the rehearsal) and would retire the upgrade
  tests, which matter only for an instance that existed before the migration they cross. It is a design of its own; the
  owner is "not concerned about 17s out of 41min".

## 9. What the owner answered

1. Isolation: a clone for every file.
2. Parallel: a pool on each runner, and shards split by position.
3. The end-to-end files' databases: runner-made snapshots, with the squashing of migrations a design of its own.
4. The scale files keep their own fixtures.
