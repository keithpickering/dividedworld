Record, written 2026-11-26.

# The e2e shards, cut by cost: plan

The design is `docs/plans/2026-11-26-e2e-cost-shards-design.md`. Read it first, all of it. Issue #1166, which the PR
closes. Built in one PR from `main`.

No test is loosened, skipped or deleted, and no assertion's meaning changes. Task 3 changes test titles only. No
migration, and no deployed database, bucket or connector is touched. CLAUDE.md is not changed. Every task is test
first, and its red run is recorded in the PR.

The words used below:
- A **key** is a test's `file › title › path`: the file relative to `e2e/`, then each describe title, then the test's
  title, joined by ` › `. It is the line Playwright's `--test-list` reads.
- A **price** is a test's estimated seconds, from the manifest.
- An **assignment** is the keys the packer gives one shard.
- The **manifest** is `e2e/cost.json`.

## Task 1. The packer: pure functions and their self-test

Model: sonnet

Files: `tools/e2e-cost.mjs` (new), `tools/test-e2e-cost.mjs` (new), `e2e/cost.json` (new), `tools/build.mjs` (`STEPS`).

`tools/e2e-cost.mjs` exports pure functions and touches no file except in its CLI (Task 5):
- `keysOf(listJson)` takes the JSON that `playwright test --list --reporter=json` prints and returns every test's key,
  in list order. It walks `suites[].specs[].tests[]` and nested `suites`, as this session's simulation did.
- `keyProblems(keys)` returns one string per key whose title holds `›` (naming the key), and one per key that is a
  `›`-prefix of another key in the same file.
- `price(key, manifest)` follows design section 3: the test's entry, else its spec's `mean`, else the suite's mean (total
  seconds over total count across `specs`), else 1.
- `pack(keys, manifest, n)` packs longest first. It sorts by price descending, then by key ascending. Each key goes into
  the shard with the least total so far, the lowest index winning a tie. It returns `n` arrays of keys and `n` totals.
- `parseCostShard(argv)` reads `--cost-shard=k/n` (1 ≤ k ≤ n, integers, one occurrence). It returns `{ k, n, rest }` or
  throws, naming the fault. It throws if `--shard` or `--test-list` is also present.
- `compareRun(assigned, reportJson)` takes the keys in the run's json report (via `keysOf`) and returns the keys that
  are missing and the keys that are extra.
- `testList(keys)` returns the file text: one key a line, ending with a newline.

`e2e/cost.json` starts as `{ "measured": null, "specs": {}, "tests": {} }`. A spec entry is `{ "count": n, "mean": s }`,
and a test entry is `"<key>": s`.

**Tests first** (`tools/test-e2e-cost.mjs`, in `STEPS` immediately before the check Task 2 adds; each red before the
function exists or is right):
- `keysOf` on a small hand-written list JSON with a nested describe gives the keys in order.
- `price` takes each of its four branches in turn.
- `pack` on 20 keys of mixed prices into 3: every key appears exactly once across the shards, and the shards' totals
  differ by no more than the largest single price. Run twice, it gives the same shards.
- Shuffling the input keys doesn't change the packing.
- A packer that drops the last key, and one that puts a key in two shards, are each driven red against the
  exactly-once assertion. These are the poisons, run as functions passed in.
- `keyProblems` names a title holding `›` and a prefix pair, and returns nothing for a clean list.
- `parseCostShard` accepts `--cost-shard=2/7`. It throws on `0/7`, `8/7`, `2/x`, two `--cost-shard` flags, and
  `--cost-shard` with `--shard` or with `--test-list`.
- `compareRun` reports one missing key and one extra key.
- `testList` of two keys gives two lines and a final newline.

## Task 2. The build's check

Model: sonnet

Files: `tools/check-e2e-cost.mjs` (new), `tools/test-e2e-cost.mjs`, `tools/build.mjs` (`STEPS`).

`problems({ manifest, keys, shards })` is pure, and its CLI reads the real inputs:
- It validates `manifest`. `measured` is null or `{ run, date }`. Every spec entry has an integer count ≥ 1 and a mean > 0.
  Every test entry is a number > 0, and its key's file has a spec entry. It returns one string per fault.
- It adds `keyProblems(keys)`.
- It returns a `report`, which is never a problem:
  - the share of the suite's estimated cost priced by fallback, meaning keys with no test entry whose spec has no entry;
  - the busiest shard's estimate at `shards`, its total over 2 workers, in minutes, against the 15-minute budget, with a
    line saying to add a shard number to web.yml's matrix when the estimate is over.

