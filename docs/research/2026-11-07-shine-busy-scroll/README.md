# The busy-thread scroll on CI: what drops its frames

Record, written 2026-11-07, for keithpickering/dividedworld#304. Twenty runs of the Web workflow (`.github/workflows/web.yml`,
three shards, two Playwright workers a shard on GitHub's `ubuntu-latest`), five on each of four commits, each logging the
`shine-data` line that `e2e/shine.spec.ts`'s busy-thread scroll writes for every timed scroll. The raw lines, with each run's id,
conclusion and failing tests, are in `runs.json` beside this file.

## What was compared

| Label | Commit | The shine paints | Posts' 8em min-height | Redrawn |
|---|---|---|---|---|
| base | 0993d61 (#295's base) with the logging | the words' box | no | every frame |
| A | 3c0ff12 with the shine held to the words' box | the words' box | yes | every frame |
| B | 3c0ff12 without the min-height | the post's body | no | at its share, on-screen rows |
| head | 572324f (3c0ff12 with the logging) | the post's body | yes | at its share, on-screen rows |

A's and B's commits were throwaway branches (`ccr-f07e679d-exp-*`); their other failures are the tests each broke on purpose.

## What it found

| | base | A | B | head |
|---|---|---|---|---|
| Runs whose scroll check passed | 4 of 5 | 4 of 5 | 3 of 5 | 3 of 5 |
| Timed scrolls at 33 ms or more (p95 frame gap) | 5 of 9 | 5 of 9 | 6 of 9 | 6 of 9 |
| Share of the viewport the shine's canvases cover | 0.29–0.31 | 0.27–0.28 | 0.62–0.64 | 0.64–0.65 |
| Shine canvases on screen, a frame | 5.4–5.8 | 5.1–5.3 | 5.9–6.1 | 5.7–5.8 |
| Loop / foil worker own time, p95, at most | 1.6 / 5.0 ms | 2.8 / 6.3 ms | 2.1 / 6.0 ms | 1.4 / 6.5 ms |
| Control: the same scroll with every shine canvas hidden | 16.7–16.8 ms | 16.7–16.8 ms | 16.7–16.8 ms | 16.7–16.8 ms |
| Calibration before a scroll that held / dropped frames (median) | 114 / 130 ms | 138 / 158 ms | 100 / 160 ms | 130 / 178 ms |

- **The check missed before #295 too.** #295's base dropped frames in 5 of its 9 timed scrolls and failed one run in five: the
  frame-gap backstop was already sensitive to the runner, and #295 did not make it clearly worse at five runs a commit.
- **The shine is what is sensitive.** The control scroll, minutes later on the same page with the shine's canvases hidden, held
  16.7–16.8 ms in all twenty runs, including every one whose shine scroll dropped frames.
- **Neither the canvases' area nor how often they are redrawn decides it.** Covering half the viewport or more than a quarter,
  redrawn every frame or at a share, every variant dropped frames about as often. The loop and the worker stayed far inside their
  16 ms budgets throughout.
- **The runner's load tips it.** A fixed piece of work timed just before a scroll took longer, in the median, before the scrolls
  that dropped frames. The other Playwright worker on the shard shares the runner's two cores with the scroll.

## What it leaves open

- **Layer count.** About five or six canvases were on screen in every variant, so whether the compositor's cost follows the number
  of layers was not tested. Stacked effects on one post multiply it (a Glitter Bomb is up to three canvases).
- **Tall posts.** The thread's posts are a few hundred px tall; a post taller than the viewport, or several effects on one, is not
  in the story.
