# The build's length: plan

Record, written 2026-11-12. A fix built straight from its issue (#495, its first item), at the owner's word of
2026-11-12, with no design session. Built in one PR from `main`. The issue's second item (Settlement's Esc test) is
left alone.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added. No
migration. No deployed database, bucket or connector is touched. CLAUDE.md is not changed, and neither are the
workflows or `tools/build.mjs`: CI still runs `npm run typecheck`, then `npm run build:ci`, over the one `STEPS` list.

## The problem

The `build` job in `.github/workflows/build.yml` has `timeout-minutes: 15`. On 2026-11-11 and 2026-11-12 it was
cancelled at that limit on PRs #469, #449 (twice), #428 and #471 with no test failing.

## The root cause, measured

Run 43141375349 (a green one, main's shape): 49 steps in 690s, of which `npm run test:ui` was 638s. The next slowest
step was 59s, and the pool runs it beside `test:ui`. The build is as long as `test:ui`.

`test:ui` alone, on an idle machine with 4 CPUs (`vitest run --reporter=json`, main at 68186a7f): 658s wall, 212
files, 5,479 tests, about 900 seconds of test time in all. By file:

| | Wall | On |
|---|---|---|
| 211 files | 0s to 225s | three workers |
| `web/a11y.test.tsx`, 430 tests | 223s to 658s, 435s | one worker, the others idle |

That one file checks every Storybook story with axe, 428 stories at about a second each, and Vitest runs a file's tests
in order on one worker. Stories are found by glob, so the file grows with every screen and card, and the build grew
with it. The suite's length is one file on one CPU, not the suite's work over the CPUs.

What this rules out:

- **Sharding `test:ui` over CI runners, as e2e is sharded.** Vitest shards by file; Playwright's shards split a spec
  because its config is fully parallel. The shard holding `a11y.test.tsx` would still take 435s and more, and the
  local build would not change at all.
- **`isolate: false`.** Vitest's own report puts it at about 48 seconds of worker startup over the whole run, which is
  about 16 seconds of wall on three workers, for tests that would then share a module graph and a DOM across files.
- **A bigger number alone.** The file grows with each story; a limit raised today is reached again.

## The fix

Run the sweep on every worker. `vitest.config.ts` runs `web/a11y.test.tsx` once per part, each part a Vitest project
with `A11Y_PART` set ("3/8"), and each run takes its share of the stories. The number of parts is written once, in the
config. Everything else stays one project. Measured on the same machine: 396s, 221 files, the same 428 stories swept.
Vitest's default is one worker fewer than the CPUs, so the run is now bound by its work (about 900s over three
workers) and no longer by one file.

The job's `timeout-minutes: 15` stays: at about 400s of `test:ui` the build is under half of it, and 15 minutes still
ends a hang.

## Tasks

### Task 1: the split, as a pure function

Model: inline

- `web/a11y-share.ts`: `readPart(text)` reads `"i/n"` (not set is no part, the whole sweep; anything else throws,
  because a part misread as nothing would sweep no story and stay green); `share(items, part)` deals every n-th item.
- `web/a11y-share.test.ts`, first: every item is in exactly one part, for several n and lengths; sizes within one;
  neighbors go to different parts; `readPart` refuses each malformed value.

### Task 2: the sweep in parts

Model: inline

- `web/a11y-stories.tsx`: the story list (in a stated order), `SCREENS`, and `show(story)`: render, settle, play, and
  refuse an error page. Moved from `web/a11y.test.tsx` unchanged in what it asserts.
- `web/a11y.test.tsx`: its part's stories, each shown and held to axe; its part holds at least one story.
- `web/a11y-screens.test.tsx`: "each screen has a story that renders that screen's own content". It was the sweep's
  last test and read a map the sweep filled, which no one part can fill. For each screen it tries that directory's
  stories in order until one shows the selector.
- `vitest.config.ts`: the projects. A test in `web/a11y-share.test.ts` reads the config: the sweep runs once for each
  part, 1 to n of the same n, and the other project leaves it out.

### Task 3: the full run

Model: inline

`npm run build`, with the suite's JSON report read for: 428 story tests across the parts (the count before), each
story once.

## Review focus

- Every story the sweep held before is held now, exactly once, and a story added tomorrow is held with no edit.
- The screens test is as strict as the test it replaces: a screen whose stories all render something else fails.
- Nothing about `STEPS`, the workflows or the two commands CI runs changed.

## Not built here

- The `rehearsal`, `sql` and e2e jobs install packages with apt at run time (and Playwright's `--with-deps`), and died
  on 2026-11-11 when the runner could not resolve the Ubuntu mirrors. A separate concern, filed as its own issue.
- Issue #495's second item, the Settlement Esc test.
