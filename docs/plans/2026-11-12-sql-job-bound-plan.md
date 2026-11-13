# The SQL job's time limit: plan

Record, written 2026-11-12. A CI fix built straight from its fault, dispatched by the session that watches and merges
PRs because the fault blocks every open PR; no design session. Built in one PR from `main`.

No `check-*.mjs` is added (Task 3 adds a rule to an existing one) and no test is shortened, skipped or reordered. No
migration. No deployed database, bucket or connector is touched. CLAUDE.md is not changed, and neither is `tools/build.mjs` or `tools/test-sql.mjs`; of the
workflows only the `sql` job's time limit (Task 1) and the Postgres image's name (Task 3).

## The problem

The `sql` job in `.github/workflows/sql.yml` has `timeout-minutes: 15`. On 2026-11-12 it was cancelled at that limit,
with the suite still running and no test failing, on PR #559 (job 131504988560), PR #569 (job 131485438294) and branch
`claude/wizardly-planck-40edty` (job 131483994396). Runs that passed the same day took 13m57s to 14m55s. A PR with no
SQL in its diff goes green or cancelled by which runner it drew.

## The cause, measured

From the job logs of twelve runs between 2026-11-07 and 2026-11-12 (GitHub stamps every line, and
`tools/test-sql.mjs` prints one line as each file ends, one file after another).

**Where the time goes** (PR #562's green run, job 131506276542, a head that contains main; 14m27s):

| Part | Seconds | Share |
|---|---|---|
| Set up, containers, checkout, Node, `npm ci` | about 30 | 3% |
| Replaying 197 migrations and the fixtures | 16 | 2% |
| 205 assertion files | 532 | 61% |
| 26 end-to-end files | 287 | 33% |

The time is in the files, not the replay. Twelve files are 55% of the step: `0058-progress-scale.sql` 82s,
`0168-conduct-concealing.sql` 65s, `e2e/0004-names.ts` 42s, `0116-search.sql` 41s, `e2e/0003-export.ts` 39s, and seven
more of 25s to 30s. About 185 assertion files share 97s. The eight end-to-end files that create and drop databases are
146s of the 287s. No log shows a hang: every silence is one slow file.

**The suite grew.** The `npm run test:sql` step, same kind of runner:

| Day | Migrations / assertion files / e2e files | Step |
|---|---|---|
| 2026-11-07 | 117 / 122 / 18 | 420s |
| 2026-11-11 | 153 / 166 / 20 | 573s |
| 2026-11-12, before #428 | 193 / 196 / 25 | 545s to 809s |
| 2026-11-12, with #428 | 197 / 205 / 26 | 830s to about 940s |

**Runners differ by half again.** The same suite (193 / 196 / 25) took 545s, 575s and 809s on three runners on
2026-11-12, as #515 found for the build (four CPUs reported, about two CPUs' work on a slow one). #428 added about 70s
to 90s, which took a slow runner's run over the limit; a fast runner's was never near it.

**How far over.** The three cancelled runs stopped inside the end-to-end files with about 45s, 60s and 2s left, going
by the same files' times in #562's run. So a slow runner's whole job today is about 16 minutes. GitHub counts the limit
from the first step after the containers start, and cancels at 15m00s of that.

**What is coming.** PR #575 will add a `vacuum (analyze)` before every file and new scale fixtures: about 2.5 minutes
on a 4-core machine where the suite is 9 to 10 minutes, so about 4 minutes on a slow runner. That makes about 20
minutes.

## The limit

`timeout-minutes: 45`.

The limit is there to end a job that will never end, and it is the last of four: inside the suite a lock wait ends at
30s, a statement at 300s and a file at 10 minutes (`tools/test-sql.mjs`). So a wide limit costs little: a hang is
ended by the suite long before the job's limit, and the limit only has to be well clear of a run in which every file
is slow.

Forty-five minutes is a little over twice the 20 minutes a slow runner will need once #575 lands. It is not the 30
minutes of the build and the e2e shards: at 30 the room would be 10 minutes, and the suite gained 7 minutes or more in
the five days measured (420s to between 830s and about 940s). The number buys time; it does not make the suite
shorter, and Task 2 files that.

## Tasks

### Task 1: the limit

Model: inline

`.github/workflows/sql.yml`: `timeout-minutes: 45`, with a comment above it that says what the limit is for, what was
measured and why the number is not 30.

**The red run** is the fault itself: the three jobs cancelled at 15m00s named above, recorded in the PR with their log
lines. **The green run** is this PR's own `sql` job, which runs the whole suite under the new limit, and after merge a
slow runner's job that ends past 15 minutes and passes.

The limit has no test of its own, as the build's had none in #503: nothing in the repository reads a job's limit, and
a check that the number is "big enough" would hold a second copy of a measurement that changes with every test file.

### Task 2: the issue

Model: inline

File an issue that says the suite should be made shorter or spread over runners, with the measurements above, and
leaves the design to the owner. It names what bears on it: "Two lists that must agree are one list" and the owner's
answer on splitting `test:ui` in #515; #579, which stands in the way of running a file alone or files on different
runners; the twelve files that are 55% of the step; and the eight end-to-end files that create and drop databases.

### Task 3: the Postgres image, named by digest

Model: sonnet

Added 2026-11-13, at the owner's word on #596 as the merging session relayed it: name the image by 17.11's digest in
this PR, so that CI runs the same Postgres until a PR moves it, and a new Postgres arrives as one red PR and not as
every PR going red at once. #596 stays open for making the suite hold on 17.12.

**The fault.** Both workflows that start a Postgres (`.github/workflows/sql.yml` and
`.github/workflows/rehearsal.yml`) say `image: postgres:17`, a tag that moves. Between 21:38 and 22:15 UTC on
2026-11-12 it moved from 17.11 to 17.12, and every `sql` job since has failed: three on this PR (jobs 131531867021,
131538686788, 131549085404) and one on `main` alone (job 131560473402), on `0058-progress-scale.sql` (a statement that
runs to the 300s `statement_timeout`), `0146-card-writes.sql` and `0166-surface-log.sql`. The twelve runs read on
17.11 passed those files. Those four jobs are the red runs of the pin; its green run is this PR's `sql` job.

**The change.** In both workflows:
`image: postgres:17.11@sha256:ff87138949ad9a46f32ff23bd6852b52ce024a13dffe9b4087be98292cdd3b4f`, the digest every
passing run pulled. Docker pulls by the digest; the tag beside it only says which version the digest is. A comment in
`sql.yml` says why, and how to move it: a PR of its own that changes the one string in both files, whose `sql` and
`rehearsal` jobs then run on the new image.

**The check.** Two files that must name the same image are two lists that must agree, and a workflow file cannot read
another's. So `tools/check-release-workflows.mjs` gains a rule, R8: every `services` entry in any workflow whose image
is a Postgres names it as `postgres:<version>@sha256:<64 hex>`, and all of them are the same string. Test first, in
`tools/test-release-workflows.mjs`, each driven red before the rule exists and by the rule's message after:
`sql.yml` back on `postgres:17`; `rehearsal.yml` on a digest that differs from `sql.yml`'s; a tag with no digest
(`postgres:17.11`). The real files pass.

The setup script's note (`scripts/setup-container.sh`) says "CI runs Postgres 17" and stays true.

## Review focus

- The comment in the workflow says only what the logs show.
- Nothing in the suite, its order or its files changes.
- The image string is identical in both workflows and is the digest the passing runs pulled.
