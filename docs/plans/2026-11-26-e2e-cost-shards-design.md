Record, written 2026-11-26.

# The e2e shards, cut by cost: design

A design session with the owner for issue #1166. The owner picked option (B), balancing by cost, on 2026-11-26. That came after a
seventh shard cut by count (#1160, closed) left the last shard at 25.2 minutes, and after #1167 began uploading every
test's duration from every shard. The plan is `docs/plans/2026-11-26-e2e-cost-shards-plan.md`.

## 1. What was measured

Run 45811694449 (#1167's head af48d140, six shards by count, 5,502 tests, all passed, no retries). Each shard ran 917
tests. Their wall times were 699, 818, 1,014, 793, 1,139 and 1,323 s. The suite is 11,296 test-seconds over 97 specs. `a11y.spec.ts`
alone is 5,853 (52%), and the top ten specs hold 84%. Per-test cost runs from 0.9 s (list-rows) through 6.5–9 s
(hot-box, steel-chair, effect-tiles, hold) to 68 s (dent-bend's one test) and 81 s (hot-box's long-post hold under
forced colors). Every runner has two workers, so a shard's wall time is about half its test-seconds.

Why count fails: Playwright 1.63's `--shard=k/n` (`filterForShard` in `playwright/lib/runner/index.js`) cuts the test
groups, in file order, into runs of equal count. The heavy late-alphabet specs always land in the last shard, and a
seventh, eighth or tenth shard still leaves 550–790 of their tests there (#1166). `PWTEST_SHARD_WEIGHTS` only changes
how many tests each shard gets, never which tests go where, so it cannot fix this.

What Playwright offers instead: `--test-list <file>`, which takes one test per line as `file › title › path`, matched as
a prefix of each test's title path. A run with a list runs only the listed tests.

This session simulated the chosen design on that run's six `results.json` files. Pricing every test at its own time
gives seven shards of 13.4 min each. Pricing by spec means plus the outlier tests (section 3) gives 13.3–13.6 min.
Pricing by spec means alone gives 12.6–14.3 min.

## 2. How a test is assigned to a shard

**Decided: a committed cost manifest and a packer.** `npm run test:e2e -- --cost-shard=k/n` first lists the suite with
`playwright test --list` (about 2 s). A pure function prices every listed test from `e2e/cost.json` and packs the whole
list into n shards, longest first, each test going into the shard with the least cost so far. Ties are broken by test
key, so every runner of the same commit computes the same packing. Shard k's tests are written as a `--test-list`, and
Playwright runs them. Afterwards the runner reads the run's json report and fails unless it holds exactly the tests it
assigned to that shard, no more and no fewer.

Weighed:
- *Split the heavy specs into smaller files* so the count cut lands better. This needs no machinery, but it is redone by hand
  whenever a spec grows, and file order still decides. Rejected.
- *A separate a11y leg.* It fixes today's 52% but leaves the rest cut by count, with the same heavy tail. Rejected.

**The live list is the only list of what runs.** The manifest and the suite are two lists, and CLAUDE.md's "Two lists
that must agree are one list" applies. So the manifest is never asked to agree with the suite: it only gives prices. A
test missing from it is still listed and still assigned, at a fallback price. A manifest entry for a test that no longer
exists is ignored. A stale manifest makes the shards less even and never makes a test go unrun. The partition (every
listed test in exactly one shard) is a property of the pure packer, held by its self-test. The per-shard comparison of
the report against the assignment catches a list line that Playwright matched to nothing.

**Titles never carry `›`.** Playwright splits a list line on `›` (or on `>` when the line has no `›`). On 2026-11-26,
50 tests had `›` in a title: a11y 1, focus 1, glass-hover 2, glass-layout 26, glass-text 20. Those tests could not be
listed. **Decided:** the plan renames them to use `>`, which is safe because every line the packer writes uses `›`. The packer
refuses, naming the test, any title that holds `›`, and so does the build's check. A test whose title path is a prefix of
another's in the same file would match both, so it is refused too (none exists today). Weighed: a filter of our own, a
`grep` RegExp of about 900 escaped titles per shard built in `playwright.config.ts`. It keeps the titles, but a generated
regex that size is hard to read and to trust. Rejected. Titles are test names; no player reads them.

**Serial blocks** (`effect-tiles.spec.ts`, `shine.spec.ts`, `test.describe.configure({ mode: 'serial' })`) get no
special handling. Their tests share nothing (`playwright.config.ts` says so). A block split across two runners still
runs serially on each, and the block exists only to stop its tests from slowing each other's frames on one machine.

**The flag is a new one.** **Decided:** `--cost-shard=k/n`, never a reinterpreted `--shard`. Otherwise `--shard` would mean one
thing through `npm run test:e2e` and another through `npx playwright test`. The runner refuses `--cost-shard` combined
with `--shard` or `--test-list`.

## 3. What the manifest records

**Decided: spec means, plus the tests that stray from them.** For each spec, `e2e/cost.json` records its test count and
mean seconds per test. For each test whose time is more than twice or less than half its spec's mean, it records the test's own
seconds (428 tests on run 45811694449), rounded to 0.1 s. It also records the run it was measured from and that run's
date. The file is about 57 KB today, and a refresh's diff stays readable.

Prices, in order:
1. The test's own entry, if it has one.
2. Otherwise, its spec's mean.
3. For a spec not in the manifest, the suite's mean per test: the manifest's total seconds over its total count.
4. For a manifest with no specs at all, 1 s per test. Every test then costs the same, and the packing is by count.

Weighed:
- *Spec means only.* About 97 lines, but hot-box's 81 s test is priced at 7 s, so the outliers can stack. Simulated, the busiest
  shard at seven was 14.3 min against 12.6 for the lightest. Rejected.
- *Every test, rounded to whole seconds.* 5,502 entries, about 750 KB, and a large diff each refresh. Rejected, because the
  means-plus-outliers form prices within 0.2 min of it.
- *A fixed price for unknown tests.* That would underprice a new heavy spec until refreshed. Rejected in favor of the spec mean.

## 4. How the manifest stays current

**Decided: a refresh tool, and a report at the build's tail.** `node tools/e2e-cost.mjs --refresh <dir>` reads one run's
downloaded `e2e-timings-<k>` folders. Each shard uploads its assignment beside its report (`assigned.json`: k, n, the
commit, the test keys). The tool:
- refuses unless shards 1 to n are all present and all name the same commit. A cancelled shard is never read as a fast one.
- takes the duration of each test that passed;
- keeps the old entry's price for a test that did not pass, or that was interrupted;
- drops entries for tests the run did not list;
- writes the manifest with the run's id and date.

A session runs it and commits the result.

The build's check prints the unpriced share of the suite's estimated cost (tests priced by fallback) and the busiest
shard's estimate against the budget (section 5). Neither one fails the build. A new spec has no timing until its own CI
has run, and failing its PR for that would add a push for nothing. The share tells whoever reads the tail when to
refresh.

Weighed:
- *Fail the build over a threshold of unpriced cost.* This forces refreshes, but a PR adding a big spec would have to run CI,
  refresh and push again. Rejected.
- *Fetch the latest main run's artifacts at CI time.* Always fresh, but the shards would depend on another run, artifacts
  expire after 90 days, and a run could not be reproduced from the repository alone. Rejected. It would also tie the
  suite to GitHub's API, against "Portable by construction".

**A cancelled shard still writes its file.** #1166's follow-up: the json reporter writes only at the end, so a shard
cancelled at the 30-minute job limit uploaded nothing. **Decided:** on CI, `playwright.config.ts` sets `globalTimeout` to 25
minutes. A shard that runs that long stops itself, fails red, and still writes the report the refresh reads, with the
tests it did not reach marked interrupted. That leaves five minutes for setup and the uploads.

## 5. The time budget and the shard count

**Decided: 15 minutes of tests per shard, and seven shards.** The busiest shard's estimate is its test-seconds over the
runner's two workers. Fifteen minutes is the rule web.yml's sizing comment already follows: half the 30-minute job limit, so
a slow runner still finishes and a hang is still cut off. Seven shards put the suite of 2026-11-26 at about 13.4 min each,
with room to grow. The matrix in web.yml stays the one list of shards. The check reads n from it and reports the busiest
estimate at that n against the budget. When the report says the budget is passed, someone adds a number to the matrix.

Weighed:
- *Stay at six.* The balanced estimate (15.7 min) is over budget from the first day. Rejected.
- *Compute n from the manifest* in a job that emits the matrix. No hand edits, but it needs a dynamic matrix, one more job
  before e2e, and a rewrite of R9's "the matrix is the one list". Rejected.

## 6. The workflows

- **web.yml.** The matrix becomes `[1, 2, 3, 4, 5, 6, 7]`. The command is exactly
  `npm run test:e2e -- --cost-shard=${{ matrix.shard }}/${{ strategy.job-total }}`. The sizing comment is rewritten to
  describe the cost cut and its budget, and the timing upload's comment is rewritten too. The upload's path,
  `e2e/report/timings/`, also carries `assigned.json`.
- **R9** (`tools/check-release-workflows.mjs`) holds the new exact command. Its self-test gains red cases: Playwright's
  own `--shard` there, and a `--cost-shard` with a literal total.
- **release.yml is unchanged.** It calls web.yml with `uses:`, so a release runs the same cost shards from the
  candidate's own manifest.
- **playwright.config.ts.** The reporter comment ("shards are cut by count") is reworded, and `globalTimeout` is set on CI.

## 7. The rules this design answers to

- *Two lists that must agree are one list.* The suite's list decides what runs. The manifest only prices. The shard count
  lives in the matrix alone, and the check reads it from there.
- *A guard that has never been red is not known to work.* `check-e2e-cost.mjs` arrives with `test-e2e-cost.mjs`, and
  each poison is in the plan. The runner's report comparison is driven red in the same self-test. R9's new string arrives with its red cases.
- *A path in prose is a claim.* Every path named here exists by the end of the plan's last task.
- *Weigh a design at the scale of a busy instance*, here a growing suite. Listing costs about 2 s and packing is
  O(t log t + t·n) over a few thousand tests. Adding specs grows the manifest by one line each, plus their outliers.
  Growth past the budget shows in the build's tail and is answered with a shard number. No player, Act or mask is
  touched: this is CI machinery, neither engine nor instance.

## 8. Open

- **Within-shard balance** across the two workers is left to Playwright. The simulation priced shards as test-seconds ÷ 2.
  A shard whose last test is 81 s may run up to about a minute past its estimate. If measured runs show that, a later
  change can pack the heaviest tests first within each list. Playwright runs a list in file order, so that would need
  more than reordering the list.
- **When to refresh** is left to whoever reads the tail's report, with no set cadence.