The CLI:
- runs `node <@playwright/test/cli> test --list --reporter=json` and parses its stdout;
- reads `e2e/cost.json`;
- reads `shards` as the length of the `shard` list in `.github/workflows/web.yml`'s e2e job, with the `yaml` package as
  `check-release-workflows.mjs` does. That keeps the matrix the one list.
- prints the report, and exits 1 on any problem.

The two workers and the 15 minutes are named once each, as exported constants in `tools/e2e-cost.mjs`.

**Tests first** (in `tools/test-e2e-cost.mjs`; poisons as fixtures):
- A clean manifest and clean keys give no problems.
- These poisons each give a problem: a spec with count 0, a negative mean, a test entry whose spec is missing, `measured`
  as a string, a key holding `›`, and a prefix pair.
- The report on a fixture names the unpriced share and the busiest estimate. It says to add a shard when the estimate is
  over 15 minutes, and it doesn't when the estimate is under.

**Red on the real suite.** With `check-e2e-cost.mjs` in `STEPS`, `node tools/check-e2e-cost.mjs` exits 1 on today's
50 titles that hold `›`. Record that run in the PR. Task 3 makes it pass.

## Task 3. The titles

Model: sonnet

Files: those `e2e/*.spec.ts` whose test or describe titles hold `›`. On 2026-11-26 that was `a11y.spec.ts` (1),
`focus.spec.ts` (1), `glass-hover.spec.ts` (2), `glass-layout.spec.ts` (26) and `glass-text.spec.ts` (20). Find them
with the check, not this count.

Change the title text only, writing `>` where it had `›`. Where the title is built from a value the test also uses
(a11y's `label`, 'Settings › Account', a page's name in glass-layout and glass-text), leave the value alone. Change only
how the title is formed, for example `${label.replace(' › ', ' > ')}`, or a separate title field. Every assertion, locator
and path stays byte-for-byte the same; the diff shows it. Comments that mention a page as "Settings › Account" are not
titles and stay.

**Green:** `node tools/check-e2e-cost.mjs` exits 0. `npx playwright test --list` gives the same count as before (5,502
on 2026-11-26, or whatever main has then). Run each changed spec in full locally (`KB_E2E_PORT` set per worktree), and it
passes as it did on main.

## Task 4. The runner

Model: sonnet

Files: `tools/test-e2e.mjs`, `tools/build.mjs` (its `OUTSIDE_THE_BUILD` reason for `tools/test-e2e.mjs`, if the wording
needs it).

With no `--cost-shard`, `tools/test-e2e.mjs` behaves exactly as today. With `--cost-shard=k/n` (`parseCostShard`):
1. List the suite (as the check's CLI does), get the keys, and refuse with the `keyProblems` if there are any.
2. Pack with the manifest, take shard k's keys, and write `e2e/report/timings/shard.list` (`testList`) and
   `e2e/report/timings/assigned.json` (`{ k, n, commit, keys }`). `commit` is `git rev-parse HEAD`.
3. Print one line: shard k of n, its test count, its estimate in minutes.
4. Run Playwright with the `rest` arguments and `--test-list e2e/report/timings/shard.list`.
5. Read `e2e/report/timings/results.json` and `compareRun`. Name every missing and every extra key, and exit 1 if there
   are any, even when Playwright passed. Otherwise exit with Playwright's status. If there is no report, exit 1 and say so.

Confirm two things before relying on them, and record what was seen:
- the CLI's `--reporter=json` on `--list` prints to stdout even though the config's CI reporter names an `outputFile`;
- a list line `file › describe › title`, with the file relative to `e2e/`, matches its test (Playwright compares
  against `config.rootDir`).

**Tests first:** the pure parts are Task 1's. The runner itself is outside the build (it needs a browser), so its red
and green are local runs, recorded in the PR:
- `CI=1 node tools/test-e2e.mjs --cost-shard=1/40 e2e/captions-routes.spec.ts` is refused, because a file filter would make the list
  differ from the packing's. The runner refuses positional filters with `--cost-shard`; add that to `parseCostShard` and
  its test.
- `CI=1 KB_E2E_PORT=4199 node tools/test-e2e.mjs --cost-shard=40/40` passes, and its `assigned.json` and `results.json`
  agree.
- A poisoned run, with one key in `shard.list` changed by hand to a title that doesn't exist (behind a
  `KB_E2E_POISON_LIST=1` the runner honors only to test this, documented in its header), exits 1 and names the missing
  key while Playwright itself passed.

## Task 5. The refresh

Model: sonnet

Files: `tools/e2e-cost.mjs` (its CLI and a pure `refresh`), `tools/test-e2e-cost.mjs`.

`refresh(old, shards, date, run)` is pure. `shards` is one `{ assigned, report }` per downloaded folder. It:
- refuses unless the `assigned.n` values agree, `k` covers 1 to n exactly once, and every `commit` is the same. It names
  what is missing or mismatched. A cancelled shard is never read as fast.
