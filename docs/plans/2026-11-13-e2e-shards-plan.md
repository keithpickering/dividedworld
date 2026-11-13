# The e2e shards' length: plan

Record, written 2026-11-13. A CI fix built straight from its issue (#605), dispatched by the session that watches and
merges PRs; no design session. Built in one PR from `main`.

No test is shortened, skipped or reordered, and no spec file changes. No migration. No deployed database, bucket or
connector is touched. CLAUDE.md is not changed, and neither is `tools/build.mjs` or `playwright.config.ts`. Of the
workflows only `web.yml` changes, and one comment in `build.yml` that names it.

## The problem

Each of the three `e2e` jobs in `.github/workflows/web.yml` has `timeout-minutes: 30`. On 2026-11-13 `e2e (3/3)` on
PR #566's head 50f9b990 (job 131606076799) was cancelled at that limit with 1,398 of its 1,436 tests done and none
failed, about a minute from its end. The same shard was cut the same way on 7923c559 (job 131582975044, 1,411 of 1,443
done, none failed; its re-run passed in 28m16s), and on c61accc3 and d9852352 on 2026-11-12 with a failure already
printed. Of the last 27 completed `e2e (3/3)` jobs, 13 took 28 minutes or more.

## The cause, measured

From 163 runs of `web.yml` on pull requests, 2026-11-11 17:15 UTC to 2026-11-13 01:20 UTC: 501 jobs, 467 logs.

**The suite is an hour of work and growing.** On main today it is 4,306 tests. With the two workers a runner gives,
the three shards' test steps are 20:19, 16:05 and 24:51 on a middling runner: 61 minutes in all. It was 3,292 tests 31
hours earlier. Set-up before the tests is 32s a job (the browser download 18s of it), and each shard builds the app
again in about 8s, so a job is its tests.

**The split is by count, and the last third is the slow third.** `playwright.config.ts` runs fully parallel, so
`--shard=i/3` cuts the list of tests (files in alphabetical order, then each file's own order) into three equal
counts: 1,436, 1,435 and 1,435. `a11y.spec.ts` is 2,535 of the tests, at about 0.7s each; `glass-layout.spec.ts` (591)
and `glass-text.spec.ts` (366) come late in the alphabet and cost 1.0s to 1.4s each, and are two thirds of shard 3's
time. So the shards are equal in count and 1.22 times the mean in time at the slow end. Under any equal-count split
the last shard is the heavy one.

**Runners differ by about 1.3.** The same shard on the same tests ranges from 0.82 to 1.22 of its median between the
10th and 90th percentile, and the slowdown is the same for every file, so it is the runner. Shard 3's median of 24:51
is 32 minutes on a slow runner.

**No file holds durations.** CI uses Playwright's dot reporter, which prints none; the times per file here come from
the log's timestamp on each line of 80 dots. A split by time needs a recorded time per test, which nothing records.
A split that keeps files whole cannot balance at all: `a11y.spec.ts` alone is 30 minutes.

**What a split by count gives**, from the same profile (median, and at 1.3 for a slow runner):

| Shards | Slowest shard | On a slow runner | Under a 30-minute limit |
|---|---|---|---|
| 3 (today) | 24:51 | 32:18 | over |
| 4 | 20:15 | 26:19 | 4 minutes of room |
| 5 | 17:13 | 22:22 | 8 |
| 6 | 15:17 | 19:52 | 10 |

A fourth shard alone would be back at the limit within days at the rate the suite has grown.

## The design

**Six shards, the limit kept at 30 minutes.** The slowest shard is then about 15 minutes, and 20 on a slow runner: the
limit is twice the one and half again the other. A shard costs about 40 seconds of set-up and build, so six cost two
minutes of runner time more than three, and every shard reports sooner than any does today. The limit stays where the
build's is (`build.yml` says so in a comment, which stays true).

**The total is said once.** Today the number of shards is written three times: the matrix's list, the job's name
(`/3`) and the command (`--shard=…/3`). A matrix of four with a command that still says `/3` fails loudly, but a list
with a gap (1, 2, 3, 5) or a command with a total larger than the list runs fewer tests and stays green. So the name
and the command take the total from GitHub's `strategy.job-total`, the number of jobs the matrix makes, and the matrix
is the one list.

**A check holds the shape**, because a shard that silently does not run is a suite that passes on tests nobody ran.
`tools/check-release-workflows.mjs`, which already holds `web.yml`'s shape for the release (R5), gains a rule: in
`web.yml` the job that runs `npm run test:e2e` has a matrix whose only key is `shard`, its list is exactly 1 to n in
order with no gap or repeat, and the command is `--shard=${{ matrix.shard }}/${{ strategy.job-total }}` (a second
matrix key would multiply `job-total`).

**Not in this PR, and filed on #605:** balancing by time. It needs a reporter that records each test's duration and a
committed or cached record to cut by, which is a design of its own; six shards by count is within what is there
today (`--shard`, one matrix) and leaves that open. "Two lists that must agree are one list" is about the build's
`STEPS`; the e2e suite is outside the build (`tools/build.mjs`'s `OUTSIDE_THE_BUILD`) and already runs in shards, and
this change makes its one list more nearly one.

## Tasks

### Task 1: the rule, test first

Model: sonnet

`tools/test-release-workflows.mjs`, red before the rule exists: the matrix's list with a gap (`[1, 2, 4]`); with a
repeat; not starting at 1; a second matrix key beside `shard`; the command with a literal total
(`--shard=${{ matrix.shard }}/3`); the command with no `--shard` at all. Each expects the new rule's own message. The
real files pass.

`tools/check-release-workflows.mjs`: the rule, numbered after the last rule main holds when the task is built (R8
there; PR #588, not yet merged, adds an R8 of its own for Postgres images, so this branch will meet it in a merge of
main and the later one is renumbered then). The header's list of rules says what it holds and why.

### Task 2: six shards

Model: sonnet

`.github/workflows/web.yml`: `shard: [1, 2, 3, 4, 5, 6]`; `name: e2e (${{ matrix.shard }}/${{ strategy.job-total }})`;
`npm run test:e2e -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}`; the comment above the strategy rewritten
with what was measured on 2026-11-13 and why six and why 30. `timeout-minutes: 30` stays. The artifact's name already
takes the shard's number.

**The red run** is the fault: job 131606076799, cancelled at 30 minutes with no test failed, and 131582975044.
**The green run** is this PR's own six `e2e` jobs: each prints `Running N tests using 2 workers, shard i of 6`, the six
counts add up to the whole suite's, and each ends well inside the limit. The PR records the six lengths.

## Design questions

1. The check runs' names change from `e2e (1/3)`… to `e2e (1/6)`…. If the repository's branch protection names the
   old three as required, it has to name the new six; a session cannot read or change that setting.

## Review focus

- The six shards together run every test exactly once: the counts in the six logs add up to `playwright test --list`.
- `strategy.job-total` is read where GitHub allows it (a job's `name` and a step's `run`).
- The comment in the workflow says only what was measured.