- for each assigned key, takes the summed `results[].duration` of a test whose final outcome is passed; otherwise it
  keeps `price(key, old)`;
- sets each spec's count to its assigned tests and its mean to the mean of those prices;
- keeps a test entry only where its price is more than twice or less than half its spec's new mean, rounded to 0.1 s;
- drops anything the run didn't assign;
- sets `measured` to `{ run, date }`.

Write it with keys sorted, two-space indent and a final newline, so diffs are stable.

The CLI is `node tools/e2e-cost.mjs --refresh <dir> --run <id>`. It reads every `<dir>/e2e-timings-*/` folder's
`assigned.json` and `results.json`, takes the date from the newest report's `stats.startTime`, writes `e2e/cost.json`,
and prints the per-shard estimates the new manifest gives.

**Tests first:**
- Three fixture shards refresh into the expected manifest.
- A failed test keeps its old price.
- An outlier keeps its entry, and a test near its mean loses its entry.
- A removed test is dropped.
- Poisons, each refused: shard 2 of 3 missing; two folders claiming k=1; commits that differ; n values that differ.

## Task 6. The workflows and the config

Model: sonnet

Files: `.github/workflows/web.yml`, `tools/check-release-workflows.mjs`, `tools/test-release-workflows.mjs`,
`playwright.config.ts`.

- **web.yml.**
  - The matrix becomes `shard: [1, 2, 3, 4, 5, 6, 7]`.
  - The command becomes `npm run test:e2e -- --cost-shard=${{ matrix.shard }}/${{ strategy.job-total }}`.
  - The sizing comment is rewritten to describe the cut by cost (`e2e/cost.json`, the packer in `tools/e2e-cost.mjs`), the
    15-minute budget against the 30-minute limit, and that the build's check reports when to add a shard.
  - The timing upload's comment says it carries the assignment too, and that `tools/e2e-cost.mjs --refresh` reads it.
  - `if-no-files-found` becomes `error`, since `globalTimeout` now means a file is always written.
- **R9.** The exact command string becomes the new one, and the header comment is reworded to match. New red cases in
  `test-release-workflows.mjs`:
  - the old `--shard=` command;
  - `--cost-shard=${{ matrix.shard }}/7`;
  - `--cost-shard` with a suffix on the total;
  - the flag only in a shell comment.

  Keep the existing matrix cases.
- **playwright.config.ts.**
  - `globalTimeout: process.env.CI ? 25 * 60_000 : undefined`, with a comment: the json report is written only at the end of
    a run, so a shard near the job's 30-minute limit stops itself first and still leaves the file `--refresh` reads.
  - The reporter and `fullyParallel` comments drop "cut by count" and say the shards are cut by cost (`tools/e2e-cost.mjs`).

**Tests first:** the R9 red cases fail against the old check. `node tools/test-release-workflows.mjs` prints "all cases
pass" after it. `node tools/check-release-workflows.mjs` exits 0 on the new web.yml.

## Task 7. The first manifest, from the PR's own run

Model: inline

The PR's first green CI run cuts the suite with the empty manifest, so every test costs 1 s and the cut is by count in
price order.
1. Download that run's seven `e2e-timings-*` artifacts into the scratchpad, each into its own new directory.
2. Run `node tools/e2e-cost.mjs --refresh <dir> --run <id>`.
3. Commit `e2e/cost.json` and push.
4. Record both runs' per-shard wall times in the PR: the count-like first and the cost-cut second. The second's busiest
   shard should be within about a minute of the others and under 15 minutes of tests. If it isn't, find the root cause
   before anything is changed.
5. Run `npm run build` and record the check's report line.

The PR's description says `Closes #1166`. Tick #1166's three follow-ups in the PR, saying where each went:
- `globalTimeout` (Task 6);
- the comment (Task 6);
- shard 6's large file, which is unchanged and noted.

## Review focus

- The partition: can any listed test be in no shard, or in two? Consider ties, a shard count larger than the test
  count, and a key holding `>`.
- Two runners of one commit computing different packings: anything in the list order, or the manifest read, that
  differs by machine.
- `--test-list` matching: a key Playwright reads differently from how the packer wrote it (a file path's root, a
  describe title with spaces at its ends, `>` inside a title). The run's report comparison should catch each case; check
  that it would.
- A shard stopped by `globalTimeout`: its report lists interrupted tests. Check that `compareRun` still counts them as
  run, and that `refresh` keeps their old prices rather than reading their partial durations.
- Task 3's diff changes titles only, with no value an assertion reads.
- The tail's report never fails the build, and a malformed manifest always does.
